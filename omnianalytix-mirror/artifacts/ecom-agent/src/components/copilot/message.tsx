import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLocation } from "wouter";
import {
  ArrowRight, BarChart3, RefreshCw, AlertTriangle, Loader2, Check,
  ChevronDown, ChevronRight, Wrench, Activity, List,
  Megaphone, Package, Bell,
} from "lucide-react";
import { ResponsiveContainer, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Bar, Cell, LineChart, Line } from "recharts";
import { formatUsdInDisplay } from "@/lib/fx-format";
import { cn } from "@/lib/utils";
import { authPost, authFetch } from "@/lib/auth-fetch";
import { useToast } from "@/hooks/use-toast";
import { CampaignComparisonCard } from "@/components/shared/CampaignComparisonCard";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ActionType =
  | "NAVIGATE"
  | "GENERATE_REPORT"
  | "TRIGGER_SYNC"
  | "PAUSE_CAMPAIGN";

export interface SuggestedAction {
  label:       string;
  action_type: ActionType;
  payload:     Record<string, unknown>;
}

export interface ToolCall {
  tool:   string;
  args:   Record<string, unknown>;
  result: unknown;
}

export interface CopilotMessageProps {
  role:             "user" | "assistant";
  content:          string;
  suggested_actions?: SuggestedAction[];
  toolCalls?:       ToolCall[];
  isGreeting?:      boolean;
}

// ─── Action icon map ───────────────────────────────────────────────────────────

function ActionIcon({ type }: { type: ActionType }) {
  switch (type) {
    case "NAVIGATE":        return <ArrowRight className="w-3.5 h-3.5" />;
    case "GENERATE_REPORT": return <BarChart3   className="w-3.5 h-3.5" />;
    case "TRIGGER_SYNC":    return <RefreshCw   className="w-3.5 h-3.5" />;
    case "PAUSE_CAMPAIGN":  return <AlertTriangle className="w-3.5 h-3.5" />;
    default:                return <ArrowRight className="w-3.5 h-3.5" />;
  }
}

// ─── Action colour map ─────────────────────────────────────────────────────────

function actionStyle(type: ActionType): { bg: string; text: string; border: string; hover: string } {
  switch (type) {
    case "NAVIGATE":
      return { bg: "rgba(26,115,232,0.1)", text: "#1a73e8", border: "rgba(26,115,232,0.25)", hover: "rgba(26,115,232,0.18)" };
    case "GENERATE_REPORT":
      return { bg: "rgba(52,168,83,0.1)",  text: "#34a853", border: "rgba(52,168,83,0.25)",  hover: "rgba(52,168,83,0.18)"  };
    case "TRIGGER_SYNC":
      return { bg: "rgba(79,195,247,0.1)", text: "#0288d1", border: "rgba(79,195,247,0.3)",  hover: "rgba(79,195,247,0.18)" };
    case "PAUSE_CAMPAIGN":
      return { bg: "rgba(234,67,53,0.08)", text: "#ea4335", border: "rgba(234,67,53,0.2)",   hover: "rgba(234,67,53,0.14)"  };
    default:
      return { bg: "rgba(26,115,232,0.1)", text: "#1a73e8", border: "rgba(26,115,232,0.25)", hover: "rgba(26,115,232,0.18)" };
  }
}

// ─── Action button ─────────────────────────────────────────────────────────────

