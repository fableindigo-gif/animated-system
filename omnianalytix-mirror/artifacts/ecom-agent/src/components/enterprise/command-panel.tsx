import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "wouter";
import { Settings, Plus, Terminal, CreditCard, TrendingUp, Star, BarChart3, Loader2, RefreshCw, DatabaseZap, Users, Layers, Trash2, AlertTriangle, MousePointerClick, Package, DollarSign, Activity } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LiveTriage } from "@/components/enterprise/live-triage";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/contexts/currency-context";
import { useDateRange } from "@/contexts/date-range-context";
import { useUserRole, ROLE_LABELS, ROLE_COLORS } from "@/contexts/user-role-context";
import { authFetch } from "@/lib/auth-fetch";
import { formatRelativeTime } from "@/lib/formatters";
import { MetricTooltip } from "@/components/help/metric-tooltip";
import { useToast } from "@/hooks/use-toast";
import { useDeleteGeminiConversation, getListGeminiConversationsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import type { GeminiConversation, PlatformConnection } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

interface WarehouseKpis {
  hasData: boolean;
  totalSpend: number;
  estimatedRevenue: number;
  trueProfit: number;
  inventoryValue: number;
  activeProducts: number;
  totalProducts: number;
  totalConversions: number;
  totalClicks: number;
  campaignCount: number;
  mappingCount: number;
  poas: number;
  roas: number;
  etlStatus: "idle" | "running" | "complete" | "error";
  etlPhase: string;
  etlPct: number;
  etlRowsExtracted?: number;
  lastSyncedAt: number | null;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

interface KPITile {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  pct?: number;
  delta?: string;
  deltaUp?: boolean;
  color: string;
  skeleton?: boolean;
  tooltip?: string;
}

function MetricTile({ label, value, sub, icon, pct, delta, deltaUp, color, skeleton, tooltip }: KPITile) {
  return (
    <div className="p-3 bg-surface-container-lowest rounded-2xl border border-outline-variant/10 hover:bg-surface-container-low hover:-translate-y-0.5 hover:shadow-md transition-all duration-200">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span style={{ color }} className="opacity-80">{icon}</span>
          <span className="text-[9px] font-semibold text-on-secondary-container uppercase tracking-widest">{label}</span>
          {tooltip && <MetricTooltip content={tooltip} />}
        </div>
        {delta && (
          <span className={cn(
            "text-[9px] font-bold px-1.5 py-0.5 rounded-full tabular-nums",
            deltaUp
              ? "text-emerald-700 bg-emerald-50"
              : "text-on-error-container bg-error-container"
          )}>
            {deltaUp ? "↑" : "↓"} {delta}
          </span>
        )}
      </div>
      {skeleton ? (
        <div className="h-[18px] w-16 bg-surface-container-highest rounded animate-pulse" />
      ) : (
        <div className="flex items-baseline gap-1.5">
          <span className="text-[18px] font-bold tabular-nums" style={{ color }}>{value}</span>
          <span className="text-[10px] text-on-secondary-container">{sub}</span>
        </div>
      )}
      {pct !== undefined && !skeleton && (
        <div className="mt-2">
          <div className="h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${pct}%`, background: color }}
            />
          </div>
          <p className="text-[9px] text-on-secondary-container mt-0.5 text-right">{pct}%</p>
        </div>
      )}
    </div>
  );
}

function EtlProgressBanner({ phase, pct, rowsExtracted }: { phase: string; pct: number; rowsExtracted?: number }) {
  return (
    <div className="mx-2.5 mb-2 px-3 py-2 rounded-2xl border border-accent-blue/20 bg-accent-blue/5 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <DatabaseZap className="w-3 h-3 text-accent-blue shrink-0 animate-pulse" />
        <span className="text-[9px] font-semibold text-accent-blue uppercase tracking-widest">
          Syncing warehouse
        </span>
        <span className="ml-auto text-[9px] font-medium text-on-secondary-container">{pct}%</span>
      </div>
      <div className="h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-accent-blue transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[9px] text-on-secondary-container truncate">{phase}</p>
      {(rowsExtracted ?? 0) > 0 && (
        <p className="text-[9px] text-accent-blue/60 font-medium">
          Extracted {rowsExtracted!.toLocaleString()} row{rowsExtracted !== 1 ? "s" : ""} so far…
        </p>
      )}
    </div>
  );
}

interface CommandPanelProps {
  connections: PlatformConnection[];
  conversations: GeminiConversation[];
  activeConvId: number | null;
  onSelectConv: (id: number | null) => void;
  onNewConv: () => void;
  onTriageAction?: (prompt: string) => void;
}

export function CommandPanel({
  connections,
  conversations,
  activeConvId,
  onSelectConv,
  onNewConv,
  onTriageAction,
}: CommandPanelProps) {
  // Warehouse KPIs (totalSpend / estimatedRevenue / trueProfit) are denominated
  // in USD by the warehouse pipeline. As of #61, `formatMoney` is FX-safe and
  // converts the USD value into the user's preferred display currency using
  // the live FX rate published by FxProvider, so we route everything through
  // it instead of the USD-only `formatUsd`.
  const { formatMoney: formatUsd, currencyCode } = useCurrency();
  const { dateRange, refreshKey } = useDateRange();
  const { currentUser } = useUserRole();
  const activeConnectionCount = (connections ?? []).filter((c: any) => c.isActive).length;
  const [kpis, setKpis] = useState<WarehouseKpis | null>(null);
  const [kpisError, setKpisError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchKpis = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const resp = await authFetch(`${API_BASE}api/warehouse/kpis?days=${dateRange.daysBack}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!resp.ok) { setKpisError(true); return; }
      const data = await resp.json() as WarehouseKpis;
      if (controller.signal.aborted) return;
      setKpis(data);
      setKpisError(false);
    } catch {
      if (controller.signal.aborted) return;
      setKpisError(true);
    }
  }, [dateRange.daysBack]);

  useEffect(() => {
    void fetchKpis();
    const id = setInterval(() => void fetchKpis(), 15_000);
    return () => { clearInterval(id); abortRef.current?.abort(); };
  }, [fetchKpis, refreshKey]);

  const isLoading = kpis === null && !kpisError;
  const etlRunning = kpis?.etlStatus === "running";
  const hasLiveData = kpis?.hasData && activeConnectionCount > 0;

  const emptySub = activeConnectionCount === 0 ? "no connections" : "awaiting sync";
  const emptyTiles: KPITile[] = [
    { label: "Ad Spend",      value: "—", sub: emptySub, icon: <CreditCard className="w-3.5 h-3.5" />, color: "#9ca3af", skeleton: isLoading },
    { label: "Est. Revenue",  value: "—", sub: emptySub, icon: <TrendingUp className="w-3.5 h-3.5" />, color: "#9ca3af", skeleton: isLoading },
    { label: "Blended ROAS",  value: "—", sub: emptySub, icon: <Activity className="w-3.5 h-3.5" />,   color: "#9ca3af", skeleton: isLoading },
    { label: "Blended POAS",  value: "—", sub: emptySub, icon: <Star className="w-3.5 h-3.5" />,       color: "#9ca3af", skeleton: isLoading, tooltip: "Profit on Ad Spend = True Profit ÷ Ad Spend. Measures actual profit per dollar spent after all costs are deducted." },
    { label: "Total Clicks",  value: "—", sub: emptySub, icon: <MousePointerClick className="w-3.5 h-3.5" />, color: "#9ca3af", skeleton: isLoading },
    { label: "Conversions",   value: "—", sub: emptySub, icon: <TrendingUp className="w-3.5 h-3.5" />, color: "#9ca3af", skeleton: isLoading },
    { label: "Active SKUs",   value: "—", sub: emptySub, icon: <BarChart3 className="w-3.5 h-3.5" />,  color: "#9ca3af", skeleton: isLoading },
    { label: "True Profit",   value: "—", sub: emptySub, icon: <DollarSign className="w-3.5 h-3.5" />, color: "#9ca3af", skeleton: isLoading, tooltip: "True Profit = Revenue − (Ad Spend + COGS + Fees). Strips out all variable costs to show your real net gain per period." },
  ];

  const tiles: KPITile[] = hasLiveData && kpis
    ? [
        {
          label: "Ad Spend",
          value: formatUsd(kpis.totalSpend, { compact: true }),
          sub: `${kpis.campaignCount} campaign${kpis.campaignCount === 1 ? "" : "s"}`,
          icon: <CreditCard className="w-3.5 h-3.5" />,
          color: "#0081FB",
        },
        {
          label: "Est. Revenue",
          value: formatUsd(kpis.estimatedRevenue, { compact: true }),
          sub: `${fmtNum(kpis.totalConversions)} conversions`,
          icon: <TrendingUp className="w-3.5 h-3.5" />,
          color: "#16a34a",
        },
        {
          label: "Blended ROAS",
          value: kpis.roas > 0 ? `${kpis.roas.toFixed(2)}x` : "—",
          sub: "revenue ÷ spend",
          icon: <Activity className="w-3.5 h-3.5" />,
          color: "#7c3aed",
        },
        {
          label: "Blended POAS",
          value: kpis.poas > 0 ? `${kpis.poas.toFixed(2)}x` : "—",
          sub: "profit ÷ ad spend",
          icon: <Star className="w-3.5 h-3.5" />,
          color: "#0081FB",
          tooltip: "Profit on Ad Spend = True Profit ÷ Ad Spend. Measures actual profit per dollar spent after all costs are deducted.",
        },
        {
          label: "Total Clicks",
          value: fmtNum(kpis.totalClicks),
          sub: `${kpis.campaignCount} campaign${kpis.campaignCount === 1 ? "" : "s"}`,
          icon: <MousePointerClick className="w-3.5 h-3.5" />,
          color: "#ea580c",
        },
        {
          label: "Conversions",
          value: fmtNum(kpis.totalConversions),
          sub: kpis.totalClicks > 0 ? `${((kpis.totalConversions / kpis.totalClicks) * 100).toFixed(1)}% CVR` : "—",
          icon: <TrendingUp className="w-3.5 h-3.5" />,
          color: "#16a34a",
        },
        {
          label: "Active SKUs",
          value: `${fmtNum(kpis.activeProducts)} / ${fmtNum(kpis.totalProducts)}`,
          sub: `${kpis.mappingCount} ad-linked`,
          icon: <BarChart3 className="w-3.5 h-3.5" />,
          color: "#16a34a",
        },
        {
          label: "True Profit",
          value: formatUsd(kpis.trueProfit ?? 0, { compact: true }),
          sub: "revenue − costs",
          icon: <DollarSign className="w-3.5 h-3.5" />,
          color: (kpis.trueProfit ?? 0) >= 0 ? "#16a34a" : "#dc2626",
          tooltip: "True Profit = Revenue − (Ad Spend + COGS + Fees). Strips out all variable costs to show your real net gain per period.",
        },
      ]
    : emptyTiles;

  return (
    <div className="w-full h-full bg-slate-50/80 flex flex-col">

      <div className="px-3 py-2.5 border-b border-outline-variant/15 flex items-center gap-2 shrink-0">
        {currentUser && (
          <Link href="/team">
            <span className={cn(
              "flex items-center gap-1 text-[8px] font-semibold px-1.5 py-0.5 rounded-full border cursor-pointer truncate max-w-[90px]",
              ROLE_COLORS[currentUser.role],
            )} title={`${currentUser.name} · ${ROLE_LABELS[currentUser.role]}`}>
              {currentUser.name.split(" ")[0]}
            </span>
          </Link>
        )}
        <div className="flex items-center gap-0.5 ml-auto">
          {kpis && (
            <button
              onClick={() => void fetchKpis()}
              className="p-1.5 rounded-2xl text-on-surface-variant hover:text-accent-blue hover:bg-surface transition-colors"
              title="Refresh KPIs"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          )}
          <Link href="/team">
            <button className="p-1.5 rounded-2xl text-on-surface-variant hover:text-on-surface-variant hover:bg-surface transition-colors" title="Team & Access">
              <Users className="w-3.5 h-3.5" />
            </button>
          </Link>
          <Link href="/forensic">
            <button className="p-1.5 rounded-2xl text-on-surface-variant hover:text-on-surface-variant hover:bg-surface transition-colors" title="Forensic Auditor">
              <Layers className="w-3.5 h-3.5" />
            </button>
          </Link>
          <Link href="/connections">
            <button className="p-1.5 rounded-2xl text-on-surface-variant hover:text-on-surface-variant hover:bg-surface transition-colors" title="Manage Connections">
              <Settings className="w-3.5 h-3.5" />
            </button>
          </Link>
        </div>
      </div>

      {etlRunning && kpis && (
        <div className="pt-2">
          <EtlProgressBanner phase={kpis.etlPhase} pct={kpis.etlPct} rowsExtracted={kpis.etlRowsExtracted} />
        </div>
      )}

      <div className="px-2.5 pt-3 pb-2.5 space-y-2 border-b border-outline-variant/15 shrink-0">
        <div className="flex items-center gap-1.5 px-1 mb-2">
          <p className="text-[9px] font-semibold text-on-secondary-container uppercase tracking-widest flex-1">Portfolio KPIs</p>
          {kpis?.lastSyncedAt && !etlRunning && (
            <span className="text-[8px] font-medium text-on-surface-variant">
              Synced {formatRelativeTime(kpis.lastSyncedAt)}
            </span>
          )}
          {/* Warehouse KPIs are USD-only until we ship FX conversion. We hard-
              code the chip to "USD" so users with a non-USD display preference
              don't see e.g. "INR" attached to numbers we're rendering as USD. */}
          <span
            className="text-[8px] font-semibold px-1 py-0.5 rounded bg-accent-blue/8 text-accent-blue"
            title={currencyCode !== "USD" ? `Warehouse data is in USD. Your display preference (${currencyCode}) will apply once FX conversion ships.` : undefined}
          >USD</span>
          {isLoading && <Loader2 className="w-2.5 h-2.5 text-on-surface-variant animate-spin" />}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {tiles.map((tile) => (
            <MetricTile key={tile.label} {...tile} />
          ))}
        </div>
      </div>

      <div className="shrink-0">
        <LiveTriage onAction={onTriageAction} />
      </div>

      <ConversationsList
        conversations={conversations}
        activeConvId={activeConvId}
        onSelectConv={onSelectConv}
        onNewConv={onNewConv}
      />

    </div>
  );
}

function ConversationsList({
  conversations,
  activeConvId,
  onSelectConv,
  onNewConv,
}: {
  conversations: GeminiConversation[];
  activeConvId: number | null;
  onSelectConv: (id: number | null) => void;
  onNewConv: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const deleteMutation = useDeleteGeminiConversation();
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  const handleDeleteSingle = (id: number) => {
    deleteMutation.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListGeminiConversationsQueryKey() });
          if (activeConvId === id) onSelectConv(null);
          setPendingDeleteId(null);
        },
        onError: (err) => {
          setPendingDeleteId(null);
          console.error("[CommandPanel] Failed to delete conversation:", err);
        },
      },
    );
  };

  const handleDeleteAll = async () => {
    setIsDeletingAll(true);
    try {
      const resp = await authFetch(`${API_BASE}api/gemini/conversations/all`, { method: "DELETE" });
      if (resp.ok) {
        const data = await resp.json().catch(() => ({})) as { deleted?: number };
        queryClient.invalidateQueries({ queryKey: getListGeminiConversationsQueryKey() });
        onSelectConv(null);
        toast({ title: "Execution Logs Cleared", description: `${data.deleted ?? "All"} log${(data.deleted ?? 0) !== 1 ? "s" : ""} deleted successfully.` });
      } else {
        const err = await resp.json().catch(() => ({})) as { error?: string };
        toast({ title: "Delete Failed", description: err.error ?? "Could not clear logs. Please try again.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network Error", description: "Could not reach the server. Please try again.", variant: "destructive" });
    } finally {
      setIsDeletingAll(false);
      setShowDeleteAll(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 px-2.5 py-2.5">
      <div className="flex items-center justify-between px-1 mb-2">
        <p className="text-[9px] font-semibold text-on-secondary-container uppercase tracking-widest">Execution Logs</p>
        {conversations.length > 0 && (
          <button
            onClick={() => setShowDeleteAll(true)}
            className="text-[9px] font-medium text-on-surface-variant hover:text-error transition-colors px-1.5 py-0.5 rounded hover:bg-error/5"
            title="Delete all logs"
            data-testid="button-clear-all-logs"
          >
            Clear All
          </button>
        )}
      </div>

      {showDeleteAll && (
        <div className="mx-0.5 mb-2 px-3 py-2.5 rounded-2xl border border-error/30 bg-error/5 space-y-2 shrink-0 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-error shrink-0" />
            <span className="text-[10px] font-semibold text-error">Delete all {conversations.length} log{conversations.length !== 1 ? "s" : ""}?</span>
          </div>
          <p className="text-[9px] text-on-surface-variant leading-relaxed">
            This will permanently remove all execution logs and their messages. This cannot be undone.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDeleteAll}
              disabled={isDeletingAll}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-xl text-[10px] font-semibold bg-error text-on-error hover:bg-error/90 transition-colors disabled:opacity-50"
              data-testid="button-confirm-delete-all"
            >
              {isDeletingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              {isDeletingAll ? "Deleting…" : "Delete All"}
            </button>
            <button
              onClick={() => setShowDeleteAll(false)}
              disabled={isDeletingAll}
              className="flex-1 px-2 py-1.5 rounded-xl text-[10px] font-semibold text-on-surface-variant bg-surface-container hover:bg-surface-container-high transition-colors disabled:opacity-50"
              data-testid="button-cancel-delete-all"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <button
        onClick={onNewConv}
        className="w-full flex items-center gap-2 px-3 py-2 mb-2 rounded-2xl text-left text-xs font-medium text-on-surface-variant border border-dashed border-outline-variant/40 hover:border-accent-blue/40 hover:bg-accent-blue/5 transition-all duration-150 shrink-0"
      >
        <Plus className="w-3.5 h-3.5 shrink-0 text-accent-blue" />
        <span>New Execution Log</span>
      </button>

      <ScrollArea className="flex-1">
        <div className="space-y-0.5 pr-1">
          {conversations.length === 0 && (
            <p className="text-xs text-on-surface-variant text-center py-4">No logs yet</p>
          )}
          {conversations.map((conv) => (
            <div key={conv.id} className="relative group">
              {pendingDeleteId === conv.id ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2.5 animate-in fade-in duration-150 space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    <span className="text-[11px] text-rose-700 font-semibold flex-1">Delete this log?</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDeleteSingle(conv.id)}
                      disabled={deleteMutation.isPending}
                      className="flex-1 py-1.5 rounded-xl text-[11px] font-bold bg-rose-600 text-white hover:bg-rose-700 transition-colors disabled:opacity-50"
                      data-testid={`button-confirm-delete-${conv.id}`}
                    >
                      {deleteMutation.isPending ? "Deleting…" : "Delete"}
                    </button>
                    <button
                      onClick={() => setPendingDeleteId(null)}
                      className="flex-1 py-1.5 rounded-xl text-[11px] font-bold text-rose-600 bg-white border border-rose-200 hover:bg-rose-50 transition-colors"
                      data-testid={`button-cancel-delete-${conv.id}`}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => onSelectConv(conv.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 rounded-2xl text-left transition-colors",
                    activeConvId === conv.id
                      ? "bg-accent-blue/10 text-accent-blue border border-accent-blue/20"
                      : "text-on-surface-variant hover:bg-surface hover:text-on-surface",
                  )}
                  data-testid={`link-conversation-${conv.id}`}
                >
                  <Terminal className="w-3 h-3 shrink-0 opacity-60" />
                  <span className="text-[11px] truncate flex-1 font-medium">{conv.title}</span>
                  <span
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDeleteId(conv.id);
                    }}
                    className="opacity-60 hover:opacity-100 p-1 rounded-lg hover:bg-error/10 hover:text-error transition-all shrink-0"
                    title="Delete log"
                    data-testid={`button-delete-conversation-${conv.id}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </span>
                </button>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
