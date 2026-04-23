/**
 * Shopify rate limiter — concurrency tests.
 *
 * The bulk-apply path issues many Shopify writes in quick succession from
 * potentially concurrent requests. The rate limiter is the only thing
 * standing between us and Shopify's Admin API throttle (REST: 2 req/sec
 * sustained, leaky-bucket capacity 40), so we verify under parallel load
 * that:
 *   • Initial burst never exceeds the configured bucket capacity.
 *   • Sustained release rate stays within the configured refill rate even
 *     when 20 callers race for tokens.
 *   • The fast path (single sequential caller) still works without
 *     unnecessary timer ticks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ShopifyRateLimiter } from "../lib/shopify-rate-limiter";

describe("ShopifyRateLimiter", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(()  => { vi.useRealTimers(); });

  it("releases up to capacity immediately, then throttles to refill rate", async () => {
    const rl = new ShopifyRateLimiter(/* capacity */ 5, /* refillPerSec */ 2);
    const releaseTimes: number[] = [];
    const start = Date.now();

    // 12 concurrent acquires — 5 should fly through, the rest must wait.
    const all = Promise.all(
      Array.from({ length: 12 }, () =>
        rl.acquire().then(() => releaseTimes.push(Date.now() - start))),
    );

    // Yield microtasks so the synchronous fast-path resolves for first 5.
    await vi.advanceTimersByTimeAsync(0);
    expect(releaseTimes.length).toBe(5);

    // Advance virtual time and watch the queue drain at 2/sec.
    await vi.advanceTimersByTimeAsync(4000);
    await all;
    expect(releaseTimes.length).toBe(12);

    // Burst window: first 5 within ~0ms.
    for (let i = 0; i < 5; i++) expect(releaseTimes[i]).toBeLessThanOrEqual(50);

    // After the burst, no more than `refillPerSec` releases per second.
    // Inspect 1-second sliding windows over the throttled tail.
    const tail = releaseTimes.slice(5);
    for (let t = tail[0]; t <= tail[tail.length - 1]; t += 100) {
      const inWindow = tail.filter((x) => x >= t && x < t + 1000).length;
      // Allow +1 slack for window-edge alignment under fake timers.
      expect(inWindow).toBeLessThanOrEqual(2 + 1);
    }
  });

  it("sequential callers take the fast path without scheduling timers", async () => {
    const rl = new ShopifyRateLimiter(3, 2);
    // Three sequential acquires within capacity should all resolve in the
    // same microtask flush — no timer required.
    await rl.acquire();
    await rl.acquire();
    await rl.acquire();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never releases more than capacity even under simultaneous acquires", async () => {
    const rl = new ShopifyRateLimiter(4, 1);
    let resolved = 0;
    const all = Promise.all(
      Array.from({ length: 20 }, () => rl.acquire().then(() => { resolved += 1; })),
    );
    await vi.advanceTimersByTimeAsync(0);
    // Initial burst is exactly capacity, never more.
    expect(resolved).toBe(4);
    // After 5 seconds at 1 token/sec we should have 4 + 5 = 9 (bounded).
    await vi.advanceTimersByTimeAsync(5000);
    expect(resolved).toBeLessThanOrEqual(4 + 5 + 1);
    // Eventually all 20 release.
    await vi.advanceTimersByTimeAsync(20000);
    await all;
    expect(resolved).toBe(20);
  });
});
