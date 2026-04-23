import { useState, useEffect, useRef } from "react";
import { Users, Target, TrendingUp, BarChart3, Loader2, RefreshCw, Zap, AlertCircle } from "lucide-react";
import { BudgetPacingBar } from "./budget-pacing-bar";
import { DateRangePicker } from "./date-range-picker";
import { FilterBar } from "./filter-bar";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/contexts/currency-context";
import { useDateRange } from "@/contexts/date-range-context";
import { authFetch } from "@/lib/auth-fetch";
import { formatUsdInDisplay } from "@/lib/fx-format";
import { formatRelativeTime } from "@/lib/formatters";
import { MetricTooltip } from "@/components/help/metric-tooltip";
import { UnifiedBillingHub } from "@/components/dashboard/unified-billing-hub";
import { LookerVisualizationHub } from "@/components/dashboard/looker-visualization-hub";
import { ShareableReports } from "@/components/dashboard/shareable-reports";
import { WindowEmptyBanner } from "./window-empty-banner";

// ─── Count-up hook ─────────────────────────────────────────────────────────────

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

// ─── Types ────────────────────────────────────────────────────────────────────

interface WarehouseKpis {
  hasData: boolean;
  hasDataInWindow?: boolean;
  hasDataOutsideWindow?: boolean;
  latestAdsSyncAt?: string | null;
  totalSpend: number;
  totalConversions: number;
  totalClicks: number;
  campaignCount: number;
  poas: number;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Currency-honesty fix: every numeric value passed here originates from the
// warehouse, which only stores USD. Prepending the user's preferred symbol
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function fmtCurrency(n: number, _sym: string): string {
  return formatUsdInDisplay(n, { compact: true, decimals: 1 });
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}


// ─── Widget Card ──────────────────────────────────────────────────────────────

interface WidgetProps {
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
  wide?: boolean;
  tooltip?: string;
}

function AnimatedValue({ raw, prefix = "", suffix = "", accent }: { raw: number; prefix?: string; suffix?: string; accent: string }) {
  const count = useCountUp(raw);
  const display = count >= 1_000_000 ? `${(count / 1_000_000).toFixed(1)}M`
    : count >= 1_000 ? `${(count / 1_000).toFixed(1)}k`
    : count >= 10 ? `${Math.round(count)}`
    : count.toFixed(2);
  return (
    <span className="text-[28px] font-bold font-mono tabular-nums leading-none"
      style={{ color: accent, textShadow: "none" }}>
      {prefix}{display}{suffix}
    </span>
  );
}

function Widget({ label, value, rawValue, prefix = "", suffix = "", sub, icon, accent, trend, skeleton, wide, tooltip }: WidgetProps) {
  return (
    <div
      className={cn(
        "relative rounded-2xl border border-outline-variant/15 overflow-hidden",
        "bg-white border-outline-variant/15",
        "shadow-sm",
        "p-4 flex flex-col gap-2 hover:border-[#c8c5cb] transition-colors",
        wide && "col-span-2",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <span className="text-[9px] font-mono text-on-secondary-container uppercase tracking-[0.2em]">{label}</span>
          {tooltip && <MetricTooltip content={tooltip} />}
        </span>
        <span style={{ color: accent }} className="opacity-70">{icon}</span>
      </div>

      {skeleton ? (
        <div className="h-8 w-24 bg-surface-container-highest rounded-2xl animate-pulse mt-1" />
      ) : (
        <div className="flex items-end gap-2">
          {rawValue !== undefined && rawValue > 0 ? (
            <AnimatedValue raw={rawValue} prefix={prefix} suffix={suffix} accent={accent} />
          ) : (
            <span
              className="text-[28px] font-bold font-mono tabular-nums leading-none"
              style={{ color: accent, textShadow: "none" }}
            >
              {value}
            </span>
          )}
          {sub && (
            <span className="text-[11px] font-mono text-on-surface-variant mb-0.5">{sub}</span>
          )}
        </div>
      )}

      {trend && !skeleton && (
        <div className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-mono border w-fit",
          trend.up
            ? "text-emerald-600 border-emerald-200 bg-emerald-50"
            : "text-error-m3 border-error-m3/20 bg-error-container",
        )}>
          {trend.up ? "↑" : "↓"} {trend.label}
        </div>
      )}

      <div
        className="absolute bottom-0 left-0 right-0 h-[2px] opacity-40"
        style={{ background: 'transparent' }}
      />
    </div>
  );
}

// ─── Pipeline Triage Row ──────────────────────────────────────────────────────

function TriageRow({ c, sym }: { c: PipelineCampaign; sym: string }) {
  const convPct = (c.convRate * 100).toFixed(2);
  const isCritical = c.convRate < 0.005 && c.spend > 100;
  const isWarning  = c.convRate < 0.01  && c.spend > 50;
  const dotColor   = isCritical ? "#ef4444" : isWarning ? "#ffd47e" : "#a8b5e0";

  return (
    <div className="flex items-start gap-3 py-2.5 border-b ghost-border last:border-0">
      <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: dotColor, boxShadow: "none" }} />
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-mono text-on-surface truncate">{c.campaignName || "Unnamed Campaign"}</p>
        <p className="text-[9px] font-mono text-on-surface-variant">
          {fmtNum(c.clicks)} contacts · {convPct}% conversion rate · CPL {fmtCurrency(c.cpl, sym)}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[11px] font-mono font-bold" style={{ color: isCritical ? "#ef4444" : "#ffd47e" }}>
          {fmtCurrency(c.spend, sym)}
        </p>
        <p className="text-[9px] font-mono text-on-surface-variant">{fmtNum(c.conversions)} conv.</p>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function LeadGenDashboard({ onChat }: { onChat?: (msg: string) => void }) {
  const { currencySymbol: sym } = useCurrency();
  const { dateRange, refreshKey } = useDateRange();
  const [kpis, setKpis] = useState<WarehouseKpis | null>(null);
  const [campaigns, setCampaigns] = useState<PipelineCampaign[]>([]);
  // Task #114: window-empty disambiguation for the pipeline-triage grid.
  const [pipelineHasDataOutsideWindow, setPipelineHasDataOutsideWindow] = useState(false);
  const [pipelineLatestAdsSyncAt,      setPipelineLatestAdsSyncAt]      = useState<string | null>(null);
  // Task #211: sub-threshold notice when campaigns exist but none exceed spend bar.
  const [pipelineHasDataInWindow,      setPipelineHasDataInWindow]      = useState(false);
  const [pipelineInWindowCampaignCount, setPipelineInWindowCampaignCount] = useState(0);
  const [pipelineSpendThresholdUsd,    setPipelineSpendThresholdUsd]    = useState(10);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const qs = `?days=${dateRange.daysBack}&from=${dateRange.from.toISOString().slice(0,10)}&to=${dateRange.to.toISOString().slice(0,10)}`;
      const [kpiRes, triageRes] = await Promise.all([
        authFetch(`${API_BASE}api/warehouse/kpis${qs}`, { signal: controller.signal }),
        authFetch(`${API_BASE}api/warehouse/pipeline-triage${qs}`, { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      if (kpiRes.ok) setKpis(await kpiRes.json() as WarehouseKpis);
      if (controller.signal.aborted) return;
      if (triageRes.ok) {
        const d = await triageRes.json() as {
          data?: PipelineCampaign[];
          campaigns?: PipelineCampaign[];
          hasDataInWindow?: boolean;
          hasDataOutsideWindow?: boolean;
          latestAdsSyncAt?: string | null;
          inWindowCampaignCount?: number;
          spendThresholdUsd?: number;
        };
        setCampaigns(d.data ?? d.campaigns ?? []);
        // Task #114: capture flags so the empty branch can show the
        // WindowEmptyBanner when the warehouse has older rows but the
        // active date window has none — instead of the misleading
        // "no quality issues detected" green-state copy.
        setPipelineHasDataOutsideWindow(Boolean(d.hasDataOutsideWindow));
        setPipelineLatestAdsSyncAt(d.latestAdsSyncAt ?? null);
        // Task #211: capture in-window counts to show the sub-threshold notice.
        setPipelineHasDataInWindow(Boolean(d.hasDataInWindow));
        setPipelineInWindowCampaignCount(Number(d.inWindowCampaignCount) || 0);
        setPipelineSpendThresholdUsd(Number(d.spendThresholdUsd) || 10);
      }
      setLastRefresh(Date.now());
    } catch {
      if (controller.signal.aborted) return;
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

  // Derived lead gen metrics from ad data.
  // CAC is honest — it is a direct ratio of warehouse-known totals.
  const cac = kpis && kpis.totalConversions > 0
    ? kpis.totalSpend / kpis.totalConversions
    : 0;

  // ---- Honesty fix: no more fabricated pipeline metrics ----
  // Pipeline Value and MQL/SQL rate cannot be computed from ad data alone;
  // they require CRM stage values + closed-won amounts. The previous code
  // multiplied conversions × $850 and clicks × 12% as static heuristics,
  // which produced numbers that looked precise but were entirely invented.
  // We now mark them as unavailable so the UI can render "—" and prompt
  // the user to connect a CRM. Tracked via `pipelineDataAvailable`.
  const pipelineDataAvailable = false;  // becomes true once we surface real CRM-sourced KPIs
  const pipelineValue = 0;
  const sqlRate = 0;

  const criticalCount = campaigns.filter((c) => c.convRate < 0.005 && c.spend > 100).length;

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
      <FilterBar
        pageKey="leadgen"
        dimensions={[
          { id: "platform" },
          { id: "campaign" },
          { id: "country" },
          { id: "lifecycle" },
        ]}
      />
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-[0.2em]">Lead Gen & Pipeline</p>
          <h2 className="text-sm font-bold font-mono text-on-surface mt-0.5">Pipeline Intelligence Dashboard</h2>
        </div>
        <div className="flex items-center gap-3">
          <DateRangePicker />
          {lastRefresh && (
            <span className="text-[9px] font-mono text-on-surface-variant">
              Updated {formatRelativeTime(lastRefresh, "Never")}
            </span>
          )}
          <button
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-2xl border border-outline-variant/15 bg-surface text-[10px] font-mono text-on-surface-variant/60 hover:text-on-surface hover:border-[#c8c5cb] transition-all disabled:opacity-40"
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {!loading && windowEmpty && (
        <WindowEmptyBanner latestSyncAt={kpis?.latestAdsSyncAt ?? null} />
      )}

      {/* No data */}
      {!loading && kpis && !kpis.hasData && !windowEmpty && (
        <div className="rounded-2xl border border-outline-variant/15 bg-white px-5 py-8 text-center">
          <p className="text-xs font-mono text-on-secondary-container">No pipeline data yet — connect your ad platforms to start tracking acquisition costs and lead quality.</p>
          <button
            onClick={() => onChat?.("Run a lead gen pipeline audit and check what data sources are connected.")}
            className="mt-3 text-[10px] font-mono text-violet-500 hover:underline"
          >
            Ask AI to audit pipeline →
          </button>
        </div>
      )}

      {/* KPI Widget Grid */}
      <div className="grid grid-cols-2 gap-3">
        <Widget
          label="Blended CAC"
          value={noData ? "No Data" : cac > 0 ? fmtCurrency(cac, sym) : "Loading\u2026"}
          rawValue={noData ? 0 : cac}
          prefix="$"
          sub={noData ? "connect platforms to sync" : "per acquisition"}
          icon={<Users className="w-4 h-4" />}
          accent={noData ? "#9ca3af" : "#a78bfa"}
          trend={!noData && cac > 0 ? { label: cac < 200 ? "healthy range" : "above target", up: cac < 200 } : undefined}
          skeleton={sk || noData}
          tooltip="CAC (Customer Acquisition Cost) is your total ad spend divided by the number of conversions. A lower CAC means more efficient spending. Compare against customer LTV to gauge sustainability."
        />
        <div className="flex flex-col">
          <Widget
            label={`Total Ad Spend (${dateRange.preset === "custom" ? dateRange.label : dateRange.label.replace("Last ", "")})`}
            value={noData ? "No Data" : kpis ? fmtCurrency(kpis.totalSpend, sym) : "Loading\u2026"}
            rawValue={noData ? 0 : (kpis?.totalSpend ?? 0)}
            prefix="$"
            sub={noData ? "connect platforms to sync" : "across all channels"}
            icon={<BarChart3 className="w-4 h-4" />}
            accent={noData ? "#9ca3af" : "#ffd47e"}
            skeleton={sk || noData}
            tooltip={`Aggregate spend across all connected ad platforms for ${dateRange.label.toLowerCase()}. Budget-constrained campaigns may be leaving revenue on the table.`}
          />
          {!noData && kpis && kpis.totalSpend > 0 && (
            <div className="px-4 pb-3 -mt-1">
              <BudgetPacingBar totalSpend={kpis.totalSpend} currencySymbol={sym} />
            </div>
          )}
        </div>
        <Widget
          label="Qualified Pipeline Value"
          value={noData ? "No Data" : pipelineDataAvailable && pipelineValue > 0 ? fmtCurrency(pipelineValue, sym) : "—"}
          rawValue={noData ? 0 : pipelineValue}
          prefix={pipelineDataAvailable ? sym : undefined}
          sub={noData ? "connect platforms to sync" : pipelineDataAvailable ? "from CRM stages" : "requires CRM (HubSpot, Salesforce)"}
          icon={<Target className="w-4 h-4" />}
          accent={noData || !pipelineDataAvailable ? "#9ca3af" : "#16a34a"}
          trend={!noData && pipelineDataAvailable && pipelineValue > 0 ? { label: `${fmtNum(kpis?.totalConversions ?? 0)} qualified`, up: true } : undefined}
          skeleton={sk || noData}
          tooltip="Pipeline value cannot be derived from ad-platform data alone — it requires CRM stage values and closed-won amounts. Connect HubSpot or Salesforce to populate this metric."
        />
        <Widget
          label="MQL-to-SQL Rate"
          value={noData ? "No Data" : pipelineDataAvailable && sqlRate > 0 ? `${Math.min(sqlRate, 99.9).toFixed(1)}%` : "—"}
          rawValue={noData ? 0 : (sqlRate > 0 ? Math.min(sqlRate, 99.9) : 0)}
          suffix={pipelineDataAvailable ? "%" : undefined}
          sub={noData ? "connect platforms to sync" : pipelineDataAvailable ? "conversion pipeline" : "requires CRM lifecycle stages"}
          icon={<TrendingUp className="w-4 h-4" />}
          accent={noData || !pipelineDataAvailable ? "#9ca3af" : sqlRate > 20 ? "#16a34a" : sqlRate > 10 ? "#ffd47e" : "#ef4444"}
          trend={!noData && pipelineDataAvailable && sqlRate > 0 ? { label: sqlRate > 20 ? "strong" : "needs work", up: sqlRate > 20 } : undefined}
          skeleton={sk || noData}
          tooltip="MQL→SQL conversion rate is a CRM-derived metric tracking lead lifecycle progression. It cannot be computed from ad clicks alone."
        />
      </div>

      {/* Pipeline Quality Triage */}
      <div className="rounded-2xl border border-outline-variant/15 bg-white border-outline-variant/15 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b ghost-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-[#ffd47e]" />
            <span className="text-[10px] font-mono font-bold text-on-surface uppercase tracking-[0.15em]">Pipeline Quality Triage</span>
            {criticalCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-mono bg-error-container text-error-m3 border border-error-m3/20">
                {criticalCount} critical
              </span>
            )}
          </div>
          <span className="text-[9px] font-mono text-on-surface-variant">high spend · low conversions</span>
        </div>

        <div className="px-4">
          {sk ? (
            <div className="py-4 space-y-2.5">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-surface-container-low rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : campaigns.length === 0 ? (
            // Honesty fix: don't claim "no quality issues" when there are
            // simply no campaigns in the warehouse to evaluate. `noData`
            // here mirrors the same flag used by the KPI cards above.
            // Task #114: when the warehouse has campaigns outside this date
            // window but none inside, render the shared WindowEmptyBanner
            // (with a "Switch to Last 30 Days" shortcut) instead of the
            // misleading "all campaigns converting efficiently" message.
            // Task #211: when the window has campaigns but none clear the
            // spend threshold, show a specific sub-threshold notice so users
            // aren't confused by what looks like an empty table.
            pipelineHasDataOutsideWindow ? (
              <div className="py-3">
                <WindowEmptyBanner latestSyncAt={pipelineLatestAdsSyncAt} />
              </div>
            ) : pipelineHasDataInWindow && pipelineInWindowCampaignCount > 0 ? (
              <div className="py-6 text-center space-y-1">
                <p className="text-[11px] font-mono text-on-surface-variant">
                  {pipelineInWindowCampaignCount} campaign{pipelineInWindowCampaignCount !== 1 ? "s" : ""} active in this window — all spend under ${pipelineSpendThresholdUsd} triage threshold.
                </p>
                <p className="text-[10px] font-mono text-on-surface-variant/60">
                  Only campaigns exceeding ${pipelineSpendThresholdUsd} in spend are evaluated for quality issues.
                </p>
              </div>
            ) : (
              <div className="py-6 text-center">
                {noData ? (
                  <p className="text-[11px] font-mono text-on-surface-variant">
                    Awaiting first warehouse sync — connect a CRM or ad platform to begin triage analysis.
                  </p>
                ) : (
                  <p className="text-[11px] font-mono text-emerald-600">
                    No pipeline quality issues detected — all active campaigns are converting efficiently.
                  </p>
                )}
              </div>
            )
          ) : (
            <div>
              {campaigns.map((c, i) => (
                <TriageRow key={`${c.campaignId}-${i}`} c={c} sym={sym} />
              ))}
            </div>
          )}
        </div>

        {campaigns.length > 0 && (
          <div className="px-4 py-3 border-t ghost-border">
            <button
              onClick={() => onChat?.(`I can see ${campaigns.length} ${campaigns.length === 1 ? "campaign" : "campaigns"} with poor pipeline efficiency. Analyse each one for conversion rate issues and recommend budget reallocation to improve CAC.`)}
              className="text-[10px] font-mono text-violet-500 hover:text-violet-500/80 transition-colors flex items-center gap-1.5"
            >
              <Zap className="w-3 h-3" />
              Ask AI to rebalance pipeline budget →
            </button>
          </div>
        )}
      </div>

      {/* Summary stats */}
      {kpis && kpis.hasData && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Active Campaigns", value: fmtNum(kpis.campaignCount), color: "var(--on-surface-variant)" },
            { label: "Total Contacts", value: fmtNum(kpis.totalClicks), color: "var(--on-surface-variant)" },
            { label: "Conversions", value: fmtNum(kpis.totalConversions), color: "var(--on-surface-variant)" },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border ghost-border bg-surface px-3 py-2.5 text-center">
              <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-[0.15em]">{s.label}</p>
              <p className="text-sm font-bold font-mono mt-0.5" style={{ color: s.color }}>{s.value}</p>
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
        title={`Lead Gen Performance · ${dateRange.label}`}
        filenameBase="leadgen-performance"
      />
    </div>
  );
}
