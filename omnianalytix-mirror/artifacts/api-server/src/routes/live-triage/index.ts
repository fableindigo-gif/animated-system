import { Router } from "express";
import crypto from "crypto";
import { db, platformConnections, warehouseGoogleAds, warehouseCrossPlatformMapping, warehouseShopifyProducts, liveTriageAlerts, workspaces } from "@workspace/db";
import { eq, gt, sql, and, inArray, isNull } from "drizzle-orm";
import { getFreshGoogleCredentials } from "../../lib/google-token-refresh";
import { getOrgId } from "../../middleware/rbac";
import {
  googleAds_identifyBudgetConstraints,
  googleAds_listCampaigns,
  googleAds_detectAutomationChurn,
  googleAds_detectRoasDrop,
} from "../../lib/platform-executors";
import { logger } from "../../lib/logger";
import { getAlerts } from "../../lib/alert-store";
import { runAdvancedDiagnostics, type DiagnosticAlert, type AlertType } from "../../lib/advanced-diagnostic-engine";
import {
  triageEmitter,
  type TriageEvent,
  registerSseConnection,
  unregisterSseConnection,
  getEventsSince,
} from "../../lib/triage-emitter";
import { verifyAnyToken } from "../auth/gate";
import { sseTicketRateLimit } from "../../middleware/rate-limiter";

const router = Router();

const SSE_TICKET_TTL_MS = 30_000;
const sseTickets = new Map<string, { expiresAt: number; goal: string }>();

setInterval(() => {
  const now = Date.now();
  for (const [id, ticket] of sseTickets) {
    if (ticket.expiresAt < now) sseTickets.delete(id);
  }
}, 60_000);

interface TriageAlert {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  platform: string;
  action?: string;
  type?: AlertType;
  ts: string;
}

function nowUTC() {
  return new Date().toISOString().substring(11, 16) + " UTC";
}

