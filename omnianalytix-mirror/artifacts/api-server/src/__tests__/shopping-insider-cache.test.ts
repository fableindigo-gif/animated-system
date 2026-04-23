import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock bigquery-client BEFORE importing anything that captures its exports.
// `runQuery` is used by service-level bypassCache paths; `runQueryWithStats`
// is used by the cached path inside `withCache`.
const runQueryMock = vi.fn();
const runQueryWithStatsMock = vi.fn();
vi.mock("../lib/bigquery-client", async () => {
  const actual = await vi.importActual<typeof import("../lib/bigquery-client")>("../lib/bigquery-client");
  return {
    ...actual,
    runQuery: (...args: unknown[]) => runQueryMock(...args),
    runQueryWithStats: (...args: unknown[]) => runQueryWithStatsMock(...args),
    getBigQueryConfig: () => ({ projectId: "test-proj", location: "US" }),
    safeIdent: (s: string) => s,
  };
});

import {
  getCampaignPerformance,
  getProductPerformance,
  getProductIssues,
  getAccountHealth,
  clearShoppingInsiderCache,
  shoppingInsiderCacheStats,
} from "../services/shopping-insider";
import {
  withCache,
  hashKey,
  getCacheMetrics,
  resetCacheForTests,
  recordBypass,
} from "../lib/shopping-insider-cache";

describe("shopping-insider cache (service layer)", () => {
  beforeEach(async () => {
    runQueryMock.mockReset();
    runQueryWithStatsMock.mockReset();
    runQueryMock.mockResolvedValue([{ campaign_id: "1" }]);
    runQueryWithStatsMock.mockResolvedValue({ rows: [{ campaign_id: "1" }], totalBytesProcessed: 1000 });
    await resetCacheForTests();
  });

  afterEach(async () => {
    await clearShoppingInsiderCache();
  });

  it("serves identical campaign-performance queries from cache", async () => {
    const opts = { range: { startDate: "2025-01-01", endDate: "2025-01-31" }, customerId: "123" };
    const a = await getCampaignPerformance(opts);
    const b = await getCampaignPerformance(opts);
    expect(a).toEqual(b);
    // First call hits BigQuery, second is served from cache.
    expect(runQueryWithStatsMock).toHaveBeenCalledTimes(1);
    expect((await shoppingInsiderCacheStats()).size).toBeGreaterThan(0);
  });

  it("treats different customer_id as distinct keys", async () => {
    const base = { range: { startDate: "2025-01-01", endDate: "2025-01-31" } };
    await getCampaignPerformance({ ...base, customerId: "A" });
    await getCampaignPerformance({ ...base, customerId: "B" });
    expect(runQueryWithStatsMock).toHaveBeenCalledTimes(2);
  });

  it("bypassCache=true skips the cache entirely (read and write)", async () => {
    const opts = { range: { startDate: "2025-01-01", endDate: "2025-01-31" } };
    await getCampaignPerformance(opts);                            // miss → cached via withStats
    await getCampaignPerformance({ ...opts, bypassCache: true });  // bypass → fresh runQuery, no cache write
    await getCampaignPerformance(opts);                            // hit on the original cache entry
    expect(runQueryWithStatsMock).toHaveBeenCalledTimes(1);
    expect(runQueryMock).toHaveBeenCalledTimes(1);
  });

  it("caches each service function independently", async () => {
    runQueryWithStatsMock.mockResolvedValue({ rows: [{ x: 1 }], totalBytesProcessed: 1 });
    await getCampaignPerformance({ range: { startDate: "2025-01-01", endDate: "2025-01-31" } });
    await getProductPerformance({ range: { startDate: "2025-01-01", endDate: "2025-01-31" } });
    await getProductIssues({});
    await getAccountHealth({});
    expect(runQueryWithStatsMock).toHaveBeenCalledTimes(4);

    // Repeat — all should hit cache.
    await getCampaignPerformance({ range: { startDate: "2025-01-01", endDate: "2025-01-31" } });
    await getProductPerformance({ range: { startDate: "2025-01-01", endDate: "2025-01-31" } });
    await getProductIssues({});
    await getAccountHealth({});
    expect(runQueryWithStatsMock).toHaveBeenCalledTimes(4);
  });

  it("clearShoppingInsiderCache() forces a fresh query", async () => {
    const opts = { range: { startDate: "2025-01-01", endDate: "2025-01-31" } };
    await getCampaignPerformance(opts);
    await clearShoppingInsiderCache();
    await getCampaignPerformance(opts);
    expect(runQueryWithStatsMock).toHaveBeenCalledTimes(2);
  });
});

