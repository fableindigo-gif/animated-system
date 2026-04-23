import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import {
  db,
  warehouseGoogleAds,
  warehouseShopifyProducts,
  warehouseCrossPlatformMapping,
  warehouseCrmLeads,
  workspaces,
  DEFAULT_TENANT_ID,
} from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { etlState } from "../../lib/etl-state";
import { logger } from "../../lib/logger";
import { getOrgId } from "../../middleware/rbac";

const router: Router = Router();

const TenantSyncStateEnum = z.enum([
  "AWAITING_OAUTH",
  "HISTORICAL_BACKFILL",
  "SYNCING",
  "OPERATIONAL_EMPTY",
  "OPERATIONAL_POPULATED",
  "STALE_DATA",
]);
export type TenantSyncState = z.infer<typeof TenantSyncStateEnum>;

const GoalTypeEnum = z.enum(["E-COMMERCE", "LEADGEN", "HYBRID"]);
export type GoalType = z.infer<typeof GoalTypeEnum>;

const MarginLeakRowSchema = z.object({
  sku: z.string(),
  productTitle: z.string(),
  productId: z.string(),
  spendUsd: z.number(),
  attributedRevenueUsd: z.number(),
  attributedProfitUsd: z.number(),
  marginPct: z.number(),
  severity: z.enum(["critical", "warning", "info"]),
});

const CrmSyncIssueSchema = z.object({
  leadId: z.string(),
  email: z.string(),
  reason: z.string(),
  pipelineStage: z.string(),
  dealAmount: z.number(),
});

export const UnifiedDashboardStateSchema = z.object({
  syncState: TenantSyncStateEnum,
  goalType: GoalTypeEnum,
  lastSyncedAt: z.number().nullable(),
  workspaceId: z.number().nullable(),
  workspaceName: z.string().nullable(),
  ecommerce: z
    .object({
      spendUsd: z.number(),
      revenueUsd: z.number(),
      cogsUsd: z.number(),
      trueProfitUsd: z.number(),
      poas: z.number(),
      conversions: z.number(),
      marginLeaks: z.array(MarginLeakRowSchema),
    })
    .nullable(),
  leadgen: z
    .object({
      spendUsd: z.number(),
      leadCount: z.number(),
      qualifiedLeadCount: z.number(),
      pipelineValueUsd: z.number(),
      closedWonValueUsd: z.number(),
      cplUsd: z.number(),
      crmSyncIssues: z.array(CrmSyncIssueSchema),
    })
    .nullable(),
  meta: z.object({
    computedAtMs: z.number(),
    etlPhase: z.string(),
    etlPct: z.number(),
    isStale: z.boolean(),
  }),
});
export type UnifiedDashboardState = z.infer<typeof UnifiedDashboardStateSchema>;

const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000;

function normalizeGoal(raw: string | null | undefined): GoalType {
  const v = (raw ?? "").toLowerCase();
  if (v === "leadgen") return "LEADGEN";
  if (v === "hybrid") return "HYBRID";
  return "E-COMMERCE";
}

