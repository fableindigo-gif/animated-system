import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { authFetch } from "@/lib/auth-fetch";
import { useCurrency, getCurrencySymbol } from "./currency-context";
import { useWorkspace } from "./workspace-context";
import { setActiveFxRate } from "./fx-runtime";

const BASE     = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FxRateInfo = {
  rate:     number;
  source:   "override" | "cache" | "fallback" | "fetched";
  rateDate: string; // YYYY-MM-DD
};

interface FxContextValue {
  /** USD→quote rate currently active for the user (today). */
  rate:       number;
  source:     FxRateInfo["source"];
  rateDate:   string;
  /** True while the first rate for the active currency is loading. */
  loading:    boolean;
  /**
   * Convert a USD amount to the user's preferred currency using today's rate.
   * Returns the input untouched if the user's preferred currency is USD.
   */
  convert:    (amountUsd: number) => number;
  /**
   * Convert a USD amount to ANY currency code using today's cached rate.
   * Falls back to 1.0 (effectively USD passthrough) if not yet loaded.
   */
  convertTo:  (amountUsd: number, quote: string) => number;
  /**
   * Pre-fetch a rate for a non-active currency (e.g. mixed-currency Shopify
   * accounts). Idempotent; a no-op if the rate is already cached.
   */
  ensureRate: (quote: string, date?: string) => Promise<void>;
  /** Look up the rate info for any currency (returns null until fetched). */
  rateFor:    (quote: string, date?: string) => FxRateInfo | null;
  /**
   * Convert a USD warehouse value into the user's preferred display currency
   * AND format it with the correct symbol/locale. This is the canonical
   * function for rendering any monetary KPI sourced from the warehouse.
   */
  formatFromUsd: (amountUsd: number, opts?: { compact?: boolean; decimals?: number }) => string;
  /**
   * Date-aware variant of `formatFromUsd`. Use when rendering a KPI tied to a
   * specific period — e.g. last quarter's revenue should use last quarter's
   * end-date FX rate, not today's. The date must be ISO `YYYY-MM-DD`.
   *
   * If the rate for that date is not yet cached this kicks off a background
   * fetch and renders today's rate in the meantime.
   */
  formatFromUsdAt: (
    amountUsd: number,
    date: string,
    opts?: { compact?: boolean; decimals?: number },
  ) => string;
  /**
   * Drop the in-memory rate cache so subsequent reads re-fetch from the
   * server. Call this after admins mutate `/api/fx/overrides` so dashboards
   * pick up the new "source: override" rate without a full page reload.
   */
  invalidateCache: () => void;
}

const FxContext = createContext<FxContextValue>({
  rate:      1,
  source:    "fallback",
  rateDate:  new Date().toISOString().slice(0, 10),
  loading:   false,
  convert:   (n) => n,
  convertTo: (n) => n,
  ensureRate:    async () => {},
  rateFor:       () => null,
  formatFromUsd:   (n) => `$${n.toLocaleString()}`,
  formatFromUsdAt: (n) => `$${n.toLocaleString()}`,
  invalidateCache: () => {},
});

// ─── Provider ────────────────────────────────────────────────────────────────

const cacheKey = (quote: string, date: string) => `${quote.toUpperCase()}|${date}`;

