/**
 * FeedGen Runner Worker
 * ─────────────────────
 * Picks underperforming products from the warehouse, asks Gemini (via the
 * FeedGen service) for a rewritten title + description, and upserts the
 * result into `product_feedgen_rewrites`.
 *
 * Underperformer selection (current implementation):
 *   - Default "underperformer" mode joins warehouse_shopify_products to the
 *     per-tenant `v_poas_by_sku` view (hydrated from Shopping Insider /
 *     GAARF ad data) on (tenant_id, sku), filters to SKUs with non-zero ad
 *     spend, and picks the lowest gross ROAS first — i.e. the SKUs leaking
 *     the most ad budget per dollar of revenue. Ties broken by total ad
 *     spend DESC.
 *   - "stale" fallback (also auto-used when v_poas_by_sku has no rows for a
 *     tenant) sorts by price DESC so high-margin products without ads data
 *     still get attention.
 *
 * Refresh policy:
 *   - Products with no rewrite row → scanned.
 *   - Rows older than `REFRESH_AFTER_MS` (default 14 days) → re-scanned.
 *   - "approved" or "applied" rows are NEVER auto-overwritten — they
 *     already shipped and have a paper trail in `proposed_tasks`.
 *
 * The runner is best-effort: any failure is logged but never crashes the
 * API process. If Vertex is unreachable the run aborts cleanly and retries
 * on the next tick.
 */