function ActionButton({
  action,
  onNavigate,
}: {
  action:     SuggestedAction;
  onNavigate: (route: string) => void;
}) {
  const { toast }            = useToast();
  const [state, setState]    = useState<"idle" | "loading" | "done" | "error">("idle");
  const style                = actionStyle(action.action_type);

  async function handleClick() {
    if (state === "loading" || state === "done") return;

    switch (action.action_type) {
      case "NAVIGATE": {
        const route = String(action.payload.route ?? "/");
        onNavigate(route);
        setState("done");
        setTimeout(() => setState("idle"), 2000);
        return;
      }

      case "GENERATE_REPORT": {
        setState("loading");
        try {
          const res = await authPost("/api/looker/generate", {
            workspaceId: action.payload.workspaceId,
            reportType:  action.payload.reportType  ?? "revenue",
            dateRange:   action.payload.dateRange   ?? "last_30_days",
          });
          if (!res.ok) throw new Error("report generation failed");
          setState("done");
          toast({ title: "Report queued", description: "Your report is being generated and will appear in the Reports section." });
        } catch {
          setState("error");
          toast({ title: "Report failed", description: "Could not generate the report. Please try again.", variant: "destructive" });
        } finally {
          setTimeout(() => setState("idle"), 3000);
        }
        return;
      }

      case "TRIGGER_SYNC": {
        setState("loading");
        try {
          const platform = String(action.payload.platform ?? "");
          const res       = await authPost("/api/etl/sync", { platform });
          if (!res.ok) throw new Error("sync failed");
          setState("done");
          toast({ title: "Sync started", description: `${platform} data will refresh within 5–10 minutes.` });
        } catch {
          setState("error");
          toast({ title: "Sync failed", description: "Could not trigger the sync. Please check the platform connection.", variant: "destructive" });
        } finally {
          setTimeout(() => setState("idle"), 3000);
        }
        return;
      }

      case "PAUSE_CAMPAIGN": {
        setState("loading");
        try {
          const res = await authPost("/api/tasks", {
            action_type:  "propose_campaign_fix",
            campaignId:   action.payload.campaignId,
            action:       "pause",
            rationale:    action.payload.rationale ?? "OmniCopilot flagged this campaign for review.",
            requiresDualAuth: true,
          });
          if (!res.ok) throw new Error("task creation failed");
          setState("done");
          toast({
            title:       "Proposal sent for approval",
            description: "The campaign fix proposal has been submitted to the approval queue.",
          });
        } catch {
          setState("error");
          toast({ title: "Proposal failed", description: "Could not submit the campaign fix. Please try again.", variant: "destructive" });
        } finally {
          setTimeout(() => setState("idle"), 3000);
        }
        return;
      }
    }
  }

  const isLoading = state === "loading";
  const isDone    = state === "done";
  const isError   = state === "error";

  return (
    <button
      onClick={handleClick}
      disabled={isLoading || isDone}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
        "border focus:outline-none focus-visible:ring-2",
        (isLoading || isDone) && "opacity-70 cursor-not-allowed",
      )}
      style={{
        background:   isError ? "rgba(234,67,53,0.1)"  : style.bg,
        color:        isError ? "#ea4335"               : style.text,
        borderColor:  isError ? "rgba(234,67,53,0.25)" : style.border,
      }}
      onMouseEnter={(e) => {
        if (!isLoading && !isDone)
          (e.currentTarget as HTMLElement).style.background = style.hover;
      }}
      onMouseLeave={(e) => {
        if (!isLoading && !isDone)
          (e.currentTarget as HTMLElement).style.background = style.bg;
      }}
    >
      {isLoading ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : isDone ? (
        <Check className="w-3 h-3" />
      ) : isError ? (
        <AlertTriangle className="w-3 h-3" />
      ) : (
        <ActionIcon type={action.action_type} />
      )}
      {isLoading ? "Working…" : isDone ? "Done" : isError ? "Error — retry" : action.label}
    </button>
  );
}

// ─── Tool call icon ────────────────────────────────────────────────────────────

function ToolIcon({ toolName }: { toolName: string }) {
  if (toolName === "get_system_health")          return <Activity   className="w-3 h-3" />;
  if (toolName === "list_platform_capabilities") return <List       className="w-3 h-3" />;
  if (toolName === "list_top_campaigns")         return <Megaphone  className="w-3 h-3" />;
  if (toolName === "list_low_stock_skus")        return <Package    className="w-3 h-3" />;
  if (toolName === "list_active_anomalies")      return <Bell       className="w-3 h-3" />;
  return <Wrench className="w-3 h-3" />;
}

// ─── Severity badge for anomalies ──────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, { bg: string; color: string; dot: string }> = {
    critical: { bg: "rgba(234,67,53,0.12)", color: "#ea4335", dot: "#ea4335" },
    warning:  { bg: "rgba(251,188,5,0.14)", color: "#b3860b", dot: "#fbbc05" },
    info:     { bg: "rgba(26,115,232,0.1)", color: "#1a73e8", dot: "#1a73e8" },
  };
  const s = map[severity] ?? map.info;
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide"
      style={{ background: s.bg, color: s.color, fontSize: "9px" }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }} />
      {severity}
    </span>
  );
}

function formatNumber(value: unknown, opts: { currency?: string; decimals?: number } = {}): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const decimals = opts.decimals ?? (Math.abs(n) >= 100 ? 0 : 2);
  const formatted = n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return opts.currency ? `${opts.currency} ${formatted}` : formatted;
}

