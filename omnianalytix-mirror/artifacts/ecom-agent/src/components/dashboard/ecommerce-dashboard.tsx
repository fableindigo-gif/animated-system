import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocation, Link } from "wouter";
import { RefreshCw, TrendingUp, TrendingDown, Minus, Zap, ExternalLink } from "lucide-react";
import { MoneyTile } from "@/components/ui/money-tile";
import { motion } from "framer-motion";
import { ProfitTrendChart, type ProfitTrendPoint } from "./profit-trend-chart";
import { MarginLeakTriageModal } from "./margin-leak-triage-modal";
import { DateRangePicker } from "./date-range-picker";
import { FilterBar } from "./filter-bar";
import { useFilterQs } from "@/lib/use-filter-qs";
import { useEconomicsSettings } from "@/lib/use-economics-settings";
import { SiMeta, SiShopify } from "react-icons/si";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/contexts/currency-context";
import { useFx } from "@/contexts/fx-context";
import { useDateRange } from "@/contexts/date-range-context";
import { authFetch } from "@/lib/auth-fetch";
import { useDashboardStore } from "@/store/dashboardStore";
import { formatUsdInDisplay } from "@/lib/fx-format";
import { useWorkspace } from "@/contexts/workspace-context";
import { computePoP, isSyncStale, type PoP } from "@/lib/dashboard-utils";
import { formatRelativeTime } from "@/lib/formatters";
import { GhostWidget } from "@/components/enterprise/ghost-widget";
import { UnifiedBillingHub } from "@/components/dashboard/unified-billing-hub";
import { LookerVisualizationHub } from "@/components/dashboard/looker-visualization-hub";
import { ShareableReports } from "@/components/dashboard/shareable-reports";
import { WindowEmptyBanner } from "./window-empty-banner";
import { ShareReportButton } from "@/components/dashboard/share-report-modal";
import { useListConnections } from "@workspace/api-client-react";

// ─── Design tokens (from mockup) ──────────────────────────────────────────────
// These match the exact colors in the provided HTML mockup
const T = {
  primary:             "#005bbf",
  primaryContainer:    "#1a73e8",
  onPrimaryContainer:  "#ffffff",
  primaryFixed:        "#d5e3fc",
  onPrimaryFixed:      "#0d1c2e",
  onPrimaryFixedVar:   "#004493",
  tertiary:            "#006c49",
  tertiaryContainer:   "#00885d",
  onTertiaryContainer: "#000703",
  tertiaryFixed:       "#6ffbbe",
  onTertiaryFixed:     "#002113",
  onTertiaryFixedVar:  "#005236",
  surface:             "#f7f9fb",
  surfaceContLow:      "#f2f4f6",
  surfaceCont:         "#eceef0",
  surfaceContHigh:     "#e6e8ea",
  surfaceContLowest:   "#ffffff",
  onSurface:           "#191c1e",
  onSurfaceVariant:    "#414754",
  outlineVariant:      "#c1c6d6",
  error:               "#ba1a1a",
  errorContainer:      "#ffdad6",
  onErrorContainer:    "#93000a",
};

