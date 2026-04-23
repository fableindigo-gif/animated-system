import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAccount } from "./account-context";
import { useWorkspace } from "./workspace-context";
import { COUNTRY_CURRENCY } from "@/lib/localization/country-currency";
import { getActiveFxRate } from "./fx-runtime";

// ── Public types ──────────────────────────────────────────────────────────
export interface CurrencyOption {
  code: string;
  symbol: string;
  /**
   * Where this option came from in the resolution chain. Used by the UI to
   * label "(detected from Shopify)" vs "(your override)" etc.
   */
  source: "override" | "auto-account" | "auto-workspace" | "fallback";
}

interface CurrencyContextValue {
  /** Currently displayed currency (override > auto-account > workspace HQ > USD). */
  currencyCode: string;
  currencySymbol: string;
  /** Provenance of `currencyCode` — drives badging in the switcher. */
  currencySource: CurrencyOption["source"];
  /** Codes auto-detected from connected ad/commerce accounts. */
  detectedCurrencies: string[];
  /** Manual override (null = follow auto-detect). */
  displayOverride: string | null;
  setDisplayOverride: (code: string | null) => void;

  /**
   * Formats a USD `amount` in the user's preferred display currency.
   *
   * As of the multi-currency rollout (#61), `formatMoney` ALWAYS treats its
   * input as a USD warehouse value and converts it to the active display
   * currency using the live FX rate published by `FxProvider`. This makes
   * the function safe to use across every dashboard without per-call
   * decisions about whether to reach for `formatFromUsd`.
   *
   * Prefer `useFx().formatFromUsd` (or the date-aware `formatFromUsdAt`)
   * inside React components for richer auditability metadata.
   */
  formatMoney: (amount: number, opts?: { compact?: boolean; decimals?: number }) => string;

  /**
   * Formats `amount` as USD with a `$` prefix, regardless of the user's
   * preferred display currency. Use this for every monetary value that
   * comes from the warehouse — it is the only honest answer until we
   * wire a forex-rate source.
   */
  formatUsd: (amount: number, opts?: { compact?: boolean; decimals?: number }) => string;
}

const STORAGE_KEY = "omni_currency_override";

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", GBP: "£", EUR: "€", INR: "₹", AUD: "A$", CAD: "C$",
  JPY: "¥", CNY: "¥", SGD: "S$", AED: "د.إ", NZD: "NZ$",
  SAR: "﷼", BRL: "R$", MXN: "MX$", KRW: "₩", SEK: "kr", NOK: "kr",
  DKK: "kr", CHF: "CHF", PLN: "zł", ZAR: "R", ILS: "₪", TRY: "₺",
  HKD: "HK$", TWD: "NT$", THB: "฿", PHP: "₱", MYR: "RM", IDR: "Rp",
  VND: "₫", CLP: "CL$", COP: "COL$", ARS: "AR$", NGN: "₦", KES: "KSh",
  EGP: "E£", PKR: "₨",
};

export function getCurrencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code.toUpperCase()] ?? code.toUpperCase();
}

export function listSupportedCurrencies(): { code: string; symbol: string }[] {
  return Object.entries(CURRENCY_SYMBOLS).map(([code, symbol]) => ({ code, symbol }));
}

function formatUsdImpl(amount: number, opts: { compact?: boolean; decimals?: number } = {}): string {
  const { compact = false, decimals } = opts;
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (compact) {
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(decimals ?? 1)}M`;
    if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(decimals ?? 1)}K`;
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: decimals ?? 0,
      maximumFractionDigits: decimals ?? 0,
    }).format(amount);
  } catch {
    return `${sign}$${abs.toLocaleString()}`;
  }
}