async function computeEcommerceBlock(tenantId: string) {
  // Aggregate spend, clicks, conversions, and conversion_value directly from
  // campaign-level warehouse rows. We use conversion_value (the actual Google
  // Ads reported revenue) rather than the old proxy of `conversions × sp.price`
  // which was always $0 whenever the cross-platform SKU mapping was empty
  // (the common case for Performance Max campaigns).
  const adsAggRows = await db
    .select({
      spend:           sql<number>`COALESCE(SUM(${warehouseGoogleAds.costUsd}), 0)`,
      conversions:     sql<number>`COALESCE(SUM(${warehouseGoogleAds.conversions}), 0)`,
      conversionValue: sql<number>`COALESCE(SUM(${warehouseGoogleAds.conversionValue}), 0)`,
    })
    .from(warehouseGoogleAds)
    .where(eq(warehouseGoogleAds.tenantId, tenantId));
  const adsAgg = adsAggRows[0] ?? { spend: 0, conversions: 0, conversionValue: 0 };

  // SKU-level attributed rows — used for margin-leak triage on SKUs that ARE
  // matched via the cross-platform mapping (Search/Shopping campaigns).
  // PMax campaigns won't appear here (no final_url → no mapping), but their
  // revenue is captured in adsAgg.conversionValue above.
  const attributedRows = await db.execute<{
    sku: string;
    product_id: string;
    product_title: string;
    spend: number;
    cogs_total: number;
    conversions: number;
  }>(sql`
    SELECT
      COALESCE(sp.sku, '')                                    AS sku,
      sp.product_id                                           AS product_id,
      COALESCE(sp.title, 'Untitled')                          AS product_title,
      COALESCE(SUM(ga.cost_usd), 0)                           AS spend,
      COALESCE(SUM(ga.conversions * sp.cogs), 0)              AS cogs_total,
      COALESCE(SUM(ga.conversions), 0)                        AS conversions
    FROM ${warehouseCrossPlatformMapping} m
    JOIN ${warehouseGoogleAds}            ga ON ga.id          = m.google_ad_id
    JOIN ${warehouseShopifyProducts}      sp ON sp.product_id  = m.shopify_product_id
    WHERE m.tenant_id = ${tenantId}
    GROUP BY sp.sku, sp.product_id, sp.title
    HAVING COALESCE(SUM(ga.cost_usd), 0) > 0
  `);

  const rows = (attributedRows.rows ?? []) as Array<{
    sku: string;
    product_id: string;
    product_title: string;
    spend: number;
    cogs_total: number;
    conversions: number;
  }>;

  // Revenue = Google Ads reported conversion value (authoritative).
  // COGS = sum from mapped SKUs (partial — PMax SKUs not mapped).
  const revenueUsd = Number(adsAgg.conversionValue) || 0;
  const cogsUsd = rows.reduce((s, r) => s + (Number(r.cogs_total) || 0), 0);
  const spendUsd = Number(adsAgg.spend) || 0;
  const conversions = Number(adsAgg.conversions) || 0;
  const trueProfitUsd = revenueUsd - spendUsd - cogsUsd;
  const poas = spendUsd > 0 ? trueProfitUsd / spendUsd : 0;

  // Margin-leak triage: SKUs where spend > attributed COGS recovery.
  // Revenue per SKU is estimated as (conversions × product.price) for the
  // mapped fraction only — this is used for triage severity, not the top-level KPI.
  const marginLeaks = rows
    .map((r) => {
      const sp = Number(r.spend) || 0;
      const cg = Number(r.cogs_total) || 0;
      // Revenue estimate for this specific SKU: use cogs as floor signal
      const rev = cg > 0 ? cg * 2.5 : 0; // rough 2.5× COGS estimate when no direct revenue split
      const profit = rev - sp - cg;
      const marginPct = rev > 0 ? (profit / rev) * 100 : -100;
      let severity: "critical" | "warning" | "info" = "info";
      if (profit < 0)          severity = "critical";
      else if (marginPct < 15) severity = "warning";
      return {
        sku: r.sku || r.product_id,
        productTitle: r.product_title || "Untitled",
        productId: r.product_id,
        spendUsd: sp,
        attributedRevenueUsd: rev,
        attributedProfitUsd: profit,
        marginPct,
        severity,
      };
    })
    .filter((r) => r.severity !== "info")
    .sort((a, b) => a.attributedProfitUsd - b.attributedProfitUsd)
    .slice(0, 8);

  return { spendUsd, revenueUsd, cogsUsd, trueProfitUsd, poas, conversions, marginLeaks };
}

