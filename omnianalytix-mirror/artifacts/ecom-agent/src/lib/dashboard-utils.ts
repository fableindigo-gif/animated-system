/**
 * dashboard-utils.ts
 * ──────────────────
 * Pure utility functions shared between the dashboard components and their
 * test suites. Extracted so vitest can import them without a DOM or Vite
 * alias resolver.
 */

export const STALE_MS = 24 * 60 * 60 * 1_000;

export interface PoP {
  pct: number | null;
  direction: "up" | "down" | "flat" | "na";
}

/**
 * Compute a period-over-period delta.
 *
 * Returns { direction: "na" } when either value is missing, non-finite, or
 * when `previous` is zero (division by zero guard). A ±0.5 % dead-band
 * around zero is treated as "flat" to suppress noise.
 */
export function computePoP(
  current: number | null | undefined,
  previous: number | null | undefined,
): PoP {
  if (current == null || !Number.isFinite(current)) return { pct: null, direction: "na" };
  if (previous == null || !Number.isFinite(previous) || previous === 0) {
    return { pct: null, direction: "na" };
  }
  const pct = (current - previous) / previous;
  const direction = pct > 0.005 ? "up" : pct < -0.005 ? "down" : "flat";
  return { pct, direction };
}

export interface SyncTimestamps {
  latestAdsSyncAt?: string | null;
  lastSyncedAt?: number | null;
}

/**
 * Returns true when the most recent sync is older than STALE_MS.
 * Deliberately returns false (not stale) when no timestamp is available —
 * a brand-new tenant with no sync history should not see the stale banner.
 *
 * @param timestamps  The relevant fields from the KPI payload.
 * @param now         Injectable clock so tests can freeze time.
 */
export function isSyncStale(
  timestamps: SyncTimestamps,
  now: number = Date.now(),
): boolean {
  const candidate =
    (timestamps.latestAdsSyncAt ? Date.parse(timestamps.latestAdsSyncAt) : null) ??
    timestamps.lastSyncedAt ??
    null;
  if (candidate == null || !Number.isFinite(candidate)) return false;
  return now - candidate > STALE_MS;
}

/**
 * Returns true when a campaign row should be shown when "hide inactive" is on.
 *
 * Mirrors the predicate in performance-grid.tsx exactly:
 *   channels.filter(c => !((c.status ?? "").toUpperCase() === "PAUSED" && (c.spend ?? 0) === 0))
 *
 * A row is hidden ONLY when BOTH conditions hold: status is "PAUSED" (case-
 * insensitive) AND spend is zero or null. A paused campaign that still spends
 * remains visible; an enabled/active zero-spend campaign also remains visible.
 */
export function shouldShowWhenHideInactive(row: {
  status?: string | null;
  spend?: number | null;
}): boolean {
  return !((row.status ?? "").toUpperCase() === "PAUSED" && (row.spend ?? 0) === 0);
}