const CurrencyContext = createContext<CurrencyContextValue>({
  currencyCode: "USD",
  currencySymbol: "$",
  currencySource: "fallback",
  detectedCurrencies: [],
  displayOverride: null,
  setDisplayOverride: () => {},
  formatMoney: (n) => formatUsdImpl(n),
  formatUsd:   (n, opts) => formatUsdImpl(n, opts),
});

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { activeAccount, accounts } = useAccount();
  const { activeWorkspace } = useWorkspace();

  // ── Manual override (localStorage-backed) ──────────────────────────────
  const [displayOverride, setDisplayOverrideState] = useState<string | null>(() => {
    // SSR safety: guard against builds that pre-render outside the browser.
    if (typeof window === "undefined") return null;
    try {
      const v = window.localStorage.getItem(STORAGE_KEY);
      return v && v.trim() ? v.toUpperCase() : null;
    } catch {
      return null;
    }
  });

  const setDisplayOverride = useCallback((code: string | null) => {
    const norm = code ? code.toUpperCase() : null;
    setDisplayOverrideState(norm);
    if (typeof window === "undefined") return;
    try {
      if (norm) window.localStorage.setItem(STORAGE_KEY, norm);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch { /* private mode / quota — best effort only */ }
  }, []);

  // Cross-tab sync so the switcher in one tab reflects in another.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setDisplayOverrideState(e.newValue && e.newValue.trim() ? e.newValue.toUpperCase() : null);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // ── Resolution chain ───────────────────────────────────────────────────
  const detectedCurrencies = useMemo(() => {
    const set = new Set<string>();
    for (const a of accounts) {
      if (a.currency) set.add(a.currency.toUpperCase());
    }
    return Array.from(set);
  }, [accounts]);

  const hqCountry  = (activeWorkspace as Record<string, unknown> | null)?.headquartersCountry as string | undefined;
  const hqCurrency = hqCountry ? COUNTRY_CURRENCY[hqCountry] : undefined;

  let resolvedCode: string;
  let resolvedSource: CurrencyOption["source"];
  if (displayOverride) {
    resolvedCode = displayOverride;
    resolvedSource = "override";
  } else if (activeAccount?.currency) {
    resolvedCode = activeAccount.currency.toUpperCase();
    resolvedSource = "auto-account";
  } else if (hqCurrency) {
    resolvedCode = hqCurrency.toUpperCase();
    resolvedSource = "auto-workspace";
  } else {
    resolvedCode = "USD";
    resolvedSource = "fallback";
  }

  const currencyCode   = resolvedCode;
  const currencySymbol = getCurrencySymbol(currencyCode);

  const formatMoney = useMemo(() => (
    amountUsd: number,
    opts: { compact?: boolean; decimals?: number } = {},
  ): string => {
    const { compact = false, decimals } = opts;
    // Convert USD warehouse value → display currency using the live FX rate
    // published by FxProvider via `setActiveFxRate`. If the active quote
    // doesn't match (e.g. Fx hasn't loaded yet) we still produce a number
    // — at worst it's USD-on-USD (rate=1) which is correct for USD users.
    const { quote, rate, source } = getActiveFxRate();
    // Honesty rule: when no trusted rate exists, render USD with `$` rather
    // than mislabel a USD value with the user's preferred currency symbol.
    // Only trust the runtime rate when (a) it's marked trusted and (b) the
    // active quote matches the requested currencyCode. Otherwise degrade to
    // USD/$ to avoid mislabeling or applying a stale prior-currency rate
    // mid-switch.
    const rateUsable = source !== "fallback" && quote === currencyCode;
    const useFallbackUsd = !rateUsable && currencyCode !== "USD";
    const displayCode    = useFallbackUsd ? "USD" : currencyCode;
    const displaySymbol  = useFallbackUsd ? "$"   : currencySymbol;
    const useRate        = useFallbackUsd ? 1 : (currencyCode === "USD" ? 1 : rate);
    const amount  = Number.isFinite(amountUsd) ? amountUsd * useRate : amountUsd;
    if (compact) {
      if (Math.abs(amount) >= 1_000_000) {
        return `${displaySymbol}${(amount / 1_000_000).toFixed(decimals ?? 1)}M`;
      }
      if (Math.abs(amount) >= 1_000) {
        return `${displaySymbol}${(amount / 1_000).toFixed(decimals ?? 1)}K`;
      }
    }
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: displayCode,
        minimumFractionDigits: decimals ?? 0,
        maximumFractionDigits: decimals ?? 0,
      }).format(amount);
    } catch {
      return `${displaySymbol}${amount.toLocaleString()}`;
    }
  }, [currencyCode, currencySymbol]);

  const value: CurrencyContextValue = {
    currencyCode,
    currencySymbol,
    currencySource: resolvedSource,
    detectedCurrencies,
    displayOverride,
    setDisplayOverride,
    formatMoney,
    formatUsd: formatUsdImpl,
  };

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  return useContext(CurrencyContext);
}
