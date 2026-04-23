import { useState, useCallback, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { useDateRangeParams } from "@/lib/use-date-range-params";
import { useDateRange } from "@/contexts/date-range-context";
import { cn } from "@/lib/utils";
import { DateRangePicker } from "./date-range-picker";
import { FilterBar } from "./filter-bar";
import { useFilterQs } from "@/lib/use-filter-qs";
import { formatUsdInDisplay } from "@/lib/fx-format";
import {
  AlertTriangle, RefreshCw, ChevronDown, ChevronUp,
  TrendingDown, Users, RotateCcw, CheckCircle2, XCircle,
} from "lucide-react";

const BASE     = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface MarginBleedResult {
  ok: boolean;
  message: string;
  bleedingSkus?: Array<{
    sku: string;
    title?: string;
    roas: number;
    poas: number;
    adSpend: number;
    cogs: number;
    shipping?: number;
    platformFees?: number;
  }>;
  totalBleedingSpend?: number;
  skuCount?: number;
}

interface AudienceOverlapResult {
  ok: boolean;
  message: string;
  daysBack?: number;
  shopifyRevenue?: number;
  googleReportedValue?: number;
  metaReportedValue?: number;
  blendedRoas?: number;
  deduplicatedRoas?: number;
  overlapPct?: number;
  ghostSpend?: number;
}

interface CrmArbitrageResult {
  ok: boolean;
  message: string;
  repurchaseCustomers?: Array<{
    email: string;
    lastOrderDays: number;
    predictedRepurchaseDay: number;
  }>;
  exclusionList?: string[];
  windowStart?: number;
  windowEnd?: number;
  customerCount?: number;
}

type AnalysisState = "idle" | "running" | "done" | "error";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n: number) {
  return formatUsdInDisplay(n, { compact: true, decimals: 1 });
}

function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

// ─── Analysis card shell ───────────────────────────────────────────────────────

function AnalysisCard({
  icon: Icon,
  title,
  subtitle,
  state,
  onRun,
  accentColor,
  children,
}: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  state: AnalysisState;
  onRun: () => void;
  accentColor: string;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  const hasResult = state === "done" || state === "error";

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-5">
        <div className="flex items-start gap-4">
          <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", accentColor)}>
            <Icon className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-slate-900 text-base">{title}</h3>
            <p className="text-slate-500 text-sm mt-0.5 leading-snug">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {hasResult && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="flex items-center gap-1 text-sm text-indigo-600 hover:underline"
              >
                {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                {expanded ? "Hide" : "View"} Results
              </button>
            )}
            <button
              onClick={onRun}
              disabled={state === "running"}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-all"
            >
              {state === "running" ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <span className="material-symbols-outlined text-[16px]">play_arrow</span>
              )}
              {state === "running" ? "Analysing…" : "Run Analysis"}
            </button>
          </div>
        </div>

        {/* Status badge */}
        {state === "done" && (
          <div className="mt-3 flex items-center gap-1.5 text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-1.5 w-fit">
            <CheckCircle2 className="w-4 h-4" />
            Analysis complete
          </div>
        )}
        {state === "error" && (
          <div className="mt-3 flex items-center gap-1.5 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-1.5 w-fit">
            <XCircle className="w-4 h-4" />
            Analysis failed — check platform connections
          </div>
        )}
      </div>

      {/* Results panel */}
      {expanded && hasResult && (
        <div className="border-t border-slate-100 p-5 bg-slate-50/50">{children}</div>
      )}
    </div>
  );
}

// ─── Margin bleed results ──────────────────────────────────────────────────────

