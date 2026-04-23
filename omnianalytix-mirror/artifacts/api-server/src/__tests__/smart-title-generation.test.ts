/**
 * Smart Title Generation — Unit Tests
 *
 * Covers:
 *   generateSmartTitle:
 *     • Happy path: valid Gemini response → title persisted on session
 *     • Empty AI response + empty user prompt → no title stored (skipped)
 *     • Gemini failure → error is caught and NOT rethrown
 *     • Race-condition guard: session already has a title → no overwrite
 *
 *   runAdkAgent / isNewSession flag:
 *     • No sessionId provided → isNewSession = true
 *     • sessionId provided and session exists → isNewSession = false
 *     • sessionId provided but session not found → isNewSession = true (new session created)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks (must be created before vi.mock factories run) ───────────────

const { mockGenerateContent, mockSessionService, mockRunAsync } = vi.hoisted(() => {
  const mockGenerateContent = vi.fn();

  const mockSessionService = {
    getSession:    vi.fn(),
    createSession: vi.fn(),
    deleteSession: vi.fn(),
  };

  const mockRunAsync = vi.fn(async function* () { /* no events */ });

  return { mockGenerateContent, mockSessionService, mockRunAsync };
});

// ── In-memory store for adk_sessions ─────────────────────────────────────────

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
  const inArray = (col: { name: string }, _vals: unknown[])  => ({ kind: "raw" as const });
  const ilike  = (_col: unknown, _pat: unknown)              => ({ kind: "raw" as const });
  const or     = (..._conds: unknown[])                      => ({ kind: "raw" as const });

  const sql: any = (..._args: unknown[]) => ({ kind: "raw" });
  sql.raw = (_s: string) => ({ kind: "raw" });

  return { eq, and, lt, lte, gte, ne, isNull, desc, asc, inArray, ilike, or, sql };
});

// ── Condition evaluator ───────────────────────────────────────────────────────

function evalCond(cond: Cond, row: FakeRow): boolean {
  if (cond.kind === "eq")     return (row as any)[cond.col.name] === cond.val;
  if (cond.kind === "lt")     return (row as any)[cond.col.name] <  (cond.val as any);
  if (cond.kind === "gte")    return (row as any)[cond.col.name] >= (cond.val as any);
  if (cond.kind === "isNull") return (row as any)[cond.col.name] == null;
  if (cond.kind === "and")    return cond.conds.every((c) => evalCond(c, row));
  return true;
}

// ── DB query-builder helpers ──────────────────────────────────────────────────

function makeSelectChain(projection?: Record<string, { name: string }>) {
  const state: { where?: Cond; limit?: number } = {};
  const chain = {
    from(_table: unknown)  { return chain; },
    where(c: Cond)         { state.where = c; return chain; },
    orderBy(..._os: any[]) { return chain; },
    limit(n: number)       { state.limit = n; return chain; },
    offset(_n: number)     { return chain; },
    then(resolve: (rows: any[]) => void) {
      let rows = state.where
        ? store.rows.filter((r) => evalCond(state.where!, r))
        : [...store.rows];
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
      for (const row of matched) Object.assign(row, updates);
      return Promise.resolve(matched.map((r) => ({ id: r.id })));
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

// ── @workspace/db mock ────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  const db = {
    select: (projection?: Record<string, { name: string }>) => makeSelectChain(projection),
    delete: (_table: unknown) => ({
      where(_c: unknown) { return { then: (r: any) => r([])}; },
    }),
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
    biAdPerformance:          tableStub,
  };
});

// ── Configurable Gemini AI mock ───────────────────────────────────────────────

vi.mock("@workspace/integrations-gemini-ai", () => ({
  ai: {
    models: {
      generateContent: (...args: unknown[]) => mockGenerateContent(...args),
    },
  },
}));

// ── Configurable ADK Runner mock ──────────────────────────────────────────────

vi.mock("@google/adk", () => {
  class FunctionTool { constructor(_opts: unknown) {} }
  class LlmAgent     { constructor(_opts: unknown) {} }
  class Runner {
    sessionService = mockSessionService;
    runAsync = mockRunAsync;
    constructor(_opts: unknown) {}
  }
  return { FunctionTool, LlmAgent, Runner };
});

