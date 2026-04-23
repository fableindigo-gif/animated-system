import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Wifi, WifiOff, DatabaseZap, Cpu, CircleDot, Calendar, ChevronDown, Check, ShieldCheck, ShieldAlert, ShieldX, Loader2, FileText, PlugZap } from "lucide-react";
import { useWorkspace } from "@/contexts/workspace-context";
import { useDateRange, PRESETS, type DatePreset } from "@/contexts/date-range-context";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth-fetch";
import { formatRelativeTime } from "@/lib/formatters";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

interface SystemStatus {
  etlStatus: "idle" | "running" | "complete" | "error";
  lastSyncedAt: number | null;
  activeProducts: number;
  hasData: boolean;
}

type InfraStatus = "operational" | "degraded" | "pending";

interface HealthCheck {
  check: string;
  ok: boolean;
  latencyMs: number;
  detail?: string;
}

interface QualityFixesScannerStatus {
  state: "idle" | "running" | "last-error";
  lastRunAt: string | null;
  lastSuccessfulRunAt: string | null;
  lastSummary: {
    scanned: number;
    refreshed: number;
    failed: number;
    skipped: boolean;
    reason?: string;
  } | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  pendingScanCount: number;
}

interface FeedgenRecoveryStatus {
  state: "idle" | "running" | "last-error";
  lastSweepAt: string | null;
  lastSuccessfulSweepAt: string | null;
  lastRecoveredCount: number;
  totalRecoveredCount: number;
  currentStuckCount: number;
  lastErrorMessage: string | null;
}

interface InfraHealth {
  status: InfraStatus;
  lastRunAt: string | null;
  checks: HealthCheck[];
  qualityFixesScanner?: QualityFixesScannerStatus;
  feedgenRecovery?: FeedgenRecoveryStatus;
}

interface CacheHitRatePoint {
  hour: string;
  hitRate: number | null;
}

interface CacheHealth {
  ok: boolean;
  backend: "memory" | "redis";
  configuredBackend: "memory" | "redis";
  pingMs: number | null;
  reason?: string;
  lastErrorAt: string | null;
  lastErrorReason: string | null;
  hitRate: number | null;
  hitsLastHour: number;
  missesLastHour: number;
  bypassesLastHour: number;
  history?: CacheHitRatePoint[];
}

interface ShoppingInsiderWindowStats {
  windowMs: number;
  hits: number;
  misses: number;
  bytesBilled: number;
  bytesAvoided: number;
  hitRate: number | null;
}

interface ShoppingInsiderAlertStatus {
  ok: boolean;
  alerterEnabled: boolean;
  lastAlertKind: "bytes_billed_spike" | "hit_rate_floor" | null;
  lastAlertAt: number | null;
  currentWindow: ShoppingInsiderWindowStats | null;
}


const PRESET_ORDER: DatePreset[] = ["today", "7d", "14d", "30d", "90d", "mtd", "ytd"];

function toInputDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function DateRangePicker() {
  const { dateRange, setPreset, setCustomRange } = useDateRange();
  const [open, setOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setShowCustom(false); }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleApplyCustom = () => {
    if (!customFrom || !customTo) return;
    const from = new Date(customFrom + "T00:00:00");
    const to = new Date(customTo + "T23:59:59");
    if (from > to) return;
    setCustomRange(from, to);
    setOpen(false);
    setShowCustom(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-1.5 px-2 py-0.5 rounded-2xl transition-all",
          "hover:bg-surface-container-low",
          open ? "bg-surface-container-low text-accent-blue" : "text-on-secondary-container",
        )}
      >
        <Calendar className="w-2.5 h-2.5" />
        <span className="text-[9px] font-semibold">{dateRange.label}</span>
        <ChevronDown className={cn("w-2 h-2 transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence>
        {open && (
        <motion.div
          className="absolute top-full left-0 mt-1 z-50 min-w-[200px] bg-white border border-outline-variant/30 rounded-2xl shadow-lg overflow-hidden"
          initial={{ opacity: 0, y: -6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.97 }}
          transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
          style={{ willChange: "transform, opacity" }}
        >
          <div className="px-3 py-1.5 border-b ghost-border">
            <span className="text-[8px] font-semibold text-on-secondary-container uppercase tracking-widest">Time Range</span>
          </div>
          {PRESET_ORDER.map((key) => {
            const DYNAMIC_LABELS: Record<string, string> = { mtd: "Month to Date", ytd: "Year to Date" };
            const meta = (key in PRESETS) ? PRESETS[key as keyof typeof PRESETS] : null;
            const label = meta?.label ?? DYNAMIC_LABELS[key] ?? key;
            const daysLabel = meta ? `${meta.daysBack}d` : key === "mtd" ? "MTD" : "YTD";
            const isActive = dateRange.preset === key;
            return (
              <button
                key={key}
                onClick={() => { setPreset(key); setOpen(false); setShowCustom(false); }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors",
                  isActive
                    ? "bg-accent-blue/8 text-accent-blue"
                    : "text-on-surface-variant hover:bg-surface hover:text-on-surface",
                )}
              >
                {isActive && <Check className="w-2.5 h-2.5 shrink-0" />}
                {!isActive && <span className="w-2.5" />}
                <span className="text-[10px] font-medium">{label}</span>
                <span className="ml-auto text-[8px] font-medium text-outline">{daysLabel}</span>
              </button>
            );
          })}

          <div className="border-t ghost-border">
            <button
              onClick={() => setShowCustom(!showCustom)}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors",
                dateRange.preset === "custom"
                  ? "bg-accent-blue/8 text-accent-blue"
                  : "text-on-surface-variant hover:bg-surface hover:text-on-surface",
              )}
            >
              {dateRange.preset === "custom" && <Check className="w-2.5 h-2.5 shrink-0" />}
              {dateRange.preset !== "custom" && <span className="w-2.5" />}
              <span className="text-[10px] font-medium">Custom Range</span>
              <Calendar className="ml-auto w-2.5 h-2.5 text-outline" />
            </button>

            {showCustom && (
              <div className="px-3 pb-3 pt-1 space-y-2">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-[8px] font-semibold text-on-surface-variant uppercase tracking-wider block mb-0.5">From</label>
                    <input
                      type="date"
                      value={customFrom || (dateRange.preset === "custom" ? toInputDate(dateRange.from) : "")}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      max={toInputDate(new Date())}
                      className="w-full px-2 py-1.5 text-[10px] border border-outline-variant/15 rounded-2xl outline-none focus:border-accent-blue focus:ring-1 focus:ring-accent-blue/20 bg-white text-on-surface"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-[8px] font-semibold text-on-surface-variant uppercase tracking-wider block mb-0.5">To</label>
                    <input
                      type="date"
                      value={customTo || (dateRange.preset === "custom" ? toInputDate(dateRange.to) : "")}
                      onChange={(e) => setCustomTo(e.target.value)}
                      max={toInputDate(new Date())}
                      className="w-full px-2 py-1.5 text-[10px] border border-outline-variant/15 rounded-2xl outline-none focus:border-accent-blue focus:ring-1 focus:ring-accent-blue/20 bg-white text-on-surface"
                    />
                  </div>
                </div>
                <button
                  onClick={handleApplyCustom}
                  disabled={!customFrom || !customTo}
                  className="w-full py-1.5 rounded-2xl text-[10px] font-semibold bg-accent-blue text-white disabled:opacity-40 hover:bg-accent-blue/90 transition-all"
                >
                  Apply Range
                </button>
              </div>
            )}
          </div>
        </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Google Workspace background health ──────────────────────────────────────

type GWSHealthStatus = "not_connected" | "healthy" | "needs_reconnect";

interface GWSPlatformHealth {
  status: GWSHealthStatus;
  errorCode?: string;
}

interface WorkspaceHealthSnapshot {
  checkedAt: string;
  platforms: Record<string, GWSPlatformHealth>;
}

interface CachedWorkspaceHealth {
  available: boolean;
  snapshot: WorkspaceHealthSnapshot | null;
}

const GWS_PLATFORM_LABELS: Record<string, string> = {
  google_calendar: "Google Calendar",
  google_drive: "Google Drive",
  google_docs: "Google Docs",
};

function WorkspaceHealthPill() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [snapshot, setSnapshot] = useState<WorkspaceHealthSnapshot | null>(null);
  const prevStatusRef = useRef<Record<string, GWSHealthStatus>>({});

  useEffect(() => {
    const poll = async () => {
      try {
        const resp = await authFetch(`${API_BASE}api/connections/google/health/cached`);
        if (!resp.ok) return;
        const data = await resp.json() as CachedWorkspaceHealth;
        if (!data.available || !data.snapshot) return;

        const current = data.snapshot;
        const prev = prevStatusRef.current;

        // Fire a toast for every platform that newly flipped to needs_reconnect.
        for (const [platform, health] of Object.entries(current.platforms)) {
          if (
            health.status === "needs_reconnect" &&
            prev[platform] !== "needs_reconnect"
          ) {
            const label = GWS_PLATFORM_LABELS[platform] ?? platform;
            toast({
              title: `${label} disconnected`,
              description: "This Google Workspace connection needs to be reconnected. Visit Connections to fix it.",
              variant: "destructive",
            });
          }
        }

        // Update previous status map.
        prevStatusRef.current = Object.fromEntries(
          Object.entries(current.platforms).map(([p, h]) => [p, h.status]),
        );

        setSnapshot(current);
      } catch {
        // non-fatal background poll
      }
    };

    void poll();
    const id = setInterval(() => void poll(), 5 * 60 * 1000); // every 5 min
    return () => clearInterval(id);
  }, [toast]);

  if (!snapshot) return null;

  const stalePlatforms = Object.entries(snapshot.platforms)
    .filter(([, h]) => h.status === "needs_reconnect")
    .map(([p]) => GWS_PLATFORM_LABELS[p] ?? p);

  if (stalePlatforms.length === 0) return null;

  return (
    <button
      onClick={() => navigate("/connections")}
      title={`Reconnect required: ${stalePlatforms.join(", ")}`}
      className="flex items-center gap-1 px-2 py-0.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-all"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
      <PlugZap className="w-2.5 h-2.5 text-amber-600" />
      <span className="text-[9px] font-semibold text-amber-700 whitespace-nowrap">
        Workspace {stalePlatforms.length === 1 ? "connection" : `${stalePlatforms.length} connections`} stale
      </span>
    </button>
  );
}

// ─── Mini sparkline for cache hit-rate history (Task #214) ───────────────────

function HitRateSparkline({ points }: { points: CacheHitRatePoint[] }) {
  const W = 56;
  const H = 18;
  const PAD = 1;

  if (points.length === 0) return null;

  const n = points.length;
  const xStep = n < 2 ? W : (W - PAD * 2) / (n - 1);
  const toX = (i: number) => PAD + i * xStep;
  const toY = (rate: number) => PAD + (H - PAD * 2) * (1 - rate);

  // Build path segments — null points break the line so they appear as gaps.
  let pathD = "";
  let penDown = false;
  for (let i = 0; i < n; i++) {
    const rate = points[i].hitRate;
    if (rate === null) {
      penDown = false;
    } else {
      const x = toX(i).toFixed(1);
      const y = toY(rate).toFixed(1);
      pathD += penDown ? ` L ${x} ${y}` : ` M ${x} ${y}`;
      penDown = true;
    }
  }

  // Colour based on the latest non-null value.
  const latestNonNull = [...points].reverse().find((p) => p.hitRate !== null)?.hitRate ?? 0;
  const stroke =
    latestNonNull >= 0.7 ? "#10b981" : latestNonNull >= 0.4 ? "#f59e0b" : "#ef4444";

  // Tooltip: one line per hour.
  const tooltipText = points.map((p) => {
    const d = new Date(p.hour);
    const hh = d.getUTCHours().toString().padStart(2, "0");
    const val = p.hitRate === null ? "—" : `${Math.round(p.hitRate * 100)}%`;
    return `${hh}:00 UTC — ${val}`;
  }).join("\n");

  // Last visible point for the end-dot.
  const lastIdx = [...points].reduce<number>((acc, p, i) => (p.hitRate !== null ? i : acc), -1);

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="shrink-0 overflow-visible"
      aria-label="Hit-rate sparkline (24 h)"
    >
      <path d={pathD.trim()} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {lastIdx >= 0 && points[lastIdx].hitRate !== null && (
        <circle cx={toX(lastIdx)} cy={toY(points[lastIdx].hitRate!)} r="2" fill={stroke} />
      )}
    </svg>
  );
}

