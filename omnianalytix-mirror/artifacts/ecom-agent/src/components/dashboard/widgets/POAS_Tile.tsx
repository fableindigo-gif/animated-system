import { TrendingUp } from "lucide-react";
import Tile, { fmtRatio } from "./Tile";
import { useDashboardStore } from "@/store/dashboardStore";
import { useCurrency } from "@/contexts/currency-context";
import { NoDataHelper } from "./EmptyStateForSyncState";

export default function POAS_Tile() {
  const ecommerce     = useDashboardStore((s) => s.ecommerce);
  const isLoading     = useDashboardStore((s) => s.isLoading);
  const syncState     = useDashboardStore((s) => s.syncState);
  const hasUsableData = useDashboardStore((s) => s.hasUsableData());
  const { currencySymbol } = useCurrency();
  const poas = ecommerce?.poas ?? 0;
  const tone: "positive" | "negative" | "default" =
    poas >= 1   ? "positive"
    : poas > 0  ? "default"
    : "negative";
  // noData fix: when warehouse has no usable rows, POAS = (rev - spend - cogs) / spend
  // collapses to -1.00x (because spend > 0 from a connected ad account but
  // no warehouse-attributed revenue). Showing -1.00x in red is a lie — we
  // simply have no measurement. Suppress the value until data is real.
  return (
    <Tile
      label="Profit on Ad Spend (POAS)"
      value={fmtRatio(poas)}
      icon={<TrendingUp className="w-4 h-4" />}
      tone={tone}
      loading={isLoading && !ecommerce}
      noData={!hasUsableData}
      helper={
        !hasUsableData
          ? <NoDataHelper syncState={syncState} />
          : poas >= 1
            ? `Profitable — every ${currencySymbol}1 in ad spend is returning more than ${currencySymbol}1 in true profit`
            : "Below break-even — ads are losing money after COGS"
      }
    />
  );
}
