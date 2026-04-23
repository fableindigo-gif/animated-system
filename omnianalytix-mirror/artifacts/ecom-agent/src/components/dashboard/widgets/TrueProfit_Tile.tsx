import { Scale } from "lucide-react";
import Tile, { fmtUsd } from "./Tile";
import { useDashboardStore } from "@/store/dashboardStore";
import { NoDataHelper } from "./EmptyStateForSyncState";

export default function TrueProfit_Tile() {
  const ecommerce     = useDashboardStore((s) => s.ecommerce);
  const isLoading     = useDashboardStore((s) => s.isLoading);
  const syncState     = useDashboardStore((s) => s.syncState);
  const hasUsableData = useDashboardStore((s) => s.hasUsableData());
  const profit = ecommerce?.trueProfitUsd ?? 0;
  const tone: "positive" | "negative" | "default" =
    profit > 0  ? "positive"
    : profit < 0 ? "negative"
    : "default";
  return (
    <Tile
      label="True Profit"
      value={fmtUsd(profit, { compact: Math.abs(profit) >= 10000 })}
      icon={<Scale className="w-4 h-4" />}
      tone={tone}
      loading={isLoading && !ecommerce}
      noData={!hasUsableData}
      helper={
        !hasUsableData
          ? <NoDataHelper syncState={syncState} />
          : ecommerce
            ? `Revenue ${fmtUsd(ecommerce.revenueUsd, { compact: true })} − Spend ${fmtUsd(ecommerce.spendUsd, { compact: true })} − COGS ${fmtUsd(ecommerce.cogsUsd, { compact: true })}`
            : "Server-computed: Revenue − Ad Spend − COGS"
      }
    />
  );
}
