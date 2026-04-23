import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Search,
  Trophy,
  XCircle,
  CircleDot,
  Percent,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth-fetch";
import { useWorkspace } from "@/contexts/workspace-context";
import { useCurrency } from "@/contexts/currency-context";
import { useDateRange } from "@/contexts/date-range-context";
import { formatUsdInDisplay } from "@/lib/fx-format";

const BASE     = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface PipelineDeal {
  id: string;
  date: string;
  dealName: string;
  contactPerson: string;
  company: string;
  dealSize: number;
  probability: number;
  closedWon: number;
  closedLost: number;
  status: "Open" | "Won" | "Lost";
  dealStage: string;
  source: string;
  crmProvider: string;
}

interface PipelineTotals {
  totalDeal: number;
  closedWon: number;
  closedLost: number;
  avgProb: number;
  count: number;
}

interface PipelineResponse {
  deals: PipelineDeal[];
  totals: PipelineTotals;
}

// ─── Stage config ──────────────────────────────────────────────────────────────

const STAGE_ORDER = ["discovery", "proposal", "negotiation", "closed_won", "closed_lost"] as const;
type StageKey = (typeof STAGE_ORDER)[number];

const STAGE_META: Record<StageKey, { label: string; color: string; bg: string; dot: string }> = {
  discovery:   { label: "Discovery",   color: "text-blue-600",  bg: "bg-blue-50  border-blue-200",  dot: "bg-blue-400"  },
  proposal:    { label: "Proposal",    color: "text-violet-600", bg: "bg-violet-50 border-violet-200", dot: "bg-violet-400" },
  negotiation: { label: "Negotiation", color: "text-amber-600", bg: "bg-amber-50  border-amber-200",  dot: "bg-amber-400" },
  closed_won:  { label: "Closed Won",  color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200", dot: "bg-emerald-500" },
  closed_lost: { label: "Closed Lost", color: "text-red-500",   bg: "bg-red-50    border-red-200",    dot: "bg-red-400"   },
};

// ─── Formatters ────────────────────────────────────────────────────────────────

// Currency-honesty fix: CRM deal sizes flow through the warehouse in USD.
// Accept `sym` so call-sites stay unchanged, but always render `$` — the
// override switcher must not silently relabel USD totals as INR/GBP/etc.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function fmt(n: number, _sym: string): string {
  return formatUsdInDisplay(n, { compact: true, decimals: 1 });
}

function fmtFull(n: number, _sym: string): string {
  return formatUsdInDisplay(Math.abs(n));
}

// ─── Skeleton ──────────────────────────────────────────────────────────────────

function Skel({ w = "w-20", h = "h-5" }: { w?: string; h?: string }) {
  return <span className={cn("inline-block rounded animate-pulse bg-slate-200", w, h)} />;
}

// ─── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, icon: Icon, iconClass, loading, sym, isPercent = false,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  iconClass: string;
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
        <span className="text-2xl font-bold tabular-nums text-slate-900">
          {isPercent ? `${value.toFixed(1)}%` : fmt(value, sym)}
        </span>
      )}
    </div>
  );
}

// ─── Stage badge ───────────────────────────────────────────────────────────────

function StageBadge({ stage }: { stage: string }) {
  const meta = STAGE_META[stage as StageKey] ?? {
    label: stage, color: "text-slate-500", bg: "bg-slate-50 border-slate-200", dot: "bg-slate-400",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border", meta.bg, meta.color)}>
      <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", meta.dot)} />
      {meta.label}
    </span>
  );
}

// ─── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: "Open" | "Won" | "Lost" }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold",
      status === "Won"  && "bg-emerald-50 text-emerald-700",
      status === "Lost" && "bg-red-50 text-red-600",
      status === "Open" && "bg-blue-50 text-blue-700",
    )}>
      {status === "Won"  && <Trophy  className="w-2.5 h-2.5" />}
      {status === "Lost" && <XCircle className="w-2.5 h-2.5" />}
      {status === "Open" && <CircleDot className="w-2.5 h-2.5" />}
      {status}
    </span>
  );
}

// ─── Probability bar ───────────────────────────────────────────────────────────

function ProbBar({ value }: { value: number }) {
  const color =
    value >= 70 ? "bg-emerald-500" : value >= 40 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs tabular-nums text-slate-500 w-8 text-right">{value}%</span>
    </div>
  );
}

// ─── Kanban column ─────────────────────────────────────────────────────────────

