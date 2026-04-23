/**
 * shopping-insider-cost-alerter.ts — Task #42
 *
 * Periodically samples the Shopping Insider cache counters
 * (`getCacheMetrics()` from `shopping-insider-cache.ts`) and fires a
 * Sentry alert whenever:
 *   - BigQuery `bytesBilled` over a rolling window exceeds a configured
 *     threshold (runaway spend — e.g. a deploy that broke the cache key
 *     and is re-billing every request), or
 *   - The cache `hitRate` over a rolling window falls below a configured
 *     floor (cache effectively offline).
 *
 * Configuration (all optional — alerter is a no-op unless at least one
 * threshold is set, which keeps local dev / CI silent):
 *
 * | Env var | Default | Meaning |
 * | --- | --- | --- |
 * | `SHOPPING_INSIDER_ALERT_INTERVAL_MS` | `300000` (5 min) | How often the alerter samples the metrics endpoint. |
 * | `SHOPPING_INSIDER_ALERT_WINDOW_MS` | `3600000` (1 h) | Rolling window across which deltas are computed. |
 * | `SHOPPING_INSIDER_ALERT_BYTES_THRESHOLD` | unset | Fire when bytesBilled within the window exceeds this many bytes. |
 * | `SHOPPING_INSIDER_ALERT_HITRATE_FLOOR` | unset | Fire when hitRate within the window falls below this fraction (0..1). |
 * | `SHOPPING_INSIDER_ALERT_MIN_SAMPLES` | `20` | Skip the hit-rate check until at least this many requests landed inside the window (avoids noisy alerts at low traffic). |
 * | `SHOPPING_INSIDER_ALERT_COOLDOWN_MS` | `3600000` (1 h) | Minimum gap between two fires for the same alert kind. |
 *
 * Alerts are emitted via `captureServerException` so they ride the
 * existing Sentry surface configured in `monitoring.ts` — there's
 * nothing extra for on-call to wire up. When Sentry isn't configured
 * (no `SENTRY_DSN`) the alerter still logs at `warn` level so the
 * incident is at least visible in the API server logs.
 */

import { getCacheMetrics, type CacheCounters } from "./shopping-insider-cache";
import { captureServerException } from "./monitoring";
import { logger } from "./logger";
import { loadAlerterConfigOverrides, applyOverrides } from "./alerter-config-store";
import { db, shoppingInsiderCostSamples } from "@workspace/db";

interface Sample {
  ts: number;
  hits: number;
  misses: number;
  bytesBilled: number;
  bytesAvoided: number;
}

export interface AlerterConfig {
  intervalMs: number;
  windowMs: number;
  bytesThreshold: number | null;
  hitRateFloor: number | null;
  minSamples: number;
  cooldownMs: number;
}

export type AlertKind = "bytes_billed_spike" | "hit_rate_floor";

export interface WindowStats {
  windowMs: number;
  hits: number;
  misses: number;
  bytesBilled: number;
  bytesAvoided: number;
  hitRate: number | null;
}

export interface AlertStatus {
  lastAlertKind: AlertKind | null;
  lastAlertAt: number | null;
  currentWindow: WindowStats | null;
  alerterEnabled: boolean;
}

