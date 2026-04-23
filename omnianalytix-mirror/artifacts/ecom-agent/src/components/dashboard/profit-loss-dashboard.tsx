import { useState, useEffect, useRef, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, RefreshCw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth-fetch";
import { useWorkspace } from "@/contexts/workspace-context";
import { useCurrency } from "@/contexts/currency-context";
import { useFx } from "@/contexts/fx-context";
import { formatUsdInDisplay } from "@/lib/fx-format";
import { useDateRange } from "@/contexts/date-range-context";
import { DateRangePicker } from "./date-range-picker";
import { FilterBar } from "./filter-bar";

const BASE     = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface FinancialRecord {
  id: number;
  month: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  operatingExpenses: number;
  operatingIncome: number;
  interestExpense: number;
  earningsBeforeTax: number;
  taxExpense: number;
  netIncome: number;
  notes: string | null;
}

interface FinancialTotals {
  revenue: number;
  cogs: number;
  grossProfit: number;
  operatingExpenses: number;
  operatingIncome: number;
  interestExpense: number;
  earningsBeforeTax: number;
  taxExpense: number;
  netIncome: number;
}

interface FinancialsResponse {
  records: FinancialRecord[];
  totals: FinancialTotals;
  workspaceId: number;
  syncedAt: number;
}

// ─── Formatters ────────────────────────────────────────────────────────────────

// Currency-honesty fix — financials API returns USD only. The two functions
// below are kept ONLY as safe fallbacks for non-React contexts (e.g. exports
// or chart tickers that don't have hook access). All in-tree call sites have
// migrated to `formatFromUsd` from FxContext, which converts to the user's
// preferred display currency. See CURRENCY_COVERAGE.md.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function fmtUsdCompact(n: number): string {
  return formatUsdInDisplay(n, { compact: true, decimals: 2 });
}

function shortMonth(month: string): string {
  const [y, m] = month.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString("en-US", { month: "short", year: "2-digit" });
}

// ─── Skeleton ──────────────────────────────────────────────────────────────────

function Skel({ w = "w-24", h = "h-8" }: { w?: string; h?: string }) {
  return <span className={cn("inline-block rounded-lg animate-pulse bg-slate-200", w, h)} />;
}

// ─── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  trend,
  loading,
  accent = false,
  sym,
}: {
  label: string;
  value: number;
  sub?: string;
  trend?: "up" | "down" | "flat";
  loading: boolean;
  accent?: boolean;
  sym: string;
}) {
  const { formatFromUsd } = useFx();
  const TrendIcon =
    trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendColor =
    trend === "up"
      ? "text-emerald-600"
      : trend === "down"
        ? "text-red-500"
        : "text-slate-400";

  return (
    <div
      className={cn(
        "rounded-2xl border border-slate-200 bg-white p-5 flex flex-col gap-2 shadow-sm",
        accent && "border-omni-primary/30 bg-blue-50/40",
      )}
    >
      <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">
        {label}
      </span>
      {loading ? (
        <Skel w="w-28" h="h-9" />
      ) : (
        <span
          className={cn(
            "text-2xl font-bold tabular-nums",
            value < 0 ? "text-red-600" : accent ? "text-omni-primary" : "text-slate-900",
          )}
        >
          {formatFromUsd(value, { compact: true, decimals: 1 })}
        </span>
      )}
      <div className="flex items-center gap-1.5 mt-auto">
        {trend && !loading && (
          <TrendIcon className={cn("w-3.5 h-3.5 flex-shrink-0", trendColor)} />
        )}
        {sub && (
          <span className="text-[11px] text-slate-500 truncate">{sub}</span>
        )}
      </div>
    </div>
  );
}

// ─── Custom Tooltip ────────────────────────────────────────────────────────────

