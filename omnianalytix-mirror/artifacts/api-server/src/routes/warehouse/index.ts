import { Router } from "express";
import { sql, eq, and } from "drizzle-orm";
import {
  db,
  organizations,
  warehouseShopifyProducts,
  warehouseGoogleAds,
  warehouseCrossPlatformMapping,
} from "@workspace/db";
import { DEFAULT_TENANT_ID } from "@workspace/db/schema";
import { etlState } from "../../lib/etl-state";
import { getOrgId } from "../../middleware/rbac";
import { logger } from "../../lib/logger";
import { handleRouteError } from "../../lib/route-error-handler";
import { parseFilterParams, parseAdvancedFilters, type AdvancedFilters } from "../../lib/filter-params";
import { inArray, ilike, or } from "drizzle-orm";
import { getFreshGoogleCredentials } from "../../lib/google-token-refresh";
import { googleAds_listCampaigns } from "../../lib/platform-executors";

// ─── Advanced-filter ad-row clause builder ──────────────────────────────────
// Translates the dimension / search components of an AdvancedFilters object
// into a Drizzle SQL fragment suitable for AND-combining with other clauses
// in any query against `warehouse_google_ads`. Numeric thresholds are NOT
// included here — they apply per-campaign via HAVING in `/channels` only,
// since POAS/ROAS thresholds aren't well defined at the per-row aggregation
// level used by the KPI / margin-leak rollups.
function buildAdsAdvancedClause(adv: AdvancedFilters) {
  const clauses: ReturnType<typeof and>[] = [];
  // platform: if user picked platforms but excluded google_ads, the entire
  // google-ads-derived KPI block should collapse to zero. We signal that
  // via a guaranteed-false predicate.
  const platforms = adv.dimensions.platform;
  if (platforms && platforms.length > 0 && !platforms.includes("google_ads")) {
    return sql`FALSE`;
  }
  const camps = adv.dimensions.campaign;
  if (camps && camps.length > 0) {
    clauses.push(
      or(
        inArray(warehouseGoogleAds.campaignId, camps),
        ...camps.map((c) => ilike(warehouseGoogleAds.campaignName, `%${c}%`)),
      ),
    );
  }
  const statuses = adv.dimensions.status;
  if (statuses && statuses.length > 0) {
    clauses.push(inArray(warehouseGoogleAds.status, statuses));
  }
  if (adv.q) {
    clauses.push(
      or(
        ilike(warehouseGoogleAds.campaignName, `%${adv.q}%`),
        ilike(warehouseGoogleAds.campaignId, `%${adv.q}%`),
      ),
    );
  }
  if (clauses.length === 0) return undefined;
  return and(...clauses);
}

const router = Router();

// SECURITY: Tenant resolution is strict — never fall back across tenants.
// If the caller has an orgId, that IS their tenant_id (returned even if their
// warehouse is empty, so queries return zero rows rather than leaking another
// tenant's data). Only unauthenticated/legacy callers (orgId == null) get
// DEFAULT_TENANT_ID. The previous "fall back to default when org has no data"
// behavior would expose any default-tenant rows to every authenticated org.
export async function resolveEffectiveTenant(orgId: number | null | undefined): Promise<string> {
  if (orgId != null) return String(orgId);
  return DEFAULT_TENANT_ID;
}

export function getWarehouseTenantFilter(tenantId: string) {
  return eq(warehouseGoogleAds.tenantId, tenantId);
}

function getShopifyTenantFilter(tenantId: string) {
  return eq(warehouseShopifyProducts.tenantId, tenantId);
}

function getCrossPlatformTenantFilter(tenantId: string) {
  return eq(warehouseCrossPlatformMapping.tenantId, tenantId);
}

function rawAdsTenantClause(tenantId: string) {
  return sql` AND ${warehouseGoogleAds.tenantId} = ${tenantId}`;
}

async function hasRealAdsData(orgId?: number | null): Promise<boolean> {
  const tenantId = await resolveEffectiveTenant(orgId);
  const filter = getWarehouseTenantFilter(tenantId);
  const row = await db
    .select({ cnt: sql<number>`COUNT(*)::int` })
    .from(warehouseGoogleAds)
    .where(filter);
  return (Number(row[0]?.cnt) || 0) > 0;
}

function parseDays(req: { query: Record<string, unknown> }): number {
  const raw = Math.floor(Number(req.query.days));
  return Number.isFinite(raw) && raw > 0 && raw <= 365 ? raw : 30;
}

// Parses explicit from/to ISO date strings (e.g. ?from=2026-01-01&to=2026-04-13).
// REMOVED Apr 2026 (Phase 3 SQL safety): the prior `parseDateFilter()` returned
// an UNQUALIFIED `synced_at >= ...` SQL fragment. When dropped into any JOIN
// query that touched 2+ tables with a `synced_at` column (warehouse_google_ads,
// warehouse_shopify_products), Postgres would throw `column reference
// "synced_at" is ambiguous` (incident: commit a8804b0). Use `parseAdsDateFilter`
// with an explicit Drizzle column reference everywhere — single-table queries
// included — so a future JOIN refactor cannot reintroduce the ambiguity.

// Returns a SQL fragment suitable for a WHERE clause on synced_at, qualified
// against the table column passed in. The `col` argument MUST be a Drizzle
// column reference (e.g. `warehouseGoogleAds.syncedAt`), never a string.
function parseAdsDateFilter(req: { query: Record<string, unknown> }, col: import("drizzle-orm").AnyColumn | import("drizzle-orm").SQL<unknown>) {
  const fromRaw = req.query.from as string | undefined;
  const toRaw   = req.query.to   as string | undefined;
  if (fromRaw && toRaw) {
    const from = new Date(fromRaw);
    const to   = new Date(toRaw);
    to.setHours(23, 59, 59, 999);
    if (!isNaN(from.getTime()) && !isNaN(to.getTime())) {
      return sql`${col} >= ${from.toISOString()}::timestamptz AND ${col} <= ${to.toISOString()}::timestamptz`;
    }
  }
  const days = parseDays(req);
  return sql`${col} >= NOW() - make_interval(days => ${days})`;
}

// Returns a SQL fragment for the prior period of equal length, immediately
// before the current window. Used for revenue trend % calculation.
// e.g. window 7-14 Apr → prior period 31 Mar - 6 Apr.
function parsePriorPeriodAdsFilter(req: { query: Record<string, unknown> }, col: import("drizzle-orm").AnyColumn | import("drizzle-orm").SQL<unknown>) {
  const fromRaw = req.query.from as string | undefined;
  const toRaw   = req.query.to   as string | undefined;
  if (fromRaw && toRaw) {
    const from = new Date(fromRaw);
    const to   = new Date(toRaw);
    to.setHours(23, 59, 59, 999);
    if (!isNaN(from.getTime()) && !isNaN(to.getTime())) {
      const windowMs = to.getTime() - from.getTime() + 1;
      const priorTo  = new Date(from.getTime() - 1);
      const priorFrom = new Date(from.getTime() - windowMs);
      return sql`${col} >= ${priorFrom.toISOString()}::timestamptz AND ${col} <= ${priorTo.toISOString()}::timestamptz`;
    }
  }
  const days = parseDays(req);
  return sql`${col} >= NOW() - make_interval(days => ${days * 2}) AND ${col} < NOW() - make_interval(days => ${days})`;
}

import { parsePagination, paginatedResponse } from "../../lib/pagination";

// ── Payment processing fee constants ────────────────────────────────────────
// Stripe standard / Shopify Payments: 2.9 % of revenue + $0.30 per transaction.
// Used in the true-profit POAS calculation for the dashboard KPI card.
// This mirrors the same constant in the Agency Engine's profit_layer.py.
const SHOPIFY_STRIPE_FEE_RATE = 0.029;

