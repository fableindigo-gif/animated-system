/**
 * ADK Agent Service — Google Agent Development Kit orchestration layer
 *
 * Initialises a Gemini-backed LlmAgent with OmniAnalytix-specific tools and
 * exposes a single `runAdkAgent` function that handles session lifecycle and
 * returns a structured { output, sessionId, toolCalls } response.
 *
 * Authentication: requires GEMINI_API_KEY environment variable.
 * Sessions: stored in PostgreSQL via DrizzleSessionService (survives restarts).
 *
 * Multi-tenancy: all data-access tools are scoped to the caller's orgId.
 *   Each unique orgId gets its own Runner (and thus its own LlmAgent instance
 *   whose tools close over that orgId). Runners are cached for performance.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod/v3";

// ──────────────────────────────────────────────────────────────────────────────
// FunctionTool parameter-typing adapter
// ──────────────────────────────────────────────────────────────────────────────
// Why this exists:
//   `@google/adk` types `FunctionTool({ parameters })` against
//   `z3.ZodObject<z3.ZodRawShape>` resolved through ITS copy of `zod/v3`. In
//   our pnpm graph, `@google/adk@0.6.1` is hoisted alongside `zod@4.3.6`
//   (which exposes `/v3` as a back-compat surface), while `api-server`'s own
//   `zod` dep is `zod@3.25.76`. Both files resolve `import { z } from "zod/v3"`
//   to the *same JavaScript* at runtime, but TypeScript treats the two
//   `ZodObject` classes as distinct *module identities* (private member
//   `_cached` is "private to a different declaration"), so a `ZodObject`
//   built from one cannot satisfy the type union exported by the other.
//
//   The runtime code is correct — ADK introspects the schema with
//   `zodObjectToSchema` regardless of which zod copy created it. The cast
//   below acknowledges that this is a tooling-only mismatch.
//
//   Tracked as follow-up #106: align the two zod copies (pnpm overrides) and
//   then drop this adapter.
type ToolDef<S extends z.ZodObject<z.ZodRawShape>> = {
  name: string;
  description: string;
  parameters: S;
  execute: (input: unknown) => Promise<unknown> | unknown;
};
function makeTool<S extends z.ZodObject<z.ZodRawShape>>(opts: ToolDef<S>): FunctionTool {
  // The `unknown` hop is the entire purpose of this adapter — see header.
  return new FunctionTool(opts as unknown as ConstructorParameters<typeof FunctionTool>[0]);
}
import {
  LlmAgent,
  Runner,
  FunctionTool,
} from "@google/adk";
import { sql, and, eq, desc, gte, lte, ne, isNull, inArray, lt, ilike, or, type SQL } from "drizzle-orm";
import {
  db,
  warehouseGoogleAds,
  warehouseShopifyProducts,
  liveTriageAlerts,
  platformConnections,
  workspaces,
  adkSessions,
  biAdPerformance,
} from "@workspace/db";
import { drizzleSessionService, startSessionCleanup } from "../lib/adk/drizzle-session-service";
import { logger } from "../lib/logger";
import { notifySessionOwnershipMismatch } from "../lib/security-alerter";
import { getLastHealthResults } from "./system-health-monitor";
import { getFreshGoogleCredentials } from "../lib/google-token-refresh";
import { decryptCredentials } from "../lib/credential-helpers";
import {
  googleAds_getBudgetConstrainedCampaigns,
  googleAds_listCampaigns,
  googleAds_getCampaignDailyTrend,
  googleAds_searchCampaignsByName,
  shopify_getStoreInventoryHealth,
  shopify_getStoreRevenueSummary,
} from "../lib/platform-executors";
import {
  renderPrompt,
  getPromptDescription,
  getToolDescription,
} from "../agents/infrastructure/prompts/loader";
import {
  getOrgGuardrails,
  checkAndIncrementUsage,
  getTodayRowCount,
  getRequestBudget,
  DEFAULT_MAX_LOOKBACK_DAYS,
  DEFAULT_DAILY_ROW_CAP,
} from "../lib/ai-gads-usage";

// ── Per-run async context (carries orgId/tenantId into tool callbacks) ────────

interface AdkRunContext {
  orgId:    number | null;
  tenantId: string;
}

const agentRunContext = new AsyncLocalStorage<AdkRunContext>();

function getRunContext(): AdkRunContext {
  return agentRunContext.getStore() ?? { orgId: null, tenantId: "default" };
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// ── Env guard ─────────────────────────────────────────────────────────────────

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

/** ADK uses "gemini-2.0-flash" as a concise, cost-effective default. */
const DEFAULT_MODEL = "gemini-2.0-flash";

// ── Static tool definitions (no org context needed) ───────────────────────────

/**
 * Tool: get_system_health
 * Returns the latest system health check results from the internal monitor.
 */
const getSystemHealthTool = new FunctionTool({
  name: "get_system_health",
  description: getToolDescription("get_system_health"),
  execute: async (_input: unknown) => {
    try {
      const { results, lastRunAt } = getLastHealthResults();
      const failures = results.filter((r) => !r.ok && !r.detail?.includes("skipped"));
      const status = results.length === 0 ? "pending" : failures.length > 0 ? "degraded" : "operational";
      return {
        status,
        lastRunAt,
        totalChecks: results.length,
        failingChecks: failures.map((f) => ({ check: f.check, detail: f.detail })),
        passingChecks: results.filter((r) => r.ok).length,
      };
    } catch (err) {
      logger.error({ err }, "[ADKAgent] get_system_health tool error");
      return { error: "Failed to retrieve system health data" };
    }
  },
});

/**
 * Tool: list_platform_capabilities
 * Returns a summary of OmniAnalytix platform capabilities.
 */
const listCapabilitiesTool = new FunctionTool({
  name: "list_platform_capabilities",
  description: getToolDescription("list_platform_capabilities"),
  execute: async (_input: unknown) => ({
    modules: [
      "Analytics Dashboard",
      "Google Ads Integration",
      "Shopify Connector",
      "Inventory Management",
      "AI Creative Generation",
      "Live Triage Alerts",
      "Customer CRM",
      "Promo Engine",
      "Compliance Reporting",
      "Multi-tenant Workspaces",
    ],
    aiFeatures: [
      "RAG-powered chat agents",
      "Gemini-based insights",
      "Autonomous remediation proposals",
      "ADK-orchestrated multi-step workflows",
    ],
  }),
});

// ── Org-scoped tool factory ────────────────────────────────────────────────────

/**
 * Builds the three data-access tools for a specific org.
 * orgId is captured in closure so every DB/API call is automatically scoped.
 * A null orgId is treated as "no org context" — the data tools refuse to
 * execute rather than silently returning cross-tenant data.
 */
