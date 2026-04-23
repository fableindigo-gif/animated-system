import { useState, useEffect, useRef } from "react";
import { ArrowUpDown, TrendingUp, TrendingDown, Loader2, WifiOff, RefreshCw, Link2, Package } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/contexts/currency-context";
import { useDateRange } from "@/contexts/date-range-context";
import { authFetch } from "@/lib/auth-fetch";

const BASE = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

interface SKURow {
  sku: string;
  name: string;
  platform: string;
  campaign: string;
  spend: number;
  revenue: number;
  cogs: number;
  netMargin: number;
  poas: number;
  imageUrl: string | null;
  brandLogoUrl: string | null;
}

type SortField = keyof SKURow;
type SortDir = "asc" | "desc";

const PLATFORM_DOT: Record<string, string> = {
  "Google Ads": "bg-[#60a5fa]",
  "Meta Ads":   "bg-[#1877F2]",
  "Shopify":    "bg-emerald-400",
};

function poasColor(poas: number) {
  if (poas >= 2.5) return "text-emerald-400";
  if (poas >= 1.5) return "text-amber-400";
  return "text-rose-400";
}

function marginColor(margin: number) {
  if (margin >= 25) return "text-emerald-400";
  if (margin >= 10) return "text-amber-400";
  return "text-rose-400";
}

