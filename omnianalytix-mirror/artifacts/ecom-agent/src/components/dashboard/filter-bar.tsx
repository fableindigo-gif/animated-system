import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, X, Filter, Bookmark, BookmarkPlus, Loader2, Search, Sliders } from "lucide-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth-fetch";
import {
  FLOATING_LAYER_EVENT,
  dispatchFloatingLayerOpen,
  type FloatingLayerEventDetail,
} from "@/lib/floating-layer-events";
import { useWorkspace } from "@/contexts/workspace-context";
import { useDateRange } from "@/contexts/date-range-context";
import {
  useFilters,
  type DimensionId,
  type FilterValues,
  type ThresholdKey,
  type Thresholds,
} from "@/contexts/filters-context";

const BASE     = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

// ─── Hint cache ───────────────────────────────────────────────────────────────
// Keyed by dim id. Shared across all FilterBar instances so the network request
// only fires once per session (first pill that opens for a given dimension).
const FETCHABLE_DIMS: ReadonlySet<DimensionId> = new Set(["campaign", "sku"]);
type HintEntry = { status: "loading" | "ok" | "error"; values: string[] };
const _hintsCache = new Map<string, HintEntry>();

async function fetchHints(dim: DimensionId): Promise<string[]> {
  const cached = _hintsCache.get(dim);
  if (cached?.status === "ok")      return cached.values;
  if (cached?.status === "loading") return [];
  _hintsCache.set(dim, { status: "loading", values: [] });
  try {
    const res  = await authFetch(`${API_BASE}api/warehouse/filter-hints?dims=${dim}`);
    const json = (await res.json()) as Record<string, string[]>;
    const vals = (json[dim] ?? []).filter(Boolean);
    _hintsCache.set(dim, { status: "ok", values: vals });
    return vals;
  } catch {
    _hintsCache.set(dim, { status: "error", values: [] });
    return [];
  }
}

// ─── Static option lists ───────────────────────────────────────────────────────
const STATIC_OPTIONS: Partial<Record<DimensionId, { value: string; label: string }[]>> = {
  platform: [
    { value: "google_ads",  label: "Google Ads" },
    { value: "meta_ads",    label: "Meta Ads" },
    { value: "tiktok_ads",  label: "TikTok Ads" },
    { value: "shopify",     label: "Shopify" },
    { value: "gmc",         label: "Merchant Center" },
  ],
  device: [
    { value: "mobile",  label: "Mobile" },
    { value: "desktop", label: "Desktop" },
    { value: "tablet",  label: "Tablet" },
  ],
  network: [
    { value: "search",   label: "Search" },
    { value: "display",  label: "Display" },
    { value: "shopping", label: "Shopping" },
    { value: "pmax",     label: "Performance Max" },
    { value: "youtube",  label: "YouTube" },
  ],
  lifecycle: [
    { value: "awareness",     label: "Awareness" },
    { value: "consideration", label: "Consideration" },
    { value: "conversion",    label: "Conversion" },
    { value: "retention",     label: "Retention" },
  ],
  segment: [
    { value: "new",        label: "New customers" },
    { value: "returning",  label: "Returning customers" },
    { value: "ltv_high",   label: "High LTV" },
    { value: "ltv_low",    label: "Low LTV" },
  ],
  status: [
    { value: "ENABLED",  label: "Enabled" },
    { value: "PAUSED",   label: "Paused" },
    { value: "LEARNING", label: "Learning" },
    { value: "REMOVED",  label: "Removed" },
  ],
};

const DIM_LABELS: Record<DimensionId, string> = {
  account:    "Account",
  platform:   "Platform",
  campaign:   "Campaign",
  adGroup:    "Ad group",
  country:    "Country",
  region:     "Region",
  brand:      "Brand",
  collection: "Collection",
  sku:        "SKU",
  segment:    "Segment",
  device:     "Device",
  network:    "Network",
  lifecycle:  "Lifecycle",
  status:     "Status",
};

export interface DimensionSpec {
  id: DimensionId;
  label?: string;
  options?: { value: string; label: string }[];
}

