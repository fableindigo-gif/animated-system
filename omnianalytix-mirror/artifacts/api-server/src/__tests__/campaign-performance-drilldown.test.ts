/**
 * Tests — get_campaign_performance drill-down (campaign_name parameter)
 *
 * Covers the three regression-prone paths in the ADK tool:
 *   (a) Substring match → returns matched campaigns + per-day trend with ROAS.
 *   (b) No match → returns the helpful "available campaigns" message and
 *       includes the wider, all-status nearby pool from the fallback list call.
 *   (c) Warehouse fallback (no live Google Ads connection) honours the
 *       campaign_name filter against channel names and surfaces the
 *       available channel list when nothing matches.
 *
 * All external deps (googleAds_listCampaigns, googleAds_searchCampaignsByName,
 * googleAds_getCampaignDailyTrend, the prompts loader, the DB select and the
 * Google credential helpers) are stubbed so the tests run with no live
 * credentials and no network or DB access.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (registered before importing the subject) ──────────────────────────

// Drizzle DB — chainable select() that resolves to whatever the current test
// queues up via `dbResultsQueue`. Each terminal `await` pops one entry.
const dbResultsQueue: unknown[][] = [];
function makeChain(): unknown {
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  chain.from   = passthrough;
  chain.where  = passthrough;
  chain.limit  = passthrough;
  chain.orderBy = passthrough;
  // Make the chain awaitable.
  (chain as { then: unknown }).then = (
    onFulfilled: (v: unknown) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => {
    const next = dbResultsQueue.shift() ?? [];
    return Promise.resolve(next).then(onFulfilled, onRejected);
  };
  return chain;
}
const mockDbSelect = vi.fn(() => makeChain());

vi.mock("@workspace/db", () => ({
  db: {
    select: (..._args: unknown[]) => mockDbSelect(),
  },
  // Column placeholders — drizzle helpers (eq/and/etc.) are happy with any object.
  warehouseGoogleAds:     {},
  warehouseShopifyProducts: {},
  liveTriageAlerts:       { workspaceId: "workspaceId", resolvedStatus: "resolvedStatus", createdAt: "createdAt", id: "id", severity: "severity", type: "type", title: "title", message: "message", platform: "platform", action: "action", contextTag: "contextTag" },
  platformConnections:    { platform: "platform", isActive: "isActive", organizationId: "organizationId" },
  workspaces:             { id: "id", organizationId: "organizationId" },
  adkSessions:            { id: "id", appName: "appName", userId: "userId", events: "events", createdAt: "createdAt", updatedAt: "updatedAt" },
  biAdPerformance:        { workspaceId: "workspaceId", date: "date", channel: "channel", spend: "spend", clicks: "clicks", conversions: "conversions", revenue: "revenue" },
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/adk/drizzle-session-service", () => ({
  drizzleSessionService: {},
  startSessionCleanup: vi.fn(),
}));

vi.mock("./system-health-monitor", () => ({
  getLastHealthResults: () => ({ results: [], lastRunAt: null }),
}));

vi.mock("../lib/google-token-refresh", () => ({
  getFreshGoogleCredentials: vi.fn(async () => null),
}));

vi.mock("../lib/ai-gads-usage", () => ({
  DEFAULT_MAX_LOOKBACK_DAYS: 180,
  DEFAULT_DAILY_ROW_CAP:     50_000,
  PER_REQUEST_ROW_CAP:       5_000,
  getOrgGuardrails: vi.fn(async () => ({
    maxLookbackDays: 365,
    dailyRowCap:     50_000,
  })),
  getTodayRowCount: vi.fn(async () => 0),
  getRequestBudget: vi.fn((_rowsToday: number, guardrails: { dailyRowCap: number }) =>
    Math.min(guardrails.dailyRowCap, 5_000),
  ),
  checkAndIncrementUsage: vi.fn(async (_orgId: number, rowCount: number, guardrails: { dailyRowCap: number }) => ({
    rowsBefore:    0,
    rowsAfter:     rowCount,
    dailyRowCap:   guardrails.dailyRowCap,
    capExceeded:   false,
    nearingCap:    false,
    usageFraction: rowCount / guardrails.dailyRowCap,
  })),
}));

vi.mock("../lib/credential-helpers", () => ({
  decryptCredentials: (c: Record<string, string>) => c,
}));

// Prompts loader — return cheap stubs so module init doesn't try to read .prompt files.
vi.mock("../agents/infrastructure/prompts/loader", () => ({
  renderPrompt:         () => "stub-prompt",
  getPromptDescription: () => "stub-description",
  getToolDescription:   (name: string) => `stub description for ${name}`,
}));

// Platform executors — the tool calls these for the live Google Ads path.
const mockListCampaigns        = vi.fn();
const mockSearchCampaignsByName = vi.fn();
const mockGetCampaignDailyTrend = vi.fn();
vi.mock("../lib/platform-executors", () => ({
  googleAds_getBudgetConstrainedCampaigns: vi.fn(),
  googleAds_listCampaigns:        (...a: unknown[]) => mockListCampaigns(...a),
  googleAds_getCampaignDailyTrend: (...a: unknown[]) => mockGetCampaignDailyTrend(...a),
  googleAds_searchCampaignsByName: (...a: unknown[]) => mockSearchCampaignsByName(...a),
  shopify_getStoreInventoryHealth: vi.fn(),
  shopify_getStoreRevenueSummary:  vi.fn(),
}));

// ── Subject ───────────────────────────────────────────────────────────────────

import { buildOrgTools } from "../services/adk-agent";

// ── Helpers ───────────────────────────────────────────────────────────────────

const ORG_ID = 7;

/** Locate the get_campaign_performance tool and invoke its execute path. */
async function runTool(args: Record<string, unknown>): Promise<unknown> {
  const tools = buildOrgTools(ORG_ID);
  const tool  = tools.find((t) => t.name === "get_campaign_performance");
  if (!tool) throw new Error("get_campaign_performance tool not registered");
  // ADK's FunctionTool.runAsync validates `args` against the zod schema and
  // forwards them to the registered execute() function. The tool's execute()
  // does not consult toolContext, so a stub is sufficient.
  return tool.runAsync({ args, toolContext: {} as unknown as never });
}

