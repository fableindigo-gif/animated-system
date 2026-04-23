/**
 * Cross-tenant isolation E2E for the Quality Fixes routes.
 *
 * Scenario: two agencies (tenants "1" and "2") each have their own
 * warehouse products and pre-computed `product_quality_fixes`. The test
 * drives the live express router with a tenant-aware in-memory DB mock
 * and asserts that:
 *   • GET  /quality-fixes returns only the caller's rows.
 *   • GET  /quality-fixes coverage counts only the caller's products.
 *   • POST /quality-fixes/approve refuses to queue a fix targeting the
 *     other tenant's offerId (403 FOREIGN_OFFER_IDS), and only inserts
 *     the caller's owned fixes.
 *   • POST /quality-fixes/approve refuses requests with no resolved
 *     tenant context (401) — the prior `if (tenantId)` short-circuit
 *     would have skipped the cross-tenant check.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { db } from "@workspace/db";

// ── Logger ───────────────────────────────────────────────────────────────────
vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

// ── Stubs for unrelated route deps ───────────────────────────────────────────
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
  undoQualityFixOnShopify:  vi.fn(),
  APPLY_TOOL_NAME:          "shopify_apply_quality_fix",
  UNDO_TOOL_NAME:           "shopify_undo_quality_fix",
  APPLY_PLATFORM:           "shopify",
}));
vi.mock("../workers/feed-enrichment", () => ({ runFeedEnrichment: vi.fn() }));
vi.mock("../workers/shoptimizer-writeback", () => ({
  runShoptimizerWriteback:        vi.fn(),
  SHOPTIMIZER_WRITEBACK_TOOL:     "shoptimizer_writeback",
  SHOPTIMIZER_WRITEBACK_PLATFORM: "gmc",
  classifyWritebackFailure:       vi.fn(),
}));
vi.mock("../routes/feed-enrichment/feedgen", () => ({ default: express.Router() }));

// ── Tier middleware drives the active tenant per request ─────────────────────
let currentOrgId: number | null = 1;
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

// ── Tenant-aware in-memory DB ────────────────────────────────────────────────
//
// We don't reimplement Drizzle. Instead we capture the *table objects* the
// route imports and, on each `db.select(...).from(table)`, return seeded
// rows for that table (filtered by the current tenant). The route's
// `where(...)` clause is derived from drizzle helpers (eq/and/inArray)
// which we replace with structured "predicates" we can evaluate here.
type Predicate =
  | { kind: "eq"; col: string; val: unknown }
  | { kind: "in"; col: string; vals: unknown[] }
  | { kind: "gt"; col: string; val: unknown }
  | { kind: "and"; parts: Predicate[] }
  | { kind: "raw" };

vi.mock("drizzle-orm", async (orig) => {
  const real: any = await (orig as any)();
  return {
    ...real,
    eq:      (col: any, val: any): Predicate => ({ kind: "eq", col: String(col), val }),
    gt:      (col: any, val: any): Predicate => ({ kind: "gt", col: String(col), val }),
    inArray: (col: any, vals: any[]): Predicate => ({ kind: "in", col: String(col), vals }),
    and:     (...parts: Predicate[]): Predicate =>
      ({ kind: "and", parts: parts.filter(Boolean) }),
    desc:    (_c: any) => ({ kind: "desc" }),
    sql:     Object.assign(
      (_strs: TemplateStringsArray, ..._vals: unknown[]) => ({ kind: "raw" } as Predicate),
      { raw: (_: string) => ({ kind: "raw" }) },
    ),
  };
});

interface QFRow {
  id: string; tenantId: string; productId: string; sku: string;
  status: string; errorCode: string | null; errorMessage: string | null;
  pluginsFired: string[];
  changedFields: Array<{ field: string; before: unknown; after: unknown }>;
  changeCount: number;
  productSyncedAt: Date; scannedAt: Date;
}
interface WHRow {
  id: string; tenantId: string; productId: string; sku: string;
  title: string; imageUrl: string | null; status: string;
  syncedAt: Date;
}

const store = {
  qualityFixes:    [] as QFRow[],
  warehouse:       [] as WHRow[],
  proposedTasks:   [] as Array<Record<string, unknown>>,
  proposedSeq:     0,
  // Captured cross-references between a specific call-site (a `db.select`
  // builder) and the table it was called on.
};

function evalPred(row: any, pred: Predicate | undefined): boolean {
  if (!pred) return true;
  switch (pred.kind) {
    case "eq":  return String(row[pred.col]) === String(pred.val);
    case "in":  return pred.vals.map(String).includes(String(row[pred.col]));
    case "gt":  return Number(row[pred.col]) > Number(pred.val);
    case "and": return pred.parts.every((p) => evalPred(row, p));
    case "raw": return true;
  }
}

vi.mock("@workspace/db", () => {
  // Each "column" is just its bare name — drizzle's `eq(col, val)` will
  // stringify it via the predicate helpers above.
  const tbl = (name: string, cols: string[]) => {
    const o: any = { __table: name };
    for (const c of cols) o[c] = c;
    return o;
  };

  const productQualityFixes = tbl("product_quality_fixes", [
    "id", "tenantId", "productId", "sku", "status", "errorCode", "errorMessage",
    "pluginsFired", "changedFields", "changeCount", "productSyncedAt", "scannedAt",
  ]);
  const warehouseShopifyProducts = tbl("warehouse_shopify_products", [
    "id", "tenantId", "productId", "sku", "title", "imageUrl", "status", "syncedAt",
  ]);
  const proposedTasks = tbl("proposed_tasks", [
    "id", "idempotencyKey", "status", "workspaceId", "toolName", "createdAt",
  ]);
  const workspaces         = tbl("workspaces", ["id", "organizationId"]);
  const organizations      = tbl("organizations", ["id", "subscriptionTier"]);
  const feedEnrichmentJobs = tbl("feed_enrichment_jobs", ["id"]);
  const productFeedgenRewrites = tbl("product_feedgen_rewrites", ["id"]);

  function tableRowsFor(t: any): any[] {
    if (t === productQualityFixes)      return store.qualityFixes;
    if (t === warehouseShopifyProducts) return store.warehouse;
    if (t === proposedTasks)            return store.proposedTasks;
    return [];
  }

  function makeBuilder(tableObj: any, columns: any) {
    let predicate: Predicate | undefined;
    let isCount = false;
    let limit: number | undefined;
    if (columns && typeof columns === "object") {
      for (const k of Object.keys(columns)) {
        // sql<number>`count(*)::int` → predicate.kind === "raw"
        const v = (columns as any)[k];
        if (v && typeof v === "object" && (v as any).kind === "raw") isCount = true;
      }
    }
    const b: any = {};
    b.innerJoin = () => b;
    b.leftJoin  = () => b;
    b.where     = (p: Predicate) => { predicate = p; return b; };
    b.orderBy   = () => b;
    b.offset    = () => b;
    b.limit     = (n: number) => { limit = n; return b; };
    b.then = (resolve: any, reject: any) => Promise.resolve().then(() => {
      const rows = tableRowsFor(tableObj).filter((r) => evalPred(r, predicate));
      if (isCount) {
        const key = Object.keys(columns)[0];
        return [{ [key]: rows.length }];
      }
      const projected = rows.map((r) => {
        if (!columns || typeof columns !== "object") return r;
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(columns)) out[k] = r[k];
        return out;
      });
      return limit != null ? projected.slice(0, limit) : projected;
    }).then(resolve, reject);
    return b;
  }

  const select = vi.fn((cols?: any) => ({
    from: vi.fn((t: any) => makeBuilder(t, cols)),
  }));

  const insert = vi.fn((t: any) => ({
    values: vi.fn((vals: Record<string, unknown>) => ({
      returning: vi.fn(async () => {
        if (t === proposedTasks) {
          const id = ++store.proposedSeq;
          const row = { id, ...vals };
          store.proposedTasks.push(row);
          return [row];
        }
        return [vals];
      }),
    })),
  }));

  const update = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => {}) })) }));
  // The /quality-fixes GET handler probes audit_logs via raw SQL to attach
  // an `undoableAuditId` to each row. These tests don't seed any audit data,
  // so a no-op response is fine — `undoableAuditId` will be null on every row.
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
  store.qualityFixes.length = 0;
  store.warehouse.length    = 0;
  store.proposedTasks.length = 0;
  store.proposedSeq = 0;
  currentOrgId = 1;
});

function seedTwoTenants() {
  const baseDate = new Date("2026-04-15T00:00:00Z");
  // Tenant 1 — two products, both with fixes.
  store.warehouse.push(
    { id: "t1_p1_sku1", tenantId: "1", productId: "t1_p1", sku: "sku1",
      title: "T1 Product One", imageUrl: null, status: "active", syncedAt: baseDate },
    { id: "t1_p2_sku2", tenantId: "1", productId: "t1_p2", sku: "sku2",
      title: "T1 Product Two", imageUrl: null, status: "active", syncedAt: baseDate },
  );
  store.qualityFixes.push(
    { id: "t1_p1_sku1", tenantId: "1", productId: "t1_p1", sku: "sku1",
      status: "ok", errorCode: null, errorMessage: null,
      pluginsFired: ["title-plugin"],
      changedFields: [{ field: "title", before: "old", after: "new" }],
      changeCount: 1, productSyncedAt: baseDate, scannedAt: baseDate },
    { id: "t1_p2_sku2", tenantId: "1", productId: "t1_p2", sku: "sku2",
      status: "ok", errorCode: null, errorMessage: null,
      pluginsFired: ["desc-plugin"],
      changedFields: [{ field: "description", before: "old", after: "new" }],
      changeCount: 1, productSyncedAt: baseDate, scannedAt: baseDate },
  );

  // Tenant 2 — three products, only one with fixes.
  store.warehouse.push(
    { id: "t2_p1_sku1", tenantId: "2", productId: "t2_p1", sku: "sku1",
      title: "T2 Product One", imageUrl: null, status: "active", syncedAt: baseDate },
    { id: "t2_p2_sku2", tenantId: "2", productId: "t2_p2", sku: "sku2",
      title: "T2 Product Two", imageUrl: null, status: "active", syncedAt: baseDate },
    { id: "t2_p3_sku3", tenantId: "2", productId: "t2_p3", sku: "sku3",
      title: "T2 Product Three", imageUrl: null, status: "active", syncedAt: baseDate },
  );
  store.qualityFixes.push(
    { id: "t2_p1_sku1", tenantId: "2", productId: "t2_p1", sku: "sku1",
      status: "ok", errorCode: null, errorMessage: null,
      pluginsFired: ["title-plugin"],
      changedFields: [{ field: "title", before: "old2", after: "new2" }],
      changeCount: 1, productSyncedAt: baseDate, scannedAt: baseDate },
  );
}

describe("Quality Fixes — cross-tenant isolation E2E", () => {
  it("GET /quality-fixes only returns the caller's rows and coverage counts", async () => {
    seedTwoTenants();

    currentOrgId = 1;
    const r1 = await fetch(`${baseUrl}/api/feed-enrichment/quality-fixes`);
    expect(r1.status).toBe(200);
    const b1: any = await r1.json();
    expect(b1.results.map((x: any) => x.id).sort()).toEqual(["t1_p1_sku1", "t1_p2_sku2"]);
    expect(b1.coverage.totalProducts).toBe(2);   // tenant 1 has 2 warehouse products
    expect(b1.coverage.scannedProducts).toBe(2);

    currentOrgId = 2;
    const r2 = await fetch(`${baseUrl}/api/feed-enrichment/quality-fixes`);
    expect(r2.status).toBe(200);
    const b2: any = await r2.json();
    expect(b2.results.map((x: any) => x.id)).toEqual(["t2_p1_sku1"]);
    expect(b2.coverage.totalProducts).toBe(3);   // tenant 2 has 3 warehouse products
    expect(b2.coverage.scannedProducts).toBe(1);

    // Hard guarantee: tenant 1's payload contains nothing belonging to tenant 2.
    for (const row of b1.results) expect(row.tenantId).toBe("1");
    for (const row of b2.results) expect(row.tenantId).toBe("2");
  });

  it("POST /quality-fixes/approve refuses fixes targeting another tenant's offerId", async () => {
    seedTwoTenants();
    currentOrgId = 1;

    // Tenant 1 tries to approve one of its own fixes AND one belonging to tenant 2.
    const res = await fetch(`${baseUrl}/api/feed-enrichment/quality-fixes/approve`, {
      method:  "POST",
      headers: { "content-type": "application/json" },
      body:    JSON.stringify({
        fixes: [
          {
            offerId: "t1_p1_sku1", productId: "t1_p1", sku: "sku1",
            title: "T1 Product One",
            pluginsFired: ["title-plugin"],
            changedFields: [{ field: "title", before: "old", after: "new" }],
          },
          {
            offerId: "t2_p1_sku1", productId: "t2_p1", sku: "sku1",
            title: "T2 Product One",
            pluginsFired: ["title-plugin"],
            changedFields: [{ field: "title", before: "old2", after: "new2" }],
          },
        ],
      }),
    });
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body.code).toBe("FOREIGN_OFFER_IDS");
    expect(body.foreign).toEqual(["t2_p1_sku1"]);
    // Critically: nothing was queued — even the legitimate fix is rolled back.
    expect(store.proposedTasks).toEqual([]);
  });

  it("POST /quality-fixes/approve only inserts the caller's owned fixes (happy path)", async () => {
    seedTwoTenants();
    currentOrgId = 1;
    const res = await fetch(`${baseUrl}/api/feed-enrichment/quality-fixes/approve`, {
      method:  "POST",
      headers: { "content-type": "application/json" },
      body:    JSON.stringify({
        fixes: [
          {
            offerId: "t1_p1_sku1", productId: "t1_p1", sku: "sku1", title: "T1 P1",
            pluginsFired: ["title-plugin"],
            changedFields: [{ field: "title", before: "old", after: "new" }],
          },
          {
            offerId: "t1_p2_sku2", productId: "t1_p2", sku: "sku2", title: "T1 P2",
            pluginsFired: ["desc-plugin"],
            changedFields: [{ field: "description", before: "old", after: "new" }],
          },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body: any = await res.json();
    expect(body.approved).toBe(2);
    expect(store.proposedTasks).toHaveLength(2);
    // Switching tenant must not see tenant 1's queued tasks via /quality-fixes
    // (the proposed_tasks table isn't surfaced by the list route, but verify
    // no cross-tenant leakage on the read path either).
    currentOrgId = 2;
    const r2 = await fetch(`${baseUrl}/api/feed-enrichment/quality-fixes`);
    const b2: any = await r2.json();
    expect(b2.results.map((x: any) => x.id)).toEqual(["t2_p1_sku1"]);
  });

  it("POST /quality-fixes/approve refuses requests with no resolved tenant (401)", async () => {
    seedTwoTenants();
    currentOrgId = null;
    const res = await fetch(`${baseUrl}/api/feed-enrichment/quality-fixes/approve`, {
      method:  "POST",
      headers: { "content-type": "application/json" },
      body:    JSON.stringify({
        fixes: [{
          offerId: "t1_p1_sku1",
          pluginsFired: ["title-plugin"],
          changedFields: [{ field: "title", before: "old", after: "new" }],
        }],
      }),
    });
    expect(res.status).toBe(401);
    expect(store.proposedTasks).toEqual([]);
  });
});

// ── Constants that mirror the mocked worker values ────────────────────────────
const APPLY_TOOL = "shopify_apply_quality_fix";
const UNDO_TOOL  = "shopify_undo_quality_fix";

// ── Typed fixtures for the two db.execute() call sites in the route ──────────
// First execute: "undoable" query — DISTINCT ON latest apply/undo per fix.
interface UndoableRow { fix_id: string; id: number; tool_name: string }
// Second execute: "history" query — full chronological timeline per fix.
interface HistoryRow {
  fix_id:     string;
  id:         number;
  tool_name:  string;
  status:     string;
  created_at: string;
  applied_by: { id?: number | null; name?: string | null; role?: string | null } | null;
  undone_by:  { id?: number | null; name?: string | null; role?: string | null } | null;
}

/**
 * Wrap rows into the shape that drizzle's db.execute() promise resolves to.
 * The single cast lives here so call-sites stay type-safe.
 */
