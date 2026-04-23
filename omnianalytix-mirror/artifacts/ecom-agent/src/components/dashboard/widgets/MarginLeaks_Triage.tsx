import { AlertTriangle, AlertCircle } from "lucide-react";
import { useDashboardStore } from "@/store/dashboardStore";
import { useDashboardFilter } from "@/context/DashboardFilterContext";
import { WindowEmptyBanner } from "@/components/dashboard/window-empty-banner";
import { fmtUsd } from "./Tile";
import { cn } from "@/lib/utils";
import EmptyStateForSyncState from "./EmptyStateForSyncState";

export default function MarginLeaks_Triage() {
  const ecommerce           = useDashboardStore((s) => s.ecommerce);
  const isStale             = useDashboardStore((s) => s.isStale());
  const isLoading           = useDashboardStore((s) => s.isLoading);
  const syncState           = useDashboardStore((s) => s.syncState);
  const hasUsableData       = useDashboardStore((s) => s.hasUsableData());
  const leaksWindowEmpty    = useDashboardStore((s) => s.leaksWindowEmpty);
  const leaksLatestAdsSyncAt = useDashboardStore((s) => s.leaksLatestAdsSyncAt);
  const { skuId, setFilter, clearFilter } = useDashboardFilter();
  const leaks = ecommerce?.marginLeaks ?? [];

  return (
    <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-semibold text-on-surface">Margin-Leak Triage</h3>
        </div>
        {skuId && (
          <button
            onClick={() => clearFilter()}
            className="text-[10px] uppercase tracking-wider text-accent-blue hover:underline"
          >
            Clear filter
          </button>
        )}
      </div>

      {isLoading && !ecommerce && (
        <div className="text-xs text-on-surface-variant">Scanning warehouse for unprofitable SKUs…</div>
      )}

      {!isLoading && isStale && (
        <div className="flex flex-col items-center text-center gap-2 py-6">
          <AlertCircle className="w-4 h-4 text-amber-500" />
          <div className="text-xs font-semibold text-on-surface">Triage results unavailable while data is stale</div>
          <div className="text-[11px] text-on-surface-variant max-w-[42ch] leading-relaxed">
            Refresh the warehouse sync to re-evaluate SKU margins.
          </div>
        </div>
      )}

      {!isLoading && !isStale && leaks.length === 0 && leaksWindowEmpty && (
        <WindowEmptyBanner
          latestSyncAt={leaksLatestAdsSyncAt}
          className="mt-1"
        />
      )}

      {!isLoading && !isStale && leaks.length === 0 && !leaksWindowEmpty && (
        <EmptyStateForSyncState
          syncState={hasUsableData ? "OPERATIONAL_POPULATED" : syncState}
          populatedFallback="No margin leaks detected. Every SKU with attributed spend is currently profitable."
        />
      )}

      <ul className={cn("space-y-1.5", isStale && "hidden")}>
        {leaks.map((leak) => {
          const selected = skuId === leak.sku;
          return (
            <li key={`${leak.productId}_${leak.sku}`}>
              <button
                onClick={() => setFilter({ skuId: selected ? null : leak.sku })}
                className={cn(
                  "w-full text-left flex items-center justify-between gap-3 px-3 py-2 rounded-xl transition-colors",
                  selected
                    ? "bg-accent-blue/10 border border-accent-blue/40"
                    : "border border-transparent hover:bg-surface-container",
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn(
                      "w-1.5 h-1.5 rounded-full shrink-0",
                      leak.severity === "critical" ? "bg-rose-500" : "bg-amber-500",
                    )}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-on-surface truncate">{leak.productTitle}</div>
                    <div className="text-[10px] text-on-surface-variant truncate">SKU {leak.sku || "—"}</div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className={cn(
                    "text-xs font-semibold tabular-nums",
                    leak.attributedProfitUsd < 0 ? "text-rose-500" : "text-amber-500",
                  )}>
                    {fmtUsd(leak.attributedProfitUsd, { compact: true })}
                  </div>
                  <div className="text-[10px] text-on-surface-variant tabular-nums">
                    {leak.marginPct.toFixed(1)}% margin
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