// ── GET /filter-hints ─────────────────────────────────────────────────────────
// Returns up to 100 distinct values per requested dimension so the FilterBar
// can show real campaign / SKU / status options rather than a blank text input.
// ?dims=campaign,sku,status   (comma-separated subset of supported dims)
// Supported dims: campaign | sku | status
// Response: { campaign?: string[], sku?: string[], status?: string[] }
router.get("/filter-hints", async (req, res) => {
  try {
    const orgId    = getOrgId(req);
    const tenantId = await resolveEffectiveTenant(orgId);
    const dimParam = (req.query.dims as string | undefined) ?? "";
    const requested = new Set(dimParam.split(",").map((d) => d.trim()).filter(Boolean));
    const result: Record<string, string[]> = {};

    if (requested.has("campaign")) {
      const rows = await db
        .selectDistinct({ v: warehouseGoogleAds.campaignName })
        .from(warehouseGoogleAds)
        .where(eq(warehouseGoogleAds.tenantId, tenantId))
        .orderBy(warehouseGoogleAds.campaignName)
        .limit(100);
      result.campaign = rows.map((r) => r.v ?? "").filter(Boolean);
    }

    if (requested.has("sku")) {
      const rows = await db
        .selectDistinct({ v: warehouseShopifyProducts.sku })
        .from(warehouseShopifyProducts)
        .where(eq(warehouseShopifyProducts.tenantId, tenantId))
        .orderBy(warehouseShopifyProducts.sku)
        .limit(100);
      result.sku = rows.map((r) => r.v ?? "").filter(Boolean);
    }

    if (requested.has("status")) {
      const rows = await db
        .selectDistinct({ v: warehouseGoogleAds.status })
        .from(warehouseGoogleAds)
        .where(eq(warehouseGoogleAds.tenantId, tenantId))
        .limit(20);
      result.status = rows.map((r) => r.v ?? "").filter(Boolean);
    }

    res.json(result);
  } catch (err) {
    handleRouteError(err, req, res, "/warehouse/filter-hints");
  }
});

router.get("/kpis", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const tenantId = await resolveEffectiveTenant(orgId);
    // Date filter is qualified against a specific table column —
    // see comment above `parseAdsDateFilter` for rationale.
    const adsDateFilter = parseAdsDateFilter(req, warehouseGoogleAds.syncedAt);
    const adsTenantFilter = getWarehouseTenantFilter(tenantId);
    const shopifyTenantFilter = getShopifyTenantFilter(tenantId);
    const crossPlatformFilter = getCrossPlatformTenantFilter(tenantId);

    // ── Advanced filters: dimension multi-selects + free-text search ─────
    // KPI rollups must reflect the same slice the user has selected in the
    // FilterBar (e.g. "Meta only", "campaign X", "search:black-friday").
    // Numeric thresholds are intentionally not applied here — they are a
    // per-campaign concept evaluated in /channels via HAVING.
    const adv = parseAdvancedFilters(req);
    const advAdsClause  = buildAdsAdvancedClause(adv);
    const adsWhere      = advAdsClause
      ? and(adsDateFilter, adsTenantFilter, advAdsClause)
      : and(adsDateFilter, adsTenantFilter);
    const crossAdsClause = advAdsClause
      ? sql` AND ${advAdsClause}`
      : sql``;

    const [shopifyRow, adsRow, mapRow, crossRevenueRow, freshnessRow, adsFreshnessRow] = await Promise.all([
      // ── Shopify product catalog metrics (no date filter — inventory is atemporal) ──
      db
        .select({
          productCount:   sql<number>`COUNT(*)::int`,
          activeCount:    sql<number>`COUNT(*) FILTER (WHERE status = 'active' AND inventory_qty > 0)::int`,
          inventoryValue: sql<number>`COALESCE(SUM(price * inventory_qty), 0)`,
          totalCogs:      sql<number>`COALESCE(SUM(cogs  * inventory_qty), 0)`,
          avgPrice:       sql<number>`COALESCE(AVG(price), 0)`,
        })
        .from(warehouseShopifyProducts)
        .where(shopifyTenantFilter),

      // ── Google Ads performance metrics (date-scoped) ──────────────────────
      // conversionValue = actual Google-reported conversion value (purchase
      // revenue). This replaces the old proxy of conversions × product.price
      // which was always $0 for PMax campaigns (no SKU mapping available).
      db
        .select({
          totalSpend:           sql<number>`COALESCE(SUM(cost_usd), 0)`,
          totalConversions:     sql<number>`COALESCE(SUM(conversions), 0)`,
          totalConversionValue: sql<number>`COALESCE(SUM(conversion_value), 0)`,
          totalClicks:          sql<number>`COALESCE(SUM(clicks)::int, 0)`,
          totalImpressions:     sql<number>`COALESCE(SUM(impressions)::int, 0)`,
          campaignCount:        sql<number>`COUNT(DISTINCT campaign_id)::int`,
          adCount:              sql<number>`COUNT(*)::int`,
          accountCurrency:      sql<string>`MAX(account_currency)`,
        })
        .from(warehouseGoogleAds)
        .where(adsWhere),

      // ── Cross-platform mapping count (tenant-scoped, no date filter) ──────
      db
        .select({ mappingCount: sql<number>`COUNT(*)::int` })
        .from(warehouseCrossPlatformMapping)
        .where(crossPlatformFilter),

      // ── COGS from mapped SKUs (for margin accuracy) ───────────────────────
      // Revenue is sourced from conversion_value above (authoritative).
      // COGS is mapped where we have Shopify product cost data linked via
      // the cross-platform mapping.
      // Join uses warehouseGoogleAds.id (= campaignId for campaign-level rows).
      db
        .select({
          mappedCogs:        sql<number>`COALESCE(SUM(${warehouseGoogleAds.conversions} * ${warehouseShopifyProducts.cogs}), 0)`,
          mappedConversions: sql<number>`COALESCE(SUM(${warehouseGoogleAds.conversions}), 0)`,
        })
        .from(warehouseCrossPlatformMapping)
        .innerJoin(
          warehouseShopifyProducts,
          sql`${warehouseShopifyProducts.productId} = ${warehouseCrossPlatformMapping.shopifyProductId}
              AND ${warehouseShopifyProducts.tenantId} = ${tenantId}`,
        )
        .innerJoin(
          warehouseGoogleAds,
          sql`${warehouseGoogleAds.id} = ${warehouseCrossPlatformMapping.googleAdId}
              AND ${adsDateFilter}
              AND ${warehouseGoogleAds.tenantId} = ${tenantId}${crossAdsClause}`,
        )
        .where(crossPlatformFilter),

      // ── Inventory data freshness (latest Shopify ETL sync timestamp) ──────
      db
        .select({
          latestSync: sql<string>`MAX(${warehouseShopifyProducts.syncedAt})`,
        })
        .from(warehouseShopifyProducts)
        .where(shopifyTenantFilter),

      // ── Ads data freshness (latest Google Ads ETL sync, NO date filter) ───
      // Lets the UI distinguish "platform never connected" (latestAdsSyncAt == null)
      // from "selected window has no rows but warehouse has older data"
      // (latestAdsSyncAt != null but in-window adCount == 0). See task #69.
      db
        .select({
          latestSync: sql<string>`MAX(${warehouseGoogleAds.syncedAt})`,
          adCount: sql<number>`COUNT(*)::int`,
        })
        .from(warehouseGoogleAds)
        .where(adsTenantFilter),
    ]);

    const shopify    = shopifyRow[0];
    const ads        = adsRow[0];
    const mapping    = mapRow[0];
    const crossRev   = crossRevenueRow[0];
    const freshness  = freshnessRow[0];

    const totalSpend          = Number(ads.totalSpend)             || 0;
    const totalConversions    = Number(ads.totalConversions)       || 0;
    const totalConversionValue= Number(ads.totalConversionValue)   || 0;
    const accountCurrency     = ads.accountCurrency ?? "USD";
    const avgPrice            = Number(shopify.avgPrice)           || 0;
    const inventoryValue      = Number(shopify.inventoryValue)     || 0;

    // ── Revenue: Google Ads conversion_value is the authoritative source ──────
    // The old approach (conversions × product.price via cross-platform mapping)
    // was $0 whenever SKU mapping was incomplete — which is always the case for
    // Performance Max campaigns.
    // Source hierarchy:
    //   1. conversion_value from Google Ads API (actual purchase value tracked)
    //   2. conversions × catalog avg price (fallback when conversion tracking off)
    const hasConversionValue = totalConversionValue > 0;
    const estimatedRevenue   = hasConversionValue
      ? totalConversionValue
      : totalConversions * avgPrice;
    const revenueMethod = hasConversionValue
      ? "google_ads_conversion_value"   // Direct from Google Ads conversion tracking
      : "avg_price_estimate";           // totalConversions × AVG(catalog price)

    // COGS: sourced from SKU-mapped products only (partial for PMax campaigns)
    const hasMappedCogs = (Number(crossRev?.mappedConversions) || 0) > 0;
    const totalCogs     = hasMappedCogs
      ? Number(crossRev.mappedCogs)
      : Number(shopify.totalCogs) || 0;

    // ── True Profit & POAS ────────────────────────────────────────────────────
    // TrueProfit = Revenue − AdSpend − COGS − ProcessingFees
    // POAS = TrueProfit / AdSpend  (profit on ad spend)
    // ROAS = Revenue   / AdSpend  (gross return on ad spend)
    const processingFees = estimatedRevenue * SHOPIFY_STRIPE_FEE_RATE;
    const trueProfit     = estimatedRevenue - totalSpend - totalCogs - processingFees;
    const poas = totalSpend > 0 ? trueProfit / totalSpend : 0;
    const roas = totalSpend > 0 ? estimatedRevenue / totalSpend : 0;

    // ── Inventory data freshness ─────────────────────────────────────────────
    const latestSyncRaw       = freshness?.latestSync ? new Date(freshness.latestSync) : null;
    const inventoryFreshnessMs = latestSyncRaw ? Date.now() - latestSyncRaw.getTime() : null;
    const inventoryFreshnessHours = inventoryFreshnessMs != null
      ? parseFloat((inventoryFreshnessMs / 3_600_000).toFixed(1))
      : null;
    const inventoryDataStale  = inventoryFreshnessHours != null && inventoryFreshnessHours > 4;

    const hasData = (shopify.productCount ?? 0) > 0 || (ads.adCount ?? 0) > 0;

    // ── Window-vs-warehouse disambiguation (task #69) ────────────────────────
    // hasDataInWindow: true if the date-scoped queries returned rows for this window.
    // hasDataOutsideWindow: true if the warehouse has ads rows for this tenant
    //   that fall outside the requested window (i.e. the user picked too narrow
    //   a window relative to the latest sync).
    // latestAdsSyncAt: the most recent Google Ads `synced_at` for this tenant,
    //   irrespective of the date filter. Lets the UI render "Latest data: <date>".
    const adsLatestSyncRaw = adsFreshnessRow[0]?.latestSync ? new Date(adsFreshnessRow[0].latestSync) : null;
    const totalAdsRowCount = Number(adsFreshnessRow[0]?.adCount) || 0;
    const adsInWindow      = (ads.adCount ?? 0) > 0;
    const productsExist    = (shopify.productCount ?? 0) > 0;
    const hasDataInWindow  = adsInWindow || productsExist;
    const hasDataOutsideWindow = !adsInWindow && totalAdsRowCount > 0;

    logger.info(
      {
        orgId,
        resolvedTenant:        tenantId,
        shopifyProducts:       shopify.productCount,
        adsAdCount:            ads.adCount,
        hasData,
        revenueMethod,
        accountCurrency,
        estimatedRevenue:      estimatedRevenue.toFixed(2),
        totalConversionValue:  totalConversionValue.toFixed(2),
        trueProfit:            trueProfit.toFixed(2),
        poas:                  poas.toFixed(4),
        inventoryFreshnessHours,
        inventoryDataStale,
      },
      "Warehouse KPI query result",
    );

    res.json({
      hasData,
      hasDataInWindow,
      hasDataOutsideWindow,
      latestAdsSyncAt:        adsLatestSyncRaw?.toISOString() ?? null,
      totalSpend,
      estimatedRevenue:        parseFloat(estimatedRevenue.toFixed(2)),
      totalConversionValue:    parseFloat(totalConversionValue.toFixed(2)),
      trueProfit:              parseFloat(trueProfit.toFixed(2)),
      processingFees:          parseFloat(processingFees.toFixed(2)),
      inventoryValue,
      activeProducts:          shopify.activeCount        ?? 0,
      totalProducts:           shopify.productCount       ?? 0,
      totalConversions,
      totalClicks:             ads.totalClicks            ?? 0,
      campaignCount:           ads.campaignCount          ?? 0,
      mappingCount:            mapping.mappingCount       ?? 0,
      accountCurrency,
      poas:                    parseFloat(poas.toFixed(2)),
      roas:                    parseFloat(roas.toFixed(2)),
      // Revenue methodology metadata — lets the frontend surface a note
      // when the less-accurate fallback method is in use
      revenueMethod,
      // Inventory freshness metadata
      inventoryLastSyncAt:     latestSyncRaw?.toISOString()      ?? null,
      inventoryFreshnessHours: inventoryFreshnessHours           ?? null,
      inventoryDataStale,
      etlStatus:               etlState.status,
      etlPhase:                etlState.phase,
      etlPct:                  etlState.pct,
      etlRowsExtracted:        etlState.rowsExtracted,
      lastSyncedAt:            etlState.completedAt,
    });
  } catch (err) {
    handleRouteError(err, req, res, "GET /api/warehouse/kpis", {
      error: "Failed to compute warehouse KPIs",
      detail: "An unexpected error occurred",
    });
  }
});