// ── Lazy-loaded product thumbnail ──────────────────────────────────────────────
// Uses IntersectionObserver so images only load when they scroll into view.
// Falls back to a <Package> icon if the URL is missing or the request fails.
function LazyProductImage({
  imageUrl,
  brandLogoUrl,
  name,
  size = "sm",
}: {
  imageUrl: string | null;
  brandLogoUrl: string | null;
  name: string;
  size?: "sm" | "md";
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError]   = useState(false);
  const [visible, setVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const src = imageUrl || brandLogoUrl || null;
  const dim = size === "md" ? "w-10 h-10" : "w-7 h-7";
  const iconDim = size === "md" ? "w-5 h-5" : "w-3.5 h-3.5";

  useEffect(() => {
    if (!src) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } },
      { rootMargin: "120px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [src]);

  const showFallback = !src || error;

  return (
    <div
      ref={containerRef}
      className={cn(
        dim,
        "rounded-lg border border-outline-variant/15 bg-surface-container-low overflow-hidden shrink-0 flex items-center justify-center",
      )}
    >
      {showFallback ? (
        <Package className={cn(iconDim, "text-on-surface-variant opacity-40")} />
      ) : (
        <>
          {!loaded && (
            <div className={cn(dim, "absolute inset-0 skeleton-shimmer rounded-lg")} />
          )}
          {visible && (
            <img
              src={src}
              alt={name}
              loading="lazy"
              decoding="async"
              onLoad={() => setLoaded(true)}
              onError={() => setError(true)}
              className={cn(
                "w-full h-full object-cover transition-opacity duration-300",
                loaded ? "opacity-100" : "opacity-0",
              )}
            />
          )}
        </>
      )}
    </div>
  );
}

function SKUMobileCard({ row, sym }: { row: SKURow; sym: string }) {
  const poasOk = row.poas >= 1.5;
  return (
    <div className={cn(
      "rounded-2xl border px-4 py-3 space-y-2",
      row.poas < 1 ? "border-rose-700/40 bg-rose-900/10" : "border-outline-variant/15 bg-white/40",
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          <LazyProductImage imageUrl={row.imageUrl} brandLogoUrl={row.brandLogoUrl} name={row.name} size="md" />
          <div className="min-w-0">
            <p className="text-xs font-mono text-accent-blue font-bold">{row.sku}</p>
            <p className="text-sm font-medium text-on-surface truncate">{row.name}</p>
            <p className="text-[10px] text-on-surface-variant truncate">{row.campaign}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", PLATFORM_DOT[row.platform] ?? "bg-surface0")} />
          <span className="text-[10px] text-on-surface-variant">{row.platform}</span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 pt-1 border-t border-outline-variant/15/60">
        <div>
          <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest">Spend</p>
          <p className="text-xs font-mono text-on-surface font-bold">{sym}{row.spend.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest">Margin</p>
          <p className={cn("text-xs font-mono font-bold", marginColor(row.netMargin))}>{row.netMargin.toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest">POAS</p>
          <span className={cn("inline-flex items-center gap-0.5 text-xs font-mono font-bold", poasColor(row.poas))}>
            {row.poas.toFixed(2)}x
            {poasOk
              ? <TrendingUp className="w-3 h-3 text-emerald-500" />
              : <TrendingDown className="w-3 h-3 text-error-m3" />
            }
          </span>
        </div>
      </div>
    </div>
  );
}

function SkeletonRows() {
  return (
    <>
      {[1, 2, 3, 4].map((i) => (
        <tr key={i} className="border-b border-outline-variant/15/40">
          {/* thumbnail cell */}
          <td className="px-2 py-2">
            <div className="w-7 h-7 rounded-lg bg-surface-container-highest animate-pulse" />
          </td>
          {[80, 120, 60, 100, 50, 50, 50, 50].map((w, j) => (
            <td key={j} className="px-2 py-2">
              <div className="h-3 bg-surface-container-highest rounded animate-pulse" style={{ width: w }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function SkeletonCards() {
  return (
    <>
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-2xl border border-outline-variant/15 p-4 space-y-3 animate-pulse">
          <div className="flex gap-2.5">
            <div className="w-10 h-10 rounded-lg bg-surface-container-highest shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-surface-container-highest rounded w-3/4" />
              <div className="h-3 bg-surface-container-low rounded w-1/2" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-2 border-t ghost-border">
            <div className="h-6 bg-surface-container-low rounded" />
            <div className="h-6 bg-surface-container-low rounded" />
            <div className="h-6 bg-surface-container-low rounded" />
          </div>
        </div>
      ))}
    </>
  );
}

const PAGE_SIZE = 15;
// PERF-04: Desktop list virtualization. Estimated row height in px — used by
// `useVirtualizer` to predict the scroll surface and only render the rows
// inside the visible window (+ overscan). Mobile keeps the existing
// "Load More" pagination because card heights vary per content.
const ROW_HEIGHT_PX = 36;

export function SKUGrid() {
  const { currencySymbol: sym } = useCurrency();
  const { dateRange, refreshKey } = useDateRange();
  const [sortField, setSortField] = useState<SortField>("poas");
  const [sortDir, setSortDir]     = useState<SortDir>("desc");
  const [filter, setFilter]       = useState("");
  const [data, setData]           = useState<SKURow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const abortRef = useRef<AbortController | null>(null);
  const desktopScrollRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(false);
    try {
      const resp = await authFetch(`${API_BASE}api/warehouse/products?page=1&page_size=60&days=${dateRange.daysBack}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!resp.ok) {
        setError(true);
        setLoading(false);
        return;
      }
      const json = await resp.json() as { data: SKURow[] };
      if (controller.signal.aborted) return;
      setData(json.data ?? []);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    setVisibleCount(PAGE_SIZE);
    return () => { abortRef.current?.abort(); };
  }, [dateRange.daysBack, refreshKey]);

  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [filter]);

  const handleSort = (field: SortField) => {
    if (sortField === field) { setSortDir((d) => d === "asc" ? "desc" : "asc"); }
    else { setSortField(field); setSortDir("desc"); }
  };

  const rows = [...data]
    .filter((r) =>
      filter === "" ||
      r.sku.toLowerCase().includes(filter.toLowerCase()) ||
      r.name.toLowerCase().includes(filter.toLowerCase()) ||
      r.campaign.toLowerCase().includes(filter.toLowerCase())
    )
    .sort((a, b) => {
      const av = a[sortField] as number | string | null;
      const bv = b[sortField] as number | string | null;
      const cmp = typeof av === "number" ? av - (bv as number) : String(av ?? "").localeCompare(String(bv ?? ""));
      return sortDir === "asc" ? cmp : -cmp;
    });

  const visibleRows = rows.slice(0, visibleCount);
  const hasMore = rows.length > visibleCount;

  // PERF-04: Virtualize the desktop table body. We virtualize the FULL sorted
  // `rows` list (not the paginated `visibleRows`) — the "Load More" pattern is
  // no longer needed on desktop because react-virtual keeps the rendered DOM
  // bounded regardless of dataset size.
  const desktopVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => desktopScrollRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 8,
  });
  const virtualItems = desktopVirtualizer.getVirtualItems();
  const totalSize = desktopVirtualizer.getTotalSize();

  const profitablePct = rows.length > 0
    ? Math.round((rows.filter((r) => r.poas >= 1.5).length / rows.length) * 100)
    : 0;

  const ColHeader = ({ field, label, right = false }: { field: SortField; label: string; right?: boolean }) => (
    <th
      className={cn(
        "px-2 py-1.5 text-[9px] font-mono uppercase tracking-widest text-on-surface-variant cursor-pointer hover:text-on-surface-variant select-none whitespace-nowrap",
        right && "text-right",
      )}
      onClick={() => handleSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className={cn("w-2.5 h-2.5", sortField === field ? "text-accent-blue" : "text-on-surface-variant")} />
      </span>
    </th>
  );

  if (loading) {
    return (
      <div className="flex flex-col h-full overflow-hidden bg-surface">
        <div className="flex items-center gap-3 px-4 py-2 border-b border-outline-variant/15/60 shrink-0">
          <div className="flex-1 h-7 bg-surface-container-low rounded-md animate-pulse" />
          <Loader2 className="w-4 h-4 text-on-surface-variant animate-spin" />
        </div>
        <div className="md:hidden flex-1 overflow-y-auto p-3 space-y-2">
          <SkeletonCards />
        </div>
        <div className="hidden md:block flex-1 overflow-auto">
          <table className="min-w-[680px] w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-white/95 backdrop-blur z-10">
              <tr className="border-b border-outline-variant/15">
                <th className="px-2 py-1.5 w-10" />
                {["SKU", "Product", "Platform", "Campaign", "Spend", "COGS", "Net Margin %", "POAS"].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-[9px] font-mono uppercase tracking-widest text-on-surface-variant">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody><SkeletonRows /></tbody>
          </table>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-8 gap-3 bg-surface">
        <p className="text-sm text-error-m3 font-medium">Failed to load SKU data.</p>
        <button
          onClick={() => void load()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-accent-blue text-white text-xs font-bold hover:bg-accent-blue/90 transition-all"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </button>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-8 gap-4 bg-surface">
        <div className="w-10 h-10 rounded-2xl bg-surface-container-low flex items-center justify-center">
          <WifiOff className="w-5 h-5 text-on-surface-variant" />
        </div>
        <div className="text-center space-y-1.5">
          <p className="text-sm font-bold text-on-surface">No live data available</p>
          <p className="text-[11px] text-on-surface-variant max-w-[240px] leading-relaxed">
            Connect your accounts and run a sync to see SKU-level performance with live POAS metrics.
          </p>
        </div>
        <a
          href="/connections"
          className="flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-accent-blue text-white text-xs font-bold hover:bg-accent-blue/90 transition-all min-h-[44px]"
        >
          <Link2 className="w-3 h-3" />
          Connect Accounts
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-outline-variant/15/60 shrink-0">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter SKU / campaign..."
          className="flex-1 text-xs font-mono bg-white border border-outline-variant/15 rounded-md px-2 py-1 text-on-surface placeholder-on-surface-variant focus:outline-none focus:border-cyan-500/50"
        />
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-mono text-on-surface-variant">{visibleRows.length}/{rows.length} {rows.length === 1 ? "SKU" : "SKUs"}</span>
          <span className={cn(
            "text-[10px] font-mono px-2 py-0.5 rounded border",
            profitablePct >= 75 ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" : "text-amber-400 border-amber-500/30 bg-amber-500/10",
          )}>
            {profitablePct}% Profitable
          </span>
          <button
            onClick={() => void load()}
            className="text-on-surface-variant hover:text-on-surface transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="md:hidden flex-1 overflow-y-auto p-3 space-y-2">
        {visibleRows.map((row) => <SKUMobileCard key={row.sku + row.campaign} row={row} sym={sym} />)}
        {hasMore && (
          <button
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            className="w-full py-2 text-xs font-semibold text-on-surface-variant border border-outline-variant/15 rounded-2xl hover:border-outline hover:text-on-surface transition-colors"
          >
            Show {Math.min(PAGE_SIZE, rows.length - visibleCount)} more of {rows.length - visibleCount} remaining
          </button>
        )}
      </div>

      <div className="hidden md:flex flex-col flex-1 overflow-hidden">
        {/* PERF-04: Virtualized desktop list. Header is rendered as a fixed
            grid row outside the scroll surface so column widths line up with
            each virtualized row below. */}
        <div role="table" aria-label="SKU performance grid" aria-rowcount={rows.length + 1} className="contents">
        <div role="rowgroup" className="border-b border-outline-variant/15 bg-white/95 backdrop-blur shrink-0">
          <div
            role="row"
            aria-rowindex={1}
            className="grid items-center min-w-[680px] text-[9px] font-mono uppercase tracking-widest text-on-surface-variant"
            style={{ gridTemplateColumns: "40px 90px 1fr 110px 1fr 90px 80px 110px 90px" }}
          >
            <div className="px-2 py-1.5" />
            <button onClick={() => handleSort("sku")}       className="px-2 py-1.5 text-left flex items-center gap-1 hover:text-on-surface select-none">SKU <ArrowUpDown className={cn("w-2.5 h-2.5", sortField === "sku" ? "text-accent-blue" : "")} /></button>
            <button onClick={() => handleSort("name")}      className="px-2 py-1.5 text-left flex items-center gap-1 hover:text-on-surface select-none">Product <ArrowUpDown className={cn("w-2.5 h-2.5", sortField === "name" ? "text-accent-blue" : "")} /></button>
            <button onClick={() => handleSort("platform")}  className="px-2 py-1.5 text-left flex items-center gap-1 hover:text-on-surface select-none">Platform <ArrowUpDown className={cn("w-2.5 h-2.5", sortField === "platform" ? "text-accent-blue" : "")} /></button>
            <button onClick={() => handleSort("campaign")}  className="px-2 py-1.5 text-left flex items-center gap-1 hover:text-on-surface select-none">Campaign <ArrowUpDown className={cn("w-2.5 h-2.5", sortField === "campaign" ? "text-accent-blue" : "")} /></button>
            <button onClick={() => handleSort("spend")}     className="px-2 py-1.5 text-right flex items-center justify-end gap-1 hover:text-on-surface select-none">Spend <ArrowUpDown className={cn("w-2.5 h-2.5", sortField === "spend" ? "text-accent-blue" : "")} /></button>
            <button onClick={() => handleSort("cogs")}      className="px-2 py-1.5 text-right flex items-center justify-end gap-1 hover:text-on-surface select-none">COGS <ArrowUpDown className={cn("w-2.5 h-2.5", sortField === "cogs" ? "text-accent-blue" : "")} /></button>
            <button onClick={() => handleSort("netMargin")} className="px-2 py-1.5 text-right flex items-center justify-end gap-1 hover:text-on-surface select-none">Net Margin % <ArrowUpDown className={cn("w-2.5 h-2.5", sortField === "netMargin" ? "text-accent-blue" : "")} /></button>
            <button onClick={() => handleSort("poas")}      className="px-2 py-1.5 text-right flex items-center justify-end gap-1 hover:text-on-surface select-none">POAS <ArrowUpDown className={cn("w-2.5 h-2.5", sortField === "poas" ? "text-accent-blue" : "")} /></button>
          </div>
        </div>
        <div ref={desktopScrollRef} className="flex-1 overflow-auto" data-testid="sku-grid-scroll">
          <div
            role="rowgroup"
            className="relative min-w-[680px]"
            style={{ height: `${totalSize}px` }}
          >
            {virtualItems.map((vItem) => {
              const row = rows[vItem.index];
              if (!row) return null;
              const poasIcon = row.poas >= 1.5 ? (
                <TrendingUp className="w-3 h-3 inline ml-1 text-emerald-500 opacity-70" />
              ) : (
                <TrendingDown className="w-3 h-3 inline ml-1 text-error-m3 opacity-70" />
              );
              return (
                <div
                  key={row.sku + row.campaign}
                  role="row"
                  aria-rowindex={vItem.index + 2}
                  className={cn(
                    "absolute left-0 top-0 w-full grid items-center text-xs border-b border-outline-variant/15/40 hover:bg-surface/30 transition-colors",
                    vItem.index % 2 === 0 ? "bg-transparent" : "bg-white/20",
                    row.poas < 1 && "bg-rose-900/10",
                  )}
                  style={{
                    height: `${vItem.size}px`,
                    transform: `translateY(${vItem.start}px)`,
                    gridTemplateColumns: "40px 90px 1fr 110px 1fr 90px 80px 110px 90px",
                  }}
                >
                  <div role="cell" className="px-2 py-1.5">
                    <LazyProductImage
                      imageUrl={row.imageUrl}
                      brandLogoUrl={row.brandLogoUrl}
                      name={row.name}
                      size="sm"
                    />
                  </div>
                  <div role="cell" className="px-2 py-1.5 font-mono text-accent-blue whitespace-nowrap truncate">{row.sku}</div>
                  <div role="cell" className="px-2 py-1.5 text-on-surface truncate" title={row.name}>{row.name}</div>
                  <div role="cell" className="px-2 py-1.5 whitespace-nowrap">
                    <span className="flex items-center gap-1.5">
                      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", PLATFORM_DOT[row.platform] ?? "bg-surface0")} />
                      <span className="text-on-surface-variant truncate">{row.platform}</span>
                    </span>
                  </div>
                  <div role="cell" className="px-2 py-1.5 text-on-surface-variant truncate" title={row.campaign}>{row.campaign}</div>
                  <div role="cell" className="px-2 py-1.5 font-mono text-on-surface text-right whitespace-nowrap">{sym}{row.spend.toLocaleString()}</div>
                  <div role="cell" className="px-2 py-1.5 font-mono text-on-surface-variant text-right whitespace-nowrap">{sym}{row.cogs.toLocaleString()}</div>
                  <div role="cell" className={cn("px-2 py-1.5 font-mono font-bold text-right whitespace-nowrap", marginColor(row.netMargin))}>
                    {row.netMargin.toFixed(1)}%
                  </div>
                  <div role="cell" className={cn("px-2 py-1.5 font-mono font-bold text-right whitespace-nowrap", poasColor(row.poas))}>
                    {row.poas.toFixed(2)}x{poasIcon}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
