import { Database, AlertCircle } from "lucide-react";
import { useDashboardStore } from "@/store/dashboardStore";
import { useDashboardFilter } from "@/context/DashboardFilterContext";
import { fmtUsd } from "./Tile";
import { cn } from "@/lib/utils";
import EmptyStateForSyncState from "./EmptyStateForSyncState";

export default function CRMSync_Triage() {
  const leadgen       = useDashboardStore((s) => s.leadgen);
  const isStale       = useDashboardStore((s) => s.isStale());
  const isLoading     = useDashboardStore((s) => s.isLoading);
  const syncState     = useDashboardStore((s) => s.syncState);
  const hasUsableData = useDashboardStore((s) => s.hasUsableData());
  const { campaignId, setFilter, clearFilter } = useDashboardFilter();
  const issues = leadgen?.crmSyncIssues ?? [];

  return (
    <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-semibold text-on-surface">CRM Sync Triage</h3>
        </div>
        {campaignId && (
          <button
            onClick={() => clearFilter()}
            className="text-[10px] uppercase tracking-wider text-accent-blue hover:underline"
          >
            Clear filter
          </button>
        )}
      </div>

      {isStale && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed font-medium">
            Data Stale: Inaccurate results — last CRM sync was &gt; 4 hours ago.
          </p>
        </div>
      )}

      {isLoading && !leadgen && (
        <div className="text-xs text-on-surface-variant">Scanning CRM warehouse for attribution gaps…</div>
      )}

      {!isLoading && issues.length === 0 && (
        // Same honesty fix as MarginLeaks_Triage: don't claim "no sync
        // issues" when there are no leads in the warehouse to evaluate.
        <EmptyStateForSyncState
          syncState={hasUsableData ? "OPERATIONAL_POPULATED" : syncState}
          populatedFallback="No sync issues detected. All leads have complete attribution + pipeline data."
        />
      )}

      <ul className="space-y-1.5">
        {issues.map((issue) => {
          const filterCampaignId = `lead:${issue.leadId}`;
          const selected = campaignId === filterCampaignId;
          return (
            <li key={issue.leadId}>
              <button
                onClick={() => setFilter({ campaignId: selected ? null : filterCampaignId })}
                className={cn(
                  "w-full text-left flex items-center justify-between gap-3 px-3 py-2 rounded-xl transition-colors",
                  selected
                    ? "bg-accent-blue/10 border border-accent-blue/40"
                    : "border border-transparent hover:bg-surface-container",
                )}
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium text-on-surface truncate">{issue.email || "(no email)"}</div>
                  <div className="text-[10px] text-on-surface-variant truncate">{issue.reason}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs font-semibold text-on-surface tabular-nums">{fmtUsd(issue.dealAmount, { compact: true })}</div>
                  <div className="text-[10px] text-on-surface-variant uppercase tracking-wider">{issue.pipelineStage.replace(/_/g, " ")}</div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
