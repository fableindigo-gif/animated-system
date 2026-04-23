import { useEffect, useMemo, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useFx } from "@/contexts/fx-context";
import { useCurrency } from "@/contexts/currency-context";

interface MoneyTileProps {
  /** Amount in USD as returned by the warehouse. */
  usd:       number;
  compact?:  boolean;
  decimals?: number;
  className?: string;
  /** Optional override for the tooltip label (defaults to "Source: USD"). */
  hint?:     ReactNode;
  /** When true, renders inline (<span>) instead of the default <span>. */
  as?:       "span" | "div";
  /**
   * ISO YYYY-MM-DD period-end date this value belongs to (e.g. the last day
   * of the reporting window). When supplied — and different from today — the
   * value is converted using the FX rate cached for that date (or the
   * nearest prior cached row) instead of today's rate, and a visible
   * "rate as of …" caption is rendered alongside the figure so users know
   * the value reflects historical FX, not spot.
   */
  periodEnd?: string;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Renders a USD warehouse value in the user's preferred display currency.
 *
 * The tooltip discloses the underlying USD amount, the FX rate used, the rate
 * date, and the rate source ("override" / "cache" / "fetched" / "fallback")
 * so users can audit any conversion they see on a dashboard.
 *
 * When `periodEnd` is set and the resolved rate date differs from today, a
 * small "rate as of YYYY-MM-DD" caption is rendered next to the figure to
 * surface that the value uses historical FX (see Task #72).
 */
export function MoneyTile({
  usd,
  compact,
  decimals,
  className,
  hint,
  as = "span",
  periodEnd,
}: MoneyTileProps) {
  const { formatFromUsd, formatFromUsdAt, rate, source, rateDate, loading, rateFor, ensureRate } = useFx();
  const { currencyCode, formatUsd } = useCurrency();
  const today = useMemo(todayIso, []);

  const isUsd = currencyCode.toUpperCase() === "USD";

  // Warm the historical rate so `rateFor` resolves the actual cached row.
  useEffect(() => {
    if (!periodEnd || isUsd || periodEnd === today) return;
    void ensureRate(currencyCode, periodEnd);
  }, [periodEnd, isUsd, today, currencyCode, ensureRate]);

  const usingHistorical = !!periodEnd && periodEnd !== today && !isUsd;
  const display = usingHistorical
    ? formatFromUsdAt(usd, periodEnd, { compact, decimals })
    : formatFromUsd(usd, { compact, decimals });

  const periodInfo = usingHistorical ? rateFor(currencyCode, periodEnd) : null;
  const effectiveRate     = periodInfo?.rate ?? rate;
  const effectiveRateDate = periodInfo?.rateDate ?? rateDate;
  const effectiveSource   = periodInfo?.source ?? source;

  // Visible caption only when the rate the figure was converted at is not
  // today's. Period-end requests that resolve via the nearest-prior cached
  // row will show the resolved date, not the requested one — that's the
  // honest answer the user needs.
  const showAsOf = usingHistorical && effectiveRateDate !== today;

  const Tag: "span" | "div" = as;

  if (isUsd) {
    return <Tag className={className}>{display}</Tag>;
  }

  const tile = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Tag className={className} style={{ cursor: "help" }}>
          {display}
        </Tag>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div className="space-y-0.5">
          <div className="font-medium">{formatUsd(usd, { decimals: decimals ?? 2 })} (USD)</div>
          <div className="opacity-80">
            1 USD = {effectiveRate.toFixed(4)} {currencyCode} · {effectiveRateDate}
          </div>
          <div className="opacity-60 capitalize">
            {loading ? "loading rate…" : `source: ${effectiveSource}`}
          </div>
          {hint ? <div className="opacity-80 pt-1 border-t border-border/40">{hint}</div> : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );

  if (!showAsOf) return tile;

  // Inline caption — kept tiny and muted so it never competes with the KPI.
  // Outer wrapper matches `as` to avoid invalid <div>-in-<span> nesting when
  // the tile is rendered as a block element.
  const Wrapper: "span" | "div" = as;
  return (
    <Wrapper className="inline-flex items-baseline gap-1.5">
      {tile}
      <span className="text-[10px] uppercase tracking-wide opacity-60 whitespace-nowrap">
        rate as of {effectiveRateDate}
      </span>
    </Wrapper>
  );
}
