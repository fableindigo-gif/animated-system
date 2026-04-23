import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import { db, feedEnrichmentJobs, warehouseShopifyProducts, workspaces, proposedTasks, productQualityFixes, auditLogs } from "@workspace/db";
import { eq, and, asc, desc, isNull, isNotNull, sql, gte, gt, inArray } from "drizzle-orm";
import { runQualityFixesScan, rescanProductsByIds } from "../../workers/quality-fixes-scanner";
import {
  applyQualityFixToShopify,
  applyQualityFixesToShopifyBulk,
  undoQualityFixOnShopify,
  APPLY_TOOL_NAME,
  UNDO_TOOL_NAME,
} from "../../workers/quality-fixes-apply";
import { checkEnrichmentTier, resolveEnrichmentContext, TIER_LIMITS } from "../../middleware/enrichment-tier";
import { rescanRateLimit } from "../../middleware/rescan-rate-limiter";
import { runFeedEnrichment } from "../../workers/feed-enrichment";
import {
  runShoptimizerWriteback,
  runWritebackRetryScheduler,
  SHOPTIMIZER_WRITEBACK_TOOL,
  SHOPTIMIZER_WRITEBACK_PLATFORM,
  WRITEBACK_MAX_ATTEMPTS,
  type RetryGuidance,
} from "../../workers/shoptimizer-writeback";
import { logger } from "../../lib/logger";
import { merchantProductSchema, type MerchantProduct } from "../../lib/shoptimizer-client";
import feedgenRouter from "./feedgen";
import {
  optimizeBatch,
  MAX_BATCH,
  BatchTooLargeError,
  InfrastructureFailureError,
} from "../../services/shoptimizer-service";

const router = Router();

/**
 * Per-fix audit entry surfaced alongside each row in
 * `GET /api/feed-enrichment/quality-fixes`. The UI uses this to render an
 * inline "applied by … / undone by …" timeline on a fix without making the
 * operator leave for the full Activity Log.
 */
interface FixHistoryEntry {
  auditId: number;
  action:  "apply" | "undo";
  /** audit_logs.status — "applied" on success, "failed" on partial/error. */
  status:  string;
  /** ISO timestamp of audit_logs.created_at. */
  at:      string;
  actor:   { id: number | null; name: string | null; role: string | null } | null;
}

// ─── FeedGen sub-router ─────────────────────────────────────────────────────
// Mounted at /api/feed-enrichment/feedgen/* — handles AI-generated title +
// description rewrites that flow through the same Shoptimizer write-back
// queue as quality-fix approvals.
router.use("/feedgen", feedgenRouter);

// ─── GET /api/feed-enrichment/status ─────────────────────────────────────────
// Returns the org's enrichment tier info and current month stats.
router.get("/status", checkEnrichmentTier({ soft: true }), async (req, res) => {
  try {
    const ctx = (req as any).enrichmentCtx;

    // Latest job
    const [latestJob] = await db
      .select()
      .from(feedEnrichmentJobs)
      .where(eq(feedEnrichmentJobs.organizationId, ctx.orgId))
      .orderBy(desc(feedEnrichmentJobs.createdAt))
      .limit(1);

    // Total enriched + pending counts in warehouse
    const [{ enrichedCount }] = await db
      .select({ enrichedCount: sql<number>`count(*)::int` })
      .from(warehouseShopifyProducts)
      .where(isNotNull(warehouseShopifyProducts.llmEnrichedAt));

    const [{ pendingCount }] = await db
      .select({ pendingCount: sql<number>`count(*)::int` })
      .from(warehouseShopifyProducts)
      .where(isNull(warehouseShopifyProducts.llmEnrichedAt));

    res.json({
      tier:          ctx.tier,
      limit:         ctx.limit === Infinity ? null : ctx.limit,
      monthlyUsed:   ctx.monthlyUsed,
      remaining:     ctx.remaining === Infinity ? null : ctx.remaining,
      enrichedTotal: Number(enrichedCount) || 0,
      pendingTotal:  Number(pendingCount)  || 0,
      latestJob:     latestJob ?? null,
    });
  } catch (err) {
    logger.error({ err }, "feed-enrichment/status: error");
    res.status(500).json({ error: "Failed to fetch enrichment status" });
  }
});

