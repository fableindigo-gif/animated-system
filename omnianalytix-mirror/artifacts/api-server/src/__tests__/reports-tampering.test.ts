/**
 * SEC-04 / SEC-05 — Customers cannot tamper with exported reports.
 *
 * The /api/reports/export-csv and /api/reports/share endpoints were refactored
 * so the browser only sends a `reportId`; the server looks the report up,
 * verifies the caller's workspace owns it, and re-fetches the rows from the
 * warehouse scoped to the caller's tenant. These tests prove the guarantees
 * customers depend on:
 *
 *   1. Posting to /export-csv or /share without `reportId`     → 400.
 *   2. A workspace can't load (GET /saved/:id), export, or share a saved
 *      report owned by another workspace                       → 404
 *      (NOT 403 — existence of the foreign id must not leak).
 *   3. The server-side warehouse fetcher always scopes its WHERE clause to
 *      the caller's resolved tenantId — no cross-tenant leakage even if the
 *      saved report was somehow loaded for another tenant.
 *   4. POST /api/reports/saved with an unknown `kind`         → 400.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction, Router } from "express";
import { z } from "zod/v4";

// ── Heavy dep stubs ──────────────────────────────────────────────────────────
vi.mock("pdfkit", () => ({ default: class { constructor() {} } }));
vi.mock("pptxgenjs", () => ({ default: class { constructor() {} } }));
vi.mock("../lib/vertex-client", () => ({
  getGoogleGenAI: vi.fn(),
  VERTEX_MODEL: "test-model",
}));
vi.mock("../lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ── Fixture state ────────────────────────────────────────────────────────────
// savedReports rows by id. Each row has its `workspaceId` (= tenant).
interface SavedReportRow {
  id: string;
  workspaceId: number;
  createdBy: number | null;
  definition: { kind: string; filters?: Record<string, unknown>; title?: string };
  createdAt: Date;
}
const savedReportRows = new Map<string, SavedReportRow>();
const insertedSharedReports: Array<Record<string, unknown>> = [];
const insertedSavedReports: Array<Record<string, unknown>> = [];

// Captures every WHERE-condition used to query the warehouse tables — lets us
// assert the tenant filter pinned the query to the caller's workspaceId.
interface WarehouseQueryCapture {
  table: "warehouse_shopify_products" | "warehouse_google_ads";
  tenantIdInWhere: string | null;
}
let warehouseQueries: WarehouseQueryCapture[] = [];

// ── @workspace/db mock ───────────────────────────────────────────────────────
vi.mock("@workspace/db", () => {
  const tableSentinel = (name: string, cols: string[]): Record<string, unknown> => {
    const t: Record<string, unknown> = { __table: name };
    for (const c of cols) t[c] = { __col: c, __table: name };
    return t;
  };

  const savedReports = tableSentinel("saved_reports", [
    "id", "workspaceId", "createdBy", "definition", "createdAt",
  ]);
  const sharedReports = tableSentinel("shared_reports", [
    "id", "shareId", "workspaceId", "agencyName", "reportTitle",
    "reportData", "expiresAt", "isActive", "createdAt",
  ]);
  const warehouseShopifyProducts = tableSentinel("warehouse_shopify_products", [
    "id", "tenantId", "syncedAt", "status", "price", "inventoryQty", "cogs",
  ]);
  const warehouseGoogleAds = tableSentinel("warehouse_google_ads", [
    "id", "tenantId", "syncedAt", "campaignId", "campaignName",
    "costUsd", "conversions", "conversionValue", "clicks", "impressions",
  ]);
  const auditLogs = tableSentinel("audit_logs", ["createdAt", "organizationId"]);
  const stateSnapshots = tableSentinel("state_snapshots", ["id"]);

  // savedReportDefinitionSchema reproduced here to keep the mock self-contained
  // without importing lib/db (which requires a live DATABASE_URL).
  //
  // ⚠  KEEP IN SYNC with lib/db/src/schema/saved-reports.ts — any change to
  // TRUSTED_REPORT_KINDS or the definition shape there must be mirrored here.
  const TRUSTED_REPORT_KINDS = ["warehouse_kpis", "warehouse_channels"] as const;
  const savedReportDefinitionSchema = z.object({
    kind: z.enum(TRUSTED_REPORT_KINDS),  // mirrors: lib/db/src/schema/saved-reports.ts
    filters: z.record(z.string(), z.unknown()).optional(),
    title: z.string().max(200).optional(),
  });

  // Walk a where-condition produced by the drizzle-orm mock below to extract
  // the value an `eq(<col>, <val>)` was applied with for a given column name.
  const findEqValue = (
    cond: unknown,
    targetCol: string,
  ): unknown => {
    if (!cond || typeof cond !== "object") return undefined;
    const c = cond as Record<string, unknown>;
    if (c.__op === "eq" && (c.__col as { __col?: string })?.__col === targetCol) {
      return c.__val;
    }
    if (c.__op === "and" || c.__op === "or") {
      for (const sub of c.__args as unknown[]) {
        const v = findEqValue(sub, targetCol);
        if (v !== undefined) return v;
      }
    }
    return undefined;
  };

  const findTableInCondition = (cond: unknown): string | null => {
    if (!cond || typeof cond !== "object") return null;
    const c = cond as Record<string, unknown>;
    if (c.__op === "eq" || c.__op === "gte") {
      const col = c.__col as { __table?: string } | undefined;
      if (col?.__table) return col.__table;
    }
    if (c.__op === "and" || c.__op === "or") {
      for (const sub of c.__args as unknown[]) {
        const t = findTableInCondition(sub);
        if (t) return t;
      }
    }
    return null;
  };

  // Build a fluent select chain that recognises which table is being queried
  // based on the .from() target.
  const selectChain = () => {
    let tableName: string | null = null;
    const chain: Record<string, unknown> = {};
    chain.from = (tbl: { __table?: string }) => {
      tableName = tbl?.__table ?? null;
      return chain;
    };
    chain.where = (cond: unknown) => {
      // For warehouse tables, capture the tenantId used so tests can assert
      // tenant scoping. For savedReports lookup, capture id+workspaceId.
      if (tableName === "warehouse_shopify_products" || tableName === "warehouse_google_ads") {
        const tenantIdVal = findEqValue(cond, "tenantId");
        warehouseQueries.push({
          table: tableName,
          tenantIdInWhere: typeof tenantIdVal === "string" ? tenantIdVal : null,
        });
      }
      if (tableName === "saved_reports") {
        const id = findEqValue(cond, "id");
        const wsId = findEqValue(cond, "workspaceId");
        const idStr = typeof id === "string" ? id : "";
        const wsNum = typeof wsId === "number" ? wsId : -1;
        const row = savedReportRows.get(idStr);
        const matched = row && row.workspaceId === wsNum ? [row] : [];
        chain.limit = () => Promise.resolve(matched);
        return chain;
      }
      // Default warehouse aggregation row
      const aggRow = tableName === "warehouse_shopify_products"
        ? { productCount: 5, activeCount: 4, inventoryValue: 100, avgPrice: 20 }
        : { totalSpend: 50, totalConversions: 3, totalConversionValue: 150,
            totalClicks: 30, campaignCount: 2 };
      const result = [aggRow];
      // chain.groupBy / chain.limit terminal
      chain.groupBy = () => chain;
      chain.limit = () => Promise.resolve(result);
      // also support direct await (terminal where) — return a thenable
      (chain as { then?: unknown }).then = (resolve: (v: unknown) => unknown) =>
        resolve(result);
      return chain;
    };
    return chain;
  };

  return {
    db: {
      select: (..._args: unknown[]) => selectChain(),
      insert: (tbl: { __table?: string }) => ({
        values: (v: Record<string, unknown>) => {
          const out = { id: 999, ...v };
          if (tbl?.__table === "saved_reports") {
            const id = `00000000-0000-4000-8000-${String(insertedSavedReports.length + 1).padStart(12, "0")}`;
            const row: SavedReportRow = {
              id,
              workspaceId: v.workspaceId as number,
              createdBy: (v.createdBy as number | null) ?? null,
              definition: v.definition as SavedReportRow["definition"],
              createdAt: new Date(),
            };
            savedReportRows.set(id, row);
            insertedSavedReports.push(v);
            return { returning: () => Promise.resolve([row]) };
          }
          if (tbl?.__table === "shared_reports") {
            insertedSharedReports.push(v);
            return { returning: () => Promise.resolve([{ ...out }]) };
          }
          return { returning: () => Promise.resolve([out]) };
        },
      }),
    },
    savedReports,
    sharedReports,
    warehouseShopifyProducts,
    warehouseGoogleAds,
    auditLogs,
    stateSnapshots,
    savedReportDefinitionSchema,
    TRUSTED_REPORT_KINDS,
    // helpers for tests:
    __findTableInCondition: findTableInCondition,
  };
});

// ── drizzle-orm mock — preserve op + cols so the @workspace/db mock can read
// the predicate back. The shape mirrors what the production code passes to
// `db.select().where(...)`.
vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ __op: "eq", __col: col, __val: val }),
  and: (...args: unknown[]) => ({ __op: "and", __args: args }),
  or: (...args: unknown[]) => ({ __op: "or", __args: args }),
  gte: (col: unknown, val: unknown) => ({ __op: "gte", __col: col, __val: val }),
  desc: (c: unknown) => c,
  sql: (() => ({ __sql: true })) as unknown,
}));

// ── Subject under test ───────────────────────────────────────────────────────
import reportsRouter from "../routes/reports";
import { requireAuth } from "../middleware/rbac";

// ── Helpers ──────────────────────────────────────────────────────────────────
interface ExpressLayer {
  route?: ExpressRoute;
  handle: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
}
interface ExpressRoute {
  path: string;
  methods: Record<string, boolean>;
  stack: ExpressLayer[];
}

function findRoute(router: Router, method: string, path: string): ExpressRoute {
  const stack = (router as unknown as Router & { stack: ExpressLayer[] }).stack;
  const layer = stack.find(
    (l) => l.route?.path === path && (l.route as unknown as ExpressRoute)?.methods[method.toLowerCase()],
  );
  if (!layer || !layer.route) throw new Error(`Route not found: ${method} ${path}`);
  return layer.route as unknown as ExpressRoute;
}

function makeRes(): Response & { statusCode: number; body: unknown } {
  const res = { statusCode: 200, body: null as unknown } as Response & { statusCode: number; body: unknown };
  (res as unknown as Record<string, unknown>).status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  (res as unknown as Record<string, unknown>).json = vi.fn((b: unknown) => {
    res.body = b;
    return res;
  });
  (res as unknown as Record<string, unknown>).send = vi.fn((b: unknown) => {
    res.body = b;
    return res;
  });
  (res as unknown as Record<string, unknown>).setHeader = vi.fn();
  return res;
}

function makeReq(orgId: number | null, body: Record<string, unknown>, params: Record<string, string> = {}): Request {
  const rbacUser = orgId == null
    ? undefined
    : { id: 1, organizationId: orgId, name: "Tester", email: "t@e", role: "admin" };
  return {
    rbacUser,
    jwtPayload: orgId == null ? undefined : { memberId: 1, organizationId: orgId, role: "admin" },
    body,
    params,
    query: {},
    headers: {},
    log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as unknown as Request["log"],
  } as unknown as Request;
}

async function runRoute(route: ExpressRoute, req: Request, res: Response): Promise<void> {
  for (const layer of route.stack) {
    let nextCalled = false;
    let nextErr: unknown = undefined;
    const next: NextFunction = (err?: unknown) => {
      nextCalled = true;
      nextErr = err;
    };
    await Promise.resolve(layer.handle(req, res, next));
    if (nextErr) throw nextErr;
    if (!nextCalled) return;
  }
}

// ── Seed ─────────────────────────────────────────────────────────────────────
const ORG_ALICE = 1;
const ORG_BOB = 2;
const ALICE_REPORT_ID = "11111111-1111-4111-8111-111111111111";
const BOB_REPORT_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  savedReportRows.clear();
  insertedSharedReports.length = 0;
  insertedSavedReports.length = 0;
  warehouseQueries = [];
  // Alice's saved report
  savedReportRows.set(ALICE_REPORT_ID, {
    id: ALICE_REPORT_ID,
    workspaceId: ORG_ALICE,
    createdBy: 1,
    definition: { kind: "warehouse_kpis", filters: { daysBack: 7 }, title: "Alice KPIs" },
    createdAt: new Date(),
  });
  // Bob's saved report — Alice should NEVER be able to see this
  savedReportRows.set(BOB_REPORT_ID, {
    id: BOB_REPORT_ID,
    workspaceId: ORG_BOB,
    createdBy: 2,
    definition: { kind: "warehouse_channels", title: "Bob Channels" },
    createdAt: new Date(),
  });
});

// ── 1. Missing reportId → 400 ────────────────────────────────────────────────
describe("SEC-04/05 — reportId is required", () => {
  it("POST /export-csv without reportId → 400", async () => {
    const route = findRoute(reportsRouter, "POST", "/export-csv");
    const req = makeReq(ORG_ALICE, {});
    const res = makeRes();
    await runRoute(route, req, res);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/reportId/i);
  });

  it("POST /export-csv with non-string reportId → 400", async () => {
    const route = findRoute(reportsRouter, "POST", "/export-csv");
    const req = makeReq(ORG_ALICE, { reportId: 123 });
    const res = makeRes();
    await runRoute(route, req, res);
    expect(res.statusCode).toBe(400);
  });

  it("POST /share without reportId → 400", async () => {
    const route = findRoute(reportsRouter, "POST", "/share");
    const req = makeReq(ORG_ALICE, {});
    const res = makeRes();
    await runRoute(route, req, res);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/reportId/i);
  });
});

// ── 2. Cross-tenant access to another workspace's saved report → 404 ─────────
describe("SEC-04/05 — workspace isolation on saved reports", () => {
  it("GET /saved/:id for another workspace's report → 404 (not 403, hides existence)", async () => {
    const route = findRoute(reportsRouter, "GET", "/saved/:id");
    // Alice asks for Bob's report id
    const req = makeReq(ORG_ALICE, {}, { id: BOB_REPORT_ID });
    const res = makeRes();
    await runRoute(route, req, res);
    expect(res.statusCode).toBe(404);
    expect((res.body as { error: string }).error).toMatch(/not found/i);
  });

  it("POST /export-csv for another workspace's reportId → 404", async () => {
    const route = findRoute(reportsRouter, "POST", "/export-csv");
    const req = makeReq(ORG_ALICE, { reportId: BOB_REPORT_ID });
    const res = makeRes();
    await runRoute(route, req, res);
    expect(res.statusCode).toBe(404);
    // Critically: no warehouse query was issued and no shared row was written.
    expect(warehouseQueries).toHaveLength(0);
    expect(insertedSharedReports).toHaveLength(0);
  });

  it("POST /share for another workspace's reportId → 404", async () => {
    const route = findRoute(reportsRouter, "POST", "/share");
    const req = makeReq(ORG_ALICE, { reportId: BOB_REPORT_ID });
    const res = makeRes();
    await runRoute(route, req, res);
    expect(res.statusCode).toBe(404);
    // No share row leaked under Alice's workspaceId either.
    expect(insertedSharedReports).toHaveLength(0);
  });

  it("malformed reportId → 400 (rejected before any DB lookup)", async () => {
    const route = findRoute(reportsRouter, "GET", "/saved/:id");
    const req = makeReq(ORG_ALICE, {}, { id: "not-a-uuid" });
    const res = makeRes();
    await runRoute(route, req, res);
    expect(res.statusCode).toBe(400);
  });
});

// ── 3. Warehouse fetcher always tenant-scoped to caller ──────────────────────
describe("SEC-04/05 — warehouse fetcher pins tenantId to the caller", () => {
  it("/export-csv against the caller's own report queries warehouse with caller's tenantId only", async () => {
    const route = findRoute(reportsRouter, "POST", "/export-csv");
    const req = makeReq(ORG_ALICE, { reportId: ALICE_REPORT_ID });
    const res = makeRes();
    await runRoute(route, req, res);

    // warehouse_kpis fetcher hits both warehouse tables.
    expect(warehouseQueries.length).toBeGreaterThan(0);
    for (const q of warehouseQueries) {
      // Every warehouse WHERE must pin tenantId to caller's workspaceId
      // (stringified — production code does `String(orgId)`).
      expect(q.tenantIdInWhere).toBe(String(ORG_ALICE));
    }
  });

  it("/share against the caller's own report queries warehouse with caller's tenantId only", async () => {
    const route = findRoute(reportsRouter, "POST", "/share");
    const req = makeReq(ORG_ALICE, { reportId: ALICE_REPORT_ID });
    const res = makeRes();
    await runRoute(route, req, res);

    expect(res.statusCode).toBe(200);
    expect(warehouseQueries.length).toBeGreaterThan(0);
    for (const q of warehouseQueries) {
      expect(q.tenantIdInWhere).toBe(String(ORG_ALICE));
    }
    // The persisted share row is stamped with the caller's workspaceId only.
    expect(insertedSharedReports).toHaveLength(1);
    expect(insertedSharedReports[0].workspaceId).toBe(ORG_ALICE);
  });

  it("unauthenticated caller (no org) on POST /share is rejected with 401 — no warehouse query issued", async () => {
    // POST /share explicitly handles UnauthorizedTenantError → 401.
    // Using /share here for a tight, deterministic assertion; /export-csv also
    // rejects unauthenticated callers but maps the same error to 500 (a
    // separate hardening opportunity tracked in follow-up task #220).
    const route = findRoute(reportsRouter, "POST", "/share");
    const req = makeReq(null, { reportId: ALICE_REPORT_ID });
    const res = makeRes();
    await runRoute(route, req, res);
    expect(res.statusCode).toBe(401);
    expect(warehouseQueries).toHaveLength(0);
    expect(insertedSharedReports).toHaveLength(0);
  });
});

// ── 5. Unauthenticated callers blocked by auth middleware before any DB hit ───
//
// These tests mount requireAuth() in front of the route handler, mirroring how
// the production Express app registers the router. A regression that removes or
// mis-orders the auth middleware would surface here as a 2xx instead of 401.
describe("SEC-NEW — requireAuth middleware blocks unauthenticated export/share requests", () => {
  async function runWithAuth(route: ExpressRoute, req: Request, res: Response): Promise<void> {
    const authMiddleware = requireAuth();
    let authNextCalled = false;
    let authNextErr: unknown;
    const authNext: NextFunction = (err?: unknown) => {
      authNextCalled = true;
      authNextErr = err;
    };
    await Promise.resolve(authMiddleware(req, res, authNext));
    if (!authNextCalled) return;
    if (authNextErr) throw authNextErr;
    await runRoute(route, req, res);
  }

  it("POST /export-csv with no Authorization header → 401, zero warehouse queries", async () => {
    const route = findRoute(reportsRouter, "POST", "/export-csv");
    const req = makeReq(null, { reportId: ALICE_REPORT_ID });
    const res = makeRes();
    await runWithAuth(route, req, res);
    expect(res.statusCode).toBe(401);
    expect(warehouseQueries).toHaveLength(0);
  });

  it("POST /share with no Authorization header → 401, zero warehouse queries, no share row written", async () => {
    const route = findRoute(reportsRouter, "POST", "/share");
    const req = makeReq(null, { reportId: ALICE_REPORT_ID });
    const res = makeRes();
    await runWithAuth(route, req, res);
    expect(res.statusCode).toBe(401);
    expect(warehouseQueries).toHaveLength(0);
    expect(insertedSharedReports).toHaveLength(0);
  });

  it("GET /saved/:id with no Authorization header → 401, no DB lookup", async () => {
    const route = findRoute(reportsRouter, "GET", "/saved/:id");
    const req = makeReq(null, {}, { id: ALICE_REPORT_ID });
    const res = makeRes();
    await runWithAuth(route, req, res);
    expect(res.statusCode).toBe(401);
    expect(warehouseQueries).toHaveLength(0);
  });

  it("POST /export-csv with no Authorization header → response body has AUTH_REQUIRED code", async () => {
    const route = findRoute(reportsRouter, "POST", "/export-csv");
    const req = makeReq(null, { reportId: ALICE_REPORT_ID });
    const res = makeRes();
    await runWithAuth(route, req, res);
    expect(res.statusCode).toBe(401);
    expect((res.body as { code?: string }).code).toBe("AUTH_REQUIRED");
  });
});

// ── 4. POST /api/reports/saved validates `kind` ──────────────────────────────
describe("SEC-04/05 — POST /api/reports/saved validates definition", () => {
  it("rejects unknown `kind` with 400", async () => {
    const route = findRoute(reportsRouter, "POST", "/saved");
    const req = makeReq(ORG_ALICE, { kind: "all_tenants_dump" });
    const res = makeRes();
    await runRoute(route, req, res);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/invalid/i);
    expect(insertedSavedReports).toHaveLength(0);
  });

  it("rejects payload missing `kind`", async () => {
    const route = findRoute(reportsRouter, "POST", "/saved");
    const req = makeReq(ORG_ALICE, { filters: { daysBack: 7 } });
    const res = makeRes();
    await runRoute(route, req, res);
    expect(res.statusCode).toBe(400);
    expect(insertedSavedReports).toHaveLength(0);
  });

  it("accepts a valid `kind` and stamps the caller's workspaceId on the row", async () => {
    const route = findRoute(reportsRouter, "POST", "/saved");
    const req = makeReq(ORG_ALICE, { kind: "warehouse_kpis", filters: { daysBack: 14 } });
    const res = makeRes();
    await runRoute(route, req, res);
    expect(res.statusCode).toBe(201);
    expect(insertedSavedReports).toHaveLength(1);
    expect(insertedSavedReports[0]).toMatchObject({
      workspaceId: ORG_ALICE,
      definition: { kind: "warehouse_kpis", filters: { daysBack: 14 } },
    });
  });
});