import {
  db,
  pool,
  warehouseShopifyProducts,
  productFeedgenRewrites,
  feedgenRuns,
  type WarehouseShopifyProduct,
} from "@workspace/db";
import { eq, and, isNull, or, lt, sql, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { generateRewriteBatch } from "../lib/feedgen/service";
import type { SourceProduct } from "../lib/feedgen/prompts";
import { recordInfraAlert, resolveInfraAlert } from "../lib/alert-store";

// Single source of truth for batch sizing — keep API routes, ADK tool, and
// docs in sync with this constant.
export const FEEDGEN_MAX_PER_RUN = 25;
const DEFAULT_INTERVAL_MS  = 6 * 60 * 60 * 1000; // 6h
const INITIAL_DELAY_MS     = 60_000;
const REFRESH_AFTER_MS     = 14 * 24 * 60 * 60 * 1000;
// Cool-down before a `failed` rewrite is eligible for an automatic retry.
// Keeps transient Vertex blips from blocking us forever, but doesn't hammer
// the API on a permanent failure.
const FAILED_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
// Recovery cutoff for rows stuck in `processing`. A normal run claims a row,
// calls Vertex, and writes back within ~30s/SKU. If a run crashes between
// claim and write-back the row would be marooned — re-eligibility after this
// window unblocks it. Should be comfortably larger than a worst-case Vertex
// batch latency.
const PROCESSING_TIMEOUT_MS = 30 * 60 * 1000;

export interface FeedgenRunResult {
  scanned:   number;
  generated: number;
  failed:    number;
  skipped:   boolean;
  reason?:   string;
  /**
   * Median ROAS of the SKUs picked for this batch (gross_roas from
   * `v_poas_by_sku`). `null` when the batch was selected without ads/POAS
   * data (e.g. stale fallback or targeted run for SKUs with no spend).
   */
  medianRoas?: number | null;
  /** Vertex tokens spent across every per-SKU call in this run. */
  promptTokens?:     number;
  candidatesTokens?: number;
  totalTokens?:      number;
}

function toSourceProduct(row: WarehouseShopifyProduct): SourceProduct {
  return {
    offerId:     row.id,
    title:       row.title || "",
    description: row.description || "",
    productType: row.handle || null,
    customAttributes: {
      sku:   row.sku ?? "",
      price: row.price ?? null,
    },
  };
}

/**
 * Selection strategy for which SKUs to rewrite next.
 *
 *   "underperformer" (default) — true performance-driven selection. Joins
 *     warehouse_shopify_products → `v_poas_by_sku` (the per-tenant ROAS view
 *     hydrated from Shopping Insider / GAARF ad data), filters to SKUs with
 *     non-zero ad spend, and orders by ascending gross ROAS so the SKUs that
 *     are leaking the most ad budget per dollar of revenue get rewritten
 *     first. Ties broken by total ad spend DESC so we prioritise the loudest
 *     bleeders.
 *
 *   "stale" — fallback when there is no ROAS data yet (e.g. brand-new tenant
 *     before the first GAARF sync, or Shopping Insider not wired up). Picks
 *     SKUs with no rewrite, ordered by price DESC so high-margin products go
 *     first.
 */
export type SelectionMode = "underperformer" | "stale";

interface CandidateBatch {
  candidates: WarehouseShopifyProduct[];
  /**
   * Gross ROAS (revenue / cost) for each candidate, in the same order as
   * `candidates`. `null` when no ROAS is available (e.g. fallback path).
   */
  roas: Array<number | null>;
}

/**
 * Snake-case row from a raw `v_poas_by_sku`-augmented warehouse query.
 * Centralised so the field list matches `warehouse_shopify_products` exactly
 * and the mapper below stays honest.
 */
interface RawWarehouseProductRow {
  id: string;
  tenant_id: string;
  product_id: string;
  sku: string;
  handle: string;
  title: string;
  variant_title: string | null;
  status: string | null;
  inventory_qty: number | null;
  price: number | null;
  cogs: number | null;
  image_url: string | null;
  brand_logo_url: string | null;
  description: string | null;
  llm_attributes: WarehouseShopifyProduct["llmAttributes"] | null;
  llm_enriched_at: Date | string | null;
  synced_at: Date | string;
  _gross_roas: number | string | null;
}

function toWarehouseProduct(r: RawWarehouseProductRow): WarehouseShopifyProduct {
  return {
    id:            r.id,
    tenantId:      r.tenant_id,
    productId:     r.product_id,
    sku:           r.sku,
    handle:        r.handle,
    title:         r.title,
    variantTitle:  r.variant_title,
    status:        r.status,
    inventoryQty:  r.inventory_qty,
    price:         r.price,
    cogs:          r.cogs,
    imageUrl:      r.image_url,
    brandLogoUrl:  r.brand_logo_url,
    description:   r.description,
    llmAttributes: r.llm_attributes ?? null,
    llmEnrichedAt: r.llm_enriched_at ? new Date(r.llm_enriched_at) : null,
    syncedAt:      r.synced_at instanceof Date ? r.synced_at : new Date(r.synced_at),
  };
}

/** Median of a (potentially sparse) numeric list. Returns null if empty. */
export function medianOf(values: Array<number | null | undefined>): number | null {
  const nums = values
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
}

async function hydrateRoasForCandidates(
  candidates: WarehouseShopifyProduct[],
  tenantId?: string,
): Promise<Array<number | null>> {
  if (candidates.length === 0) return [];
  const skus = Array.from(new Set(candidates.map((c) => c.sku).filter((s) => s && s.length > 0)));
  if (skus.length === 0) return candidates.map(() => null);

  const tenantSql = tenantId ? sql`tenant_id = ${tenantId}` : sql`TRUE`;
  try {
    const result = await db.execute(sql`
      SELECT sku, gross_roas
      FROM v_poas_by_sku
      WHERE ${tenantSql} AND sku IN (${sql.join(skus, sql`, `)})
    `);
    const rows = (result as unknown as { rows: Array<{ sku: string; gross_roas: number | string | null }> }).rows ?? [];
    const bySku = new Map<string, number | null>();
    for (const r of rows) {
      const v = r.gross_roas;
      if (v === null || v === undefined) { bySku.set(r.sku, null); continue; }
      const n = typeof v === "number" ? v : parseFloat(String(v));
      bySku.set(r.sku, Number.isFinite(n) ? n : null);
    }
    return candidates.map((c) => (bySku.has(c.sku) ? bySku.get(c.sku) ?? null : null));
  } catch (err) {
    logger.debug({ err }, "[feedgen-runner] hydrateRoasForCandidates failed (non-fatal)");
    return candidates.map(() => null);
  }
}

async function selectCandidates(
  limit: number,
  tenantId?: string,
  mode: SelectionMode = "underperformer",
): Promise<CandidateBatch> {
  const refreshCutoff      = new Date(Date.now() - REFRESH_AFTER_MS);
  const failedRetryCutoff  = new Date(Date.now() - FAILED_RETRY_AFTER_MS);
  const processingCutoff   = new Date(Date.now() - PROCESSING_TIMEOUT_MS);

  if (mode === "underperformer") {
    // Performance-driven selection via `v_poas_by_sku` — the canonical
    // per-SKU ROAS view, joined on (tenant_id, sku). Stale-rewrite +
    // tenancy filters still apply via the LEFT JOIN to
    // product_feedgen_rewrites. `processing` rows are excluded unless they
    // are stale (a previous run crashed before write-back).
    const tenantSql    = tenantId ? sql`p.tenant_id = ${tenantId}` : sql`TRUE`;
    const freshnessSql = sql`(
      r.id IS NULL
      OR (r.status = 'pending'    AND r.generated_at < ${refreshCutoff})
      OR (r.status = 'failed'     AND r.generated_at < ${failedRetryCutoff})
      OR (r.status = 'processing' AND r.generated_at < ${processingCutoff})
    )`;

    const result = await db.execute(sql`
      SELECT p.*, v.gross_roas AS _gross_roas
      FROM warehouse_shopify_products p
      INNER JOIN v_poas_by_sku v
        ON v.tenant_id = p.tenant_id AND v.sku = p.sku
      LEFT JOIN product_feedgen_rewrites r
        ON r.id = p.id
      WHERE ${tenantSql}
        AND v.total_ad_spend > 0
        AND ${freshnessSql}
      ORDER BY v.gross_roas ASC NULLS LAST,
               v.total_ad_spend DESC
      LIMIT ${limit}
    `);

    const rows = (result as unknown as { rows: RawWarehouseProductRow[] }).rows ?? [];
    if (rows.length > 0) {
      return {
        candidates: rows.map(toWarehouseProduct),
        roas:       rows.map((r) => {
          const v = r._gross_roas;
          if (v === null || v === undefined) return null;
          const n = typeof v === "number" ? v : parseFloat(String(v));
          return Number.isFinite(n) ? n : null;
        }),
      };
    }
    // Fall through to stale-only mode if v_poas_by_sku has no rows for this
    // tenant yet (e.g. Shopping Insider not wired up).
  }

  // Fallback: pick SKUs without a fresh rewrite, highest price first.
  const tenantPred = tenantId
    ? eq(warehouseShopifyProducts.tenantId, tenantId)
    : sql`TRUE`;
  const freshnessPred = or(
    isNull(productFeedgenRewrites.id),
    and(
      eq(productFeedgenRewrites.status, "pending"),
      lt(productFeedgenRewrites.generatedAt, refreshCutoff),
    ),
    and(
      eq(productFeedgenRewrites.status, "failed"),
      lt(productFeedgenRewrites.generatedAt, failedRetryCutoff),
    ),
    and(
      eq(productFeedgenRewrites.status, "processing"),
      lt(productFeedgenRewrites.generatedAt, processingCutoff),
    ),
  );

  const fallbackRows = await db
    .select()
    .from(warehouseShopifyProducts)
    .leftJoin(
      productFeedgenRewrites,
      eq(productFeedgenRewrites.id, warehouseShopifyProducts.id),
    )
    .where(and(tenantPred, freshnessPred))
    .orderBy(sql`${warehouseShopifyProducts.price} DESC NULLS LAST`)
    .limit(limit);

  const candidates = fallbackRows.map(
    (r) => (r as { warehouse_shopify_products: WarehouseShopifyProduct }).warehouse_shopify_products,
  );
  return { candidates, roas: candidates.map(() => null) };
}

/**
 * Atomically "claim" candidate rows by upserting them into
 * `product_feedgen_rewrites` with status='processing'. This is the row-level
 * lock that prevents two overlapping runs (e.g. cron tick + manual click) from
 * picking the same SKUs and double-billing Vertex.
 *
 * The conditional `ON CONFLICT … WHERE` clause is the critical bit: Postgres
 * row-locks the conflicting row, re-evaluates the WHERE against the *current*
 * row, and only updates (and returns via RETURNING) when it still looks
 * eligible. A concurrent run that already moved the row to 'processing' will
 * cause our WHERE to fail — we silently lose the race for that row and the
 * other run owns it. Result: two simultaneous runs always pick disjoint sets.
 *
 * `approved`/`applied`/`rejected` rows are protected by the WHERE — we never
 * stomp operator-owned rewrites here.
 *
 * Returns the set of ids we successfully claimed; callers must filter their
 * candidate list down to this set before calling Vertex.
 *
 * Two claim policies:
 *   "auto"     — used by cron / underperformer / stale selection. Only
 *                claims rows that look stale per the cooldown windows
 *                (pending > REFRESH_AFTER_MS, failed > FAILED_RETRY_AFTER_MS,
 *                processing > PROCESSING_TIMEOUT_MS). Preserves the
 *                "don't re-rewrite a fresh pending row" cooldown.
 *
 *   "targeted" — used when the operator (or an ADK call) explicitly named
 *                SKUs via `productIds`. Claims any row that isn't owned by
 *                an operator decision, which means fresh pending/failed
 *                rows are fair game — the operator asked for these SKUs,
 *                they want a re-run. Still respects the row-level lock
 *                semantics, so two simultaneous targeted runs on the same
 *                SKU still pick disjoint sets (whichever flips it to
 *                'processing' first wins).
 */
type ClaimPolicy = "auto" | "targeted";

export async function claimCandidates(
  candidates: WarehouseShopifyProduct[],
  policy: ClaimPolicy,
): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();

  const now = new Date();
  const rowSql = candidates.map((c) => sql`(
    ${c.id}, ${c.tenantId}, ${c.productId}, ${c.sku ?? ""},
    'processing', ${now}
  )`);

  // Whichever policy is in effect, a fresh `processing` row is NEVER
  // re-claimable — that's another run actively paying Vertex for this SKU.
  // Allowing reclaim there would defeat the entire point of this lock.
  const processingCutoff = new Date(Date.now() - PROCESSING_TIMEOUT_MS);

  let conflictWhere;
  if (policy === "targeted") {
    // Operator asked for these specific SKUs — claim anything that isn't
    // owned by an operator decision OR currently being processed by another
    // run. Fresh pending/failed rows are still fair game (operator wants a
    // re-run); fresh `processing` rows are excluded so two simultaneous
    // targeted runs can't double-bill the same SKU.
    conflictWhere = sql`
       product_feedgen_rewrites.status IN ('pending', 'failed')
       OR (product_feedgen_rewrites.status = 'processing' AND product_feedgen_rewrites.generated_at < ${processingCutoff})
    `;
  } else {
    const refreshCutoff     = new Date(Date.now() - REFRESH_AFTER_MS);
    const failedRetryCutoff = new Date(Date.now() - FAILED_RETRY_AFTER_MS);
    conflictWhere = sql`
        (product_feedgen_rewrites.status = 'pending'    AND product_feedgen_rewrites.generated_at < ${refreshCutoff})
     OR (product_feedgen_rewrites.status = 'failed'     AND product_feedgen_rewrites.generated_at < ${failedRetryCutoff})
     OR (product_feedgen_rewrites.status = 'processing' AND product_feedgen_rewrites.generated_at < ${processingCutoff})
    `;
  }

  const result = await db.execute(sql`
    INSERT INTO product_feedgen_rewrites
      (id, tenant_id, product_id, sku, status, generated_at)
    VALUES ${sql.join(rowSql, sql`, `)}
    ON CONFLICT (id) DO UPDATE
      SET status = 'processing', generated_at = EXCLUDED.generated_at
      WHERE ${conflictWhere}
    RETURNING id
  `);
  const rows = (result as unknown as { rows: Array<{ id: string }> }).rows ?? [];
  return new Set(rows.map((r) => r.id));
}

