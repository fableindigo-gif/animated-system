/**
 * Phase 1 — cross-tenant / credential-leak regression suite.
 *
 * Phase 1 of the security audit shipped four route-/library-layer fixes
 * that, until now, only had a single regression test (connections-rbac).
 * This file adds end-to-end behavioural tests for the remaining three
 * areas so future refactors cannot silently regress them:
 *
 *   SEC-03  POST /api/billing/create-checkout-session ignores body.workspaceId
 *           and uses the authenticated session's id (Stripe spoofing fix).
 *   SEC-05  POST /api/reports/share rejects unauthenticated calls and
 *           persists rows under the org's workspaceId — never user.id.
 *   SEC-06  credential-vault.encrypt/decrypt fail closed when
 *           DB_CREDENTIAL_ENCRYPTION_KEY is missing outside development/test.
 *
 * SEC-07 (google-token-refresh log redaction) is exercised by the existing
 * google-token-refresh-redaction.test.ts and is not duplicated here.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type { Request, Response, NextFunction, Router } from "express";

// ── Shared route-traversal helpers ───────────────────────────────────────────

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
  (res as unknown as Record<string, unknown>).setHeader = vi.fn(() => res);
  return res;
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

// ─────────────────────────────────────────────────────────────────────────────
// SEC-03 — POST /api/billing/create-checkout-session
// ─────────────────────────────────────────────────────────────────────────────

describe("SEC-03 — POST /api/billing/create-checkout-session ignores body.workspaceId", () => {
  // Mock state shared across the describe block.
  const stripeCreate = vi.fn().mockResolvedValue({ id: "cs_test_session", url: "https://stripe.test/co" });
  let billingRouter: Router;

  beforeEach(async () => {
    vi.resetModules();
    stripeCreate.mockClear();

    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    process.env.STRIPE_PRO_PRICE_ID = "price_dummy";

    vi.doMock("stripe", () => ({
      default: class MockStripe {
        checkout = { sessions: { create: stripeCreate } };
        billingPortal = { sessions: { create: vi.fn() } };
      },
    }));

    vi.doMock("../lib/logger", () => ({
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
    }));

    // Mock the rbac middleware so we can deterministically inject rbacUser
    // (or omit it) without standing up the real JWT machinery.
    vi.doMock("../middleware/rbac", () => {
      const requireAuth = () => (req: Request, _res: Response, next: NextFunction) => {
        // Read the test-controlled identity off req for this run.
        const stub = (req as unknown as { __mockUser?: { id: number; organizationId: number; workspaceId?: number } }).__mockUser;
        if (stub) {
          (req as unknown as { rbacUser: typeof stub }).rbacUser = stub;
        }
        next();
      };
      const getOrgId = (req: Request) =>
        (req as unknown as { rbacUser?: { organizationId?: number } }).rbacUser?.organizationId ?? null;
      return { requireAuth, getOrgId };
    });

    billingRouter = (await import("../routes/billing")).default as unknown as Router;
  });

  function makeReq(opts: {
    user?: { id: number; organizationId: number; workspaceId?: number };
    body?: Record<string, unknown>;
  }): Request {
    return {
      headers: {},
      hostname: "test.example.com",
      method: "POST",
      originalUrl: "/api/billing/create-checkout-session",
      body: opts.body ?? {},
      params: {},
      query: {},
      __mockUser: opts.user,
      log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as unknown as Request["log"],
    } as unknown as Request;
  }

  it("rejects (403) when body.workspaceId belongs to a different tenant than the session", async () => {
    const route = findRoute(billingRouter, "POST", "/create-checkout-session");
    // Authenticated tenant is org/workspace 42. Attacker passes 999 in the body.
    const req = makeReq({
      user: { id: 1, organizationId: 42, workspaceId: 42 },
      body: { tier: "pro", workspaceId: 999 },
    });
    const res = makeRes();

    await runRoute(route, req, res);

    expect(res.statusCode).toBe(403);
    expect((res.body as { code: string }).code).toBe("WORKSPACE_MISMATCH");
    // Critically: Stripe was NEVER asked to create a session with the
    // spoofed workspaceId.
    expect(stripeCreate).not.toHaveBeenCalled();
  });

  it("uses the session's workspaceId in Stripe metadata even when body omits it", async () => {
    const route = findRoute(billingRouter, "POST", "/create-checkout-session");
    const req = makeReq({
      user: { id: 1, organizationId: 42, workspaceId: 42 },
      body: { tier: "pro" }, // no workspaceId in body at all
    });
    const res = makeRes();

    await runRoute(route, req, res);

    expect(res.statusCode).toBe(200);
    expect(stripeCreate).toHaveBeenCalledOnce();
    const args = stripeCreate.mock.calls[0][0] as { metadata: Record<string, string> };
    expect(args.metadata.workspaceId).toBe("42");
  });

  it("uses the session's workspaceId when body.workspaceId matches (allow-listed harmless case)", async () => {
    const route = findRoute(billingRouter, "POST", "/create-checkout-session");
    const req = makeReq({
      user: { id: 1, organizationId: 42, workspaceId: 42 },
      body: { tier: "pro", workspaceId: 42 },
    });
    const res = makeRes();

    await runRoute(route, req, res);

    expect(res.statusCode).toBe(200);
    const args = stripeCreate.mock.calls[0][0] as { metadata: Record<string, string> };
    expect(args.metadata.workspaceId).toBe("42");
  });

  it("rejects (401) when the request has no authenticated session at all", async () => {
    const route = findRoute(billingRouter, "POST", "/create-checkout-session");
    const req = makeReq({ body: { tier: "pro", workspaceId: 999 } }); // no user
    const res = makeRes();

    await runRoute(route, req, res);

    expect(res.statusCode).toBe(401);
    expect((res.body as { code: string }).code).toBe("AUTH_REQUIRED");
    expect(stripeCreate).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-05 — POST /api/reports/share
// ─────────────────────────────────────────────────────────────────────────────

describe("SEC-05 — POST /api/reports/share workspace derivation", () => {
  // Captured insert payload(s) so we can assert what got persisted.
  let inserted: Array<{ table: unknown; v: Record<string, unknown> }>;
  let reportsRouter: Router;

  // Fixture: saved report belongs to workspace 42.
  const SAVED_REPORT = {
    id: "11111111-1111-1111-1111-111111111111",
    workspaceId: 42,
    definition: { kind: "warehouse_kpis", filters: {} },
  };

  beforeEach(async () => {
    vi.resetModules();
    inserted = [];

    // Sentinel objects for table identity checks in the db mock.
    const savedReports = { __t: "savedReports", id: "id", workspaceId: "workspaceId" };
    const sharedReports = { __t: "sharedReports" };
    const warehouseShopifyProducts = {
      __t: "warehouseShopifyProducts",
      tenantId: "tenantId",
      syncedAt: "syncedAt",
      price: "price",
      cogs: "cogs",
      status: "status",
      inventoryQty: "inventoryQty",
    };
    const warehouseGoogleAds = {
      __t: "warehouseGoogleAds",
      tenantId: "tenantId",
      syncedAt: "syncedAt",
      campaignId: "campaignId",
      campaignName: "campaignName",
      costUsd: "costUsd",
      conversions: "conversions",
      clicks: "clicks",
      impressions: "impressions",
    };
    const auditLogs = { __t: "auditLogs", organizationId: "organizationId", createdAt: "createdAt" };
    const stateSnapshots = { __t: "stateSnapshots" };

    // Drizzle-style chainable query builder. `.limit()` returns the saved-
    // report row; warehouse aggregations resolve via the thenable shim so
    // `await db.select().from(t).where(...)` yields a single aggregate row.
    type Builder = {
      from: (t: { __t: string }) => Builder;
      where: () => Builder;
      groupBy: () => Builder;
      orderBy: () => Builder;
      limit: () => Promise<Record<string, unknown>[]>;
      then: (resolve: (v: Record<string, unknown>[]) => void) => void;
    };

    const makeBuilder = (): Builder => {
      let table: { __t: string } | null = null;
      const b: Builder = {
        from: (t) => { table = t; return b; },
        where: () => b,
        groupBy: () => b,
        orderBy: () => b,
        limit: () => {
          if (table?.__t === "savedReports") return Promise.resolve([SAVED_REPORT]);
          return Promise.resolve([]);
        },
        then: (resolve) => {
          if (table?.__t === "warehouseShopifyProducts") {
            resolve([{ productCount: 5, activeCount: 3, inventoryValue: 100, avgPrice: 10 }]);
          } else if (table?.__t === "warehouseGoogleAds") {
            resolve([{ totalSpend: 200, totalConversions: 10, totalConversionValue: 500, totalClicks: 50, campaignCount: 2 }]);
          } else {
            resolve([]);
          }
        },
      };
      return b;
    };

    vi.doMock("@workspace/db", () => ({
      db: {
        select: () => makeBuilder(),
        insert: (table: unknown) => ({
          values: (v: Record<string, unknown>) => {
            inserted.push({ table, v });
            return {
              returning: () => Promise.resolve([{ id: 1, ...v }]),
            };
          },
        }),
      },
      savedReports,
      sharedReports,
      warehouseGoogleAds,
      warehouseShopifyProducts,
      auditLogs,
      stateSnapshots,
      savedReportDefinitionSchema: {
        safeParse: (v: unknown) => ({ success: true, data: v }),
      },
    }));

    vi.doMock("drizzle-orm", () => ({
      eq: (col: unknown, val: unknown) => ({ __op: "eq", col, val }),
      and: (...args: unknown[]) => ({ __op: "and", args }),
      gte: (col: unknown, val: unknown) => ({ __op: "gte", col, val }),
      desc: (c: unknown) => c,
      sql: Object.assign(() => "sql", { raw: () => "sql" }),
    }));

    vi.doMock("../lib/logger", () => ({
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
    }));

    vi.doMock("../lib/vertex-client", () => ({
      getGoogleGenAI: vi.fn(),
      VERTEX_MODEL: "gemini-test",
    }));

    // Mock the rbac middleware. requireOrgId either returns the test-supplied
    // org id, or throws UnauthorizedTenantError when none was supplied —
    // exactly mirroring the production behaviour.
    class UnauthorizedTenantError extends Error {
      readonly httpStatus = 401 as const;
      readonly code = "UNAUTHORIZED" as const;
      constructor() { super("Authentication required"); this.name = "UnauthorizedTenantError"; }
    }
    vi.doMock("../middleware/rbac", () => ({
      getOrgId: (req: Request) => (req as unknown as { __orgId?: number }).__orgId ?? null,
      requireOrgId: (req: Request) => {
        const id = (req as unknown as { __orgId?: number }).__orgId;
        if (id == null) throw new UnauthorizedTenantError();
        return id;
      },
      UnauthorizedTenantError,
    }));

    // pdfkit / pptxgenjs are imported at module load by the reports router,
    // but the /share handler doesn't use them — leaving the real modules in
    // place is fine; they don't perform side effects on import.

    reportsRouter = (await import("../routes/reports")).default as unknown as Router;
  });

  function makeReq(opts: {
    orgId?: number;
    userId?: number;
    body?: Record<string, unknown>;
  }): Request {
    return {
      headers: {},
      method: "POST",
      originalUrl: "/api/reports/share",
      body: opts.body ?? {},
      params: {},
      query: {},
      __orgId: opts.orgId,
      rbacUser: opts.userId != null ? { id: opts.userId, organizationId: opts.orgId ?? null } : undefined,
      log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as unknown as Request["log"],
    } as unknown as Request;
  }

  it("rejects (401) unauthenticated calls and never inserts a shared_reports row", async () => {
    const route = findRoute(reportsRouter, "POST", "/share");
    const req = makeReq({
      // No orgId → requireOrgId throws UnauthorizedTenantError.
      body: { reportId: SAVED_REPORT.id },
    });
    const res = makeRes();

    await runRoute(route, req, res);

    expect(res.statusCode).toBe(401);
    expect(inserted).toHaveLength(0);
  });

  it("persists the row under the org's workspaceId — never the user.id", async () => {
    const route = findRoute(reportsRouter, "POST", "/share");
    // Important: userId (7) and orgId (42) deliberately differ. The buggy
    // pre-fix path used `req.rbacUser?.id` as a fallback, which would have
    // stored workspaceId=7. The fix forces wsId=orgId=42.
    const req = makeReq({
      orgId: 42,
      userId: 7,
      body: { reportId: SAVED_REPORT.id, reportTitle: "Q4" },
    });
    const res = makeRes();

    await runRoute(route, req, res);

    expect(res.statusCode).toBe(200);
    const sharedInsert = inserted.find((r) => (r.table as { __t: string }).__t === "sharedReports");
    expect(sharedInsert, "expected one shared_reports insert").toBeTruthy();
    expect(sharedInsert!.v.workspaceId).toBe(42);
    expect(sharedInsert!.v.workspaceId).not.toBe(7); // explicit guard against the legacy bug
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-05b — sibling saved/shared report endpoints reject unauthenticated calls
//
// The /share workspace-derivation behaviour is covered above. Its sibling
// endpoints flow through the same requireOrgId / getOrgId chokepoint and the
// same UnauthorizedTenantError catch path. Without dedicated tests, a future
// refactor that drops the auth guard from any one of them would not be caught.
// ─────────────────────────────────────────────────────────────────────────────

describe("SEC-05b — saved/shared report sibling endpoints reject unauthenticated calls", () => {
  let inserted: Array<{ table: unknown; v: Record<string, unknown> }>;
  let selected: number;
  let updated: Array<{ table: unknown; v: Record<string, unknown> }>;
  let reportsRouter: Router;

  // Same fixture as the SEC-05 block — a saved report owned by workspace 42.
  const VALID_UUID = "11111111-1111-1111-1111-111111111111";

  beforeEach(async () => {
    vi.resetModules();
    inserted = [];
    selected = 0;
    updated = [];

    const savedReports = { __t: "savedReports", id: "id", workspaceId: "workspaceId" };
    const sharedReports = { __t: "sharedReports", id: "id", shareId: "shareId", workspaceId: "workspaceId", reportTitle: "reportTitle", isActive: "isActive", expiresAt: "expiresAt", createdAt: "createdAt" };
    const warehouseShopifyProducts = { __t: "warehouseShopifyProducts", tenantId: "tenantId", syncedAt: "syncedAt", price: "price", cogs: "cogs", status: "status", inventoryQty: "inventoryQty" };
    const warehouseGoogleAds = { __t: "warehouseGoogleAds", tenantId: "tenantId", syncedAt: "syncedAt", campaignId: "campaignId", campaignName: "campaignName", costUsd: "costUsd", conversions: "conversions", clicks: "clicks", impressions: "impressions" };
    const auditLogs = { __t: "auditLogs", organizationId: "organizationId", createdAt: "createdAt" };
    const stateSnapshots = { __t: "stateSnapshots" };

    // Minimal chainable stub. If the auth guard works, none of these methods
    // should ever be reached — tests assert `selected === 0`, etc.
    const makeBuilder = () => {
      const b: Record<string, unknown> = {};
      b.from = () => b;
      b.where = () => b;
      b.groupBy = () => b;
      b.orderBy = () => b;
      b.limit = () => Promise.resolve([]);
      b.then = (resolve: (v: unknown[]) => void) => resolve([]);
      return b;
    };

    vi.doMock("@workspace/db", () => ({
      db: {
        select: () => { selected += 1; return makeBuilder(); },
        insert: (table: unknown) => ({
          values: (v: Record<string, unknown>) => {
            inserted.push({ table, v });
            return { returning: () => Promise.resolve([{ id: 1, ...v }]) };
          },
        }),
        update: (table: unknown) => ({
          set: (v: Record<string, unknown>) => ({
            where: () => { updated.push({ table, v }); return Promise.resolve(); },
          }),
        }),
      },
      savedReports,
      sharedReports,
      warehouseGoogleAds,
      warehouseShopifyProducts,
      auditLogs,
      stateSnapshots,
      savedReportDefinitionSchema: {
        safeParse: (v: unknown) => ({ success: true, data: v }),
      },
    }));

    vi.doMock("drizzle-orm", () => ({
      eq: (col: unknown, val: unknown) => ({ __op: "eq", col, val }),
      and: (...args: unknown[]) => ({ __op: "and", args }),
      gte: (col: unknown, val: unknown) => ({ __op: "gte", col, val }),
      desc: (c: unknown) => c,
      sql: Object.assign(() => "sql", { raw: () => "sql" }),
    }));

    vi.doMock("../lib/logger", () => ({
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
    }));

    vi.doMock("../lib/vertex-client", () => ({
      getGoogleGenAI: vi.fn(),
      VERTEX_MODEL: "gemini-test",
    }));

    class UnauthorizedTenantError extends Error {
      readonly httpStatus = 401 as const;
      readonly code = "UNAUTHORIZED" as const;
      constructor() { super("Authentication required"); this.name = "UnauthorizedTenantError"; }
    }
    vi.doMock("../middleware/rbac", () => ({
      getOrgId: (req: Request) => (req as unknown as { __orgId?: number }).__orgId ?? null,
      requireOrgId: (req: Request) => {
        const id = (req as unknown as { __orgId?: number }).__orgId;
        if (id == null) throw new UnauthorizedTenantError();
        return id;
      },
      UnauthorizedTenantError,
    }));

    reportsRouter = (await import("../routes/reports")).default as unknown as Router;
  });

  function makeReq(opts: {
    method: string;
    path: string;
    body?: Record<string, unknown>;
    params?: Record<string, string>;
  }): Request {
    return {
      headers: {},
      method: opts.method,
      originalUrl: `/api/reports${opts.path}`,
      body: opts.body ?? {},
      params: opts.params ?? {},
      query: {},
      // No __orgId → requireOrgId throws; getOrgId returns null.
      log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as unknown as Request["log"],
    } as unknown as Request;
  }

  it("POST /saved → 401 and never inserts a saved_reports row", async () => {
    const route = findRoute(reportsRouter, "POST", "/saved");
    const req = makeReq({ method: "POST", path: "/saved", body: { kind: "warehouse_kpis", filters: {} } });
    const res = makeRes();

    await runRoute(route, req, res);

    expect(res.statusCode).toBe(401);
    expect(inserted).toHaveLength(0);
  });

  it("GET /saved/:id → 401 and never reads from the database", async () => {
    const route = findRoute(reportsRouter, "GET", "/saved/:id");
    const req = makeReq({ method: "GET", path: `/saved/${VALID_UUID}`, params: { id: VALID_UUID } });
    const res = makeRes();

    await runRoute(route, req, res);

    expect(res.statusCode).toBe(401);
    expect(selected).toBe(0);
  });

  it("POST /export-csv → 401 and never reads from the database", async () => {
    const route = findRoute(reportsRouter, "POST", "/export-csv");
    // A valid UUID is required to clear the early reportId-shape guard so we
    // exercise the auth path (loadSavedReport → requireOrgId throws).
    const req = makeReq({ method: "POST", path: "/export-csv", body: { reportId: VALID_UUID } });
    const res = makeRes();

    await runRoute(route, req, res);

    expect(res.statusCode).toBe(401);
    expect(selected).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it("GET /shared-links → 401 and never reads from the database", async () => {
    const route = findRoute(reportsRouter, "GET", "/shared-links");
    const req = makeReq({ method: "GET", path: "/shared-links" });
    const res = makeRes();

    await runRoute(route, req, res);

    expect(res.statusCode).toBe(401);
    expect(selected).toBe(0);
  });

  it("PATCH /shared-links/:shareId/deactivate → 401 and never updates the row", async () => {
    const route = findRoute(reportsRouter, "PATCH", "/shared-links/:shareId/deactivate");
    const req = makeReq({
      method: "PATCH",
      path: "/shared-links/some-share-id/deactivate",
      params: { shareId: "some-share-id" },
    });
    const res = makeRes();

    await runRoute(route, req, res);

    expect(res.statusCode).toBe(401);
    expect(updated).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-06 — credential vault fail-closed
// ─────────────────────────────────────────────────────────────────────────────

describe("SEC-06 — credential-vault refuses to operate without DB_CREDENTIAL_ENCRYPTION_KEY", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    // Wipe the three vars the vault inspects so each case starts from a
    // pristine, deterministic environment.
    delete process.env.DB_CREDENTIAL_ENCRYPTION_KEY;
    delete process.env.NODE_ENV;
    delete process.env.SESSION_SECRET;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("encrypt() throws synchronously when DB_CREDENTIAL_ENCRYPTION_KEY is missing", async () => {
    const { encrypt } = await import("../lib/credential-vault");
    expect(() => encrypt("plaintext")).toThrow(/DB_CREDENTIAL_ENCRYPTION_KEY is required/);
  });

  it("decrypt() throws when both DB_CREDENTIAL_ENCRYPTION_KEY and NODE_ENV are unset (fail closed at boot)", async () => {
    const { decrypt } = await import("../lib/credential-vault");
    // Use a structurally-valid ciphertext shape so we exercise the key-resolution
    // path, not the malformed-input early return.
    expect(() => decrypt("aa:bb:cc")).toThrow(/must be set outside development\/test/);
  });

  it("decrypt() also throws under NODE_ENV=production even if SESSION_SECRET would otherwise serve as a legacy fallback", async () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "x".repeat(32);
    const { decrypt } = await import("../lib/credential-vault");
    expect(() => decrypt("aa:bb:cc")).toThrow(/must be set outside development\/test/);
  });

  it("encrypt() succeeds once DB_CREDENTIAL_ENCRYPTION_KEY is provided (positive control)", async () => {
    process.env.DB_CREDENTIAL_ENCRYPTION_KEY = "a".repeat(64);
    const { encrypt, decrypt } = await import("../lib/credential-vault");
    const ct = encrypt("hello");
    expect(decrypt(ct)).toBe("hello");
  });
});