async function buildTriageAlerts(goal: string, organizationId?: number | null): Promise<TriageAlert[]> {
  const alerts: TriageAlert[] = [];

  // ── Google Ads ──────────────────────────────────────────────────────────────
  try {
    const connConditions = [eq(platformConnections.platform, "google_ads")];
    connConditions.push(organizationId != null ? eq(platformConnections.organizationId, organizationId) : isNull(platformConnections.organizationId));
    const [gadsConn] = await db
      .select()
      .from(platformConnections)
      .where(and(...connConditions));

    if (gadsConn?.isActive) {
      const creds = await getFreshGoogleCredentials("google_ads", organizationId);
      if (creds) {
        const ts = nowUTC();

        const [budgetResult, campaignsResult, churnResult, roasDropResult] = await Promise.allSettled([
          googleAds_identifyBudgetConstraints(creds),
          googleAds_listCampaigns(creds),
          googleAds_detectAutomationChurn(creds),
          // ROAS drop: compares last-7-day vs 14-day rolling average per campaign.
          // Using a rolling baseline prevents false alerts from normal daily swings.
          googleAds_detectRoasDrop(creds),
        ]);

        // Budget-constrained campaigns
        if (budgetResult.status === "fulfilled" && budgetResult.value.success) {
          const data = budgetResult.value.data as {
            campaigns: Array<{
              campaign_name: string;
              current_budget_usd: number;
              budget_lost_impression_share: number;
              estimated_missed_revenue_7d: number;
              recommended_budget_increase: number;
              roas: number;
            }>;
          };
          for (const [i, c] of (data.campaigns ?? []).slice(0, 3).entries()) {
            alerts.push({
              id: `gads-budget-${i}`,
              severity: c.budget_lost_impression_share > 30 ? "critical" : "warning",
              title: `"${c.campaign_name}" losing ${c.budget_lost_impression_share}% impressions to budget`,
              detail: `Estimated $${c.estimated_missed_revenue_7d.toFixed(0)} missed revenue over last 7 days (ROAS ${c.roas.toFixed(1)}x). Current daily budget: $${c.current_budget_usd.toFixed(0)}.`,
              platform: "Google Ads",
              action: `Increase daily budget $${c.current_budget_usd.toFixed(0)} → $${c.recommended_budget_increase.toFixed(0)}`,
              ts,
            });
          }
        }

        // Zero-impression campaigns from the campaign list
        if (campaignsResult.status === "fulfilled" && campaignsResult.value.success) {
          const data = campaignsResult.value.data as {
            campaigns: Array<{ name: string; impressions: number; spend_usd: number }>;
          };
          const zeroCampaigns = (data.campaigns ?? []).filter((c) => c.impressions === 0);
          if (zeroCampaigns.length > 0) {
            const names = zeroCampaigns
              .slice(0, 3)
              .map((c) => `"${c.name}"`)
              .join(", ");
            const extra = zeroCampaigns.length > 3 ? ` + ${zeroCampaigns.length - 3} more` : "";
            alerts.push({
              id: "gads-zero-impressions",
              severity: "warning",
              title: `${zeroCampaigns.length} enabled campaign${zeroCampaigns.length > 1 ? "s" : ""} with zero impressions (30d)`,
              detail: `${names}${extra} received no impressions despite being enabled. Check bids, targeting, or ad approval status.`,
              platform: "Google Ads",
              action: "Review targeting, bids, and ad approvals",
              ts,
            });
          }

          // Low spend campaigns (enabled but spending < $1 in 30d — might be broken)
          const nearlySilent = (data.campaigns ?? []).filter(
            (c) => c.impressions > 0 && c.spend_usd < 1,
          );
          if (nearlySilent.length > 0) {
            alerts.push({
              id: "gads-low-spend",
              severity: "info",
              title: `${nearlySilent.length} campaign${nearlySilent.length > 1 ? "s" : ""} active but spending under $1 (30d)`,
              detail: `${nearlySilent.map((c) => `"${c.name}"`).slice(0, 3).join(", ")} have impressions but negligible spend — may be under-optimised.`,
              platform: "Google Ads",
              action: "Review bid strategy and daily budget allocation",
              ts,
            });
          }
        }

        // Automation churn
        if (churnResult.status === "fulfilled" && churnResult.value.success) {
          const data = churnResult.value.data as {
            churn_detected: boolean;
            delta_percentage_points: number;
            ai_share_last_28d: number;
            ai_share_last_7d: number;
            severity?: string;
          };
          if (data.churn_detected) {
            alerts.push({
              id: "gads-automation-churn",
              severity: data.severity === "CRITICAL" ? "critical" : "warning",
              title: `Smart bidding share dropped ${Math.abs(data.delta_percentage_points).toFixed(1)}pp in last 7 days`,
              detail: `AI bidding coverage fell from ${data.ai_share_last_28d}% (28d) to ${data.ai_share_last_7d}% (7d). Manual overrides may be disrupting automation learning.`,
              platform: "Google Ads",
              action: "Re-enable Smart Bidding on affected campaigns",
              ts,
            });
          }
        }

        // ── ROAS Drop — rolling 7-day vs 14-day baseline ──────────────────────
        // Uses a rolling average to prevent false alerts during normal daily
        // fluctuations.  Fires only when the 7-day ROAS is ≥20% below the
        // 14-day rolling average for that specific campaign.
        if (roasDropResult.status === "fulfilled" && roasDropResult.value.success) {
          const data = roasDropResult.value.data as {
            drop_count: number;
            campaigns: Array<{
              campaign_id: string;
              campaign_name: string;
              roas_7d: number;
              roas_14d_baseline: number;
              drop_pct: number;
              spend_7d: number;
            }>;
          };
          for (const [i, c] of (data.campaigns ?? []).slice(0, 3).entries()) {
            alerts.push({
              id: `gads-roas-drop-${c.campaign_id || i}`,
              severity: c.drop_pct >= 40 ? "critical" : "warning",
              title: `"${c.campaign_name}" ROAS dropped ${c.drop_pct}% vs 14-day rolling average`,
              detail: `7-day ROAS: ${c.roas_7d}× vs 14-day baseline: ${c.roas_14d_baseline}×. A ${c.drop_pct}% drop on $${c.spend_7d.toFixed(0)} spend signals a material performance regression — not a normal daily fluctuation. Investigate creative, audience, or bidding changes in the last 7 days.`,
              platform: "Google Ads",
              action: "Review recent creative, audience, and bidding changes for this campaign",
              ts,
            });
          }
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "live-triage: google_ads section failed");
  }

  // ── Scenario C: Cross-platform attribution discrepancy ──────────────────────
  try {
    const adsTenantFilter = organizationId != null
      ? and(gt(warehouseGoogleAds.costUsd, 0), eq(warehouseGoogleAds.tenantId, String(organizationId)))
      : gt(warehouseGoogleAds.costUsd, 0);
    const mapTenantFilter = organizationId != null
      ? eq(warehouseCrossPlatformMapping.tenantId, String(organizationId))
      : undefined;
    const shopifyTenantFilter = organizationId != null
      ? eq(warehouseShopifyProducts.tenantId, String(organizationId))
      : undefined;
    const [adsCount, mapCount, shopifyCount] = await Promise.all([
      db.$count(warehouseGoogleAds, adsTenantFilter),
      db.$count(warehouseCrossPlatformMapping, mapTenantFilter),
      db.$count(warehouseShopifyProducts, shopifyTenantFilter),
    ]);

    if (adsCount > 0 && shopifyCount > 0 && mapCount === 0) {
      alerts.push({
        id: "cross-platform-discrepancy-no-mapping",
        severity: "warning",
        title: "Cross-platform attribution gap ⚠️",
        detail: `${adsCount} ad campaign${adsCount !== 1 ? "s" : ""} are spending but 0 Shopify SKUs are linked. ROAS figures cannot be validated against real revenue — run a full sync to build the SKU-to-ad mapping.`,
        platform: "Cross-Platform",
        action: "Run a full data sync to link ad spend to Shopify revenue",
        ts: nowUTC(),
      });
    } else if (adsCount > 0 && mapCount > 0) {
      // Check if mapped ratio is < 60%: many campaigns with no linked SKUs
      const [{ mappedCampaigns }] = await db
        .select({ mappedCampaigns: sql<number>`count(distinct ${warehouseCrossPlatformMapping.googleAdId})` })
        .from(warehouseCrossPlatformMapping)
        .where(mapTenantFilter);
      const mappedRatio = Number(mappedCampaigns) / adsCount;
      if (mappedRatio < 0.6) {
        const unmapped = adsCount - Number(mappedCampaigns);
        alerts.push({
          id: "cross-platform-discrepancy-partial",
          severity: "warning",
          title: `${unmapped} campaign${unmapped !== 1 ? "s" : ""} missing Shopify attribution ⚠️`,
          detail: `Only ${Math.round(mappedRatio * 100)}% of spending campaigns are linked to Shopify SKUs. Revenue attribution is incomplete — the AI cannot compute true POAS for the remaining campaigns.`,
          platform: "Cross-Platform",
          action: "Re-run sync to map remaining ad campaigns to Shopify products",
          ts: nowUTC(),
        });
      }
    }
  } catch (err) {
    logger.warn({ err }, "live-triage: cross-platform discrepancy check failed");
  }

  // ── Advanced Diagnostic Engine (goal-aware) ──────────────────────────────────
  try {
    const validGoal = (["ecom", "leadgen", "hybrid"] as const).includes(goal as "ecom" | "leadgen" | "hybrid")
      ? (goal as "ecom" | "leadgen" | "hybrid")
      : "ecom";
    const diagnosticAlerts = await runAdvancedDiagnostics(validGoal);
    for (const da of diagnosticAlerts) {
      if (!alerts.some((a) => a.id === da.id)) {
        alerts.push({
          id: da.id,
          severity: da.severity,
          title: da.title,
          detail: da.detail,
          platform: da.platform,
          action: da.action,
          type: da.type,
          ts: da.ts,
        });
      }
    }
  } catch (err) {
    logger.error({ err }, "live-triage: advanced diagnostic engine failed");
  }

  // Merge programmatic alerts injected by webhooks, ETL events, etc.
  const programmaticAlerts = getAlerts();
  for (const pa of programmaticAlerts) {
    if (!alerts.some((a) => a.id === pa.id)) {
      alerts.push(pa);
    }
  }

  const order: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));

  return alerts;
}

