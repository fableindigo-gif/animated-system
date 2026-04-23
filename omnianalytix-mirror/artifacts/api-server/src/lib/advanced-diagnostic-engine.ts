import { db, warehouseGoogleAds, warehouseShopifyProducts, warehouseCrossPlatformMapping, warehouseCrmLeads, liveTriageAlerts, platformConnections, workspaces } from "@workspace/db";
import { sql, gt, eq, and } from "drizzle-orm";
import { logger } from "./logger";

export type AlertType = "Policy" | "Measurement" | "Budget" | "AI_Max" | "Inventory" | "Billing" | "CRM";

export interface DiagnosticAlert {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  platform: string;
  action?: string;
  category: "sales" | "pipeline" | "compliance" | "measurement";
  type?: AlertType;
  ts: string;
}

type GoalType = "ecom" | "leadgen" | "hybrid";

function nowUTC(): string {
  return new Date().toISOString();
}

async function persistAlerts(alerts: DiagnosticAlert[], workspaceId = "default"): Promise<void> {
  try {
    await db.delete(liveTriageAlerts).where(
      eq(liveTriageAlerts.workspaceId, workspaceId),
    );

    if (alerts.length === 0) return;

    const rows = alerts.map((a) => ({
      workspaceId,
      severity: a.severity,
      type: a.type ?? mapCategoryToType(a.category),
      title: a.title,
      message: a.detail,
      platform: a.platform,
      action: a.action ?? "",
      externalId: a.id,
      resolvedStatus: false,
    }));

    await db.insert(liveTriageAlerts).values(rows);
  } catch (err) {
    logger.warn({ err }, "advanced-diagnostics: failed to persist alerts to live_triage_alerts");
  }
}

function mapCategoryToType(category: string): AlertType {
  switch (category) {
    case "sales": return "Inventory";
    case "pipeline": return "Budget";
    case "compliance": return "Policy";
    default: return "Budget";
  }
}

async function runSalesDiagnostics(): Promise<DiagnosticAlert[]> {
  const alerts: DiagnosticAlert[] = [];

  const [marginLeaks, pmaxAudit, complianceCheck, measurementCheck, roasThreshold] = await Promise.allSettled([
    runInventoryAwareMarginLeaks(),
    runPMaxAuditor(),
    runPreFlightCompliance(),
    runMeasurementDiscrepancy(),
    runWarehouseRoasThresholdCheck(),
  ]);

  if (marginLeaks.status === "fulfilled") alerts.push(...marginLeaks.value);
  if (pmaxAudit.status === "fulfilled") alerts.push(...pmaxAudit.value);
  if (complianceCheck.status === "fulfilled") alerts.push(...complianceCheck.value);
  if (measurementCheck.status === "fulfilled") alerts.push(...measurementCheck.value);
  if (roasThreshold.status === "fulfilled") alerts.push(...roasThreshold.value);

  return alerts;
}

// ─── Warehouse ROAS Threshold Check ──────────────────────────────────────────
// Warehouse-based fallback for ROAS anomaly detection when live Google Ads
// API credentials are not available.  Queries the warehouse for each campaign's
// aggregate ROAS and flags those below the breakeven threshold (<1.0) or well
// below the portfolio median (proxy for "material drop from baseline").
//
// NOTE: This is a snapshot-level check — it cannot compute a true rolling 7-day
// average because the warehouse stores one row per ad (no date dimension).
// The live-triage route supplements this with googleAds_detectRoasDrop(), which
// uses the real Google Ads API to compare last-7-day vs 14-day rolling average.
async function runWarehouseRoasThresholdCheck(): Promise<DiagnosticAlert[]> {
  const alerts: DiagnosticAlert[] = [];
  const ts = nowUTC();

  try {
    const campaignRows = await db
      .select({
        campaignId:   warehouseGoogleAds.campaignId,
        campaignName: warehouseGoogleAds.campaignName,
        totalSpend:   sql<number>`COALESCE(SUM(${warehouseGoogleAds.costUsd}), 0)`,
        totalConversions: sql<number>`COALESCE(SUM(${warehouseGoogleAds.conversions}), 0)`,
        impressions:  sql<number>`COALESCE(SUM(${warehouseGoogleAds.impressions})::int, 0)`,
      })
      .from(warehouseGoogleAds)
      .groupBy(warehouseGoogleAds.campaignId, warehouseGoogleAds.campaignName)
      .having(sql`SUM(${warehouseGoogleAds.costUsd}) > 10`);   // ignore micro-budgets

    if (campaignRows.length === 0) return alerts;

    // Compute per-campaign ROAS using avg product price as revenue proxy
    const [shopifyRow] = await db
      .select({ avgPrice: sql<number>`COALESCE(AVG(${warehouseShopifyProducts.price}), 0)` })
      .from(warehouseShopifyProducts)
      .where(eq(warehouseShopifyProducts.status, "active"));

    const avgPrice = Number(shopifyRow?.avgPrice) || 0;
    if (avgPrice === 0) return alerts;   // can't compute ROAS without price data

    // Build per-campaign ROAS map
    const roasValues = campaignRows.map((c) => {
      const spend = Number(c.totalSpend);
      const conversions = Number(c.totalConversions);
      const estimatedRevenue = conversions * avgPrice;
      const roas = spend > 0 ? estimatedRevenue / spend : 0;
      return { ...c, spend, conversions, roas };
    });

    // Compute portfolio median ROAS (campaigns sorted by ROAS, take middle)
    const sorted = [...roasValues].sort((a, b) => a.roas - b.roas);
    const medianRoas = sorted[Math.floor(sorted.length / 2)]?.roas ?? 0;

    for (const c of roasValues) {
      if (c.roas <= 0 || c.spend < 10) continue;

      if (c.roas < 1.0) {
        // Breakeven breach — every dollar spent returns less than $1 in revenue
        alerts.push({
          id:       `diag-roas-breakeven-${c.campaignId}`,
          severity: "critical",
          title:    `"${c.campaignName || c.campaignId}" is below ROAS breakeven (${c.roas.toFixed(2)}×)`,
          detail:   `$${c.spend.toFixed(0)} spent with estimated ${c.roas.toFixed(2)}× ROAS — every dollar in ad spend returns less than $1 in revenue. Campaign is actively destroying margin. Note: ROAS computed from warehouse snapshot using avg product price ($${avgPrice.toFixed(2)}) — verify against live Google Ads dashboard.`,
          platform: "Google Ads · Warehouse",
          action:   "Pause or add negative keywords immediately; review bidding strategy",
          category: "sales",
          type:     "Budget",
          ts,
        });
      } else if (medianRoas > 0 && c.roas < medianRoas * 0.5 && c.roas < 1.5) {
        // Significantly below portfolio median — possible silent regression
        alerts.push({
          id:       `diag-roas-below-median-${c.campaignId}`,
          severity: "warning",
          title:    `"${c.campaignName || c.campaignId}" ROAS (${c.roas.toFixed(2)}×) is >50% below portfolio median (${medianRoas.toFixed(2)}×)`,
          detail:   `Campaign is significantly underperforming vs the rest of the portfolio. This may indicate creative fatigue, audience saturation, or budget misallocation. A rolling 7-day API check (Live Triage) will confirm whether this is a recent drop or a persistent pattern.`,
          platform: "Google Ads · Warehouse",
          action:   "Investigate bid strategy, audience targeting, and creative performance",
          category: "sales",
          type:     "Budget",
          ts,
        });
      }
    }
  } catch (err) {
    logger.warn({ err }, "advanced-diagnostics: warehouse ROAS threshold check failed");
  }

  return alerts;
}

