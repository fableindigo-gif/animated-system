// ─── TTL Cache ────────────────────────────────────────────────────────────────
// A small TTL-aware cache that transparently uses one of two backends:
//   • In-process Map (default — what we've always done).
//   • Shared Redis store (when SHARED_CACHE_REDIS_URL is set), so that
//     multiple API server replicas share a single cache and preserve
//     hit rates / BigQuery savings under horizontal scale.
//
// Key format and TTL semantics are identical across both backends, so
// callers don't need to care which one is active.

import Redis, { type Redis as RedisClient, type RedisOptions } from "ioredis";
import { logger } from "./logger";

interface MemoryEntry<T> {
  data: T;
  ts: number;
}

/** Backend contract — both Map and Redis implementations satisfy this. */
interface CacheBackend<T> {
  readonly kind: "memory" | "redis";
  get(key: string): Promise<T | null>;
  set(key: string, data: T): Promise<void>;
  invalidate(key: string): Promise<void>;
  clear(): Promise<void>;
  size(): Promise<number>;
  /** Sweep expired entries (memory only — Redis expires on its own). */
  purgeExpired(): Promise<number>;
}

// ─── Memory backend ───────────────────────────────────────────────────────────

class MemoryBackend<T> implements CacheBackend<T> {
  readonly kind = "memory" as const;
  private readonly store = new Map<string, MemoryEntry<T>>();
  constructor(private readonly ttlMs: number) {}

  async get(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > this.ttlMs) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  async set(key: string, data: T): Promise<void> {
    this.store.set(key, { data, ts: Date.now() });
  }

  async invalidate(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async size(): Promise<number> {
    return this.store.size;
  }

  async purgeExpired(): Promise<number> {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.store.entries()) {
      if (now - entry.ts > this.ttlMs) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }
}

// ─── Redis backend ────────────────────────────────────────────────────────────

let _sharedRedis: RedisClient | null = null;
let _sharedRedisFailed = false;

/** Lazily build (or reuse) the singleton Redis client. */
function getSharedRedis(): RedisClient | null {
  if (_sharedRedisFailed) return null;
  if (_sharedRedis) return _sharedRedis;

  const url = process.env.SHARED_CACHE_REDIS_URL;
  if (!url) return null;

  try {
    const opts: RedisOptions = {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      connectTimeout: 5_000,
    };
    const client = new Redis(url, opts);
    client.on("error", (err) => {
      logger.warn({ err: err.message }, "shared cache redis error");
      // Surface the most recent connection-level error to operators via
      // /api/system/cache-health (Task #39).
      recordCacheError(err.message);
    });
    _sharedRedis = client;
    logger.info("shared cache backend: redis");
    return client;
  } catch (err) {
    _sharedRedisFailed = true;
    const msg = (err as Error).message;
    logger.warn({ err: msg }, "failed to init shared cache redis; falling back to memory");
    recordCacheError(`init failed: ${msg}`);
    return null;
  }
}

class RedisBackend<T> implements CacheBackend<T> {
  readonly kind = "redis" as const;
  private readonly ttlSeconds: number;
  private readonly prefix: string;

  constructor(
    private readonly client: RedisClient,
    ttlMs: number,
    namespace: string,
  ) {
    this.ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    const root = process.env.SHARED_CACHE_KEY_PREFIX ?? "omnianalytix:cache:";
    this.prefix = `${root}${namespace}:`;
  }

  private k(key: string): string {
    return `${this.prefix}${key}`;
  }

  async get(key: string): Promise<T | null> {
    try {
      const raw = await this.client.get(this.k(key));
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      logger.warn({ err: (err as Error).message, key }, "shared cache get failed");
      recordCacheError(`get failed: ${(err as Error).message}`);
      return null;
    }
  }

  async set(key: string, data: T): Promise<void> {
    try {
      await this.client.set(this.k(key), JSON.stringify(data), "EX", this.ttlSeconds);
    } catch (err) {
      logger.warn({ err: (err as Error).message, key }, "shared cache set failed");
      recordCacheError(`set failed: ${(err as Error).message}`);
    }
  }

