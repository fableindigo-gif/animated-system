/**
 * Tests for shopping-insider-cost-alerter.ts (Task #42 / Task #264)
 *
 * Strategy: mock `getCacheMetrics` and `captureServerException` so the
 * alerter can be exercised in pure unit-test style without a real BigQuery
 * connection or a Sentry DSN.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Mock getCacheMetrics ────────────────────────────────────────────────────
const getCacheMetricsMock = vi.fn();
vi.mock("../lib/shopping-insider-cache", async () => {
  const actual = await vi.importActual<typeof import("../lib/shopping-insider-cache")>(
    "../lib/shopping-insider-cache",
  );
  return { ...actual, getCacheMetrics: (...a: unknown[]) => getCacheMetricsMock(...a) };
});

// ─── Mock captureServerException ────────────────────────────────────────────
const captureServerExceptionMock = vi.fn();
vi.mock("../lib/monitoring", async () => {
  const actual = await vi.importActual<typeof import("../lib/monitoring")>("../lib/monitoring");
  return {
    ...actual,
    captureServerException: (...a: unknown[]) => captureServerExceptionMock(...a),
  };
});

// ─── Mock alerter-config-store (used inside CostAlerter.tick) ───────────────
vi.mock("../lib/alerter-config-store", () => ({
  loadAlerterConfigOverrides: vi.fn(async () => ({})),
  applyOverrides: vi.fn((_base: unknown, _overrides: unknown) => _base),
}));

// ─── Mock @workspace/db (tick persists samples; errors are non-fatal) ────────
vi.mock("@workspace/db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => Promise.resolve()),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(async () => []),
        })),
      })),
    })),
  },
  shoppingInsiderCostSamples: { __table: "shopping_insider_cost_samples" },
}));

import {
  computeWindowStats,
  evaluateAlerts,
  createCostAlerterForTests,
  loadAlerterConfig,
  alerterEnabled,
  getShoppingInsiderAlertStatus,
  startShoppingInsiderCostAlerter,
  _resetCostAlerterForTests,
  _tickShoppingInsiderAlerterForTests,
  type AlerterConfig,
} from "../lib/shopping-insider-cost-alerter";

function makeMetrics(bytesBilled: number, hits: number, misses: number) {
  return {
    ttlMs: 3_600_000,
    cacheSize: 1,
    perFunction: {},
    totals: {
      hits,
      misses,
      bytesBilled,
      bytesAvoided: 0,
      hitRate: hits + misses === 0 ? null : hits / (hits + misses),
    },
  };
}

const baseConfig: AlerterConfig = {
  intervalMs: 1_000,
  windowMs: 60_000,
  bytesThreshold: 5_000,
  hitRateFloor: 0.5,
  minSamples: 5,
  cooldownMs: 100,
};

beforeEach(() => {
  getCacheMetricsMock.mockReset();
  captureServerExceptionMock.mockReset();
});

// ─── computeWindowStats ──────────────────────────────────────────────────────
describe("computeWindowStats", () => {
  it("returns full delta when only one old sample exists", () => {
    const baseline = { ts: 0, hits: 10, misses: 5, bytesBilled: 100, bytesAvoided: 200 };
    const current  = { ts: 60_000, hits: 20, misses: 10, bytesBilled: 600, bytesAvoided: 500 };
    const stats = computeWindowStats([baseline], current, 60_000, 60_000);
    expect(stats.hits).toBe(10);
    expect(stats.misses).toBe(5);
    expect(stats.bytesBilled).toBe(500);
    expect(stats.hitRate).toBeCloseTo(10 / 15);
  });

  it("picks the oldest sample inside the window, ignoring samples before it", () => {
    const now = 100_000;
    const windowMs = 60_000;
    const before = { ts: 30_000, hits: 0, misses: 0, bytesBilled: 0, bytesAvoided: 0 };
    const inside  = { ts: 50_000, hits: 5, misses: 5, bytesBilled: 1_000, bytesAvoided: 0 };
    const current = { ts: now, hits: 15, misses: 10, bytesBilled: 3_000, bytesAvoided: 0 };
    const stats = computeWindowStats([before, inside], current, windowMs, now);
    expect(stats.hits).toBe(10);
    expect(stats.misses).toBe(5);
    expect(stats.bytesBilled).toBe(2_000);
  });

  it("clamps negative deltas to 0 (counter resets)", () => {
    const baseline = { ts: 0, hits: 100, misses: 50, bytesBilled: 9_000, bytesAvoided: 0 };
    const current  = { ts: 60_000, hits: 10, misses: 5, bytesBilled: 500, bytesAvoided: 0 };
    const stats = computeWindowStats([baseline], current, 60_000, 60_000);
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.bytesBilled).toBe(0);
  });

  it("returns null hitRate when no traffic in window", () => {
    const baseline = { ts: 0, hits: 10, misses: 5, bytesBilled: 0, bytesAvoided: 0 };
    const current  = { ts: 60_000, hits: 10, misses: 5, bytesBilled: 0, bytesAvoided: 0 };
    const stats = computeWindowStats([baseline], current, 60_000, 60_000);
    expect(stats.hitRate).toBeNull();
  });
});

// ─── evaluateAlerts ──────────────────────────────────────────────────────────
describe("evaluateAlerts", () => {
  it("fires bytes_billed_spike when bytesBilled exceeds threshold", () => {
    const stats = {
      windowMs: 60_000, hits: 30, misses: 10, bytesBilled: 10_000,
      bytesAvoided: 0, hitRate: 0.75,
    };
    const kinds = evaluateAlerts(stats, baseConfig);
    expect(kinds).toContain("bytes_billed_spike");
  });

  it("does NOT fire bytes spike when under threshold", () => {
    const stats = {
      windowMs: 60_000, hits: 30, misses: 10, bytesBilled: 100,
      bytesAvoided: 0, hitRate: 0.75,
    };
    expect(evaluateAlerts(stats, baseConfig)).not.toContain("bytes_billed_spike");
  });

  it("fires hit_rate_floor when hitRate below floor and minSamples met", () => {
    const stats = {
      windowMs: 60_000, hits: 1, misses: 9, bytesBilled: 100,
      bytesAvoided: 0, hitRate: 0.1,
    };
    expect(evaluateAlerts(stats, baseConfig)).toContain("hit_rate_floor");
  });

  it("does NOT fire hit_rate_floor when minSamples not met", () => {
    const stats = {
      windowMs: 60_000, hits: 0, misses: 2, bytesBilled: 100,
      bytesAvoided: 0, hitRate: 0.0,
    };
    expect(evaluateAlerts(stats, baseConfig)).not.toContain("hit_rate_floor");
  });

  it("does NOT fire hit_rate_floor when hitRate is null", () => {
    const stats = {
      windowMs: 60_000, hits: 0, misses: 0, bytesBilled: 0,
      bytesAvoided: 0, hitRate: null,
    };
    expect(evaluateAlerts(stats, baseConfig)).not.toContain("hit_rate_floor");
  });

  it("fires both alerts when both thresholds breached", () => {
    const stats = {
      windowMs: 60_000, hits: 1, misses: 9, bytesBilled: 10_000,
      bytesAvoided: 0, hitRate: 0.1,
    };
    const kinds = evaluateAlerts(stats, baseConfig);
    expect(kinds).toContain("bytes_billed_spike");
    expect(kinds).toContain("hit_rate_floor");
  });

  it("does not fire bytes_billed_spike when bytesThreshold is null", () => {
    const cfg = { ...baseConfig, bytesThreshold: null };
    const stats = {
      windowMs: 60_000, hits: 0, misses: 0, bytesBilled: 1_000_000,
      bytesAvoided: 0, hitRate: null,
    };
    expect(evaluateAlerts(stats, cfg)).not.toContain("bytes_billed_spike");
  });

  it("does not fire hit_rate_floor when hitRateFloor is null", () => {
    const cfg = { ...baseConfig, hitRateFloor: null };
    const stats = {
      windowMs: 60_000, hits: 1, misses: 99, bytesBilled: 0,
      bytesAvoided: 0, hitRate: 0.01,
    };
    expect(evaluateAlerts(stats, cfg)).not.toContain("hit_rate_floor");
  });
});

// ─── CostAlerter.tick (end-to-end) ──────────────────────────────────────────
describe("CostAlerter tick", () => {
  it("fires bytes alert and calls captureServerException when threshold exceeded", async () => {
    getCacheMetricsMock
      .mockResolvedValueOnce(makeMetrics(0, 0, 0))       // t=0
      .mockResolvedValueOnce(makeMetrics(9_000, 10, 2));  // t=1 → spike

    const alerter = createCostAlerterForTests(baseConfig);
    await alerter.tick(0);
    const fired = await alerter.tick(1_000);
    alerter.stop();

    expect(fired).toContain("bytes_billed_spike");
    expect(captureServerExceptionMock).toHaveBeenCalledTimes(1);
    const [err, ctx] = captureServerExceptionMock.mock.calls[0] as [Error, Record<string, unknown>];
    expect(err.message).toMatch(/bytesBilled/);
    expect((ctx as { extra: { kind: string } }).extra.kind).toBe("bytes_billed_spike");
  });

  it("respects cooldown — does not re-fire within cooldown window", async () => {
    getCacheMetricsMock
      .mockResolvedValueOnce(makeMetrics(0, 0, 0))
      .mockResolvedValueOnce(makeMetrics(9_000, 0, 0))
      .mockResolvedValueOnce(makeMetrics(18_000, 0, 0));

    const cfg = { ...baseConfig, cooldownMs: 10_000 };
    const alerter = createCostAlerterForTests(cfg);
    await alerter.tick(0);
    await alerter.tick(1_000);   // fires
    const second = await alerter.tick(2_000);  // still within cooldown
    alerter.stop();

    expect(second).not.toContain("bytes_billed_spike");
    expect(captureServerExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("re-fires after cooldown expires", async () => {
    getCacheMetricsMock
      .mockResolvedValueOnce(makeMetrics(0, 0, 0))
      .mockResolvedValueOnce(makeMetrics(9_000, 0, 0))
      .mockResolvedValueOnce(makeMetrics(18_000, 0, 0));

    const cfg = { ...baseConfig, cooldownMs: 500 };
    const alerter = createCostAlerterForTests(cfg);
    await alerter.tick(0);
    await alerter.tick(1_000);
    const second = await alerter.tick(2_000); // 1000ms > 500ms cooldown
    alerter.stop();

    expect(second).toContain("bytes_billed_spike");
    expect(captureServerExceptionMock).toHaveBeenCalledTimes(2);
  });

  it("does not fire when counters are below all thresholds", async () => {
    getCacheMetricsMock
      .mockResolvedValueOnce(makeMetrics(0, 10, 0))
      .mockResolvedValueOnce(makeMetrics(100, 15, 0));

    const alerter = createCostAlerterForTests(baseConfig);
    await alerter.tick(0);
    const fired = await alerter.tick(1_000);
    alerter.stop();

    expect(fired).toHaveLength(0);
    expect(captureServerExceptionMock).not.toHaveBeenCalled();
  });

  it("fires hit_rate_floor when hitRate drops below floor with enough samples", async () => {
    getCacheMetricsMock
      .mockResolvedValueOnce(makeMetrics(0, 0, 0))
      .mockResolvedValueOnce(makeMetrics(0, 1, 9)); // 10% hit rate, 10 samples ≥ minSamples=5

    const alerter = createCostAlerterForTests(baseConfig);
    await alerter.tick(0);
    const fired = await alerter.tick(1_000);
    alerter.stop();

    expect(fired).toContain("hit_rate_floor");
  });
});

// ─── loadAlerterConfig / alerterEnabled ─────────────────────────────────────
describe("loadAlerterConfig / alerterEnabled", () => {
  it("is disabled when no thresholds are set", () => {
    const cfg: AlerterConfig = {
      intervalMs: 300_000,
      windowMs: 3_600_000,
      bytesThreshold: null,
      hitRateFloor: null,
      minSamples: 20,
      cooldownMs: 3_600_000,
    };
    expect(alerterEnabled(cfg)).toBe(false);
  });

  it("is enabled when only bytesThreshold is set", () => {
    const cfg: AlerterConfig = { ...baseConfig, hitRateFloor: null };
    expect(alerterEnabled(cfg)).toBe(true);
  });

  it("is enabled when only hitRateFloor is set", () => {
    const cfg: AlerterConfig = { ...baseConfig, bytesThreshold: null };
    expect(alerterEnabled(cfg)).toBe(true);
  });
});

// ─── getShoppingInsiderAlertStatus (singleton state) ─────────────────────────
describe("getShoppingInsiderAlertStatus", () => {
  const THRESHOLD_VAR = "SHOPPING_INSIDER_ALERT_BYTES_THRESHOLD";

  beforeEach(() => {
    getCacheMetricsMock.mockReset();
    captureServerExceptionMock.mockReset();
    _resetCostAlerterForTests();
  });

  afterEach(() => {
    _resetCostAlerterForTests();
    delete process.env[THRESHOLD_VAR];
  });

  it("returns alerterEnabled=false and all-null fields when no singleton exists", () => {
    const status = getShoppingInsiderAlertStatus();
    expect(status).toEqual({
      alerterEnabled: false,
      currentWindow: null,
      lastAlertKind: null,
      lastAlertAt: null,
    });
  });

  it("returns currentWindow=null before the first tick completes", () => {
    process.env[THRESHOLD_VAR] = "5000";
    startShoppingInsiderCostAlerter();
    const status = getShoppingInsiderAlertStatus();
    expect(status.currentWindow).toBeNull();
    expect(status.lastAlertKind).toBeNull();
    expect(status.lastAlertAt).toBeNull();
    expect(status.alerterEnabled).toBe(true);
  });

  it("populates currentWindow after a tick that does not fire any alert", async () => {
    process.env[THRESHOLD_VAR] = "100000";
    getCacheMetricsMock
      .mockResolvedValueOnce(makeMetrics(0, 0, 0))
      .mockResolvedValueOnce(makeMetrics(500, 10, 2));

    startShoppingInsiderCostAlerter();
    await _tickShoppingInsiderAlerterForTests(0);
    await _tickShoppingInsiderAlerterForTests(1_000);

    const status = getShoppingInsiderAlertStatus();
    expect(status.currentWindow).not.toBeNull();
    expect(status.currentWindow!.bytesBilled).toBe(500);
    expect(status.currentWindow!.hits).toBe(10);
    expect(status.currentWindow!.misses).toBe(2);
    expect(status.lastAlertKind).toBeNull();
    expect(status.lastAlertAt).toBeNull();
    expect(status.alerterEnabled).toBe(true);
  });

  it("populates lastAlertKind and lastAlertAt after a threshold breach", async () => {
    process.env[THRESHOLD_VAR] = "5000";
    getCacheMetricsMock
      .mockResolvedValueOnce(makeMetrics(0, 0, 0))
      .mockResolvedValueOnce(makeMetrics(9_000, 10, 2));

    startShoppingInsiderCostAlerter();
    await _tickShoppingInsiderAlerterForTests(0);
    await _tickShoppingInsiderAlerterForTests(1_000);

    const status = getShoppingInsiderAlertStatus();
    expect(status.lastAlertKind).toBe("bytes_billed_spike");
    expect(status.lastAlertAt).toBe(1_000);
    expect(status.currentWindow).not.toBeNull();
    expect(status.currentWindow!.bytesBilled).toBe(9_000);
    expect(status.alerterEnabled).toBe(true);
    expect(captureServerExceptionMock).toHaveBeenCalledTimes(1);
  });
});