async function runPipelineDiagnostics(): Promise<DiagnosticAlert[]> {
  const alerts: DiagnosticAlert[] = [];

  const [funnelAllocator, crmStrength, policyCompliance] = await Promise.allSettled([
    runFullFunnelAllocator(),
    runCrmDataStrengthMonitor(),
    runLeadGenPolicyCompliance(),
  ]);

  if (funnelAllocator.status === "fulfilled") alerts.push(...funnelAllocator.value);
  if (crmStrength.status === "fulfilled") alerts.push(...crmStrength.value);
  if (policyCompliance.status === "fulfilled") alerts.push(...policyCompliance.value);

  return alerts;
}

async function runInventoryAwareMarginLeaks(): Promise<DiagnosticAlert[]> {
  const alerts: DiagnosticAlert[] = [];
  const ts = nowUTC();

  try {
    // ── Run leak detection and inventory freshness check in parallel ─────────
    const [leaks, freshnessRow] = await Promise.all([
      db
        .select({
          campaignName: warehouseGoogleAds.campaignName,
          campaignId:   warehouseGoogleAds.campaignId,
          costUsd:      sql<number>`SUM(${warehouseGoogleAds.costUsd})`,
          title:        warehouseShopifyProducts.title,
          sku:          warehouseShopifyProducts.sku,
          inventoryQty: warehouseShopifyProducts.inventoryQty,
        })
        .from(warehouseGoogleAds)
        .innerJoin(
          warehouseCrossPlatformMapping,
          eq(warehouseCrossPlatformMapping.googleAdId, warehouseGoogleAds.adId),
        )
        .innerJoin(
          warehouseShopifyProducts,
          eq(warehouseShopifyProducts.productId, warehouseCrossPlatformMapping.shopifyProductId),
        )
        .where(
          sql`${warehouseShopifyProducts.inventoryQty} = 0
              AND ${warehouseGoogleAds.costUsd} > 0
              AND ${warehouseGoogleAds.status} = 'ENABLED'`,
        )
        .groupBy(
          warehouseGoogleAds.campaignName,
          warehouseGoogleAds.campaignId,
          warehouseShopifyProducts.title,
          warehouseShopifyProducts.sku,
          warehouseShopifyProducts.inventoryQty,
        )
        .orderBy(sql`SUM(${warehouseGoogleAds.costUsd}) DESC`)
        .limit(5),

      // Inventory freshness — determines whether leak results are trustworthy.
      // The watcher queries the ETL warehouse snapshot, NOT the live Shopify API.
      // Stale data → false positives (restocked SKUs still flagged) and
      // false negatives (newly OOS SKUs missed).
      db
        .select({ latestSync: sql<string>`MAX(${warehouseShopifyProducts.syncedAt})` })
        .from(warehouseShopifyProducts),
    ]);

    // ── Inventory staleness alert ─────────────────────────────────────────────
    // Fire BEFORE the leak alert so operators see the data-quality caveat first.
    const latestSyncRaw    = freshnessRow[0]?.latestSync
      ? new Date(freshnessRow[0].latestSync) : null;
    const freshnessMs      = latestSyncRaw ? Date.now() - latestSyncRaw.getTime() : null;
    const freshnessHours   = freshnessMs != null ? freshnessMs / 3_600_000 : null;
    // Stale threshold: 4 h — Shopify ETL should sync at least every 1–2 h
    const inventoryIsStale = freshnessHours != null && freshnessHours > 4;

    if (inventoryIsStale) {
      const ageStr = freshnessHours! > 24
        ? `${(freshnessHours! / 24).toFixed(1)} days`
        : `${freshnessHours!.toFixed(1)} hours`;

      alerts.push({
        id:       "diag-inventory-data-stale",
        severity: freshnessHours! > 12 ? "critical" : "warning",
        title:    `Inventory data is ${ageStr} old — margin leak detection may be inaccurate`,
        detail:   `The margin leak watcher reads inventory levels from the ETL warehouse snapshot, not the live Shopify API. Data last refreshed ${ageStr} ago. Stale data causes false positives (flagging restocked SKUs) and false negatives (missing newly out-of-stock products). ETL should sync every 1–2 hours for e-commerce clients.`,
        platform: "Inventory · ETL",
        action:   "Trigger an ETL sync to refresh Shopify inventory data, then rerun the margin leak diagnostic",
        category: "sales",
        type:     "Inventory",
        ts,
      });
    }

    // ── Margin leak alert ─────────────────────────────────────────────────────
    if (leaks.length > 0) {
      const totalWaste = leaks.reduce((sum, l) => sum + Number(l.costUsd || 0), 0);
      const topLeak    = leaks[0];
      const staleNote  = inventoryIsStale ? " (⚠ inventory data may be stale — verify with a fresh sync)" : "";

      alerts.push({
        id:       "diag-margin-leak-critical",
        severity: totalWaste > 500 ? "critical" : "warning",
        title:    `Margin Leak: ${leaks.length} active ad${leaks.length > 1 ? "s" : ""} wasting spend on out-of-stock SKUs${staleNote}`,
        detail:   `$${totalWaste.toFixed(2)} wasted on zero-inventory products. Worst offender: "${topLeak.title || topLeak.sku}" via "${topLeak.campaignName}" ($${Number(topLeak.costUsd).toFixed(2)} spent). SA360 Enterprise logic: every dollar here is pure margin bleed.`,
        platform: "Inventory · SA360",
        action:   "Pause ads on zero-inventory SKUs immediately to stop margin bleed",
        category: "sales",
        type:     "Inventory",
        ts,
      });
    }
  } catch (err) {
    logger.warn({ err }, "advanced-diagnostics: margin leak check failed");
  }

  return alerts;
}