function MarginBleedResults({ data }: { data: MarginBleedResult }) {
  if (!data.ok) return <p className="text-slate-500 text-sm">{data.message}</p>;

  const skus = data.bleedingSkus ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-4 flex-wrap">
        <div className="rounded-xl bg-white border border-slate-200 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Bleeding SKUs</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{data.skuCount ?? skus.length}</p>
        </div>
        {data.totalBleedingSpend != null && (
          <div className="rounded-xl bg-white border border-slate-200 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Wasted Ad Spend</p>
            <p className="text-2xl font-bold text-red-600 mt-1">{fmt$(data.totalBleedingSpend)}</p>
          </div>
        )}
      </div>

      {skus.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {["SKU / Title", "ROAS", "POAS", "Ad Spend", "COGS"].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {skus.slice(0, 10).map((s, i) => (
                <tr key={i} className="hover:bg-red-50/40">
                  <td className="px-3 py-2 font-medium text-slate-800">{s.title ?? s.sku}</td>
                  <td className="px-3 py-2 text-emerald-600 tabular-nums">{s.roas.toFixed(2)}x</td>
                  <td className="px-3 py-2 text-red-600 tabular-nums font-semibold">{s.poas.toFixed(2)}x</td>
                  <td className="px-3 py-2 tabular-nums">{fmt$(s.adSpend)}</td>
                  <td className="px-3 py-2 tabular-nums">{fmt$(s.cogs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {skus.length === 0 && (
        <p className="text-slate-500 text-sm">{data.message || "No bleeding SKUs detected."}</p>
      )}
    </div>
  );
}

// ─── Audience overlap results ──────────────────────────────────────────────────

function AudienceOverlapResults({ data }: { data: AudienceOverlapResult }) {
  if (!data.ok) return <p className="text-slate-500 text-sm">{data.message}</p>;

  const metrics = [
    { label: "Shopify Ground Truth Revenue",   value: data.shopifyRevenue != null   ? fmt$(data.shopifyRevenue)          : null },
    { label: "Google Reported Conv Value",      value: data.googleReportedValue != null ? fmt$(data.googleReportedValue) : null },
    { label: "Meta Reported Conv Value",        value: data.metaReportedValue != null   ? fmt$(data.metaReportedValue)   : null },
    { label: "Blended ROAS (platforms claim)", value: data.blendedRoas != null      ? `${data.blendedRoas.toFixed(2)}x`  : null },
    { label: "Deduplicated True ROAS",          value: data.deduplicatedRoas != null ? `${data.deduplicatedRoas.toFixed(2)}x` : null, accent: true },
    { label: "Audience Overlap",                value: data.overlapPct != null       ? fmtPct(data.overlapPct)            : null },
    { label: "Ghost Ad Spend",                  value: data.ghostSpend != null       ? fmt$(data.ghostSpend)              : null, danger: true },
  ].filter((m) => m.value != null);

  return (
    <div>
      <p className="text-sm text-slate-500 mb-4">
        Analysis over the last <strong>{data.daysBack ?? 30}</strong> days
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-xl bg-white border border-slate-200 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 leading-tight">{m.label}</p>
            <p className={cn(
              "text-xl font-bold mt-1 tabular-nums",
              m.danger ? "text-red-600" : m.accent ? "text-indigo-600" : "text-slate-900",
            )}>
              {m.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── CRM arbitrage results ─────────────────────────────────────────────────────

function CrmArbitrageResults({ data }: { data: CrmArbitrageResult }) {
  if (!data.ok) return <p className="text-slate-500 text-sm">{data.message}</p>;

  const customers = data.repurchaseCustomers ?? [];
  const exclusions = data.exclusionList ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-4 flex-wrap">
        <div className="rounded-xl bg-white border border-slate-200 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            In Repurchase Window ({data.windowStart}–{data.windowEnd}d)
          </p>
          <p className="text-2xl font-bold text-indigo-600 mt-1">
            {data.customerCount ?? customers.length}
          </p>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Suggested Ad Exclusions</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{exclusions.length}</p>
        </div>
      </div>

      {customers.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {["Customer", "Last Order (days ago)", "Predicted Repurchase"].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customers.slice(0, 10).map((c, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 font-mono text-slate-700">{c.email}</td>
                  <td className="px-3 py-2 text-slate-600">{c.lastOrderDays}d</td>
                  <td className="px-3 py-2 text-indigo-600 font-medium">Day {c.predictedRepurchaseDay}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {exclusions.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
            Ad Exclusion List (suppress ads to these emails)
          </p>
          <div className="bg-slate-950 rounded-xl p-4 font-mono text-xs text-green-300 max-h-40 overflow-y-auto">
            {exclusions.slice(0, 20).join("\n")}
            {exclusions.length > 20 && `\n… and ${exclusions.length - 20} more`}
          </div>
        </div>
      )}

      {customers.length === 0 && exclusions.length === 0 && (
        <p className="text-slate-500 text-sm">{data.message || "No customers in the repurchase window."}</p>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function CrossPlatformInsights() {
  const { qs, refreshKey } = useDateRangeParams();
  const { dateRange } = useDateRange();
  const [bleedState,     setBleedState]     = useState<AnalysisState>("idle");
  const [overlapState,   setOverlapState]   = useState<AnalysisState>("idle");
  const [arbitrageState, setArbitrageState] = useState<AnalysisState>("idle");

  const [bleedData,     setBleedData]     = useState<MarginBleedResult | null>(null);
  const [overlapData,   setOverlapData]   = useState<AudienceOverlapResult | null>(null);
  const [arbitrageData, setArbitrageData] = useState<CrmArbitrageResult | null>(null);

  const runBleed = useCallback(async () => {
    setBleedState("running");
    try {
      const res  = await authFetch(`${API_BASE}api/insights/cross-platform/margin-bleed${qs}`);
      const data = await res.json();
      setBleedData(data);
      setBleedState(data.ok ? "done" : "error");
    } catch {
      setBleedState("error");
    }
  }, [qs]);

  const runOverlap = useCallback(async () => {
    setOverlapState("running");
    try {
      const res  = await authFetch(`${API_BASE}api/insights/cross-platform/audience-overlap${qs}`);
      const data = await res.json();
      setOverlapData(data);
      setOverlapState(data.ok ? "done" : "error");
    } catch {
      setOverlapState("error");
    }
  }, [qs]);

  const runArbitrage = useCallback(async () => {
    setArbitrageState("running");
    try {
      const res  = await authFetch(`${API_BASE}api/insights/cross-platform/crm-arbitrage${qs}`);
      const data = await res.json();
      setArbitrageData(data);
      setArbitrageState(data.ok ? "done" : "error");
    } catch {
      setArbitrageState("error");
    }
  }, [qs]);

  // When the global date range or refresh key changes, re-run any analysis
  // the user has already completed so the displayed numbers track the picker.
  // Skip analyses that are still idle — those require explicit user action.
  useEffect(() => {
    if (bleedState === "done" || bleedState === "error")     void runBleed();
    if (overlapState === "done" || overlapState === "error") void runOverlap();
    if (arbitrageState === "done" || arbitrageState === "error") void runArbitrage();
    // We intentionally only depend on the date params + refreshKey; including
    // the *State vars would cause a re-run loop on every status transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs, refreshKey]);

  return (
    <div className="flex flex-col gap-6">
      <FilterBar
        pageKey="cross-platform"
        dimensions={[
          { id: "platform" },
          { id: "country" },
          { id: "brand" },
          { id: "lifecycle" },
        ]}
      />
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Cross-Platform Insights</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            AI-powered analyses that reconcile data across Google Ads, Meta, and Shopify to surface hidden inefficiencies
            <span className="ml-2 text-slate-400">· window: <strong>{dateRange.label}</strong></span>
          </p>
        </div>
        <DateRangePicker />
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-sm text-amber-800">
          These analyses require active Google Ads and Shopify connections. Navigate to{" "}
          <a href="/connections" className="underline font-semibold">Platform Integrations</a> to connect them.
        </p>
      </div>

      {/* Analysis cards */}
      <AnalysisCard
        icon={TrendingDown}
        title="Margin Bleed X-Ray"
        subtitle="Finds SKUs where ROAS looks good but POAS is negative — you're bleeding profit on every conversion."
        state={bleedState}
        onRun={runBleed}
        accentColor="bg-red-500"
      >
        {bleedData && <MarginBleedResults data={bleedData} />}
      </AnalysisCard>

      <AnalysisCard
        icon={Users}
        title="Ghost Audience Deduplicator"
        subtitle="Compares Google + Meta self-reported conversion value against Shopify ground truth to expose double-counting and reveal your true blended ROAS."
        state={overlapState}
        onRun={runOverlap}
        accentColor="bg-violet-500"
      >
        {overlapData && <AudienceOverlapResults data={overlapData} />}
      </AnalysisCard>

      <AnalysisCard
        icon={RotateCcw}
        title="CRM Repurchase Arbitrage"
        subtitle="Identifies customers already in their natural repurchase window (30–40 days) so you can suppress retargeting ads and redirect that spend to cold acquisition."
        state={arbitrageState}
        onRun={runArbitrage}
        accentColor="bg-teal-500"
      >
        {arbitrageData && <CrmArbitrageResults data={arbitrageData} />}
      </AnalysisCard>
    </div>
  );
}
