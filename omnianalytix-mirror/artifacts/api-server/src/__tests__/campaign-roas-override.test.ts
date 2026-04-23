/**
 * Tests for PUT /api/settings/economics/campaigns/:campaignId
 *
 * Covers:
 *   - Valid save    — manager auth + positive ROAS → 200 with updated economics
 *   - Null clear    — manager auth + null → 200, override removed from response
 *   - Out-of-range  — value of 0 or 101 → 400 INVALID_INPUT
 *   - Unauthenticated — no/invalid token → 403 RBAC_NO_IDENTITY
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction, Router } from "express";

// ── Express layer types ───────────────────────────────────────────────────────
interface ExpressLayer {
  route?: ExpressRoute;
  handle: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
}
interface ExpressRoute {
  path: string;
  methods: Record<string, boolean>;
  stack: ExpressLayer[];
}

// ── DB mock setup ─────────────────────────────────────────────────────────────

// Chainable select helper — awaitable at any step in the chain.
function makeSelectChain(result: unknown): unknown {
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  chain.from    = passthrough;
  chain.where   = passthrough;
  chain.limit   = passthrough;
  chain.orderBy = passthrough;
  (chain as { then: unknown }).then = (
    onFulfilled: (v: unknown) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
}

const dbSelectQueue: unknown[][] = [];
const mockDbSelect = vi.fn(() => makeSelectChain(dbSelectQueue.shift() ?? []));

// Chainable insert helper — .values() is awaitable and also exposes
// .onConflictDoUpdate() for the campaign-targets upsert path.
const mockDbInsertOnConflict = vi.fn().mockResolvedValue(undefined);
const mockDbInsertValues = vi.fn(() => {
  const obj: Record<string, unknown> = {};
  obj.onConflictDoUpdate = mockDbInsertOnConflict;
  (obj as { then: unknown }).then = (
    onFulfilled: (v: unknown) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => Promise.resolve(undefined).then(onFulfilled, onRejected);
  return obj;
});
const mockDbInsert = vi.fn(() => ({ values: mockDbInsertValues }));

const mockDbDeleteWhere = vi.fn().mockResolvedValue(undefined);
const mockDbDelete = vi.fn(() => ({ where: mockDbDeleteWhere }));

const mockDbUpdate = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) }));

vi.mock("@workspace/db", () => ({
  db: {
    select: (..._args: unknown[]) => mockDbSelect(),
    insert: (...args: any[]) => (mockDbInsert as any)(...args),
    delete: (...args: any[]) => (mockDbDelete as any)(...args),
    update: (...args: any[]) => (mockDbUpdate as any)(...args),
  },
  organizations: {
    id: "id",
    cogsPctDefault:    "cogsPctDefault",
    targetRoasDefault: "targetRoasDefault",
    aiMaxLookbackDays: "aiMaxLookbackDays",
    aiDailyRowCap:     "aiDailyRowCap",
  },
  campaignTargets: {
    organizationId: "organizationId",
    campaignId:     "campaignId",
    targetRoas:     "targetRoas",
    updatedAt:      "updatedAt",
  },
  auditLogs: { organizationId: "organizationId" },
  teamMembers: {},
}));

vi.mock("../lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../routes/auth/gate", () => ({
  verifyAnyToken: vi.fn(),
}));

vi.mock("../lib/ai-gads-usage", () => ({
  DEFAULT_MAX_LOOKBACK_DAYS: 90,
  DEFAULT_DAILY_ROW_CAP: 10000,
}));

vi.mock("../lib/route-error-handler", () => ({
  handleRouteError: vi.fn((_err, _req, res: Response, _path, fallback) => {
    res.status(500).json(fallback);
  }),
}));

// ── Import subject after mocks ────────────────────────────────────────────────
import settingsRouter from "../routes/settings/index";
import { verifyAnyToken } from "../routes/auth/gate";

// ── Helpers ───────────────────────────────────────────────────────────────────

function findRoute(method: string, path: string): ExpressRoute {
  const stack = (settingsRouter as unknown as Router & { stack: ExpressLayer[] }).stack;
  const layer = stack.find(
    (l) => l.route?.path === path && (l.route as unknown as ExpressRoute)?.methods[method.toLowerCase()],
  );
  if (!layer || !layer.route) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  return layer.route as unknown as ExpressRoute;
}

function makeReq(
  overrides: Partial<Request> & { body?: unknown; params?: Record<string, string> } = {},
): Request {
  return {
    headers: { authorization: "Bearer fake-token" },
    method: "PUT",
    originalUrl: "/api/settings/economics/campaigns/camp-001",
    body: {},
    params: { campaignId: "camp-001" },
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as Request["log"],
    ...overrides,
  } as unknown as Request;
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
  (res as unknown as Record<string, unknown>).send = vi.fn(() => res);
  return res;
}

async function runRoute(
  method: string,
  path: string,
  req: Request,
): Promise<{ statusCode: number; body: unknown }> {
  const route = findRoute(method, path);
  const res = makeRes();

  for (const layer of route.stack) {
    let advanced = false;
    await new Promise<void>((resolve) => {
      const result = layer.handle(req, res, () => {
        advanced = true;
        resolve();
      });
      if (result && typeof (result as Promise<void>).then === "function") {
        (result as Promise<void>).then(() => resolve(), () => resolve());
      } else if (!advanced) {
        setImmediate(() => resolve());
      }
    });
    if (!advanced) break;
  }

  return { statusCode: res.statusCode, body: res.body };
}

function mockManager() {
  (verifyAnyToken as ReturnType<typeof vi.fn>).mockReturnValue({
    memberId:       1,
    organizationId: 42,
    role:           "manager",
    name:           "Mgr User",
    email:          "mgr@example.com",
  });
}

function mockNoAuth() {
  (verifyAnyToken as ReturnType<typeof vi.fn>).mockReturnValue(null);
}

/** Queue two select results that loadEconomics() expects. */
function queueLoadEconomics(
  orgDefaults: { cogsPctDefault: number | null; targetRoasDefault: number } = { cogsPctDefault: null, targetRoasDefault: 4.0 },
  overrides: { campaignId: string; targetRoas: number }[] = [],
) {
  dbSelectQueue.push([orgDefaults]);
  dbSelectQueue.push(overrides);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PUT /economics/campaigns/:campaignId — campaign ROAS override", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbSelectQueue.length = 0;
    mockDbInsertOnConflict.mockResolvedValue(undefined);
    mockDbDeleteWhere.mockResolvedValue(undefined);
  });

  // ── Valid save ──────────────────────────────────────────────────────────────

  it("saves a valid ROAS override and returns updated economics", async () => {
    mockManager();
    queueLoadEconomics(
      { cogsPctDefault: 0.3, targetRoasDefault: 4.0 },
      [{ campaignId: "camp-001", targetRoas: 6.5 }],
    );

    const req = makeReq({ body: { targetRoas: 6.5 } });
    const { statusCode, body } = await runRoute("put", "/economics/campaigns/:campaignId", req);

    expect(statusCode).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b.cogsPct).toBe(0.3);
    expect(b.targetRoas).toBe(4.0);
    expect((b.campaignOverrides as Record<string, number>)["camp-001"]).toBe(6.5);
    expect(mockDbInsertOnConflict).toHaveBeenCalledTimes(1);
  });

  it("upserts with the supplied campaignId from req.params", async () => {
    mockManager();
    queueLoadEconomics();

    const req = makeReq({
      params: { campaignId: "my-campaign-xyz" },
      body:   { targetRoas: 3.0 },
      originalUrl: "/api/settings/economics/campaigns/my-campaign-xyz",
    });
    await runRoute("put", "/economics/campaigns/:campaignId", req);

    expect(mockDbInsert).toHaveBeenCalled();
    const insertedValues = (mockDbInsertValues.mock.calls[0] as unknown[])?.[0] as Record<string, unknown>;
    expect(insertedValues.campaignId).toBe("my-campaign-xyz");
    expect(insertedValues.targetRoas).toBe(3.0);
    expect(insertedValues.organizationId).toBe(42);
  });

  // ── Null clear ─────────────────────────────────────────────────────────────

  it("clears an override when targetRoas is null", async () => {
    mockManager();
    queueLoadEconomics(
      { cogsPctDefault: null, targetRoasDefault: 4.0 },
      [],
    );

    const req = makeReq({ body: { targetRoas: null } });
    const { statusCode, body } = await runRoute("put", "/economics/campaigns/:campaignId", req);

    expect(statusCode).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b.campaignOverrides).toEqual({});
    expect(mockDbDelete).toHaveBeenCalledTimes(1);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("scopes the delete to the caller's organizationId and campaignId", async () => {
    mockManager();
    queueLoadEconomics();

    const req = makeReq({
      params: { campaignId: "camp-to-clear" },
      body:   { targetRoas: null },
    });
    await runRoute("put", "/economics/campaigns/:campaignId", req);

    expect(mockDbDelete).toHaveBeenCalledTimes(1);
  });

  // ── Out-of-range validation ────────────────────────────────────────────────

  it("rejects targetRoas of 0 with 400 INVALID_INPUT", async () => {
    mockManager();

    const req = makeReq({ body: { targetRoas: 0 } });
    const { statusCode, body } = await runRoute("put", "/economics/campaigns/:campaignId", req);

    expect(statusCode).toBe(400);
    const b = body as Record<string, string>;
    expect(b.code).toBe("INVALID_INPUT");
    expect(mockDbInsert).not.toHaveBeenCalled();
    expect(mockDbDelete).not.toHaveBeenCalled();
  });

  it("rejects targetRoas of 101 with 400 INVALID_INPUT", async () => {
    mockManager();

    const req = makeReq({ body: { targetRoas: 101 } });
    const { statusCode, body } = await runRoute("put", "/economics/campaigns/:campaignId", req);

    expect(statusCode).toBe(400);
    const b = body as Record<string, string>;
    expect(b.code).toBe("INVALID_INPUT");
  });

  it("rejects a negative targetRoas with 400 INVALID_INPUT", async () => {
    mockManager();

    const req = makeReq({ body: { targetRoas: -1 } });
    const { statusCode, body } = await runRoute("put", "/economics/campaigns/:campaignId", req);

    expect(statusCode).toBe(400);
    expect((body as Record<string, string>).code).toBe("INVALID_INPUT");
  });

  it("rejects a non-numeric targetRoas with 400 INVALID_INPUT", async () => {
    mockManager();

    const req = makeReq({ body: { targetRoas: "high" } });
    const { statusCode, body } = await runRoute("put", "/economics/campaigns/:campaignId", req);

    expect(statusCode).toBe(400);
    expect((body as Record<string, string>).code).toBe("INVALID_INPUT");
  });

  // ── Unauthenticated ────────────────────────────────────────────────────────

  it("returns 403 RBAC_NO_IDENTITY when there is no valid token", async () => {
    mockNoAuth();

    const req = makeReq({ body: { targetRoas: 5.0 } });
    const { statusCode, body } = await runRoute("put", "/economics/campaigns/:campaignId", req);

    expect(statusCode).toBe(403);
    expect((body as Record<string, string>).code).toBe("RBAC_NO_IDENTITY");
    expect(mockDbInsert).not.toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: expect.anything() }),
    );
  });

  it("returns 403 for a viewer role (below manager threshold)", async () => {
    (verifyAnyToken as ReturnType<typeof vi.fn>).mockReturnValue({
      memberId:       2,
      organizationId: 42,
      role:           "viewer",
      name:           "View Only",
      email:          "view@example.com",
    });

    const req = makeReq({ body: { targetRoas: 5.0 } });
    const { statusCode, body } = await runRoute("put", "/economics/campaigns/:campaignId", req);

    expect(statusCode).toBe(403);
    expect((body as Record<string, string>).code).toBe("RBAC_INSUFFICIENT_ROLE");
  });

  it("returns 403 for an analyst role (below manager threshold)", async () => {
    (verifyAnyToken as ReturnType<typeof vi.fn>).mockReturnValue({
      memberId:       3,
      organizationId: 42,
      role:           "analyst",
      name:           "Analyst",
      email:          "analyst@example.com",
    });

    const req = makeReq({ body: { targetRoas: 5.0 } });
    const { statusCode } = await runRoute("put", "/economics/campaigns/:campaignId", req);

    expect(statusCode).toBe(403);
  });
});
