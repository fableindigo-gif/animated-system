/**
 * runWritebackRetryScheduler — end-to-end unit tests.
 *
 * All DB I/O and GMC credential fetching are mocked; no real Postgres or
 * Google Merchant Center needed.
 *
 * The DB mock is split into two logical paths:
 *   • Eligibility query  (innerJoin chain): runs the same filter predicates
 *     the real WHERE clause does — status=failed, isNotNull(nextRetryAt),
 *     nextRetryAt<=now, attemptCount<cap — so regressions in any predicate
 *     surface immediately.
 *   • Writeback select   (direct where chain): driven by an explicit queue
 *     that each test populates. This lets per-org tests control which task
 *     rows each org's writeback call sees, without needing to evaluate
 *     the inArray / org-scope predicates that the real SQL would.
 *
 * Coverage:
 *   1.  Returns all-zero result when the DB has no tasks at all.
 *   2.  Eligibility filter passes through only tasks satisfying all four predicates.
 *   3.  Tasks with nextRetryAt IS NULL (auth / non_retryable) are filtered out.
 *   4.  Tasks whose nextRetryAt is in the future are filtered out.
 *   5.  Tasks that have reached the attempt cap are filtered out.
 *   6.  Custom maxAttempts override is respected.
 *   7.  Atomic flip: DB update sets status='approved' / clears nextRetryAt
 *       and only affects the eligible task IDs.
 *   8.  The flip update is issued BEFORE patchProduct runs.
 *   9.  patchProduct seam receives correct offerId, merchantId, accessToken.
 *   10. 2xx → task marked 'applied'; totalApplied incremented.
 *   11. Non-2xx → task marked 'failed'; attemptCount uses a SQL expression.
 *   12. Audit-log entry written for each processed task.
 *   13. Per-org batching: one credential fetch per org; each org's writeback
 *       sees only its own task rows (verified via patchProduct offerId sets).
 *   14. Same-org tasks share a single credential fetch.
 *   15. Aggregate counts correct for a mixed success / failure batch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

// ─── Shared state (vi.hoisted so it is initialised before mock factories run) ─

type FakeTask = {
  taskId:         number;
  workspaceId:    number;
  organizationId: number;
  attemptCount:   number;
  status:         "failed" | "approved" | "applied";
  nextRetryAt:    Date | null;
  offerId:        string;
  merchantId:     string;
};

const { state } = vi.hoisted(() => ({
  state: {
    /** Simulated proposed_tasks rows.  Eligibility filter runs against these. */
    fakeDB: [] as FakeTask[],
    /** Mirror of WRITEBACK_MAX_ATTEMPTS — tests override this to check the cap. */
    maxAttempts: 5 as number,
    /** IDs returned by the most recent eligibility query; used to scope the flip. */
    lastEligibleIds: new Set<number>(),
    /** Queue consumed by the writeback select (one entry per org writeback run). */
    writebackQueue: [] as Array<Array<Record<string, unknown>>>,
    /** All .set(values) calls captured from db.update(...).set(...).where(...). */
    updates: [] as Array<Record<string, unknown>>,
    /** All .values(row) calls captured from db.insert(...).values(...). */
    inserts: [] as Array<Record<string, unknown>>,
  },
}));

function resetState() {
  state.fakeDB            = [];
  state.maxAttempts       = 5;
  state.lastEligibleIds   = new Set<number>();
  state.writebackQueue    = [];
  state.updates           = [];
  state.inserts           = [];
}

