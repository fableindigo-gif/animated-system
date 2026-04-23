/**
 * Shopify Admin API token-bucket rate limiter.
 *
 * Gates every outbound Shopify HTTP call — shared across single-row applies,
 * bulk applies, and undo replays so a burst of "Apply all" clicks can't blow
 * past Shopify's Admin API throttle (REST: 2 req/sec sustained, 40-call
 * leaky bucket).
 *
 * Tokens refill at `refillPerSec` and the bucket is capped at `capacity`.
 * `acquire()` resolves once a token is available — callers `await` it before
 * issuing a fetch.
 */
export class ShopifyRateLimiter {
  private tokens: number;
  private last:   number;
  private queue:  Array<() => void> = [];
  // A single pending drain timer — we never schedule more than one because
  // the drain loop reschedules itself if the queue is still non-empty.
  private timer:  ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly capacity:      number,
    private readonly refillPerSec:  number,
  ) {
    this.tokens = capacity;
    this.last   = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const add = ((now - this.last) / 1000) * this.refillPerSec;
    if (add > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + add);
      this.last   = now;
    }
  }

  // Drain as many waiters as we have whole tokens for; if any remain,
  // schedule exactly one timer for the next refill and return. Only the
  // drain loop ever decrements `tokens` for queued callers, which is what
  // makes concurrent acquire() safe — there is no race where two waiters
  // each consume the "same" token.
  private drain(): void {
    this.refill();
    while (this.queue.length > 0 && this.tokens >= 1) {
      this.tokens -= 1;
      const next = this.queue.shift()!;
      next();
    }
    if (this.queue.length > 0 && this.timer === null) {
      const waitMs = Math.max(1, Math.ceil(((1 - this.tokens) / this.refillPerSec) * 1000));
      this.timer = setTimeout(() => {
        this.timer = null;
        this.drain();
      }, waitMs);
    }
  }

  async acquire(): Promise<void> {
    // Fast path: if no one is queued and we have a token, take it directly
    // so single-threaded callers don't pay an extra tick.
    if (this.queue.length === 0) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
    }
    // Slow path: queue and let the single drain loop hand us a token.
    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
      this.drain();
    });
  }
}