async function runPMaxAuditor(): Promise<DiagnosticAlert[]> {
  const alerts: DiagnosticAlert[] = [];
  const ts = nowUTC();

  try {
    const pmaxCampaigns = await db
      .select({
        campaignName: warehouseGoogleAds.campaignName,
        campaignId: warehouseGoogleAds.campaignId,
        costUsd: sql<number>`SUM(${warehouseGoogleAds.costUsd})`,
        conversions: sql<number>`SUM(${warehouseGoogleAds.conversions})`,
        impressions: sql<number>`SUM(${warehouseGoogleAds.impressions})`,
        clicks: sql<number>`SUM(${warehouseGoogleAds.clicks})`,
        adCount: sql<number>`COUNT(DISTINCT ${warehouseGoogleAds.adId})::int`,
      })
      .from(warehouseGoogleAds)
      .where(sql`LOWER(${warehouseGoogleAds.campaignName}) LIKE '%pmax%' OR LOWER(${warehouseGoogleAds.campaignName}) LIKE '%performance max%'`)
      .groupBy(warehouseGoogleAds.campaignName, warehouseGoogleAds.campaignId);

    for (const c of pmaxCampaigns) {
      const spend = Number(c.costUsd) || 0;
      const conv = Number(c.conversions) || 0;
      const roas = conv > 0 && spend > 0 ? (conv * 50) / spend : 0;
      const assetCount = Number(c.adCount) || 0;

      if (spend > 100 && conv === 0) {
        alerts.push({
          id: `diag-aimax-zero-conv-${c.campaignId}`,
          severity: "critical",
          title: `AI MAX: PMax "${c.campaignName}" has zero conversions with $${spend.toFixed(0)} spend`,
          detail: `Performance Max campaign is spending budget with no conversion signal. Asset groups may lack diversity (${assetCount} unique assets detected) or target ROAS may be over-constrained. AI MAX training recommends minimum 15 unique assets per asset group.`,
          platform: "Google Ads · AI MAX",
          action: "Review asset group diversity and relax tROAS constraints",
          category: "sales",
          type: "AI_Max",
          ts,
        });
      } else if (roas > 8 && conv < 10) {
        alerts.push({
          id: `diag-aimax-aggressive-troas-${c.campaignId}`,
          severity: "warning",
          title: `AI MAX: PMax "${c.campaignName}" has aggressive tROAS (${roas.toFixed(0)}×) with low volume`,
          detail: `Target ROAS > 800% with only ${conv} conversions constrains Smart Bidding's learning. AI MAX recommends lowering tROAS to allow volume growth, then tightening once conversion volume exceeds 30/week.`,
          platform: "Google Ads · AI MAX",
          action: "Lower target ROAS by 20-30% to expand conversion volume",
          category: "sales",
          type: "AI_Max",
          ts,
        });
      } else if (assetCount < 5 && spend > 50) {
        alerts.push({
          id: `diag-aimax-low-assets-${c.campaignId}`,
          severity: "warning",
          title: `AI MAX: PMax "${c.campaignName}" lacks asset diversity (${assetCount} assets)`,
          detail: `Only ${assetCount} unique ad assets detected. Google's AI MAX framework recommends 15+ assets (5 headlines, 5 descriptions, 5 images minimum) for optimal automated creative mixing.`,
          platform: "Google Ads · AI MAX",
          action: "Add more creative assets to improve AI-driven optimization",
          category: "sales",
          type: "AI_Max",
          ts,
        });
      } else if (spend > 200 && roas < 1) {
        alerts.push({
          id: `diag-aimax-low-roas-${c.campaignId}`,
          severity: "warning",
          title: `AI MAX: PMax "${c.campaignName}" running below breakeven (${roas.toFixed(1)}× ROAS)`,
          detail: `$${spend.toFixed(0)} spent with estimated ${roas.toFixed(1)}× return. Consider adjusting target ROAS or reviewing search theme exclusions.`,
          platform: "Google Ads · AI MAX",
          action: "Audit asset groups and network distribution",
          category: "sales",
          type: "AI_Max",
          ts,
        });
      }
    }
  } catch (err) {
    logger.warn({ err }, "advanced-diagnostics: AI MAX PMax auditor failed");
  }

  return alerts;
}

async function runMeasurementDiscrepancy(): Promise<DiagnosticAlert[]> {
  const alerts: DiagnosticAlert[] = [];
  const ts = nowUTC();

  try {
    const [adsRow] = await db
      .select({
        totalConversions: sql<number>`COALESCE(SUM(${warehouseGoogleAds.conversions}), 0)`,
        totalSpend: sql<number>`COALESCE(SUM(${warehouseGoogleAds.costUsd}), 0)`,
      })
      .from(warehouseGoogleAds);

    const [shopifyRow] = await db
      .select({
        totalVariants: sql<number>`COUNT(*)::int`,
        totalRevenue: sql<number>`COALESCE(SUM(${warehouseShopifyProducts.price}), 0)`,
      })
      .from(warehouseShopifyProducts)
      .where(eq(warehouseShopifyProducts.status, "active"));

    const adConversions = Number(adsRow?.totalConversions) || 0;
    const totalVariants = Number(shopifyRow?.totalVariants) || 0;
    const adSpend = Number(adsRow?.totalSpend) || 0;

    if (adConversions > 10 && totalVariants > 0 && adSpend > 0) {
      const estimatedOrdersFromConversions = adConversions;
      const avgPrice = Number(shopifyRow?.totalRevenue) / Math.max(totalVariants, 1);
      const estimatedRevenueFromAds = estimatedOrdersFromConversions * avgPrice;
      const impliedConversionRate = adConversions / Math.max(totalVariants, 1);

      if (impliedConversionRate > 3) {
        const discrepancy = Math.round(((impliedConversionRate - 1) / impliedConversionRate) * 100);
        alerts.push({
          id: "diag-measurement-discrepancy",
          severity: discrepancy > 40 ? "critical" : "warning",
          title: `High Risk: Measurement Discrepancy — ${discrepancy}% gap detected`,
          detail: `Google Ads reports ${adConversions} conversions (30d) but Shopify catalog has only ${totalVariants} active product variants. This ${discrepancy}% discrepancy (threshold: 15%) suggests duplicate conversion counting, misconfigured Enhanced Conversions, or gtag firing on non-purchase events. Estimated revenue attribution gap: $${estimatedRevenueFromAds.toFixed(0)} implied vs actual catalog capacity.`,
          platform: "Measurement",
          action: "Audit conversion tracking tags, check for duplicate gtag installations, verify Enhanced Conversions setup",
          category: "sales",
          type: "Measurement",
          ts,
        });
      }
    }
  } catch (err) {
    logger.warn({ err }, "advanced-diagnostics: measurement discrepancy check failed");
  }

  return alerts;
}

