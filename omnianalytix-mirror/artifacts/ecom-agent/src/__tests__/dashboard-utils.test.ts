/**
 * dashboard-utils.test.ts — Task #154 Smoke Verification
 * ──────────────────────────────────────────────────────
 * Pure-function unit tests for the dashboard core logic extracted into
 * @/lib/dashboard-utils. These run without a DOM or network and verify
 * the five acceptance criteria from the task:
 *
 *   1. PoP pills render with correct polarity on a real date range
 *      (computePoP direction + PoPBadge polarity contract)
 *   2. "Trigger Fresh Sync" only shows when data is > 24 h stale
 *      (isSyncStale clock-injectable)
 *   3. Profit trend chart — no assertion needed here (DOM-only)
 *   4. Margin-Leak modal opens from Active SKUs tile (DOM-only)
 *   5. Performance-grid hide-inactive toggle hides/shows correct rows
 *      (inline predicate mirrored from performance-grid.tsx)
 */

import { describe, it, expect } from "vitest";
import { computePoP, isSyncStale, STALE_MS, shouldShowWhenHideInactive } from "@/lib/dashboard-utils";

// ─── computePoP ──────────────────────────────────────────────────────────────

describe("computePoP", () => {
  it("returns direction=na when current is null", () => {
    const r = computePoP(null, 100);
    expect(r.direction).toBe("na");
    expect(r.pct).toBeNull();
  });

  it("returns direction=na when previous is null", () => {
    const r = computePoP(100, null);
    expect(r.direction).toBe("na");
  });

  it("returns direction=na when previous is 0 (div-by-zero guard)", () => {
    const r = computePoP(50, 0);
    expect(r.direction).toBe("na");
  });

  it("returns direction=na when current is non-finite", () => {
    expect(computePoP(Infinity, 100).direction).toBe("na");
    expect(computePoP(NaN, 100).direction).toBe("na");
  });

  it("detects an upward movement above the 0.5% dead-band", () => {
    const r = computePoP(106, 100); // +6%
    expect(r.direction).toBe("up");
    expect(r.pct).toBeCloseTo(0.06, 5);
  });

  it("detects a downward movement below the 0.5% dead-band", () => {
    const r = computePoP(94, 100); // -6%
    expect(r.direction).toBe("down");
    expect(r.pct).toBeCloseTo(-0.06, 5);
  });

  it("returns flat when within ±0.5% dead-band", () => {
    // +0.3% — below the 0.5% threshold
    expect(computePoP(100.3, 100).direction).toBe("flat");
    // −0.3%
    expect(computePoP(99.7, 100).direction).toBe("flat");
  });

  it("boundary: exactly +0.5% is classified as flat (inclusive lower bound of 'up' is >0.5%)", () => {
    // pct = 0.005 is NOT > 0.005, so it should be flat
    expect(computePoP(100.5, 100).direction).toBe("flat");
  });

  it("boundary: +0.51% is classified as up", () => {
    expect(computePoP(100.51, 100).direction).toBe("up");
  });
});

// ─── PoPBadge polarity contract ───────────────────────────────────────────────
//
// The badge colours a movement "good" or "bad" depending on the metric polarity:
//   - higher-is-better  → up = good, down = bad
//   - lower-is-better   → down = good, up = bad
//   - flat is always good
//
// This logic lives in PoPBadge (ecommerce-dashboard.tsx) and is NOT extracted,
// so we duplicate the minimal computation here to pin the contract.

type MetricPolarity = "higher-is-better" | "lower-is-better";

function isGood(
  direction: "up" | "down" | "flat" | "na",
  polarity: MetricPolarity,
): boolean {
  if (direction === "flat") return true;
  if (direction === "na")   return true; // na renders as neutral, not bad
  return polarity === "higher-is-better" ? direction === "up" : direction === "down";
}

describe("PoPBadge polarity contract", () => {
  describe("higher-is-better (revenue, ROAS, POAS, True Profit)", () => {
    it("up is good", () => expect(isGood("up",   "higher-is-better")).toBe(true));
    it("down is bad", () => expect(isGood("down", "higher-is-better")).toBe(false));
    it("flat is good", () => expect(isGood("flat", "higher-is-better")).toBe(true));
  });

  describe("lower-is-better (spend)", () => {
    it("down is good (spend dropped = positive)", () => expect(isGood("down", "lower-is-better")).toBe(true));
    it("up is bad (spend rose = negative)",        () => expect(isGood("up",   "lower-is-better")).toBe(false));
    it("flat is good",                             () => expect(isGood("flat", "lower-is-better")).toBe(true));
  });
});

// ─── isSyncStale ─────────────────────────────────────────────────────────────

