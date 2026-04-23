import type { Request, RequestHandler } from "express";
import Redis, { type Redis as RedisClient } from "ioredis";
import { logger } from "../lib/logger";

/**
 * Per-tenant token-bucket rate limiter for the manual quality-fixes
 * `/rescan` endpoint.
 *
 * Why this exists: a single per-row "Rescan" or "Rescan failed" click can
 * fan out up to 100 ids to Shoptimizer. An impatient (or stuck) operator
 * could spam the button hundreds of times per second, blow through their
 * Shoptimizer budget, and crowd out the scheduled scanner. This middleware
 * caps how many rescan calls one tenant can issue per minute and surfaces a
 * 429 with a clear `Retry-After` so the UI can show a friendly "slow down"
 * toast.
 *
 * Implementation notes:
 *   - Continuous (fractional) refill: `capacity` tokens are restored evenly
 *     over `intervalMs`. This avoids the "thundering herd at the window
 *     boundary" problem of a fixed-window limiter while staying simple.
 *   - State is kept in a shared store (Redis when SHARED_CACHE_REDIS_URL is
 *     set) so all API server replicas see the same counts.
 *   - Failure mode: when the shared store is required
 *     (REQUIRE_SHARED_RESCAN_LIMITS=true or `opts.requireSharedStore`) a
 *     store error returns 503 rather than silently bypassing the limit. When
 *     not required the middleware logs an ERROR and fails open — appropriate
 *     for single-instance deployments where Redis is not expected.
 *   - The middleware is a no-op when no tenant key can be derived from the
 *     request — the route immediately downstream returns 401 in that case,
 *     and we'd rather let it own that error path than 429 an unauthenticated
 *     caller.
 */

// ─── Store abstraction ────────────────────────────────────────────────────────

export interface ConsumeResult {
  allowed:      boolean;
  /** Only meaningful when allowed === false. */
  retryAfterMs: number;
}

/**
 * Backend that persists token-bucket state. Implementations must be safe to
 * call concurrently — either through atomic server-side operations (Redis Lua)
 * or by the fact that in-process JS is single-threaded.
 */
export interface RateLimitStore {
  readonly kind: "memory" | "redis";
  /**
   * Attempt to consume one token from the bucket identified by `key`.
   * Refills the bucket proportionally based on elapsed time before deciding.
   * MUST reject (throw) if the backend is unavailable so callers can handle
   * the failure mode explicitly.
   */
  consume(
    key:        string,
    capacity:   number,
    intervalMs: number,
    nowMs:      number,
  ): Promise<ConsumeResult>;
}

// ─── In-process memory store ──────────────────────────────────────────────────

interface Bucket {
  tokens:     number;
  lastRefill: number;
}

export class MemoryStore implements RateLimitStore {
  readonly kind = "memory" as const;
  /** Exposed only to support test isolation — do NOT rely on this in prod. */
  readonly _buckets = new Map<string, Bucket>();

  async consume(
    key:        string,
    capacity:   number,
    intervalMs: number,
    nowMs:      number,
  ): Promise<ConsumeResult> {
    const existing = this._buckets.get(key);
    const bucket: Bucket = existing ?? { tokens: capacity, lastRefill: nowMs };

    const elapsed = Math.max(0, nowMs - bucket.lastRefill);
    if (elapsed > 0) {
      const refill = (elapsed / intervalMs) * capacity;
      bucket.tokens     = Math.min(capacity, bucket.tokens + refill);
      bucket.lastRefill = nowMs;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      this._buckets.set(key, bucket);
      return { allowed: true, retryAfterMs: 0 };
    }

    const needed       = 1 - bucket.tokens;
    const retryAfterMs = needed * (intervalMs / capacity);
    this._buckets.set(key, bucket);
    return { allowed: false, retryAfterMs };
  }
}

// ─── Redis store ──────────────────────────────────────────────────────────────

/**
 * Atomic token-bucket consume via a Redis Lua script.
 *
 * The script runs atomically (Redis is single-threaded) so there are no
 * race conditions even when multiple API server replicas call simultaneously.
 *
 * Args:
 *   KEYS[1]  — bucket key
 *   ARGV[1]  — capacity (number)
 *   ARGV[2]  — intervalMs (number)
 *   ARGV[3]  — nowMs (unix ms, number)
 *   ARGV[4]  — ttlSec: TTL to (re)set on the key so it auto-expires when idle
 *
 * Returns: [allowed (0|1), retryAfterMs (integer)]
 */
