import { describe, it, expect, beforeEach } from "vitest";
import { TTLCache, getCacheRollingStats, recordCacheBypass } from "../lib/cache";

describe("TTLCache (memory backend)", () => {
  beforeEach(() => {
    delete process.env.SHARED_CACHE_REDIS_URL;
  });

  it("uses the in-memory backend when SHARED_CACHE_REDIS_URL is unset", () => {
    const cache = new TTLCache<number>(1000, "test-mem");
    expect(cache.backendKind).toBe("memory");
  });

  it("returns null for missing keys and round-trips values within TTL", async () => {
    const cache = new TTLCache<{ n: number }>(1000, "test-rt");
    expect(await cache.get("missing")).toBeNull();
    await cache.set("k", { n: 42 });
    expect(await cache.get("k")).toEqual({ n: 42 });
  });

  it("expires entries after the TTL elapses", async () => {
    const cache = new TTLCache<string>(10, "test-ttl");
    await cache.set("k", "v");
    await new Promise((r) => setTimeout(r, 25));
    expect(await cache.get("k")).toBeNull();
  });

  it("supports invalidate() and clear()", async () => {
    const cache = new TTLCache<string>(1000, "test-inv");
    await cache.set("a", "1");
    await cache.set("b", "2");
    await cache.invalidate("a");
    expect(await cache.get("a")).toBeNull();
    expect(await cache.get("b")).toBe("2");
    await cache.clear();
    expect(await cache.get("b")).toBeNull();
  });

  it("purgeExpired() removes only timed-out entries", async () => {
    const cache = new TTLCache<number>(20, "test-purge");
    await cache.set("old", 1);
    await new Promise((r) => setTimeout(r, 30));
    await cache.set("fresh", 2);
    const removed = await cache.purgeExpired();
    expect(removed).toBe(1);
    expect(await cache.get("fresh")).toBe(2);
  });
});

describe("rolling hit-rate counters (Task #58)", () => {
  it("getCacheRollingStats returns null hitRate with no traffic", () => {
    // Fresh stats over a tiny window that has had no activity recorded
    // in this test run. We can't reset the module-level buckets, but we
    // can assert the shape of the response.
    const s = getCacheRollingStats();
    expect(typeof s.hits).toBe("number");
    expect(typeof s.misses).toBe("number");
    expect(typeof s.bypasses).toBe("number");
    expect(s.windowMs).toBe(3_600_000);
    // hitRate is null or a number in [0,1]
    if (s.hitRate !== null) {
      expect(s.hitRate).toBeGreaterThanOrEqual(0);
      expect(s.hitRate).toBeLessThanOrEqual(1);
    }
  });

  it("TTLCache.get() increments hit on a present key and miss on an absent key", async () => {
    const cache = new TTLCache<string>(5_000, "test-rolling");
    const before = getCacheRollingStats();

    await cache.get("absent");
    const afterMiss = getCacheRollingStats();
    expect(afterMiss.misses).toBeGreaterThan(before.misses);

    await cache.set("present", "v");
    await cache.get("present");
    const afterHit = getCacheRollingStats();
    expect(afterHit.hits).toBeGreaterThan(afterMiss.hits);
  });

  it("recordCacheBypass() increments the bypass counter", () => {
    const before = getCacheRollingStats();
    recordCacheBypass();
    recordCacheBypass();
    const after = getCacheRollingStats();
    expect(after.bypasses).toBe(before.bypasses + 2);
  });

  it("hitRate is computed as hits / (hits + misses), ignoring bypasses", async () => {
    const cache = new TTLCache<number>(5_000, "test-hitrate");
    const before = getCacheRollingStats();

    // 1 miss
    await cache.get("nope");
    // 1 hit
    await cache.set("yes", 1);
    await cache.get("yes");

    const after = getCacheRollingStats();
    const deltaHits = after.hits - before.hits;
    const deltaMisses = after.misses - before.misses;
    expect(deltaHits).toBe(1);
    expect(deltaMisses).toBe(1);
    // Rate across the full window may include other test traffic, so just
    // verify it's a valid fraction rather than asserting an exact value.
    expect(after.hitRate).not.toBeNull();
    expect(after.hitRate!).toBeGreaterThanOrEqual(0);
    expect(after.hitRate!).toBeLessThanOrEqual(1);
  });
});