function KanbanCol({
  stage, deals, sym,
}: {
  stage: StageKey;
  deals: PipelineDeal[];
  sym: string;
}) {
  const meta     = STAGE_META[stage];
  const colTotal = deals.reduce((s, d) => s + d.dealSize, 0);

  return (
    <div className="flex flex-col gap-3 min-w-[220px]">
      {/* Column header */}
      <div className={cn("rounded-xl border px-3 py-2 flex items-center justify-between", meta.bg)}>
        <span className={cn("text-xs font-bold uppercase tracking-wide", meta.color)}>{meta.label}</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-slate-500">{deals.length} deal{deals.length !== 1 ? "s" : ""}</span>
          <span className={cn("text-[10px] font-bold tabular-nums", meta.color)}>{fmt(colTotal, sym)}</span>
        </div>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-2">
        {deals.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-4 text-xs text-slate-400 text-center">
            No deals
          </div>
        ) : (
          deals.map((deal) => (
            <div
              key={deal.id}
              className="rounded-xl border border-slate-200 bg-white p-3.5 flex flex-col gap-2 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all"
            >
              <p className="text-sm font-semibold text-slate-800 leading-tight line-clamp-2">{deal.dealName}</p>
              <p className="text-xs text-slate-500">{deal.contactPerson}{deal.company ? ` · ${deal.company}` : ""}</p>
              <div className="flex items-center justify-between mt-1">
                <span className="text-sm font-bold tabular-nums text-omni-primary">{fmtFull(deal.dealSize, sym)}</span>
                <span className="text-[10px] text-slate-400">{deal.date}</span>
              </div>
              <ProbBar value={deal.probability} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Sort key type ─────────────────────────────────────────────────────────────

type SortKey = "date" | "dealName" | "dealSize" | "probability" | "status";
type SortDir = "asc" | "desc";

// ─── Main component ────────────────────────────────────────────────────────────

export function PipelineFunnel() {
  const { activeWorkspace }     = useWorkspace();
  const { currencySymbol: sym } = useCurrency();
  const { dateRange }           = useDateRange();

  const [data, setData]         = useState<PipelineResponse | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(false);
  const [view, setView]         = useState<"kanban" | "table">("kanban");
  const [search, setSearch]     = useState("");
  const [sortKey, setSortKey]   = useState<SortKey>("date");
  const [sortDir, setSortDir]   = useState<SortDir>("desc");
  const [stageFilter, setStageFilter] = useState<StageKey | "all">("all");
  const abortRef                = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoading(true);
    setError(false);
    try {
      const wsParam = activeWorkspace ? `&workspaceId=${activeWorkspace.id}` : "";
      const from    = dateRange.from.toISOString().slice(0, 10);
      const to      = dateRange.to.toISOString().slice(0, 10);
      const res     = await authFetch(
        `${API_BASE}api/etl/crm-leads?from=${from}&to=${to}${wsParam}`,
        { signal: ctl.signal },
      );
      if (ctl.signal.aborted) return;
      if (!res.ok) { setError(true); return; }
      const json = (await res.json()) as PipelineResponse;
      if (!ctl.signal.aborted) setData(json);
    } catch {
      if (!ctl.signal.aborted) setError(true);
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, [activeWorkspace?.id, dateRange.daysBack]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  useEffect(() => { setData(null); }, [activeWorkspace?.id]);

  // Filtered + sorted deal list
  const deals = useMemo(() => {
    let list = data?.deals ?? [];
    if (stageFilter !== "all") list = list.filter((d) => d.dealStage === stageFilter);
    const q = search.toLowerCase();
    if (q) list = list.filter((d) =>
      d.dealName.toLowerCase().includes(q) ||
      d.contactPerson.toLowerCase().includes(q) ||
      d.company.toLowerCase().includes(q),
    );
    return list.slice().sort((a, b) => {
      let av: string | number = 0;
      let bv: string | number = 0;
      if (sortKey === "date")        { av = a.date;        bv = b.date; }
      if (sortKey === "dealName")    { av = a.dealName;    bv = b.dealName; }
      if (sortKey === "dealSize")    { av = a.dealSize;    bv = b.dealSize; }
      if (sortKey === "probability") { av = a.probability; bv = b.probability; }
      if (sortKey === "status")      { av = a.status;      bv = b.status; }
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [data, stageFilter, search, sortKey, sortDir]);

  // Kanban buckets
  const buckets = useMemo(() => {
    const map: Partial<Record<StageKey, PipelineDeal[]>> = {};
    for (const s of STAGE_ORDER) map[s] = [];
    for (const d of deals) {
      const key = (STAGE_ORDER.includes(d.dealStage as StageKey) ? d.dealStage : "discovery") as StageKey;
      map[key]!.push(d);
    }
    return map as Record<StageKey, PipelineDeal[]>;
  }, [deals]);

  const totals = data?.totals;

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <ChevronDown className="w-3 h-3 opacity-30" />;
    return sortDir === "asc"
      ? <ChevronUp className="w-3 h-3 text-omni-primary" />
      : <ChevronDown className="w-3 h-3 text-omni-primary" />;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Pipeline Funnel</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {activeWorkspace?.clientName ?? "All Workspaces"} · CRM deal tracker
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded-xl overflow-hidden border border-slate-200 text-xs font-semibold">
            {(["kanban", "table"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "px-3 py-1.5 capitalize transition-colors",
                  view === v ? "bg-omni-primary text-white" : "bg-white text-slate-500 hover:text-slate-700",
                )}
              >
                {v}
              </button>
            ))}
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-omni-primary transition-colors rounded-xl px-3 py-1.5 hover:bg-blue-50 active:scale-[0.9] disabled:opacity-40"
            aria-label="Refresh pipeline data"
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
          Failed to load pipeline data. Check your connection and try refreshing.
        </div>
      )}

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard label="Closed Won"   value={totals?.closedWon  ?? 0} icon={Trophy}    iconClass="bg-emerald-100 text-emerald-600" loading={loading} sym={sym} />
        <KpiCard label="Closed Lost"  value={totals?.closedLost ?? 0} icon={XCircle}   iconClass="bg-red-100 text-red-500"         loading={loading} sym={sym} />
        <KpiCard label="Total Pipeline" value={totals?.totalDeal ?? 0} icon={TrendingUp} iconClass="bg-blue-100 text-omni-primary"   loading={loading} sym={sym} />
        <KpiCard label="Avg Probability" value={totals?.avgProb ?? 0} icon={Percent}   iconClass="bg-violet-100 text-violet-600"   loading={loading} sym={sym} isPercent />
      </div>

      {/* ── Filters row ── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search deals…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-omni-primary/30 focus:border-omni-primary transition-colors"
          />
        </div>
        {/* Stage filter */}
        <div className="flex flex-wrap gap-1.5">
          {(["all", ...STAGE_ORDER] as const).map((s) => {
            const meta = s === "all" ? null : STAGE_META[s];
            return (
              <button
                key={s}
                onClick={() => setStageFilter(s)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors",
                  stageFilter === s
                    ? "bg-omni-primary text-white border-omni-primary"
                    : "bg-white text-slate-500 border-slate-200 hover:border-slate-300",
                )}
              >
                {s === "all" ? "All Stages" : meta!.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Kanban view ── */}
      {view === "kanban" && (
        <div className="overflow-x-auto pb-2">
          {loading ? (
            <div className="flex gap-4">
              {STAGE_ORDER.map((s) => (
                <div key={s} className="flex flex-col gap-3 min-w-[220px]">
                  <Skel w="w-full" h="h-9" />
                  {[1, 2].map((i) => <Skel key={i} w="w-full" h="h-28" />)}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex gap-4">
              {STAGE_ORDER.map((s) => (
                <KanbanCol key={s} stage={s} deals={buckets[s]} sym={sym} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Table view ── */}
      {view === "table" && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide border-b border-slate-200">
                  {(
                    [
                      { key: "date",        label: "Date" },
                      { key: "dealName",    label: "Deal Name" },
                      { key: null,          label: "Contact" },
                      { key: "dealSize",    label: "Deal Size" },
                      { key: "probability", label: "Probability" },
                      { key: null,          label: "Stage" },
                      { key: "status",      label: "Status" },
                      { key: null,          label: "Won / Lost" },
                    ] as Array<{ key: SortKey | null; label: string }>
                  ).map(({ key, label }) => (
                    <th
                      key={label}
                      className={cn(
                        "px-4 py-3 text-left whitespace-nowrap font-semibold",
                        key && "cursor-pointer select-none hover:text-slate-700",
                      )}
                      onClick={() => key && toggleSort(key)}
                    >
                      <span className="inline-flex items-center gap-1">
                        {label}
                        {key && <SortIcon k={key} />}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 8 }).map((__, j) => (
                          <td key={j} className="px-4 py-3"><Skel w="w-20" h="h-4" /></td>
                        ))}
                      </tr>
                    ))
                  : deals.length === 0
                    ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-12 text-center text-slate-400 text-sm">
                          No deals match the current filters.
                        </td>
                      </tr>
                    )
                    : deals.map((d) => (
                        <tr key={d.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">{d.date}</td>
                          <td className="px-4 py-3 font-semibold text-slate-800 max-w-[200px]">
                            <p className="truncate">{d.dealName}</p>
                            {d.company && <p className="text-xs text-slate-400 font-normal truncate">{d.company}</p>}
                          </td>
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{d.contactPerson}</td>
                          <td className="px-4 py-3 font-semibold tabular-nums text-omni-primary whitespace-nowrap">
                            {fmtFull(d.dealSize, sym)}
                          </td>
                          <td className="px-4 py-3 min-w-[130px]"><ProbBar value={d.probability} /></td>
                          <td className="px-4 py-3 whitespace-nowrap"><StageBadge stage={d.dealStage} /></td>
                          <td className="px-4 py-3 whitespace-nowrap"><StatusBadge status={d.status} /></td>
                          <td className="px-4 py-3 whitespace-nowrap tabular-nums text-xs">
                            {d.closedWon  > 0 && <span className="text-emerald-600 font-semibold">+{fmtFull(d.closedWon,  sym)}</span>}
                            {d.closedLost > 0 && <span className="text-red-500 font-semibold">−{fmtFull(d.closedLost, sym)}</span>}
                            {d.closedWon === 0 && d.closedLost === 0 && <span className="text-slate-300">—</span>}
                          </td>
                        </tr>
                      ))
                }
              </tbody>
            </table>
          </div>
          {!loading && (
            <div className="px-4 py-3 border-t border-slate-100 text-xs text-slate-400 flex items-center justify-between">
              <span>{deals.length} deal{deals.length !== 1 ? "s" : ""} shown</span>
              {totals && (
                <span className="font-semibold text-slate-600">
                  Pipeline total: <span className="text-omni-primary">{fmtFull(totals.totalDeal, sym)}</span>
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
