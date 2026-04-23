/**
 * FeedGen REST routes — mounted under `/api/feed-enrichment/feedgen/*`.
 *
 * Endpoints:
 *   GET  /rewrites             — list rewrites (paged, filterable by status)
 *   GET  /rewrites/coverage    — counts of pending/approved/applied/failed
 *   POST /rewrites/run         — synchronously generate rewrites for the
 *                                next batch of underperformers
 *   POST /rewrites/run-targeted — generate rewrites for specific product IDs
 *   POST /rewrites/approve     — push selected rewrites into the existing
 *                                Shoptimizer write-back queue (proposed_tasks)
 *
 * Approval reuses the existing Shoptimizer write-back path so that a single
 * approval queue + audit log captures every Merchant Center mutation,
 * regardless of which AI subsystem proposed it.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import {
  db,
  productFeedgenRewrites,
  warehouseShopifyProducts,
  proposedTasks,
  feedgenRuns,
} from "@workspace/db";
import { and, eq, desc, sql, inArray } from "drizzle-orm";
import { logger } from "../../lib/logger";

/**
 * Resolve a non-null tenant id for the request. FeedGen reads + writes are
 * always tenant-scoped — there is no "global" view — so a missing context
 * is a 400, not a silent global query.
 */
async function requireTenant(req: Request, res: Response): Promise<string | null> {
  const ctx = await resolveEnrichmentContext(req);
  if (!ctx?.orgId) {
    res.status(400).json({ error: "Missing tenant context" });
    return null;
  }
  return String(ctx.orgId);
}
import { runFeedgenScan } from "../../workers/feedgen-runner";
import {
  SHOPTIMIZER_WRITEBACK_TOOL,
  SHOPTIMIZER_WRITEBACK_PLATFORM,
} from "../../workers/shoptimizer-writeback";
import { resolveEnrichmentContext } from "../../middleware/enrichment-tier";

const router: ReturnType<typeof Router> = Router();

const ALLOWED_STATUS = new Set(["pending", "approved", "applied", "rejected", "failed"]);

/**
 * Gemini token pricing (USD per 1,000,000 tokens), used to translate the raw
 * `feedgen_runs.prompt_tokens` / `candidates_tokens` counters into estimated
 * spend for the dashboard's "AI cost vs approved feed changes" panel.
 *
 * Configurable via env so finance can update the rates without a code release
 * when Google changes Gemini pricing. Defaults track Gemini 2.5 Flash list
 * pricing as of 2025-04 ($0.30 / 1M input, $2.50 / 1M output) — that's the
 * model FeedGen actually calls (see `workers/feed-enrichment.ts`).
 *
 * The values are read on every request rather than cached at module load so a
 * deploy isn't needed to pick up a new rate — operators can update the secret
 * and the next dashboard refresh reflects the new estimate.
 */
function geminiPricingUsdPer1M(): {
  prompt: number; candidates: number;
  promptIsDefault: boolean; candidatesIsDefault: boolean;
} {
  const parseWithFlag = (
    raw: string | undefined,
    fallback: number,
  ): { value: number; isDefault: boolean } => {
    if (raw === undefined || raw === "") return { value: fallback, isDefault: true };
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0)   return { value: fallback, isDefault: true };
    return { value: n, isDefault: false };
  };
  const p = parseWithFlag(process.env.FEEDGEN_USD_PER_1M_PROMPT_TOKENS,     0.30);
  const c = parseWithFlag(process.env.FEEDGEN_USD_PER_1M_CANDIDATES_TOKENS, 2.50);
  return {
    prompt:             p.value,
    candidates:         c.value,
    promptIsDefault:    p.isDefault,
    candidatesIsDefault: c.isDefault,
  };
}

/**
 * Warn once at startup when either pricing env var is absent or malformed so
 * the operator knows the dashboard is using hardcoded defaults that may drift
 * from actual Google pricing over time.
 */
(function warnIfPricingDefaultsInUse() {
  const pricing = geminiPricingUsdPer1M();
  const missing: string[] = [];
  if (pricing.promptIsDefault)     missing.push("FEEDGEN_USD_PER_1M_PROMPT_TOKENS");
  if (pricing.candidatesIsDefault) missing.push("FEEDGEN_USD_PER_1M_CANDIDATES_TOKENS");
  if (missing.length > 0) {
    logger.warn(
      { missingEnvVars: missing, usingDefaults: { prompt: pricing.prompt, candidates: pricing.candidates } },
      "FeedGen pricing config: %s env var(s) are unset or invalid — " +
      "dashboard spend estimates are using hardcoded Gemini 2.5 Flash defaults " +
      "($0.30/1M input, $2.50/1M output). " +
      "Set the env var(s) to suppress this warning and keep estimates accurate if Google changes pricing.",
      missing.join(", "),
    );
  }
})();

