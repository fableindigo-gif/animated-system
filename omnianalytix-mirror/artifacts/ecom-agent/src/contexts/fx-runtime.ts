/**
 * Module-level FX runtime. The `FxProvider` writes the active USD→display
 * rate here on every change so non-FX-aware code paths (most notably
 * `CurrencyContext.formatMoney`) can perform safe USD→display conversion
 * without participating in the React context graph.
 *
 * This indirection exists because `CurrencyProvider` sits ABOVE `FxProvider`
 * in the tree (see App.tsx) — `FxProvider` cannot use `useCurrency()`
 * downstream of itself if currency must be a parent of fx, so we reverse
 * the data flow via this module-level ref.
 *
 * NEVER read this from React rendering code — use `useFx()` instead.
 * Use this only inside helpers that cannot access React context.
 */
// Source provenance is tracked alongside the rate so callers can degrade to
// USD-with-$ when the rate is a fallback rather than mislabel a USD value
// with a foreign currency symbol.
//
// `activeSource` preserves the full fine-grained provenance string published by
// `FxProvider` ("override" | "cache" | "fetched" | "fallback") rather than
// collapsing it to the binary "trusted"/"fallback" used internally for USD
// honesty checks. This lets export helpers report the same source label that
// `<MoneyTile>` shows in its hover tooltip.
let activeRate: number = 1;
let activeQuote: string = "USD";
let activeSourceTrust: "trusted" | "fallback" = "trusted";
let activeSource: string = "cache";
let activeRateDate: string = new Date().toISOString().slice(0, 10);

export function setActiveFxRate(
  quote: string,
  rate: number,
  source: "trusted" | "fallback" = "trusted",
  rateDate?: string,
  /** Full fine-grained source label (override | cache | fetched | fallback). */
  fullSource?: string,
): void {
  activeQuote       = (quote || "USD").toUpperCase();
  activeRate        = Number.isFinite(rate) && rate > 0 ? rate : 1;
  activeSourceTrust = activeQuote === "USD" ? "trusted" : source;
  activeSource      = fullSource ?? (source === "fallback" ? "fallback" : "cache");
  activeRateDate    = rateDate ?? new Date().toISOString().slice(0, 10);
}

export function getActiveFxRate(): {
  quote: string;
  rate: number;
  /** Binary trust level — use for USD-fallback honesty checks. */
  source: "trusted" | "fallback";
  /** Full provenance label: "override" | "cache" | "fetched" | "fallback". */
  fullSource: string;
  rateDate: string;
} {
  return {
    quote:      activeQuote,
    rate:       activeRate,
    source:     activeSourceTrust,
    fullSource: activeSource,
    rateDate:   activeRateDate,
  };
}