const STUB_CONNECTION = {
  credentials: { customerId: "123-456-7890" } as Record<string, string>,
};

/** Live-path setup: db.select() returns the platformConnections row first. */
function queueLiveConnection() {
  dbResultsQueue.push([STUB_CONNECTION]);
}

/** Warehouse-path setup: no live connection, then workspaces, then bi rows. */
function queueWarehouse(rows: Array<Record<string, unknown>>) {
  // 1st select: platformConnections lookup → empty (no live)
  dbResultsQueue.push([]);
  // 2nd select: workspaces.id rows
  dbResultsQueue.push([{ id: 101 }]);
  // 3rd select: biAdPerformance rows
  dbResultsQueue.push(rows);
}

beforeEach(() => {
  vi.clearAllMocks();
  dbResultsQueue.length = 0;
});

// ── (a) Substring match returns matched campaigns + daily trend ──────────────

describe("get_campaign_performance — campaign_name substring match (live Google Ads)", () => {
  it("returns the matched campaign with a daily trend and computed ROAS", async () => {
    queueLiveConnection();

    // Active-campaigns list (used for the available-campaigns nearby pool when
    // nothing matches; here it's a baseline so the live branch is taken).
    mockListCampaigns.mockResolvedValueOnce({
      success: true,
      data: {
        campaigns: [
          { id: "111", name: "Brand · Search", status: "ENABLED", type: "SEARCH",
            spend_usd: 500, impressions: 10000, clicks: 200, conversions: 10,
            conversion_value_usd: 1500, roas: 3 },
          { id: "222", name: "Black Friday 2024", status: "PAUSED", type: "SHOPPING",
            spend_usd: 200, impressions: 5000, clicks: 80, conversions: 4,
            conversion_value_usd: 600, roas: 3 },
        ],
        count: 2, total_spend_usd: 700, total_revenue_usd: 2100, roas: 3,
      },
    });

    // Direct GAQL search by name → returns the Black Friday match.
    mockSearchCampaignsByName.mockResolvedValueOnce({
      success: true,
      data: {
        campaigns: [
          { id: "222", name: "Black Friday 2024", status: "PAUSED", type: "SHOPPING",
            spend_usd: 200, impressions: 5000, clicks: 80, conversions: 4,
            conversion_value_usd: 600, roas: 3 },
        ],
        count: 1,
      },
    });

    // Per-day trend for the matched campaign id.
    mockGetCampaignDailyTrend.mockResolvedValueOnce({
      success: true,
      data: {
        rows: [
          { campaign_id: "222", campaign_name: "Black Friday 2024",
            date: "2024-11-28", spend_usd: 100, impressions: 2500, clicks: 40,
            conversions: 2, conversions_value_usd: 400 },
          { campaign_id: "222", campaign_name: "Black Friday 2024",
            date: "2024-11-29", spend_usd: 100, impressions: 2500, clicks: 40,
            conversions: 2, conversions_value_usd: 200 },
        ],
      },
    });

    const result = await runTool({ campaign_name: "Black Friday", days: 365 }) as Record<string, unknown>;

    expect(result.source).toBe("google_ads_live");
    expect(result.campaign_name_query).toBe("Black Friday");
    expect(result.matched_count).toBe(1);
    expect(result.drilldown_count).toBe(1);
    expect(result.trend_available).toBe(true);

    const campaigns = result.campaigns as Array<Record<string, unknown>>;
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].id).toBe("222");
    expect(campaigns[0].name).toBe("Black Friday 2024");
    // Trend totals replaced the list-level aggregates: 100+100 = 200 spend,
    // 400+200 = 600 revenue → ROAS 3.0x.
    expect(campaigns[0].spend_usd).toBe(200);
    expect(campaigns[0].revenue_usd).toBe(600);
    expect(campaigns[0].roas).toBe(3);
    expect(campaigns[0].has_daily_trend).toBe(true);

    const trend = campaigns[0].daily_trend as Array<Record<string, unknown>>;
    expect(trend).toHaveLength(2);
    expect(trend[0]).toMatchObject({ date: "2024-11-28", spend_usd: 100, conversions_value_usd: 400, roas: 4 });
    expect(trend[1]).toMatchObject({ date: "2024-11-29", spend_usd: 100, conversions_value_usd: 200, roas: 2 });

    // Verify the search call honoured the days window passed to the tool.
    expect(mockSearchCampaignsByName).toHaveBeenCalledWith(
      STUB_CONNECTION.credentials,
      "Black Friday",
      expect.objectContaining({ lookbackDays: 365 }),
    );
    // Daily trend call only fetches the drilled subset (1 id) for `days` window.
    expect(mockGetCampaignDailyTrend).toHaveBeenCalledWith(
      STUB_CONNECTION.credentials,
      ["222"],
      365,
    );
  });
});