function ChartTooltip({
  active,
  payload,
  label,
  sym,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  sym: string;
}) {
  const { formatFromUsd } = useFx();
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg text-sm">
      <p className="font-semibold text-slate-800 mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-6">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ background: p.color }}
            />
            <span className="text-slate-500">{p.name}</span>
          </span>
          <span className="font-semibold tabular-nums text-slate-800">
            {formatFromUsd(p.value, { decimals: 2 })}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function ProfitLossDashboard() {
  const { activeWorkspace }         = useWorkspace();
  const { currencySymbol: sym }     = useCurrency();
  const { formatFromUsd }           = useFx();
  const { dateRange, refreshKey }   = useDateRange();
  const [data, setData]             = useState<FinancialsResponse | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(false);
  const abortRef                    = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!activeWorkspace) return;
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoading(true);
    setError(false);
    try {
      // Server doesn't yet filter by date — we send the params anyway so it
      // can be migrated server-side without a client change, and we filter
      // the response client-side below to honour the picker today.
      const fromStr = dateRange.from.toISOString().slice(0, 10);
      const toStr   = dateRange.to.toISOString().slice(0, 10);
      const res = await authFetch(
        `${API_BASE}api/financials?workspaceId=${activeWorkspace.id}&from=${fromStr}&to=${toStr}`,
        { signal: ctl.signal },
      );
      if (ctl.signal.aborted) return;
      if (!res.ok) { setError(true); return; }
      const json = (await res.json()) as FinancialsResponse;
      if (!ctl.signal.aborted) setData(json);
    } catch {
      if (!ctl.signal.aborted) setError(true);
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, [activeWorkspace?.id, dateRange.from.getTime(), dateRange.to.getTime()]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load, refreshKey]);

  // Clear stale data immediately on workspace switch
  useEffect(() => {
    setData(null);
  }, [activeWorkspace?.id]);

  // ---- Date-range filter (client-side, until server supports it) ----
  // Records are keyed by `YYYY-MM`; include any month whose first day falls
  // inside the picker range. Totals are recomputed from the filtered slice
  // so the KPI cards and the chart agree with the visible window.
  const fromMonth = `${dateRange.from.getFullYear()}-${String(dateRange.from.getMonth() + 1).padStart(2, "0")}`;
  const toMonth   = `${dateRange.to.getFullYear()}-${String(dateRange.to.getMonth() + 1).padStart(2, "0")}`;

  const allRecords = data?.records ?? [];
  const records    = allRecords.filter((r) => r.month >= fromMonth && r.month <= toMonth);

  const totals = records.reduce(
    (acc, r) => {
      acc.revenue           += r.revenue;
      acc.cogs              += r.cogs;
      acc.grossProfit       += r.grossProfit;
      acc.operatingExpenses += r.operatingExpenses;
      acc.operatingIncome   += r.operatingIncome;
      acc.interestExpense   += r.interestExpense;
      acc.earningsBeforeTax += r.earningsBeforeTax;
      acc.taxExpense        += r.taxExpense;
      acc.netIncome         += r.netIncome;
      return acc;
    },
    { revenue: 0, cogs: 0, grossProfit: 0, operatingExpenses: 0, operatingIncome: 0, interestExpense: 0, earningsBeforeTax: 0, taxExpense: 0, netIncome: 0 } as FinancialTotals,
  );

  const chartData = records.map((r) => ({
    month:    shortMonth(r.month),
    Revenue:  r.revenue,
    "Op. Expenses": r.operatingExpenses,
    "Net Income": r.netIncome,
  }));

  // Gross margin trend (last vs previous month)
  const trend = (() => {
    if (records.length < 2) return "flat" as const;
    const last = records[records.length - 1];
    const prev = records[records.length - 2];
    if (last.netIncome > prev.netIncome) return "up" as const;
    if (last.netIncome < prev.netIncome) return "down" as const;
    return "flat" as const;
  })();

  return (
    <div className="flex flex-col gap-6">
      <FilterBar
        pageKey="profit-loss"
        dimensions={[
          { id: "account" },
          { id: "brand" },
          { id: "country" },
          { id: "lifecycle" },
        ]}
      />
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Profit &amp; Loss</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {activeWorkspace?.clientName ?? "All Workspaces"} ·{" "}
            {records.length > 0
              ? `${records.length} month${records.length !== 1 ? "s" : ""} (${dateRange.label})`
              : `${dateRange.label}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker compact />
          <button
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-omni-primary transition-colors rounded-xl px-3 py-1.5 hover:bg-blue-50 active:scale-[0.9] disabled:opacity-40"
            aria-label="Refresh financial data"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Error state ── */}
      {error && !loading && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          Failed to load financial data. Check your connection and try refreshing.
        </div>
      )}

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          label="Total Revenue"
          value={totals?.revenue ?? 0}
          sub="Gross sales across all months"
          trend="up"
          loading={loading}
          accent
          sym={sym}
        />
        <KpiCard
          label="Total COGS"
          value={totals?.cogs ?? 0}
          sub="Cost of goods sold"
          loading={loading}
          sym={sym}
        />
        <KpiCard
          label="Total Expenses"
          value={totals?.operatingExpenses ?? 0}
          sub="Operating expenses incl. ad spend"
          loading={loading}
          sym={sym}
        />
        <KpiCard
          label="Total Net Income"
          value={totals?.netIncome ?? 0}
          sub="After tax & interest"
          trend={trend}
          loading={loading}
          sym={sym}
        />
      </div>

      {/* ── Chart ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">
          Revenue vs. Operating Expenses — Month-over-Month
        </h3>
        {loading ? (
          <div className="h-64 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-slate-400 text-sm">
              <RefreshCw className="w-5 h-5 animate-spin" />
              Loading chart data…
            </div>
          </div>
        ) : records.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-400 text-sm">
            No financial records found for this workspace.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} barCategoryGap="28%">
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v: number) => formatFromUsd(v, { compact: true, decimals: 1 })}
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
                width={60}
              />
              <Tooltip
                content={(props) => (
                  <ChartTooltip
                    active={props.active}
                    payload={props.payload as Array<{ name: string; value: number; color: string }>}
                    label={props.label as string}
                    sym={sym}
                  />
                )}
              />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                iconType="square"
                iconSize={10}
              />
              <Bar dataKey="Revenue"       fill="#1a73e8" radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar dataKey="Op. Expenses"  fill="#475569" radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar dataKey="Net Income"    fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Detailed Table ── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-700">Monthly Breakdown</h3>
          <p className="text-xs text-slate-400 mt-0.5">All figures in USD ($) · Calculated fields in italics</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                {[
                  "Month",
                  "Revenue",
                  "COGS",
                  "Gross Profit",
                  "Op. Expenses",
                  "Op. Income",
                  "Interest",
                  "EBT",
                  "Tax",
                  "Net Income",
                ].map((h) => (
                  <th key={h} className="px-4 py-3 text-right first:text-left whitespace-nowrap font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 10 }).map((__, j) => (
                        <td key={j} className="px-4 py-3">
                          <Skel w="w-16" h="h-4" />
                        </td>
                      ))}
                    </tr>
                  ))
                : records.map((r) => (
                    <tr
                      key={r.id}
                      className="hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">
                        {shortMonth(r.month)}
                      </td>
                      <Num v={r.revenue}           sym={sym} />
                      <Num v={r.cogs}              sym={sym} muted />
                      <Num v={r.grossProfit}       sym={sym} derived />
                      <Num v={r.operatingExpenses} sym={sym} muted />
                      <Num v={r.operatingIncome}   sym={sym} derived />
                      <Num v={r.interestExpense}   sym={sym} muted />
                      <Num v={r.earningsBeforeTax} sym={sym} derived />
                      <Num v={r.taxExpense}        sym={sym} muted />
                      <Num v={r.netIncome}         sym={sym} derived accent />
                    </tr>
                  ))}
            </tbody>
            {/* Totals row */}
            {!loading && totals && (
              <tfoot>
                <tr className="bg-slate-50 font-semibold border-t-2 border-slate-200">
                  <td className="px-4 py-3 text-slate-700">Totals</td>
                  <Num v={totals.revenue}           sym={sym} bold />
                  <Num v={totals.cogs}              sym={sym} bold muted />
                  <Num v={totals.grossProfit}       sym={sym} bold derived />
                  <Num v={totals.operatingExpenses} sym={sym} bold muted />
                  <Num v={totals.operatingIncome}   sym={sym} bold derived />
                  <Num v={totals.interestExpense}   sym={sym} bold muted />
                  <Num v={totals.earningsBeforeTax} sym={sym} bold derived />
                  <Num v={totals.taxExpense}        sym={sym} bold muted />
                  <Num v={totals.netIncome}         sym={sym} bold derived accent />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Table cell helper ─────────────────────────────────────────────────────────

function Num({
  v,
  sym,
  muted = false,
  derived = false,
  accent = false,
  bold = false,
}: {
  v: number;
  sym: string;
  muted?: boolean;
  derived?: boolean;
  accent?: boolean;
  bold?: boolean;
}) {
  const { formatFromUsd } = useFx();
  return (
    <td
      className={cn(
        "px-4 py-3 text-right tabular-nums whitespace-nowrap",
        bold && "font-semibold",
        derived && "italic",
        accent && (v < 0 ? "text-red-600" : "text-omni-tertiary font-semibold"),
        !accent && muted && "text-slate-500",
        !accent && !muted && "text-slate-800",
      )}
    >
      {formatFromUsd(v, { decimals: 2 })}
    </td>
  );
}
