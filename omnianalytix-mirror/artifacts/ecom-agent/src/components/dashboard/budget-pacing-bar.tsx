import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { formatUsdInDisplay } from "@/lib/fx-format";

interface BudgetPacingBarProps {
  totalSpend: number;
  monthlyBudget?: number;
  currencySymbol?: string;
}

export function BudgetPacingBar({ totalSpend, monthlyBudget, currencySymbol = "$" }: BudgetPacingBarProps) {
  const { pct, targetPct, offTrack, label, statusColor } = useMemo(() => {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();
    const elapsedPct = dayOfMonth / daysInMonth;

    const budget = monthlyBudget || totalSpend * (1 / elapsedPct) * 1.05;
    const actual = totalSpend / budget;
    const target = elapsedPct;
    const deviation = actual - target;
    const offByMore = Math.abs(deviation) > 0.10;

    const fmt = (n: number) => formatUsdInDisplay(n, { compact: true, decimals: 1 });

    return {
      pct: Math.min(actual, 1),
      targetPct: target,
      offTrack: offByMore,
      label: `${fmt(totalSpend)} of ${fmt(budget)} MTD`,
      statusColor: offByMore
        ? deviation > 0 ? "overspend" as const : "underspend" as const
        : "ontrack" as const,
    };
  }, [totalSpend, monthlyBudget, currencySymbol]);

  const barColor = statusColor === "overspend"
    ? "bg-rose-400"
    : statusColor === "underspend"
    ? "bg-amber-400"
    : "bg-emerald-400";

  const textColor = statusColor === "overspend"
    ? "text-error-m3"
    : statusColor === "underspend"
    ? "text-amber-600"
    : "text-emerald-600";

  return (
    <div className="mt-2">
      <div className="relative h-1.5 rounded-full bg-surface-container-low overflow-hidden">
        <motion.div
          className={cn("absolute inset-y-0 left-0 rounded-full", barColor)}
          initial={{ width: 0 }}
          animate={{ width: `${pct * 100}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
        <div
          className="absolute top-0 bottom-0 w-px bg-outline/60"
          style={{ left: `${targetPct * 100}%` }}
        />
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[9px] text-on-surface-variant">{label}</span>
        {offTrack && (
          <span className={cn("text-[9px] font-bold", textColor)}>
            {statusColor === "overspend" ? "Over pacing" : "Under pacing"}
          </span>
        )}
      </div>
    </div>
  );
}