export function buildOrgTools(orgId: number | null): FunctionTool[] {
  // ── Fail-closed guard ─────────────────────────────────────────────────────
  // Data tools must not run without an org. All authenticated callers (the
  // /api/ai-agents/run route) pass a guaranteed non-null orgId via requireOrgId.
  const MISSING_ORG = { error: "No organisation context — please sign in to use this feature." };

  // ── platformConnections WHERE condition helper ──────────────────────────────
  function platformWhere(platform: string) {
    const platformEq = eq(platformConnections.platform, platform);
    const activeEq   = eq(platformConnections.isActive, true);
    const orgFilter  = orgId != null
      ? eq(platformConnections.organizationId, orgId)
      : isNull(platformConnections.organizationId);
    return and(platformEq, activeEq, orgFilter);
  }

  // ── Tool: get_capped_campaigns ─────────────────────────────────────────────
  const getCappedCampaignsTool = new FunctionTool({
    name: "get_capped_campaigns",
    description: getToolDescription("get_capped_campaigns"),
    execute: async (_input: unknown) => {
      if (orgId == null) return MISSING_ORG;
      try {
        const creds = await getFreshGoogleCredentials("google_ads", orgId);
        if (!creds) {
          const [conn] = await db
            .select()
            .from(platformConnections)
            .where(platformWhere("google_ads"))
            .limit(1);
          if (!conn) {
            return { error: "Google Ads is not connected. Connect it on the Connections page first." };
          }
          const fallback = decryptCredentials(conn.credentials as Record<string, string>);
          if (!fallback.customerId) {
            return { error: "Google Ads Customer ID not configured. Enter it on the Connections page." };
          }
          const result = await googleAds_getBudgetConstrainedCampaigns(fallback);
          if (!result.success) return { error: result.message };
          return { summary: result.message, ...result.data };
        }
        if (!creds.customerId) {
          return { error: "Google Ads Customer ID not configured. Enter it on the Connections page." };
        }
        const result = await googleAds_getBudgetConstrainedCampaigns(creds);
        if (!result.success) return { error: result.message };
        return { summary: result.message, ...result.data };
      } catch (err) {
        logger.error({ err, orgId }, "[ADKAgent] get_capped_campaigns tool error");
        return { error: "Failed to retrieve capped campaigns data." };
      }
    },
  });

  // ── Tool: get_inventory_alerts ─────────────────────────────────────────────
  const getInventoryAlertsTool = new FunctionTool({
    name: "get_inventory_alerts",
    description: getToolDescription("get_inventory_alerts"),
    execute: async (_input: unknown) => {
      if (orgId == null) return MISSING_ORG;
      try {
        const [conn] = await db
          .select()
          .from(platformConnections)
          .where(platformWhere("shopify"))
          .limit(1);
        if (!conn) {
          return { error: "Shopify is not connected. Connect it on the Connections page first." };
        }
        const creds = decryptCredentials(conn.credentials as Record<string, string>);
        const result = await shopify_getStoreInventoryHealth(creds);
        if (!result.success && !result.data) return { error: result.message };
        return { summary: result.message, ...result.data };
      } catch (err) {
        logger.error({ err, orgId }, "[ADKAgent] get_inventory_alerts tool error");
        return { error: "Failed to retrieve inventory data." };
      }
    },
  });

  // ── Tool: get_recent_triage_events ────────────────────────────────────────
  const getRecentTriageEventsTool = makeTool({
    name: "get_recent_triage_events",
    description: getToolDescription("get_recent_triage_events"),
    parameters: z.object({
      limit: z.number().optional().describe("Maximum number of recent triage alerts to return (default 20, max 50)."),
      unresolved_only: z.boolean().optional().describe("When true, only returns alerts that have not yet been resolved."),
    }),
    execute: async (input: unknown) => {
      if (orgId == null) return MISSING_ORG;
      try {
        const args = (input ?? {}) as { limit?: number; unresolved_only?: boolean };
        const limit = Math.min(Math.max(1, Number(args.limit ?? 20)), 50);
        const unresolvedOnly = args.unresolved_only === true;

        // Build org-scoped WHERE: include system-level "default" workspace alerts
        // AND alerts belonging to any workspace under this org.
        const orgFilter = sql`(
          ${liveTriageAlerts.workspaceId} = 'default'
          OR ${liveTriageAlerts.workspaceId} IN (
            SELECT id::text FROM ${workspaces} WHERE ${workspaces.organizationId} = ${orgId}
          )
        )`;

        const whereClause = unresolvedOnly
          ? and(eq(liveTriageAlerts.resolvedStatus, false), orgFilter)
          : orgFilter;

        const rows = await db
          .select({
            id:         liveTriageAlerts.id,
            severity:   liveTriageAlerts.severity,
            type:       liveTriageAlerts.type,
            title:      liveTriageAlerts.title,
            message:    liveTriageAlerts.message,
            platform:   liveTriageAlerts.platform,
            action:     liveTriageAlerts.action,
            resolved:   liveTriageAlerts.resolvedStatus,
            contextTag: liveTriageAlerts.contextTag,
            createdAt:  liveTriageAlerts.createdAt,
          })
          .from(liveTriageAlerts)
          .where(whereClause)
          .orderBy(desc(liveTriageAlerts.createdAt))
          .limit(limit);

        const criticalCount   = rows.filter((r) => r.severity === "critical").length;
        const warningCount    = rows.filter((r) => r.severity === "warning").length;
        const unresolvedCount = rows.filter((r) => !r.resolved).length;

        return {
          summary: `${rows.length} recent triage alert(s) — ${criticalCount} critical, ${warningCount} warnings, ${unresolvedCount} unresolved.`,
          total_returned:    rows.length,
          critical_count:    criticalCount,
          warning_count:     warningCount,
          unresolved_count:  unresolvedCount,
          alerts: rows.map((r) => ({
            id:         r.id,
            severity:   r.severity,
            type:       r.type,
            title:      r.title,
            message:    r.message,
            platform:   r.platform,
            action:     r.action,
            resolved:   r.resolved,
            contextTag: r.contextTag,
            createdAt:  r.createdAt,
          })),
        };
      } catch (err) {
        logger.error({ err, orgId }, "[ADKAgent] get_recent_triage_events tool error");
        return { error: "Failed to retrieve triage events." };
      }
    },
  });

  // ── Tool: get_campaign_performance ─────────────────────────────────────────
  const getCampaignPerformanceTool = makeTool({
    name: "get_campaign_performance",
    description: getToolDescription("get_campaign_performance"),
    parameters: z.object({
      days: z.number().optional().describe("Lookback window in days (1–365, default 30). Hard-capped to the org's configured maximum (default 180 days) to control Google Ads API quota. Applies to the warehouse fallback and to live Google Ads drill-down/comparison searches by campaign_name(s) — use a wider value (e.g. 180) when asking about paused or older campaigns like 'Black Friday 2024'. The aggregate (no campaign_name) live view always uses the last 30 days of active campaigns."),
      limit: z.number().optional().describe("Maximum number of top campaigns/channels to include in the breakdown (1–50, default 10)."),
      campaign_name: z.string().optional().describe("Optional case-insensitive substring match on the campaign name. When set, the response is narrowed to the matching campaign(s) and includes a daily spend/clicks/conversions/ROAS trend so the agent can give a per-campaign deep dive."),
      campaign_names: z.array(z.string()).optional().describe("Optional list of 2–5 case-insensitive substring filters for side-by-side comparison (e.g. [\"Brand\", \"Performance Max\"]). When supplied, the response is a single comparison payload with per-side metrics, an aligned daily trend across all sides, and side-vs-side deltas — use this for any 'compare X vs Y' prompt instead of calling the tool multiple times."),
    }),
    execute: async (input: unknown) => {
      if (orgId == null) return MISSING_ORG;
      try {
        const args = (input ?? {}) as { days?: number; limit?: number; campaign_name?: string; campaign_names?: string[] };

        // ── Org guardrails (Task #159) ─────────────────────────────────────
        const guardrails = await getOrgGuardrails(orgId);
        const requestedDays  = clampInt(args.days, 30, 1, 365);
        // Hard-cap lookback to org's configured maximum (default 180 days).
        const days           = Math.min(requestedDays, guardrails.maxLookbackDays);
        const windowClamped  = requestedDays > guardrails.maxLookbackDays;

        // Pre-call daily cap check — abort early if already exhausted.
        const todayRowCount = await getTodayRowCount(orgId);
        if (todayRowCount >= guardrails.dailyRowCap) {
          logger.warn({ orgId, todayRowCount, cap: guardrails.dailyRowCap }, "[ADKAgent] Daily Google Ads row cap exceeded — skipping GAQL calls");
          return {
            error:           "daily_cap_exceeded",
            summary:         `Daily Google Ads query limit reached (${guardrails.dailyRowCap.toLocaleString()} rows scanned today). ` +
                             `Resets at midnight UTC. Try again tomorrow, or ask your administrator to raise the daily cap.`,
            rows_read_today: todayRowCount,
            daily_row_cap:   guardrails.dailyRowCap,
          };
        }

        // Per-request budget: limits rows consumed within a single AI question.
        // = min(remaining daily capacity, PER_REQUEST_ROW_CAP).
        const requestBudget = getRequestBudget(todayRowCount, guardrails);
        if (requestBudget <= 0) {
          return {
            error:           "daily_cap_exceeded",
            summary:         `Daily Google Ads query limit reached. Resets at midnight UTC.`,
            rows_read_today: todayRowCount,
            daily_row_cap:   guardrails.dailyRowCap,
          };
        }
        // Running tally of rows consumed this request (for per-request budget).
        let requestRowsUsed = 0;

        const limit = clampInt(args.limit, 10, 1, 50);
        const nameFilterRaw = typeof args.campaign_name === "string" ? args.campaign_name.trim() : "";
        const nameFilter    = nameFilterRaw.length > 0 ? nameFilterRaw.toLowerCase() : null;

        // Normalise comparison filters: trim, drop empties, dedupe (case-insensitive),
        // cap at 5 sides to keep payload compact.
        const compareRaw: string[] = Array.isArray(args.campaign_names)
          ? args.campaign_names
              .map((n) => (typeof n === "string" ? n.trim() : ""))
              .filter((n) => n.length > 0)
          : [];
        const compareDedup: string[] = [];
        const seenLower = new Set<string>();
        for (const n of compareRaw) {
          const k = n.toLowerCase();
          if (seenLower.has(k)) continue;
          seenLower.add(k);
          compareDedup.push(n);
          if (compareDedup.length >= 5) break;
        }
        const compareMode = compareDedup.length >= 2;

        // ── 1. Try live Google Ads first ───────────────────────────────────
        const [conn] = await db
          .select()
          .from(platformConnections)
          .where(platformWhere("google_ads"))
          .limit(1);

        if (conn) {
          const creds = (await getFreshGoogleCredentials("google_ads", orgId))
            ?? decryptCredentials(conn.credentials as Record<string, string>);
          if (creds?.customerId) {
            const result = await googleAds_listCampaigns(creds);
            if (result.success && result.data) {
              const data = result.data as {
                campaigns: Array<{
                  id: string; name: string; status: string; type: string;
                  spend_usd: number; impressions: number; clicks: number; conversions: number;
                  conversion_value_usd: number; roas: number;
                }>;
                count: number;
                total_spend_usd: number;
                total_revenue_usd: number;
                roas: number;
              };

              // Track rows from the initial list call (Task #159).
              const listUsage = await checkAndIncrementUsage(orgId, data.campaigns.length, guardrails);
              requestRowsUsed += data.campaigns.length;
              if (listUsage.capExceeded || requestRowsUsed >= requestBudget) {
                logger.warn({ orgId, rowsAfter: listUsage.rowsAfter, cap: listUsage.dailyRowCap, requestRowsUsed, requestBudget }, "[ADKAgent] Cap/per-request budget hit after list call — aborting further GAQL");
                return {
                  error:           "daily_cap_exceeded",
                  summary:         `Daily Google Ads query limit reached (${listUsage.dailyRowCap.toLocaleString()} rows). Resets at midnight UTC. Ask your administrator to raise the daily cap.`,
                  rows_read_today: listUsage.rowsAfter,
                  daily_row_cap:   listUsage.dailyRowCap,
                };
              }

              // ── Side-by-side comparison branch ───────────────────────────
              if (compareMode) {
                // Per side: matched campaigns + drilled subset (capped).
                const drillCapPerSide = Math.max(1, Math.min(limit, 3));
                type SideMatched = Array<{
                  id: string; name: string; status?: string; type?: string;
                  spend_usd: number; impressions: number; clicks: number;
                  conversions: number; conversion_value_usd?: number; roas?: number;
                }>;
                type SideMeta = {
                  query: string;
                  matched: SideMatched;
                  drillIds: string[];
                };
                // Direct GAQL search per side over the requested window so we
                // can find paused / removed / older campaigns the active-only
                // active-campaigns list (data.campaigns) wouldn't surface.
                const sideSearches = await Promise.all(
                  compareDedup.map((q) => googleAds_searchCampaignsByName(creds, q, { lookbackDays: days, limit: 25 })),
                );
                // Track rows from all side searches (Task #159).
                const sideSearchRowCount = sideSearches.reduce((sum, sr) => {
                  const campaigns = sr.success && sr.data ? ((sr.data as { campaigns: unknown[] }).campaigns ?? []) : [];
                  return sum + campaigns.length;
                }, 0);
                const searchUsage = await checkAndIncrementUsage(orgId, sideSearchRowCount, guardrails);
                requestRowsUsed += sideSearchRowCount;

                // Cap mid-execution: skip expensive trend fetch if limit reached.
                const skipCompareTrend = searchUsage.capExceeded || requestRowsUsed >= requestBudget;
                if (skipCompareTrend) {
                  logger.warn({ orgId, rowsAfter: searchUsage.rowsAfter, cap: searchUsage.dailyRowCap, requestRowsUsed, requestBudget }, "[ADKAgent] Cap/per-request budget hit after side searches — skipping trend GAQL");
                }

                const sideMetas: SideMeta[] = compareDedup.map((q, i) => {
                  const sr = sideSearches[i];
                  const matched: SideMatched = sr.success && sr.data
                    ? ((sr.data as { campaigns: SideMatched }).campaigns ?? [])
                    : [];
                  if (!sr.success) {
                    logger.warn(
                      { orgId, query: q, message: sr.message },
                      "[ADKAgent] get_campaign_performance comparison-side name search failed; side will report 0 matches.",
                    );
                  }
                  return {
                    query:    q,
                    matched,
                    drillIds: matched.slice(0, drillCapPerSide).map((c) => c.id),
                  };
                });

                // Single trend fetch covering every drilled id across all sides
                // (de-duplicated; same id may match more than one filter).
                const allDrillIds = Array.from(new Set(sideMetas.flatMap((s) => s.drillIds)));
                let trendOk = false;
                let trendRows: Array<{
                  campaign_id: string; campaign_name: string; date: string;
                  spend_usd: number; impressions: number; clicks: number;
                  conversions: number; conversions_value_usd: number;
                }> = [];
                if (allDrillIds.length > 0 && !skipCompareTrend) {
                  const trendRes = await googleAds_getCampaignDailyTrend(creds, allDrillIds, days);
                  trendOk = trendRes.success && !!trendRes.data;
                  trendRows = trendOk
                    ? (trendRes.data as { rows: typeof trendRows }).rows
                    : [];
                  if (!trendOk) {
                    logger.warn(
                      { orgId, message: trendRes.message },
                      "[ADKAgent] get_campaign_performance comparison daily-trend fetch failed; per-side aggregates fall back to list totals (no revenue/ROAS).",
                    );
                  }
                  // Track trend rows (Task #159).
                  const trendUsage = await checkAndIncrementUsage(orgId, trendRows.length, guardrails);
                  requestRowsUsed += trendRows.length;
                  void trendUsage; // capExceeded here doesn't block — this is the last GAQL call in compareMode
                }
                const trendByCampaign = new Map<string, typeof trendRows>();
                for (const r of trendRows) {
                  const arr = trendByCampaign.get(r.campaign_id) ?? [];
                  arr.push(r);
                  trendByCampaign.set(r.campaign_id, arr);
                }

                type SideMetrics = {
                  spend_usd: number; clicks: number; impressions: number;
                  conversions: number; revenue_usd: number | null; roas: number | null;
                };
                type SideOut = {
                  query:           string;
                  matched_count:   number;
                  drilldown_count: number;
                  totals_scope:    "all_matched" | "drilldown_subset";
                  has_revenue:     boolean;
                  totals:          SideMetrics;
                  matched_totals:  SideMetrics;
                  campaigns: Array<{
                    id: string; name: string; spend_usd: number; impressions: number;
                    clicks: number; conversions: number; revenue_usd: number | null;
                    roas: number | null; has_daily_trend: boolean;
                    daily_trend: Array<{ date: string; spend_usd: number; clicks: number; conversions: number; conversions_value_usd: number; roas: number }>;
                  }>;
                  daily_trend: Array<{ date: string; spend_usd: number; clicks: number; conversions: number; conversions_value_usd: number; roas: number }>;
                };

                const sidesOut: SideOut[] = sideMetas.map((meta) => {
                  // Drilled per-campaign with trend overlay (mirrors single-name path).
                  const drilledCampaigns = meta.matched.slice(0, drillCapPerSide).map((c) => {
                    const rows = trendByCampaign.get(c.id) ?? [];
                    if (rows.length === 0) {
                      return {
                        id:              c.id,
                        name:            c.name,
                        spend_usd:       parseFloat(c.spend_usd.toFixed(2)),
                        impressions:     c.impressions,
                        clicks:          c.clicks,
                        conversions:     parseFloat(c.conversions.toFixed(2)),
                        revenue_usd:     null,
                        roas:            null,
                        has_daily_trend: false,
                        daily_trend:     [] as Array<{ date: string; spend_usd: number; clicks: number; conversions: number; conversions_value_usd: number; roas: number }>,
                      };
                    }
                    let spend = 0, impressions = 0, clicks = 0, conversions = 0, revenue = 0;
                    const dt: Array<{ date: string; spend_usd: number; clicks: number; conversions: number; conversions_value_usd: number; roas: number }> = [];
                    for (const r of rows) {
                      spend       += r.spend_usd;
                      impressions += r.impressions;
                      clicks      += r.clicks;
                      conversions += r.conversions;
                      revenue     += r.conversions_value_usd;
                      dt.push({
                        date:                  r.date,
                        spend_usd:             r.spend_usd,
                        clicks:                r.clicks,
                        conversions:           r.conversions,
                        conversions_value_usd: r.conversions_value_usd,
                        roas:                  r.spend_usd > 0
                          ? parseFloat((r.conversions_value_usd / r.spend_usd).toFixed(2))
                          : 0,
                      });
                    }
                    return {
                      id:              c.id,
                      name:            rows[0].campaign_name,
                      spend_usd:       parseFloat(spend.toFixed(2)),
                      impressions,
                      clicks,
                      conversions:     parseFloat(conversions.toFixed(2)),
                      revenue_usd:     parseFloat(revenue.toFixed(2)),
                      roas:            spend > 0 ? parseFloat((revenue / spend).toFixed(2)) : 0,
                      has_daily_trend: true,
                      daily_trend:     dt,
                    };
                  });

                  // Side daily trend = sum of drilled-campaign trend rows by date.
                  const dailyAgg = new Map<string, { spend: number; clicks: number; conversions: number; revenue: number }>();
                  for (const c of drilledCampaigns) {
                    for (const d of c.daily_trend) {
                      const cur = dailyAgg.get(d.date) ?? { spend: 0, clicks: 0, conversions: 0, revenue: 0 };
                      cur.spend       += d.spend_usd;
                      cur.clicks      += d.clicks;
                      cur.conversions += d.conversions;
                      cur.revenue     += d.conversions_value_usd;
                      dailyAgg.set(d.date, cur);
                    }
                  }
                  const sideDailyTrend = Array.from(dailyAgg.entries())
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([date, m]) => ({
                      date,
                      spend_usd:             parseFloat(m.spend.toFixed(2)),
                      clicks:                m.clicks,
                      conversions:           parseFloat(m.conversions.toFixed(2)),
                      conversions_value_usd: parseFloat(m.revenue.toFixed(2)),
                      roas: m.spend > 0 ? parseFloat((m.revenue / m.spend).toFixed(2)) : 0,
                    }));

                  // Drilled-subset totals (revenue/ROAS available iff trend hit).
                  const hasRevenue   = drilledCampaigns.some((c) => c.has_daily_trend);
                  const drilledSpend       = drilledCampaigns.reduce((s, c) => s + c.spend_usd, 0);
                  const drilledClicks      = drilledCampaigns.reduce((s, c) => s + c.clicks, 0);
                  const drilledImpressions = drilledCampaigns.reduce((s, c) => s + c.impressions, 0);
                  const drilledConversions = drilledCampaigns.reduce((s, c) => s + c.conversions, 0);
                  const drilledRevenue     = drilledCampaigns.reduce((s, c) => s + (c.revenue_usd ?? 0), 0);

                  // Match-set totals (covers every matched campaign for this side,
                  // even those past the drill cap). No revenue from list endpoint.
                  const matchedSpend       = meta.matched.reduce((s, c) => s + c.spend_usd, 0);
                  const matchedClicks      = meta.matched.reduce((s, c) => s + c.clicks, 0);
                  const matchedImpressions = meta.matched.reduce((s, c) => s + c.impressions, 0);
                  const matchedConversions = meta.matched.reduce((s, c) => s + c.conversions, 0);

                  return {
                    query:           meta.query,
                    matched_count:   meta.matched.length,
                    drilldown_count: drilledCampaigns.length,
                    totals_scope:    meta.matched.length === drilledCampaigns.length ? "all_matched" : "drilldown_subset",
                    has_revenue:     hasRevenue,
                    totals: {
                      spend_usd:   parseFloat(drilledSpend.toFixed(2)),
                      clicks:      drilledClicks,
                      impressions: drilledImpressions,
                      conversions: parseFloat(drilledConversions.toFixed(2)),
                      revenue_usd: hasRevenue ? parseFloat(drilledRevenue.toFixed(2)) : null,
                      roas:        hasRevenue && drilledSpend > 0
                                     ? parseFloat((drilledRevenue / drilledSpend).toFixed(2))
                                     : null,
                    },
                    matched_totals: {
                      spend_usd:   parseFloat(matchedSpend.toFixed(2)),
                      clicks:      matchedClicks,
                      impressions: matchedImpressions,
                      conversions: parseFloat(matchedConversions.toFixed(2)),
                      revenue_usd: null,
                      roas:        null,
                    },
                    campaigns:   drilledCampaigns,
                    daily_trend: sideDailyTrend,
                  };
                });

                // Aligned daily trend across the union of dates from every side.
                const allDates = new Set<string>();
                for (const s of sidesOut) for (const d of s.daily_trend) allDates.add(d.date);
                const sideDailyByDate: Array<Map<string, { spend_usd: number; clicks: number; conversions: number; conversions_value_usd: number; roas: number }>> =
                  sidesOut.map((s) => new Map(s.daily_trend.map((d) => [d.date, d])));
                const alignedDailyTrend = Array.from(allDates)
                  .sort((a, b) => a.localeCompare(b))
                  .map((date) => {
                    const row: Record<string, unknown> = { date };
                    sidesOut.forEach((_, idx) => {
                      const d = sideDailyByDate[idx].get(date);
                      row[`side_${idx}`] = d
                        ? {
                            spend_usd:             d.spend_usd,
                            clicks:                d.clicks,
                            conversions:           d.conversions,
                            conversions_value_usd: d.conversions_value_usd,
                            roas:                  d.roas,
                          }
                        : null;
                    });
                    return row;
                  });

                // Per-metric deltas: each side's value plus pairwise diffs vs side_0.
                const deltaMetric = (
                  pick: (t: SideMetrics) => number | null,
                ) => {
                  const values = sidesOut.map((s) => pick(s.totals));
                  const base   = values[0];
                  const vsBase = values.map((v, idx) => {
                    if (idx === 0) return null;
                    if (v == null || base == null) return null;
                    const abs = parseFloat((v - base).toFixed(2));
                    const pct = base !== 0 ? parseFloat((((v - base) / base) * 100).toFixed(2)) : null;
                    return { abs_diff: abs, pct_diff_vs_side_0: pct };
                  });
                  return { values, vs_side_0: vsBase };
                };
                const deltas = {
                  spend_usd:   deltaMetric((t) => t.spend_usd),
                  clicks:      deltaMetric((t) => t.clicks),
                  impressions: deltaMetric((t) => t.impressions),
                  conversions: deltaMetric((t) => t.conversions),
                  revenue_usd: deltaMetric((t) => t.revenue_usd),
                  roas:        deltaMetric((t) => t.roas),
                };

                const totalMatched = sidesOut.reduce((s, x) => s + x.matched_count, 0);
                // Surface available campaign names so the agent can guide the
                // user to a valid filter when one or more sides matched nothing
                // (mirrors the recovery hint from the single-name drill-down).
                // Pull from a wider, all-status scan so paused/older campaigns
                // (e.g. last year's Black Friday) appear in the suggestions too.
                const anyEmpty = sidesOut.some((s) => s.matched_count === 0);
                let availableCampaignNames: Array<{ name: string; status: string }> | undefined;
                if (anyEmpty && !skipCompareTrend) {
                  const wide = await googleAds_listCampaigns(creds, undefined, {
                    lookbackDays:       guardrails.maxLookbackDays,
                    includeAllStatuses: true,
                    limit:              25,
                  });
                  if (wide.success && wide.data) {
                    const pool = (wide.data as { campaigns: Array<{ name: string; status: string }> }).campaigns ?? [];
                    availableCampaignNames = pool.slice(0, 15).map((c) => ({ name: c.name, status: c.status }));
                    await checkAndIncrementUsage(orgId, pool.length, guardrails);
                    requestRowsUsed += pool.length;
                  } else {
                    availableCampaignNames = data.campaigns.slice(0, 10).map((c) => ({ name: c.name, status: "ENABLED" }));
                  }
                }
                const sideSummaries = sidesOut.map((s, i) => {
                  const r = s.totals.roas;
                  const rev = s.totals.revenue_usd;
                  return `side_${i} "${s.query}" → ${s.matched_count} matched · ` +
                         `spend $${s.totals.spend_usd.toFixed(2)}` +
                         (rev != null ? ` · revenue $${rev.toFixed(2)}` : "") +
                         (r != null ? ` · ROAS ${r.toFixed(2)}x` : "");
                }).join(" | ");
                const trendNote = !trendOk && allDrillIds.length > 0
                  ? " (Daily trend unavailable — Google Ads daily-breakdown call failed; per-side revenue/ROAS not reported.)"
                  : "";
                const windowNote = windowClamped
                  ? ` (Lookback capped at ${days} days by org policy; requested ${requestedDays} days.)`
                  : "";
                const capWarning = searchUsage.nearingCap
                  ? ` Warning: ${searchUsage.rowsAfter.toLocaleString()} of ${searchUsage.dailyRowCap.toLocaleString()} daily Google Ads rows consumed today (${(searchUsage.usageFraction * 100).toFixed(0)}%).`
                  : "";

                return {
                  source:               "google_ads_live",
                  mode:                 "comparison",
                  window_days:          days,
                  window_clamped:       windowClamped,
                  campaign_name_queries: compareDedup,
                  side_count:           sidesOut.length,
                  total_matched_count:  totalMatched,
                  trend_available:      trendOk,
                  summary:
                    `Comparing ${sidesOut.length} campaign group(s) over the last ${days} days (any status) · ${sideSummaries}.` + trendNote + windowNote + capWarning +
                    (anyEmpty ? ` Some sides matched no campaigns — share the available_campaign_names list with the user so they can pick one.` : ""),
                  sides:                sidesOut,
                  aligned_daily_trend:  alignedDailyTrend,
                  deltas,
                  ...(availableCampaignNames ? { available_campaign_names: availableCampaignNames } : {}),
                  ...(searchUsage.nearingCap ? {
                    usage_warning: {
                      rows_read_today: searchUsage.rowsAfter,
                      daily_row_cap:   searchUsage.dailyRowCap,
                      usage_pct:       parseFloat((searchUsage.usageFraction * 100).toFixed(1)),
                    },
                  } : {}),
                };
              }

              // ── Per-campaign drill-down branch ────────────────────────────
              if (nameFilter) {
                // Direct GAQL search by campaign.name over the requested
                // window so we can find paused / removed / older campaigns
                // (e.g. "Black Friday 2024") that the active-only list above
                // would miss. Falls back to the active-list scan if the search
                // call itself errors.
                const searchRes = await googleAds_searchCampaignsByName(creds, nameFilterRaw, {
                  lookbackDays: days,
                  limit:        50,
                });
                let matched: Array<{
                  id: string; name: string; status?: string; type?: string;
                  spend_usd: number; impressions: number; clicks: number;
                  conversions: number; conversion_value_usd?: number; roas?: number;
                }> = [];
                let searchOk = false;
                if (searchRes.success && searchRes.data) {
                  matched  = (searchRes.data as { campaigns: typeof matched }).campaigns ?? [];
                  searchOk = true;
                } else {
                  logger.warn(
                    { orgId, query: nameFilterRaw, message: searchRes.message },
                    "[ADKAgent] get_campaign_performance name-search failed; falling back to active-campaigns substring filter.",
                  );
                  matched = data.campaigns.filter((c) => c.name.toLowerCase().includes(nameFilter));
                }
                // Track rows from name search (Task #159).
                const nameSearchUsage = await checkAndIncrementUsage(orgId, matched.length, guardrails);
                requestRowsUsed += matched.length;

                // Cap mid-execution: skip further GAQL if limit reached.
                if (nameSearchUsage.capExceeded || requestRowsUsed >= requestBudget) {
                  logger.warn({ orgId, rowsAfter: nameSearchUsage.rowsAfter, cap: nameSearchUsage.dailyRowCap, requestRowsUsed, requestBudget }, "[ADKAgent] Cap/per-request budget hit after name search — skipping wide+trend GAQL");
                  return {
                    error:           "daily_cap_exceeded",
                    summary:         `Daily Google Ads query limit reached (${nameSearchUsage.dailyRowCap.toLocaleString()} rows). Resets at midnight UTC. Ask your administrator to raise the daily cap.`,
                    rows_read_today: nameSearchUsage.rowsAfter,
                    daily_row_cap:   nameSearchUsage.dailyRowCap,
                  };
                }

                if (matched.length === 0) {
                  // Surface paused / older campaigns so the user can pick one.
                  // Capped to org max lookback to honour cost guardrails (Task #159).
                  const wide = await googleAds_listCampaigns(creds, undefined, {
                    lookbackDays:       guardrails.maxLookbackDays,
                    includeAllStatuses: true,
                    limit:              25,
                  });
                  if (wide.success && wide.data) {
                    const wideCampaigns = (wide.data as { campaigns: unknown[] }).campaigns ?? [];
                    await checkAndIncrementUsage(orgId, wideCampaigns.length, guardrails);
                    requestRowsUsed += wideCampaigns.length;
                  }
                  const pool = wide.success && wide.data
                    ? ((wide.data as { campaigns: Array<{ name: string; status: string }> }).campaigns ?? [])
                    : data.campaigns.map((c) => ({ name: c.name, status: "ENABLED" }));
                  const nearby = pool.slice(0, 15);
                  const nearbyText = nearby.length > 0
                    ? nearby.map((c) => `${c.name} [${c.status}]`).join(", ")
                    : "none";
                  return {
                    source: "google_ads_live",
                    window_days: days,
                    campaign_name_query: nameFilterRaw,
                    summary: `No campaign matched "${nameFilterRaw}" over the last ${days} days (any status). ` +
                             `Nearby campaigns the user can ask about: ${nearbyText}.`,
                    matched_count: 0,
                    campaigns: [],
                    available_campaigns: nearby,
                    search_ok: searchOk,
                  };
                }

                // Cap the drill-down to keep the response compact.
                const drillSubset = matched.slice(0, Math.min(limit, 5));
                const drillIds    = drillSubset.map((c) => c.id);
                const trendRes    = await googleAds_getCampaignDailyTrend(creds, drillIds, days);
                const trendOk     = trendRes.success && !!trendRes.data;
                const trendRows   = trendOk
                  ? (trendRes.data as { rows: Array<{
                      campaign_id: string; campaign_name: string; date: string;
                      spend_usd: number; impressions: number; clicks: number;
                      conversions: number; conversions_value_usd: number;
                    }> }).rows
                  : [];
                if (!trendOk) {
                  logger.warn(
                    { orgId, message: trendRes.message },
                    "[ADKAgent] get_campaign_performance daily-trend fetch failed; returning list-level aggregates without trend",
                  );
                }
                // Track trend rows (Task #159).
                const drillTrendUsage = await checkAndIncrementUsage(orgId, trendRows.length, guardrails);
                requestRowsUsed += trendRows.length;

                // Seed each drilled campaign with the list-level aggregates so a
                // failed/empty trend fetch doesn't zero them out. If trend rows
                // come back, *replace* the list aggregates with the (more accurate)
                // trend-row sum and add the daily breakdown + revenue/ROAS.
                type DrilledCampaign = {
                  id: string; name: string; spend: number; impressions: number;
                  clicks: number; conversions: number; revenue: number;
                  daily_trend: Array<{ date: string; spend_usd: number; clicks: number; conversions: number; conversions_value_usd: number; roas: number }>;
                  has_trend: boolean;
                  has_revenue: boolean;
                };
                const perCampaign = new Map<string, DrilledCampaign>();
                for (const c of drillSubset) {
                  perCampaign.set(c.id, {
                    id:          c.id,
                    name:        c.name,
                    spend:       c.spend_usd,
                    impressions: c.impressions,
                    clicks:      c.clicks,
                    conversions: c.conversions,
                    revenue:     0,
                    daily_trend: [],
                    has_trend:   false,
                    has_revenue: false,
                  });
                }
                // Bucket trend rows per campaign and overlay them.
                const trendByCampaign = new Map<string, typeof trendRows>();
                for (const r of trendRows) {
                  const arr = trendByCampaign.get(r.campaign_id) ?? [];
                  arr.push(r);
                  trendByCampaign.set(r.campaign_id, arr);
                }
                for (const [id, rows] of trendByCampaign) {
                  const cur = perCampaign.get(id);
                  if (!cur || rows.length === 0) continue;
                  cur.name        = rows[0].campaign_name;
                  cur.spend       = 0;
                  cur.impressions = 0;
                  cur.clicks      = 0;
                  cur.conversions = 0;
                  cur.revenue     = 0;
                  cur.has_trend   = true;
                  cur.has_revenue = true;
                  for (const r of rows) {
                    cur.spend       += r.spend_usd;
                    cur.impressions += r.impressions;
                    cur.clicks      += r.clicks;
                    cur.conversions += r.conversions;
                    cur.revenue     += r.conversions_value_usd;
                    cur.daily_trend.push({
                      date:                  r.date,
                      spend_usd:             r.spend_usd,
                      clicks:                r.clicks,
                      conversions:           r.conversions,
                      conversions_value_usd: r.conversions_value_usd,
                      roas:                  r.spend_usd > 0
                        ? parseFloat((r.conversions_value_usd / r.spend_usd).toFixed(2))
                        : 0,
                    });
                  }
                }

                const campaignsOut = Array.from(perCampaign.values()).map((c) => ({
                  id:           c.id,
                  name:         c.name,
                  spend_usd:    parseFloat(c.spend.toFixed(2)),
                  impressions:  c.impressions,
                  clicks:       c.clicks,
                  conversions:  parseFloat(c.conversions.toFixed(2)),
                  revenue_usd:  c.has_revenue ? parseFloat(c.revenue.toFixed(2)) : null,
                  roas:         c.has_revenue && c.spend > 0
                                  ? parseFloat((c.revenue / c.spend).toFixed(2))
                                  : null,
                  has_daily_trend: c.has_trend,
                  daily_trend:  c.daily_trend,
                }));

                // Drilled-subset totals (what's shown in `campaigns`).
                const drilledSpend       = campaignsOut.reduce((s, c) => s + c.spend_usd, 0);
                const drilledClicks      = campaignsOut.reduce((s, c) => s + c.clicks, 0);
                const drilledConversions = campaignsOut.reduce((s, c) => s + c.conversions, 0);
                const drilledRevenue     = campaignsOut.reduce((s, c) => s + (c.revenue_usd ?? 0), 0);
                const drilledRoas        = drilledSpend > 0 && campaignsOut.some((c) => c.revenue_usd != null)
                                              ? drilledRevenue / drilledSpend
                                              : null;

                // Full match-set totals (covers all matched campaigns, even those
                // beyond the drill-down cap). Computed from the list response so
                // they're available regardless of trend success — but no revenue/
                // ROAS here because the list call doesn't return conversion value.
                const matchedSpend       = matched.reduce((s, c) => s + c.spend_usd, 0);
                const matchedClicks      = matched.reduce((s, c) => s + c.clicks, 0);
                const matchedImpressions = matched.reduce((s, c) => s + c.impressions, 0);
                const matchedConversions = matched.reduce((s, c) => s + c.conversions, 0);

                const totalsScope = matched.length === campaignsOut.length
                  ? "all_matched"
                  : "drilldown_subset";
                const drilldownExplanation = matched.length > campaignsOut.length
                  ? ` Daily trend + revenue/ROAS shown for the top ${campaignsOut.length} of ${matched.length} matched campaign(s) by spend; the remaining ${matched.length - campaignsOut.length} are summarised in matched_totals only.`
                  : "";
                const trendNote = !trendOk
                  ? " (Daily trend unavailable — Google Ads daily-breakdown call failed; per-campaign aggregates fall back to the active-campaigns summary, so revenue/ROAS are not reported.)"
                  : "";
                const windowNote = windowClamped
                  ? ` (Lookback capped at ${days} days by org policy; requested ${requestedDays} days.)`
                  : "";
                const drillCapWarning = drillTrendUsage.nearingCap
                  ? ` Warning: ${drillTrendUsage.rowsAfter.toLocaleString()} of ${drillTrendUsage.dailyRowCap.toLocaleString()} daily Google Ads rows consumed today (${(drillTrendUsage.usageFraction * 100).toFixed(0)}%).`
                  : nameSearchUsage.nearingCap
                    ? ` Warning: ${nameSearchUsage.rowsAfter.toLocaleString()} of ${nameSearchUsage.dailyRowCap.toLocaleString()} daily Google Ads rows consumed today (${(nameSearchUsage.usageFraction * 100).toFixed(0)}%).`
                    : "";

                return {
                  source: "google_ads_live",
                  window_days: days,
                  window_clamped: windowClamped,
                  campaign_name_query: nameFilterRaw,
                  matched_count:   matched.length,
                  drilldown_count: campaignsOut.length,
                  totals_scope:    totalsScope,
                  trend_available: trendOk,
                  summary:
                    `${matched.length} campaign(s) matched "${nameFilterRaw}" (last ${days} days, any status) · ` +
                    `Matched spend $${matchedSpend.toFixed(2)} · ${matchedConversions.toFixed(1)} conversions · ${matchedClicks} clicks.` +
                    drilldownExplanation +
                    trendNote + windowNote + drillCapWarning,
                  // Drilled-subset numbers (match `campaigns` array exactly).
                  total_spend_usd:   parseFloat(drilledSpend.toFixed(2)),
                  total_clicks:      drilledClicks,
                  total_conversions: parseFloat(drilledConversions.toFixed(2)),
                  total_revenue_usd: drilledRoas == null ? null : parseFloat(drilledRevenue.toFixed(2)),
                  roas:              drilledRoas == null ? null : parseFloat(drilledRoas.toFixed(2)),
                  // Always-available totals across every matched campaign.
                  matched_totals: {
                    spend_usd:        parseFloat(matchedSpend.toFixed(2)),
                    clicks:           matchedClicks,
                    impressions:      matchedImpressions,
                    conversions:      parseFloat(matchedConversions.toFixed(2)),
                    revenue_usd:      null,
                    roas:             null,
                    note:             "Aggregates across all matched active campaigns; revenue/ROAS unavailable from the list endpoint.",
                  },
                  campaigns: campaignsOut,
                  ...(drillTrendUsage.nearingCap || nameSearchUsage.nearingCap ? {
                    usage_warning: {
                      rows_read_today: drillTrendUsage.rowsAfter,
                      daily_row_cap:   drillTrendUsage.dailyRowCap,
                      usage_pct:       parseFloat((drillTrendUsage.usageFraction * 100).toFixed(1)),
                    },
                  } : {}),
                };
              }

              // ── Aggregate (no name filter) ─────────────────────────────────
              const totalClicks      = data.campaigns.reduce((s, c) => s + c.clicks, 0);
              const totalImpressions = data.campaigns.reduce((s, c) => s + c.impressions, 0);
              const totalConversions = data.campaigns.reduce((s, c) => s + c.conversions, 0);
              const totalRevenue     = data.total_revenue_usd ?? 0;
              const roas             = data.roas ?? (data.total_spend_usd > 0 ? totalRevenue / data.total_spend_usd : 0);
              const roasNote         = totalRevenue === 0
                ? " (Revenue is $0 — either no converting traffic in this window, or conversion value tracking is not configured in Google Ads.)"
                : "";
              const aggCapWarning = listUsage.nearingCap
                ? ` Warning: ${listUsage.rowsAfter.toLocaleString()} of ${listUsage.dailyRowCap.toLocaleString()} daily Google Ads rows consumed today (${(listUsage.usageFraction * 100).toFixed(0)}%).`
                : "";
              return {
                source: "google_ads_live",
                window_days: 30,
                summary:
                  `${data.count} active campaign(s) over the last 30 days · ` +
                  `Spend $${data.total_spend_usd.toFixed(2)} · ` +
                  `Revenue $${totalRevenue.toFixed(2)} · ROAS ${roas.toFixed(2)}x · ` +
                  `${totalConversions.toFixed(1)} conversions · ` +
                  `${totalClicks} clicks.${roasNote}${aggCapWarning}`,
                total_spend_usd:   data.total_spend_usd,
                total_clicks:      totalClicks,
                total_impressions: totalImpressions,
                total_conversions: parseFloat(totalConversions.toFixed(1)),
                total_revenue_usd: parseFloat(totalRevenue.toFixed(2)),
                roas:              parseFloat(roas.toFixed(2)),
                campaigns: data.campaigns.slice(0, limit),
                ...(listUsage.nearingCap ? {
                  usage_warning: {
                    rows_read_today: listUsage.rowsAfter,
                    daily_row_cap:   listUsage.dailyRowCap,
                    usage_pct:       parseFloat((listUsage.usageFraction * 100).toFixed(1)),
                  },
                } : {}),
              };
            }
            logger.warn({ orgId, message: result.message }, "[ADKAgent] get_campaign_performance live fetch failed, falling back to warehouse");
          }
        }

        // ── 2. Warehouse fallback (biAdPerformance) ────────────────────────
        const wsRows = await db
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(eq(workspaces.organizationId, orgId));
        const wsIds = wsRows.map((w) => w.id);
        if (wsIds.length === 0) {
          return { error: "No workspaces found for this organisation. Connect Google Ads or import warehouse data first." };
        }

        const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
          .toISOString().slice(0, 10);

        const rows = await db
          .select({
            channel:     biAdPerformance.channel,
            spend:       biAdPerformance.spend,
            clicks:      biAdPerformance.clicks,
            conversions: biAdPerformance.conversions,
            revenue:     biAdPerformance.revenue,
          })
          .from(biAdPerformance)
          .where(and(
            inArray(biAdPerformance.workspaceId, wsIds),
            gte(biAdPerformance.date, sinceDate),
          ));

        if (rows.length === 0) {
          return {
            source: "warehouse",
            window_days: days,
            summary: `No campaign performance data found in the warehouse for the last ${days} days.`,
            total_spend_usd: 0, total_clicks: 0, total_conversions: 0, total_revenue_usd: 0, roas: 0,
            campaigns: [],
          };
        }

        // Aggregate per channel (warehouse stores per-channel daily rollups, not per-campaign)
        const byChannel = new Map<string, { spend: number; clicks: number; conversions: number; revenue: number }>();
        for (const r of rows) {
          const cur = byChannel.get(r.channel) ?? { spend: 0, clicks: 0, conversions: 0, revenue: 0 };
          cur.spend       += Number(r.spend ?? 0);
          cur.clicks      += Number(r.clicks ?? 0);
          cur.conversions += Number(r.conversions ?? 0);
          cur.revenue     += Number(r.revenue ?? 0);
          byChannel.set(r.channel, cur);
        }

        let channels = Array.from(byChannel.entries())
          .map(([channel, m]) => ({
            channel,
            spend_usd:   parseFloat(m.spend.toFixed(2)),
            clicks:      m.clicks,
            conversions: m.conversions,
            revenue_usd: parseFloat(m.revenue.toFixed(2)),
            roas:        m.spend > 0 ? parseFloat((m.revenue / m.spend).toFixed(2)) : 0,
          }))
          .sort((a, b) => b.spend_usd - a.spend_usd);

        if (compareMode) {
          // Warehouse rollups are per-channel, not per-campaign. Build a
          // best-effort comparison from the channel-name substring matches.
          // Note: warehouse rows aren't kept per-day after rollup here, so the
          // comparison payload omits aligned_daily_trend in this path.
          type WhSideMetrics = {
            spend_usd: number; clicks: number; conversions: number;
            revenue_usd: number; roas: number;
          };
          type WhSide = {
            query:         string;
            matched_count: number;
            channels:      typeof channels;
            totals:        WhSideMetrics;
          };
          const sidesOut: WhSide[] = compareDedup.map((q) => {
            const ql = q.toLowerCase();
            const matched = channels.filter((c) => c.channel.toLowerCase().includes(ql));
            const spend       = matched.reduce((s, c) => s + c.spend_usd, 0);
            const clicks      = matched.reduce((s, c) => s + c.clicks, 0);
            const conversions = matched.reduce((s, c) => s + c.conversions, 0);
            const revenue     = matched.reduce((s, c) => s + c.revenue_usd, 0);
            return {
              query:         q,
              matched_count: matched.length,
              channels:      matched,
              totals: {
                spend_usd:   parseFloat(spend.toFixed(2)),
                clicks,
                conversions,
                revenue_usd: parseFloat(revenue.toFixed(2)),
                roas:        spend > 0 ? parseFloat((revenue / spend).toFixed(2)) : 0,
              },
            };
          });
          const deltaMetric = (pick: (t: WhSideMetrics) => number) => {
            const values = sidesOut.map((s) => pick(s.totals));
            const base = values[0];
            const vsBase = values.map((v, idx) => {
              if (idx === 0) return null;
              const abs = parseFloat((v - base).toFixed(2));
              const pct = base !== 0 ? parseFloat((((v - base) / base) * 100).toFixed(2)) : null;
              return { abs_diff: abs, pct_diff_vs_side_0: pct };
            });
            return { values, vs_side_0: vsBase };
          };
          const deltas = {
            spend_usd:   deltaMetric((t) => t.spend_usd),
            clicks:      deltaMetric((t) => t.clicks),
            conversions: deltaMetric((t) => t.conversions),
            revenue_usd: deltaMetric((t) => t.revenue_usd),
            roas:        deltaMetric((t) => t.roas),
          };
          const sideSummaries = sidesOut.map((s, i) =>
            `side_${i} "${s.query}" → ${s.matched_count} channel(s) · spend $${s.totals.spend_usd.toFixed(2)} · revenue $${s.totals.revenue_usd.toFixed(2)} · ROAS ${s.totals.roas.toFixed(2)}x`,
          ).join(" | ");
          // Recovery hint when one or more sides matched zero channels.
          const anyEmptyWh = sidesOut.some((s) => s.matched_count === 0);
          const availableChannelNames = anyEmptyWh
            ? channels.slice(0, 10).map((c) => c.channel)
            : undefined;
          return {
            source:                "warehouse",
            mode:                  "comparison",
            window_days:           days,
            campaign_name_queries: compareDedup,
            side_count:            sidesOut.length,
            total_matched_count:   sidesOut.reduce((s, x) => s + x.matched_count, 0),
            // Warehouse rollup is per-channel-per-day-aggregated; we don't
            // re-fetch the per-day rows here, so explicitly flag the trend as
            // unavailable for schema parity with the live-mode payload.
            trend_available:       false,
            aligned_daily_trend:   [],
            summary:
              `Warehouse comparison over the last ${days} days · ${sideSummaries}. ` +
              `Warehouse data is rolled up per channel, not per campaign — connect Google Ads for true per-campaign comparisons with daily trends.` +
              (anyEmptyWh ? ` Some sides matched no channels — share the available_campaign_names list with the user so they can pick one.` : ""),
            sides:                 sidesOut,
            deltas,
            ...(availableChannelNames ? { available_campaign_names: availableChannelNames } : {}),
          };
        }

        if (nameFilter) {
          // Warehouse rollups are per-channel, not per-campaign. Best-effort
          // substring match on the channel name; tell the agent if nothing hit.
          const filtered = channels.filter((c) => c.channel.toLowerCase().includes(nameFilter));
          if (filtered.length === 0) {
            return {
              source: "warehouse",
              window_days: days,
              campaign_name_query: nameFilterRaw,
              summary:
                `No warehouse rows matched "${nameFilterRaw}" (warehouse data is rolled up per channel — ` +
                `available channels: ${channels.slice(0, 10).map((c) => c.channel).join(", ") || "none"}). ` +
                `Connect Google Ads for per-campaign drill-downs.`,
              matched_count: 0,
              campaigns: [],
            };
          }
          channels = filtered;
        }
        channels = channels.slice(0, limit);

        const totalSpend       = channels.reduce((s, c) => s + c.spend_usd, 0);
        const totalClicks      = channels.reduce((s, c) => s + c.clicks, 0);
        const totalConversions = channels.reduce((s, c) => s + c.conversions, 0);
        const totalRevenue     = channels.reduce((s, c) => s + c.revenue_usd, 0);
        const roas             = totalSpend > 0 ? totalRevenue / totalSpend : 0;

        return {
          source: "warehouse",
          window_days: days,
          summary:
            `Last ${days} days · Spend $${totalSpend.toFixed(2)} · ` +
            `Revenue $${totalRevenue.toFixed(2)} · ROAS ${roas.toFixed(2)}x · ` +
            `${totalConversions} conversions across ${channels.length} channel(s).`,
          total_spend_usd:   parseFloat(totalSpend.toFixed(2)),
          total_clicks:      totalClicks,
          total_conversions: totalConversions,
          total_revenue_usd: parseFloat(totalRevenue.toFixed(2)),
          roas:              parseFloat(roas.toFixed(2)),
          campaigns:         channels,
        };
      } catch (err) {
        logger.error({ err, orgId }, "[ADKAgent] get_campaign_performance tool error");
        return { error: "Failed to retrieve campaign performance data." };
      }
    },
  });

  // ── Tool: get_store_revenue_summary ────────────────────────────────────────
  const getStoreRevenueSummaryTool = new FunctionTool({
    // NOTE: ADK tool name kept as `get_store_revenue_summary` to preserve any
    // upstream session/runtime references; the prompt-file lookup key is
    // `omni_get_store_revenue_summary` to disambiguate from the gap-finder /
    // growth-engine variant in `lib/adk/platform-tools.ts` which surfaces a
    // top-5-products + trend payload instead of the 30d/7d snapshot here.
    name: "get_store_revenue_summary",
    description: getToolDescription("omni_get_store_revenue_summary"),
    execute: async (_input: unknown) => {
      if (orgId == null) return MISSING_ORG;
      try {
        const [conn] = await db
          .select()
          .from(platformConnections)
          .where(platformWhere("shopify"))
          .limit(1);
        if (!conn) {
          return { error: "Shopify is not connected. Connect it on the Connections page first." };
        }
        const creds = decryptCredentials(conn.credentials as Record<string, string>);
        const result = await shopify_getStoreRevenueSummary(creds);
        if (!result.success && !result.data) return { error: result.message };
        return { summary: result.message, ...result.data };
      } catch (err) {
        logger.error({ err, orgId }, "[ADKAgent] get_store_revenue_summary tool error");
        return { error: "Failed to retrieve store revenue summary." };
      }
    },
  });

  return [
    getCappedCampaignsTool,
    getInventoryAlertsTool,
    getRecentTriageEventsTool,
    getCampaignPerformanceTool,
    getStoreRevenueSummaryTool,
  ];
}

