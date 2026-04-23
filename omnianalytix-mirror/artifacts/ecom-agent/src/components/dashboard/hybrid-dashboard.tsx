import { useState, useEffect, useRef } from "react";
import {
  TrendingUp, Users, DollarSign, AlertTriangle, ShoppingCart, Target,
  RefreshCw, Zap, BarChart3, ShieldAlert, AlertCircle, ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/contexts/currency-context";
import { useDateRange } from "@/contexts/date-range-context";
import { authFetch } from "@/lib/auth-fetch";
import { useDashboardStore } from "@/store/dashboardStore";
import { formatUsdInDisplay } from "@/lib/fx-format";
import { formatRelativeTime } from "@/lib/formatters";
import { MetricTooltip } from "@/components/help/metric-tooltip";
import { BudgetPacingBar } from "./budget-pacing-bar";
import { DateRangePicker } from "./date-range-picker";
import { FilterBar } from "./filter-bar";
import { UnifiedBillingHub } from "@/components/dashboard/unified-billing-hub";
import { LookerVisualizationHub } from "@/components/dashboard/looker-visualization-hub";
import { ShareableReports } from "@/components/dashboard/shareable-reports";
import { WindowEmptyBanner } from "./window-empty-banner";

function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(0);
  const frameRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (target === 0) { setValue(0); return; }
    startRef.current = null;
    const tick = (now: number) => {
      if (!startRef.current) startRef.current = now;
      const progress = Math.min((now - startRef.current) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(target * eased);
      if (progress < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [target, duration]);

  return value;
}

const BASE = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

interface WarehouseKpis {
  hasData: boolean;
  hasDataInWindow?: boolean;
  hasDataOutsideWindow?: boolean;
  latestAdsSyncAt?: string | null;
  totalSpend: number;
  estimatedRevenue: number;
  activeProducts: number;
  totalConversions: number;
  totalClicks: number;
  poas: number;
  roas: number;
  inventoryValue: number;
  campaignCount: number;
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

interface PipelineCampaign {
  campaignId: string;
  campaignName: string | null;
  spend: number;
  clicks: number;
  conversions: number;
  cpl: number;
  convRate: number;
}

type Severity = "critical" | "warning" | "info";

interface TriageAlert {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  platform: string;
  action?: string;
  ts: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function fmtCurrency(n: number, _sym: string): string {
  return formatUsdInDisplay(n, { compact: true, decimals: 1 });
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}


function AnimatedValue({ raw, prefix = "", suffix = "", accent }: {
  raw: number; prefix?: string; suffix?: string; accent: string;
}) {
  const count = useCountUp(raw);
  const display = count >= 1_000_000 ? `${(count / 1_000_000).toFixed(1)}M`
    : count >= 1_000 ? `${(count / 1_000).toFixed(1)}k`
    : count >= 10 ? `${Math.round(count)}`
    : count.toFixed(2);
  return (
    <span className="text-[26px] font-bold font-[system-ui] tabular-nums leading-none"
      style={{ color: accent, textShadow: "none" }}>
      {prefix}{display}{suffix}
    </span>
  );
}

interface HybridWidgetProps {
  label: string;
  value: string;
  rawValue?: number;
  prefix?: string;
  suffix?: string;
  sub?: string;
  icon: React.ReactNode;
  accent: string;
  trend?: { label: string; up: boolean };
  skeleton?: boolean;
  lens?: "sales" | "pipeline" | "unified";
  tooltip?: string;
}

function HybridWidget({ label, value, rawValue, prefix = "", suffix = "", sub, icon, accent, trend, skeleton, lens, tooltip }: HybridWidgetProps) {
  const lensColor = lens === "sales" ? "text-emerald-400/50" : lens === "pipeline" ? "text-violet-400/50" : "text-amber-400/50";
  const lensLabel = lens === "sales" ? "SALES" : lens === "pipeline" ? "PIPELINE" : "UNIFIED";

  return (
    <div className={cn(
      "relative rounded-2xl overflow-hidden",
      "bg-white ",
      "border border-outline-variant/15",
      "shadow-sm",
      "p-4 flex flex-col gap-2",
      "hover:border-[#c8c5cb] hover:shadow-md transition-all duration-300",
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-[system-ui] text-on-secondary-container uppercase tracking-[0.15em] font-medium">{label}</span>
          {tooltip && <MetricTooltip content={tooltip} />}
          {lens && (
            <span className={cn("text-[7px] font-[system-ui] uppercase tracking-[0.2em] font-bold", lensColor)}>
              {lensLabel}
            </span>
          )}
        </div>
        <span style={{ color: accent }} className="opacity-60">{icon}</span>
      </div>

      {skeleton ? (
        <div className="h-7 w-20 bg-surface-container-low rounded-2xl animate-pulse mt-1" />
      ) : (
        <div className="flex items-end gap-2">
          {rawValue !== undefined && rawValue > 0 ? (
            <AnimatedValue raw={rawValue} prefix={prefix} suffix={suffix} accent={accent} />
          ) : (
            <span className="text-[26px] font-bold font-[system-ui] tabular-nums leading-none"
              style={{ color: accent, textShadow: "none" }}>
              {value}
            </span>
          )}
          {sub && <span className="text-[10px] font-[system-ui] text-on-surface-variant mb-0.5">{sub}</span>}
        </div>
      )}

      {trend && !skeleton && (
        <div className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[8px] font-[system-ui] font-medium border w-fit",
          trend.up
            ? "text-emerald-400 border-emerald-500/15 bg-emerald-500/8"
            : "text-rose-400 border-rose-500/15 bg-error-container/8",
        )}>
          {trend.up ? "↑" : "↓"} {trend.label}
        </div>
      )}

      <div className="absolute bottom-0 left-4 right-4 h-px opacity-20"
        style={{ background: 'transparent' }} />
    </div>
  );
}

const SEV_STYLES: Record<Severity, { dot: string; badge: string; border: string }> = {
  critical: { dot: "#ff6b6b", badge: "text-rose-400 bg-error-container/10 border-rose-500/20", border: "border-rose-500/15" },
  warning:  { dot: "#fbbf24", badge: "text-amber-400 bg-amber-500/10 border-amber-500/20", border: "border-amber-500/15" },
  info:     { dot: "#60a5fa", badge: "text-[#60a5fa] bg-primary-container/10 border-primary-container/20", border: "border-primary-container/15" },
};

function TriageAlertRow({ alert, onStart }: { alert: TriageAlert; onStart: (p: string) => void }) {
  const sev = SEV_STYLES[alert.severity];
  return (
    <button
      onClick={() => onStart(
        alert.action
          ? `${alert.title}. Recommended action: ${alert.action}. Analyse this issue and provide a step-by-step resolution.`
          : `Analyse this issue: ${alert.title}`,
      )}
      className={cn(
        "w-full text-left rounded-2xl border p-3.5 transition-all group",
        "hover:bg-surface active:scale-[0.995]",
        "bg-white ",
        sev.border,
      )}
    >
      <div className="flex items-start gap-3">
        <span className="w-1.5 h-1.5 rounded-full mt-2 shrink-0"
          style={{ background: sev.dot, boxShadow: "none" }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={cn("text-[8px] font-[system-ui] font-semibold px-1.5 py-0.5 rounded-full border", sev.badge)}>
              {alert.platform}
            </span>
            <span className="text-[11px] font-[system-ui] font-semibold text-on-surface">{alert.title}</span>
          </div>
          <p className="text-[10px] font-[system-ui] text-on-surface-variant leading-relaxed">{alert.detail}</p>
        </div>
        <ArrowRight className="w-3.5 h-3.5 shrink-0 text-on-surface-variant group-hover:text-on-surface-variant mt-1 transition-colors" />
      </div>
    </button>
  );
}

export function HybridDashboard({ onChat }: { onChat?: (msg: string) => void }) {
  const { currencySymbol: sym } = useCurrency();
  const { dateRange, refreshKey } = useDateRange();
  const [kpis, setKpis] = useState<WarehouseKpis | null>(null);
  const [leaks, setLeaks] = useState<MarginLeak[]>([]);
  const [pipeline, setPipeline] = useState<PipelineCampaign[]>([]);
  const [triageAlerts, setTriageAlerts] = useState<TriageAlert[]>([]);
  const [pipelineHasDataOutsideWindow, setPipelineHasDataOutsideWindow] = useState(false);
  const [pipelineLatestAdsSyncAt, setPipelineLatestAdsSyncAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);
  const [triageError, setTriageError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setTriageError(false);
    // Task #209: clear stale window-empty state before each fetch so the
    // banner does not persist if the request fails or is aborted.
    useDashboardStore.getState().setLeaksWindowMeta(false, null);
    try {
      const qs = `?days=${dateRange.daysBack}&from=${dateRange.from.toISOString().slice(0,10)}&to=${dateRange.to.toISOString().slice(0,10)}`;
      const [kpiRes, leakRes, triageRes, pipelineRes] = await Promise.all([
        authFetch(`${API_BASE}api/warehouse/kpis${qs}`, { signal: controller.signal }),
        authFetch(`${API_BASE}api/warehouse/margin-leaks${qs}`, { signal: controller.signal }),
        authFetch(`${API_BASE}api/live-triage?goal=hybrid&days=${dateRange.daysBack}`, { signal: controller.signal }),
        authFetch(`${API_BASE}api/warehouse/pipeline-triage${qs}`, { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      if (kpiRes.ok) setKpis(await kpiRes.json() as WarehouseKpis);
      if (controller.signal.aborted) return;
      if (leakRes.ok) {
        const d = await leakRes.json() as {
          data?: MarginLeak[];
          leaks?: MarginLeak[];
          hasDataOutsideWindow?: boolean;
          latestAdsSyncAt?: string | null;
        };
        setLeaks(d.data ?? d.leaks ?? []);
        // Task #209: push window-empty meta into the store so the bento widget
        // can show the amber banner without needing props.
        useDashboardStore.getState().setLeaksWindowMeta(
          Boolean(d.hasDataOutsideWindow),
          d.latestAdsSyncAt ?? null,
        );
      }
      if (controller.signal.aborted) return;
      if (triageRes.ok) {
        const d = await triageRes.json() as { alerts: TriageAlert[] };
        setTriageAlerts(d.alerts ?? []);
      } else {
        setTriageError(true);
      }
      if (controller.signal.aborted) return;
      if (pipelineRes.ok) {
        const d = await pipelineRes.json() as {
          data?: PipelineCampaign[];
          campaigns?: PipelineCampaign[];
          hasDataOutsideWindow?: boolean;
          latestAdsSyncAt?: string | null;
        };
        setPipeline(d.data ?? d.campaigns ?? []);
        // Task #210: capture flags so the Pipeline Quality Triage section can
        // show WindowEmptyBanner when the warehouse has older rows but the
        // active date window has none — mirroring task #114 in leadgen-dashboard.
        setPipelineHasDataOutsideWindow(Boolean(d.hasDataOutsideWindow));
        setPipelineLatestAdsSyncAt(d.latestAdsSyncAt ?? null);
      }
      setLastRefresh(Date.now());
    } catch {
      if (controller.signal.aborted) return;
      setTriageError(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return () => { abortRef.current?.abort(); };
  }, [dateRange.daysBack, refreshKey]);

  const sk = loading && !kpis;
  const noData = !!(kpis && !kpis.hasData);
  const windowEmpty = !!(kpis && kpis.hasDataOutsideWindow);

  const cac = kpis && kpis.totalConversions > 0 ? kpis.totalSpend / kpis.totalConversions : 0;
  // ---- Honesty fix: see leadgen-dashboard.tsx ----
  // Pipeline Value cannot be derived from ad-platform data alone; the prior
  // `totalConversions × $850` heuristic invented numbers. Show "—" until
  // real CRM-sourced KPIs are wired.
  const pipelineDataAvailable = false;
  const pipelineValue = 0;
  const sqlRate = 0;

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
      <FilterBar
        pageKey="hybrid"
        dimensions={[
          { id: "platform" },
          { id: "country" },
          { id: "lifecycle" },
          { id: "segment" },
        ]}
      />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <p className="text-[9px] font-[system-ui] font-semibold text-amber-400/60 uppercase tracking-[0.2em]">
              Hybrid Intelligence
            </p>
            <span className="px-2 py-0.5 rounded-full text-[7px] font-[system-ui] font-bold uppercase tracking-[0.15em] bg-amber-500/10 text-amber-400 border border-amber-500/20">
              Dual Funnel
            </span>
          </div>
          <h2 className="text-sm font-bold font-[system-ui] text-on-surface mt-1">Unified Command Dashboard</h2>
        </div>
        <div className="flex items-center gap-3">
          <DateRangePicker />
          {lastRefresh && (
            <span className="text-[9px] font-[system-ui] text-on-surface-variant">
              {formatRelativeTime(lastRefresh, "Never")}
            </span>
          )}
          <button
            onClick={() => void load()}
            disabled={loading}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-2xl",
              "border border-outline-variant/15 bg-surface ",
              "text-[10px] font-[system-ui] font-medium text-on-secondary-container",
              "hover:text-on-surface hover:border-[#c8c5cb] transition-all disabled:opacity-40",
            )}
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {!loading && windowEmpty && (
        <WindowEmptyBanner latestSyncAt={kpis?.latestAdsSyncAt ?? null} />
      )}

      {!loading && kpis && !kpis.hasData && !windowEmpty && (
        <div className="rounded-2xl border ghost-border bg-white  px-6 py-10 text-center shadow-sm">
          <p className="text-xs font-[system-ui] text-on-secondary-container">No data yet — connect your platforms to see unified metrics across both sales and pipeline.</p>
          <button
            onClick={() => onChat?.("Run a full hybrid workspace diagnostic. Check all connected platforms and report on both revenue and pipeline health.")}
            className="mt-4 text-[10px] font-[system-ui] font-medium text-amber-400 hover:text-amber-300 transition-colors"
          >
            Ask AI to run full diagnostic →
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <HybridWidget
          label="Blended POAS"
          value={noData ? "No Data" : kpis ? `${kpis.poas.toFixed(2)}×` : "Loading\u2026"}
          rawValue={noData ? 0 : (kpis?.poas ?? 0)}
          suffix="×"
          sub={noData ? "connect platforms to sync" : "profit on ad spend"}
          icon={<TrendingUp className="w-4 h-4" />}
          accent={noData ? "#9ca3af" : "#34d399"}
          trend={!noData && kpis && kpis.poas > 0 ? { label: kpis.poas > 1 ? "profitable" : "below breakeven", up: kpis.poas > 1 } : undefined}
          skeleton={sk || noData}
          lens="sales"
          tooltip="POAS (Profit on Ad Spend) measures actual profit per dollar of ad spend. Unlike ROAS which uses gross revenue, POAS subtracts COGS, shipping, and fees to reveal true profitability."
        />
        <HybridWidget
          label="Blended CAC"
          value={noData ? "No Data" : cac > 0 ? fmtCurrency(cac, sym) : "Loading\u2026"}
          rawValue={noData ? 0 : cac}
          prefix="$"
          sub={noData ? "connect platforms to sync" : "per acquisition"}
          icon={<Users className="w-4 h-4" />}
          accent={noData ? "#9ca3af" : "#a78bfa"}
          trend={!noData && cac > 0 ? { label: cac < 200 ? "healthy" : "above target", up: cac < 200 } : undefined}
          skeleton={sk || noData}
          lens="pipeline"
          tooltip="CAC (Customer Acquisition Cost) is your total ad spend divided by conversions. A lower CAC means more efficient spending. Compare against customer LTV to gauge sustainability."
        />
        <div className="flex flex-col">
          <HybridWidget
            label="Total Ad Spend"
            value={noData ? "No Data" : kpis ? fmtCurrency(kpis.totalSpend, sym) : "Loading\u2026"}
            rawValue={noData ? 0 : (kpis?.totalSpend ?? 0)}
            prefix="$"
            sub={noData ? "connect platforms to sync" : dateRange.label}
            icon={<DollarSign className="w-4 h-4" />}
            accent={noData ? "#9ca3af" : "#fbbf24"}
            skeleton={sk || noData}
            lens="unified"
            tooltip={`Aggregate spend across all connected ad platforms for ${dateRange.label.toLowerCase()}. Budget-constrained campaigns may be leaving revenue on the table.`}
          />
          {!noData && kpis && kpis.totalSpend > 0 && (
            <div className="px-4 pb-3 -mt-1">
              <BudgetPacingBar totalSpend={kpis.totalSpend} currencySymbol={sym} />
            </div>
          )}
        </div>
        <HybridWidget
          label="Margin Leaks"
          value={noData ? "No Data" : `${leaks.length}`}
          rawValue={noData ? 0 : leaks.length}
          sub={noData ? "connect platforms to sync" : "OOS SKUs with ads"}
          icon={<AlertTriangle className="w-4 h-4" />}
          accent={noData ? "#9ca3af" : leaks.length > 0 ? "#ff6b6b" : "#34d399"}
          trend={!noData ? (leaks.length > 0 ? { label: `${leaks.length} active`, up: false } : { label: "clear", up: true }) : undefined}
          skeleton={sk || noData}
          lens="sales"
          tooltip="Margin leaks are active ad campaigns promoting out-of-stock products. These waste budget on clicks that cannot convert, directly eroding profit."
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <HybridWidget
          label="Pipeline Value"
          value={noData ? "No Data" : pipelineDataAvailable && pipelineValue > 0 ? fmtCurrency(pipelineValue, sym) : "—"}
          rawValue={noData ? 0 : pipelineValue}
          prefix={pipelineDataAvailable ? sym : undefined}
          sub={noData ? "connect platforms to sync" : pipelineDataAvailable ? "from CRM stages" : "requires CRM (HubSpot, Salesforce)"}
          icon={<Target className="w-4 h-4" />}
          accent={noData || !pipelineDataAvailable ? "#9ca3af" : "#34d399"}
          skeleton={sk || noData}
          lens="pipeline"
        />
        <HybridWidget
          label="Revenue"
          value={noData ? "No Data" : kpis ? fmtCurrency(kpis.estimatedRevenue || 0, sym) : "Loading\u2026"}
          rawValue={noData ? 0 : (kpis?.estimatedRevenue ?? 0)}
          prefix="$"
          sub={noData ? "connect platforms to sync" : "DTC conversions"}
          icon={<ShoppingCart className="w-4 h-4" />}
          accent={noData ? "#9ca3af" : "#60a5fa"}
          skeleton={sk || noData}
          lens="sales"
        />
        <HybridWidget
          label="MQL→SQL"
          value={noData ? "No Data" : pipelineDataAvailable && sqlRate > 0 ? `${Math.min(sqlRate, 99.9).toFixed(1)}%` : "—"}
          rawValue={noData ? 0 : (pipelineDataAvailable && sqlRate > 0 ? Math.min(sqlRate, 99.9) : 0)}
          suffix={pipelineDataAvailable && sqlRate > 0 ? "%" : undefined}
          sub={noData ? "connect platforms to sync" : pipelineDataAvailable ? "pipeline rate" : "requires CRM (HubSpot, Salesforce)"}
          icon={<BarChart3 className="w-4 h-4" />}
          accent={noData || !pipelineDataAvailable ? "#9ca3af" : sqlRate > 20 ? "#34d399" : sqlRate > 10 ? "#fbbf24" : "#ff6b6b"}
          skeleton={sk || noData}
          lens="pipeline"
          tooltip="MQL→SQL conversion is a CRM-derived metric tracking lead lifecycle progression. It cannot be computed from ad clicks alone."
        />
      </div>

      <div className={cn(
        "rounded-2xl overflow-hidden",
        "bg-white ",
        "border border-outline-variant/15",
        "shadow-sm",
      )}>
        <div className="px-5 py-3.5 border-b ghost-border flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <Zap className="w-3 h-3 text-amber-400" />
            </div>
            <span className="text-[10px] font-[system-ui] font-bold text-on-surface uppercase tracking-[0.12em]">
              Unified Live Triage
            </span>
            {triageAlerts.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[8px] font-[system-ui] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                {triageAlerts.length}
              </span>
            )}
          </div>
          <span className="text-[8px] font-[system-ui] text-on-surface-variant uppercase tracking-wider">
            Sales + Pipeline alerts
          </span>
        </div>

        <div className="p-4 space-y-2">
          {sk ? (
            <div className="space-y-2.5">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-surface rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : triageError ? (
            <div className="py-8 text-center">
              <div className="w-10 h-10 rounded-2xl bg-error-container/10 border border-rose-500/15 flex items-center justify-center mx-auto mb-3">
                <AlertCircle className="w-5 h-5 text-rose-400" />
              </div>
              <p className="text-[11px] font-[system-ui] text-rose-400/70 font-medium">
                Triage data unavailable — unable to determine system health.
              </p>
              <button onClick={() => void load()} className="mt-2 text-[10px] font-[system-ui] text-amber-400 hover:text-amber-300 transition-colors">
                Retry →
              </button>
            </div>
          ) : triageAlerts.length === 0 ? (
            // Honesty fix: "All systems nominal" must not be shown when the
            // warehouse has no data — the triage detector cannot conclude
            // anything from an empty input. Reuse the existing `noData`
            // flag (same definition as the KPI cards above).
            noData ? (
              <div className="py-8 text-center">
                <div className="w-10 h-10 rounded-2xl bg-on-surface-variant/10 border border-outline-variant/30 flex items-center justify-center mx-auto mb-3">
                  <AlertCircle className="w-5 h-5 text-on-surface-variant" />
                </div>
                <p className="text-[11px] font-[system-ui] text-on-surface-variant font-medium max-w-[34ch] mx-auto leading-relaxed">
                  Awaiting first warehouse sync — connect a data source to begin cross-funnel triage.
                </p>
              </div>
            ) : (
              <div className="py-8 text-center">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center mx-auto mb-3">
                  <ShieldAlert className="w-5 h-5 text-emerald-400" />
                </div>
                <p className="text-[11px] font-[system-ui] text-emerald-400/70 font-medium">
                  All systems nominal — no critical issues across either funnel.
                </p>
              </div>
            )
          ) : (
            triageAlerts.slice(0, 6).map((alert) => (
              <TriageAlertRow
                key={alert.id}
                alert={alert}
                onStart={(p) => onChat?.(p)}
              />
            ))
          )}
        </div>

        {triageAlerts.length > 0 && (
          <div className="px-5 py-3 border-t ghost-border">
            <button
              onClick={() => onChat?.(`I see ${triageAlerts.length} ${triageAlerts.length === 1 ? "alert" : "alerts"} across both funnels. Run a complete cross-funnel triage and prioritise actions by total margin + pipeline impact.`)}
              className="text-[10px] font-[system-ui] font-medium text-amber-400 hover:text-amber-300 transition-colors flex items-center gap-1.5"
            >
              <Zap className="w-3 h-3" />
              Ask AI for cross-funnel resolution plan →
            </button>
          </div>
        )}
      </div>

      {!sk && pipelineHasDataOutsideWindow && pipeline.length === 0 && (
        // Task #210: warehouse has pipeline data outside this date window but
        // none within the active window — show the shared disambiguation banner.
        // This section is intentionally hidden when pipeline rows are present
        // until a full Pipeline Quality Triage grid is wired up (task #319).
        <div className={cn(
          "rounded-2xl overflow-hidden",
          "bg-white ",
          "border border-outline-variant/15",
          "shadow-sm",
        )}>
          <div className="px-5 py-3.5 border-b ghost-border flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                <BarChart3 className="w-3 h-3 text-violet-400" />
              </div>
              <span className="text-[10px] font-[system-ui] font-bold text-on-surface uppercase tracking-[0.12em]">
                Pipeline Quality Triage
              </span>
            </div>
            <span className="text-[8px] font-[system-ui] text-on-surface-variant uppercase tracking-wider">
              Pipeline campaigns
            </span>
          </div>
          <div className="px-4 py-3">
            <WindowEmptyBanner latestSyncAt={pipelineLatestAdsSyncAt} />
          </div>
        </div>
      )}

      {kpis && kpis.hasData && (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Campaigns", value: fmtNum(kpis.campaignCount), color: "var(--on-surface-variant)" },
            { label: "Conversions", value: fmtNum(kpis.totalConversions), color: "var(--on-surface-variant)" },
            { label: "Inventory", value: fmtCurrency(kpis.inventoryValue || 0, sym), color: "var(--on-surface-variant)" },
            { label: "ROAS", value: `${(kpis.roas || 0).toFixed(1)}×`, color: "var(--on-surface-variant)" },
          ].map((s) => (
            <div key={s.label} className={cn(
              "rounded-2xl border ghost-border px-3 py-2.5 text-center",
              "bg-surface ",
            )}>
              <p className="text-[8px] font-[system-ui] text-on-surface-variant uppercase tracking-[0.15em] font-medium">{s.label}</p>
              <p className="text-sm font-bold font-[system-ui] mt-0.5" style={{ color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>
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
        title={`Hybrid Performance · ${dateRange.label}`}
        filenameBase="hybrid-performance"
      />
    </div>
  );
}
