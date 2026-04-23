/**
 * Route-level integration tests — PATCH /api/ai-agents/sessions/:id
 *                                  GET  /api/ai-agents/sessions
 *
 * Covers:
 *   • PATCH — request validation (empty body, wrong types) → 400
 *   • PATCH — unauthenticated             → 401
 *   • PATCH — session not found / cross-user → 404
 *   • PATCH — rename, pin, archive (happy paths) → 200
 *   • GET   — unauthenticated             → 401
 *   • GET   — archived query param parsing (?archived=1 / ?archived=true / absent)
 *
 * Uses a real Express server on an ephemeral port.
 * adk-agent service is fully stubbed; no DB required.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// ── Mock heavy dependencies BEFORE importing the router ───────────────────────

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock("multer", () => {
  const noop = (_req: unknown, _res: unknown, next: () => void) => next();
  const multer = () => ({ single: () => noop, array: () => noop, none: () => noop, any: () => noop, fields: () => noop });
  multer.memoryStorage = () => ({});
  multer.diskStorage   = () => ({});
  return { default: multer };
});

vi.mock("stripe", () => {
  class Stripe { constructor(_key: unknown, _opts: unknown) {} }
  return { default: Stripe };
});

vi.mock("@workspace/db", () => {
  const tbl = new Proxy({}, { get: (_t, p) => ({ name: String(p) }) });
  return {
    db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), execute: vi.fn() },
    aiAgents:    tbl,
    kbDocuments: tbl,
    kbChunks:    tbl,
    adkSessions: tbl,
  };
});

vi.mock("drizzle-orm", () => ({
  eq:     vi.fn(),
  and:    vi.fn(),
  desc:   vi.fn(),
  asc:    vi.fn(),
  sql:    Object.assign(vi.fn(), { raw: vi.fn() }),
  isNull: vi.fn(),
  lt:     vi.fn(),
  lte:    vi.fn(),
  gte:    vi.fn(),
  ne:     vi.fn(),
}));

vi.mock("../lib/tenant-guards", () => ({
  assertOwnsAgent:       vi.fn(),
  TenantOwnershipError:  class TenantOwnershipError extends Error { readonly httpStatus = 404; readonly code = "NOT_FOUND"; readonly resource = ""; readonly id = 0; },
}));

// ── adk-agent service stubs ───────────────────────────────────────────────────

const updateAdkSessionMock = vi.fn();
const listAdkSessionsMock  = vi.fn();
const getAdkSessionMock    = vi.fn();
const runAdkAgentMock      = vi.fn();
const deleteAdkSessionMock = vi.fn();

vi.mock("../services/adk-agent", () => ({
  APP_NAME:          "omnianalytix-adk",
  updateAdkSession:  (...args: unknown[]) => updateAdkSessionMock(...args),
  listAdkSessions:   (...args: unknown[]) => listAdkSessionsMock(...args),
  getAdkSession:     (...args: unknown[]) => getAdkSessionMock(...args),
  runAdkAgent:       (...args: unknown[]) => runAdkAgentMock(...args),
  deleteAdkSession:  (...args: unknown[]) => deleteAdkSessionMock(...args),
  AdkConfigError:    class AdkConfigError  extends Error {},
  AdkRunError:       class AdkRunError     extends Error {},
}));

// ── Server setup ──────────────────────────────────────────────────────────────

// Auth state: set per-test. When null → unauthenticated.
let currentUser: { orgId: number; memberId: number } | null = { orgId: 42, memberId: 1 };

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { default: aiAgentsRouter } = await import("../routes/ai-agents/index");

  const app = express();
  app.use(express.json());

  // Inject fake auth into req so requireOrgId + adkUserIdFor work
  app.use((req: any, _res, next) => {
    if (currentUser) {
      req.rbacUser = { organizationId: currentUser.orgId, id: currentUser.memberId, role: "admin" };
    }
    next();
  });

  app.use("/api/ai-agents", aiAgentsRouter);

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
  currentUser = { orgId: 42, memberId: 1 };
  updateAdkSessionMock.mockReset();
  listAdkSessionsMock.mockReset();
  getAdkSessionMock.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/ai-agents/sessions/:sessionId
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_ID  = "sess-abc";
const FAKE_SESSION = {
  sessionId:  SESSION_ID,
  title:      "Renamed",
  pinned:     false,
  archived:   false,
  eventCount: 2,
  createdAt:  "2026-04-17T00:00:00.000Z",
  updatedAt:  "2026-04-17T00:00:00.000Z",
  messages:   [],
};

function patch(id: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/api/ai-agents/sessions/${id}`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json", ...headers },
    body:    JSON.stringify(body),
  });
}

describe("PATCH /api/ai-agents/sessions/:sessionId — auth", () => {
  it("returns 401 when unauthenticated", async () => {
    currentUser = null;
    const res = await patch(SESSION_ID, { title: "X" });
    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.code).toBeDefined();
  });
});

describe("PATCH /api/ai-agents/sessions/:sessionId — validation", () => {
  it("returns 400 when body has no recognised fields", async () => {
    const res = await patch(SESSION_ID, { unrelated: "value" });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when body is empty object", async () => {
    const res = await patch(SESSION_ID, {});
    expect(res.status).toBe(400);
    expect((await res.json() as any).code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when pinned is not a boolean", async () => {
    const res = await patch(SESSION_ID, { pinned: "yes" });
    expect(res.status).toBe(400);
    expect((await res.json() as any).code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when title is a number (not string/null)", async () => {
    const res = await patch(SESSION_ID, { title: 42 });
    expect(res.status).toBe(400);
    expect((await res.json() as any).code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when archived is not a boolean", async () => {
    const res = await patch(SESSION_ID, { archived: "true" });
    expect(res.status).toBe(400);
    expect((await res.json() as any).code).toBe("VALIDATION_ERROR");
  });
});

describe("PATCH /api/ai-agents/sessions/:sessionId — not found / isolation", () => {
  it("returns 404 when the session does not exist", async () => {
    updateAdkSessionMock.mockResolvedValue(null);
    const res = await patch("nonexistent-id", { title: "Oops" });
    expect(res.status).toBe(404);
    expect((await res.json() as any).code).toBe("NOT_FOUND");
  });

  it("returns 404 when session belongs to a different user (tenant isolation)", async () => {
    // Service returns null — same behaviour as not-found from route perspective
    updateAdkSessionMock.mockResolvedValue(null);
    const res = await patch("other-user-sess", { pinned: true });
    expect(res.status).toBe(404);
  });

  it("passes the caller's adkUserId to updateAdkSession (not another user's)", async () => {
    updateAdkSessionMock.mockResolvedValue(FAKE_SESSION);
    await patch(SESSION_ID, { pinned: true });
    const [userId] = updateAdkSessionMock.mock.calls[0];
    // Must be scoped to org:42:user:1
    expect(userId).toBe("org:42:user:1");
  });
});

describe("PATCH /api/ai-agents/sessions/:sessionId — happy paths", () => {
  it("returns 200 with the updated session when renaming (title)", async () => {
    updateAdkSessionMock.mockResolvedValue({ ...FAKE_SESSION, title: "My Report" });
    const res = await patch(SESSION_ID, { title: "My Report" });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.session.title).toBe("My Report");
    expect(body.session.sessionId).toBe(SESSION_ID);
  });

  it("returns 200 and calls updateAdkSession with { title } only", async () => {
    updateAdkSessionMock.mockResolvedValue(FAKE_SESSION);
    await patch(SESSION_ID, { title: "New Name" });
    const [, , patchArg] = updateAdkSessionMock.mock.calls[0];
    expect(patchArg).toEqual({ title: "New Name" });
  });

  it("returns 200 with the updated session when pinning", async () => {
    updateAdkSessionMock.mockResolvedValue({ ...FAKE_SESSION, pinned: true });
    const res = await patch(SESSION_ID, { pinned: true });
    expect(res.status).toBe(200);
    expect((await res.json() as any).session.pinned).toBe(true);
  });

  it("returns 200 and calls updateAdkSession with { pinned } only", async () => {
    updateAdkSessionMock.mockResolvedValue(FAKE_SESSION);
    await patch(SESSION_ID, { pinned: false });
    const [, , patchArg] = updateAdkSessionMock.mock.calls[0];
    expect(patchArg).toEqual({ pinned: false });
  });

  it("returns 200 with the updated session when archiving", async () => {
    updateAdkSessionMock.mockResolvedValue({ ...FAKE_SESSION, archived: true });
    const res = await patch(SESSION_ID, { archived: true });
    expect(res.status).toBe(200);
    expect((await res.json() as any).session.archived).toBe(true);
  });

  it("returns 200 and calls updateAdkSession with { archived } only", async () => {
    updateAdkSessionMock.mockResolvedValue(FAKE_SESSION);
    await patch(SESSION_ID, { archived: false });
    const [, , patchArg] = updateAdkSessionMock.mock.calls[0];
    expect(patchArg).toEqual({ archived: false });
  });

  it("accepts null title to clear the session name", async () => {
    updateAdkSessionMock.mockResolvedValue(FAKE_SESSION);
    const res = await patch(SESSION_ID, { title: null });
    expect(res.status).toBe(200);
    const [, , patchArg] = updateAdkSessionMock.mock.calls[0];
    expect(patchArg).toEqual({ title: null });
  });

  it("accepts all three fields in one request", async () => {
    updateAdkSessionMock.mockResolvedValue(FAKE_SESSION);
    const res = await patch(SESSION_ID, { title: "All", pinned: true, archived: true });
    expect(res.status).toBe(200);
    const [, , patchArg] = updateAdkSessionMock.mock.calls[0];
    expect(patchArg).toEqual({ title: "All", pinned: true, archived: true });
  });

  it("passes the correct sessionId to updateAdkSession", async () => {
    updateAdkSessionMock.mockResolvedValue(FAKE_SESSION);
    await patch("target-session-123", { pinned: true });
    const [, sessionId] = updateAdkSessionMock.mock.calls[0];
    expect(sessionId).toBe("target-session-123");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai-agents/sessions — archived query param parsing
// ─────────────────────────────────────────────────────────────────────────────

const FAKE_LIST = { sessions: [], total: 0, hasMore: false };

function getList(query = "") {
  return fetch(`${baseUrl}/api/ai-agents/sessions${query ? `?${query}` : ""}`);
}

describe("GET /api/ai-agents/sessions — auth", () => {
  it("returns 401 when unauthenticated", async () => {
    currentUser = null;
    const res = await getList();
    expect(res.status).toBe(401);
  });
});

describe("GET /api/ai-agents/sessions — archived filter", () => {
  it("calls listAdkSessions with includeArchived=false by default", async () => {
    listAdkSessionsMock.mockResolvedValue(FAKE_LIST);
    const res = await getList();
    expect(res.status).toBe(200);
    const [, opts] = listAdkSessionsMock.mock.calls[0];
    expect(opts.includeArchived).toBe(false);
  });

  it("calls listAdkSessions with includeArchived=true when ?archived=1", async () => {
    listAdkSessionsMock.mockResolvedValue(FAKE_LIST);
    const res = await getList("archived=1");
    expect(res.status).toBe(200);
    const [, opts] = listAdkSessionsMock.mock.calls[0];
    expect(opts.includeArchived).toBe(true);
  });

  it("calls listAdkSessions with includeArchived=true when ?archived=true", async () => {
    listAdkSessionsMock.mockResolvedValue(FAKE_LIST);
    const res = await getList("archived=true");
    expect(res.status).toBe(200);
    const [, opts] = listAdkSessionsMock.mock.calls[0];
    expect(opts.includeArchived).toBe(true);
  });

  it("passes the caller's adkUserId to listAdkSessions", async () => {
    listAdkSessionsMock.mockResolvedValue(FAKE_LIST);
    await getList();
    const [userId] = listAdkSessionsMock.mock.calls[0];
    expect(userId).toBe("org:42:user:1");
  });

  it("returns the sessions payload from listAdkSessions", async () => {
    const payload = {
      sessions: [{ sessionId: "s1", title: "Chat 1", pinned: false, archived: false, eventCount: 1, createdAt: "2026-04-17T00:00:00.000Z", updatedAt: "2026-04-17T00:00:00.000Z" }],
      total: 1,
      hasMore: false,
    };
    listAdkSessionsMock.mockResolvedValue(payload);
    const res = await getList();
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].sessionId).toBe("s1");
    expect(body.total).toBe(1);
  });
});