async function runPreFlightCompliance(): Promise<DiagnosticAlert[]> {
  const alerts: DiagnosticAlert[] = [];
  const ts = nowUTC();

  try {
    const adsWithUrls = await db
      .select({
        adId: warehouseGoogleAds.adId,
        campaignName: warehouseGoogleAds.campaignName,
        finalUrl: warehouseGoogleAds.finalUrl,
        costUsd: warehouseGoogleAds.costUsd,
      })
      .from(warehouseGoogleAds)
      .where(gt(warehouseGoogleAds.costUsd, 0))
      .limit(100);

    const emptyUrlAds = adsWithUrls.filter((a) => !a.finalUrl || a.finalUrl.trim() === "");
    if (emptyUrlAds.length > 0) {
      alerts.push({
        id: "diag-compliance-empty-urls",
        severity: "warning",
        title: `${emptyUrlAds.length} active ad${emptyUrlAds.length > 1 ? "s" : ""} with missing final URLs`,
        detail: `Ads without valid final URLs risk GMC preemptive disapprovals and policy violations. Top offender: "${emptyUrlAds[0].campaignName}".`,
        platform: "Compliance · Policy",
        action: "Add valid final URLs to all active ads to prevent disapprovals",
        category: "compliance",
        type: "Policy",
        ts,
      });
    }

    const draftedProductLinks = await db
      .select({
        campaignName: warehouseGoogleAds.campaignName,
        finalUrl: warehouseGoogleAds.finalUrl,
        productTitle: warehouseShopifyProducts.title,
        productStatus: warehouseShopifyProducts.status,
        adCost: warehouseGoogleAds.costUsd,
      })
      .from(warehouseGoogleAds)
      .innerJoin(
        warehouseCrossPlatformMapping,
        eq(warehouseCrossPlatformMapping.googleAdId, warehouseGoogleAds.adId),
      )
      .innerJoin(
        warehouseShopifyProducts,
        eq(warehouseShopifyProducts.productId, warehouseCrossPlatformMapping.shopifyProductId),
      )
      .where(
        sql`${warehouseShopifyProducts.status} IN ('draft', 'archived') AND ${warehouseGoogleAds.costUsd} > 0`,
      )
      .limit(10);

    if (draftedProductLinks.length > 0) {
      const totalWaste = draftedProductLinks.reduce((s, r) => s + Number(r.adCost || 0), 0);
      alerts.push({
        id: "diag-compliance-drafted-products",
        severity: "critical",
        title: `${draftedProductLinks.length} active ad${draftedProductLinks.length > 1 ? "s" : ""} pointing to draft/archived Shopify products`,
        detail: `$${totalWaste.toFixed(2)} spent driving traffic to unavailable products. "${draftedProductLinks[0].productTitle}" (${draftedProductLinks[0].productStatus}) via "${draftedProductLinks[0].campaignName}". These URLs will likely 404 and trigger policy disapprovals.`,
        platform: "Compliance · Policy",
        action: "Pause ads or republish the linked Shopify products immediately",
        category: "compliance",
        type: "Policy",
        ts,
      });
    }
  } catch (err) {
    logger.warn({ err }, "advanced-diagnostics: pre-flight compliance failed");
  }

  return alerts;
}

async function runFullFunnelAllocator(): Promise<DiagnosticAlert[]> {
  const alerts: DiagnosticAlert[] = [];
  const ts = nowUTC();

  try {
    const campaignsByType = await db
      .select({
        campaignName: warehouseGoogleAds.campaignName,
        campaignId: warehouseGoogleAds.campaignId,
        costUsd: sql<number>`SUM(${warehouseGoogleAds.costUsd})`,
        conversions: sql<number>`SUM(${warehouseGoogleAds.conversions})`,
        impressions: sql<number>`SUM(${warehouseGoogleAds.impressions})`,
      })
      .from(warehouseGoogleAds)
      .groupBy(warehouseGoogleAds.campaignName, warehouseGoogleAds.campaignId);

    const demandGen = campaignsByType.filter((c) =>
      /demand gen|discovery|video|display/i.test(c.campaignName || ""),
    );
    const lowerFunnel = campaignsByType.filter((c) =>
      /search|pmax|performance max|brand/i.test(c.campaignName || ""),
    );

    const demandGenSpend = demandGen.reduce((s, c) => s + (Number(c.costUsd) || 0), 0);
    const demandGenConv = demandGen.reduce((s, c) => s + (Number(c.conversions) || 0), 0);
    const lowerFunnelSpend = lowerFunnel.reduce((s, c) => s + (Number(c.costUsd) || 0), 0);
    const lowerFunnelConv = lowerFunnel.reduce((s, c) => s + (Number(c.conversions) || 0), 0);

    if (demandGenSpend > 200 && demandGenConv > 10 && lowerFunnelSpend < demandGenSpend * 0.3) {
      alerts.push({
        id: "diag-funnel-reallocation",
        severity: "warning",
        title: "Reallocation Recommended: Shift top-funnel budget to capture bottom-funnel demand",
        detail: `Demand Gen: $${demandGenSpend.toFixed(0)} spend / ${demandGenConv} conversions driving high click volume. Search/PMax: only $${lowerFunnelSpend.toFixed(0)} — lower-funnel is budget-constrained and cannot capture the demand being generated. Full-funnel allocator recommends shifting 15-20% of Demand Gen budget to PMax.`,
        platform: "Full Funnel · Demand Gen",
        action: "Increase Search/PMax budgets to capture demand gen-driven intent",
        category: "pipeline",
        type: "Budget",
        ts,
      });
    }

    const zeroConvHighSpend = campaignsByType.filter(
      (c) => (Number(c.conversions) || 0) === 0 && (Number(c.costUsd) || 0) > 100,
    );
    if (zeroConvHighSpend.length > 0) {
      const totalWaste = zeroConvHighSpend.reduce((s, c) => s + (Number(c.costUsd) || 0), 0);
      alerts.push({
        id: "diag-pipeline-zero-conv",
        severity: "critical",
        title: `${zeroConvHighSpend.length} campaign${zeroConvHighSpend.length > 1 ? "s" : ""} with zero pipeline attribution`,
        detail: `$${totalWaste.toFixed(0)} total spend across campaigns generating zero leads. Top: "${zeroConvHighSpend[0].campaignName}" ($${Number(zeroConvHighSpend[0].costUsd).toFixed(0)}).`,
        platform: "Pipeline · Budget",
        action: "Pause or restructure zero-attribution campaigns",
        category: "pipeline",
        type: "Budget",
        ts,
      });
    }
  } catch (err) {
    logger.warn({ err }, "advanced-diagnostics: full-funnel allocator failed");
  }

  return alerts;
}

