import { useState, useCallback, useEffect, useRef } from "react";
import { authFetch, authPost } from "@/lib/auth-fetch";
import { appendFxAuditToCsv } from "@/lib/fx-audit-csv";
import { useDateRange } from "@/contexts/date-range-context";
import { cn } from "@/lib/utils";
import { DateRangePicker } from "./date-range-picker";
import { FilterBar } from "./filter-bar";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import {
  Search, Play, RefreshCw, AlertTriangle, ChevronRight,
  Download, Table2, BarChart2, Code2,
} from "lucide-react";

const BASE     = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface QueryTemplate {
  name: string;
  description: string;
  requiredMacros?: string[];
  defaultMacros?: Record<string, string>;
}

interface QueryResult {
  queryName: string;
  description: string;
  customerId: string;
  columns: string[];
  rows: unknown[][];
  objects: Record<string, unknown>[];
  rowCount: number;
}

type ViewMode = "table" | "chart" | "raw";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return v % 1 === 0 ? String(v) : v.toFixed(2);
  }
  return String(v);
}

function fmtCol(col: string): string {
  return col.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const QUERY_ICONS: Record<string, string> = {
  campaign_performance:  "campaign",
  ad_group_performance:  "folder_open",
  keyword_performance:   "key",
  shopping_performance:  "shopping_cart",
  budget_utilisation:    "account_balance_wallet",
  account_structure:     "account_tree",
  search_terms:          "manage_search",
};

const CHART_METRIC_HINTS: Record<string, string[]> = {
  campaign_performance:  ["cost_usd", "revenue", "conversions"],
  ad_group_performance:  ["cost_usd", "conversions", "clicks"],
  keyword_performance:   ["cost_usd", "clicks", "conversions"],
  shopping_performance:  ["cost_usd", "revenue", "conversions"],
  budget_utilisation:    ["daily_budget_usd", "cost_usd"],
  account_structure:     [],
  search_terms:          ["impressions", "clicks", "cost_usd"],
};

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4"];

// ─── Skeleton ──────────────────────────────────────────────────────────────────

function Skel({ w = "w-24", h = "h-4" }: { w?: string; h?: string }) {
  return <span className={cn("inline-block rounded animate-pulse bg-slate-200", w, h)} />;
}

// ─── Query card (left rail) ────────────────────────────────────────────────────

function QueryCard({
  tpl,
  active,
  onSelect,
}: {
  tpl: QueryTemplate;
  active: boolean;
  onSelect: () => void;
}) {
  const icon = QUERY_ICONS[tpl.name] ?? "query_stats";
  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left px-3 py-3 rounded-xl flex items-start gap-3 transition-all",
        active
          ? "bg-indigo-600 text-white shadow-sm"
          : "hover:bg-slate-100 text-slate-700",
      )}
    >
      <span
        className={cn(
          "material-symbols-outlined text-[20px] shrink-0 mt-0.5",
          active ? "text-white" : "text-indigo-500",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className={cn("text-sm font-semibold truncate", active ? "text-white" : "text-slate-900")}>
          {fmtCol(tpl.name)}
        </p>
        <p className={cn("text-xs mt-0.5 leading-snug line-clamp-2", active ? "text-indigo-100" : "text-slate-500")}>
          {tpl.description}
        </p>
      </div>
      <ChevronRight className={cn("w-4 h-4 shrink-0 mt-1", active ? "text-white" : "text-slate-300")} />
    </button>
  );
}

// ─── Results table ─────────────────────────────────────────────────────────────