// ─── GET /api/warehouse/channels ─────────────────────────────────────────────
// Returns live campaign-level performance data from Google Ads warehouse.
// Supports ?from=YYYY-MM-DD&to=YYYY-MM-DD (preferred) or legacy ?days=N.
// Returns ALL campaigns in the warehouse (regardless of spend in period),
// with metrics aggregated inside the requested date window.
router.get("/channels", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const tenantId = await resolveEffectiveTenant(orgId);
    const { page, pageSize, offset } = parsePagination(req.query as Record<string, unknown>);
    const adsTenantFilter = getWarehouseTenantFilter(tenantId);

    // Build a date filter expression for the synced_at column.
    const dateFilter = parseAdsDateFilter(req, warehouseGoogleAds.syncedAt);
    // Prior-period filter for revenue trend % computation (same window length, shifted back).
    const priorDateFilter = parsePriorPeriodAdsFilter(req, warehouseGoogleAds.syncedAt);

    // Optional dimension filters + free-text search + numeric metric thresholds
    // (filter.campaign=…, filter.status=…, filter.q=…, filter.minSpend=…).
    // All values are validated/coerced by parseAdvancedFilters — never
    // interpolated raw — and metric thresholds are applied via HAVING below.
    const adv = parseAdvancedFilters(req);
    const advClause = buildAdsAdvancedClause(adv);

    // allTenantFilter: used for campaign listing — NO date filter so zero-spend
    // campaigns still appear in the grid (date scoping is done via CASE WHEN inside aggregations).
    const allTenantFilter = advClause
      ? and(adsTenantFilter, advClause)
      : adsTenantFilter;

    // ── HAVING clause for per-campaign metric thresholds ────────────────────
    // ROAS  = sum(revenue) / sum(spend);  POAS not computable here (needs COGS).
    // Conv  = sum(conversions);           Spend = sum(cost_usd) within window.
    // We compare the windowed (CASE WHEN dateFilter THEN … ELSE 0 END) sums.
    const t = adv.thresholds;
    const havingClauses: ReturnType<typeof and>[] = [];
    const winSpend       = sql`COALESCE(SUM(CASE WHEN ${dateFilter} THEN ${warehouseGoogleAds.costUsd}        ELSE 0 END), 0)`;
    const winConversions = sql`COALESCE(SUM(CASE WHEN ${dateFilter} THEN ${warehouseGoogleAds.conversions}    ELSE 0 END), 0)`;
    const winRevenue     = sql`COALESCE(SUM(CASE WHEN ${dateFilter} THEN ${warehouseGoogleAds.conversionValue} ELSE 0 END), 0)`;
    if (t.minSpend != null) havingClauses.push(sql`${winSpend}       >= ${t.minSpend}`);
    if (t.maxSpend != null) havingClauses.push(sql`${winSpend}       <= ${t.maxSpend}`);
    if (t.minConv  != null) havingClauses.push(sql`${winConversions} >= ${t.minConv}`);
    if (t.maxConv  != null) havingClauses.push(sql`${winConversions} <= ${t.maxConv}`);
    // ROAS thresholds: only meaningful when there's spend; treat as "spend > 0
    // AND revenue/spend in [min,max]". We push the spend>0 guard implicitly
    // by using `revenue >= min*spend` when spend>0.
    if (t.minRoas != null) havingClauses.push(sql`${winSpend} > 0 AND ${winRevenue} >= ${t.minRoas} * ${winSpend}`);
    if (t.maxRoas != null) havingClauses.push(sql`(${winSpend} = 0 OR ${winRevenue} <= ${t.maxRoas} * ${winSpend})`);
    const havingCombined = havingClauses.length > 0 ? and(...havingClauses) : undefined;

    // ── Window-vs-warehouse disambiguation (task #114, mirrors task #69) ────
    // We need to tell the UI whether "0 campaigns" means "warehouse empty"
    // (no platform connected / first sync still pending) vs "narrow window
    // hides older rows". We probe the ads table without the date filter for
    // this tenant + the latest synced_at so the WindowEmptyBanner can render.
    const adsFreshnessRowPromise = db
      .select({
        latestSync: sql<string>`MAX(${warehouseGoogleAds.syncedAt})`,
        adCount: sql<number>`COUNT(*)::int`,
      })
      .from(warehouseGoogleAds)
      .where(adsTenantFilter);

    // Daily revenue trend query — runs in parallel with the main campaign aggregation.
    // Returns one row per (campaign_id, day) for the current date window so the
    // frontend can render a per-row sparkline without a separate round-trip.
    const dailyTrendPromise = db
      .select({
        campaignId: warehouseGoogleAds.campaignId,
        day: sql<string>`date_trunc('day', ${warehouseGoogleAds.syncedAt})::date`,
        revenue: sql<number>`COALESCE(SUM(${warehouseGoogleAds.conversionValue}), 0)`,
      })
      .from(warehouseGoogleAds)
      .where(advClause ? and(adsTenantFilter, dateFilter, advClause) : and(adsTenantFilter, dateFilter))
      .groupBy(
        warehouseGoogleAds.campaignId,
        sql`date_trunc('day', ${warehouseGoogleAds.syncedAt})`,
      )
      .orderBy(
        warehouseGoogleAds.campaignId,
        sql`date_trunc('day', ${warehouseGoogleAds.syncedAt})`,
      );

    const [campaignRows, countRow, adsFreshnessRow, dailyTrendRows] = await Promise.all([
      // Aggregate metrics per campaign using conditional SUM so that campaigns
      // with no activity in the period still appear (with 0 spend/clicks/etc.).
      db
        .select({
          campaignId:   warehouseGoogleAds.campaignId,
          campaignName: warehouseGoogleAds.campaignName,
          // Most recent known status for the campaign (priority: ENABLED > LEARNING > PAUSED > REMOVED)
          status: sql<string>`
            CASE
              WHEN BOOL_OR(${warehouseGoogleAds.status} = 'ENABLED')  THEN 'ENABLED'
              WHEN BOOL_OR(${warehouseGoogleAds.status} = 'LEARNING') THEN 'LEARNING'
              WHEN BOOL_OR(${warehouseGoogleAds.status} = 'PAUSED')   THEN 'PAUSED'
              ELSE MAX(${warehouseGoogleAds.status})
            END`,
          // Spend/conversions/etc. are scoped to the requested date window
          spend:        sql<number>`COALESCE(SUM(CASE WHEN ${dateFilter} THEN ${warehouseGoogleAds.costUsd}    ELSE 0 END), 0)`,
          conversions:  sql<number>`COALESCE(SUM(CASE WHEN ${dateFilter} THEN ${warehouseGoogleAds.conversions} ELSE 0 END), 0)`,
          // Revenue: actual conversion value reported by Google Ads
          // (sum of conversion event values — purchase revenue, etc.). This is
          // the authoritative attributed-revenue figure and powers per-campaign
          // ROAS in the grid. Previously this endpoint synthesised revenue from
          // `conversions * avgShopifyPrice`, which fabricated numbers whenever
          // the Shopify catalog was sparse. The warehouse now stores the real
          // value via the ETL (warehouse_google_ads.conversion_value), so we
          // surface it directly.
          revenue:      sql<number>`COALESCE(SUM(CASE WHEN ${dateFilter} THEN ${warehouseGoogleAds.conversionValue} ELSE 0 END), 0)`,
          revenuePrior: sql<number>`COALESCE(SUM(CASE WHEN ${priorDateFilter} THEN ${warehouseGoogleAds.conversionValue} ELSE 0 END), 0)`,
          clicks:       sql<number>`COALESCE(SUM(CASE WHEN ${dateFilter} THEN ${warehouseGoogleAds.clicks}      ELSE 0 END)::int, 0)`,
          impressions:  sql<number>`COALESCE(SUM(CASE WHEN ${dateFilter} THEN ${warehouseGoogleAds.impressions} ELSE 0 END)::int, 0)`,
          adCount:      sql<number>`COUNT(*)::int`,
          // Most recent date the campaign had non-zero spend — used to show
          // "Last active: N days ago" on paused/removed rows so users know how
          // stale the data is. NULL when the campaign has never spent.
          lastActiveDate: sql<string | null>`MAX(${warehouseGoogleAds.syncedAt}) FILTER (WHERE ${warehouseGoogleAds.costUsd} > 0)`,
        })
        .from(warehouseGoogleAds)
        .where(allTenantFilter)
        .groupBy(warehouseGoogleAds.campaignId, warehouseGoogleAds.campaignName)
        .having(havingCombined ?? sql`TRUE`)
        // Default order: spend in period desc, then name for stability
        .orderBy(
          sql`COALESCE(SUM(CASE WHEN ${dateFilter} THEN ${warehouseGoogleAds.costUsd} ELSE 0 END), 0) DESC`,
          warehouseGoogleAds.campaignName,
        )
        .limit(pageSize)
        .offset(offset),

      // Total count must respect the same HAVING — wrap in a subquery.
      havingCombined
        ? db.execute(sql`
            SELECT COUNT(*)::int AS total FROM (
              SELECT 1 FROM ${warehouseGoogleAds}
              WHERE ${allTenantFilter}
              GROUP BY ${warehouseGoogleAds.campaignId}, ${warehouseGoogleAds.campaignName}
              HAVING ${havingCombined}
            ) sub
          `).then((r) => (r as unknown as { rows?: Array<{ total: number }> }).rows ?? [])
        : db
            .select({ total: sql<number>`COUNT(DISTINCT campaign_id)::int` })
            .from(warehouseGoogleAds)
            .where(allTenantFilter),
      adsFreshnessRowPromise,
      dailyTrendPromise,
    ]);

    const totalCount = Number(countRow[0]?.total) || 0;
    // ── Window-vs-warehouse flags (task #114) ───────────────────────────────
    // hasDataInWindow: true when the date-scoped aggregation produced rows that
    //   actually had spend/clicks/etc. in the window. We approximate this with
    //   the per-campaign spend rollup since `totalCount` here counts campaigns
    //   that EXIST for the tenant, not whether they were active in-window.
    const adsLatestSyncRaw = adsFreshnessRow[0]?.latestSync
      ? new Date(adsFreshnessRow[0].latestSync) : null;
    const totalAdsRowCount = Number(adsFreshnessRow[0]?.adCount) || 0;
    const inWindowSpendRows = campaignRows.filter(
      (r) => Number(r.spend) > 0 || Number(r.clicks) > 0 || Number(r.impressions) > 0,
    ).length;
    const hasDataInWindow      = inWindowSpendRows > 0;
    const hasDataOutsideWindow = !hasDataInWindow && totalAdsRowCount > 0;

    // Build a per-campaign daily revenue map for sparkline rendering.
    // Key: campaignId → sorted array of { date: "YYYY-MM-DD", revenue: number }
    const dailyTrendMap = new Map<string, { date: string; revenue: number }[]>();
    for (const row of dailyTrendRows) {
      if (!row.campaignId) continue;
      const entry = { date: String(row.day), revenue: Number(row.revenue) || 0 };
      const existing = dailyTrendMap.get(row.campaignId);
      if (existing) {
        existing.push(entry);
      } else {
        dailyTrendMap.set(row.campaignId, [entry]);
      }
    }

    const channels = campaignRows.map((r) => {
      const spend        = Number(r.spend)        || 0;
      const conversions  = Number(r.conversions)  || 0;
      const revenue      = Number(r.revenue)      || 0;
      const revenuePrior = Number(r.revenuePrior) || 0;
      const clicks       = Number(r.clicks)       || 0;
      const impressions  = Number(r.impressions)  || 0;

      // ROAS = revenue / spend. Only meaningful when we have spent something.
      const roas = spend > 0
        ? parseFloat((revenue / spend).toFixed(2))
        : null;

      const ctr = impressions > 0 ? parseFloat(((clicks / impressions) * 100).toFixed(2)) : 0;
      const cpa = conversions > 0 ? parseFloat((spend / conversions).toFixed(2)) : null;

      // Revenue trend: % change vs. prior period of equal length.
      // null when prior period had no data (can't compute meaningful %).
      const revenueTrendPct = revenuePrior > 0
        ? parseFloat(((revenue - revenuePrior) / revenuePrior * 100).toFixed(1))
        : null;
      // revenueIsNew: true when this campaign had zero revenue in the prior
      // period but positive revenue now — a stronger signal than null trend.
      const revenueIsNew = revenuePrior === 0 && revenue > 0;

      return {
        campaignId:      r.campaignId,
        campaignName:    r.campaignName || "Unnamed Campaign",
        spend,
        conversions,
        clicks,
        impressions,
        ctr,
        roas,
        cpa,
        revenue:         parseFloat(revenue.toFixed(2)),
        status:          r.status || "UNKNOWN",
        revenueTrendPct,
        revenueIsNew,
        // Daily revenue breakdown for sparkline rendering.
        // null when no daily rows exist (e.g. live endpoint or empty window).
        revenueTrend:    dailyTrendMap.get(r.campaignId ?? "") ?? null,
        // Most recent date with non-zero spend — drives the "Last active" badge
        // on paused/removed rows. ISO string or null.
        lastActiveDate:  r.lastActiveDate ? new Date(r.lastActiveDate).toISOString() : null,
      };
    });

    res.json({
      data: channels,
      total_count: totalCount,
      page,
      page_size: pageSize,
      has_more: offset + channels.length < totalCount,
      syncedAt: Date.now(),
      // Window-empty disambiguation (task #114)
      hasDataInWindow,
      hasDataOutsideWindow,
      latestAdsSyncAt: adsLatestSyncRaw?.toISOString() ?? null,
    });
  } catch (err) {
    logger.error({ err }, "[Channels] Query failed");
    res.status(500).json({ error: "Failed to load channel data", detail: "An unexpected error occurred" });
  }
});