async function computeLeadgenBlock(tenantId: string) {
  const adsAggRows = await db
    .select({ spend: sql<number>`COALESCE(SUM(${warehouseGoogleAds.costUsd}), 0)` })
    .from(warehouseGoogleAds)
    .where(eq(warehouseGoogleAds.tenantId, tenantId));
  const spendUsd = Number(adsAggRows[0]?.spend) || 0;

  const crmAggRows = await db.execute<{
    lead_count: number;
    qualified_count: number;
    pipeline_value: number;
    closed_won_value: number;
  }>(sql`
    SELECT
      COUNT(*)                                                                  AS lead_count,
      COUNT(*) FILTER (WHERE pipeline_stage NOT IN ('discovery','closed_lost')) AS qualified_count,
      COALESCE(SUM(deal_amount) FILTER (WHERE pipeline_stage <> 'closed_lost'), 0) AS pipeline_value,
      COALESCE(SUM(deal_amount) FILTER (WHERE pipeline_stage  = 'closed_won'), 0)  AS closed_won_value
    -- sql-ambiguous-skip: single-table SELECT, no JOIN, no ambiguity.
    FROM ${warehouseCrmLeads}
    WHERE tenant_id = ${tenantId}
  `);
  const a = crmAggRows.rows?.[0] ?? { lead_count: 0, qualified_count: 0, pipeline_value: 0, closed_won_value: 0 };
  const leadCount = Number(a.lead_count) || 0;
  const qualifiedLeadCount = Number(a.qualified_count) || 0;
  const pipelineValueUsd = Number(a.pipeline_value) || 0;
  const closedWonValueUsd = Number(a.closed_won_value) || 0;
  const cplUsd = leadCount > 0 ? spendUsd / leadCount : 0;

  const issuesRows = await db.execute<{ id: string; email: string; pipeline_stage: string; deal_amount: number; reason: string }>(sql`
    SELECT
      id,
      COALESCE(email, '')                                                                                AS email,
      COALESCE(pipeline_stage, 'unknown')                                                                AS pipeline_stage,
      COALESCE(deal_amount, 0)                                                                           AS deal_amount,
      CASE
        WHEN gclid <> '' AND utm_source = '' THEN 'GCLID present but no UTM source'
        WHEN gclid =  '' AND utm_source = '' THEN 'Missing source attribution'
        WHEN converted_at IS NULL  AND lifecycle_stage = 'customer'   THEN 'Marked customer but no conversion timestamp'
        WHEN deal_amount = 0       AND pipeline_stage = 'closed_won'  THEN 'Closed-won but $0 deal amount'
        ELSE NULL
      END AS reason
    -- sql-ambiguous-skip: single-table SELECT on warehouseCrmLeads.
    FROM ${warehouseCrmLeads}
    WHERE tenant_id = ${tenantId}
    ORDER BY synced_at DESC
    LIMIT 50
  `);
  const crmSyncIssues = (issuesRows.rows ?? [])
    .filter((r): r is { id: string; email: string; pipeline_stage: string; deal_amount: number; reason: string } =>
      typeof r.reason === "string" && r.reason.length > 0)
    .slice(0, 8)
    .map((r) => ({
      leadId: r.id,
      email: r.email,
      reason: r.reason,
      pipelineStage: r.pipeline_stage,
      dealAmount: Number(r.deal_amount) || 0,
    }));

  return { spendUsd, leadCount, qualifiedLeadCount, pipelineValueUsd, closedWonValueUsd, cplUsd, crmSyncIssues };
}

async function deriveSyncState(tenantId: string): Promise<{ state: TenantSyncState; lastSyncedAtMs: number | null }> {
  // sql-ambiguous-skip: each leg of the UNION ALL is a single-table SELECT
  // and the outer MAX(synced_at) reads from the derived alias `t`, where
  // `synced_at` is the only column. No JOIN, no ambiguity possible.
  const lastRows = await db.execute<{ last_synced: string | null }>(sql`
    SELECT MAX(synced_at)::text AS last_synced FROM (
      SELECT MAX(synced_at) AS synced_at FROM ${warehouseGoogleAds}        WHERE tenant_id = ${tenantId}
      UNION ALL
      SELECT MAX(synced_at) AS synced_at FROM ${warehouseShopifyProducts}  WHERE tenant_id = ${tenantId}
      UNION ALL
      SELECT MAX(synced_at) AS synced_at FROM ${warehouseCrmLeads}         WHERE tenant_id = ${tenantId}
    ) t
  `);
  const rawLast = lastRows.rows?.[0]?.last_synced ?? null;
  const lastSyncedAtMs = rawLast ? new Date(rawLast).getTime() : null;

  // sql-ambiguous-skip: each `tenant_id = …` lives in its own single-table
  // scalar subquery (`SELECT COUNT(*) FROM x WHERE …`). No JOIN, no ambiguity.
  const countRows = await db.execute<{ ads: number; products: number; leads: number }>(sql`
    SELECT
      (SELECT COUNT(*) FROM ${warehouseGoogleAds}        WHERE tenant_id = ${tenantId}) AS ads,
      (SELECT COUNT(*) FROM ${warehouseShopifyProducts}  WHERE tenant_id = ${tenantId}) AS products,
      (SELECT COUNT(*) FROM ${warehouseCrmLeads}         WHERE tenant_id = ${tenantId}) AS leads
  `);
  const c = countRows.rows?.[0] ?? { ads: 0, products: 0, leads: 0 };
  const totalRows = Number(c.ads) + Number(c.products) + Number(c.leads);

  if (etlState.status === "running") {
    const phase = (etlState.phase || "").toLowerCase();
    if (phase.includes("backfill") || phase.includes("historical")) {
      return { state: "HISTORICAL_BACKFILL", lastSyncedAtMs };
    }
    return { state: "SYNCING", lastSyncedAtMs };
  }

  if (lastSyncedAtMs == null && totalRows === 0) {
    return { state: "AWAITING_OAUTH", lastSyncedAtMs };
  }
  if (totalRows === 0) {
    return { state: "OPERATIONAL_EMPTY", lastSyncedAtMs };
  }
  if (lastSyncedAtMs != null && Date.now() - lastSyncedAtMs > STALE_THRESHOLD_MS) {
    return { state: "STALE_DATA", lastSyncedAtMs };
  }
  return { state: "OPERATIONAL_POPULATED", lastSyncedAtMs };
}