// Task #25: close this popover whenever a non-FilterBar floating layer opens.
function useCloseOnOtherFloatingOpen(close: () => void) {
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<FloatingLayerEventDetail>;
      if (ce.detail?.source !== "filter-bar") close();
    };
    window.addEventListener(FLOATING_LAYER_EVENT, handler as EventListener);
    return () => window.removeEventListener(FLOATING_LAYER_EVENT, handler as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export interface FilterBarProps {
  pageKey: string;
  dimensions: DimensionSpec[];
  hideSavedViews?: boolean;
  /** Show the fuzzy text-search input. Default true. */
  enableSearch?: boolean;
  /** Show the numeric metric-threshold popover. Default true. */
  enableThresholds?: boolean;
  /** Placeholder for the search input. */
  searchPlaceholder?: string;
}

// ─── Multi-select dropdown ─────────────────────────────────────────────────────
function DimensionPill({
  spec,
  selected,
  onToggle,
  onClear,
}: {
  spec: DimensionSpec;
  selected: string[];
  onToggle: (v: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen]           = useState(false);
  const [tag, setTag]             = useState("");
  const [hintOpts, setHintOpts]   = useState<string[]>([]);
  const [hintLoading, setHintLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Task #25: close when the profile dropdown (or any other source) opens.
  useCloseOnOtherFloatingOpen(() => setOpen(false));

  // Fetch hints when this pill opens, if the dim is dynamically fetchable and
  // has no static options baked in.
  const staticOpts = spec.options ?? STATIC_OPTIONS[spec.id] ?? [];
  useEffect(() => {
    if (!open) return;
    if (staticOpts.length > 0) return;
    if (!FETCHABLE_DIMS.has(spec.id)) return;
    // Serve from cache immediately if already loaded, otherwise start fetch.
    const cached = _hintsCache.get(spec.id);
    if (cached?.status === "ok") {
      setHintOpts(cached.values);
      return;
    }
    setHintLoading(true);
    void fetchHints(spec.id).then((vals) => {
      setHintOpts(vals);
      setHintLoading(false);
    });
  }, [open, spec.id, staticOpts.length]);

  // Resolved options: static > dynamic hints > nothing (shows text input)
  const options = staticOpts.length > 0 ? staticOpts : hintOpts.map((v) => ({ value: v, label: v }));
  const label   = spec.label ?? DIM_LABELS[spec.id];
  const hasOpts = options.length > 0;

  const summary =
    selected.length === 0
      ? label
      : selected.length === 1
        ? `${label}: ${options.find((o) => o.value === selected[0])?.label ?? selected[0]}`
        : `${label}: ${selected.length}`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() =>
          setOpen((v) => {
            const next = !v;
            if (next) dispatchFloatingLayerOpen("filter-bar");
            return next;
          })
        }
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
          selected.length > 0
            ? "border-omni-primary/40 bg-blue-50 text-omni-primary"
            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
        )}
      >
        <span className="truncate max-w-[180px]">{summary}</span>
        {selected.length > 0 ? (
          <X
            className="w-3 h-3 hover:text-red-500"
            onClick={(e) => { e.stopPropagation(); onClear(); }}
          />
        ) : (
          <ChevronDown className="w-3 h-3" />
        )}
      </button>
      {open && (
        <div className="absolute z-[200] mt-1 min-w-[220px] max-w-[320px] rounded-xl border border-slate-200 bg-white shadow-lg p-1 max-h-72 overflow-y-auto">
          {hintLoading ? (
            <div className="flex items-center justify-center gap-2 py-4 text-xs text-slate-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading {label.toLowerCase()}…
            </div>
          ) : hasOpts ? (
            options.map((o) => {
              const checked = selected.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => onToggle(o.value)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-xs text-left hover:bg-slate-50"
                >
                  <span
                    className={cn(
                      "w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0",
                      checked ? "bg-omni-primary border-omni-primary" : "border-slate-300",
                    )}
                  >
                    {checked && <Check className="w-2.5 h-2.5 text-white" />}
                  </span>
                  <span className="text-slate-700 truncate">{o.label}</span>
                </button>
              );
            })
          ) : (
            <>
              <p className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-wider text-slate-400">
                Type a {label.toLowerCase()} to filter
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const t = tag.trim();
                  if (!t) return;
                  onToggle(t);
                  setTag("");
                }}
                className="flex gap-1 px-1 pb-1"
              >
                <input
                  autoFocus
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  placeholder={`e.g. ${spec.id === "country" ? "US" : "value"}`}
                  className="flex-1 text-xs px-2 py-1 border border-slate-200 rounded-md focus:outline-none focus:border-omni-primary"
                />
                <button
                  type="submit"
                  className="text-xs px-2 py-1 rounded-md bg-omni-primary text-white"
                >
                  Add
                </button>
              </form>
              {selected.length > 0 && (
                <div className="border-t border-slate-100 mt-1 pt-1 px-1 flex flex-wrap gap-1">
                  {selected.map((v) => (
                    <span
                      key={v}
                      className="inline-flex items-center gap-1 text-[11px] bg-blue-50 text-omni-primary rounded-full px-2 py-0.5"
                    >
                      {v}
                      <X className="w-2.5 h-2.5 cursor-pointer hover:text-red-500" onClick={() => onToggle(v)} />
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Numeric thresholds popover ───────────────────────────────────────────────
type ThresholdRow = {
  label:  string;
  minKey: ThresholdKey;
  maxKey: ThresholdKey;
  step:   number;
  prefix?: string;
};

const THRESHOLD_ROWS: ThresholdRow[] = [
  { label: "Spend",        minKey: "minSpend", maxKey: "maxSpend", step: 10,   prefix: "$" },
  { label: "ROAS",         minKey: "minRoas",  maxKey: "maxRoas",  step: 0.1 },
  { label: "POAS",         minKey: "minPoas",  maxKey: "maxPoas",  step: 0.1 },
  { label: "Conversions",  minKey: "minConv",  maxKey: "maxConv",  step: 1 },
];

function ThresholdsPill({
  thresholds,
  onChange,
}: {
  thresholds: Thresholds;
  onChange: (k: ThresholdKey, v: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Task #25: close when the profile dropdown (or any other source) opens.
  useCloseOnOtherFloatingOpen(() => setOpen(false));

  const activeCount = Object.keys(thresholds).length;
  const summary = activeCount === 0
    ? "Thresholds"
    : `Thresholds: ${activeCount}`;

  const NumInput = ({ k, placeholder }: { k: ThresholdKey; placeholder: string }) => {
    const v = thresholds[k];
    const [draft, setDraft] = useState<string>(v != null ? String(v) : "");
    useEffect(() => { setDraft(v != null ? String(v) : ""); }, [v]);
    return (
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft);
          onChange(k, draft === "" || !Number.isFinite(n) ? null : n);
        }}
        placeholder={placeholder}
        className="w-20 text-xs px-1.5 py-0.5 border border-slate-200 rounded-md focus:outline-none focus:border-omni-primary"
      />
    );
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() =>
          setOpen((v) => {
            const next = !v;
            if (next) dispatchFloatingLayerOpen("filter-bar");
            return next;
          })
        }
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
          activeCount > 0
            ? "border-omni-primary/40 bg-blue-50 text-omni-primary"
            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
        )}
      >
        <Sliders className="w-3 h-3" />
        <span>{summary}</span>
        {activeCount > 0 ? (
          <X
            className="w-3 h-3 hover:text-red-500"
            onClick={(e) => {
              e.stopPropagation();
              for (const row of THRESHOLD_ROWS) {
                onChange(row.minKey, null);
                onChange(row.maxKey, null);
              }
            }}
          />
        ) : (
          <ChevronDown className="w-3 h-3" />
        )}
      </button>
      {open && (
        <div className="absolute z-30 mt-1 min-w-[280px] rounded-xl border border-slate-200 bg-white shadow-lg p-2 space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-slate-400 px-1 pt-1">
            Per-campaign metric thresholds
          </p>
          {THRESHOLD_ROWS.map((r) => (
            <div key={r.label} className="flex items-center gap-2 px-1 py-0.5">
              <span className="text-xs text-slate-600 w-24 shrink-0">
                {r.prefix && <span className="text-slate-400">{r.prefix}</span>}
                {r.label}
              </span>
              <NumInput k={r.minKey} placeholder="min" />
              <span className="text-[10px] text-slate-400">to</span>
              <NumInput k={r.maxKey} placeholder="max" />
            </div>
          ))}
          <p className="text-[10px] text-slate-400 px-1 pt-1 leading-snug">
            ROAS = revenue ÷ spend. POAS uses gross margin and only applies to per-campaign views.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Search input (debounced) ─────────────────────────────────────────────────
function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (draft !== value) onChange(draft);
    }, 300);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  return (
    <div className="relative">
      <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "text-xs pl-6 pr-6 py-1.5 rounded-full border focus:outline-none w-44",
          draft
            ? "border-omni-primary/40 bg-blue-50 text-omni-primary placeholder:text-omni-primary/60"
            : "border-slate-200 bg-white text-slate-700 placeholder:text-slate-400 hover:border-slate-300 focus:border-omni-primary",
        )}
      />
      {draft && (
        <button
          type="button"
          onClick={() => { setDraft(""); onChange(""); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-red-500"
          aria-label="Clear search"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ─── Saved views ───────────────────────────────────────────────────────────────

interface SavedView {
  id: number;
  name: string;
  filters: FilterValues;
  datePreset: string | null;
  customFrom: string | null;
  customTo: string | null;
}

function SavedViewsMenu({ pageKey, current }: { pageKey: string; current: FilterValues }) {
  const { activeWorkspace } = useWorkspace();
  const { dateRange, setPreset, setCustomRange } = useDateRange();
  const { setFilters } = useFilters(pageKey);
  const [open, setOpen]   = useState(false);
  const [views, setViews] = useState<SavedView[]>([]);
  const [name, setName]   = useState("");
  const [busy, setBusy]   = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Task #25: close when the profile dropdown (or any other source) opens.
  useCloseOnOtherFloatingOpen(() => setOpen(false));

  const reload = async () => {
    if (!activeWorkspace) return;
    try {
      const r = await authFetch(`${API_BASE}api/saved-views?workspaceId=${activeWorkspace.id}&pageKey=${encodeURIComponent(pageKey)}`);
      if (!r.ok) return;
      const j = await r.json();
      setViews(Array.isArray(j.views) ? j.views : []);
    } catch { /* saved views are non-critical */ }
  };

  useEffect(() => { if (open) void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, activeWorkspace?.id, pageKey]);

  const save = async () => {
    if (!activeWorkspace || !name.trim()) return;
    setBusy(true);
    try {
      await authFetch(`${API_BASE}api/saved-views`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: activeWorkspace.id,
          pageKey,
          name: name.trim(),
          filters: current,
          datePreset: dateRange.preset,
          customFrom: dateRange.preset === "custom" ? dateRange.from.toISOString() : null,
          customTo:   dateRange.preset === "custom" ? dateRange.to.toISOString()   : null,
        }),
      });
      setName("");
      await reload();
    } finally { setBusy(false); }
  };

  const apply = (v: SavedView) => {
    setFilters(v.filters ?? {});
    if (v.datePreset === "custom" && v.customFrom && v.customTo) {
      setCustomRange(new Date(v.customFrom), new Date(v.customTo));
    } else if (v.datePreset) {
      setPreset(v.datePreset as Parameters<typeof setPreset>[0]);
    }
    setOpen(false);
  };

  const remove = async (id: number) => {
    if (!activeWorkspace) return;
    await authFetch(`${API_BASE}api/saved-views/${id}?workspaceId=${activeWorkspace.id}`, { method: "DELETE" });
    await reload();
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() =>
          setOpen((v) => {
            const next = !v;
            if (next) dispatchFloatingLayerOpen("filter-bar");
            return next;
          })
        }
        className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-300"
      >
        <Bookmark className="w-3 h-3" />
        Views
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-72 rounded-xl border border-slate-200 bg-white shadow-lg p-2">
          <div className="flex items-center gap-1 mb-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Save current as…"
              className="flex-1 text-xs px-2 py-1 border border-slate-200 rounded-md focus:outline-none focus:border-omni-primary"
            />
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || !name.trim()}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-omni-primary text-white disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <BookmarkPlus className="w-3 h-3" />}
              Save
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {views.length === 0 ? (
              <p className="text-[11px] text-slate-400 px-2 py-3 text-center">No saved views yet.</p>
            ) : (
              views.map((v) => (
                <div key={v.id} className="flex items-center gap-1 group hover:bg-slate-50 rounded-lg px-2 py-1">
                  <button
                    type="button"
                    onClick={() => apply(v)}
                    className="flex-1 text-left text-xs text-slate-700"
                  >
                    {v.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(v.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-red-500"
                    aria-label={`Delete ${v.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Public component ──────────────────────────────────────────────────────────
export function FilterBar({
  pageKey,
  dimensions,
  hideSavedViews,
  enableSearch = true,
  enableThresholds = true,
  searchPlaceholder = "Search campaigns, SKUs…",
}: FilterBarProps) {
  const {
    filters,
    q,
    thresholds,
    toggleValue,
    setFilters,
    setQ,
    setThreshold,
    clear,
  } = useFilters(pageKey);

  const activeDimCount   = Object.values(filters).filter((arr) => arr && arr.length > 0).length;
  const activeThreshCount = Object.keys(thresholds).length;
  const anyActive = activeDimCount > 0 || activeThreshCount > 0 || q.length > 0;

  return (
    <div className="relative z-50 flex items-center gap-2 flex-wrap rounded-2xl border border-slate-200 bg-slate-50/60 px-3 py-2">
      <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      {enableSearch && (
        <SearchInput value={q} onChange={setQ} placeholder={searchPlaceholder} />
      )}
      {dimensions.map((d) => (
        <DimensionPill
          key={d.id}
          spec={d}
          selected={filters[d.id] ?? []}
          onToggle={(v) => toggleValue(d.id, v)}
          onClear={() => setFilters({ ...filters, [d.id]: [] })}
        />
      ))}
      {enableThresholds && (
        <ThresholdsPill thresholds={thresholds} onChange={setThreshold} />
      )}
      {anyActive && (
        <button
          type="button"
          onClick={() => clear()}
          className="text-[11px] text-slate-500 hover:text-red-500 underline-offset-2 hover:underline"
        >
          Clear all
        </button>
      )}
      <div className="ml-auto">
        {!hideSavedViews && <SavedViewsMenu pageKey={pageKey} current={filters} />}
      </div>
    </div>
  );
}