/** Convert raw token counts into estimated USD spend. */
function estimateUsd(
  promptTokens: number,
  candidatesTokens: number,
  pricing: { prompt: number; candidates: number },
): number {
  return (promptTokens * pricing.prompt + candidatesTokens * pricing.candidates) / 1_000_000;
}

// ─── GET /rewrites ───────────────────────────────────────────────────────────
router.get("/rewrites", async (req, res) => {
  try {
    const tenantId = await requireTenant(req, res);
    if (!tenantId) return;
    const page  = Math.max(1, Number(req.query.page)  || 1);
    const limit = Math.min(100, Number(req.query.limit) || 50);
    const status = String(req.query.status ?? "pending");
    const offset = (page - 1) * limit;

    const where = ALLOWED_STATUS.has(status)
      ? and(
          eq(productFeedgenRewrites.status, status),
          eq(productFeedgenRewrites.tenantId, tenantId),
        )
      : eq(productFeedgenRewrites.tenantId, tenantId);

    const rows = await db
      .select({
        id:                   productFeedgenRewrites.id,
        productId:            productFeedgenRewrites.productId,
        sku:                  productFeedgenRewrites.sku,
        title:                warehouseShopifyProducts.title,
        imageUrl:             warehouseShopifyProducts.imageUrl,
        originalTitle:        productFeedgenRewrites.originalTitle,
        originalDescription:  productFeedgenRewrites.originalDescription,
        rewrittenTitle:       productFeedgenRewrites.rewrittenTitle,
        rewrittenDescription: productFeedgenRewrites.rewrittenDescription,
        qualityScore:         productFeedgenRewrites.qualityScore,
        reasoning:            productFeedgenRewrites.reasoning,
        citedAttributes:      productFeedgenRewrites.citedAttributes,
        status:               productFeedgenRewrites.status,
        errorCode:            productFeedgenRewrites.errorCode,
        errorMessage:         productFeedgenRewrites.errorMessage,
        latencyMs:            productFeedgenRewrites.latencyMs,
        generatedAt:          productFeedgenRewrites.generatedAt,
        approvedAt:           productFeedgenRewrites.approvedAt,
        approvedTaskId:       productFeedgenRewrites.approvedTaskId,
      })
      .from(productFeedgenRewrites)
      .leftJoin(
        warehouseShopifyProducts,
        eq(warehouseShopifyProducts.id, productFeedgenRewrites.id),
      )
      .where(where)
      .orderBy(desc(productFeedgenRewrites.qualityScore), desc(productFeedgenRewrites.generatedAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(productFeedgenRewrites)
      .where(where);

    res.json({ page, limit, total: Number(total) || 0, rewrites: rows });
  } catch (err) {
    logger.error({ err }, "feedgen/rewrites: error");
    res.status(500).json({ error: "Failed to fetch rewrites" });
  }
});

// ─── GET /rewrites/coverage ──────────────────────────────────────────────────
router.get("/rewrites/coverage", async (req, res) => {
  try {
    const tenantId = await requireTenant(req, res);
    if (!tenantId) return;

    const counts = await db
      .select({
        status: productFeedgenRewrites.status,
        n:      sql<number>`count(*)::int`,
      })
      .from(productFeedgenRewrites)
      .where(eq(productFeedgenRewrites.tenantId, tenantId))
      .groupBy(productFeedgenRewrites.status);

    const [{ totalProducts }] = await db
      .select({ totalProducts: sql<number>`count(*)::int` })
      .from(warehouseShopifyProducts)
      .where(eq(warehouseShopifyProducts.tenantId, tenantId));

    const byStatus = Object.fromEntries(counts.map((c) => [c.status, Number(c.n) || 0]));
    res.json({
      totalProducts:  Number(totalProducts) || 0,
      pending:        byStatus.pending  ?? 0,
      approved:       byStatus.approved ?? 0,
      applied:        byStatus.applied  ?? 0,
      rejected:       byStatus.rejected ?? 0,
      failed:         byStatus.failed   ?? 0,
    });
  } catch (err) {
    logger.error({ err }, "feedgen/coverage: error");
    res.status(500).json({ error: "Failed to fetch coverage" });
  }
});

// ─── GET /rewrites/stats ─────────────────────────────────────────────────────
// Powers the "AI cost vs approved feed changes" chart on the Title &
// Description tab. Returns one bucket per UTC day for the last `days` days
// (default 30), so a missing day shows up as zeros instead of a gap.
//
// `approvalRate` is computed over the cohort of rewrites *generated* on that
// day, not the rewrites *approved* that day — the question we're answering is
// "of what we shipped to operators today, how much did they keep?". Failed
// generations are excluded from the denominator since there was nothing for an
// operator to approve in the first place.
router.get("/rewrites/stats", async (req, res) => {
  try {
    const tenantId = await requireTenant(req, res);
    if (!tenantId) return;
    const days = Math.max(1, Math.min(180, Number(req.query.days) || 30));

    // Cost + run volume by day, summed across every run that touched Vertex
    // for this tenant. Skipped runs are still recorded but contribute 0
    // tokens — they show up on the runs count but don't pollute the cost line.
    const costRows = await db.execute(sql`
      SELECT
        to_char(date_trunc('day', started_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
        COUNT(*)::int                                                           AS runs,
        COALESCE(SUM(generated), 0)::int                                        AS generated,
        COALESCE(SUM(failed), 0)::int                                           AS failed,
        COALESCE(SUM(prompt_tokens), 0)::bigint                                 AS prompt_tokens,
        COALESCE(SUM(candidates_tokens), 0)::bigint                             AS candidates_tokens,
        COALESCE(SUM(total_tokens), 0)::bigint                                  AS total_tokens
      FROM feedgen_runs
      -- sql-ambiguous-skip: single-table feedgen_runs query — tenant_id is unambiguous
      WHERE tenant_id = ${tenantId}
        AND started_at >= now() - (${days} || ' days')::interval
      GROUP BY 1
    `);

    // Approval rate by *generation day* of the rewrite. The Approval Queue can
    // approve a rewrite hours later, so we bucket by `generated_at` (the day
    // the rewrite was offered) and just look at the current status of each
    // row. `failed` rows never had a chance to be approved — exclude them.
    const apprRows = await db.execute(sql`
      SELECT
        to_char(date_trunc('day', generated_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
        COUNT(*) FILTER (WHERE status <> 'failed')::int                            AS offered,
        COUNT(*) FILTER (WHERE status IN ('approved', 'applied'))::int             AS approved
      FROM product_feedgen_rewrites
      -- sql-ambiguous-skip: single-table product_feedgen_rewrites query — tenant_id is unambiguous
      WHERE tenant_id = ${tenantId}
        AND generated_at >= now() - (${days} || ' days')::interval
      GROUP BY 1
    `);

    const costByDay = new Map<string, { runs: number; generated: number; failed: number; promptTokens: number; candidatesTokens: number; totalTokens: number }>();
    for (const r of (costRows as unknown as { rows: Array<{ day: string; runs: number; generated: number; failed: number; prompt_tokens: string | number; candidates_tokens: string | number; total_tokens: string | number }> }).rows ?? []) {
      costByDay.set(r.day, {
        runs:             Number(r.runs)             || 0,
        generated:        Number(r.generated)        || 0,
        failed:           Number(r.failed)           || 0,
        promptTokens:     Number(r.prompt_tokens)    || 0,
        candidatesTokens: Number(r.candidates_tokens)|| 0,
        totalTokens:      Number(r.total_tokens)     || 0,
      });
    }
    const apprByDay = new Map<string, { offered: number; approved: number }>();
    for (const r of (apprRows as unknown as { rows: Array<{ day: string; offered: number; approved: number }> }).rows ?? []) {
      apprByDay.set(r.day, {
        offered:  Number(r.offered)  || 0,
        approved: Number(r.approved) || 0,
      });
    }

    const pricing = geminiPricingUsdPer1M();

    // Backfill missing days with zeros so charts always render a continuous
    // axis (a quiet weekend should be a flat line, not a gap).
    const series: Array<{
      day: string; runs: number; generated: number; failed: number;
      offered: number; approved: number; approvalRate: number | null;
      promptTokens: number; candidatesTokens: number; totalTokens: number;
      estimatedUsd: number;
    }> = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
      const day = d.toISOString().slice(0, 10);
      const c = costByDay.get(day) ?? { runs: 0, generated: 0, failed: 0, promptTokens: 0, candidatesTokens: 0, totalTokens: 0 };
      const a = apprByDay.get(day) ?? { offered: 0, approved: 0 };
      series.push({
        day,
        runs:             c.runs,
        generated:        c.generated,
        failed:           c.failed,
        offered:          a.offered,
        approved:         a.approved,
        approvalRate:     a.offered > 0 ? a.approved / a.offered : null,
        promptTokens:     c.promptTokens,
        candidatesTokens: c.candidatesTokens,
        totalTokens:      c.totalTokens,
        estimatedUsd:     estimateUsd(c.promptTokens, c.candidatesTokens, pricing),
      });
    }

    // Headline numbers shown above the chart.
    let totalRuns = 0, totalGenerated = 0, totalApproved = 0, totalOffered = 0;
    let totalPromptTokens = 0, totalCandidatesTokens = 0, totalTokens = 0;
    for (const p of series) {
      totalRuns             += p.runs;
      totalGenerated        += p.generated;
      totalOffered          += p.offered;
      totalApproved         += p.approved;
      totalPromptTokens     += p.promptTokens;
      totalCandidatesTokens += p.candidatesTokens;
      totalTokens           += p.totalTokens;
    }
    const totalEstimatedUsd = estimateUsd(totalPromptTokens, totalCandidatesTokens, pricing);

    res.json({
      days,
      series,
      totals: {
        runs:             totalRuns,
        generated:        totalGenerated,
        offered:          totalOffered,
        approved:         totalApproved,
        approvalRate:     totalOffered > 0 ? totalApproved / totalOffered : null,
        totalTokens,
        estimatedUsd:     totalEstimatedUsd,
        usdPerApproved:   totalApproved > 0 ? totalEstimatedUsd / totalApproved : null,
      },
      pricing: {
        promptUsdPer1M:     pricing.prompt,
        candidatesUsdPer1M: pricing.candidates,
        currency:           "USD",
        usingDefaults: {
          prompt:     pricing.promptIsDefault,
          candidates: pricing.candidatesIsDefault,
        },
      },
    });
  } catch (err) {
    logger.error({ err }, "feedgen/stats: error");
    res.status(500).json({ error: "Failed to fetch FeedGen stats" });
  }
});

// ─── POST /rewrites/run ──────────────────────────────────────────────────────
const runBodySchema = z.object({
  maxProducts: z.number().int().positive().max(100).optional(),
  // "underperformer" = pick by ascending gross ROAS from `v_poas_by_sku`
  // (default — uses Shopping Insider / GAARF ad data joined per-tenant).
  // "stale"          = pick by price DESC, no ads data required (fallback).
  mode: z.enum(["underperformer", "stale"]).optional(),
});
router.post("/rewrites/run", async (req, res) => {
  const parsed = runBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  try {
    const tenantId = await requireTenant(req, res);
    if (!tenantId) return;
    const result = await runFeedgenScan({
      maxProducts: parsed.data.maxProducts,
      mode:        parsed.data.mode,
      tenantId,
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "feedgen/run: error");
    res.status(500).json({ error: "Failed to run FeedGen scan" });
  }
});

// ─── POST /rewrites/run-targeted ────────────────────────────────────────────
const targetedSchema = z.object({
  productIds: z.array(z.string().min(1)).min(1).max(100),
});
router.post("/rewrites/run-targeted", async (req, res) => {
  const parsed = targetedSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  try {
    const tenantId = await requireTenant(req, res);
    if (!tenantId) return;
    const result = await runFeedgenScan({
      productIds: parsed.data.productIds,
      tenantId,
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "feedgen/run-targeted: error");
    res.status(500).json({ error: "Failed to run targeted FeedGen scan" });
  }
});

// ─── POST /rewrites/approve ─────────────────────────────────────────────────
const approveBodySchema = z.object({
  rewriteIds: z.array(z.string().min(1)).min(1).max(100),
});
router.post("/rewrites/approve", async (req, res) => {
  const parsed = approveBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  try {
    const rbacUser = (req as any).rbacUser ?? null;
    if (!rbacUser?.id) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const wsId = rbacUser.workspaceId ?? null;
    if (!wsId) {
      res.status(400).json({ error: "Caller has no workspace; cannot approve rewrites." });
      return;
    }
    const tenantId = await requireTenant(req, res);
    if (!tenantId) return;

    // Load rewrites + verify tenancy in a single round-trip.
    const rows = await db
      .select()
      .from(productFeedgenRewrites)
      .where(
        and(
          inArray(productFeedgenRewrites.id, parsed.data.rewriteIds),
          eq(productFeedgenRewrites.tenantId, tenantId),
        ),
      );

    if (rows.length === 0) {
      res.status(404).json({ error: "No matching rewrites found" });
      return;
    }

    const created: Array<{ rewriteId: string; taskId: number; status: string }> = [];

    for (const r of rows) {
      if (r.status !== "pending") {
        // Skip already-approved/applied/rejected rows silently.
        continue;
      }

      // Idempotency: hash {rewriteId + tool} so double-clicks / parallel
      // approvals don't queue two write-backs for the same rewrite.
      const idempotencyKey = crypto.createHash("sha256")
        .update(JSON.stringify({ rewriteId: r.id, tool: SHOPTIMIZER_WRITEBACK_TOOL }))
        .digest("hex");

      const existing = await db
        .select({ id: proposedTasks.id, status: proposedTasks.status })
        .from(proposedTasks)
        .where(
          and(
            eq(proposedTasks.workspaceId, wsId),
            eq(proposedTasks.toolName, SHOPTIMIZER_WRITEBACK_TOOL),
            sql`(${proposedTasks.toolArgs}->>'idempotencyKey') = ${idempotencyKey}`,
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        // Already queued — re-link the rewrite to the existing task and skip.
        await db
          .update(productFeedgenRewrites)
          .set({ status: "approved", approvedTaskId: existing[0].id, approvedAt: new Date() })
          .where(eq(productFeedgenRewrites.id, r.id));
        created.push({ rewriteId: r.id, taskId: existing[0].id, status: existing[0].status });
        continue;
      }

      const optimized = {
        offerId:     r.id,
        title:       r.rewrittenTitle,
        description: r.rewrittenDescription,
      };
      const original = {
        offerId:     r.id,
        title:       r.originalTitle,
        description: r.originalDescription,
      };

      const displayDiff = [
        { label: "title",       from: r.originalTitle.slice(0, 120),       to: r.rewrittenTitle.slice(0, 120) },
        { label: "description", from: r.originalDescription.slice(0, 120), to: r.rewrittenDescription.slice(0, 120) },
      ];

      const [task] = await db
        .insert(proposedTasks)
        .values({
          workspaceId:     wsId,
          proposedBy:      rbacUser.id,
          proposedByName:  rbacUser.name ?? "FeedGen",
          proposedByRole:  rbacUser.role ?? "system",
          platform:        SHOPTIMIZER_WRITEBACK_PLATFORM,
          platformLabel:   "Google Merchant Center",
          toolName:        SHOPTIMIZER_WRITEBACK_TOOL,
          toolDisplayName: `Apply FeedGen rewrite to ${r.sku || r.productId || r.id}`,
          toolArgs: {
            offerId:       r.id,
            optimized,
            original,
            pluginsFired:  ["feedgen"],
            changedFields: ["title", "description"],
            source:        "feedgen",
            qualityScore:  r.qualityScore,
            idempotencyKey,
          },
          displayDiff,
          reasoning: `FeedGen rewrite (score ${r.qualityScore}/100): ${r.reasoning.slice(0, 400)}`,
          status:    "pending",
        })
        .returning({ id: proposedTasks.id, status: proposedTasks.status });

      await db
        .update(productFeedgenRewrites)
        .set({ status: "approved", approvedTaskId: task.id, approvedAt: new Date() })
        .where(eq(productFeedgenRewrites.id, r.id));

      created.push({ rewriteId: r.id, taskId: task.id, status: task.status });
    }

    res.status(201).json({
      approved: created.length,
      tasks:    created,
    });
  } catch (err) {
    logger.error({ err }, "feedgen/approve: error");
    res.status(500).json({ error: "Failed to approve rewrites" });
  }
});

// ─── POST /rewrites/:id/reject ──────────────────────────────────────────────
router.post("/rewrites/:id/reject", async (req, res) => {
  try {
    const tenantId = await requireTenant(req, res);
    if (!tenantId) return;
    const result = await db
      .update(productFeedgenRewrites)
      .set({ status: "rejected" })
      .where(
        and(
          eq(productFeedgenRewrites.id, req.params.id),
          eq(productFeedgenRewrites.status, "pending"),
          eq(productFeedgenRewrites.tenantId, tenantId),
        ),
      )
      .returning({ id: productFeedgenRewrites.id });
    if (result.length === 0) {
      res.status(404).json({ error: "Rewrite not found or not in pending state" });
      return;
    }
    res.json({ rejected: true, id: result[0].id });
  } catch (err) {
    logger.error({ err }, "feedgen/reject: error");
    res.status(500).json({ error: "Failed to reject rewrite" });
  }
});

export default router;