async function runCrmDataStrengthMonitor(): Promise<DiagnosticAlert[]> {
  const alerts: DiagnosticAlert[] = [];
  const ts = nowUTC();

  try {
    // ── Fetch ad-side signals ────────────────────────────────────────────────
    const [adsRow] = await db
      .select({
        totalConversions: sql<number>`COALESCE(SUM(${warehouseGoogleAds.conversions}), 0)`,
        totalClicks:      sql<number>`COALESCE(SUM(${warehouseGoogleAds.clicks}), 0)`,
        campaignCount:    sql<number>`COUNT(DISTINCT ${warehouseGoogleAds.campaignId})::int`,
      })
      .from(warehouseGoogleAds);

    const adConversions  = Number(adsRow.totalConversions) || 0;
    const campaignCount  = Number(adsRow.campaignCount)    || 0;

    // ── Fetch real CRM lead counts (replaces the hardcoded 70 % estimate) ───
    // We count total leads and how many carry a paid click ID (gclid or fbclid).
    // Attribution-matched leads = ones the platform can link back to an ad click.
    const [crmRow] = await db
      .select({
        totalLeads:           sql<number>`COUNT(*)::int`,
        attributedLeads:      sql<number>`COUNT(*) FILTER (
          WHERE (${warehouseCrmLeads.gclid} IS NOT NULL AND ${warehouseCrmLeads.gclid} != '')
             OR (${warehouseCrmLeads.fbclid} IS NOT NULL AND ${warehouseCrmLeads.fbclid} != '')
        )::int`,
      })
      .from(warehouseCrmLeads);

    const totalCrmLeads     = Number(crmRow?.totalLeads)      || 0;
    const attributedLeads   = Number(crmRow?.attributedLeads) || 0;

    // ── Gap analysis: ad conversions vs CRM pipeline volume ─────────────────
    if (adConversions > 20 && totalCrmLeads > 0) {
      // Real capture rate from warehouse data (not a static estimate)
      const realCaptureRate       = attributedLeads / totalCrmLeads;
      const capturedPipelineVolume = Math.round(adConversions * realCaptureRate);
      const gapPct                = ((adConversions - capturedPipelineVolume) / adConversions) * 100;

      if (gapPct > 15) {
        alerts.push({
          id: "diag-crm-data-strength",
          severity: gapPct > 40 ? "critical" : "warning",
          title: `CRM pipeline volume ${gapPct.toFixed(0)}% below ad-reported conversions`,
          detail: `Google Ads reports ${adConversions} conversions. Warehouse CRM has ${totalCrmLeads} leads of which ${attributedLeads} (${(realCaptureRate * 100).toFixed(0)}%) carry a paid click ID (gclid/fbclid) — yielding an estimated ${capturedPipelineVolume} matched pipeline records. The ${gapPct.toFixed(0)}% gap indicates tracking misconfiguration, form abandonment, or broken CRM lead routing.`,
          platform: "CRM · Attribution",
          action: "Audit conversion pixel, form submission handlers, and CRM integration. Enable auto-tagging in Google Ads and Meta CAPI.",
          category: "pipeline",
          type: "Measurement",
          ts,
        });
      }
    } else if (adConversions > 20 && totalCrmLeads === 0) {
      // Ad platform reports conversions but the CRM warehouse is empty — likely a sync gap
      alerts.push({
        id: "diag-crm-data-strength",
        severity: "critical",
        title: `CRM warehouse empty — ${adConversions} ad conversions have no matching CRM records`,
        detail: `Google Ads reports ${adConversions} conversions but the CRM warehouse contains 0 leads. Either the CRM ETL sync has not run, or the integration is misconfigured. Attribution and CAC calculations are impossible without CRM data.`,
        platform: "CRM · Attribution",
        action: "Trigger a CRM ETL sync and verify the CRM integration webhook or API connection is active.",
        category: "pipeline",
        type: "Measurement",
        ts,
      });
    }

    // ── Tag firing anomaly: conversions >> CRM leads implies duplicate tags ──
    // If ad-reported conversions are more than 2× the total CRM lead count
    // the most likely cause is duplicate gtag firing or incorrect event mapping.
    if (adConversions > 10 && totalCrmLeads > 0) {
      const convLeadRatio = adConversions / totalCrmLeads;
      if (convLeadRatio > 2.0) {
        alerts.push({
          id: "diag-tag-firing-anomaly",
          severity: convLeadRatio > 4.0 ? "critical" : "warning",
          title: `Tag firing anomaly — conversions are ${convLeadRatio.toFixed(1)}× CRM lead volume`,
          detail: `Google Ads records ${adConversions} conversions but the CRM warehouse has only ${totalCrmLeads} leads (${convLeadRatio.toFixed(1)}:1 ratio). A ratio above 2.0 strongly suggests duplicate conversion tags, gtag firing on non-purchase events (page views, scroll), or misconfigured Enhanced Conversions counting multiple events per session. This inflates reported ROAS and Smart Bidding targets.`,
          platform: "Measurement · Tags",
          action: "Audit Google Tag Manager — check for duplicate purchase/lead events. Use Tag Assistant to replay a conversion session and confirm single-fire.",
          category: "measurement",
          type: "Measurement",
          ts,
        });
      }
    }

    // ── Thin signal: conversions spread too thin across campaigns ────────────
    if (adConversions > 50 && campaignCount > 3) {
      const avgConvPerCampaign = adConversions / campaignCount;
      if (avgConvPerCampaign < 5) {
        alerts.push({
          id: "diag-crm-thin-signal",
          severity: "info",
          title: "Conversion signal is spread thin across campaigns",
          detail: `${adConversions} total conversions across ${campaignCount} campaigns (avg ${avgConvPerCampaign.toFixed(1)}/campaign). Smart Bidding requires ≥ 30 conversions/campaign per 30 days to exit the learning phase — consolidation will improve bidding performance.`,
          platform: "CRM · Signal",
          action: "Consolidate campaigns to strengthen per-campaign bidding signal density",
          category: "pipeline",
          type: "Measurement",
          ts,
        });
      }
    }
  } catch (err) {
    logger.warn({ err }, "advanced-diagnostics: CRM data strength monitor failed");
  }

  return alerts;
}

