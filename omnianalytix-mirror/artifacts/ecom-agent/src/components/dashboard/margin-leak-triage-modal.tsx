import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, PackageX, RefreshCw, ShieldAlert } from "lucide-react";
import { formatUsdInDisplay } from "@/lib/fx-format";
import { WindowEmptyBanner } from "./window-empty-banner";

export interface MarginLeak {
  campaignName: string | null;
  campaignId: string;
  productTitle: string | null;
  sku: string | null;
  inventoryQty: number | null;
  wastedSpend: number;
  impressions: number;
}

type IssueType = "Low Inventory" | "Sync Disruption";

function classifyLeak(leak: MarginLeak): IssueType {
  if (leak.inventoryQty != null && leak.inventoryQty <= 5) return "Low Inventory";
  return "Sync Disruption";
}

export function MarginLeakTriageModal({
  open,
  onOpenChange,
  leaks,
  // Task #114: window-empty disambiguation. When the warehouse has rows
  // outside the selected date window but none inside it, render the shared
  // WindowEmptyBanner instead of the bare "no leaks" message so the user
  // can jump to Last 30 Days.
  hasDataOutsideWindow = false,
  latestAdsSyncAt = null,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  leaks: MarginLeak[];
  hasDataOutsideWindow?: boolean;
  latestAdsSyncAt?: string | null;
}) {
  const grouped = useMemo(() => {
    const g: Record<IssueType, MarginLeak[]> = {
      "Low Inventory": [],
      "Sync Disruption": [],
    };
    for (const l of leaks) g[classifyLeak(l)].push(l);
    g["Low Inventory"].sort((a, b) => b.wastedSpend - a.wastedSpend);
    g["Sync Disruption"].sort((a, b) => b.wastedSpend - a.wastedSpend);
    return g;
  }, [leaks]);

  const totalWasted = leaks.reduce((s, l) => s + (l.wastedSpend ?? 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-500" />
            Margin-Leak Triage
          </DialogTitle>
          <p className="text-xs text-slate-500 mt-1">
            {leaks.length} at-risk SKU{leaks.length === 1 ? "" : "s"} · estimated{" "}
            <span className="font-semibold text-slate-700">
              {formatUsdInDisplay(totalWasted, { compact: true, decimals: 2 })}
            </span>{" "}
            wasted spend this period.
          </p>
        </DialogHeader>

        {leaks.length === 0 ? (
          // Task #114: window-empty vs truly-empty disambiguation. When the
          // warehouse has older rows but the active date window has none,
          // surface the shared banner with a one-click "Switch to Last 30
          // Days" affordance. Otherwise keep the existing healthy-state copy.
          hasDataOutsideWindow ? (
            <div className="py-4">
              <WindowEmptyBanner latestSyncAt={latestAdsSyncAt} />
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-slate-500">
              No active margin leaks detected. All SKUs with ad spend are healthy.
            </div>
          )
        ) : (
          <div className="space-y-6 mt-2">
            {(["Low Inventory", "Sync Disruption"] as IssueType[]).map((issue) => {
              const rows = grouped[issue];
              if (rows.length === 0) return null;
              const Icon = issue === "Low Inventory" ? PackageX : RefreshCw;
              const accent = issue === "Low Inventory" ? "text-rose-600 bg-rose-50" : "text-amber-600 bg-amber-50";
              return (
                <section key={issue}>
                  <header className={`flex items-center gap-2 px-3 py-2 rounded-lg ${accent}`}>
                    <Icon className="w-4 h-4" />
                    <h4 className="text-sm font-bold">{issue}</h4>
                    <span className="text-xs font-semibold ml-auto">
                      {rows.length} SKU{rows.length === 1 ? "" : "s"}
                    </span>
                  </header>
                  <div className="mt-2 rounded-xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-3 py-2 font-semibold text-slate-600">SKU</th>
                          <th className="px-3 py-2 font-semibold text-slate-600">Product</th>
                          <th className="px-3 py-2 font-semibold text-slate-600 text-right">Wasted Spend</th>
                          <th className="px-3 py-2 font-semibold text-slate-600 text-right">Inventory</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((l) => (
                          <tr key={`${l.campaignId}-${l.sku ?? "_"}`} className="border-t border-slate-100">
                            <td className="px-3 py-2 font-mono text-[11px] text-slate-700">
                              {l.sku ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-slate-800">
                              {l.productTitle ?? l.campaignName ?? "Unknown"}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums font-semibold text-rose-700">
                              {formatUsdInDisplay(l.wastedSpend ?? 0, { compact: true, decimals: 2 })}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                              {l.inventoryQty == null ? (
                                <span className="inline-flex items-center gap-1 text-amber-600">
                                  <AlertTriangle className="w-3 h-3" />
                                  unknown
                                </span>
                              ) : (
                                l.inventoryQty
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