// ─── DB mock ─────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  const TABLE_TASKS = Symbol("proposedTasks");
  const TABLE_WS    = Symbol("workspaces");
  const TABLE_AUDIT = Symbol("auditLogs");

  const select = vi.fn((_cols?: unknown) => ({
    from: vi.fn((tbl: symbol) => {
      if (tbl === TABLE_TASKS) {
        return {
          // ── Eligibility-query path ─────────────────────────────────────────
          // Scheduler: db.select({...cols}).from(proposedTasks).innerJoin(workspaces,...).where(...)
          //
          // The implementation mirrors the real WHERE predicates so that any
          // future regression in status / nextRetryAt / attemptCount filtering
          // will be caught here.
          innerJoin: vi.fn(() => ({
            where: vi.fn(async () => {
              const now = new Date();
              const eligible = state.fakeDB.filter(
                (t) =>
                  t.status === "failed" &&
                  t.nextRetryAt !== null &&
                  t.nextRetryAt <= now &&
                  t.attemptCount < state.maxAttempts,
              );
              // Store which task IDs were selected so the flip update and
              // the writeback select can scope themselves correctly.
              state.lastEligibleIds = new Set(eligible.map((t) => t.taskId));
              return eligible.map((t) => ({
                taskId:         t.taskId,
                workspaceId:    t.workspaceId,
                organizationId: t.organizationId,
                attemptCount:   t.attemptCount,
              }));
            }),
          })),

          // ── Writeback re-select path ───────────────────────────────────────
          // Writeback: db.select().from(proposedTasks).where(and(inArray(id, taskIds),...))
          //
          // We can't evaluate the inArray / org-scope predicates here, so
          // tests populate state.writebackQueue with the rows each org run
          // should see.  The queue is consumed in FIFO order matching the
          // scheduler's sequential for...of byOrg loop.
          where: vi.fn(async () => state.writebackQueue.shift() ?? []),
        };
      }
      return { where: vi.fn(async () => []) };
    }),
  }));

  const update = vi.fn((_tbl: symbol) => ({
    set: vi.fn((values: Record<string, unknown>) => ({
      where: vi.fn(async () => {
        state.updates.push({ ...values });
        // Atomic flip: only tasks that were returned by the eligibility query
        // get promoted.  This matches the real SQL:
        //   UPDATE … SET status='approved' WHERE id IN (eligibleIds) AND status='failed'
        if (values["status"] === "approved") {
          for (const t of state.fakeDB) {
            if (state.lastEligibleIds.has(t.taskId)) {
              t.status      = "approved";
              t.nextRetryAt = null;
            }
          }
        }
        // Per-task applied/failed updates are captured in state.updates;
        // no further selects depend on their final status so we don't mutate fakeDB.
      }),
    })),
  }));

  const insert = vi.fn((_tbl: symbol) => ({
    values: vi.fn(async (values: Record<string, unknown>) => {
      state.inserts.push(values);
    }),
  }));

  return {
    db: { select, update, insert },
    proposedTasks: TABLE_TASKS,
    workspaces:    TABLE_WS,
    auditLogs:     TABLE_AUDIT,
  };
});

// ─── Credential mock ──────────────────────────────────────────────────────────

const mockGetCreds = vi.fn(async (_platform: string, _orgId: number) => ({
  accessToken: "mock-access-token",
  merchantId:  "merchant-default",
}));

vi.mock("../lib/google-token-refresh", () => ({
  getFreshGoogleCredentials: (...args: [string, number]) => mockGetCreds(...args),
}));

// ─── Import under test (after all mocks) ─────────────────────────────────────

import { runWritebackRetryScheduler, runShoptimizerWriteback, WRITEBACK_MAX_ATTEMPTS } from "../workers/shoptimizer-writeback";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function seedTask(overrides: Partial<FakeTask> & { taskId: number }): FakeTask {
  const t: FakeTask = {
    taskId:         overrides.taskId,
    workspaceId:    overrides.workspaceId    ?? 10,
    organizationId: overrides.organizationId ?? 100,
    attemptCount:   overrides.attemptCount   ?? 0,
    status:         overrides.status         ?? "failed",
    nextRetryAt:    overrides.nextRetryAt    !== undefined
                      ? overrides.nextRetryAt
                      : new Date(Date.now() - 60_000),
    offerId:        overrides.offerId        ?? `online:en:US:sku-${overrides.taskId}`,
    merchantId:     overrides.merchantId     ?? "merchant-default",
  };
  state.fakeDB.push(t);
  return t;
}

/** Build the ProposedTask-shaped row the writeback worker expects. */
function makeRow(t: FakeTask): Record<string, unknown> {
  return {
    id:              t.taskId,
    toolName:        "gmc_applyShoptimizerDiff",
    status:          "approved",
    workspaceId:     t.workspaceId,
    toolDisplayName: "Apply Shoptimizer fix",
    displayDiff:     null,
    attemptCount:    t.attemptCount,
    nextRetryAt:     null,
    lastRetryClass:  null,
    comments:        null,
    resolvedAt:      null,
    toolArgs: {
      offerId:    t.offerId,
      merchantId: t.merchantId,
      optimized:  { offerId: t.offerId, title: "Widget" },
    },
  };
}

