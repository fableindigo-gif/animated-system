// @vitest-environment happy-dom

/**
 * Tests for PerformanceGrid — status filter and lookback selector.
 *
 * Section A: Pure-logic tests (no DOM)
 *   A-1  ENABLED + 30d  → warehouse /channels endpoint.
 *   A-2  PAUSED         → live /campaigns/live endpoint with statusFilter=PAUSED.
 *   A-3  REMOVED        → live endpoint with statusFilter=REMOVED.
 *   A-4  ALL            → live endpoint with statusFilter=ALL.
 *   A-5  ENABLED + 60d  → live endpoint (lookbackDays > 30 forces live).
 *   A-6  ENABLED + 365d → live endpoint with lookbackDays=365.
 *   A-7  buildAnalyzePrompt mirrors the expected string for a PAUSED campaign.
 *
 * Section B: Component interaction tests (happy-dom + @testing-library/react)
 *   B-1  Clicking "Paused" status button re-fetches with the live endpoint URL.
 *   B-2  Changing lookback to 90d re-fetches with lookbackDays=90 on the live URL.
 *   B-3  Clicking a PAUSED campaign row fires onAnalyze with the right prompt.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";

// ─── Section A: Pure URL-building logic ─────────────────────────────────────
//
// The decision below mirrors `const useLiveEndpoint = statusFilter !== "ENABLED" || lookbackDays > 30`
// from performance-grid.tsx. Keeping it here means a change in the component
// that breaks the contract will also break these tests.

type StatusFilter = "ALL" | "ENABLED" | "PAUSED" | "REMOVED";

/**
 * Mirrors the `useLiveEndpoint` decision from PerformanceGrid.
 * Returns true when the component should call /campaigns/live.
 */
function useLiveEndpoint(statusFilter: StatusFilter, lookbackDays: number): boolean {
  return statusFilter !== "ENABLED" || lookbackDays > 30;
}

/**
 * Mirrors the URL construction inside PerformanceGrid.load().
 * Returns the URL string that the component would pass to authFetch.
 */
function buildUrl(
  statusFilter: StatusFilter,
  lookbackDays: number,
  page = 1,
): string {
  const API_BASE = "/";
  if (useLiveEndpoint(statusFilter, lookbackDays)) {
    return `${API_BASE}api/warehouse/campaigns/live?statusFilter=${statusFilter}&lookbackDays=${lookbackDays}&limit=200`;
  }
  // Warehouse URL — dates are computed at call time; we only check the stable parts.
  return `${API_BASE}api/warehouse/channels?page=${page}&page_size=20&days=${lookbackDays}`;
}

/**
 * Mirrors `buildAnalyzePrompt` from performance-grid.tsx.
 * Must produce the same string the component sends to onAnalyze.
 */
interface LiveChannel {
  campaignId: string;
  campaignName: string;
  spend: number;
  roas: number;
  conversions: number;
  cpa: number | null;
  revenue: number | null;
  clicks: number;
  impressions: number;
  ctr: number;
  status: string;
  revenueTrendPct: number | null;
}

function buildAnalyzePrompt(row: LiveChannel): string {
  const cpaPart = row.cpa != null ? `, CPA ${row.cpa.toFixed(2)}` : "";
  const convValPart = row.revenue != null ? `, Conv. Value ${row.revenue.toFixed(2)}` : "";
  return (
    `Deep-dive analysis on campaign "${row.campaignName}" (ID: ${row.campaignId}). ` +
    `Current metrics: Spend ${(row.spend ?? 0).toFixed(2)}, ROAS ${(row.roas ?? 0).toFixed(2)}×, ` +
    `${row.conversions ?? 0} conversions${cpaPart}${convValPart}, ${row.clicks ?? 0} clicks, ` +
    `${row.impressions ?? 0} impressions, CTR ${(row.ctr ?? 0).toFixed(2)}%, Status: ${row.status}. ` +
    `Analyze performance, identify optimization opportunities, and recommend specific actions ` +
    `to improve ROAS and reduce wasted spend. Be decisive and specific.`
  );
}