// ── Runner cache (one runner per orgId) ───────────────────────────────────────

export const APP_NAME = "omni_analytix";

const _runners = new Map<number | null, Runner>();

function getRunner(orgId: number | null): Runner {
  const cached = _runners.get(orgId);
  if (cached) return cached;

  if (!GEMINI_API_KEY) {
    throw new AdkConfigError(
      "GEMINI_API_KEY is not set. Please add it as a secret to enable ADK agent orchestration.",
    );
  }

  const orgTools = buildOrgTools(orgId);

  const agent = new LlmAgent({
    name: "omni_analytix_agent",
    model: DEFAULT_MODEL,
    description: getPromptDescription("omni-assistant"),
    instruction: renderPrompt("omni-assistant"),
    tools: [getSystemHealthTool, listCapabilitiesTool, ...orgTools],
  });

  const runner = new Runner({
    appName:        APP_NAME,
    agent,
    sessionService: drizzleSessionService,
  });

  // Start TTL cleanup once the runner is created (idempotent — setInterval uses unref())
  startSessionCleanup();

  _runners.set(orgId, runner);
  logger.info({ orgId, model: DEFAULT_MODEL, session: "drizzle-pg" }, "[ADKAgent] Runner initialised");
  return runner;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export class AdkConfigError extends Error {
  readonly code = "ADK_CONFIG_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "AdkConfigError";
  }
}

