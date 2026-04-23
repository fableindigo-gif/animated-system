import { useEffect, useState } from "react";
import { Activity, MessageSquare, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { authFetch } from "@/lib/auth-fetch";
import { useDashboardFilter } from "@/context/DashboardFilterContext";
import { useAgentExecutionStore } from "@/hooks/useAgentExecution";
import { cn } from "@/lib/utils";

const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

interface ExecutionLogRow {
  id: string;
  toolName: string;
  status: string;
  createdAt: number;
  summary?: string;
  campaignId?: string;
  skuId?: string;
}

interface PerformanceAILogsProps {
  onChat?: (msg: string) => void;
}

export default function PerformanceAILogs({ onChat }: PerformanceAILogsProps) {
  const { skuId, campaignId, isFiltered } = useDashboardFilter();
  const agentExecStatus  = useAgentExecutionStore((s) => s.status);
  const agentExecMessage = useAgentExecutionStore((s) => s.message);
  const agentExecName    = useAgentExecutionStore((s) => s.agentName);
  const [logs, setLogs]       = useState<ExecutionLogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    authFetch(`${BASE}/api/actions/executions?limit=20`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown) => {
        if (cancelled) return;
        const arr = Array.isArray(data) ? data : Array.isArray((data as { items?: unknown }).items) ? (data as { items: ExecutionLogRow[] }).items : [];
        setLogs(arr as ExecutionLogRow[]);
      })
      .catch(() => { if (!cancelled) setLogs([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = logs.filter((log) => {
    if (skuId && log.skuId && log.skuId !== skuId) return false;
    if (campaignId && log.campaignId && log.campaignId !== campaignId) return false;
    return true;
  });

  return (
    <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-on-surface-variant" />
          <h3 className="text-sm font-semibold text-on-surface">Performance AI Logs</h3>
          {isFiltered && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-blue/10 text-accent-blue uppercase tracking-wider">
              Filtered{skuId ? ` · sku ${skuId}` : ""}{campaignId ? ` · ${campaignId}` : ""}
            </span>
          )}
        </div>
        {onChat && (
          <button
            onClick={() => onChat(isFiltered ? `Investigate ${skuId ?? campaignId ?? "the current selection"} performance` : "Show me today's AI execution summary")}
            className="text-[10px] uppercase tracking-wider text-accent-blue hover:underline flex items-center gap-1"
          >
            <MessageSquare className="w-3 h-3" /> Ask AI
          </button>
        )}
      </div>

      {agentExecStatus !== "idle" && (
        <div className={cn(
          "mb-3 flex items-center gap-2 rounded-xl border px-3 py-2",
          agentExecStatus === "analyzing" && "border-accent-blue/30 bg-accent-blue/5 text-accent-blue",
          agentExecStatus === "complete"  && "border-emerald-400/30 bg-emerald-400/5 text-emerald-600",
          agentExecStatus === "error"     && "border-rose-400/30 bg-rose-400/5 text-rose-500",
        )}>
          {agentExecStatus === "analyzing" && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
          {agentExecStatus === "complete"  && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
          {agentExecStatus === "error"     && <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
          <div className="text-[11px] leading-snug">
            <span className="font-semibold">{agentExecName ?? "Agent"}</span>
            <span className="opacity-80"> · {agentExecMessage}</span>
          </div>
        </div>
      )}

      {loading && <div className="text-xs text-on-surface-variant">Loading recent agent executions…</div>}
      {!loading && filtered.length === 0 && (
        <div className="text-xs text-on-surface-variant py-4 text-center">
          {isFiltered ? "No agent executions match the current filter." : "No recent agent executions."}
        </div>
      )}
      <ul className="space-y-1.5 max-h-64 overflow-y-auto">
        {filtered.map((log) => (
          <li key={log.id} className="flex items-center justify-between gap-3 px-3 py-1.5 rounded-xl hover:bg-surface-container">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-on-surface truncate">{log.toolName}</div>
              {log.summary && <div className="text-[10px] text-on-surface-variant truncate">{log.summary}</div>}
            </div>
            <div className={cn(
              "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0",
              log.status === "succeeded" ? "bg-emerald-500/10 text-emerald-500"
              : log.status === "failed"   ? "bg-rose-500/10 text-rose-500"
              : "bg-on-surface-variant/10 text-on-surface-variant",
            )}>
              {log.status}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
