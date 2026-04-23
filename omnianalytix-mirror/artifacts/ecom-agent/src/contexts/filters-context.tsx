import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from "react";

// ─── Dimensions ────────────────────────────────────────────────────────────────
// The set of filter dimensions any dashboard page may declare. Each dashboard
// page picks the subset it supports via <FilterBar dimensions={[...]} />.
export type DimensionId =
  | "account"
  | "platform"
  | "campaign"
  | "adGroup"
  | "country"
  | "region"
  | "brand"
  | "collection"
  | "sku"
  | "segment"
  | "device"
  | "network"
  | "lifecycle"
  | "status";

export type FilterValues = Partial<Record<DimensionId, string[]>>;

// ─── Numeric metric thresholds ─────────────────────────────────────────────────
// Sliders / numeric inputs in the FilterBar; backend translates them into
// HAVING clauses. POAS thresholds require COGS to be computed and so are
// honoured only in /channels (not /kpis or /margin-leaks).
export type ThresholdKey =
  | "minSpend"
  | "maxSpend"
  | "minRoas"
  | "maxRoas"
  | "minPoas"
  | "maxPoas"
  | "minConv"
  | "maxConv";

export type Thresholds = Partial<Record<ThresholdKey, number>>;

export interface AdvancedFilterState {
  dims: FilterValues;
  q: string;
  thresholds: Thresholds;
}

const EMPTY_STATE: AdvancedFilterState = { dims: {}, q: "", thresholds: {} };

interface FiltersContextValue {
  getState: (pageKey: string) => AdvancedFilterState;
  setDims:       (pageKey: string, dims: FilterValues) => void;
  toggleValue:   (pageKey: string, dim: DimensionId, value: string) => void;
  setQ:          (pageKey: string, q: string) => void;
  setThreshold:  (pageKey: string, key: ThresholdKey, value: number | null) => void;
  setState:      (pageKey: string, state: AdvancedFilterState) => void;
  clear:         (pageKey: string) => void;
  refreshKey: number;
}

const FiltersContext = createContext<FiltersContextValue>({
  getState: () => EMPTY_STATE,
  setDims:      () => {},
  toggleValue:  () => {},
  setQ:         () => {},
  setThreshold: () => {},
  setState:     () => {},
  clear:        () => {},
  refreshKey: 0,
});

const STORAGE_PREFIX = "omni_filters_";
const URL_PREFIX     = "f.";
const Q_KEY          = "q";

const DIMENSION_IDS: ReadonlySet<string> = new Set<DimensionId>([
  "account", "platform", "campaign", "adGroup", "country", "region",
  "brand", "collection", "sku", "segment", "device", "network",
  "lifecycle", "status",
]);

const THRESHOLD_KEYS: ReadonlySet<string> = new Set<ThresholdKey>([
  "minSpend", "maxSpend", "minRoas", "maxRoas", "minPoas", "maxPoas", "minConv", "maxConv",
]);

// ─── URL <-> state codecs ──────────────────────────────────────────────────────
function stateFromUrl(): AdvancedFilterState {
  if (typeof window === "undefined") return EMPTY_STATE;
  const params = new URLSearchParams(window.location.search);
  const dims: FilterValues = {};
  const thresholds: Thresholds = {};
  let q = "";
  for (const [k, v] of params.entries()) {
    if (!k.startsWith(URL_PREFIX) || !v) continue;
    const tail = k.slice(URL_PREFIX.length);
    if (tail === Q_KEY) {
      q = v;
    } else if (THRESHOLD_KEYS.has(tail)) {
      const n = Number(v);
      if (Number.isFinite(n)) thresholds[tail as ThresholdKey] = n;
    } else if (DIMENSION_IDS.has(tail)) {
      dims[tail as DimensionId] = v.split(",").filter(Boolean);
    }
  }
  return { dims, q, thresholds };
}