// ─── GET /api/warehouse/campaigns/live ───────────────────────────────────────
// Live Google Ads campaign fetch — calls `googleAds_listCampaigns` directly
// against the API so paused/removed/older campaigns appear even when the
// warehouse ETL has not synced them.
//
// Query params:
//   ?lookbackDays=N           1-365, default 90
//   ?statusFilter=ALL|ENABLED|PAUSED|REMOVED   default ALL
//   ?limit=N                  1-200, default 100
//
// Response shape mirrors /channels so the frontend can use the same code path.
router.get("/campaigns/live", async (req, res) => {
  try {
    const orgId = getOrgId(req);

    const lookbackDays = Math.max(1, Math.min(365, Math.floor(Number(req.query.lookbackDays) || 90)));
    const statusFilter = String(req.query.statusFilter ?? "ALL").toUpperCase();
    const limit        = Math.max(1, Math.min(200, Math.floor(Number(req.query.limit) || 100)));

    const creds = await getFreshGoogleCredentials("google_ads", orgId);
    if (!creds) {
      return res.status(502).json({
        error: "Google Ads not connected or credentials unavailable",
        source: "live",
        data: [],
        total_count: 0,
        has_more: false,
      });
    }

    const includeAllStatuses = statusFilter !== "ENABLED";
    const result = await googleAds_listCampaigns(creds, undefined, {
      lookbackDays,
      includeAllStatuses,
      limit,
    });

    if (!result.success || !result.data) {
      return res.status(502).json({ error: result.message, source: "live", data: [], total_count: 0, has_more: false });
    }

    type RawCampaign = {
      id: string;
      name: string;
      status: string;
      type?: string;
      end_date?: string | null;
      spend_usd: number;
      impressions: number;
      clicks: number;
      conversions: number;
      conversion_value_usd: number;
      roas: number;
    };

    const allCampaigns = (result.data.campaigns as RawCampaign[]) ?? [];
    const campaigns = statusFilter === "ALL"
      ? allCampaigns
      : allCampaigns.filter((c) => c.status === statusFilter);

    const channels = campaigns.map((c) => {
      const spend       = c.spend_usd         ?? 0;
      const revenue     = c.conversion_value_usd ?? 0;
      const conversions = c.conversions        ?? 0;
      const clicks      = c.clicks             ?? 0;
      const impressions = c.impressions        ?? 0;
      const ctr    = impressions > 0 ? parseFloat(((clicks / impressions) * 100).toFixed(2)) : 0;
      const cpa    = conversions > 0 ? parseFloat((spend / conversions).toFixed(2)) : null;
      const roas   = spend > 0 ? parseFloat((revenue / spend).toFixed(2)) : null;
      // lastActiveDate for live-endpoint campaigns: derived from campaign.end_date
      // (Google Ads API field — the campaign's scheduled last day). This serves
      // as a fallback when no warehouse spend history exists for the campaign.
      // end_date is "YYYY-MM-DD"; convert to ISO string for UI consistency.
      const lastActiveDate = c.end_date
        ? (() => {
            const d = new Date(c.end_date);
            return isNaN(d.getTime()) ? null : d.toISOString();
          })()
        : null;
      return {
        campaignId:   c.id,
        campaignName: c.name || "Unnamed Campaign",
        spend,
        conversions,
        clicks,
        impressions,
        ctr,
        roas,
        cpa,
        revenue:   parseFloat(revenue.toFixed(2)),
        convValue: parseFloat(revenue.toFixed(2)),
        status: c.status || "UNKNOWN",
        lastActiveDate,
      };
    });

    logger.info({ orgId, statusFilter, lookbackDays, count: channels.length }, "[campaigns/live] fetched");

    return res.json({
      data: channels,
      total_count: channels.length,
      page: 1,
      page_size: channels.length,
      has_more: false,
      syncedAt: Date.now(),
      source: "live",
    });
  } catch (err) {
    logger.error({ err }, "[campaigns/live] error");
    return res.status(500).json({ error: "Failed to fetch live campaign data", source: "live", data: [], total_count: 0, has_more: false });
  }
});

