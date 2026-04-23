import { DollarSign } from "lucide-react";
import Tile, { fmtUsd, fmtNum } from "./Tile";
import { useDashboardStore } from "@/store/dashboardStore";
import { NoDataHelper } from "./EmptyStateForSyncState";

export default function Revenue_Tile() {
  const ecommerce     = useDashboardStore((s) => s.ecommerce);
  const isLoading     = useDashboardStore((s) => s.isLoading);
  const syncState     = useDashboardStore((s) => s.syncState);
  const hasUsableData = useDashboardStore((s) => s.hasUsableData());
  const rev = ecommerce?.revenueUsd ?? 0;
  return (
    <Tile
      label="Attributed Revenue"
      value={fmtUsd(rev, { compact: rev >= 10000 })}
      icon={<DollarSign className="w-4 h-4" />}
      loading={isLoading && !ecommerce}
      noData={!hasUsableData}
      helper={
        !hasUsableData
          ? <NoDataHelper syncState={syncState} />
          : ecommerce
            ? `${fmtNum(ecommerce.conversions)} conversions tracked`
            : undefined
      }
    />
  );
}
