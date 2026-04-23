/**
 * BentoDashboard — "Command Overview" Bento Grid
 *
 * A Bento Box summary layer that aggregates KPIs, chart previews, and
 * live-operational feeds across all active workspace capabilities.
 *
 * Row 1 (The Pulse):   4 high-contrast KPI cards
 * Row 2 (The Visuals): P&L bar chart (wide) + Pipeline funnel snapshot
 * Row 3 (The Actions): Ops task preview + CRM deal feed
 *
 * Intentionally lightweight — each cell fetches its own slice of data so
 * failures are isolated and the grid never goes blank as a whole.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  TrendingUp, TrendingDown, DollarSign, Target, CheckCircle2,
  Clock, AlertTriangle, RefreshCw, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth-fetch";
import { useWorkspace } from "@/contexts/workspace-context";
import { useCurrency } from "@/contexts/currency-context";
import { useFx } from "@/contexts/fx-context";
import { Link } from "wouter";
import { WorkspaceSelector } from "@/components/dashboard/workspace-selector";

// ─── Helpers ───────────────────────────────────────────────────────────────────

const BASE     = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";


function Skel({ w = "w-20", h = "h-6", className = "" }: { w?: string; h?: string; className?: string }) {
  return <span className={cn("inline-block rounded-lg animate-pulse bg-slate-200", w, h, className)} />;
}

// ─── Row 1: KPI Pulse Cards ────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  delta?: number | null;
  icon: React.ElementType;
  iconClass: string;
  loading: boolean;
  href?: string;
}

function KpiCard({ label, value, delta, icon: Icon, iconClass, loading, href }: KpiCardProps) {
  const content = (
    <div
      className={cn(
        "rounded-2xl border border-slate-200 bg-white p-5 flex flex-col gap-3 shadow-sm",
        "transition-all hover:shadow-md hover:-translate-y-0.5",
        href && "cursor-pointer",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-omni-secondary">{label}</span>
        <span className={cn("w-8 h-8 rounded-xl flex items-center justify-center shrink-0", iconClass)}>
          <Icon className="w-4 h-4" />
        </span>
      </div>
      {loading
        ? <Skel w="w-28" h="h-8" />
        : <span className="font-heading text-2xl font-bold tabular-nums text-slate-900">{value}</span>}
      {delta != null && !loading && (
        <div className={cn("flex items-center gap-1 text-[11px] font-semibold", delta >= 0 ? "text-omni-tertiary" : "text-red-500")}>
          {delta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {Math.abs(delta).toFixed(1)}% vs last period
        </div>
      )}
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

// ─── Row 2: P&L Mini Bar Chart ─────────────────────────────────────────────────

interface FinRow { month: string; revenue: number; netIncome: number; }

function PLMiniChart({ workspaceId, sym }: { workspaceId: number; sym: string }) {
  const { formatFromUsd } = useFx();
  const [data, setData] = useState<FinRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    (async () => {
      try {
        const res = await authFetch(`${API_BASE}api/financials?workspaceId=${workspaceId}`);
        if (cancelled) return;
        if (!res.ok) { setLoadError(true); return; }
        const json = await res.json();
        const records: Array<{ month: string; revenue: number; netIncome: number }> = json.records ?? [];
        setData(records.slice(-6).map((r) => ({
          month: new Date(r.month + "-01").toLocaleString("default", { month: "short" }),
          revenue: r.revenue,
          netIncome: r.netIncome,
        })));
      } catch {
        if (!cancelled) setLoadError(true);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [workspaceId]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-omni-secondary">P&L Snapshot</p>
          <p className="text-xs text-slate-400 mt-0.5">Last 6 months</p>
        </div>
        <Link href="/profit-loss">
          <button className="flex items-center gap-1 text-[11px] text-omni-primary font-semibold hover:underline">
            Full Report <ChevronRight className="w-3 h-3" />
          </button>
        </Link>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Skel w="w-full" h="h-32" />
        </div>
      ) : loadError ? (
        <div className="flex-1 flex items-center justify-center text-xs text-rose-500">Couldn't load financials</div>
      ) : data.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-slate-400">No financial data yet</div>
      ) : (
        <div className="flex-1 min-h-[140px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barGap={2} barSize={14}>
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 11, boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}
                formatter={(val: number) => [formatFromUsd(val, { compact: true, decimals: 1 })]}
              />
              <Bar dataKey="revenue" name="Revenue" radius={[4, 4, 0, 0]} fill="#1a73e8" opacity={0.85} />
              <Bar dataKey="netIncome" name="Net Income" radius={[4, 4, 0, 0]}>
                {data.map((entry, i) => (
                  <Cell key={i} fill={entry.netIncome >= 0 ? "#10b981" : "#f87171"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── Row 2: Pipeline Funnel Snapshot ──────────────────────────────────────────

const STAGE_COLORS: Record<string, string> = {
  discovery:   "#1a73e8",
  proposal:    "#7c3aed",
  negotiation: "#f59e0b",
  closed_won:  "#10b981",
  closed_lost: "#f87171",
};

function PipelineSnapshot({ workspaceId, sym }: { workspaceId: number; sym: string }) {
  const { formatFromUsd: fmtMoney } = useFx();
  const [deals, setDeals] = useState<Array<{ dealStage: string; dealSize: number; dealName: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [totalClosed, setTotalClosed] = useState(0);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    (async () => {
      try {
        const res = await authFetch(`${API_BASE}api/etl/crm-leads?workspaceId=${workspaceId}`);
        if (cancelled) return;
        if (!res.ok) { setLoadError(true); return; }
        const json = await res.json();
        setDeals((json.deals ?? []).slice(0, 5));
        setTotalClosed(json.totals?.closedWon ?? 0);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [workspaceId]);

  const stageCounts: Record<string, number> = {};
  for (const d of deals) stageCounts[d.dealStage] = (stageCounts[d.dealStage] ?? 0) + 1;
  const stages = Object.entries(stageCounts);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-omni-secondary">Pipeline</p>
          <p className="text-xs text-slate-400 mt-0.5">Active deals by stage</p>
        </div>
        <Link href="/pipeline-funnel">
          <button className="flex items-center gap-1 text-[11px] text-omni-primary font-semibold hover:underline">
            Open <ChevronRight className="w-3 h-3" />
          </button>
        </Link>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => <Skel key={i} w="w-full" h="h-6" />)}
        </div>
      ) : loadError ? (
        <p className="text-xs text-rose-500 text-center py-6">Couldn't load pipeline</p>
      ) : stages.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-6">No pipeline data</p>
      ) : (
        <div className="flex flex-col gap-2">
          {stages.map(([stage, count]) => (
            <div key={stage} className="flex items-center gap-3">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: STAGE_COLORS[stage] ?? "#94a3b8" }}
              />
              <span className="text-xs text-slate-600 capitalize flex-1">{stage.replace("_", " ")}</span>
              <span className="text-xs font-bold tabular-nums text-slate-800">{count}</span>
            </div>
          ))}
        </div>
      )}

      {!loading && totalClosed > 0 && (
        <div className="mt-auto pt-3 border-t border-slate-100 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">Closed Won</span>
          <span className="text-sm font-bold tabular-nums text-omni-tertiary">{fmtMoney(totalClosed, { compact: true, decimals: 1 })}</span>
        </div>
      )}
    </div>
  );
}

// ─── Row 3: Ops Task Preview ──────────────────────────────────────────────────

interface OpsPreviewTask { id: number; title: string; priority: string; status: string; assignedToName: string; }

const STATUS_DOT: Record<string, string> = {
  not_started: "bg-slate-300",
  in_progress: "bg-omni-primary",
  completed:   "bg-omni-tertiary",
};

const PRIORITY_DOT: Record<string, string> = {
  high:   "text-red-500",
  medium: "text-amber-500",
  low:    "text-slate-400",
};

function TaskPreview() {
  const [tasks, setTasks]   = useState<OpsPreviewTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    (async () => {
      try {
        const res = await authFetch(`${BASE}/api/tasks/ops`);
        if (cancelled) return;
        if (!res.ok) { setLoadError(true); return; }
        const json = await res.json();
        setTasks((json.tasks ?? []).slice(0, 6));
      } catch {
        if (!cancelled) setLoadError(true);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm flex flex-col h-full">
      <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-omni-secondary">Operational Tasks</p>
          <p className="text-xs text-slate-400 mt-0.5">Across all workspaces</p>
        </div>
        <Link href="/tasks">
          <button className="flex items-center gap-1 text-[11px] text-omni-primary font-semibold hover:underline">
            All tasks <ChevronRight className="w-3 h-3" />
          </button>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col gap-2 px-4 pb-4">
            {[1, 2, 3, 4].map((i) => <Skel key={i} w="w-full" h="h-11" />)}
          </div>
        ) : loadError ? (
          <p className="text-xs text-rose-500 text-center py-8">Couldn't load tasks</p>
        ) : tasks.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-8">No tasks yet</p>
        ) : (
          <ul className="flex flex-col gap-2 px-4 pb-4">
            {tasks.map((t) => (
              <li
                key={t.id}
                className={cn(
                  "flex items-center gap-3 px-3.5 py-2.5",
                  "rounded-xl border border-slate-200 bg-white shadow-sm",
                  "hover:shadow-md hover:scale-[1.02] hover:-translate-y-0.5",
                  "transition-all duration-200 cursor-pointer",
                )}
              >
                <span className={cn("w-2 h-2 rounded-full shrink-0", STATUS_DOT[t.status] ?? "bg-slate-200")} />
                <p className="flex-1 text-xs font-medium text-slate-700 truncate">{t.title}</p>
                <span className={cn("text-[10px] font-bold uppercase shrink-0", PRIORITY_DOT[t.priority])}>{t.priority}</span>
                {t.assignedToName && (
                  <span className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center text-[9px] font-bold text-omni-primary shrink-0">
                    {t.assignedToName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Row 3: Sales Leaderboard Mini ────────────────────────────────────────────

interface MiniRep { id: number; salespersonName: string; salesProgress: number; closedAmount: number; status: string; }

function SalesPreview({ workspaceId, sym }: { workspaceId: number; sym: string }) {
  const { formatFromUsd: fmtMoney } = useFx();
  const [reps, setReps]     = useState<MiniRep[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`${API_BASE}api/etl/crm-sales?workspaceId=${workspaceId}`);
        if (res.ok && !cancelled) {
          const json = await res.json();
          setReps((json.reps ?? []).slice(0, 5));
        }
      } catch { /* silent */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [workspaceId]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm flex flex-col h-full">
      <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-omni-secondary">Sales Leaders</p>
          <p className="text-xs text-slate-400 mt-0.5">Top 5 this period</p>
        </div>
        <Link href="/sales-leaderboard">
          <button className="flex items-center gap-1 text-[11px] text-omni-primary font-semibold hover:underline">
            Full board <ChevronRight className="w-3 h-3" />
          </button>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col gap-2 px-5 pb-5">
            {[1, 2, 3].map((i) => <Skel key={i} w="w-full" h="h-10" />)}
          </div>
        ) : reps.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-8">No sales data</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {reps.map((r, i) => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                <span className="text-sm shrink-0">{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-800 truncate">{r.salespersonName}</p>
                  <div className="w-full h-1.5 rounded-full bg-slate-100 mt-1 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-omni-primary"
                      style={{ width: `${Math.min(100, r.salesProgress)}%` }}
                    />
                  </div>
                </div>
                <span className="text-xs font-bold tabular-nums text-omni-primary shrink-0">{fmtMoney(r.closedAmount, { compact: true, decimals: 1 })}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Main BentoDashboard ──────────────────────────────────────────────────────

