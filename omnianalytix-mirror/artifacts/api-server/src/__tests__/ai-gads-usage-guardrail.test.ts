/**
 * Unit tests for the AI Google Ads row-cap guardrail logic.
 *
 * Covers:
 *   - getOrgGuardrails: org-specific values, null fallback, missing org fallback,
 *     DB-error fallback
 *   - checkAndIncrementUsage: happy path, cap-hit abort, UPSERT idempotency on
 *     repeated calls, nearingCap threshold (>80 %), fail-closed on DB error
 *   - getRequestBudget: pure arithmetic — normal, exhausted, low-remaining cases
 *   - windowClamped clamping math from get_campaign_performance: verifies that
 *     days = min(requested, maxLookback) and windowClamped = requested > max
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Logger stub ───────────────────────────────────────────────────────────────
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── drizzle-orm stubs (operators used inside ai-gads-usage.ts) ────────────────
vi.mock("drizzle-orm", () => {
  const eq  = (col: { name: string }, val: unknown) => ({ kind: "eq",  col, val });
  const and = (...conds: unknown[])                 => ({ kind: "and", conds });
  const sql: any = (strings: TemplateStringsArray, ...vals: unknown[]) =>
    ({ kind: "sql", strings, vals });
  sql.raw = (s: string) => ({ kind: "sql-raw", s });
  return { eq, and, sql };
});

// ── In-memory stores ──────────────────────────────────────────────────────────

interface OrgRow  { id: number; aiMaxLookbackDays: number | null; aiDailyRowCap: number | null }
interface UsageRow { organizationId: number; usageDate: string; rowsRead: number; queryCount: number }

const orgStore:   { rows: OrgRow[]   } = { rows: [] };
const usageStore: { rows: UsageRow[] } = { rows: [] };

/** Track what was written via insert().values().onConflictDoUpdate() */
const insertLog: Array<{ values: unknown; updateSet: unknown }> = [];

// ── @workspace/db mock ────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  // Minimal column descriptors so eq() comparisons work.
  const organizations = {
    id:                { name: "id" },
    aiMaxLookbackDays: { name: "aiMaxLookbackDays" },
    aiDailyRowCap:     { name: "aiDailyRowCap" },
  };

  const aiGadsDailyUsage = {
    organizationId: { name: "organizationId" },
    usageDate:      { name: "usageDate" },
    rowsRead:       { name: "rowsRead" },
    queryCount:     { name: "queryCount" },
    updatedAt:      { name: "updatedAt" },
  };

  function evalCond(cond: any, row: Record<string, unknown>): boolean {
    if (cond.kind === "eq")  return row[cond.col.name] === cond.val;
    if (cond.kind === "and") return (cond.conds as any[]).every((c) => evalCond(c, row));
    return true;
  }

  function makeSelectChain(store: { rows: Record<string, unknown>[] }, projection: string[]) {
    const state: { where?: any; lim?: number } = {};
    const chain = {
      from:  (_t: unknown) => chain,
      where: (c: any)      => { state.where = c; return chain; },
      limit: (n: number)   => { state.lim = n;   return chain; },
      then(resolve: (v: unknown[]) => void) {
        let rows = state.where
          ? store.rows.filter((r) => evalCond(state.where, r))
          : [...store.rows];
        if (state.lim != null) rows = rows.slice(0, state.lim);
        // Project only the requested fields.
        const projected = rows.map((r) => {
          const out: Record<string, unknown> = {};
          for (const k of projection) out[k] = r[k];
          return out;
        });
        resolve(projected);
      },
    };
    return chain;
  }

  // select() decides which store/projection to use based on the projection
  // object passed to it. We distinguish by the keys present.
  const db = {
    select(proj?: Record<string, { name: string }>) {
      // Determine which store we're querying from the projection keys.
      const keys = proj ? Object.keys(proj) : [];
      if (keys.includes("aiMaxLookbackDays") || keys.includes("aiDailyRowCap")) {
        const colNames = keys.length
          ? Object.values(proj!).map((c) => c.name)
          : ["id", "aiMaxLookbackDays", "aiDailyRowCap"];
        return makeSelectChain(orgStore as any, colNames);
      }
      // Default to usage store.
      const colNames = keys.length
        ? Object.values(proj!).map((c) => c.name)
        : ["organizationId", "usageDate", "rowsRead", "queryCount"];
      return makeSelectChain(usageStore as any, colNames);
    },

    insert(_table: unknown) {
      return {
        values(vals: unknown) {
          return {
            onConflictDoUpdate(opts: { set: unknown }) {
              const orgId   = (vals as any).organizationId;
              const date    = (vals as any).usageDate;
              const rowInc  = (vals as any).rowsRead ?? 0;
              const qInc    = (vals as any).queryCount ?? 0;
              insertLog.push({ values: vals, updateSet: opts.set });

              const existing = (usageStore.rows as UsageRow[]).find(
                (r) => r.organizationId === orgId && r.usageDate === date,
              );
              if (existing) {
                existing.rowsRead   += rowInc;
                existing.queryCount += qInc;
              } else {
                (usageStore.rows as UsageRow[]).push({
                  organizationId: orgId,
                  usageDate:      date,
                  rowsRead:       rowInc,
                  queryCount:     qInc,
                });
              }
              return Promise.resolve();
            },
          };
        },
      };
    },
  };

  return { db, organizations, aiGadsDailyUsage };
});

