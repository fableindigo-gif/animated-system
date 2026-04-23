import { useState, useRef, useEffect } from "react";
import {
  AlertTriangle, AlertCircle, Info, ChevronDown, ChevronUp, Zap, RefreshCw, ShieldCheck,
  Shield, BarChart3, Wallet, BrainCircuit, PackageX, Wifi, WifiOff, MoreHorizontal, Clock, CheckCircle2, EyeOff,
  ArrowRightLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { TagGatewayModal } from "./tag-gateway-modal";
import { TransferTaskModal } from "./transfer-task-modal";
import { useWorkspace } from "@/contexts/workspace-context";
import { useLiveTriageStream, type TriageAlert } from "@/hooks/use-live-triage-stream";
import { authFetch, authPatch } from "@/lib/auth-fetch";
import { useToast } from "@/hooks/use-toast";
import { formatTriageTimestamp } from "@/lib/formatters";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Severity = "critical" | "warning" | "info";
type AlertType = "Policy" | "Measurement" | "Budget" | "AI_Max" | "Inventory";
type TriageAction = "resolve" | "snooze" | "expected";

const TYPE_ICON: Record<AlertType, React.ReactNode> = {
  Policy: <Shield className="w-3 h-3 shrink-0 text-error-m3" />,
  Measurement: <BarChart3 className="w-3 h-3 shrink-0 text-primary-container" />,
  Budget: <Wallet className="w-3 h-3 shrink-0 text-amber-500" />,
  AI_Max: <BrainCircuit className="w-3 h-3 shrink-0 text-violet-500" />,
  Inventory: <PackageX className="w-3 h-3 shrink-0 text-orange-500" />,
};

const TYPE_BADGE: Record<AlertType, string> = {
  Policy: "bg-error-container border-error-m3/20 text-error-m3",
  Measurement: "bg-primary-container/10 border-primary-container/20 text-primary-container",
  Budget: "bg-amber-50 border-amber-200 text-amber-600",
  AI_Max: "bg-violet-50 border-violet-200 text-violet-600",
  Inventory: "bg-orange-50 border-orange-200 text-orange-600",
};

const SEV_CONFIG: Record<Severity, {
  icon: React.ReactNode;
  label: string;
  leftBorder: string;
  bg: string;
  text: string;
  badge: string;
  skeletonBg: string;
}> = {
  critical: {
    icon: <AlertTriangle className="w-3 h-3 shrink-0" />,
    label: "CRITICAL",
    leftBorder: "border-l-4 border-l-rose-500",
    bg: "bg-error-container/50",
    text: "text-error-m3",
    badge: "bg-error-container border border-error-m3/20 text-error-m3",
    skeletonBg: "bg-error-container",
  },
  warning: {
    icon: <AlertCircle className="w-3 h-3 shrink-0" />,
    label: "WARNING",
    leftBorder: "border-l-4 border-l-amber-500",
    bg: "bg-amber-50/50",
    text: "text-amber-600",
    badge: "bg-amber-50 border border-amber-200 text-amber-600",
    skeletonBg: "bg-amber-50",
  },
  info: {
    icon: <Info className="w-3 h-3 shrink-0" />,
    label: "INFO",
    leftBorder: "border-l-4 border-l-outline-variant",
    bg: "bg-surface",
    text: "text-on-surface-variant",
    badge: "bg-surface-container-low border border-outline-variant/15 text-on-surface-variant",
    skeletonBg: "bg-surface",
  },
};

const TRIAGE_ACTIONS: { id: TriageAction; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: "resolve", label: "Resolve", icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />, desc: "Mark as fixed" },
  { id: "snooze", label: "Snooze 7 Days", icon: <Clock className="w-3.5 h-3.5 text-amber-500" />, desc: "Revisit later" },
  { id: "expected", label: "Mark as Expected", icon: <EyeOff className="w-3.5 h-3.5 text-on-surface-variant" />, desc: "Known behavior" },
];

interface TriageAlertRowProps {
  alert: TriageAlert;
  onAction?: (prompt: string) => void;
  onTagGateway?: () => void;
  onTriageAction?: (alertId: string, action: TriageAction) => void;
  onEscalate?: (alert: TriageAlert) => void;
  escalating?: boolean;
}

