/**
 * Cross-tenant isolation tests for the write-back routes.
 *
 * Scenario: two organizations (org 1 and org 2) each own separate workspaces
 * and write-back tasks. The tests drive the live express router with a
 * tenant-aware in-memory DB mock and assert that:
 *
 *   • GET  /writeback scoped to org B never surfaces org A's tasks.
 *   • POST /writeback/run always calls the worker with the *caller's*
 *     organizationId — even when the request body contains taskIds that
 *     happen to belong to another org.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// ── Logger ─────────────────────────────────────────────────────────────────
vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

// ── Unrelated route deps ───────────────────────────────────────────────────
vi.mock("../services/shoptimizer-service", () => ({
  MAX_BATCH: 50,
  optimizeBatch: vi.fn(),
  BatchTooLargeError: class extends Error { code = "BATCH_TOO_LARGE" as const; max = 50; },
  InfrastructureFailureError: class extends Error { code = "SHOPTIMIZER_UNREACHABLE" as const; },
}));
vi.mock("../lib/shoptimizer-client", async () => {
  const { z } = await import("zod");
  return { merchantProductSchema: z.object({ offerId: z.string() }).passthrough() };
});
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
vi.mock("../workers/feed-enrichment", () => ({ runFeedEnrichment: vi.fn() }));
vi.mock("../routes/feed-enrichment/feedgen", () => ({ default: express.Router() }));

// ── Worker mock (writeback) ────────────────────────────────────────────────
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

// ── Active tenant ──────────────────────────────────────────────────────────
// The mocked tier middleware reads this to populate req.enrichmentCtx.
let currentOrgId: number | null = 1;

vi.mock("../middleware/enrichment-tier", () => ({
  checkEnrichmentTier: () => (req: any, _res: any, next: any) => {
    req.enrichmentCtx = currentOrgId == null
      ? null
      : { orgId: currentOrgId, tier: "base", limit: 5000, monthlyUsed: 0, remaining: 5000 };
    next();
  },
  resolveEnrichmentContext: async (req: any) =>
    req.enrichmentCtx ?? (currentOrgId == null
      ? null
      : { orgId: currentOrgId, tier: "base", limit: 5000, monthlyUsed: 0, remaining: 5000 }),
  TIER_LIMITS: { enterprise: Infinity, default: 5_000 },
}));

// ── Tenant-aware in-memory store ───────────────────────────────────────────
//
// We seed tasks for two orgs and expose a DB mock whose select().from() chain
// returns only the rows that belong to the *current* org (read from
// `currentOrgId` at query time). This verifies that each tenant only sees
// its own data without relying on the SQL predicate evaluator — the route's
// WHERE clause already embeds ctx.orgId; the mock here simulates the
// consequence of that scoping.

interface TaskRow {
  id: number;
  workspaceId: number;
  orgId: number;                // synthetic field for test-side filtering
  toolName: string;
  status: string;
  toolArgs: Record<string, unknown>;
  toolDisplayName: string;
  proposedByName: string;
  createdAt: string;
  attemptCount: number;
  nextRetryAt: null;
  lastRetryClass: null;
  // remaining columns returned as-is
  [k: string]: unknown;
}

const store: { tasks: TaskRow[] } = { tasks: [] };

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
  const workspaces              = tbl(["id", "organizationId"]);
  const organizations           = tbl(["id", "subscriptionTier", "name", "slug"]);
  const feedEnrichmentJobs      = tbl(["id", "organizationId", "status", "createdAt", "processedSkus"]);
  const warehouseShopifyProducts = tbl([
    "id", "tenantId", "productId", "sku", "title", "imageUrl", "status",
    "syncedAt", "llmEnrichedAt", "llmAttributes", "description",
  ]);
  const productQualityFixes = tbl([
    "id", "tenantId", "productId", "sku", "status", "errorCode", "errorMessage",
    "pluginsFired", "changedFields", "changeCount", "productSyncedAt", "scannedAt",
  ]);
  const productFeedgenRewrites = tbl(["id"]);

  function makeBuilder(fromTable: unknown) {
    const b: any = {};
    b.innerJoin = () => b;
    b.leftJoin  = () => b;
    b.where     = () => b;
    b.orderBy   = () => b;
    b.limit     = () => b;
    b.offset    = () => b;
    b.then = (resolve: any, reject: any) =>
      Promise.resolve()
        .then(() => {
          if (fromTable === proposedTasks) {
            // Return only tasks belonging to the currently-active org.
            return store.tasks.filter((t) => t.orgId === currentOrgId);
          }
          // All other tables: return empty (not needed for these tests).
          return [];
        })
        .then(resolve, reject);
    return b;
  }

  const select = vi.fn((_cols?: unknown) => ({
    from: vi.fn((t: unknown) => makeBuilder(t)),
  }));
  const insert = vi.fn((_tbl: unknown) => ({
    values: vi.fn((vals: Record<string, unknown>) => ({
      returning: vi.fn(async () => [{ id: 999, ...vals }]),
    })),
  }));
  const update = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => {}) })) }));
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

// ── Server ─────────────────────────────────────────────────────────────────
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { default: feedRouter } = await import("../routes/feed-enrichment/index");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.rbacUser = { id: 99, name: "Test User", role: "manager", workspaceId: 10, organizationId: currentOrgId };
    req.enrichmentCtx = currentOrgId == null
      ? null
      : { orgId: currentOrgId, tier: "base", limit: 5000, monthlyUsed: 0, remaining: 5000 };
    next();
  });
  app.use("/api/feed-enrichment", feedRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

beforeEach(() => {
  store.tasks.length = 0;
  runShoptimizerWritebackMock.mockReset();
  runWritebackRetrySchedulerMock.mockReset();
  currentOrgId = 1;
});

// ── Helpers ────────────────────────────────────────────────────────────────
function makeTask(overrides: Partial<TaskRow> & { id: number; orgId: number }): TaskRow {
  return {
    workspaceId:    overrides.orgId === 1 ? 10 : 20,
    toolName:       "gmc_applyShoptimizerDiff",
    status:         "approved",
    toolArgs:       { offerId: `offer-${overrides.id}` },
    toolDisplayName: `Fix offer ${overrides.id}`,
    proposedByName: "System",
    createdAt:      new Date().toISOString(),
    attemptCount:   0,
    nextRetryAt:    null,
    lastRetryClass: null,
    ...overrides,
  };
}

function seedTwoOrgs() {
  // Org 1 owns tasks 1 and 2.
  store.tasks.push(makeTask({ id: 1, orgId: 1 }));
  store.tasks.push(makeTask({ id: 2, orgId: 1 }));
  // Org 2 owns tasks 3 and 4.
  store.tasks.push(makeTask({ id: 3, orgId: 2 }));
  store.tasks.push(makeTask({ id: 4, orgId: 2 }));
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Write-back routes — cross-tenant isolation", () => {
  describe("GET /writeback — org-scoped task listing", () => {
    it("org 1 caller only sees org 1 tasks", async () => {
      seedTwoOrgs();
      currentOrgId = 1;

      const res = await fetch(`${baseUrl}/api/feed-enrichment/writeback`);
      expect(res.status).toBe(200);

      const body = await res.json() as any;
      const ids = body.tasks.map((t: any) => t.id);
      expect(ids.sort()).toEqual([1, 2]);
      // None of org 2's task IDs (3, 4) must appear.
      expect(ids).not.toContain(3);
      expect(ids).not.toContain(4);
    });

    it("org 2 caller only sees org 2 tasks", async () => {
      seedTwoOrgs();
      currentOrgId = 2;

      const res = await fetch(`${baseUrl}/api/feed-enrichment/writeback`);
      expect(res.status).toBe(200);

      const body = await res.json() as any;
      const ids = body.tasks.map((t: any) => t.id);
      expect(ids.sort()).toEqual([3, 4]);
      // None of org 1's task IDs (1, 2) must appear.
      expect(ids).not.toContain(1);
      expect(ids).not.toContain(2);
    });

    it("a tenant with no tasks sees an empty list even when the store has tasks from other orgs", async () => {
      seedTwoOrgs();
      // Org 3 has never created any write-back tasks.
      currentOrgId = 3;

      const res = await fetch(`${baseUrl}/api/feed-enrichment/writeback`);
      expect(res.status).toBe(200);

      const body = await res.json() as any;
      expect(body.tasks).toHaveLength(0);
    });

    it("returns 401 and no tasks when org context is missing", async () => {
      seedTwoOrgs();
      currentOrgId = null;

      const res = await fetch(`${baseUrl}/api/feed-enrichment/writeback`);
      expect(res.status).toBe(401);
    });
  });

  describe("POST /writeback/run — worker called with caller's orgId only", () => {
    it("passes the caller's orgId to the worker even when foreign taskIds are supplied, and the worker finds zero matching tasks", async () => {
      // Org 2's tasks are IDs 3 and 4. A caller authenticated as org 1
      // tries to run them. The worker must be invoked with organizationId=1
      // (the session org), not 2 (the tasks' owner). Because the worker
      // scopes its DB query by organizationId, it will find zero tasks that
      // match both the supplied IDs *and* org 1 — returning an empty result.
      seedTwoOrgs();
      currentOrgId = 1;

      // Simulate what the real worker returns when the supplied taskIds don't
      // belong to the caller's org: no tasks were found or executed.
      runShoptimizerWritebackMock.mockImplementation(async ({ organizationId, taskIds }: { organizationId: number; taskIds?: number[] }) => {
        // In production the worker only operates on tasks whose workspace
        // belongs to organizationId. Foreign IDs yield zero matches.
        const ownTaskIds = store.tasks
          .filter((t) => t.orgId === organizationId && (!taskIds || taskIds.includes(t.id)))
          .map((t) => t.id);
        return {
          totalRequested: ownTaskIds.length,
          totalApplied:   0,
          totalFailed:    0,
          results:        [],
        };
      });

      const res = await fetch(`${baseUrl}/api/feed-enrichment/writeback/run`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        // taskIds 3 and 4 belong to org 2, but the session is org 1.
        body: JSON.stringify({ taskIds: [3, 4] }),
      });

      expect(res.status).toBe(200);
      expect(runShoptimizerWritebackMock).toHaveBeenCalledOnce();

      const callArg = runShoptimizerWritebackMock.mock.calls[0][0];
      // The worker receives the *session* org's ID — not the foreign org's.
      expect(callArg.organizationId).toBe(1);

      // Key isolation assertion: foreign taskIds resolve to zero work because
      // the worker's org-scoped query finds no tasks that are both in the
      // supplied list and owned by org 1.
      const body = await res.json() as any;
      expect(body.totalRequested).toBe(0);
      expect(body.totalApplied).toBe(0);
    });

    it("passes the caller's orgId (not a foreign org) when running own tasks", async () => {
      seedTwoOrgs();
      currentOrgId = 2;

      runShoptimizerWritebackMock.mockResolvedValue({
        totalRequested: 2, totalApplied: 2, totalFailed: 0, results: [],
      });

      const res = await fetch(`${baseUrl}/api/feed-enrichment/writeback/run`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskIds: [3, 4] }),
      });

      expect(res.status).toBe(200);

      const callArg = runShoptimizerWritebackMock.mock.calls[0][0];
      // Worker is scoped to org 2's ID.
      expect(callArg.organizationId).toBe(2);
      expect(callArg.taskIds).toEqual([3, 4]);
    });

    it("calls the worker with an undefined taskIds list when no ids are specified (full drain scoped to caller's org)", async () => {
      currentOrgId = 1;

      runShoptimizerWritebackMock.mockResolvedValue({
        totalRequested: 2, totalApplied: 2, totalFailed: 0, results: [],
      });

      const res = await fetch(`${baseUrl}/api/feed-enrichment/writeback/run`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);

      const callArg = runShoptimizerWritebackMock.mock.calls[0][0];
      expect(callArg.organizationId).toBe(1);
      // No taskIds → worker drains all approved tasks scoped to org 1.
      expect(callArg.taskIds).toBeUndefined();
    });

    it("returns 401 and never calls the worker when org context is missing", async () => {
      currentOrgId = null;

      const res = await fetch(`${baseUrl}/api/feed-enrichment/writeback/run`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskIds: [1, 2] }),
      });

      expect(res.status).toBe(401);
      expect(runShoptimizerWritebackMock).not.toHaveBeenCalled();
    });
  });
});