// ── Peripheral mocks so adk-agent.ts loads without side-effects ───────────────

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
  googleAds_listCampaigns:                 vi.fn(),
  googleAds_getCampaignDailyTrend:         vi.fn(),
  googleAds_searchCampaignsByName:         vi.fn(),
  shopify_getStoreInventoryHealth:         vi.fn(),
  shopify_getStoreRevenueSummary:          vi.fn(),
}));

vi.mock("../agents/infrastructure/prompts/loader", () => ({
  renderPrompt:        () => "",
  getPromptDescription: () => "",
  getToolDescription:  () => "",
}));

vi.mock("../lib/adk/drizzle-session-service", () => ({
  drizzleSessionService: mockSessionService,
  startSessionCleanup:   vi.fn(),
}));

vi.mock("../lib/ai-gads-usage", () => ({
  getOrgGuardrails:          vi.fn(async () => ({ maxLookbackDays: 180, dailyRowCap: 50000 })),
  checkAndIncrementUsage:    vi.fn(async () => ({ capExceeded: false, rowsAfter: 0, dailyRowCap: 50000 })),
  getTodayRowCount:          vi.fn(async () => 0),
  getRequestBudget:          vi.fn(() => 10000),
  DEFAULT_MAX_LOOKBACK_DAYS: 180,
  DEFAULT_DAILY_ROW_CAP:     50000,
}));

// ── Subject under test ────────────────────────────────────────────────────────

import { generateSmartTitle, runAdkAgent, APP_NAME } from "../services/adk-agent";

// ── Store helpers ─────────────────────────────────────────────────────────────

function seedSession(
  id: string,
  userId: string,
  overrides: Partial<Omit<FakeRow, "id" | "userId">> = {},
): void {
  store.rows.push({
    id,
    appName:    APP_NAME,
    userId,
    state:      {},
    events:     [],
    title:      null,
    pinned:     false,
    archivedAt: null,
    createdAt:  new Date("2026-04-22T00:00:00Z"),
    updatedAt:  new Date("2026-04-22T00:00:00Z"),
    ...overrides,
  });
}

// ── generateSmartTitle: happy path ────────────────────────────────────────────

describe("generateSmartTitle — happy path", () => {
  const userId    = "org:1:user:1";
  const sessionId = "sess-title-happy";

  beforeEach(() => {
    store.rows = [];
    seedSession(sessionId, userId);
    mockGenerateContent.mockResolvedValue({ text: "Google Ads Budget Analysis Report" });
  });

  it("stores the AI-generated title on the session", async () => {
    await generateSmartTitle(userId, sessionId, "Show me my budget-constrained campaigns", "Here are your capped campaigns…");

    const row = store.rows.find((r) => r.id === sessionId)!;
    expect(row.title).toBe("Google Ads Budget Analysis Report");
  });

  it("strips surrounding quotes the model sometimes adds", async () => {
    mockGenerateContent.mockResolvedValue({ text: '"Google Ads Budget Analysis Report"' });

    await generateSmartTitle(userId, sessionId, "Show me my capped campaigns", "Here are your capped campaigns…");

    const row = store.rows.find((r) => r.id === sessionId)!;
    expect(row.title).toBe("Google Ads Budget Analysis Report");
  });

  it("strips trailing punctuation the model sometimes adds", async () => {
    mockGenerateContent.mockResolvedValue({ text: "Google Ads Budget Analysis Report." });

    await generateSmartTitle(userId, sessionId, "Show me campaigns", "Here they are…");

    const row = store.rows.find((r) => r.id === sessionId)!;
    expect(row.title).not.toMatch(/\.$/);
    expect(row.title).toBe("Google Ads Budget Analysis Report");
  });
});

// ── generateSmartTitle: empty / out-of-range AI response ─────────────────────

describe("generateSmartTitle — empty AI response with empty prompt", () => {
  const userId    = "org:2:user:1";
  const sessionId = "sess-title-empty";

  beforeEach(() => {
    store.rows = [];
    seedSession(sessionId, userId);
    // Empty text from the model AND an empty userPrompt → cleanTitle remains ""
    mockGenerateContent.mockResolvedValue({ text: "" });
  });

  it("does not store a title when AI returns empty and user prompt is also empty", async () => {
    await generateSmartTitle(userId, sessionId, "", "");

    const row = store.rows.find((r) => r.id === sessionId)!;
    expect(row.title).toBeNull();
  });
});

