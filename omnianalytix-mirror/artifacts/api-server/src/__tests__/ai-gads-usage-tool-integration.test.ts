/**
 * Integration tests for the AI row-cap guardrail logic as exercised through
 * the actual `get_campaign_performance` tool execution path.
 *
 * Covers:
 *   - windowClamped: when requested days exceeds the org's maxLookbackDays, the
 *     tool response includes `window_clamped: true` and `window_days` reflects
 *     the clamped value — not the originally requested value.
 *   - usage_warning: when `checkAndIncrementUsage` reports nearingCap=true (>80 %
 *     of dailyRowCap consumed), the response includes a `usage_warning` object
 *     with `rows_read_today`, `daily_row_cap`, and `usage_pct`.
 *
 * All external dependencies (DB, Google Ads API client, credential helpers,
 * prompts loader) are stubbed so the tests run with no live credentials or
 * network access, mirroring the pattern in campaign-performance-drilldown.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DB mock: queue-based so each test controls select() results ───────────────

const dbResultsQueue: unknown[][] = [];
function makeChain(): unknown {
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  chain.from    = passthrough;
  chain.where   = passthrough;
  chain.limit   = passthrough;
  chain.orderBy = passthrough;
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
  db: { select: (..._args: unknown[]) => mockDbSelect() },
  warehouseGoogleAds:      {},
  warehouseShopifyProducts: {},
  liveTriageAlerts:        {
    workspaceId: "workspaceId", resolvedStatus: "resolvedStatus",
    createdAt: "createdAt", id: "id", severity: "severity", type: "type",
    title: "title", message: "message", platform: "platform",
    action: "action", contextTag: "contextTag",
  },
  platformConnections: { platform: "platform", isActive: "isActive", organizationId: "organizationId" },
  workspaces:          { id: "id", organizationId: "organizationId" },
  adkSessions:         {
    id: "id", appName: "appName", userId: "userId",
    events: "events", createdAt: "createdAt", updatedAt: "updatedAt",
  },
  biAdPerformance: {
    workspaceId: "workspaceId", date: "date", channel: "channel",
    spend: "spend", clicks: "clicks", conversions: "conversions", revenue: "revenue",
  },
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/adk/drizzle-session-service", () => ({
  drizzleSessionService: {},
  startSessionCleanup:   vi.fn(),
}));

vi.mock("./system-health-monitor", () => ({
  getLastHealthResults: () => ({ results: [], lastRunAt: null }),
}));

vi.mock("../lib/google-token-refresh", () => ({
  getFreshGoogleCredentials: vi.fn(async () => null),
}));

// ── ai-gads-usage mock: vi.fn() instances so each test can control behaviour ──

const mockGetOrgGuardrails      = vi.fn();
const mockGetTodayRowCount      = vi.fn();
const mockGetRequestBudget      = vi.fn();
const mockCheckAndIncrementUsage = vi.fn();

vi.mock("../lib/ai-gads-usage", () => ({
  DEFAULT_MAX_LOOKBACK_DAYS: 180,
  DEFAULT_DAILY_ROW_CAP:     50_000,
  PER_REQUEST_ROW_CAP:       5_000,
  getOrgGuardrails:       (...a: unknown[]) => mockGetOrgGuardrails(...a),
  getTodayRowCount:       (...a: unknown[]) => mockGetTodayRowCount(...a),
  getRequestBudget:       (...a: unknown[]) => mockGetRequestBudget(...a),
  checkAndIncrementUsage: (...a: unknown[]) => mockCheckAndIncrementUsage(...a),
}));

vi.mock("../lib/credential-helpers", () => ({
  decryptCredentials: (c: Record<string, string>) => c,
}));

vi.mock("../agents/infrastructure/prompts/loader", () => ({
  renderPrompt:         () => "stub-prompt",
  getPromptDescription: () => "stub-description",
  getToolDescription:   (name: string) => `stub description for ${name}`,
}));

// ── Google Ads API stubs ───────────────────────────────────────────────────────

const mockListCampaigns         = vi.fn();
const mockSearchCampaignsByName  = vi.fn();
const mockGetCampaignDailyTrend  = vi.fn();

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

const ORG_ID = 42;

const STUB_CONNECTION = {
  credentials: { customerId: "111-222-3333" } as Record<string, string>,
};

async function runTool(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tools = buildOrgTools(ORG_ID);
  const tool  = tools.find((t) => t.name === "get_campaign_performance");
  if (!tool) throw new Error("get_campaign_performance tool not registered");
  return tool.runAsync({ args, toolContext: {} as unknown as never }) as Promise<Record<string, unknown>>;
}

/** Standard Google Ads response with a single matching campaign. */
const STUB_LIST_RESULT = {
  success: true,
  data: {
    campaigns: [
      {
        id: "111", name: "Brand Search", status: "ENABLED", type: "SEARCH",
        spend_usd: 500, impressions: 10_000, clicks: 200,
        conversions: 10, conversion_value_usd: 1_500, roas: 3,
      },
    ],
    count: 1, total_spend_usd: 500, total_revenue_usd: 1_500, roas: 3,
  },
};