// ── Import the module under test AFTER mocks ──────────────────────────────────

import {
  getOrgGuardrails,
  checkAndIncrementUsage,
  getRequestBudget,
  DEFAULT_MAX_LOOKBACK_DAYS,
  DEFAULT_DAILY_ROW_CAP,
  PER_REQUEST_ROW_CAP,
} from "../lib/ai-gads-usage";

// ── Helpers ───────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("getOrgGuardrails", () => {
  beforeEach(() => {
    orgStore.rows = [];
  });

  it("returns org-specific values from the DB", async () => {
    orgStore.rows = [{ id: 1, aiMaxLookbackDays: 60, aiDailyRowCap: 10_000 }];
    const g = await getOrgGuardrails(1);
    expect(g.maxLookbackDays).toBe(60);
    expect(g.dailyRowCap).toBe(10_000);
  });

  it("falls back to platform defaults when org row is absent", async () => {
    const g = await getOrgGuardrails(99);
    expect(g.maxLookbackDays).toBe(DEFAULT_MAX_LOOKBACK_DAYS);
    expect(g.dailyRowCap).toBe(DEFAULT_DAILY_ROW_CAP);
  });

  it("falls back to platform defaults when guardrail columns are null", async () => {
    orgStore.rows = [{ id: 2, aiMaxLookbackDays: null, aiDailyRowCap: null }];
    const g = await getOrgGuardrails(2);
    expect(g.maxLookbackDays).toBe(DEFAULT_MAX_LOOKBACK_DAYS);
    expect(g.dailyRowCap).toBe(DEFAULT_DAILY_ROW_CAP);
  });

  it("falls back to platform defaults when the DB throws", async () => {
    const { db } = await import("@workspace/db");
    const original = (db as any).select;
    (db as any).select = () => { throw new Error("simulated DB failure"); };

    const g = await getOrgGuardrails(5);
    expect(g.maxLookbackDays).toBe(DEFAULT_MAX_LOOKBACK_DAYS);
    expect(g.dailyRowCap).toBe(DEFAULT_DAILY_ROW_CAP);

    (db as any).select = original;
  });
});

describe("checkAndIncrementUsage — happy path", () => {
  beforeEach(() => {
    usageStore.rows = [];
    insertLog.length = 0;
  });

  it("returns rowsBefore=0 and correct rowsAfter on the first call", async () => {
    const guardrails = { maxLookbackDays: 180, dailyRowCap: 50_000 };
    const result = await checkAndIncrementUsage(1, 1_000, guardrails);

    expect(result.rowsBefore).toBe(0);
    expect(result.rowsAfter).toBe(1_000);
    expect(result.capExceeded).toBe(false);
    expect(result.nearingCap).toBe(false);
    expect(result.dailyRowCap).toBe(50_000);
  });

  it("accumulates rows across repeated calls (UPSERT idempotency)", async () => {
    const guardrails = { maxLookbackDays: 180, dailyRowCap: 50_000 };
    const orgId = 2;

    const r1 = await checkAndIncrementUsage(orgId, 1_000, guardrails);
    expect(r1.rowsBefore).toBe(0);
    expect(r1.rowsAfter).toBe(1_000);

    const r2 = await checkAndIncrementUsage(orgId, 2_000, guardrails);
    expect(r2.rowsBefore).toBe(1_000);
    expect(r2.rowsAfter).toBe(3_000);

    const r3 = await checkAndIncrementUsage(orgId, 500, guardrails);
    expect(r3.rowsBefore).toBe(3_000);
    expect(r3.rowsAfter).toBe(3_500);

    // Three inserts should have been emitted.
    expect(insertLog).toHaveLength(3);

    // In-memory row should reflect the total.
    const stored = (usageStore.rows as any[]).find(
      (r) => r.organizationId === orgId && r.usageDate === today(),
    );
    expect(stored?.rowsRead).toBe(3_500);
    expect(stored?.queryCount).toBe(3);
  });
});