// Postgres advisory-lock namespace for FeedGen runs. Two-int variant:
// (FEEDGEN_LOCK_NAMESPACE, hash(tenantId)) so each tenant gets its own lock
// and the cron + a manual ADK-triggered run can't overlap on the same tenant.
// 0x4644 4744 = "FDGD" — arbitrary, just needs to be stable.
const FEEDGEN_LOCK_NAMESPACE = 0x46444744;

function tenantLockKey(tenantId: string | undefined): number {
  // 32-bit signed FNV-1a hash of the tenant string. Postgres advisory locks
  // accept signed int4 — keep it in range. "" → 0 = global cron lock.
  const s = tenantId ?? "";
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) | 0;
  }
  return h | 0;
}

/**
 * Best-effort audit insert into `feedgen_runs`. Recorded for every run —
 * including skipped runs — so the dashboard can show "we tried 18 times,
 * 12 had no candidates" instead of silently dropping those data points.
 *
 * Failures here are deliberately swallowed: we never want a bad audit row to
 * mask a successful Vertex run from the caller.
 */
async function recordFeedgenRun(args: {
  tenantId?: string;
  mode: string;
  result:   FeedgenRunResult;
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
}): Promise<void> {
  try {
    await db.insert(feedgenRuns).values({
      tenantId:         args.tenantId ?? "default",
      mode:             args.mode,
      status:           args.result.skipped ? "skipped" : "completed",
      skipReason:       args.result.reason ?? null,
      scanned:          args.result.scanned,
      generated:        args.result.generated,
      failed:           args.result.failed,
      promptTokens:     args.promptTokens,
      candidatesTokens: args.candidatesTokens,
      totalTokens:      args.totalTokens,
      medianRoas:       args.result.medianRoas ?? null,
    });
  } catch (err) {
    logger.warn({ err }, "[feedgen-runner] Failed to record feedgen_runs audit row (non-fatal)");
  }
}

