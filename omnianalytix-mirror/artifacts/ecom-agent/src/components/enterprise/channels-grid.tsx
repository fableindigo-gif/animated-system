import { useState, useEffect, useRef } from "react";
import { TrendingUp, TrendingDown, Minus, ArrowUpDown, Loader2, Wifi, WifiOff, RefreshCw, Link2, ChevronDown, ChevronUp } from "lucide-react";
import { SiGoogleads, SiMeta } from "react-icons/si";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth-fetch";
import { formatRelativeTime } from "@/lib/formatters";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCurrency } from "@/contexts/currency-context";
import { useDateRange } from "@/contexts/date-range-context";

const BASE = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

type Status = "ACTIVE" | "LEARNING" | "PAUSED" | "ENDED";
type TrendDir = "up" | "flat" | "down";
type SortKey = "spend" | "roas" | "conversions";

interface LiveChannel {
  campaignId:   string;
  campaignName: string;
  spend:        number;
  conversions:  number;
  clicks:       number;
  impressions:  number;
  ctr:          number;
  roas:         number;
  status:       string;
}

function fmt(n: number, prefix = "") {
  if (n === 0) return "\u2014";
  const abs = Math.abs(n);
  const str = abs >= 1_000_000
    ? `${prefix}${(abs / 1_000_000).toFixed(1)}M`
    : abs >= 1_000
    ? `${prefix}${(abs / 1_000).toFixed(1)}k`
    : `${prefix}${abs.toFixed(2)}`;
  return n < 0 ? `-${str}` : str;
}


const STATUS_STYLE: Record<string, string> = {
  ACTIVE:   "bg-emerald-50 text-emerald-700",
  LEARNING: "bg-amber-50 text-amber-700",
  PAUSED:   "bg-surface-container-low text-on-surface-variant",
  ENDED:    "bg-surface-container-low text-on-surface-variant",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold tracking-tight",
      STATUS_STYLE[status] ?? STATUS_STYLE.PAUSED,
    )}>
      {status}
    </span>
  );
}

function TrendIcon({ roas }: { roas: number }) {
  if (roas >= 3)  return <TrendingUp  className="w-3.5 h-3.5 text-emerald-600" />;
  if (roas >= 1)  return <Minus className="w-3.5 h-3.5 text-amber-500" />;
  if (roas > 0)   return <TrendingDown className="w-3.5 h-3.5 text-error-m3" />;
  return <Minus className="w-3.5 h-3.5 text-outline-variant" />;
}

