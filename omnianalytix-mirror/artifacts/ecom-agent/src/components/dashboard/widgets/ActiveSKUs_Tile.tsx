import { Package } from "lucide-react";
import { useDashboardStore } from "@/store/dashboardStore";

// Active SKUs surface for the Performance & AI Logs dashboard.
//
// Source: until the unified-state schema exposes a dedicated
// `activeProducts` field for the e-commerce slice, we approximate
// "SKUs currently appearing in attribution" by reading
// `ecommerce.marginLeaks` (the only per-SKU collection on the slice
// today). When the backend adds a true active-SKU count
// (UnifiedDashboardState.ecommerce.activeProducts), wire it here.
export default function ActiveSKUs_Tile() {
  const ecommerce = useDashboardStore((s) => s.ecommerce);
  const isLoading = useDashboardStore((s) => s.isLoading);

  const count = ecommerce?.marginLeaks?.length ?? 0;

  return (
    <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4 min-h-[120px] relative">
      <Package className="w-4 h-4 text-on-surface-variant absolute top-4 right-4" aria-hidden />
      <span className="block text-[11px] uppercase tracking-wider text-on-surface-variant font-semibold">
        Active SKUs
      </span>
      <span
        className={`block mt-1.5 text-2xl font-bold tabular-nums text-on-surface ${
          isLoading && !ecommerce ? "opacity-30" : ""
        }`}
      >
        {count.toLocaleString("en-US")}
      </span>
    </div>
  );
}
