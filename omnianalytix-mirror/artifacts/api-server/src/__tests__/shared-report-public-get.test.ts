/**
 * SEC-08 — GET /api/shared-reports/:shareId (public share link) auth tests.
 *
 * Covers:
 *   1. Expired link       → 410 Gone
 *   2. Deactivated link   → 404 (isActive=false filtered at DB level)
 *   3. Unknown shareId    → 404
 *   4. Active valid link  → 200 with correct payload
 *   5. workspaceId NEVER in response body (cross-tenant leak guard)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction, Router } from "express";

// ── Shared-report fixture store ───────────────────────────────────────────────
interface SharedReportRow {
  id: number;
  shareId: string;
  workspaceId: number;
  agencyName: string | null;
  reportTitle: string;
  reportData: Record<string, unknown>;
  expiresAt: Date | null;
  isActive: boolean;
  createdAt: Date;
}

const sharedReportStore = new Map<string, SharedReportRow>();

// ── @workspace/db mock ───────────────────────────────────────────────────────
vi.mock("@workspace/db", () => {
  const tableSentinel = (name: string, cols: string[]): Record<string, unknown> => {
    const t: Record<string, unknown> = { __table: name };
    for (const c of cols) t[c] = { __col: c, __table: name };
    return t;
  };

  const sharedReports = tableSentinel("shared_reports", [
    "id", "shareId", "workspaceId", "agencyName", "reportTitle",
    "reportData", "expiresAt", "isActive", "createdAt",
  ]);

  const findEqVal = (cond: unknown, col: string): unknown => {
    if (!cond || typeof cond !== "object") return undefined;
    const c = cond as Record<string, unknown>;
    if (c.__op === "eq" && (c.__col as { __col?: string })?.__col === col) return c.__val;
    if (c.__op === "and" || c.__op === "or") {
      for (const sub of c.__args as unknown[]) {
        const v = findEqVal(sub, col);
        if (v !== undefined) return v;
      }
    }
    return undefined;
  };

  const selectChain = () => {
    let tbl: string | null = null;
    const chain: Record<string, unknown> = {};
    chain.from = (t: { __table?: string }) => { tbl = t?.__table ?? null; return chain; };
    chain.where = (cond: unknown) => {
      chain.limit = () => {
        if (tbl !== "shared_reports") return Promise.resolve([]);
        const shareId = findEqVal(cond, "shareId");
        const isActive = findEqVal(cond, "isActive");
        const row = typeof shareId === "string" ? sharedReportStore.get(shareId) : undefined;
        if (!row) return Promise.resolve([]);
        if (typeof isActive === "boolean" && row.isActive !== isActive) return Promise.resolve([]);
        return Promise.resolve([row]);
      };
      return chain;
    };
    return chain;
  };

  return {
    db: { select: () => selectChain() },
    sharedReports,
    // stub everything else the main router might reference at import-time
    savedReports: tableSentinel("saved_reports", ["id", "workspaceId"]),
    auditLogs: tableSentinel("audit_logs", ["createdAt", "organizationId"]),
  };
});

// ── drizzle-orm mock ──────────────────────────────────────────────────────────
vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ __op: "eq", __col: col, __val: val }),
  and: (...args: unknown[]) => ({ __op: "and", __args: args }),
  or: (...args: unknown[]) => ({ __op: "or", __args: args }),
  gte: (col: unknown, val: unknown) => ({ __op: "gte", __col: col, __val: val }),
  desc: (c: unknown) => c,
  sql: (() => ({ __sql: true })) as unknown,
  inArray: (col: unknown, val: unknown) => ({ __op: "inArray", __col: col, __val: val }),
}));

// ── Middleware mocks ──────────────────────────────────────────────────────────
vi.mock("../middleware/rbac", () => ({
  requireAuth: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  readGuard: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  attachUser: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  mutationGuard: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../middleware/super-admin", () => ({
  requireSuperAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../middleware/mutation-logger", () => ({
  mutationLogger: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../middleware/connection-guard", () => ({
  requireActiveConnection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../middleware/rate-limiter", () => ({
  authRateLimit: (_req: Request, _res: Response, next: NextFunction) => next(),
  warehouseRateLimit: (_req: Request, _res: Response, next: NextFunction) => next(),
  sharedReportRateLimit: (_req: Request, _res: Response, next: NextFunction) => next(),
  geminiRateLimit: (_req: Request, _res: Response, next: NextFunction) => next(),
  connectionsRateLimit: (_req: Request, _res: Response, next: NextFunction) => next(),
  actionsRateLimit: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../middleware/rescan-rate-limiter", () => ({
  rescanRateLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../middleware/enrichment-tier", () => ({
  requireEnrichmentTier: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../middleware/tenant-isolation", () => ({
  tenantIsolation: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// ── Services / workers mocks ──────────────────────────────────────────────────
vi.mock("../services/system-health-monitor", () => ({
  getLastHealthResults: () => ({ results: [], lastRunAt: null }),
}));
vi.mock("../workers/quality-fixes-scanner", () => ({
  getQualityFixesScannerStatus: () => ({ lastErrorCode: null }),
  getPendingQualityFixesCount: () => Promise.resolve(0),
}));
vi.mock("../workers/feedgen-runner", () => ({
  getFeedgenRecoveryStatus: () => ({}),
  getStuckFeedgenCount: () => Promise.resolve(0),
}));

// ── Logger / error-handler mocks ──────────────────────────────────────────────
vi.mock("../lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/route-error-handler", () => ({
  handleRouteError: (_err: unknown, _req: Request, res: Response, _ctx: string, body: unknown) => {
    res.status(500).json(body);
  },
}));

// ── Sub-router stubs (all sub-routers → no-op passthrough) ───────────────────
// vi.mock() is hoisted before any variable declarations, so every factory must
// be a self-contained inline expression that references nothing from outer scope.
type AnyFn = (...a: unknown[]) => unknown;

vi.mock("../routes/health",            () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/gemini",            () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/connections",       () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/auth",              () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/actions",           () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/reports",           () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/compliance",        () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/inventory",         () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/customers",         () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/shopify",           () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/system",            () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/google-ads",        () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/live-triage",       () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/mcp/index",         () => ({ mcpRouter: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/analytics",         () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/crm",               () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/insights",          () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/fx",                () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/etl",               () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/dashboard",         () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/warehouse",         () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/team",              () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/tasks",             () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/webhooks",          () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/webhooks/master-bus",() => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/workspaces",        () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/organizations",     () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/infrastructure",    () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/billing",           () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/billing-hub",       () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/looker",            () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/ai-creative",       () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/feed-enrichment",   () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/ai-agents",         () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/promo-engine",      () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/resolution-library",() => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/data-modeling",     () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/data-upload",       () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/byodb",             () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/leads",             () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/admin",             () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/financials",        () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/saved-views",       () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/users",             () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/copilot",           () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/bi",                () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/me",                () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/leadgen",           () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/hybrid",            () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/invite",            () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/platform",          () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/integrations",      () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/adk",               () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/adk-proto",         () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/gaarf",             () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));
vi.mock("../routes/settings",          () => ({ default: Object.assign((_r:unknown,_s:unknown,n:AnyFn)=>n(),{use:()=>{},get:()=>{},post:()=>{}}) }));

// ── Subject under test ────────────────────────────────────────────────────────
import mainRouter from "../routes/index";

// ── Test helpers ──────────────────────────────────────────────────────────────
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
  (res as unknown as Record<string, unknown>).status = vi.fn((code: number) => { res.statusCode = code; return res; });
  (res as unknown as Record<string, unknown>).json = vi.fn((b: unknown) => { res.body = b; return res; });
  (res as unknown as Record<string, unknown>).send = vi.fn((b: unknown) => { res.body = b; return res; });
  (res as unknown as Record<string, unknown>).setHeader = vi.fn();
  return res;
}

function makeReq(shareId: string): Request {
  return {
    params: { shareId },
    body: {},
    query: {},
    headers: {},
    log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as unknown as Request["log"],
  } as unknown as Request;
}

async function runRoute(route: ExpressRoute, req: Request, res: Response): Promise<void> {
  for (const layer of route.stack) {
    let nextCalled = false;
    let nextErr: unknown = undefined;
    const next: NextFunction = (err?: unknown) => { nextCalled = true; nextErr = err; };
    await Promise.resolve(layer.handle(req, res, next));
    if (nextErr) throw nextErr;
    if (!nextCalled) return;
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────
const ALICE_WS = 42;
const BOB_WS = 99;

const ACTIVE_SHARE_ID    = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EXPIRED_SHARE_ID   = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const INACTIVE_SHARE_ID  = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const UNKNOWN_SHARE_ID   = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const ACTIVE_ROW: SharedReportRow = {
  id: 1,
  shareId: ACTIVE_SHARE_ID,
  workspaceId: ALICE_WS,
  agencyName: "Alice Agency",
  reportTitle: "Alice Q1 Report",
  reportData: { kind: "warehouse_kpis", rows: [{ spend: 100 }], generatedAt: "2026-01-01T00:00:00Z" },
  expiresAt: new Date(Date.now() + 86_400_000 * 30), // 30 days future
  isActive: true,
  createdAt: new Date("2026-01-01"),
};

const EXPIRED_ROW: SharedReportRow = {
  id: 2,
  shareId: EXPIRED_SHARE_ID,
  workspaceId: ALICE_WS,
  agencyName: null,
  reportTitle: "Old Report",
  reportData: { kind: "warehouse_kpis", rows: [] },
  expiresAt: new Date(Date.now() - 86_400_000), // 1 day in the past
  isActive: true,
  createdAt: new Date("2025-12-01"),
};

const INACTIVE_ROW: SharedReportRow = {
  id: 3,
  shareId: INACTIVE_SHARE_ID,
  workspaceId: BOB_WS,
  agencyName: "Bob Agency",
  reportTitle: "Bob Deactivated",
  reportData: { kind: "warehouse_channels", rows: [] },
  expiresAt: new Date(Date.now() + 86_400_000 * 30),
  isActive: false,
  createdAt: new Date("2026-02-01"),
};

beforeEach(() => {
  sharedReportStore.clear();
  sharedReportStore.set(ACTIVE_SHARE_ID, ACTIVE_ROW);
  sharedReportStore.set(EXPIRED_SHARE_ID, EXPIRED_ROW);
  sharedReportStore.set(INACTIVE_SHARE_ID, INACTIVE_ROW);
});

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("SEC-08 — GET /shared-reports/:shareId public link auth", () => {
  let route: ExpressRoute;

  beforeEach(() => {
    route = findRoute(mainRouter as unknown as Router, "GET", "/shared-reports/:shareId");
  });

  // 1. Active, non-expired → 200
  it("active non-expired link → 200 with report data", async () => {
    const req = makeReq(ACTIVE_SHARE_ID);
    const res = makeRes();
    await runRoute(route, req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.shareId).toBe(ACTIVE_SHARE_ID);
    expect(body.reportTitle).toBe("Alice Q1 Report");
    expect(body.agencyName).toBe("Alice Agency");
    expect(body.reportData).toMatchObject({ kind: "warehouse_kpis" });
  });

  // 2. workspaceId must NOT appear in response
  it("response body never contains workspaceId (cross-tenant leak guard)", async () => {
    const req = makeReq(ACTIVE_SHARE_ID);
    const res = makeRes();
    await runRoute(route, req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("workspaceId");
    // Also check serialised form — catches accidental nesting
    const json = JSON.stringify(body);
    expect(json).not.toContain(`"workspaceId"`);
  });

  // 3. Expired link → 410 Gone
  it("expired link → 410 Gone", async () => {
    const req = makeReq(EXPIRED_SHARE_ID);
    const res = makeRes();
    await runRoute(route, req, res);

    expect(res.statusCode).toBe(410);
    const body = res.body as Record<string, unknown>;
    expect(typeof body.error).toBe("string");
    expect((body.error as string).toLowerCase()).toMatch(/expired/);
  });

  // 4. Deactivated link → 404 (WHERE isActive=true filters it out at DB level)
  it("deactivated link → 404 (existence not revealed)", async () => {
    const req = makeReq(INACTIVE_SHARE_ID);
    const res = makeRes();
    await runRoute(route, req, res);

    expect(res.statusCode).toBe(404);
    const body = res.body as Record<string, unknown>;
    expect(typeof body.error).toBe("string");
  });

  // 5. Unknown shareId → 404
  it("unknown shareId → 404", async () => {
    const req = makeReq(UNKNOWN_SHARE_ID);
    const res = makeRes();
    await runRoute(route, req, res);

    expect(res.statusCode).toBe(404);
  });

  // 6. workspaceId from a different tenant's deactivated row not leaked even in 404 body
  it("404 body for deactivated row does not contain Bob's workspaceId", async () => {
    const req = makeReq(INACTIVE_SHARE_ID);
    const res = makeRes();
    await runRoute(route, req, res);

    expect(res.statusCode).toBe(404);
    const json = JSON.stringify(res.body);
    expect(json).not.toContain(String(BOB_WS));
  });

  // 7. No expiry set → treated as non-expiring (null expiresAt)
  it("null expiresAt → link never expires, returns 200", async () => {
    const noExpiryId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    sharedReportStore.set(noExpiryId, {
      ...ACTIVE_ROW,
      id: 4,
      shareId: noExpiryId,
      expiresAt: null,
    });
    const req = makeReq(noExpiryId);
    const res = makeRes();
    await runRoute(route, req, res);

    expect(res.statusCode).toBe(200);
  });
});
