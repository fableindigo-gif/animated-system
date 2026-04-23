import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Loader2,
  Wifi,
  WifiOff,
  RefreshCw,
  Link2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  AlertTriangle,
  Calendar,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { SiGoogleads, SiMeta } from "react-icons/si";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth-fetch";
import { formatUsdInDisplay } from "@/lib/fx-format";
import { MoneyTile } from "@/components/ui/money-tile";
import { useIsMobile } from "@/hooks/use-mobile";
import { useHasPermission } from "@/hooks/use-has-permission";
import { useDateRange } from "@/contexts/date-range-context";
import { useWorkspace } from "@/contexts/workspace-context";
import { formatRelativeTime } from "@/lib/formatters";
import { Link } from "wouter";
import { FilterBar } from "./filter-bar";
import { useFilterQs } from "@/lib/use-filter-qs";
import { useEconomicsSettings } from "@/lib/use-economics-settings";
import { WindowEmptyBanner } from "./window-empty-banner";

const BASE = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

// Portfolio fallback for the Health badge. Tenants configure their own default
// in Settings → Economics, and individual campaigns can override that value;
// we only land on this constant when neither is set.
const DEFAULT_TARGET_ROAS = 4.0;

function healthScore(roas: number | null | undefined, targetRoas: number): number | null {
  if (roas == null || !Number.isFinite(roas) || roas < 0) return null;
  if (!Number.isFinite(targetRoas) || targetRoas <= 0) return null;
  return Math.min(100, (roas / targetRoas) * 100);
}

function HealthBadge({
  roas,
  targetRoas,
  targetRoasProvenance,
}: {
  roas: number | null | undefined;
  targetRoas: number;
  /** "configured", "campaign override", or "default" — shown in the tooltip. */
  targetRoasProvenance?: string;
}) {
  const score = healthScore(roas, targetRoas);
  if (score == null) {
    return <span className="text-outline-variant text-[10px]">—</span>;
  }
  const rounded = Math.round(score);
  const tone =
    score > 80
      ? { bg: "bg-emerald-50", fg: "text-emerald-700", ring: "ring-emerald-200" }
      : score >= 50
        ? { bg: "bg-amber-50", fg: "text-amber-700", ring: "ring-amber-200" }
        : { bg: "bg-rose-50", fg: "text-rose-700", ring: "ring-rose-200" };
  const provNote = targetRoasProvenance ? ` (${targetRoasProvenance})` : "";
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tabular-nums ring-1",
        tone.bg,
        tone.fg,
        tone.ring,
      )}
      title={`Health ${rounded}/100 · ROAS ${(roas ?? 0).toFixed(2)}× vs target ${targetRoas.toFixed(1)}×${provNote}`}
      data-testid="health-badge"
    >
      {rounded}
    </span>
  );
}

type SortKey = "spend" | "roas" | "conversions" | "clicks" | "impressions" | "ctr" | "cpa" | "revenue";
type SortDir = "asc" | "desc";

interface LiveChannel {
  campaignId: string;
  campaignName: string;
  spend: number;
  conversions: number;
  clicks: number;
  impressions: number;
  ctr: number;
  roas: number;
  cpa: number | null;
  // revenue: actual conversion value reported by Google Ads (purchase value
  // sum from conversion tracking).
  revenue: number | null;
  status: string;
  // revenueTrendPct: % change in revenue vs prior period of equal length.
  // null when prior period had no revenue data (new campaign, etc.).
  revenueTrendPct: number | null;
  // revenueIsNew: true when campaign had $0 revenue last period but positive revenue now.
  revenueIsNew?: boolean;
  // revenueTrend: per-day revenue for the current window — drives the sparkline.
  // null when the live endpoint is used or data is unavailable.
  revenueTrend?: { date: string; revenue: number }[] | null;
  // lastActiveDate: ISO timestamp of the most recent day this campaign had
  // non-zero spend in the warehouse. Drives the "Last active" badge on
  // paused/removed rows. null when never spent or not available.
  lastActiveDate?: string | null;
}

interface PerformanceGridProps {
  onAnalyze?: (prompt: string) => void;
}

function fmt(n: number | null | undefined, prefix = "") {
  if (n == null || !Number.isFinite(n)) return "—";
  // Money values get FX conversion; non-money (counts) bypass.
  if (prefix === "$") return formatUsdInDisplay(n);
  return _fmtRawLegacy(n, prefix);
}
function fmtCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const v = Math.round(n);
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString("en-US");
}
function _fmtRawLegacy(n: number | null | undefined, prefix = "") {
  if (n == null) return null;
  if (n === 0) return "0.00";
  const abs = Math.abs(n);
  const str =
    abs >= 1_000_000
      ? `${prefix}${(abs / 1_000_000).toFixed(1)}M`
      : abs >= 1_000
        ? `${prefix}${(abs / 1_000).toFixed(1)}K`
        : `${prefix}${abs.toFixed(2)}`;
  return n < 0 ? `-${str}` : str;
}

function NullMetric() {
  return (
    <span className="inline-flex items-center gap-1 text-amber-500" title="Tracking data unavailable or missing">
      <AlertTriangle className="w-3 h-3" />
    </span>
  );
}

function RevenueTrendBadge({
  pct,
  isNew,
}: {
  pct: number | null | undefined;
  isNew?: boolean;
}) {
  if (isNew) {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[9px] font-bold leading-none text-accent-blue"
        title="First revenue recorded — no prior-period data to compare"
      >
        <Sparkles className="w-2.5 h-2.5" />
        NEW
      </span>
    );
  }
  if (pct == null) return null;
  const up = pct > 0;
  const flat = pct === 0;
  const abs = Math.abs(pct);
  const label = flat ? "0%" : `${up ? "+" : "−"}${abs.toFixed(1)}%`;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[9px] font-bold tabular-nums leading-none",
        flat
          ? "text-on-surface-variant/50"
          : up
            ? "text-emerald-600"
            : "text-rose-500",
      )}
      title={`Revenue ${up ? "up" : flat ? "flat" : "down"} ${abs.toFixed(1)}% vs prior period`}
    >
      {flat ? (
        <Minus className="w-2.5 h-2.5" />
      ) : up ? (
        <TrendingUp className="w-2.5 h-2.5" />
      ) : (
        <TrendingDown className="w-2.5 h-2.5" />
      )}
      {label}
    </span>
  );
}


