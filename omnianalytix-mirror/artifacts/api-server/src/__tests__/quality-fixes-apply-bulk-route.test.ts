/**
 * POST /api/feed-enrichment/quality-fixes/apply-bulk — route-level tests.
 *
 * Covers the two pieces of behaviour that aren't reachable from the worker
 * tests:
 *   • Tenant ownership is enforced *before* any Shopify call: an id that
 *     belongs to a different tenant short-circuits with 403 / FOREIGN_FIX_IDS
 *     and the bulk worker is never invoked.
 *   • The NDJSON stream emits frames in the documented order:
 *         started → progress* → summary
 *     and each progress line carries the `type: "progress"` discriminator
 *     plus the per-row payload from the worker.
 *
 * The bulk worker itself is mocked — its own contract is covered in
 * quality-fixes-apply.test.ts.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

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

const applyBulkMock = vi.fn();
vi.mock("../workers/quality-fixes-apply", () => ({
  applyQualityFixToShopify:        vi.fn(),
  applyQualityFixesToShopifyBulk:  (...args: unknown[]) => applyBulkMock(...args),
  undoQualityFixOnShopify:         vi.fn(),
  APPLY_TOOL_NAME:                 "shopify_apply_quality_fix",
  UNDO_TOOL_NAME:                  "shopify_undo_quality_fix",
  APPLY_PLATFORM:                  "shopify",
}));
vi.mock("../workers/feed-enrichment", () => ({ runFeedEnrichment: vi.fn() }));
vi.mock("../workers/shoptimizer-writeback", () => ({
  runShoptimizerWriteback: vi.fn(),
  SHOPTIMIZER_WRITEBACK_TOOL: "shoptimizer_writeback",
  SHOPTIMIZER_WRITEBACK_PLATFORM: "gmc",
  classifyWritebackFailure: vi.fn(),
}));

vi.mock("../routes/feed-enrichment/feedgen", () => ({ default: express.Router() }));

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

// ── DB mock ────────────────────────────────────────────────────────────────
//
// The bulk route only issues one DB query: a `select({id})` against
// `warehouseShopifyProducts` filtered by tenantId + inArray(ids). We feed
// the canned ownership response from `ownedRows`.
let ownedRows: Array<{ id: string }> = [];

vi.mock("@workspace/db", () => {
  const tbl = (cols: string[]) =>
    Object.fromEntries(cols.map((c) => [c, c])) as Record<string, string>;

  const warehouseShopifyProducts = tbl(["id", "tenantId"]);
  const productQualityFixes      = tbl(["id", "tenantId"]);
  const proposedTasks            = tbl(["id"]);
  const workspaces               = tbl(["id", "organizationId"]);
  const feedEnrichmentJobs       = tbl(["id"]);
  const auditLogs                = tbl(["id"]);

  const makeBuilder = (getResult: () => unknown) => {
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
  };

  const select = vi.fn((_cols?: unknown) => ({
    from: vi.fn((_tbl: unknown) => makeBuilder(() => ownedRows)),
  }));
  const insert = vi.fn(() => ({
    values: vi.fn(() => ({ returning: vi.fn(async () => []) })),
  }));
  const update = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => {}) })) }));
  const execute = vi.fn(async () => ({ rows: [] }));

  return {
    db: { select, insert, update, execute },
    warehouseShopifyProducts,
    productQualityFixes,
    proposedTasks,
    workspaces,
    feedEnrichmentJobs,
    auditLogs,
  };
});

// ── Server boot ────────────────────────────────────────────────────────────
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { default: feedRouter } = await import("../routes/feed-enrichment/index");
  const app = express();
  app.use(express.json());
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
  currentOrgId = 42;
  ownedRows = [];
  applyBulkMock.mockReset();
});

async function postBulk(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/feed-enrichment/quality-fixes/apply-bulk`, {
    method:  "POST",
    headers: { "content-type": "application/json" },
    body:    JSON.stringify(body),
  });
}

describe("POST /quality-fixes/apply-bulk — tenant ownership", () => {
  it("rejects with 403 / FOREIGN_FIX_IDS when an id belongs to another tenant, and never calls the worker", async () => {
    // Caller asks for two ids; the DB only confirms ownership of the first.
    ownedRows = [{ id: "p1_sku1" }];

    const res = await postBulk({ ids: ["p1_sku1", "foreign_sku"] });
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body).toMatchObject({
      code:    "FOREIGN_FIX_IDS",
      foreign: ["foreign_sku"],
    });
    // Worker must NOT have run — that's the whole point of the check.
    expect(applyBulkMock).not.toHaveBeenCalled();
  });

  it("de-dups ids before checking ownership so a duplicated foreign id still 403s", async () => {
    ownedRows = [];
    const res = await postBulk({ ids: ["foreign_sku", "foreign_sku"] });
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body.foreign).toEqual(["foreign_sku"]);
    expect(applyBulkMock).not.toHaveBeenCalled();
  });
});

describe("POST /quality-fixes/apply-bulk — NDJSON stream framing", () => {
  it("emits started → progress* → summary in order", async () => {
    ownedRows = [{ id: "p1_sku1" }, { id: "p2_sku2" }];

    // Drive the worker manually so we can interleave progress callbacks
    // with the test's expectations on stream order.
    applyBulkMock.mockImplementation(async (
      opts: { fixIds: string[] },
      onProgress: (p: unknown) => void | Promise<void>,
    ) => {
      const ids = opts.fixIds;
      const results = ids.map((fixId) => ({
        ok: true, productId: fixId, applied: [], errors: [], auditId: 1, rescanned: true,
      }));
      for (let i = 0; i < ids.length; i++) {
        await onProgress({ fixId: ids[i], index: i, total: ids.length, result: results[i] });
      }
      return {
        total: ids.length, succeeded: ids.length, partial: 0, failed: 0, results,
      };
    });

    const res = await postBulk({ ids: ["p1_sku1", "p2_sku2"] });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/x-ndjson/i);

    const text = await res.text();
    const lines = text.trim().split("\n").map((l) => JSON.parse(l));

    // Exactly: 1 started + 2 progress + 1 summary, in that order.
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ type: "started", total: 2 });

    expect(lines[1]).toMatchObject({
      type: "progress", fixId: "p1_sku1", index: 0, total: 2,
    });
    expect(lines[1].result).toMatchObject({ ok: true, productId: "p1_sku1" });

    expect(lines[2]).toMatchObject({
      type: "progress", fixId: "p2_sku2", index: 1, total: 2,
    });
    expect(lines[2].result).toMatchObject({ ok: true, productId: "p2_sku2" });

    expect(lines[3]).toMatchObject({
      type: "summary", total: 2, succeeded: 2, partial: 0, failed: 0,
    });

    // No "summary" frame should appear before the last position.
    for (let i = 0; i < lines.length - 1; i++) {
      expect(lines[i].type).not.toBe("summary");
    }
    // No "progress" frame appears before the started frame.
    expect(lines[0].type).toBe("started");
  });
});