// ─── GET /api/live-triage ─────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const decoded = verifyAnyToken(auth.slice(7));
  if (!decoded) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const goal = (req.query.goal as string) || "ecom";
  const orgId = getOrgId(req);
  const alerts = await buildTriageAlerts(goal, orgId);
  res.json({ alerts, refreshedAt: new Date().toISOString() });
});

// ─── POST /api/live-triage/ticket — Issue a short-lived SSE ticket ──────────

router.post("/ticket", sseTicketRateLimit, (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const decoded = verifyAnyToken(auth.slice(7));
  if (!decoded) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const goal = (req.body?.goal as string) || "ecom";
  const ticketId = crypto.randomBytes(32).toString("hex");
  sseTickets.set(ticketId, {
    expiresAt: Date.now() + SSE_TICKET_TTL_MS,
    goal,
  });

  res.json({ ticket: ticketId, expiresIn: SSE_TICKET_TTL_MS / 1000 });
});

// ─── GET /api/live-triage/stream — SSE endpoint for real-time triage ────────

router.get("/stream", async (req, res) => {
  const ticketId = req.query.ticket as string | undefined;
  if (!ticketId) {
    res.status(401).json({ error: "Missing SSE ticket. Use POST /api/live-triage/ticket first." });
    return;
  }

  const ticket = sseTickets.get(ticketId);
  if (!ticket) {
    res.status(401).json({ error: "Invalid or expired SSE ticket." });
    return;
  }

  if (ticket.expiresAt < Date.now()) {
    sseTickets.delete(ticketId);
    res.status(401).json({ error: "SSE ticket has expired. Request a new one." });
    return;
  }

  sseTickets.delete(ticketId);

  const connToken = registerSseConnection();
  if (!connToken) {
    res.status(503).json({
      error: "Too many active SSE connections",
      message: "The server has reached its maximum number of live streams. Please try again later.",
      code: "SSE_CONNECTION_LIMIT",
    });
    return;
  }

  const goal = ticket.goal;
  const lastEventId = req.headers["last-event-id"] as string | undefined;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (event: string, data: unknown, eventId?: string) => {
    let msg = `event: ${event}\n`;
    if (eventId) msg += `id: ${eventId}\n`;
    msg += `data: ${JSON.stringify(data)}\n\n`;
    res.write(msg);
  };

  if (lastEventId) {
    const missed = getEventsSince(lastEventId);
    for (const evt of missed) {
      send(evt.type, evt, evt.eventId);
    }
  }

  try {
    const orgId = getOrgId(req);
    const initialAlerts = await buildTriageAlerts(goal, orgId);
    send("initial", { alerts: initialAlerts, refreshedAt: new Date().toISOString() });
  } catch (err) {
    logger.warn({ err }, "SSE: failed to build initial triage data");
    send("initial", { alerts: [], refreshedAt: new Date().toISOString() });
  }

  const onTriageEvent = (evt: TriageEvent) => {
    send(evt.type, evt, evt.eventId);
  };

  triageEmitter.on("triage", onTriageEvent);

  const heartbeat = setInterval(() => {
    send("heartbeat", { ts: new Date().toISOString() });
  }, 30000);

  req.on("close", () => {
    clearInterval(heartbeat);
    triageEmitter.off("triage", onTriageEvent);
    unregisterSseConnection(connToken);
  });
});