// ─── Tool call card ────────────────────────────────────────────────────────────

function ToolCallCard({ call }: { call: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  const label = call.tool
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  function renderResult() {
    if (call.result === null || call.result === undefined) return null;

    if (typeof call.result === "object") {
      const obj = call.result as Record<string, unknown>;

      if (call.tool === "get_system_health") {
        return (
          <div className="space-y-1.5 text-[11px]">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold"
                style={{
                  background: obj.status === "operational" ? "rgba(52,168,83,0.12)" : "rgba(234,67,53,0.1)",
                  color:      obj.status === "operational" ? "#34a853"               : "#ea4335",
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: obj.status === "operational" ? "#34a853" : "#ea4335" }}
                />
                {String(obj.status ?? "unknown")}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {obj.totalChecks !== undefined && (
                <div className="bg-slate-50 rounded px-2 py-1">
                  <p className="text-slate-400 uppercase tracking-wide" style={{ fontSize: "9px" }}>Total checks</p>
                  <p className="font-semibold text-slate-700">{String(obj.totalChecks)}</p>
                </div>
              )}
              {obj.passingChecks !== undefined && (
                <div className="bg-slate-50 rounded px-2 py-1">
                  <p className="text-slate-400 uppercase tracking-wide" style={{ fontSize: "9px" }}>Passing</p>
                  <p className="font-semibold text-emerald-600">{String(obj.passingChecks)}</p>
                </div>
              )}
            </div>
            {Array.isArray(obj.failingChecks) && obj.failingChecks.length > 0 && (
              <div className="rounded-md border border-red-100 bg-red-50 px-2 py-1.5">
                <p className="text-red-600 font-semibold mb-0.5">Failing checks</p>
                <ul className="text-red-500 space-y-0.5">
                  {(obj.failingChecks as string[]).map((c, i) => (
                    <li key={i} className="flex items-start gap-1">
                      <span className="mt-0.5">•</span> {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {obj.lastRunAt != null && (
              <p className="text-slate-400" style={{ fontSize: "10px" }}>
                Last run: {new Date(String(obj.lastRunAt as string | number)).toLocaleString()}
              </p>
            )}
          </div>
        );
      }

      if (call.tool === "list_top_campaigns") {
        const campaigns = Array.isArray(obj.campaigns) ? (obj.campaigns as Array<Record<string, unknown>>) : [];
        const days = Number(obj.windowDays) || 30;
        if (campaigns.length === 0) {
          return (
            <p className="text-[11px] text-slate-500">
              No campaign activity in the last {days} day{days === 1 ? "" : "s"}.
            </p>
          );
        }
        return (
          <div className="space-y-1.5 text-[11px]">
            <p className="text-slate-400" style={{ fontSize: "10px" }}>
              Top {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"} by spend · last {days}d
            </p>
            <div className="overflow-x-auto rounded-md border border-blue-100">
              <table className="min-w-full text-[10.5px] border-collapse">
                <thead className="bg-blue-50/60">
                  <tr>
                    <th className="px-2 py-1 text-left font-semibold text-[#004ac6] border-b border-blue-100">Campaign</th>
                    <th className="px-2 py-1 text-right font-semibold text-[#004ac6] border-b border-blue-100">Spend</th>
                    <th className="px-2 py-1 text-right font-semibold text-[#004ac6] border-b border-blue-100">Conv.</th>
                    <th className="px-2 py-1 text-right font-semibold text-[#004ac6] border-b border-blue-100">ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c, i) => {
                    const roas = c.roas == null ? "—" : `${formatNumber(c.roas, { decimals: 2 })}x`;
                    const roasColor =
                      typeof c.roas === "number" && c.roas < 1 ? "#ea4335"
                      : typeof c.roas === "number" && c.roas >= 3 ? "#34a853"
                      : "#475569";
                    return (
                      <tr key={i} className="border-b border-blue-50 last:border-b-0">
                        <td className="px-2 py-1 text-slate-700 align-top max-w-[180px] truncate" title={String(c.campaignName ?? "")}>
                          {String(c.campaignName ?? "(unnamed)")}
                        </td>
                        <td className="px-2 py-1 text-right text-slate-700 tabular-nums">
                          {formatNumber(c.spend, { currency: String(c.currency ?? "USD") })}
                        </td>
                        <td className="px-2 py-1 text-right text-slate-700 tabular-nums">
                          {formatNumber(c.conversions, { decimals: 1 })}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums font-semibold" style={{ color: roasColor }}>
                          {roas}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      }

      if (call.tool === "list_low_stock_skus") {
        const skus = Array.isArray(obj.skus) ? (obj.skus as Array<Record<string, unknown>>) : [];
        const threshold = Number(obj.threshold ?? 5);
        const outOfStock = Number(obj.outOfStock ?? 0);
        if (skus.length === 0) {
          return (
            <p className="text-[11px] text-slate-500">
              No SKUs at or below {threshold} units. Inventory looks healthy.
            </p>
          );
        }
        return (
          <div className="space-y-1.5 text-[11px]">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-slate-400" style={{ fontSize: "10px" }}>
                {skus.length} SKU{skus.length === 1 ? "" : "s"} ≤ {threshold} units
              </p>
              {outOfStock > 0 && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-semibold"
                  style={{ background: "rgba(234,67,53,0.1)", color: "#ea4335", fontSize: "9px" }}
                >
                  {outOfStock} out of stock
                </span>
              )}
            </div>
            <div className="overflow-x-auto rounded-md border border-blue-100">
              <table className="min-w-full text-[10.5px] border-collapse">
                <thead className="bg-blue-50/60">
                  <tr>
                    <th className="px-2 py-1 text-left font-semibold text-[#004ac6] border-b border-blue-100">SKU</th>
                    <th className="px-2 py-1 text-left font-semibold text-[#004ac6] border-b border-blue-100">Title</th>
                    <th className="px-2 py-1 text-right font-semibold text-[#004ac6] border-b border-blue-100">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {skus.map((s, i) => {
                    const qty = Number(s.inventoryQty ?? 0);
                    const qtyColor = qty <= 0 ? "#ea4335" : qty <= 2 ? "#b3860b" : "#475569";
                    return (
                      <tr key={i} className="border-b border-blue-50 last:border-b-0">
                        <td className="px-2 py-1 text-slate-700 align-top font-mono text-[10px]">
                          {String(s.sku ?? "—")}
                        </td>
                        <td className="px-2 py-1 text-slate-700 align-top max-w-[160px] truncate" title={String(s.title ?? "")}>
                          {String(s.title ?? "(untitled)")}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums font-semibold" style={{ color: qtyColor }}>
                          {qty}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      }

      if (call.tool === "list_active_anomalies") {
        const alerts = Array.isArray(obj.alerts) ? (obj.alerts as Array<Record<string, unknown>>) : [];
        const counts = (obj.counts as Record<string, unknown>) ?? {};
        if (alerts.length === 0) {
          return (
            <p className="text-[11px] text-slate-500">
              No active anomalies — your accounts are clear.
            </p>
          );
        }
        return (
          <div className="space-y-1.5 text-[11px]">
            <div className="flex items-center gap-1.5 flex-wrap">
              {Number(counts.critical) > 0 && <SeverityBadge severity="critical" />}
              {Number(counts.warning)  > 0 && <SeverityBadge severity="warning" />}
              {Number(counts.info)     > 0 && <SeverityBadge severity="info" />}
              <span className="text-slate-400" style={{ fontSize: "10px" }}>
                {alerts.length} active
              </span>
            </div>
            <ul className="space-y-1">
              {alerts.slice(0, 6).map((a, i) => (
                <li
                  key={i}
                  className="rounded-md border px-2 py-1.5"
                  style={{ borderColor: "rgba(0,74,198,0.1)", background: "white" }}
                >
                  <div className="flex items-start gap-1.5 mb-0.5">
                    <SeverityBadge severity={String(a.severity ?? "info")} />
                    <span className="text-slate-400" style={{ fontSize: "9.5px" }}>
                      {String(a.type ?? "")}
                      {a.platform ? ` · ${String(a.platform)}` : ""}
                    </span>
                  </div>
                  <p className="font-semibold text-slate-700 leading-tight">{String(a.title ?? "")}</p>
                  {a.message ? (
                    <p className="text-slate-500 mt-0.5 leading-snug">{String(a.message)}</p>
                  ) : null}
                </li>
              ))}
            </ul>
            {alerts.length > 6 && (
              <p className="text-slate-400 text-center" style={{ fontSize: "10px" }}>
                + {alerts.length - 6} more
              </p>
            )}
          </div>
        );
      }

      if (call.tool === "list_platform_capabilities") {
        const caps = Array.isArray(obj.capabilities) ? (obj.capabilities as string[]) : [];
        return (
          <div className="space-y-1 text-[11px]">
            {caps.map((cap, i) => (
              <div key={i} className="flex items-start gap-1.5 text-slate-600">
                <span className="mt-0.5 text-blue-400">•</span> {cap}
              </div>
            ))}
          </div>
        );
      }

      if (call.tool === "get_campaign_performance" && obj.mode === "comparison") {
        return (
          <CampaignComparisonCard payload={obj as import("@/components/shared/CampaignComparisonCard").ComparisonPayload} />
        );
      }

      return (
        <pre className="text-[10px] text-slate-600 bg-slate-50 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(call.result, null, 2)}
        </pre>
      );
    }

    return <p className="text-[11px] text-slate-600">{String(call.result)}</p>;
  }

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ border: "1px solid rgba(0, 74, 198, 0.12)", background: "rgba(241,245,254,0.6)" }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-blue-50/50"
      >
        <span
          className="shrink-0 w-5 h-5 rounded flex items-center justify-center"
          style={{ background: "rgba(0,74,198,0.1)", color: "#004ac6" }}
        >
          <ToolIcon toolName={call.tool} />
        </span>
        <span className="flex-1 text-[11px] font-semibold text-slate-700">{label}</span>
        {expanded
          ? <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
          : <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />}
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-blue-50">
          {renderResult()}
        </div>
      )}
    </div>
  );
}

// ─── Main message component ────────────────────────────────────────────────────

export function CopilotMessage({ role, content, suggested_actions = [], toolCalls = [], isGreeting }: CopilotMessageProps) {
  const [, navigate] = useLocation();

  const isUser = role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-tr-sm text-[13px] leading-relaxed text-white"
          style={{ background: "#004ac6" }}
        >
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* ── Tool call cards (shown above the response) ──────────────────── */}
      {toolCalls.length > 0 && (
        <div className="pl-8 flex flex-col gap-1.5">
          {toolCalls.map((tc, i) => (
            <ToolCallCard key={i} call={tc} />
          ))}
        </div>
      )}

      {/* ── Assistant bubble ───────────────────────────────────────────── */}
      <div className="flex items-start gap-2">
        {/* Avatar */}
        <div
          className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5"
          style={{ background: "linear-gradient(160deg, #0d1117 0%, #141e33 100%)" }}
        >
          <span className="material-symbols-outlined text-white" style={{ fontSize: "12px", fontVariationSettings: "'FILL' 1" }}>
            smart_toy
          </span>
        </div>

        {/* Content bubble */}
        <div
          className="flex-1 min-w-0 px-3.5 py-2.5 rounded-2xl rounded-tl-sm text-[13px] leading-relaxed"
          style={{ background: "#f1f5fe", color: "#1e293b" }}
        >
          <div
            className={cn(
              "prose prose-sm max-w-none",
              "[&_p]:my-0.5 [&_ul]:my-1 [&_li]:my-0 [&_strong]:text-[#004ac6]",
              "[&_code]:bg-blue-50 [&_code]:text-blue-700 [&_code]:px-1 [&_code]:rounded",
              isGreeting && "text-[12px]",
            )}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                table: (props) => (
                  <div className="my-2 overflow-x-auto rounded-md border border-blue-100">
                    <table {...props} className="min-w-full text-[11px] border-collapse" />
                  </div>
                ),
                thead: (props) => <thead {...props} className="bg-blue-50/60" />,
                th: (props) => <th {...props} className="px-2 py-1.5 text-left font-semibold text-[#004ac6] border-b border-blue-100 whitespace-nowrap" />,
                td: (props) => <td {...props} className="px-2 py-1.5 text-slate-700 border-b border-blue-50 align-top" />,
              }}
            >{content}</ReactMarkdown>
          </div>
        </div>
      </div>

      {/* ── Action buttons ──────────────────────────────────────────────── */}
      {suggested_actions.length > 0 && (
        <div className="flex flex-wrap gap-2 pl-8">
          {suggested_actions.map((action, i) => (
            <ActionButton
              key={i}
              action={action}
              onNavigate={(route) => navigate(route)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