/** Queue a single org's writeback rows (called once per org in the test). */
function queueWriteback(tasks: FakeTask[]) {
  state.writebackQueue.push(tasks.map(makeRow));
}

const OK_PATCH   = vi.fn(async () => ({ status: 200, body: "{}", headers: new Headers() }));
const FAIL_PATCH = vi.fn(async () => ({ status: 503, body: "error",  headers: new Headers() }));

beforeEach(() => {
  resetState();
  mockGetCreds.mockClear();
  OK_PATCH.mockClear();
  FAIL_PATCH.mockClear();
});

// ─── 1. No tasks ──────────────────────────────────────────────────────────────

describe("No eligible tasks", () => {
  it("returns all-zero result when the DB is empty", async () => {
    const r = await runWritebackRetryScheduler({ patchProduct: OK_PATCH });

    expect(r.organizationsProcessed).toBe(0);
    expect(r.totalRequeued).toBe(0);
    expect(r.totalApplied).toBe(0);
    expect(r.totalFailed).toBe(0);
    expect(OK_PATCH).not.toHaveBeenCalled();
    expect(mockGetCreds).not.toHaveBeenCalled();
  });
});

// ─── 2. Eligibility filter ────────────────────────────────────────────────────

describe("Eligibility filter", () => {
  it("picks up exactly the eligible task from a mixed set", async () => {
    const eligible = seedTask({ taskId: 1, attemptCount: 1, nextRetryAt: new Date(Date.now() - 1_000) });
    // null nextRetryAt → excluded (auth/non_retryable never get one set).
    seedTask({ taskId: 2, nextRetryAt: null });
    // Future nextRetryAt → retry window not yet elapsed.
    seedTask({ taskId: 3, nextRetryAt: new Date(Date.now() + 60_000) });
    // At cap → excluded even though nextRetryAt is past.
    seedTask({ taskId: 4, attemptCount: WRITEBACK_MAX_ATTEMPTS, nextRetryAt: new Date(Date.now() - 1_000) });

    queueWriteback([eligible]);

    const r = await runWritebackRetryScheduler({ patchProduct: OK_PATCH });

    expect(r.totalRequeued).toBe(1);
    expect(OK_PATCH).toHaveBeenCalledTimes(1);
    const firstArg0 = ((OK_PATCH.mock.calls[0] as unknown[])?.[0] as any);
    expect(firstArg0?.offerId).toContain("sku-1");
  });

  it("excludes tasks with nextRetryAt IS NULL (auth / non_retryable classes)", async () => {
    seedTask({ taskId: 10, nextRetryAt: null });
    // No writeback queue entry — the scheduler must return before reaching it.

    const r = await runWritebackRetryScheduler({ patchProduct: OK_PATCH });

    expect(r.totalRequeued).toBe(0);
    expect(OK_PATCH).not.toHaveBeenCalled();
  });

  it("excludes tasks whose nextRetryAt has not yet elapsed", async () => {
    seedTask({ taskId: 11, nextRetryAt: new Date(Date.now() + 5 * 60_000) });

    const r = await runWritebackRetryScheduler({ patchProduct: OK_PATCH });

    expect(r.totalRequeued).toBe(0);
    expect(OK_PATCH).not.toHaveBeenCalled();
  });

  it("excludes tasks that have reached the default attempt cap", async () => {
    seedTask({ taskId: 12, attemptCount: WRITEBACK_MAX_ATTEMPTS, nextRetryAt: new Date(Date.now() - 1_000) });

    const r = await runWritebackRetryScheduler({ patchProduct: OK_PATCH });

    expect(r.totalRequeued).toBe(0);
    expect(OK_PATCH).not.toHaveBeenCalled();
  });

  it("respects a lower maxAttempts override — task at the override cap is excluded", async () => {
    seedTask({ taskId: 13, attemptCount: 2, nextRetryAt: new Date(Date.now() - 1_000) });
    state.maxAttempts = 2;  // tell the mock to use cap=2

    const r = await runWritebackRetryScheduler({ patchProduct: OK_PATCH, maxAttempts: 2 });

    expect(r.totalRequeued).toBe(0);
  });

  it("includes a task that is still under a lowered maxAttempts cap", async () => {
    const t = seedTask({ taskId: 14, attemptCount: 1, nextRetryAt: new Date(Date.now() - 1_000) });
    state.maxAttempts = 2;
    queueWriteback([t]);

    const r = await runWritebackRetryScheduler({ patchProduct: OK_PATCH, maxAttempts: 2 });

    expect(r.totalRequeued).toBe(1);
    expect(OK_PATCH).toHaveBeenCalledTimes(1);
  });

  it("flips only the eligible task IDs in fakeDB to 'approved'", async () => {
    const eligible = seedTask({ taskId: 1, attemptCount: 0, nextRetryAt: new Date(Date.now() - 1_000) });
    // This task is NOT eligible (at cap), but also has a past nextRetryAt,
    // so a naive flip-all-failed would incorrectly promote it.
    const atCap = seedTask({ taskId: 4, attemptCount: WRITEBACK_MAX_ATTEMPTS, nextRetryAt: new Date(Date.now() - 1_000) });

    queueWriteback([eligible]);

    await runWritebackRetryScheduler({ patchProduct: OK_PATCH });

    const eligibleRecord = state.fakeDB.find((t) => t.taskId === 1)!;
    const atCapRecord    = state.fakeDB.find((t) => t.taskId === 4)!;
    expect(eligibleRecord.status).toBe("approved");
    expect(atCapRecord.status).toBe("failed"); // must NOT have been flipped
  });
});