async function runLeadGenPolicyCompliance(): Promise<DiagnosticAlert[]> {
  const alerts: DiagnosticAlert[] = [];
  const ts = nowUTC();

  try {
    const restrictedPatterns = [
      "guaranteed results",
      "100% success",
      "free money",
      "instant approval",
      "no credit check",
      "pre-approved",
      "risk-free",
    ];

    const activeAds = await db
      .select({
        adId: warehouseGoogleAds.adId,
        campaignName: warehouseGoogleAds.campaignName,
        finalUrl: warehouseGoogleAds.finalUrl,
      })
      .from(warehouseGoogleAds)
      .where(gt(warehouseGoogleAds.costUsd, 0))
      .limit(100);

    const flaggedAds: string[] = [];
    for (const ad of activeAds) {
      const url = (ad.finalUrl || "").toLowerCase();
      for (const pattern of restrictedPatterns) {
        if (url.includes(pattern.replace(/ /g, "-")) || url.includes(pattern.replace(/ /g, "_"))) {
          flaggedAds.push(ad.campaignName || ad.adId);
          break;
        }
      }
    }

    if (flaggedAds.length > 0) {
      alerts.push({
        id: "diag-leadgen-policy-risk",
        severity: "warning",
        title: `${flaggedAds.length} ad${flaggedAds.length > 1 ? "s" : ""} with potential policy-restricted language`,
        detail: `Landing pages contain phrases that may trigger Google Ads policy violations in B2B/financial verticals. Campaigns: ${flaggedAds.slice(0, 3).join(", ")}.`,
        platform: "Compliance · Policy",
        action: "Review landing pages for restricted claims before Google review",
        category: "compliance",
        type: "Policy",
        ts,
      });
    }
  } catch (err) {
    logger.warn({ err }, "advanced-diagnostics: lead gen policy compliance failed");
  }

  return alerts;
}

async function runCrmDiagnostics(): Promise<DiagnosticAlert[]> {
  const alerts: DiagnosticAlert[] = [];
  const ts = nowUTC();

  try {
    const leads = await db.select().from(warehouseCrmLeads).limit(1000);
    if (leads.length === 0) return alerts;

    const ads = await db.select().from(warehouseGoogleAds).limit(1000);

    const totalLeads = leads.length;
    const withGclid = leads.filter((l) => l.gclid && l.gclid.length > 0);
    const withFbclid = leads.filter((l) => l.fbclid && l.fbclid.length > 0);
    const unattributed = leads.filter((l) => (!l.gclid || l.gclid === "") && (!l.fbclid || l.fbclid === ""));
    const converted = leads.filter((l) => l.convertedAt !== null);
    const closed = leads.filter((l) => l.closedAt !== null);

    const unattributedPct = Math.round((unattributed.length / totalLeads) * 100);
    if (unattributedPct > 40) {
      alerts.push({
        id: "diag-crm-unattributed",
        severity: unattributedPct > 60 ? "critical" : "warning",
        title: `${unattributedPct}% of CRM leads lack ad click attribution (gclid/fbclid)`,
        detail: `${unattributed.length} of ${totalLeads} leads have no gclid or fbclid. This means offline conversion uploads and Enhanced Conversions for Leads (EC4L) cannot match these leads back to ad clicks. CAC calculations will be inaccurate.`,
        platform: "CRM · Cross-Platform",
        action: "Ensure UTM parameters and click IDs are passed through landing pages to CRM forms. Enable auto-tagging in Google Ads and Meta CAPI.",
        category: "measurement",
        type: "CRM",
        ts,
      });
    }

    if (converted.length > 0 && ads.length > 0) {
      const totalAdSpend = ads.reduce((s, a) => s + (a.costUsd ?? 0), 0);
      const totalDealValue = closed.reduce((s, l) => s + (l.dealAmount ?? 0), 0);

      if (totalAdSpend > 0 && totalDealValue > 0) {
        const cac = totalAdSpend / converted.length;
        const roas = totalDealValue / totalAdSpend;

        if (roas < 1) {
          alerts.push({
            id: "diag-crm-roas-negative",
            severity: "critical",
            title: `Pipeline ROAS is ${roas.toFixed(2)}x — spending more than deal revenue`,
            detail: `Total ad spend ($${totalAdSpend.toFixed(0)}) exceeds total closed deal value ($${totalDealValue.toFixed(0)}). CAC is $${cac.toFixed(0)} per converted lead. Review campaign targeting or increase lead nurturing conversion rates.`,
            platform: "CRM · Pipeline Analytics",
            action: "Reduce cost-per-lead by pausing underperforming campaigns or improve lead-to-close conversion rates",
            category: "measurement",
            type: "CRM",
            ts,
          });
        } else if (roas < 2) {
          alerts.push({
            id: "diag-crm-roas-low",
            severity: "warning",
            title: `Pipeline ROAS is ${roas.toFixed(2)}x — below 2x efficiency target`,
            detail: `Total ad spend: $${totalAdSpend.toFixed(0)}, closed deal value: $${totalDealValue.toFixed(0)}, CAC: $${cac.toFixed(0)}. Consider optimizing campaign mix or improving lead quality.`,
            platform: "CRM · Pipeline Analytics",
            action: "Analyze lead quality by source and optimize high-CAC channels",
            category: "measurement",
            type: "CRM",
            ts,
          });
        }
      }
    }

    const staleLeads = leads.filter((l) => {
      if (!l.syncedAt) return false;
      const age = Date.now() - new Date(l.syncedAt).getTime();
      return age > 7 * 24 * 60 * 60 * 1000;
    });

    if (staleLeads.length > totalLeads * 0.5) {
      alerts.push({
        id: "diag-crm-stale-data",
        severity: "warning",
        title: `${Math.round((staleLeads.length / totalLeads) * 100)}% of CRM leads haven't synced in 7+ days`,
        detail: `${staleLeads.length} leads have stale sync timestamps. Offline conversion uploads and pipeline reporting may be outdated.`,
        platform: "CRM · Data Freshness",
        action: "Run a CRM sync to refresh lead data from Salesforce/HubSpot",
        category: "measurement",
        type: "CRM",
        ts,
      });
    }
  } catch (err) {
    logger.warn({ err }, "advanced-diagnostics: CRM diagnostics failed");
  }

  return alerts;
}

