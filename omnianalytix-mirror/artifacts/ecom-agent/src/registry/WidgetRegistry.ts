import { lazy, type LazyExoticComponent, type ComponentType } from "react";
import type { GoalType } from "@/store/dashboardStore";

export interface WidgetEntry {
  id: string;
  span: 1 | 2 | 3 | 4;
  Component: LazyExoticComponent<ComponentType>;
}

const POAS_Tile           = lazy(() => import("@/components/dashboard/widgets/POAS_Tile"));
const Revenue_Tile        = lazy(() => import("@/components/dashboard/widgets/Revenue_Tile"));
const TrueProfit_Tile     = lazy(() => import("@/components/dashboard/widgets/TrueProfit_Tile"));
const ActiveSKUs_Tile     = lazy(() => import("@/components/dashboard/widgets/ActiveSKUs_Tile"));
const MarginLeaks_Triage  = lazy(() => import("@/components/dashboard/widgets/MarginLeaks_Triage"));
const CPL_Tile            = lazy(() => import("@/components/dashboard/widgets/CPL_Tile"));
const PipelineValue_Tile  = lazy(() => import("@/components/dashboard/widgets/PipelineValue_Tile"));
const CRMSync_Triage      = lazy(() => import("@/components/dashboard/widgets/CRMSync_Triage"));

const ECOMMERCE_WIDGETS: WidgetEntry[] = [
  { id: "POAS_Tile",          span: 1, Component: POAS_Tile },
  { id: "Revenue_Tile",       span: 1, Component: Revenue_Tile },
  { id: "TrueProfit_Tile",    span: 1, Component: TrueProfit_Tile },
  { id: "ActiveSKUs_Tile",    span: 1, Component: ActiveSKUs_Tile },
  { id: "MarginLeaks_Triage", span: 3, Component: MarginLeaks_Triage },
];

const LEADGEN_WIDGETS: WidgetEntry[] = [
  { id: "CPL_Tile",           span: 1, Component: CPL_Tile },
  { id: "PipelineValue_Tile", span: 2, Component: PipelineValue_Tile },
  { id: "CRMSync_Triage",     span: 3, Component: CRMSync_Triage },
];

const HYBRID_WIDGETS: WidgetEntry[] = [
  { id: "POAS_Tile",          span: 1, Component: POAS_Tile },
  { id: "Revenue_Tile",       span: 1, Component: Revenue_Tile },
  { id: "TrueProfit_Tile",    span: 1, Component: TrueProfit_Tile },
  { id: "ActiveSKUs_Tile",    span: 1, Component: ActiveSKUs_Tile },
  { id: "CPL_Tile",           span: 1, Component: CPL_Tile },
  { id: "PipelineValue_Tile", span: 2, Component: PipelineValue_Tile },
  { id: "MarginLeaks_Triage", span: 3, Component: MarginLeaks_Triage },
  { id: "CRMSync_Triage",     span: 3, Component: CRMSync_Triage },
];

export const WidgetRegistry: Record<GoalType, WidgetEntry[]> = {
  "E-COMMERCE": ECOMMERCE_WIDGETS,
  "LEADGEN":    LEADGEN_WIDGETS,
  "HYBRID":     HYBRID_WIDGETS,
};
