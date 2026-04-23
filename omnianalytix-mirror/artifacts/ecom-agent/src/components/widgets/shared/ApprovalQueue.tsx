import { useEffect, useState, useCallback } from "react";
import { Check, X, Clock, AlertTriangle, Loader2 } from "lucide-react";
import { authFetch, getActiveWorkspaceId, getActiveOrgId } from "@/lib/auth-fetch";
import { useHasPermission } from "@/hooks/use-has-permission";
import { cn } from "@/lib/utils";

const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

interface DisplayDiff { label: string; from: string; to: string }

interface ProposedTaskRow {
  id: number;
  proposedByName: string;
  proposedByRole: string;
  platform: string;
  platformLabel: string;
  toolName: string;
  toolDisplayName: string;
  toolArgs: Record<string, unknown>;
  displayDiff: DisplayDiff[] | null;
  reasoning: string;
  status: string;
  createdAt: string;
}

interface ApprovalQueueProps {
  pollIntervalMs?: number;
  onTaskCountChange?: (count: number) => void;
}

export default function ApprovalQueue({ pollIntervalMs = 30_000, onTaskCountChange }: ApprovalQueueProps) {
  const { permitted: canApprove } = useHasPermission("manager");
  const [tasks, setTasks]     = useState<ProposedTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId]   = useState<number | null>(null);
  const [error, setError]     = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/tasks?status=pending`);
      if (!res.ok) throw new Error(`Approval queue fetch failed: ${res.status}`);
      const rows = (await res.json()) as ProposedTaskRow[];
      setTasks(Array.isArray(rows) ? rows : []);
      onTaskCountChange?.(Array.isArray(rows) ? rows.length : 0);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load approval queue");
    } finally {
      setLoading(false);
    }
  }, [onTaskCountChange]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => { void refresh(); }, pollIntervalMs);
    return () => clearInterval(t);
  }, [refresh, pollIntervalMs]);

  const callMcpExecute = useCallback(async (task: ProposedTaskRow) => {
    if (task.toolName !== "execute_budget_shift") return; // Other tools handled by their own pipelines
    try {
      await authFetch(`${BASE}/api/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `exec_${task.id}_${Date.now()}`,
          method: "invoke_tool",
          params: {
            tool_name: "execute_budget_shift",
            workspace_id: getActiveWorkspaceId() ?? "ws_default",
            org_id: getActiveOrgId() ?? "org_default",
            args: { proposed_task_id: task.id },
          },
        }),
      });
    } catch (e) {
      console.warn("[ApprovalQueue] MCP execute_budget_shift call failed:", e);
    }
  }, []);

  const handleApprove = useCallback(async (task: ProposedTaskRow) => {
    setBusyId(task.id);
    try {
      const res = await authFetch(`${BASE}/api/tasks/${task.id}/approve`, { method: "PATCH" });
      if (!res.ok) throw new Error(`Approve failed: ${res.status}`);
      await callMcpExecute(task);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setBusyId(null);
    }
  }, [callMcpExecute, refresh]);

  const handleReject = useCallback(async (task: ProposedTaskRow) => {
    setBusyId(task.id);
    try {
      const res = await authFetch(`${BASE}/api/tasks/${task.id}/reject`, { method: "PATCH" });
      if (!res.ok) throw new Error(`Reject failed: ${res.status}`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rejection failed");
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  if (!loading && tasks.length === 0) return null;

  return (
    <div className="rounded-2xl border border-amber-400/30 bg-amber-400/5 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-semibold text-on-surface">Approval Queue</h3>
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 font-semibold">
            {tasks.length} pending
          </span>
        </div>
        <span className="text-[10px] text-on-surface-variant uppercase tracking-wider">
          {canApprove ? "Human-in-the-loop" : "View only · approval requires Account Director"}
        </span>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
          <p className="text-[11px] text-rose-500 leading-snug">{error}</p>
        </div>
      )}

      <ul className="space-y-2">
        {tasks.map((task) => {
          const isBusy = busyId === task.id;
          return (
            <li key={task.id} className="rounded-xl border border-outline-variant/30 bg-surface-container-low p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold text-on-surface truncate">{task.toolDisplayName}</span>
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-on-surface-variant/10 text-on-surface-variant">
                      {task.platformLabel}
                    </span>
                  </div>
                  <div className="text-[11px] text-on-surface-variant leading-snug mb-2">
                    Proposed by <span className="font-medium text-on-surface">{task.proposedByName}</span> · {task.reasoning || "No reasoning provided"}
                  </div>
                  {task.displayDiff && task.displayDiff.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 mt-2 mb-1">
                      {task.displayDiff.map((d, i) => (
                        <div key={i} className="rounded-lg bg-surface-container px-2 py-1.5">
                          <div className="text-[10px] uppercase tracking-wider text-on-surface-variant">{d.label}</div>
                          <div className="text-[11px] text-on-surface mt-0.5 truncate" title={`${d.from} → ${d.to}`}>
                            <span className="text-rose-500">{d.from}</span>
                            <span className="text-on-surface-variant mx-1">→</span>
                            <span className="text-emerald-500">{d.to}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {canApprove ? (
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button
                      disabled={isBusy}
                      onClick={() => handleApprove(task)}
                      className={cn(
                        "flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors",
                        "bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25",
                        isBusy && "opacity-50 cursor-wait",
                      )}
                    >
                      {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      Approve
                    </button>
                    <button
                      disabled={isBusy}
                      onClick={() => handleReject(task)}
                      className={cn(
                        "flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors",
                        "bg-rose-500/10 text-rose-500 hover:bg-rose-500/20",
                        isBusy && "opacity-50 cursor-wait",
                      )}
                    >
                      <X className="w-3 h-3" />
                      Reject
                    </button>
                  </div>
                ) : (
                  <div className="text-[10px] text-on-surface-variant italic shrink-0 self-center px-2">
                    Awaiting<br />approver
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