// ─── GET /api/feed-enrichment/products ───────────────────────────────────────
// Paginated list of products with their LLM attributes.
// Query: ?page=1&limit=50&filter=enriched|pending|all
router.get("/products", checkEnrichmentTier({ soft: true }), async (req, res) => {
  try {
    const page   = Math.max(1, Number(req.query.page)  || 1);
    const limit  = Math.min(100, Number(req.query.limit) || 50);
    const filter = String(req.query.filter ?? "all");
    const offset = (page - 1) * limit;

    let where: ReturnType<typeof isNull> | ReturnType<typeof isNotNull> | undefined;
    if (filter === "enriched") where = isNotNull(warehouseShopifyProducts.llmEnrichedAt);
    if (filter === "pending")  where = isNull(warehouseShopifyProducts.llmEnrichedAt);

    const rows = await db
      .select({
        id:            warehouseShopifyProducts.id,
        productId:     warehouseShopifyProducts.productId,
        sku:           warehouseShopifyProducts.sku,
        title:         warehouseShopifyProducts.title,
        imageUrl:      warehouseShopifyProducts.imageUrl,
        status:        warehouseShopifyProducts.status,
        llmAttributes: warehouseShopifyProducts.llmAttributes,
        llmEnrichedAt: warehouseShopifyProducts.llmEnrichedAt,
      })
      .from(warehouseShopifyProducts)
      .where(where)
      .orderBy(desc(warehouseShopifyProducts.llmEnrichedAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(warehouseShopifyProducts)
      .where(where);

    res.json({ products: rows, total: Number(total) || 0, page, limit });
  } catch (err) {
    logger.error({ err }, "feed-enrichment/products: error");
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

// ─── GET /api/feed-enrichment/jobs ───────────────────────────────────────────
// Recent enrichment job history.
router.get("/jobs", checkEnrichmentTier({ soft: true }), async (req, res) => {
  try {
    const ctx  = (req as any).enrichmentCtx;
    const jobs = await db
      .select()
      .from(feedEnrichmentJobs)
      .where(eq(feedEnrichmentJobs.organizationId, ctx.orgId))
      .orderBy(desc(feedEnrichmentJobs.createdAt))
      .limit(20);
    res.json({ jobs });
  } catch (err) {
    logger.error({ err }, "feed-enrichment/jobs: error");
    res.status(500).json({ error: "Failed to fetch job history" });
  }
});

// ─── POST /api/feed-enrichment/run ───────────────────────────────────────────
// Starts a new enrichment run (async — returns immediately after job creation).
// The worker runs as a non-blocking async task in the same process.
// Body: { batchSize?: number } — number of SKUs to process in this run (default: min(remaining, 500))
router.post("/run", checkEnrichmentTier(), async (req, res) => {
  try {
    const ctx        = (req as any).enrichmentCtx;
    const rbacUser   = (req as any).rbacUser;
    const workspaceId = rbacUser?.workspaceId ?? undefined;

    // Check for an already-running job
    const [running] = await db
      .select({ id: feedEnrichmentJobs.id })
      .from(feedEnrichmentJobs)
      .where(
        and(
          eq(feedEnrichmentJobs.organizationId, ctx.orgId),
          eq(feedEnrichmentJobs.status, "running"),
        ),
      )
      .limit(1);

    if (running) {
      res.status(409).json({
        error:    "An enrichment run is already in progress.",
        jobId:    running.id,
        code:     "JOB_ALREADY_RUNNING",
      });
      return;
    }

    const requestedBatch = Math.min(
      Number(req.body?.batchSize ?? 500),
      500,
    );
    const batchLimit = ctx.remaining === Infinity
      ? requestedBatch
      : Math.min(requestedBatch, ctx.remaining);

    if (batchLimit <= 0) {
      res.status(403).json({
        error:       "Monthly SKU enrichment quota exhausted.",
        code:        "ENRICHMENT_QUOTA_EXCEEDED",
        tier:         ctx.tier,
        monthlyUsed: ctx.monthlyUsed,
        upgradeUrl:  "/billing-hub",
      });
      return;
    }

    // Create the job record
    const [job] = await db
      .insert(feedEnrichmentJobs)
      .values({
        organizationId: ctx.orgId,
        workspaceId:    workspaceId ?? null,
        status:         "pending",
        totalSkus:      0,
        processedSkus:  0,
        failedSkus:     0,
      })
      .returning();

    logger.info({ jobId: job.id, orgId: ctx.orgId, batchLimit }, "Feed enrichment job created, starting worker");

    // Fire and forget — worker runs in background
    runFeedEnrichment({
      jobId:          job.id,
      organizationId: ctx.orgId,
      workspaceId,
      limit:          batchLimit,
    }).catch((err) => {
      logger.error({ err, jobId: job.id }, "Feed enrichment worker unhandled error");
      // tenant-ownership-skip: follow-up failure marker on a job whose row
      // was inserted/loaded with org scope earlier in this handler (`job`).
      db.update(feedEnrichmentJobs)
        .set({ status: "failed", errorMessage: String(err), completedAt: new Date() })
        .where(eq(feedEnrichmentJobs.id, job.id))
        .catch(() => {});
    });

    res.status(202).json({
      jobId:      job.id,
      status:     "started",
      batchLimit,
      tier:        ctx.tier,
      remaining:  ctx.remaining === Infinity ? null : ctx.remaining,
    });
  } catch (err) {
    logger.error({ err }, "feed-enrichment/run: error");
    res.status(500).json({ error: "Failed to start enrichment run" });
  }
});

// ─── GET /api/feed-enrichment/job/:id ────────────────────────────────────────
// Poll a specific job for progress updates.
router.get("/job/:id", checkEnrichmentTier({ soft: true }), async (req, res) => {
  try {
    const jobId = Number(req.params.id);
    const ctx   = (req as any).enrichmentCtx;
    const [job] = await db
      .select()
      .from(feedEnrichmentJobs)
      .where(
        and(
          eq(feedEnrichmentJobs.id, jobId),
          eq(feedEnrichmentJobs.organizationId, ctx.orgId),
        ),
      )
      .limit(1);

    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json({ job });
  } catch (err) {
    logger.error({ err }, "feed-enrichment/job/:id: error");
    res.status(500).json({ error: "Failed to fetch job" });
  }
});

// ─── POST /api/feed-enrichment/optimize ──────────────────────────────────────
// Run one or more Merchant Center products through the external Shoptimizer
// service and return the optimized payloads + a structured field-level diff.
//
// Body: { products: MerchantProduct[] (1..MAX_BATCH), pluginSettings?: object }
// Also accepts { product: MerchantProduct } for single-product convenience.
//
// Failure modes:
//   • 400 — bad input or batch too large
//   • 503 — SHOPTIMIZER_BASE_URL unset OR Shoptimizer unreachable
//   • 200 — partial successes are returned per-item with `ok: false`
const optimizeBodySchema = z
  .object({
    product: merchantProductSchema.optional(),
    products: z.array(merchantProductSchema).optional(),
    pluginSettings: z.record(z.unknown()).optional(),
  })
  .refine((b) => b.product || (b.products && b.products.length > 0), {
    message: "Provide `product` or a non-empty `products` array.",
  });

router.post("/optimize", async (req, res) => {
  const parsed = optimizeBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  const { product, products, pluginSettings } = parsed.data;
  const list = products ?? [product!];

  try {
    const batch = await optimizeBatch(
      list.map((p) => ({ product: p, pluginSettings })),
    );
    res.json({
      maxBatch: MAX_BATCH,
      ...batch,
    });
  } catch (err) {
    if (err instanceof BatchTooLargeError) {
      res.status(400).json({ error: err.message, code: err.code, max: err.max });
      return;
    }
    if (err instanceof InfrastructureFailureError) {
      res.status(503).json({ error: err.message, code: err.code });
      return;
    }
    logger.error({ err }, "feed-enrichment/optimize: error");
    res.status(500).json({ error: "Failed to optimize products" });
  }
});

// Returns pre-computed Shoptimizer diffs from `product_quality_fixes`,
// joined to the live warehouse product so callers get title/sku/image
// alongside the suggested fixes. The Quality Fixes UI uses this instead
// of running a synchronous scan on every page load.
//
// Query:
//   ?page=1&limit=50
//   &filter=with-fixes | no-fixes | error | all   (default: with-fixes)
//   &stale=true                                   (only rows older than the live product)
//   &sort=recent | oldest                         (default: recent — biggest changeCount, newest scan first)
router.get("/quality-fixes", checkEnrichmentTier({ soft: true }), async (req, res) => {
  try {
    const page   = Math.max(1, Number(req.query.page)  || 1);
    const limit  = Math.min(100, Number(req.query.limit) || 50);
    const filter = String(req.query.filter ?? "with-fixes");
    const onlyStale = String(req.query.stale ?? "") === "true";
    const sort   = String(req.query.sort ?? "recent") === "oldest" ? "oldest" : "recent";
    const offset = (page - 1) * limit;

    // Tenant scoping. The endpoint must never surface another tenant's
    // pre-computed fixes — the UI auto-loads + auto-selects rows for
    // approval, and the approve route would 403 a mixed-tenant payload.
    // Without a resolved tenant id the only safe response is "empty".
    const ctx      = (req as any).enrichmentCtx;
    const tenantId = ctx?.orgId != null ? String(ctx.orgId) : null;
    if (!tenantId) {
      logger.warn("feed-enrichment/quality-fixes: no tenant in context — returning empty list");
      res.json({
        page, limit, total: 0, results: [],
        coverage: { totalProducts: 0, scannedProducts: 0, pendingScan: 0, lastScanAt: null },
      });
      return;
    }

    const conditions: ReturnType<typeof eq>[] = [
      eq(productQualityFixes.tenantId, tenantId) as ReturnType<typeof eq>,
      eq(warehouseShopifyProducts.tenantId, tenantId) as ReturnType<typeof eq>,
    ];
    if (filter === "with-fixes") {
      conditions.push(gt(productQualityFixes.changeCount, 0) as ReturnType<typeof eq>);
      conditions.push(eq(productQualityFixes.status, "ok"));
    } else if (filter === "no-fixes") {
      conditions.push(eq(productQualityFixes.changeCount, 0) as ReturnType<typeof eq>);
      conditions.push(eq(productQualityFixes.status, "ok"));
    } else if (filter === "error") {
      conditions.push(eq(productQualityFixes.status, "error"));
    }
    if (onlyStale) {
      conditions.push(
        gt(warehouseShopifyProducts.syncedAt, productQualityFixes.productSyncedAt) as ReturnType<typeof eq>,
      );
    }
    const where = and(...conditions);

    const rows = await db
      .select({
        id:               productQualityFixes.id,
        tenantId:         productQualityFixes.tenantId,
        productId:        productQualityFixes.productId,
        sku:              productQualityFixes.sku,
        title:            warehouseShopifyProducts.title,
        imageUrl:         warehouseShopifyProducts.imageUrl,
        productStatus:    warehouseShopifyProducts.status,
        scanStatus:       productQualityFixes.status,
        errorCode:        productQualityFixes.errorCode,
        errorMessage:     productQualityFixes.errorMessage,
        pluginsFired:     productQualityFixes.pluginsFired,
        changedFields:    productQualityFixes.changedFields,
        changeCount:      productQualityFixes.changeCount,
        productSyncedAt:  productQualityFixes.productSyncedAt,
        scannedAt:        productQualityFixes.scannedAt,
        productLastSync:  warehouseShopifyProducts.syncedAt,
      })
      .from(productQualityFixes)
      .innerJoin(
        warehouseShopifyProducts,
        eq(warehouseShopifyProducts.id, productQualityFixes.id),
      )
      .where(where)
      .orderBy(
        ...(sort === "oldest"
          ? [asc(productQualityFixes.scannedAt), desc(productQualityFixes.changeCount)]
          : [desc(productQualityFixes.changeCount), desc(productQualityFixes.scannedAt)]),
      )
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(productQualityFixes)
      .innerJoin(
        warehouseShopifyProducts,
        eq(warehouseShopifyProducts.id, productQualityFixes.id),
      )
      .where(where);

    // Coverage stats — useful for the UI to show "X of Y products scanned".
    // All counts are scoped to this tenant.
    const [{ totalProducts }] = await db
      .select({ totalProducts: sql<number>`count(*)::int` })
      .from(warehouseShopifyProducts)
      .where(eq(warehouseShopifyProducts.tenantId, tenantId));
    const [{ scannedProducts }] = await db
      .select({ scannedProducts: sql<number>`count(*)::int` })
      .from(productQualityFixes)
      .where(eq(productQualityFixes.tenantId, tenantId));
    const [{ pendingScan }] = await db
      .select({ pendingScan: sql<number>`count(*)::int` })
      .from(warehouseShopifyProducts)
      .leftJoin(
        productQualityFixes,
        eq(productQualityFixes.id, warehouseShopifyProducts.id),
      )
      .where(and(
        eq(warehouseShopifyProducts.tenantId, tenantId),
        sql`${productQualityFixes.id} IS NULL OR ${warehouseShopifyProducts.syncedAt} > ${productQualityFixes.productSyncedAt}`,
      ));

    const [latestScan] = await db
      .select({ scannedAt: productQualityFixes.scannedAt })
      .from(productQualityFixes)
      .where(eq(productQualityFixes.tenantId, tenantId))
      .orderBy(desc(productQualityFixes.scannedAt))
      .limit(1);

    // Per-row "undoable audit id". For each fix row in this page, look up the
    // *latest* applied audit entry (apply or undo) keyed by toolArgs.fixId.
    // If that latest entry is an apply, the row can be undone — surface its
    // audit id so the UI can show an "Undo" button. If the latest is itself
    // an undo (or there is no applied entry), no Undo is offered.
    const rowIds = rows.map((r) => r.id);
    const undoableMap = new Map<string, number>();
    // Per-row apply/undo timeline. Each entry is the audit_logs row that
    // either applied or undid a fix on this product, ordered oldest →
    // newest so the UI can render a chronological story ("Applied by X
    // at T → Undone by Y at T → Re-applied …"). Powers the inline
    // history disclosure in FixRow without forcing the user to leave
    // the page for the full Activity log.
    const historyMap = new Map<string, FixHistoryEntry[]>();
    if (rowIds.length > 0) {
      // tenant-ownership-skip: org-scoped via WHERE organization_id = ctx.orgId inside the sql`` template literal
      const latest = await db.execute(sql`
        SELECT DISTINCT ON ((tool_args->>'fixId'))
          (tool_args->>'fixId') AS fix_id,
          id,
          tool_name
        FROM audit_logs
        -- sql-ambiguous-skip: single-table audit_logs query — organization_id is unambiguous
        WHERE organization_id = ${ctx.orgId}
          AND tool_name IN (${APPLY_TOOL_NAME}, ${UNDO_TOOL_NAME})
          AND status     = 'applied'
          AND (tool_args->>'fixId') = ANY(${rowIds}::text[])
        -- sql-ambiguous-skip: single-table audit_logs query — created_at is unambiguous
        ORDER BY (tool_args->>'fixId'), created_at DESC
      `);
      const latestRows = (latest as unknown as { rows?: Array<{ fix_id: string; id: number; tool_name: string }> }).rows ?? [];
      for (const r of latestRows) {
        if (r.tool_name === APPLY_TOOL_NAME) undoableMap.set(r.fix_id, Number(r.id));
      }

      // Full per-fix timeline (oldest → newest). We pull both apply and
      // undo rows — including failed attempts so operators can see why a
      // fix is in its current state — and project the actor out of
      // toolArgs.appliedBy / toolArgs.undoneBy.
      // tenant-ownership-skip: org-scoped via WHERE organization_id = ctx.orgId inside the sql`` template literal
      const historyRes = await db.execute(sql`
        SELECT
          (tool_args->>'fixId')                   AS fix_id,
          id,
          tool_name,
          status,
          -- sql-ambiguous-skip: single-table audit_logs query — created_at is unambiguous
          created_at,
          tool_args->'appliedBy'                  AS applied_by,
          tool_args->'undoneBy'                   AS undone_by
        FROM audit_logs
        WHERE organization_id = ${ctx.orgId}
          AND tool_name IN (${APPLY_TOOL_NAME}, ${UNDO_TOOL_NAME})
          AND (tool_args->>'fixId') = ANY(${rowIds}::text[])
        ORDER BY (tool_args->>'fixId'), created_at ASC
      `);
      const historyRows =
        (historyRes as unknown as {
          rows?: Array<{
            fix_id:     string;
            id:         number;
            tool_name:  string;
            status:     string;
            created_at: string | Date;
            applied_by: { id?: number | null; name?: string | null; role?: string | null } | null;
            undone_by:  { id?: number | null; name?: string | null; role?: string | null } | null;
          }>;
        }).rows ?? [];
      for (const r of historyRows) {
        const action: "apply" | "undo" = r.tool_name === UNDO_TOOL_NAME ? "undo" : "apply";
        const actor  = action === "undo" ? r.undone_by : r.applied_by;
        const entry: FixHistoryEntry = {
          auditId: Number(r.id),
          action,
          status:  r.status,
          at:      r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
          actor: actor && (actor.id != null || actor.name)
            ? {
                id:   actor.id   ?? null,
                name: actor.name ?? null,
                role: actor.role ?? null,
              }
            : null,
        };
        const list = historyMap.get(r.fix_id);
        if (list) list.push(entry);
        else historyMap.set(r.fix_id, [entry]);
      }
    }
    const resultsWithUndo = rows.map((r) => ({
      ...r,
      undoableAuditId: undoableMap.get(r.id) ?? null,
      history: historyMap.get(r.id) ?? [],
    }));

    res.json({
      page,
      limit,
      total: Number(total) || 0,
      results: resultsWithUndo,
      coverage: {
        totalProducts:   Number(totalProducts)   || 0,
        scannedProducts: Number(scannedProducts) || 0,
        pendingScan:     Number(pendingScan)     || 0,
        lastScanAt:      latestScan?.scannedAt ?? null,
      },
    });
  } catch (err) {
    logger.error({ err }, "feed-enrichment/quality-fixes: error");
    res.status(500).json({ error: "Failed to fetch quality fixes" });
  }
});

// ─── GET /api/feed-enrichment/quality-fixes/rescan-budget ────────────────────
// Returns the calling tenant's remaining manual-rescan budget for the current
// minute, plus how many milliseconds until the next token is available.
// The UI polls this to show a "X rescans left" badge and disable buttons when
// the budget is exhausted.
router.get("/quality-fixes/rescan-budget", checkEnrichmentTier({ soft: true }), (req, res) => {
  const ctx   = (req as any).enrichmentCtx;
  const orgId = ctx?.orgId;

  // When no tenant can be derived, return a full budget so the UI stays
  // functional (the downstream 401 path on the POST route handles auth).
  const key      = orgId != null ? `tenant-${String(orgId)}` : null;
  const snapshot = key
    ? rescanRateLimit.inspectBucket(key)
    : { remaining: rescanRateLimit.capacity, capacity: rescanRateLimit.capacity, resetInMs: 0 };

  res.json(snapshot);
});

// ─── POST /api/feed-enrichment/quality-fixes/rescan ──────────────────────────
// Manually trigger a quality-fixes scan tick. The scheduled cron normally
// keeps the table fresh; this endpoint is for "scan now" UI buttons and
// for ops backfills. Returns immediately with the run summary.
// Body (all optional):
//   • { maxProducts?: number }           — bulk staleness scan (default behaviour)
//   • { productIds: string[] }           — targeted rescan of specific
//                                          warehouse_shopify_products.id rows
//                                          (used by per-row "Rescan" + the
//                                          "Rescan failed" bulk action). Capped
//                                          at 100 ids per call to keep the
//                                          synchronous Shoptimizer round-trip
//                                          bounded.
const rescanBodySchema = z.object({
  maxProducts: z.number().int().positive().max(1000).optional(),
  productIds:  z.array(z.string().min(1)).min(1).max(100).optional(),
});

router.post("/quality-fixes/rescan", checkEnrichmentTier({ soft: true }), rescanRateLimit, async (req, res) => {
  // Scope to the caller's tenant so an authenticated user can never trigger
  // a scan that touches another tenant's products (and burns their
  // Shoptimizer quota / pollutes their cache).
  const ctx      = (req as any).enrichmentCtx;
  const tenantId = ctx?.orgId != null ? String(ctx.orgId) : null;
  if (!tenantId) {
    res.status(401).json({ error: "Could not resolve organization context." });
    return;
  }

  const parsed = rescanBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  try {
    if (parsed.data.productIds && parsed.data.productIds.length > 0) {
      // De-dup ids before forwarding so a noisy UI selection doesn't waste
      // Shoptimizer calls.
      const ids = Array.from(new Set(parsed.data.productIds));
      const result = await rescanProductsByIds(ids, { tenantId });
      res.json(result);
      return;
    }

    const result = await runQualityFixesScan({
      maxProducts: parsed.data.maxProducts,
      tenantId,
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "feed-enrichment/quality-fixes/rescan: error");
    res.status(500).json({ error: "Failed to run quality-fixes scan" });
  }
});

// ─── POST /api/feed-enrichment/quality-fixes/apply ───────────────────────────
// Push a single cached Shoptimizer fix back to the underlying Shopify
// product (title/body_html via PUT, everything else as a metafield in the
// `omnianalytix_feed` namespace). Records an audit_logs row attributing
// the change to the calling user, then re-scans the product so the UI
// reflects the new state.
//
// Body: { id: string }   — warehouse_shopify_products.id (also pq.id)
const applyBodySchema = z.object({
  id: z.string().min(1),
});

router.post("/quality-fixes/apply", checkEnrichmentTier({ soft: true }), async (req, res) => {
  const parsed = applyBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const ctx = (req as any).enrichmentCtx;
  if (!ctx?.orgId) {
    res.status(401).json({ error: "Could not resolve organization context." });
    return;
  }
  const tenantId = String(ctx.orgId);

  // Tenant-scoped existence check before we touch Shopify — keeps a 404
  // distinguishable from a 403 and prevents leaking foreign ids.
  const [owned] = await db
    .select({ id: warehouseShopifyProducts.id })
    .from(warehouseShopifyProducts)
    .where(and(
      eq(warehouseShopifyProducts.id, parsed.data.id),
      eq(warehouseShopifyProducts.tenantId, tenantId),
    ))
    .limit(1);
  if (!owned) {
    res.status(404).json({ error: "Quality fix not found for this tenant." });
    return;
  }

  const rbacUser = (req as any).rbacUser ?? null;

  try {
    const result = await applyQualityFixToShopify({
      fixId:          parsed.data.id,
      organizationId: ctx.orgId,
      workspaceId:    rbacUser?.workspaceId ?? null,
      user: rbacUser
        ? { id: rbacUser.id ?? null, name: rbacUser.name ?? null, role: rbacUser.role ?? null }
        : null,
    });
    // 200 on full success, 207 on partial (some fields wrote, others didn't),
    // 502 if everything failed at the Shopify edge.
    const httpStatus = result.ok
      ? 200
      : result.applied.some((a) => a.ok) ? 207 : 502;
    res.status(httpStatus).json(result);
  } catch (err) {
    logger.error({ err }, "feed-enrichment/quality-fixes/apply: error");
    res.status(500).json({ error: "Failed to apply quality fix" });
  }
});

// ─── POST /api/feed-enrichment/quality-fixes/apply-bulk ──────────────────────
// Push many cached Shoptimizer fixes back to Shopify in a single user
// action. Tenant ownership is checked up-front for *every* id so a forged
// or stale selection can never touch a foreign tenant's products.
//
// Streams per-row outcomes to the client as NDJSON (one JSON object per
// line) so the dashboard can render live progress. The final line is a
// `{ type: "summary", ... }` aggregate.
//
// Body: { ids: string[] }   — warehouse_shopify_products.id values (1..50)
const APPLY_BULK_MAX = 50;
const applyBulkBodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(APPLY_BULK_MAX),
});

router.post("/quality-fixes/apply-bulk", checkEnrichmentTier({ soft: true }), async (req, res) => {
  const parsed = applyBulkBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const ctx = (req as any).enrichmentCtx;
  if (!ctx?.orgId) {
    res.status(401).json({ error: "Could not resolve organization context." });
    return;
  }
  const tenantId = String(ctx.orgId);

  // De-dup before the ownership check so a noisy selection can't double
  // the work or smuggle a foreign id in via a duplicate.
  const ids = Array.from(new Set(parsed.data.ids));

  const owned = await db
    .select({ id: warehouseShopifyProducts.id })
    .from(warehouseShopifyProducts)
    .where(and(
      eq(warehouseShopifyProducts.tenantId, tenantId),
      inArray(warehouseShopifyProducts.id, ids),
    ));
  const ownedSet = new Set(owned.map((r) => r.id));
  const foreign  = ids.filter((id) => !ownedSet.has(id));
  if (foreign.length > 0) {
    res.status(403).json({
      error: "One or more ids reference products outside this tenant.",
      code:  "FOREIGN_FIX_IDS",
      foreign,
    });
    return;
  }

  const rbacUser = (req as any).rbacUser ?? null;

  // NDJSON stream — one JSON object per line, flushed as each row finishes.
  // Headers are committed before any work happens so the client knows the
  // bulk run started even if the first Shopify call is slow.
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");        // disable proxy buffering
  res.flushHeaders?.();

  const writeLine = (obj: unknown): boolean =>
    res.write(JSON.stringify(obj) + "\n");

  // Initial "started" line so the client can render the running state
  // without waiting on the first row's Shopify round-trip.
  writeLine({ type: "started", total: ids.length });

  let aborted = false;
  req.on("close", () => {
    // Client disconnected mid-stream. We can't cancel in-flight Shopify
    // writes, but stop emitting progress lines so we don't write to a
    // closed socket.
    aborted = true;
  });

  try {
    const summary = await applyQualityFixesToShopifyBulk(
      {
        fixIds:         ids,
        organizationId: ctx.orgId,
        workspaceId:    rbacUser?.workspaceId ?? null,
        user: rbacUser
          ? { id: rbacUser.id ?? null, name: rbacUser.name ?? null, role: rbacUser.role ?? null }
          : null,
      },
      (progress) => {
        if (aborted) return;
        writeLine({ type: "progress", ...progress });
      },
    );
    if (!aborted) {
      writeLine({ type: "summary", ...summary });
    }
    res.end();
  } catch (err) {
    logger.error({ err }, "feed-enrichment/quality-fixes/apply-bulk: error");
    if (!aborted) {
      writeLine({ type: "error", error: "Bulk apply failed", message: String(err) });
    }
    res.end();
  }
});

// ─── POST /api/feed-enrichment/quality-fixes/undo ────────────────────────────
// Reverts a previously-applied Shopify quality fix by replaying the inverse
// writes (the original `before` values stored on the audit_logs row at apply
// time). Records a *new* audit row tagged `shopify_undo_quality_fix` and
// re-scans the product so the UI reflects the reverted state.
//
// Body: { auditId: number }   — id of the original apply audit_logs row.
const undoBodySchema = z.object({
  auditId: z.number().int().positive(),
});

router.post("/quality-fixes/undo", checkEnrichmentTier({ soft: true }), async (req, res) => {
  const parsed = undoBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const ctx = (req as any).enrichmentCtx;
  if (!ctx?.orgId) {
    res.status(401).json({ error: "Could not resolve organization context." });
    return;
  }

  const rbacUser = (req as any).rbacUser ?? null;

  try {
    const result = await undoQualityFixOnShopify({
      auditId:        parsed.data.auditId,
      organizationId: ctx.orgId,
      workspaceId:    rbacUser?.workspaceId ?? null,
      user: rbacUser
        ? { id: rbacUser.id ?? null, name: rbacUser.name ?? null, role: rbacUser.role ?? null }
        : null,
    });
    // Map worker outcome codes → HTTP statuses (no regex on error text):
    //  - 200: undo succeeded
    //  - 207: partial — some inverse writes failed at Shopify
    //  - 404: audit row missing or not visible to this tenant
    //  - 409: business-rule violation (already undone, not an apply, no
    //         successful fields to revert)
    //  - 502: Shopify rejected every inverse write
    switch (result.code) {
      case "OK":             res.status(200).json(result); return;
      case "NOT_FOUND":      res.status(404).json(result); return;
      case "NOT_AN_APPLY":
      case "ALREADY_UNDONE":
      case "NO_FIELDS":      res.status(409).json(result); return;
      case "SHOPIFY_PARTIAL": res.status(207).json(result); return;
      case "SHOPIFY_FAILED":  res.status(502).json(result); return;
      default: {
        const exhaustive: never = result.code;
        logger.error({ code: exhaustive }, "feed-enrichment/quality-fixes/undo: unhandled outcome code");
        res.status(500).json({ error: "Unhandled undo outcome" });
      }
    }
  } catch (err) {
    logger.error({ err }, "feed-enrichment/quality-fixes/undo: error");
    res.status(500).json({ error: "Failed to undo quality fix" });
  }
});

// ─── POST /api/feed-enrichment/quality-fixes/approve ─────────────────────────
// Push selected Shoptimizer fixes into the existing Approval Queue
// (proposed_tasks). Actual Merchant Center write-back is stubbed for now —
// the agency operator approves the proposed change in the task board, and a
// future worker will replay these against Merchant Center.
//
// Body: { fixes: Array<{
//   offerId: string;
//   productId?: string | null;
//   sku?: string | null;
//   title?: string | null;
//   pluginsFired: string[];
//   changedFields: Array<{ field: string; before: unknown; after: unknown }>;
// }> }
const approveBodySchema = z.object({
  fixes: z.array(z.object({
    offerId:      z.string().min(1),
    productId:    z.string().nullable().optional(),
    sku:          z.string().nullable().optional(),
    title:        z.string().nullable().optional(),
    pluginsFired: z.array(z.string()).default([]),
    changedFields: z.array(z.object({
      field:  z.string(),
      before: z.unknown(),
      after:  z.unknown(),
    })).min(1),
  })).min(1).max(MAX_BATCH),
});

function previewValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v.length > 120 ? v.slice(0, 117) + "…" : v;
  try {
    const s = JSON.stringify(v);
    return s.length > 120 ? s.slice(0, 117) + "…" : s;
  } catch { return String(v); }
}

router.post("/quality-fixes/approve", checkEnrichmentTier({ soft: true }), async (req, res) => {
  const parsed = approveBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const user = (req as any).rbacUser;
  const wsId = user?.workspaceId ?? null;
  const ctx  = (req as any).enrichmentCtx;
  const tenantId = ctx?.orgId != null ? String(ctx.orgId) : null;

  // Without a resolved tenant we cannot prove ownership of any offerId —
  // refuse the request rather than skip the cross-tenant check (which
  // would let a misconfigured caller queue write-backs against any
  // product in the warehouse).
  if (!tenantId) {
    res.status(401).json({ error: "Could not resolve organization context." });
    return;
  }

  // Verify every offerId in the request actually belongs to the caller's
  // tenant before queuing tasks — prevents a caller from forging fixes
  // against other tenants' products.
  const offerIds = Array.from(new Set(parsed.data.fixes.map((f) => f.offerId)));
  const owned = await db
    .select({ id: warehouseShopifyProducts.id })
    .from(warehouseShopifyProducts)
    .where(and(
      eq(warehouseShopifyProducts.tenantId, tenantId),
      inArray(warehouseShopifyProducts.id, offerIds),
    ));
  const ownedSet = new Set(owned.map((r) => r.id));
  const foreign = offerIds.filter((id) => !ownedSet.has(id));
  if (foreign.length > 0) {
    res.status(403).json({
      error: "One or more fixes reference products outside this tenant.",
      code:  "FOREIGN_OFFER_IDS",
      foreign,
    });
    return;
  }

  const created: Array<{ id: number; offerId: string; duplicate?: boolean }> = [];

  try {
    for (const fix of parsed.data.fixes) {
      const toolArgs = {
        offerId:       fix.offerId,
        productId:     fix.productId ?? null,
        sku:           fix.sku ?? null,
        pluginsFired:  fix.pluginsFired,
        changedFields: fix.changedFields,
      };
      const idempotencyKey = crypto.createHash("sha256")
        .update(JSON.stringify({ ws: wsId, tool: "shoptimizer_apply_fix", args: toolArgs }))
        .digest("hex")
        .substring(0, 40);

      // Reuse an identical pending task if it already exists.
      // tenant-ownership-skip: idempotency-key deduplication; key is SHA-256 of workspace-scoped content — collision across orgs is cryptographically negligible
      const existing = await db.select({ id: proposedTasks.id })
        .from(proposedTasks)
        .where(and(
          eq(proposedTasks.idempotencyKey, idempotencyKey),
          eq(proposedTasks.status, "pending"),
        ))
        .limit(1);

      if (existing.length > 0) {
        created.push({ id: existing[0].id, offerId: fix.offerId, duplicate: true });
        continue;
      }

      const displayDiff = fix.changedFields.map((c) => ({
        label: c.field,
        from:  previewValue(c.before),
        to:    previewValue(c.after),
      }));

      const productLabel = fix.title || fix.sku || fix.productId || fix.offerId;
      const reasoning = `Shoptimizer suggested ${fix.changedFields.length} field fix(es) ` +
        `via plugin(s): ${fix.pluginsFired.join(", ") || "n/a"}. ` +
        `Approving will queue a Merchant Center write-back for "${productLabel}".`;

      const [task] = await db.insert(proposedTasks).values({
        workspaceId:     wsId,
        idempotencyKey,
        proposedBy:      user?.id ?? null,
        proposedByName:  user?.name || "Feed Enrichment",
        proposedByRole:  user?.role || "system",
        platform:        "gmc",
        platformLabel:   "Google Merchant Center",
        toolName:        "shoptimizer_apply_fix",
        toolDisplayName: `Apply feed fix: ${productLabel}`,
        toolArgs,
        displayDiff,
        reasoning,
        comments:        "",
        status:          "pending",
      }).returning();

      created.push({ id: task.id, offerId: fix.offerId });
    }

    res.status(201).json({
      approved:  created.length,
      duplicate: created.filter((c) => c.duplicate).length,
      tasks:     created,
    });
  } catch (err) {
    logger.error({ err }, "feed-enrichment/quality-fixes/approve: error");
    res.status(500).json({ error: "Failed to queue fixes for approval" });
  }
});

// ─── Shoptimizer → GMC write-back ────────────────────────────────────────────
//
// Once a Shoptimizer diff has been reviewed (sibling task: dashboard fixes
// UI), it can be queued for write-back. Write-backs flow through the existing
// Approval Queue (`proposed_tasks`) and the mutation/audit log (`audit_logs`)
// so every PATCH that hits Google Merchant Center is attributable.
//
// Two-step flow:
//   1) POST /writeback/enqueue → creates pending proposed_tasks rows
//      (managers/admins may pass autoApprove to skip the approve step).
//   2) PATCH /api/tasks/:id/approve (existing) → flips them to `approved`.
//   3) POST /writeback/run → drains approved rows by calling
//      Content API products.update for each, classifies failures with
//      retry guidance, and writes per-product audit log entries.

const writebackDiffSchema = z.object({
  offerId: z.string().min(1),
  optimized: merchantProductSchema,
  original: merchantProductSchema.optional(),
  pluginsFired: z.array(z.string()).optional(),
  changedFields: z.array(z.string()).optional(),
  merchantId: z.string().optional(),
  /** Optional override for the human-readable label shown in the queue. */
  toolDisplayName: z.string().optional(),
  /** Optional pre-computed display diff so the UI doesn't have to re-derive it. */
  displayDiff: z
    .array(z.object({ label: z.string(), from: z.string(), to: z.string() }))
    .optional(),
});

const writebackEnqueueBody = z.object({
  diffs: z.array(writebackDiffSchema).min(1).max(MAX_BATCH),
  /**
   * Optional shortcut: if the caller is a manager/admin, skip the
   * separate `/api/tasks/:id/approve` step. Analysts cannot use this.
   * Default false — pending rows must go through the existing approval
   * route just like every other proposed task.
   */
  autoApprove: z.boolean().optional(),
});

router.post("/writeback/enqueue", async (req, res) => {
  const parsed = writebackEnqueueBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  try {
    const rbacUser = (req as any).rbacUser ?? null;
    if (!rbacUser?.id) {
      res.status(401).json({ error: "Authentication required to enqueue write-backs." });
      return;
    }
    const ctx = await resolveEnrichmentContext(req);
    if (!ctx) {
      res.status(401).json({ error: "Could not resolve organization context." });
      return;
    }
    const workspaceId = rbacUser.workspaceId ?? null;
    if (!workspaceId) {
      // SECURITY: the worker scopes drains by workspace→organization, so
      // workspace-less tasks are deliberately excluded. Refuse here so
      // approved rows can't be silently orphaned outside any tenant.
      res.status(400).json({ error: "Caller has no workspace; cannot enqueue write-back." });
      return;
    }

    // SECURITY: only managers/admins may auto-approve writebacks. Anything
    // else is enqueued in `pending` and must flow through the existing
    // /api/tasks/:id/approve route (which already enforces that gate).
    const isManager = rbacUser.role === "admin" || rbacUser.role === "manager";
    const autoApprove = parsed.data.autoApprove === true && isManager;
    if (parsed.data.autoApprove === true && !isManager) {
      res.status(403).json({
        error: "Only managers/admins can auto-approve write-backs. Enqueue as pending and approve via /api/tasks/:id/approve.",
      });
      return;
    }

    const proposedByName = rbacUser.name ?? "unknown";
    const proposedByRole = rbacUser.role ?? "analyst";
    const proposedBy = rbacUser.id;

    const inserted = await Promise.all(
      parsed.data.diffs.map(async (diff) => {
        const displayDiff =
          diff.displayDiff ??
          (diff.changedFields ?? []).map((f) => ({
            label: f,
            from: String((diff.original as Record<string, unknown> | undefined)?.[f] ?? ""),
            to: String((diff.optimized as Record<string, unknown>)[f] ?? ""),
          }));

        const [row] = await db
          .insert(proposedTasks)
          .values({
            workspaceId,
            proposedBy,
            proposedByName,
            proposedByRole,
            platform: SHOPTIMIZER_WRITEBACK_PLATFORM,
            platformLabel: "Google Merchant Center",
            toolName: SHOPTIMIZER_WRITEBACK_TOOL,
            toolDisplayName:
              diff.toolDisplayName ?? `Apply Shoptimizer fix to GMC offer ${diff.offerId}`,
            toolArgs: {
              offerId: diff.offerId,
              optimized: diff.optimized,
              original: diff.original,
              pluginsFired: diff.pluginsFired ?? [],
              changedFields: diff.changedFields ?? [],
              merchantId: diff.merchantId,
            },
            displayDiff,
            reasoning:
              `Shoptimizer optimized ${diff.changedFields?.length ?? "0"} field(s) on offer ${diff.offerId}` +
              (diff.pluginsFired?.length ? ` via plugins: ${diff.pluginsFired.join(", ")}` : ""),
            status: autoApprove ? "approved" : "pending",
            resolvedAt: autoApprove ? new Date() : null,
            resolvedBy: autoApprove ? proposedBy : null,
            resolvedByName: autoApprove ? proposedByName : null,
          })
          .returning({ id: proposedTasks.id, status: proposedTasks.status });
        return { id: row.id, offerId: diff.offerId, status: row.status };
      }),
    );

    res.status(201).json({
      enqueued: inserted.length,
      tasks: inserted,
      organizationId: ctx.orgId,
    });
  } catch (err) {
    logger.error({ err }, "feed-enrichment/writeback/enqueue: error");
    res.status(500).json({ error: "Failed to enqueue write-back" });
  }
});

const writebackRunBody = z.object({
  taskIds: z.array(z.number().int().positive()).max(MAX_BATCH).optional(),
  merchantId: z.string().optional(),
});

router.post("/writeback/run", async (req, res) => {
  const parsed = writebackRunBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  try {
    const ctx = await resolveEnrichmentContext(req);
    if (!ctx) {
      res.status(401).json({ error: "Could not resolve organization context." });
      return;
    }
    const rbacUser = (req as any).rbacUser ?? null;

    const result = await runShoptimizerWriteback({
      organizationId: ctx.orgId,
      taskIds: parsed.data.taskIds,
      merchantId: parsed.data.merchantId,
      approvedBy: rbacUser
        ? { id: rbacUser.id, name: rbacUser.name, role: rbacUser.role }
        : null,
    });

    const httpStatus =
      result.totalRequested === 0 || result.totalApplied > 0 ? 200 : 207;
    res.status(httpStatus).json(result);
  } catch (err) {
    logger.error({ err }, "feed-enrichment/writeback/run: error");
    res.status(500).json({ error: "Failed to run write-back" });
  }
});

router.get("/writeback", async (req, res) => {
  try {
    const ctx = await resolveEnrichmentContext(req);
    if (!ctx) {
      res.status(401).json({ error: "Could not resolve organization context." });
      return;
    }
    const status = typeof req.query.status === "string" ? req.query.status : undefined;

    const where = status
      ? and(
          eq(proposedTasks.toolName, SHOPTIMIZER_WRITEBACK_TOOL),
          eq(proposedTasks.status, status),
          // sql-ambiguous-skip: subquery references workspaces only — organization_id is unambiguous
          sql`${proposedTasks.workspaceId} IN (SELECT id FROM workspaces WHERE organization_id = ${ctx.orgId})`,
        )
      : and(
          eq(proposedTasks.toolName, SHOPTIMIZER_WRITEBACK_TOOL),
          // sql-ambiguous-skip: subquery references workspaces only — organization_id is unambiguous
          sql`${proposedTasks.workspaceId} IN (SELECT id FROM workspaces WHERE organization_id = ${ctx.orgId})`,
        );

    const tasks = await db
      .select({
        id: proposedTasks.id,
        workspaceId: proposedTasks.workspaceId,
        idempotencyKey: proposedTasks.idempotencyKey,
        proposedBy: proposedTasks.proposedBy,
        proposedByName: proposedTasks.proposedByName,
        proposedByRole: proposedTasks.proposedByRole,
        platform: proposedTasks.platform,
        platformLabel: proposedTasks.platformLabel,
        toolName: proposedTasks.toolName,
        toolDisplayName: proposedTasks.toolDisplayName,
        toolArgs: proposedTasks.toolArgs,
        displayDiff: proposedTasks.displayDiff,
        reasoning: proposedTasks.reasoning,
        snapshotId: proposedTasks.snapshotId,
        comments: proposedTasks.comments,
        status: proposedTasks.status,
        assignedTo: proposedTasks.assignedTo,
        assignedToName: proposedTasks.assignedToName,
        resolvedBy: proposedTasks.resolvedBy,
        resolvedByName: proposedTasks.resolvedByName,
        resolvedAt: proposedTasks.resolvedAt,
        // Retry bookkeeping — surfaced so the dashboard can show progress
        // and so the frontend knows when the next auto-retry is due.
        attemptCount: proposedTasks.attemptCount,
        nextRetryAt: proposedTasks.nextRetryAt,
        lastRetryClass: proposedTasks.lastRetryClass,
        createdAt: proposedTasks.createdAt,
      })
      .from(proposedTasks)
      .where(where)
      .orderBy(desc(proposedTasks.createdAt))
      .limit(200);

    // Fetch the most recent audit log per task so the UI can render
    // retry-class badges and hints next to failed rows.
    let latestByTask = new Map<number, {
      retry: RetryGuidance | null;
      httpStatus: number | null;
      result: { success: boolean; message: string } | null;
      createdAt: string | null;
    }>();
    if (tasks.length > 0) {
      const taskIds = tasks.map((t) => t.id);
      const logs = await db
        .select({
          id:        auditLogs.id,
          toolArgs:  auditLogs.toolArgs,
          result:    auditLogs.result,
          status:    auditLogs.status,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .where(and(
          eq(auditLogs.toolName, SHOPTIMIZER_WRITEBACK_TOOL),
          eq(auditLogs.organizationId, ctx.orgId),
          sql`(${auditLogs.toolArgs}->>'proposedTaskId')::int = ANY(${taskIds})`,
        ))
        .orderBy(desc(auditLogs.createdAt));

      for (const log of logs) {
        const args = (log.toolArgs ?? {}) as Record<string, unknown>;
        const taskId = Number(args.proposedTaskId);
        if (!Number.isFinite(taskId) || latestByTask.has(taskId)) continue;
        const retry = (args.retry as RetryGuidance | null | undefined) ?? null;
        const httpStatus = typeof args.httpStatus === "number" ? args.httpStatus : null;
        latestByTask.set(taskId, {
          retry,
          httpStatus,
          result: (log.result as { success: boolean; message: string } | null) ?? null,
          createdAt: log.createdAt ? new Date(log.createdAt as unknown as string).toISOString() : null,
        });
      }
    }

    const enriched = tasks.map((t) => {
      const latest = latestByTask.get(t.id);
      const args = (t.toolArgs ?? {}) as Record<string, unknown>;
      return {
        ...t,
        offerId: (args.offerId as string | undefined) ?? null,
        latestAttempt: latest ?? null,
      };
    });

    res.json({ tasks: enriched, maxAttempts: WRITEBACK_MAX_ATTEMPTS });
  } catch (err) {
    logger.error({ err }, "feed-enrichment/writeback (list): error");
    res.status(500).json({ error: "Failed to list write-back tasks" });
  }
});

// ─── POST /api/feed-enrichment/writeback/retry-drain ─────────────────────────
// Manually trigger the retry scheduler (admin/manager only). The scheduler
// runs automatically on a background interval when the server is running; this
// endpoint allows ops to trigger an immediate drain without waiting.
router.post("/writeback/retry-drain", async (req, res) => {
  try {
    const rbacUser = (req as any).rbacUser ?? null;
    if (!rbacUser?.id) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    const isManager = rbacUser.role === "admin" || rbacUser.role === "manager";
    if (!isManager) {
      res.status(403).json({ error: "Only managers/admins can trigger the retry scheduler." });
      return;
    }

    const result = await runWritebackRetryScheduler();
    res.json(result);
  } catch (err) {
    logger.error({ err }, "feed-enrichment/writeback/retry-drain: error");
    res.status(500).json({ error: "Failed to run retry scheduler" });
  }
});

export default router;
