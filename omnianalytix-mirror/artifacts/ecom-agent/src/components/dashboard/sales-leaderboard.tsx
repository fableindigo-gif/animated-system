import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  RefreshCw,
  AlertTriangle,
  Trophy,
  TrendingUp,
  DollarSign,
  BarChart2,
  ChevronDown,
  ChevronUp,
  Medal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth-fetch";
import { useWorkspace } from "@/contexts/workspace-context";
import { useCurrency } from "@/contexts/currency-context";
import { useDateRange } from "@/contexts/date-range-context";
import { formatUsdInDisplay } from "@/lib/fx-format";
import { DateRangePicker } from "./date-range-picker";
import { FilterBar } from "./filter-bar";

const BASE     = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type SalesStatus = "not_started" | "in_progress" | "completed";

export interface SalesRep {
  id: number;
  salespersonName: string;
  salesTarget: number;
  closedAmount: number;
  salesProgress: number;
  expenses: number;
  leftover: number;
  status: SalesStatus;
  period: string;
}

interface SalesTotals {
  totalExpenses: number;
  totalLeftover: number;
  totalTarget: number;
  totalClosed: number;
  avgProgress: number;
  completedCount: number;
  count: number;
}

interface SalesResponse {
  reps: SalesRep[];
  totals: SalesTotals;
  workspaceId: number;
  syncedAt: number;
}

// ─── Status config ─────────────────────────────────────────────────────────────

const STATUS_META: Record<SalesStatus, { label: string; bar: string; badge: string; text: string }> = {
  not_started: { label: "Not Started", bar: "bg-slate-300",   badge: "bg-slate-100 text-slate-500 border-slate-200",   text: "text-slate-500" },
  in_progress: { label: "In Progress", bar: "bg-omni-primary", badge: "bg-blue-50 text-omni-primary border-blue-200",   text: "text-omni-primary" },
  completed:   { label: "Completed",   bar: "bg-emerald-500",  badge: "bg-emerald-50 text-emerald-700 border-emerald-200", text: "text-emerald-600" },
};

// ─── Formatters ────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function fmt(n: number, _sym: string): string {
  return formatUsdInDisplay(n, { compact: true, decimals: 1 });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function fmtFull(n: number, _sym: string): string {
  return formatUsdInDisplay(Math.abs(n));
}

// ─── Skeleton ──────────────────────────────────────────────────────────────────

function Skel({ w = "w-20", h = "h-5" }: { w?: string; h?: string }) {
  return <span className={cn("inline-block rounded-lg animate-pulse bg-slate-200", w, h)} />;
}

// ─── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, icon: Icon, iconClass, sub, loading, sym, isPercent = false,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  iconClass: string;
  sub?: string;
  loading: boolean;
  sym: string;
  isPercent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-col gap-3 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">{label}</span>
        <span className={cn("w-8 h-8 rounded-xl flex items-center justify-center", iconClass)}>
          <Icon className="w-4 h-4" />
        </span>
      </div>
      {loading ? (
        <Skel w="w-28" h="h-8" />
      ) : (
        <span className={cn("text-2xl font-bold tabular-nums", value < 0 ? "text-red-600" : "text-slate-900")}>
          {isPercent ? `${value.toFixed(1)}%` : fmt(value, sym)}
        </span>
      )}
      {sub && <p className="text-xs text-slate-400 -mt-1">{sub}</p>}
    </div>
  );
}

// ─── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: SalesStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border", m.badge)}>
      {m.label}
    </span>
  );
}

// ─── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ value, status }: { value: number; status: SalesStatus }) {
  const m = STATUS_META[status];
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-slate-200 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", m.bar)}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
      <span className={cn("text-xs tabular-nums font-semibold w-10 text-right shrink-0", m.text)}>
        {value.toFixed(0)}%
      </span>
    </div>
  );
}