// ─── GET /api/warehouse/margin-leaks ─────────────────────────────────────────
// Returns top campaigns wasting spend on zero-inventory SKUs.
// Powers the "Live Margin Leaks" widget on the Ecommerce Dashboard.
router.get("/margin-leaks", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const tenantId = await resolveEffectiveTenant(orgId);
    const days = parseDays(req);
    const { page, pageSize, offset } = parsePagination(req.query as Record<string, unknown>);

    const tenantClause = rawAdsTenantClause(tenantId);
    const adsDateFilter = parseAdsDateFilter(req, warehouseGoogleAds.syncedAt);

    // Advanced filters: dimension multi-selects + free-text search.
    // q matches across campaign name, sku, and product title so a single
    // search term scopes the leak feed to the items the analyst is reviewing.
    const adv = parseAdvancedFilters(req);
    const advAdsClause = buildAdsAdvancedClause(adv);
    const advClauseSql = advAdsClause ? sql` AND ${advAdsClause}` : sql``;
    const skuFilter = adv.dimensions.sku && adv.dimensions.sku.length > 0
      ? sql` AND ${warehouseShopifyProducts.sku} IN ${adv.dimensions.sku}`
      : sql``;
    const productSearchSql = adv.q
      ? sql` AND (${warehouseShopifyProducts.title} ILIKE ${`%${adv.q}%`}
                  OR ${warehouseShopifyProducts.sku} ILIKE ${`%${adv.q}%`})`
      : sql``;

    const leakCondition = sql`(${warehouseShopifyProducts.inventoryQty} = 0 OR ${warehouseShopifyProducts.status} = 'out_of_stock')
        AND ${adsDateFilter}${tenantClause}${advClauseSql}${skuFilter}${productSearchSql}`;

    const baseJoin = db
      .select({
        campaignName: warehouseGoogleAds.campaignName,
        campaignId:   warehouseGoogleAds.campaignId,
        productTitle: warehouseShopifyProducts.title,
        sku:          warehouseShopifyProducts.sku,
        inventoryQty: warehouseShopifyProducts.inventoryQty,
        wastedSpend:  sql<number>`COALESCE(SUM(${warehouseGoogleAds.costUsd}), 0)`,
        impressions:  sql<number>`COALESCE(SUM(${warehouseGoogleAds.impressions})::int, 0)`,
      })
      .from(warehouseCrossPlatformMapping)
      .innerJoin(
        warehouseShopifyProducts,
        sql`${warehouseShopifyProducts.productId} = ${warehouseCrossPlatformMapping.shopifyProductId}`,
      )
      .innerJoin(
        warehouseGoogleAds,
        sql`${warehouseGoogleAds.adId} = ${warehouseCrossPlatformMapping.googleAdId}`,
      )
      .where(leakCondition)
      .groupBy(
        warehouseGoogleAds.campaignName,
        warehouseGoogleAds.campaignId,
        warehouseShopifyProducts.title,
        warehouseShopifyProducts.sku,
        warehouseShopifyProducts.inventoryQty,
      );

    // Also fetch inventory data freshness — critical for margin leak accuracy.
    // If Shopify ETL hasn't run recently, stale zero-inventory records may falsely
    // flag SKUs that have actually been restocked since the last sync.
    // Plus an ads-freshness probe (task #114) so the consumer can render the
    // WindowEmptyBanner when the leak feed is empty solely because the date
    // window doesn't intersect any ads rows for this tenant.
    const [rows, countRow, inventoryFreshnessRow, adsFreshnessRow] = await Promise.all([
      baseJoin
        .orderBy(sql`COALESCE(SUM(${warehouseGoogleAds.costUsd}), 0) DESC`)
        .limit(pageSize)
        .offset(offset),
      db
        .select({ total: sql<number>`COUNT(*)::int` })
        .from(
          sql`(
            SELECT 1
            FROM ${warehouseCrossPlatformMapping}
            INNER JOIN ${warehouseShopifyProducts}
              ON ${warehouseShopifyProducts.productId} = ${warehouseCrossPlatformMapping.shopifyProductId}
            INNER JOIN ${warehouseGoogleAds}
              ON ${warehouseGoogleAds.adId} = ${warehouseCrossPlatformMapping.googleAdId}
            WHERE (${warehouseShopifyProducts.inventoryQty} = 0 OR ${warehouseShopifyProducts.status} = 'out_of_stock')
              AND ${warehouseGoogleAds.syncedAt} >= NOW() - make_interval(days => ${days})${tenantClause}
            GROUP BY ${warehouseGoogleAds.campaignName}, ${warehouseGoogleAds.campaignId},
                     ${warehouseShopifyProducts.title}, ${warehouseShopifyProducts.sku}, ${warehouseShopifyProducts.inventoryQty}
          ) sub`,
        ),
      // MAX(synced_at) from Shopify warehouse table — tells us when inventory
      // data was last refreshed from the Shopify Admin API via ETL.
      db
        .select({ latestSync: sql<string>`MAX(${warehouseShopifyProducts.syncedAt})` })
        .from(warehouseShopifyProducts)
        .where(getShopifyTenantFilter(tenantId)),
      // Ads freshness probe (task #114) — see comment above.
      db
        .select({
          latestSync: sql<string>`MAX(${warehouseGoogleAds.syncedAt})`,
          adCount: sql<number>`COUNT(*)::int`,
        })
        .from(warehouseGoogleAds)
        .where(getWarehouseTenantFilter(tenantId)),
    ]);

    const totalCount = Number(countRow[0]?.total) || 0;
    // ── Window-vs-warehouse flags (task #114) ───────────────────────────────
    const adsLatestSyncRaw = adsFreshnessRow[0]?.latestSync
      ? new Date(adsFreshnessRow[0].latestSync) : null;
    const totalAdsRowCount = Number(adsFreshnessRow[0]?.adCount) || 0;
    const hasDataInWindow      = totalCount > 0;
    const hasDataOutsideWindow = !hasDataInWindow && totalAdsRowCount > 0;

    // ── Inventory staleness metadata ─────────────────────────────────────────
    // Margin leak detection reads inventory_qty from the ETL snapshot.
    // Stale inventory data means:
    //   • False positives: SKUs restocked after the last ETL sync are still flagged
    //   • False negatives: SKUs that went OOS after the last ETL sync are NOT caught
    // Threshold: warn at 4 h (ETL should run every 1–2 h for e-commerce clients)
    const latestSyncRaw           = inventoryFreshnessRow[0]?.latestSync
      ? new Date(inventoryFreshnessRow[0].latestSync) : null;
    const inventoryFreshnessMs    = latestSyncRaw ? Date.now() - latestSyncRaw.getTime() : null;
    const inventoryFreshnessHours = inventoryFreshnessMs != null
      ? parseFloat((inventoryFreshnessMs / 3_600_000).toFixed(1))
      : null;
    // >4 h stale: results may include restocked SKUs or miss newly OOS SKUs
    const inventoryDataStale = inventoryFreshnessHours != null && inventoryFreshnessHours > 4;

    res.json({
      data:            rows,
      total_count:     totalCount,
      page,
      page_size:       pageSize,
      has_more:        offset + rows.length < totalCount,
      // ── Inventory freshness metadata ───────────────────────────────────────
      // Consumers should surface a warning if inventoryDataStale === true.
      // The margin leak list reflects warehouse snapshot data — NOT the live
      // Shopify API — so stale data means results may have changed since sync.
      inventoryDataSource:    "warehouse_etl_snapshot",
      inventoryLastSyncAt:    latestSyncRaw?.toISOString()      ?? null,
      inventoryFreshnessHours: inventoryFreshnessHours          ?? null,
      inventoryDataStale,
      inventoryStaleNote:     inventoryDataStale
        ? `Inventory data is ${inventoryFreshnessHours}h old. Results may include restocked SKUs or miss newly out-of-stock products. Trigger an ETL sync to refresh.`
        : null,
      // Window-empty disambiguation (task #114)
      hasDataInWindow,
      hasDataOutsideWindow,
      latestAdsSyncAt:        adsLatestSyncRaw?.toISOString() ?? null,
    });
  } catch (err) {
    handleRouteError(err, req, res, "GET /api/warehouse/margin-leaks", {
      error: "Failed to compute margin leaks",
      detail: "An unexpected error occurred",
    });
  }
});