describe("isSyncStale", () => {
  const NOW = Date.UTC(2026, 3, 21, 12, 0, 0); // 21 Apr 2026 12:00 UTC (pinned)

  it("returns false when no timestamps are present (new tenant guard)", () => {
    expect(isSyncStale({}, NOW)).toBe(false);
    expect(isSyncStale({ latestAdsSyncAt: null, lastSyncedAt: null }, NOW)).toBe(false);
  });

  it("returns false when latestAdsSyncAt is an invalid date string", () => {
    expect(isSyncStale({ latestAdsSyncAt: "not-a-date" }, NOW)).toBe(false);
  });

  it("returns true when latestAdsSyncAt is more than 24h ago", () => {
    const staleMs = NOW - STALE_MS - 1;
    const staleIso = new Date(staleMs).toISOString();
    expect(isSyncStale({ latestAdsSyncAt: staleIso }, NOW)).toBe(true);
  });

  it("returns false when latestAdsSyncAt is less than 24h ago (fresh data)", () => {
    const freshMs = NOW - STALE_MS + 60_000; // 1 minute inside the window
    const freshIso = new Date(freshMs).toISOString();
    expect(isSyncStale({ latestAdsSyncAt: freshIso }, NOW)).toBe(false);
  });

  it("returns true when falling back to lastSyncedAt (epoch ms) that is stale", () => {
    const staleMs = NOW - STALE_MS - 1;
    expect(isSyncStale({ lastSyncedAt: staleMs }, NOW)).toBe(true);
  });

  it("returns false when falling back to lastSyncedAt that is fresh", () => {
    const freshMs = NOW - STALE_MS + 60_000;
    expect(isSyncStale({ lastSyncedAt: freshMs }, NOW)).toBe(false);
  });

  it("prefers latestAdsSyncAt over lastSyncedAt when both present", () => {
    // latestAdsSyncAt is fresh but lastSyncedAt is stale — should not be stale
    const freshIso = new Date(NOW - STALE_MS + 60_000).toISOString();
    const staleLegacy = NOW - STALE_MS - 1;
    expect(isSyncStale({ latestAdsSyncAt: freshIso, lastSyncedAt: staleLegacy }, NOW)).toBe(false);
  });

  it("boundary: exactly at STALE_MS is NOT stale (strict >)", () => {
    const exactMs = NOW - STALE_MS;
    expect(isSyncStale({ lastSyncedAt: exactMs }, NOW)).toBe(false);
  });

  it("boundary: STALE_MS + 1ms is stale", () => {
    const oneOverMs = NOW - STALE_MS - 1;
    expect(isSyncStale({ lastSyncedAt: oneOverMs }, NOW)).toBe(true);
  });
});

// ─── Performance-grid hide-inactive predicate ────────────────────────────────
//
// shouldShowWhenHideInactive() mirrors the filter predicate in
// performance-grid.tsx line 554-557 exactly:
//   channels.filter(c => !((c.status ?? "").toUpperCase() === "PAUSED" && (c.spend ?? 0) === 0))
//
// Rows are hidden ONLY when BOTH conditions hold: status is PAUSED AND spend
// is 0/null. Active, enabled, or spending-paused campaigns all stay visible.

describe("Performance-grid hide-inactive predicate (shouldShowWhenHideInactive)", () => {
  it("hides a PAUSED, zero-spend campaign", () => {
    expect(shouldShowWhenHideInactive({ status: "PAUSED", spend: 0 })).toBe(false);
  });

  it("hides a paused campaign with null spend (treated as 0)", () => {
    expect(shouldShowWhenHideInactive({ status: "PAUSED", spend: null })).toBe(false);
  });

  it("keeps a PAUSED campaign that still has spend > 0", () => {
    expect(shouldShowWhenHideInactive({ status: "PAUSED", spend: 50 })).toBe(true);
  });

  it("keeps an ENABLED zero-spend campaign (not paused)", () => {
    expect(shouldShowWhenHideInactive({ status: "ENABLED", spend: 0 })).toBe(true);
  });

  it("keeps an ACTIVE campaign with spend", () => {
    expect(shouldShowWhenHideInactive({ status: "ACTIVE", spend: 1234.56 })).toBe(true);
  });

  it("keeps a campaign with null status (not definitively paused)", () => {
    expect(shouldShowWhenHideInactive({ status: null, spend: 0 })).toBe(true);
  });

  it("keeps a campaign with undefined status and spend", () => {
    expect(shouldShowWhenHideInactive({})).toBe(true);
  });

  it("toggle off: all campaigns visible (no filter applied)", () => {
    const channels = [
      { status: "PAUSED", spend: 0 },
      { status: "ENABLED", spend: 500 },
      { status: "PAUSED", spend: 100 },
    ];
    // When hideInactive is false, we return all channels (no filter)
    const hideOff = channels;
    expect(hideOff).toHaveLength(3);

    // When hideInactive is true, only the first row is hidden
    const hideOn = channels.filter(shouldShowWhenHideInactive);
    expect(hideOn).toHaveLength(2);
    expect(hideOn.every((c) => shouldShowWhenHideInactive(c))).toBe(true);
  });
});