const LUA_CONSUME = `
local key        = KEYS[1]
local capacity   = tonumber(ARGV[1])
local intervalMs = tonumber(ARGV[2])
local nowMs      = tonumber(ARGV[3])
local ttlSec     = tonumber(ARGV[4])

local raw = redis.call('GET', key)
local tokens, lastRefill
if raw then
  local d    = cjson.decode(raw)
  tokens     = d.tokens
  lastRefill = d.lastRefill
else
  tokens     = capacity
  lastRefill = nowMs
end

-- Continuous refill proportional to elapsed time.
local elapsed = nowMs - lastRefill
if elapsed > 0 then
  local refill = (elapsed / intervalMs) * capacity
  tokens = math.min(capacity, tokens + refill)
  lastRefill = nowMs
end

local allowed      = 0
local retryAfterMs = 0
if tokens >= 1 then
  tokens  = tokens - 1
  allowed = 1
else
  local needed  = 1 - tokens
  retryAfterMs  = math.ceil(needed * (intervalMs / capacity))
end

redis.call('SET', key, cjson.encode({tokens=tokens, lastRefill=lastRefill}), 'EX', ttlSec)
return {allowed, retryAfterMs}
`;

export class RedisStore implements RateLimitStore {
  readonly kind = "redis" as const;
  private readonly prefix: string;

  constructor(private readonly client: RedisClient) {
    const root = process.env.SHARED_CACHE_KEY_PREFIX ?? "omnianalytix:cache:";
    this.prefix = `${root}rescan-rate-limit:`;
  }

  async consume(
    key:        string,
    capacity:   number,
    intervalMs: number,
    nowMs:      number,
  ): Promise<ConsumeResult> {
    const redisKey = `${this.prefix}${key}`;
    const ttlSec   = Math.max(1, Math.ceil((intervalMs * 2) / 1000));

    const result = await this.client.eval(
      LUA_CONSUME,
      1,
      redisKey,
      String(capacity),
      String(intervalMs),
      String(nowMs),
      String(ttlSec),
    ) as [number, number];

    const [allowed, retryAfterMs] = result;
    return { allowed: allowed === 1, retryAfterMs };
  }
}

// ─── Store factory ────────────────────────────────────────────────────────────

/**
 * Build the default store for production use:
 *   • Redis  — when SHARED_CACHE_REDIS_URL is set (required for multi-replica).
 *   • Memory — single-instance fallback with an explicit notice in the logs.
 *
 * Important: ioredis connection failures (e.g. ECONNREFUSED) are asynchronous
 * and are NOT caught by the constructor try/catch here — they arrive via the
 * "error" event after the client is created. As a result, `isShared: true`
 * means the Redis client was successfully *instantiated* (URL parsed, object
 * created), not that it has successfully *connected*. Network-level failures
 * are caught at request time inside `RedisStore.consume()`, which throws and
 * lets `createRescanRateLimiter` decide whether to fail closed (503) or open.
 *
 * The constructor try/catch covers deterministic failures only: malformed URL,
 * invalid options, etc. — cases where building the client object itself throws.
 */
export function buildDefaultStore(): { store: RateLimitStore; isShared: boolean } {
  const url = process.env.SHARED_CACHE_REDIS_URL;
  if (url) {
    try {
      const client = new Redis(url, {
        lazyConnect:          false,
        maxRetriesPerRequest: 2,
        enableOfflineQueue:   false,
        connectTimeout:       5_000,
      });
      // Log connection-level errors. Because ioredis failures are async,
      // these arrive here rather than at construction time.
      client.on("error", (err) => {
        logger.warn({ err: err.message }, "rescan rate-limit redis error");
      });
      logger.info("rescan rate-limit store: redis (shared across replicas)");
      return { store: new RedisStore(client), isShared: true };
    } catch (err) {
      // Only synchronous/deterministic failures reach here (e.g. bad URL).
      // Network-level failures (ECONNREFUSED) are async and handled in consume().
      logger.error(
        { err: (err as Error).message },
        "rescan rate-limit: failed to instantiate Redis client — falling back to in-process memory. " +
        "Shared rate limiting is UNAVAILABLE; per-tenant limits will not be enforced across replicas.",
      );
      return { store: new MemoryStore(), isShared: false };
    }
  }

  logger.info(
    "rescan rate-limit store: in-process memory " +
    "(set SHARED_CACHE_REDIS_URL to share limits across replicas)",
  );
  return { store: new MemoryStore(), isShared: false };
}

