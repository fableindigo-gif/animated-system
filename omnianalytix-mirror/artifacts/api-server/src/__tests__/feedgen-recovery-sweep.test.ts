/**
 * FeedGen recovery sweeper — proves stuck rows are auto-recovered.
 *
 * Coverage:
 *   1. Rows in `processing` with stale `generated_at` (past the 30-min
 *      PROCESSING_TIMEOUT_MS cutoff) are flipped to `failed` with
 *      error_code = 'WORKER_CRASHED_MID_BATCH' when runFeedgenRecoverySweep()
 *      is called.
 *   2. Rows still inside the timeout window are NOT touched.
 *   3. GET /system-health via the real production router (routes/index.ts)
 *      reports a live `feedgenRecovery.currentStuckCount` and flips the
 *      top-level `status` to 'degraded' when that count is nonzero.
 *
 * All tests run against real Postgres (DATABASE_URL). Sub-routers and
 * unrelated middleware are stubbed; only the /system-health handler's
 * production code (+ DB-backed FeedGen functions) actually executes.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";

// ── Logger ────────────────────────────────────────────────────────────────────
vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

// ── Non-FeedGen system-health deps ────────────────────────────────────────────
// One passing check so results.length > 0 — otherwise status short-circuits
// to 'pending' before feedgenRecoveryStuck can take effect.
vi.mock("../services/system-health-monitor", () => ({
  getLastHealthResults: () => ({
    results: [{ ok: true, label: "db", detail: "ok" }],
    lastRunAt: new Date().toISOString(),
  }),
}));
vi.mock("../workers/quality-fixes-scanner", () => ({
  getQualityFixesScannerStatus: () => ({ lastErrorCode: null }),
  getPendingQualityFixesCount:  async () => 0,
}));

// ── Sub-routers: all stubbed as empty routers ─────────────────────────────────
// vi.mock factories are hoisted so factory literals must be inline
// (cannot reference top-level variables defined after the mock block).
vi.mock("../routes/health",              () => ({ default: express.Router() }));
vi.mock("../routes/gemini",              () => ({ default: express.Router() }));
vi.mock("../routes/connections",         () => ({ default: express.Router() }));
vi.mock("../routes/auth",                () => ({ default: express.Router() }));
vi.mock("../routes/actions",             () => ({ default: express.Router() }));
vi.mock("../routes/reports",             () => ({ default: express.Router() }));
vi.mock("../routes/compliance",          () => ({ default: express.Router() }));
vi.mock("../routes/inventory",           () => ({ default: express.Router() }));
vi.mock("../routes/customers",           () => ({ default: express.Router() }));
vi.mock("../routes/shopify",             () => ({ default: express.Router() }));
vi.mock("../routes/system",              () => ({ default: express.Router() }));
vi.mock("../routes/google-ads",          () => ({ default: express.Router() }));
vi.mock("../routes/live-triage",         () => ({ default: express.Router() }));
vi.mock("../routes/mcp/index",           () => ({ mcpRouter: express.Router() }));
vi.mock("../routes/analytics",           () => ({ default: express.Router() }));
vi.mock("../routes/crm",                 () => ({ default: express.Router() }));
vi.mock("../routes/insights",            () => ({ default: express.Router() }));
vi.mock("../routes/fx",                  () => ({ default: express.Router() }));
vi.mock("../routes/etl",                 () => ({ default: express.Router() }));
vi.mock("../routes/dashboard",           () => ({ default: express.Router() }));
vi.mock("../routes/warehouse",           () => ({ default: express.Router() }));
vi.mock("../routes/team",                () => ({ default: express.Router() }));
vi.mock("../routes/tasks",               () => ({ default: express.Router() }));
vi.mock("../routes/webhooks",            () => ({ default: express.Router() }));
vi.mock("../routes/webhooks/master-bus", () => ({ default: express.Router() }));
vi.mock("../routes/workspaces",          () => ({ default: express.Router() }));
vi.mock("../routes/organizations",       () => ({ default: express.Router() }));
vi.mock("../routes/infrastructure",      () => ({ default: express.Router() }));
vi.mock("../routes/billing",             () => ({ default: express.Router() }));
vi.mock("../routes/billing-hub",         () => ({ default: express.Router() }));
vi.mock("../routes/looker",              () => ({ default: express.Router() }));
vi.mock("../routes/ai-creative",         () => ({ default: express.Router() }));
vi.mock("../routes/feed-enrichment",     () => ({ default: express.Router() }));
vi.mock("../routes/ai-agents",           () => ({ default: express.Router() }));
vi.mock("../routes/promo-engine",        () => ({ default: express.Router() }));
vi.mock("../routes/resolution-library",  () => ({ default: express.Router() }));
vi.mock("../routes/data-modeling",       () => ({ default: express.Router() }));
vi.mock("../routes/data-upload",         () => ({ default: express.Router() }));
vi.mock("../routes/byodb",               () => ({ default: express.Router() }));
vi.mock("../routes/leads",               () => ({ default: express.Router() }));
vi.mock("../routes/admin",               () => ({ default: express.Router() }));
vi.mock("../routes/financials",          () => ({ default: express.Router() }));
vi.mock("../routes/saved-views",         () => ({ default: express.Router() }));
vi.mock("../routes/users",               () => ({ default: express.Router() }));
vi.mock("../routes/copilot",             () => ({ default: express.Router() }));
vi.mock("../routes/bi",                  () => ({ default: express.Router() }));
vi.mock("../routes/me",                  () => ({ default: express.Router() }));
vi.mock("../routes/leadgen",             () => ({ default: express.Router() }));
vi.mock("../routes/hybrid",              () => ({ default: express.Router() }));
vi.mock("../routes/invite",              () => ({ default: express.Router() }));
vi.mock("../routes/platform",            () => ({ default: express.Router() }));
vi.mock("../routes/integrations",        () => ({ default: express.Router() }));
vi.mock("../routes/adk",                 () => ({ default: express.Router() }));
vi.mock("../routes/adk-proto",           () => ({ default: express.Router() }));
vi.mock("../routes/gaarf",               () => ({ default: express.Router() }));
vi.mock("../routes/settings",            () => ({ default: express.Router() }));

// ── Middleware stubs ──────────────────────────────────────────────────────────
vi.mock("../middleware/rbac", () => ({
  requireRole:  () => (_req: any, _res: any, next: any) => next(),
  readGuard:    () => (_req: any, _res: any, next: any) => next(),
  attachUser:   () => (_req: any, _res: any, next: any) => next(),
  requireAuth:  () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../middleware/super-admin", () => ({
  requireSuperAdmin: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../middleware/mutation-logger", () => ({
  mutationLogger: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../middleware/connection-guard", () => ({
  requireActiveConnection: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../middleware/rate-limiter", () => ({
  authRateLimit:         (_req: any, _res: any, next: any) => next(),
  warehouseRateLimit:    (_req: any, _res: any, next: any) => next(),
  sharedReportRateLimit: (_req: any, _res: any, next: any) => next(),
  geminiRateLimit:       (_req: any, _res: any, next: any) => next(),
  connectionsRateLimit:  (_req: any, _res: any, next: any) => next(),
  actionsRateLimit:      (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../lib/route-error-handler", () => ({
  handleRouteError: (_err: unknown, _req: any, res: any, _label: string, body: any) =>
    res.status(500).json(body),
}));

// ── Imports (after all mocks) ─────────────────────────────────────────────────
import supertest from "supertest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  runFeedgenRecoverySweep,
  FEEDGEN_RECOVERY_ERROR_CODE,
} from "../workers/feedgen-runner";

// Real production router — /system-health handler loaded with mocked sub-routers
// and middleware. The FeedGen DB functions inside the handler use real Postgres.
import productionRouter from "../routes/index";

const app = express();
app.use(productionRouter);

// ── Constants ─────────────────────────────────────────────────────────────────
const TENANT = "test-feedgen-recovery-sweep";
const STALE_OFFSET_MS = 40 * 60 * 1000; // past the 30-min PROCESSING_TIMEOUT_MS
const FRESH_OFFSET_MS =  5 * 60 * 1000; // inside the window

// ── Helpers ───────────────────────────────────────────────────────────────────
async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM product_feedgen_rewrites WHERE tenant_id = ${TENANT}`);
}

async function seedProcessingRows(count: number, offsetMs: number, prefix: string): Promise<void> {
  const ts = new Date(Date.now() - offsetMs);
  for (let i = 0; i < count; i++) {
    const id  = `${TENANT}:${prefix}:${i}`;
    const sku = `sku-${prefix}-${i}`;
    await db.execute(sql`
      INSERT INTO product_feedgen_rewrites
        (id, tenant_id, product_id, sku, status, generated_at)
      VALUES (${id}, ${TENANT}, ${sku}, ${sku}, 'processing', ${ts})
      ON CONFLICT (id) DO UPDATE SET status = 'processing', generated_at = ${ts}
    `);
  }
}

async function fetchRows(
  prefix: string,
): Promise<Array<{ id: string; status: string; error_code: string | null }>> {
  const like = `sku-${prefix}-%`;
  const r = await db.execute(sql`
    SELECT id, status, error_code
    FROM   product_feedgen_rewrites
    WHERE  tenant_id = ${TENANT} AND sku LIKE ${like}
  `);
  return (r as unknown as { rows: Array<{ id: string; status: string; error_code: string | null }> }).rows;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
beforeAll(async () => { await cleanup(); });
afterAll(async ()  => { await cleanup(); });

// ── Test 1 ────────────────────────────────────────────────────────────────────
describe("runFeedgenRecoverySweep — stale processing rows", () => {
  it("flips stuck rows to failed with error_code WORKER_CRASHED_MID_BATCH", async () => {
    await seedProcessingRows(3, STALE_OFFSET_MS, "stale");

    const result = await runFeedgenRecoverySweep();
    expect(result.recovered).toBeGreaterThanOrEqual(3);

    const rows = await fetchRows("stale");
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.status).toBe("failed");
      expect(row.error_code).toBe(FEEDGEN_RECOVERY_ERROR_CODE);
      expect(row.error_code).toBe("WORKER_CRASHED_MID_BATCH");
    }
  });
});

// ── Test 2 ────────────────────────────────────────────────────────────────────
describe("runFeedgenRecoverySweep — fresh processing rows", () => {
  it("does NOT touch rows still inside the timeout window", async () => {
    await seedProcessingRows(3, FRESH_OFFSET_MS, "fresh");

    await runFeedgenRecoverySweep();

    const rows = await fetchRows("fresh");
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.status).toBe("processing");
  });
});

// ── Test 3: real HTTP call to the production route ────────────────────────────
describe("GET /system-health (real routes/index.ts production handler)", () => {
  it("reports nonzero currentStuckCount and status=degraded when stuck rows exist", async () => {
    await cleanup();
    await seedProcessingRows(2, STALE_OFFSET_MS, "health-check");

    const res = await supertest(app).get("/system-health");

    expect(res.status).toBe(200);
    expect(res.body.feedgenRecovery.currentStuckCount).toBeGreaterThanOrEqual(2);
    expect(res.body.status).toBe("degraded");
  });

  it("reports zero currentStuckCount and status=operational when no rows are stuck", async () => {
    await cleanup();

    const res = await supertest(app).get("/system-health");

    expect(res.status).toBe(200);
    expect(res.body.feedgenRecovery.currentStuckCount).toBe(0);
    // One passing health check (mocked) + zero stuck → operational.
    expect(res.body.status).toBe("operational");
  });
});
