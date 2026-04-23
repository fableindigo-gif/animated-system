/**
 * Route-layer tests — unauthorized session access returns 404 and is logged
 *
 * Verifies that the GET and DELETE session route handlers:
 *   (a) always return HTTP 404 (never 403) when an ownership mismatch is
 *       detected — 404 prevents leaking that the session exists, and
 *   (b) emit logger.warn with reason:"ownership_mismatch" so every
 *       cross-user access attempt is auditable at the route layer.
 *
 * The adk-agent service layer is fully stubbed; this file only covers the
 * route-level concern.  See adk-session-unauthorized-access-service.test.ts
 * for service-layer warn coverage.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import request from "supertest";

// ─── Logger mock (must be hoisted before any subject import) ──────────────────

vi.mock("../lib/logger", () => ({
  logger: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

// ─── Heavy dep stubs ─────────────────────────────────────────────────────────

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

vi.mock("../lib/route-error-handler", () => ({
  handleRouteError: (_err: unknown, _req: unknown, res: Response) => {
    res.status(500).json({ error: "internal" });
  },
}));

// ─── Service-layer stubs ──────────────────────────────────────────────────────

const getAdkSessionMock               = vi.fn();
const deleteAdkSessionMock            = vi.fn();
const listAdkSessionsMock             = vi.fn();
const resolveAdkSessionMissReasonMock = vi.fn();
const updateAdkSessionMock            = vi.fn();
const runAdkAgentMock                 = vi.fn();

vi.mock("../services/adk-agent", () => ({
  APP_NAME:                    "omnianalytix-adk",
  getAdkSession:               (...args: unknown[]) => getAdkSessionMock(...args),
  deleteAdkSession:            (...args: unknown[]) => deleteAdkSessionMock(...args),
  listAdkSessions:             (...args: unknown[]) => listAdkSessionsMock(...args),
  resolveAdkSessionMissReason: (...args: unknown[]) => resolveAdkSessionMissReasonMock(...args),
  updateAdkSession:            (...args: unknown[]) => updateAdkSessionMock(...args),
  runAdkAgent:                 (...args: unknown[]) => runAdkAgentMock(...args),
  generateSmartTitle:          vi.fn(),
  AdkConfigError:              class AdkConfigError extends Error {},
  AdkRunError:                 class AdkRunError    extends Error {},
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { logger } from "../lib/logger";

// ─── Express test app ─────────────────────────────────────────────────────────

const SESSION_ID = "sess-route-test-001";

let app: Express;
let currentUser: { orgId: number; memberId: number } | null;

beforeAll(async () => {
  const { default: aiAgentsRouter } = await import("../routes/ai-agents/index");
  app = express();
  app.use(express.json());
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
  getAdkSessionMock.mockReset();
  deleteAdkSessionMock.mockReset();
  listAdkSessionsMock.mockReset();
  resolveAdkSessionMissReasonMock.mockReset().mockResolvedValue("not_found");
  updateAdkSessionMock.mockReset();
  vi.mocked(logger.warn).mockClear();
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/ai-agents/sessions/:sessionId
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/ai-agents/sessions/:sessionId — unauthorized access blocked and logged", () => {
  it("returns 404 (not 403) when ownership_mismatch is detected", async () => {
    getAdkSessionMock.mockResolvedValue(null);
    resolveAdkSessionMissReasonMock.mockResolvedValue("ownership_mismatch");
    currentUser = { orgId: 10, memberId: 99 };

    const res = await request(app).get(`/api/ai-agents/sessions/${SESSION_ID}`);

    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("emits logger.warn with reason:'ownership_mismatch' and the mismatch message", async () => {
    getAdkSessionMock.mockResolvedValue(null);
    resolveAdkSessionMissReasonMock.mockResolvedValue("ownership_mismatch");
    currentUser = { orgId: 10, memberId: 99 };

    await request(app).get(`/api/ai-agents/sessions/${SESSION_ID}`);

    expect(logger.warn).toHaveBeenCalledOnce();
    const [payload, message] = vi.mocked(logger.warn).mock.calls[0] as [Record<string, unknown>, string];
    expect(payload.reason).toBe("ownership_mismatch");
    expect(payload.sessionId).toBe(SESSION_ID);
    expect(payload.route).toBe("GET /api/ai-agents/sessions/:id");
    expect(message).toMatch(/owned by a different user/i);
  });

  it("emits logger.warn with reason:'not_found' and the not-found message when session is absent", async () => {
    getAdkSessionMock.mockResolvedValue(null);
    resolveAdkSessionMissReasonMock.mockResolvedValue("not_found");

    await request(app).get(`/api/ai-agents/sessions/${SESSION_ID}`);

    expect(logger.warn).toHaveBeenCalledOnce();
    const [payload, message] = vi.mocked(logger.warn).mock.calls[0] as [Record<string, unknown>, string];
    expect(payload.reason).toBe("not_found");
    expect(message).toMatch(/does not exist/i);
  });

  it("does NOT emit logger.warn when the owner successfully fetches their session", async () => {
    getAdkSessionMock.mockResolvedValue({
      sessionId:  SESSION_ID,
      messages:   [],
      title:      "t",
      pinned:     false,
      archived:   false,
      eventCount: 1,
      createdAt:  "2026-04-01T00:00:00.000Z",
      updatedAt:  "2026-04-01T00:00:00.000Z",
    });

    await request(app).get(`/api/ai-agents/sessions/${SESSION_ID}`);

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("calls resolveAdkSessionMissReason only on the miss path, never on a hit", async () => {
    getAdkSessionMock.mockResolvedValue({
      sessionId: SESSION_ID, messages: [], title: "t",
      pinned: false, archived: false, eventCount: 1,
      createdAt: "", updatedAt: "",
    });

    await request(app).get(`/api/ai-agents/sessions/${SESSION_ID}`);

    expect(resolveAdkSessionMissReasonMock).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE /api/ai-agents/sessions/:sessionId
// ═══════════════════════════════════════════════════════════════════════════════

describe("DELETE /api/ai-agents/sessions/:sessionId — unauthorized access blocked and logged", () => {
  it("returns 404 (not 403) when ownership_mismatch is detected", async () => {
    deleteAdkSessionMock.mockResolvedValue(false);
    resolveAdkSessionMissReasonMock.mockResolvedValue("ownership_mismatch");
    currentUser = { orgId: 10, memberId: 99 };

    const res = await request(app).delete(`/api/ai-agents/sessions/${SESSION_ID}`);

    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("emits logger.warn with reason:'ownership_mismatch' and the mismatch message", async () => {
    deleteAdkSessionMock.mockResolvedValue(false);
    resolveAdkSessionMissReasonMock.mockResolvedValue("ownership_mismatch");
    currentUser = { orgId: 10, memberId: 99 };

    await request(app).delete(`/api/ai-agents/sessions/${SESSION_ID}`);

    expect(logger.warn).toHaveBeenCalledOnce();
    const [payload, message] = vi.mocked(logger.warn).mock.calls[0] as [Record<string, unknown>, string];
    expect(payload.reason).toBe("ownership_mismatch");
    expect(payload.sessionId).toBe(SESSION_ID);
    expect(payload.route).toBe("DELETE /api/ai-agents/sessions/:id");
    expect(message).toMatch(/owned by a different user/i);
  });

  it("emits logger.warn with reason:'not_found' and the not-found message when session is absent", async () => {
    deleteAdkSessionMock.mockResolvedValue(false);
    resolveAdkSessionMissReasonMock.mockResolvedValue("not_found");

    await request(app).delete(`/api/ai-agents/sessions/${SESSION_ID}`);

    expect(logger.warn).toHaveBeenCalledOnce();
    const [payload, message] = vi.mocked(logger.warn).mock.calls[0] as [Record<string, unknown>, string];
    expect(payload.reason).toBe("not_found");
    expect(message).toMatch(/does not exist/i);
  });

  it("does NOT emit logger.warn when the owner successfully deletes their session", async () => {
    deleteAdkSessionMock.mockResolvedValue(true);

    await request(app).delete(`/api/ai-agents/sessions/${SESSION_ID}`);

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("calls resolveAdkSessionMissReason only on the miss path, never on a successful delete", async () => {
    deleteAdkSessionMock.mockResolvedValue(true);

    await request(app).delete(`/api/ai-agents/sessions/${SESSION_ID}`);

    expect(resolveAdkSessionMissReasonMock).not.toHaveBeenCalled();
  });
});