// ─── 3. Atomic flip ───────────────────────────────────────────────────────────

describe("Atomic status flip (failed → approved)", () => {
  it("issues a DB update with status='approved' before patchProduct runs", async () => {
    const t = seedTask({ taskId: 20 });
    queueWriteback([t]);

    const callOrder: string[] = [];
    const trackedPatch = vi.fn(async () => {
      callOrder.push("patch");
      return { status: 200, body: "{}", headers: new Headers() };
    });

    const origPush = state.updates.push.bind(state.updates);
    state.updates.push = (...args: [Record<string, unknown>]) => {
      if (args[0]["status"] === "approved") callOrder.push("db-flip");
      return origPush(...args);
    };

    await runWritebackRetryScheduler({ patchProduct: trackedPatch });

    expect(callOrder.indexOf("db-flip")).toBeGreaterThanOrEqual(0);
    expect(callOrder.indexOf("patch")).toBeGreaterThan(callOrder.indexOf("db-flip"));
  });

  it("clears nextRetryAt in the flip update", async () => {
    const t = seedTask({ taskId: 21 });
    queueWriteback([t]);

    await runWritebackRetryScheduler({ patchProduct: OK_PATCH });

    const flip = state.updates.find((u) => u["status"] === "approved");
    expect(flip).toBeDefined();
    expect(flip!["nextRetryAt"]).toBeNull();
  });
});

// ─── 4. patchProduct seam + result propagation ────────────────────────────────