describe("shopping-insider cache metrics", () => {
  beforeEach(() => {
    resetCacheForTests();
    runQueryWithStatsMock.mockReset();
  });

  it("counts a miss on first call and a hit on the second, accumulating bytesAvoided", async () => {
    runQueryWithStatsMock.mockResolvedValueOnce({ rows: [{ a: 1 }], totalBytesProcessed: 1_000_000 });

    const key = hashKey(["x"]);
    const r1 = await withCache<{ a: number }>("getCampaignPerformance", key, "SQL", {});
    const r2 = await withCache<{ a: number }>("getCampaignPerformance", key, "SQL", {});

    expect(r1).toEqual([{ a: 1 }]);
    expect(r2).toEqual([{ a: 1 }]);
    expect(runQueryWithStatsMock).toHaveBeenCalledTimes(1);

    const m = await getCacheMetrics();
    const fn = m.perFunction.getCampaignPerformance;
    expect(fn.hits).toBe(1);
    expect(fn.misses).toBe(1);
    expect(fn.bytesAvoided).toBe(1_000_000);
    expect(fn.bytesBilled).toBe(1_000_000);
    expect(fn.hitRate).toBeCloseTo(0.5);
    expect(m.totals.hits).toBe(1);
    expect(m.totals.misses).toBe(1);
    expect(m.totals.bytesAvoided).toBe(1_000_000);
  });

  it("treats different keys as independent cache entries", async () => {
    runQueryWithStatsMock
      .mockResolvedValueOnce({ rows: [1], totalBytesProcessed: 500 })
      .mockResolvedValueOnce({ rows: [2], totalBytesProcessed: 700 });

    await withCache("getProductIssues", "k1", "SQL1", {});
    await withCache("getProductIssues", "k2", "SQL2", {});

    expect(runQueryWithStatsMock).toHaveBeenCalledTimes(2);
    const m = await getCacheMetrics();
    expect(m.perFunction.getProductIssues.misses).toBe(2);
    expect(m.perFunction.getProductIssues.hits).toBe(0);
    expect(m.perFunction.getProductIssues.bytesBilled).toBe(1_200);
    expect(m.perFunction.getProductIssues.bytesAvoided).toBe(0);
  });

  it("reports a null hitRate when there has been no traffic", async () => {
    const m = await getCacheMetrics();
    expect(m.totals.hits).toBe(0);
    expect(m.totals.misses).toBe(0);
    expect(m.totals.hitRate).toBeNull();
  });
});

describe("bypass counter accounting (Task #58)", () => {
  beforeEach(async () => {
    await resetCacheForTests();
    runQueryMock.mockReset();
    runQueryWithStatsMock.mockReset();
    runQueryMock.mockResolvedValue([{ campaign_id: "1" }]);
    runQueryWithStatsMock.mockResolvedValue({ rows: [{ campaign_id: "1" }], totalBytesProcessed: 500 });
  });

  it("bypassCache:true increments bypass counter, not miss or hit", async () => {
    const opts = { range: { startDate: "2025-01-01", endDate: "2025-01-31" }, bypassCache: true };
    await getCampaignPerformance(opts);
    await getCampaignPerformance(opts);

    const m = await getCacheMetrics();
    const fn = m.perFunction.getCampaignPerformance;
    expect(fn.bypasses).toBe(2);
    expect(fn.hits).toBe(0);
    expect(fn.misses).toBe(0);
    expect(m.totals.bypasses).toBe(2);
  });

  it("recordBypass() increments per-function bypass counter", async () => {
    await resetCacheForTests();
    recordBypass("myFn");
    recordBypass("myFn");
    recordBypass("otherFn");

    const m = await getCacheMetrics();
    expect(m.perFunction.myFn?.bypasses).toBe(2);
    expect(m.perFunction.otherFn?.bypasses).toBe(1);
    expect(m.totals.bypasses).toBeGreaterThanOrEqual(3);
  });

  it("bypass does not pollute hit/miss counts or bytesAvoided", async () => {
    const opts = { range: { startDate: "2025-01-01", endDate: "2025-01-31" } };
    await getCampaignPerformance(opts);                            // miss + cached
    await getCampaignPerformance({ ...opts, bypassCache: true }); // bypass, skip cache

    const m = await getCacheMetrics();
    const fn = m.perFunction.getCampaignPerformance;
    expect(fn.misses).toBe(1);
    expect(fn.hits).toBe(0);
    expect(fn.bypasses).toBe(1);
    expect(fn.bytesAvoided).toBe(0);
  });
});