const UnifiedRequestSchema = z.object({
  workspaceId: z.number().int().positive().optional(),
});

router.post("/unified-state", async (req: Request, res: Response) => {
  try {
    const parsed = UnifiedRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    }
    const orgId = getOrgId(req);
    const tenantId = orgId != null ? String(orgId) : DEFAULT_TENANT_ID;

    let workspaceId: number | null = parsed.data.workspaceId ?? null;
    let workspaceName: string | null = null;
    let goalType: GoalType = "E-COMMERCE";

    if (workspaceId != null) {
      // Tenant scope the workspace lookup. Pre-fix this leaked clientName +
      // primaryGoal across organisations: any authed user could pass a
      // foreign workspaceId and read its metadata (Phase 2C CVE, Apr 2026).
      // When orgId is null (legacy single-tenant), restrict to NULL-scoped
      // workspaces so a stale demo install never returns paid-tier data.
      const wsWhere = orgId != null
        ? and(eq(workspaces.id, workspaceId), eq(workspaces.organizationId, orgId))
        : and(eq(workspaces.id, workspaceId), isNull(workspaces.organizationId));
      const wsRows = await db.select().from(workspaces).where(wsWhere).limit(1);
      const ws = wsRows[0];
      if (ws) {
        workspaceName = ws.clientName ?? null;
        goalType = normalizeGoal(ws.primaryGoal);
      } else {
        // workspaceId not in caller's org — silently fall back to org default
        // rather than echoing back unowned data. Matches the 404-no-leak
        // policy used by tenant-guards.ts.
        workspaceId = null;
      }
    }

    const { state: syncState, lastSyncedAtMs } = await deriveSyncState(tenantId);

    const needsEcom    = goalType === "E-COMMERCE" || goalType === "HYBRID";
    const needsLeadgen = goalType === "LEADGEN"    || goalType === "HYBRID";

    const [ecommerce, leadgen] = await Promise.all([
      needsEcom    ? computeEcommerceBlock(tenantId) : Promise.resolve(null),
      needsLeadgen ? computeLeadgenBlock(tenantId)   : Promise.resolve(null),
    ]);

    const isStale =
      lastSyncedAtMs != null && Date.now() - lastSyncedAtMs > STALE_THRESHOLD_MS;

    const payload: UnifiedDashboardState = {
      syncState,
      goalType,
      lastSyncedAt: lastSyncedAtMs,
      workspaceId,
      workspaceName,
      ecommerce,
      leadgen,
      meta: {
        computedAtMs: Date.now(),
        etlPhase: etlState.phase || "idle",
        etlPct: etlState.pct ?? 0,
        isStale,
      },
    };

    const validated = UnifiedDashboardStateSchema.safeParse(payload);
    if (!validated.success) {
      logger.error({ issues: validated.error.issues }, "[Dashboard] payload failed self-validation");
      return res.status(500).json({ error: "Internal payload validation failed" });
    }

    return res.json(validated.data);
  } catch (err) {
    logger.error({ err }, "[Dashboard] /unified-state failed");
    return res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
