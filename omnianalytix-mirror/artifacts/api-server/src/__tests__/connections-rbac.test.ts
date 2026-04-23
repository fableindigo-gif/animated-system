/**
 * SEC-01 / SEC-02 — Regression tests for connections RBAC.
 *
 * Verifies that the mutating routes on `/api/connections` (create / delete /
 * credential rotation) require admin role at the route level, in addition to
 * the router-level readGuard("viewer", "manager"). A non-admin (e.g. analyst,
 * viewer) must receive HTTP 403 even if they are otherwise authenticated.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction, Router } from "express";

// Express does not export `Layer` / `Route` types publicly; declare the minimal
// shape we need to traverse `router.stack` in tests.
interface ExpressLayer {
  route?: ExpressRoute;
  handle: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
}
interface ExpressRoute {
  path: string;
  methods: Record<string, boolean>;
  stack: ExpressLayer[];
}

// ── Mock heavy dependencies before importing the subject ──────────────────────
vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
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
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../routes/auth/gate", () => ({
  verifyAnyToken: vi.fn(),
}));

vi.mock("../lib/platform-fetchers", () => ({
  fetchPlatformData: vi.fn(),
  formatPlatformDataForAgent: vi.fn(),
}));

vi.mock("../lib/credential-helpers", () => ({
  decryptCredentials: (x: unknown) => x,
  encryptCredentials: (x: unknown) => x,
}));

vi.mock("@workspace/api-zod", () => ({
  CreateConnectionBody: { safeParse: vi.fn(() => ({ success: true, data: { platform: "shopify", displayName: "shop", credentials: {} } })) },
  DeleteConnectionParams: { safeParse: vi.fn((v: { id: number }) => ({ success: true, data: v })) },
  TestConnectionParams: { safeParse: vi.fn((v: { id: number }) => ({ success: true, data: v })) },
}));

// ── Import subject AFTER mocks ────────────────────────────────────────────────
import connectionsRouter from "../routes/connections";

// ── Helpers ───────────────────────────────────────────────────────────────────

function findRoute(method: string, path: string): ExpressRoute {
  // Express stores routes on router.stack — each layer.route is the registered route.
  const stack = (connectionsRouter as unknown as Router & { stack: ExpressLayer[] }).stack;
  const layer = stack.find((l) => l.route?.path === path && (l.route as unknown as ExpressRoute)?.methods[method.toLowerCase()]);
  if (!layer || !layer.route) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  return layer.route as unknown as ExpressRoute;
}

function makeReq(role: string | null): Request {
  return {
    headers: { authorization: role ? `Bearer fake-${role}-token` : undefined },
    method: "POST",
    originalUrl: "/api/connections",
    body: { platform: "shopify", displayName: "shop", credentials: {} },
    params: { id: "1" },
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as Request["log"],
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

// Run an entire route's middleware chain (admin-guard + handler) to completion.
async function runRoute(method: string, path: string, role: string | null): Promise<{ statusCode: number; body: unknown }> {
  const route = findRoute(method, path);
  const req = makeReq(role);
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
        // Sync handler that didn't call next(): treat as terminal (handler responded).
        setImmediate(() => resolve());
      }
    });
    if (!advanced) break; // Middleware short-circuited (sent response).
  }

  return { statusCode: res.statusCode, body: res.body };
}

// ── Mock the JWT verifier to return a payload of our choosing ─────────────────

import { verifyAnyToken } from "../routes/auth/gate";

function mockRole(role: "viewer" | "analyst" | "manager" | "admin" | "super_admin" | null) {
  if (role === null) {
    (verifyAnyToken as ReturnType<typeof vi.fn>).mockReturnValue(null);
    return;
  }
  (verifyAnyToken as ReturnType<typeof vi.fn>).mockReturnValue({
    memberId: 1,
    organizationId: 42,
    role,
    name: "Test User",
    email: "test@example.com",
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SEC-01/SEC-02 — connections mutating routes require admin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects POST /  for an analyst (non-admin) with 403", async () => {
    mockRole("analyst");
    const { statusCode, body } = await runRoute("post", "/", "analyst");
    expect(statusCode).toBe(403);
    expect((body as Record<string, string>).code).toMatch(/RBAC_/);
  });

  it("rejects POST /  for a viewer with 403", async () => {
    mockRole("viewer");
    const { statusCode } = await runRoute("post", "/", "viewer");
    expect(statusCode).toBe(403);
  });

  it("rejects POST /  for a manager with 403 (manager < admin)", async () => {
    mockRole("manager");
    const { statusCode } = await runRoute("post", "/", "manager");
    expect(statusCode).toBe(403);
  });

  it("rejects POST /  with no auth at all (403, no identity)", async () => {
    mockRole(null);
    const { statusCode, body } = await runRoute("post", "/", null);
    expect(statusCode).toBe(403);
    expect((body as Record<string, string>).code).toBe("RBAC_NO_IDENTITY");
  });

  it("rejects DELETE /:id for an analyst (non-admin) with 403", async () => {
    mockRole("analyst");
    const { statusCode } = await runRoute("delete", "/:id", "analyst");
    expect(statusCode).toBe(403);
  });

  it("rejects PATCH /google-ads/customer-id for an analyst with 403", async () => {
    mockRole("analyst");
    const { statusCode } = await runRoute("patch", "/google-ads/customer-id", "analyst");
    expect(statusCode).toBe(403);
  });

  it("rejects PATCH /google-ads/ga4-property-id for an analyst with 403", async () => {
    mockRole("analyst");
    const { statusCode } = await runRoute("patch", "/google-ads/ga4-property-id", "analyst");
    expect(statusCode).toBe(403);
  });
});
