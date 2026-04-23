import { Suspense, useEffect } from "react";
import { useDashboardStore } from "@/store/dashboardStore";
import { useWorkspace } from "@/contexts/workspace-context";
import { COUNTRY_LOCALE } from "@/lib/localization/country-currency";
import { DashboardFilterProvider } from "@/context/DashboardFilterContext";
import { WidgetRegistry } from "@/registry/WidgetRegistry";
import SkeletonLoader from "@/components/dashboard/widgets/SkeletonLoader";
import PerformanceAILogs from "@/components/dashboard/PerformanceAILogs";
import { PerformanceGrid } from "@/components/dashboard/performance-grid";
import ApprovalQueue from "@/components/widgets/shared/ApprovalQueue";
import { useAgentExecution } from "@/hooks/useAgentExecution";
import { AlertCircle, RefreshCw, Plug, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

// Locale-aware formatter for the "Last sync" timestamp.
// Locale resolution order: explicit override → workspace HQ country →
// browser navigator → "en".
function formatLastSync(ms: number, locale: string): string {
  try {
    const d = new Date(ms);
    const date = new Intl.DateTimeFormat(locale, {
      day: "2-digit", month: "2-digit", year: "numeric",
    }).format(d);
    const time = new Intl.DateTimeFormat(locale, {
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(d);
    return `${date} ${time}`;
  } catch {
    return new Date(ms).toISOString();
  }
}

function StateBanner() {
  const syncState     = useDashboardStore((s) => s.syncState);
  const lastSyncedAt  = useDashboardStore((s) => s.lastSyncedAt);
  const isStale       = useDashboardStore((s) => s.isStale());
  const etlPhase      = useDashboardStore((s) => s.meta.etlPhase);
  const etlPct        = useDashboardStore((s) => s.meta.etlPct);
  const { activeWorkspace } = useWorkspace();
  const hqCountry = (activeWorkspace as Record<string, unknown> | null)?.headquartersCountry as string | undefined;
  const workspaceLocale = hqCountry ? COUNTRY_LOCALE[hqCountry] : undefined;
  const navigatorLocale = typeof navigator !== "undefined" ? navigator.language : undefined;
  const locale = workspaceLocale ?? navigatorLocale ?? "en";

  if (syncState === "OPERATIONAL_POPULATED" && !isStale) return null;

  const config: Record<string, { icon: React.ReactNode; tone: string; title: string; body: string }> = {
    AWAITING_OAUTH: {
      icon: <Plug className="w-4 h-4" />,
      tone: "border-accent-blue/30 bg-accent-blue/10 text-accent-blue",
      title: "Connect a platform to begin",
      body: "Link Google Ads, Shopify, or your CRM from the Connections page to start populating the warehouse.",
    },
    HISTORICAL_BACKFILL: {
      icon: <RefreshCw className="w-4 h-4 animate-spin" />,
      tone: "border-accent-blue/30 bg-accent-blue/10 text-accent-blue",
      title: "Initial backfill in progress",
      body: `Pulling 90 days of history — phase: ${etlPhase} · ${Math.round(etlPct)}%. Widgets will hydrate when complete.`,
    },
    SYNCING: {
      icon: <RefreshCw className="w-4 h-4 animate-spin" />,
      tone: "border-emerald-400/30 bg-emerald-400/10 text-emerald-600",
      title: "Sync in progress",
      body: `Fresh data coming in (${etlPhase}). Existing values shown below.`,
    },
    OPERATIONAL_EMPTY: {
      icon: <AlertCircle className="w-4 h-4" />,
      tone: "border-amber-400/30 bg-amber-400/10 text-amber-600",
      title: "Connected, but no data yet",
      body: "Sync completed without finding records. Verify API permissions and date ranges in Connections.",
    },
    STALE_DATA: {
      icon: <Clock className="w-4 h-4" />,
      tone: "border-amber-400/30 bg-amber-400/10 text-amber-600",
      title: "Data is stale",
      body: lastSyncedAt
        ? `Last sync: ${formatLastSync(lastSyncedAt, locale)}. Numbers may not reflect current performance — trigger a fresh sync.`
        : "Trigger a fresh sync to refresh.",
    },
  };

  const c = config[syncState];
  if (!c) return null;

  return (
    <div className={cn("mx-4 mt-3 mb-1 flex items-start gap-2.5 rounded-2xl border px-3 py-2.5", c.tone)}>
      <span className="shrink-0 mt-0.5">{c.icon}</span>
      <div>
        <div className="text-[12px] font-semibold leading-tight">{c.title}</div>
        <div className="text-[11px] opacity-90 leading-snug mt-0.5">{c.body}</div>
      </div>
    </div>
  );
}

function WidgetGrid() {
  const goalType = useDashboardStore((s) => s.goalType);
  const widgets = WidgetRegistry[goalType] ?? WidgetRegistry["E-COMMERCE"];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 px-4">
      {widgets.map(({ id, span, Component }) => {
        const colSpan =
          span === 3 ? "col-span-1 sm:col-span-2 lg:col-span-3" :
          span === 2 ? "col-span-1 sm:col-span-2 lg:col-span-2" :
          "col-span-1";
        return (
          <div key={id} className={colSpan}>
            <Suspense fallback={<div className="h-32 rounded-2xl bg-surface-container-low/60 animate-pulse" />}>
              <Component />
            </Suspense>
          </div>
        );
      })}
    </div>
  );
}

interface DashboardCanvasProps {
  onChat?: (msg: string) => void;
}

export default function DashboardCanvas({ onChat }: DashboardCanvasProps) {
  const { activeWorkspace } = useWorkspace();
  void activeWorkspace; // referenced via fetchUnifiedState dep below
  const fetchUnifiedState = useDashboardStore((s) => s.fetchUnifiedState);
  const syncState         = useDashboardStore((s) => s.syncState);
  const hasLoadedOnce     = useDashboardStore((s) => s.hasLoadedOnce);
  const error             = useDashboardStore((s) => s.error);

  // Workforce: long-running agent execution (Gap Finder re-verifies on stale→fresh)
  useAgentExecution();

  useEffect(() => {
    void fetchUnifiedState(activeWorkspace?.id ?? null);
    const interval = setInterval(() => {
      void fetchUnifiedState(activeWorkspace?.id ?? null);
    }, 60_000);
    return () => clearInterval(interval);
  }, [activeWorkspace?.id, fetchUnifiedState]);

  if (syncState === "HISTORICAL_BACKFILL" && !hasLoadedOnce) {
    return (
      <div className="flex-1 overflow-y-auto">
        <StateBanner />
        <SkeletonLoader message="Performing historical backfill — no partial hydration permitted" />
      </div>
    );
  }

  return (
    <DashboardFilterProvider>
      <div className="flex-1 overflow-y-auto pb-6 space-y-3">
        <StateBanner />
        {error && (
          <div className="mx-4 flex items-start gap-2 rounded-2xl border border-rose-400/30 bg-rose-400/10 px-3 py-2.5">
            <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-rose-500 leading-relaxed">{error}</p>
          </div>
        )}
        <div className="px-4">
          <ApprovalQueue />
        </div>
        <WidgetGrid />
        <div className="px-4 pt-2">
          <PerformanceGrid />
        </div>
        <div className="px-4">
          <PerformanceAILogs onChat={onChat} />
        </div>
      </div>
    </DashboardFilterProvider>
  );
}
