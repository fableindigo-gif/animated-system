/**
 * Integration tests for the feed-quality fixes review + approve flow.
 *
 * Covers:
 *   • GET  /api/feed-enrichment/quality-fixes
 *       - happy path: returns tenant-scoped rows joined to the warehouse
 *         product, only items with proposed changes when filter=with-fixes,
 *         along with coverage stats.
 *       - safe fallback: empty list when no tenant context is resolved.
 *   • POST /api/feed-enrichment/quality-fixes/approve
 *       - happy path: inserts one pending proposed_tasks row per fix.
 *       - idempotency: re-approving the same fix returns duplicate: true
 *         without creating a second row.
 *       - validation: malformed body → 400.
 *       - tenant ownership: an offerId outside the caller's tenant → 403.
 *
 * The Shoptimizer HTTP layer (services/shoptimizer-service +
 * lib/shoptimizer-client) is stubbed so the suite never touches a live
 * optimizer service. The DB and the enrichment-tier middleware are also
 * mocked so the tests do not require a real database.
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

// ── Shoptimizer HTTP layer (stubbed) ─────────────────────────────────────────
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

// ── Workers (kept inert — they import network/DB code we don't need) ─────────
const runQualityFixesScanMock = vi.fn();
const rescanProductsByIdsMock = vi.fn();
vi.mock("../workers/quality-fixes-scanner", () => ({
  runQualityFixesScan: (...args: unknown[]) => runQualityFixesScanMock(...args),
  rescanProductsByIds: (...args: unknown[]) => rescanProductsByIdsMock(...args),
}));
vi.mock("../workers/quality-fixes-apply", () => ({
  applyQualityFixToShopify: vi.fn(),
  undoQualityFixOnShopify:  vi.fn(),
  APPLY_TOOL_NAME:          "shopify_apply_quality_fix",
  UNDO_TOOL_NAME:           "shopify_undo_quality_fix",
  APPLY_PLATFORM:           "shopify",
}));
vi.mock("../workers/feed-enrichment", () => ({
  runFeedEnrichment: vi.fn(),
}));
vi.mock("../workers/shoptimizer-writeback", () => ({
  runShoptimizerWriteback:        vi.fn(),
  SHOPTIMIZER_WRITEBACK_TOOL:     "shoptimizer_writeback",
  SHOPTIMIZER_WRITEBACK_PLATFORM: "gmc",
  classifyWritebackFailure:       vi.fn(),
}));

// FeedGen sub-router — mounted by the parent router but out of scope here.
vi.mock("../routes/feed-enrichment/feedgen", () => ({
  default: express.Router(),
}));

// ── Tier middleware (controllable per test) ──────────────────────────────────
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

// ── DB mock ──────────────────────────────────────────────────────────────────
//
// `selectQueue` is a FIFO of canned results — each `db.select(...).from(...)`
// (regardless of the trailing chain) consumes the next entry. Tests load it
// up with the answers they want returned, in the order the route consumes
// them.
const selectQueue: unknown[] = [];

interface InsertedTask { id: number; [k: string]: unknown }
const insertedTasks: InsertedTask[] = [];
let proposedTasksSeq = 0;

// Spies — exposed so tests can assert on call counts (more robust than
// inferring "no further query happened" from `selectQueue.length`).
const selectSpy = vi.fn();
const insertSpy = vi.fn();

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

  const productQualityFixes = tbl([
    "id", "tenantId", "productId", "sku", "status", "errorCode", "errorMessage",
    "pluginsFired", "changedFields", "changeCount", "productSyncedAt", "scannedAt",
  ]);
  const warehouseShopifyProducts = tbl([
    "id", "tenantId", "productId", "sku", "title", "imageUrl", "status",
    "syncedAt", "llmEnrichedAt", "llmAttributes", "description",
  ]);
  const proposedTasks = tbl([
    "id", "idempotencyKey", "status", "workspaceId", "toolName", "createdAt",
  ]);
  const workspaces         = tbl(["id", "organizationId"]);
  const organizations      = tbl(["id", "subscriptionTier", "name", "slug"]);
  const feedEnrichmentJobs = tbl([
    "id", "organizationId", "status", "createdAt", "processedSkus",
  ]);
  const productFeedgenRewrites = tbl(["id"]);

  const select = vi.fn((cols?: unknown) => {
    selectSpy(cols);
    return {
      from: vi.fn((_tbl: unknown) => makeBuilder(() => selectQueue.shift() ?? [])),
    };
  });

  const insert = vi.fn((tbl: unknown) => {
    insertSpy(tbl);
    return {
      values: vi.fn((vals: Record<string, unknown>) => ({
        returning: vi.fn(async (_cols?: unknown) => {
          const id = ++proposedTasksSeq;
          const row = { id, ...vals } as InsertedTask;
          insertedTasks.push(row);
          return [row];
        }),
      })),
    };
  });

  const update = vi.fn((_tbl: unknown) => ({
    set: vi.fn(() => ({ where: vi.fn(async () => {}) })),
  }));

  const execute = vi.fn(async () => ({ rows: [] }));

  return {
    db: { select, insert, update, execute },
    productQualityFixes,
    warehouseShopifyProducts,
    proposedTasks,
    workspaces,
    organizations,
    feedEnrichmentJobs,
    productFeedgenRewrites,
  };
});

// ── Server boot ──────────────────────────────────────────────────────────────
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
  selectQueue.length = 0;
  insertedTasks.length = 0;
  proposedTasksSeq = 0;
  currentOrgId = 42;
  selectSpy.mockClear();
  insertSpy.mockClear();
  runQualityFixesScanMock.mockReset();
  rescanProductsByIdsMock.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/feed-enrichment/quality-fixes", () => {
  it("returns tenant-scoped rows joined to the warehouse product", async () => {
    const fixRow = {
      id: "p1_sku1",
      tenantId: "42",
      productId: "p1",
      sku: "sku1",
      title: "Old title",
      imageUrl: "http://img/p1.jpg",
      productStatus: "active",
      scanStatus: "ok",
      errorCode: null,
      errorMessage: null,
      pluginsFired: ["title-plugin"],
      changedFields: [{ field: "title", before: "Old title", after: "New title" }],
      changeCount: 1,
      productSyncedAt: new Date("2026-04-01T00:00:00Z"),
      scannedAt:       new Date("2026-04-15T00:00:00Z"),
      productLastSync: new Date("2026-04-15T00:00:00Z"),
    };

    // Order matches the route: rows → total → totalProducts → scannedProducts
    // → pendingScan → latestScan.
    selectQueue.push(
      [fixRow],
      [{ total: 1 }],
      [{ totalProducts: 10 }],
      [{ scannedProducts: 7 }],
      [{ pendingScan: 3 }],
      [{ scannedAt: new Date("2026-04-15T00:00:00Z") }],
    );

    const res = await fetch(`${baseUrl}/api/feed-enrichment/quality-fixes`);
    expect(res.status).toBe(200);

    const body: any = await res.json();
    expect(body.total).toBe(1);
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({
      id: "p1_sku1",
      tenantId: "42",
      sku: "sku1",
      changeCount: 1,
      scanStatus: "ok",
    });
    expect(body.results[0].changedFields).toEqual([
      { field: "title", before: "Old title", after: "New title" },
    ]);
    expect(body.coverage).toEqual({
      totalProducts:   10,
      scannedProducts: 7,
      pendingScan:     3,
      lastScanAt:      "2026-04-15T00:00:00.000Z",
    });
  });

  it("returns an empty list when no tenant is resolvable from the request", async () => {
    currentOrgId = null;
    const res = await fetch(`${baseUrl}/api/feed-enrichment/quality-fixes`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toMatchObject({
      total: 0,
      results: [],
      coverage: { totalProducts: 0, scannedProducts: 0, pendingScan: 0, lastScanAt: null },
    });
    // Importantly: with no tenant we must NOT have queried the DB at all.
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it("only surfaces rows the with-fixes filter returned (no post-DB padding)", async () => {
    // The actual filter is enforced via SQL in the route's `where` clause —
    // the DB returns only rows with changeCount > 0 and status = 'ok'. This
    // test verifies the route faithfully renders that filtered set: it does
    // not synthesise extra rows or hide returned ones, even when the page
    // contains a mix of high- and low-change items.
    const rowMany = {
      id: "p1_sku1", tenantId: "42", productId: "p1", sku: "sku1",
      title: "T1", imageUrl: null, productStatus: "active",
      scanStatus: "ok", errorCode: null, errorMessage: null,
      pluginsFired: ["title-plugin"],
      changedFields: [
        { field: "title",       before: "Old", after: "New" },
        { field: "description", before: "Old", after: "New" },
      ],
      changeCount: 2,
      productSyncedAt: new Date("2026-04-01T00:00:00Z"),
      scannedAt:       new Date("2026-04-15T00:00:00Z"),
      productLastSync: new Date("2026-04-15T00:00:00Z"),
    };
    const rowOne = {
      ...rowMany,
      id: "p2_sku2", productId: "p2", sku: "sku2", title: "T2",
      changedFields: [{ field: "color", before: null, after: "blue" }],
      changeCount: 1,
    };
    selectQueue.push(
      [rowMany, rowOne],            // rows
      [{ total: 2 }],
      [{ totalProducts: 5 }],
      [{ scannedProducts: 5 }],
      [{ pendingScan: 0 }],
      [{ scannedAt: rowMany.scannedAt }],
    );

    const res = await fetch(`${baseUrl}/api/feed-enrichment/quality-fixes?filter=with-fixes`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.total).toBe(2);
    expect(body.results.map((r: { id: string }) => r.id)).toEqual(["p1_sku1", "p2_sku2"]);
    // Every rendered row carries the original DB-returned changeCount (>0).
    for (const r of body.results) {
      expect(r.changeCount).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/feed-enrichment/quality-fixes/approve", () => {
  const validFix = {
    offerId:   "p1_sku1",
    productId: "p1",
    sku:       "sku1",
    title:     "Old title",
    pluginsFired:  ["title-plugin"],
    changedFields: [{ field: "title", before: "Old title", after: "New title" }],
  };

  async function postApprove(body: unknown): Promise<Response> {
    return fetch(`${baseUrl}/api/feed-enrichment/quality-fixes/approve`, {
      method:  "POST",
      headers: { "content-type": "application/json" },
      body:    JSON.stringify(body),
    });
  }

  it("creates one pending proposed_tasks row per fix on the happy path", async () => {
    selectQueue.push(
      [{ id: "p1_sku1" }], // tenant ownership check — owns the offer
      [],                   // idempotency check — no existing pending row
    );

    const res = await postApprove({ fixes: [validFix] });
    expect(res.status).toBe(201);

    const body: any = await res.json();
    expect(body.approved).toBe(1);
    expect(body.duplicate).toBe(0);
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].duplicate).toBeUndefined();

    expect(insertedTasks).toHaveLength(1);
    const inserted = insertedTasks[0];
    expect(inserted.toolName).toBe("shoptimizer_apply_fix");
    expect(inserted.platform).toBe("gmc");
    expect(inserted.status).toBe("pending");
    expect(typeof inserted.idempotencyKey).toBe("string");
    expect((inserted.idempotencyKey as string).length).toBeGreaterThan(0);
    // Display diff is derived from changedFields with previewed values.
    expect(inserted.displayDiff).toEqual([
      { label: "title", from: "Old title", to: "New title" },
    ]);
  });

  it("is idempotent — re-approving the same fix returns duplicate: true", async () => {
    // First call: ownership ok, no existing pending row.
    selectQueue.push([{ id: "p1_sku1" }], []);
    const first = await postApprove({ fixes: [validFix] });
    expect(first.status).toBe(201);
    expect(insertedTasks).toHaveLength(1);
    const firstId = insertedTasks[0].id;

    // Second call: ownership ok, idempotency lookup HITS the previous row.
    selectQueue.push([{ id: "p1_sku1" }], [{ id: firstId }]);
    const second = await postApprove({ fixes: [validFix] });
    expect(second.status).toBe(201);

    const body: any = await second.json();
    expect(body.approved).toBe(1);
    expect(body.duplicate).toBe(1);
    expect(body.tasks[0]).toMatchObject({ id: firstId, offerId: "p1_sku1", duplicate: true });
    // No new row was inserted on the second call.
    expect(insertedTasks).toHaveLength(1);
  });

  it("rejects malformed bodies with 400", async () => {
    // Missing changedFields (zod requires .min(1)).
    const res = await postApprove({
      fixes: [{ offerId: "p1_sku1", pluginsFired: [], changedFields: [] }],
    });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toMatch(/Invalid request body/i);
    expect(body.details).toBeDefined();
    expect(insertedTasks).toEqual([]);

    // Empty fixes array also rejected.
    const res2 = await postApprove({ fixes: [] });
    expect(res2.status).toBe(400);

    // Wrong shape entirely.
    const res3 = await postApprove({ nope: true });
    expect(res3.status).toBe(400);

    expect(insertedTasks).toEqual([]);
  });

  it("refuses requests with no resolvable tenant (401)", async () => {
    currentOrgId = null;
    const res = await postApprove({ fixes: [validFix] });
    expect(res.status).toBe(401);
    // Must not have run any DB ownership check or insert.
    expect(selectSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
    expect(insertedTasks).toEqual([]);
  });

  it("returns 403 when an offerId belongs to another tenant", async () => {
    // Ownership check returns NO rows for the supplied offerId — the route
    // must surface this as FOREIGN_OFFER_IDS without ever reaching the
    // idempotency check or the insert.
    selectQueue.push([]); // ownership: nothing owned

    const res = await postApprove({
      fixes: [{ ...validFix, offerId: "foreign_sku" }],
    });
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body).toMatchObject({
      code:    "FOREIGN_OFFER_IDS",
      foreign: ["foreign_sku"],
    });
    expect(insertedTasks).toEqual([]);
    // Exactly one select (the ownership check) — the idempotency lookup
    // must not have run, and the insert must not have been attempted.
    expect(selectSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/feed-enrichment/quality-fixes/rescan", () => {
  async function postRescan(body: unknown): Promise<Response> {
    return fetch(`${baseUrl}/api/feed-enrichment/quality-fixes/rescan`, {
      method:  "POST",
      headers: { "content-type": "application/json" },
      body:    JSON.stringify(body),
    });
  }

  it("falls back to the bulk staleness scan when no productIds are provided", async () => {
    runQualityFixesScanMock.mockResolvedValue({
      scanned: 3, refreshed: 3, failed: 0, skipped: false,
    });
    const res = await postRescan({});
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toMatchObject({ scanned: 3, refreshed: 3 });
    expect(runQualityFixesScanMock).toHaveBeenCalledTimes(1);
    expect(runQualityFixesScanMock).toHaveBeenCalledWith({
      maxProducts: undefined, tenantId: "42",
    });
    expect(rescanProductsByIdsMock).not.toHaveBeenCalled();
  });

  it("forwards productIds (deduped) to rescanProductsByIds with the caller's tenant", async () => {
    rescanProductsByIdsMock.mockResolvedValue({
      scanned: 2, refreshed: 2, failed: 0, skipped: false,
    });
    const res = await postRescan({ productIds: ["p1", "p2", "p1"] });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toMatchObject({ refreshed: 2, failed: 0 });
    expect(rescanProductsByIdsMock).toHaveBeenCalledTimes(1);
    const [ids, opts] = rescanProductsByIdsMock.mock.calls[0];
    expect(new Set(ids)).toEqual(new Set(["p1", "p2"]));
    expect(ids).toHaveLength(2);
    expect(opts).toEqual({ tenantId: "42" });
    expect(runQualityFixesScanMock).not.toHaveBeenCalled();
  });

  it("rejects malformed bodies with 400", async () => {
    // Empty productIds violates .min(1).
    const res = await postRescan({ productIds: [] });
    expect(res.status).toBe(400);
    expect(rescanProductsByIdsMock).not.toHaveBeenCalled();

    // Too many ids — .max(100).
    const tooMany = Array.from({ length: 101 }, (_, i) => `p${i}`);
    const res2 = await postRescan({ productIds: tooMany });
    expect(res2.status).toBe(400);
    expect(rescanProductsByIdsMock).not.toHaveBeenCalled();

    // Wrong type for productIds.
    const res3 = await postRescan({ productIds: "p1" });
    expect(res3.status).toBe(400);
  });

  it("returns 401 when the caller has no resolvable tenant", async () => {
    currentOrgId = null;
    const res = await postRescan({ productIds: ["p1"] });
    expect(res.status).toBe(401);
    expect(rescanProductsByIdsMock).not.toHaveBeenCalled();
    expect(runQualityFixesScanMock).not.toHaveBeenCalled();
  });
});