// ─── Rank medal ────────────────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-lg leading-none" title="1st">🥇</span>;
  if (rank === 2) return <span className="text-lg leading-none" title="2nd">🥈</span>;
  if (rank === 3) return <span className="text-lg leading-none" title="3rd">🥉</span>;
  return (
    <span className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[11px] font-bold text-slate-500">
      {rank}
    </span>
  );
}

// ─── Leaderboard row ───────────────────────────────────────────────────────────

function LeaderRow({
  rep, rank, sym, expanded, onToggle,
}: {
  rep: SalesRep;
  rank: number;
  sym: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const leftoverColor = rep.leftover >= 0 ? "text-emerald-600" : "text-red-500";

  return (
    <div
      className={cn(
        "rounded-2xl border bg-white shadow-sm transition-shadow",
        rank === 1 ? "border-amber-200 ring-1 ring-amber-100" : "border-slate-200",
        "hover:shadow-md",
      )}
    >
      {/* Main row */}
      <button
        className="w-full flex items-center gap-4 px-5 py-4 text-left"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        {/* Rank */}
        <div className="flex-shrink-0">
          <RankBadge rank={rank} />
        </div>

        {/* Name + status */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-slate-800 truncate">{rep.salespersonName}</p>
            <StatusBadge status={rep.status} />
          </div>
          <p className="text-xs text-slate-400 mt-0.5">Target: {fmtFull(rep.salesTarget, sym)}</p>
        </div>

        {/* Closed amount */}
        <div className="text-right flex-shrink-0 hidden sm:block">
          <p className="text-sm font-bold tabular-nums text-omni-primary">{fmtFull(rep.closedAmount, sym)}</p>
          <p className="text-[11px] text-slate-400">closed</p>
        </div>

        {/* Progress bar — desktop */}
        <div className="w-36 flex-shrink-0 hidden md:block">
          <ProgressBar value={rep.salesProgress} status={rep.status} />
        </div>

        {/* Expand chevron */}
        <div className="flex-shrink-0 text-slate-400">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {/* Progress bar — mobile (always visible) */}
      <div className="px-5 pb-3 md:hidden">
        <ProgressBar value={rep.salesProgress} status={rep.status} />
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="border-t border-slate-100 px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm bg-slate-50 rounded-b-2xl">
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Sales Target</p>
            <p className="font-semibold tabular-nums">{fmtFull(rep.salesTarget, sym)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Closed Amount</p>
            <p className="font-semibold tabular-nums text-omni-primary">{fmtFull(rep.closedAmount, sym)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Expenses</p>
            <p className="font-semibold tabular-nums text-slate-700">{fmtFull(rep.expenses, sym)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Leftover</p>
            <p className={cn("font-semibold tabular-nums", leftoverColor)}>
              {rep.leftover >= 0 ? "+" : "−"}{fmtFull(Math.abs(rep.leftover), sym)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sort key ──────────────────────────────────────────────────────────────────

type SortKey = "closedAmount" | "salesProgress" | "salesTarget" | "expenses";

// ─── Main component ────────────────────────────────────────────────────────────

export function SalesLeaderboard() {
  const { activeWorkspace }     = useWorkspace();
  const { currencySymbol: sym } = useCurrency();
  const { dateRange, refreshKey } = useDateRange();

  const [data, setData]         = useState<SalesResponse | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [sortKey, setSortKey]   = useState<SortKey>("closedAmount");
  const [sortDir, setSortDir]   = useState<"asc" | "desc">("desc");
  const [statusFilter, setStatusFilter] = useState<SalesStatus | "all">("all");
  const abortRef                = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!activeWorkspace) return;
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoading(true);
    setError(false);
    try {
      // Server doesn't yet filter by date — params sent for forward-compat;
      // client-side filtering applied below to honour the picker today.
      const fromStr = dateRange.from.toISOString().slice(0, 10);
      const toStr   = dateRange.to.toISOString().slice(0, 10);
      const res = await authFetch(
        `${API_BASE}api/etl/crm-sales?workspaceId=${activeWorkspace.id}&from=${fromStr}&to=${toStr}`,
        { signal: ctl.signal },
      );
      if (ctl.signal.aborted) return;
      if (!res.ok) { setError(true); return; }
      const json = (await res.json()) as SalesResponse;
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

  useEffect(() => { setData(null); setExpandedId(null); }, [activeWorkspace?.id]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  }

  // ---- Date-range filter (client-side, until server supports it) ----
  // Each rep row carries `period` as `YYYY-MM`; include only rows whose
  // period falls inside the picker window. Totals are recomputed from the
  // filtered slice so the KPI cards reflect the visible reps.
  const fromMonth = `${dateRange.from.getFullYear()}-${String(dateRange.from.getMonth() + 1).padStart(2, "0")}`;
  const toMonth   = `${dateRange.to.getFullYear()}-${String(dateRange.to.getMonth() + 1).padStart(2, "0")}`;

  const reps = useMemo(() => {
    let list = data?.reps ?? [];
    list = list.filter((r) => r.period >= fromMonth && r.period <= toMonth);
    if (statusFilter !== "all") list = list.filter((r) => r.status === statusFilter);
    return list.slice().sort((a, b) => {
      const diff = (a[sortKey] as number) - (b[sortKey] as number);
      return sortDir === "asc" ? diff : -diff;
    });
  }, [data, statusFilter, sortKey, sortDir, fromMonth, toMonth]);

  // Totals are computed from the SAME visible slice as the leaderboard list
  // (date window AND active status chip) so the KPI cards never disagree
  // with the rows the user can see.
  const totals: SalesTotals = useMemo(() => {
    let visible = (data?.reps ?? []).filter((r) => r.period >= fromMonth && r.period <= toMonth);
    if (statusFilter !== "all") visible = visible.filter((r) => r.status === statusFilter);
    if (visible.length === 0) {
      return { totalExpenses: 0, totalLeftover: 0, totalTarget: 0, totalClosed: 0, avgProgress: 0, completedCount: 0, count: 0 };
    }
    return {
      totalExpenses: parseFloat(visible.reduce((s, r) => s + r.expenses, 0).toFixed(2)),
      totalLeftover: parseFloat(visible.reduce((s, r) => s + r.leftover, 0).toFixed(2)),
      totalTarget:   parseFloat(visible.reduce((s, r) => s + r.salesTarget, 0).toFixed(2)),
      totalClosed:   parseFloat(visible.reduce((s, r) => s + r.closedAmount, 0).toFixed(2)),
      avgProgress:   parseFloat((visible.reduce((s, r) => s + r.salesProgress, 0) / visible.length).toFixed(1)),
      completedCount: visible.filter((r) => r.status === "completed").length,
      count:         visible.length,
    };
  }, [data, fromMonth, toMonth, statusFilter]);

  // Completion rate for subtitle
  const completionRate = totals && totals.count > 0
    ? Math.round((totals.completedCount / totals.count) * 100)
    : 0;

  return (
    <div className="flex flex-col gap-6">
      <FilterBar
        pageKey="sales-leaderboard"
        dimensions={[
          { id: "account" },
          { id: "country" },
          { id: "brand" },
          { id: "segment" },
        ]}
      />
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Sales Leaderboard</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {activeWorkspace?.clientName ?? "All Workspaces"} ·{" "}
            {totals ? `${totals.completedCount}/${totals.count} reps completed · ${completionRate}% team quota hit` : "Loading…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker compact />
          <button
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-omni-primary transition-colors rounded-xl px-3 py-1.5 hover:bg-blue-50 active:scale-[0.9] disabled:opacity-40"
            aria-label="Refresh sales data"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && !loading && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          Failed to load sales data. Check your connection and try refreshing.
        </div>
      )}

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          label="Total Expenses"
          value={totals?.totalExpenses ?? 0}
          icon={DollarSign}
          iconClass="bg-red-100 text-red-500"
          sub="Team-wide spend"
          loading={loading}
          sym={sym}
        />
        <KpiCard
          label="Total Leftover"
          value={totals?.totalLeftover ?? 0}
          icon={TrendingUp}
          iconClass="bg-emerald-100 text-emerald-600"
          sub="Target minus expenses"
          loading={loading}
          sym={sym}
        />
        <KpiCard
          label="Total Closed"
          value={totals?.totalClosed ?? 0}
          icon={Trophy}
          iconClass="bg-amber-100 text-amber-600"
          sub={`vs ${formatUsdInDisplay(totals?.totalTarget ?? 0, { compact: true })} target`}
          loading={loading}
          sym={sym}
        />
        <KpiCard
          label="Avg Progress"
          value={totals?.avgProgress ?? 0}
          icon={BarChart2}
          iconClass="bg-violet-100 text-violet-600"
          sub="Across all active reps"
          loading={loading}
          sym={sym}
          isPercent
        />
      </div>

      {/* ── Controls row ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Status filter chips */}
        <div className="flex flex-wrap gap-1.5">
          {(["all", "completed", "in_progress", "not_started"] as const).map((s) => {
            const label = s === "all" ? "All" : STATUS_META[s].label;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors",
                  statusFilter === s
                    ? "bg-omni-primary text-white border-omni-primary"
                    : "bg-white text-slate-500 border-slate-200 hover:border-slate-300",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Sort controls */}
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>Sort by:</span>
          {(
            [
              { key: "closedAmount",  label: "Closed" },
              { key: "salesProgress", label: "Progress" },
              { key: "salesTarget",   label: "Target" },
              { key: "expenses",      label: "Expenses" },
            ] as Array<{ key: SortKey; label: string }>
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => toggleSort(key)}
              className={cn(
                "px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-colors flex items-center gap-0.5",
                sortKey === key
                  ? "bg-omni-primary text-white border-omni-primary"
                  : "bg-white border-slate-200 hover:border-slate-300",
              )}
            >
              {label}
              {sortKey === key && (
                sortDir === "desc"
                  ? <ChevronDown className="w-3 h-3" />
                  : <ChevronUp className="w-3 h-3" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Leaderboard list ── */}
      <div className="flex flex-col gap-3">
        {loading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-slate-200 bg-white p-5 flex items-center gap-4 shadow-sm">
                <Skel w="w-6" h="h-6" />
                <div className="flex-1 flex flex-col gap-2">
                  <Skel w="w-40" h="h-4" />
                  <Skel w="w-full" h="h-2" />
                </div>
                <Skel w="w-20" h="h-6" />
              </div>
            ))
          : reps.length === 0
            ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
                <Medal className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-400">No sales reps match the current filter.</p>
              </div>
            )
            : reps.map((rep, i) => (
                <LeaderRow
                  key={rep.id}
                  rep={rep}
                  rank={i + 1}
                  sym={sym}
                  expanded={expandedId === rep.id}
                  onToggle={() => setExpandedId(expandedId === rep.id ? null : rep.id)}
                />
              ))
        }
      </div>

      {/* ── Team progress summary bar ── */}
      {!loading && totals && totals.totalTarget > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-slate-700">Team Quota Progress</p>
            <p className="text-sm font-bold tabular-nums text-omni-primary">
              {fmtFull(totals.totalClosed, sym)}
              <span className="text-slate-400 font-normal"> / {fmtFull(totals.totalTarget, sym)}</span>
            </p>
          </div>
          <div className="w-full h-3 rounded-full bg-slate-200 overflow-hidden">
            <div
              className="h-full rounded-full bg-omni-primary transition-all duration-700"
              style={{ width: `${Math.min(100, (totals.totalClosed / totals.totalTarget) * 100).toFixed(1)}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-2 text-xs text-slate-400">
            <span>{((totals.totalClosed / totals.totalTarget) * 100).toFixed(1)}% of team quota achieved</span>
            <span>{totals.completedCount} of {totals.count} reps hit target</span>
          </div>
        </div>
      )}
    </div>
  );
}