export function FxProvider({ children }: { children: ReactNode }) {
  const { currencyCode } = useCurrency();
  const { activeWorkspace } = useWorkspace();
  const workspaceId = (activeWorkspace as { id?: number } | null)?.id ?? null;

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Per-(quote,date) rate cache. Persisted in-memory only; the server-side
  // table provides cross-session persistence.
  const [cache, setCache] = useState<Record<string, FxRateInfo>>(() => ({
    [cacheKey("USD", todayIso)]: { rate: 1, source: "cache", rateDate: todayIso },
  }));
  const [loading, setLoading] = useState(false);

  // Avoid duplicate inflight requests for the same (quote, date).
  const inflightRef = useRef<Record<string, Promise<void> | undefined>>({});

  const fetchRate = useCallback(async (quote: string, date: string) => {
    const key = cacheKey(quote, date);
    if (cache[key]) return;
    const existing = inflightRef.current[key];
    if (existing) return existing;

    const promise = (async () => {
      try {
        const qs = new URLSearchParams({ quotes: quote, date });
        if (workspaceId != null) qs.set("workspaceId", String(workspaceId));
        const resp = await authFetch(`${API_BASE}api/fx/rates?${qs.toString()}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json() as {
          ok?: boolean;
          rates?: Record<string, { rate: number; source: FxRateInfo["source"]; rateDate: string }>;
        };
        const entry = json.rates?.[quote.toUpperCase()];
        if (entry) {
          setCache((prev) => ({ ...prev, [key]: entry }));
        }
      } catch {
        // Last-resort fallback so a broken provider doesn't break the UI.
        setCache((prev) => prev[key] ? prev : {
          ...prev,
          [key]: { rate: 1, source: "fallback", rateDate: date },
        });
      } finally {
        delete inflightRef.current[key];
      }
    })();
    inflightRef.current[key] = promise;
    return promise;
  }, [cache, workspaceId]);

  // Whenever the user's chosen currency (or workspace) changes, ensure we
  // have today's rate ready before any KPI tile mounts.
  useEffect(() => {
    if (!currencyCode || currencyCode.toUpperCase() === "USD") {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchRate(currencyCode, todayIso).finally(() => setLoading(false));
  }, [currencyCode, todayIso, fetchRate]);

  const ensureRate = useCallback(async (quote: string, date?: string) => {
    await fetchRate(quote.toUpperCase(), date ?? todayIso);
  }, [fetchRate, todayIso]);

  const rateFor = useCallback((quote: string, date?: string): FxRateInfo | null => {
    return cache[cacheKey(quote, date ?? todayIso)] ?? null;
  }, [cache, todayIso]);

  const activeKey = cacheKey(currencyCode, todayIso);
  const activeInfo: FxRateInfo = cache[activeKey] ?? { rate: 1, source: "fallback", rateDate: todayIso };

  // Push the active rate into the module-level runtime so non-React-context
  // helpers (CurrencyContext.formatMoney) can convert USD→display safely.
  useEffect(() => {
    const trust = activeInfo.source === "fallback" ? "fallback" : "trusted";
    setActiveFxRate(currencyCode, activeInfo.rate, trust, activeInfo.rateDate, activeInfo.source);
  }, [currencyCode, activeInfo.rate, activeInfo.source, activeInfo.rateDate]);

  const convert = useCallback((amountUsd: number): number => {
    if (!Number.isFinite(amountUsd)) return amountUsd;
    return amountUsd * activeInfo.rate;
  }, [activeInfo.rate]);

  const convertTo = useCallback((amountUsd: number, quote: string): number => {
    if (!Number.isFinite(amountUsd)) return amountUsd;
    const info = cache[cacheKey(quote, todayIso)];
    return amountUsd * (info?.rate ?? 1);
  }, [cache, todayIso]);

  const formatWithRate = useCallback((
    amountUsd: number,
    rate: number,
    opts: { compact?: boolean; decimals?: number } = {},
  ): string => {
    const { compact = false, decimals } = opts;
    const converted = Number.isFinite(amountUsd) ? amountUsd * rate : amountUsd;
    const symbol = getCurrencySymbol(currencyCode);
    const sign = converted < 0 ? "-" : "";
    const abs = Math.abs(converted);
    if (compact) {
      if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(decimals ?? 1)}M`;
      if (abs >= 1_000)     return `${sign}${symbol}${(abs / 1_000).toFixed(decimals ?? 1)}k`;
    }
    try {
      return new Intl.NumberFormat("en-US", {
        style:                 "currency",
        currency:              currencyCode,
        minimumFractionDigits: decimals ?? 0,
        maximumFractionDigits: decimals ?? 0,
      }).format(converted);
    } catch {
      return `${sign}${symbol}${abs.toLocaleString()}`;
    }
  }, [currencyCode]);

  const formatFromUsd = useCallback((
    amountUsd: number,
    opts: { compact?: boolean; decimals?: number } = {},
  ): string => formatWithRate(amountUsd, activeInfo.rate, opts),
  [activeInfo.rate, formatWithRate]);

  // Date-aware: look up the rate cached for `date`, fall back to today's
  // active rate while a background fetch warms the cache.
  const formatFromUsdAt = useCallback((
    amountUsd: number,
    date: string,
    opts: { compact?: boolean; decimals?: number } = {},
  ): string => {
    if (!currencyCode || currencyCode.toUpperCase() === "USD") {
      return formatWithRate(amountUsd, 1, opts);
    }
    const key = cacheKey(currencyCode, date);
    const info = cache[key];
    if (!info) {
      // Kick off a background fetch — render today's rate this paint cycle.
      void fetchRate(currencyCode, date);
      return formatWithRate(amountUsd, activeInfo.rate, opts);
    }
    return formatWithRate(amountUsd, info.rate, opts);
  }, [cache, currencyCode, activeInfo.rate, fetchRate, formatWithRate]);

  const invalidateCache = useCallback(() => {
    // Soft invalidation: drop only the active currency's today entry so the
    // active-currency effect re-fetches it (fetchRate short-circuits on cache
    // hits, so we must remove the key first). Other (quote, date) entries
    // remain so dashboards don't flash the USD-identity fallback for past
    // periods that aren't affected by this override change.
    inflightRef.current = {};
    if (currencyCode && currencyCode.toUpperCase() !== "USD") {
      const activeKey = cacheKey(currencyCode, todayIso);
      setCache((prev) => {
        if (!(activeKey in prev)) return prev;
        const next = { ...prev };
        delete next[activeKey];
        return next;
      });
    }
  }, [currencyCode, todayIso]);

  const value: FxContextValue = {
    rate:     activeInfo.rate,
    source:   activeInfo.source,
    rateDate: activeInfo.rateDate,
    loading,
    convert,
    convertTo,
    ensureRate,
    rateFor,
    formatFromUsd,
    formatFromUsdAt,
    invalidateCache,
  };

  return <FxContext.Provider value={value}>{children}</FxContext.Provider>;
}

export function useFx() {
  return useContext(FxContext);
}
