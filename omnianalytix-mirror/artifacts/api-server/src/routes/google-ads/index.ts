import { Router } from "express";
import { sql } from "drizzle-orm";
import { db, platformConnections, workspaces, biAdPerformance, biSystemLogs, ldAdPerformance, hyAdPerformance } from "@workspace/db";
import { eq, and, isNull, desc } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { getFreshGoogleCredentials } from "../../lib/google-token-refresh";
import { decryptCredentials } from "../../lib/credential-helpers";
import { getOrgId } from "../../middleware/rbac";
import { googleAds_getBudgetConstrainedCampaigns } from "../../lib/platform-executors";
import { customerFromCreds, formatGoogleAdsError } from "../../lib/google-ads/client";

const router = Router();

// ─── Shared helpers ───────────────────────────────────────────────────────────

const CHANNEL_MAP: Record<string, string> = {
  SEARCH:           "Google Search",
  SHOPPING:         "Google Shopping",
  DISPLAY:          "Google Display",
  VIDEO:            "Google Video",
  PERFORMANCE_MAX:  "Performance Max",
  SMART:            "Google Smart",
  DISCOVERY:        "Google Discovery",
  MULTI_CHANNEL:    "Multi-Channel",
};

const ECOM_CHANNEL_TYPES = new Set(["SHOPPING", "PERFORMANCE_MAX", "DISPLAY", "VIDEO", "SMART", "DISCOVERY"]);

async function resolveWorkspaceId(orgId: number | null): Promise<number | null> {
  if (orgId == null) return null;
  const rows = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.organizationId, orgId)).limit(1);
  return rows[0]?.id ?? null;
}