// ─── GET /api/warehouse/pipeline-triage ──────────────────────────────────────
// Returns campaigns with high spend but poor conversion rates.
// Powers the "Pipeline Quality Triage" widget on the Lead Gen Dashboard.

// Minimum per-campaign spend (USD) required to appear in triage results.
// Sourced here so both HAVING clauses and the API response stay in sync.
const PIPELINE_SPEND_THRESHOLD_USD = 10;

router.get("/pipeline-triage", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const tenantId = await resolveEffectiveTenant(orgId);
    const days = parseDays(req);
    const { page, pageSize, offset } = parsePagination(req.query as Record<string, unknown>);
    const dateFilter = sql`${warehouseGoogleAds.syncedAt} >= NOW() - make_interval(days => ${days})`;
    const adsTenantFilter = getWarehouseTenantFilter(tenantId);
    const combinedFilter = and(dateFilter, adsTenantFilter);
    const tenantClause = rawAdsTenantClause(tenantId);
    const spendThreshold = sql`COALESCE(SUM(${warehouseGoogleAds.costUsd}), 0) > ${PIPELINE_SPEND_THRESHOLD_USD}`;

    const [rows, countRow, adsFreshnessRow, inWindowAdsRow, inWindowCampaignCountRow] = await Promise.all([
      db
        .select({
          campaignId:   warehouseGoogleAds.campaignId,
          campaignName: warehouseGoogleAds.campaignName,
          spend:        sql<number>`COALESCE(SUM(${warehouseGoogleAds.costUsd}), 0)`,
          clicks:       sql<number>`COALESCE(SUM(${warehouseGoogleAds.clicks})::int, 0)`,
          conversions:  sql<number>`COALESCE(SUM(${warehouseGoogleAds.conversions}), 0)`,
          cpl:          sql<number>`CASE WHEN COALESCE(SUM(${warehouseGoogleAds.clicks}), 0) > 0 THEN COALESCE(SUM(${warehouseGoogleAds.costUsd}), 0) / COALESCE(SUM(${warehouseGoogleAds.clicks}), 1) ELSE 0 END`,
          convRate:     sql<number>`CASE WHEN COALESCE(SUM(${warehouseGoogleAds.clicks}), 0) > 0 THEN COALESCE(SUM(${warehouseGoogleAds.conversions}), 0) / COALESCE(SUM(${warehouseGoogleAds.clicks}), 1) ELSE 0 END`,
        })
        .from(warehouseGoogleAds)
        .where(combinedFilter)
        .groupBy(warehouseGoogleAds.campaignId, warehouseGoogleAds.campaignName)
        .having(spendThreshold)
        .orderBy(sql`COALESCE(SUM(${warehouseGoogleAds.costUsd}), 0) DESC`)
        .limit(pageSize)
        .offset(offset),

      db
        .select({ total: sql<number>`COUNT(*)::int` })
        .from(
          sql`(
            SELECT 1
            FROM ${warehouseGoogleAds}
            WHERE ${warehouseGoogleAds.syncedAt} >= NOW() - make_interval(days => ${days})${tenantClause}
            GROUP BY ${warehouseGoogleAds.campaignId}, ${warehouseGoogleAds.campaignName}
            HAVING COALESCE(SUM(${warehouseGoogleAds.costUsd}), 0) > ${PIPELINE_SPEND_THRESHOLD_USD}
          ) sub`,
        ),

      // Ads freshness probe (task #114): MAX(synced_at) + total ads rows for
      // tenant — ignoring the date window — so the consumer can disambiguate
      // "no triage candidates in window" from "warehouse empty".
      db
        .select({
          latestSync: sql<string>`MAX(${warehouseGoogleAds.syncedAt})`,
          adCount: sql<number>`COUNT(*)::int`,
        })
        .from(warehouseGoogleAds)
        .where(adsTenantFilter),

      // In-window ads count (no spend threshold). Lets us tell "window has ads
      // but none meet the spend triage bar" apart from "window is empty".
      db
        .select({ adCount: sql<number>`COUNT(*)::int` })
        .from(warehouseGoogleAds)
        .where(combinedFilter),

      // In-window distinct campaign count (no spend threshold). Used by the
      // frontend to show "X campaigns active but all spend under $N threshold"
      // when the window has campaigns but none clear the spend bar.
      db
        .select({ campaignCount: sql<number>`COUNT(DISTINCT ${warehouseGoogleAds.campaignId})::int` })
        .from(warehouseGoogleAds)
        .where(combinedFilter),
    ]);

    const totalCount = Number(countRow[0]?.total) || 0;

    // ── Window-vs-warehouse flags (task #114) ───────────────────────────────
    const adsLatestSyncRaw = adsFreshnessRow[0]?.latestSync
      ? new Date(adsFreshnessRow[0].latestSync) : null;
    const totalAdsRowCount = Number(adsFreshnessRow[0]?.adCount) || 0;
    const inWindowAdsCount = Number(inWindowAdsRow[0]?.adCount) || 0;
    const inWindowCampaignCount = Number(inWindowCampaignCountRow[0]?.campaignCount) || 0;
    const hasDataInWindow      = inWindowAdsCount > 0;
    const hasDataOutsideWindow = !hasDataInWindow && totalAdsRowCount > 0;

    res.json({
      data: rows,
      total_count: totalCount,
      page,
      page_size: pageSize,
      has_more: offset + rows.length < totalCount,
      // Window-empty disambiguation (task #114)
      hasDataInWindow,
      hasDataOutsideWindow,
      latestAdsSyncAt: adsLatestSyncRaw?.toISOString() ?? null,
      // Sub-threshold disambiguation: campaigns present but none exceed
      // PIPELINE_SPEND_THRESHOLD_USD so they don't appear in triage results.
      inWindowCampaignCount,
      spendThresholdUsd: PIPELINE_SPEND_THRESHOLD_USD,
    });
  } catch (err) {
    handleRouteError(err, req, res, "GET /api/warehouse/pipeline-triage", {
      error: "Failed to compute pipeline triage",
      detail: "An unexpected error occurred",
    });
  }
});