describe("checkAndIncrementUsage — cap-hit abort", () => {
  beforeEach(() => {
    usageStore.rows = [];
    insertLog.length = 0;
  });

  it("sets capExceeded=true when rowsAfter equals the daily cap", async () => {
    const cap = 5_000;
    const guardrails = { maxLookbackDays: 180, dailyRowCap: cap };

    // Seed existing usage at exactly cap - 100.
    usageStore.rows = [{
      organizationId: 3,
      usageDate:      today(),
      rowsRead:       cap - 100,
      queryCount:     10,
    }];

    const result = await checkAndIncrementUsage(3, 100, guardrails);
    expect(result.rowsAfter).toBe(cap);
    expect(result.capExceeded).toBe(true);
  });

  it("sets capExceeded=true when rowsAfter exceeds the daily cap", async () => {
    const cap = 5_000;
    const guardrails = { maxLookbackDays: 180, dailyRowCap: cap };

    usageStore.rows = [{
      organizationId: 4,
      usageDate:      today(),
      rowsRead:       cap - 50,
      queryCount:     5,
    }];

    const result = await checkAndIncrementUsage(4, 200, guardrails);
    expect(result.capExceeded).toBe(true);
    expect(result.rowsAfter).toBeGreaterThan(cap);
  });

  it("keeps capExceeded=false when rowsAfter is still below the cap", async () => {
    const guardrails = { maxLookbackDays: 180, dailyRowCap: 50_000 };
    const result = await checkAndIncrementUsage(5, 100, guardrails);
    expect(result.capExceeded).toBe(false);
  });
});

describe("checkAndIncrementUsage — nearingCap (>80 % warning)", () => {
  beforeEach(() => {
    usageStore.rows = [];
    insertLog.length = 0;
  });

  it("sets nearingCap=false when usage is below 80 % of cap", async () => {
    const cap = 10_000;
    const guardrails = { maxLookbackDays: 180, dailyRowCap: cap };

    // 79 % → still below threshold.
    usageStore.rows = [{
      organizationId: 10,
      usageDate:      today(),
      rowsRead:       7_800,
      queryCount:     5,
    }];

    const result = await checkAndIncrementUsage(10, 100, guardrails);
    expect(result.rowsAfter).toBe(7_900);
    expect(result.nearingCap).toBe(false);
  });

  it("sets nearingCap=true when usage crosses the 80 % threshold", async () => {
    const cap = 10_000;
    const guardrails = { maxLookbackDays: 180, dailyRowCap: cap };

    // Seed at 79 % then add enough to cross 80 %.
    usageStore.rows = [{
      organizationId: 11,
      usageDate:      today(),
      rowsRead:       7_900,
      queryCount:     8,
    }];

    const result = await checkAndIncrementUsage(11, 200, guardrails);
    // rowsAfter = 8 100 = 81 % → nearingCap should be true.
    expect(result.rowsAfter).toBe(8_100);
    expect(result.nearingCap).toBe(true);
    expect(result.usageFraction).toBeCloseTo(0.81, 2);
  });

  it("sets nearingCap=true when usage is exactly at 80 % of cap", async () => {
    const cap = 10_000;
    const guardrails = { maxLookbackDays: 180, dailyRowCap: cap };

    const result = await checkAndIncrementUsage(12, 8_000, guardrails);
    expect(result.rowsAfter).toBe(8_000);
    expect(result.nearingCap).toBe(true);
    expect(result.usageFraction).toBeCloseTo(0.8, 5);
  });
});