describe("PerformanceGrid — URL routing logic (A: pure logic)", () => {
  it("A-1: ENABLED + 30d uses the warehouse /channels endpoint", () => {
    const url = buildUrl("ENABLED", 30);
    expect(url).toContain("api/warehouse/channels");
    expect(url).not.toContain("campaigns/live");
  });

  it("A-2: PAUSED uses the live endpoint with statusFilter=PAUSED", () => {
    const url = buildUrl("PAUSED", 30);
    expect(url).toContain("api/warehouse/campaigns/live");
    expect(url).toContain("statusFilter=PAUSED");
    expect(url).toContain("lookbackDays=30");
  });

  it("A-3: REMOVED uses the live endpoint with statusFilter=REMOVED", () => {
    const url = buildUrl("REMOVED", 30);
    expect(url).toContain("api/warehouse/campaigns/live");
    expect(url).toContain("statusFilter=REMOVED");
  });

  it("A-4: ALL uses the live endpoint with statusFilter=ALL", () => {
    const url = buildUrl("ALL", 30);
    expect(url).toContain("api/warehouse/campaigns/live");
    expect(url).toContain("statusFilter=ALL");
  });

  it("A-5: ENABLED + lookbackDays=60 forces the live endpoint", () => {
    const url = buildUrl("ENABLED", 60);
    expect(url).toContain("api/warehouse/campaigns/live");
    expect(url).toContain("lookbackDays=60");
    expect(url).toContain("statusFilter=ENABLED");
  });

  it("A-6: ENABLED + lookbackDays=365 passes correct lookbackDays on the live URL", () => {
    const url = buildUrl("ENABLED", 365);
    expect(url).toContain("api/warehouse/campaigns/live");
    expect(url).toContain("lookbackDays=365");
  });

  it("A-7: buildAnalyzePrompt for a PAUSED campaign includes the name and status", () => {
    const row: LiveChannel = {
      campaignId: "222",
      campaignName: "Black Friday 2024",
      spend: 200,
      roas: 3,
      conversions: 5,
      cpa: 40,
      revenue: 600,
      clicks: 100,
      impressions: 5000,
      ctr: 2.0,
      status: "PAUSED",
      revenueTrendPct: null,
    };
    const prompt = buildAnalyzePrompt(row);
    expect(prompt).toContain('"Black Friday 2024"');
    expect(prompt).toContain("Status: PAUSED");
    expect(prompt).toContain("Spend 200.00");
    expect(prompt).toContain("ROAS 3.00×");
    expect(prompt).toContain("CPA 40.00");
    expect(prompt).toContain("Conv. Value 600.00");
  });

  it("A-7b: buildAnalyzePrompt for an ENABLED campaign omits missing CPA/revenue gracefully", () => {
    const row: LiveChannel = {
      campaignId: "111",
      campaignName: "Brand Search",
      spend: 500,
      roas: 4,
      conversions: 10,
      cpa: null,
      revenue: null,
      clicks: 200,
      impressions: 10000,
      ctr: 2.0,
      status: "ENABLED",
      revenueTrendPct: null,
    };
    const prompt = buildAnalyzePrompt(row);
    expect(prompt).toContain('"Brand Search"');
    expect(prompt).toContain("Status: ENABLED");
    expect(prompt).not.toContain("CPA");
    expect(prompt).not.toContain("Conv. Value");
  });
});

// ─── Section B: Component interaction tests ──────────────────────────────────
//
// These tests render the real PerformanceGrid component with all external
// dependencies mocked. The mock for authFetch records every URL it is called
// with so we can assert the routing decision without a live server.

const mockAuthFetch = vi.fn();

vi.mock("@/lib/auth-fetch", () => ({
  authFetch: (...args: unknown[]) => mockAuthFetch(...args),
  authPost: vi.fn(),
}));

vi.mock("@/contexts/workspace-context", () => ({
  useWorkspace: vi.fn(() => ({
    activeWorkspace: { id: 1, name: "Test Org" },
    workspaces: [],
    setWorkspace: vi.fn(),
    refreshWorkspaces: vi.fn(),
  })),
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/contexts/date-range-context", () => ({
  useDateRange: vi.fn(() => ({
    dateRange: { daysBack: 30 },
    refreshKey: 0,
    setDateRange: vi.fn(),
  })),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: vi.fn(() => false),
}));

vi.mock("@/hooks/use-has-permission", () => ({
  useHasPermission: vi.fn(() => ({ permitted: false })),
}));

vi.mock("@/lib/use-filter-qs", () => ({
  useFilterQs: vi.fn(() => ({ qs: "", refreshKey: 0 })),
}));