export class AdkRunError extends Error {
  readonly code = "ADK_RUN_ERROR";
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "AdkRunError";
  }
}

export interface AdkRunResult {
  output: string;
  sessionId: string;
  toolCalls: ToolCallRecord[];
  isNewSession: boolean;
}

export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
}

// ── Core run function ─────────────────────────────────────────────────────────

/**
 * Runs the OmniAnalytix ADK agent with the given prompt.
 *
 * @param prompt    - The user message to send to the agent.
 * @param userId    - Authenticated user identifier. Sessions are scoped per
 *                    user so each team member has their own conversation
 *                    history. Required — callers must pass the verified
 *                    identity (e.g. `requireOrgId`-derived rbacUser.id).
 * @param sessionId - Optional existing session ID for multi-turn conversations.
 *                    A new session is created automatically when omitted or
 *                    when the provided ID is not found / not owned by `userId`.
 * @param orgId     - The organisation ID of the authenticated caller.
 *                    Used to scope all data-access tools to the correct tenant
 *                    via the agent run context. Supplied by requireOrgId(req)
 *                    in the route layer.
 * @returns         Structured { output, sessionId, toolCalls }
 */
export async function runAdkAgent(
  prompt: string,
  userId: string,
  sessionId?: string,
  orgId?: number | null,
): Promise<AdkRunResult> {
  if (!userId) {
    throw new AdkRunError("runAdkAgent requires a non-empty userId");
  }
  return agentRunContext.run(
    { orgId: orgId ?? null, tenantId: orgId != null ? String(orgId) : "default" },
    () => runAdkAgentInner(prompt, userId, sessionId, orgId ?? null),
  );
}