describe("checkAndIncrementUsage — fail-closed on DB error", () => {
  it("returns capExceeded=true and nearingCap=true when the DB throws", async () => {
    // Override the mock db.select to throw for this one test.
    const { db } = await import("@workspace/db");
    const original = (db as any).select;
    (db as any).select = () => { throw new Error("simulated DB failure"); };

    const guardrails = { maxLookbackDays: 180, dailyRowCap: 50_000 };
    const result = await checkAndIncrementUsage(99, 1_000, guardrails);

    expect(result.capExceeded).toBe(true);
    expect(result.nearingCap).toBe(true);
    expect(result.usageFraction).toBe(1);
    expect(result.rowsBefore).toBe(0);
    expect(result.rowsAfter).toBe(0);

    (db as any).select = original;
  });
});

describe("getRequestBudget", () => {
  it("returns PER_REQUEST_ROW_CAP when daily capacity is ample", () => {
    const guardrails = { maxLookbackDays: 180, dailyRowCap: 50_000 };
    const budget = getRequestBudget(0, guardrails);
    expect(budget).toBe(PER_REQUEST_ROW_CAP);
  });

  it("returns remaining capacity when it is smaller than PER_REQUEST_ROW_CAP", () => {
    const guardrails = { maxLookbackDays: 180, dailyRowCap: 50_000 };
    // Only 2 000 rows remaining (< 5 000 per-request cap).
    const budget = getRequestBudget(48_000, guardrails);
    expect(budget).toBe(2_000);
  });

  it("returns 0 when the daily cap is already exhausted", () => {
    const guardrails = { maxLookbackDays: 180, dailyRowCap: 50_000 };
    expect(getRequestBudget(50_000, guardrails)).toBe(0);
    expect(getRequestBudget(55_000, guardrails)).toBe(0);
  });

  it("caps the budget at PER_REQUEST_ROW_CAP even with plenty of daily capacity", () => {
    const guardrails = { maxLookbackDays: 180, dailyRowCap: 1_000_000 };
    expect(getRequestBudget(0, guardrails)).toBe(PER_REQUEST_ROW_CAP);
  });
});

// ── Window-clamping logic (mirrors the computation in get_campaign_performance) ─

describe("windowClamped clamping in get_campaign_performance", () => {
  /**
   * Replicates the two lines from adk-agent.ts:
   *   const days          = Math.min(requestedDays, guardrails.maxLookbackDays);
   *   const windowClamped = requestedDays > guardrails.maxLookbackDays;
   *
   * Tests that:
   *   - Requesting more days than the org limit → days is hard-capped and
   *     windowClamped is true.
   *   - Requesting days within the org limit → days is unchanged and
   *     windowClamped is false.
   *   - An org with a custom (short) lookback cap is enforced correctly.
   */

  function computeWindow(requestedDays: number, maxLookbackDays: number) {
    const days         = Math.min(requestedDays, maxLookbackDays);
    const windowClamped = requestedDays > maxLookbackDays;
    return { days, windowClamped };
  }

  it("clamps days and sets windowClamped=true when requested > org max", () => {
    const { days, windowClamped } = computeWindow(365, 180);
    expect(days).toBe(180);
    expect(windowClamped).toBe(true);
  });

  it("leaves days unchanged and windowClamped=false when requested <= org max", () => {
    const { days, windowClamped } = computeWindow(30, 180);
    expect(days).toBe(30);
    expect(windowClamped).toBe(false);
  });

  it("exactly at the limit: days = limit and windowClamped=false", () => {
    const { days, windowClamped } = computeWindow(180, 180);
    expect(days).toBe(180);
    expect(windowClamped).toBe(false);
  });

  it("respects a short org-specific cap (e.g. 30 days)", () => {
    const { days, windowClamped } = computeWindow(90, 30);
    expect(days).toBe(30);
    expect(windowClamped).toBe(true);
  });

  it("getOrgGuardrails feeds the correct maxLookbackDays to the clamping step", async () => {
    orgStore.rows = [{ id: 7, aiMaxLookbackDays: 45, aiDailyRowCap: 20_000 }];
    const guardrails = await getOrgGuardrails(7);

    const { days, windowClamped } = computeWindow(90, guardrails.maxLookbackDays);
    expect(guardrails.maxLookbackDays).toBe(45);
    expect(days).toBe(45);
    expect(windowClamped).toBe(true);
  });
});