function readNumber(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function loadAlerterConfig(): AlerterConfig {
  return {
    intervalMs: readNumber("SHOPPING_INSIDER_ALERT_INTERVAL_MS") ?? 5 * 60 * 1000,
    windowMs: readNumber("SHOPPING_INSIDER_ALERT_WINDOW_MS") ?? 60 * 60 * 1000,
    bytesThreshold: readNumber("SHOPPING_INSIDER_ALERT_BYTES_THRESHOLD"),
    hitRateFloor: readNumber("SHOPPING_INSIDER_ALERT_HITRATE_FLOOR"),
    minSamples: readNumber("SHOPPING_INSIDER_ALERT_MIN_SAMPLES") ?? 20,
    cooldownMs: readNumber("SHOPPING_INSIDER_ALERT_COOLDOWN_MS") ?? 60 * 60 * 1000,
  };
}

export function alerterEnabled(cfg: AlerterConfig): boolean {
  return cfg.bytesThreshold !== null || cfg.hitRateFloor !== null;
}

/**
 * Pure helper: given the current rolling buffer of samples and the most
 * recent counter snapshot, returns the deltas across the configured
 * window. Exported for testing.
 */
export function computeWindowStats(
  buffer: Sample[],
  current: Sample,
  windowMs: number,
  now: number,
): WindowStats {
  const cutoff = now - windowMs;
  // Pick the oldest sample that's still inside the window — falling back
  // to the very first sample we have if the buffer hasn't filled the
  // window yet. That under-reports rather than over-reports, which is
  // the safe direction for a cost alert.
  let baseline: Sample | undefined;
  for (const s of buffer) {
    if (s.ts >= cutoff) {
      baseline = s;
      break;
    }
  }
  if (!baseline) baseline = buffer[0] ?? current;

  const hits = Math.max(0, current.hits - baseline.hits);
  const misses = Math.max(0, current.misses - baseline.misses);
  const bytesBilled = Math.max(0, current.bytesBilled - baseline.bytesBilled);
  const bytesAvoided = Math.max(0, current.bytesAvoided - baseline.bytesAvoided);
  const total = hits + misses;
  return {
    windowMs: now - baseline.ts,
    hits,
    misses,
    bytesBilled,
    bytesAvoided,
    hitRate: total === 0 ? null : hits / total,
  };
}

function totalsToSample(totals: CacheCounters, ts: number): Sample {
  return {
    ts,
    hits: totals.hits,
    misses: totals.misses,
    bytesBilled: totals.bytesBilled,
    bytesAvoided: totals.bytesAvoided,
  };
}

/**
 * Decide whether the current window deltas warrant an alert. Pure
 * function, exported for testing.
 */
export function evaluateAlerts(
  stats: WindowStats,
  cfg: AlerterConfig,
): AlertKind[] {
  const fired: AlertKind[] = [];
  if (cfg.bytesThreshold !== null && stats.bytesBilled > cfg.bytesThreshold) {
    fired.push("bytes_billed_spike");
  }
  if (
    cfg.hitRateFloor !== null &&
    stats.hits + stats.misses >= cfg.minSamples &&
    stats.hitRate !== null &&
    stats.hitRate < cfg.hitRateFloor
  ) {
    fired.push("hit_rate_floor");
  }
  return fired;
}

class CostAlerter {
  private buffer: Sample[] = [];
  private lastFiredAt: Partial<Record<AlertKind, number>> = {};
  private timer: NodeJS.Timeout | null = null;
  private cfg: AlerterConfig;
  /** Immutable snapshot of the env/default config at construction time.
   *  DB overrides are applied against this fresh base each tick so that
   *  clearing an override reliably reverts to the original default. */
  private readonly baseCfg: AlerterConfig;
  private lastAlertKind: AlertKind | null = null;
  private lastAlertAt: number | null = null;
  private lastWindowStats: WindowStats | null = null;

  constructor(cfg: AlerterConfig) {
    this.baseCfg = { ...cfg };
    this.cfg = { ...cfg };
  }

  getStatus(): AlertStatus {
    return {
      lastAlertKind: this.lastAlertKind,
      lastAlertAt: this.lastAlertAt,
      currentWindow: this.lastWindowStats,
      alerterEnabled: alerterEnabled(this.cfg),
    };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((err) =>
        logger.warn({ err }, "[ShoppingInsiderCostAlerter] tick failed (non-fatal)"),
      );
    }, this.cfg.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Test hook — run one sampling tick synchronously. */
  async tick(now: number = Date.now()): Promise<AlertKind[]> {
    // Re-read DB overrides on every tick so threshold changes take effect
    // immediately without a server restart.  Always apply against the
    // immutable baseCfg so that clearing a DB override reliably reverts to
    // the env/default value rather than the previously-merged value.
    try {
      const overrides = await loadAlerterConfigOverrides();
      this.cfg = applyOverrides(this.baseCfg, overrides);
    } catch {
      // If the DB is unreachable, keep using the last known config.
    }

    const metrics = await getCacheMetrics();
    const sample = totalsToSample(metrics.totals, now);

    // Evaluate against the buffer BEFORE pushing the new sample so the
    // baseline is genuinely older than `now`.
    const stats = computeWindowStats(this.buffer, sample, this.cfg.windowMs, now);
    this.lastWindowStats = stats;

    this.buffer.push(sample);
    // Drop samples older than the window (keep one extra so we always
    // have a baseline anchored at-or-before the window edge).
    const cutoff = now - this.cfg.windowMs;
    let drop = 0;
    while (drop + 1 < this.buffer.length && this.buffer[drop + 1].ts < cutoff) {
      drop += 1;
    }
    if (drop > 0) this.buffer.splice(0, drop);

    // Persist this tick's window stats for cost-trend history.
    void db
      .insert(shoppingInsiderCostSamples)
      .values({
        sampledAt: new Date(now),
        bytesBilled: stats.bytesBilled,
        bytesAvoided: stats.bytesAvoided,
        hits: stats.hits,
        misses: stats.misses,
        hitRate: stats.hitRate ?? null,
        windowMs: stats.windowMs,
      })
      .catch((err: unknown) =>
        logger.warn(
          { err },
          "[ShoppingInsiderCostAlerter] failed to persist cost sample (non-fatal)",
        ),
      );

    const fired = evaluateAlerts(stats, this.cfg);
    const reported: AlertKind[] = [];
    for (const kind of fired) {
      const last = this.lastFiredAt[kind] ?? -Infinity;
      if (now - last < this.cfg.cooldownMs) continue;
      this.lastFiredAt[kind] = now;
      reported.push(kind);
      this.report(kind, stats, now);
    }
    return reported;
  }

  private report(kind: AlertKind, stats: WindowStats, now: number = Date.now()): void {
    this.lastAlertKind = kind;
    this.lastAlertAt = now;
    const message =
      kind === "bytes_billed_spike"
        ? `Shopping Insider BigQuery bytesBilled (${stats.bytesBilled}) exceeded threshold ${this.cfg.bytesThreshold} over the last ${stats.windowMs}ms`
        : `Shopping Insider cache hitRate (${stats.hitRate}) fell below floor ${this.cfg.hitRateFloor} over the last ${stats.windowMs}ms (${stats.hits + stats.misses} samples)`;

    logger.warn(
      {
        kind,
        bytesBilled: stats.bytesBilled,
        bytesAvoided: stats.bytesAvoided,
        hitRate: stats.hitRate,
        hits: stats.hits,
        misses: stats.misses,
        windowMs: stats.windowMs,
        bytesThreshold: this.cfg.bytesThreshold,
        hitRateFloor: this.cfg.hitRateFloor,
      },
      `[ShoppingInsiderCostAlerter] ${message}`,
    );

    captureServerException(new Error(message), {
      extra: {
        alert: "shopping_insider_cost",
        kind,
        bytesBilled: stats.bytesBilled,
        bytesAvoided: stats.bytesAvoided,
        hitRate: stats.hitRate,
        hits: stats.hits,
        misses: stats.misses,
        windowMs: stats.windowMs,
        bytesThreshold: this.cfg.bytesThreshold,
        hitRateFloor: this.cfg.hitRateFloor,
      },
    });
  }
}

let singleton: CostAlerter | null = null;

/**
 * Start the cost alerter. Called once during server boot.
 *
 * The alerter always starts now — even when no env-var thresholds are set —
 * so that DB overrides saved via the admin UI take effect immediately on the
 * next tick without requiring a redeploy.  `evaluateAlerts` is a no-op when
 * both thresholds remain null, so there is no false-positive risk.
 */
export function startShoppingInsiderCostAlerter(): { started: boolean } {
  const cfg = loadAlerterConfig();
  if (singleton) return { started: true };
  singleton = new CostAlerter(cfg);
  singleton.start();

  if (alerterEnabled(cfg)) {
    logger.info(
      {
        intervalMs: cfg.intervalMs,
        windowMs: cfg.windowMs,
        bytesThreshold: cfg.bytesThreshold,
        hitRateFloor: cfg.hitRateFloor,
      },
      "[ShoppingInsiderCostAlerter] started (env thresholds active)",
    );
  } else {
    logger.info(
      { intervalMs: cfg.intervalMs, windowMs: cfg.windowMs },
      "[ShoppingInsiderCostAlerter] started (no env thresholds — will activate when DB overrides are set via admin UI)",
    );
  }
  return { started: true };
}

/** Test-only: build a fresh alerter against an explicit config. */
export function createCostAlerterForTests(cfg: AlerterConfig): {
  tick: (now?: number) => Promise<AlertKind[]>;
  stop: () => void;
} {
  const a = new CostAlerter(cfg);
  return { tick: (now) => a.tick(now), stop: () => a.stop() };
}

/**
 * Return the current alert status from the running singleton.
 * - The alerter always starts now (even with no env thresholds) so DB-saved
 *   values activate on the next tick.  `alerterEnabled` reflects whether at
 *   least one threshold is currently non-null (env OR DB).
 * - Before the first tick completes, `currentWindow`, `lastAlertKind`, and
 *   `lastAlertAt` are null.
 * - After the first tick the `currentWindow` is always populated; alert
 *   fields remain null until a threshold is actually breached.
 */
export function getShoppingInsiderAlertStatus(): AlertStatus {
  if (!singleton) {
    return { lastAlertKind: null, lastAlertAt: null, currentWindow: null, alerterEnabled: false };
  }
  return singleton.getStatus();
}

/** Test-only: stop and forget the singleton. */
export function _resetCostAlerterForTests(): void {
  if (singleton) {
    singleton.stop();
    singleton = null;
  }
}

/** Test-only: run one tick on the live singleton (if any). */
export async function _tickShoppingInsiderAlerterForTests(
  now?: number,
): Promise<AlertKind[]> {
  if (!singleton) return [];
  return singleton.tick(now);
}