// ── (b) No match returns the helpful "available campaigns" message ───────────

describe("get_campaign_performance — campaign_name with no match (live Google Ads)", () => {
  it("returns matched_count=0 and surfaces nearby campaigns from the wider all-status pool", async () => {
    queueLiveConnection();

    // Initial active list (used as fallback if name-search fails; here it's needed
    // before the search branch is consulted).
    mockListCampaigns.mockResolvedValueOnce({
      success: true,
      data: {
        campaigns: [
          { id: "111", name: "Brand · Search", status: "ENABLED", type: "SEARCH",
            spend_usd: 500, impressions: 10000, clicks: 200, conversions: 10,
            conversion_value_usd: 1500, roas: 3 },
        ],
        count: 1, total_spend_usd: 500, total_revenue_usd: 1500, roas: 3,
      },
    });

    // Direct name search → no campaigns found.
    mockSearchCampaignsByName.mockResolvedValueOnce({
      success: true,
      data: { campaigns: [], count: 0 },
    });

    // Wider, all-status fallback pool (lookback 365 + includeAllStatuses).
    mockListCampaigns.mockResolvedValueOnce({
      success: true,
      data: {
        campaigns: [
          { id: "111", name: "Brand · Search",      status: "ENABLED" },
          { id: "222", name: "Black Friday 2024",   status: "PAUSED"  },
          { id: "333", name: "Performance Max — US",status: "REMOVED" },
        ],
      },
    });

    const result = await runTool({ campaign_name: "Christmas 2099", days: 30 }) as Record<string, unknown>;

    expect(result.source).toBe("google_ads_live");
    expect(result.matched_count).toBe(0);
    expect(result.campaigns).toEqual([]);
    expect(result.campaign_name_query).toBe("Christmas 2099");

    const nearby = result.available_campaigns as Array<Record<string, unknown>>;
    expect(nearby.length).toBeGreaterThan(0);
    // Nearby pool is sourced from the wider all-status list.
    expect(nearby.map((c) => c.name)).toEqual(
      expect.arrayContaining(["Black Friday 2024", "Performance Max — US"]),
    );
    expect(String(result.summary)).toContain('No campaign matched "Christmas 2099"');
    expect(String(result.summary)).toContain("Black Friday 2024 [PAUSED]");

    // Wider scan must have been invoked with the all-statuses + 365-day options.
    expect(mockListCampaigns).toHaveBeenLastCalledWith(
      STUB_CONNECTION.credentials,
      undefined,
      expect.objectContaining({ includeAllStatuses: true, lookbackDays: 365 }),
    );
    // Trend fetch must NOT be called when there are no matches.
    expect(mockGetCampaignDailyTrend).not.toHaveBeenCalled();
  });
});