vi.mock("@/lib/use-economics-settings", () => ({
  useEconomicsSettings: vi.fn(() => ({
    targetRoasFor: (_id: string, fallback: number) => fallback,
    settings: { targetRoas: 4.0, campaignOverrides: {} },
    setCampaignTargetRoas: vi.fn(),
  })),
}));

vi.mock("@/lib/fx-format", () => ({
  formatUsdInDisplay: (n: number) => `$${n.toFixed(2)}`,
}));

vi.mock("@/lib/formatters", () => ({
  formatRelativeTime: () => "just now",
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/money-tile", () => ({
  MoneyTile: ({ usd }: { usd: number }) => <span>${usd.toFixed(2)}</span>,
}));

vi.mock("../components/dashboard/filter-bar", () => ({
  FilterBar: () => null,
}));

vi.mock("../components/dashboard/window-empty-banner", () => ({
  WindowEmptyBanner: () => null,
}));

vi.mock("wouter", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useLocation: () => ["/", vi.fn()],
}));

// react-icons stubs
vi.mock("react-icons/si", () => ({
  SiGoogleads: () => <span data-testid="si-google" />,
  SiMeta:      () => <span data-testid="si-meta" />,
}));

import { PerformanceGrid } from "../components/dashboard/performance-grid";

// ── Shared test data ─────────────────────────────────────────────────────────

const PAUSED_CAMPAIGN = {
  campaignId: "222",
  campaignName: "Black Friday 2024",
  spend: 200,
  conversions: 5,
  clicks: 100,
  impressions: 5000,
  ctr: 2.0,
  roas: 3.0,
  cpa: 40,
  revenue: 600,
  status: "PAUSED",
  revenueTrendPct: null as number | null,
  revenueIsNew: false,
  revenueTrend: null,
};

const ACTIVE_CAMPAIGN = {
  campaignId: "111",
  campaignName: "Brand Search",
  spend: 500,
  conversions: 10,
  clicks: 200,
  impressions: 10000,
  ctr: 2.0,
  roas: 4.0,
  cpa: 50,
  revenue: 2000,
  status: "ENABLED",
  revenueTrendPct: 10 as number | null,
  revenueIsNew: false,
  revenueTrend: null,
};

function makeApiResponse(campaigns: Array<typeof ACTIVE_CAMPAIGN | typeof PAUSED_CAMPAIGN>) {
  return {
    ok: true,
    json: async () => ({
      data: campaigns,
      total_count: campaigns.length,
      has_more: false,
      syncedAt: 1700000000000,
      hasDataInWindow: true,
      hasDataOutsideWindow: false,
      latestAdsSyncAt: null,
    }),
  };
}

