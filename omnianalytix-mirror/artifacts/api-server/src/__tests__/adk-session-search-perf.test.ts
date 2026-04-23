/**
 * ADK Session Search — Performance Regression Test (Integration)
 *
 * Connects to the real Postgres database to verify that ILIKE search across
 * the `adk_sessions.events` column stays within the 150 ms latency budget
 * at scale (5 000+ sessions per user).
 *
 * This test exercises the actual database index path:
 *   1. Ensures the pg_trgm extension and GIN trigram index are present
 *      (applying lib/db/migrations/0001_adk_sessions_events_trgm_idx.sql).
 *   2. Seeds SESSION_COUNT (5 001) real rows into `adk_sessions`.
 *   3. Runs the same ILIKE query used by listAdkSessions and asserts it
 *      completes within LATENCY_BUDGET_MS (150 ms).
 *   4. Cleans up every row it inserted so CI runs are idempotent.
 *
 * Regressions caught: GIN index removal, migration drift, planner changes.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

// ── Configuration ─────────────────────────────────────────────────────────────

const SESSION_COUNT     = 5_001;
const LATENCY_BUDGET_MS = 150;
const SEARCH_TERM       = "unique-needle-trgm-perf-xyz";
const APP_NAME          = "omni_analytix";
// Use a deterministic test-only userId so cleanup is reliable.
const TEST_USER_ID      = "org:0:user:perf-test-trgm";

// ── DB helpers ────────────────────────────────────────────────────────────────

let pool: pg.Pool;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  // Assert preconditions — do NOT auto-repair.  If either check fails the test
  // suite fails immediately, signalling that a required migration was not applied
  // (regression detected before any latency measurement is attempted).

  const extRow = await pool.query<{ count: string }>(
    `SELECT count(*)::int AS count FROM pg_extension WHERE extname = 'pg_trgm'`,
  );
  if (Number(extRow.rows[0].count) === 0) {
    throw new Error(
      "pg_trgm extension is missing — apply lib/db/migrations/0001_adk_sessions_events_trgm_idx.sql",
    );
  }

  const idxRow = await pool.query<{ count: string }>(
    `SELECT count(*)::int AS count FROM pg_indexes
      WHERE tablename = 'adk_sessions'
        AND indexname = 'adk_sessions_events_trgm_idx'`,
  );
  if (Number(idxRow.rows[0].count) === 0) {
    throw new Error(
      "GIN trigram index adk_sessions_events_trgm_idx is missing — " +
      "apply lib/db/migrations/0001_adk_sessions_events_trgm_idx.sql",
    );
  }

  // Seed SESSION_COUNT rows.  Only the last one contains the search needle.
  await pool.query("DELETE FROM adk_sessions WHERE user_id = $1", [TEST_USER_ID]);

  const now = new Date();
  const insertValues: unknown[] = [];
  const placeholders: string[]  = [];

  for (let i = 0; i < SESSION_COUNT; i++) {
    const text = i === SESSION_COUNT - 1 ? SEARCH_TERM : `generic message ${i}`;
    const events = JSON.stringify([
      { content: { role: "user", parts: [{ text }] }, timestamp: i },
    ]);
    const updatedAt = new Date(now.getTime() + i * 1000).toISOString();
    const base = i * 6;
    placeholders.push(
      `($${base + 1},$${base + 2},$${base + 3},'{}','false',NULL,$${base + 4},$${base + 5},$${base + 6})`,
    );
    insertValues.push(
      `sess-trgm-perf-${i}`,
      APP_NAME,
      TEST_USER_ID,
      events,
      updatedAt,
      updatedAt,
    );
  }

  await pool.query(
    `INSERT INTO adk_sessions (id, app_name, user_id, state, pinned, archived_at, events, created_at, updated_at)
     VALUES ${placeholders.join(",")}`,
    insertValues,
  );
}, 60_000);

afterAll(async () => {
  await pool.query("DELETE FROM adk_sessions WHERE user_id = $1", [TEST_USER_ID]);
  await pool.end();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("conversation search performance — real Postgres with GIN trigram index", () => {
  it(`lists sessions without a search filter within ${LATENCY_BUDGET_MS} ms`, async () => {
    const start = performance.now();

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::int AS count
         FROM adk_sessions
        WHERE app_name = $1
          AND user_id  = $2
          AND archived_at IS NULL`,
      [APP_NAME, TEST_USER_ID],
    );

    const elapsed = performance.now() - start;
    expect(Number(rows[0].count)).toBe(SESSION_COUNT);
    expect(elapsed).toBeLessThan(LATENCY_BUDGET_MS);
  });

  it(`ILIKE search across ${SESSION_COUNT} sessions returns 1 match within ${LATENCY_BUDGET_MS} ms`, async () => {
    const pattern = `%${SEARCH_TERM}%`;

    const start = performance.now();

    const { rows } = await pool.query<{ id: string }>(
      `SELECT id
         FROM adk_sessions
        WHERE app_name            = $1
          AND user_id             = $2
          AND archived_at IS NULL
          AND events::text ILIKE  $3`,
      [APP_NAME, TEST_USER_ID, pattern],
    );

    const elapsed = performance.now() - start;

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(`sess-trgm-perf-${SESSION_COUNT - 1}`);
    expect(elapsed).toBeLessThan(LATENCY_BUDGET_MS);
  });

  it(`ILIKE search that matches nothing completes within ${LATENCY_BUDGET_MS} ms`, async () => {
    const pattern = "%this-term-does-not-appear-anywhere-ever%";

    const start   = performance.now();
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id
         FROM adk_sessions
        WHERE app_name            = $1
          AND user_id             = $2
          AND archived_at IS NULL
          AND events::text ILIKE  $3`,
      [APP_NAME, TEST_USER_ID, pattern],
    );
    const elapsed = performance.now() - start;

    expect(rows).toHaveLength(0);
    expect(elapsed).toBeLessThan(LATENCY_BUDGET_MS);
  });

  it("GIN trigram index exists on the events column", async () => {
    const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef
         FROM pg_indexes
        WHERE tablename = 'adk_sessions'
          AND indexname = 'adk_sessions_events_trgm_idx'`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/gin/i);
    expect(rows[0].indexdef).toMatch(/gin_trgm_ops/i);
  });

  it("query planner does not perform a sequential scan for the ILIKE search", async () => {
    const pattern = `%${SEARCH_TERM}%`;

    const { rows } = await pool.query<{ "QUERY PLAN": string }>(
      `EXPLAIN (FORMAT TEXT)
       SELECT id
         FROM adk_sessions
        WHERE app_name            = $1
          AND user_id             = $2
          AND archived_at IS NULL
          AND events::text ILIKE  $3`,
      [APP_NAME, TEST_USER_ID, pattern],
    );

    const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
    // The planner must use an index (btree on app_name/user_id or GIN trigram)
    // rather than a full sequential scan.  A seq scan would degrade linearly
    // with table size; any index strategy keeps query time bounded.
    expect(plan).not.toMatch(/Seq Scan/i);
  });
});