describe("generateSmartTitle — single-word AI response falls back to prompt", () => {
  const userId    = "org:3:user:1";
  const sessionId = "sess-title-oneword";

  beforeEach(() => {
    store.rows = [];
    seedSession(sessionId, userId);
    // Single-word response is out of the 2-10 word range → triggers prompt fallback
    mockGenerateContent.mockResolvedValue({ text: "Campaigns" });
  });

  it("falls back to the user prompt when AI word count is out of range", async () => {
    const prompt = "Show me all my Google Ads campaigns";
    await generateSmartTitle(userId, sessionId, prompt, "Sure, here they are…");

    const row = store.rows.find((r) => r.id === sessionId)!;
    expect(row.title).not.toBeNull();
    expect(row.title).toBe(prompt);
  });
});

// ── generateSmartTitle: Gemini failure ───────────────────────────────────────

describe("generateSmartTitle — Gemini failure", () => {
  const userId    = "org:4:user:1";
  const sessionId = "sess-title-error";

  beforeEach(() => {
    store.rows = [];
    seedSession(sessionId, userId);
    mockGenerateContent.mockRejectedValue(new Error("Gemini 503 Service Unavailable"));
  });

  it("does not throw when Gemini throws", async () => {
    await expect(
      generateSmartTitle(userId, sessionId, "What campaigns are over budget?", "Let me check…"),
    ).resolves.not.toThrow();
  });

  it("leaves the session title unchanged when Gemini throws", async () => {
    await generateSmartTitle(userId, sessionId, "What campaigns are over budget?", "Let me check…");

    const row = store.rows.find((r) => r.id === sessionId)!;
    expect(row.title).toBeNull();
  });
});

// ── generateSmartTitle: race-condition guard ──────────────────────────────────

describe("generateSmartTitle — session already has a title (race-condition guard)", () => {
  const userId    = "org:5:user:1";
  const sessionId = "sess-title-race";

  beforeEach(() => {
    store.rows = [];
    // Session already has a manually set title
    seedSession(sessionId, userId, { title: "Manual Title Set By User" });
    mockGenerateContent.mockResolvedValue({ text: "AI Generated New Title Here" });
  });

  it("does not overwrite an existing title", async () => {
    await generateSmartTitle(userId, sessionId, "Show me campaigns", "Here they are…");

    const row = store.rows.find((r) => r.id === sessionId)!;
    expect(row.title).toBe("Manual Title Set By User");
  });
});

// ── runAdkAgent: isNewSession flag ────────────────────────────────────────────

describe("runAdkAgent — isNewSession flag", () => {
  // Each sub-suite uses a distinct orgId so the module-level Runner cache
  // does not carry state between tests.

  it("is true when no sessionId is provided (first call)", async () => {
    const userId = "org:10:user:1";

    mockSessionService.createSession.mockResolvedValue({ id: "new-session-10" });
    mockRunAsync.mockImplementation(async function* () { /* no events */ });

    const result = await runAdkAgent("Hello", userId, undefined, 10);

    expect(result.isNewSession).toBe(true);
    expect(result.sessionId).toBe("new-session-10");
  });

  it("is false when sessionId is provided and the session exists", async () => {
    const userId    = "org:11:user:1";
    const sessionId = "existing-session-11";

    // getSession returns the existing session object
    mockSessionService.getSession.mockResolvedValue({ id: sessionId, appName: APP_NAME, userId, events: [] });
    mockRunAsync.mockImplementation(async function* () { /* no events */ });

    const result = await runAdkAgent("Continue the conversation", userId, sessionId, 11);

    expect(result.isNewSession).toBe(false);
    expect(result.sessionId).toBe(sessionId);
  });

  it("is true when sessionId is provided but the session is not found (creates a new one)", async () => {
    const userId    = "org:12:user:1";
    const sessionId = "stale-session-12";

    // getSession returns null — session not found / belongs to another user
    mockSessionService.getSession.mockResolvedValue(null);
    mockSessionService.createSession.mockResolvedValue({ id: "replacement-session-12" });
    mockRunAsync.mockImplementation(async function* () { /* no events */ });

    const result = await runAdkAgent("Hello again", userId, sessionId, 12);

    expect(result.isNewSession).toBe(true);
    expect(result.sessionId).toBe("replacement-session-12");
  });
});
