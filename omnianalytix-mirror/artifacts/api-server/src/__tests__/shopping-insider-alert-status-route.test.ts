/**
 * Route-level integration tests for GET /api/admin/shopping-insider-cache/alert-status
 * (Task #264)
 *
 * Strategy: mock `getShoppingInsiderAlertStatus` from the cost-alerter so
 * the handler can be exercised without a live singleton, BigQuery connection,
 * or Sentry DSN.  All four status shapes exercised by the unit tests are
 * also verified at the HTTP boundary to lock in the response envelope.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction, Router } from "express";

// ─── Hoisted mock factory ─────────────────────────────────────────────────────

const { getAlertStatusMock } = vi.hoisted(() => ({
  getAlertStatusMock: vi.fn(),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../lib/shopping-insider-cost-alerter", () => ({
  getShoppingInsiderAlertStatus: getAlertStatusMock,
}));

vi.mock("../lib/shopping-insider-cache", () => ({
  getCacheMetrics: vi.fn(async () => ({
    ttlMs: 3_600_000,
    cacheSize: 0,
    perFunction: {},
    totals: { hits: 0, misses: 0, bytesBilled: 0, bytesAvoided: 0, hitRate: null },
  })),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(async () => []),
        })),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
  },
  shoppingInsiderCostSamples: { __table: "shopping_insider_cost_samples" },
}));

vi.mock("drizzle-orm", () => ({
  desc: vi.fn((col: unknown) => ({ __desc: col })),
  eq: vi.fn(),
  and: vi.fn(),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import shoppingInsiderCacheRouter from "../routes/admin/shopping-insider-cache";

// ─── Route traversal helpers ──────────────────────────────────────────────────

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
  const stack = (router as unknown as { stack: ExpressLayer[] }).stack;
  const layer = stack.find(
    (l) => l.route?.path === path && l.route.methods[method.toLowerCase()],
  );
  if (!layer?.route) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  return layer.route as unknown as ExpressRoute;
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: "GET",
    originalUrl: "/api/admin/shopping-insider-cache/alert-status",
    headers: {},
    body: {},
    params: {},
    query: {},
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response & { statusCode: number; body: unknown } {
  const res = { statusCode: 200, body: null } as Response & {
    statusCode: number;
    body: unknown;
  };
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

async function callAlertStatus(): Promise<{ statusCode: number; body: unknown }> {
  const route = findRoute(
    shoppingInsiderCacheRouter as unknown as Router,
    "get",
    "/alert-status",
  );
  const req = makeReq();
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /alert-status — route handler", () => {
  beforeEach(() => {
    getAlertStatusMock.mockReset();
  });

  it("returns ok:true and the full AlertStatus envelope when no singleton exists", async () => {
    getAlertStatusMock.mockReturnValue({
      alerterEnabled: false,
      lastAlertKind: null,
      lastAlertAt: null,
      currentWindow: null,
    });

    const { statusCode, body } = await callAlertStatus();

    expect(statusCode).toBe(200);
    expect(body).toEqual({
      ok: true,
      alerterEnabled: false,
      lastAlertKind: null,
      lastAlertAt: null,
      currentWindow: null,
    });
  });

  it("returns ok:true with alerterEnabled=true and null window before first tick", async () => {
    getAlertStatusMock.mockReturnValue({
      alerterEnabled: true,
      lastAlertKind: null,
      lastAlertAt: null,
      currentWindow: null,
    });

    const { statusCode, body } = await callAlertStatus();

    expect(statusCode).toBe(200);
    const result = body as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(result.alerterEnabled).toBe(true);
    expect(result.currentWindow).toBeNull();
    expect(result.lastAlertKind).toBeNull();
    expect(result.lastAlertAt).toBeNull();
  });

  it("returns a populated currentWindow after a tick with no alert", async () => {
    const window = {
      windowMs: 1_000,
      hits: 10,
      misses: 2,
      bytesBilled: 500,
      bytesAvoided: 4_000,
      hitRate: 10 / 12,
    };
    getAlertStatusMock.mockReturnValue({
      alerterEnabled: true,
      lastAlertKind: null,
      lastAlertAt: null,
      currentWindow: window,
    });

    const { statusCode, body } = await callAlertStatus();

    expect(statusCode).toBe(200);
    const result = body as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(result.lastAlertKind).toBeNull();
    expect(result.lastAlertAt).toBeNull();
    expect(result.currentWindow).toMatchObject({
      bytesBilled: 500,
      hits: 10,
      misses: 2,
    });
  });

  it("surfaces lastAlertKind and lastAlertAt after a threshold breach", async () => {
    const window = {
      windowMs: 1_000,
      hits: 0,
      misses: 0,
      bytesBilled: 9_000,
      bytesAvoided: 0,
      hitRate: null,
    };
    getAlertStatusMock.mockReturnValue({
      alerterEnabled: true,
      lastAlertKind: "bytes_billed_spike",
      lastAlertAt: 1_716_000_000_000,
      currentWindow: window,
    });

    const { statusCode, body } = await callAlertStatus();

    expect(statusCode).toBe(200);
    const result = body as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(result.alerterEnabled).toBe(true);
    expect(result.lastAlertKind).toBe("bytes_billed_spike");
    expect(result.lastAlertAt).toBe(1_716_000_000_000);
    expect((result.currentWindow as Record<string, unknown>).bytesBilled).toBe(9_000);
  });

  it("calls getShoppingInsiderAlertStatus exactly once per request", async () => {
    getAlertStatusMock.mockReturnValue({
      alerterEnabled: false,
      lastAlertKind: null,
      lastAlertAt: null,
      currentWindow: null,
    });

    await callAlertStatus();

    expect(getAlertStatusMock).toHaveBeenCalledTimes(1);
  });
});