router.patch("/:id/action", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const decoded = verifyAnyToken(auth.slice(7));
  if (!decoded) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const alertId = parseInt(req.params.id, 10);
  if (isNaN(alertId)) {
    res.status(400).json({ error: "Invalid alert ID" });
    return;
  }

  const { action } = req.body as { action?: string };
  const validActions = ["resolve", "snooze", "expected"];
  if (!action || !validActions.includes(action)) {
    res.status(400).json({ error: "action must be one of: resolve, snooze, expected" });
    return;
  }

  try {
    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now };

    if (action === "resolve") {
      updates.resolvedStatus = true;
      updates.contextTag = "resolved";
    } else if (action === "snooze") {
      updates.contextTag = "snoozed";
      updates.snoozedUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    } else if (action === "expected") {
      updates.contextTag = "expected";
      updates.resolvedStatus = true;
    }

    const triageOrgId = getOrgId(req);
    const alertWhere = triageOrgId != null
      ? and(
          eq(liveTriageAlerts.id, alertId),
          inArray(
            liveTriageAlerts.workspaceId,
            db.select({ id: sql<string>`CAST(${workspaces.id} AS TEXT)` }).from(workspaces).where(eq(workspaces.organizationId, triageOrgId))
          )
        )
      : eq(liveTriageAlerts.id, alertId);
    const [updated] = await db
      .update(liveTriageAlerts)
      .set(updates)
      .where(alertWhere)
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Alert not found" });
      return;
    }

    res.json({ ok: true, alert: updated });
  } catch (err) {
    logger.error({ err }, "Failed to update triage alert");
    res.status(500).json({ error: "Failed to update alert" });
  }
});

export default router;
