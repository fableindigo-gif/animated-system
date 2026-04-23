/**
 * Hook-free FX-aware formatter — converts a USD warehouse value into the
 * user's active display currency using the rate published by `FxProvider`
 * via `setActiveFxRate` (see `contexts/fx-runtime.ts`).
 *
 * Use this from module-scope helpers (the per-dashboard `fmt(n, sym)`
 * functions). Inside React components, prefer `useFx().formatFromUsd` for
 * richer auditability metadata.
 */
import { getActiveFxRate } from "@/contexts/fx-runtime";
import { getCurrencySymbol } from "@/contexts/currency-context";

export interface FxFormatOpts {
  compact?:  boolean;
  decimals?: number;
}

/** USD → display currency, formatted with Intl.NumberFormat. */
export function formatUsdInDisplay(amountUsd: number, opts: FxFormatOpts = {}): string {
  const { compact = false, decimals } = opts;
  const { quote, rate, source } = getActiveFxRate();
  // Honesty rule: when no trusted rate exists, render USD with `$` rather
  // than mislabel a USD value with the user's preferred currency symbol
  // (e.g. ₹110,000 for $110,000 with rate=1.0).
  const useFallbackUsd = source === "fallback" && quote !== "USD";
  const displayQuote = useFallbackUsd ? "USD" : quote;
  const safeRate = useFallbackUsd || quote === "USD" ? 1 : rate;
  const converted = Number.isFinite(amountUsd) ? amountUsd * safeRate : amountUsd;
  const symbol = getCurrencySymbol(displayQuote);
  const sign = converted < 0 ? "-" : "";
  const abs  = Math.abs(converted);
  if (compact) {
    if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(decimals ?? 1)}M`;
    if (abs >= 1_000)     return `${sign}${symbol}${(abs / 1_000).toFixed(decimals ?? 1)}K`;
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: displayQuote,
      minimumFractionDigits: decimals ?? 0,
      maximumFractionDigits: decimals ?? 0,
    }).format(converted);
  } catch {
    return `${sign}${symbol}${abs.toLocaleString()}`;
  }
}