function RevenueSparkline({
  data,
  fallbackPct,
  fallbackIsNew,
}: {
  data?: { date: string; revenue: number }[] | null;
  fallbackPct?: number | null;
  fallbackIsNew?: boolean;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!data || data.length < 2) {
    return <RevenueTrendBadge pct={fallbackPct} isNew={fallbackIsNew} />;
  }

  const W = 52;
  const H = 20;
  const gap = 1;
  const n = data.length;
  const barW = Math.max(2, (W - gap * (n - 1)) / n);
  const step = barW + gap;
  const maxVal = Math.max(...data.map((d) => d.revenue), 0.01);
  const hovered = hoveredIdx != null ? data[hoveredIdx] : null;

  return (
    <div
      className="relative inline-block"
      onMouseLeave={() => setHoveredIdx(null)}
    >
      {hovered && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 rounded bg-gray-800 text-white text-[8px] whitespace-nowrap pointer-events-none z-50 shadow-sm"
          style={{ transform: "translateX(-50%) translateY(-2px)" }}
        >
          {hovered.date}: {formatUsdInDisplay(hovered.revenue)}
        </div>
      )}
      <svg
        width={W}
        height={H}
        className="block overflow-visible"
        aria-label="Daily revenue trend sparkline"
      >
        {data.map((d, i) => {
          const barH = Math.max(2, (d.revenue / maxVal) * (H - 2));
          const x = i * step;
          const y = H - barH;
          const isActive = hoveredIdx === i;
          const prevRev = i > 0 ? data[i - 1].revenue : d.revenue;
          const barColor = d.revenue >= prevRev ? "#10b981" : "#f43f5e";
          return (
            <rect
              key={d.date}
              x={x}
              y={y}
              width={barW}
              height={barH}
              rx={0.5}
              fill={isActive ? "#6366f1" : barColor}
              opacity={hoveredIdx != null && !isActive ? 0.45 : 1}
              onMouseEnter={() => setHoveredIdx(i)}
              style={{ cursor: "default" }}
            >
              <title>{d.date}: {formatUsdInDisplay(d.revenue)}</title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}


const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700",
  LEARNING: "bg-amber-50 text-amber-700",
  PAUSED: "bg-surface-container-low text-on-surface-variant",
  ENDED: "bg-surface-container-low text-on-surface-variant",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold tracking-tight",
        STATUS_STYLE[status] ?? STATUS_STYLE.PAUSED,
      )}
    >
      {status}
    </span>
  );
}

function TrendIcon({ roas }: { roas: number }) {
  if (roas >= 3) return <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />;
  if (roas >= 1) return <Minus className="w-3.5 h-3.5 text-amber-500" />;
  if (roas > 0) return <TrendingDown className="w-3.5 h-3.5 text-error-m3" />;
  return <Minus className="w-3.5 h-3.5 text-outline-variant" />;
}

