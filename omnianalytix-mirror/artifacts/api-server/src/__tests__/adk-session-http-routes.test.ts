/**
 * Route-level integration tests — ADK session HTTP layer
 *
 *   GET    /api/ai-agents/sessions
 *   GET    /api/ai-agents/sessions/:sessionId
 *   DELETE /api/ai-agents/sessions/:sessionId
 *
 * Covers the HTTP status codes returned by the route layer (not the service
 * layer, which is covered by adk-session-isolation.test.ts):
 *   • Unauthenticated requests          → 401
 *   • Cross-user access (same org)      → 404   (not 200 or 403)
 *   • Cross-org access  (same memberId) → 404
 *   • Authenticated owner               → 200
 *
 * Uses Supertest (request(app)) against a real Express app; adk-agent
 * service is fully stubbed — no DB required.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── Stub heavy dependencies BEFORE the router is imported ────────────────────

vi.mock("../lib/logger", () => ({
  logger: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

vi.mock("multer", () => {
  const noop = (_req: Request, _res: Response, next: NextFunction) => next();
  const multer = () => ({
    single:  () => noop,
    array:   () => noop,
    none:    () => noop,
    any:     () => noop,
    fields:  () => noop,
  });
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
    db:          { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), execute: vi.fn() },
    aiAgents:    tbl,
    kbDocuments: tbl,
    kbChunks:    tbl,
    adkSessions: tbl,
  };
});

vi.mock("drizzle-orm", () => ({
  eq:      vi.fn(),
  and:     vi.fn(),
  desc:    vi.fn(),
  asc:     vi.fn(),
  sql:     Object.assign(vi.fn(), { raw: vi.fn() }),
  isNull:  vi.fn(),
  lt:      vi.fn(),
  lte:     vi.fn(),
  gte:     vi.fn(),
  ne:      vi.fn(),
  or:      vi.fn(),
  ilike:   vi.fn(),
  inArray: vi.fn(),
}));

vi.mock("../lib/tenant-guards", () => ({
  assertOwnsAgent:      vi.fn(),
  TenantOwnershipError: class TenantOwnershipError extends Error {
    readonly httpStatus = 404;
    readonly code       = "NOT_FOUND";
    readonly resource   = "";
    readonly id         = 0;
  },
}));

// ── Service-layer stubs ───────────────────────────────────────────────────────

const listAdkSessionsMock          = vi.fn();
const getAdkSessionMock            = vi.fn();
const deleteAdkSessionMock         = vi.fn();
const resolveAdkSessionMissReasonMock = vi.fn();
const updateAdkSessionMock         = vi.fn();
const runAdkAgentMock              = vi.fn();

vi.mock("../services/adk-agent", () => ({
  APP_NAME:                    "omnianalytix-adk",
  listAdkSessions:             (...args: unknown[]) => listAdkSessionsMock(...args),
  getAdkSession:               (...args: unknown[]) => getAdkSessionMock(...args),
  deleteAdkSession:            (...args: unknown[]) => deleteAdkSessionMock(...args),
  resolveAdkSessionMissReason: (...args: unknown[]) => resolveAdkSessionMissReasonMock(...args),
  updateAdkSession:            (...args: unknown[]) => updateAdkSessionMock(...args),
  runAdkAgent:                 (...args: unknown[]) => runAdkAgentMock(...args),
  AdkConfigError:              class AdkConfigError extends Error {},
  AdkRunError:                 class AdkRunError    extends Error {},
}));

// ── Typed response shapes ─────────────────────────────────────────────────────

interface ErrorBody {
  error: string;
  code:  string;
}

interface SessionSummary {
  sessionId:  string;
  title:      string;
  pinned:     boolean;
  archived:   boolean;
  eventCount: number;
  createdAt:  string;
  updatedAt:  string;
}

interface SessionDetail extends SessionSummary {
  messages: unknown[];
}

interface ListSessionsBody {
  sessions: SessionSummary[];
  total:    number;
  hasMore:  boolean;
}

interface GetSessionBody {
  session: SessionDetail;
}

interface DeleteSessionBody {
  deleted: boolean;
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const SESSION_ID = "sess-test-001";

const FAKE_SUMMARY: SessionSummary = {
  sessionId:  SESSION_ID,
  title:      "Test session",
  pinned:     false,
  archived:   false,
  eventCount: 3,
  createdAt:  "2026-04-01T00:00:00.000Z",
  updatedAt:  "2026-04-01T00:00:00.000Z",
};

const FAKE_DETAIL: SessionDetail = {
  ...FAKE_SUMMARY,
  messages: [],
};

const FAKE_LIST: ListSessionsBody = {
  sessions: [FAKE_SUMMARY],
  total:    1,
  hasMore:  false,
};

// ── Express test app ──────────────────────────────────────────────────────────

// Set per-test. null → unauthenticated (no rbacUser on request).
let currentUser: { orgId: number; memberId: number } | null = { orgId: 10, memberId: 1 };

let app: Express;

beforeAll(async () => {
  const { default: aiAgentsRouter } = await import("../routes/ai-agents/index");

  app = express();
  app.use(express.json());

  // Inject fake auth: mirrors what the real RBAC middleware sets on req.
  // req.rbacUser is globally augmented by src/middleware/rbac.ts — the
  // shape is known and all required fields are provided explicitly.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (currentUser) {
      req.rbacUser = {
        id:             currentUser.memberId,
        organizationId: currentUser.orgId,
        name:           "test-user",
        email:          "test@example.com",
        role:           "admin" as const,
      };
    }
    next();
  });

  app.use("/api/ai-agents", aiAgentsRouter);
});

beforeEach(() => {
  currentUser = { orgId: 10, memberId: 1 };
  listAdkSessionsMock.mockReset();
  getAdkSessionMock.mockReset();
  deleteAdkSessionMock.mockReset();
  resolveAdkSessionMissReasonMock.mockReset().mockResolvedValue("not_found");
  updateAdkSessionMock.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai-agents/sessions — list
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/ai-agents/sessions", () => {
  it("returns 401 when the request is unauthenticated", async () => {
    currentUser = null;
    const res = await request(app).get("/api/ai-agents/sessions");
    expect(res.status).toBe(401);
    // Route may emit AUTH_REQUIRED (adkUserIdFor guard) or UNAUTHORIZED
    // (requireOrgId guard) — both are acceptable; the contract is HTTP 401.
    const body = res.body as ErrorBody;
    expect(body.code).toBeDefined();
  });

  it("returns 200 with session list for an authenticated user", async () => {
    listAdkSessionsMock.mockResolvedValue(FAKE_LIST);
    const res = await request(app).get("/api/ai-agents/sessions");
    expect(res.status).toBe(200);
    const body = res.body as ListSessionsBody;
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].sessionId).toBe(SESSION_ID);
  });

  it("passes the org-scoped ADK userId (org:{orgId}:user:{memberId}) to listAdkSessions", async () => {
    listAdkSessionsMock.mockResolvedValue(FAKE_LIST);
    await request(app).get("/api/ai-agents/sessions");
    expect(listAdkSessionsMock).toHaveBeenCalledWith("org:10:user:1", expect.any(Object));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai-agents/sessions/:sessionId — fetch single
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/ai-agents/sessions/:sessionId", () => {
  it("returns 401 when the request is unauthenticated", async () => {
    currentUser = null;
    const res = await request(app).get(`/api/ai-agents/sessions/${SESSION_ID}`);
    expect(res.status).toBe(401);
    const body = res.body as ErrorBody;
    expect(body.code).toBeDefined();
  });

  it("returns 200 with session detail for the authenticated owner", async () => {
    getAdkSessionMock.mockResolvedValue(FAKE_DETAIL);
    const res = await request(app).get(`/api/ai-agents/sessions/${SESSION_ID}`);
    expect(res.status).toBe(200);
    const body = res.body as GetSessionBody;
    expect(body.session.sessionId).toBe(SESSION_ID);
  });

  it("returns 404 when a different member of the same org tries to fetch the session", async () => {
    getAdkSessionMock.mockResolvedValue(null);
    resolveAdkSessionMissReasonMock.mockResolvedValue("ownership_mismatch");
    currentUser = { orgId: 10, memberId: 99 };
    const res = await request(app).get(`/api/ai-agents/sessions/${SESSION_ID}`);
    expect(res.status).toBe(404);
    const body = res.body as ErrorBody;
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 404 — not 403 or 200 — for cross-user access", async () => {
    getAdkSessionMock.mockResolvedValue(null);
    resolveAdkSessionMissReasonMock.mockResolvedValue("ownership_mismatch");
    currentUser = { orgId: 10, memberId: 99 };
    const res = await request(app).get(`/api/ai-agents/sessions/${SESSION_ID}`);
    // Must be 404 — not 403 (that would reveal the session exists)
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(200);
    expect(res.status).toBe(404);
  });

  it("returns 404 when the same memberId accesses a session owned by a different org", async () => {
    getAdkSessionMock.mockResolvedValue(null);
    resolveAdkSessionMissReasonMock.mockResolvedValue("not_found");
    currentUser = { orgId: 999, memberId: 1 };
    const res = await request(app).get(`/api/ai-agents/sessions/${SESSION_ID}`);
    expect(res.status).toBe(404);
    const body = res.body as ErrorBody;
    expect(body.code).toBe("NOT_FOUND");
  });

  it("calls getAdkSession with the full org-scoped userId, not just memberId", async () => {
    getAdkSessionMock.mockResolvedValue(FAKE_DETAIL);
    await request(app).get(`/api/ai-agents/sessions/${SESSION_ID}`);
    expect(getAdkSessionMock).toHaveBeenCalledWith("org:10:user:1", SESSION_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/ai-agents/sessions/:sessionId
// ─────────────────────────────────────────────────────────────────────────────

describe("DELETE /api/ai-agents/sessions/:sessionId", () => {
  it("returns 401 when the request is unauthenticated", async () => {
    currentUser = null;
    const res = await request(app).delete(`/api/ai-agents/sessions/${SESSION_ID}`);
    expect(res.status).toBe(401);
    const body = res.body as ErrorBody;
    expect(body.code).toBeDefined();
  });

  it("returns 200 with { deleted: true } when the owner deletes their session", async () => {
    deleteAdkSessionMock.mockResolvedValue(true);
    const res = await request(app).delete(`/api/ai-agents/sessions/${SESSION_ID}`);
    expect(res.status).toBe(200);
    const body = res.body as DeleteSessionBody;
    expect(body.deleted).toBe(true);
  });

  it("returns 404 when a different member of the same org tries to delete the session", async () => {
    deleteAdkSessionMock.mockResolvedValue(false);
    resolveAdkSessionMissReasonMock.mockResolvedValue("ownership_mismatch");
    currentUser = { orgId: 10, memberId: 99 };
    const res = await request(app).delete(`/api/ai-agents/sessions/${SESSION_ID}`);
    expect(res.status).toBe(404);
    const body = res.body as ErrorBody;
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 404 — not 403 or 200 — for cross-user delete", async () => {
    deleteAdkSessionMock.mockResolvedValue(false);
    resolveAdkSessionMissReasonMock.mockResolvedValue("ownership_mismatch");
    currentUser = { orgId: 10, memberId: 99 };
    const res = await request(app).delete(`/api/ai-agents/sessions/${SESSION_ID}`);
    // Must be 404 — not 403 (that would confirm the session exists)
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(200);
    expect(res.status).toBe(404);
  });

  it("returns 404 when the same memberId tries to delete a session from a different org", async () => {
    deleteAdkSessionMock.mockResolvedValue(false);
    resolveAdkSessionMissReasonMock.mockResolvedValue("not_found");
    currentUser = { orgId: 999, memberId: 1 };
    const res = await request(app).delete(`/api/ai-agents/sessions/${SESSION_ID}`);
    expect(res.status).toBe(404);
    const body = res.body as ErrorBody;
    expect(body.code).toBe("NOT_FOUND");
  });

  it("calls deleteAdkSession with the full org-scoped userId, not just memberId", async () => {
    deleteAdkSessionMock.mockResolvedValue(true);
    await request(app).delete(`/api/ai-agents/sessions/${SESSION_ID}`);
    expect(deleteAdkSessionMock).toHaveBeenCalledWith("org:10:user:1", SESSION_ID);
  });
});
