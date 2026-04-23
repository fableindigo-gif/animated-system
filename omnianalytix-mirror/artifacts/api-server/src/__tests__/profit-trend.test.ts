/**
 * Integration tests for GET /api/warehouse/profit-trend
 *
 * Verifies the four behaviours mandated by the task:
 *
 *   1. N-day series  — tenant with N warehouse rows (one per day) → response has
 *                      exactly N distinct date points.
 *   2. Mapped COGS   — when cross-platform mapping rows exist for a day the
 *                      `cogs` column in that point uses SKU-level values, NOT
 *                      cogsPctFallback × revenue.
 *   3. Low history   — tenant with < 14 distinct days of data → hasEnoughHistory
 *                      is false.
 *   4. Empty tenant  — tenant with 0 warehouse rows → hasData is false and every
 *                      point's numeric fields are zero.
 *
 * The DB, logger, and all heavy side-effectful imports are mocked; no real
 * Postgres connection is required.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// ── Logger ────────────────────────────────────────────────────────────────────
vi.mock("../lib/logger", () => ({
  logger: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

// ── ETL state (used by /status route loaded alongside profit-trend) ───────────
vi.mock("../lib/etl-state", () => ({
  etlState: { get: vi.fn(async () => null) },
}));

// ── Google token / platform executors (imported at module level) ─────────────
vi.mock("../lib/google-token-refresh", () => ({
  getFreshGoogleCredentials: vi.fn(async () => ({ accessToken: "tok" })),
}));

vi.mock("../lib/platform-executors", () => ({
  googleAds_listCampaigns: vi.fn(async () => []),
}));

// ── DB mock ──────────────────────────────────────────────────────────────────
//
// selectQueue is a FIFO consumed by each db.select().from() chain, in the
// order the queries are created inside Promise.all.  For profit-trend the
// order is:
//   [0] adsRows    — per-day spend & revenue
//   [1] mappedRows — per-day mapped COGS (cross-platform join)
//   [2] orgRow     — cogsPctDefault from organizations
//   [3] historyRow — distinct-days count
//
const selectQueue: unknown[] = [];
const selectSpy = vi.fn();

// Typed interface for the fluent Drizzle ORM query builder that the mock needs
// to satisfy. Every method returns the builder itself so arbitrary chains work.
interface ChainableBuilder extends PromiseLike<unknown> {
  from: (...args: unknown[]) => ChainableBuilder;
  where: (...args: unknown[]) => ChainableBuilder;
  groupBy: (...args: unknown[]) => ChainableBuilder;
  orderBy: (...args: unknown[]) => ChainableBuilder;
  limit: (...args: unknown[]) => ChainableBuilder;
  offset: (...args: unknown[]) => ChainableBuilder;
  innerJoin: (...args: unknown[]) => ChainableBuilder;
  leftJoin: (...args: unknown[]) => ChainableBuilder;
}

function makeBuilder(getResult: () => unknown): ChainableBuilder {
  const builder: ChainableBuilder = {
    from:      (..._a) => builder,
    where:     (..._a) => builder,
    groupBy:   (..._a) => builder,
    orderBy:   (..._a) => builder,
    limit:     (..._a) => builder,
    offset:    (..._a) => builder,
    innerJoin: (..._a) => builder,
    leftJoin:  (..._a) => builder,
    then: (resolve?: any, reject?: any) => Promise.resolve().then(getResult).then(resolve, reject),
  };
  return builder;
}

vi.mock("@workspace/db", () => {
  // Simple column-identity objects so drizzle-orm helpers like eq() / sql
  // get real-looking column references without a real database.
  const col = (name: string) => ({ name, table: "mock" });
  const tbl = (cols: string[]) =>
    Object.fromEntries(cols.map((c) => [c, col(c)]));

  const warehouseGoogleAds = tbl([
    "id", "tenantId", "syncedAt", "campaignId", "campaignName",
    "costUsd", "conversionValue", "conversions", "status",
  ]);
  const warehouseShopifyProducts = tbl([
    "id", "tenantId", "productId", "sku", "title", "cogs",
  ]);
  const warehouseCrossPlatformMapping = tbl([
    "id", "tenantId", "googleAdId", "shopifyProductId",
  ]);
  const organizations = tbl(["id", "cogsPctDefault", "name", "slug"]);
  const workspaces    = tbl(["id", "organizationId"]);

  const select = vi.fn((_cols?: unknown) => {
    selectSpy(_cols);
    return {
      from: vi.fn((_tbl: unknown) => makeBuilder(() => selectQueue.shift() ?? [])),
    };
  });

  return {
    db: { select },
    warehouseGoogleAds,
    warehouseShopifyProducts,
    warehouseCrossPlatformMapping,
    organizations,
    workspaces,
  };
});

// @workspace/db/schema — only DEFAULT_TENANT_ID is consumed by the route
vi.mock("@workspace/db/schema", () => ({
  DEFAULT_TENANT_ID: "default",
}));

// ── Response shape ─────────────────────────────────────────────────────────────
interface TrendPoint {
  date: string;
  spend: number;
  revenue: number;
  cogs: number;
  profit: number;
}

interface ProfitTrendResponse {
  hasData: boolean;
  hasEnoughHistory: boolean;
  distinctDays: number;
  minHistoryDays: number;
  cogsPctFallback: number;
  from: string;
  to: string;
  points: TrendPoint[];
}

// ── Server boot ───────────────────────────────────────────────────────────────
let server: Server;
let baseUrl: string;

// orgId injected by the fake auth middleware; changeable per test
let currentOrgId: number | null = 99;

beforeAll(async () => {
  const { default: warehouseRouter } = await import("../routes/warehouse/index");

  const app = express();
  app.use(express.json());

  // Minimal auth shim: stamps req.jwtPayload so getOrgId() has something to read.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).jwtPayload = { organizationId: currentOrgId };
    next();
  });

  app.use("/api/warehouse", warehouseRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

beforeEach(() => {
  selectQueue.length = 0;
  selectSpy.mockClear();
  currentOrgId = 99;
});

// ── Helper: date string N days before a fixed anchor ──────────────────────────
const ANCHOR = "2026-04-22"; // fixed "today" for deterministic date math

function daysAgo(n: number): string {
  const d = new Date(`${ANCHOR}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/warehouse/profit-trend", () => {

  // ── Test 1: N-day series ──────────────────────────────────────────────────
  it("returns exactly N distinct date points when the tenant has N days of data", async () => {
    const N = 5;
    const adsRows = Array.from({ length: N }, (_, i) => ({
      day:     daysAgo(N - 1 - i),            // oldest first
      spend:   (10 + i).toFixed(2),
      revenue: (100 + i * 10).toFixed(2),
    }));

    selectQueue.push(
      adsRows,                       // [0] adsRows
      [],                            // [1] mappedRows — no cross-platform mapping
      [{ cogsPctDefault: 0.4 }],    // [2] orgRow
      [{ distinctDays: N }],         // [3] historyRow
    );

    const from = daysAgo(N - 1);
    const to   = ANCHOR;
    const res  = await fetch(`${baseUrl}/api/warehouse/profit-trend?from=${from}&to=${to}`);
    expect(res.status).toBe(200);

    const body = await res.json() as ProfitTrendResponse;
    expect(body.points).toHaveLength(N);

    // Every date in the window must appear exactly once, in ascending order
    const dates = body.points.map((p) => p.date);
    const expected = Array.from({ length: N }, (_, i) => daysAgo(N - 1 - i));
    expect(dates).toEqual(expected);

    // All mandatory numeric fields present on each point
    for (const pt of body.points) {
      expect(typeof pt.spend).toBe("number");
      expect(typeof pt.revenue).toBe("number");
      expect(typeof pt.cogs).toBe("number");
      expect(typeof pt.profit).toBe("number");
    }

    // Spot-check two non-adjacent days to prove values come from per-day DB rows,
    // not a shared total or synthetic aggregation.
    const firstPt = body.points[0];
    expect(firstPt.spend).toBe(parseFloat((10).toFixed(2)));       // i=0 → 10
    expect(firstPt.revenue).toBe(parseFloat((100).toFixed(2)));    // i=0 → 100

    const lastPt = body.points[N - 1];
    expect(lastPt.spend).toBe(parseFloat((10 + N - 1).toFixed(2)));       // i=N-1
    expect(lastPt.revenue).toBe(parseFloat((100 + (N - 1) * 10).toFixed(2))); // i=N-1
  });

  // ── Test 2: Mapped COGS takes precedence over cogsPctFallback ────────────
  it("uses SKU-level mapped COGS when cross-platform mapping exists for a day", async () => {
    const day        = daysAgo(0);
    const spend      = 50;
    const revenue    = 200;
    const mappedCogs = 80;
    // cogsPct 0.20 → fallback COGS = 200 × 0.20 = 40.
    // Mapped COGS is 80 — different value proves mapped path is taken.
    const cogsPct = 0.20;

    selectQueue.push(
      [{ day, spend: String(spend), revenue: String(revenue) }], // [0] adsRows
      [{ day, cogs: String(mappedCogs) }],                        // [1] mappedRows
      [{ cogsPctDefault: cogsPct }],                              // [2] orgRow
      [{ distinctDays: 14 }],                                     // [3] historyRow
    );

    const res  = await fetch(`${baseUrl}/api/warehouse/profit-trend?from=${day}&to=${day}`);
    expect(res.status).toBe(200);

    const body = await res.json() as ProfitTrendResponse;
    expect(body.points).toHaveLength(1);

    const pt = body.points[0];
    // COGS must use the mapped value, not the percentage-based fallback
    expect(pt.cogs).toBe(parseFloat(mappedCogs.toFixed(2)));
    // Sanity: profit = revenue − spend − cogs
    expect(pt.profit).toBeCloseTo(revenue - spend - mappedCogs, 5);

    expect(body.hasData).toBe(true);
    expect(body.hasEnoughHistory).toBe(true);
  });

  // ── Test 3: hasEnoughHistory false when < 14 distinct days ───────────────
  it("returns hasEnoughHistory: false when tenant has fewer than 14 days of data", async () => {
    const distinctDays = 7; // below the 14-day threshold

    selectQueue.push(
      [{ day: daysAgo(0), spend: "20", revenue: "100" }], // [0] adsRows
      [],                                                   // [1] mappedRows
      [{ cogsPctDefault: 0.4 }],                           // [2] orgRow
      [{ distinctDays }],                                  // [3] historyRow
    );

    const res  = await fetch(`${baseUrl}/api/warehouse/profit-trend?days=7`);
    expect(res.status).toBe(200);

    const body = await res.json() as ProfitTrendResponse;
    expect(body.hasEnoughHistory).toBe(false);
    expect(body.distinctDays).toBe(distinctDays);
    expect(body.minHistoryDays).toBe(14);
  });

  // ── Test 4: Empty tenant → hasData false, all points zeroed ──────────────
  it("returns hasData: false and all-zero points when the tenant has no warehouse rows", async () => {
    const days = 3;

    selectQueue.push(
      [],                            // [0] adsRows — empty
      [],                            // [1] mappedRows — empty
      [{ cogsPctDefault: 0.4 }],    // [2] orgRow
      [{ distinctDays: 0 }],         // [3] historyRow
    );

    const from = daysAgo(days - 1);
    const to   = ANCHOR;
    const res  = await fetch(`${baseUrl}/api/warehouse/profit-trend?from=${from}&to=${to}`);
    expect(res.status).toBe(200);

    const body = await res.json() as ProfitTrendResponse;
    expect(body.hasData).toBe(false);
    expect(body.hasEnoughHistory).toBe(false);
    expect(body.points).toHaveLength(days);

    for (const pt of body.points) {
      expect(pt.spend).toBe(0);
      expect(pt.revenue).toBe(0);
      expect(pt.cogs).toBe(0);
      expect(pt.profit).toBe(0);
    }
  });

});