// ─── GET /api/warehouse/products ──────────────────────────────────────────────
// Returns SKU-level performance with POAS computed from joined ads + product data.
// Powers the SKU Grid on the Ecommerce Dashboard.
router.get("/products", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const tenantId = await resolveEffectiveTenant(orgId);
    const days = parseDays(req);
    const { page, pageSize, offset } = parsePagination(req.query as Record<string, unknown>);
    const tenantClause = rawAdsTenantClause(tenantId);

    const dateAndTenant = sql`${warehouseGoogleAds.syncedAt} >= NOW() - make_interval(days => ${days})${tenantClause}`;

    const [rows, countRow] = await Promise.all([
      db
        .select({
          sku:          warehouseShopifyProducts.sku,
          productTitle: warehouseShopifyProducts.title,
          price:        warehouseShopifyProducts.price,
          cogs:         warehouseShopifyProducts.cogs,
          inventoryQty: warehouseShopifyProducts.inventoryQty,
          status:       warehouseShopifyProducts.status,
          imageUrl:     warehouseShopifyProducts.imageUrl,
          brandLogoUrl: warehouseShopifyProducts.brandLogoUrl,
          campaignName: warehouseGoogleAds.campaignName,
          spend:        sql<number>`COALESCE(SUM(${warehouseGoogleAds.costUsd}), 0)`,
          conversions:  sql<number>`COALESCE(SUM(${warehouseGoogleAds.conversions}), 0)`,
          impressions:  sql<number>`COALESCE(SUM(${warehouseGoogleAds.impressions})::int, 0)`,
          clicks:       sql<number>`COALESCE(SUM(${warehouseGoogleAds.clicks})::int, 0)`,
        })
        .from(warehouseCrossPlatformMapping)
        .innerJoin(
          warehouseShopifyProducts,
          sql`${warehouseShopifyProducts.productId} = ${warehouseCrossPlatformMapping.shopifyProductId}`,
        )
        .innerJoin(
          warehouseGoogleAds,
          sql`${warehouseGoogleAds.adId} = ${warehouseCrossPlatformMapping.googleAdId}`,
        )
        .where(dateAndTenant)
        .groupBy(
          warehouseShopifyProducts.sku,
          warehouseShopifyProducts.title,
          warehouseShopifyProducts.price,
          warehouseShopifyProducts.cogs,
          warehouseShopifyProducts.inventoryQty,
          warehouseShopifyProducts.status,
          warehouseShopifyProducts.imageUrl,
          warehouseShopifyProducts.brandLogoUrl,
          warehouseGoogleAds.campaignName,
        )
        .orderBy(sql`COALESCE(SUM(${warehouseGoogleAds.costUsd}), 0) DESC`)
        .limit(pageSize)
        .offset(offset),

      db
        .select({ total: sql<number>`COUNT(*)::int` })
        .from(
          sql`(
            SELECT 1
            FROM ${warehouseCrossPlatformMapping}
            INNER JOIN ${warehouseShopifyProducts}
              ON ${warehouseShopifyProducts.productId} = ${warehouseCrossPlatformMapping.shopifyProductId}
            INNER JOIN ${warehouseGoogleAds}
              ON ${warehouseGoogleAds.adId} = ${warehouseCrossPlatformMapping.googleAdId}
            WHERE ${warehouseGoogleAds.syncedAt} >= NOW() - make_interval(days => ${days})${tenantClause}
            GROUP BY ${warehouseShopifyProducts.sku}, ${warehouseShopifyProducts.title},
                     ${warehouseShopifyProducts.price}, ${warehouseShopifyProducts.cogs},
                     ${warehouseShopifyProducts.inventoryQty}, ${warehouseShopifyProducts.status},
                     ${warehouseGoogleAds.campaignName}
          ) sub`,
        ),
    ]);

    const totalCount = Number(countRow[0]?.total) || 0;

    const products = rows.map((r) => {
      const spend = Number(r.spend) || 0;
      const conversions = Number(r.conversions) || 0;
      const price = Number(r.price) || 0;
      const cogs = Number(r.cogs) || 0;
      const revenue = conversions * price;
      const totalCost = spend + (cogs * conversions);
      const netMargin = revenue > 0 ? parseFloat(((revenue - totalCost) / revenue * 100).toFixed(1)) : 0;
      const poas = totalCost > 0 ? parseFloat((revenue / totalCost).toFixed(2)) : 0;

      return {
        sku:          r.sku || "—",
        name:         r.productTitle || "Untitled Product",
        platform:     "Google Ads",
        campaign:     r.campaignName || "Unnamed Campaign",
        spend:        parseFloat(spend.toFixed(2)),
        revenue:      parseFloat(revenue.toFixed(2)),
        cogs:         parseFloat((cogs * conversions).toFixed(2)),
        netMargin,
        poas,
        imageUrl:     r.imageUrl || null,
        brandLogoUrl: r.brandLogoUrl || null,
      };
    });

    res.json({
      data: products,
      total_count: totalCount,
      page,
      page_size: pageSize,
      has_more: offset + products.length < totalCount,
      syncedAt: Date.now(),
    });
  } catch (err) {
    handleRouteError(err, req, res, "GET /api/warehouse/products", {
      error: "Failed to load product data",
      detail: "An unexpected error occurred",
    });
  }
});

