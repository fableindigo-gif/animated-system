/**
 * ADK Session Patch — Unit/Integration Tests
 *
 * Covers:
 *   • updateAdkSession — rename (title), pin, archive
 *   • updateAdkSession — tenant isolation (cross-user patch = null)
 *   • updateAdkSession — title sanitisation (trim, 200-char cap, null clear)
 *   • listAdkSessions  — archived filter (default hides archived; includeArchived shows all)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── In-memory store ───────────────────────────────────────────────────────────

interface FakeRow {
  id:         string;
  appName:    string;
  userId:     string;
  state:      Record<string, unknown>;
  events:     unknown[];
  title:      string | null;
  pinned:     boolean;
  archivedAt: Date | null;
  createdAt:  Date;
  updatedAt:  Date;
}

const store: { rows: FakeRow[] } = { rows: [] };

// ── drizzle-orm mock ──────────────────────────────────────────────────────────

type Cond =
  | { kind: "eq";     col: { name: string }; val: unknown }
  | { kind: "and";    conds: Cond[] }
  | { kind: "lt";     col: { name: string }; val: unknown }
  | { kind: "gte";    col: { name: string }; val: unknown }
  | { kind: "isNull"; col: { name: string } }
  | { kind: "raw" };

vi.mock("drizzle-orm", () => {
  const eq     = (col: { name: string }, val: unknown): Cond => ({ kind: "eq",     col, val });
  const and    = (...conds: Cond[]): Cond                    => ({ kind: "and",    conds });
  const lt     = (col: { name: string }, val: unknown): Cond => ({ kind: "lt",     col, val });
  const lte    = (col: { name: string }, val: unknown): Cond => ({ kind: "lt",     col, val });
  const gte    = (col: { name: string }, val: unknown): Cond => ({ kind: "gte",    col, val });
  const ne     = (col: { name: string }, val: unknown): Cond => ({ kind: "eq",     col, val });
  const isNull = (col: { name: string }): Cond               => ({ kind: "isNull", col });
  const desc   = (col: { name: string })                     => ({ kind: "desc",   col });
  const asc    = (col: { name: string })                     => ({ kind: "asc",    col });

  const sql: any = (..._args: unknown[]) => ({ kind: "raw" });
  sql.raw = (_s: string) => ({ kind: "raw" });

  return { eq, and, lt, lte, gte, ne, isNull, desc, asc, sql };
});

// ── @workspace/db mock ────────────────────────────────────────────────────────

function evalCond(cond: Cond, row: FakeRow): boolean {
  if (cond.kind === "eq")     return (row as any)[cond.col.name] === cond.val;
  if (cond.kind === "lt")     return (row as any)[cond.col.name] <  (cond.val as any);
  if (cond.kind === "gte")    return (row as any)[cond.col.name] >= (cond.val as any);
  if (cond.kind === "isNull") return (row as any)[cond.col.name] == null;
  if (cond.kind === "and")    return cond.conds.every((c) => evalCond(c, row));
  return true; // "raw" — unknown conditions always pass in test
}

function applyOrderBy(rows: FakeRow[], order: any): FakeRow[] {
  if (!order || !order.col) return rows;
  const sorted = [...rows].sort((a, b) => {
    const av = (a as any)[order.col.name];
    const bv = (b as any)[order.col.name];
    if (av === bv) return 0;
    return av < bv ? -1 : 1;
  });
  return order.kind === "desc" ? sorted.reverse() : sorted;
}

function makeSelectChain(projection?: Record<string, { name: string }>) {
  const state: { where?: Cond; order?: any; limit?: number; offset?: number } = {};
  const chain = {
    from(_table: unknown)  { return chain; },
    where(c: Cond)         { state.where  = c; return chain; },
    orderBy(o: any)        { state.order  = o; return chain; },
    limit(n: number)       { state.limit  = n; return chain; },
    offset(n: number)      { state.offset = n; return chain; },
    then(resolve: (rows: any[]) => void) {
      let rows = state.where
        ? store.rows.filter((r) => evalCond(state.where!, r))
        : [...store.rows];
      rows = applyOrderBy(rows, state.order);
      const off = state.offset ?? 0;
      rows = rows.slice(off);
      if (state.limit != null) rows = rows.slice(0, state.limit);
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

function makeUpdateChain() {
  let updates: Record<string, unknown> = {};
  const state: { where?: Cond } = {};
  const chain = {
    set(vals: Record<string, unknown>) { updates = vals; return chain; },
    where(c: Cond) { state.where = c; return chain; },
    returning(_proj?: unknown) {
      const matched = state.where
        ? store.rows.filter((r) => evalCond(state.where!, r))
        : [...store.rows];
      for (const row of matched) {
        Object.assign(row, updates);
      }
      return Promise.resolve(matched.map((r) => ({ id: r.id })));
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
        pinned:     v.pinned     ?? false,
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
    update: (_table: unknown) => makeUpdateChain(),
  };

  const tableStub = new Proxy(
    {},
    { get: (_t, p) => ({ name: String(p) }) },
  ) as Record<string, { name: string }>;

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

// ── Peripheral mocks so adk-agent.ts loads ────────────────────────────────────

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

// ── Subject under test ────────────────────────────────────────────────────────

import {
  APP_NAME,
  updateAdkSession,
  listAdkSessions,
} from "../services/adk-agent";

// ── Helpers ───────────────────────────────────────────────────────────────────

function adkUserId(orgId: number, memberId: number): string {
  return `org:${orgId}:user:${memberId}`;
}

function seed(
  id: string,
  userId: string,
  overrides: Partial<Omit<FakeRow, "id" | "userId">> = {},
): void {
  store.rows.push({
    id,
    appName:    APP_NAME,
    userId,
    state:      {},
    events:     [{ content: { role: "user", parts: [{ text: "Hello" }] }, timestamp: 1 }],
    title:      null,
    pinned:     false,
    archivedAt: null,
    createdAt:  new Date("2026-04-17T00:00:00Z"),
    updatedAt:  new Date("2026-04-17T00:00:00Z"),
    ...overrides,
  });
}

// ── updateAdkSession: rename ──────────────────────────────────────────────────

describe("updateAdkSession — rename (title)", () => {
  const user = adkUserId(10, 1);

  beforeEach(() => {
    store.rows = [];
    seed("sess-1", user);
  });

  it("sets a new title and returns the updated session", async () => {
    const result = await updateAdkSession(user, "sess-1", { title: "My Report" });
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe("sess-1");
    expect(result!.title).toBe("My Report");
  });

  it("trims whitespace from the title", async () => {
    const result = await updateAdkSession(user, "sess-1", { title: "  Trimmed  " });
    expect(result!.title).toBe("Trimmed");
  });

  it("caps title at 200 characters", async () => {
    const long  = "x".repeat(300);
    const result = await updateAdkSession(user, "sess-1", { title: long });
    expect(result!.title!.length).toBe(200);
  });

  it("clears title when null is passed", async () => {
    // Pre-set a title in the store
    store.rows[0].title = "Old Title";
    const result = await updateAdkSession(user, "sess-1", { title: null });
    // title cleared → falls back to derived title from first user event
    expect(result).not.toBeNull();
    // title should not be "Old Title"
    expect(result!.title).not.toBe("Old Title");
  });

  it("clears title when empty string is passed", async () => {
    store.rows[0].title = "Was Set";
    const result = await updateAdkSession(user, "sess-1", { title: "   " });
    expect(result).not.toBeNull();
    expect(result!.title).not.toBe("Was Set");
  });
});

// ── updateAdkSession: pin ─────────────────────────────────────────────────────

describe("updateAdkSession — pin / unpin", () => {
  const user = adkUserId(10, 2);

  beforeEach(() => {
    store.rows = [];
    seed("sess-pin", user, { pinned: false });
  });

  it("pins a session (pinned: true)", async () => {
    const result = await updateAdkSession(user, "sess-pin", { pinned: true });
    expect(result).not.toBeNull();
    expect(result!.pinned).toBe(true);
  });

  it("unpins a session (pinned: false)", async () => {
    store.rows[0].pinned = true;
    const result = await updateAdkSession(user, "sess-pin", { pinned: false });
    expect(result!.pinned).toBe(false);
  });
});

// ── updateAdkSession: archive ─────────────────────────────────────────────────

describe("updateAdkSession — archive / restore", () => {
  const user = adkUserId(10, 3);

  beforeEach(() => {
    store.rows = [];
    seed("sess-arch", user, { archivedAt: null });
  });

  it("archives a session (archived: true sets archivedAt)", async () => {
    const result = await updateAdkSession(user, "sess-arch", { archived: true });
    expect(result).not.toBeNull();
    expect(result!.archived).toBe(true);
    // Confirm the store row has a Date for archivedAt
    const row = store.rows.find((r) => r.id === "sess-arch")!;
    expect(row.archivedAt).toBeInstanceOf(Date);
  });

  it("restores a session (archived: false clears archivedAt)", async () => {
    store.rows[0].archivedAt = new Date("2026-04-01T00:00:00Z");
    const result = await updateAdkSession(user, "sess-arch", { archived: false });
    expect(result!.archived).toBe(false);
    const row = store.rows.find((r) => r.id === "sess-arch")!;
    expect(row.archivedAt).toBeNull();
  });
});

// ── updateAdkSession: tenant isolation ───────────────────────────────────────

describe("updateAdkSession — tenant isolation", () => {
  const orgId = 20;
  const userA = adkUserId(orgId, 1);
  const userB = adkUserId(orgId, 2);

  beforeEach(() => {
    store.rows = [];
    seed("sess-a", userA);
    seed("sess-b", userB);
  });

  it("returns null when patching another user's session (same org)", async () => {
    // User A tries to rename User B's session
    const result = await updateAdkSession(userA, "sess-b", { title: "Hijacked" });
    expect(result).toBeNull();
  });

  it("leaves the target session unchanged after a failed cross-user patch", async () => {
    await updateAdkSession(userA, "sess-b", { pinned: true });
    const row = store.rows.find((r) => r.id === "sess-b")!;
    expect(row.pinned).toBe(false);
  });

  it("returns null when patching across orgs (same memberId, different org)", async () => {
    const userOrg99 = adkUserId(99, 1); // same memberId=1 but different org
    seed("sess-org99", userOrg99);

    const result = await updateAdkSession(userA, "sess-org99", { archived: true });
    expect(result).toBeNull();
  });

  it("still allows the owner to patch their own session", async () => {
    const result = await updateAdkSession(userA, "sess-a", { title: "Mine" });
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Mine");
  });
});

// ── updateAdkSession: unknown session ────────────────────────────────────────

describe("updateAdkSession — non-existent session", () => {
  const user = adkUserId(30, 1);

  beforeEach(() => { store.rows = []; });

  it("returns null for a session id that does not exist", async () => {
    const result = await updateAdkSession(user, "does-not-exist", { pinned: true });
    expect(result).toBeNull();
  });
});

// ── listAdkSessions: archived filter ─────────────────────────────────────────

describe("listAdkSessions — archived filter", () => {
  const user = adkUserId(40, 1);

  beforeEach(() => {
    store.rows = [];
    seed("active-1", user, { archivedAt: null });
    seed("active-2", user, { archivedAt: null });
    seed("archived-1", user, { archivedAt: new Date("2026-04-01T00:00:00Z") });
    seed("archived-2", user, { archivedAt: new Date("2026-04-02T00:00:00Z") });
  });

  it("hides archived sessions by default", async () => {
    const { sessions } = await listAdkSessions(user);
    const ids = sessions.map((s) => s.sessionId);
    expect(ids).toContain("active-1");
    expect(ids).toContain("active-2");
    expect(ids).not.toContain("archived-1");
    expect(ids).not.toContain("archived-2");
  });

  it("shows all sessions when includeArchived is true", async () => {
    const { sessions } = await listAdkSessions(user, { includeArchived: true });
    const ids = sessions.map((s) => s.sessionId);
    expect(ids).toContain("active-1");
    expect(ids).toContain("active-2");
    expect(ids).toContain("archived-1");
    expect(ids).toContain("archived-2");
  });

  it("archived field is true on archived sessions when includeArchived", async () => {
    const { sessions } = await listAdkSessions(user, { includeArchived: true });
    const archived = sessions.filter((s) => s.sessionId.startsWith("archived-"));
    expect(archived.length).toBe(2);
    for (const s of archived) {
      expect(s.archived).toBe(true);
    }
  });

  it("archived field is false on active sessions", async () => {
    const { sessions } = await listAdkSessions(user, { includeArchived: true });
    const active = sessions.filter((s) => s.sessionId.startsWith("active-"));
    expect(active.length).toBe(2);
    for (const s of active) {
      expect(s.archived).toBe(false);
    }
  });

  it("archived sessions from other users do not appear in caller's list", async () => {
    const other = adkUserId(40, 2);
    seed("other-archived", other, { archivedAt: new Date() });

    const { sessions } = await listAdkSessions(user, { includeArchived: true });
    expect(sessions.map((s) => s.sessionId)).not.toContain("other-archived");
  });
});

// ── updateAdkSession: simultaneous patch fields ───────────────────────────────

describe("updateAdkSession — multiple fields in one patch", () => {
  const user = adkUserId(50, 1);

  beforeEach(() => {
    store.rows = [];
    seed("sess-multi", user);
  });

  it("applies title + pinned + archived in one call", async () => {
    const result = await updateAdkSession(user, "sess-multi", {
      title:    "All At Once",
      pinned:   true,
      archived: true,
    });
    expect(result).not.toBeNull();
    expect(result!.title).toBe("All At Once");
    expect(result!.pinned).toBe(true);
    expect(result!.archived).toBe(true);
  });
});
