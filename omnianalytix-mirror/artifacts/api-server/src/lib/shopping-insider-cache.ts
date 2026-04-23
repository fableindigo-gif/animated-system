/**
 * shopping-insider-cache.ts — 1-hour cache that fronts the Shopping
 * Insider BigQuery queries to cut spend on repeated reads (Task #21),
 * plus per-function counters that record cache hits, misses and the
 * BigQuery bytes those hits avoided (Task #27).
 *
 * The underlying TTLCache transparently uses Redis when
 * SHARED_CACHE_REDIS_URL is set so multiple API server replicas share
 * the same cache; otherwise it falls back to an in-process Map.
 *
 * Counters are exposed via `getCacheMetrics()` — see
 * `routes/admin/shopping-insider-cache.ts` and SHOPPING_INSIDER.md for
 * how to read them.
 *
 * Configurable via `SHOPPING_INSIDER_CACHE_TTL_MS` (default 1 hour).
 * Set it to `0` to disable the cache entirely; per-call `bypassCache`
 * is handled by the service layer in `services/shopping-insider.ts`.
 */
import { createHash } from "crypto";
import { TTLCache, recordCacheBypass } from "./cache";
import { runQueryWithStats, type RunQueryOptions } from "./bigquery-client";
import { logger } from "./logger";

const DEFAULT_TTL_MS = 60 * 60 * 1000;

export const CACHE_TTL_MS: number = (() => {
  const raw = process.env.SHOPPING_INSIDER_CACHE_TTL_MS;
  if (raw === undefined || raw === "") return DEFAULT_TTL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_TTL_MS;
})();

export const CACHE_DISABLED: boolean = CACHE_TTL_MS === 0;

interface CacheEntry {
  rows: unknown[];
  /** Bytes BigQuery billed for the underlying query that populated this entry. */
  bytes: number;
}

const cache = new TTLCache<CacheEntry>(CACHE_TTL_MS || 1, "shopping-insider");

// Sweep expired entries periodically so the in-memory backend can
// never grow unbounded. (No-op for the Redis backend.)
setInterval(() => {
  void cache.purgeExpired();
}, 5 * 60 * 1000).unref();

export interface CacheCounters {
  hits: number;
  misses: number;
  /** Requests where the cache was intentionally skipped (CACHE_DISABLED path). */
  bypasses: number;
  /** Sum of `totalBytesProcessed` across cache hits (i.e. bytes BigQuery did NOT bill). */
  bytesAvoided: number;
  /** Sum of `totalBytesProcessed` across cache misses (i.e. bytes BigQuery did bill). */
  bytesBilled: number;
}

const countersByFn = new Map<string, CacheCounters>();

function counterFor(fnName: string): CacheCounters {
  let c = countersByFn.get(fnName);
  if (!c) {
    c = { hits: 0, misses: 0, bypasses: 0, bytesAvoided: 0, bytesBilled: 0 };
    countersByFn.set(fnName, c);
  }
  return c;
}

/** Stable cache-key fragment for arbitrary JSON-serialisable opts. */
export function hashKey(parts: unknown): string {
  return createHash("sha1").update(stableStringify(parts)).digest("hex").slice(0, 16);
}

/** JSON.stringify with sorted object keys, so {a:1,b:2} === {b:2,a:1}. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

/**
 * Run `sql` through the 1-hour cache keyed by `${fnName}:${key}`.
 * On a cache hit, increments `bytesAvoided` by the bytes the original
 * query billed — that's our estimate of BigQuery cost saved by the cache.
 * When the cache is disabled (`SHOPPING_INSIDER_CACHE_TTL_MS=0`) the
 * underlying query runs every time and counters are not touched.
 */
export async function withCache<T>(
  fnName: string,
  key: string,
  sql: string,
  opts: RunQueryOptions,
): Promise<T[]> {
  if (CACHE_DISABLED) {
    const c = counterFor(fnName);
    c.bypasses += 1;
    recordCacheBypass();
    const { rows } = await runQueryWithStats<T>(sql, opts);
    return rows;
  }
  const cacheKey = `${fnName}:${key}`;
  const c = counterFor(fnName);
  const cached = await cache.get(cacheKey);
  if (cached) {
    c.hits += 1;
    c.bytesAvoided += cached.bytes;
    logger.debug({ fn: fnName, key: cacheKey }, "Shopping Insider cache hit");
    return cached.rows as T[];
  }
  c.misses += 1;
  const { rows, totalBytesProcessed } = await runQueryWithStats<T>(sql, opts);
  c.bytesBilled += totalBytesProcessed;
  await cache.set(cacheKey, { rows, bytes: totalBytesProcessed });
  return rows;
}

export interface ShoppingInsiderCacheMetrics {
  ttlMs: number;
  cacheSize: number;
  perFunction: Record<string, CacheCounters & { hitRate: number | null }>;
  totals: CacheCounters & { hitRate: number | null };
}

export async function getCacheMetrics(): Promise<ShoppingInsiderCacheMetrics> {
  const perFunction: ShoppingInsiderCacheMetrics["perFunction"] = {};
  let hits = 0;
  let misses = 0;
  let bypasses = 0;
  let bytesAvoided = 0;
  let bytesBilled = 0;
  for (const [fn, c] of countersByFn) {
    const total = c.hits + c.misses;
    perFunction[fn] = { ...c, hitRate: total === 0 ? null : c.hits / total };
    hits += c.hits;
    misses += c.misses;
    bypasses += c.bypasses;
    bytesAvoided += c.bytesAvoided;
    bytesBilled += c.bytesBilled;
  }
  const total = hits + misses;
  return {
    ttlMs: CACHE_TTL_MS,
    cacheSize: await cache.size(),
    perFunction,
    totals: {
      hits,
      misses,
      bypasses,
      bytesAvoided,
      bytesBilled,
      hitRate: total === 0 ? null : hits / total,
    },
  };
}

/**
 * Record a per-call bypass (e.g. bypassCache:true in service layer).
 * Increments both the per-function counter and the shared rolling window
 * so /api/system/cache-health reflects all intentional cache skips.
 */
export function recordBypass(fnName: string): void {
  counterFor(fnName).bypasses += 1;
  recordCacheBypass();
}

/** Clear cached entries (does not reset counters). */
export async function clearShoppingInsiderCache(): Promise<void> {
  await cache.clear();
}

/** Lightweight introspection helper. */
export async function shoppingInsiderCacheStats(): Promise<{ size: number; ttlMs: number }> {
  return { size: await cache.size(), ttlMs: CACHE_TTL_MS };
}

/** Test-only: drop the cache and reset all counters. */
export async function resetCacheForTests(): Promise<void> {
  await cache.clear();
  countersByFn.clear();
}