  async invalidate(key: string): Promise<void> {
    try {
      await this.client.del(this.k(key));
    } catch (err) {
      logger.warn({ err: (err as Error).message, key }, "shared cache invalidate failed");
      recordCacheError(`invalidate failed: ${(err as Error).message}`);
    }
  }

  async clear(): Promise<void> {
    try {
      const stream = this.client.scanStream({ match: `${this.prefix}*`, count: 200 });
      for await (const keys of stream as AsyncIterable<string[]>) {
        if (keys.length) await this.client.del(...keys);
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "shared cache clear failed");
      recordCacheError(`clear failed: ${(err as Error).message}`);
    }
  }

  async size(): Promise<number> {
    let count = 0;
    try {
      const stream = this.client.scanStream({ match: `${this.prefix}*`, count: 200 });
      for await (const keys of stream as AsyncIterable<string[]>) count += keys.length;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "shared cache size failed");
      recordCacheError(`size failed: ${(err as Error).message}`);
    }
    return count;
  }

  async purgeExpired(): Promise<number> {
    return 0; // Redis evicts on its own.
  }
}

// ─── Rolling hit-rate window (Task #58) ──────────────────────────────────────
// Tracks cache hits, misses, and bypasses in 1-minute buckets so callers can
// compute a rolling hit-rate over any sub-hour window without unbounded memory.

const BUCKET_MS = 60_000;       // 1 minute per bucket
const WINDOW_BUCKETS = 60;      // keep 60 buckets = 1 hour

interface RollingBucket {
  minuteKey: number;  // Math.floor(Date.now() / BUCKET_MS)
  hits: number;
  misses: number;
  bypasses: number;
}

const rollingBuckets: RollingBucket[] = [];

function currentMinuteKey(): number {
  return Math.floor(Date.now() / BUCKET_MS);
}

function activeBucket(): RollingBucket {
  const key = currentMinuteKey();
  const last = rollingBuckets[rollingBuckets.length - 1];
  if (last && last.minuteKey === key) return last;
  const bucket: RollingBucket = { minuteKey: key, hits: 0, misses: 0, bypasses: 0 };
  rollingBuckets.push(bucket);
  // Evict old buckets (keep only last WINDOW_BUCKETS entries)
  while (rollingBuckets.length > WINDOW_BUCKETS) rollingBuckets.shift();
  return bucket;
}

/** Record a cache hit against the rolling window. */
export function recordCacheHit(): void {
  activeBucket().hits++;
}

/** Record a cache miss against the rolling window. */
export function recordCacheMiss(): void {
  activeBucket().misses++;
}

/** Record a cache bypass (cache intentionally skipped) against the rolling window. */
export function recordCacheBypass(): void {
  activeBucket().bypasses++;
}

export interface CacheRollingStats {
  hits: number;
  misses: number;
  bypasses: number;
  /** null when no lookups have occurred yet. */
  hitRate: number | null;
  /** How far back the window spans in milliseconds (≤ 3 600 000). */
  windowMs: number;
}

/**
 * Aggregate rolling stats from the last `windowMs` milliseconds (default 1h).
 * Exported for use by pingCache() and tests.
 */
export function getCacheRollingStats(windowMs = 3_600_000): CacheRollingStats {
  const cutoff = currentMinuteKey() - Math.ceil(windowMs / BUCKET_MS);
  let hits = 0, misses = 0, bypasses = 0;
  for (const b of rollingBuckets) {
    if (b.minuteKey > cutoff) {
      hits += b.hits;
      misses += b.misses;
      bypasses += b.bypasses;
    }
  }
  const lookups = hits + misses;
  return {
    hits,
    misses,
    bypasses,
    hitRate: lookups === 0 ? null : hits / lookups,
    windowMs,
  };
}

// ─── Hourly hit-rate history (Task #214) ─────────────────────────────────────
// Persists up to 24 hourly snapshots in an in-process ring buffer so the
// dashboard can plot a sparkline of hit-rate over the last 24 hours.