const STUB_SEARCH_RESULT = {
  success: true,
  data: {
    campaigns: [
      {
        id: "111", name: "Brand Search", status: "ENABLED", type: "SEARCH",
        spend_usd: 500, impressions: 10_000, clicks: 200,
        conversions: 10, conversion_value_usd: 1_500, roas: 3,
      },
    ],
    count: 1,
  },
};

const STUB_TREND_RESULT = {
  success: true,
  data: {
    rows: [
      {
        campaign_id: "111", campaign_name: "Brand Search", date: "2026-04-01",
        spend_usd: 50, impressions: 1_000, clicks: 20,
        conversions: 1, conversions_value_usd: 150,
      },
    ],
  },
};

/** A usage result that signals the cap is not close (< 80 %). */
function makeUsageBelow(rowsAfter: number, cap = 50_000) {
  return {
    rowsBefore:    rowsAfter - 1,
    rowsAfter,
    dailyRowCap:   cap,
    capExceeded:   false,
    nearingCap:    false,
    usageFraction: rowsAfter / cap,
  };
}

/** A usage result that signals nearingCap (>= 80 %). */
function makeUsageNearing(rowsAfter: number, cap = 50_000) {
  return {
    rowsBefore:    rowsAfter - 1,
    rowsAfter,
    dailyRowCap:   cap,
    capExceeded:   false,
    nearingCap:    true,
    usageFraction: rowsAfter / cap,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbResultsQueue.length = 0;

  // Default: no rows consumed today → full budget available.
  mockGetTodayRowCount.mockResolvedValue(0);
  mockGetRequestBudget.mockReturnValue(5_000);

  // Default guardrails (overridden per test as needed).
  mockGetOrgGuardrails.mockResolvedValue({
    maxLookbackDays: 180,
    dailyRowCap:     50_000,
  });

  // Default: each checkAndIncrementUsage call is well below threshold.
  mockCheckAndIncrementUsage.mockResolvedValue(makeUsageBelow(100));
});

// ─────────────────────────────────────────────────────────────────────────────
// window_clamped: requested days > org max → tool clamps and flags it
// ─────────────────────────────────────────────────────────────────────────────