function SortIndicator({
  column,
  activeKey,
  activeDir,
}: {
  column: SortKey;
  activeKey: SortKey;
  activeDir: SortDir;
}) {
  if (column !== activeKey)
    return <ArrowUpDown className="w-2.5 h-2.5 opacity-40" />;
  return activeDir === "desc" ? (
    <ArrowDown className="w-2.5 h-2.5 text-accent-blue" />
  ) : (
    <ArrowUp className="w-2.5 h-2.5 text-accent-blue" />
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b ghost-border">
      {[120, 60, 50, 50, 40, 40, 45, 35, 30].map((w, i) => (
        <td key={i} className="px-3 py-3">
          <div
            className="h-3 bg-surface-container-highest rounded animate-pulse"
            style={{ width: w }}
          />
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

function buildAnalyzePrompt(row: LiveChannel): string {
  const cpaPart = row.cpa != null ? `, CPA ${row.cpa.toFixed(2)}` : "";
  const convValPart = row.revenue != null ? `, Conv. Value ${row.revenue.toFixed(2)}` : "";
  return (
    `Deep-dive analysis on campaign "${row.campaignName}" (ID: ${row.campaignId}). ` +
    `Current metrics: Spend ${(row.spend ?? 0).toFixed(2)}, ROAS ${(row.roas ?? 0).toFixed(2)}×, ` +
    `${row.conversions ?? 0} conversions${cpaPart}${convValPart}, ${row.clicks ?? 0} clicks, ` +
    `${row.impressions ?? 0} impressions, CTR ${(row.ctr ?? 0).toFixed(2)}%, Status: ${row.status}. ` +
    `Analyze performance, identify optimization opportunities, and recommend specific actions ` +
    `to improve ROAS and reduce wasted spend. Be decisive and specific.`
  );
}

const INACTIVE_STATUSES = new Set(["PAUSED", "ENDED", "REMOVED"]);

function daysAgoFromIso(isoString: string | null | undefined): number | null {
  if (!isoString) return null;
  const ms = Date.now() - new Date(isoString).getTime();
  if (!isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / 86_400_000);
}

function LastActiveBadge({ lastActiveDate, status }: { lastActiveDate?: string | null; status: string }) {
  if (!INACTIVE_STATUSES.has(status)) return null;
  const days = daysAgoFromIso(lastActiveDate);
  if (days == null) return null;
  const label = days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[9px] text-on-surface-variant/60 leading-none"
      title={`Last spend recorded: ${new Date(lastActiveDate!).toLocaleDateString()}`}
    >
      <Calendar className="w-2.5 h-2.5 shrink-0" />
      Last active: {label}
    </span>
  );
}

const CampaignCard = memo(function CampaignCard({
  row,
  onAnalyze,
  isAnalyzing,
  targetRoasFor,
  econSettings,
  setCampaignTargetRoas,
  isManager,
}: {
  row: LiveChannel;
  onAnalyze?: (prompt: string) => void;
  isAnalyzing: boolean;
  targetRoasFor?: (campaignId: string | null | undefined, fallback: number) => number;
  econSettings?: import("@/lib/use-economics-settings").EconomicsSettings | null;
  setCampaignTargetRoas?: (campaignId: string, targetRoas: number | null) => Promise<void>;
  isManager?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [roasEditing, setRoasEditing] = useState(false);
  const [roasValue, setRoasValue] = useState("");
  const [roasSaving, setRoasSaving] = useState(false);
  const [roasError, setRoasError] = useState<string | null>(null);
  const roasInputRef = useRef<HTMLInputElement | null>(null);
  const roasCancelledRef = useRef(false);

  const startRoasEdit = useCallback((currentOverride: number | undefined) => {
    roasCancelledRef.current = false;
    setRoasValue(currentOverride != null ? String(currentOverride) : "");
    setRoasError(null);
    setRoasEditing(true);
    setTimeout(() => roasInputRef.current?.focus(), 0);
  }, []);

  const cancelRoasEdit = useCallback(() => {
    roasCancelledRef.current = true;
    setRoasEditing(false);
    setRoasValue("");
    setRoasError(null);
  }, []);

  const saveRoasEdit = useCallback(async () => {
    if (roasCancelledRef.current) { roasCancelledRef.current = false; return; }
    if (!setCampaignTargetRoas) return;
    const trimmed = roasValue.trim();
    const parsed = trimmed === "" ? null : parseFloat(trimmed);
    if (trimmed !== "" && (Number.isNaN(parsed) || (parsed as number) <= 0 || (parsed as number) > 100)) {
      setRoasError("Enter 0.1–100 or leave blank to clear");
      return;
    }
    setRoasSaving(true);
    setRoasError(null);
    try {
      await setCampaignTargetRoas(row.campaignId, parsed);
      setRoasEditing(false);
      setRoasValue("");
    } catch (err) {
      setRoasError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setRoasSaving(false);
    }
  }, [roasValue, setCampaignTargetRoas, row.campaignId]);

  return (
    <div className="rounded-2xl border ghost-border bg-white overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left p-4 min-h-[44px] active:bg-surface transition-colors"
      >
        <div className={cn("flex items-center justify-between", INACTIVE_STATUSES.has(row.status) ? "mb-1" : "mb-3")}>
          <span className="text-[13px] font-semibold text-on-surface truncate flex-1 mr-2">
            {row.campaignName}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={row.status} />
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-on-surface-variant" />
            ) : (
              <ChevronDown className="w-4 h-4 text-on-surface-variant" />
            )}
          </div>
        </div>
        {INACTIVE_STATUSES.has(row.status) && (
          <div className="mb-2">
            <LastActiveBadge lastActiveDate={row.lastActiveDate} status={row.status} />
          </div>
        )}
        <div className="flex gap-3">
          <div className="flex-1 bg-surface rounded-2xl px-3 py-2">
            <p className="text-[9px] font-semibold text-on-surface-variant uppercase tracking-wider">
              Spend
            </p>
            <p className="text-sm font-bold text-on-surface tabular-nums">
              {row.spend == null
                ? <NullMetric />
                : row.spend === 0
                  ? <MoneyTile usd={0} decimals={2} />
                  : <MoneyTile usd={row.spend} compact={row.spend >= 1_000} decimals={row.spend < 1_000 ? 0 : 1} />}
            </p>
          </div>
          <div className="flex-1 bg-surface rounded-2xl px-3 py-2">
            <p className="text-[9px] font-semibold text-on-surface-variant uppercase tracking-wider">
              ROAS
            </p>
            <p
              className={cn(
                "text-sm font-bold tabular-nums",
                (row.roas ?? 0) >= 4
                  ? "text-emerald-600"
                  : (row.roas ?? 0) >= 2
                    ? "text-accent-blue"
                    : (row.roas ?? 0) > 0
                      ? "text-amber-500"
                      : "text-outline-variant",
              )}
            >
              {row.roas == null ? <NullMetric /> : row.roas === 0 ? "0.00×" : `${row.roas.toFixed(2)}×`}
            </p>
          </div>
          <div className="flex-1 bg-surface rounded-2xl px-3 py-2">
            <p className="text-[9px] font-semibold text-on-surface-variant uppercase tracking-wider">
              Status
            </p>
            <div className="flex items-center gap-1 mt-0.5">
              <TrendIcon roas={row.roas} />
              <span className="text-[11px] font-semibold text-on-surface-variant">
                {row.status}
              </span>
            </div>
          </div>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t ghost-border">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="text-center py-2">
              <p className="text-[9px] font-semibold text-on-surface-variant uppercase">
                Conv.
              </p>
              <p className="text-sm font-bold text-on-surface tabular-nums">
                {row.conversions == null ? <NullMetric /> : row.conversions === 0 ? "0" : fmtCount(row.conversions)}
              </p>
            </div>
            <div className="text-center py-2">
              <p className="text-[9px] font-semibold text-on-surface-variant uppercase">
                CPA
              </p>
              <p className="text-sm font-bold text-on-surface tabular-nums">
                {row.cpa == null
                  ? <span className="text-on-surface-variant/40">—</span>
                  : <MoneyTile usd={row.cpa} decimals={2} />}
              </p>
            </div>
            <div className="text-center py-2">
              <p className="text-[9px] font-semibold text-on-surface-variant uppercase">
                Revenue
              </p>
              <p className="text-sm font-bold text-emerald-600 tabular-nums">
                {(() => {
                  const rev = row.revenue;
                  if (rev == null) return <span className="text-on-surface-variant/40">—</span>;
                  return <MoneyTile usd={rev} compact={rev >= 1_000} decimals={rev >= 1_000 ? 1 : 2} />;
                })()}
              </p>
              <div className="flex justify-center mt-0.5">
                <RevenueSparkline
                  data={row.revenueTrend}
                  fallbackPct={row.revenueTrendPct}
                  fallbackIsNew={row.revenueIsNew}
                />
              </div>
            </div>
            <div className="text-center py-2">
              <p className="text-[9px] font-semibold text-on-surface-variant uppercase">
                Clicks
              </p>
              <p className="text-sm font-bold text-on-surface tabular-nums">
                {row.clicks == null ? <NullMetric /> : row.clicks === 0 ? "0" : fmtCount(row.clicks)}
              </p>
            </div>
            <div className="text-center py-2">
              <p className="text-[9px] font-semibold text-on-surface-variant uppercase">
                Impressions
              </p>
              <p className="text-sm font-bold text-on-surface tabular-nums">
                {row.impressions == null ? <NullMetric /> : row.impressions === 0 ? "0" : fmtCount(row.impressions)}
              </p>
            </div>
            <div className="text-center py-2">
              <p className="text-[9px] font-semibold text-on-surface-variant uppercase">
                CTR
              </p>
              <p className="text-sm font-bold text-on-surface tabular-nums">
                {row.ctr == null ? <NullMetric /> : `${row.ctr.toFixed(2)}%`}
              </p>
            </div>
          </div>
          {targetRoasFor && (
            <div className="mb-3 pt-2 border-t ghost-border" onClick={(e) => e.stopPropagation()}>
              {(() => {
                const tRoas = targetRoasFor(row.campaignId, DEFAULT_TARGET_ROAS);
                const currentOverride = econSettings?.campaignOverrides?.[row.campaignId];
                const hasOverride = typeof currentOverride === "number";
                const hasOrgDefault = econSettings?.targetRoas != null;
                const provenance = hasOverride ? "campaign override" : hasOrgDefault ? "configured" : "default";
                return (
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-0.5">
                      <p className="text-[9px] font-semibold text-on-surface-variant uppercase tracking-wider">
                        Target ROAS
                      </p>
                      <HealthBadge roas={row.roas} targetRoas={tRoas} targetRoasProvenance={provenance} />
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      {roasEditing ? (
                        <>
                          <div className="flex items-center gap-1">
                            <input
                              ref={roasInputRef}
                              type="number"
                              min="0.1"
                              max="100"
                              step="0.1"
                              value={roasValue}
                              onChange={(e) => { setRoasValue(e.target.value); setRoasError(null); }}
                              onBlur={() => void saveRoasEdit()}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { e.preventDefault(); void saveRoasEdit(); }
                                if (e.key === "Escape") { e.preventDefault(); cancelRoasEdit(); }
                              }}
                              placeholder={String((econSettings?.targetRoas ?? DEFAULT_TARGET_ROAS).toFixed(1))}
                              className="w-16 text-[11px] tabular-nums border border-outline-variant/40 rounded px-1.5 py-1 bg-surface focus:outline-none focus:border-accent-blue"
                              disabled={roasSaving}
                            />
                            <button
                              onMouseDown={(e) => { e.preventDefault(); void saveRoasEdit(); }}
                              disabled={roasSaving}
                              title="Save target ROAS"
                              className="w-7 h-7 flex items-center justify-center rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 disabled:opacity-40 transition-colors"
                            >
                              {roasSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                            </button>
                            <button
                              onMouseDown={(e) => { e.preventDefault(); cancelRoasEdit(); }}
                              disabled={roasSaving}
                              title="Cancel (Esc)"
                              className="w-7 h-7 flex items-center justify-center rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 disabled:opacity-40 transition-colors"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                          {roasError && (
                            <span className="text-[9px] text-rose-600 leading-none">{roasError}</span>
                          )}
                        </>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "text-[11px] tabular-nums font-semibold",
                              hasOverride ? "text-on-surface" : "text-on-surface-variant/60",
                            )}
                          >
                            {tRoas.toFixed(1)}×
                          </span>
                          {isManager && setCampaignTargetRoas && (
                            <button
                              onClick={() => startRoasEdit(currentOverride)}
                              title={hasOverride ? `Edit override (${tRoas.toFixed(1)}×)` : "Set per-campaign target ROAS"}
                              className="w-7 h-7 flex items-center justify-center rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface-variant transition-colors"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          {onAnalyze && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAnalyze(buildAnalyzePrompt(row));
              }}
              disabled={isAnalyzing}
              className={cn(
                "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold transition-all min-h-[44px]",
                isAnalyzing
                  ? "bg-surface-container-low text-on-surface-variant cursor-not-allowed"
                  : "bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20 active:scale-[0.98]",
              )}
            >
              {isAnalyzing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              {isAnalyzing ? "Analyzing…" : "Deep-Dive Analysis"}
            </button>
          )}
        </div>
      )}
    </div>
  );
});

function MetaConnectPrompt() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4">
      <div className="w-10 h-10 rounded-2xl bg-[#1877F2]/10 flex items-center justify-center">
        <SiMeta className="w-5 h-5 text-[#1877F2]" />
      </div>
      <div className="text-center space-y-1.5">
        <p className="text-sm font-bold text-on-surface">
          Meta Ads not connected
        </p>
        <p className="text-[11px] text-on-surface-variant max-w-[200px] leading-relaxed">
          Connect your Meta Business account to see live campaign performance.
        </p>
      </div>
      <Link
        to="/connections"
        className="flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-accent-blue text-white text-xs font-bold hover:bg-accent-blue/90 transition-all min-h-[44px]"
      >
        <Link2 className="w-3 h-3" />
        Connect Meta Ads
      </Link>
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
        <p className="text-sm font-bold text-on-surface">
          No campaign data synced
        </p>
        <p className="text-[11px] text-on-surface-variant max-w-[210px] leading-relaxed">
          Connect Google Ads and run a sync to see live campaign performance in
          real time.
        </p>
      </div>
      <Link
        to="/connections"
        className="flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-accent-blue text-white text-xs font-bold hover:bg-accent-blue/90 transition-all min-h-[44px]"
      >
        <Link2 className="w-3 h-3" />
        Connect Google Ads
      </Link>
    </div>
  );
}

export function PerformanceGrid({ onAnalyze }: PerformanceGridProps) {
  const isMobile = useIsMobile();
  const { dateRange, refreshKey } = useDateRange();
  const { activeWorkspace } = useWorkspace();
  // Tenant-configured target ROAS (Task #153) — falls back to per-campaign
  // override → org default → portfolio default inside `targetRoasFor`.
  const { targetRoasFor, settings: econSettings, setCampaignTargetRoas } = useEconomicsSettings();
  // Task #164: inline target ROAS editing for manager+ users.
  const { permitted: isManager } = useHasPermission("manager");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const editCancelledRef = useRef(false);
  const [platform, setPlatform] = useState<"google" | "meta">("google");
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [channels, setChannels] = useState<LiveChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [activeConnCount, setActiveConnCount] = useState<number | null>(null);
  // ── Window-empty disambiguation (task #114) ─────────────────────────────
  // Tracks whether the warehouse has rows for this tenant outside the
  // currently selected date window. When true and the in-window result set
  // is empty we surface the WindowEmptyBanner instead of the "Connect
  // accounts" empty state.
  const [hasDataOutsideWindow, setHasDataOutsideWindow] = useState(false);
  const [latestAdsSyncAt, setLatestAdsSyncAt] = useState<string | null>(null);
  // Status filter controls which campaigns are fetched from the API.
  // "ALL" fetches every status (ENABLED + PAUSED + REMOVED) via the live
  // Google Ads endpoint. "ENABLED" uses the fast warehouse /channels route.
  type StatusFilter = "ALL" | "ENABLED" | "PAUSED" | "REMOVED";
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ENABLED");
  // Lookback window in days for the campaigns grid (independent of the global
  // date-range context so the user can browse older/paused campaigns without
  // changing the KPI window for the rest of the dashboard).
  const [lookbackDays, setLookbackDays] = useState(30);
  const [dataSource, setDataSource] = useState<"warehouse" | "live">("warehouse");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const fetchConns = async () => {
      try {
        const resp = await authFetch(`${API_BASE}api/connections`);
        if (resp.ok) {
          const raw = await resp.json();
          const list: Array<{ isActive: boolean }> = Array.isArray(raw) ? raw : (raw.connections ?? raw.data ?? []);
          setActiveConnCount(list.filter((c) => c.isActive).length);
        }
      } catch { /* connection check failed silently */ }
    };
    void fetchConns();
  }, []);

  const { qs: filterQs, refreshKey: filterRefreshKey } = useFilterQs("performance-grid");

  // Decide which endpoint to use. The live endpoint goes direct to the
  // Google Ads API and returns any status + any lookback window. The
  // warehouse /channels route uses synced data (fast but ENABLED-only).
  const useLiveEndpoint = statusFilter !== "ENABLED" || lookbackDays > 30;

  const load = async (p = 1) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(false);
    try {
      let url: string;
      if (useLiveEndpoint) {
        url = `${API_BASE}api/warehouse/campaigns/live?statusFilter=${statusFilter}&lookbackDays=${lookbackDays}&limit=200`;
        setDataSource("live");
      } else {
        // Warehouse endpoint — compute from/to from local lookbackDays so
        // this grid's window stays independent of the global date-range picker.
        const endDate   = new Date();
        const startDate = new Date(endDate.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
        const from = startDate.toISOString().slice(0, 10);
        const to   = endDate.toISOString().slice(0, 10);
        url = `${API_BASE}api/warehouse/channels?page=${p}&page_size=20&days=${lookbackDays}&from=${from}&to=${to}${filterQs}`;
        setDataSource("warehouse");
      }

      const resp = await authFetch(url, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!resp.ok) {
        if (p === 1) {
          setChannels([]);
          setTotalCount(0);
          setHasMore(false);
          setError(true);
        }
        return;
      }
      const data = (await resp.json()) as {
        data: LiveChannel[];
        total_count: number;
        has_more: boolean;
        syncedAt: number;
        hasDataInWindow?: boolean;
        hasDataOutsideWindow?: boolean;
        latestAdsSyncAt?: string | null;
      };
      if (controller.signal.aborted) return;
      if (p === 1) {
        setChannels(data.data ?? []);
      } else {
        setChannels((prev) => [...prev, ...(data.data ?? [])]);
      }
      setTotalCount(data.total_count ?? 0);
      setHasMore(data.has_more ?? false);
      setSyncedAt(data.syncedAt ?? null);
      // Task #114: capture window-empty metadata so the banner can render
      // when an empty grid is caused by a narrow date window (warehouse has
      // older rows) rather than by no data at all.
      setHasDataOutsideWindow(Boolean(data.hasDataOutsideWindow));
      setLatestAdsSyncAt(data.latestAdsSyncAt ?? null);
      setPage(p);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  // When the active workspace changes, clear stale data immediately so
  // skeleton loaders appear before the new workspace data arrives.
  useEffect(() => {
    setChannels([]);
    setTotalCount(0);
    setPage(1);
  }, [activeWorkspace?.id]);

  useEffect(() => {
    void load(1);
    return () => { abortRef.current?.abort(); };
  }, [dateRange.daysBack, refreshKey, activeWorkspace?.id, filterQs, filterRefreshKey, statusFilter, lookbackDays]);

  const rows = useMemo(() => {
    return channels.slice().sort((a, b) => {
      const av = a[sortKey] ?? (sortDir === "asc" ? Infinity : -Infinity);
      const bv = b[sortKey] ?? (sortDir === "asc" ? Infinity : -Infinity);
      const diff = (av as number) - (bv as number);
      return sortDir === "asc" ? diff : -diff;
    });
  }, [channels, sortKey, sortDir]);

  const toggleSort = useCallback((k: SortKey) => {
    if (sortKey === k) setSortDir((v) => (v === "desc" ? "asc" : "desc"));
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  }, [sortKey]);

  const handleRowAnalyze = useCallback((row: LiveChannel) => {
    if (!onAnalyze) return;
    setAnalyzingId(row.campaignId);
    onAnalyze(buildAnalyzePrompt(row));
    setTimeout(() => setAnalyzingId(null), 3000);
  }, [onAnalyze]);

  // Task #164: per-campaign target ROAS inline editing helpers.
  const startEdit = useCallback((campaignId: string, currentOverride: number | undefined) => {
    editCancelledRef.current = false;
    setEditingId(campaignId);
    setEditingValue(currentOverride != null ? String(currentOverride) : "");
    setEditError(null);
    // Focus the input on next tick after render
    setTimeout(() => editInputRef.current?.focus(), 0);
  }, []);

  const cancelEdit = useCallback(() => {
    editCancelledRef.current = true;
    setEditingId(null);
    setEditingValue("");
    setEditError(null);
  }, []);

  const saveEdit = useCallback(async (campaignId: string) => {
    // Guard: if Esc was pressed, onBlur fires after onKeyDown but we must not save.
    if (editCancelledRef.current) {
      editCancelledRef.current = false;
      return;
    }
    const trimmed = editingValue.trim();
    const parsed = trimmed === "" ? null : parseFloat(trimmed);
    if (trimmed !== "" && (Number.isNaN(parsed) || (parsed as number) <= 0 || (parsed as number) > 100)) {
      setEditError("Enter 0.1–100 or leave blank to clear");
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      await setCampaignTargetRoas(campaignId, parsed);
      setEditingId(null);
      setEditingValue("");
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setEditSaving(false);
    }
  }, [editingValue, setCampaignTargetRoas]);

  const { totalSpend, totalRevenue, blendedRoas, totalConvs, totalClicks, totalImpressions } = useMemo(() => {
    const totalSpend = rows.reduce((s, r) => s + (r.spend ?? 0), 0);
    const totalRevenue = rows.reduce(
      (s, r) => s + (r.revenue ?? 0),
      0,
    );
    // Blended ROAS = total revenue / total spend (a single weighted ratio
    // across the visible campaigns), not a per-row average. This matches
    // how the AI tool reports portfolio ROAS.
    const blendedRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    const totalConvs = rows.reduce((s, r) => s + (r.conversions ?? 0), 0);
    const totalClicks = rows.reduce((s, r) => s + (r.clicks ?? 0), 0);
    const totalImpressions = rows.reduce((s, r) => s + (r.impressions ?? 0), 0);
    return { totalSpend, totalRevenue, blendedRoas, totalConvs, totalClicks, totalImpressions };
  }, [rows]);

  const noConnections = activeConnCount !== null && activeConnCount === 0;
  const isLive = !loading && !error && channels.length > 0 && !noConnections;

  return (
    <div className="w-full h-full border-l border-outline-variant/15 bg-white flex flex-col">
      <div className="px-3 pt-2 shrink-0">
        <FilterBar
          pageKey="performance-grid"
          dimensions={[
            { id: "platform" },
            { id: "campaign" },
            { id: "network" },
            { id: "device" },
            { id: "country" },
          ]}
        />
      </div>
      <div className="px-4 py-3 border-b border-outline-variant/15 shrink-0 flex items-start justify-between gap-2">
        <div className="shrink-0">
          <p className="text-[9px] font-semibold text-on-secondary-container uppercase tracking-widest">
            {dataSource === "live" ? "Live · Google Ads API" : "Active Channels"}
          </p>
          <h2 className="text-sm font-bold text-on-surface">
            Performance Grid
          </h2>
        </div>

        {/* ── Status filter ───────────────────────────────────────── */}
        <div className="flex items-center gap-1 flex-wrap">
          {(["ENABLED", "PAUSED", "REMOVED", "ALL"] as const).map((s) => {
            const labels: Record<string, string> = { ENABLED: "Active", PAUSED: "Paused", REMOVED: "Removed", ALL: "All" };
            return (
              <button
                key={s}
                type="button"
                onClick={() => { setStatusFilter(s); setPage(1); }}
                data-testid={`status-filter-${s.toLowerCase()}`}
                className={cn(
                  "px-2 py-0.5 rounded-full text-[9px] font-bold transition-colors",
                  statusFilter === s
                    ? "bg-accent-blue text-white"
                    : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container",
                )}
              >
                {labels[s]}
              </button>
            );
          })}
        </div>

        {/* ── Lookback + live/offline badge + refresh ─────────────── */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1">
            <Calendar className="w-2.5 h-2.5 text-on-surface-variant" />
            <select
              value={lookbackDays}
              onChange={(e) => { setLookbackDays(Number(e.target.value)); setPage(1); }}
              aria-label="Lookback window"
              className="text-[9px] font-bold text-on-surface-variant bg-transparent border-none outline-none cursor-pointer pr-1"
            >
              {[30, 60, 90, 180, 365].map((d) => (
                <option key={d} value={d}>{d}d</option>
              ))}
            </select>
          </div>

          {!loading && (
            <div
              className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold",
                isLive
                  ? "text-emerald-700 bg-emerald-50"
                  : "text-on-surface-variant bg-surface-container-low",
              )}
            >
              {isLive ? (
                <Wifi className="w-2.5 h-2.5" />
              ) : (
                <WifiOff className="w-2.5 h-2.5" />
              )}
              {isLive ? "LIVE" : "OFFLINE"}
            </div>
          )}
          <button
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh campaign data"
            className="text-on-surface-variant hover:text-on-surface active:scale-[0.9] transition-all duration-150 disabled:opacity-30 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl"
          >
            <RefreshCw
              className={cn("w-3.5 h-3.5", loading && "animate-spin")}
            />
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
          {!loading && rows.length > 0 && !noConnections && (
            <div className="px-3 py-2 border-b border-outline-variant/15 flex items-center gap-4 shrink-0">
              <div>
                <p className="text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider">
                  Total Spend
                </p>
                <p className="text-[11px] font-bold text-accent-blue tabular-nums">
                  {totalSpend > 0
                    ? <MoneyTile usd={totalSpend} compact={totalSpend >= 1_000} decimals={totalSpend < 1_000 ? 0 : 1} />
                    : <MoneyTile usd={0} decimals={0} />}
                </p>
              </div>
              <div>
                <p className="text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider">
                  Revenue
                </p>
                <p className="text-[11px] font-bold text-emerald-600 tabular-nums">
                  {totalRevenue > 0
                    ? <MoneyTile usd={totalRevenue} compact={totalRevenue >= 1_000} decimals={totalRevenue < 1_000 ? 0 : 1} />
                    : <span title="No conversion value reported by Google Ads in this window">—</span>}
                </p>
              </div>
              <div>
                <p
                  className="text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider"
                  title="Blended ROAS = total revenue ÷ total spend across the visible campaigns"
                >
                  Blended ROAS
                </p>
                <p className="text-[11px] font-bold text-on-surface tabular-nums">
                  {blendedRoas > 0
                    ? `${blendedRoas.toFixed(2)}×`
                    : <span title="No ROAS data available yet">—</span>}
                </p>
              </div>
              <div>
                <p className="text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider">
                  Conversions
                </p>
                <p className="text-[11px] font-bold text-emerald-600 tabular-nums">
                  {totalConvs > 0 ? fmtCount(totalConvs) : <span title="No conversions recorded yet">—</span>}
                </p>
              </div>
              <div>
                <p className="text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider">
                  Clicks
                </p>
                <p className="text-[11px] font-bold text-on-surface tabular-nums">
                  {totalClicks > 0 ? fmtCount(totalClicks) : "—"}
                </p>
              </div>
              <div>
                <p className="text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider">
                  Impressions
                </p>
                <p className="text-[11px] font-bold text-on-surface tabular-nums">
                  {totalImpressions > 0 ? fmtCount(totalImpressions) : "—"}
                </p>
              </div>
              {syncedAt && (
                <div className="ml-auto">
                  <p className="text-[8px] font-medium text-on-surface-variant uppercase tracking-wider">
                    Synced
                  </p>
                  <p className="text-[9px] text-on-surface-variant">
                    {formatRelativeTime(syncedAt)}
                  </p>
                </div>
              )}
            </div>
          )}

          {loading ? (
            isMobile ? (
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {[1, 2, 3].map((i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            ) : (
              <ScrollArea className="flex-1">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface-container-low">
                      {["Campaign", "Status", "Spend", "ROAS", "Conv.", "CPA", "Revenue", "Clicks", "Impr.", "CTR"].map(
                        (h) => (
                          <th
                            key={h}
                            className="px-3 py-2 text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider"
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <SkeletonRow key={i} />
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            )
          ) : error ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <p className="text-[11px] text-error-m3 text-center">
                Failed to load channel data.
              </p>
            </div>
          ) : rows.length === 0 || noConnections ? (
            // Task #114: when the grid is empty BUT the warehouse has data
            // outside the selected window, show the WindowEmptyBanner with a
            // "Switch to Last 30 Days" shortcut. Otherwise fall back to the
            // original "Connect accounts" empty state for the truly empty case.
            hasDataOutsideWindow && !noConnections ? (
              <div className="flex-1 p-4">
                <WindowEmptyBanner latestSyncAt={latestAdsSyncAt} />
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4">
                <div className="w-10 h-10 rounded-2xl bg-surface-container-low flex items-center justify-center">
                  <WifiOff className="w-5 h-5 text-on-surface-variant" />
                </div>
                <div className="text-center space-y-1.5">
                  <p className="text-sm font-bold text-on-surface">
                    No active campaigns
                  </p>
                  <p className="text-[11px] text-on-surface-variant max-w-[240px] leading-relaxed">
                    Connect your Google Ads or Meta account to view live campaign performance.
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
            )
          ) : isMobile ? (
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-2">
                {rows.map((row) => (
                  <CampaignCard
                    key={row.campaignId}
                    row={row}
                    onAnalyze={onAnalyze}
                    isAnalyzing={analyzingId === row.campaignId}
                    targetRoasFor={targetRoasFor}
                    econSettings={econSettings}
                    setCampaignTargetRoas={setCampaignTargetRoas}
                    isManager={isManager}
                  />
                ))}
              </div>
              {hasMore && (
                <div className="flex justify-center py-3">
                  <button
                    onClick={() => void load(page + 1)}
                    disabled={loading}
                    className="text-[10px] font-bold uppercase tracking-widest text-accent-blue hover:text-accent-blue/80 disabled:opacity-40 transition-colors min-h-[44px] px-4"
                  >
                    {loading
                      ? "Loading…"
                      : `Load more (${channels.length} of ${totalCount})`}
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
                      <th className="px-3 py-2 text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider">
                        Campaign
                      </th>
                      <th className="px-2 py-2 text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider">
                        Status
                      </th>
                      <th
                        className="px-2 py-2 text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider cursor-pointer hover:text-on-surface select-none"
                        onClick={() => toggleSort("spend")}
                      >
                        <span className="flex items-center gap-1">
                          Spend{" "}
                          <SortIndicator
                            column="spend"
                            activeKey={sortKey}
                            activeDir={sortDir}
                          />
                        </span>
                      </th>
                      <th
                        className="px-2 py-2 text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider cursor-pointer hover:text-on-surface select-none"
                        onClick={() => toggleSort("roas")}
                      >
                        <span className="flex items-center gap-1">
                          ROAS{" "}
                          <SortIndicator
                            column="roas"
                            activeKey={sortKey}
                            activeDir={sortDir}
                          />
                        </span>
                      </th>
                      <th
                        className="px-2 py-2 text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider cursor-pointer hover:text-on-surface select-none"
                        onClick={() => toggleSort("conversions")}
                      >
                        <span className="flex items-center gap-1">
                          Conv.{" "}
                          <SortIndicator
                            column="conversions"
                            activeKey={sortKey}
                            activeDir={sortDir}
                          />
                        </span>
                      </th>
                      <th
                        className="px-2 py-2 text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider cursor-pointer hover:text-on-surface select-none"
                        onClick={() => toggleSort("cpa")}
                        title="Cost Per Acquisition"
                      >
                        <span className="flex items-center gap-1">
                          CPA{" "}
                          <SortIndicator
                            column="cpa"
                            activeKey={sortKey}
                            activeDir={sortDir}
                          />
                        </span>
                      </th>
                      <th
                        className="px-2 py-2 text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider cursor-pointer hover:text-on-surface select-none"
                        onClick={() => toggleSort("revenue")}
                        title="Revenue (conversion value reported by Google Ads)"
                      >
                        <span className="flex items-center gap-1">
                          Revenue{" "}
                          <SortIndicator
                            column="revenue"
                            activeKey={sortKey}
                            activeDir={sortDir}
                          />
                        </span>
                      </th>
                      <th
                        className="px-2 py-2 text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider cursor-pointer hover:text-on-surface select-none"
                        onClick={() => toggleSort("clicks")}
                      >
                        <span className="flex items-center gap-1">
                          Clicks{" "}
                          <SortIndicator
                            column="clicks"
                            activeKey={sortKey}
                            activeDir={sortDir}
                          />
                        </span>
                      </th>
                      <th
                        className="px-2 py-2 text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider cursor-pointer hover:text-on-surface select-none"
                        onClick={() => toggleSort("impressions")}
                      >
                        <span className="flex items-center gap-1">
                          Impr.{" "}
                          <SortIndicator
                            column="impressions"
                            activeKey={sortKey}
                            activeDir={sortDir}
                          />
                        </span>
                      </th>
                      <th
                        className="px-2 py-2 text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider cursor-pointer hover:text-on-surface select-none"
                        onClick={() => toggleSort("ctr")}
                      >
                        <span className="flex items-center gap-1">
                          CTR{" "}
                          <SortIndicator
                            column="ctr"
                            activeKey={sortKey}
                            activeDir={sortDir}
                          />
                        </span>
                      </th>
                      <th className="px-2 py-2 text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider">
                        Health
                      </th>
                      {onAnalyze && (
                        <th className="px-2 py-2 text-[9px] font-semibold text-on-secondary-container uppercase tracking-wider w-8" />
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[rgba(200,197,203,0.08)]">
                    {rows.map((row) => {
                      const isRowAnalyzing = analyzingId === row.campaignId;
                      return (
                        <tr
                          key={row.campaignId}
                          className={cn(
                            "transition-colors group",
                            onAnalyze
                              ? "hover:bg-accent-blue/[0.04] cursor-pointer"
                              : "hover:bg-surface",
                            isRowAnalyzing && "bg-accent-blue/[0.06]",
                          )}
                          onClick={() => handleRowAnalyze(row)}
                        >
                          <td className="px-3 py-2.5">
                            <span
                              className="text-[11px] font-medium text-on-surface truncate block max-w-[200px]"
                              title={row.campaignName}
                            >
                              {row.campaignName}
                            </span>
                            <LastActiveBadge lastActiveDate={row.lastActiveDate} status={row.status} />
                          </td>
                          <td className="px-2 py-2.5">
                            <StatusBadge status={row.status} />
                          </td>
                          <td className="px-2 py-2.5">
                            <span className="text-[11px] tabular-nums text-on-surface-variant">
                              {row.spend == null
                                ? <NullMetric />
                                : row.spend === 0
                                  ? <MoneyTile usd={0} decimals={2} />
                                  : <MoneyTile usd={row.spend} compact={row.spend >= 1_000} decimals={row.spend < 1_000 ? 0 : 1} />}
                            </span>
                          </td>
                          <td className="px-2 py-2.5">
                            <span
                              className={cn(
                                "text-[11px] font-bold tabular-nums",
                                row.roas >= 4
                                  ? "text-emerald-600"
                                  : row.roas >= 2
                                    ? "text-accent-blue"
                                    : row.roas > 0
                                      ? "text-amber-500"
                                      : "text-outline-variant",
                              )}
                            >
                              {row.roas == null ? <NullMetric /> : row.roas === 0 ? "0.00×" : `${row.roas.toFixed(2)}×`}
                            </span>
                          </td>
                          <td className="px-2 py-2.5">
                            <span className="text-[11px] tabular-nums text-on-surface-variant">
                              {row.conversions == null
                                ? <NullMetric />
                                : row.conversions === 0
                                  ? "0"
                                  : fmtCount(row.conversions)}
                            </span>
                          </td>
                          <td className="px-2 py-2.5">
                            <span className="text-[11px] tabular-nums text-on-surface-variant" title="Cost Per Acquisition">
                              {row.cpa == null
                                ? <span className="text-on-surface-variant/40">—</span>
                                : <MoneyTile usd={row.cpa} compact={row.cpa >= 1_000} decimals={row.cpa < 1_000 ? 2 : 1} />}
                            </span>
                          </td>
                          <td className="px-2 py-2.5">
                            <div className="flex flex-col items-start gap-0.5">
                              <span className="text-[11px] tabular-nums text-emerald-600" title="Revenue (conversion value reported by Google Ads)">
                                {(() => {
                                  const rev = row.revenue;
                                  if (rev == null) return <span className="text-on-surface-variant/40">—</span>;
                                  return <MoneyTile usd={rev} compact={rev >= 1_000} decimals={rev >= 1_000 ? 1 : 2} />;
                                })()}
                              </span>
                              <RevenueSparkline
                                data={row.revenueTrend}
                                fallbackPct={row.revenueTrendPct}
                                fallbackIsNew={row.revenueIsNew}
                              />
                            </div>
                          </td>
                          <td className="px-2 py-2.5">
                            <span className="text-[11px] tabular-nums text-on-surface-variant">
                              {row.clicks == null
                                ? <NullMetric />
                                : row.clicks === 0
                                  ? "0"
                                  : fmtCount(row.clicks)}
                            </span>
                          </td>
                          <td className="px-2 py-2.5">
                            <span className="text-[11px] tabular-nums text-on-surface-variant">
                              {row.impressions == null
                                ? <NullMetric />
                                : row.impressions === 0
                                  ? "0"
                                  : fmtCount(row.impressions)}
                            </span>
                          </td>
                          <td className="px-2 py-2.5">
                            <span className="text-[11px] tabular-nums text-on-surface-variant">
                              {row.ctr == null
                                ? <NullMetric />
                                : `${row.ctr.toFixed(2)}%`}
                            </span>
                          </td>
                          <td className="px-2 py-2.5">
                            {/* Task #149/#153/#164: score-based Health badge with
                                inline ROAS editor for manager+ users. Green > 80,
                                amber 50–80, red < 50. Click the pencil to override
                                the per-campaign target; clear the field to fall
                                back to the org default. */}
                            {(() => {
                              const tRoas = targetRoasFor(row.campaignId, DEFAULT_TARGET_ROAS);
                              const currentOverride = econSettings?.campaignOverrides?.[row.campaignId];
                              const hasOverride = typeof currentOverride === "number";
                              const hasOrgDefault = econSettings?.targetRoas != null;
                              const provenance = hasOverride ? "campaign override" : hasOrgDefault ? "configured" : "default";
                              const isEditing = editingId === row.campaignId;
                              return (
                                <div className="flex flex-col items-start gap-0.5" onClick={(e) => e.stopPropagation()}>
                                  <HealthBadge roas={row.roas} targetRoas={tRoas} targetRoasProvenance={provenance} />
                                  {isEditing ? (
                                    <>
                                      <div className="flex items-center gap-0.5 mt-0.5">
                                        <input
                                          ref={editInputRef}
                                          type="number"
                                          min="0.1"
                                          max="100"
                                          step="0.1"
                                          value={editingValue}
                                          onChange={(e) => { setEditingValue(e.target.value); setEditError(null); }}
                                          onBlur={() => void saveEdit(row.campaignId)}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter") { e.preventDefault(); void saveEdit(row.campaignId); }
                                            if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                                          }}
                                          placeholder={String((econSettings?.targetRoas ?? DEFAULT_TARGET_ROAS).toFixed(1))}
                                          className="w-14 text-[10px] tabular-nums border border-outline-variant/40 rounded px-1 py-0.5 bg-surface focus:outline-none focus:border-accent-blue"
                                          disabled={editSaving}
                                        />
                                        <button
                                          onMouseDown={(e) => { e.preventDefault(); void saveEdit(row.campaignId); }}
                                          disabled={editSaving}
                                          title="Save target ROAS"
                                          className="w-5 h-5 flex items-center justify-center rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 disabled:opacity-40 transition-colors"
                                        >
                                          {editSaving ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Check className="w-2.5 h-2.5" />}
                                        </button>
                                        <button
                                          onMouseDown={(e) => { e.preventDefault(); cancelEdit(); }}
                                          disabled={editSaving}
                                          title="Cancel (Esc)"
                                          className="w-5 h-5 flex items-center justify-center rounded bg-rose-50 hover:bg-rose-100 text-rose-600 disabled:opacity-40 transition-colors"
                                        >
                                          <X className="w-2.5 h-2.5" />
                                        </button>
                                      </div>
                                      {editError && (
                                        <span className="text-[8px] text-rose-600 leading-none">{editError}</span>
                                      )}
                                    </>
                                  ) : (
                                    <div className="flex items-center gap-0.5 group/target">
                                      {isManager ? (
                                        <button
                                          onClick={() => startEdit(row.campaignId, currentOverride)}
                                          title={hasOverride ? `Edit override (${tRoas.toFixed(1)}×) — click to change` : "Click to set per-campaign target ROAS"}
                                          className={cn(
                                            "text-[8px] tabular-nums leading-none transition-opacity cursor-pointer",
                                            hasOverride ? "opacity-80 font-bold hover:opacity-100" : "opacity-50 hover:opacity-90",
                                          )}
                                        >
                                          {tRoas.toFixed(1)}×
                                        </button>
                                      ) : (
                                        <Link
                                          href="/settings?tab=economics"
                                          onClick={(e) => e.stopPropagation()}
                                          title={`Scored vs target ROAS ${tRoas.toFixed(1)}× (${provenance}) — click to configure in Settings → Economics`}
                                          className={cn(
                                            "text-[8px] tabular-nums leading-none transition-opacity",
                                            hasOverride ? "opacity-80 font-bold hover:opacity-100" : "opacity-50 hover:opacity-90",
                                          )}
                                          style={{ color: "inherit", textDecoration: "none" }}
                                        >
                                          {tRoas.toFixed(1)}×
                                        </Link>
                                      )}
                                      {isManager && (
                                        <button
                                          onClick={() => startEdit(row.campaignId, currentOverride)}
                                          title={hasOverride ? `Edit override (${tRoas.toFixed(1)}×)` : "Set per-campaign target ROAS"}
                                          className="opacity-0 group-hover/target:opacity-60 hover:!opacity-100 w-3.5 h-3.5 flex items-center justify-center transition-opacity"
                                        >
                                          <Pencil className="w-2.5 h-2.5 text-on-surface-variant" />
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                          {onAnalyze && (
                            <td className="px-2 py-2.5">
                              <span
                                className={cn(
                                  "inline-flex items-center justify-center w-6 h-6 rounded-2xl transition-all",
                                  isRowAnalyzing
                                    ? "bg-accent-blue/20"
                                    : "opacity-0 group-hover:opacity-100 bg-accent-blue/10 hover:bg-accent-blue/20",
                                )}
                              >
                                {isRowAnalyzing ? (
                                  <Loader2 className="w-3 h-3 text-accent-blue animate-spin" />
                                ) : (
                                  <Sparkles className="w-3 h-3 text-accent-blue" />
                                )}
                              </span>
                            </td>
                          )}
                        </tr>
                      );
                    })}
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
                    {loading
                      ? "Loading…"
                      : `Load more (${channels.length} of ${totalCount})`}
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