async function runAdkAgentInner(
  prompt: string,
  userId: string,
  sessionId: string | undefined,
  orgId: number | null,
): Promise<AdkRunResult> {
  const runner = getRunner(orgId);

  // Resolve or create session — sessions are tenant-scoped to userId so
  // a sessionId belonging to a different user cannot be resumed.
  let resolvedSessionId: string;
  let isNewSession: boolean;
  if (sessionId) {
    const existing = await runner.sessionService.getSession({
      appName: APP_NAME,
      userId,
      sessionId,
    });
    if (existing) {
      resolvedSessionId = sessionId;
      isNewSession = false;
    } else {
      resolvedSessionId = await createNewSession(runner, userId);
      isNewSession = true;
    }
  } else {
    resolvedSessionId = await createNewSession(runner, userId);
    isNewSession = true;
  }

  const newMessage = {
    role:  "user" as const,
    parts: [{ text: prompt }],
  };

  const toolCalls: ToolCallRecord[] = [];
  let outputText = "";

  try {
    const stream = runner.runAsync({
      userId,
      sessionId: resolvedSessionId,
      newMessage,
    });

    for await (const event of stream) {
      const ev = event as unknown as Record<string, unknown>;

      // Collect tool call records
      const fcs = ev["functionCalls"] as Array<Record<string, unknown>> | undefined;
      if (fcs?.length) {
        for (const fc of fcs) {
          toolCalls.push({
            tool:   String(fc["name"] ?? "unknown"),
            args:   (fc["args"] as Record<string, unknown>) ?? {},
            result: null,
          });
        }
      }

      // Pair tool responses back to call records
      const frs = ev["functionResponses"] as Array<Record<string, unknown>> | undefined;
      if (frs?.length) {
        for (const fr of frs) {
          const match = toolCalls.find(
            (tc) => tc.tool === String(fr["name"]) && tc.result === null,
          );
          if (match) match.result = fr["response"];
        }
      }

      // Capture final text from content.parts
      const content = ev["content"] as Record<string, unknown> | undefined;
      const parts = content?.["parts"] as Array<Record<string, unknown>> | undefined;
      if (parts) {
        for (const part of parts) {
          if (part["text"]) outputText += String(part["text"]);
        }
      }

      // Some ADK event shapes surface text directly
      if (ev["text"]) outputText += String(ev["text"]);
    }
  } catch (err) {
    logger.error({ err, sessionId: resolvedSessionId, orgId }, "[ADKAgent] runAsync error");
    const msg = err instanceof Error ? err.message : String(err);
    throw new AdkRunError(`Agent run failed: ${msg}`, err);
  }

  logger.info(
    { sessionId: resolvedSessionId, orgId, toolCallCount: toolCalls.length, outputLength: outputText.length },
    "[ADKAgent] Run complete",
  );

  return {
    output:       outputText.trim() || "(no text output)",
    sessionId:    resolvedSessionId,
    toolCalls,
    isNewSession,
  };
}