function TriageAlertRow({ alert, onAction, onTagGateway, onTriageAction, onEscalate, escalating }: TriageAlertRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const cfg = SEV_CONFIG[alert.severity];
  const isTagGatewayAlert = alert.action === "Setup Tag Gateway" || alert.platform === "Tag Infrastructure";
  const typeIcon = alert.type ? TYPE_ICON[alert.type as AlertType] : null;
  const typeBadgeCls = alert.type ? TYPE_BADGE[alert.type as AlertType] : "";

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <div
      className={cn(
        "overflow-hidden transition-all rounded-2xl mx-1 my-1",
        "bg-surface-container-lowest",
        cfg.leftBorder,
      )}
    >
      <div className="flex items-center">
        <button
          className="flex-1 flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-surface transition-colors min-h-[44px]"
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="shrink-0">{typeIcon ?? <span className={cfg.text}>{cfg.icon}</span>}</span>
          <span className="flex-1 text-[11px] font-medium text-on-surface truncate leading-snug">{alert.title}</span>
          {alert.type && (
            <span className={cn("shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded-full border hidden sm:inline-flex", typeBadgeCls)}>
              {alert.type.replace("_", " ")}
            </span>
          )}
          <span className="shrink-0 text-[9px] text-on-surface-variant">{formatTriageTimestamp(alert.ts)}</span>
          {expanded
            ? <ChevronUp className="w-3 h-3 text-on-surface-variant shrink-0 ml-0.5" />
            : <ChevronDown className="w-3 h-3 text-on-surface-variant shrink-0 ml-0.5" />
          }
        </button>

        <div className="relative pr-2" ref={menuRef}>
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            className="p-2 rounded-2xl text-on-surface-variant hover:text-on-surface-variant hover:bg-surface-container-low transition-colors"
            aria-label="Alert actions"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>

          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                transition={{ duration: 0.12 }}
                className="absolute right-0 top-full mt-1 w-48 bg-white border border-outline-variant/15 rounded-2xl shadow-lg overflow-hidden z-50"
              >
                {TRIAGE_ACTIONS.map((ta) => (
                  <button
                    key={ta.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      onTriageAction?.(alert.id, ta.id);
                    }}
                    className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-surface transition-colors"
                  >
                    {ta.icon}
                    <div>
                      <p className="text-xs font-medium text-on-surface">{ta.label}</p>
                      <p className="text-[9px] text-on-surface-variant">{ta.desc}</p>
                    </div>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {expanded && (
        <div className="px-3.5 pb-3 space-y-2 border-t ghost-border pt-2">
          <p className="text-[11px] text-on-surface-variant leading-relaxed">{alert.detail}</p>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-medium text-on-surface-variant">{alert.platform}</span>
          </div>
          {alert.action && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-2xl", cfg.badge)}>
                {alert.action}
              </span>
              {isTagGatewayAlert && onTagGateway && (
                <button
                  onClick={(e) => { e.stopPropagation(); onTagGateway(); }}
                  className="flex items-center gap-1 text-[10px] font-bold ml-auto px-2.5 py-1 rounded-2xl bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20 transition-colors min-h-[44px]"
                >
                  <ShieldCheck className="w-2.5 h-2.5" /> Setup Tag Gateway
                </button>
              )}
              {!isTagGatewayAlert && onAction && (
                <button
                  onClick={(e) => { e.stopPropagation(); onAction(`${alert.action} — ${alert.title}`); }}
                  className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-2xl bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20 transition-colors min-h-[44px]"
                >
                  <Zap className="w-2.5 h-2.5" /> Ask Agent
                </button>
              )}
              {onEscalate && (
                <button
                  onClick={(e) => { e.stopPropagation(); if (!escalating) onEscalate(alert); }}
                  disabled={escalating}
                  className="flex items-center gap-1 text-[10px] font-bold ml-auto px-2.5 py-1 rounded-2xl bg-purple-50 text-purple-600 hover:bg-purple-100 transition-colors min-h-[44px] disabled:opacity-50 disabled:pointer-events-none"
                >
                  <ArrowRightLeft className="w-2.5 h-2.5" /> {escalating ? "Escalating…" : "Escalate"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface LiveTriageProps {
  onAction?: (prompt: string) => void;
}

export function LiveTriage({ onAction }: LiveTriageProps) {
  const { activeWorkspace } = useWorkspace();
  const { toast } = useToast();
  const [collapsed, setCollapsed] = useState(false);
  const [tagGatewayOpen, setTagGatewayOpen] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [escalatedTask, setEscalatedTask] = useState<{ id: number; title: string } | null>(null);
  const [escalating, setEscalating] = useState(false);

  const goal = activeWorkspace?.primaryGoal || "ecom";
  const { alerts, connected, status, initialLoaded, lastEvent, manualRefresh } = useLiveTriageStream(goal);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(tick);
  }, []);

  // Polite announcement of SSE connection-status changes for screen readers.
  // Kept in a separate live region from the alerts list so status flips don't
  // interleave with new-alert announcements.
  const [statusAnnouncement, setStatusAnnouncement] = useState("");
  const prevStatus = useRef<typeof status | null>(null);
  useEffect(() => {
    if (prevStatus.current === null) {
      prevStatus.current = status;
      return;
    }
    if (prevStatus.current !== status) {
      const msg =
        status === "live" ? "Live alerts connected"
        : status === "reconnecting" ? "Live alerts reconnecting"
        : "Live alerts offline";
      setStatusAnnouncement(msg);
      prevStatus.current = status;
    }
  }, [status]);

  const STALE_THRESHOLD_MS = 60_000;
  const isStale = connected && lastEvent !== null && (now - lastEvent) > STALE_THRESHOLD_MS;

  const handleRefresh = async () => {
    setRefreshing(true);
    await manualRefresh();
    setDismissedIds(new Set());
    setRefreshing(false);
  };

  const handleTriageAction = async (alertId: string, action: TriageAction) => {
    setDismissedIds((prev) => new Set(prev).add(alertId));
    const numericId = parseInt(alertId.replace(/\D/g, ""), 10);
    if (!isNaN(numericId)) {
      try {
        const res = await authPatch(`${BASE}/api/live-triage/${numericId}/action`, { action });
        if (!res.ok) {
          setDismissedIds((prev) => { const next = new Set(prev); next.delete(alertId); return next; });
          toast({ title: "Action Failed", description: "Could not update this alert. It has been restored.", variant: "destructive" });
        }
      } catch {
        setDismissedIds((prev) => { const next = new Set(prev); next.delete(alertId); return next; });
        toast({ title: "Network Error", description: "Could not reach the server. Alert restored.", variant: "destructive" });
      }
    }
  };

  const handleEscalate = async (alert: TriageAlert) => {
    if (escalating) return;
    setEscalating(true);
    try {
      const res = await authFetch(`${BASE}/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: alert.platform?.toLowerCase().replace(/\s+/g, "_") || "system",
          platformLabel: alert.platform || "System",
          toolName: "escalated_alert",
          toolDisplayName: `Escalated: ${alert.title}`,
          toolArgs: { alertId: alert.id, severity: alert.severity },
          reasoning: alert.detail,
          comments: `Auto-escalated from Live Triage (${alert.severity})`,
        }),
      });
      if (res.ok) {
        const task = await res.json() as { id: number; toolDisplayName: string };
        toast({ title: "Alert Escalated", description: "A task has been created. You can now transfer it to a team member." });
        setEscalatedTask({ id: task.id, title: task.toolDisplayName });
      } else {
        toast({ title: "Error", description: "Could not escalate this alert.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Network error.", variant: "destructive" });
    } finally { setEscalating(false); }
  };

  const visibleAlerts = alerts.filter((a) => !dismissedIds.has(a.id));
  const criticalCount = visibleAlerts.filter((a) => a.severity === "critical").length;
  const warningCount  = visibleAlerts.filter((a) => a.severity === "warning").length;

  return (
    <div className="mx-2 my-2.5 overflow-hidden border border-outline-variant/20 bg-surface-container-lowest rounded-2xl">
      {/* Polite live region for SSE connection-status changes (separate from
          the alerts log so status flips don't interleave with new alerts). */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {statusAnnouncement}
      </div>
      <div className="flex items-center gap-2 px-3.5 py-2 border-b ghost-border">
        <button
          className="flex-1 flex items-center gap-2 text-left min-h-[44px]"
          onClick={() => setCollapsed((v) => !v)}
        >
          <AlertTriangle className="w-3 h-3 text-error-m3 shrink-0" />
          <span className="text-[9px] font-bold text-error-m3 uppercase tracking-widest">Live Triage</span>

          {status === "live" ? (
            <span
              className="shrink-0 inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200"
              aria-label="Live alerts connected"
            >
              <Wifi className="w-2.5 h-2.5" /> Live
            </span>
          ) : status === "reconnecting" ? (
            <span
              className="shrink-0 inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200"
              aria-label="Live alerts reconnecting"
            >
              <RefreshCw className="w-2.5 h-2.5 animate-spin" /> Reconnecting…
            </span>
          ) : (
            <span
              className="shrink-0 inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-error-container text-error-m3 border border-error-m3/20"
              aria-label="Live alerts offline"
            >
              <WifiOff className="w-2.5 h-2.5" /> Offline
            </span>
          )}

          {!refreshing && !collapsed && criticalCount > 0 && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-error-container text-error-m3">
              {criticalCount} CRIT
            </span>
          )}
          {!refreshing && !collapsed && warningCount > 0 && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600">
              {warningCount} WARN
            </span>
          )}
          {!initialLoaded && (
            <span className="text-[9px] text-on-surface-variant animate-pulse">scanning…</span>
          )}
          {initialLoaded && visibleAlerts.length === 0 && (
            <span className="text-[9px] font-medium text-emerald-600">All clear</span>
          )}

          <span className="ml-auto text-[9px] text-on-surface-variant">
            {initialLoaded && visibleAlerts.length > 0 ? `${visibleAlerts.length} alert${visibleAlerts.length !== 1 ? "s" : ""}` : ""}
          </span>
          {collapsed
            ? <ChevronDown className="w-3 h-3 text-on-surface-variant shrink-0" />
            : <ChevronUp className="w-3 h-3 text-on-surface-variant shrink-0" />
          }
        </button>

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh alerts"
          className="shrink-0 p-1 rounded-2xl text-on-surface-variant hover:text-on-surface hover:bg-surface transition-colors disabled:opacity-40 min-w-[44px] min-h-[44px] flex items-center justify-center"
        >
          <RefreshCw className={cn("w-3 h-3", refreshing && "animate-spin")} />
        </button>
      </div>

      {status === "offline" && (
        <div className="flex items-center gap-2 px-3.5 py-2 bg-error-container/40 border-b border-error-m3/15">
          <WifiOff className="w-3 h-3 text-error-m3 shrink-0" />
          <p className="flex-1 text-[10px] text-error-m3 leading-snug">
            Can't reach the live alerts service. We'll keep trying in the background.
          </p>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-2xl bg-white text-error-m3 border border-error-m3/30 hover:bg-error-container transition-colors disabled:opacity-50 min-h-[32px]"
          >
            <RefreshCw className={cn("w-2.5 h-2.5", refreshing && "animate-spin")} />
            Refresh now
          </button>
        </div>
      )}

      {!collapsed && (
        <div
          className="divide-y divide-[rgba(200,197,203,0.08)]"
          role="log"
          aria-live="polite"
          aria-atomic="false"
          aria-relevant="additions"
          aria-label="Live triage alerts"
        >
          {!initialLoaded ? (
            <div className="p-2 space-y-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-8 rounded-2xl bg-surface-container-low animate-pulse" />
              ))}
            </div>
          ) : visibleAlerts.length === 0 ? (
            <div className="py-5 text-center">
              <p className="text-[11px] text-on-surface-variant">All systems healthy — no active alerts</p>
            </div>
          ) : (
            <>
              <AnimatePresence mode="popLayout" initial>
                {visibleAlerts.map((alert, idx) => (
                  <motion.div
                    key={alert.id}
                    layout
                    initial={{ opacity: 0, y: -8, height: "auto" }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0 }}
                    transition={{
                      opacity: { duration: 0.2, delay: idx * 0.04, ease: [0.4, 0, 0.2, 1] },
                      y:       { duration: 0.22, delay: idx * 0.04, ease: [0.05, 0.7, 0.1, 1.0] },
                      height:  { duration: 0.25, ease: "easeInOut" },
                    }}
                    style={{ willChange: "transform, opacity" }}
                  >
                    <TriageAlertRow
                      alert={alert}
                      onAction={onAction}
                      onTagGateway={() => setTagGatewayOpen(true)}
                      onTriageAction={handleTriageAction}
                      onEscalate={handleEscalate}
                      escalating={escalating}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
              <p className="text-[9px] text-on-surface-variant text-right px-3 py-1.5 flex items-center justify-end gap-1.5">
                <span className={cn(
                  "inline-block w-1.5 h-1.5 rounded-full",
                  status === "offline" ? "bg-rose-400 animate-pulse"
                    : status === "reconnecting" ? "bg-amber-400 animate-pulse"
                    : isStale ? "bg-amber-400"
                    : "bg-emerald-500",
                )} />
                {status === "offline" ? "Offline · Retrying in background"
                  : status === "reconnecting" ? "Reconnecting…"
                  : isStale ? "Data Feed · Reconnecting"
                  : "Live Data Feed"}
              </p>
            </>
          )}
        </div>
      )}

      <TagGatewayModal open={tagGatewayOpen} onClose={() => setTagGatewayOpen(false)} />

      {escalatedTask && (
        <TransferTaskModal
          open={!!escalatedTask}
          onClose={() => setEscalatedTask(null)}
          taskId={escalatedTask.id}
          taskTitle={escalatedTask.title}
          onTransferred={() => {
            toast({ title: "Task Transferred", description: "The escalated alert has been assigned to a team member." });
            setEscalatedTask(null);
          }}
        />
      )}
    </div>
  );
}