function stateFromStorage(pageKey: string): AdvancedFilterState {
  if (typeof localStorage === "undefined") return EMPTY_STATE;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + pageKey);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return EMPTY_STATE;
    // Backward compat: old shape was `Partial<Record<DimensionId, string[]>>`
    // saved at the top level. Detect by looking for a `dims` field.
    if ("dims" in parsed || "q" in parsed || "thresholds" in parsed) {
      const dims: FilterValues = {};
      if (parsed.dims && typeof parsed.dims === "object") {
        for (const [k, v] of Object.entries(parsed.dims)) {
          if (Array.isArray(v) && v.every((x) => typeof x === "string") && DIMENSION_IDS.has(k)) {
            dims[k as DimensionId] = v as string[];
          }
        }
      }
      const thresholds: Thresholds = {};
      if (parsed.thresholds && typeof parsed.thresholds === "object") {
        for (const [k, v] of Object.entries(parsed.thresholds)) {
          if (THRESHOLD_KEYS.has(k) && typeof v === "number" && Number.isFinite(v)) {
            thresholds[k as ThresholdKey] = v;
          }
        }
      }
      const q = typeof parsed.q === "string" ? parsed.q : "";
      return { dims, q, thresholds };
    }
    // Legacy shape — top-level dim keys.
    const dims: FilterValues = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (Array.isArray(v) && v.every((x) => typeof x === "string") && DIMENSION_IDS.has(k)) {
        dims[k as DimensionId] = v as string[];
      }
    }
    return { dims, q: "", thresholds: {} };
  } catch {
    return EMPTY_STATE;
  }
}

function persist(pageKey: string, s: AdvancedFilterState) {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(STORAGE_PREFIX + pageKey, JSON.stringify(s));
    } catch { /* quota */ }
  }
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  // Strip every f.* before re-writing.
  Array.from(url.searchParams.keys())
    .filter((k) => k.startsWith(URL_PREFIX))
    .forEach((k) => url.searchParams.delete(k));
  for (const [dim, arr] of Object.entries(s.dims)) {
    if (arr && arr.length > 0) url.searchParams.set(URL_PREFIX + dim, arr.join(","));
  }
  if (s.q) url.searchParams.set(URL_PREFIX + Q_KEY, s.q);
  for (const [k, v] of Object.entries(s.thresholds)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      url.searchParams.set(URL_PREFIX + k, String(v));
    }
  }
  window.history.replaceState({}, "", url.toString());
}