// ── (d) Live Google Ads side-by-side comparison — both sides match ───────────

describe("get_campaign_performance — campaign_names comparison (live Google Ads, both sides match)", () => {
  it("returns mode=comparison with per-side totals, aligned daily trend, and vs-side_0 deltas", async () => {
    queueLiveConnection();

    // Initial active-campaign list (required before the comparison branch runs).
    mockListCampaigns.mockResolvedValueOnce({
      success: true,
      data: {
        campaigns: [
          { id: "111", name: "Brand Search", status: "ENABLED", type: "SEARCH",
            spend_usd: 300, impressions: 6000, clicks: 120, conversions: 6,
            conversion_value_usd: 900, roas: 3 },
          { id: "222", name: "Black Friday 2024", status: "PAUSED", type: "SHOPPING",
            spend_usd: 200, impressions: 4000, clicks: 80, conversions: 4,
            conversion_value_usd: 800, roas: 4 },
        ],
        count: 2, total_spend_usd: 500, total_revenue_usd: 1700, roas: 3.4,
      },
    });

    // Per-side GAQL searches (called in parallel via Promise.all).
    // side_0 "Brand"
    mockSearchCampaignsByName.mockResolvedValueOnce({
      success: true,
      data: {
        campaigns: [
          { id: "111", name: "Brand Search", status: "ENABLED", type: "SEARCH",
            spend_usd: 300, impressions: 6000, clicks: 120, conversions: 6,
            conversion_value_usd: 900, roas: 3 },
        ],
        count: 1,
      },
    });
    // side_1 "Black Friday"
    mockSearchCampaignsByName.mockResolvedValueOnce({
      success: true,
      data: {
        campaigns: [
          { id: "222", name: "Black Friday 2024", status: "PAUSED", type: "SHOPPING",
            spend_usd: 200, impressions: 4000, clicks: 80, conversions: 4,
            conversion_value_usd: 800, roas: 4 },
        ],
        count: 1,
      },
    });

    // Single de-duplicated trend fetch for both drilled IDs.
    mockGetCampaignDailyTrend.mockResolvedValueOnce({
      success: true,
      data: {
        rows: [
          { campaign_id: "111", campaign_name: "Brand Search",
            date: "2024-01-01", spend_usd: 150, impressions: 3000, clicks: 60, conversions: 3, conversions_value_usd: 450 },
          { campaign_id: "111", campaign_name: "Brand Search",
            date: "2024-01-02", spend_usd: 150, impressions: 3000, clicks: 60, conversions: 3, conversions_value_usd: 450 },
          { campaign_id: "222", campaign_name: "Black Friday 2024",
            date: "2024-01-01", spend_usd: 100, impressions: 2000, clicks: 40, conversions: 2, conversions_value_usd: 400 },
          { campaign_id: "222", campaign_name: "Black Friday 2024",
            date: "2024-01-02", spend_usd: 100, impressions: 2000, clicks: 40, conversions: 2, conversions_value_usd: 400 },
        ],
      },
    });

    const result = await runTool({
      campaign_names: ["Brand", "Black Friday"],
      days: 30,
    }) as Record<string, unknown>;

    // Top-level envelope.
    expect(result.source).toBe("google_ads_live");
    expect(result.mode).toBe("comparison");
    expect(result.side_count).toBe(2);
    expect(result.total_matched_count).toBe(2);
    expect(result.trend_available).toBe(true);
    expect(result.campaign_name_queries).toEqual(["Brand", "Black Friday"]);

    // Per-side structure.
    const sides = result.sides as Array<Record<string, unknown>>;
    expect(sides).toHaveLength(2);

    const side0 = sides[0];
    expect(side0.query).toBe("Brand");
    expect(side0.matched_count).toBe(1);
    expect(side0.has_revenue).toBe(true);
    const s0totals = side0.totals as Record<string, unknown>;
    // Trend-derived totals: 150+150=300 spend, 450+450=900 revenue → ROAS 3.
    expect(s0totals.spend_usd).toBe(300);
    expect(s0totals.revenue_usd).toBe(900);
    expect(s0totals.roas).toBe(3);

    const side1 = sides[1];
    expect(side1.query).toBe("Black Friday");
    expect(side1.matched_count).toBe(1);
    const s1totals = side1.totals as Record<string, unknown>;
    // Trend-derived totals: 100+100=200 spend, 400+400=800 revenue → ROAS 4.
    expect(s1totals.spend_usd).toBe(200);
    expect(s1totals.revenue_usd).toBe(800);
    expect(s1totals.roas).toBe(4);

    // Aligned daily trend must cover both dates with entries for each side.
    const aligned = result.aligned_daily_trend as Array<Record<string, unknown>>;
    expect(aligned).toHaveLength(2);
    const day1 = aligned.find((d) => (d as Record<string, unknown>).date === "2024-01-01") as Record<string, unknown>;
    expect(day1).toBeDefined();
    expect((day1.side_0 as Record<string, unknown>).spend_usd).toBe(150);
    expect((day1.side_1 as Record<string, unknown>).spend_usd).toBe(100);

    // Deltas: side_0 is base; side_1 spend diff = 200 - 300 = -100.
    const deltas = result.deltas as Record<string, { values: number[]; vs_side_0: Array<{ abs_diff: number; pct_diff_vs_side_0: number } | null> }>;
    expect(deltas.spend_usd.values).toEqual([300, 200]);
    expect(deltas.spend_usd.vs_side_0[0]).toBeNull();
    // spend pct: (200-300)/300*100 = -33.33
    expect(deltas.spend_usd.vs_side_0[1]).toMatchObject({ abs_diff: -100, pct_diff_vs_side_0: -33.33 });
    // ROAS delta: side_1 ROAS 4 vs side_0 ROAS 3 → abs +1, pct (1/3)*100 = 33.33.
    expect(deltas.roas.vs_side_0[1]).toMatchObject({ abs_diff: 1, pct_diff_vs_side_0: 33.33 });

    // Trend fetch must have received exactly both campaign IDs, de-duplicated, in order.
    expect(mockGetCampaignDailyTrend).toHaveBeenCalledTimes(1);
    expect(mockGetCampaignDailyTrend).toHaveBeenCalledWith(
      STUB_CONNECTION.credentials,
      ["111", "222"],
      30,
    );

    // No available_campaign_names when all sides match.
    expect(result.available_campaign_names).toBeUndefined();
  });
});