// ─── Middleware factory ───────────────────────────────────────────────────────

export interface RescanRateLimiterOptions {
  /** Max rescan calls allowed per `intervalMs`. Default: 10. */
  capacity?: number;
  /** Refill window in ms. Default: 60_000 (one minute). */
  intervalMs?: number;
  /** Injection point for tests — defaults to `Date.now`. */
  now?: () => number;
  /** Override the default tenant-id key extractor. */
  keyFromRequest?: (req: Request) => string | null;
  /**
   * Backing store for bucket state. Defaults to a Redis store when
   * SHARED_CACHE_REDIS_URL is set, or an in-process MemoryStore otherwise.
   * Inject a shared MemoryStore or mock in tests.
   */
  store?: RateLimitStore;
  /**
   * Signals whether the injected `store` is actually shared across replicas.
   * Only relevant when `store` is provided explicitly (e.g. in tests) AND
   * `requireSharedStore` is true. Defaults to `true` when `store` is given
   * (the caller is assumed to know what they are injecting). In production the
   * value comes from `buildDefaultStore().isShared` automatically.
   *
   * Pass `false` in tests to simulate "Redis fell back to in-process memory"
   * so the fail-closed path can be exercised without a real Redis server.
   */
  storeIsShared?: boolean;
  /**
   * When true, the middleware returns 503 ("rate limit service unavailable")
   * in two situations:
   *   1. The shared store was required but could not be initialized (fell back
   *      to in-process memory) — caught at construction time via `isShared`.
   *   2. The store's `consume` call throws at request time.
   *
   * This prevents multi-replica deployments from silently losing cross-instance
   * enforcement when Redis is misconfigured or down.
   *
   * Defaults to `true` when REQUIRE_SHARED_RESCAN_LIMITS env var is set;
   * `false` otherwise (single-instance / resilience-first deployments).
   */
  requireSharedStore?: boolean;
}

function defaultKey(req: Request): string | null {
  const ctx = (req as unknown as { enrichmentCtx?: { orgId?: number | string | null } }).enrichmentCtx;
  if (ctx?.orgId != null) return `tenant-${String(ctx.orgId)}`;

  const rbac = (req as unknown as { rbacUser?: { organizationId?: number | string | null; id?: number | string | null } }).rbacUser;
  if (rbac?.organizationId != null) return `tenant-${String(rbac.organizationId)}`;
  if (rbac?.id != null)             return `user-${String(rbac.id)}`;
  return null;
}

export interface BucketSnapshot {
  /** Floored remaining whole tokens at the time of the snapshot. */
  remaining: number;
  /** The limiter's configured capacity. */
  capacity: number;
  /**
   * Milliseconds until the next whole token is available.
   * 0 when at least one token is already available.
   */
  resetInMs: number;
}

export interface RescanRateLimiterMiddleware extends RequestHandler {
  /**
   * The underlying store. When using MemoryStore you can access
   * `(middleware.store as MemoryStore)._buckets` in tests.
   * @deprecated Use `store` directly for test assertions instead.
   */
  _bucketsForTests:   Map<string, Bucket>;
  capacity:           number;
  intervalMs:         number;
  store:              RateLimitStore;
  requireSharedStore: boolean;
  /**
   * Returns a point-in-time snapshot of the named tenant's budget.
   * Applies the same continuous-refill math as the middleware so callers
   * get a consistent view without having to replicate the refill logic.
   * Returns a full-budget snapshot when the tenant has not yet made any
   * requests, or when the store is a RedisStore (live Redis bucket state
   * cannot be read synchronously).
   */
  inspectBucket: (key: string) => BucketSnapshot;
}