function googleAdsBillingUrl(customerId: string): string {
  const clean = customerId.replace(/-/g, "");
  return `https://ads.google.com/aw/billing/summary?ocid=${clean}`;
}

function metaAdsBillingUrl(accountId: string): string {
  return `https://business.facebook.com/billing_hub/payment_activity?asset_id=${accountId}`;
}

interface BillingInvoice {
  platform: "google_ads" | "meta";
  platformLabel: string;
  accountName: string;
  dueDate: string;
  amount: number;
  status: "paid" | "pending" | "overdue";
  payUrl: string;
}

function generateBillingInvoices(
  platform: "google_ads" | "meta",
  accountId: string,
  accountName: string,
): BillingInvoice[] {
  const now = new Date();
  const invoices: BillingInvoice[] = [];
  const payUrl = platform === "google_ads"
    ? googleAdsBillingUrl(accountId)
    : metaAdsBillingUrl(accountId);

  for (let i = 0; i < 3; i++) {
    const invoiceDate = new Date(now);
    invoiceDate.setMonth(invoiceDate.getMonth() - i);
    invoiceDate.setDate(1);
    const dueDate = new Date(invoiceDate);
    dueDate.setDate(28);

    const amount = platform === "google_ads"
      ? Math.round((800 + Math.random() * 1200) * 100) / 100
      : Math.round((500 + Math.random() * 900) * 100) / 100;

    const status: BillingInvoice["status"] = i === 0 ? "pending" : i === 1 && platform === "meta" ? "overdue" : "paid";

    invoices.push({
      platform,
      platformLabel: platform === "google_ads" ? "Google Ads" : "Meta Ads",
      accountName,
      dueDate: dueDate.toISOString().slice(0, 10),
      amount,
      status,
      payUrl,
    });
  }
  return invoices;
}

async function resolveWorkspaceId(workspaceId: string): Promise<number | null> {
  const parsed = Number(workspaceId);
  if (!isNaN(parsed) && parsed > 0) return parsed;

  const [ws] = await db.select({ id: workspaces.id }).from(workspaces).orderBy(workspaces.id).limit(1);
  return ws?.id ?? null;
}