// ── (e) Live Google Ads comparison — one side matches zero campaigns ──────────

describe("get_campaign_performance — campaign_names comparison (live Google Ads, one empty side)", () => {
  it("populates available_campaign_names and mentions the empty side in the summary", async () => {
    queueLiveConnection();

    mockListCampaigns.mockResolvedValueOnce({
      success: true,
      data: {
        campaigns: [
          { id: "111", name: "Brand Search", status: "ENABLED", type: "SEARCH",
            spend_usd: 300, impressions: 6000, clicks: 120, conversions: 6,
            conversion_value_usd: 900, roas: 3 },
        ],
        count: 1, total_spend_usd: 300, total_revenue_usd: 900, roas: 3,
      },
    });

    // side_0 "Brand" matches.
    mockSearchCampaignsByName.mockResolvedValueOnce({
      success: true,
      data: {
        campaigns: [
          { id: "111", name: "Brand Search", status: "ENABLED", type: "SEARCH",
            spend_usd: 300, impressions: 6000, clicks: 120, conversions: 6,
            conversion_value_usd: 900, roas: 3 },
        ],
        count: 1,
      },
    });
    // side_1 "Nonexistent2099" — zero matches.
    mockSearchCampaignsByName.mockResolvedValueOnce({
      success: true,
      data: { campaigns: [], count: 0 },
    });

    // Trend fetch runs for side_0's campaign only.
    mockGetCampaignDailyTrend.mockResolvedValueOnce({
      success: true,
      data: {
        rows: [
          { campaign_id: "111", campaign_name: "Brand Search",
            date: "2024-01-01", spend_usd: 150, impressions: 3000, clicks: 60, conversions: 3, conversions_value_usd: 450 },
          { campaign_id: "111", campaign_name: "Brand Search",
            date: "2024-01-02", spend_usd: 150, impressions: 3000, clicks: 60, conversions: 3, conversions_value_usd: 450 },
        ],
      },
    });

    // Wide all-status scan triggered because side_1 matched nothing.
    mockListCampaigns.mockResolvedValueOnce({
      success: true,
      data: {
        campaigns: [
          { id: "111", name: "Brand Search",         status: "ENABLED"  },
          { id: "333", name: "Summer Sale 2023",      status: "PAUSED"   },
          { id: "444", name: "Performance Max — US",  status: "REMOVED"  },
        ],
      },
    });

    const result = await runTool({
      campaign_names: ["Brand", "Nonexistent2099"],
      days: 30,
    }) as Record<string, unknown>;

    expect(result.source).toBe("google_ads_live");
    expect(result.mode).toBe("comparison");

    const sides = result.sides as Array<Record<string, unknown>>;
    expect((sides[0] as Record<string, unknown>).matched_count).toBe(1);
    expect((sides[1] as Record<string, unknown>).matched_count).toBe(0);

    // Recovery hint must be present and populated from the wide scan.
    const available = result.available_campaign_names as Array<Record<string, unknown>>;
    expect(available).toBeDefined();
    expect(available.length).toBeGreaterThan(0);
    expect(available.map((c) => c.name)).toContain("Summer Sale 2023");

    // Summary must mention the guidance.
    expect(String(result.summary)).toContain("available_campaign_names");

    // Wide scan must have used includeAllStatuses + extended lookback.
    expect(mockListCampaigns).toHaveBeenLastCalledWith(
      STUB_CONNECTION.credentials,
      undefined,
      expect.objectContaining({ includeAllStatuses: true }),
    );
  });
});