export async function runFeedgenScan(
  opts: {
    maxProducts?: number;
    tenantId?:    string;
    productIds?:  string[];
    /** Selection strategy when productIds is omitted. Default "underperformer". */
    mode?:        SelectionMode;
  } = {},
): Promise<FeedgenRunResult> {
  const max = Math.max(1, Math.min(opts.maxProducts ?? FEEDGEN_MAX_PER_RUN, FEEDGEN_MAX_PER_RUN));

  // ── Concurrency guard: only one FeedGen run per tenant at a time ────────────
  // Without this, an ADK-triggered run and the cron tick can race and both
  // pick the same SKUs, doubling Vertex spend and producing duplicate work.
  //
  // pg_try_advisory_lock is SESSION-scoped: lock and unlock must run on the
  // same physical pg connection. The Drizzle pool would hand out different
  // clients for each db.execute, so a lock-on-A / unlock-on-B mismatch would
  // strand the lock until the original connection eventually closes. Take a
  // dedicated client out of the pool for the lock pair, run all work via the
  // normal `db` (any pool client is fine — they don't need the lock), and
  // release the lock client at the very end.
  const lockKey = tenantLockKey(opts.tenantId);
  const lockClient = await pool.connect();
  let gotLock = false;
  try {
    const lockRes = await lockClient.query<{ got: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS got",
      [FEEDGEN_LOCK_NAMESPACE, lockKey],
    );
    gotLock = lockRes.rows[0]?.got === true;
  } catch (err) {
    lockClient.release();
    throw err;
  }
  if (!gotLock) {
    lockClient.release();
    logger.info(
      { tenantId: opts.tenantId ?? "(global)" },
      "[FeedgenRunner] another run already in progress for this tenant — skipping",
    );
    const skipped: FeedgenRunResult = {
      scanned: 0, generated: 0, failed: 0, skipped: true,
      reason: "concurrent-run-in-progress",
    };
    await recordFeedgenRun({
      tenantId: opts.tenantId,
      mode: opts.productIds && opts.productIds.length > 0 ? "targeted" : (opts.mode ?? "underperformer"),
      result: skipped,
      promptTokens: 0, candidatesTokens: 0, totalTokens: 0,
    });
    return skipped;
  }

  try {
  let candidates: WarehouseShopifyProduct[];
  let roasByCandidate: Array<number | null>;
  let claimPolicy: ClaimPolicy = "auto";
  if (opts.productIds && opts.productIds.length > 0) {
    claimPolicy = "targeted";
    // Targeted run: e.g. an ADK call asking for specific SKUs.
    const ids = opts.productIds.slice(0, max);
    candidates = await db
      .select()
      .from(warehouseShopifyProducts)
      .where(
        and(
          inArray(warehouseShopifyProducts.id, ids),
          opts.tenantId ? eq(warehouseShopifyProducts.tenantId, opts.tenantId) : sql`TRUE`,
        ),
      );

    // Skip rewrites the operator owns: approved/applied/rejected. `pending`
    // and `failed` are fair game for an explicit targeted re-run (the user
    // asked for these specific SKUs — they want a fresh attempt).
    if (candidates.length > 0) {
      const locked = await db
        .select({ id: productFeedgenRewrites.id })
        .from(productFeedgenRewrites)
        .where(
          and(
            inArray(productFeedgenRewrites.id, candidates.map((c) => c.id)),
            inArray(productFeedgenRewrites.status, ["approved", "applied", "rejected"]),
          ),
        );
      const skip = new Set(locked.map((r) => r.id));
      candidates = candidates.filter((c) => !skip.has(c.id));
    }
    // Targeted runs don't go through v_poas_by_sku — operators specified the
    // SKUs explicitly. Best-effort hydrate ROAS for the toolbar median so the
    // UI still shows something useful when the picked SKUs do have ad spend.
    roasByCandidate = await hydrateRoasForCandidates(candidates, opts.tenantId);
  } else {
    const batch = await selectCandidates(max, opts.tenantId, opts.mode ?? "underperformer");
    candidates      = batch.candidates;
    roasByCandidate = batch.roas;
  }

  if (candidates.length === 0) {
    const noCandidates: FeedgenRunResult = {
      scanned: 0, generated: 0, failed: 0, skipped: true,
      reason: "no-candidates", medianRoas: null,
    };
    await recordFeedgenRun({
      tenantId: opts.tenantId,
      mode: claimPolicy === "targeted" ? "targeted" : (opts.mode ?? "underperformer"),
      result: noCandidates,
      promptTokens: 0, candidatesTokens: 0, totalTokens: 0,
    });
    return noCandidates;
  }

  // Row-level claim: mark our candidates as `processing` atomically. Any
  // candidate a concurrent run already grabbed will be filtered out here, so
  // we never call Vertex for SKUs another run is already paying for. Targeted
  // runs use a looser claim policy (operator asked for these SKUs by name —
  // fresh pending/failed rows are still fair game).
  const claimedIds = await claimCandidates(candidates, claimPolicy);
  if (claimedIds.size < candidates.length) {
    const lost = candidates.length - claimedIds.size;
    logger.info(
      { tenantId: opts.tenantId ?? "(global)", lost, kept: claimedIds.size },
      "[FeedgenRunner] dropped candidates already claimed by a concurrent run",
    );
    const filtered: WarehouseShopifyProduct[]    = [];
    const filteredRoas: Array<number | null>     = [];
    for (let i = 0; i < candidates.length; i++) {
      if (claimedIds.has(candidates[i]!.id)) {
        filtered.push(candidates[i]!);
        filteredRoas.push(roasByCandidate[i] ?? null);
      }
    }
    candidates      = filtered;
    roasByCandidate = filteredRoas;
  }
  if (candidates.length === 0) {
    const allClaimed: FeedgenRunResult = {
      scanned: 0, generated: 0, failed: 0, skipped: true,
      reason: "all-claimed-by-concurrent-run", medianRoas: null,
    };
    await recordFeedgenRun({
      tenantId: opts.tenantId,
      mode: claimPolicy === "targeted" ? "targeted" : (opts.mode ?? "underperformer"),
      result: allClaimed,
      promptTokens: 0, candidatesTokens: 0, totalTokens: 0,
    });
    return allClaimed;
  }

  const medianRoas = medianOf(roasByCandidate);

  const sources = candidates.map(toSourceProduct);
  const results = await generateRewriteBatch(sources, { concurrency: 4 });

  // Aggregate Vertex token usage across every per-SKU call so we can record
  // the full per-run cost in `feedgen_runs`. Failed calls still count — Vertex
  // bills for a request the moment it's accepted, regardless of our parse step.
  let promptTokens = 0, candidatesTokens = 0, totalTokens = 0;
  for (const r of results) {
    promptTokens     += r.usage.promptTokens;
    candidatesTokens += r.usage.candidatesTokens;
    totalTokens      += r.usage.totalTokens;
  }

  let generated = 0, failed = 0;
  for (let i = 0; i < candidates.length; i++) {
    const product = candidates[i]!;
    const result = results[i]!;
    try {
      if (result.ok) {
        await db
          .insert(productFeedgenRewrites)
          .values({
            id:                   product.id,
            tenantId:             product.tenantId,
            productId:            product.productId,
            sku:                  product.sku ?? "",
            originalTitle:        product.title ?? "",
            originalDescription:  product.description ?? "",
            rewrittenTitle:       result.rewrite.rewrittenTitle,
            rewrittenDescription: result.rewrite.rewrittenDescription,
            qualityScore:         result.rewrite.qualityScore,
            reasoning:            result.rewrite.reasoning,
            citedAttributes:      result.rewrite.citedAttributes,
            triggerSignals:       null,
            status:               "pending",
            errorCode:            null,
            errorMessage:         null,
            latencyMs:            result.latencyMs,
            generatedAt:          new Date(),
          })
          .onConflictDoUpdate({
            target: productFeedgenRewrites.id,
            set: {
              originalTitle:        product.title ?? "",
              originalDescription:  product.description ?? "",
              rewrittenTitle:       result.rewrite.rewrittenTitle,
              rewrittenDescription: result.rewrite.rewrittenDescription,
              qualityScore:         result.rewrite.qualityScore,
              reasoning:            result.rewrite.reasoning,
              citedAttributes:      result.rewrite.citedAttributes,
              status:               "pending",
              errorCode:            null,
              errorMessage:         null,
              latencyMs:            result.latencyMs,
              generatedAt:          new Date(),
            },
            // Overwrite our own claim or any still-pending row, but never
            // clobber operator-owned rows (approved / applied / rejected).
            setWhere: sql`${productFeedgenRewrites.status} NOT IN ('approved', 'applied', 'rejected')`,
          });
        generated++;
      } else {
        await db
          .insert(productFeedgenRewrites)
          .values({
            id:                   product.id,
            tenantId:             product.tenantId,
            productId:            product.productId,
            sku:                  product.sku ?? "",
            originalTitle:        product.title ?? "",
            originalDescription:  product.description ?? "",
            rewrittenTitle:       "",
            rewrittenDescription: "",
            qualityScore:         0,
            reasoning:            "",
            citedAttributes:      [],
            triggerSignals:       null,
            status:               "failed",
            errorCode:            result.errorCode,
            errorMessage:         result.errorMessage.substring(0, 500),
            latencyMs:            result.latencyMs,
            generatedAt:          new Date(),
          })
          .onConflictDoUpdate({
            target: productFeedgenRewrites.id,
            set: {
              status:       "failed",
              errorCode:    result.errorCode,
              errorMessage: result.errorMessage.substring(0, 500),
              latencyMs:    result.latencyMs,
              generatedAt:  new Date(),
            },
            setWhere: sql`${productFeedgenRewrites.status} NOT IN ('approved', 'applied', 'rejected')`,
          });
        failed++;
      }
    } catch (dbErr) {
      logger.error(
        { err: dbErr, productId: product.productId },
        "[feedgen-runner] Failed to persist rewrite",
      );
      failed++;
    }
  }

  const completed: FeedgenRunResult = {
    scanned: generated + failed, generated, failed, skipped: false, medianRoas,
    promptTokens, candidatesTokens, totalTokens,
  };
  await recordFeedgenRun({
    tenantId: opts.tenantId,
    mode: claimPolicy === "targeted" ? "targeted" : (opts.mode ?? "underperformer"),
    result: completed,
    promptTokens, candidatesTokens, totalTokens,
  });
  return completed;
  } finally {
    // Always release the advisory lock on the SAME client that acquired it —
    // even if a Vertex call threw and bubbled out, the next tick must be able
    // to run. Releasing the client back to the pool happens regardless.
    try {
      await lockClient.query(
        "SELECT pg_advisory_unlock($1, $2)",
        [FEEDGEN_LOCK_NAMESPACE, lockKey],
      );
    } catch (unlockErr) {
      logger.warn(
        { err: unlockErr, lockKey },
        "[FeedgenRunner] failed to release advisory lock (will release on connection close)",
      );
    } finally {
      lockClient.release();
    }
  }
}