interface BentoDashboardProps {
  goal?: "ecom" | "leadgen" | "hybrid";
}

export function BentoDashboard({ goal }: BentoDashboardProps) {
  const { activeWorkspace }     = useWorkspace();
  const { currencySymbol: sym } = useCurrency();
  const { formatFromUsd: fmtMoney } = useFx();
  const wsId = activeWorkspace?.id ?? 0;

  // KPI data from multiple APIs
  const [kpiData, setKpiData] = useState<{
    revenue: number; margin: number; marginPct: number;
    activeTasks: number; completedTasks: number;
  } | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const fetchKpis = useCallback(async () => {
    if (!wsId) return;
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setKpiLoading(true);
    try {
      const [finRes, opsRes] = await Promise.allSettled([
        authFetch(`${API_BASE}api/financials?workspaceId=${wsId}`, { signal: ctl.signal }),
        authFetch(`${BASE}/api/tasks/ops`, { signal: ctl.signal }),
      ]);

      let revenue = 0; let netIncome = 0;
      if (finRes.status === "fulfilled" && finRes.value.ok) {
        const fin = await finRes.value.json();
        revenue   = fin.totals?.totalRevenue  ?? 0;
        netIncome = fin.totals?.totalNetIncome ?? 0;
      }

      let activeTasks = 0; let completedTasks = 0;
      if (opsRes.status === "fulfilled" && opsRes.value.ok) {
        const ops = await opsRes.value.json();
        activeTasks   = ops.totals?.in_progress  ?? 0;
        completedTasks = ops.totals?.completed   ?? 0;
      }

      if (!ctl.signal.aborted) {
        setKpiData({
          revenue,
          margin: netIncome,
          marginPct: revenue > 0 ? (netIncome / revenue) * 100 : 0,
          activeTasks,
          completedTasks,
        });
      }
    } catch { /* silent */ }
    finally { if (!abortRef.current?.signal.aborted) setKpiLoading(false); }
  }, [wsId]);

  useEffect(() => {
    void fetchKpis();
    return () => abortRef.current?.abort();
  }, [fetchKpis]);

  const showPipeline = goal === "leadgen" || goal === "hybrid";
  const showPL       = goal === "ecom"    || goal === "hybrid" || !goal;

  return (
    <div className="flex flex-col gap-5 p-6 max-w-screen-2xl mx-auto" style={{ background: "var(--color-omni-neutral, #f8fafc)" }}>

      {/* ── Section header: heading + workspace selector (inline, vertically aligned) ── */}
      <div className="flex items-center justify-between gap-4">

        {/* Left group: "Command Overview" h2 + workspace selector at same baseline */}
        <div className="flex items-center gap-1.5 min-w-0">
          <h2 className="font-heading text-lg font-bold text-slate-900 shrink-0 leading-none">
            Command Overview
          </h2>
          {/* Separator */}
          <span className="text-slate-300 text-lg font-extralight shrink-0 select-none" aria-hidden="true">/</span>
          {/* WorkspaceSelector — Radix portal, zero z-index clipping */}
          <WorkspaceSelector />
        </div>

        {/* Right group: real-time pulse label + refresh */}
        <div className="flex items-center gap-0.5 shrink-0">
          <span className="hidden sm:inline text-[9px] font-bold uppercase tracking-wider text-slate-400 font-mono mr-1">
            real-time
          </span>
          <button
            onClick={() => { void fetchKpis(); }}
            disabled={kpiLoading}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-omni-primary transition-colors rounded-xl px-3 py-1.5 hover:bg-blue-50 disabled:opacity-50"
            title="Refresh KPIs"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", kpiLoading && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* ── Row 1: Pulse KPIs ────────────────────────────────────────────── */}
      <div id="tour-bento-pulse" className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Total Revenue"
          value={kpiData ? fmtMoney(kpiData.revenue, { compact: true, decimals: 1 }) : "—"}
          icon={DollarSign}
          iconClass="bg-blue-100 text-omni-primary"
          loading={kpiLoading}
          href="/profit-loss"
        />
        <KpiCard
          label="Net Margin"
          value={kpiData ? fmtMoney(kpiData.margin, { compact: true, decimals: 1 }) : "—"}
          delta={kpiData ? kpiData.marginPct : null}
          icon={TrendingUp}
          iconClass="bg-emerald-100 text-omni-tertiary"
          loading={kpiLoading}
          href="/profit-loss"
        />
        <KpiCard
          label="Active Tasks"
          value={kpiData ? String(kpiData.activeTasks) : "—"}
          icon={Clock}
          iconClass="bg-amber-100 text-amber-500"
          loading={kpiLoading}
          href="/tasks"
        />
        <KpiCard
          label="Completed Tasks"
          value={kpiData ? String(kpiData.completedTasks) : "—"}
          icon={CheckCircle2}
          iconClass="bg-violet-100 text-violet-500"
          loading={kpiLoading}
          href="/tasks"
        />
      </div>

      {/* ── Row 2: Visuals ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4" style={{ minHeight: 220 }}>
        <div className="md:col-span-2">
          {wsId > 0 && <PLMiniChart workspaceId={wsId} sym={sym} />}
          {wsId === 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex items-center justify-center h-full">
              <p className="text-xs text-slate-400">Select a workspace to view P&L</p>
            </div>
          )}
        </div>
        <div>
          {showPipeline && wsId > 0
            ? <PipelineSnapshot workspaceId={wsId} sym={sym} />
            : (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm h-full flex flex-col gap-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-omni-secondary">Target Metrics</p>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-500">ROAS Goal</p>
                    <p className="text-xs font-bold text-omni-primary tabular-nums">4.0×</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-500">Margin Target</p>
                    <p className="text-xs font-bold text-omni-tertiary tabular-nums">35%</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-500">CPL Cap</p>
                    <p className="text-xs font-bold text-slate-800 tabular-nums">$45</p>
                  </div>
                </div>
              </div>
            )
          }
        </div>
      </div>

      {/* ── Row 3: Actions ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ minHeight: 260 }}>
        <TaskPreview />
        {wsId > 0
          ? <SalesPreview workspaceId={wsId} sym={sym} />
          : (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex items-center justify-center">
              <p className="text-xs text-slate-400">Select a workspace to view sales data</p>
            </div>
          )
        }
      </div>
    </div>
  );
}