function makeExecRows<T>(rows: T[]): any {
  return { rows };
}

describe("Quality Fixes — apply/undo history timeline", () => {
  // Seed a single tenant-1 fix row and its warehouse product.
  function seedOneFix() {
    const baseDate = new Date("2026-04-15T00:00:00Z");
    store.warehouse.push({
      id: "t1_p1_sku1", tenantId: "1", productId: "t1_p1", sku: "sku1",
      title: "T1 Product One", imageUrl: null, status: "active", syncedAt: baseDate,
    });
    store.qualityFixes.push({
      id: "t1_p1_sku1", tenantId: "1", productId: "t1_p1", sku: "sku1",
      status: "ok", errorCode: null, errorMessage: null,
      pluginsFired: ["title-plugin"],
      changedFields: [{ field: "title", before: "old", after: "new" }],
      changeCount: 1, productSyncedAt: baseDate, scannedAt: baseDate,
    });
  }

  beforeEach(() => {
    // Reset execute mock back to the default no-op between tests so prior
    // mockResolvedValueOnce queues do not bleed into subsequent tests.
    vi.mocked(db.execute).mockReset();
    vi.mocked(db.execute).mockResolvedValue(makeExecRows([]));
  });

  it("history array is empty when audit_logs has no entries for the fix", async () => {
    seedOneFix();
    currentOrgId = 1;

    // execute returns empty rows for both the undoable and history queries.
    vi.mocked(db.execute)
      .mockResolvedValueOnce(makeExecRows<UndoableRow>([]))   // undoable query
      .mockResolvedValueOnce(makeExecRows<HistoryRow>([]));    // history query

    const res = await fetch(`${baseUrl}/api/feed-enrichment/quality-fixes`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const fix = body.results.find((r: any) => r.id === "t1_p1_sku1");
    expect(fix).toBeDefined();
    expect(fix.history).toEqual([]);
    expect(fix.undoableAuditId).toBeNull();
  });

  it("history is populated with an apply event and marks the fix undoable", async () => {
    seedOneFix();
    currentOrgId = 1;

    const appliedAt = "2026-04-15T10:00:00.000Z";

    // First execute (undoable): latest entry for this fix is an apply.
    vi.mocked(db.execute).mockResolvedValueOnce(
      makeExecRows<UndoableRow>([{ fix_id: "t1_p1_sku1", id: 42, tool_name: APPLY_TOOL }]),
    );

    // Second execute (history timeline): one apply entry.
    vi.mocked(db.execute).mockResolvedValueOnce(
      makeExecRows<HistoryRow>([{
        fix_id:     "t1_p1_sku1",
        id:         42,
        tool_name:  APPLY_TOOL,
        status:     "applied",
        created_at: appliedAt,
        applied_by: { id: 7, name: "Alice", role: "admin" },
        undone_by:  null,
      }]),
    );

    const res = await fetch(`${baseUrl}/api/feed-enrichment/quality-fixes`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const fix = body.results.find((r: any) => r.id === "t1_p1_sku1");

    expect(fix).toBeDefined();
    expect(fix.undoableAuditId).toBe(42);
    expect(fix.history).toHaveLength(1);
    expect(fix.history[0]).toMatchObject({
      auditId: 42,
      action:  "apply",
      status:  "applied",
      at:      appliedAt,
      actor:   { id: 7, name: "Alice", role: "admin" },
    });
  });

  it("history shows apply then undo in chronological order and clears undoableAuditId", async () => {
    seedOneFix();
    currentOrgId = 1;

    const appliedAt = "2026-04-15T10:00:00.000Z";
    const undoneAt  = "2026-04-15T11:30:00.000Z";

    // First execute (undoable): latest entry is an undo — not undoable.
    vi.mocked(db.execute).mockResolvedValueOnce(
      makeExecRows<UndoableRow>([{ fix_id: "t1_p1_sku1", id: 99, tool_name: UNDO_TOOL }]),
    );

    // Second execute (history timeline): apply followed by undo.
    vi.mocked(db.execute).mockResolvedValueOnce(
      makeExecRows<HistoryRow>([
        {
          fix_id:     "t1_p1_sku1",
          id:         42,
          tool_name:  APPLY_TOOL,
          status:     "applied",
          created_at: appliedAt,
          applied_by: { id: 7, name: "Alice", role: "admin" },
          undone_by:  null,
        },
        {
          fix_id:     "t1_p1_sku1",
          id:         99,
          tool_name:  UNDO_TOOL,
          status:     "applied",
          created_at: undoneAt,
          applied_by: null,
          undone_by:  { id: 8, name: "Bob", role: "editor" },
        },
      ]),
    );

    const res = await fetch(`${baseUrl}/api/feed-enrichment/quality-fixes`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const fix = body.results.find((r: any) => r.id === "t1_p1_sku1");

    expect(fix).toBeDefined();
    // Latest is undo → no longer undoable.
    expect(fix.undoableAuditId).toBeNull();

    // Timeline must be oldest-first.
    expect(fix.history).toHaveLength(2);
    expect(fix.history[0]).toMatchObject({
      auditId: 42,
      action:  "apply",
      status:  "applied",
      at:      appliedAt,
      actor:   { id: 7, name: "Alice", role: "admin" },
    });
    expect(fix.history[1]).toMatchObject({
      auditId: 99,
      action:  "undo",
      status:  "applied",
      at:      undoneAt,
      actor:   { id: 8, name: "Bob", role: "editor" },
    });
  });

  it("history entries are attributed to the correct fix when multiple fixes are present", async () => {
    // Seed two fixes for tenant 1.
    const baseDate = new Date("2026-04-15T00:00:00Z");
    store.warehouse.push(
      { id: "t1_p1_sku1", tenantId: "1", productId: "t1_p1", sku: "sku1",
        title: "Fix A", imageUrl: null, status: "active", syncedAt: baseDate },
      { id: "t1_p2_sku2", tenantId: "1", productId: "t1_p2", sku: "sku2",
        title: "Fix B", imageUrl: null, status: "active", syncedAt: baseDate },
    );
    store.qualityFixes.push(
      { id: "t1_p1_sku1", tenantId: "1", productId: "t1_p1", sku: "sku1",
        status: "ok", errorCode: null, errorMessage: null,
        pluginsFired: ["title-plugin"],
        changedFields: [{ field: "title", before: "old", after: "new" }],
        changeCount: 1, productSyncedAt: baseDate, scannedAt: baseDate },
      { id: "t1_p2_sku2", tenantId: "1", productId: "t1_p2", sku: "sku2",
        status: "ok", errorCode: null, errorMessage: null,
        pluginsFired: ["desc-plugin"],
        changedFields: [{ field: "description", before: "old", after: "new" }],
        changeCount: 1, productSyncedAt: baseDate, scannedAt: baseDate },
    );
    currentOrgId = 1;

    const applyAt1 = "2026-04-15T09:00:00.000Z";
    const applyAt2 = "2026-04-15T10:00:00.000Z";

    // First execute (undoable): both fixes have their last entry as an apply.
    vi.mocked(db.execute).mockResolvedValueOnce(
      makeExecRows<UndoableRow>([
        { fix_id: "t1_p1_sku1", id: 10, tool_name: APPLY_TOOL },
        { fix_id: "t1_p2_sku2", id: 20, tool_name: APPLY_TOOL },
      ]),
    );

    // Second execute (history): one apply entry per fix.
    vi.mocked(db.execute).mockResolvedValueOnce(
      makeExecRows<HistoryRow>([
        {
          fix_id:     "t1_p1_sku1",
          id:         10,
          tool_name:  APPLY_TOOL,
          status:     "applied",
          created_at: applyAt1,
          applied_by: { id: 1, name: "Alice", role: "admin" },
          undone_by:  null,
        },
        {
          fix_id:     "t1_p2_sku2",
          id:         20,
          tool_name:  APPLY_TOOL,
          status:     "applied",
          created_at: applyAt2,
          applied_by: { id: 2, name: "Bob", role: "editor" },
          undone_by:  null,
        },
      ]),
    );

    const res = await fetch(`${baseUrl}/api/feed-enrichment/quality-fixes`);
    expect(res.status).toBe(200);
    const body: any = await res.json();

    const fixA = body.results.find((r: any) => r.id === "t1_p1_sku1");
    const fixB = body.results.find((r: any) => r.id === "t1_p2_sku2");

    expect(fixA).toBeDefined();
    expect(fixB).toBeDefined();

    // Each fix gets only its own history entry.
    expect(fixA.history).toHaveLength(1);
    expect(fixA.history[0].auditId).toBe(10);
    expect(fixA.history[0].actor?.name).toBe("Alice");
    expect(fixA.undoableAuditId).toBe(10);

    expect(fixB.history).toHaveLength(1);
    expect(fixB.history[0].auditId).toBe(20);
    expect(fixB.history[0].actor?.name).toBe("Bob");
    expect(fixB.undoableAuditId).toBe(20);
  });

  it("actor is null when applied_by / undone_by is missing from the audit entry", async () => {
    seedOneFix();
    currentOrgId = 1;

    vi.mocked(db.execute).mockResolvedValueOnce(
      makeExecRows<UndoableRow>([{ fix_id: "t1_p1_sku1", id: 5, tool_name: APPLY_TOOL }]),
    );

    vi.mocked(db.execute).mockResolvedValueOnce(
      makeExecRows<HistoryRow>([{
        fix_id:     "t1_p1_sku1",
        id:         5,
        tool_name:  APPLY_TOOL,
        status:     "applied",
        created_at: "2026-04-15T08:00:00.000Z",
        applied_by: null,
        undone_by:  null,
      }]),
    );

    const res = await fetch(`${baseUrl}/api/feed-enrichment/quality-fixes`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const fix = body.results.find((r: any) => r.id === "t1_p1_sku1");

    expect(fix.history).toHaveLength(1);
    expect(fix.history[0].actor).toBeNull();
  });
});