// ── (h) Live Google Ads comparison — trend fetch fails (revenue/ROAS gaps) ───

describe("get_campaign_performance — campaign_names comparison (live Google Ads, trend fetch fails)", () => {
  it("sets trend_available=false and nulls revenue/ROAS on both sides, appends the failure note to summary", async () => {
    queueLiveConnection();

    // Initial active-campaign list (consumed before the comparison branch).
    mockListCampaigns.mockResolvedValueOnce({
      success: true,
      data: {
        campaigns: [
          { id: "111", name: "Brand Search", status: "ENABLED", type: "SEARCH",
            spend_usd: 300, impressions: 6000, clicks: 120, conversions: 6,
            conversion_value_usd: 900, roas: 3 },
          { id: "222", name: "Black Friday 2024", status: "PAUSED", type: "SHOPPING",
            spend_usd: 200, impressions: 4000, clicks: 80, conversions: 4,
            conversion_value_usd: 800, roas: 4 },
        ],
        count: 2, total_spend_usd: 500, total_revenue_usd: 1700, roas: 3.4,
      },
    });

    // side_0 "Brand" — matches one campaign.
    mockSearchCampaignsByName.mockResolvedValueOnce({
      success: true,
      data: {
        campaigns: [
          { id: "111", name: "Brand Search", status: "ENABLED", type: "SEARCH",
            spend_usd: 300, impressions: 6000, clicks: 120, conversions: 6,
            conversion_value_usd: 900, roas: 3 },
        ],
        count: 1,
      },
    });
    // side_1 "Black Friday" — also matches one campaign.
    mockSearchCampaignsByName.mockResolvedValueOnce({
      success: true,
      data: {
        campaigns: [
          { id: "222", name: "Black Friday 2024", status: "PAUSED", type: "SHOPPING",
            spend_usd: 200, impressions: 4000, clicks: 80, conversions: 4,
            conversion_value_usd: 800, roas: 4 },
        ],
        count: 1,
      },
    });

    // Daily-trend call fails — this is the degradation path under test.
    mockGetCampaignDailyTrend.mockResolvedValueOnce({ success: false });

    const result = await runTool({
      campaign_names: ["Brand", "Black Friday"],
      days: 30,
    }) as Record<string, unknown>;

    // Top-level flags.
    expect(result.source).toBe("google_ads_live");
    expect(result.mode).toBe("comparison");
    expect(result.trend_available).toBe(false);

    // Per-side revenue and ROAS must be null on both sides.
    const sides = result.sides as Array<Record<string, unknown>>;
    expect(sides).toHaveLength(2);

    for (const side of sides) {
      const totals = side.totals as Record<string, unknown>;
      expect(totals.revenue_usd).toBeNull();
      expect(totals.roas).toBeNull();
      expect(side.has_revenue).toBe(false);
    }

    // The daily-breakdown failure note must appear in the summary.
    expect(String(result.summary)).toContain(
      "Daily trend unavailable — Google Ads daily-breakdown call failed; per-side revenue/ROAS not reported.",
    );

    // Aligned trend is empty since there are no trend rows.
    expect(result.aligned_daily_trend).toEqual([]);

    // Trend call must have been attempted for both campaign IDs.
    expect(mockGetCampaignDailyTrend).toHaveBeenCalledTimes(1);
    expect(mockGetCampaignDailyTrend).toHaveBeenCalledWith(
      STUB_CONNECTION.credentials,
      ["111", "222"],
      30,
    );
  });
});

