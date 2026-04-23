import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatUsdInDisplay } from "@/lib/fx-format";

export interface TileProps {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  helper?: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "positive" | "negative" | "warning";
  loading?: boolean;
  /**
   * When true, the numeric `value` is suppressed in favour of an em-dash
   * and the `helper` slot is the only thing shown. Use this whenever the
   * underlying warehouse data is not OPERATIONAL_POPULATED / STALE_DATA,
   * so KPI tiles do not render misleading derived numbers like
   * "POAS = -1.00x" or "Revenue = $0" as if they were real measurements
   * rather than a "no data" condition.
   */
  noData?: boolean;
}

const TONE_CLASSES: Record<NonNullable<TileProps["tone"]>, string> = {
  default:  "text-on-surface",
  positive: "text-emerald-500",
  negative: "text-rose-500",
  warning:  "text-amber-500",
};

export default function Tile({ label, value, delta, helper, icon, tone = "default", loading, noData }: TileProps) {
  // noData wins over tone — a "we don't know" state must never look
  // positive (green) or negative (red); both would imply a measurement.
  const effectiveTone = noData ? "default" : tone;
  const showValue = !loading && !noData;
  return (
    <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4 flex flex-col gap-1.5 min-h-[120px]">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-on-surface-variant font-semibold">{label}</span>
        {icon && <span className="text-on-surface-variant">{icon}</span>}
      </div>
      <div
        className={cn(
          "text-2xl font-bold tabular-nums",
          TONE_CLASSES[effectiveTone],
          (loading || noData) && "opacity-30",
        )}
      >
        {showValue ? value : "—"}
      </div>
      {delta && <div className="text-xs text-on-surface-variant">{delta}</div>}
      {helper && <div className="text-[11px] text-on-surface-variant/80 mt-auto pt-1">{helper}</div>}
    </div>
  );
}

// USD warehouse value → user's display currency via the FX runtime.
// Module-level so non-React callers (table cells, helpers) work too.
export function fmtUsd(n: number, opts?: { compact?: boolean }) {
  const value = Number.isFinite(n) ? n : 0;
  return formatUsdInDisplay(value, {
    compact: !!opts?.compact,
    decimals: opts?.compact ? 1 : 0,
  });
}

// Integer-or-compact count formatter. Counts are inherently whole numbers,
// so we round the input before any formatting to avoid `233.00`-style
// fractional drift from upstream floats.
export function fmtNum(n: number, opts?: { compact?: boolean }) {
  const v = Number.isFinite(n) ? Math.round(n) : 0;
  if (opts?.compact) {
    const abs = Math.abs(v);
    const sign = v < 0 ? "-" : "";
    if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000)     return `${sign}${(abs / 1_000).toFixed(1)}K`;
  }
  return v.toLocaleString("en-US");
}

export function fmtRatio(n: number) {
  if (!Number.isFinite(n)) return "0.00x";
  return `${n.toFixed(2)}x`;
}
