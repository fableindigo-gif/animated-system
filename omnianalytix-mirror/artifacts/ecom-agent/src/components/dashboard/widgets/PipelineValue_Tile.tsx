import { Briefcase } from "lucide-react";
import Tile, { fmtUsd, fmtNum } from "./Tile";
import { useDashboardStore } from "@/store/dashboardStore";
import { NoDataHelper } from "./EmptyStateForSyncState";

export default function PipelineValue_Tile() {
  const leadgen       = useDashboardStore((s) => s.leadgen);
  const isLoading     = useDashboardStore((s) => s.isLoading);
  const syncState     = useDashboardStore((s) => s.syncState);
  const hasUsableData = useDashboardStore((s) => s.hasUsableData());
  const pipeline = leadgen?.pipelineValueUsd ?? 0;
  return (
    <Tile
      label="Open Pipeline Value"
      value={fmtUsd(pipeline, { compact: pipeline >= 10000 })}
      icon={<Briefcase className="w-4 h-4" />}
      tone="positive"
      loading={isLoading && !leadgen}
      noData={!hasUsableData}
      helper={
        !hasUsableData
          ? <NoDataHelper syncState={syncState} />
          : leadgen
            ? `${fmtNum(leadgen.qualifiedLeadCount)} qualified leads · ${fmtUsd(leadgen.closedWonValueUsd, { compact: true })} closed-won`
            : undefined
      }
    />
  );
}
