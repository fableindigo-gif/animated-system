/**
 * FeedGen overlapping-runs regression — proves we don't double-bill Vertex.
 *
 * The contract under test lives in `claimCandidates` in
 * `workers/feedgen-runner.ts`: a single
 *   INSERT … ON CONFLICT (id) DO UPDATE … WHERE <freshness>
 * statement that must atomically partition the candidate set across any
 * number of concurrent FeedGen runs. Without it, the cron tick and a
 * manual "Generate Rewrites" click can both pick the same SKUs and pay
 * Vertex twice for the same rewrite.
 *
 * These tests run against the real Postgres pointed to by DATABASE_URL.
 * They mock `generateRewriteBatch` so no Vertex traffic is made — the
 * mock simply records which SKUs each run would have billed.
 *
 * Coverage:
 *   1. Direct claim race on the same row set → disjoint winners, full union.
 *   2. End-to-end runFeedgenScan race: cron (no tenantId) vs manual
 *      (specific tenantId) overlap on the same tenant's products → the
 *      SKU sets passed to Vertex are disjoint, and no SKU is billed twice.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

// ── Logger stub (must come before any module that imports the logger) ───────
vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

// ── Vertex stub: capture the SKU set each run would bill, never call out. ───
const vertexCalls: Array<string[]> = [];
vi.mock("../lib/feedgen/service", () => ({
  generateRewriteBatch: vi.fn(async (products: Array<{ offerId: string; customAttributes?: { sku?: string } }>) => {
    vertexCalls.push(products.map((p) => p.customAttributes?.sku ?? p.offerId));
    return products.map(() => ({
      ok: true as const,
      latencyMs: 1,
      rewrite: {
        rewrittenTitle: "rewritten",
        rewrittenDescription: "rewritten",
        qualityScore: 50,
        reasoning: "test",
        citedAttributes: [] as string[],
      },
      usage: { promptTokens: 0, candidatesTokens: 0, totalTokens: 0 },
    }));
  }),
}));

import { db, type WarehouseShopifyProduct } from "@workspace/db";
import { sql } from "drizzle-orm";
import { runFeedgenScan, claimCandidates } from "../workers/feedgen-runner";

const TENANT_PREFIX = "test-feedgen-concurrent";
const SCAN_TENANT   = `${TENANT_PREFIX}-scan`;
const CLAIM_TENANT  = `${TENANT_PREFIX}-claim`;

async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM product_feedgen_rewrites WHERE tenant_id LIKE ${TENANT_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM warehouse_shopify_products WHERE tenant_id LIKE ${TENANT_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM feedgen_runs              WHERE tenant_id LIKE ${TENANT_PREFIX + "%"}`);
}

async function seedProducts(tenantId: string, n: number): Promise<WarehouseShopifyProduct[]> {
  const rows: WarehouseShopifyProduct[] = [];
  for (let i = 0; i < n; i++) {
    const id  = `${tenantId}:p${i}`;
    const sku = `${tenantId}-sku-${i}`;
    await db.execute(sql`
      INSERT INTO warehouse_shopify_products
        (id, tenant_id, product_id, sku, handle, title, price, synced_at)
      VALUES
        (${id}, ${tenantId}, ${`p${i}`}, ${sku}, ${`h${i}`}, ${`Title ${i}`}, ${10 + i}, now())
      ON CONFLICT (id) DO NOTHING
    `);
    rows.push({
      id, tenantId, productId: `p${i}`, sku,
      handle: `h${i}`, title: `Title ${i}`,
      variantTitle: null, status: "active",
      inventoryQty: 0, price: 10 + i, cogs: 0,
      imageUrl: null, brandLogoUrl: null, description: null,
      llmAttributes: null, llmEnrichedAt: null,
      syncedAt: new Date(),
    });
  }
  return rows;
}

beforeAll(async () => { await cleanup(); });
beforeEach(() => { vertexCalls.length = 0; });
afterAll(async () => {
  await cleanup();
  // Intentionally do NOT call `pool.end()` — the Drizzle pool is shared
  // across the whole vitest worker, and tearing it down here would break
  // any test file scheduled after this one in the same worker.
});

describe("FeedGen claimCandidates — row-level race protection", () => {
  it("partitions candidates disjointly across two concurrent claim calls on the SAME rows", async () => {
    const candidates = await seedProducts(CLAIM_TENANT, 12);

    // Fire two claimCandidates() calls in parallel against the *same*
    // row set. Postgres' row-level lock on the conflicting INSERT must
    // ensure that each row is returned by exactly one of the two calls.
    const [aIds, bIds] = await Promise.all([
      claimCandidates(candidates, "auto"),
      claimCandidates(candidates, "auto"),
    ]);

    // Disjoint: no row appears in both winners' sets.
    const intersection = [...aIds].filter((id) => bIds.has(id));
    expect(intersection).toEqual([]);

    // Complete: every candidate is owned by exactly one of the two runs.
    const union = new Set<string>([...aIds, ...bIds]);
    expect(union.size).toBe(candidates.length);
    for (const c of candidates) expect(union.has(c.id)).toBe(true);

    // And the underlying rows are now all 'processing' exactly once.
    const dbRows = await db.execute(sql`
      SELECT id, status FROM product_feedgen_rewrites
      WHERE tenant_id = ${CLAIM_TENANT}
    `);
    const rows = (dbRows as unknown as { rows: Array<{ id: string; status: string }> }).rows;
    expect(rows.length).toBe(candidates.length);
    for (const r of rows) expect(r.status).toBe("processing");
  });

  it("still partitions disjointly under a third concurrent claim", async () => {
    // Reset state — same tenant, fresh row set with new ids.
    await db.execute(sql`DELETE FROM product_feedgen_rewrites WHERE tenant_id = ${CLAIM_TENANT}`);
    await db.execute(sql`DELETE FROM warehouse_shopify_products WHERE tenant_id = ${CLAIM_TENANT}`);
    const candidates = await seedProducts(CLAIM_TENANT, 8);

    const winners = await Promise.all([
      claimCandidates(candidates, "auto"),
      claimCandidates(candidates, "auto"),
      claimCandidates(candidates, "auto"),
    ]);

    // Pairwise disjoint.
    for (let i = 0; i < winners.length; i++) {
      for (let j = i + 1; j < winners.length; j++) {
        const overlap = [...winners[i]!].filter((id) => winners[j]!.has(id));
        expect(overlap).toEqual([]);
      }
    }
    // Union covers everything exactly once.
    const totalClaimed = winners.reduce((acc, s) => acc + s.size, 0);
    expect(totalClaimed).toBe(candidates.length);
  });
});

describe("FeedGen runFeedgenScan — cron vs manual overlap", () => {
  it("cron run (no tenantId) racing a manual run (specific tenantId) never bills the same SKU twice", async () => {
    // Seed only this tenant's rows. The cron run has no tenantId so it
    // scans across all tenants and will see these. The manual run is
    // scoped to this tenant. Both can therefore pick the same SKUs —
    // claimCandidates is the only thing keeping them disjoint.
    await seedProducts(SCAN_TENANT, 10);

    // Different lockKeys (tenantLockKey("") vs tenantLockKey(SCAN_TENANT))
    // ⇒ both runs acquire their advisory lock and proceed concurrently.
    const [cron, manual] = await Promise.all([
      runFeedgenScan({ mode: "stale", maxProducts: 25 }),
      runFeedgenScan({ tenantId: SCAN_TENANT, mode: "stale", maxProducts: 25 }),
    ]);

    // At least one of the two runs must have actually called Vertex —
    // otherwise the test wouldn't be exercising anything.
    const totalGenerated = cron.generated + manual.generated;
    expect(totalGenerated).toBeGreaterThan(0);

    // Collect the SKU sets that were passed into the (mocked) Vertex
    // batch call. Restrict to our test tenant so unrelated rows from
    // other suites can't contaminate the assertion.
    const skusByCall = vertexCalls.map((skus) => skus.filter((s) => s.startsWith(`${SCAN_TENANT}-sku-`)));
    const allSkus = skusByCall.flat();
    const uniqueSkus = new Set(allSkus);

    // The critical contract: NO SKU was sent to Vertex more than once
    // across the two overlapping runs. Vertex bills per request, so a
    // duplicate here is real money lost.
    expect(allSkus.length).toBe(uniqueSkus.size);

    // And concretely: when two calls happened, the two sets are disjoint.
    if (skusByCall.length >= 2) {
      const [a, b] = skusByCall;
      const intersection = a!.filter((s) => b!.includes(s));
      expect(intersection).toEqual([]);
    }

    // The DB ends up with one row per claimed SKU, none stuck in 'processing'
    // (the runs wrote back successfully, so status is 'pending').
    const dbRows = await db.execute(sql`
      SELECT status, COUNT(*)::int AS n
      FROM product_feedgen_rewrites
      WHERE tenant_id = ${SCAN_TENANT}
      GROUP BY status
    `);
    const rows = (dbRows as unknown as { rows: Array<{ status: string; n: number }> }).rows;
    const processingRow = rows.find((r) => r.status === "processing");
    expect(processingRow?.n ?? 0).toBe(0);
  });
});