const HISTORY_MAX = 24;

interface HourlySnapshot {
  /** Math.floor(epoch_ms / 3_600_000) — one slot per clock-hour. */
  hourKey: number;
  hitRate: number | null;
}

const hitRateHistory: HourlySnapshot[] = [];

function currentHourKey(): number {
  return Math.floor(Date.now() / 3_600_000);
}

export interface CacheHitRatePoint {
  /** ISO timestamp of the start of the clock-hour. */
  hour: string;
  /** 0–1, or null when no lookups occurred that hour. */
  hitRate: number | null;
}

/**
 * Capture a rolling-stats snapshot for the current clock-hour.
 * Idempotent: calling it multiple times within the same hour is a no-op.
 * Exported so tests can exercise it directly.
 */
export function snapshotHourlyHitRate(): void {
  const key = currentHourKey();
  const last = hitRateHistory[hitRateHistory.length - 1];
  if (last && last.hourKey === key) return;
  const stats = getCacheRollingStats(3_600_000);
  hitRateHistory.push({ hourKey: key, hitRate: stats.hitRate });
  while (hitRateHistory.length > HISTORY_MAX) hitRateHistory.shift();
}

/** Return up to 24 hourly hit-rate snapshots, oldest first. */
export function getCacheHitRateHistory(): CacheHitRatePoint[] {
  return hitRateHistory.map(({ hourKey, hitRate }) => ({
    hour: new Date(hourKey * 3_600_000).toISOString(),
    hitRate,
  }));
}

// Automatically snapshot once per hour so history accumulates even when no
// operator has the dashboard open.
setInterval(() => { snapshotHourlyHitRate(); }, 3_600_000).unref();

// ─── Public TTLCache facade ───────────────────────────────────────────────────

/**
 * Generic async TTL cache. Uses Redis when SHARED_CACHE_REDIS_URL is
 * configured; otherwise an in-process Map.
 *
 * `namespace` is required so multiple logical caches can safely share the
 * same Redis instance without colliding key spaces.
 *
 * Every `get()` call increments the module-level rolling hit/miss counter so
 * that /api/system/cache-health can report an accurate hit-rate (Task #58).
 */
export class TTLCache<T> {
  private readonly backend: CacheBackend<T>;

  constructor(ttlMs: number, namespace: string) {
    const redis = getSharedRedis();
    this.backend = redis
      ? new RedisBackend<T>(redis, ttlMs, namespace)
      : new MemoryBackend<T>(ttlMs);
  }

  /** Which backend is in use — handy for diagnostics + tests. */
  get backendKind(): "memory" | "redis" {
    return this.backend.kind;
  }

  async get(key: string): Promise<T | null> {
    const result = await this.backend.get(key);
    if (result !== null) {
      recordCacheHit();
    } else {
      recordCacheMiss();
    }
    return result;
  }

  set(key: string, data: T): Promise<void> {
    return this.backend.set(key, data);
  }

  invalidate(key: string): Promise<void> {
    return this.backend.invalidate(key);
  }

  clear(): Promise<void> {
    return this.backend.clear();
  }

  size(): Promise<number> {
    return this.backend.size();
  }

  purgeExpired(): Promise<number> {
    return this.backend.purgeExpired();
  }
}

// ─── Singleton platform-data cache ────────────────────────────────────────────
// Key: `${connectionId}:${platform}`  Value: PlatformData
// 60-second TTL preserves today's behavior; the same key format and TTL
// are used regardless of backend.
import type { PlatformData } from "./platform-fetchers";
export const platformDataCache = new TTLCache<PlatformData>(60_000, "platform-data");

// Periodic purge for the in-memory backend so the Map never grows unbounded.
// No-op when Redis is the active backend (Redis expires keys natively).
setInterval(() => {
  void platformDataCache.purgeExpired();
}, 5 * 60 * 1000).unref();