export function createRescanRateLimiter(
  opts: RescanRateLimiterOptions = {},
): RescanRateLimiterMiddleware {
  const capacity   = opts.capacity   ?? 10;
  const intervalMs = opts.intervalMs ?? 60_000;
  const now        = opts.now        ?? (() => Date.now());
  const keyFn      = opts.keyFromRequest ?? defaultKey;

  const requireSharedStore =
    opts.requireSharedStore ??
    (process.env.REQUIRE_SHARED_RESCAN_LIMITS === "true");

  let store: RateLimitStore;
  let sharedStoreAvailable: boolean;

  if (opts.store) {
    store = opts.store;
    // Caller explicitly injected a store. Assume it is shared unless they
    // pass `storeIsShared: false` — used in tests to simulate a Redis
    // fallback without requiring a real Redis server.
    sharedStoreAvailable = opts.storeIsShared ?? true;
  } else {
    const built = buildDefaultStore();
    store = built.store;
    sharedStoreAvailable = built.isShared;
  }

  // Log prominently when the shared store is required but unavailable at
  // construction time. Requests will be rejected with 503 at runtime.
  if (requireSharedStore && !sharedStoreAvailable) {
    logger.error(
      "REQUIRE_SHARED_RESCAN_LIMITS is set but the shared Redis store is unavailable. " +
      "All rescan requests will be rejected with 503 until the store is restored.",
    );
  }

  if (capacity <= 0)   throw new Error("rescan rate limiter: capacity must be > 0");
  if (intervalMs <= 0) throw new Error("rescan rate limiter: intervalMs must be > 0");

  const middleware: RequestHandler = async (req, res, next) => {
    const key = keyFn(req);
    if (!key) {
      next();
      return;
    }

    // Fail closed immediately when the shared store was required but never
    // became available (e.g., Redis misconfigured / failed to connect). This
    // covers the construction-time failure path; the runtime-error path below
    // covers transient failures after a successful start.
    if (requireSharedStore && !sharedStoreAvailable) {
      logger.error({ key }, "rescan rate-limit: shared store required but unavailable — rejecting request");
      res.status(503).json({
        error:   "Rate limit service unavailable",
        message: "The rate limit service is temporarily unavailable. Please try again shortly.",
        code:    "RATE_LIMIT_STORE_UNAVAILABLE",
      });
      return;
    }

    let result: ConsumeResult;
    try {
      result = await store.consume(key, capacity, intervalMs, now());
    } catch (err) {
      logger.error({ err: (err as Error).message, key }, "rescan rate-limit store error");

      if (requireSharedStore) {
        // Fail closed: the shared limit is required and the store threw
        // at request time (transient failure after successful start).
        res.status(503).json({
          error:   "Rate limit service unavailable",
          message: "The rate limit service is temporarily unavailable. Please try again shortly.",
          code:    "RATE_LIMIT_STORE_UNAVAILABLE",
        });
        return;
      }

      // Fail open: single-instance or resilience-first deployment. Log at
      // ERROR so it's visible, but let the request through rather than
      // blocking a feature that would otherwise be healthy.
      logger.error(
        { key },
        "rescan rate-limit: failing open because requireSharedStore=false. " +
        "Set REQUIRE_SHARED_RESCAN_LIMITS=true to fail closed on store errors.",
      );
      next();
      return;
    }

    if (result.allowed) {
      next();
      return;
    }

    const retryAfter = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    logger.warn({ key, retryAfter }, "rescan rate limit exceeded");

    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({
      error:      "Too many rescan requests",
      message:    `You're rescanning too quickly. Please wait ${retryAfter}s and try again.`,
      code:       "RATE_LIMIT_RESCAN",
      retryAfter,
    });
  };

  const msPerToken = intervalMs / capacity;
  const memStore   = store instanceof MemoryStore ? store : null;
  const wrapped    = middleware as RescanRateLimiterMiddleware;
  wrapped._bucketsForTests   = memStore?._buckets ?? new Map();
  wrapped.capacity           = capacity;
  wrapped.intervalMs         = intervalMs;
  wrapped.store              = store;
  wrapped.requireSharedStore = requireSharedStore;

  wrapped.inspectBucket = (key: string): BucketSnapshot => {
    // Only in-process MemoryStore buckets can be read synchronously.
    // For a RedisStore the live state lives on the server; return the
    // theoretical full-budget snapshot so callers degrade gracefully.
    const bucket = memStore?._buckets.get(key);
    if (!bucket) {
      return { remaining: capacity, capacity, resetInMs: 0 };
    }
    const t       = now();
    const elapsed = Math.max(0, t - bucket.lastRefill);
    const refill  = elapsed > 0 ? (elapsed / intervalMs) * capacity : 0;
    const current = Math.min(capacity, bucket.tokens + refill);
    const remaining = Math.floor(current);
    const resetInMs = current >= 1
      ? 0
      : Math.max(0, Math.ceil((1 - current) * msPerToken));
    return { remaining, capacity, resetInMs };
  };

  return wrapped;
}

/**
 * Default singleton used by the feed-enrichment router. 10 rescans / minute
 * per tenant — at the route's 100-id cap, that's still 1,000 product rescans
 * per minute per tenant, which dwarfs anything a real human can drive from
 * the UI but blocks pathological click-storms.
 */
export const rescanRateLimit = createRescanRateLimiter();