describe("get_campaign_performance — windowClamped guardrail", () => {
  it("sets window_clamped=true and clamps window_days when requested days exceeds org maxLookbackDays", async () => {
    // Org configured with a 30-day max; user requests 90.
    mockGetOrgGuardrails.mockResolvedValue({ maxLookbackDays: 30, dailyRowCap: 50_000 });

    // Queue a live Google Ads connection.
    dbResultsQueue.push([STUB_CONNECTION]);

    // Wire the Google Ads API stubs.
    mockListCampaigns.mockResolvedValue(STUB_LIST_RESULT);
    mockSearchCampaignsByName.mockResolvedValue(STUB_SEARCH_RESULT);
    mockGetCampaignDailyTrend.mockResolvedValue(STUB_TREND_RESULT);

    const result = await runTool({ days: 90, campaign_name: "Brand" });

    expect(result.window_clamped).toBe(true);
    expect(result.window_days).toBe(30);
    expect(result.source).toBe("google_ads_live");
  });

  it("sets window_clamped=false and preserves window_days when requested days is within org limit", async () => {
    mockGetOrgGuardrails.mockResolvedValue({ maxLookbackDays: 180, dailyRowCap: 50_000 });

    dbResultsQueue.push([STUB_CONNECTION]);

    mockListCampaigns.mockResolvedValue(STUB_LIST_RESULT);
    mockSearchCampaignsByName.mockResolvedValue(STUB_SEARCH_RESULT);
    mockGetCampaignDailyTrend.mockResolvedValue(STUB_TREND_RESULT);

    const result = await runTool({ days: 30, campaign_name: "Brand" });

    expect(result.window_clamped).toBe(false);
    expect(result.window_days).toBe(30);
  });

  it("clamps to org max even when the org limit is very short (e.g. 7 days)", async () => {
    mockGetOrgGuardrails.mockResolvedValue({ maxLookbackDays: 7, dailyRowCap: 50_000 });

    dbResultsQueue.push([STUB_CONNECTION]);

    mockListCampaigns.mockResolvedValue(STUB_LIST_RESULT);
    mockSearchCampaignsByName.mockResolvedValue(STUB_SEARCH_RESULT);
    mockGetCampaignDailyTrend.mockResolvedValue(STUB_TREND_RESULT);

    const result = await runTool({ days: 180, campaign_name: "Brand" });

    expect(result.window_clamped).toBe(true);
    expect(result.window_days).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// usage_warning: appears once >80 % of daily cap is consumed
// ─────────────────────────────────────────────────────────────────────────────

describe("get_campaign_performance — usage_warning field", () => {
  it("includes usage_warning in the drill-down response when drillTrendUsage.nearingCap is true", async () => {
    dbResultsQueue.push([STUB_CONNECTION]);

    mockListCampaigns.mockResolvedValue(STUB_LIST_RESULT);
    mockSearchCampaignsByName.mockResolvedValue(STUB_SEARCH_RESULT);
    mockGetCampaignDailyTrend.mockResolvedValue(STUB_TREND_RESULT);

    // checkAndIncrementUsage call sequence in drill-down path:
    //   1st → listUsage      (after googleAds_listCampaigns)
    //   2nd → nameSearchUsage (after googleAds_searchCampaignsByName)
    //   3rd → drillTrendUsage (after googleAds_getCampaignDailyTrend)
    mockCheckAndIncrementUsage
      .mockResolvedValueOnce(makeUsageBelow(100))        // listUsage — still fine
      .mockResolvedValueOnce(makeUsageBelow(200))        // nameSearchUsage — still fine
      .mockResolvedValueOnce(makeUsageNearing(42_000));  // drillTrendUsage — >80 %

    const result = await runTool({ days: 30, campaign_name: "Brand" });

    expect(result).toHaveProperty("usage_warning");
    const uw = result.usage_warning as Record<string, unknown>;
    expect(uw.rows_read_today).toBe(42_000);
    expect(uw.daily_row_cap).toBe(50_000);
    expect(typeof uw.usage_pct).toBe("number");
    expect(uw.usage_pct as number).toBeCloseTo(84, 0);
  });

  it("includes usage_warning when nameSearchUsage.nearingCap is true (even if drillTrend is fine)", async () => {
    dbResultsQueue.push([STUB_CONNECTION]);

    mockListCampaigns.mockResolvedValue(STUB_LIST_RESULT);
    mockSearchCampaignsByName.mockResolvedValue(STUB_SEARCH_RESULT);
    mockGetCampaignDailyTrend.mockResolvedValue(STUB_TREND_RESULT);

    mockCheckAndIncrementUsage
      .mockResolvedValueOnce(makeUsageBelow(100))        // listUsage — fine
      .mockResolvedValueOnce(makeUsageNearing(41_000))   // nameSearchUsage — >80 %
      .mockResolvedValueOnce(makeUsageBelow(41_001));    // drillTrendUsage — still below (just +1)

    const result = await runTool({ days: 30, campaign_name: "Brand" });

    expect(result).toHaveProperty("usage_warning");
  });

  it("omits usage_warning when all checkAndIncrementUsage calls are below 80 %", async () => {
    dbResultsQueue.push([STUB_CONNECTION]);

    mockListCampaigns.mockResolvedValue(STUB_LIST_RESULT);
    mockSearchCampaignsByName.mockResolvedValue(STUB_SEARCH_RESULT);
    mockGetCampaignDailyTrend.mockResolvedValue(STUB_TREND_RESULT);

    // All calls well below threshold.
    mockCheckAndIncrementUsage.mockResolvedValue(makeUsageBelow(1_000));

    const result = await runTool({ days: 30, campaign_name: "Brand" });

    expect(result).not.toHaveProperty("usage_warning");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// daily_cap_exceeded: tool aborts early when todayRowCount >= dailyRowCap
// ─────────────────────────────────────────────────────────────────────────────

describe("get_campaign_performance — pre-flight daily cap gate", () => {
  it("returns daily_cap_exceeded error without calling GAQL when cap is already exhausted", async () => {
    mockGetTodayRowCount.mockResolvedValue(50_000);
    // getRequestBudget will see remaining = 0 but pre-flight check fires first.
    // (todayRowCount >= dailyRowCap → tool returns early before any GAQL call)
    mockGetOrgGuardrails.mockResolvedValue({ maxLookbackDays: 180, dailyRowCap: 50_000 });

    // No DB connection needed — the tool should return before querying the DB.
    const result = await runTool({ days: 30 });

    expect(result.error).toBe("daily_cap_exceeded");
    expect(mockListCampaigns).not.toHaveBeenCalled();
  });
});