function ResultsTable({ result }: { result: QueryResult }) {
  const [page, setPage] = useState(0);
  const PAGE = 20;
  const total = result.rows.length;
  const pages = Math.ceil(total / PAGE);
  const slice = result.rows.slice(page * PAGE, page * PAGE + PAGE);

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 sticky top-0">
            <tr>
              {result.columns.map((col) => (
                <th
                  key={col}
                  className="px-3 py-2.5 text-left font-semibold text-slate-600 whitespace-nowrap text-xs uppercase tracking-wide"
                >
                  {fmtCol(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {slice.map((row, ri) => (
              <tr key={ri} className="hover:bg-slate-50 transition-colors">
                {(row as unknown[]).map((cell, ci) => (
                  <td key={ci} className="px-3 py-2 text-slate-700 whitespace-nowrap tabular-nums">
                    {fmt(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-between mt-3 text-sm text-slate-500">
          <span>{total} rows — page {page + 1} of {pages}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
            >
              Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
              disabled={page >= pages - 1}
              className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Bar chart view ────────────────────────────────────────────────────────────

function ResultsChart({ result }: { result: QueryResult }) {
  const hints = CHART_METRIC_HINTS[result.queryName] ?? [];
  const metricCols = hints.filter((h) => result.columns.includes(h));
  const labelCol = result.columns.find((c) =>
    ["campaign_name", "ad_group_name", "keyword", "product_title", "search_term"].includes(c),
  );

  if (!metricCols.length || !labelCol) {
    return (
      <p className="text-slate-500 text-sm py-8 text-center">
        Chart view is not available for this query type. Switch to Table.
      </p>
    );
  }

  const labelIdx  = result.columns.indexOf(labelCol);
  const metricIdx = result.columns.indexOf(metricCols[0]);

  const data = result.rows.slice(0, 15).map((row) => ({
    name:  String((row as unknown[])[labelIdx] ?? "—").slice(0, 20),
    value: Number((row as unknown[])[metricIdx] ?? 0),
  }));

  return (
    <div>
      <p className="text-xs text-slate-500 mb-3">
        Showing top 15 rows — <span className="font-medium">{fmtCol(metricCols[0])}</span> by {fmtCol(labelCol)}
      </p>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} layout="vertical" margin={{ left: 120, right: 20 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(v)} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
          <Tooltip formatter={(v: number) => [fmt(v), fmtCol(metricCols[0])]} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Ad-hoc GAQL panel ────────────────────────────────────────────────────────

function buildDefaultAdHocGaql(from: string, to: string): string {
  return (
    "SELECT\n" +
    "  campaign.id AS campaign_id,\n" +
    "  campaign.name AS campaign_name,\n" +
    "  metrics.clicks AS clicks\n" +
    "FROM campaign\n" +
    `WHERE segments.date BETWEEN '${from}' AND '${to}'\n` +
    "ORDER BY metrics.clicks DESC\n" +
    "LIMIT 10"
  );
}

function AdHocPanel({
  onResult,
  running,
  setRunning,
  startDate,
  endDate,
  rangeLabel,
}: {
  onResult: (r: QueryResult) => void;
  running: boolean;
  setRunning: (v: boolean) => void;
  startDate: string;
  endDate: string;
  rangeLabel: string;
}) {
  const [gaql, setGaql] = useState(() => buildDefaultAdHocGaql(startDate, endDate));
  // Track whether the user has hand-edited the textarea. While the textarea
  // still matches the seed template, we keep re-seeding from the global date
  // picker. Once the user types anything custom, we stop clobbering their
  // edits on subsequent picker changes.
  const [edited, setEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Insert a snippet at the textarea's current cursor position (or replace
  // the current selection). Marks the panel as "edited" so the global
  // picker stops re-seeding the literal seed query and overwriting the
  // user's work — but never flips edited back to false, so chip inserts
  // always preserve any existing custom edits.
  const insertAtCursor = useCallback((snippet: string) => {
    const ta = textareaRef.current;
    // Use a functional updater so rapid consecutive clicks always splice
    // into the freshest text — never a stale closure snapshot.
    let caret = 0;
    setGaql((prev) => {
      const start = ta?.selectionStart ?? prev.length;
      const end   = ta?.selectionEnd ?? prev.length;
      caret = start + snippet.length;
      return prev.slice(0, start) + snippet + prev.slice(end);
    });
    setEdited(true);
    // Restore focus and place caret at the end of the inserted snippet.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }, []);

  useEffect(() => {
    if (edited) return;
    setGaql(buildDefaultAdHocGaql(startDate, endDate));
  }, [startDate, endDate, edited]);

  const resetToSeed = useCallback(() => {
    setGaql(buildDefaultAdHocGaql(startDate, endDate));
    setEdited(false);
    setError(null);
  }, [startDate, endDate]);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await authPost(`${API_BASE}api/gaarf/run`, { query: gaql, script_name: "ad_hoc" });
      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: "Unknown error" }));
        setError(e.error ?? "Query failed");
        return;
      }
      const data = await res.json();
      onResult({
        queryName: "ad_hoc",
        description: "Ad-hoc query",
        customerId: data.customerId ?? "",
        columns: data.columns,
        rows: data.rows,
        objects: data.rows.map((row: unknown[]) =>
          Object.fromEntries(data.columns.map((c: string, i: number) => [c, row[i]])),
        ),
        rowCount: data.rowCount,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }, [gaql, onResult, setRunning]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          Seed query window:{" "}
          <span className="font-mono text-slate-700">{startDate}</span>
          {" → "}
          <span className="font-mono text-slate-700">{endDate}</span>
          <span className="ml-2 text-slate-400">({rangeLabel})</span>
          {edited && (
            <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 font-semibold">
              edited — picker won't overwrite
            </span>
          )}
        </span>
        {edited && (
          <button
            onClick={resetToSeed}
            className="text-indigo-600 hover:text-indigo-700 font-semibold"
          >
            Reset to picker window
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 mr-1">
          Insert at cursor:
        </span>
        <button
          type="button"
          onClick={() => insertAtCursor("{start_date}")}
          title="GAARF macro — resolved to the picker's start date at run time"
          className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700 px-2.5 py-1 text-xs font-mono font-semibold hover:bg-indigo-100 transition-colors"
        >
          {"{start_date}"}
        </button>
        <button
          type="button"
          onClick={() => insertAtCursor("{end_date}")}
          title="GAARF macro — resolved to the picker's end date at run time"
          className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700 px-2.5 py-1 text-xs font-mono font-semibold hover:bg-indigo-100 transition-colors"
        >
          {"{end_date}"}
        </button>
        <button
          type="button"
          onClick={() =>
            insertAtCursor("segments.date BETWEEN '{start_date}' AND '{end_date}'")
          }
          title="Insert a date BETWEEN clause that follows the global picker"
          className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700 px-2.5 py-1 text-xs font-semibold hover:bg-indigo-100 transition-colors"
        >
          BETWEEN macros
        </button>
        <span className="mx-1 h-4 w-px bg-slate-200" aria-hidden />
        <button
          type="button"
          onClick={() => insertAtCursor(`'${startDate}'`)}
          title={`Insert today's picker start date (${startDate}) as a literal`}
          className="inline-flex items-center rounded-full border border-slate-200 bg-white text-slate-700 px-2.5 py-1 text-xs font-mono font-semibold hover:bg-slate-50 transition-colors"
        >
          {`'${startDate}'`}
        </button>
        <button
          type="button"
          onClick={() => insertAtCursor(`'${endDate}'`)}
          title={`Insert today's picker end date (${endDate}) as a literal`}
          className="inline-flex items-center rounded-full border border-slate-200 bg-white text-slate-700 px-2.5 py-1 text-xs font-mono font-semibold hover:bg-slate-50 transition-colors"
        >
          {`'${endDate}'`}
        </button>
        <button
          type="button"
          onClick={() =>
            insertAtCursor(
              `segments.date BETWEEN '${startDate}' AND '${endDate}'`,
            )
          }
          title="Insert today's picker window as a literal BETWEEN clause"
          className="inline-flex items-center rounded-full border border-slate-200 bg-white text-slate-700 px-2.5 py-1 text-xs font-semibold hover:bg-slate-50 transition-colors"
        >
          Today's window
        </button>
      </div>
      <textarea
        ref={textareaRef}
        value={gaql}
        onChange={(e) => {
          setGaql(e.target.value);
          if (!edited && e.target.value !== buildDefaultAdHocGaql(startDate, endDate)) {
            setEdited(true);
          }
        }}
        rows={8}
        spellCheck={false}
        className="w-full rounded-xl border border-slate-200 bg-slate-950 text-green-300 font-mono text-sm p-4 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500"
        placeholder="SELECT ... FROM campaign WHERE ..."
      />
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}
      <button
        onClick={run}
        disabled={running || !gaql.trim()}
        className="self-start inline-flex items-center gap-2 rounded-xl bg-indigo-600 text-white px-5 py-2.5 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-all"
      >
        {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
        {running ? "Running…" : "Run Query"}
      </button>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function GoogleAdsHub() {
  const [templates, setTemplates]     = useState<QueryTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [selected, setSelected]       = useState<QueryTemplate | null>(null);
  const [result, setResult]           = useState<QueryResult | null>(null);
  const [running, setRunning]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [viewMode, setViewMode]       = useState<ViewMode>("table");
  // Date pickers are seeded from the global DateRangeContext, but kept as
  // local state so the user can still tweak start/end per-query without
  // clobbering the app-wide preset. When the global picker changes, sync
  // back into the local state so the next "Run" honors the new window.
  const { dateRange, refreshKey } = useDateRange();
  const [startDate, setStartDate] = useState(() => dateRange.from.toISOString().slice(0, 10));
  const [endDate, setEndDate]     = useState(() => dateRange.to.toISOString().slice(0, 10));
  useEffect(() => {
    setStartDate(dateRange.from.toISOString().slice(0, 10));
    setEndDate(dateRange.to.toISOString().slice(0, 10));
  }, [dateRange.from, dateRange.to, refreshKey]);
  // When the global picker (or refresh button) changes, any currently
  // displayed result is now stale because it was computed against the
  // *previous* window. Auto-rerun the active named query so on-screen
  // numbers always reflect the picker — matches the rest of the app.
  // Tracked via a "last-run" stamp so we don't fire during the very first
  // render before the user has run anything.
  const lastRunRef = useRef<string | null>(null);
  const [activeTab, setActiveTab]     = useState<"named" | "adhoc">("named");

  useEffect(() => {
    authFetch(`${API_BASE}api/gaarf/queries`)
      .then((r) => r.json())
      .then((data: QueryTemplate[]) => {
        setTemplates(data);
        if (data.length) setSelected(data[0]);
      })
      .catch(() => setError("Failed to load query templates"))
      .finally(() => setLoadingTemplates(false));
  }, []);

  const runSelected = useCallback(async () => {
    if (!selected) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await authPost(`${API_BASE}api/gaarf/queries/${selected.name}/run`, {
        macros: { start_date: startDate, end_date: endDate },
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: "Unknown error" }));
        setError(e.error ?? e.message ?? "Query execution failed");
        return;
      }
      const data = await res.json();
      setResult(data);
      setViewMode("table");
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
      // Stamp includes refreshKey so an explicit Refresh (which doesn't
      // change the date strings) still triggers a rerun via the effect
      // below — same semantics as the rest of the app.
      lastRunRef.current = `${selected.name}:${startDate}:${endDate}:${refreshKey}`;
    }
  }, [selected, startDate, endDate, refreshKey]);

  // Auto-rerun the active named query whenever the global picker
  // (or refresh button) changes, so on-screen numbers always reflect
  // the user-selected window. Only fires after the user has run at
  // least one query (lastRunRef is null on first mount).
  useEffect(() => {
    if (activeTab !== "named") return;
    if (!selected || !result || running) return;
    if (lastRunRef.current === null) return;
    const stamp = `${selected.name}:${startDate}:${endDate}:${refreshKey}`;
    if (stamp === lastRunRef.current) return;
    runSelected();
  }, [startDate, endDate, refreshKey, selected, result, running, activeTab, runSelected]);

  function downloadCsv() {
    if (!result) return;
    const header = result.columns.join(",");
    const body   = result.rows.map((r) =>
      (r as unknown[]).map((v) => (typeof v === "string" ? `"${v}"` : String(v ?? ""))).join(","),
    );
    const csv  = appendFxAuditToCsv([header, ...body].join("\n"));
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${result.queryName}_${startDate}_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-6">
      <FilterBar
        pageKey="google-ads-hub"
        dimensions={[
          { id: "account" },
          { id: "campaign" },
          { id: "network" },
          { id: "device" },
          { id: "country" },
        ]}
      />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Google Ads Reports</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Live GAQL queries powered by the Google Ads API Report Fetcher
            <span className="ml-2 text-slate-400">· seeded from <strong>{dateRange.label}</strong></span>
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <DateRangePicker />
          <button
            onClick={() => setActiveTab("named")}
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-semibold border transition-all",
              activeTab === "named"
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50",
            )}
          >
            Named Queries
          </button>
          <button
            onClick={() => setActiveTab("adhoc")}
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-semibold border transition-all",
              activeTab === "adhoc"
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50",
            )}
          >
            <span className="flex items-center gap-1.5">
              <Code2 className="w-4 h-4" />
              Ad-hoc GAQL
            </span>
          </button>
        </div>
      </div>

      {activeTab === "named" ? (
        <div className="grid grid-cols-[280px_1fr] gap-5 min-h-[600px]">
          {/* Left rail */}
          <div className="flex flex-col gap-1 bg-white rounded-2xl border border-slate-200 p-3 shadow-sm h-fit">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 px-2 mb-1">
              Query Templates
            </p>
            {loadingTemplates
              ? [1, 2, 3, 4, 5].map((i) => <Skel key={i} w="w-full" h="h-14" />)
              : templates.map((tpl) => (
                  <QueryCard
                    key={tpl.name}
                    tpl={tpl}
                    active={selected?.name === tpl.name}
                    onSelect={() => {
                      setSelected(tpl);
                      setResult(null);
                      setError(null);
                    }}
                  />
                ))}
          </div>

          {/* Right panel */}
          <div className="flex flex-col gap-4">
            {selected && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">{fmtCol(selected.name)}</h2>
                    <p className="text-slate-500 text-sm mt-0.5">{selected.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Date pickers */}
                    <div className="flex items-center gap-2 text-sm">
                      <div className="flex items-center gap-1 border border-slate-200 rounded-xl px-3 py-2">
                        <Search className="w-3.5 h-3.5 text-slate-400" />
                        <input
                          type="date"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          className="text-slate-700 outline-none bg-transparent"
                        />
                      </div>
                      <span className="text-slate-400">→</span>
                      <div className="flex items-center gap-1 border border-slate-200 rounded-xl px-3 py-2">
                        <input
                          type="date"
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                          className="text-slate-700 outline-none bg-transparent"
                        />
                      </div>
                    </div>
                    <button
                      onClick={runSelected}
                      disabled={running}
                      className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 text-white px-5 py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-all"
                    >
                      {running ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                      {running ? "Running…" : "Run"}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 mb-4">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">Query failed</p>
                      <p className="text-red-600 mt-0.5">{error}</p>
                    </div>
                  </div>
                )}

                {result && (
                  <div>
                    {/* Toolbar */}
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm text-slate-500">
                        <span className="font-semibold text-slate-800">{result.rowCount}</span> rows
                        {result.customerId && (
                          <> — Customer ID <span className="font-mono text-slate-600">{result.customerId}</span></>
                        )}
                      </p>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setViewMode("table")}
                          title="Table view"
                          className={cn(
                            "p-2 rounded-lg transition-all",
                            viewMode === "table" ? "bg-indigo-100 text-indigo-600" : "text-slate-400 hover:bg-slate-100",
                          )}
                        >
                          <Table2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setViewMode("chart")}
                          title="Chart view"
                          className={cn(
                            "p-2 rounded-lg transition-all",
                            viewMode === "chart" ? "bg-indigo-100 text-indigo-600" : "text-slate-400 hover:bg-slate-100",
                          )}
                        >
                          <BarChart2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={downloadCsv}
                          title="Download CSV"
                          className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 transition-all"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {viewMode === "table" && <ResultsTable result={result} />}
                    {viewMode === "chart" && <ResultsChart result={result} />}
                  </div>
                )}

                {!result && !running && !error && (
                  <div className="py-16 text-center text-slate-400">
                    <span className="material-symbols-outlined text-5xl text-slate-200">query_stats</span>
                    <p className="mt-3 text-sm">Select a date range and press Run to fetch live data</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-lg font-bold text-slate-900 mb-1">Ad-hoc GAQL Query</h2>
          <p className="text-slate-500 text-sm mb-5">
            Write any valid GAQL query with GAARF extended syntax: <code className="bg-slate-100 px-1 rounded text-xs">AS alias</code>,{" "}
            <code className="bg-slate-100 px-1 rounded text-xs">:nested.path</code>,{" "}
            <code className="bg-slate-100 px-1 rounded text-xs">{"{start_date}"}</code> macros.
          </p>
          <AdHocPanel
            running={running}
            setRunning={setRunning}
            startDate={startDate}
            endDate={endDate}
            rangeLabel={dateRange.label}
            onResult={(r) => { setResult(r); setViewMode("table"); }}
          />
          {result && result.queryName === "ad_hoc" && (
            <div className="mt-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-slate-500">
                  <span className="font-semibold text-slate-800">{result.rowCount}</span> rows returned
                </p>
                <button onClick={downloadCsv} className="flex items-center gap-1.5 text-sm text-indigo-600 hover:underline">
                  <Download className="w-3.5 h-3.5" />
                  Download CSV
                </button>
              </div>
              <ResultsTable result={result} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
