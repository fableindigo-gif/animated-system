/**
 * Unit tests for the per-tenant token-bucket rate limiter that guards
 * POST /api/feed-enrichment/quality-fixes/rescan.
 *
 * Covers:
 *   - The first `capacity` calls in a window are allowed; the (capacity+1)th
 *     is rejected with 429 + a Retry-After header.
 *   - After enough simulated time passes the bucket refills and the next
 *     call is allowed again.
 *   - Buckets are isolated per tenant — one tenant burning their budget
 *     does not block another.
 *   - When no tenant key can be derived the middleware is a no-op (the
 *     downstream handler owns the 401 path).
 *   - Two middleware instances sharing the same store enforce the combined
 *     budget — simulating multiple server replicas behind a load balancer.
 *     This test catches regressions where the shared store is bypassed and
 *     each instance falls back to its own private in-process map.
 *   - When `requireSharedStore` is true and the store throws, the middleware
 *     returns 503 instead of silently failing open. This ensures misconfigured
 *     deployments fail loudly rather than losing cross-replica enforcement.
 *   - When `requireSharedStore` is false and the store throws, the middleware
 *     fails open (lets the request through) and logs an error.
 */
import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

import { createRescanRateLimiter, MemoryStore, type RateLimitStore } from "../middleware/rescan-rate-limiter";