// ── Crash-recovery sweeper ──────────────────────────────────────────────────
// A FeedGen run claims candidates by upserting them into
// `product_feedgen_rewrites` with status='processing'. If the worker dies
// after the claim but before the write-back, those rows would stay
// `processing` until the next claim attempt notices them via
// PROCESSING_TIMEOUT_MS — and the next attempt only happens when selection
// touches that SKU again, which can be hours (FeedGen cron is 6h).
//
// The sweeper runs much more frequently (default 5 min) and explicitly
// "rescues" any row stuck in `processing` past PROCESSING_TIMEOUT_MS by
// flipping it to `failed` with a recognisable error code and back-dating
// `generated_at` so the next normal selection considers it instantly
// retry-eligible (i.e. already past FAILED_RETRY_AFTER_MS). The row is kept
// for audit so operators can see how often the worker crashed mid-batch.
const RECOVERY_DEFAULT_INTERVAL_MS = 5 * 60 * 1000;   // 5 minutes
const RECOVERY_INITIAL_DELAY_MS    = 30_000;
export const FEEDGEN_RECOVERY_ERROR_CODE = "WORKER_CRASHED_MID_BATCH";

/**
 * Alert fired into the same infra-alert channel as the Quality Fixes scanner
 * when the FeedGen sweeper is recovering too many stuck rows — a sign the
 * worker is crashing mid-batch repeatedly.
 *
 * Thresholds (configurable via env):
 *   FEEDGEN_RECOVERY_ALERT_PER_SWEEP  — fire if a single sweep recovers ≥ N rows (default 5)
 *   FEEDGEN_RECOVERY_ALERT_CONSECUTIVE — fire if recoveries persist for ≥ M consecutive
 *                                         sweeps, even if each sweep is below per-sweep N (default 3)
 */
