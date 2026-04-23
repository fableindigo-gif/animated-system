import { UserCheck } from "lucide-react";
import Tile, { fmtUsd, fmtNum } from "./Tile";
import { useDashboardStore } from "@/store/dashboardStore";
import { NoDataHelper } from "./EmptyStateForSyncState";

export default function CPL_Tile() {
  const leadgen       = useDashboardStore((s) => s.leadgen);
  const isLoading     = useDashboardStore((s) => s.isLoading);
  const syncState     = useDashboardStore((s) => s.syncState);
  const hasUsableData = useDashboardStore((s) => s.hasUsableData());
  const cpl = leadgen?.cplUsd ?? 0;
  return (
    <Tile
      label="Cost Per Lead"
      value={fmtUsd(cpl)}
      icon={<UserCheck className="w-4 h-4" />}
      loading={isLoading && !leadgen}
      noData={!hasUsableData}
      helper={
        !hasUsableData
          ? <NoDataHelper syncState={syncState} />
          : leadgen
            ? `${fmtNum(leadgen.leadCount)} leads from ${fmtUsd(leadgen.spendUsd, { compact: true })} spend`
            : undefined
      }
    />
  );
}