// ─── Shared-cache health (Task #39 / Task #58) ───────────────────────────────
// When SHARED_CACHE_REDIS_URL is set the deployment expects a shared Redis
// cache; if that connection silently degrades, every replica falls back to
// its own memory cache and BigQuery cost creeps up. This module exposes the
// active backend, the last error timestamp, a non-throwing PING, and a
// rolling hit-rate so operators can judge whether the cache is actually saving
// BigQuery calls or just adding latency (Task #58).

export type CacheBackendKind = "memory" | "redis";

let lastError: { at: string; reason: string } | null = null;

/** Record a degradation event from anywhere in the cache layer. */
export function recordCacheError(reason: string): void {
  lastError = { at: new Date().toISOString(), reason };
}

/** Configured backend kind, derived from env. */
export function getConfiguredBackend(): CacheBackendKind {
  return process.env.SHARED_CACHE_REDIS_URL ? "redis" : "memory";
}

export interface CacheHealth {
  ok: boolean;
  backend: CacheBackendKind;
  configuredBackend: CacheBackendKind;
  pingMs: number | null;
  reason?: string;
  lastErrorAt: string | null;
  lastErrorReason: string | null;
  /** Rolling hit-rate over the last hour (0–1), or null if no lookups yet. */
  hitRate: number | null;
  /** Raw counters for the last hour. */
  hitsLastHour: number;
  missesLastHour: number;
  bypassesLastHour: number;
  /** Hourly snapshots over the last 24 h, oldest first (Task #214). */
  history: CacheHitRatePoint[];
}

/**
 * Quick PING against the shared cache. Never throws — a broken cache returns
 * { ok: false, reason }. When Redis is configured but unreachable we report
 * the active backend (whatever the singleton TTLCache actually fell back to)
 * so the dashboard can show a red indicator even though the process keeps
 * serving. Also includes rolling hit-rate stats (Task #58).
 */
export async function pingCache(): Promise<CacheHealth> {
  // Opportunistically snapshot the current hour so history grows on every poll.
  snapshotHourlyHitRate();

  const configured = getConfiguredBackend();
  const activeBackend: CacheBackendKind = platformDataCache.backendKind;
  const baseError = {
    lastErrorAt: lastError?.at ?? null,
    lastErrorReason: lastError?.reason ?? null,
  };
  const rolling = getCacheRollingStats();
  const rollingFields = {
    hitRate: rolling.hitRate,
    hitsLastHour: rolling.hits,
    missesLastHour: rolling.misses,
    bypassesLastHour: rolling.bypasses,
    history: getCacheHitRateHistory(),
  };

  if (configured === "memory") {
    return {
      ok: true,
      backend: "memory",
      configuredBackend: "memory",
      pingMs: 0,
      ...baseError,
      ...rollingFields,
    };
  }

  // configured === "redis"
  const client = getSharedRedis();
  if (!client) {
    const reason = "redis client unavailable; using memory fallback";
    recordCacheError(reason);
    return {
      ok: false,
      backend: activeBackend,
      configuredBackend: "redis",
      pingMs: null,
      reason,
      lastErrorAt: lastError?.at ?? null,
      lastErrorReason: lastError?.reason ?? null,
      ...rollingFields,
    };
  }

  const t0 = Date.now();
  try {
    const pong = await Promise.race([
      client.ping(),
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error("ping timeout")), 2000)),
    ]);
    const pingMs = Date.now() - t0;
    const ok = typeof pong === "string" && pong.toUpperCase() === "PONG";
    if (!ok) recordCacheError(`unexpected PING reply: ${String(pong)}`);
    return {
      ok,
      backend: ok ? "redis" : activeBackend,
      configuredBackend: "redis",
      pingMs,
      reason: ok ? undefined : "unexpected PING reply",
      lastErrorAt: lastError?.at ?? null,
      lastErrorReason: lastError?.reason ?? null,
      ...rollingFields,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    recordCacheError(reason);
    return {
      ok: false,
      backend: activeBackend,
      configuredBackend: "redis",
      pingMs: null,
      reason,
      lastErrorAt: lastError?.at ?? null,
      lastErrorReason: lastError?.reason ?? null,
      ...rollingFields,
    };
  }
}