export const FEEDGEN_RECOVERY_ALERT_ID = "feedgen_recovery_crash_alert";

function getRecoveryAlertPerSweepThreshold(): number {
  const v = parseInt(process.env.FEEDGEN_RECOVERY_ALERT_PER_SWEEP ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : 5;
}

function getRecoveryAlertConsecutiveThreshold(): number {
  const v = parseInt(process.env.FEEDGEN_RECOVERY_ALERT_CONSECUTIVE ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : 3;
}

export interface FeedgenRecoveryStatus {
  state:                "idle" | "running" | "last-error";
  lastSweepAt:          string | null;
  lastSuccessfulSweepAt:string | null;
  lastRecoveredCount:   number;
  totalRecoveredCount:  number;
  currentStuckCount:    number;
  lastErrorMessage:     string | null;
  /** How many consecutive sweeps in a row have recovered at least one row. */
  consecutiveSweepsWithRecoveries: number;
}

const _recoveryStatus: FeedgenRecoveryStatus = {
  state:                "idle",
  lastSweepAt:          null,
  lastSuccessfulSweepAt:null,
  lastRecoveredCount:   0,
  totalRecoveredCount:  0,
  currentStuckCount:    0,
  lastErrorMessage:     null,
  consecutiveSweepsWithRecoveries: 0,
};

export function getFeedgenRecoveryStatus(): FeedgenRecoveryStatus {
  return { ..._recoveryStatus };
}

/**
 * Count rows currently stuck in `processing` past PROCESSING_TIMEOUT_MS.
 * Best-effort — returns 0 on any DB error so the health surface never throws.
 */
export async function getStuckFeedgenCount(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - PROCESSING_TIMEOUT_MS);
    const result = await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM product_feedgen_rewrites
      WHERE status = 'processing' AND generated_at < ${cutoff}
    `);
    const rows = (result as unknown as { rows: Array<{ n: number | string }> }).rows ?? [];
    const n = rows[0]?.n;
    return typeof n === "number" ? n : Number(n ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Sweep stuck `processing` rows: rewrite them to `failed` with a recognisable
 * error code and back-date `generated_at` so the next normal selection picks
 * them up immediately (past FAILED_RETRY_AFTER_MS). Returns the count of
 * rows recovered. Keeps a forensic trail for operators.
 */
export async function runFeedgenRecoverySweep(): Promise<{ recovered: number; stuckRemaining: number }> {
  _recoveryStatus.state = "running";
  const startedAt = new Date().toISOString();
  try {
    const cutoff = new Date(Date.now() - PROCESSING_TIMEOUT_MS);
    // Backdate so the row is INSTANTLY past FAILED_RETRY_AFTER_MS — the next
    // selection tick will treat it as stale-failed and re-claim it.
    const backdated = new Date(Date.now() - FAILED_RETRY_AFTER_MS - 60_000);
    const result = await db.execute(sql`
      UPDATE product_feedgen_rewrites
         SET status        = 'failed',
             error_code    = ${FEEDGEN_RECOVERY_ERROR_CODE},
             error_message = 'Recovered by feedgen sweeper after worker crashed mid-batch',
             generated_at  = ${backdated}
       WHERE status = 'processing'
         AND generated_at < ${cutoff}
      RETURNING id
    `);
    const rows = (result as unknown as { rows: Array<{ id: string }> }).rows ?? [];
    const recovered = rows.length;

    _recoveryStatus.state                 = "idle";
    _recoveryStatus.lastSweepAt           = startedAt;
    _recoveryStatus.lastSuccessfulSweepAt = startedAt;
    _recoveryStatus.lastRecoveredCount    = recovered;
    _recoveryStatus.totalRecoveredCount  += recovered;
    _recoveryStatus.lastErrorMessage      = null;
    _recoveryStatus.currentStuckCount     = await getStuckFeedgenCount();

    if (recovered > 0) {
      _recoveryStatus.consecutiveSweepsWithRecoveries += 1;

      logger.warn(
        { recovered, ids: rows.map((r) => r.id).slice(0, 10), consecutiveSweeps: _recoveryStatus.consecutiveSweepsWithRecoveries },
        "[FeedgenRecovery] Recovered rows stuck in `processing` past timeout — worker likely crashed mid-batch",
      );

      // Fire an infra alert if either threshold is crossed.
      const perSweepThreshold  = getRecoveryAlertPerSweepThreshold();
      const consecutiveThreshold = getRecoveryAlertConsecutiveThreshold();
      const shouldAlert =
        recovered >= perSweepThreshold ||
        _recoveryStatus.consecutiveSweepsWithRecoveries >= consecutiveThreshold;

      if (shouldAlert) {
        void recordInfraAlert({
          alertId:  FEEDGEN_RECOVERY_ALERT_ID,
          severity: "critical",
          title:    "FeedGen Workers — Repeated Mid-Batch Crashes Detected",
          detail:   `The FeedGen recovery sweeper rescued ${recovered} stuck row(s) in this sweep ` +
                    `(${_recoveryStatus.consecutiveSweepsWithRecoveries} consecutive sweep(s) with recoveries). ` +
                    `This indicates the FeedGen worker is crashing mid-batch repeatedly — ` +
                    `likely a bad deploy or a persistent Vertex connectivity issue. ` +
                    `Thresholds: per-sweep ≥ ${perSweepThreshold}, consecutive ≥ ${consecutiveThreshold}.`,
          platform: "FeedGen Background Worker",
          action:   "Check recent FeedGen worker logs, verify the Vertex AI endpoint, and roll back any recent deploys if necessary.",
        }).catch((err) => {
          logger.warn({ err }, "[FeedgenRecovery] Failed to record infra alert (non-fatal)");
        });
      }
    } else {
      // No stuck rows this sweep — reset the consecutive counter and resolve
      // any active alert so operators know the worker is healthy again.
      // `resolveInfraAlert` is idempotent and handles the "no active alert"
      // case gracefully, so call it unconditionally — this ensures the alert
      // is cleared even if the process restarted (losing the in-memory counter)
      // while an alert was still open in the DB.
      _recoveryStatus.consecutiveSweepsWithRecoveries = 0;
      void resolveInfraAlert(FEEDGEN_RECOVERY_ALERT_ID).catch((err) => {
        logger.warn({ err }, "[FeedgenRecovery] Failed to resolve infra alert (non-fatal)");
      });
    }

    return { recovered, stuckRemaining: _recoveryStatus.currentStuckCount };
  } catch (err) {
    _recoveryStatus.state            = "last-error";
    _recoveryStatus.lastSweepAt      = startedAt;
    _recoveryStatus.lastErrorMessage = err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
    logger.warn({ err }, "[FeedgenRecovery] Sweep failed (non-fatal)");
    throw err;
  }
}

let recoveryCronTimer:   ReturnType<typeof setInterval> | null = null;
let recoveryInitialTimer:ReturnType<typeof setTimeout>  | null = null;

export function startFeedgenRecoveryCron(opts: { intervalMs?: number; initialDelayMs?: number } = {}): void {
  const intervalMs     = Math.max(60_000, opts.intervalMs     ?? RECOVERY_DEFAULT_INTERVAL_MS);
  const initialDelayMs = Math.max(0,      opts.initialDelayMs ?? RECOVERY_INITIAL_DELAY_MS);

  if (recoveryCronTimer) {
    logger.debug("[FeedgenRecovery] Cron already running — skipping start");
    return;
  }

  const tick = () => {
    runFeedgenRecoverySweep().catch((err) =>
      logger.warn({ err }, "[FeedgenRecovery] Tick failed (non-fatal)"),
    );
  };

  recoveryInitialTimer = setTimeout(tick, initialDelayMs);
  recoveryInitialTimer.unref?.();
  recoveryCronTimer = setInterval(tick, intervalMs);
  recoveryCronTimer.unref?.();

  logger.info({ intervalMs, initialDelayMs }, "[FeedgenRecovery] Cron started");
}

export function stopFeedgenRecoveryCron(): void {
  if (recoveryInitialTimer) { clearTimeout(recoveryInitialTimer);  recoveryInitialTimer = null; }
  if (recoveryCronTimer)    { clearInterval(recoveryCronTimer);    recoveryCronTimer    = null; }
}

let cronTimer:    ReturnType<typeof setInterval> | null = null;
let initialTimer: ReturnType<typeof setTimeout>  | null = null;

export function startFeedgenCron(opts: { intervalMs?: number; initialDelayMs?: number; maxProducts?: number } = {}): void {
  const intervalMs     = Math.max(60_000, opts.intervalMs     ?? DEFAULT_INTERVAL_MS);
  const initialDelayMs = Math.max(0,      opts.initialDelayMs ?? INITIAL_DELAY_MS);
  const maxProducts    = opts.maxProducts;

  if (cronTimer) {
    logger.debug("[feedgen-runner] Cron already running — skipping start");
    return;
  }

  const tick = () => {
    runFeedgenScan({ maxProducts })
      .then((res) => {
        if (res.skipped) logger.debug({ res }, "[feedgen-runner] Tick skipped");
        else             logger.info({ res }, "[feedgen-runner] Tick complete");
      })
      .catch((err) => logger.warn({ err }, "[feedgen-runner] Tick failed (non-fatal)"));
  };

  initialTimer = setTimeout(tick, initialDelayMs);
  initialTimer.unref?.();
  cronTimer = setInterval(tick, intervalMs);
  cronTimer.unref?.();

  logger.info({ intervalMs, initialDelayMs, maxProducts }, "[feedgen-runner] Cron started");
}

export function stopFeedgenCron(): void {
  if (initialTimer) { clearTimeout(initialTimer);  initialTimer = null; }
  if (cronTimer)    { clearInterval(cronTimer);    cronTimer    = null; }
}