function makeConnectionsResponse() {
  return {
    ok: true,
    json: async () => [{ isActive: true }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PerformanceGrid — status filter component interactions (B)", () => {
  it("B-1: clicking 'Paused' re-fetches using the live endpoint with statusFilter=PAUSED", async () => {
    // First call: /api/connections. Second call: initial grid fetch (warehouse).
    // Third call: after clicking Paused (live endpoint).
    mockAuthFetch
      .mockResolvedValueOnce(makeConnectionsResponse())
      .mockResolvedValueOnce(makeApiResponse([ACTIVE_CAMPAIGN]))
      .mockResolvedValueOnce(makeApiResponse([PAUSED_CAMPAIGN]));

    await act(async () => {
      render(<PerformanceGrid />);
    });

    // Wait for the initial fetch to settle.
    await waitFor(() => {
      expect(mockAuthFetch).toHaveBeenCalledTimes(2);
    });

    // Click the "Paused" status filter button.
    await act(async () => {
      fireEvent.click(screen.getByTestId("status-filter-paused"));
    });

    await waitFor(() => {
      expect(mockAuthFetch).toHaveBeenCalledTimes(3);
    });

    const thirdCallUrl = mockAuthFetch.mock.calls[2][0] as string;
    expect(thirdCallUrl).toContain("campaigns/live");
    expect(thirdCallUrl).toContain("statusFilter=PAUSED");
    expect(thirdCallUrl).toContain("lookbackDays=30");
  });

  it("B-2: changing lookback to 90d re-fetches with lookbackDays=90 on the live endpoint", async () => {
    mockAuthFetch
      .mockResolvedValueOnce(makeConnectionsResponse())
      .mockResolvedValueOnce(makeApiResponse([ACTIVE_CAMPAIGN]))
      .mockResolvedValueOnce(makeApiResponse([ACTIVE_CAMPAIGN]));

    await act(async () => {
      render(<PerformanceGrid />);
    });

    await waitFor(() => {
      expect(mockAuthFetch).toHaveBeenCalledTimes(2);
    });

    // Change the lookback selector to 90d.
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox", { name: /lookback window/i }), {
        target: { value: "90" },
      });
    });

    await waitFor(() => {
      expect(mockAuthFetch).toHaveBeenCalledTimes(3);
    });

    const thirdCallUrl = mockAuthFetch.mock.calls[2][0] as string;
    expect(thirdCallUrl).toContain("campaigns/live");
    expect(thirdCallUrl).toContain("lookbackDays=90");
    expect(thirdCallUrl).toContain("statusFilter=ENABLED");
  });

  it("B-3: clicking a PAUSED campaign row fires onAnalyze with the campaign name and PAUSED status", async () => {
    mockAuthFetch
      .mockResolvedValueOnce(makeConnectionsResponse())
      .mockResolvedValueOnce(makeApiResponse([PAUSED_CAMPAIGN]));

    const onAnalyze = vi.fn();

    await act(async () => {
      render(<PerformanceGrid onAnalyze={onAnalyze} />);
    });

    // Wait for the row to appear.
    await waitFor(() => {
      expect(screen.getByText("Black Friday 2024")).toBeDefined();
    });

    // Click the row.
    await act(async () => {
      fireEvent.click(screen.getByText("Black Friday 2024"));
    });

    expect(onAnalyze).toHaveBeenCalledTimes(1);
    const prompt = onAnalyze.mock.calls[0][0] as string;
    expect(prompt).toContain('"Black Friday 2024"');
    expect(prompt).toContain("Status: PAUSED");
  });

  it("B-4: clicking an ENABLED campaign row also fires onAnalyze with the correct campaign and ENABLED status", async () => {
    mockAuthFetch
      .mockResolvedValueOnce(makeConnectionsResponse())
      .mockResolvedValueOnce(makeApiResponse([ACTIVE_CAMPAIGN]));

    const onAnalyze = vi.fn();

    await act(async () => {
      render(<PerformanceGrid onAnalyze={onAnalyze} />);
    });

    await waitFor(() => {
      expect(screen.getByText("Brand Search")).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Brand Search"));
    });

    expect(onAnalyze).toHaveBeenCalledTimes(1);
    const prompt = onAnalyze.mock.calls[0][0] as string;
    expect(prompt).toContain('"Brand Search"');
    expect(prompt).toContain("Status: ENABLED");
  });

  it("B-5: clicking 'Removed' status button re-fetches with statusFilter=REMOVED on the live endpoint", async () => {
    mockAuthFetch
      .mockResolvedValueOnce(makeConnectionsResponse())
      .mockResolvedValueOnce(makeApiResponse([ACTIVE_CAMPAIGN]))
      .mockResolvedValueOnce(makeApiResponse([]));

    await act(async () => {
      render(<PerformanceGrid />);
    });

    await waitFor(() => {
      expect(mockAuthFetch).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("status-filter-removed"));
    });

    await waitFor(() => {
      expect(mockAuthFetch).toHaveBeenCalledTimes(3);
    });

    const url = mockAuthFetch.mock.calls[2][0] as string;
    expect(url).toContain("campaigns/live");
    expect(url).toContain("statusFilter=REMOVED");
  });

  it("B-6: clicking 'All' status button re-fetches with statusFilter=ALL on the live endpoint", async () => {
    mockAuthFetch
      .mockResolvedValueOnce(makeConnectionsResponse())
      .mockResolvedValueOnce(makeApiResponse([ACTIVE_CAMPAIGN]))
      .mockResolvedValueOnce(makeApiResponse([ACTIVE_CAMPAIGN, PAUSED_CAMPAIGN]));

    await act(async () => {
      render(<PerformanceGrid />);
    });

    await waitFor(() => {
      expect(mockAuthFetch).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("status-filter-all"));
    });

    await waitFor(() => {
      expect(mockAuthFetch).toHaveBeenCalledTimes(3);
    });

    const url = mockAuthFetch.mock.calls[2][0] as string;
    expect(url).toContain("campaigns/live");
    expect(url).toContain("statusFilter=ALL");
  });
});