// ── (c) Warehouse fallback honours the name filter against channel names ─────

describe("get_campaign_performance — warehouse fallback honours campaign_name", () => {
  it("filters channels by case-insensitive substring and returns matched-only totals", async () => {
    queueWarehouse([
      { channel: "Google Ads",   spend: "300", clicks: 100, conversions: 5,  revenue: "900" },
      { channel: "Meta Ads",     spend: "200", clicks: 50,  conversions: 2,  revenue: "400" },
      { channel: "Google Search", spend: "150", clicks: 80, conversions: 3,  revenue: "450" },
    ]);

    const result = await runTool({ campaign_name: "google", days: 14 }) as Record<string, unknown>;

    expect(result.source).toBe("warehouse");
    expect(result.window_days).toBe(14);

    const campaigns = result.campaigns as Array<Record<string, unknown>>;
    // Only the two "Google …" channels survive the filter.
    expect(campaigns.map((c) => c.channel)).toEqual(["Google Ads", "Google Search"]);
    // Totals reflect only the matched channels (300+150=450 spend, 900+450=1350 revenue → ROAS 3x).
    expect(result.total_spend_usd).toBe(450);
    expect(result.total_revenue_usd).toBe(1350);
    expect(result.roas).toBe(3);
  });

  it("returns matched_count=0 with the available channel list when no channel matches", async () => {
    queueWarehouse([
      { channel: "Google Ads", spend: "300", clicks: 100, conversions: 5, revenue: "900" },
      { channel: "Meta Ads",   spend: "200", clicks: 50,  conversions: 2, revenue: "400" },
    ]);

    const result = await runTool({ campaign_name: "tiktok", days: 30 }) as Record<string, unknown>;

    expect(result.source).toBe("warehouse");
    expect(result.matched_count).toBe(0);
    expect(result.campaigns).toEqual([]);
    expect(String(result.summary)).toContain('No warehouse rows matched "tiktok"');
    expect(String(result.summary)).toContain("Google Ads");
    expect(String(result.summary)).toContain("Meta Ads");
  });
});

// ── (f) Warehouse comparison — per-side channel filter + trend contract ───────