// ─── GET /google-ads/campaigns ─────────────────────────────────────────────
router.get("/campaigns", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const connConditions = [eq(platformConnections.platform, "google_ads")];
    connConditions.push(orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId));
    const rows = await db.select().from(platformConnections).where(and(...connConditions));
    if (rows.length === 0 || !rows[0].isActive) {
      res.status(404).json({ error: "Google Ads not connected." });
      return;
    }

    const creds = (await getFreshGoogleCredentials("google_ads", orgId)) ?? decryptCredentials(rows[0].credentials as Record<string, string>);
    if (!creds.customerId) {
      res.status(400).json({ error: "Google Ads Customer ID not configured. Enter it on the Connections page." });
      return;
    }

    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks
      FROM campaign
      WHERE campaign.status = 'ENABLED'
        AND segments.date DURING LAST_30_DAYS
      ORDER BY metrics.cost_micros DESC
      LIMIT 100
    `;

    let gaqlRows: Array<Record<string, unknown>>;
    try {
      const customer = customerFromCreds(creds);
      gaqlRows = (await customer.query(query)) as Array<Record<string, unknown>>;
    } catch (sdkErr) {
      const msg = formatGoogleAdsError(sdkErr);
      logger.warn({ msg }, "Google Ads /campaigns GAQL error");
      res.status(502).json({ error: `Google Ads API error: ${msg}` });
      return;
    }

    const campaigns = gaqlRows.map((r) => {
      const campaign = r.campaign as Record<string, unknown>;
      const metrics  = r.metrics  as Record<string, unknown>;
      return {
        id:          String(campaign?.id ?? ""),
        name:        String(campaign?.name ?? ""),
        status:      String(campaign?.status ?? ""),
        type:        String(campaign?.advertisingChannelType ?? ""),
        spendUsd:    Number(metrics?.costMicros ?? 0) / 1_000_000,
        impressions: Number(metrics?.impressions ?? 0),
        clicks:      Number(metrics?.clicks ?? 0),
      };
    });

    logger.info({ count: campaigns.length }, "GET /google-ads/campaigns");
    res.json({ success: true, count: campaigns.length, campaigns });
  } catch (err) {
    logger.error({ err }, "GET /google-ads/campaigns error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /google-ads/budget-constraints ────────────────────────────────────
router.get("/budget-constraints", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const connConditions = [eq(platformConnections.platform, "google_ads")];
    connConditions.push(orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId));
    const rows = await db.select().from(platformConnections).where(and(...connConditions));
    if (rows.length === 0 || !rows[0].isActive) {
      res.status(404).json({ error: "Google Ads not connected." });
      return;
    }

    const creds = (await getFreshGoogleCredentials("google_ads", orgId)) ?? decryptCredentials(rows[0].credentials as Record<string, string>);
    if (!creds.customerId) {
      res.status(400).json({ error: "Google Ads Customer ID not configured. Enter it on the Connections page." });
      return;
    }

    const customerIdOverride = typeof req.query.customer_id === "string" ? req.query.customer_id : undefined;
    const result = await googleAds_getBudgetConstrainedCampaigns(creds, customerIdOverride);

    if (!result.success) {
      res.status(502).json({
        success: false,
        error: result.message,
        ...(result.data?.raw_error ? { raw_google_ads_error: result.data.raw_error } : {}),
      });
      return;
    }

    logger.info({ count: (result.data as Record<string, unknown>)?.constrained_count }, "GET /google-ads/budget-constraints");
    res.json({ success: true, ...result.data });
  } catch (err) {
    logger.error({ err }, "GET /google-ads/budget-constraints error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /google-ads/sync/status ───────────────────────────────────────────
// Returns connection health and the last time data was synced.
router.get("/sync/status", async (req, res) => {
  try {
    const orgId = getOrgId(req);

    const connConditions = [eq(platformConnections.platform, "google_ads")];
    connConditions.push(orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId));
    const connRows = await db.select().from(platformConnections).where(and(...connConditions));
    const isConnected = connRows.length > 0 && connRows[0].isActive;
    const hasCustomerId = isConnected
      ? !!decryptCredentials(connRows[0].credentials as Record<string, string>).customerId
      : false;

    const wsId = await resolveWorkspaceId(orgId);

    const logConditions = [eq(biSystemLogs.type, "Google Ads Sync")];
    if (wsId != null) logConditions.push(eq(biSystemLogs.workspaceId, wsId));

    const lastLog = await db.select({ createdAt: biSystemLogs.createdAt, message: biSystemLogs.message })
      .from(biSystemLogs)
      .where(and(...logConditions))
      .orderBy(desc(biSystemLogs.createdAt))
      .limit(1);

    res.json({
      connected: isConnected,
      hasCustomerId,
      lastSyncAt: lastLog[0]?.createdAt ?? null,
      lastSyncMessage: lastLog[0]?.message ?? null,
    });
  } catch (err) {
    logger.error({ err }, "GET /google-ads/sync/status error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /google-ads/sync ─────────────────────────────────────────────────
// Pulls last 30 days of Google Ads campaign performance and upserts into all
// three BI ad-performance tables (ecom, leadgen, hybrid).
router.post("/sync", async (req, res) => {
  try {
    const orgId = getOrgId(req);

    // 1. Resolve connection & credentials
    const connConditions = [eq(platformConnections.platform, "google_ads")];
    connConditions.push(orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId));
    const connRows = await db.select().from(platformConnections).where(and(...connConditions));

    if (connRows.length === 0 || !connRows[0].isActive) {
      res.status(404).json({ error: "Google Ads not connected. Authorize on the Connections page first." });
      return;
    }

    const creds = (await getFreshGoogleCredentials("google_ads", orgId)) ?? decryptCredentials(connRows[0].credentials as Record<string, string>);
    if (!creds.customerId) {
      res.status(400).json({ error: "Google Ads Customer ID not configured. Enter it on the Connections page." });
      return;
    }

    // 2. Query via SDK (version-pinned via GOOGLE_ADS_API_VERSION in client.ts)
    const gaqlQuery = `
      SELECT
        segments.date,
        campaign.advertising_channel_type,
        metrics.cost_micros,
        metrics.clicks,
        metrics.impressions,
        metrics.conversions,
        metrics.conversions_value
      FROM campaign
      WHERE segments.date DURING LAST_30_DAYS
        AND metrics.cost_micros > 0
      ORDER BY segments.date, campaign.advertising_channel_type
    `;

    logger.info({ orgId, customerId: creds.customerId }, "POST /google-ads/sync — fetching from API");

    let syncRows: Array<Record<string, unknown>>;
    try {
      const customer = customerFromCreds(creds);
      syncRows = (await customer.query(gaqlQuery)) as Array<Record<string, unknown>>;
    } catch (sdkErr) {
      const errMsg = formatGoogleAdsError(sdkErr);
      logger.warn({ errMsg }, "Google Ads /sync GAQL error");
      res.status(502).json({ error: `Google Ads API error: ${errMsg}` });
      return;
    }

    // 3. Aggregate by (date, channelType)
    type Row = {
      date: string;
      channelType: string;
      channel: string;
      spend: number;
      clicks: number;
      impressions: number;
      conversions: number;
      revenue: number;
    };

    const aggregated = new Map<string, Row>();

    for (const r of syncRows) {
      const segments = r.segments as Record<string, unknown>;
      const campaign = r.campaign as Record<string, unknown>;
      const metrics  = r.metrics  as Record<string, unknown>;
      const date = String(segments?.date ?? "");
      const channelType = String(campaign?.advertisingChannelType ?? "");
      const channel = CHANNEL_MAP[channelType] ?? channelType;
      const key = `${date}|${channelType}`;

      const existing: Row = aggregated.get(key) ?? {
        date, channelType, channel,
        spend: 0, clicks: 0, impressions: 0, conversions: 0, revenue: 0,
      };

      existing.spend       += Number(metrics?.costMicros     ?? 0) / 1_000_000;
      existing.clicks      += Number(metrics?.clicks         ?? 0);
      existing.impressions += Number(metrics?.impressions    ?? 0);
      existing.conversions += Number(metrics?.conversions    ?? 0);
      existing.revenue     += Number(metrics?.conversionsValue ?? 0);

      aggregated.set(key, existing);
    }

    const rows = Array.from(aggregated.values());

    if (rows.length === 0) {
      res.json({ success: true, rows: 0, days: 0, spend: 0, channels: [], message: "No campaign spend data found for the last 30 days." });
      return;
    }

    // 4. Resolve workspace
    const wsId = await resolveWorkspaceId(orgId);

    // 5. Upsert → bi_ad_performance (ecom / Abley's)
    await db.insert(biAdPerformance)
      .values(rows.map((r) => ({
        workspaceId:  wsId,
        date:         r.date,
        channel:      r.channel,
        spend:        r.spend,
        clicks:       Math.round(r.clicks),
        conversions:  Math.round(r.conversions),
        revenue:      r.revenue,
      })))
      .onConflictDoUpdate({
        target: [biAdPerformance.workspaceId, biAdPerformance.date, biAdPerformance.channel],
        set: {
          spend:       sql`EXCLUDED.spend`,
          clicks:      sql`EXCLUDED.clicks`,
          conversions: sql`EXCLUDED.conversions`,
          revenue:     sql`EXCLUDED.revenue`,
        },
      });

    // 6. Upsert → ld_ad_performance (leadgen / Laedgen)
    await db.insert(ldAdPerformance)
      .values(rows.map((r) => ({
        workspaceId:     wsId,
        date:            r.date,
        channel:         r.channel,
        spend:           r.spend,
        clicks:          Math.round(r.clicks),
        impressions:     Math.round(r.impressions),
        formSubmissions: Math.round(r.conversions),
      })))
      .onConflictDoUpdate({
        target: [ldAdPerformance.workspaceId, ldAdPerformance.date, ldAdPerformance.channel],
        set: {
          spend:           sql`EXCLUDED.spend`,
          clicks:          sql`EXCLUDED.clicks`,
          impressions:     sql`EXCLUDED.impressions`,
          formSubmissions: sql`EXCLUDED.form_submissions`,
        },
      });

    // 7. Upsert → hy_ad_performance (hybrid)
    await db.insert(hyAdPerformance)
      .values(rows.map((r) => ({
        workspaceId:      wsId,
        date:             r.date,
        channel:          r.channel,
        campaignType:     ECOM_CHANNEL_TYPES.has(r.channelType) ? "ecom" : "leadgen",
        spend:            r.spend,
        clicks:           Math.round(r.clicks),
        totalConversions: Math.round(r.conversions),
      })))
      .onConflictDoUpdate({
        target: [hyAdPerformance.workspaceId, hyAdPerformance.date, hyAdPerformance.channel, hyAdPerformance.campaignType],
        set: {
          spend:            sql`EXCLUDED.spend`,
          clicks:           sql`EXCLUDED.clicks`,
          totalConversions: sql`EXCLUDED.total_conversions`,
        },
      });

    // 8. Write sync log
    const uniqueDays     = new Set(rows.map((r) => r.date)).size;
    const uniqueChannels = [...new Set(rows.map((r) => r.channel))];
    const totalSpend     = rows.reduce((s, r) => s + r.spend, 0);
    const syncMsg = `Google Ads sync — ${rows.length} channel-day rows · ${uniqueDays} days · $${totalSpend.toFixed(0)} spend · channels: ${uniqueChannels.join(", ")}`;

    await db.insert(biSystemLogs).values({
      workspaceId: wsId,
      type:        "Google Ads Sync",
      message:     syncMsg,
    });

    logger.info({ orgId, rows: rows.length, uniqueDays, totalSpend }, "POST /google-ads/sync complete");

    res.json({
      success:  true,
      rows:     rows.length,
      days:     uniqueDays,
      spend:    totalSpend,
      channels: uniqueChannels,
      message:  syncMsg,
    });
  } catch (err) {
    logger.error({ err }, "POST /google-ads/sync error");
    res.status(500).json({ error: "Internal server error during Google Ads sync" });
  }
});

export default router;