// ─── GET /api/warehouse/profit-trend ─────────────────────────────────────────
// Returns per-day spend, revenue, COGS, and profit for the requested window
// (?days=N or ?from=YYYY-MM-DD&to=YYYY-MM-DD). Daily series replaces the
// client-side sinusoidal synthesis used by the dashboard's Profit Trend chart
// so two tenants with the same window total no longer share an identical curve.
//
// COGS source mirrors /kpis: prefer per-day mapped COGS (Σ conversions * SKU.cogs
// via cross-platform mapping); fall back to revenue × org.cogsPctDefault when
// no mapping exists for a given day. Profit = revenue − spend − cogs.
//
// `hasEnoughHistory` flips true once the warehouse has ≥ 14 distinct days with
// any ad activity for the tenant (window-independent so the empty-state banner
// matches the spirit of "tenant has real history yet").
router.get("/profit-trend", async (req, res) => {
  try {
    const orgId    = getOrgId(req);
    const tenantId = await resolveEffectiveTenant(orgId);
    const adsTenantFilter = getWarehouseTenantFilter(tenantId);
    const dateFilter      = parseAdsDateFilter(req, warehouseGoogleAds.syncedAt);

    // Resolve [from, to] for filling missing days. We re-derive these from the
    // request rather than threading them out of parseAdsDateFilter so the
    // single source of truth for the SQL filter stays unchanged.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    let to: Date, from: Date;
    const fromRaw = req.query.from as string | undefined;
    const toRaw   = req.query.to   as string | undefined;
    if (fromRaw && toRaw && !isNaN(Date.parse(fromRaw)) && !isNaN(Date.parse(toRaw))) {
      from = new Date(fromRaw); from.setUTCHours(0, 0, 0, 0);
      to   = new Date(toRaw);   to.setUTCHours(0, 0, 0, 0);
    } else {
      const days = parseDays(req);
      to   = today;
      from = new Date(today);
      from.setUTCDate(from.getUTCDate() - (days - 1));
    }
    const dayMs = 86_400_000;
    const totalDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / dayMs) + 1);

    const day = sql<string>`to_char(${warehouseGoogleAds.syncedAt}, 'YYYY-MM-DD')`;

    const [adsRows, mappedRows, orgRow, historyRow] = await Promise.all([
      // Per-day ad spend & revenue inside the window.
      db
        .select({
          day,
          spend:   sql<number>`COALESCE(SUM(${warehouseGoogleAds.costUsd}), 0)`,
          revenue: sql<number>`COALESCE(SUM(${warehouseGoogleAds.conversionValue}), 0)`,
        })
        .from(warehouseGoogleAds)
        .where(and(adsTenantFilter, dateFilter))
        .groupBy(day),

      // Per-day mapped COGS via cross-platform mapping × Shopify SKU cogs.
      // Same join shape as /kpis so the rollup totals reconcile.
      db
        .select({
          day:  sql<string>`to_char(${warehouseGoogleAds.syncedAt}, 'YYYY-MM-DD')`,
          cogs: sql<number>`COALESCE(SUM(${warehouseGoogleAds.conversions} * ${warehouseShopifyProducts.cogs}), 0)`,
        })
        .from(warehouseCrossPlatformMapping)
        .innerJoin(
          warehouseShopifyProducts,
          sql`${warehouseShopifyProducts.productId} = ${warehouseCrossPlatformMapping.shopifyProductId}
              AND ${warehouseShopifyProducts.tenantId} = ${tenantId}`,
        )
        .innerJoin(
          warehouseGoogleAds,
          sql`${warehouseGoogleAds.id} = ${warehouseCrossPlatformMapping.googleAdId}
              AND ${dateFilter}
              AND ${warehouseGoogleAds.tenantId} = ${tenantId}`,
        )
        .where(eq(warehouseCrossPlatformMapping.tenantId, tenantId))
        .groupBy(sql`to_char(${warehouseGoogleAds.syncedAt}, 'YYYY-MM-DD')`),

      // Tenant-configured COGS % fallback (mirrors /api/settings/economics).
      orgId != null
        ? db
            .select({ cogsPctDefault: organizations.cogsPctDefault })
            .from(organizations)
            .where(eq(organizations.id, orgId))
        : Promise.resolve([] as { cogsPctDefault: number | null }[]),

      // Distinct days of ad activity across the entire warehouse for this
      // tenant — drives the "not enough history" banner.
      db
        .select({
          distinctDays: sql<number>`COUNT(DISTINCT to_char(${warehouseGoogleAds.syncedAt}, 'YYYY-MM-DD'))::int`,
        })
        .from(warehouseGoogleAds)
        .where(adsTenantFilter),
    ]);

    const cogsPctFallback = Number(orgRow[0]?.cogsPctDefault ?? 0.4) || 0;
    const distinctDays    = Number(historyRow[0]?.distinctDays) || 0;
    const hasEnoughHistory = distinctDays >= 14;

    const adsByDay = new Map(adsRows.map((r) => [r.day, r]));
    const cogsByDay = new Map(mappedRows.map((r) => [r.day, Number(r.cogs) || 0]));

    const points: Array<{ date: string; spend: number; revenue: number; cogs: number; profit: number }> = [];
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(from.getTime() + i * dayMs);
      const key = d.toISOString().slice(0, 10);
      const ad = adsByDay.get(key);
      const spend   = ad ? Number(ad.spend)   || 0 : 0;
      const revenue = ad ? Number(ad.revenue) || 0 : 0;
      const mapped  = cogsByDay.get(key) ?? 0;
      const cogs    = mapped > 0 ? mapped : revenue * cogsPctFallback;
      const profit  = revenue - spend - cogs;
      points.push({
        date:    key,
        spend:   parseFloat(spend.toFixed(2)),
        revenue: parseFloat(revenue.toFixed(2)),
        cogs:    parseFloat(cogs.toFixed(2)),
        profit:  parseFloat(profit.toFixed(2)),
      });
    }

    const hasData = adsRows.length > 0;

    res.json({
      hasData,
      hasEnoughHistory,
      distinctDays,
      minHistoryDays: 14,
      cogsPctFallback,
      from: from.toISOString().slice(0, 10),
      to:   to.toISOString().slice(0, 10),
      points,
    });
  } catch (err) {
    handleRouteError(err, req, res, "GET /api/warehouse/profit-trend", {
      error: "Failed to compute profit trend",
      detail: "An unexpected error occurred",
    });
  }
});

export default router;