async function createNewSession(runner: Runner, userId: string): Promise<string> {
  const session = await runner.sessionService.createSession({
    appName: APP_NAME,
    userId,
  });
  return session.id;
}

/**
 * Generate a smart 5–8 word conversation title from the first user prompt
 * and the first AI reply, then persist it on the session. Designed to be
 * called fire-and-forget (errors are logged, never rethrown).
 */
export async function generateSmartTitle(
  userId: string,
  sessionId: string,
  userPrompt: string,
  aiReply: string,
): Promise<void> {
  try {
    const { ai } = await import("@workspace/integrations-gemini-ai");

    const titlePrompt = [
      "You are a conversation labeller. Your task is to produce a concise, descriptive title for a chat session.",
      "Rules:",
      "- Output ONLY the title — no quotes, no punctuation at the end, no explanation.",
      "- 5 to 8 words maximum.",
      "- Use title case.",
      "- Capture the main topic or intent of the exchange.",
      "",
      `User message: ${userPrompt.slice(0, 500)}`,
      `Assistant reply (first 300 chars): ${aiReply.slice(0, 300)}`,
    ].join("\n");

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: titlePrompt }] }],
      config: { maxOutputTokens: 32, temperature: 0.4 },
    });

    const rawTitle = response.text?.trim() ?? "";
    // Strip surrounding quotes the model sometimes adds, and trailing punctuation
    let cleanTitle = rawTitle.replace(/^["']|["']$/g, "").replace(/[.!?]+$/, "").trim();

    // Sanity-check word count (1-word or >10-word responses are likely malformed)
    const wordCount = cleanTitle.split(/\s+/).filter(Boolean).length;
    if (wordCount < 2 || wordCount > 10) {
      // Fall back to truncating the user prompt — still better than a raw first message
      cleanTitle = userPrompt.slice(0, 60).trim();
      if (cleanTitle.length === 60) cleanTitle = `${cleanTitle.slice(0, 57)}…`;
      logger.warn({ sessionId, rawTitle, wordCount }, "[ADKAgent] generateSmartTitle: model output out of range, using prompt fallback");
    }

    if (!cleanTitle) {
      logger.warn({ sessionId }, "[ADKAgent] generateSmartTitle: no usable title produced, skipping update");
      return;
    }

    // Race-condition guard: only write if no title has been set yet (prevents
    // overwriting a manual rename that happened while generation was in-flight)
    const current = await db
      .select({ title: adkSessions.title })
      .from(adkSessions)
      .where(and(
        eq(adkSessions.id,      sessionId),
        eq(adkSessions.appName, APP_NAME),
        eq(adkSessions.userId,  userId),
      ))
      .limit(1);

    if (current.length > 0 && current[0].title != null) {
      logger.info({ sessionId }, "[ADKAgent] generateSmartTitle: session already has a title, skipping");
      return;
    }

    await updateAdkSession(userId, sessionId, { title: cleanTitle });
    logger.info({ sessionId, title: cleanTitle }, "[ADKAgent] Smart title stored");
  } catch (err) {
    logger.warn({ err, sessionId }, "[ADKAgent] generateSmartTitle failed — title not updated");
  }
}