// ─── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ values, color = "rgba(255,255,255,0.7)", height = 24, width = 64 }: {
  values: number[];
  color?: string;
  height?: number;
  width?: number;
}) {
  if (values.length < 2) return null;
  const min  = Math.min(...values);
  const max  = Math.max(...values);
  const norm = (v: number) => max === min ? 0.5 : (v - min) / (max - min);
  const step = width / (values.length - 1);
  const pts  = values.map((v, i) => `${i * step},${height - norm(v) * height * 0.85 - height * 0.05}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" className="opacity-60">
      <polyline points={pts} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// generate a deterministic "sparkline" seed from a value so cards look live
function fakeSparkline(seed: number, len = 8): number[] {
  const arr: number[] = [];
  let cur = seed;
  for (let i = 0; i < len; i++) {
    cur = cur * 1.003 + Math.sin(cur * 0.1 + i) * seed * 0.04;
    arr.push(cur);
  }
  return arr;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface WarehouseKpis {
  hasData: boolean;
  hasDataInWindow?: boolean;
  hasDataOutsideWindow?: boolean;
  latestAdsSyncAt?: string | null;
  totalSpend: number;
  estimatedRevenue: number;
  activeProducts: number;
  totalProducts?: number;
  totalConversions: number;
  poas: number;
  roas: number;
  inventoryValue: number;
  campaignCount: number;
  etlStatus: string;
  lastSyncedAt: number | null;
  totalClicks?: number;
}

interface MarginLeak {
  campaignName: string | null;
  campaignId: string;
  productTitle: string | null;
  sku: string | null;
  inventoryQty: number | null;
  wastedSpend: number;
  impressions: number;
}

interface Campaign {
  campaignId: string;
  campaignName: string;
  costUsd: number;
  clicks: number;
  impressions: number;
  conversions: number;
  status: string;
  budgetUsd?: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function fmtCurrency(n: number, _sym: string): string {
  return formatUsdInDisplay(n, { compact: true, decimals: 1 });
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

const BASE = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

// ─── Skeleton pulse ────────────────────────────────────────────────────────────

function Skel({ w = "w-20", h = "h-10", light = false }: { w?: string; h?: string; light?: boolean }) {
  return (
    <span className={cn("inline-block rounded-lg animate-pulse", w, h, light ? "bg-white/20" : "bg-surface-container-low")} />
  );
}

// ─── Portfolio defaults (Task #153) ────────────────────────────────────────────
// Tenants can override this in Settings → Economics; the value below is only
// used as a fallback when a brand hasn't configured their own. TARGET_ROAS
// lives with the Health badge in performance-grid.tsx since that's its only
// consumer today.
const DEFAULT_COGS_PCT = 0.35;
// computePoP, isSyncStale, PoP — imported from @/lib/dashboard-utils

/** Direction a POSITIVE movement has for the user — spend going up is bad. */
type MetricPolarity = "higher-is-better" | "lower-is-better";

function PoPBadge({ pop, polarity, periodLabel }: { pop: PoP; polarity: MetricPolarity; periodLabel: string }) {
  if (pop.pct == null || pop.direction === "na") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-black/5 text-on-surface-variant">
        <Minus className="w-3 h-3" />
        No prior data
      </span>
    );
  }
  const good =
    pop.direction === "flat"
      ? true
      : polarity === "higher-is-better"
        ? pop.direction === "up"
        : pop.direction === "down";
  const Icon =
    pop.direction === "up" ? TrendingUp : pop.direction === "down" ? TrendingDown : Minus;
  const pctStr = `${pop.pct > 0 ? "+" : ""}${(pop.pct * 100).toFixed(1)}%`;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{
        background: good ? "rgba(16,185,129,0.14)" : "rgba(220,38,38,0.14)",
        color: good ? "#047857" : "#b91c1c",
      }}
      aria-label={`${pctStr} vs ${periodLabel}`}
      data-good={good ? "true" : "false"}
      data-testid="pop-badge"
    >
      <Icon className="w-3 h-3" />
      {pctStr} vs {periodLabel}
    </span>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function EcommerceDashboard({ onChat }: { onChat?: (msg: string) => void }) {
  const [, navigate] = useLocation();
  const { currencySymbol: sym } = useCurrency();
  const { formatFromUsd } = useFx();
  const fmtCurrency = (n: number, _s: string) => formatFromUsd(n, { compact: true, decimals: 2 });
  const { dateRange, refreshKey } = useDateRange();
  const { activeWorkspace } = useWorkspace();
  // Tenant-configured COGS % (Task #153) — falls back to the portfolio default
  // if the agency hasn't set a value yet.
  const { cogsPctOr, settings: econSettings } = useEconomicsSettings();
  const cogsPct = cogsPctOr(DEFAULT_COGS_PCT);
  const cogsPctIsDefault = econSettings == null || econSettings.cogsPct == null;
  const { data: connections = [] } = useListConnections();

  const [kpis, setKpis]           = useState<WarehouseKpis | null>(null);
  const [previousKpis, setPreviousKpis] = useState<WarehouseKpis | null>(null);
  const [leaks, setLeaks]         = useState<MarginLeak[]>([]);
  // Task #114: window-empty disambiguation for the margin-leaks grid.
  const [leaksHasDataOutsideWindow, setLeaksHasDataOutsideWindow] = useState(false);
  const [leaksLatestAdsSyncAt,      setLeaksLatestAdsSyncAt]      = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading]     = useState(true);
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"google" | "meta">("google");
  const [triageOpen, setTriageOpen] = useState(false);
  const [profitTrend, setProfitTrend] = useState<{
    points: ProfitTrendPoint[];
    hasEnoughHistory: boolean;
    distinctDays: number;
    minHistoryDays: number;
    cogsPctFallback: number;
  } | null>(null);
  const [profitTrendLoading, setProfitTrendLoading] = useState(false);

  const metaConnected    = connections.some((c) => c.platform === "meta"        && c.isActive);
  const shopifyConnected = connections.some((c) => c.platform === "shopify"     && c.isActive);
  const gadsConnected    = connections.some((c) => c.platform === "google_ads"  && c.isActive);

  const abortRef = useRef<AbortController | null>(null);

  // Global advanced filter state for the dashboard. Same shape used by the
  // performance grid below — KPIs, margin-leak feed, and PoP comparison all
  // recompute against the filtered slice so the dashboard reads as one
  // coherent view (e.g. "Meta only, ROAS > 2, search: black-friday").
  const { qs: filterQs, refreshKey: filterRefreshKey } = useFilterQs("ecommerce-dashboard");

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoading(true);
    try {
      const from = dateRange.from.toISOString().slice(0, 10);
      const to   = dateRange.to.toISOString().slice(0, 10);
      const qs   = `?days=${dateRange.daysBack}&from=${from}&to=${to}${filterQs}`;
      // Task #149: pull a matched prior-period window for PoP deltas. We shift
      // the [from, to] window back by the same day-count so a 30-day view is
      // compared against the preceding 30 days. If the endpoint returns 404
      // or the tenant has no history, previousKpis stays null and the PoP
      // pill falls back to a neutral "No prior data" state.
      const rangeMs = dateRange.to.getTime() - dateRange.from.getTime();
      const prevTo = new Date(dateRange.from.getTime() - 1);
      const prevFrom = new Date(prevTo.getTime() - rangeMs);
      const prevQs = `?days=${dateRange.daysBack}&from=${prevFrom.toISOString().slice(0, 10)}&to=${prevTo.toISOString().slice(0, 10)}`;
      setProfitTrend(null);
      setProfitTrendLoading(true);
      // Task #209: clear stale window-empty state so the banner disappears
      // immediately when a new fetch starts, rather than waiting for the
      // (potentially failed) response to clear it.
      useDashboardStore.getState().setLeaksWindowMeta(false, null);
      const [kpiRes, leakRes, campRes, prevKpiRes, trendRes] = await Promise.all([
        authFetch(`${API_BASE}api/warehouse/kpis${qs}`,          { signal: ctl.signal }),
        authFetch(`${API_BASE}api/warehouse/margin-leaks${qs}`,  { signal: ctl.signal }),
        authFetch(`${API_BASE}api/warehouse/campaigns${qs}`,     { signal: ctl.signal }).catch(() => null),
        authFetch(`${API_BASE}api/warehouse/kpis${prevQs}`,      { signal: ctl.signal }).catch(() => null),
        authFetch(`${API_BASE}api/warehouse/profit-trend${qs}`,  { signal: ctl.signal }).catch(() => null),
      ]);
      if (ctl.signal.aborted) return;
      if (kpiRes.ok)  { const d = await kpiRes.json()  as WarehouseKpis; if (!ctl.signal.aborted) setKpis(d); }
      if (prevKpiRes?.ok) {
        const d = await prevKpiRes.json() as WarehouseKpis;
        if (!ctl.signal.aborted) setPreviousKpis(d.hasData ? d : null);
      } else if (!ctl.signal.aborted) {
        setPreviousKpis(null);
      }
      if (leakRes.ok) {
        const d = await leakRes.json() as {
          data?: MarginLeak[];
          leaks?: MarginLeak[];
          hasDataOutsideWindow?: boolean;
          latestAdsSyncAt?: string | null;
        };
        if (!ctl.signal.aborted) {
          setLeaks(d.data ?? d.leaks ?? []);
          // Task #114: thread the window-empty flags into the triage modal
          // so a narrow date window with older data shows the WindowEmptyBanner
          // (with a Switch-to-30d shortcut) instead of "All SKUs healthy".
          setLeaksHasDataOutsideWindow(Boolean(d.hasDataOutsideWindow));
          setLeaksLatestAdsSyncAt(d.latestAdsSyncAt ?? null);
          // Task #209: also push the flag into the store so the bento widget
          // can show the amber banner without needing props.
          useDashboardStore.getState().setLeaksWindowMeta(
            Boolean(d.hasDataOutsideWindow),
            d.latestAdsSyncAt ?? null,
          );
        }
      }
      if (campRes?.ok) {
        const d = await campRes.json() as { campaigns?: Campaign[]; data?: Campaign[] };
        if (!ctl.signal.aborted) setCampaigns((d.campaigns ?? d.data ?? []).slice(0, 4));
      }
      if (trendRes?.ok) {
        const d = await trendRes.json() as {
          hasEnoughHistory: boolean;
          distinctDays: number;
          minHistoryDays: number;
          cogsPctFallback: number;
          points: ProfitTrendPoint[];
        };
        if (!ctl.signal.aborted) setProfitTrend(d);
      } else if (!ctl.signal.aborted) {
        setProfitTrend(null);
      }
      setLastRefresh(Date.now());
    } catch (err) {
      if (!ctl.signal.aborted) console.error("[Dashboard] fetch error:", err);
    } finally {
      if (!ctl.signal.aborted) {
        setLoading(false);
        setProfitTrendLoading(false);
      }
    }
  }, [dateRange.daysBack, activeWorkspace?.id, filterQs]);

  useEffect(() => { void load(); return () => { abortRef.current?.abort(); }; }, [load, refreshKey, filterRefreshKey]);

  const sk     = loading && !kpis;
  const noData = !!(kpis && !kpis.hasData);
  const windowEmpty = !!(kpis && kpis.hasDataOutsideWindow);

  const maxCampSpend = campaigns.length ? Math.max(...campaigns.map((c) => c.costUsd), 1) : 1;

  // Task #149/#153: derive True Profit & a CoGS-aware POAS client-side using
  // the tenant-configured COGS %. Once a real per-SKU COGS feed exists this
  // block should swap to the warehouse value.
  const derive = useCallback((k: WarehouseKpis | null) => {
    if (!k || !k.hasData) return null;
    const spend = k.totalSpend ?? 0;
    const revenue = k.estimatedRevenue ?? 0;
    const cogs = revenue * cogsPct;
    const trueProfit = revenue - spend - cogs;
    const poas = spend > 0 ? (revenue - cogs) / spend : 0;
    return { spend, revenue, roas: k.roas ?? 0, poas, trueProfit };
  }, [cogsPct]);
  const cur = useMemo(() => derive(kpis), [derive, kpis]);
  const prev = useMemo(() => derive(previousKpis), [derive, previousKpis]);
  const periodLabel = useMemo(() => {
    const d = dateRange.daysBack ?? 30;
    return `Last ${d} Days`;
  }, [dateRange.daysBack]);

  // Staleness: delegate to isSyncStale() (exported for vitest, Task #154).
  // Prefers warehouse-reported latestAdsSyncAt; falls back to lastSyncedAt.
  // Returns false when kpis is null or no timestamp exists so brand-new
  // tenants don't see the stale button before their first sync.
  const isStale = useMemo(() => kpis ? isSyncStale(kpis) : false, [kpis]);

  // Live-ish timestamps for execution log rows
  const fmtTs = (minsAgo: number) => {
    const d = new Date(Date.now() - minsAgo * 60_000);
    return d.toISOString().replace("T", " ").slice(0, 19);
  };
  const execLogs = [
    { ts: fmtTs(3),  action: "Bidding Optimization (Google)", node: "us-east-ai-01",        status: "COMPLETED" },
    { ts: fmtTs(10), action: "Inventory Sync (Shopify)",      node: "global-sync-node",     status: "COMPLETED" },
    { ts: fmtTs(27), action: "Margin Leak Diagnostic",        node: "security-guardian-04", status: "COMPLETED" },
    ...(leaks.length > 0 ? [{ ts: fmtTs(0), action: `Margin Leak Alert · ${leaks.length} campaign${leaks.length !== 1 ? "s" : ""}`, node: "leak-detector-01", status: "ACTION NEEDED" }] : []),
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-8" style={{ fontFamily: "'Inter', sans-serif", backgroundColor: T.surface }}>

      {/* ── Dashboard Header ─────────────────────────────────────── */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest" style={{ color: `${T.onSurfaceVariant}80` }}>
            <span>OmniAnalytix</span>
            <span className="material-symbols-outlined" style={{ fontSize: 12 }}>chevron_right</span>
            <span style={{ color: T.primaryContainer }}>Intelligence Dashboard</span>
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight" style={{ fontFamily: "'Manrope', sans-serif", color: T.onSurface }}>
            DASHBOARD: <span style={{ color: T.onSurfaceVariant, fontWeight: 400 }}>Performance &amp; AI Logs</span>
          </h2>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <DateRangePicker />
          {lastRefresh && (
            <span className="text-[10px] font-mono hidden sm:block" style={{ color: T.onSurfaceVariant }}>
              {formatRelativeTime(lastRefresh, "Never")}
            </span>
          )}
          {isStale && (
            <button
              onClick={() => void load()}
              disabled={loading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition-colors disabled:opacity-60"
              style={{ background: T.primaryContainer, color: T.onPrimaryContainer, border: `1px solid ${T.primaryContainer}` }}
              aria-label="Data is more than 24 hours old — trigger a fresh sync"
              data-testid="trigger-fresh-sync"
            >
              <Zap className={cn("w-3.5 h-3.5", loading && "animate-pulse")} />
              Trigger Fresh Sync
            </button>
          )}
          <button
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold shadow-sm transition-colors disabled:opacity-40"
            style={{ background: T.surfaceContLowest, color: T.onSurface, border: `1px solid ${T.outlineVariant}40` }}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            Refresh
          </button>
          {kpis?.hasData && (
            <ShareReportButton
              reportKind="warehouse_kpis"
              filters={{
                from: dateRange.from.toISOString(),
                to: dateRange.to.toISOString(),
                daysBack: dateRange.daysBack,
              }}
              reportTitle={`E-Commerce Performance · ${dateRange.label}`}
            />
          )}
          <button
            className="px-5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 shadow-sm transition-colors"
            style={{ background: T.surfaceContLowest, color: T.onSurface, border: `1px solid ${T.outlineVariant}33` }}
            onClick={() => onChat?.("Generate a shareable client performance link for this period.")}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>ios_share</span>
            Share Client Link
          </button>
        </div>
      </div>

      {/* ── Global Advanced Filter Bar ──────────────────────────────
          Drives KPI cards, margin-leak feed, and the Performance Grid in
          lockstep so the dashboard is one coherent slice. URL-synchronised
          via `f.*` params for share/bookmark. */}
      <FilterBar
        pageKey="ecommerce-dashboard"
        searchPlaceholder="Search campaigns, SKUs, products…"
        dimensions={[
          { id: "platform" },
          { id: "campaign" },
          { id: "status" },
          { id: "network" },
          { id: "device" },
          { id: "country" },
          { id: "sku" },
        ]}
      />

      {!loading && windowEmpty && (
        <WindowEmptyBanner latestSyncAt={kpis?.latestAdsSyncAt ?? null} />
      )}

      {/* ── Hero KPI Scorecards (Task #149) ───────────────────────── */}
      {/* Five portfolio-level KPIs, each with a matched prior-period PoP pill.
          Spend uses "lower is better" polarity so a 20% ↑ paints red, while
          ROAS / POAS / Revenue / True Profit treat ↑ as green. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {(() => {
          const tiles: Array<{
            key: string;
            label: string;
            bg: string;
            fg: string;
            subFg: string;
            icon: string;
            value: string;
            /** Raw USD amount for money tiles — triggers FX overlay tooltip. */
            usdValue?: number;
            polarity: MetricPolarity;
            pop: PoP;
            skeleton: boolean;
          }> = [
            {
              key: "spend",
              label: "Ad Spend",
              bg: T.primaryFixed,
              fg: T.onPrimaryFixed,
              subFg: T.onPrimaryFixedVar,
              icon: "payments",
              value: sk ? "" : noData ? "—" : fmtCurrency(cur?.spend ?? 0, sym),
              usdValue: !sk && !noData ? (cur?.spend ?? 0) : undefined,
              polarity: "lower-is-better",
              pop: computePoP(cur?.spend, prev?.spend),
              skeleton: sk,
            },
            {
              key: "revenue",
              label: "Est. Revenue",
              bg: T.tertiaryFixed,
              fg: T.onTertiaryFixed,
              subFg: T.onTertiaryFixedVar,
              icon: "monetization_on",
              value: sk ? "" : noData ? "—" : fmtCurrency(cur?.revenue ?? 0, sym),
              usdValue: !sk && !noData ? (cur?.revenue ?? 0) : undefined,
              polarity: "higher-is-better",
              pop: computePoP(cur?.revenue, prev?.revenue),
              skeleton: sk,
            },
            {
              key: "roas",
              label: "Blended ROAS",
              bg: T.surfaceContLowest,
              fg: T.onSurface,
              subFg: T.onSurfaceVariant,
              icon: "query_stats",
              value: sk ? "" : noData ? "—" : `${(cur?.roas ?? 0).toFixed(2)}×`,
              polarity: "higher-is-better",
              pop: computePoP(cur?.roas, prev?.roas),
              skeleton: sk,
            },
            {
              key: "poas",
              label: "Blended POAS",
              bg: T.primaryContainer,
              fg: T.onPrimaryContainer,
              subFg: "rgba(255,255,255,0.85)",
              icon: "insights",
              value: sk ? "" : noData ? "—" : `${(cur?.poas ?? 0).toFixed(2)}×`,
              polarity: "higher-is-better",
              pop: computePoP(cur?.poas, prev?.poas),
              skeleton: sk,
            },
            {
              key: "trueProfit",
              label: "True Profit",
              bg: T.tertiaryContainer,
              fg: T.onTertiaryContainer,
              subFg: "rgba(255,255,255,0.85)",
              icon: "savings",
              value: sk ? "" : noData ? "—" : fmtCurrency(cur?.trueProfit ?? 0, sym),
              usdValue: !sk && !noData ? (cur?.trueProfit ?? 0) : undefined,
              polarity: "higher-is-better",
              pop: computePoP(cur?.trueProfit, prev?.trueProfit),
              skeleton: sk,
            },
          ];
          const isLight = (key: string) => key === "poas" || key === "trueProfit";
          return tiles.map((t) => (
            <motion.div
              key={t.key}
              className="p-5 rounded-xl relative overflow-hidden cursor-default"
              style={{ background: t.bg, color: t.fg, border: t.bg === T.surfaceContLowest ? `1px solid ${T.outlineVariant}26` : undefined }}
              whileHover={{ scale: 1.02, boxShadow: "0 8px 24px rgba(13,28,46,0.12)" }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              data-testid={`kpi-card-${t.key}`}
            >
              <div className="relative z-10 space-y-2.5">
                <p className="text-[11px] font-bold uppercase tracking-wider" style={{ opacity: 0.8 }}>
                  {t.label}
                </p>
                <h3 className="text-3xl font-bold leading-tight" style={{ fontFamily: "'Manrope', sans-serif" }}>
                  {t.skeleton ? (
                    <Skel light={isLight(t.key)} w="w-24" h="h-8" />
                  ) : t.usdValue !== undefined ? (
                    <MoneyTile usd={t.usdValue} compact decimals={2} />
                  ) : (
                    t.value
                  )}
                </h3>
                <div>
                  {t.skeleton ? (
                    <Skel light={isLight(t.key)} w="w-20" h="h-4" />
                  ) : (
                    <PoPBadge pop={t.pop} polarity={t.polarity} periodLabel={periodLabel} />
                  )}
                </div>
                {/* Economics assumption chip — POAS & True Profit silently use COGS %;
                    this badge makes the assumption visible and links to the config tab. */}
                {!t.skeleton && !noData && (t.key === "poas" || t.key === "trueProfit") && (
                  <div>
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate("/settings?tab=economics"); }}
                      title={`Using COGS ${Math.round(cogsPct * 100)}%${cogsPctIsDefault ? " (platform default — click to configure)" : " (configured) — click to adjust in Settings → Economics"}`}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold tracking-wide transition-opacity hover:opacity-100"
                      style={{ background: "rgba(255,255,255,0.18)", color: "inherit", opacity: 0.72 }}
                    >
                      COGS {Math.round(cogsPct * 100)}%{cogsPctIsDefault ? " ·default" : ""}
                      <ExternalLink size={8} />
                    </button>
                  </div>
                )}
                {/* Per-tile freshness — surfaces the data age right next to the
                    number so the user never has to wonder "is this current?". */}
                {!t.skeleton && lastRefresh && (
                  <p
                    className="text-[9px] font-medium uppercase tracking-wider"
                    style={{ color: t.subFg, opacity: 0.65 }}
                    data-testid={`kpi-freshness-${t.key}`}
                  >
                    Updated {formatRelativeTime(lastRefresh, "just now")}
                  </p>
                )}
              </div>
              <div className="absolute -right-4 -bottom-4" style={{ opacity: 0.07 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 110 }}>{t.icon}</span>
              </div>
            </motion.div>
          ));
        })()}
      </div>

      {/* Profit Trend Chart — wired to real daily warehouse data (Task #152)
          Guard: only show when KPI data is present AND trend data loaded (or loading).
          Hides chart if KPI fetch failed (kpis null) or trend request failed (profitTrend null + not loading). */}
      {!sk && !noData && kpis && (profitTrend !== null || profitTrendLoading) && (
        <ProfitTrendChart
          points={profitTrend?.points ?? []}
          hasEnoughHistory={profitTrend?.hasEnoughHistory ?? false}
          distinctDays={profitTrend?.distinctDays}
          minHistoryDays={profitTrend?.minHistoryDays}
          cogsPct={profitTrend?.cogsPctFallback ?? cogsPct}
          cogsPctIsDefault={cogsPctIsDefault}
          days={dateRange.daysBack}
          loading={profitTrendLoading}
          onGoToSettings={() => navigate("/settings?tab=economics")}
        />
      )}

      {/* Triage drill-down modal (opened from the Active SKUs bento tile) */}
      <MarginLeakTriageModal
        open={triageOpen}
        onOpenChange={setTriageOpen}
        leaks={leaks}
        hasDataOutsideWindow={leaksHasDataOutsideWindow}
        latestAdsSyncAt={leaksLatestAdsSyncAt}
      />

      {/* ── 12-col Layout ─────────────────────────────────────────── */}
      <div className="grid grid-cols-12 gap-8">

        {/* ── Left Column (8) ────────────────────────────────────── */}
        <div className="col-span-12 lg:col-span-8 space-y-8">

          {/* Secondary Metrics Bento */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {([
              { label: "Blended ROAS",    value: sk ? null : noData ? "—" : `${(kpis?.roas ?? 0).toFixed(2)}×`, usdValue: undefined as number | undefined, onClick: undefined as undefined | (() => void), ariaLabel: undefined as undefined | string, sub: undefined as undefined | string },
              { label: "Total Clicks",    value: sk ? null : noData ? "—" : fmtNum(kpis?.totalClicks ?? 0), usdValue: undefined, onClick: undefined, ariaLabel: undefined, sub: undefined },
              { label: "Conversions",     value: sk ? null : noData ? "—" : fmtNum(kpis?.totalConversions ?? 0), usdValue: undefined, onClick: undefined, ariaLabel: undefined, sub: undefined },
              {
                label: "Active SKUs",
                value: sk ? null : noData ? "—" : `${kpis?.activeProducts ?? 0}/${kpis?.totalProducts ?? 0}`,
                usdValue: undefined,
                // Task #149 Step 6: clicking the Active SKUs tile opens the
                // Margin-Leak Triage drill-down modal. We always allow the
                // click (even when leaks.length === 0) so the modal can show
                // an explicit "all healthy" message instead of silently
                // doing nothing.
                onClick: !sk && !noData ? () => setTriageOpen(true) : undefined,
                ariaLabel: "Open Margin-Leak Triage drill-down",
                sub: !sk && !noData && leaks.length > 0 ? `${leaks.length} at risk · click to triage` : undefined,
              },
              {
                label: "Inventory Value",
                value: sk ? null : noData ? "—" : fmtCurrency(kpis?.inventoryValue ?? 0, sym),
                usdValue: !sk && !noData ? (kpis?.inventoryValue ?? 0) : undefined,
                onClick: undefined,
                ariaLabel: undefined,
                sub: undefined,
              },
            ] as Array<{
              label: string;
              value: string | null;
              usdValue: number | undefined;
              onClick: undefined | (() => void);
              ariaLabel: undefined | string;
              sub: undefined | string;
            }>).map((m) => {
              const clickable = !!m.onClick;
              const Wrapper: "button" | "div" = clickable ? "button" : "div";
              return (
                <Wrapper
                  key={m.label}
                  type={clickable ? "button" : undefined}
                  onClick={m.onClick}
                  aria-label={m.ariaLabel}
                  data-testid={clickable ? `bento-tile-${m.label.toLowerCase().replace(/\s+/g, "-")}` : undefined}
                  className={cn(
                    "p-4 rounded-xl shadow-sm space-y-1 text-left transition-all",
                    clickable && "hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#1a73e8] cursor-pointer",
                  )}
                  style={{
                    background: T.surfaceContLowest,
                    border: clickable && leaks.length > 0
                      ? `1px solid ${T.error}4d`
                      : `1px solid ${T.outlineVariant}1a`,
                  }}
                >
                  <p className="text-[11px] font-bold uppercase tracking-widest flex items-center justify-between gap-2" style={{ color: `${T.onSurfaceVariant}99` }}>
                    <span>{m.label}</span>
                    {clickable && leaks.length > 0 && (
                      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold" style={{ background: T.errorContainer, color: T.onErrorContainer }}>
                        {leaks.length}
                      </span>
                    )}
                  </p>
                  <p className="text-2xl font-bold" style={{ fontFamily: "'Manrope', sans-serif", color: T.onSurface }}>
                    {m.value === null ? (
                      <Skel w="w-16" h="h-7" />
                    ) : m.usdValue !== undefined ? (
                      <MoneyTile usd={m.usdValue} compact decimals={2} />
                    ) : (
                      m.value
                    )}
                  </p>
                  {m.sub && (
                    <p className="text-[10px] font-semibold" style={{ color: T.error }}>{m.sub}</p>
                  )}
                </Wrapper>
              );
            })}
            {/* Add Metric button */}
            <div className="p-4 rounded-xl shadow-sm flex items-center justify-center" style={{ background: T.surfaceContLowest, border: `1px dashed ${T.outlineVariant}4d` }}>
              <button
                onClick={() => onChat?.("What additional KPIs should I track for my e-commerce performance?")}
                className="flex items-center gap-1 text-xs font-semibold"
                style={{ color: T.primaryContainer }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
                Add Metric
              </button>
            </div>
          </div>

          {/* Triage Alert Banner */}
          {/* Honesty fix: a green "All systems healthy" banner is misleading
              when the warehouse has not yet synced any rows for this tenant.
              We render a neutral "awaiting sync" tone in that case. */}
          {(() => {
            const variant: "danger" | "healthy" | "neutral" =
              noData ? "neutral" : leaks.length > 0 ? "danger" : "healthy";
            const accent =
              variant === "danger" ? T.error : variant === "healthy" ? T.tertiary : T.onSurfaceVariant;
            const icon =
              variant === "danger" ? "warning" : variant === "healthy" ? "health_and_safety" : "sync";
            const message =
              variant === "danger"
                ? `${leaks.length} active margin leak${leaks.length !== 1 ? "s" : ""} detected`
                : variant === "healthy"
                  ? "All systems healthy — no active alerts"
                  : "Awaiting first warehouse sync — connect a data source to see live triage status";
            return (
              <div
                className="p-5 rounded-r-xl flex items-center justify-between"
                style={{
                  background: `${accent}0d`,
                  borderLeft: `4px solid ${accent}`,
                }}
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: `${accent}33`, color: accent }}>
                    <span className="material-symbols-outlined">{icon}</span>
                  </div>
                  <div>
                    <h4 className="font-bold leading-tight" style={{ color: T.onSurface }}>Live Triage Status</h4>
                    <p className="text-sm" style={{ color: T.onSurfaceVariant }}>{message}</p>
                  </div>
                </div>
                <button
                  onClick={() => onChat?.("Show me a full triage report of all active margin leaks and recommended fixes.")}
                  className="text-sm font-bold hover:underline"
                  style={{ color: accent }}
                >
                  View Logs
                </button>
              </div>
            );
          })()}

          {/* Execution Logs */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-bold flex items-center gap-2" style={{ fontFamily: "'Manrope', sans-serif", color: T.onSurface }}>
                <span className="material-symbols-outlined" style={{ color: T.primaryContainer }}>terminal</span>
                Recent Execution Logs
              </h4>
              <button
                onClick={() => onChat?.("Export the recent execution logs as a CSV.")}
                className="text-xs font-bold uppercase tracking-wider"
                style={{ color: T.primaryContainer }}
              >
                Download CSV
              </button>
            </div>
            <div className="rounded-xl shadow-sm overflow-hidden" style={{ background: T.surfaceContLowest, border: `1px solid ${T.outlineVariant}1a` }}>
              <table className="w-full text-sm text-left border-collapse">
                <thead>
                  <tr className="text-[11px] font-bold uppercase tracking-widest" style={{ background: `${T.surfaceContHigh}80`, color: T.onSurfaceVariant }}>
                    <th className="px-6 py-4">Timestamp</th>
                    <th className="px-6 py-4">Action</th>
                    <th className="px-6 py-4 hidden md:table-cell">System Node</th>
                    <th className="px-6 py-4">Status</th>
                  </tr>
                </thead>
                <tbody style={{ borderTop: `1px solid ${T.outlineVariant}1a` }}>
                  {execLogs.map((log, i) => (
                    <tr
                      key={i}
                      className="transition-colors"
                      style={{ borderBottom: i < execLogs.length - 1 ? `1px solid ${T.outlineVariant}1a` : "none" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = T.surfaceContLow)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <td className="px-6 py-4 font-mono text-[12px] whitespace-nowrap" style={{ color: T.onSurfaceVariant }}>{log.ts}</td>
                      <td className="px-6 py-4 font-medium" style={{ color: log.status === "ACTION NEEDED" ? T.error : T.onSurface }}>{log.action}</td>
                      <td className="px-6 py-4 hidden md:table-cell" style={{ color: T.onSurfaceVariant }}>{log.node}</td>
                      <td className="px-6 py-4">
                        {log.status === "ACTION NEEDED" ? (
                          <span className="px-3 py-1 rounded-full text-[11px] font-bold" style={{ background: T.errorContainer, color: T.onErrorContainer }}>
                            ACTION NEEDED
                          </span>
                        ) : (
                          <span className="px-3 py-1 rounded-full text-[11px] font-bold" style={{ background: `${T.tertiaryContainer}1a`, color: T.onTertiaryFixedVar }}>
                            COMPLETED
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Ghost widgets for unconnected platforms */}
          {!metaConnected && (
            <GhostWidget
              platformName="Meta Ads"
              platformIcon={<SiMeta className="w-4 h-4 text-[#1877F2]" />}
              accentColor="#1877F2"
              metrics={[{ label: "Ad Spend" }, { label: "ROAS" }, { label: "Conversions" }, { label: "CPM" }]}
              onConnect={() => navigate("/connections")}
            />
          )}
          {!shopifyConnected && (
            <GhostWidget
              platformName="Shopify"
              platformIcon={<SiShopify className="w-4 h-4 text-emerald-400" />}
              accentColor="#34d399"
              metrics={[{ label: "Revenue" }, { label: "Orders" }, { label: "AOV" }, { label: "Cart Rate" }]}
              onConnect={() => navigate("/connections")}
            />
          )}

          <UnifiedBillingHub />
          <LookerVisualizationHub />
          <ShareableReports
            reportKind="warehouse_kpis"
            filters={{
              from: dateRange.from.toISOString(),
              to: dateRange.to.toISOString(),
              daysBack: dateRange.daysBack,
            }}
            title={`E-Commerce Performance · ${dateRange.label}`}
            filenameBase="ecommerce-performance"
          />
        </div>

        {/* ── Right Column (4) ───────────────────────────────────── */}
        <div className="col-span-12 lg:col-span-4 space-y-6">

          {/* Active Channels */}
          <div className="rounded-xl shadow-sm overflow-hidden" style={{ background: T.surfaceContLowest, border: `1px solid ${T.outlineVariant}1a` }}>
            <div className="p-6" style={{ borderBottom: `1px solid ${T.outlineVariant}1a` }}>
              <h4 className="text-lg font-bold" style={{ fontFamily: "'Manrope', sans-serif", color: T.onSurface }}>Active Channels</h4>
              <p className="text-sm" style={{ color: T.onSurfaceVariant }}>Real-time advertising spend cluster</p>
            </div>

            {/* Tabs */}
            <div className="flex p-1 mx-6 mt-4 rounded-lg" style={{ background: T.surfaceContLow }}>
              {(["google", "meta"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="flex-1 py-2 text-xs font-bold rounded-md transition-all"
                  style={
                    activeTab === tab
                      ? { background: T.surfaceContLowest, color: T.primaryContainer, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }
                      : { color: T.onSurfaceVariant }
                  }
                >
                  {tab === "google" ? "Google Ads" : "Meta Ads"}
                </button>
              ))}
            </div>

            {/* Channel List */}
            <div className="p-6 space-y-4">
              {sk ? (
                [1, 2].map((i) => (
                  <div key={i} className="space-y-2">
                    <div className="h-4 rounded animate-pulse" style={{ background: T.surfaceContLow }} />
                    <div className="h-1.5 rounded-full animate-pulse" style={{ background: T.surfaceContLow }} />
                  </div>
                ))
              ) : activeTab === "google" && campaigns.length > 0 ? (
                campaigns.map((c) => {
                  const pct = Math.max(Math.round((c.costUsd / maxCampSpend) * 100), 3);
                  return (
                    <div key={c.campaignId} className="cursor-pointer group">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: T.surfaceCont }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 20, color: T.onSurfaceVariant }}>ads_click</span>
                          </div>
                          <span className="font-bold text-sm truncate" style={{ color: T.onSurface }}>{c.campaignName}</span>
                        </div>
                        <span className="text-sm font-bold shrink-0 ml-2" style={{ color: T.onSurface }}>{fmtCurrency(c.costUsd, sym)}</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: T.surfaceContLow }}>
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: T.primaryContainer }} />
                      </div>
                      <div className="flex justify-between items-center mt-2">
                        <span className="text-[10px] font-bold uppercase flex items-center gap-1" style={{ color: T.tertiary }}>
                          <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: T.tertiary }} />
                          {c.status === "ENABLED" ? "Active" : c.status}
                        </span>
                        <span className="text-[10px] font-medium" style={{ color: T.onSurfaceVariant }}>
                          {c.budgetUsd ? `Budget: ${fmtCurrency(c.budgetUsd, sym)}` : `${fmtNum(c.clicks)} clicks`}
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : activeTab === "google" && !gadsConnected ? (
                <div className="text-center py-4">
                  <p className="text-xs" style={{ color: T.onSurfaceVariant }}>Connect Google Ads to see live channels</p>
                  <button onClick={() => navigate("/connections")} className="mt-2 text-xs font-bold" style={{ color: T.primaryContainer }}>Connect →</button>
                </div>
              ) : activeTab === "meta" && !metaConnected ? (
                <div className="text-center py-4">
                  <p className="text-xs" style={{ color: T.onSurfaceVariant }}>Connect Meta Ads to see live channels</p>
                  <button onClick={() => navigate("/connections")} className="mt-2 text-xs font-bold" style={{ color: T.primaryContainer }}>Connect →</button>
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-xs" style={{ color: T.onSurfaceVariant }}>No active campaigns in this period</p>
                </div>
              )}
            </div>

            <div className="p-6 pt-0">
              <button
                onClick={() => onChat?.("Show me a breakdown of all active ad campaigns by spend and performance.")}
                className="w-full py-2.5 rounded-lg text-xs font-bold transition-colors"
                style={{ background: T.surfaceContLowest, border: `1px solid ${T.outlineVariant}4d`, color: T.onSurfaceVariant }}
                onMouseEnter={(e) => (e.currentTarget.style.background = T.surfaceContLow)}
                onMouseLeave={(e) => (e.currentTarget.style.background = T.surfaceContLowest)}
              >
                Manage All Ad Clusters
              </button>
            </div>
          </div>

          {/* AI Intelligence Card */}
          <div
            className="rounded-xl p-6 relative overflow-hidden group cursor-pointer"
            style={{ background: `${T.primaryContainer}0d`, border: `1px solid ${T.primaryContainer}1a` }}
            onClick={() => onChat?.(kpis?.hasData ? "Analyse my campaigns and give me 3 specific optimization recommendations." : "What should I connect first to get AI-powered campaign insights?")}
          >
            <div className="absolute -right-6 -top-6 group-hover:scale-110 transition-transform duration-500" style={{ color: `${T.primaryContainer}1a` }}>
              <span className="material-symbols-outlined" style={{ fontSize: 100, fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
            </div>
            <div className="relative z-10 space-y-4">
              <div className="flex items-center gap-2" style={{ color: T.primaryContainer }}>
                <span className="material-symbols-outlined">smart_toy</span>
                <span className="text-sm font-bold uppercase tracking-wider">AI Intelligence</span>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: T.onSurface }}>
                {kpis?.hasData && kpis.poas > 0 ? (
                  <>
                    Current data shows a{" "}
                    <strong style={{ color: T.primaryContainer }}>{kpis.poas.toFixed(2)}× POAS</strong>{" "}
                    across {kpis.campaignCount} campaign{kpis.campaignCount !== 1 ? "s" : ""}.
                    {leaks.length > 0
                      ? ` ${leaks.length} margin leak${leaks.length !== 1 ? "s" : ""} detected — auto-pause recommended.`
                      : " All ads are linked to in-stock inventory."}
                  </>
                ) : (
                  <>"Connect your ad platforms to unlock AI-powered insights — POAS analysis, margin leak detection, and budget optimisation recommendations."</>
                )}
              </p>
              <Link href={kpis?.hasData ? "/budget-pacing" : "/connections"}>
                <button className="text-xs font-bold uppercase flex items-center gap-1 transition-all hover:gap-2" style={{ color: T.primaryContainer }}>
                  {kpis?.hasData ? "Deploy Strategy" : "Get Started"}
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_forward</span>
                </button>
              </Link>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