interface FakeRes {
  statusCode:    number | null;
  jsonBody:      unknown;
  headers:       Record<string, string>;
  status:        (n: number) => FakeRes;
  json:          (b: unknown) => FakeRes;
  setHeader:     (k: string, v: string) => void;
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: null,
    jsonBody:   null,
    headers:    {},
    status(n)  { this.statusCode = n; return this; },
    json(b)    { this.jsonBody   = b; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
  return res;
}

function makeReq(orgId: string | number | null): Request {
  return {
    enrichmentCtx: orgId == null ? null : { orgId },
  } as unknown as Request;
}

/** Fire the middleware and wait for next() or res.json() to be called. */
async function invoke(
  limiter: ReturnType<typeof createRescanRateLimiter>,
  req: Request,
): Promise<{ res: FakeRes; nextCalled: boolean }> {
  const res  = makeRes();
  const next = vi.fn();
  await limiter(req, res as unknown as Response, next);
  return { res, nextCalled: next.mock.calls.length === 1 };
}

/** A store that always throws — simulates Redis being unavailable. */
function makeBrokenStore(): RateLimitStore {
  return {
    kind: "redis",
    consume: async () => { throw new Error("Redis connection refused"); },
  };
}

describe("createRescanRateLimiter", () => {
  it("rejects the (N+1)th request inside the window with 429 + Retry-After", async () => {
    let now = 1_000_000;
    const limiter = createRescanRateLimiter({
      capacity:   3,
      intervalMs: 60_000,
      now: () => now,
      store: new MemoryStore(),
    });

    const req = makeReq(42);
    let allowed = 0;
    let blocked: FakeRes | null = null;

    for (let i = 0; i < 4; i++) {
      const { res, nextCalled } = await invoke(limiter, req);
      if (nextCalled) {
        allowed += 1;
      } else {
        blocked = res;
      }
    }

    expect(allowed).toBe(3);
    expect(blocked).not.toBeNull();
    expect(blocked!.statusCode).toBe(429);
    expect(blocked!.headers["Retry-After"]).toBeDefined();
    const body = blocked!.jsonBody as { code: string; retryAfter: number; message: string };
    expect(body.code).toBe("RATE_LIMIT_RESCAN");
    expect(body.retryAfter).toBeGreaterThan(0);
    // Refill rate is capacity/intervalMs = 3 per 60s = 1 token / 20s.
    // The 4th call lands when the bucket is empty, so retryAfter ≈ 20s.
    expect(body.retryAfter).toBeLessThanOrEqual(20);
    expect(body.message).toMatch(/slow down|rescanning too quickly|wait/i);
  });

  it("resets cleanly after the window and lets calls through again", async () => {
    let now = 5_000_000;
    const limiter = createRescanRateLimiter({
      capacity:   2,
      intervalMs: 60_000,
      now: () => now,
      store: new MemoryStore(),
    });

    const req = makeReq(7);

    // Burn the budget.
    for (let i = 0; i < 2; i++) {
      const { res, nextCalled } = await invoke(limiter, req);
      expect(nextCalled).toBe(true);
      expect(res.statusCode).toBeNull();
    }

    // Next call: blocked.
    {
      const { res, nextCalled } = await invoke(limiter, req);
      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(429);
    }

    // Advance time by a full window — the bucket should be fully refilled
    // and the limiter should let calls through again.
    now += 60_000;

    for (let i = 0; i < 2; i++) {
      const { res, nextCalled } = await invoke(limiter, req);
      expect(nextCalled).toBe(true);
      expect(res.statusCode).toBeNull();
    }

    // And the (N+1)th post-reset call is rejected again — proving the
    // bucket re-arms with the same capacity (no permanent drain).
    {
      const { res, nextCalled } = await invoke(limiter, req);
      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(429);
    }
  });

  it("isolates buckets per tenant", async () => {
    let now = 10_000_000;
    const limiter = createRescanRateLimiter({
      capacity:   1,
      intervalMs: 60_000,
      now: () => now,
      store: new MemoryStore(),
    });

    const tenantA = makeReq("A");
    const tenantB = makeReq("B");

    // Tenant A spends their single token.
    expect((await invoke(limiter, tenantA)).nextCalled).toBe(true);
    // Tenant A is now blocked.
    {
      const { res, nextCalled } = await invoke(limiter, tenantA);
      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(429);
    }
    // Tenant B still has a full bucket — they must be allowed through.
    expect((await invoke(limiter, tenantB)).nextCalled).toBe(true);
  });

  it("is a no-op when no tenant key can be derived (handler owns the 401)", async () => {
    const store   = new MemoryStore();
    const limiter = createRescanRateLimiter({ capacity: 1, intervalMs: 60_000, store });

    const req = makeReq(null);
    for (let i = 0; i < 5; i++) {
      const { nextCalled } = await invoke(limiter, req);
      expect(nextCalled).toBe(true);
    }
    // No bucket should have been created either.
    expect(store._buckets.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Multi-replica regression test
  //
  // Two separate middleware instances simulate two API server replicas.
  // They are wired to the SAME MemoryStore (which stands in for Redis in
  // this unit test context). The test proves that the combined budget is
  // honoured across "replicas" — if either instance reverted to using its
  // own private map, this test would fail because instance-2 would see a
  // full bucket even after instance-1 exhausted the shared one.
  // ─────────────────────────────────────────────────────────────────────────────
  it("enforces the budget across two replicas sharing the same store", async () => {
    let now = 20_000_000;
    const sharedStore = new MemoryStore();

    const replica1 = createRescanRateLimiter({
      capacity:   3,
      intervalMs: 60_000,
      now: () => now,
      store: sharedStore,
    });
    const replica2 = createRescanRateLimiter({
      capacity:   3,
      intervalMs: 60_000,
      now: () => now,
      store: sharedStore,
    });

    const req = makeReq("shared-tenant");

    // Exhaust 2 tokens via replica 1.
    expect((await invoke(replica1, req)).nextCalled).toBe(true);
    expect((await invoke(replica1, req)).nextCalled).toBe(true);

    // Consume the last token via replica 2 (a different server instance).
    expect((await invoke(replica2, req)).nextCalled).toBe(true);

    // Both replicas should now see the bucket as empty.
    {
      const via1 = await invoke(replica1, req);
      expect(via1.nextCalled).toBe(false);
      expect(via1.res.statusCode).toBe(429);
    }
    {
      const via2 = await invoke(replica2, req);
      expect(via2.nextCalled).toBe(false);
      expect(via2.res.statusCode).toBe(429);
    }

    // After a full refill window, both replicas allow traffic again.
    now += 60_000;
    expect((await invoke(replica1, req)).nextCalled).toBe(true);
    expect((await invoke(replica2, req)).nextCalled).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Store misconfiguration / availability tests
  //
  // These tests verify the intended failure mode when the backing store is
  // unreachable. They are the "clearly-failing regression tests" required by
  // the task: if someone removes the requireSharedStore path or reverts the
  // fail-closed logic, at least one of these assertions will fail.
  // ─────────────────────────────────────────────────────────────────────────────
  it("returns 503 when the store is unavailable and requireSharedStore=true", async () => {
    const limiter = createRescanRateLimiter({
      capacity:           3,
      intervalMs:         60_000,
      store:              makeBrokenStore(),
      requireSharedStore: true,
    });

    const { res, nextCalled } = await invoke(limiter, makeReq(99));

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(503);
    const body = res.jsonBody as { code: string };
    expect(body.code).toBe("RATE_LIMIT_STORE_UNAVAILABLE");
  });

  it("fails open when the store is unavailable and requireSharedStore=false", async () => {
    const limiter = createRescanRateLimiter({
      capacity:           3,
      intervalMs:         60_000,
      store:              makeBrokenStore(),
      requireSharedStore: false,
    });

    // Store is broken but requireSharedStore is false — request must go through.
    const { res, nextCalled } = await invoke(limiter, makeReq(88));

    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Construction-time misconfiguration regression test
  //
  // This is the key regression guard for "shared store is misconfigured":
  // when REQUIRE_SHARED_RESCAN_LIMITS is true but the Redis connection failed
  // at startup (buildDefaultStore returned isShared=false), the middleware must
  // reject ALL tenant requests with 503 rather than silently using in-process
  // state. Without this check, operators would have no idea the shared limit
  // was disabled and tenants could bypass quotas on different replicas.
  //
  // We simulate this without a real Redis server by injecting a MemoryStore
  // with `storeIsShared: false` (mimics the Redis-init-failure fallback).
  // ─────────────────────────────────────────────────────────────────────────────
  it("returns 503 for all tenant requests when requireSharedStore=true but store is not shared (Redis fallback at init)", async () => {
    const limiter = createRescanRateLimiter({
      capacity:           5,
      intervalMs:         60_000,
      store:              new MemoryStore(),  // simulates Redis-fallback memory store
      storeIsShared:      false,             // <-- tells limiter the store is NOT shared
      requireSharedStore: true,
    });

    // Every identified tenant must get 503 — the limiter cannot enforce the
    // shared limit so it must not allow any tenant through with unshared state.
    for (let i = 0; i < 3; i++) {
      const { res, nextCalled } = await invoke(limiter, makeReq(10 + i));
      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(503);
      const body = res.jsonBody as { code: string };
      expect(body.code).toBe("RATE_LIMIT_STORE_UNAVAILABLE");
    }
  });

  it("allows requests through when requireSharedStore=true but storeIsShared=false has NO identified tenant (no-op path)", async () => {
    // No-op path: no tenant key → middleware must NOT 503, just pass through
    // (the 401 is downstream). The fail-closed check only applies to
    // identified tenants — unidentified callers are handled by the handler.
    const limiter = createRescanRateLimiter({
      capacity:           5,
      intervalMs:         60_000,
      store:              new MemoryStore(),
      storeIsShared:      false,
      requireSharedStore: true,
    });

    const { nextCalled } = await invoke(limiter, makeReq(null));
    expect(nextCalled).toBe(true);
  });

  it("503s on store error even after some successful calls (requireSharedStore=true)", async () => {
    let callCount = 0;
    const flakyStore: RateLimitStore = {
      kind: "redis",
      consume: async (key, capacity, intervalMs, nowMs) => {
        callCount += 1;
        // Succeeds for the first 2 calls, then breaks.
        if (callCount <= 2) {
          return new MemoryStore().consume(key, capacity, intervalMs, nowMs);
        }
        throw new Error("Redis went away");
      },
    };

    const limiter = createRescanRateLimiter({
      capacity:           5,
      intervalMs:         60_000,
      store:              flakyStore,
      requireSharedStore: true,
    });

    const req = makeReq("flaky-tenant");

    // First two calls succeed.
    expect((await invoke(limiter, req)).nextCalled).toBe(true);
    expect((await invoke(limiter, req)).nextCalled).toBe(true);

    // Third call — store throws — should be 503, not 429, not next().
    const { res, nextCalled } = await invoke(limiter, req);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(503);
    const body = res.jsonBody as { code: string };
    expect(body.code).toBe("RATE_LIMIT_STORE_UNAVAILABLE");
  });
});