const CHECK_LABELS: Record<string, string> = {
  database: "Database",
  etl_integrity: "ETL Pipeline",
  google_ads_token: "Google Ads",
  shopify_token: "Shopify",
  llm_availability: "AI Engine",
};

function SystemHealthPill() {
  const [health, setHealth] = useState<InfraHealth | null>(null);
  const [cache, setCache] = useState<CacheHealth | null>(null);
  const [siAlert, setSiAlert] = useState<ShoppingInsiderAlertStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const resp = await fetch(`${API_BASE}api/system-health`);
        if (resp.ok) setHealth(await resp.json());
      } catch (err) {
        console.error("[GlobalStatusBar] Health check failed:", err);
      }
      try {
        const resp = await authFetch(`${API_BASE}api/system/cache-health`);
        if (resp.ok) setCache(await resp.json() as CacheHealth);
      } catch (err) {
        console.error("[GlobalStatusBar] Cache health check failed:", err);
      }
      try {
        const resp = await authFetch(`${API_BASE}api/admin/shopping-insider-cache/alert-status`);
        if (resp.ok) setSiAlert((await resp.json()) as ShoppingInsiderAlertStatus);
      } catch (err) {
        console.error("[GlobalStatusBar] Shopping Insider alert-status failed:", err);
      }
    };
    void load();
    const id = setInterval(() => void load(), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setExpanded(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [expanded]);

  // Cache degradation rolls up into the overall pill so operators notice the
  // bill before BigQuery does. A "memory" backend that's intentionally
  // configured (no SHARED_CACHE_REDIS_URL) is healthy; a "redis" config that's
  // failing pings flips the indicator amber.
  const cacheUnhealthy = cache !== null && cache.ok === false;
  const baseStatus = health?.status ?? "pending";
  const s: InfraStatus =
    cacheUnhealthy && baseStatus !== "pending" ? "degraded" : baseStatus;
  const Icon = s === "operational" ? ShieldCheck : s === "degraded" ? ShieldX : Loader2;
  const dotColor = s === "operational" ? "bg-emerald-500" : s === "degraded" ? "bg-amber-500 animate-pulse" : "bg-[#c8c5cb]";
  const textColor = s === "operational" ? "text-emerald-600" : s === "degraded" ? "text-amber-600" : "text-on-surface-variant";
  const label = s === "operational" ? "All Systems Operational" : s === "degraded" ? "System Degraded" : "Checking…";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "flex items-center gap-1.5 px-2 py-0.5 rounded-2xl transition-all",
          "hover:bg-surface-container-low",
          expanded ? "bg-surface-container-low" : "",
        )}
      >
        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotColor)} />
        <Icon className={cn("w-2.5 h-2.5", textColor, s === "pending" && "animate-spin")} />
        <span className={cn("text-[9px] font-semibold uppercase tracking-widest", textColor)}>
          {label}
        </span>
      </button>

      <AnimatePresence>
        {expanded && health && (
          <motion.div
            className="absolute top-full left-0 mt-1 z-50 min-w-[240px] bg-white border border-outline-variant/30 rounded-2xl shadow-lg overflow-hidden"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            style={{ willChange: "transform, opacity" }}
          >
            <div className="px-3 py-1.5 border-b ghost-border flex items-center justify-between">
              <span className="text-[8px] font-semibold text-on-secondary-container uppercase tracking-widest">Health Checks</span>
              {health.lastRunAt && (
                <span className="text-[8px] text-outline">{formatRelativeTime(health.lastRunAt, "Never")}</span>
              )}
            </div>
            {health.checks.map((c, idx) => {
              const skipped = c.detail?.includes("skipped");
              return (
                <motion.div
                  key={c.check}
                  className="flex items-center gap-2 px-3 py-1.5 border-b border-[#f9f9fe] last:border-0"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.16, delay: idx * 0.04, ease: [0.4, 0, 0.2, 1] }}
                >
                  <span className={cn(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    skipped ? "bg-[#c8c5cb]" : c.ok ? "bg-emerald-500" : "bg-error-container0 animate-pulse",
                  )} />
                  <span className="text-[10px] font-medium text-on-surface flex-1">
                    {CHECK_LABELS[c.check] ?? c.check}
                  </span>
                  <span className={cn(
                    "text-[9px] font-medium",
                    skipped ? "text-on-surface-variant" : c.ok ? "text-emerald-600" : "text-error-m3",
                  )}>
                    {skipped ? "N/A" : c.ok ? `${c.latencyMs}ms` : "FAIL"}
                  </span>
                </motion.div>
              );
            })}
            {health.checks.length === 0 && (
              <div className="px-3 py-3 text-center text-[10px] text-outline">
                Awaiting first health check…
              </div>
            )}
            {cache && (
              <div
                className="flex flex-col gap-0.5 px-3 py-1.5 border-t border-[#f9f9fe]"
                title={cache.reason ?? cache.lastErrorReason ?? undefined}
              >
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    cache.ok ? "bg-emerald-500" : "bg-amber-500 animate-pulse",
                  )} />
                  <span className="text-[10px] font-medium text-on-surface flex-1">
                    Shared Cache
                    <span className="ml-1 text-[8px] text-outline uppercase tracking-widest">
                      {cache.backend}
                      {cache.configuredBackend !== cache.backend ? ` ← ${cache.configuredBackend}` : ""}
                    </span>
                  </span>
                  <span className={cn(
                    "text-[9px] font-medium",
                    cache.ok ? "text-emerald-600" : "text-amber-600",
                  )}>
                    {cache.ok
                      ? (cache.pingMs !== null ? `${cache.pingMs}ms` : "OK")
                      : "FAIL"}
                  </span>
                </div>
                <div className="flex items-center gap-2 pl-3.5">
                  <span
                    className="text-[9px] text-outline flex-1 cursor-help"
                    title="Rolling 1-hour hit rate for this server process. In multi-replica deployments each replica reports independently."
                  >Hit rate (1h)</span>
                  {cache.history && cache.history.length > 0 && (
                    <HitRateSparkline points={cache.history} />
                  )}
                  <span className={cn(
                    "text-[9px] font-medium tabular-nums",
                    cache.hitRate === null
                      ? "text-outline"
                      : cache.hitRate >= 0.7
                        ? "text-emerald-600"
                        : cache.hitRate >= 0.4
                          ? "text-amber-600"
                          : "text-error-m3",
                  )}>
                    {cache.hitRate === null
                      ? "—"
                      : `${Math.round(cache.hitRate * 100)}%`}
                    {cache.hitRate !== null && (
                      <span className="ml-1 text-outline font-normal">
                        ({cache.hitsLastHour}H / {cache.missesLastHour}M
                        {cache.bypassesLastHour > 0 ? ` / ${cache.bypassesLastHour}B` : ""})
                      </span>
                    )}
                  </span>
                </div>
              </div>
            )}
            {health.qualityFixesScanner && (
              <QualityFixesScannerSection scanner={health.qualityFixesScanner} />
            )}
            {health.feedgenRecovery && (
              <FeedgenRecoverySection recovery={health.feedgenRecovery} />
            )}
            {siAlert && (
              <ShoppingInsiderCostSection status={siAlert} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes} B`;
}

function ShoppingInsiderCostSection({ status }: { status: ShoppingInsiderAlertStatus }) {
  const [, navigate] = useLocation();
  const hasAlert = status.lastAlertKind !== null;
  const alertLabel =
    status.lastAlertKind === "bytes_billed_spike"
      ? "Spend spike"
      : status.lastAlertKind === "hit_rate_floor"
        ? "Cache-floor breach"
        : null;

  const dotColor = !status.alerterEnabled
    ? "bg-[#c8c5cb]"
    : hasAlert
      ? "bg-amber-500 animate-pulse"
      : "bg-emerald-500";

  const stateLabel = !status.alerterEnabled
    ? "Disabled"
    : hasAlert
      ? alertLabel ?? "Alert"
      : "OK";

  const stateTextColor = !status.alerterEnabled
    ? "text-on-surface-variant"
    : hasAlert
      ? "text-amber-600"
      : "text-emerald-600";

  const w = status.currentWindow;

  return (
    <div className="border-t ghost-border px-3 py-2 space-y-1.5 bg-surface-container-low/30">
      <div className="flex items-center justify-between">
        <span className="text-[8px] font-semibold text-on-secondary-container uppercase tracking-widest">
          Shopping Insider Cost
        </span>
        <span className="flex items-center gap-1.5">
          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotColor)} />
          <span className={cn("text-[9px] font-medium", stateTextColor)}>{stateLabel}</span>
          <button
            onClick={() => navigate("/platform-admin")}
            title="Configure alert thresholds"
            className="ml-0.5 p-0.5 rounded hover:bg-surface-container transition-colors text-outline hover:text-on-surface-variant"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </span>
      </div>

      {hasAlert && status.lastAlertAt !== null && (
        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/25">
          <span className="text-[9px] font-medium text-amber-700 flex-1 leading-tight">
            {alertLabel} detected
          </span>
          <span className="text-[8px] text-outline tabular-nums shrink-0">
            {formatRelativeTime(new Date(status.lastAlertAt).toISOString(), "—")}
          </span>
        </div>
      )}

      {w && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9px]">
          <span className="text-outline">Bytes billed (window)</span>
          <span className="text-on-surface text-right font-medium tabular-nums">
            {formatBytes(w.bytesBilled)}
          </span>

          <span className="text-outline">Bytes avoided</span>
          <span className="text-emerald-600 text-right font-medium tabular-nums">
            {formatBytes(w.bytesAvoided)}
          </span>

          <span className="text-outline">Hit rate (window)</span>
          <span className={cn(
            "text-right font-medium tabular-nums",
            w.hitRate === null
              ? "text-outline"
              : w.hitRate >= 0.7
                ? "text-emerald-600"
                : w.hitRate >= 0.4
                  ? "text-amber-600"
                  : "text-error-m3",
          )}>
            {w.hitRate === null
              ? "—"
              : `${Math.round(w.hitRate * 100)}% (${w.hits}H/${w.misses}M)`}
          </span>
        </div>
      )}

      {!status.alerterEnabled && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[9px] text-outline leading-snug">
            No thresholds configured — alerts are inactive.
          </p>
          <button
            onClick={() => navigate("/platform-admin")}
            className="shrink-0 text-[9px] font-semibold text-accent-blue hover:underline whitespace-nowrap"
          >
            Configure
          </button>
        </div>
      )}
    </div>
  );
}

function QualityFixesScannerSection({ scanner }: { scanner: QualityFixesScannerStatus }) {
  const aborted =
    scanner.lastErrorCode === "SHOPTIMIZER_NOT_CONFIGURED" ||
    scanner.lastErrorCode === "SHOPTIMIZER_UNREACHABLE";

  const stateColor =
    scanner.state === "running"
      ? "bg-accent-blue animate-pulse"
      : scanner.state === "last-error"
        ? "bg-error-container0 animate-pulse"
        : "bg-emerald-500";

  const stateLabel =
    scanner.state === "running"
      ? "Running"
      : scanner.state === "last-error"
        ? "Last run errored"
        : "Idle";

  const summary = scanner.lastSummary;

  return (
    <div className="border-t ghost-border px-3 py-2 space-y-1.5 bg-surface-container-low/30">
      <div className="flex items-center justify-between">
        <span className="text-[8px] font-semibold text-on-secondary-container uppercase tracking-widest">
          Quality Fixes Scanner
        </span>
        <span className="flex items-center gap-1">
          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", stateColor)} />
          <span className="text-[9px] font-medium text-on-surface-variant">{stateLabel}</span>
        </span>
      </div>

      {aborted && (
        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-error-container0/15 border border-error-container0/30">
          <span className="text-[9px] font-bold uppercase tracking-wider text-error-m3">
            {scanner.lastErrorCode === "SHOPTIMIZER_NOT_CONFIGURED"
              ? "Shoptimizer Not Configured"
              : "Shoptimizer Unreachable"}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9px]">
        <span className="text-outline">Last successful</span>
        <span className="text-on-surface text-right font-medium">
          {formatRelativeTime(scanner.lastSuccessfulRunAt, "Never")}
        </span>

        <span className="text-outline">Pending products</span>
        <span className="text-on-surface text-right font-medium">
          {scanner.pendingScanCount.toLocaleString()}
        </span>

        {summary && (
          <>
            <span className="text-outline">Last run</span>
            <span className="text-on-surface text-right font-medium">
              {summary.skipped && summary.reason === "no-stale-products"
                ? "no work"
                : `${summary.scanned} scanned`}
            </span>
            <span className="text-outline">Refreshed / failed</span>
            <span className="text-on-surface text-right font-medium">
              <span className="text-emerald-600">{summary.refreshed}</span>
              {" / "}
              <span className={summary.failed > 0 ? "text-error-m3" : "text-on-surface"}>
                {summary.failed}
              </span>
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function FeedgenRecoverySection({ recovery }: { recovery: FeedgenRecoveryStatus }) {
  // Stuck rows = the FeedGen worker died mid-batch and the sweeper hasn't yet
  // flipped the orphans back to retry-eligible. Surface as an amber warning so
  // operators know throughput is bleeding even when nothing is on fire.
  const hasStuck = recovery.currentStuckCount > 0;
  const errored  = recovery.state === "last-error";

  const stateColor = errored
    ? "bg-error-container0 animate-pulse"
    : hasStuck
      ? "bg-amber-500 animate-pulse"
      : recovery.state === "running"
        ? "bg-accent-blue animate-pulse"
        : "bg-emerald-500";

  const stateLabel = errored
    ? "Sweep errored"
    : hasStuck
      ? `${recovery.currentStuckCount} stuck`
      : recovery.state === "running"
        ? "Sweeping"
        : "Idle";

  return (
    <div className="border-t ghost-border px-3 py-2 space-y-1.5 bg-surface-container-low/30">
      <div className="flex items-center justify-between">
        <span className="text-[8px] font-semibold text-on-secondary-container uppercase tracking-widest">
          FeedGen Recovery
        </span>
        <span className="flex items-center gap-1">
          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", stateColor)} />
          <span className={cn(
            "text-[9px] font-medium",
            hasStuck ? "text-amber-600" : errored ? "text-error-m3" : "text-on-surface-variant",
          )}>
            {stateLabel}
          </span>
        </span>
      </div>

      {errored && recovery.lastErrorMessage && (
        <div
          className="px-1.5 py-0.5 rounded-md bg-error-container0/15 border border-error-container0/30"
          title={recovery.lastErrorMessage}
        >
          <span className="text-[9px] font-medium text-error-m3 line-clamp-1">
            {recovery.lastErrorMessage}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9px]">
        <span className="text-outline">Last sweep</span>
        <span className="text-on-surface text-right font-medium">
          {formatRelativeTime(recovery.lastSuccessfulSweepAt ?? recovery.lastSweepAt, "Never")}
        </span>

        <span className="text-outline">Stuck right now</span>
        <span className={cn(
          "text-right font-medium",
          hasStuck ? "text-amber-600" : "text-on-surface",
        )}>
          {recovery.currentStuckCount.toLocaleString()}
        </span>

        <span className="text-outline">Recovered (last sweep)</span>
        <span className={cn(
          "text-right font-medium",
          recovery.lastRecoveredCount > 0 ? "text-amber-600" : "text-on-surface",
        )}>
          {recovery.lastRecoveredCount.toLocaleString()}
        </span>

        <span className="text-outline">Recovered (total)</span>
        <span className="text-on-surface text-right font-medium">
          {recovery.totalRecoveredCount.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

export function GlobalStatusBar() {
  const { activeWorkspace } = useWorkspace();
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [connCount, setConnCount] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setCurrentTime(new Date()), 10_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const [kpiResp, connResp] = await Promise.all([
          authFetch(`${API_BASE}api/warehouse/kpis`),
          authFetch(`${API_BASE}api/connections`),
        ]);
        if (kpiResp.ok) {
          const d = await kpiResp.json() as SystemStatus;
          setStatus(d);
        }
        if (connResp.ok) {
          const raw = await connResp.json();
          const list: Array<{ isActive: boolean }> = Array.isArray(raw) ? raw : (raw.connections ?? raw.data ?? []);
          setConnCount(list.filter((c) => c.isActive).length);
        }
      } catch (err) { console.error("[GlobalStatusBar] Failed to load status data:", err); }
    };
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, []);

  const isEtlRunning = status?.etlStatus === "running";
  const isHealthy    = connCount > 0 && status?.hasData;
  const goalLabel    = activeWorkspace?.primaryGoal === "leadgen" ? "Lead Gen" : activeWorkspace?.primaryGoal === "hybrid" ? "Hybrid" : "E-Commerce";
  const timeStr      = currentTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="hidden lg:flex items-center gap-2 px-4 py-0.5 border-b border-outline-variant/15 bg-surface-container-low shrink-0 min-h-[22px] overflow-hidden">

      <div className="flex items-center pr-3 border-r border-outline-variant/15">
        <SystemHealthPill />
      </div>

      <div className="flex items-center px-2 border-r border-outline-variant/15">
        <DateRangePicker />
      </div>

      <div className="flex items-center gap-1.5 px-3 border-r border-outline-variant/15">
        {connCount > 0
          ? <Wifi className="w-2.5 h-2.5 text-on-surface-variant" />
          : <WifiOff className="w-2.5 h-2.5 text-on-surface-variant" />}
        <span className="text-[9px] font-medium text-on-secondary-container">
          {connCount} connection{connCount !== 1 ? "s" : ""}
        </span>
      </div>

      <WorkspaceHealthPill />

      {status && (
        <div className="flex items-center gap-1.5 px-3 border-r border-outline-variant/15">
          <DatabaseZap className="w-2.5 h-2.5 text-on-surface-variant" />
          <span className="text-[9px] font-medium text-on-secondary-container">
            Warehouse synced {formatRelativeTime(status.lastSyncedAt, "Never")}
          </span>
        </div>
      )}

      <div className="flex items-center gap-1.5 px-3 border-r border-outline-variant/15">
        <Cpu className="w-2.5 h-2.5 text-on-surface-variant" />
        <span className="text-[9px] font-medium text-on-secondary-container">{goalLabel} Mode</span>
      </div>

      <div className="flex items-center px-2 border-r border-outline-variant/15">
        <button
          onClick={() => navigate("/client-brief")}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-2xl hover:bg-surface-container-low transition-all text-on-secondary-container"
        >
          <FileText className="w-2.5 h-2.5" />
          <span className="text-[9px] font-semibold">Client Brief</span>
        </button>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2 pl-3 border-l border-outline-variant/15">
        {activeWorkspace && (
          <>
            <div className="flex items-center gap-1.5">
              <CircleDot className="w-2 h-2 text-emerald-500/50" />
              <span className="text-[9px] font-medium text-on-secondary-container">{activeWorkspace.clientName}</span>
            </div>
            <span className="text-[9px] text-outline-variant select-none">&bull;</span>
          </>
        )}
        <span className="text-[9px] font-medium text-on-secondary-container tabular-nums">{timeStr}</span>
      </div>
    </div>
  );
}