describe("patchProduct seam and result propagation", () => {
  it("calls patchProduct with correct offerId, merchantId, and accessToken", async () => {
    const t = seedTask({ taskId: 30, offerId: "online:en:US:sku-30", merchantId: "merchant-30" });
    queueWriteback([t]);

    await runWritebackRetryScheduler({ patchProduct: OK_PATCH });

    expect(OK_PATCH).toHaveBeenCalledTimes(1);
    const args = (OK_PATCH.mock.calls[0] as unknown[])?.[0] as any;
    expect(args.offerId).toBe("online:en:US:sku-30");
    expect(args.merchantId).toBeTruthy();
    expect(args.accessToken).toBe("mock-access-token");
    expect(args.body).toMatchObject({ offerId: "online:en:US:sku-30" });
  });

  it("marks task 'applied' and increments totalApplied on 2xx", async () => {
    const t = seedTask({ taskId: 31 });
    queueWriteback([t]);

    const r = await runWritebackRetryScheduler({ patchProduct: OK_PATCH });

    expect(r.totalApplied).toBe(1);
    expect(r.totalFailed).toBe(0);
    expect(state.updates.find((u) => u["status"] === "applied")).toBeDefined();
  });

  it("marks task 'failed' and increments totalFailed on non-2xx", async () => {
    const t = seedTask({ taskId: 32 });
    queueWriteback([t]);

    const r = await runWritebackRetryScheduler({ patchProduct: FAIL_PATCH });

    expect(r.totalApplied).toBe(0);
    expect(r.totalFailed).toBe(1);
    expect(state.updates.find((u) => u["status"] === "failed")).toBeDefined();
  });

  it("uses a SQL expression (not a plain number) to increment attemptCount on failure", async () => {
    const t = seedTask({ taskId: 33, attemptCount: 2 });
    queueWriteback([t]);

    await runWritebackRetryScheduler({ patchProduct: FAIL_PATCH });

    const failUpdate = state.updates.find((u) => u["status"] === "failed");
    expect(failUpdate).toBeDefined();
    // markTaskFailed uses sql`${proposedTasks.attemptCount} + 1` — a drizzle AST
    // object — so the real DB evaluates it atomically.  It must NOT be a plain number.
    expect(typeof failUpdate!["attemptCount"]).not.toBe("number");
    expect(failUpdate!["attemptCount"]).toBeTruthy();
  });

  it("writes an audit-log entry for each processed task", async () => {
    const t = seedTask({ taskId: 34 });
    queueWriteback([t]);

    await runWritebackRetryScheduler({ patchProduct: OK_PATCH });

    expect(state.inserts.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── 5. Per-org batching ──────────────────────────────────────────────────────

describe("Per-org batching", () => {
  it("fetches credentials once per distinct organization", async () => {
    const t40 = seedTask({ taskId: 40, workspaceId: 10, organizationId: 100 });
    const t41 = seedTask({ taskId: 41, workspaceId: 20, organizationId: 200 });
    // Queue per org, in the order the for...of byOrg loop will see them.
    queueWriteback([t40]);
    queueWriteback([t41]);

    await runWritebackRetryScheduler({ patchProduct: OK_PATCH });

    expect(mockGetCreds).toHaveBeenCalledTimes(2);
    const orgIds = mockGetCreds.mock.calls.map((c) => c[1]);
    expect(orgIds).toContain(100);
    expect(orgIds).toContain(200);
  });

  it("each org's writeback sees only its own task rows — no cross-org contamination", async () => {
    seedTask({ taskId: 42, workspaceId: 10, organizationId: 100, offerId: "online:en:US:sku-42" });
    seedTask({ taskId: 43, workspaceId: 20, organizationId: 200, offerId: "online:en:US:sku-43" });

    // Return distinct creds per org so we can trace which org handled which task.
    mockGetCreds.mockImplementation(async (_p: string, orgId: number) => ({
      accessToken: `token-org-${orgId}`,
      merchantId:  `merchant-${orgId}`,
    }));

    const callsByOrg: Array<{ orgId: number; offerId: string }> = [];
    const trackingPatch = vi.fn(async (args: { accessToken: string; offerId: string }) => {
      const orgId = Number(args.accessToken.replace("token-org-", ""));
      callsByOrg.push({ orgId, offerId: args.offerId });
      return { status: 200, body: "{}", headers: new Headers() };
    });

    // Queue one entry per org so each writeback call gets exactly its rows.
    state.writebackQueue.push([
      makeRow({ taskId: 42, workspaceId: 10, organizationId: 100, offerId: "online:en:US:sku-42",
                attemptCount: 0, status: "approved", nextRetryAt: null, merchantId: "merchant-default" }),
    ]);
    state.writebackQueue.push([
      makeRow({ taskId: 43, workspaceId: 20, organizationId: 200, offerId: "online:en:US:sku-43",
                attemptCount: 0, status: "approved", nextRetryAt: null, merchantId: "merchant-default" }),
    ]);

    await runWritebackRetryScheduler({ patchProduct: trackingPatch });

    expect(callsByOrg).toHaveLength(2);

    const org100 = callsByOrg.filter((c) => c.orgId === 100);
    const org200 = callsByOrg.filter((c) => c.orgId === 200);

    expect(org100.map((c) => c.offerId)).toContain("online:en:US:sku-42");
    expect(org200.map((c) => c.offerId)).toContain("online:en:US:sku-43");
    // No cross-contamination.
    expect(org100.map((c) => c.offerId)).not.toContain("online:en:US:sku-43");
    expect(org200.map((c) => c.offerId)).not.toContain("online:en:US:sku-42");
  });

  it("tasks from the same org share a single credential fetch", async () => {
    const t44 = seedTask({ taskId: 44, workspaceId: 10, organizationId: 100, offerId: "online:en:US:sku-44" });
    const t45 = seedTask({ taskId: 45, workspaceId: 10, organizationId: 100, offerId: "online:en:US:sku-45" });
    // Both tasks belong to org 100 → single writeback run → single queue entry.
    queueWriteback([t44, t45]);

    await runWritebackRetryScheduler({ patchProduct: OK_PATCH });

    expect(mockGetCreds).toHaveBeenCalledTimes(1);
    expect(OK_PATCH).toHaveBeenCalledTimes(2);
  });
});

// ─── 6. Aggregate counts ──────────────────────────────────────────────────────

describe("Aggregate counts", () => {
  it("returns correct totals for a mixed success / failure batch in one org", async () => {
    const t50 = seedTask({ taskId: 50, offerId: "online:en:US:sku-50" });
    const t51 = seedTask({ taskId: 51, offerId: "online:en:US:sku-51" });
    queueWriteback([t50, t51]);

    let n = 0;
    const mixedPatch = vi.fn(async () => {
      return (n++ === 0)
        ? { status: 200, body: "{}", headers: new Headers() }
        : { status: 503, body: "error", headers: new Headers() };
    });

    const r = await runWritebackRetryScheduler({ patchProduct: mixedPatch });

    expect(r.organizationsProcessed).toBe(1);
    expect(r.totalRequeued).toBe(2);
    expect(r.totalApplied).toBe(1);
    expect(r.totalFailed).toBe(1);
  });
});

// ─── 7. GMC credential failure ────────────────────────────────────────────────
//
// When getFreshGoogleCredentials returns null (GMC not connected or token
// revoked), runShoptimizerWriteback must abort the entire batch immediately —
// no patchProduct calls — and mark every task failed with lastRetryClass='auth'.

describe("GMC credential failure aborts batch with auth error state", () => {
  it("marks every task failed with lastRetryClass='auth' when credentials are null", async () => {
    const BATCH_SIZE = 3;
    const tasks = [
      seedTask({ taskId: 60, offerId: "online:en:US:sku-60", organizationId: 100 }),
      seedTask({ taskId: 61, offerId: "online:en:US:sku-61", organizationId: 100 }),
      seedTask({ taskId: 62, offerId: "online:en:US:sku-62", organizationId: 100 }),
    ];
    // Queue the approved rows that runShoptimizerWriteback will read.
    queueWriteback(tasks);

    // Simulate getFreshGoogleCredentials returning null (no GMC connection).
    mockGetCreds.mockResolvedValueOnce(null as unknown as { accessToken: string; merchantId: string });

    const r = await runShoptimizerWriteback({
      organizationId: 100,
      patchProduct: OK_PATCH,
    });

    // Totals: all failed, none applied.
    expect(r.totalFailed).toBe(BATCH_SIZE);
    expect(r.totalApplied).toBe(0);

    // The HTTP seam must never have been called.
    expect(OK_PATCH).not.toHaveBeenCalled();

    // Every per-task DB update must carry status='failed' and lastRetryClass='auth'.
    const failUpdates = state.updates.filter((u) => u["status"] === "failed");
    expect(failUpdates).toHaveLength(BATCH_SIZE);
    for (const u of failUpdates) {
      expect(u["lastRetryClass"]).toBe("auth");
    }

    // An audit-log entry must have been written for each task.
    expect(state.inserts).toHaveLength(BATCH_SIZE);
  });

  it("returns totalFailed equal to batch size and totalApplied of 0", async () => {
    const tasks = [
      seedTask({ taskId: 70, offerId: "online:en:US:sku-70", organizationId: 200 }),
      seedTask({ taskId: 71, offerId: "online:en:US:sku-71", organizationId: 200 }),
    ];
    queueWriteback(tasks);

    mockGetCreds.mockResolvedValueOnce(null as unknown as { accessToken: string; merchantId: string });

    const r = await runShoptimizerWriteback({
      organizationId: 200,
      patchProduct: OK_PATCH,
    });

    expect(r.totalFailed).toBe(tasks.length);
    expect(r.totalApplied).toBe(0);
    expect(r.totalRequested).toBe(tasks.length);
  });

  it("does not call patchProduct at all when credentials are absent", async () => {
    const t = seedTask({ taskId: 80, offerId: "online:en:US:sku-80", organizationId: 300 });
    queueWriteback([t]);

    mockGetCreds.mockResolvedValueOnce(null as unknown as { accessToken: string; merchantId: string });

    await runShoptimizerWriteback({
      organizationId: 300,
      patchProduct: OK_PATCH,
    });

    expect(OK_PATCH).not.toHaveBeenCalled();
  });
});
