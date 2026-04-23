import { Router } from "express";
import { db, platformConnections, warehouseGoogleAds } from "@workspace/db";
import { eq, and, isNull, sql } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { getOrgId } from "../../middleware/rbac";
import { decryptCredentials } from "../../lib/credential-helpers";
import { resolveEffectiveTenant, getWarehouseTenantFilter } from "../warehouse/index";

const router = Router();

interface SpendRow {
  date: string;
  spend: number;
  platform: string;
}

interface BillingHubResponse {
  totalOutstanding: number;
  currency: string;
  spendByDay: SpendRow[];
  totalSpend30d: number;
  platforms: {
    google_ads: { connected: boolean; accountId: string | null; spend30d: number; billingUrl: string | null };
    meta: { connected: boolean; accountId: string | null; spend30d: number; billingUrl: string | null };
  };
}

function googleAdsBillingUrl(customerId: string): string {
  const clean = customerId.replace(/-/g, "");
  return `https://ads.google.com/aw/billing/summary?ocid=${clean}`;
}

function metaAdsBillingUrl(accountId: string): string {
  return `https://business.facebook.com/billing_hub/payment_activity?asset_id=${accountId}`;
}

router.get("/invoices", async (req, res) => {
  try {
    const billingOrgId = getOrgId(req);
    const billingOrgScope = billingOrgId != null
      ? sql`(${platformConnections.organizationId} = ${billingOrgId} OR ${platformConnections.organizationId} IS NULL)`
      : isNull(platformConnections.organizationId);
    const connections = await db
      .select()
      .from(platformConnections)
      .where(billingOrgScope);

    const googleConn = connections.find((c) => c.platform === "google_ads" && c.isActive);
    const metaConn = connections.find((c) => c.platform === "meta" && c.isActive);

    const googleCreds = googleConn ? decryptCredentials((googleConn.credentials as Record<string, string>) ?? {}) : {};
    const metaCreds = metaConn ? decryptCredentials((metaConn.credentials as Record<string, string>) ?? {}) : {};
    const googleAccountId = googleCreds.customerId ?? null;
    const metaAccountId = metaCreds.accountId ?? null;

    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 90);
    const tenantId = await resolveEffectiveTenant(billingOrgId);
    const tenantFilter = getWarehouseTenantFilter(tenantId);

    // Phase 3 SQL safety (Apr 2026): use a Drizzle column reference instead
    // of a bare `synced_at`. Even though this query is currently single-table
    // (`from(warehouseGoogleAds)`), an unqualified fragment is the exact
    // footgun pattern that produced "column reference \"synced_at\" is
    // ambiguous" in /api/warehouse/kpis (commit a8804b0). Always qualify.
    const dateFilter = sql`${warehouseGoogleAds.syncedAt} >= NOW() - make_interval(days => ${days})`;

    const campaignSpend = await db
      .select({
        campaignName: warehouseGoogleAds.campaignName,
        spend: sql<number>`COALESCE(SUM(cost_usd), 0)`,
        clicks: sql<number>`COALESCE(SUM(clicks)::int, 0)`,
        impressions: sql<number>`COALESCE(SUM(impressions)::int, 0)`,
        conversions: sql<number>`COALESCE(SUM(conversions), 0)`,
      })
      .from(warehouseGoogleAds)
      .where(and(dateFilter, tenantFilter))
      .groupBy(warehouseGoogleAds.campaignName)
      .orderBy(sql`COALESCE(SUM(cost_usd), 0) DESC`)
      .limit(20);

    const totalGoogleSpend = campaignSpend.reduce((sum, r) => sum + (Number(r.spend) || 0), 0);

    const spendByDay: SpendRow[] = campaignSpend.map((r) => ({
      date: String(r.campaignName),
      spend: Number(r.spend) || 0,
      platform: "google_ads",
    }));

    const response: BillingHubResponse = {
      totalOutstanding: 0,
      currency: googleCreds.currency || "USD",
      spendByDay,
      totalSpend30d: totalGoogleSpend,
      platforms: {
        google_ads: {
          connected: !!googleConn,
          accountId: googleAccountId,
          spend30d: totalGoogleSpend,
          billingUrl: googleAccountId ? googleAdsBillingUrl(googleAccountId) : null,
        },
        meta: {
          connected: !!metaConn,
          accountId: metaAccountId,
          spend30d: 0,
          billingUrl: metaAccountId ? metaAdsBillingUrl(metaAccountId) : null,
        },
      },
    };

    res.json(response);
  } catch (err) {
    logger.error({ err }, "Failed to fetch billing hub invoices");
    res.status(500).json({ error: "Failed to fetch billing data" });
  }
});

export default router;
