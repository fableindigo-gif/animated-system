import { Plug, RefreshCw, Database, Inbox, type LucideIcon } from "lucide-react";
import type { TenantSyncState } from "@/store/dashboardStore";

/**
 * Renders a state-aware empty state for any widget whose data depends on the
 * warehouse. This component intentionally exists so that widgets stop saying
 * "All clear / no issues found" when the truth is "we have not yet ingested
 * a single row for this tenant" — a class of false-negative that makes the
 * dashboard actively misleading on cold-start, broken-OAuth, and zero-row
 * tenants.
 *
 * Maps each TenantSyncState to a deterministic message + icon:
 *   • AWAITING_OAUTH       — "Connect a data source to begin"
 *   • SYNCING              — "Syncing now — first results in a few minutes"
 *   • HISTORICAL_BACKFILL  — "Backfilling history — this can take a while"
 *   • OPERATIONAL_EMPTY    — "Connected, but no rows returned yet"
 *   • STALE_DATA           — caller should usually still render content + a
 *                            stale badge; we provide a fallback message.
 *   • OPERATIONAL_POPULATED — caller controls the empty message (e.g.
 *                             "no margin leaks detected") because it really
 *                             does have a meaningful all-clear.
 */
export interface EmptyStateForSyncStateProps {
  syncState: TenantSyncState;
  /** Optional override of the default "all clear" message for the populated state. */
  populatedFallback?: string;
  /** Compact mode — smaller padding for tile-sized containers. */
  compact?: boolean;
}

interface StateCopy {
  title: string;
  detail: string;
  Icon: LucideIcon;
  tone: "info" | "warning" | "neutral";
}

const COPY: Record<TenantSyncState, StateCopy> = {
  AWAITING_OAUTH: {
    title: "No data sources connected",
    detail:
      "Connect Google Ads, Shopify, or your CRM from the Connections page to begin analysis.",
    Icon: Plug,
    tone: "info",
  },
  SYNCING: {
    title: "Sync in progress",
    detail:
      "We are pulling fresh data from your connected platforms. First results usually appear within a few minutes.",
    Icon: RefreshCw,
    tone: "info",
  },
  HISTORICAL_BACKFILL: {
    title: "Backfilling historical data",
    detail:
      "We are loading historical data from your connected platforms. This typically takes 5–15 minutes on first run.",
    Icon: RefreshCw,
    tone: "info",
  },
  OPERATIONAL_EMPTY: {
    title: "Connected, but no rows yet",
    detail:
      "Your data sources are connected and have synced, but returned no rows for the current scope. Verify the account selection in Connections, or wait for the next sync window.",
    Icon: Database,
    tone: "warning",
  },
  STALE_DATA: {
    title: "Data may be stale",
    detail:
      "Last warehouse sync was more than 4 hours ago. Trigger a fresh sync from Connections to restore real-time accuracy.",
    Icon: Database,
    tone: "warning",
  },
  OPERATIONAL_POPULATED: {
    title: "All clear",
    detail: "No items to surface for the current filter.",
    Icon: Inbox,
    tone: "neutral",
  },
};

const TONE_CLASSES: Record<StateCopy["tone"], string> = {
  info:    "text-accent-blue",
  warning: "text-amber-500",
  neutral: "text-on-surface-variant",
};

export default function EmptyStateForSyncState({
  syncState,
  populatedFallback,
  compact = false,
}: EmptyStateForSyncStateProps) {
  const copy = COPY[syncState];
  const detail =
    syncState === "OPERATIONAL_POPULATED" && populatedFallback
      ? populatedFallback
      : copy.detail;
  const Icon = copy.Icon;
  return (
    <div
      className={
        compact
          ? "flex flex-col items-center text-center gap-1 py-3"
          : "flex flex-col items-center text-center gap-2 py-6"
      }
    >
      <Icon className={`w-4 h-4 ${TONE_CLASSES[copy.tone]}`} />
      <div className="text-xs font-semibold text-on-surface">{copy.title}</div>
      <div className="text-[11px] text-on-surface-variant max-w-[42ch] leading-relaxed">
        {detail}
      </div>
    </div>
  );
}

/**
 * Small inline label suitable for putting under a numeric tile when the
 * tile cannot honestly display a value (e.g. POAS when there is no spend
 * AND no revenue). Keeps tiles from rendering "0.00x" or "$0" as if they
 * meant "we measured this and it is zero".
 */
export function NoDataHelper({ syncState }: { syncState: TenantSyncState }) {
  const map: Record<TenantSyncState, string> = {
    AWAITING_OAUTH:        "Connect a data source",
    SYNCING:               "Syncing — pending first results",
    HISTORICAL_BACKFILL:   "Backfilling history",
    OPERATIONAL_EMPTY:     "No rows in warehouse yet",
    STALE_DATA:            "Last sync > 4h ago",
    OPERATIONAL_POPULATED: "",
  };
  const msg = map[syncState];
  if (!msg) return null;
  return <span className="text-[11px] text-on-surface-variant/80">{msg}</span>;
}
