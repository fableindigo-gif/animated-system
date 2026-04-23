/**
 * Route-level tests for GET /api/connections/google/health.
 *
 * Verifies that the handler:
 *   - aggregates per-platform health results from `probeGoogleConnectionHealth`
 *   - returns the expected `{ checkedAt, platforms }` shape
 *   - surfaces needs_reconnect / not_connected statuses correctly
 *   - returns HTTP 500 when the probe throws unexpectedly
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction, Router } from "express";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { probeHealthMock } = vi.hoisted(() => ({
  probeHealthMock: vi.fn(),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  platformConnections: {
    id: "id",
    platform: "platform",
    organizationId: "organizationId",
    isActive: "isActive",
    displayName: "displayName",
    credentials: "credentials",
    createdAt: "createdAt",
  },
  auditLogs: { organizationId: "organizationId" },
  teamMembers: { id: "id" },
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/credential-helpers", () => ({
  decryptCredentials: (c: unknown) => c,
  encryptCredentials: (c: unknown) => c,
}));

vi.mock("../lib/platform-fetchers", () => ({
  fetchPlatformData: vi.fn(),
  formatPlatformDataForAgent: vi.fn(),
}));

vi.mock("@workspace/api-zod", () => ({
  CreateConnectionBody: { safeParse: vi.fn(() => ({ success: false })) },
  DeleteConnectionParams: { safeParse: vi.fn((v: unknown) => ({ success: true, data: v })) },
  TestConnectionParams: { safeParse: vi.fn((v: unknown) => ({ success: true, data: v })) },
}));

vi.mock("../routes/auth/gate", () => ({
  verifyAnyToken: vi.fn(),
}));

vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    setCredentials = vi.fn();
    on = vi.fn();
    refreshAccessToken = vi.fn();
  },
}));

// Replace the probe with a controllable mock; spread the rest of the module so
// WORKSPACE_PLATFORMS and other exports remain available to the route handler.
vi.mock("../lib/google-workspace-oauth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/google-workspace-oauth")>();
  return { ...actual, probeGoogleConnectionHealth: probeHealthMock };
});

process.env.GOOGLE_ADS_CLIENT_ID = "test-client-id";
process.env.GOOGLE_ADS_CLIENT_SECRET = "test-client-secret";

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { verifyAnyToken } from "../routes/auth/gate";
import connectionsRouter from "../routes/connections";

// ─── Express route traversal helpers ─────────────────────────────────────────

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
    headers: { authorization: "Bearer test-token" },
    method: "GET",
    originalUrl: "/api/connections/google/health",
    body: {},
    params: {},
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as Request["log"],
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response & { statusCode: number; body: unknown } {
  const res = { statusCode: 200, body: null } as Response & { statusCode: number; body: unknown };
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
  const route = findRoute(connectionsRouter as unknown as Router, method, path);
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

describe("GET /api/connections/google/health — route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (verifyAnyToken as ReturnType<typeof vi.fn>).mockReturnValue({
      memberId: 1,
      organizationId: 10,
      role: "admin",
      name: "Test Admin",
      email: "admin@test.com",
    });
  });

  it("returns 200 with checkedAt ISO timestamp and per-platform results when all platforms are healthy", async () => {
    probeHealthMock.mockResolvedValue({ status: "healthy" });

    const { statusCode, body } = await runRoute("get", "/google/health", makeReq());

    expect(statusCode).toBe(200);
    const result = body as { checkedAt: string; platforms: Record<string, { status: string }> };
    expect(result).toHaveProperty("checkedAt");
    expect(new Date(result.checkedAt).toISOString()).toBe(result.checkedAt);
    expect(result.platforms).toMatchObject({
      google_calendar: { status: "healthy" },
      google_drive: { status: "healthy" },
      google_docs: { status: "healthy" },
    });
  });

  it("surfaces needs_reconnect for a platform whose refresh token is revoked", async () => {
    probeHealthMock.mockImplementation(async (platform: string) => {
      if (platform === "google_drive") {
        return { status: "needs_reconnect", errorCode: "invalid_grant", httpStatus: 400 };
      }
      return { status: "healthy" };
    });

    const { statusCode, body } = await runRoute("get", "/google/health", makeReq());

    expect(statusCode).toBe(200);
    const result = body as { platforms: Record<string, object> };
    expect(result.platforms.google_calendar).toEqual({ status: "healthy" });
    expect(result.platforms.google_drive).toMatchObject({
      status: "needs_reconnect",
      errorCode: "invalid_grant",
      httpStatus: 400,
    });
    expect(result.platforms.google_docs).toEqual({ status: "healthy" });
  });

  it("surfaces not_connected for platforms with no stored connection", async () => {
    probeHealthMock.mockResolvedValue({ status: "not_connected" });

    const { statusCode, body } = await runRoute("get", "/google/health", makeReq());

    expect(statusCode).toBe(200);
    const result = body as { platforms: Record<string, object> };
    expect(result.platforms.google_calendar).toEqual({ status: "not_connected" });
    expect(result.platforms.google_drive).toEqual({ status: "not_connected" });
    expect(result.platforms.google_docs).toEqual({ status: "not_connected" });
  });

  it("returns HTTP 500 when the probe throws an unexpected error", async () => {
    probeHealthMock.mockRejectedValue(new Error("DB connection lost"));

    const { statusCode, body } = await runRoute("get", "/google/health", makeReq());

    expect(statusCode).toBe(500);
    expect((body as Record<string, string>).error).toMatch(/probe/i);
  });
});
