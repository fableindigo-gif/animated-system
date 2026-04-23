/**
 * Integration tests for the write-back routes.
 *
 * Covers:
 *   • GET  /api/feed-enrichment/writeback
 *       - happy path: tasks enriched with latestAttempt from audit logs
 *       - no audit log entries → latestAttempt null on every task
 *       - maxAttempts always returned in response
 *       - unauthenticated caller → 401
 *   • POST /api/feed-enrichment/writeback/run
 *       - no taskIds → calls worker to drain all approved tasks
 *       - specific taskIds forwarded to worker
 *       - all-applied result → 200
 *       - partial failure → 207
 *       - malformed body → 400
 *       - unauthenticated caller → 401
 *   • POST /api/feed-enrichment/writeback/retry-drain
 *       - unauthenticated → 401
 *       - analyst role → 403
 *       - manager role → triggers scheduler, returns result
 *
 * The DB and all worker modules are mocked; no real database or network is
 * touched. Follows the same patterns as quality-fixes-routes.test.ts.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// ── Logger ────────────────────────────────────────────────────────────────────
vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

// ── Shoptimizer service ───────────────────────────────────────────────────────
vi.mock("../services/shoptimizer-service", () => ({
  MAX_BATCH: 50,
  optimizeBatch: vi.fn(),
  BatchTooLargeError: class extends Error { code = "BATCH_TOO_LARGE" as const; max = 50; },
  InfrastructureFailureError: class extends Error { code = "SHOPTIMIZER_UNREACHABLE" as const; },
}));

vi.mock("../lib/shoptimizer-client", async () => {
  const { z } = await import("zod");
  return {
    merchantProductSchema: z.object({ offerId: z.string() }).passthrough(),
  };
});

// ── Workers ───────────────────────────────────────────────────────────────────
vi.mock("../workers/quality-fixes-scanner", () => ({
  runQualityFixesScan: vi.fn(),
  rescanProductsByIds: vi.fn(),
}));
vi.mock("../workers/quality-fixes-apply", () => ({
  applyQualityFixToShopify: vi.fn(),
  applyQualityFixesToShopifyBulk: vi.fn(),
  undoQualityFixOnShopify: vi.fn(),
  APPLY_TOOL_NAME: "shopify_apply_quality_fix",
  UNDO_TOOL_NAME: "shopify_undo_quality_fix",
  APPLY_PLATFORM: "shopify",
}));
vi.mock("../workers/feed-enrichment", () => ({
  runFeedEnrichment: vi.fn(),
}));

const runShoptimizerWritebackMock = vi.fn();
const runWritebackRetrySchedulerMock = vi.fn();

vi.mock("../workers/shoptimizer-writeback", () => ({
  runShoptimizerWriteback:        (...a: unknown[]) => runShoptimizerWritebackMock(...a),
  runWritebackRetryScheduler:     (...a: unknown[]) => runWritebackRetrySchedulerMock(...a),
  SHOPTIMIZER_WRITEBACK_TOOL:     "gmc_applyShoptimizerDiff",
  SHOPTIMIZER_WRITEBACK_PLATFORM: "gmc",
  WRITEBACK_MAX_ATTEMPTS:         5,
  classifyWritebackFailure:       vi.fn(),
}));

vi.mock("../routes/feed-enrichment/feedgen", () => ({
  default: express.Router(),
}));

// ── Tier middleware ───────────────────────────────────────────────────────────
let currentOrgId: number | null = 42;

vi.mock("../middleware/enrichment-tier", () => ({
  checkEnrichmentTier: () => (req: any, _res: any, next: any) => {
    req.enrichmentCtx = currentOrgId == null
      ? null
      : { orgId: currentOrgId, tier: "base", limit: 5000, monthlyUsed: 0, remaining: 5000 };
    next();
  },
  resolveEnrichmentContext: async (req: any) => req.enrichmentCtx ?? null,
  TIER_LIMITS: { enterprise: Infinity, default: 5_000 },
}));

// ── DB mock ───────────────────────────────────────────────────────────────────
const selectQueue: unknown[] = [];
const selectSpy = vi.fn();

function makeBuilder(getResult: () => unknown) {
  const b: any = {};
  b.innerJoin = () => b;
  b.leftJoin  = () => b;
  b.where     = () => b;
  b.orderBy   = () => b;
  b.limit     = () => b;
  b.offset    = () => b;
  b.then = (resolve: any, reject: any) =>
    Promise.resolve().then(getResult).then(resolve, reject);
  return b;
}

vi.mock("@workspace/db", () => {
  const tbl = (cols: string[]) =>
    Object.fromEntries(cols.map((c) => [c, c])) as Record<string, string>;

  const proposedTasks = tbl([
    "id", "idempotencyKey", "status", "workspaceId", "toolName",
    "toolDisplayName", "toolArgs", "displayDiff", "reasoning",
    "platform", "platformLabel", "snapshotId", "comments",
    "proposedBy", "proposedByName", "proposedByRole",
    "assignedTo", "assignedToName",
    "resolvedBy", "resolvedByName", "resolvedAt",
    "attemptCount", "nextRetryAt", "lastRetryClass", "createdAt",
  ]);
  const auditLogs = tbl([
    "id", "toolName", "toolArgs", "result", "status",
    "organizationId", "createdAt",
  ]);
  const workspaces         = tbl(["id", "organizationId"]);
  const organizations      = tbl(["id", "subscriptionTier", "name", "slug"]);
  const feedEnrichmentJobs = tbl(["id", "organizationId", "status", "createdAt", "processedSkus"]);
  const warehouseShopifyProducts = tbl([
    "id", "tenantId", "productId", "sku", "title", "imageUrl", "status",
    "syncedAt", "llmEnrichedAt", "llmAttributes", "description",
  ]);
  const productQualityFixes = tbl([
    "id", "tenantId", "productId", "sku", "status", "errorCode", "errorMessage",
    "pluginsFired", "changedFields", "changeCount", "productSyncedAt", "scannedAt",
  ]);
  const productFeedgenRewrites = tbl(["id"]);

  const select = vi.fn((cols?: unknown) => {
    selectSpy(cols);
    return {
      from: vi.fn((_tbl: unknown) => makeBuilder(() => selectQueue.shift() ?? [])),
    };
  });
  const insert = vi.fn((_tbl: unknown) => ({
    values: vi.fn((vals: Record<string, unknown>) => ({
      returning: vi.fn(async () => [{ id: 1, ...vals }]),
    })),
  }));
  const update = vi.fn((_tbl: unknown) => ({
    set: vi.fn(() => ({ where: vi.fn(async () => {}) })),
  }));
  const execute = vi.fn(async () => ({ rows: [] }));

  return {
    db: { select, insert, update, execute },
    proposedTasks,
    auditLogs,
    workspaces,
    organizations,
    feedEnrichmentJobs,
    warehouseShopifyProducts,
    productQualityFixes,
    productFeedgenRewrites,
  };
});

// ── RBAC helper ───────────────────────────────────────────────────────────────
function makeRbacUser(role = "manager", workspaceId = 10) {
  return { id: 99, name: "Test User", role, workspaceId, organizationId: 42 };
}

// ── Server ────────────────────────────────────────────────────────────────────
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { default: feedRouter } = await import("../routes/feed-enrichment/index");
  const app = express();
  app.use(express.json());
  // Inject rbacUser on all requests via a test middleware
  app.use((req: any, _res, next) => {
    if ((req as any)._testRbacUser !== undefined) {
      req.rbacUser = (req as any)._testRbacUser;
    } else {
      req.rbacUser = makeRbacUser();
    }
    // enrichmentCtx will be added by the mocked checkEnrichmentTier / resolveEnrichmentContext
    req.enrichmentCtx = currentOrgId == null
      ? null
      : { orgId: currentOrgId, tier: "base", limit: 5000, monthlyUsed: 0, remaining: 5000 };
    next();
  });
  app.use("/api/feed-enrichment", feedRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

beforeEach(() => {
  selectQueue.length = 0;
  selectSpy.mockClear();
  runShoptimizerWritebackMock.mockReset();
  runWritebackRetrySchedulerMock.mockReset();
  currentOrgId = 42;
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/feed-enrichment/writeback", () => {
  it("returns tasks enriched with latestAttempt populated from audit log", async () => {
    const task = {
      id: 7,
      status: "failed",
      toolDisplayName: "Fix offer shoe-123",
      toolArgs: { offerId: "shoe-123" },
      proposedByName: "Alice",
      createdAt: new Date().toISOString(),
      workspaceId: 10,
      attemptCount: 1,
      nextRetryAt: null,
      lastRetryClass: "quota",
    };
    const auditEntry = {
      id: 99,
      toolArgs: {
        proposedTaskId: 7,
        retry: { retryClass: "quota", retryable: true, retryAfterSec: 60, hint: "Quota hit" },
        httpStatus: 429,
      },
      result: { success: false, message: "rate limited" },
      status: "failed",
      createdAt: new Date().toISOString(),
    };

    // First query: proposedTasks list
    selectQueue.push([task]);
    // Second query: audit_logs for those task ids
    selectQueue.push([auditEntry]);

    const res = await fetch(`${baseUrl}/api/feed-enrichment/writeback`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.maxAttempts).toBe(5);
    expect(body.tasks).toHaveLength(1);

    const t = body.tasks[0];
    expect(t.id).toBe(7);
    expect(t.offerId).toBe("shoe-123");
    expect(t.latestAttempt).not.toBeNull();
    expect(t.latestAttempt.retry.retryClass).toBe("quota");
    expect(t.latestAttempt.retry.retryable).toBe(true);
    expect(t.latestAttempt.httpStatus).toBe(429);
    expect(t.latestAttempt.result.success).toBe(false);
  });

  it("returns latestAttempt: null when no audit log entries exist for the task", async () => {
    const task = {
      id: 12,
      status: "approved",
      toolDisplayName: "Apply fix",
      toolArgs: { offerId: "boot-99" },
      proposedByName: "Bob",
      createdAt: new Date().toISOString(),
      workspaceId: 10,
      attemptCount: 0,
      nextRetryAt: null,
      lastRetryClass: null,
    };
    // First query: tasks
    selectQueue.push([task]);
    // Second query: audit logs — empty
    selectQueue.push([]);

    const res = await fetch(`${baseUrl}/api/feed-enrichment/writeback`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.tasks[0].latestAttempt).toBeNull();
  });

  it("returns maxAttempts in every response", async () => {
    selectQueue.push([]);
    const res = await fetch(`${baseUrl}/api/feed-enrichment/writeback`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(typeof body.maxAttempts).toBe("number");
    expect(body.maxAttempts).toBeGreaterThan(0);
  });

  it("returns 401 when org context cannot be resolved", async () => {
    currentOrgId = null;
    const res = await fetch(`${baseUrl}/api/feed-enrichment/writeback`);
    expect(res.status).toBe(401);
  });

  it("only uses the most recent audit log entry per task (first seen wins)", async () => {
    const task = { id: 5, status: "failed", toolDisplayName: "Fix", toolArgs: { offerId: "x-1" },
      proposedByName: "C", createdAt: new Date().toISOString(), workspaceId: 10,
      attemptCount: 2, nextRetryAt: null, lastRetryClass: "transient" };

    const newerLog = {
      id: 200,
      toolArgs: { proposedTaskId: 5, retry: { retryClass: "transient", retryable: true, retryAfterSec: 30, hint: "5xx" }, httpStatus: 503 },
      result: { success: false, message: "upstream error" },
      status: "failed",
      createdAt: new Date().toISOString(),
    };
    const olderLog = {
      id: 100,
      toolArgs: { proposedTaskId: 5, retry: { retryClass: "quota", retryable: true, retryAfterSec: 60, hint: "old quota" }, httpStatus: 429 },
      result: { success: false, message: "quota old" },
      status: "failed",
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    };

    // The route orders by desc(createdAt), so newerLog appears first in the array
    selectQueue.push([task]);
    selectQueue.push([newerLog, olderLog]);

    const res = await fetch(`${baseUrl}/api/feed-enrichment/writeback`);
    const body = await res.json() as any;
    expect(body.tasks[0].latestAttempt.retry.retryClass).toBe("transient");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/feed-enrichment/writeback/run", () => {
  it("returns 200 and passes taskIds to worker when provided", async () => {
    runShoptimizerWritebackMock.mockResolvedValue({
      totalRequested: 2, totalApplied: 2, totalFailed: 0, results: [],
    });

    const res = await fetch(`${baseUrl}/api/feed-enrichment/writeback/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskIds: [3, 7] }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.totalRequested).toBe(2);
    expect(body.totalApplied).toBe(2);
    expect(body.totalFailed).toBe(0);

    expect(runShoptimizerWritebackMock).toHaveBeenCalledOnce();
    const callArg = runShoptimizerWritebackMock.mock.calls[0][0];
    expect(callArg.taskIds).toEqual([3, 7]);
    expect(callArg.organizationId).toBe(42);
  });

  it("drains all approved tasks when no taskIds given", async () => {
    runShoptimizerWritebackMock.mockResolvedValue({
      totalRequested: 5, totalApplied: 5, totalFailed: 0, results: [],
    });

    const res = await fetch(`${baseUrl}/api/feed-enrichment/writeback/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const callArg = runShoptimizerWritebackMock.mock.calls[0][0];
    expect(callArg.taskIds).toBeUndefined();
  });

  it("returns 207 when all tasks failed (none applied)", async () => {
    runShoptimizerWritebackMock.mockResolvedValue({
      totalRequested: 2, totalApplied: 0, totalFailed: 2,
      results: [
        { taskId: 2, offerId: "b", ok: false, httpStatus: 429, message: "quota", retry: { retryClass: "quota", retryable: true, retryAfterSec: 60, hint: "Quota hit" } },
        { taskId: 3, offerId: "c", ok: false, httpStatus: 400, message: "bad",   retry: { retryClass: "non_retryable", retryable: false, retryAfterSec: null, hint: "Fix diff" } },
      ],
    });

    const res = await fetch(`${baseUrl}/api/feed-enrichment/writeback/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskIds: [2, 3] }),
    });

    expect(res.status).toBe(207);
    const body = await res.json() as any;
    expect(body.totalApplied).toBe(0);
    expect(body.totalFailed).toBe(2);

    const quotaResult = body.results.find((r: any) => r.taskId === 2);
    expect(quotaResult.ok).toBe(false);
    expect(quotaResult.retry.retryClass).toBe("quota");
    expect(quotaResult.retry.retryable).toBe(true);
    expect(quotaResult.retry.retryAfterSec).toBe(60);

    const nonRetryableResult = body.results.find((r: any) => r.taskId === 3);
    expect(nonRetryableResult.ok).toBe(false);
    expect(nonRetryableResult.retry.retryClass).toBe("non_retryable");
    expect(nonRetryableResult.retry.retryable).toBe(false);
    expect(nonRetryableResult.retry.retryAfterSec).toBeNull();
  });

  it("returns 200 when some applied and some failed (partial success)", async () => {
    runShoptimizerWritebackMock.mockResolvedValue({
      totalRequested: 3, totalApplied: 1, totalFailed: 2,
      results: [
        { taskId: 1, offerId: "a", ok: true,  httpStatus: 200, message: "ok",   retry: { retryClass: "none", retryable: false, retryAfterSec: null, hint: "" } },
        { taskId: 2, offerId: "b", ok: false, httpStatus: 429, message: "quota", retry: { retryClass: "quota", retryable: true, retryAfterSec: 60, hint: "Quota hit" } },
        { taskId: 3, offerId: "c", ok: false, httpStatus: 400, message: "bad",   retry: { retryClass: "non_retryable", retryable: false, retryAfterSec: null, hint: "Fix diff" } },
      ],
    });

    const res = await fetch(`${baseUrl}/api/feed-enrichment/writeback/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskIds: [1, 2, 3] }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.totalApplied).toBe(1);
    expect(body.totalFailed).toBe(2);
  });

  it("returns 200 (not 207) when nothing was requested (zero tasks)", async () => {
    runShoptimizerWritebackMock.mockResolvedValue({
      totalRequested: 0, totalApplied: 0, totalFailed: 0, results: [],
    });

    const res = await fetch(`${baseUrl}/api/feed-enrichment/writeback/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
  });

  it("returns 400 for malformed taskIds (non-integer array element)", async () => {
    const res = await fetch(`${baseUrl}/api/feed-enrichment/writeback/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskIds: ["not-a-number"] }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBeDefined();
  });

  it("returns 401 when org context cannot be resolved", async () => {
    currentOrgId = null;
    const res = await fetch(`${baseUrl}/api/feed-enrichment/writeback/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(401);
    expect(runShoptimizerWritebackMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/feed-enrichment/writeback/retry-drain", () => {
  it("returns 401 when no authenticated user present", async () => {
    // Temporarily override rbacUser to be null for this one request by sending
    // a custom header that signals the test middleware. Instead, we just set
    // currentOrgId to null so resolveEnrichmentContext fails first — but
    // retry-drain checks rbacUser before org context. Let's hit a fresh server
    // instance via a custom app.
    const app2 = express();
    app2.use(express.json());
    // No rbacUser injected
    const { default: feedRouter } = await import("../routes/feed-enrichment/index");
    app2.use("/api/feed-enrichment", feedRouter);
    const server2 = await new Promise<Server>((resolve) => {
      const s = app2.listen(0, () => resolve(s));
    });
    const url2 = `http://127.0.0.1:${(server2.address() as AddressInfo).port}`;

    try {
      const res = await fetch(`${url2}/api/feed-enrichment/writeback/retry-drain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(401);
    } finally {
      await new Promise<void>((resolve, reject) => server2.close((e) => e ? reject(e) : resolve()));
    }
  });

  it("returns 403 when caller is an analyst (non-manager)", async () => {
    // Use a separate mini-app with analyst rbacUser
    const app3 = express();
    app3.use(express.json());
    app3.use((req: any, _res, next) => {
      req.rbacUser = makeRbacUser("analyst");
      req.enrichmentCtx = { orgId: 42, tier: "base", limit: 5000, monthlyUsed: 0, remaining: 5000 };
      next();
    });
    const { default: feedRouter } = await import("../routes/feed-enrichment/index");
    app3.use("/api/feed-enrichment", feedRouter);
    const server3 = await new Promise<Server>((resolve) => {
      const s = app3.listen(0, () => resolve(s));
    });
    const url3 = `http://127.0.0.1:${(server3.address() as AddressInfo).port}`;

    try {
      const res = await fetch(`${url3}/api/feed-enrichment/writeback/retry-drain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(403);
      expect(runWritebackRetrySchedulerMock).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => server3.close((e) => e ? reject(e) : resolve()));
    }
  });

  it("triggers the retry scheduler and returns its result for a manager", async () => {
    runWritebackRetrySchedulerMock.mockResolvedValue({ rescheduled: 3, skipped: 1 });

    const res = await fetch(`${baseUrl}/api/feed-enrichment/writeback/retry-drain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.rescheduled).toBe(3);
    expect(runWritebackRetrySchedulerMock).toHaveBeenCalledOnce();
  });
});