// ── Session listing / retrieval (per-user) ───────────────────────────────────

export interface AdkSessionSummary {
  sessionId:  string;
  title:      string;
  createdAt:  string;
  updatedAt:  string;
  eventCount: number;
  pinned:     boolean;
  archived:   boolean;
}

export interface AdkSessionMessage {
  role:      "user" | "assistant" | "system";
  text:      string;
  timestamp: number | null;
}

export interface AdkSessionDetail extends AdkSessionSummary {
  messages: AdkSessionMessage[];
}

/**
 * Derive a short title from the first user message in the session events.
 * Falls back to "Untitled conversation" when no user text exists yet.
 */
function deriveTitle(events: unknown[]): string {
  for (const ev of events) {
    const e = ev as Record<string, unknown>;
    const content = e["content"] as Record<string, unknown> | undefined;
    const role    = (content?.["role"] as string | undefined) ?? (e["role"] as string | undefined);
    if (role !== "user") continue;
    const parts = content?.["parts"] as Array<Record<string, unknown>> | undefined;
    const text  = parts?.map((p) => (p["text"] as string | undefined) ?? "").join("").trim();
    if (text) return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  }
  return "Untitled conversation";
}

function eventsToMessages(events: unknown[]): AdkSessionMessage[] {
  const out: AdkSessionMessage[] = [];
  for (const ev of events) {
    const e        = ev as Record<string, unknown>;
    const content  = e["content"] as Record<string, unknown> | undefined;
    const rawRole  = (content?.["role"] as string | undefined) ?? (e["role"] as string | undefined) ?? "assistant";
    const parts    = (content?.["parts"] as Array<Record<string, unknown>> | undefined) ?? [];
    const text     = parts.map((p) => (p["text"] as string | undefined) ?? "").join("").trim();
    if (!text) continue;
    const role: AdkSessionMessage["role"] =
      rawRole === "user" ? "user" : rawRole === "system" ? "system" : "assistant";
    const ts = e["timestamp"];
    out.push({
      role,
      text,
      timestamp: typeof ts === "number" ? ts : null,
    });
  }
  return out;
}

export type AdkSessionDateRange = "today" | "week" | "older";

export interface ListAdkSessionsOptions {
  /** Case-insensitive substring filter applied to title and message content. */
  query?:     string;
  /** Restrict by `updatedAt`: today / past 7 days / older than 7 days. */
  dateRange?: AdkSessionDateRange;
  /** Maximum rows to return (default 30, capped at 100). */
  limit?:     number;
  /** Number of rows to skip for pagination (default 0). */
  offset?:    number;
  /** When true, include archived sessions. Default false (archived hidden). */
  includeArchived?: boolean;
}

export interface ListAdkSessionsResult {
  sessions: AdkSessionSummary[];
  total:    number;
  hasMore:  boolean;
}

