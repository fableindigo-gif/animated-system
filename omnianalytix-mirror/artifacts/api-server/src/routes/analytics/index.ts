import { Router } from "express";
import { getFreshGoogleCredentials } from "../../lib/google-token-refresh";
import { logger } from "../../lib/logger";
import { getOrgId } from "../../middleware/rbac";

const router = Router();

// ─── GET /api/analytics/ga4/revenue-dedupe ────────────────────────────────────
//
// Uses the Google Analytics Data API (GA4) to pull e-commerce revenue broken
// down by session source/medium.  The returned data lets the AI cross-reference
// GA4 Data-Driven Attribution (DDA) revenue against Meta/Google Ads self-
// reported conversions to detect double-counting or attribution gaps.
//
// Query params:
//   property_id  (required)  GA4 property ID, e.g. "123456789"
//   start_date   (optional)  ISO date string, default = 30 days ago
//   end_date     (optional)  ISO date string, default = yesterday

router.get("/ga4/revenue-dedupe", async (req, res) => {
  const propertyId = String(req.query.property_id ?? "").trim();
  if (!propertyId) {
    res.status(400).json({ error: "property_id is required" });
    return;
  }

  const endDate   = String(req.query.end_date   ?? relDate(-1));
  const startDate = String(req.query.start_date ?? relDate(-30));

  try {
    const orgId = getOrgId(req);
    const creds = await getFreshGoogleCredentials("google_ads", orgId);
    if (!creds?.accessToken) {
      res.status(401).json({ error: "Google account not connected or access token unavailable." });
      return;
    }

    const body = {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "sessionSourceMedium" }],
      metrics: [
        { name: "purchaseRevenue" },
        { name: "transactions" },
        { name: "purchaseToViewRate" },
      ],
      orderBys: [{ metric: { metricName: "purchaseRevenue" }, desc: true }],
      limit: 50,
    };

    const resp = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { error?: { message?: string; status?: string } };
      const msg = err?.error?.message ?? resp.statusText;
      logger.error({ status: resp.status, msg }, "GA4 revenue-dedupe error");
      res.status(resp.status).json({ error: `GA4 API error: ${msg}` });
      return;
    }

    const raw = await resp.json() as {
      rows?: Array<{
        dimensionValues: Array<{ value: string }>;
        metricValues: Array<{ value: string }>;
      }>;
      rowCount?: number;
    };

    const rows = (raw.rows ?? []).map((r) => ({
      source_medium:   r.dimensionValues[0]?.value ?? "",
      revenue:         parseFloat(parseFloat(r.metricValues[0]?.value ?? "0").toFixed(2)),
      transactions:    parseInt(r.metricValues[1]?.value ?? "0", 10),
      purchase_rate:   parseFloat((parseFloat(r.metricValues[2]?.value ?? "0") * 100).toFixed(2)),
    }));

    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
    const totalTx      = rows.reduce((s, r) => s + r.transactions, 0);

    logger.info({ propertyId, rowCount: rows.length, totalRevenue }, "GA4 revenue-dedupe OK");

    res.json({
      property_id:    propertyId,
      date_range:     { start: startDate, end: endDate },
      total_revenue:  parseFloat(totalRevenue.toFixed(2)),
      total_transactions: totalTx,
      by_source_medium: rows,
      note: "Revenue is GA4 Data-Driven Attribution (DDA). Cross-reference against platform self-reported to detect double-counting.",
    });
  } catch (err) {
    logger.error({ err }, "GA4 revenue-dedupe route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/analytics/ga4/diagnostic ───────────────────────────────────────
//
// Runs a multi-signal GA4 health check:
//   1. Revenue & conversions by sessionSourceMedium (DDA, last 30 days)
//   2. Traffic quality for top-5 Paid channels:
//      engagementRate, avgSessionDuration, sessions per landing page
//   3. Attribution discrepancy flag if paid source GA4 revenue < param
//
// Query params:
//   property_id  (required)
//   days         (optional, default 30)
//   paid_threshold_pct  (optional, default 15 — flag if discrepancy > this %)

router.get("/ga4/diagnostic", async (req, res) => {
  const propertyId = String(req.query.property_id ?? "").trim();
  if (!propertyId) {
    res.status(400).json({ error: "property_id is required" });
    return;
  }

  const days         = Math.max(1, parseInt(String(req.query.days ?? "30"), 10));
  const endDate      = relDate(-1);
  const startDate    = relDate(-days);

  try {
    const orgId = getOrgId(req);
    const creds = await getFreshGoogleCredentials("google_ads", orgId);
    if (!creds?.accessToken) {
      res.status(401).json({ error: "Google account not connected or access token unavailable." });
      return;
    }

    const ga4Url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
    const headers = { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json" };
    const dateRanges = [{ startDate, endDate }];

    // ── Request 1: Revenue + conversions by sessionSourceMedium ──────────────
    const [revResp, qualityResp] = await Promise.all([
      fetch(ga4Url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          dateRanges,
          dimensions:  [{ name: "sessionSourceMedium" }],
          metrics: [
            { name: "purchaseRevenue" },
            { name: "transactions" },
            { name: "sessions" },
          ],
          orderBys: [{ metric: { metricName: "purchaseRevenue" }, desc: true }],
          limit: 50,
        }),
      }),
      // ── Request 2: Engagement quality for paid landing pages ─────────────
      fetch(ga4Url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          dateRanges,
          dimensions: [
            { name: "landingPagePlusQueryString" },
            { name: "sessionDefaultChannelGroup" },
          ],
          metrics: [
            { name: "engagementRate" },
            { name: "averageSessionDuration" },
            { name: "sessions" },
          ],
          dimensionFilter: {
            orGroup: {
              expressions: [
                { filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { matchType: "CONTAINS", value: "Paid", caseSensitive: false } } },
              ],
            },
          },
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: 10,
        }),
      }),
    ]);

    if (!revResp.ok) {
      const e = await revResp.json().catch(() => ({})) as { error?: { message?: string } };
      res.status(revResp.status).json({ error: `GA4 API error: ${e?.error?.message ?? revResp.statusText}` });
      return;
    }

    const revRaw = await revResp.json() as {
      rows?: Array<{ dimensionValues: Array<{ value: string }>; metricValues: Array<{ value: string }> }>;
    };

    const revRows = (revRaw.rows ?? []).map((r) => ({
      source_medium:  r.dimensionValues[0]?.value ?? "",
      revenue:        parseFloat(parseFloat(r.metricValues[0]?.value ?? "0").toFixed(2)),
      transactions:   parseInt(r.metricValues[1]?.value ?? "0", 10),
      sessions:       parseInt(r.metricValues[2]?.value ?? "0", 10),
    }));

    const totalGa4Revenue = revRows.reduce((s, r) => s + r.revenue, 0);

    // ── Discrepancy flag: paid CPC sources where GA4 revenue is unexpectedly low
    const paidSources = revRows.filter(r =>
      r.source_medium.toLowerCase().includes("cpc") ||
      r.source_medium.toLowerCase().includes("paid") ||
      r.source_medium.toLowerCase().includes("google") ||
      r.source_medium.toLowerCase().includes("facebook") ||
      r.source_medium.toLowerCase().includes("instagram"),
    );
    const paidGa4Revenue = paidSources.reduce((s, r) => s + r.revenue, 0);

    // ── Traffic quality by paid landing pages ─────────────────────────────────
    let qualityRows: Array<{
      landing_page: string;
      channel: string;
      engagement_rate_pct: number;
      avg_session_duration_sec: number;
      sessions: number;
    }> = [];

    if (qualityResp.ok) {
      const qualityRaw = await qualityResp.json() as {
        rows?: Array<{ dimensionValues: Array<{ value: string }>; metricValues: Array<{ value: string }> }>;
      };
      qualityRows = (qualityRaw.rows ?? []).slice(0, 5).map((r) => ({
        landing_page:             r.dimensionValues[0]?.value ?? "",
        channel:                  r.dimensionValues[1]?.value ?? "",
        engagement_rate_pct:      parseFloat((parseFloat(r.metricValues[0]?.value ?? "0") * 100).toFixed(1)),
        avg_session_duration_sec: parseFloat(parseFloat(r.metricValues[1]?.value ?? "0").toFixed(1)),
        sessions:                 parseInt(r.metricValues[2]?.value ?? "0", 10),
      }));
    }

    // ── Quality scoring ───────────────────────────────────────────────────────
    const avgEngagement = qualityRows.length
      ? qualityRows.reduce((s, r) => s + r.engagement_rate_pct, 0) / qualityRows.length
      : null;
    const avgDuration = qualityRows.length
      ? qualityRows.reduce((s, r) => s + r.avg_session_duration_sec, 0) / qualityRows.length
      : null;

    const qualitySignal = avgEngagement !== null
      ? avgEngagement >= 60 && (avgDuration ?? 0) >= 45
        ? "HEALTHY"
        : avgEngagement >= 40
          ? "DEGRADED"
          : "CRITICAL"
      : "UNKNOWN";

    logger.info({ propertyId, totalGa4Revenue, qualitySignal }, "GA4 diagnostic complete");

    res.json({
      property_id:    propertyId,
      date_range:     { start: startDate, end: endDate },
      total_ga4_revenue:   parseFloat(totalGa4Revenue.toFixed(2)),
      total_ga4_paid_revenue: parseFloat(paidGa4Revenue.toFixed(2)),
      revenue_by_source: revRows,
      traffic_quality_signal: qualitySignal,
      avg_paid_engagement_rate_pct: avgEngagement !== null ? parseFloat(avgEngagement.toFixed(1)) : null,
      avg_paid_session_duration_sec: avgDuration !== null ? parseFloat(avgDuration.toFixed(1)) : null,
      top_paid_landing_pages: qualityRows,
      insights: [
        qualitySignal === "CRITICAL"
          ? "⚠️ Paid traffic engagement is critically low — check audience targeting and landing page relevance."
          : qualitySignal === "DEGRADED"
            ? "⚡ Paid traffic engagement is below benchmark — optimize landing pages for conversion intent."
            : "✅ Paid traffic engagement looks healthy.",
        paidGa4Revenue < 100 && totalGa4Revenue > 0
          ? "⚠️ GA4 DDA is recording near-zero paid revenue — verify GA4 conversion tracking and e-commerce setup."
          : null,
      ].filter(Boolean),
    });
  } catch (err) {
    logger.error({ err }, "GA4 diagnostic route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().substring(0, 10);
}

export default router;