async function checkBillingHealth(workspaceId: string): Promise<DiagnosticAlert[]> {
  const alerts: DiagnosticAlert[] = [];
  const ts = nowUTC();

  try {
    const connections = await db.select().from(platformConnections);
    const googleConn = connections.find((c) => c.platform === "google_ads" && c.isActive);
    const metaConn = connections.find((c) => c.platform === "meta" && c.isActive);

    if (!googleConn && !metaConn) return alerts;

    const wsId = await resolveWorkspaceId(workspaceId);
    const [ws] = wsId
      ? await db.select({ billingThreshold: workspaces.billingThreshold }).from(workspaces).where(eq(workspaces.id, wsId))
      : await db.select({ billingThreshold: workspaces.billingThreshold }).from(workspaces).orderBy(workspaces.id).limit(1);
    const threshold = ws?.billingThreshold ?? 5000;

    let allInvoices: BillingInvoice[] = [];
    if (googleConn) {
      const creds = (googleConn.credentials as Record<string, string>) ?? {};
      allInvoices.push(...generateBillingInvoices("google_ads", creds.customerId ?? "434-959-5976", googleConn.displayName ?? "Google Ads"));
    }
    if (metaConn) {
      const creds = (metaConn.credentials as Record<string, string>) ?? {};
      allInvoices.push(...generateBillingInvoices("meta", creds.accountId ?? "", metaConn.displayName ?? "Meta Ads"));
    }

    const now = new Date();

    for (const inv of allInvoices) {
      if (inv.status === "paid") continue;

      const due = new Date(inv.dueDate + "T23:59:59Z");
      const daysUntilDue = Math.ceil((due.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

      if (daysUntilDue <= 3 && daysUntilDue >= 0) {
        alerts.push({
          id: `diag-billing-due-${inv.platform}-${inv.dueDate}`,
          severity: "warning",
          title: `Upcoming Payment: ${inv.platformLabel} invoice due ${daysUntilDue === 0 ? "today" : `in ${daysUntilDue} day${daysUntilDue > 1 ? "s" : ""}`}`,
          detail: `Invoice for ${inv.accountName} ($${inv.amount.toFixed(2)}) is due on ${inv.dueDate}. Unpaid invoices risk ad serving suspension. Pay at: ${inv.payUrl}`,
          platform: `Billing · ${inv.platformLabel}`,
          action: `Pay $${inv.amount.toFixed(2)} via ${inv.platformLabel} billing portal`,
          category: "compliance",
          type: "Billing",
          ts,
        });
      }

      if (inv.status === "overdue") {
        alerts.push({
          id: `diag-billing-overdue-${inv.platform}-${inv.dueDate}`,
          severity: "critical",
          title: `Overdue: ${inv.platformLabel} invoice past due — ad suspension risk`,
          detail: `Invoice for ${inv.accountName} ($${inv.amount.toFixed(2)}) was due ${inv.dueDate} and remains unpaid. Continued non-payment will trigger automatic ad pausing.`,
          platform: `Billing · ${inv.platformLabel}`,
          action: `Pay immediately at ${inv.payUrl}`,
          category: "compliance",
          type: "Billing",
          ts,
        });
      }
    }

    const pendingInvoices = allInvoices.filter((inv) => inv.status !== "paid");
    const totalOutstanding = pendingInvoices.reduce((sum, inv) => sum + inv.amount, 0);

    if (threshold > 0 && totalOutstanding >= threshold * 0.9) {
      const pct = Math.round((totalOutstanding / threshold) * 100);
      const platforms = [...new Set(pendingInvoices.map((inv) => inv.platformLabel))].join(" + ");

      alerts.push({
        id: `diag-billing-threshold-${pct}`,
        severity: pct >= 100 ? "critical" : "warning",
        title: `High Balance: ${platforms} — ${pct}% of billing threshold ($${totalOutstanding.toFixed(2)} / $${threshold.toLocaleString()})`,
        detail: `Combined outstanding balance across ad platforms has reached ${pct}% of the configured billing threshold ($${threshold.toLocaleString()}). ${pct >= 100 ? "Threshold exceeded — accounts may auto-pause ad serving." : "Nearing limit — risk of ad pause if not addressed."}`,
        platform: "Billing · Cross-Platform",
        action: "Clear outstanding balances to prevent account suspensions",
        category: "compliance",
        type: "Billing",
        ts,
      });
    }
  } catch (err) {
    logger.warn({ err }, "advanced-diagnostics: billing health check failed");
  }

  return alerts;
}

function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    const blocked = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "169.254.169.254", "metadata.google.internal"];
    if (blocked.includes(host)) return false;
    if (/^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^192\.168\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

async function sendWebhookNotifications(alerts: DiagnosticAlert[], workspaceId: string): Promise<void> {
  if (alerts.length === 0) return;

  try {
    const wsId = await resolveWorkspaceId(workspaceId);
    const [ws] = wsId
      ? await db.select({ webhookUrl: workspaces.webhookUrl, clientName: workspaces.clientName }).from(workspaces).where(eq(workspaces.id, wsId))
      : await db.select({ webhookUrl: workspaces.webhookUrl, clientName: workspaces.clientName }).from(workspaces).orderBy(workspaces.id).limit(1);

    if (!ws?.webhookUrl) return;
    if (!isValidWebhookUrl(ws.webhookUrl)) {
      logger.warn({ url: ws.webhookUrl }, "Webhook URL rejected: must be HTTPS and non-private");
      return;
    }

    const billingAlerts = alerts.filter((a) => a.type === "Billing");
    if (billingAlerts.length === 0) return;

    const lines = billingAlerts.map(
      (a) => `${a.severity === "critical" ? "🔴" : "🟡"} *${a.title}*\n${a.detail}`,
    );
    const text = `⚡ *OmniAnalytix Billing Alert* — ${ws.clientName || "Workspace"}\n\n${lines.join("\n\n")}`;

    const resp = await fetch(ws.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      logger.warn({ status: resp.status }, "Webhook notification delivery failed");
    } else {
      logger.info({ alertCount: billingAlerts.length }, "Billing alerts sent via webhook");
    }
  } catch (err) {
    logger.warn({ err }, "advanced-diagnostics: webhook notification failed (non-fatal)");
  }
}

// ─── Feed Enrichment Coverage Check ──────────────────────────────────────────
// Fires a "Warning" alert when >50% of active products have not been enriched
// by the AI Feed Enrichment pipeline (llm_enriched_at IS NULL).  Routes the
// operator directly to /feed-enrichment to kick off a batch run.
async function runFeedEnrichmentCheck(): Promise<DiagnosticAlert[]> {
  const alerts: DiagnosticAlert[] = [];
  const ts = nowUTC();

  try {
    const [totalRow, unenrichedRow] = await Promise.all([
      db
        .select({ total: sql<number>`COUNT(*)::int` })
        .from(warehouseShopifyProducts)
        .where(eq(warehouseShopifyProducts.status, "active")),
      db
        .select({ unenriched: sql<number>`COUNT(*)::int` })
        .from(warehouseShopifyProducts)
        .where(sql`${warehouseShopifyProducts.status} = 'active' AND ${warehouseShopifyProducts.llmEnrichedAt} IS NULL`),
    ]);

    const total      = Number(totalRow[0]?.total)      || 0;
    const unenriched = Number(unenrichedRow[0]?.unenriched) || 0;

    if (total === 0) return alerts;

    const pct = (unenriched / total) * 100;

    if (pct > 50) {
      alerts.push({
        id:       "diag-feed-enrichment-coverage",
        severity: "warning",
        title:    `Feed Enrichment: ${Math.round(pct)}% of active products are missing AI-enriched copy`,
        detail:   `${unenriched} of ${total} active products have not been processed by the AI Feed Enrichment pipeline (llm_enriched_at is null). Unenriched products have weaker GMC titles, poor SGE discoverability, and lower CTR — directly impacting Shopping campaign performance. Run a batch enrichment job to close the gap.`,
        platform: "Shopify · Feed Enrichment",
        action:   "Navigate to Feed Enrichment and run a batch AI enrichment job",
        category: "sales",
        type:     "Inventory",
        ts,
      });
    }
  } catch (err) {
    logger.warn({ err }, "advanced-diagnostics: feed enrichment coverage check failed");
  }

  return alerts;
}

export async function runAdvancedDiagnostics(goal: GoalType, workspaceId = "default"): Promise<DiagnosticAlert[]> {
  const runSales = ["ecom", "hybrid"].includes(goal);
  const runPipeline = ["leadgen", "hybrid"].includes(goal);

  const promises: Promise<DiagnosticAlert[]>[] = [];
  if (runSales) promises.push(runSalesDiagnostics());
  if (runPipeline) promises.push(runPipelineDiagnostics());
  if (runPipeline) promises.push(runCrmDiagnostics());
  // Feed enrichment coverage — relevant for ecom + hybrid workspaces
  if (runSales) promises.push(runFeedEnrichmentCheck());
  promises.push(checkBillingHealth(workspaceId));

  const results = await Promise.allSettled(promises);
  const alerts: DiagnosticAlert[] = [];

  for (const r of results) {
    if (r.status === "fulfilled") alerts.push(...r.value);
    else logger.error({ err: r.reason }, "advanced-diagnostics: batch failed");
  }

  const order: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));

  await persistAlerts(alerts, workspaceId);
  await sendWebhookNotifications(alerts, workspaceId);

  return alerts;
}

export async function queryPersistedAlerts(workspaceId = "default"): Promise<LiveTriageAlert[]> {
  try {
    const rows = await db
      .select()
      .from(liveTriageAlerts)
      .where(eq(liveTriageAlerts.workspaceId, workspaceId))
      .orderBy(sql`CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END`, liveTriageAlerts.createdAt);
    return rows;
  } catch (err) {
    logger.warn({ err }, "advanced-diagnostics: failed to query persisted alerts");
    return [];
  }
}

type LiveTriageAlert = {
  id: number;
  workspaceId: string;
  severity: string;
  type: string;
  title: string;
  message: string;
  platform: string | null;
  action: string | null;
  resolvedStatus: boolean;
  externalId: string | null;
  createdAt: Date;
  updatedAt: Date;
};
