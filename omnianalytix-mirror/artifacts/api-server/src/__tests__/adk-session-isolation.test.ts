/**
 * ADK Session Isolation — Integration Tests
 *
 * Verifies that the per-user / per-org scoping applied to ADK sessions cannot
 * leak conversations between team members of the same organisation OR between
 * the same memberId in two different organisations.
 *
 * The route layer derives the ADK userId as `org:{orgId}:user:{memberId}` and
 * passes it through to listAdkSessions / getAdkSession / deleteAdkSession.
 * These tests exercise those service functions directly with an in-memory
 * fake of `@workspace/db` so we can assert the WHERE-clause scoping without a
 * live Postgres instance.
 *
 * Coverage:
 *   • Cross-user (same org): user A cannot list, fetch, or delete user B's session
 *   • Cross-org   (same memberId in two orgs): each org sees only its own list
 *   • The "delete" pathway (which goes through DrizzleSessionService) is also
 *     scoped — deleting another user's session is a no-op (returns false)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── In-memory store for adk_sessions ─────────────────────────────────────────

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

// ── Mock drizzle-orm so we can introspect WHERE conditions ───────────────────

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

// ── Mock @workspace/db with chainable query builder over the in-memory store ─

function evalCond(cond: Cond, row: FakeRow): boolean {
  if (cond.kind === "eq")     return (row as any)[cond.col.name] === cond.val;
  if (cond.kind === "lt")     return (row as any)[cond.col.name] <  (cond.val as any);
  if (cond.kind === "gte")    return (row as any)[cond.col.name] >= (cond.val as any);
  if (cond.kind === "isNull") return (row as any)[cond.col.name] == null;
  if (cond.kind === "and")    return cond.conds.every((c) => evalCond(c, row));
  return true;
}

function applyOrderBy(rows: FakeRow[], orders: any[]): FakeRow[] {
  if (!orders.length) return rows;
  return [...rows].sort((a, b) => {
    for (const order of orders) {
      if (!order || !order.col) continue;
      const av = (a as any)[order.col.name];
      const bv = (b as any)[order.col.name];
      if (av === bv) continue;
      const cmp = av < bv ? -1 : 1;
      return order.kind === "desc" ? -cmp : cmp;
    }
    return 0;
  });
}

function makeSelectChain(projection?: Record<string, { name: string }>) {
  const state: { where?: Cond; orders: any[]; limit?: number; offset?: number } = { orders: [] };
  const chain = {
    from(_table: unknown)    { return chain; },
    where(c: Cond)           { state.where = c;  return chain; },
    orderBy(...os: any[])    { state.orders = os; return chain; },
    limit(n: number)         { state.limit = n;  return chain; },
    offset(n: number)        { state.offset = n; return chain; },
    then(resolve: (rows: any[]) => void) {
      let rows = state.where ? store.rows.filter((r) => evalCond(state.where!, r)) : [...store.rows];
      rows = applyOrderBy(rows, state.orders);
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
      const before = store.rows.length;
      const removed = state.where
        ? store.rows.filter((r) => evalCond(state.where!, r))
        : [...store.rows];
      store.rows = state.where
        ? store.rows.filter((r) => !evalCond(state.where!, r))
        : [];
      void before;
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

// ── Mock peripheral imports of adk-agent.ts so the module loads ──────────────

vi.mock("@google/adk", () => {
  class FunctionTool { constructor(_: unknown) {} }
  class LlmAgent     { constructor(_: unknown) {} }
  class Runner       { constructor(_: unknown) {} }
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

// ── Subject ───────────────────────────────────────────────────────────────────

import {
  APP_NAME,
  listAdkSessions,
  getAdkSession,
  deleteAdkSession,
} from "../services/adk-agent";

// Helpers that mirror the route-layer derivation `adkUserIdFor`
function adkUserId(orgId: number, memberId: number): string {
  return `org:${orgId}:user:${memberId}`;
}

function seed(id: string, userId: string, firstUserText: string): void {
  store.rows.push({
    id,
    appName:    APP_NAME,
    userId,
    state:      {},
    events:     [
      { content: { role: "user", parts: [{ text: firstUserText }] }, timestamp: 1 },
    ],
    title:      null,
    pinned:     null,
    archivedAt: null,
    createdAt:  new Date("2026-04-17T00:00:00Z"),
    updatedAt:  new Date("2026-04-17T00:00:00Z"),
  });
}

// ── Cross-user isolation (same org) ──────────────────────────────────────────

describe("ADK session isolation — two users in the same org", () => {
  beforeEach(() => {
    store.rows = [];
    const orgId = 42;
    const userA = adkUserId(orgId, 1);
    const userB = adkUserId(orgId, 2);
    seed("sess-a-1", userA, "User A's first message");
    seed("sess-a-2", userA, "User A's second message");
    seed("sess-b-1", userB, "User B's confidential question");
  });

  it("listAdkSessions only returns the caller's own sessions", async () => {
    const userA = adkUserId(42, 1);
    const userB = adkUserId(42, 2);

    const { sessions: aSessions } = await listAdkSessions(userA);
    const { sessions: bSessions } = await listAdkSessions(userB);

    expect(aSessions.map((s) => s.sessionId).sort()).toEqual(["sess-a-1", "sess-a-2"]);
    expect(bSessions.map((s) => s.sessionId)).toEqual(["sess-b-1"]);

    // Hard guarantee: user A's list never mentions user B's session id
    expect(aSessions.some((s) => s.sessionId === "sess-b-1")).toBe(false);
    expect(bSessions.some((s) => s.sessionId.startsWith("sess-a-"))).toBe(false);
  });

  it("getAdkSession returns null when fetching another user's session id", async () => {
    const userA = adkUserId(42, 1);

    // User A trying to fetch one of user B's sessions by guessing the id
    const stolen = await getAdkSession(userA, "sess-b-1");
    expect(stolen).toBeNull();

    // User A's own session still loads correctly
    const own = await getAdkSession(userA, "sess-a-1");
    expect(own).not.toBeNull();
    expect(own!.sessionId).toBe("sess-a-1");
  });

  it("deleteAdkSession is a no-op when targeting another user's session id", async () => {
    const userA = adkUserId(42, 1);

    const deleted = await deleteAdkSession(userA, "sess-b-1");
    expect(deleted).toBe(false);

    // User B's session must still exist after the failed cross-user delete
    const userB = adkUserId(42, 2);
    const { sessions: remaining } = await listAdkSessions(userB);
    expect(remaining.map((s) => s.sessionId)).toEqual(["sess-b-1"]);

    // And user A can still delete their own
    const ownDelete = await deleteAdkSession(userA, "sess-a-1");
    expect(ownDelete).toBe(true);
    const { sessions: aAfter } = await listAdkSessions(userA);
    expect(aAfter.map((s) => s.sessionId)).toEqual(["sess-a-2"]);
  });
});

// ── Cross-org isolation (same memberId, two orgs) ────────────────────────────

describe("ADK session isolation — same memberId in two different orgs", () => {
  beforeEach(() => {
    store.rows = [];
    // memberId=1 exists in org 42 AND in org 99 — they MUST be separate users
    seed("sess-org42-1",  adkUserId(42, 1), "Org 42 user 1 message");
    seed("sess-org42-1b", adkUserId(42, 1), "Org 42 user 1 second message");
    seed("sess-org99-1",  adkUserId(99, 1), "Org 99 user 1 confidential message");
  });

  it("listAdkSessions returns disjoint lists for the same memberId in different orgs", async () => {
    const { sessions: inOrg42 } = await listAdkSessions(adkUserId(42, 1));
    const { sessions: inOrg99 } = await listAdkSessions(adkUserId(99, 1));

    expect(inOrg42.map((s) => s.sessionId).sort()).toEqual(["sess-org42-1", "sess-org42-1b"]);
    expect(inOrg99.map((s) => s.sessionId)).toEqual(["sess-org99-1"]);

    // No id from one org appears in the other org's list
    const org42Ids = new Set(inOrg42.map((s) => s.sessionId));
    const org99Ids = new Set(inOrg99.map((s) => s.sessionId));
    for (const id of org42Ids) expect(org99Ids.has(id)).toBe(false);
    for (const id of org99Ids) expect(org42Ids.has(id)).toBe(false);
  });

  it("getAdkSession refuses cross-org fetches even with the correct sessionId", async () => {
    // Org 42 / member 1 cannot fetch the org 99 session by id
    const leaked = await getAdkSession(adkUserId(42, 1), "sess-org99-1");
    expect(leaked).toBeNull();

    // The owning org/member still loads it
    const owned = await getAdkSession(adkUserId(99, 1), "sess-org99-1");
    expect(owned).not.toBeNull();
    expect(owned!.sessionId).toBe("sess-org99-1");
  });

  it("deleteAdkSession refuses cross-org deletes even with the correct sessionId", async () => {
    const result = await deleteAdkSession(adkUserId(42, 1), "sess-org99-1");
    expect(result).toBe(false);

    const { sessions: stillThere } = await listAdkSessions(adkUserId(99, 1));
    expect(stillThere.map((s) => s.sessionId)).toEqual(["sess-org99-1"]);
  });
});