describe("get_campaign_performance — campaign_names comparison (warehouse fallback, both sides match)", () => {
  it("returns mode=comparison with per-side channel totals, deltas, trend_available=false and empty aligned_daily_trend", async () => {
    queueWarehouse([
      { channel: "Google Ads",   spend: "400", clicks: 160, conversions: 8, revenue: "1200" },
      { channel: "Google Search", spend: "200", clicks: 80,  conversions: 4, revenue: "600"  },
      { channel: "Meta Ads",     spend: "300", clicks: 120, conversions: 6, revenue: "900"  },
    ]);

    const result = await runTool({
      campaign_names: ["Google", "Meta"],
      days: 30,
    }) as Record<string, unknown>;

    expect(result.source).toBe("warehouse");
    expect(result.mode).toBe("comparison");
    expect(result.side_count).toBe(2);
    expect(result.window_days).toBe(30);

    // Warehouse comparison always flags trend as unavailable.
    expect(result.trend_available).toBe(false);
    expect(result.aligned_daily_trend).toEqual([]);

    const sides = result.sides as Array<Record<string, unknown>>;
    expect(sides).toHaveLength(2);

    // side_0 "Google" matches "Google Ads" + "Google Search".
    const s0 = sides[0] as Record<string, unknown>;
    expect(s0.query).toBe("Google");
    expect(s0.matched_count).toBe(2);
    const s0totals = s0.totals as Record<string, unknown>;
    // spend: 400+200=600, revenue: 1200+600=1800, ROAS=3.
    expect(s0totals.spend_usd).toBe(600);
    expect(s0totals.revenue_usd).toBe(1800);
    expect(s0totals.roas).toBe(3);

    // side_1 "Meta" matches "Meta Ads" only.
    const s1 = sides[1] as Record<string, unknown>;
    expect(s1.query).toBe("Meta");
    expect(s1.matched_count).toBe(1);
    const s1totals = s1.totals as Record<string, unknown>;
    expect(s1totals.spend_usd).toBe(300);
    expect(s1totals.revenue_usd).toBe(900);
    expect(s1totals.roas).toBe(3);

    // Deltas: side_1 spend = 300 vs side_0 spend = 600 → abs_diff = -300, pct = -50.
    const deltas = result.deltas as Record<string, { values: number[]; vs_side_0: Array<{ abs_diff: number; pct_diff_vs_side_0: number } | null> }>;
    expect(deltas.spend_usd.values).toEqual([600, 300]);
    expect(deltas.spend_usd.vs_side_0[0]).toBeNull();
    expect(deltas.spend_usd.vs_side_0[1]).toMatchObject({ abs_diff: -300, pct_diff_vs_side_0: -50 });
    // ROAS is equal on both sides → abs_diff = 0, pct_diff = 0.
    expect(deltas.roas.vs_side_0[1]).toMatchObject({ abs_diff: 0, pct_diff_vs_side_0: 0 });

    // No recovery hint when all sides matched.
    expect(result.available_campaign_names).toBeUndefined();

    // Summary must mention both sides and the warehouse channel note.
    expect(String(result.summary)).toContain("side_0");
    expect(String(result.summary)).toContain("side_1");
    expect(String(result.summary)).toContain("Warehouse data is rolled up per channel");

    // No live Google Ads calls made.
    expect(mockSearchCampaignsByName).not.toHaveBeenCalled();
    expect(mockGetCampaignDailyTrend).not.toHaveBeenCalled();
  });
});

// ── (g) Warehouse comparison — one side matches zero channels ─────────────────

describe("get_campaign_performance — campaign_names comparison (warehouse fallback, one empty side)", () => {
  it("populates available_campaign_names from available channels and flags it in the summary", async () => {
    queueWarehouse([
      { channel: "Google Ads", spend: "400", clicks: 160, conversions: 8,  revenue: "1200" },
      { channel: "Meta Ads",   spend: "300", clicks: 120, conversions: 6,  revenue: "900"  },
    ]);

    const result = await runTool({
      campaign_names: ["Google", "TikTok"],
      days: 14,
    }) as Record<string, unknown>;

    expect(result.source).toBe("warehouse");
    expect(result.mode).toBe("comparison");

    const sides = result.sides as Array<Record<string, unknown>>;
    expect((sides[0] as Record<string, unknown>).matched_count).toBe(1);
    expect((sides[1] as Record<string, unknown>).matched_count).toBe(0);

    // Recovery hint must list the available channel names.
    const available = result.available_campaign_names as string[];
    expect(available).toBeDefined();
    expect(available).toContain("Google Ads");
    expect(available).toContain("Meta Ads");

    // Summary must mention the guidance.
    expect(String(result.summary)).toContain("available_campaign_names");
  });
});