function SkeletonRow() {
  return (
    <tr className="border-b ghost-border">
      {[120, 60, 50, 50, 40].map((w, i) => (
        <td key={i} className="px-3 py-3">
          <div className="h-3 bg-surface-container-highest rounded animate-pulse" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl border ghost-border bg-white p-4 space-y-3 animate-pulse">
      <div className="h-4 bg-surface-container-highest rounded w-3/4" />
      <div className="flex gap-3">
        <div className="h-8 bg-surface-container-low rounded-2xl flex-1" />
        <div className="h-8 bg-surface-container-low rounded-2xl flex-1" />
        <div className="h-8 bg-surface-container-low rounded-2xl flex-1" />
      </div>
    </div>
  );
}

function CampaignCard({ row }: { row: LiveChannel }) {
  const [expanded, setExpanded] = useState(false);
  const { currencySymbol: sym } = useCurrency();

  return (
    <div className="rounded-2xl border ghost-border bg-white overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left p-4 min-h-[44px] active:bg-surface transition-colors"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-[13px] font-semibold text-on-surface truncate flex-1 mr-2">{row.campaignName}</span>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={row.status} />
            {expanded ? <ChevronUp className="w-4 h-4 text-on-surface-variant" /> : <ChevronDown className="w-4 h-4 text-on-surface-variant" />}
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex-1 bg-surface rounded-2xl px-3 py-2">
            <p className="text-[9px] font-semibold text-on-surface-variant uppercase tracking-wider">Spend</p>
            <p className="text-sm font-bold text-on-surface tabular-nums">
              {row.spend === 0 ? <span title="No spend recorded this period">—</span> : `${sym}${row.spend < 1_000 ? row.spend.toFixed(0) : `${(row.spend / 1_000).toFixed(1)}k`}`}
            </p>
          </div>
          <div className="flex-1 bg-surface rounded-2xl px-3 py-2">
            <p className="text-[9px] font-semibold text-on-surface-variant uppercase tracking-wider">ROAS</p>
            <p className={cn(
              "text-sm font-bold tabular-nums",
              row.roas >= 4 ? "text-emerald-600" : row.roas >= 2 ? "text-accent-blue" : row.roas > 0 ? "text-amber-500" : "text-outline-variant",
            )}>
              {row.roas === 0 ? <span title="No return data yet">—</span> : `${row.roas.toFixed(2)}×`}
            </p>
          </div>
          <div className="flex-1 bg-surface rounded-2xl px-3 py-2">
            <p className="text-[9px] font-semibold text-on-surface-variant uppercase tracking-wider">Status</p>
            <div className="flex items-center gap-1 mt-0.5">
              <TrendIcon roas={row.roas} />
              <span className="text-[11px] font-semibold text-on-surface-variant">{row.status}</span>
            </div>
          </div>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t ghost-border grid grid-cols-3 gap-3">
          <div className="text-center py-2">
            <p className="text-[9px] font-semibold text-on-surface-variant uppercase">Conv.</p>
            <p className="text-sm font-bold text-on-surface tabular-nums">{row.conversions === 0 ? <span title="No conversions recorded">—</span> : row.conversions}</p>
          </div>
          <div className="text-center py-2">
            <p className="text-[9px] font-semibold text-on-surface-variant uppercase">Clicks</p>
            <p className="text-sm font-bold text-on-surface tabular-nums">{row.clicks === 0 ? <span title="No clicks recorded">—</span> : fmt(row.clicks)}</p>
          </div>
          <div className="text-center py-2">
            <p className="text-[9px] font-semibold text-on-surface-variant uppercase">CTR</p>
            <p className="text-sm font-bold text-on-surface tabular-nums">{row.ctr === 0 ? <span title="No click-through data">—</span> : `${row.ctr.toFixed(2)}%`}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function MetaConnectPrompt() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4">
      <div className="w-10 h-10 rounded-2xl bg-[#1877F2]/10 flex items-center justify-center">
        <SiMeta className="w-5 h-5 text-[#1877F2]" />
      </div>
      <div className="text-center space-y-1.5">
        <p className="text-sm font-bold text-on-surface">Meta Ads not connected</p>
        <p className="text-[11px] text-on-surface-variant max-w-[200px] leading-relaxed">
          Connect your Meta Business account to see live campaign performance.
        </p>
      </div>
      <a
        href="/connections"
        className="flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-accent-blue text-white text-xs font-bold hover:bg-accent-blue/90 transition-all min-h-[44px]"
      >
        <Link2 className="w-3 h-3" />
        Connect Meta Ads
      </a>
    </div>
  );
}

function GoogleConnectPrompt() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4">
      <div className="w-10 h-10 rounded-2xl bg-[#EA4335]/10 flex items-center justify-center">
        <SiGoogleads className="w-5 h-5 text-[#EA4335]" />
      </div>
      <div className="text-center space-y-1.5">
        <p className="text-sm font-bold text-on-surface">No campaign data synced</p>
        <p className="text-[11px] text-on-surface-variant max-w-[210px] leading-relaxed">
          Connect Google Ads and run a sync to see live campaign performance in real time.
        </p>
      </div>
      <a
        href="/connections"
        className="flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-accent-blue text-white text-xs font-bold hover:bg-accent-blue/90 transition-all min-h-[44px]"
      >
        <Link2 className="w-3 h-3" />
        Connect Google Ads
      </a>
    </div>
  );
}

export function ChannelsGrid() {
  const isMobile = useIsMobile();
  const { currencySymbol: sym } = useCurrency();
  const { dateRange, refreshKey } = useDateRange();
  const [platform, setPlatform]     = useState<"google" | "meta">("google");
  const [sortKey, setSortKey]       = useState<SortKey>("spend");
  const [sortAsc, setSortAsc]       = useState(false);
  const [channels, setChannels]     = useState<LiveChannel[]>([]);
  const [loading, setLoading]       = useState(true);
  const [syncedAt, setSyncedAt]     = useState<number | null>(null);
  const [error, setError]           = useState(false);
  const [page, setPage]             = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore]       = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = async (p = 1) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(false);
    try {
      const resp = await authFetch(`${API_BASE}api/warehouse/channels?page=${p}&page_size=20&days=${dateRange.daysBack}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!resp.ok) { setError(true); return; }
      const data = await resp.json() as { data: LiveChannel[]; total_count: number; has_more: boolean; syncedAt: number };
      if (controller.signal.aborted) return;
      if (p === 1) {
        setChannels(data.data ?? []);
      } else {
        setChannels((prev) => [...prev, ...(data.data ?? [])]);
      }
      setTotalCount(data.total_count ?? 0);
      setHasMore(data.has_more ?? false);
      setSyncedAt(data.syncedAt ?? null);
      setPage(p);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    void load(1);
    return () => { abortRef.current?.abort(); };
  }, [dateRange.daysBack, refreshKey]);

  const rows = channels
    .slice()
    .sort((a, b) => {
      const diff = a[sortKey] - b[sortKey];
      return sortAsc ? diff : -diff;
    });

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortAsc((v) => !v);
    else { setSortKey(k); setSortAsc(false); }
  };

  const totalSpend    = rows.reduce((s, r) => s + r.spend, 0);
  const activeRows    = rows.filter((r) => r.roas > 0);
  const avgRoas       = activeRows.length > 0
    ? activeRows.reduce((s, r) => s + r.roas, 0) / activeRows.length
    : 0;
  const totalConvs    = rows.reduce((s, r) => s + r.conversions, 0);

  const isLive = !loading && !error && channels.length > 0;

  return (
    <div className="w-full h-full border-l border-outline-variant/15 bg-white flex flex-col">

      <div className="px-4 py-3 border-b border-outline-variant/15 shrink-0 flex items-start justify-between">
        <div>
          <p className="text-[9px] font-semibold text-on-secondary-container uppercase tracking-widest">Active Channels</p>
          <h2 className="text-sm font-bold text-on-surface">Performance Grid</h2>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {!loading && (
            <div className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold",
              isLive
                ? "text-emerald-700 bg-emerald-50"
                : "text-on-surface-variant bg-surface-container-low",
            )}>
              {isLive ? <Wifi className="w-2.5 h-2.5" /> : <WifiOff className="w-2.5 h-2.5" />}
              {isLive ? "LIVE" : "OFFLINE"}
            </div>
          )}
          <button
            onClick={() => void load()}
            disabled={loading}
            className="text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-30 min-w-[44px] min-h-[44px] flex items-center justify-center"
            title="Refresh"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      <div className="px-3 pt-2.5 pb-0 border-b border-outline-variant/15 flex items-center gap-1 shrink-0">
        <button
          onClick={() => setPlatform("google")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold border-b-2 transition-all min-h-[44px]",
            platform === "google"
              ? "border-accent-blue text-accent-blue"
              : "border-transparent text-on-secondary-container hover:text-on-surface",
          )}
        >
          <SiGoogleads className="w-3 h-3" />
          Google Ads
        </button>
        <button
          onClick={() => setPlatform("meta")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold border-b-2 transition-all min-h-[44px]",
            platform === "meta"
              ? "border-accent-blue text-accent-blue"
              : "border-transparent text-on-secondary-container hover:text-on-surface",
          )}
        >
          <SiMeta className="w-3 h-3" />
          Meta Ads
        </button>
      </div>

      {platform === "meta" && <MetaConnectPrompt />}

      {platform === "google" && (
        <>
          {!loading && rows.length > 0 && (
            <div className="px-3 py-2 border-b border-outline-variant/15 flex items-center gap-4 shrink-0">
              <div>
                <p className="text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider">Total Spend</p>
                <p className="text-[11px] font-bold text-accent-blue tabular-nums">{sym}{fmt(totalSpend)}</p>
              </div>
              <div>
                <p className="text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider">Avg ROAS</p>
                <p className="text-[11px] font-bold text-on-surface tabular-nums">{avgRoas > 0 ? `${avgRoas.toFixed(2)}×` : <span title="No ROAS data available yet">—</span>}</p>
              </div>
              <div>
                <p className="text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider">Conversions</p>
                <p className="text-[11px] font-bold text-emerald-600 tabular-nums">{totalConvs > 0 ? fmt(totalConvs) : <span title="No conversions recorded yet">—</span>}</p>
              </div>
              {syncedAt && (
                <div className="ml-auto">
                  <p className="text-[8px] font-medium text-on-surface-variant uppercase tracking-wider">Synced</p>
                  <p className="text-[9px] text-on-surface-variant">{formatRelativeTime(syncedAt)}</p>
                </div>
              )}
            </div>
          )}

          {loading ? (
            isMobile ? (
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
              </div>
            ) : (
              <ScrollArea className="flex-1">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface-container-low">
                      {["Campaign", "Status", "Spend", "ROAS", "Conv."].map((h) => (
                        <th key={h} className="px-3 py-2 text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[1, 2, 3, 4, 5].map((i) => <SkeletonRow key={i} />)}
                  </tbody>
                </table>
              </ScrollArea>
            )
          ) : error ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <p className="text-[11px] text-error-m3 text-center">Failed to load channel data.</p>
            </div>
          ) : rows.length === 0 ? (
            <GoogleConnectPrompt />
          ) : isMobile ? (
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-2">
                {rows.map((row) => (
                  <CampaignCard key={row.campaignId} row={row} />
                ))}
              </div>
              {hasMore && (
                <div className="flex justify-center py-3">
                  <button
                    onClick={() => void load(page + 1)}
                    disabled={loading}
                    className="text-[10px] font-bold uppercase tracking-widest text-accent-blue hover:text-accent-blue/80 disabled:opacity-40 transition-colors min-h-[44px] px-4"
                  >
                    {loading ? "Loading…" : `Load more (${channels.length} of ${totalCount})`}
                  </button>
                </div>
              )}
            </ScrollArea>
          ) : (
            <>
            <ScrollArea className="flex-1">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-surface-container-low">
                    <th className="px-3 py-2 text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider">Campaign</th>
                    <th className="px-2 py-2 text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider">Status</th>
                    <th className="px-2 py-2 text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider cursor-pointer hover:text-on-surface select-none" onClick={() => toggleSort("spend")}>
                      <span className="flex items-center gap-1">Spend <ArrowUpDown className="w-2.5 h-2.5" /></span>
                    </th>
                    <th className="px-2 py-2 text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider cursor-pointer hover:text-on-surface select-none" onClick={() => toggleSort("roas")}>
                      <span className="flex items-center gap-1">ROAS <ArrowUpDown className="w-2.5 h-2.5" /></span>
                    </th>
                    <th className="px-2 py-2 text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider cursor-pointer hover:text-on-surface select-none" onClick={() => toggleSort("conversions")}>
                      <span className="flex items-center gap-1">Conv. <ArrowUpDown className="w-2.5 h-2.5" /></span>
                    </th>
                    <th className="px-2 py-2 text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider">Health</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(200,197,203,0.08)]">
                  {rows.map((row) => (
                    <tr key={row.campaignId} className="hover:bg-surface transition-colors group">
                      <td className="px-3 py-2.5">
                        <span className="text-[11px] font-medium text-on-surface truncate block max-w-[140px]" title={row.campaignName}>
                          {row.campaignName}
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="px-2 py-2.5">
                        <span className="text-[11px] tabular-nums text-on-surface-variant">
                          {row.spend === 0 ? <span title="No spend recorded this period">—</span> : `${sym}${row.spend < 1_000 ? row.spend.toFixed(0) : `${(row.spend / 1_000).toFixed(1)}k`}`}
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        <span className={cn(
                          "text-[11px] font-bold tabular-nums",
                          row.roas >= 4   ? "text-emerald-600"
                          : row.roas >= 2 ? "text-accent-blue"
                          : row.roas > 0  ? "text-amber-500"
                          : "text-outline-variant",
                        )}>
                          {row.roas === 0 ? <span title="No return data yet">—</span> : `${row.roas.toFixed(2)}×`}
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        <span className="text-[11px] tabular-nums text-on-surface-variant">
                          {row.conversions === 0 ? <span title="No conversions recorded">—</span> : row.conversions < 1_000 ? row.conversions.toFixed(0) : `${(row.conversions / 1_000).toFixed(1)}k`}
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        <TrendIcon roas={row.roas} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
            {hasMore && (
              <div className="flex justify-center pt-2 pb-1">
                <button
                  onClick={() => void load(page + 1)}
                  disabled={loading}
                  className="text-[10px] font-bold uppercase tracking-widest text-accent-blue hover:text-accent-blue/80 disabled:opacity-40 transition-colors"
                >
                  {loading ? "Loading…" : `Load more (${channels.length} of ${totalCount})`}
                </button>
              </div>
            )}
            </>
          )}
        </>
      )}
    </div>
  );
}
