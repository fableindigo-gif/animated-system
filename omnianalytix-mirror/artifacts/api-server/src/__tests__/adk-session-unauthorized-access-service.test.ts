/**
 * Service-layer tests — unauthorized session access is blocked and logged
 *
 * Verifies that getAdkSession and deleteAdkSession:
 *   (a) return null / false so the session is never exposed, AND
 *   (b) emit logger.warn with event:"session_ownership_mismatch" so every
 *       cross-user access attempt is auditable.
 *
 * Uses an in-memory fake of @workspace/db (same approach as
 * adk-session-isolation.test.ts) — no live Postgres required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── In-memory store ──────────────────────────────────────────────────────────

interface FakeRow {
  id:         string;
  appName:    string;
  userId:     string;
  state:      Record<string, unknown>;
  events:     unknown[];
  title:      string | null;
  pinned:     boolean | null;
  archivedAt: Date | null;
  createdAt:  Date;
  updatedAt:  Date;
}

const store: { rows: FakeRow[] } = { rows: [] };

// ─── drizzle-orm stub ─────────────────────────────────────────────────────────

type Cond =
  | { kind: "eq";     col: { name: string }; val: unknown }
  | { kind: "and";    conds: Cond[] }
  | { kind: "lt";     col: { name: string }; val: unknown }
  | { kind: "gte";    col: { name: string }; val: unknown }
  | { kind: "isNull"; col: { name: string } }
  | { kind: "raw" };

vi.mock("drizzle-orm", () => {
  const eq      = (col: { name: string }, val: unknown): Cond => ({ kind: "eq",     col, val });
  const and     = (...conds: Cond[]): Cond                   => ({ kind: "and",    conds });
  const lt      = (col: { name: string }, val: unknown): Cond => ({ kind: "lt",     col, val });
  const lte     = (col: { name: string }, val: unknown): Cond => ({ kind: "lt",     col, val });
  const gte     = (col: { name: string }, val: unknown): Cond => ({ kind: "gte",    col, val });
  const ne      = (col: { name: string }, val: unknown): Cond => ({ kind: "eq",     col, val });
  const isNull  = (col: { name: string }): Cond              => ({ kind: "isNull", col });
  const desc    = (col: { name: string })                    => ({ kind: "desc",   col });
  const asc     = (col: { name: string })                    => ({ kind: "asc",    col });
  const inArray = (col: { name: string }, _vals: unknown[])  => ({ kind: "raw" as const });
  const ilike   = (_col: unknown, _pat: unknown)             => ({ kind: "raw" as const });
  const or      = (..._conds: unknown[])                     => ({ kind: "raw" as const });
  const sql: any = (..._args: unknown[]) => ({ kind: "raw" });
  sql.raw = (_s: string) => ({ kind: "raw" });
  return { eq, and, lt, lte, gte, ne, isNull, desc, asc, inArray, ilike, or, sql };
});

// ─── @workspace/db stub ───────────────────────────────────────────────────────

function evalCond(cond: Cond, row: FakeRow): boolean {
  if (cond.kind === "eq")     return (row as any)[cond.col.name] === cond.val;
  if (cond.kind === "lt")     return (row as any)[cond.col.name] <  (cond.val as any);
  if (cond.kind === "gte")    return (row as any)[cond.col.name] >= (cond.val as any);
  if (cond.kind === "isNull") return (row as any)[cond.col.name] == null;
  if (cond.kind === "and")    return cond.conds.every((c) => evalCond(c, row));
  return true;
}

function makeSelectChain(projection?: Record<string, { name: string }>) {
  const state: { where?: Cond; orders: any[]; limit?: number; offset?: number } = { orders: [] };
  const chain = {
    from(_table: unknown)    { return chain; },
    where(c: Cond)           { state.where = c; return chain; },
    orderBy(...os: any[])    { state.orders = os; return chain; },
    limit(n: number)         { state.limit = n;  return chain; },
    offset(n: number)        { state.offset = n; return chain; },
    then(resolve: (rows: any[]) => void) {
      let rows = state.where
        ? store.rows.filter((r) => evalCond(state.where!, r))
        : [...store.rows];
      const start = state.offset ?? 0;
      rows = rows.slice(start, state.limit != null ? start + state.limit : undefined);
      const projected = projection
        ? rows.map((r) => {
            const out: Record<string, unknown> = {};
            for (const [outKey, col] of Object.entries(projection)) {
              out[outKey] = (r as any)[col.name];
            }
            return out;
          })
        : rows;
      resolve(projected);
    },
  };
  return chain;
}

function makeDeleteChain() {
  const state: { where?: Cond } = {};
  const chain = {
    where(c: Cond) { state.where = c; return chain; },
    then(resolve: (rows: any[]) => void) {
      const before = store.rows.length;
      store.rows = state.where
        ? store.rows.filter((r) => !evalCond(state.where!, r))
        : [];
      const removed = before - store.rows.length;
      resolve(Array.from({ length: removed }, () => ({})));
    },
    returning(_proj?: unknown) {
      const removed = state.where
        ? store.rows.filter((r) => evalCond(state.where!, r))
        : [...store.rows];
      store.rows = state.where
        ? store.rows.filter((r) => !evalCond(state.where!, r))
        : [];
      return Promise.resolve(removed.map((r) => ({ id: r.id })));
    },
  };
  return chain;
}

function makeInsertChain() {
  return {
    values(v: Partial<FakeRow>) {
      store.rows.push({
        id:         v.id         ?? crypto.randomUUID(),
        appName:    v.appName    ?? "",
        userId:     v.userId     ?? "",
        state:      v.state      ?? {},
        events:     v.events     ?? [],
        title:      v.title      ?? null,
        pinned:     v.pinned     ?? null,
        archivedAt: v.archivedAt ?? null,
        createdAt:  v.createdAt  ?? new Date(),
        updatedAt:  v.updatedAt  ?? new Date(),
      });
      return Promise.resolve();
    },
  };
}

vi.mock("@workspace/db", () => {
  const db = {
    select: (projection?: Record<string, { name: string }>) => makeSelectChain(projection),
    delete: (_table: unknown) => makeDeleteChain(),
    insert: (_table: unknown) => makeInsertChain(),
    update: (_table: unknown) => ({
      set: () => ({ where: () => Promise.resolve() }),
    }),
  };
  const tableStub = new Proxy({}, { get: (_t, p) => ({ name: String(p) }) }) as Record<string, { name: string }>;
  return {
    db,
    adkSessions: {
      id:         { name: "id" },
      appName:    { name: "appName" },
      userId:     { name: "userId" },
      state:      { name: "state" },
      events:     { name: "events" },
      title:      { name: "title" },
      pinned:     { name: "pinned" },
      archivedAt: { name: "archivedAt" },
      createdAt:  { name: "createdAt" },
      updatedAt:  { name: "updatedAt" },
    },
    warehouseGoogleAds:       tableStub,
    warehouseShopifyProducts: tableStub,
    liveTriageAlerts:         tableStub,
    platformConnections:      tableStub,
    workspaces:               tableStub,
  };
});

// ─── Peripheral mocks so adk-agent.ts loads ───────────────────────────────────

vi.mock("@google/adk", () => {
  class FunctionTool   { constructor(_: unknown) {} }
  class LlmAgent       { constructor(_: unknown) {} }
  class Runner         { constructor(_: unknown) {} }
  class BaseSessionService {}
  return { FunctionTool, LlmAgent, Runner, BaseSessionService };
});

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/system-health-monitor", () => ({
  getLastHealthResults: () => ({ results: [], lastRunAt: null }),
}));

vi.mock("../lib/google-token-refresh", () => ({
  getFreshGoogleCredentials: vi.fn(),
}));

vi.mock("../lib/credential-helpers", () => ({
  decryptCredentials: (x: unknown) => x,
}));

vi.mock("../lib/platform-executors", () => ({
  googleAds_getBudgetConstrainedCampaigns: vi.fn(),
  shopify_getStoreInventoryHealth:         vi.fn(),
}));

vi.mock("../agents/infrastructure/prompts/loader", () => ({
  renderPrompt:       () => "",
  getToolDescription: () => "",
}));

// ─── Subject under test ───────────────────────────────────────────────────────

import { APP_NAME, getAdkSession, deleteAdkSession } from "../services/adk-agent";
import { logger } from "../lib/logger";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function adkUserId(orgId: number, memberId: number): string {
  return `org:${orgId}:user:${memberId}`;
}

function seed(id: string, userId: string): void {
  store.rows.push({
    id,
    appName:    APP_NAME,
    userId,
    state:      {},
    events:     [{ content: { role: "user", parts: [{ text: "hello" }] }, timestamp: 1 }],
    title:      null,
    pinned:     null,
    archivedAt: null,
    createdAt:  new Date("2026-04-01T00:00:00Z"),
    updatedAt:  new Date("2026-04-01T00:00:00Z"),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// getAdkSession
// ═══════════════════════════════════════════════════════════════════════════════

describe("getAdkSession — ownership-mismatch: blocked and logged", () => {
  beforeEach(() => {
    store.rows = [];
    vi.mocked(logger.warn).mockClear();
  });

  it("returns null when a different user in the same org requests the session", async () => {
    seed("sess-victim", adkUserId(42, 1));

    const result = await getAdkSession(adkUserId(42, 2), "sess-victim");

    expect(result).toBeNull();
  });

  it("emits logger.warn with event:'session_ownership_mismatch' on cross-user fetch", async () => {
    seed("sess-victim", adkUserId(42, 1));

    await getAdkSession(adkUserId(42, 2), "sess-victim");

    expect(logger.warn).toHaveBeenCalledOnce();
    const [payload, message] = vi.mocked(logger.warn).mock.calls[0] as [Record<string, unknown>, string];
    expect(payload.event).toBe("session_ownership_mismatch");
    expect(payload.sessionId).toBe("sess-victim");
    expect(message).toMatch(/owned by a different user/i);
  });

  it("includes parsed orgId and memberId in the warn payload", async () => {
    seed("sess-target", adkUserId(42, 1));

    await getAdkSession(adkUserId(42, 77), "sess-target");

    const [payload] = vi.mocked(logger.warn).mock.calls[0] as [Record<string, unknown>];
    expect(payload.orgId).toBe("42");
    expect(payload.memberId).toBe("77");
  });

  it("does NOT warn when the session simply does not exist", async () => {
    const result = await getAdkSession(adkUserId(42, 1), "nonexistent-session");

    expect(result).toBeNull();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("does NOT warn and returns the session when the legitimate owner fetches it", async () => {
    seed("sess-own", adkUserId(42, 1));

    const result = await getAdkSession(adkUserId(42, 1), "sess-own");

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe("sess-own");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("warns and returns null for cross-org access with the same memberId", async () => {
    seed("sess-org42", adkUserId(42, 1));

    const result = await getAdkSession(adkUserId(99, 1), "sess-org42");

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledOnce();
    const [payload] = vi.mocked(logger.warn).mock.calls[0] as [Record<string, unknown>];
    expect(payload.event).toBe("session_ownership_mismatch");
    expect(payload.sessionId).toBe("sess-org42");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// deleteAdkSession
// ═══════════════════════════════════════════════════════════════════════════════

describe("deleteAdkSession — ownership-mismatch: blocked and logged", () => {
  beforeEach(() => {
    store.rows = [];
    vi.mocked(logger.warn).mockClear();
  });

  it("returns false when a different user in the same org attempts to delete the session", async () => {
    seed("sess-victim", adkUserId(42, 1));

    const result = await deleteAdkSession(adkUserId(42, 2), "sess-victim");

    expect(result).toBe(false);
  });

  it("emits logger.warn with event:'session_ownership_mismatch' on cross-user delete", async () => {
    seed("sess-victim", adkUserId(42, 1));

    await deleteAdkSession(adkUserId(42, 2), "sess-victim");

    expect(logger.warn).toHaveBeenCalledOnce();
    const [payload, message] = vi.mocked(logger.warn).mock.calls[0] as [Record<string, unknown>, string];
    expect(payload.event).toBe("session_ownership_mismatch");
    expect(payload.sessionId).toBe("sess-victim");
    expect(message).toMatch(/owned by a different user/i);
  });

  it("includes parsed orgId and memberId in the warn payload", async () => {
    seed("sess-target", adkUserId(42, 1));

    await deleteAdkSession(adkUserId(42, 77), "sess-target");

    const [payload] = vi.mocked(logger.warn).mock.calls[0] as [Record<string, unknown>];
    expect(payload.orgId).toBe("42");
    expect(payload.memberId).toBe("77");
  });

  it("does NOT warn when the session simply does not exist", async () => {
    const result = await deleteAdkSession(adkUserId(42, 1), "nonexistent-session");

    expect(result).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("does NOT warn and returns true when the legitimate owner deletes their session", async () => {
    seed("sess-own", adkUserId(42, 1));

    const result = await deleteAdkSession(adkUserId(42, 1), "sess-own");

    expect(result).toBe(true);
    expect(store.rows.find((r) => r.id === "sess-own")).toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("warns and returns false for cross-org delete with the same memberId", async () => {
    seed("sess-org42", adkUserId(42, 1));

    const result = await deleteAdkSession(adkUserId(99, 1), "sess-org42");

    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalledOnce();
    const [payload] = vi.mocked(logger.warn).mock.calls[0] as [Record<string, unknown>];
    expect(payload.event).toBe("session_ownership_mismatch");
    expect(payload.sessionId).toBe("sess-org42");
  });
});