function cleanState(s: AdvancedFilterState): AdvancedFilterState {
  const dims: FilterValues = {};
  for (const [k, v] of Object.entries(s.dims)) {
    if (v && v.length > 0) dims[k as DimensionId] = v;
  }
  const thresholds: Thresholds = {};
  for (const [k, v] of Object.entries(s.thresholds)) {
    if (typeof v === "number" && Number.isFinite(v)) thresholds[k as ThresholdKey] = v;
  }
  return { dims, q: s.q ?? "", thresholds };
}

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [state, setStateMap] = useState<Record<string, AdvancedFilterState>>({});
  const [refreshKey, setRefreshKey] = useState(0);

  const getState = useCallback(
    (pageKey: string): AdvancedFilterState => {
      const cached = state[pageKey];
      if (cached) return cached;
      // Lazy-init — URL > localStorage. We don't write back here to avoid an
      // unwanted setState during render; first explicit setter does.
      const url = stateFromUrl();
      const hasUrl = url.q || Object.keys(url.dims).length > 0 || Object.keys(url.thresholds).length > 0;
      if (hasUrl) return url;
      return stateFromStorage(pageKey);
    },
    [state],
  );

  const writeState = useCallback((pageKey: string, next: AdvancedFilterState) => {
    const clean = cleanState(next);
    setStateMap((prev) => ({ ...prev, [pageKey]: clean }));
    setRefreshKey((k) => k + 1);
    persist(pageKey, clean);
  }, []);

  const setDims = useCallback((pageKey: string, dims: FilterValues) => {
    const cur = state[pageKey] ?? stateFromUrl();
    writeState(pageKey, { ...cur, dims });
  }, [state, writeState]);

  const toggleValue = useCallback(
    (pageKey: string, dim: DimensionId, value: string) => {
      const cached = state[pageKey];
      const base = cached
        ?? (Object.keys(stateFromUrl().dims).length > 0 ? stateFromUrl() : stateFromStorage(pageKey));
      const current = base.dims[dim] ?? [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      writeState(pageKey, { ...base, dims: { ...base.dims, [dim]: next } });
    },
    [state, writeState],
  );

  const setQ = useCallback((pageKey: string, q: string) => {
    const cur = state[pageKey] ?? stateFromUrl();
    writeState(pageKey, { ...cur, q });
  }, [state, writeState]);

  const setThreshold = useCallback((pageKey: string, key: ThresholdKey, value: number | null) => {
    const cur = state[pageKey] ?? stateFromUrl();
    const next: Thresholds = { ...cur.thresholds };
    if (value == null || !Number.isFinite(value)) delete next[key];
    else next[key] = value;
    writeState(pageKey, { ...cur, thresholds: next });
  }, [state, writeState]);

  const setStateFor = useCallback((pageKey: string, s: AdvancedFilterState) => {
    writeState(pageKey, s);
  }, [writeState]);

  const clear = useCallback((pageKey: string) => writeState(pageKey, EMPTY_STATE), [writeState]);

  // Hydrate URL state into in-memory store on first mount.
  useEffect(() => {
    const url = stateFromUrl();
    const hasUrl = url.q || Object.keys(url.dims).length > 0 || Object.keys(url.thresholds).length > 0;
    if (!hasUrl) return;
    setStateMap((prev) => ({ ...prev, __url__: url }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<FiltersContextValue>(
    () => ({ getState, setDims, toggleValue, setQ, setThreshold, setState: setStateFor, clear, refreshKey }),
    [getState, setDims, toggleValue, setQ, setThreshold, setStateFor, clear, refreshKey],
  );

  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
}

/** Hook that scopes filter ops to a specific page key. */
export function useFilters(pageKey: string) {
  const ctx = useContext(FiltersContext);
  const s = ctx.getState(pageKey);
  return {
    state: s,
    filters: s.dims,        // back-compat alias for callers that only need dim filters
    q: s.q,
    thresholds: s.thresholds,
    setDims:        (v: FilterValues) => ctx.setDims(pageKey, v),
    setFilters:     (v: FilterValues) => ctx.setDims(pageKey, v),  // back-compat
    toggleValue:    (dim: DimensionId, value: string) => ctx.toggleValue(pageKey, dim, value),
    setQ:           (v: string) => ctx.setQ(pageKey, v),
    setThreshold:   (k: ThresholdKey, v: number | null) => ctx.setThreshold(pageKey, k, v),
    setState:       (s: AdvancedFilterState) => ctx.setState(pageKey, s),
    clear:          () => ctx.clear(pageKey),
    refreshKey:     ctx.refreshKey,
  };
}

/** Build URL search-params fragment for sending the full advanced filter state to the API. */
export function filtersToQueryString(s: AdvancedFilterState | FilterValues): string {
  const params = new URLSearchParams();
  // Back-compat: callers passing a plain FilterValues map.
  const normalized: AdvancedFilterState =
    "dims" in (s as object) || "q" in (s as object) || "thresholds" in (s as object)
      ? (s as AdvancedFilterState)
      : { dims: s as FilterValues, q: "", thresholds: {} };
  for (const [dim, arr] of Object.entries(normalized.dims)) {
    if (arr && arr.length > 0) params.set(`filter.${dim}`, arr.join(","));
  }
  if (normalized.q) params.set("filter.q", normalized.q);
  for (const [k, v] of Object.entries(normalized.thresholds)) {
    if (typeof v === "number" && Number.isFinite(v)) params.set(`filter.${k}`, String(v));
  }
  const out = params.toString();
  return out ? `&${out}` : "";
}
