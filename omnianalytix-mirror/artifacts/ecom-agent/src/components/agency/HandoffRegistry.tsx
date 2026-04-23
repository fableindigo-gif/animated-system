import { useState, useEffect, useCallback, useRef } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { useHasPermission } from "@/hooks/use-has-permission";
import { cn } from "@/lib/utils";
import {
  ChevronDown, ChevronRight, RefreshCw, Database,
  CircleDashed, Activity, CheckCircle2, AlertTriangle, Loader2,
} from "lucide-react";

const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

type HandoffStatus =
  | "ACCEPTED" | "DISPATCHED" | "COMPLETED" | "FAILED" | "HISTORICAL_BACKFILL";

interface HandoffRow {
  handoff_id: string;
  org_id: string;
  source_agent: string;
  target_agent: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: HandoffStatus;
  timestamp: string;
  dispatched_tool: string;
  result_summary: string | null;
  error_message: string | null;
  context: {
    issue: string;
    affected_skus: string[];
    current_poas: number;
    target_poas: number;
  };
}

interface RegistryResponse {
  scope: "platform" | "org";
  org_id: string | null;
  count: number;
  handoffs: HandoffRow[];
}

const STATUS_META: Record<HandoffStatus, { label: string; cls: string; Icon: typeof CircleDashed }> = {
  ACCEPTED:            { label: "Accepted",   cls: "bg-surface-container-low text-on-surface-variant border-outline-variant/30", Icon: CircleDashed },
  DISPATCHED:          { label: "Dispatched", cls: "bg-blue-500/10 text-blue-600 border-blue-500/30",                              Icon: Activity },
  COMPLETED:           { label: "Completed",  cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",                     Icon: CheckCircle2 },
  FAILED:              { label: "Failed",     cls: "bg-rose-500/10 text-rose-600 border-rose-500/30",                              Icon: AlertTriangle },
  HISTORICAL_BACKFILL: { label: "Backfilling",cls: "bg-amber-500/10 text-amber-600 border-amber-500/30",                           Icon: Database },
};

const PRIORITY_CLS: Record<HandoffRow["priority"], string> = {
  LOW:      "bg-slate-100 text-slate-600",
  MEDIUM:   "bg-sky-100 text-sky-700",
  HIGH:     "bg-orange-100 text-orange-700",
  CRITICAL: "bg-rose-100 text-rose-700",
};

export default function HandoffRegistry() {
  const { permitted: canHeal } = useHasPermission("manager");
  const [data,    setData]    = useState<RegistryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyId,   setBusyId]   = useState<string | null>(null);
  const lastFetchRef = useRef<number>(0);

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/mcp/registry`);
      if (!res.ok) throw new Error(`Registry fetch failed (${res.status})`);
      const json = (await res.json()) as RegistryResponse;
      setData(json);
      setError(null);
      lastFetchRef.current = Date.now();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const handleRetry = async (row: HandoffRow) => {
    setBusyId(row.handoff_id);
    try {
      const res = await authFetch(`${BASE}/api/mcp/registry/${row.handoff_id}/retry`, { method: "POST" });
      if (!res.ok) throw new Error(`Retry failed (${res.status})`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const handleBackfill = async (row: HandoffRow) => {
    setBusyId(row.handoff_id);
    try {
      const res = await authFetch(`${BASE}/api/mcp/registry/${row.handoff_id}/backfill`, { method: "POST" });
      if (!res.ok) throw new Error(`Backfill trigger failed (${res.status})`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="bg-white border border-outline-variant/15 rounded-2xl shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-brand-blue text-[20px]">smart_toy</span>
          <h3 className="text-sm font-bold text-on-surface">Agent Handoff Registry</h3>
          {data && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-primary-container/10 text-brand-blue font-semibold">
              {data.scope === "platform" ? "platform" : `org #${data.org_id ?? "?"}`} · {data.count}
            </span>
          )}
        </div>
        <span className="text-[10px] text-on-surface-variant">Polling 10s · {new Date(lastFetchRef.current || Date.now()).toLocaleTimeString()}</span>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-600">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && !data && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-xl bg-surface-container-low animate-pulse" />
          ))}
        </div>
      )}

      {!loading && data && data.handoffs.length === 0 && (
        <div className="rounded-xl border border-dashed border-outline-variant/30 px-4 py-6 text-center text-xs text-on-surface-variant">
          No A2A handoffs in flight. The Gap Finder hasn't routed to a specialist in the active TTL window (1h).
        </div>
      )}

      {data && data.handoffs.length > 0 && (
        <ul className="space-y-2">
          {data.handoffs.map((row) => {
            const meta = STATUS_META[row.status];
            const isOpen = expanded.has(row.handoff_id);
            const isBusy = busyId === row.handoff_id;
            const Icon = meta.Icon;

            return (
              <li key={row.handoff_id} className="rounded-xl border border-outline-variant/15 bg-surface-container-low/30 overflow-hidden">
                <button
                  onClick={() => toggle(row.handoff_id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-surface-container-low transition-colors text-left"
                >
                  {isOpen
                    ? <ChevronDown    className="w-3.5 h-3.5 text-on-surface-variant shrink-0" />
                    : <ChevronRight   className="w-3.5 h-3.5 text-on-surface-variant shrink-0" />}

                  <span className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                    meta.cls,
                  )}>
                    <Icon className={cn("w-3 h-3", row.status === "DISPATCHED" && "animate-pulse")} />
                    {meta.label}
                  </span>

                  <span className={cn("text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded", PRIORITY_CLS[row.priority])}>
                    {row.priority}
                  </span>

                  <span className="text-xs font-semibold text-on-surface flex-1 truncate">
                    {row.source_agent} → {row.target_agent}
                  </span>

                  <span className="text-[10px] text-on-surface-variant tabular-nums shrink-0">
                    {new Date(row.timestamp).toLocaleTimeString()}
                  </span>
                </button>

                {isOpen && (
                  <div className="px-3 pb-3 pt-1 space-y-2 border-t border-outline-variant/15 bg-white">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                      <div><span className="text-on-surface-variant">handoff_id:</span> <span className="font-mono text-on-surface">{row.handoff_id}</span></div>
                      <div><span className="text-on-surface-variant">org_id:</span>     <span className="font-mono text-on-surface">{row.org_id}</span></div>
                      <div><span className="text-on-surface-variant">dispatched:</span> <span className="font-mono text-on-surface">{row.dispatched_tool}</span></div>
                      <div><span className="text-on-surface-variant">timestamp:</span>  <span className="text-on-surface">{new Date(row.timestamp).toLocaleString()}</span></div>
                    </div>

                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold mb-1">Context payload</p>
                      <pre className="text-[11px] font-mono bg-surface-container-low rounded-lg p-2 overflow-x-auto text-on-surface">
{JSON.stringify(row.context, null, 2)}
                      </pre>
                    </div>

                    {row.result_summary && (
                      <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200/60 rounded-lg px-2 py-1.5">
                        <span className="font-semibold">Result:</span> {row.result_summary}
                      </div>
                    )}

                    {row.status === "FAILED" && row.error_message && (
                      <div className="space-y-2">
                        <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200/60 rounded-lg px-2 py-1.5">
                          <p className="font-semibold mb-0.5">Worker error</p>
                          <pre className="font-mono whitespace-pre-wrap break-words text-[10px] leading-relaxed">{row.error_message}</pre>
                        </div>

                        {canHeal ? (
                          <div className="flex flex-wrap gap-2">
                            <button
                              disabled={isBusy}
                              onClick={() => handleRetry(row)}
                              className={cn(
                                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors",
                                "bg-blue-500/15 text-blue-600 hover:bg-blue-500/25",
                                isBusy && "opacity-50 cursor-wait",
                              )}
                            >
                              {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                              Retry handoff
                            </button>
                            <button
                              disabled={isBusy}
                              onClick={() => handleBackfill(row)}
                              className={cn(
                                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors",
                                "bg-amber-500/15 text-amber-600 hover:bg-amber-500/25",
                                isBusy && "opacity-50 cursor-wait",
                              )}
                            >
                              {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Database className="w-3 h-3" />}
                              Trigger data backfill
                            </button>
                          </div>
                        ) : (
                          <p className="text-[10px] text-on-surface-variant italic">Self-healing actions require Account Director or higher.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