/**
 * List ADK sessions belonging to the given user, newest first.
 * Tenant-scoped by `userId` — never returns rows from other users.
 *
 * Supports optional case-insensitive substring search across the events
 * payload (which contains both the derived title and full message bodies),
 * a coarse date-range filter on `updatedAt`, and limit/offset pagination.
 *
 * We query the table directly (rather than via the BaseSessionService) so
 * we can preserve the real `createdAt` timestamp; the service's `Session`
 * type only exposes `lastUpdateTime`.
 */
export async function listAdkSessions(
  userId:  string,
  options: ListAdkSessionsOptions = {},
): Promise<ListAdkSessionsResult> {
  if (!userId) throw new AdkRunError("listAdkSessions requires a non-empty userId");

  const limit  = clampInt(options.limit ?? 30, 30, 1, 100);
  const offset = Math.max(0, Math.floor(Number(options.offset ?? 0)) || 0);

  const conditions: (SQL | undefined)[] = [
    eq(adkSessions.appName, APP_NAME),
    eq(adkSessions.userId,  userId),
  ];

  // ── Archived filter (hidden by default) ──────────────────────────────────
  if (!options.includeArchived) {
    conditions.push(isNull(adkSessions.archivedAt));
  }

  // ── Date-range filter on updatedAt ──────────────────────────────────────
  if (options.dateRange) {
    const now = new Date();
    if (options.dateRange === "today") {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      conditions.push(gte(adkSessions.updatedAt, startOfDay));
    } else if (options.dateRange === "week") {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      conditions.push(gte(adkSessions.updatedAt, weekAgo));
    } else if (options.dateRange === "older") {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      conditions.push(lt(adkSessions.updatedAt, weekAgo));
    }
  }

  // ── Search filter: case-insensitive substring across the JSONB events ───
  // The events array contains every message's text, so a single ILIKE on its
  // text representation matches both the derived title (first user message)
  // and message content. drizzle parameterises the value, so user input is
  // safe from SQL injection.
  const trimmedQuery = options.query?.trim() ?? "";
  if (trimmedQuery) {
    const pattern = `%${trimmedQuery}%`;
    conditions.push(sql`${adkSessions.events}::text ILIKE ${pattern}`);
  }

  const whereClause = and(...conditions.filter(Boolean) as SQL[]);

  // ── Total count (for pagination UI) ─────────────────────────────────────
  const totalResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(adkSessions)
    .where(whereClause);
  const total = totalResult[0]?.count ?? 0;

  const rows = await db
    .select({
      id:         adkSessions.id,
      events:     adkSessions.events,
      title:      adkSessions.title,
      pinned:     adkSessions.pinned,
      archivedAt: adkSessions.archivedAt,
      createdAt:  adkSessions.createdAt,
      updatedAt:  adkSessions.updatedAt,
    })
    .from(adkSessions)
    .where(whereClause)
    .orderBy(desc(adkSessions.pinned), desc(adkSessions.updatedAt))
    .limit(limit)
    .offset(offset);

  const sessions = rows.map((row) => {
    const events = (row.events as unknown[]) ?? [];
    return {
      sessionId:  row.id,
      title:      row.title?.trim() ? row.title : deriveTitle(events),
      createdAt:  row.createdAt.toISOString(),
      updatedAt:  row.updatedAt.toISOString(),
      eventCount: events.length,
      pinned:     row.pinned ?? false,
      archived:   row.archivedAt != null,
    };
  });

  return {
    sessions,
    total,
    hasMore: offset + sessions.length < total,
  };
}

// ── Security helpers ──────────────────────────────────────────────────────────

/**
 * Parse the composite ADK userId string (`org:<orgId>:user:<memberId>`) into
 * its component parts for structured logging.  Returns null on unexpected
 * formats so callers can fall back to logging the raw userId.
 */
function parseAdkUserId(userId: string): { orgId: string; memberId: string } | null {
  const m = userId.match(/^org:([^:]+):user:([^:]+)$/);
  if (!m) return null;
  return { orgId: m[1], memberId: m[2] };
}

/**
 * Check whether a session with the given ID exists under ANY user for this
 * app.  Used as a secondary lookup to distinguish "session not found" from
 * "session owned by a different user" for security logging purposes.
 */
async function sessionExistsForAnyUser(sessionId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: adkSessions.userId })
    .from(adkSessions)
    .where(and(
      eq(adkSessions.id,      sessionId),
      eq(adkSessions.appName, APP_NAME),
    ))
    .limit(1);
  return row?.userId ?? null;
}

/**
 * Determine why a scoped session lookup returned nothing.
 * Returns `"ownership_mismatch"` when the session exists under a different
 * user, or `"not_found"` when it does not exist at all.
 *
 * Intended for route-layer logging after getAdkSession / deleteAdkSession
 * returns null / false — call only in the 404 path so the extra query is
 * bounded to the anomalous case.
 */
export async function resolveAdkSessionMissReason(
  userId: string,
  sessionId: string,
): Promise<"not_found" | "ownership_mismatch"> {
  const actualOwner = await sessionExistsForAnyUser(sessionId);
  return actualOwner !== null && actualOwner !== userId
    ? "ownership_mismatch"
    : "not_found";
}

/**
 * Fetch a single ADK session and convert its events into a chat-friendly
 * message list. Returns `null` if the session does not exist or is owned
 * by a different user (the underlying query is scoped by `userId`).
 */
export async function getAdkSession(
  userId: string,
  sessionId: string,
): Promise<AdkSessionDetail | null> {
  if (!userId)    throw new AdkRunError("getAdkSession requires a non-empty userId");
  if (!sessionId) throw new AdkRunError("getAdkSession requires a non-empty sessionId");

  const [row] = await db
    .select({
      id:         adkSessions.id,
      events:     adkSessions.events,
      title:      adkSessions.title,
      pinned:     adkSessions.pinned,
      archivedAt: adkSessions.archivedAt,
      createdAt:  adkSessions.createdAt,
      updatedAt:  adkSessions.updatedAt,
    })
    .from(adkSessions)
    .where(and(
      eq(adkSessions.id,      sessionId),
      eq(adkSessions.appName, APP_NAME),
      eq(adkSessions.userId,  userId),
    ))
    .limit(1);

  if (!row) {
    const actualOwner = await sessionExistsForAnyUser(sessionId);
    if (actualOwner !== null) {
      const parsed = parseAdkUserId(userId);
      const orgId    = parsed?.orgId    ?? userId;
      const memberId = parsed?.memberId ?? userId;
      logger.warn(
        {
          orgId,
          memberId,
          sessionId,
          event: "session_ownership_mismatch",
        },
        "getAdkSession: access attempt for session owned by a different user",
      );
      void notifySessionOwnershipMismatch({
        orgId,
        memberId,
        sessionId,
        source: "getAdkSession",
      });
    }
    return null;
  }

  const events = (row.events as unknown[]) ?? [];

  return {
    sessionId:  row.id,
    title:      row.title?.trim() ? row.title : deriveTitle(events),
    createdAt:  row.createdAt.toISOString(),
    updatedAt:  row.updatedAt.toISOString(),
    eventCount: events.length,
    pinned:     row.pinned ?? false,
    archived:   row.archivedAt != null,
    messages:   eventsToMessages(events),
  };
}

/**
 * Update mutable fields on a session (title / pinned / archived). Tenant-
 * scoped by `userId` — returns null when the session is not owned by the
 * caller. Pass `archived: true` to soft-archive (sets archivedAt = now);
 * pass `archived: false` to restore.
 */
export interface AdkSessionPatch {
  title?:    string | null;
  pinned?:   boolean;
  archived?: boolean;
}

export async function updateAdkSession(
  userId: string,
  sessionId: string,
  patch: AdkSessionPatch,
): Promise<AdkSessionDetail | null> {
  if (!userId)    throw new AdkRunError("updateAdkSession requires a non-empty userId");
  if (!sessionId) throw new AdkRunError("updateAdkSession requires a non-empty sessionId");

  const updates: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const trimmed = typeof patch.title === "string" ? patch.title.trim() : null;
    updates.title = trimmed && trimmed.length > 0 ? trimmed.slice(0, 200) : null;
  }
  if (patch.pinned !== undefined)   updates.pinned     = !!patch.pinned;
  if (patch.archived !== undefined) updates.archivedAt = patch.archived ? new Date() : null;

  if (Object.keys(updates).length === 0) {
    return getAdkSession(userId, sessionId);
  }

  const result = await db
    .update(adkSessions)
    .set(updates)
    .where(and(
      eq(adkSessions.id,      sessionId),
      eq(adkSessions.appName, APP_NAME),
      eq(adkSessions.userId,  userId),
    ))
    .returning({ id: adkSessions.id });

  if (result.length === 0) return null;
  return getAdkSession(userId, sessionId);
}

/**
 * Delete a single ADK session owned by the given user.
 * Returns `false` when nothing was deleted (session not found / not owned).
 */
export async function deleteAdkSession(
  userId: string,
  sessionId: string,
): Promise<boolean> {
  if (!userId)    throw new AdkRunError("deleteAdkSession requires a non-empty userId");
  if (!sessionId) throw new AdkRunError("deleteAdkSession requires a non-empty sessionId");

  // Confirm ownership first (DrizzleSessionService.deleteSession is also
  // userId-scoped, but explicit pre-check keeps the boolean return honest).
  const existing = await drizzleSessionService.getSession({
    appName: APP_NAME,
    userId,
    sessionId,
  });
  if (!existing) {
    const actualOwner = await sessionExistsForAnyUser(sessionId);
    if (actualOwner !== null) {
      const parsed = parseAdkUserId(userId);
      const orgId    = parsed?.orgId    ?? userId;
      const memberId = parsed?.memberId ?? userId;
      logger.warn(
        {
          orgId,
          memberId,
          sessionId,
          event: "session_ownership_mismatch",
        },
        "deleteAdkSession: delete attempt for session owned by a different user",
      );
      void notifySessionOwnershipMismatch({
        orgId,
        memberId,
        sessionId,
        source: "deleteAdkSession",
      });
    }
    return false;
  }

  await drizzleSessionService.deleteSession({
    appName: APP_NAME,
    userId,
    sessionId,
  });
  return true;
}
