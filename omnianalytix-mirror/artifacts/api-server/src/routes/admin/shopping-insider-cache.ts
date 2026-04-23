import { Router } from "express";
import { getCacheMetrics } from "../../lib/shopping-insider-cache";
import { getShoppingInsiderAlertStatus } from "../../lib/shopping-insider-cost-alerter";
import { db, shoppingInsiderCostSamples } from "@workspace/db";
import { desc } from "drizzle-orm";

const router = Router();

/**
 * GET /api/admin/shopping-insider-cache
 * Returns counters for the 1-hour Shopping Insider BigQuery cache so we
 * can confirm the cost reduction from Task #21 in monitoring/dashboards.
 *
 * Shape:
 *  {
 *    ttlMs: number,
 *    cacheSize: number,                      // current live entries
 *    perFunction: {
 *      [fnName]: {
 *        hits, misses,
 *        bytesAvoided,                       // BigQuery bytes the cache saved
 *        bytesBilled,                        // BigQuery bytes still spent on misses
 *        hitRate                             // hits / (hits + misses)  | null
 *      }
 *    },
 *    totals: { hits, misses, bytesAvoided, bytesBilled, hitRate }
 *  }
 *
 * Auth: mounted under `/admin`, which already requires the `admin` role
 * via the parent router (see routes/index.ts).
 */
router.get("/", async (_req, res, next) => {
  try {
    const metrics = await getCacheMetrics();
    res.json({ ok: true, ...metrics });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/shopping-insider-cache/alert-status
 * Returns the most recent BigQuery spend alert state from the in-process
 * cost alerter singleton. Lets the system health dashboard surface spend
 * spikes and cache-floor breaches without requiring Sentry access.
 *
 * Shape:
 *  {
 *    alerterEnabled: boolean,
 *    lastAlertKind: "bytes_billed_spike" | "hit_rate_floor" | null,
 *    lastAlertAt: number | null,    // Unix ms timestamp
 *    currentWindow: {
 *      windowMs, hits, misses, bytesBilled, bytesAvoided, hitRate
 *    } | null
 *  }
 */
router.get("/alert-status", (_req, res) => {
  const status = getShoppingInsiderAlertStatus();
  res.json({ ok: true, ...status });
});

/**
 * GET /api/admin/shopping-insider-cache/history?limit=N
 *
 * Returns the last N persisted alerter-tick samples from the
 * `shopping_insider_cost_samples` table, ordered newest-first.
 * Default limit is 168 (one week of hourly ticks at the 5-min alerter
 * interval would be ~2016 rows; 168 is a pragmatic "one week at hourly"
 * view suitable for a trend chart without overwhelming the payload).
 *
 * Response shape:
 *  { ok: true, samples: Array<{ id, sampledAt, bytesBilled, bytesAvoided,
 *                               hits, misses, hitRate, windowMs }> }
 */
router.get("/history", async (req, res, next) => {
  try {
    const raw = Number(req.query["limit"]);
    const limit = Number.isInteger(raw) && raw > 0 && raw <= 10_000 ? raw : 168;

    const samples = await db
      .select()
      .from(shoppingInsiderCostSamples)
      .orderBy(desc(shoppingInsiderCostSamples.sampledAt))
      .limit(limit);

    res.json({ ok: true, samples });
  } catch (err) {
    next(err);
  }
});

export default router;
