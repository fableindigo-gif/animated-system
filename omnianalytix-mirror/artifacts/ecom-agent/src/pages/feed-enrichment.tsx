import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch, authPost } from "@/lib/auth-fetch";
import { queryKeys } from "@/lib/query-keys";
import { QueryErrorState } from "@/components/query-error-state";
import { useWorkspace } from "@/contexts/workspace-context";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  RefreshCw,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Clock,
  Zap,
  TrendingUp,
  ShoppingBag,
  ArrowUpRight,
  Play,
  Pause,
  BarChart3,
  Wrench,
  ArrowRight,
  Send,
  Search,
  Undo2,
  Upload,
  History,
  ChevronDown,
  ChevronUp,
  User,
  ShieldAlert,
  TimerReset,
  XCircle,
  RotateCw,
  ExternalLink,
} from "lucide-react";

const BASE     = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

// ─── Types ────────────────────────────────────────────────────────────────────
interface EnrichmentStatus {
  tier:          "enterprise" | "base";
  limit:         number | null;
  monthlyUsed:   number;
  remaining:     number | null;
  enrichedTotal: number;
  pendingTotal:  number;
  latestJob:     EnrichmentJob | null;
}

interface EnrichmentJob {
  id:            number;
  status:        "pending" | "running" | "completed" | "failed";
  totalSkus:     number;
  processedSkus: number;
  failedSkus:    number;
  errorMessage:  string | null;
  startedAt:     string | null;
  completedAt:   string | null;
  createdAt:     string;
}

interface Product {
  id:            string;
  productId:     string;
  sku:           string;
  title:         string;
  imageUrl:      string | null;
  status:        string | null;
  llmAttributes: { shape?: string; occasion?: string; finish?: string; activity?: string } | null;
  llmEnrichedAt: string | null;
}

type FilterMode = "all" | "enriched" | "pending";
type ViewMode   = "enrichment" | "fixes" | "feedgen" | "writeback";

interface FeedgenRewriteRow {
  id:                   string;
  productId:            string;
  sku:                  string;
  title:                string | null;
  imageUrl:             string | null;
  originalTitle:        string;
  originalDescription:  string;
  rewrittenTitle:       string;
  rewrittenDescription: string;
  qualityScore:         number;
  reasoning:            string;
  citedAttributes:      string[];
  status:               string;
  errorCode:            string | null;
  errorMessage:         string | null;
  generatedAt:          string;
}

interface FeedgenStatsPoint {
  day:              string;
  runs:             number;
  generated:        number;
  failed:           number;
  offered:          number;
  approved:         number;
  approvalRate:     number | null;
  promptTokens:     number;
  candidatesTokens: number;
  totalTokens:      number;
  estimatedUsd:     number;
}

interface FeedgenStatsResponse {
  days:   number;
  series: FeedgenStatsPoint[];
  totals: {
    runs:           number;
    generated:      number;
    offered:        number;
    approved:       number;
    approvalRate:   number | null;
    totalTokens:    number;
    estimatedUsd:   number;
    usdPerApproved: number | null;
  };
  pricing?: {
    promptUsdPer1M:     number;
    candidatesUsdPer1M: number;
    currency:           string;
    usingDefaults?: {
      prompt:     boolean;
      candidates: boolean;
    };
  };
}

type WritebackStatus = "pending" | "approved" | "applied" | "failed";
type RetryClass     = "none" | "non_retryable" | "auth" | "quota" | "transient";

interface WritebackRetry {
  retryClass:    RetryClass;
  retryable:     boolean;
  retryAfterSec: number | null;
  hint:          string;
}

interface WritebackTask {
  id:               number;
  status:           WritebackStatus;
  toolDisplayName:  string;
  comments:         string;
  createdAt:        string;
  resolvedAt:       string | null;
  offerId:          string | null;
  proposedByName:   string;
  attemptCount:     number;
  latestAttempt: {
    retry:      WritebackRetry | null;
    httpStatus: number | null;
    result:     { success: boolean; message: string } | null;
    createdAt:  string | null;
  } | null;
}

interface WritebackRunResultItem {
  taskId:     number;
  offerId:    string;
  ok:         boolean;
  httpStatus: number | null;
  message:    string;
  retry:      WritebackRetry;
}

interface WritebackRunResult {
  totalRequested: number;
  totalApplied:   number;
  totalFailed:    number;
  results:        WritebackRunResultItem[];
}

interface QualityFixField {
  field:  string;
  before: unknown;
  after:  unknown;
}

interface QualityFixRow {
  id:               string;
  tenantId:         string | null;
  productId:        string | null;
  sku:              string | null;
  title:            string | null;
  imageUrl:         string | null;
  productStatus:    string | null;
  scanStatus:       "ok" | "error" | string;
  errorCode:        string | null;
  errorMessage:     string | null;
  pluginsFired:     string[] | null;
  changedFields:    QualityFixField[] | null;
  changeCount:      number;
  productSyncedAt:  string | null;
  scannedAt:        string | null;
  productLastSync:  string | null;
  /**
   * audit_logs.id of the most recent successful Apply for this row.
   * Null when there is nothing to undo (no apply yet, or the latest
   * audit entry for this fixId is itself an undo).
   */
  undoableAuditId:  number | null;
  /**
   * Chronological apply/undo audit trail for this fix (oldest → newest).
   * Empty when the fix has never been applied. Powers the inline
   * "History" disclosure inside FixRow.
   */
  history:          FixHistoryEntry[];
}

interface FixHistoryEntry {
  auditId: number;
  action:  "apply" | "undo";
  /** "applied" on success, "failed" when the Shopify write erred. */
  status:  string;
  /** ISO timestamp. */
  at:      string;
  actor:   { id: number | null; name: string | null; role: string | null } | null;
}

interface QualityFixesCoverage {
  totalProducts:   number;
  scannedProducts: number;
  pendingScan:     number;
  lastScanAt:      string | null;
}

interface QualityFixesResponse {
  page:     number;
  limit:    number;
  total:    number;
  results:  QualityFixRow[];
  coverage: QualityFixesCoverage;
  error?:   string;
  code?:    string;
}

interface RescanSummary {
  scanned:   number;
  refreshed: number;
  failed:    number;
  skipped?:  boolean;
  reason?:   string;
}

interface RescanBudget {
  remaining:  number;
  capacity:   number;
  resetInMs:  number;
}

type FixesFilter = "with-fixes" | "no-fixes" | "error" | "all";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "—";
  const from = new Date(start).getTime();
  const to   = end ? new Date(end).getTime() : Date.now();
  const secs = Math.round((to - from) / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

// Compact human-friendly "X ago" indicator for scan timestamps. Operators
// triaging stale rows scan this badge first to decide which products to
// rescan; the absolute timestamp stays visible alongside it for precision.
function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "never";
  const diffMs = Date.now() - then;
  if (diffMs < 0) return "just now";
  const secs = Math.round(diffMs / 1000);
  if (secs < 45)               return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60)               return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24)              return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7)                return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5)               return `${weeks}w ago`;
  const months = Math.round(days / 30);
  if (months < 12)             return `${months}mo ago`;
  const years = Math.round(days / 365);
  return `${years}y ago`;
}

// ─── Progress Ring ────────────────────────────────────────────────────────────
function ProgressRing({ pct, size = 72, strokeWidth = 6, color = "#7c3aed" }: {
  pct: number; size?: number; strokeWidth?: number; color?: string;
}) {
  const radius    = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset    = circumference * (1 - Math.min(1, pct / 100));
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(124,58,237,0.12)" strokeWidth={strokeWidth} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color}
        strokeWidth={strokeWidth} strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.5s ease" }}
      />
    </svg>
  );
}

// ─── Attribute Pill ───────────────────────────────────────────────────────────
const ATTR_COLORS: Record<string, string> = {
  shape:    "bg-violet-50 text-violet-700 border-violet-200",
  occasion: "bg-blue-50 text-blue-700 border-blue-200",
  finish:   "bg-emerald-50 text-emerald-700 border-emerald-200",
  activity: "bg-amber-50 text-amber-700 border-amber-200",
};

function AttrPill({ label, value }: { label: string; value: string }) {
  if (!value || value === "n/a") return null;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border",
      ATTR_COLORS[label] ?? "bg-slate-50 text-slate-600 border-slate-200",
    )}>
      <span className="text-[9px] font-mono uppercase opacity-70">{label[0]}</span>
      {value}
    </span>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: EnrichmentJob["status"] }) {
  const cfg = {
    pending:   { color: "bg-slate-100 text-slate-600 border-slate-200",   icon: <Clock className="w-3 h-3" />,        label: "Pending"   },
    running:   { color: "bg-blue-50 text-blue-700 border-blue-200",       icon: <RefreshCw className="w-3 h-3 animate-spin" />, label: "Running"   },
    completed: { color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: <CheckCircle2 className="w-3 h-3" />, label: "Completed" },
    failed:    { color: "bg-rose-50 text-rose-700 border-rose-200",       icon: <AlertCircle className="w-3 h-3" />,  label: "Failed"    },
  }[status] ?? { color: "", icon: null, label: status };
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-semibold border", cfg.color)}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function FeedEnrichmentPage() {
  const { activeWorkspace }    = useWorkspace();
  const queryClient            = useQueryClient();
  const [filter, setFilter]    = useState<FilterMode>("all");
  const [page, setPage]        = useState(1);
  const [running, setRunning]  = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [batchSize, setBatchSize] = useState(100);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── FeedGen state ─────────────────────────────────────────────────────────
  const [feedgenRows, setFeedgenRows] = useState<FeedgenRewriteRow[]>([]);
  const [feedgenStatusFilter, setFeedgenStatusFilter] = useState<string>("pending");
  const [feedgenLoading, setFeedgenLoading] = useState(false);
  const [feedgenRunning, setFeedgenRunning] = useState(false);
  const [feedgenSelected, setFeedgenSelected] = useState<Set<string>>(new Set());
  const [feedgenError, setFeedgenError] = useState<string | null>(null);
  const [feedgenApproving, setFeedgenApproving] = useState(false);
  const [feedgenLastRun, setFeedgenLastRun] = useState<{
    scanned: number; generated: number; failed: number; medianRoas: number | null;
  } | null>(null);
  const [feedgenPage, setFeedgenPage] = useState(1);
  const [feedgenTotal, setFeedgenTotal] = useState(0);
  const FEEDGEN_PAGE_SIZE = 25;
  const [feedgenStats, setFeedgenStats] = useState<FeedgenStatsResponse | null>(null);

  const loadFeedgenStats = useCallback(async () => {
    try {
      const res = await authFetch(
        `${API_BASE}api/feed-enrichment/feedgen/rewrites/stats?days=30`,
      );
      if (!res.ok) return;
      const data = await res.json() as FeedgenStatsResponse;
      setFeedgenStats(data);
    } catch {
      // Stats are best-effort — don't surface an error if they fail to load.
    }
  }, []);

  const loadFeedgen = useCallback(async (status: string, page: number) => {
    setFeedgenLoading(true);
    setFeedgenError(null);
    try {
      const params = new URLSearchParams({
        status,
        page:  String(page),
        limit: String(FEEDGEN_PAGE_SIZE),
      });
      const res = await authFetch(
        `${API_BASE}api/feed-enrichment/feedgen/rewrites?${params.toString()}`,
      );
      const data = await res.json() as {
        rewrites?: FeedgenRewriteRow[]; total?: number; error?: string;
      };
      if (!res.ok) {
        setFeedgenError(data.error ?? "Failed to load rewrites");
        return;
      }
      setFeedgenRows(data.rewrites ?? []);
      setFeedgenTotal(typeof data.total === "number" ? data.total : (data.rewrites?.length ?? 0));
      setFeedgenSelected(new Set());
    } catch {
      setFeedgenError("Network error while loading rewrites");
    } finally {
      setFeedgenLoading(false);
    }
  }, []);

  const runFeedgenScan = useCallback(async () => {
    if (feedgenRunning) return;
    setFeedgenRunning(true);
    setFeedgenError(null);
    try {
      const res = await authFetch(`${API_BASE}api/feed-enrichment/feedgen/rewrites/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxProducts: 10 }),
      });
      const data = await res.json() as {
        scanned?: number; generated?: number; failed?: number;
        medianRoas?: number | null; error?: string;
      };
      if (!res.ok) {
        setFeedgenError(data.error ?? "Failed to run FeedGen scan");
      } else {
        setFeedgenLastRun({
          scanned:    data.scanned   ?? 0,
          generated:  data.generated ?? 0,
          failed:     data.failed    ?? 0,
          medianRoas: typeof data.medianRoas === "number" ? data.medianRoas : null,
        });
        setFeedgenPage(1);
        await loadFeedgen(feedgenStatusFilter, 1);
        void loadFeedgenStats();
      }
    } catch {
      setFeedgenError("Network error while running FeedGen scan");
    } finally {
      setFeedgenRunning(false);
    }
  }, [feedgenRunning, feedgenStatusFilter, loadFeedgen, loadFeedgenStats]);

  const approveFeedgen = useCallback(async () => {
    if (feedgenSelected.size === 0 || feedgenApproving) return;
    setFeedgenApproving(true);
    setFeedgenError(null);
    try {
      const res = await authPost(
        `${API_BASE}api/feed-enrichment/feedgen/rewrites/approve`,
        { rewriteIds: Array.from(feedgenSelected) },
      );
      const data = await res.json() as { approved?: number; error?: string };
      if (!res.ok) {
        setFeedgenError(data.error ?? "Failed to approve rewrites");
      } else {
        setFeedgenSelected(new Set());
        await loadFeedgen(feedgenStatusFilter, feedgenPage);
        void loadFeedgenStats();
      }
    } catch {
      setFeedgenError("Network error while approving rewrites");
    } finally {
      setFeedgenApproving(false);
    }
  }, [feedgenSelected, feedgenApproving, feedgenStatusFilter, feedgenPage, loadFeedgen, loadFeedgenStats]);

  // ── Quality Fixes + Writeback state ──────────────────────────────────────
  const [view, setView] = useState<ViewMode>("enrichment");

  useEffect(() => {
    if (view === "feedgen") {
      void loadFeedgen(feedgenStatusFilter, feedgenPage);
      void loadFeedgenStats();
    }
  }, [view, feedgenStatusFilter, feedgenPage, loadFeedgen, loadFeedgenStats]);

  // Reset to first page whenever the status filter changes — otherwise users
  // can land on an empty trailing page after switching tabs.
  useEffect(() => { setFeedgenPage(1); }, [feedgenStatusFilter]);

  const [fixesLoading, setFixesLoading] = useState(false);
  const [fixesRescanning, setFixesRescanning] = useState(false);
  const [fixesData, setFixesData] = useState<QualityFixesResponse | null>(null);
  // Mirror of fixesData kept in a ref so the streaming bulk-apply handler
  // (defined inside a useCallback) can look up the latest title/SKU for a
  // failing row without forcing applyBulk to depend on fixesData.
  const fixesDataRef = useRef<QualityFixesResponse | null>(null);
  useEffect(() => { fixesDataRef.current = fixesData; }, [fixesData]);
  // Guard against stale Quality-Fixes responses overwriting fresher ones.
  // `loadFixes` is invoked from many concurrent paths (rescan, retry, page
  // change, filter change); without cancellation an older request that lands
  // after a newer one would flicker the panel back to outdated rows/counts.
  const loadFixesReqIdRef = useRef(0);
  const loadFixesAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => {
    // Abort any in-flight Quality-Fixes request when the page unmounts so
    // its setState calls don't fire on an unmounted component.
    loadFixesAbortRef.current?.abort();
  }, []);
  const [fixesError, setFixesError] = useState<string | null>(null);
  const [selectedOffers, setSelectedOffers] = useState<Set<string>>(new Set());
  const [fixesFilter, setFixesFilter] = useState<FixesFilter>("with-fixes");
  const [fixesStaleOnly, setFixesStaleOnly] = useState(false);
  // Sort order for the Quality Fixes list. "recent" preserves the original
  // ranking (most fixes / newest scan first); "oldest" surfaces the rows that
  // are most overdue for a refresh — handy for triaging stale or flaky scans.
  const [fixesSort, setFixesSort] = useState<"recent" | "oldest">("recent");
  const [fixesPage, setFixesPage] = useState(1);
  const FIXES_PAGE_SIZE = 25;
  const [rescanSummary, setRescanSummary] = useState<RescanSummary | null>(null);
  const [approving, setApproving] = useState(false);
  const [approveResult, setApproveResult] = useState<{
    approved: number; duplicate: number;
  } | null>(null);
  // Per-row "Apply fix" state — keyed by warehouse product id.
  // `applyingIds`  = rows whose POST /quality-fixes/apply is in flight.
  // `applyResults` = last server response per row (success/partial/error).
  const [applyingIds, setApplyingIds] = useState<Set<string>>(new Set());
  const [applyResults, setApplyResults] = useState<Record<string, {
    ok: boolean; message: string;
  }>>({});
  // Per-row "Rescan" state (mirrors the per-row apply state). `rescanningIds`
  // is the in-flight set; `rescanRowResults` shows the last per-row outcome.
  const [rescanningIds, setRescanningIds] = useState<Set<string>>(new Set());
  const [rescanRowResults, setRescanRowResults] = useState<Record<string, {
    ok: boolean; message: string;
  }>>({});
  // Per-row "Undo" state — keyed by the audit_logs.id of the apply we are
  // reverting. Mirrors the per-row apply state.
  const [undoingIds, setUndoingIds] = useState<Set<number>>(new Set());
  const [undoResults, setUndoResults] = useState<Record<string, {
    ok: boolean; message: string;
  }>>({});
  // True while the bulk "Rescan failed" button is in flight — disables the
  // bulk button + the per-row buttons for the affected rows.
  const [bulkRescanningErrors, setBulkRescanningErrors] = useState(false);
  // Remaining rescan budget for the current minute window. Polled from the
  // server and updated optimistically after each rescan attempt.
  const [rescanBudget, setRescanBudget] = useState<RescanBudget | null>(null);
  // Countdown seconds displayed when the budget is exhausted.
  const [budgetCooldown, setBudgetCooldown] = useState(0);
  // Bulk-apply-to-Shopify state. `bulkApplying` gates the button while the
  // streaming POST is open; `bulkApplyProgress` drives the live counter
  // ("12 / 25 done") shown next to it; `bulkApplySummary` shows the final
  // success/partial/error breakdown after the stream closes. Per-row
  // outcomes are merged into the existing `applyResults` so each row's
  // status pill updates in place as the stream progresses.
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkApplyProgress, setBulkApplyProgress] = useState<{ done: number; total: number } | null>(null);
  // Per-row failure log surfaced under the bulk summary pill so users don't
  // have to scroll the table hunting for which products failed and why.
  // Captured at stream time (rather than derived later) so the log survives
  // even if a follow-up rescan removes the failed row from the visible list.
  const [bulkApplyFailures, setBulkApplyFailures] = useState<Array<{
    id:      string;
    title:   string | null;
    sku:     string | null;
    message: string;
  }>>([]);
  const [bulkFailuresExpanded, setBulkFailuresExpanded] = useState(false);
  const [bulkApplySummary, setBulkApplySummary] = useState<{
    total: number; succeeded: number; partial: number; failed: number;
  } | null>(null);

  // ── Writeback panel state ─────────────────────────────────────────────────
  const [wbTasks, setWbTasks]           = useState<WritebackTask[]>([]);
  const [wbLoading, setWbLoading]       = useState(false);
  const [wbError, setWbError]           = useState<string | null>(null);
  const [wbRetrying, setWbRetrying]     = useState<Set<number>>(new Set());
  const [wbRetryingAll, setWbRetryingAll] = useState(false);
  const [wbRunResult, setWbRunResult]   = useState<WritebackRunResult | null>(null);
  // Transient per-row outcomes shown immediately after a bulk retry completes.
  // Keyed by task id; value is "applied" or "failed". Cleared after 5 s.
  const [wbRetryOutcomes, setWbRetryOutcomes] = useState<Map<number, "applied" | "failed">>(new Map());
  const wbRetryOutcomesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [wbStatusFilter, setWbStatusFilter] = useState<WritebackStatus | "all">("all");
  const [wbMaxAttempts, setWbMaxAttempts] = useState<number>(5);
  // Live progress while a write-back batch is running. Set before the POST
  // fires and cleared in the finally block. Null = no batch in flight.
  const [wbRunProgress, setWbRunProgress] = useState<{ total: number; done: number } | null>(null);
  const wbProgressPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchWritebacks = useCallback(async () => {
    setWbLoading(true);
    setWbError(null);
    try {
      const qs  = wbStatusFilter !== "all" ? `?status=${wbStatusFilter}` : "";
      const res = await authFetch(`${API_BASE}api/feed-enrichment/writeback${qs}`);
      const data = await res.json() as { tasks?: WritebackTask[]; maxAttempts?: number; error?: string };
      if (!res.ok) { setWbError(data.error ?? "Failed to load write-back tasks."); return; }
      setWbTasks(data.tasks ?? []);
      if (typeof data.maxAttempts === "number") setWbMaxAttempts(data.maxAttempts);
    } catch { setWbError("Network error loading write-back tasks."); }
    finally { setWbLoading(false); }
  }, [wbStatusFilter]);

  // Starts a polling loop that refreshes the writeback list every 1.5 s and
  // counts how many of the `targetIds` have moved to applied / failed. This
  // lets us show a live "X / Y done" counter while the POST is still in flight.
  const startWbProgressPoll = useCallback((targetIds: Set<number>, total: number) => {
    if (wbProgressPollRef.current) clearInterval(wbProgressPollRef.current);
    setWbRunProgress({ total, done: 0 });
    wbProgressPollRef.current = setInterval(async () => {
      try {
        const res = await authFetch(`${API_BASE}api/feed-enrichment/writeback`);
        if (!res.ok) return;
        const data = await res.json() as { tasks?: WritebackTask[] };
        const done = (data.tasks ?? []).filter(
          (t) => targetIds.has(t.id) && (t.status === "applied" || t.status === "failed"),
        ).length;
        setWbRunProgress({ total, done });
        // Also update the visible task list so per-row statuses change in place.
        setWbTasks(data.tasks ?? []);
      } catch {
        // best-effort — don't surface a poll error
      }
    }, 1500);
  }, []);

  const stopWbProgressPoll = useCallback(() => {
    if (wbProgressPollRef.current) {
      clearInterval(wbProgressPollRef.current);
      wbProgressPollRef.current = null;
    }
    setWbRunProgress(null);
  }, []);

  const retryTask = useCallback(async (taskId: number) => {
    setWbRetrying((prev) => new Set(prev).add(taskId));
    setWbRunResult(null);
    startWbProgressPoll(new Set([taskId]), 1);
    try {
      const res  = await authPost(`${API_BASE}api/feed-enrichment/writeback/run`, { taskIds: [taskId] });
      const data = await res.json() as WritebackRunResult & { error?: string };
      if (!res.ok) { setWbError(data.error ?? "Retry failed."); return; }
      setWbRunResult(data);
      // Refresh the list so statuses reflect reality
      await fetchWritebacks();
    } catch { setWbError("Network error during retry."); }
    finally {
      setWbRetrying((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
      stopWbProgressPoll();
    }
  }, [fetchWritebacks, startWbProgressPoll, stopWbProgressPoll]);

  const retryAllFailed = useCallback(async () => {
    const retryableIds = wbTasks
      .filter((t) => t.status === "failed" && t.latestAttempt?.retry?.retryable === true)
      .map((t) => t.id);
    if (retryableIds.length === 0 || wbRetryingAll) return;
    setWbRetryingAll(true);
    setWbRunResult(null);
    setWbError(null);
    startWbProgressPoll(new Set(retryableIds), retryableIds.length);
    try {
      const res  = await authPost(`${API_BASE}api/feed-enrichment/writeback/run`, { taskIds: retryableIds });
      const data = await res.json() as WritebackRunResult & { error?: string };
      if (!res.ok) { setWbError(data.error ?? "Bulk retry failed."); return; }
      setWbRunResult(data);
      // Build a transient per-row outcome map so each row can show an inline
      // "Applied" / "Failed" badge for a few seconds right after the run.
      if (Array.isArray(data.results) && data.results.length > 0) {
        const outcomes = new Map<number, "applied" | "failed">(
          data.results.map((r) => [r.taskId, r.ok ? "applied" : "failed"]),
        );
        setWbRetryOutcomes(outcomes);
        // Cancel any previous auto-clear timer before setting a new one.
        if (wbRetryOutcomesTimerRef.current) clearTimeout(wbRetryOutcomesTimerRef.current);
        wbRetryOutcomesTimerRef.current = setTimeout(() => {
          setWbRetryOutcomes(new Map());
          wbRetryOutcomesTimerRef.current = null;
        }, 5000);
        // Optimistically patch the task list so status changes are visible
        // immediately even before the fetchWritebacks() round-trip completes.
        setWbTasks((prev) =>
          prev.map((task) => {
            const outcome = outcomes.get(task.id);
            if (!outcome) return task;
            return { ...task, status: outcome };
          }),
        );
      }
      await fetchWritebacks();
    } catch { setWbError("Network error during bulk retry."); }
    finally {
      setWbRetryingAll(false);
      stopWbProgressPoll();
    }
  }, [wbTasks, wbRetryingAll, fetchWritebacks, startWbProgressPoll, stopWbProgressPoll]);

  // Clear the outcomes timer when the component unmounts to avoid state
  // updates on an already-unmounted component (avoids React memory leak warning).
  useEffect(() => {
    return () => {
      if (wbRetryOutcomesTimerRef.current) clearTimeout(wbRetryOutcomesTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (view === "writeback") fetchWritebacks();
  }, [view, wbStatusFilter]);

  // Status query — react-query handles cancellation across mounts and gives
  // us a single source of truth for latest job state.
  const statusQuery = useQuery({
    queryKey: queryKeys.feedEnrichmentStatus(),
    queryFn: async () => {
      const res = await authFetch(`${API_BASE}api/feed-enrichment/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as EnrichmentStatus;
    },
  });
  const status = statusQuery.data ?? null;
  const loading = statusQuery.isLoading;
  const fetchStatus = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.feedEnrichmentStatus() }),
    [queryClient],
  );

  // Sync local running/activeJobId from status payload exactly once per change.
  useEffect(() => {
    if (!status) return;
    if (status.latestJob?.status === "running") {
      setActiveJobId(status.latestJob.id);
      setRunning(true);
    } else {
      setRunning(false);
    }
  }, [status]);

  // Products query — keyed on page+filter so changing either auto-refetches
  // and cancels any stale request mid-flight.
  const productsQuery = useQuery({
    queryKey: queryKeys.feedEnrichmentProducts(page, filter),
    queryFn: async () => {
      const res = await authFetch(`${API_BASE}api/feed-enrichment/products?page=${page}&limit=50&filter=${filter}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { products: Product[]; total: number };
    },
  });
  const products = productsQuery.data?.products ?? [];
  const totalProducts = productsQuery.data?.total ?? 0;
  const fetchProducts = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.feedEnrichmentProducts(page, filter) }),
    [page, filter, queryClient],
  );

  const pollActiveJob = useCallback(async (jobId: number) => {
    try {
      const res  = await authFetch(`${API_BASE}api/feed-enrichment/job/${jobId}`);
      if (res.ok) {
        const { job } = await res.json() as { job: EnrichmentJob };
        if (job.status !== "running" && job.status !== "pending") {
          setRunning(false);
          setActiveJobId(null);
          if (pollRef.current) clearInterval(pollRef.current);
          await fetchStatus();
          await fetchProducts();
        } else {
          // Optimistic patch of the cached status while the job runs — keeps
          // the progress widget responsive without invalidating every tick.
          queryClient.setQueryData<EnrichmentStatus | null>(
            queryKeys.feedEnrichmentStatus(),
            (prev) => prev ? { ...prev, latestJob: job } : prev,
          );
        }
      }
    } catch { /* silent */ }
  }, [fetchStatus, fetchProducts, queryClient]);

  useEffect(() => {
    if (activeJobId && running) {
      pollRef.current = setInterval(() => pollActiveJob(activeJobId), 3000);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }
    return undefined;
  }, [activeJobId, running, pollActiveJob]);

  const handleRun = async () => {
    if (running) return;
    setRunError(null);
    setRunning(true);
    try {
      const res  = await authPost(`${API_BASE}api/feed-enrichment/run`, { batchSize });
      const data = await res.json() as { jobId?: number; error?: string; code?: string; upgradeUrl?: string };
      if (!res.ok) {
        setRunning(false);
        if (data.code === "ENRICHMENT_QUOTA_EXCEEDED") {
          setRunError("Monthly SKU limit reached. Upgrade to Enterprise for unlimited enrichment.");
        } else {
          setRunError(data.error ?? "Failed to start enrichment run.");
        }
        return;
      }
      if (data.jobId) {
        setActiveJobId(data.jobId);
        await fetchStatus();
      }
    } catch {
      setRunning(false);
      setRunError("Network error. Please try again.");
    }
  };

  // ── Quality Fixes handlers ───────────────────────────────────────────────
  const loadFixes = useCallback(async () => {
    // Cancel any in-flight request and bump the request id so a slower
    // older response that still resolves won't overwrite fresher state.
    loadFixesAbortRef.current?.abort();
    const controller = new AbortController();
    loadFixesAbortRef.current = controller;
    const reqId = ++loadFixesReqIdRef.current;
    const isStale = () => reqId !== loadFixesReqIdRef.current;

    setFixesLoading(true);
    setFixesError(null);
    try {
      const params = new URLSearchParams({
        page:   String(fixesPage),
        limit:  String(FIXES_PAGE_SIZE),
        filter: fixesFilter,
        sort:   fixesSort,
      });
      if (fixesStaleOnly) params.set("stale", "true");
      const res  = await authFetch(
        `${API_BASE}api/feed-enrichment/quality-fixes?${params.toString()}`,
        { signal: controller.signal },
      );
      const data = await res.json() as QualityFixesResponse;
      if (isStale()) return;
      if (!res.ok) {
        setFixesError(data.error ?? "Failed to load suggested fixes.");
        setFixesData(null);
      } else {
        setFixesData(data);
        // Pre-select every row with at least one fix.
        const next = new Set<string>();
        for (const r of data.results) {
          if (r.scanStatus === "ok" && r.changeCount > 0) next.add(r.id);
        }
        setSelectedOffers(next);
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      if (isStale()) return;
      setFixesError("Network error while loading suggested fixes.");
    } finally {
      // Only the latest request should toggle the loading flag off — an
      // aborted older request finishing first would otherwise hide the
      // spinner while the newer fetch is still in flight.
      if (!isStale()) setFixesLoading(false);
    }
  }, [fixesPage, fixesFilter, fixesStaleOnly, fixesSort]);

  const fetchRescanBudget = useCallback(async () => {
    try {
      const res  = await authFetch(`${API_BASE}api/feed-enrichment/quality-fixes/rescan-budget`);
      if (!res.ok) return;
      const data = await res.json() as RescanBudget;
      setRescanBudget(data);
      setBudgetCooldown(data.remaining < 1 ? Math.ceil(data.resetInMs / 1000) : 0);
    } catch {
      // Best-effort — don't surface a fetch error for the budget indicator.
    }
  }, []);

  const rescanFixes = useCallback(async () => {
    if (fixesRescanning) return;
    setFixesRescanning(true);
    setFixesError(null);
    setRescanSummary(null);
    try {
      const res  = await authPost(`${API_BASE}api/feed-enrichment/quality-fixes/rescan`, {});
      const data = await res.json() as RescanSummary & { error?: string; code?: string; retryAfter?: number };
      if (!res.ok) {
        if (res.status === 429) {
          const wait = Number(data.retryAfter ?? res.headers.get("Retry-After") ?? 0);
          setFixesError(
            wait > 0
              ? `Slow down — too many rescans. Try again in ${wait}s.`
              : "Slow down — too many rescans. Please wait a moment and try again.",
          );
        } else {
          setFixesError(data.error ?? "Failed to start a rescan.");
        }
      } else {
        setRescanSummary(data);
        // A full rescan can shift the result set out from under the current
        // page (e.g. the user is on page 5 but only 2 pages worth of rows
        // remain). Reset to page 1 so the user always lands on real data.
        if (fixesPage !== 1) {
          setFixesPage(1);
          // loadFixes will be re-triggered by the fixesPage useEffect.
        } else {
          await loadFixes();
        }
      }
    } catch {
      setFixesError("Network error while triggering a rescan.");
    } finally {
      setFixesRescanning(false);
      void fetchRescanBudget();
    }
  }, [fixesRescanning, loadFixes, fixesPage, fetchRescanBudget]);

  // Rescan one specific product (per-row "Rescan" button). Goes through the
  // same /rescan endpoint with a single id. Surfaces the outcome on the row.
  const rescanOne = useCallback(async (id: string) => {
    if (rescanningIds.has(id)) return;
    setRescanningIds((prev) => { const n = new Set(prev); n.add(id); return n; });
    setRescanRowResults((prev) => { const { [id]: _omit, ...rest } = prev; return rest; });
    try {
      const res  = await authPost(
        `${API_BASE}api/feed-enrichment/quality-fixes/rescan`,
        { productIds: [id] },
      );
      const data = await res.json() as RescanSummary & { error?: string; code?: string; retryAfter?: number };
      if (!res.ok) {
        if (res.status === 429) {
          const wait = Number(data.retryAfter ?? res.headers.get("Retry-After") ?? 0);
          setRescanRowResults((prev) => ({
            ...prev,
            [id]: {
              ok: false,
              message: wait > 0
                ? `Slow down — try again in ${wait}s.`
                : "Slow down — too many rescans. Try again shortly.",
            },
          }));
        } else {
          setRescanRowResults((prev) => ({
            ...prev,
            [id]: { ok: false, message: data.error ?? "Rescan failed." },
          }));
        }
      } else if (data.skipped) {
        setRescanRowResults((prev) => ({
          ...prev,
          [id]: { ok: false, message: `Skipped (${data.reason ?? "no work"}).` },
        }));
      } else {
        setRescanRowResults((prev) => ({
          ...prev,
          [id]: {
            ok: data.failed === 0,
            message: data.failed === 0
              ? "Rescanned."
              : `Rescanned with ${data.failed} failure${data.failed === 1 ? "" : "s"}.`,
          },
        }));
      }
    } catch {
      setRescanRowResults((prev) => ({
        ...prev,
        [id]: { ok: false, message: "Network error during rescan." },
      }));
    } finally {
      setRescanningIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      // Refresh so badges/scan-status pick up the new state.
      void loadFixes();
      void fetchRescanBudget();
    }
  }, [rescanningIds, loadFixes, fetchRescanBudget]);

  // Bulk "Rescan failed" — re-runs Shoptimizer for every error row visible
  // on the current page. Capped client-side at the API limit (100).
  const rescanFailed = useCallback(async (ids: string[]) => {
    if (bulkRescanningErrors || ids.length === 0) return;
    const unique = Array.from(new Set(ids)).slice(0, 100);
    setBulkRescanningErrors(true);
    setFixesError(null);
    setRescanSummary(null);
    try {
      const res  = await authPost(
        `${API_BASE}api/feed-enrichment/quality-fixes/rescan`,
        { productIds: unique },
      );
      const data = await res.json() as RescanSummary & { error?: string; code?: string; retryAfter?: number };
      if (!res.ok) {
        if (res.status === 429) {
          const wait = Number(data.retryAfter ?? res.headers.get("Retry-After") ?? 0);
          setFixesError(
            wait > 0
              ? `Slow down — too many rescans. Try again in ${wait}s.`
              : "Slow down — too many rescans. Please wait a moment and try again.",
          );
        } else {
          setFixesError(data.error ?? "Failed to rescan failed products.");
        }
      } else {
        setRescanSummary(data);
        await loadFixes();
      }
    } catch {
      setFixesError("Network error while rescanning failed products.");
    } finally {
      setBulkRescanningErrors(false);
      void fetchRescanBudget();
    }
  }, [bulkRescanningErrors, loadFixes, fetchRescanBudget]);

  // ── Rescan budget polling ─────────────────────────────────────────────────
  // Poll the budget while the fixes tab is open: every 5 s normally, every
  // 1 s when exhausted so the countdown stays accurate.
  useEffect(() => {
    if (view !== "fixes") return;
    void fetchRescanBudget();
    const interval = setInterval(fetchRescanBudget, rescanBudget?.remaining === 0 ? 1000 : 5000);
    return () => clearInterval(interval);
  }, [view, fetchRescanBudget, rescanBudget?.remaining]);

  // Tick the local cooldown display every second when the budget is zero.
  useEffect(() => {
    if (budgetCooldown <= 0) return;
    const t = setInterval(() => setBudgetCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [budgetCooldown]);

  // Auto-fetch when the Quality Fixes tab is active and filters/page change.
  useEffect(() => {
    if (view === "fixes") void loadFixes();
  }, [view, loadFixes]);

  // Reset page when filter, stale toggle, or sort changes.
  useEffect(() => { setFixesPage(1); }, [fixesFilter, fixesStaleOnly, fixesSort]);

  // The Errors tab defaults to oldest-first so flaky / long-failing rows
  // bubble up to the top — they're the ones most likely to need a manual
  // rescan or an investigation. Other filters keep the "recent" default.
  // We update both filter + sort in the same handler (rather than a follow-up
  // effect) so React batches a single render — otherwise a filter change
  // would briefly fire a request with the previous sort, then re-fire with
  // the new one.
  const changeFixesFilter = useCallback((next: FixesFilter) => {
    setFixesFilter(next);
    setFixesSort(next === "error" ? "oldest" : "recent");
  }, []);

  const toggleSelected = (offerId: string) => {
    setSelectedOffers((prev) => {
      const next = new Set(prev);
      if (next.has(offerId)) next.delete(offerId); else next.add(offerId);
      return next;
    });
  };

  const successItems: QualityFixRow[] = (fixesData?.results ?? [])
    .filter((r) => r.scanStatus === "ok" && r.changeCount > 0);
  const errorItems: QualityFixRow[] = (fixesData?.results ?? [])
    .filter((r) => r.scanStatus === "error");

  const approveSelected = async () => {
    if (selectedOffers.size === 0 || approving) return;
    setApproving(true);
    setApproveResult(null);
    setFixesError(null);
    try {
      const fixes = successItems
        .filter((it) => selectedOffers.has(it.id))
        .map((it) => ({
          offerId:       it.id,
          productId:     it.productId,
          sku:           it.sku,
          title:         it.title,
          pluginsFired:  it.pluginsFired ?? [],
          changedFields: it.changedFields ?? [],
        }));
      const res  = await authPost(`${API_BASE}api/feed-enrichment/quality-fixes/approve`, { fixes });
      const data = await res.json() as { approved?: number; duplicate?: number; error?: string };
      if (!res.ok) {
        setFixesError(data.error ?? "Failed to queue fixes for approval.");
      } else {
        setApproveResult({ approved: data.approved ?? 0, duplicate: data.duplicate ?? 0 });
        setSelectedOffers(new Set());
      }
    } catch {
      setFixesError("Network error while approving fixes.");
    } finally {
      setApproving(false);
    }
  };

  // Push a single cached fix back to Shopify. The endpoint also re-scans
  // the product, so we just reload the visible list afterwards instead of
  // mutating the row in place.
  const applyOne = useCallback(async (id: string) => {
    if (applyingIds.has(id)) return;
    setApplyingIds((prev) => { const n = new Set(prev); n.add(id); return n; });
    setApplyResults((prev) => { const { [id]: _omit, ...rest } = prev; return rest; });
    try {
      const res  = await authPost(`${API_BASE}api/feed-enrichment/quality-fixes/apply`, { id });
      const data = await res.json() as {
        ok?: boolean;
        applied?: Array<{ field: string; ok: boolean; error?: string }>;
        errors?: string[];
        error?: string;
      };
      if (res.status === 200 && data.ok) {
        setApplyResults((prev) => ({
          ...prev,
          [id]: { ok: true, message: `Applied ${data.applied?.length ?? 0} field(s) to Shopify.` },
        }));
      } else {
        const msg = data.error
          ?? (data.errors?.length ? data.errors.join("; ") : "Apply failed");
        setApplyResults((prev) => ({ ...prev, [id]: { ok: false, message: msg } }));
      }
    } catch {
      setApplyResults((prev) => ({
        ...prev,
        [id]: { ok: false, message: "Network error while applying fix." },
      }));
    } finally {
      setApplyingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      // Refresh so the post-apply rescan + warehouse mirror are reflected.
      void loadFixes();
    }
  }, [applyingIds, loadFixes]);

  // Apply many cached fixes back to Shopify in one click. Streams NDJSON
  // from the server so each row's status pill flips as soon as its Shopify
  // round-trip completes — no polling, and the user sees real progress on
  // long bulk runs (Shopify's 2 req/sec sustained throttle plus several
  // writes per row means a 25-row apply can take 30+ seconds).
  const applyBulk = useCallback(async (ids: string[]) => {
    if (bulkApplying || ids.length === 0) return;
    const unique = Array.from(new Set(ids));
    setBulkApplying(true);
    setBulkApplySummary(null);
    setBulkApplyProgress({ done: 0, total: unique.length });
    setBulkApplyFailures([]);
    setBulkFailuresExpanded(false);
    setFixesError(null);
    // Mark every row in-flight up-front so the row buttons disable
    // immediately and previous results from prior single applies clear out
    // for the rows we're about to overwrite.
    setApplyingIds((prev) => {
      const n = new Set(prev);
      for (const id of unique) n.add(id);
      return n;
    });
    setApplyResults((prev) => {
      const next = { ...prev };
      for (const id of unique) delete next[id];
      return next;
    });

    try {
      const res = await authPost(
        `${API_BASE}api/feed-enrichment/quality-fixes/apply-bulk`,
        { ids: unique },
      );

      if (!res.ok || !res.body) {
        // Validation / auth / forbidden errors come back as a plain JSON body
        // before any streaming starts.
        let msg = `Bulk apply failed (HTTP ${res.status}).`;
        try {
          const err = await res.json() as { error?: string };
          if (err?.error) msg = err.error;
        } catch { /* ignore */ }
        setFixesError(msg);
        setApplyingIds((prev) => {
          const n = new Set(prev);
          for (const id of unique) n.delete(id);
          return n;
        });
        return;
      }

      // Decode the NDJSON stream line-by-line. Lines may straddle chunks,
      // so we keep a running buffer and only consume complete lines.
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done   = 0;

      const handleLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let evt: {
          type:   string;
          fixId?: string;
          total?: number;
          result?: {
            ok: boolean;
            applied?: Array<{ field: string; ok: boolean; error?: string }>;
            errors?: string[];
          };
          succeeded?: number;
          partial?:   number;
          failed?:    number;
          error?:     string;
        };
        try {
          evt = JSON.parse(trimmed);
        } catch {
          return;
        }
        if (evt.type === "started") {
          setBulkApplyProgress({ done: 0, total: evt.total ?? unique.length });
          return;
        }
        if (evt.type === "progress" && evt.fixId && evt.result) {
          done += 1;
          const r = evt.result;
          const id = evt.fixId;
          const message = r.ok
            ? `Applied ${r.applied?.length ?? 0} field(s) to Shopify.`
            : (r.errors?.length ? r.errors.join("; ") : "Apply failed");
          setApplyResults((prev) => ({ ...prev, [id]: { ok: !!r.ok, message } }));
          setApplyingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
          setBulkApplyProgress({ done, total: evt.total ?? unique.length });
          // Capture full failures (no field landed) for the per-row error log.
          // We only count rows where every attempted field errored — partials
          // are still surfaced inline on each row, but the dedicated panel
          // mirrors the summary pill's "Z failed" count so the two stay in
          // sync. Snapshot title/SKU now in case a follow-up rescan removes
          // the row from the visible list.
          const fullyFailed = !r.ok && !(r.applied?.some((a) => a.ok));
          if (fullyFailed) {
            const row = fixesDataRef.current?.results.find((it) => it.id === id);
            setBulkApplyFailures((prev) => [
              ...prev,
              {
                id,
                title:   row?.title ?? null,
                sku:     row?.sku ?? null,
                message,
              },
            ]);
          }
          return;
        }
        if (evt.type === "summary") {
          setBulkApplySummary({
            total:     evt.total     ?? unique.length,
            succeeded: evt.succeeded ?? 0,
            partial:   evt.partial   ?? 0,
            failed:    evt.failed    ?? 0,
          });
          return;
        }
        if (evt.type === "error") {
          setFixesError(evt.error ?? "Bulk apply failed.");
          return;
        }
      };

      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          handleLine(buffer.slice(0, nl));
          buffer = buffer.slice(nl + 1);
        }
      }
      // Flush any trailing line that didn't end with a newline.
      if (buffer.trim().length > 0) handleLine(buffer);
    } catch {
      setFixesError("Network error while applying fixes in bulk.");
    } finally {
      // Clear any rows that the stream didn't report on (e.g. server crashed
      // mid-run) so their buttons re-enable.
      setApplyingIds((prev) => {
        const n = new Set(prev);
        for (const id of unique) n.delete(id);
        return n;
      });
      setBulkApplying(false);
      setSelectedOffers(new Set());
      // The per-row apply path also re-runs the scanner, so refresh the
      // visible list once the whole batch is done.
      void loadFixes();
    }
  }, [bulkApplying, loadFixes]);

  // Revert a previously-applied fix on Shopify. Like applyOne, the endpoint
  // also re-scans the product so we just reload the visible list afterwards.
  const undoOne = useCallback(async (rowId: string, auditId: number) => {
    if (undoingIds.has(auditId)) return;
    setUndoingIds((prev) => { const n = new Set(prev); n.add(auditId); return n; });
    setUndoResults((prev) => { const { [rowId]: _omit, ...rest } = prev; return rest; });
    try {
      const res  = await authPost(`${API_BASE}api/feed-enrichment/quality-fixes/undo`, { auditId });
      const data = await res.json() as {
        ok?: boolean;
        applied?: Array<{ field: string; ok: boolean; error?: string }>;
        errors?: string[];
        error?: string;
      };
      if (res.status === 200 && data.ok) {
        setUndoResults((prev) => ({
          ...prev,
          [rowId]: { ok: true, message: `Reverted ${data.applied?.length ?? 0} field(s) on Shopify.` },
        }));
      } else {
        const msg = data.error
          ?? (data.errors?.length ? data.errors.join("; ") : "Undo failed");
        setUndoResults((prev) => ({ ...prev, [rowId]: { ok: false, message: msg } }));
      }
    } catch {
      setUndoResults((prev) => ({
        ...prev,
        [rowId]: { ok: false, message: "Network error while reverting fix." },
      }));
    } finally {
      setUndoingIds((prev) => { const n = new Set(prev); n.delete(auditId); return n; });
      void loadFixes();
    }
  }, [undoingIds, loadFixes]);

  // ── Derived stats ─────────────────────────────────────────────────────────
  const job        = status?.latestJob;
  const jobPct     = job?.totalSkus ? Math.round((job.processedSkus / job.totalSkus) * 100) : 0;
  const tierLimit  = status?.limit ?? null;
  const tierUsed   = status?.monthlyUsed ?? 0;
  const tierPct    = tierLimit ? Math.round((tierUsed / tierLimit) * 100) : 0;
  const isEnterprise = status?.tier === "enterprise";
  const nearLimit  = tierLimit ? tierPct >= 80 : false;

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* ── Page Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-violet-100 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Feed Enrichment</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                LLM-powered attribute tagging for conversational search
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { fetchStatus(); fetchProducts(); }}
              className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-all"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            {view === "enrichment" && (
              <Button
                onClick={handleRun}
                disabled={running || loading}
                className="bg-violet-600 hover:bg-violet-700 text-white gap-2"
              >
                {running
                  ? <><RefreshCw className="w-4 h-4 animate-spin" />Running…</>
                  : <><Play className="w-4 h-4" />Run Enrichment</>
                }
              </Button>
            )}
            {view === "fixes" && (
              <>
                {rescanBudget && (
                  <div className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium",
                    rescanBudget.remaining < 1
                      ? "bg-rose-50 border-rose-200 text-rose-700"
                      : rescanBudget.remaining <= Math.ceil(rescanBudget.capacity * 0.3)
                        ? "bg-amber-50 border-amber-200 text-amber-700"
                        : "bg-slate-50 border-slate-200 text-slate-600",
                  )}>
                    <TimerReset className="w-3.5 h-3.5 flex-shrink-0" />
                    {rescanBudget.remaining < 1
                      ? budgetCooldown > 0
                        ? <>Budget exhausted — refills in <strong className="ml-1 font-mono">{budgetCooldown}s</strong></>
                        : <>Budget refilling…</>
                      : <><strong className="font-mono">{rescanBudget.remaining}</strong><span className="opacity-60">/{rescanBudget.capacity}</span>&nbsp;rescans left</>
                    }
                  </div>
                )}
                <Button
                  onClick={loadFixes}
                  disabled={fixesLoading}
                  variant="outline"
                  className="gap-2"
                >
                  <RefreshCw className={cn("w-4 h-4", fixesLoading && "animate-spin")} />
                  Refresh
                </Button>
                <Button
                  onClick={rescanFixes}
                  disabled={fixesRescanning || (rescanBudget?.remaining != null && rescanBudget.remaining < 1)}
                  className="bg-violet-600 hover:bg-violet-700 text-white gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {fixesRescanning
                    ? <><RefreshCw className="w-4 h-4 animate-spin" />Scanning…</>
                    : <><Search className="w-4 h-4" />Scan now</>
                  }
                </Button>
              </>
            )}
            {view === "feedgen" && (
              <Button
                onClick={runFeedgenScan}
                disabled={feedgenRunning}
                className="bg-violet-600 hover:bg-violet-700 text-white gap-2"
              >
                {feedgenRunning
                  ? <><RefreshCw className="w-4 h-4 animate-spin" />Generating…</>
                  : <><Sparkles className="w-4 h-4" />Generate Rewrites</>
                }
              </Button>
            )}
            {view === "writeback" && (
              <Button
                onClick={fetchWritebacks}
                disabled={wbLoading}
                variant="outline"
                className="gap-2"
              >
                {wbLoading
                  ? <><RefreshCw className="w-4 h-4 animate-spin" />Loading…</>
                  : <><RefreshCw className="w-4 h-4" />Refresh</>
                }
              </Button>
            )}
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 border border-slate-200">
          {([
            { key: "enrichment", label: "Attribute Enrichment", icon: <Sparkles className="w-3.5 h-3.5" /> },
            { key: "fixes",      label: "Quality Fixes",         icon: <Wrench className="w-3.5 h-3.5" /> },
            { key: "feedgen",    label: "Title & Description",   icon: <Sparkles className="w-3.5 h-3.5" /> },
            { key: "writeback",  label: "Write-Backs",           icon: <Upload className="w-3.5 h-3.5" /> },
          ] as Array<{ key: ViewMode; label: string; icon: React.ReactNode }>).map((t) => (
            <button
              key={t.key}
              onClick={() => setView(t.key)}
              className={cn(
                "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                view === t.key
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700",
              )}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {view === "enrichment" && <>
        {/* ── Top Stats Row ── */}
        {statusQuery.isError && (
          <QueryErrorState
            title="Couldn't load enrichment status"
            error={statusQuery.error}
            onRetry={() => statusQuery.refetch()}
            compact
          />
        )}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4 animate-pulse h-24" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span className="text-xs text-slate-500 font-medium">Enriched</span>
              </div>
              <p className="text-2xl font-bold text-slate-900">{(status?.enrichedTotal ?? 0).toLocaleString()}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">SKUs with LLM attributes</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-amber-500" />
                <span className="text-xs text-slate-500 font-medium">Pending</span>
              </div>
              <p className="text-2xl font-bold text-slate-900">{(status?.pendingTotal ?? 0).toLocaleString()}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">SKUs awaiting enrichment</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="w-4 h-4 text-blue-500" />
                <span className="text-xs text-slate-500 font-medium">This Month</span>
              </div>
              <p className="text-2xl font-bold text-slate-900">{tierUsed.toLocaleString()}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {isEnterprise ? "Unlimited" : `of ${(tierLimit ?? 0).toLocaleString()} limit`}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-violet-500" />
                <span className="text-xs text-slate-500 font-medium">Tier</span>
              </div>
              <p className="text-base font-bold text-slate-900 capitalize">{isEnterprise ? "Enterprise" : "Base"}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {isEnterprise ? "Unlimited SKU enrichment" : "5,000 SKUs / month"}
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── Tier Quota Card ── */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">Monthly Usage</h2>
              <Badge variant="outline" className={cn(
                "text-[10px] font-mono",
                isEnterprise ? "text-violet-600 border-violet-300 bg-violet-50" : "text-slate-600",
              )}>
                {isEnterprise ? "ENTERPRISE" : "BASE"}
              </Badge>
            </div>

            {isEnterprise ? (
              <div className="flex flex-col items-center py-4 gap-2">
                <div className="w-16 h-16 rounded-full bg-violet-50 border-2 border-violet-200 flex items-center justify-center">
                  <Zap className="w-7 h-7 text-violet-500" />
                </div>
                <p className="text-sm font-semibold text-slate-700">Unlimited</p>
                <p className="text-[11px] text-slate-400 text-center">Enterprise tier — no monthly SKU cap</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-center">
                  <div className="relative">
                    <ProgressRing
                      pct={tierPct}
                      size={100}
                      strokeWidth={8}
                      color={nearLimit ? "#f59e0b" : "#7c3aed"}
                    />
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-xl font-bold text-slate-900">{tierPct}%</span>
                      <span className="text-[9px] text-slate-400 font-mono">used</span>
                    </div>
                  </div>
                </div>
                <div className="text-center space-y-0.5">
                  <p className="text-sm font-semibold text-slate-700">
                    {tierUsed.toLocaleString()} <span className="text-slate-400 font-normal">/ {(tierLimit ?? 0).toLocaleString()} SKUs</span>
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {status?.remaining != null ? `${(status.remaining as number).toLocaleString()} remaining` : "—"}
                  </p>
                </div>
                {nearLimit && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[11px] font-semibold text-amber-800">Approaching limit</p>
                      <p className="text-[10px] text-amber-700 mt-0.5">Upgrade to Enterprise for unlimited enrichment.</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!isEnterprise && (
              <a
                href="/billing-hub"
                className="flex items-center justify-between w-full px-3 py-2 rounded-xl border border-violet-200 bg-violet-50 text-xs font-semibold text-violet-700 hover:bg-violet-100 transition-colors group"
              >
                <span className="flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5" />
                  Upgrade to Enterprise
                </span>
                <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </a>
            )}
          </div>

          {/* ── Active Job Progress ── */}
          <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">Current Run</h2>
              {job && <StatusBadge status={job.status} />}
            </div>

            {!job ? (
              <div className="flex flex-col items-center py-8 gap-3">
                <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-slate-300" />
                </div>
                <p className="text-sm text-slate-500">No enrichment run yet.</p>
                <p className="text-xs text-slate-400">Configure batch size below and click Run Enrichment to start.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Progress bar */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-600 font-medium">
                      {job.processedSkus.toLocaleString()} / {job.totalSkus.toLocaleString()} SKUs
                    </span>
                    <span className="font-mono text-slate-500">{jobPct}%</span>
                  </div>
                  <div className="w-full h-2.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${jobPct}%`,
                        background: job.status === "failed"
                          ? "#f43f5e"
                          : job.status === "completed"
                          ? "#10b981"
                          : "linear-gradient(90deg, #7c3aed, #a855f7)",
                      }}
                    />
                  </div>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Processed", value: job.processedSkus, color: "text-emerald-600" },
                    { label: "Failed",    value: job.failedSkus,    color: "text-rose-600"    },
                    { label: "Duration",  value: formatDuration(job.startedAt, job.completedAt), color: "text-slate-700", isStr: true },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl bg-slate-50 border border-slate-100 p-2.5 text-center">
                      <p className={cn("text-base font-bold", s.color)}>
                        {(s as any).isStr ? s.value : (s.value as number).toLocaleString()}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{s.label}</p>
                    </div>
                  ))}
                </div>

                {job.errorMessage && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
                    <p className="text-xs text-rose-700 font-medium">Error</p>
                    <p className="text-[11px] text-rose-600 mt-0.5">{job.errorMessage}</p>
                  </div>
                )}

                <div className="flex items-center gap-4 text-[10px] text-slate-400 font-mono">
                  <span>Started: {formatDate(job.startedAt)}</span>
                  {job.completedAt && <span>Completed: {formatDate(job.completedAt)}</span>}
                </div>
              </div>
            )}

            {/* Batch size control */}
            <div className="pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between gap-4">
                <div
                  className="flex items-center gap-3"
                  role="group"
                  aria-labelledby="batch-size-label"
                >
                  <span id="batch-size-label" className="text-xs font-medium text-slate-600 whitespace-nowrap">Batch size:</span>
                  <div className="flex items-center gap-1">
                    {[50, 100, 250, 500].map((n) => (
                      <button
                        key={n}
                        onClick={() => setBatchSize(n)}
                        className={cn(
                          "px-2.5 py-1 rounded-lg text-xs font-semibold transition-all",
                          batchSize === n
                            ? "bg-violet-600 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                        )}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-[10px] text-slate-400">SKUs per run</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Error Banner ── */}
        {runError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-rose-800">{runError}</p>
              {runError.includes("limit") && (
                <a href="/billing-hub" className="text-xs text-rose-700 hover:underline mt-1 inline-flex items-center gap-1">
                  Upgrade to Enterprise <ArrowUpRight className="w-3 h-3" />
                </a>
              )}
            </div>
            <button onClick={() => setRunError(null)} className="text-rose-400 hover:text-rose-600">
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
            </button>
          </div>
        )}

        {/* ── Product Table ── */}
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          {/* Table header */}
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-4 h-4 text-slate-400" />
              <h2 className="text-sm font-bold text-slate-900">Products</h2>
              <span className="text-xs text-slate-400 font-mono">({totalProducts.toLocaleString()})</span>
            </div>
            <div className="flex items-center gap-1">
              {(["all", "enriched", "pending"] as FilterMode[]).map((f) => (
                <button
                  key={f}
                  onClick={() => { setFilter(f); setPage(1); }}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all capitalize",
                    filter === f
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {productsQuery.isError ? (
            <QueryErrorState
              title="Couldn't load products"
              error={productsQuery.error}
              onRetry={() => productsQuery.refetch()}
              compact
            />
          ) : productsQuery.isLoading ? (
            <div className="divide-y divide-slate-100">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-12 h-12 rounded-lg bg-slate-100 animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-2/3 bg-slate-100 rounded animate-pulse" />
                    <div className="h-2.5 w-1/3 bg-slate-100 rounded animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-3">
              <ShoppingBag className="w-8 h-8 text-slate-200" />
              <p className="text-sm text-slate-400">
                {filter === "enriched" ? "No enriched products yet." : filter === "pending" ? "No pending products." : "No products in warehouse."}
              </p>
              {filter === "pending" && (
                <p className="text-xs text-slate-400">Sync your Shopify store to populate the product warehouse.</p>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {products.map((product) => (
                <div key={product.id} className="px-5 py-3.5 flex items-center gap-4 hover:bg-slate-50/50 transition-colors">
                  {/* Image */}
                  <div className="w-10 h-10 rounded-xl bg-slate-100 overflow-hidden flex-shrink-0">
                    {product.imageUrl ? (
                      <img
                        src={product.imageUrl}
                        alt={product.title}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ShoppingBag className="w-4 h-4 text-slate-300" />
                      </div>
                    )}
                  </div>

                  {/* Title + SKU */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{product.title}</p>
                    <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                      SKU: {product.sku || "—"} · ID: {product.productId}
                    </p>
                  </div>

                  {/* LLM Attributes */}
                  <div className="flex items-center gap-1.5 flex-wrap max-w-xs">
                    {product.llmAttributes ? (
                      Object.entries(product.llmAttributes).map(([key, val]) => (
                        <AttrPill key={key} label={key} value={val ?? ""} />
                      ))
                    ) : (
                      <span className="text-[10px] text-slate-400 font-mono">Not enriched</span>
                    )}
                  </div>

                  {/* Status */}
                  <div className="flex-shrink-0">
                    {product.llmEnrichedAt ? (
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        <span className="text-[10px] text-slate-400 font-mono whitespace-nowrap">
                          {new Date(product.llmEnrichedAt).toLocaleDateString()}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-amber-400" />
                        <span className="text-[10px] text-amber-600 font-mono">Pending</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalProducts > 50 && (
            <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
              <p className="text-xs text-slate-500 font-mono">
                Showing {(page - 1) * 50 + 1}–{Math.min(page * 50, totalProducts)} of {totalProducts.toLocaleString()}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 disabled:opacity-40 hover:bg-slate-200 transition-all"
                >
                  Prev
                </button>
                <span className="text-xs text-slate-500 font-mono">Page {page}</span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page * 50 >= totalProducts}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 disabled:opacity-40 hover:bg-slate-200 transition-all"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── How it Works ── */}
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-violet-50/60 to-slate-50 p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-4">How Feed Enrichment Works</h3>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            {[
              { step: "1", icon: "inventory_2", title: "Fetch Products",    desc: "Pulls unenriched SKUs from your Shopify warehouse" },
              { step: "2", icon: "psychology",  title: "GPT-4o-mini Tags",  desc: "Extracts Shape, Occasion, Finish & Activity as JSON" },
              { step: "3", icon: "save",        title: "Store Attributes",  desc: "Saves LLM output to the product warehouse" },
              { step: "4", icon: "storefront",  title: "Shopify Metafields", desc: "Pushes attributes back to Shopify for search" },
            ].map((item) => (
              <div key={item.step} className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-violet-600" style={{ fontSize: 14, fontVariationSettings: "'FILL' 1" }}>
                    {item.icon}
                  </span>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-700">{item.title}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        </>}

        {view === "feedgen" && (
          <FeedgenView
            rows={feedgenRows}
            loading={feedgenLoading}
            running={feedgenRunning}
            approving={feedgenApproving}
            error={feedgenError}
            statusFilter={feedgenStatusFilter}
            setStatusFilter={setFeedgenStatusFilter}
            selected={feedgenSelected}
            toggleSelected={(id) => setFeedgenSelected((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id); else next.add(id);
              return next;
            })}
            onSelectAll={() => setFeedgenSelected(new Set(feedgenRows.filter((r) => r.status === "pending").map((r) => r.id)))}
            onClearSelected={() => setFeedgenSelected(new Set())}
            onScan={runFeedgenScan}
            onApprove={approveFeedgen}
            lastRun={feedgenLastRun}
            page={feedgenPage}
            setPage={setFeedgenPage}
            pageSize={FEEDGEN_PAGE_SIZE}
            total={feedgenTotal}
            stats={feedgenStats}
          />
        )}

        {view === "fixes" && (
          <QualityFixesView
            loading={fixesLoading}
            rescanning={fixesRescanning}
            data={fixesData}
            error={fixesError}
            successItems={successItems}
            errorItems={errorItems}
            filter={fixesFilter}
            setFilter={changeFixesFilter}
            staleOnly={fixesStaleOnly}
            setStaleOnly={setFixesStaleOnly}
            sort={fixesSort}
            setSort={setFixesSort}
            page={fixesPage}
            setPage={setFixesPage}
            pageSize={FIXES_PAGE_SIZE}
            rescanSummary={rescanSummary}
            rescanBudget={rescanBudget}
            selected={selectedOffers}
            toggleSelected={toggleSelected}
            approving={approving}
            approveResult={approveResult}
            onApprove={approveSelected}
            onSelectAll={() => setSelectedOffers(new Set(successItems.map((it) => it.id)))}
            onClearSelected={() => setSelectedOffers(new Set())}
            applyingIds={applyingIds}
            applyResults={applyResults}
            onApply={applyOne}
            undoingIds={undoingIds}
            undoResults={undoResults}
            onUndo={undoOne}
            rescanningIds={rescanningIds}
            rescanRowResults={rescanRowResults}
            onRescanRow={rescanOne}
            bulkRescanningErrors={bulkRescanningErrors}
            onRescanFailed={rescanFailed}
            bulkApplying={bulkApplying}
            bulkApplyProgress={bulkApplyProgress}
            bulkApplySummary={bulkApplySummary}
            bulkApplyFailures={bulkApplyFailures}
            bulkFailuresExpanded={bulkFailuresExpanded}
            setBulkFailuresExpanded={setBulkFailuresExpanded}
            onApplyBulk={applyBulk}
          />
        )}

        {view === "writeback" && (
          <WritebackView
            tasks={wbTasks}
            loading={wbLoading}
            error={wbError}
            retrying={wbRetrying}
            retryingAll={wbRetryingAll}
            runResult={wbRunResult}
            retryOutcomes={wbRetryOutcomes}
            runProgress={wbRunProgress}
            statusFilter={wbStatusFilter}
            setStatusFilter={setWbStatusFilter}
            onRetry={retryTask}
            onRetryAll={retryAllFailed}
            onRefresh={fetchWritebacks}
            maxAttempts={wbMaxAttempts}
          />
        )}

      </div>
    </AppShell>
  );
}

// ─── FeedGen view (AI Title + Description rewrites) ─────────────────────────
function FeedgenView(props: {
  rows:            FeedgenRewriteRow[];
  loading:         boolean;
  running:         boolean;
  approving:       boolean;
  error:           string | null;
  statusFilter:    string;
  setStatusFilter: (s: string) => void;
  selected:        Set<string>;
  toggleSelected:  (id: string) => void;
  onSelectAll:     () => void;
  onClearSelected: () => void;
  onScan:          () => void;
  onApprove:       () => void;
  lastRun:         { scanned: number; generated: number; failed: number; medianRoas: number | null } | null;
  page:            number;
  setPage:         (n: number) => void;
  pageSize:        number;
  total:           number;
  stats:           FeedgenStatsResponse | null;
}) {
  const {
    rows, loading, running, approving, error, statusFilter, setStatusFilter,
    selected, toggleSelected, onSelectAll, onClearSelected, onApprove, lastRun,
    page, setPage, pageSize, total, stats,
  } = props;

  const pendingCount = rows.filter((r) => r.status === "pending").length;
  const allSelected  = pendingCount > 0 && selected.size === pendingCount;
  const totalPages   = Math.max(1, Math.ceil(total / pageSize));
  const hasPrev      = page > 1;
  const hasNext      = page < totalPages;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {(["pending", "approved", "applied", "rejected", "failed"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium border transition",
                statusFilter === s
                  ? "bg-violet-600 text-white border-violet-600"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50",
              )}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
          {lastRun && (
            <span className="ml-3 text-[11px] text-slate-500 font-mono">
              Last run: scanned {lastRun.scanned} · generated {lastRun.generated} · failed {lastRun.failed}
              {lastRun.medianRoas !== null && (
                <> · median ROAS {lastRun.medianRoas.toFixed(2)}x</>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && statusFilter === "pending" && (
            <>
              <button
                onClick={allSelected ? onClearSelected : onSelectAll}
                className="text-xs text-violet-600 hover:text-violet-800"
              >
                {allSelected ? "Clear selection" : `Select all ${pendingCount}`}
              </button>
              <Button
                onClick={onApprove}
                disabled={selected.size === 0 || approving}
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
              >
                {approving
                  ? <><RefreshCw className="w-4 h-4 animate-spin" />Approving…</>
                  : <><CheckCircle2 className="w-4 h-4" />Approve {selected.size > 0 ? `(${selected.size})` : ""}</>
                }
              </Button>
            </>
          )}
        </div>
      </div>

      {stats && stats.totals.runs > 0 && (
        <FeedgenStatsPanel stats={stats} />
      )}

      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center text-slate-400 text-sm">
          <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
          Loading rewrites…
        </div>
      ) : rows.length === 0 ? (
        <div className="p-12 text-center rounded-xl border border-dashed border-slate-200 bg-slate-50">
          <Sparkles className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-600 font-medium">
            No {statusFilter} rewrites yet.
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {statusFilter === "pending"
              ? `Click "Generate Rewrites" to score the next batch of underperformers${running ? " (running…)" : ""}.`
              : "Switch tabs or run another generation pass."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const isPending  = r.status === "pending";
            const isSelected = selected.has(r.id);
            return (
              <div
                key={r.id}
                className={cn(
                  "rounded-xl border bg-white p-4 transition",
                  isSelected ? "border-violet-400 ring-1 ring-violet-200" : "border-slate-200",
                )}
              >
                <div className="flex items-start gap-3">
                  {isPending && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelected(r.id)}
                      className="mt-1 w-4 h-4 accent-violet-600 cursor-pointer"
                    />
                  )}
                  {r.imageUrl
                    ? <img src={r.imageUrl} alt={r.title ? `Product image for ${r.title}` : `Product ${r.sku || r.productId}`} loading="lazy" decoding="async" className="w-12 h-12 rounded-lg object-cover border border-slate-200 flex-shrink-0" />
                    : <div className="w-12 h-12 rounded-lg bg-slate-100 flex-shrink-0" aria-hidden="true" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono text-slate-500">{r.sku || r.productId}</span>
                      <Badge className={cn(
                        "text-[10px]",
                        r.qualityScore >= 80 ? "bg-emerald-100 text-emerald-700"
                          : r.qualityScore >= 60 ? "bg-amber-100 text-amber-700"
                          : "bg-rose-100 text-rose-700",
                      )}>
                        Score {r.qualityScore}/100
                      </Badge>
                      <Badge className="bg-slate-100 text-slate-600 text-[10px] capitalize">{r.status}</Badge>
                    </div>

                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="rounded-lg bg-rose-50/50 border border-rose-100 p-3">
                        <p className="text-[10px] uppercase tracking-wider text-rose-600 font-semibold mb-1">Before</p>
                        <p className="text-xs font-medium text-slate-800 break-words">{r.originalTitle}</p>
                        <p className="text-[11px] text-slate-600 mt-1.5 line-clamp-3">{r.originalDescription}</p>
                      </div>
                      <div className="rounded-lg bg-emerald-50/50 border border-emerald-100 p-3">
                        <p className="text-[10px] uppercase tracking-wider text-emerald-600 font-semibold mb-1">After</p>
                        <p className="text-xs font-medium text-slate-800 break-words">{r.rewrittenTitle}</p>
                        <p className="text-[11px] text-slate-600 mt-1.5 line-clamp-3">{r.rewrittenDescription}</p>
                      </div>
                    </div>

                    {r.reasoning && (
                      <div className="mt-2 text-[11px] text-slate-500 italic line-clamp-2">
                        Reasoning: {r.reasoning}
                      </div>
                    )}
                    {r.errorMessage && (
                      <div className="mt-2 text-[11px] text-rose-600">
                        Error ({r.errorCode}): {r.errorMessage}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination — mirrors the Quality Fixes pager so power users get a
          consistent control surface across both tabs. Hidden when everything
          fits on a single page. */}
      {!loading && total > pageSize && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-slate-500 font-mono">
            Page {page} of {totalPages} · {total.toLocaleString()} total
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => hasPrev && setPage(page - 1)}
              disabled={!hasPrev}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => hasNext && setPage(page + 1)}
              disabled={!hasNext}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Quality Fixes view ──────────────────────────────────────────────────────
function previewVal(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function QualityFixesView(props: {
  loading:         boolean;
  rescanning:      boolean;
  data:            QualityFixesResponse | null;
  error:           string | null;
  successItems:    QualityFixRow[];
  errorItems:      QualityFixRow[];
  filter:          FixesFilter;
  setFilter:       (f: FixesFilter) => void;
  staleOnly:       boolean;
  setStaleOnly:    (v: boolean) => void;
  sort:            "recent" | "oldest";
  setSort:         (s: "recent" | "oldest") => void;
  page:            number;
  setPage:         (n: number) => void;
  pageSize:        number;
  rescanSummary:   RescanSummary | null;
  rescanBudget:    RescanBudget | null;
  selected:        Set<string>;
  toggleSelected:  (offerId: string) => void;
  approving:       boolean;
  approveResult:   { approved: number; duplicate: number } | null;
  onApprove:       () => void;
  onSelectAll:     () => void;
  onClearSelected: () => void;
  applyingIds:     Set<string>;
  applyResults:    Record<string, { ok: boolean; message: string }>;
  onApply:         (id: string) => void;
  undoingIds:      Set<number>;
  undoResults:     Record<string, { ok: boolean; message: string }>;
  onUndo:          (id: string, auditId: number) => void;
  rescanningIds:   Set<string>;
  rescanRowResults: Record<string, { ok: boolean; message: string }>;
  onRescanRow:     (id: string) => void;
  bulkRescanningErrors: boolean;
  onRescanFailed:  (ids: string[]) => void;
  bulkApplying:    boolean;
  bulkApplyProgress: { done: number; total: number } | null;
  bulkApplySummary:  { total: number; succeeded: number; partial: number; failed: number } | null;
  bulkApplyFailures: Array<{ id: string; title: string | null; sku: string | null; message: string }>;
  bulkFailuresExpanded: boolean;
  setBulkFailuresExpanded: (v: boolean) => void;
  onApplyBulk:     (ids: string[]) => void;
}) {
  const {
    loading, rescanning, data, error, successItems, errorItems,
    filter, setFilter, staleOnly, setStaleOnly, sort, setSort,
    page, setPage, pageSize, rescanSummary, rescanBudget,
    selected, toggleSelected, approving, approveResult,
    onApprove, onSelectAll, onClearSelected,
    applyingIds, applyResults, onApply,
    undoingIds, undoResults, onUndo,
    rescanningIds, rescanRowResults, onRescanRow,
    bulkRescanningErrors, onRescanFailed,
    bulkApplying, bulkApplyProgress, bulkApplySummary, onApplyBulk,
    bulkApplyFailures, bulkFailuresExpanded, setBulkFailuresExpanded,
  } = props;

  const [isRetryRun, setIsRetryRun] = useState(false);

  const rescanDisabled = rescanBudget != null && rescanBudget.remaining < 1;

  const coverage     = data?.coverage;
  const totalScanned = coverage?.scannedProducts ?? 0;
  const totalAll     = coverage?.totalProducts   ?? 0;
  const pendingScan  = coverage?.pendingScan     ?? 0;
  const coveragePct  = totalAll > 0 ? Math.round((totalScanned / totalAll) * 100) : 0;
  const totalRows    = data?.total ?? 0;
  const totalPages   = Math.max(1, Math.ceil(totalRows / pageSize));
  const rowsOnPage   = data?.results.length ?? 0;
  // Clamp to a valid page so the "Showing X–Y of N" label can never display
  // a start past the end (e.g. if external churn shrank the result set
  // between renders).
  const safePage     = Math.min(Math.max(1, page), totalPages);
  const rangeStart   = totalRows === 0 || rowsOnPage === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd     = totalRows === 0 || rowsOnPage === 0 ? 0 : (safePage - 1) * pageSize + rowsOnPage;

  return (
    <div className="space-y-5">
      {/* ── Controls + summary ── */}
      {/* ── Header card ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-wrap items-start gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center">
            <Wrench className="w-4 h-4 text-amber-600" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Shoptimizer Quality Fixes</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Pre-computed Shoptimizer diffs from the background scanner.
              Pick the fixes you want and push them to the Approval Queue.
            </p>
          </div>
        </div>
      </div>

      {/* ── Coverage stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500 font-medium">Scanned coverage</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">
            {totalScanned.toLocaleString()} <span className="text-slate-400 text-base font-normal">/ {totalAll.toLocaleString()}</span>
          </p>
          <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-violet-500 transition-all"
              style={{ width: `${coveragePct}%` }}
            />
          </div>
          <p className="text-[10px] text-slate-400 mt-1">{coveragePct}% of warehouse products</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500 font-medium">Pending / stale</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{pendingScan.toLocaleString()}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">Need a (re)scan</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500 font-medium">Last scan</p>
          <p className="text-base font-semibold text-slate-900 mt-1">
            {coverage?.lastScanAt ? formatDate(coverage.lastScanAt) : "Never"}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">Most recent scanner tick</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500 font-medium">Selected</p>
          <p className="text-2xl font-bold text-violet-600 mt-1">{selected.size.toLocaleString()}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">Queued for approval</p>
        </div>
      </div>

      {/* ── Filters bar ── */}
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 flex flex-wrap items-center gap-3">
        <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Filter</span>
        {([
          { key: "with-fixes", label: "With fixes" },
          { key: "no-fixes",   label: "No fixes"   },
          { key: "error",      label: "Errors"     },
          { key: "all",        label: "All"        },
        ] as Array<{ key: FixesFilter; label: string }>).map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-semibold border transition",
              filter === f.key
                ? "bg-violet-600 text-white border-violet-600"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50",
            )}
          >
            {f.label}
          </button>
        ))}
        <label className="ml-2 inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={staleOnly}
            onChange={(e) => setStaleOnly(e.target.checked)}
            className="w-3.5 h-3.5 accent-violet-600"
          />
          Stale only
        </label>
        <label className="ml-2 inline-flex items-center gap-2 text-xs text-slate-600 select-none">
          <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
            Sort
          </span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value === "oldest" ? "oldest" : "recent")}
            className="px-2 py-1 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-200"
            title="Choose how the list is ordered"
          >
            <option value="recent">Most fixes / newest scan</option>
            <option value="oldest">Oldest scan first</option>
          </select>
        </label>
        <span className="ml-auto text-[11px] text-slate-400 font-mono">
          {totalRows === 0
            ? "0 matching rows"
            : <>Showing <strong className="text-slate-600">{rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()}</strong> of <strong className="text-slate-600">{totalRows.toLocaleString()}</strong></>}
        </span>
      </div>

      {/* ── Rescan summary banner ── */}
      {rescanSummary && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50 px-5 py-3 flex items-start gap-3">
          <Search className="w-4 h-4 text-violet-500 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-violet-900">
            {rescanSummary.skipped ? (
              <>Scan skipped — <span className="font-mono">{rescanSummary.reason ?? "no work to do"}</span>.</>
            ) : (
              <>
                Scan finished: scanned <strong>{rescanSummary.scanned.toLocaleString()}</strong>,
                refreshed <strong>{rescanSummary.refreshed.toLocaleString()}</strong>,
                failed <strong>{rescanSummary.failed.toLocaleString()}</strong>.
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Error / approve banners ── */}
      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm font-semibold text-rose-800">{error}</p>
        </div>
      )}

      {approveResult && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 flex items-start gap-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-emerald-800">
              Queued {approveResult.approved} fix{approveResult.approved === 1 ? "" : "es"} for approval.
            </p>
            {approveResult.duplicate > 0 && (
              <p className="text-xs text-emerald-700 mt-0.5">
                {approveResult.duplicate} were already pending in the Approval Queue.
              </p>
            )}
            <a href="/tasks" className="text-xs text-emerald-700 hover:underline mt-1 inline-flex items-center gap-1">
              View in Approval Queue <ArrowUpRight className="w-3 h-3" />
            </a>
          </div>
        </div>
      )}

      {/* ── List ── */}
      {(() => {
        if (loading) {
          return (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center space-y-3">
              <RefreshCw className="w-6 h-6 text-violet-500 mx-auto animate-spin" />
              <p className="text-sm text-slate-600">Loading suggested fixes…</p>
            </div>
          );
        }
        if (!data) {
          return (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-200 mx-auto flex items-center justify-center">
                <Wrench className="w-6 h-6 text-slate-300" />
              </div>
              <p className="text-sm text-slate-600 font-medium">No data yet.</p>
              <p className="text-xs text-slate-400">
                Click <span className="font-semibold text-slate-600">Scan now</span> to populate the table.
              </p>
            </div>
          );
        }

        const noFixItems: QualityFixRow[] = data.results.filter(
          (r) => r.scanStatus === "ok" && r.changeCount === 0,
        );

        // Decide which rows belong in the main row list per filter.
        // Errors are always rendered through their own ErrorList block below.
        const rowsForList: QualityFixRow[] =
          filter === "with-fixes" ? successItems
          : filter === "no-fixes" ? noFixItems
          : filter === "error"    ? []                       // handled separately
          /* all */                : [...successItems, ...noFixItems];

        const errorRowsToShow: QualityFixRow[] =
          filter === "error" ? errorItems
          : filter === "all" ? errorItems
          : [];

        const nothing = rowsForList.length === 0 && errorRowsToShow.length === 0;
        if (nothing) {
          return <EmptyFixesState filter={filter} totalRows={totalRows} />;
        }

        const selectableCount = successItems.length;

        return (
          <>
            {errorRowsToShow.length > 0 && (
              <ErrorList
                items={errorRowsToShow}
                totalRows={filter === "error" ? totalRows : errorRowsToShow.length}
                rescanning={rescanning}
                rescanningIds={rescanningIds}
                rescanRowResults={rescanRowResults}
                onRescanRow={onRescanRow}
                bulkRescanning={bulkRescanningErrors}
                onRescanAll={() => onRescanFailed(errorRowsToShow.map((r) => r.id))}
                rescanDisabled={rescanDisabled}
              />
            )}

            {rowsForList.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          {/* Bulk-action bar — only meaningful when at least one row has fixes */}
          {selectableCount > 0 && (
          <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
            <button
              onClick={selected.size === selectableCount ? onClearSelected : onSelectAll}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900"
            >
              {selected.size === selectableCount ? "Clear all" : "Select all with fixes"}
            </button>
            <span className="text-xs text-slate-400 font-mono">
              {selected.size} of {selectableCount} selected on this page
            </span>
            {bulkApplying && bulkApplyProgress && (
              <span className="text-xs text-violet-700 font-medium inline-flex items-center gap-1.5">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Applying to Shopify… {bulkApplyProgress.done} / {bulkApplyProgress.total}
              </span>
            )}
            {!bulkApplying && bulkApplySummary && (
              <span className={cn(
                "text-xs font-medium inline-flex items-center gap-1.5",
                bulkApplySummary.failed === 0 && bulkApplySummary.partial === 0
                  ? "text-emerald-700"
                  : "text-amber-700",
              )}>
                {bulkApplySummary.failed === 0 && bulkApplySummary.partial === 0
                  ? <CheckCircle2 className="w-3.5 h-3.5" />
                  : <AlertCircle className="w-3.5 h-3.5" />}
                {isRetryRun
                  ? <>
                      Retry complete — {bulkApplySummary.succeeded} fixed
                      {bulkApplySummary.partial > 0 && <>, {bulkApplySummary.partial} partial</>}
                      {bulkApplySummary.failed  > 0
                        ? <>, {bulkApplySummary.failed} still failing</>
                        : <> — all clear</>}
                    </>
                  : <>
                      Bulk apply done — {bulkApplySummary.succeeded} ok
                      {bulkApplySummary.partial > 0 && <>, {bulkApplySummary.partial} partial</>}
                      {bulkApplySummary.failed  > 0 && <>, {bulkApplySummary.failed} failed</>}
                      {" "}of {bulkApplySummary.total}.
                    </>
                }
              </span>
            )}
            {!bulkApplying && bulkApplyFailures.length > 0 && (
              <button
                type="button"
                onClick={() => setBulkFailuresExpanded(!bulkFailuresExpanded)}
                className="text-xs font-semibold text-rose-700 hover:text-rose-900 inline-flex items-center gap-1"
                aria-expanded={bulkFailuresExpanded}
                title="Show the list of products that failed to apply, with the Shopify error for each."
              >
                {bulkApplyFailures.length} failed — {bulkFailuresExpanded ? "hide details" : "view details"}
                {bulkFailuresExpanded
                  ? <ChevronUp className="w-3 h-3" />
                  : <ChevronDown className="w-3 h-3" />}
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button
                onClick={() => { setIsRetryRun(false); onApplyBulk(Array.from(selected)); }}
                disabled={selected.size === 0 || bulkApplying || approving}
                className="bg-violet-600 hover:bg-violet-700 text-white gap-2 disabled:opacity-50"
                title="Push every selected fix to Shopify in one click (rate-limited to stay under the Admin API throttle)."
              >
                {bulkApplying
                  ? <><RefreshCw className="w-4 h-4 animate-spin" />Applying…</>
                  : <><Send className="w-4 h-4" />Apply selected{selected.size > 0 ? ` (${selected.size})` : ""}</>
                }
              </Button>
              <Button
                onClick={onApprove}
                disabled={selected.size === 0 || approving || bulkApplying}
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 disabled:opacity-50"
              >
                {approving
                  ? <><RefreshCw className="w-4 h-4 animate-spin" />Sending…</>
                  : <><Send className="w-4 h-4" />Approve {selected.size > 0 ? `${selected.size} ` : ""}fix{selected.size === 1 ? "" : "es"}</>
                }
              </Button>
            </div>
          </div>
          )}

          {/* Per-row failure log — only rendered after a bulk apply finishes
              with at least one full failure, and only when the user opens it.
              The "retry this one" buttons reuse the existing single-apply
              path (`onApply`) so behaviour matches a per-row Apply click. */}
          {!bulkApplying && bulkFailuresExpanded && bulkApplyFailures.length > 0 && (
            <div className="px-5 py-4 border-b border-slate-100 bg-rose-50/40">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                <p className="text-xs font-semibold text-rose-800">
                  {bulkApplyFailures.length} product{bulkApplyFailures.length === 1 ? "" : "s"} failed to apply
                </p>
                <button
                  type="button"
                  onClick={() => { setIsRetryRun(true); onApplyBulk(bulkApplyFailures.map((f) => f.id)); }}
                  disabled={bulkApplying}
                  className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold border border-rose-300 text-rose-700 bg-white hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Re-run the bulk apply against every failed product in one click."
                >
                  <RotateCw className="w-3 h-3" />
                  Retry all failed ({bulkApplyFailures.length})
                </button>
              </div>
              <ul className="space-y-2">
                {bulkApplyFailures.map((f) => {
                  const isRetrying = applyingIds.has(f.id);
                  return (
                    <li
                      key={f.id}
                      className="rounded-lg border border-rose-200 bg-white px-3 py-2 flex items-start gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-900 truncate">
                          {f.title || f.sku || f.id}
                        </p>
                        <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                          SKU: {f.sku || "—"}
                        </p>
                        <p className="text-[11px] text-rose-700 mt-1 break-words">
                          {f.message}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onApply(f.id)}
                        disabled={isRetrying}
                        className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold border border-rose-300 text-rose-700 bg-white hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Re-run the single-product apply for this row."
                      >
                        {isRetrying
                          ? <><RefreshCw className="w-3 h-3 animate-spin" />Retrying…</>
                          : <><RotateCw className="w-3 h-3" />Retry this one</>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="divide-y divide-slate-100">
            {rowsForList.map((item) => {
              if (item.changeCount === 0) {
                return <NoFixRow
                  key={item.id}
                  item={item}
                  rescanning={rescanningIds.has(item.id)}
                  rescanResult={rescanRowResults[item.id]}
                  onRescan={() => onRescanRow(item.id)}
                  rescanDisabled={rescanDisabled}
                />;
              }
              return <FixRow
                key={item.id}
                item={item}
                checked={selected.has(item.id)}
                onToggle={() => toggleSelected(item.id)}
                applying={applyingIds.has(item.id)}
                applyResult={applyResults[item.id]}
                onApply={() => onApply(item.id)}
                undoing={item.undoableAuditId != null && undoingIds.has(item.undoableAuditId)}
                undoResult={undoResults[item.id]}
                onUndo={item.undoableAuditId != null
                  ? () => onUndo(item.id, item.undoableAuditId!)
                  : undefined}
                rescanning={rescanningIds.has(item.id)}
                rescanResult={rescanRowResults[item.id]}
                onRescan={() => onRescanRow(item.id)}
                rescanDisabled={rescanDisabled}
              />;
            })}
          </div>
        </div>
            )}

            {/* Pagination — shared across all filters */}
            {totalRows > pageSize && (
              <div className="rounded-2xl border border-slate-200 bg-white px-5 py-3 flex items-center justify-between">
                <p className="text-xs text-slate-500 font-mono">
                  Page {page} of {totalPages} · {totalRows.toLocaleString()} total
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 disabled:opacity-40 hover:bg-slate-200 transition-all"
                  >
                    Prev
                  </button>
                  <button
                    onClick={() => setPage(page + 1)}
                    disabled={page >= totalPages}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 disabled:opacity-40 hover:bg-slate-200 transition-all"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}

function FixRow({
  item, checked, onToggle,
  applying, applyResult, onApply,
  undoing, undoResult, onUndo,
  rescanning, rescanResult, onRescan,
  rescanDisabled,
}: {
  item: QualityFixRow;
  checked: boolean;
  onToggle: () => void;
  applying: boolean;
  applyResult?: { ok: boolean; message: string };
  onApply: () => void;
  undoing: boolean;
  undoResult?: { ok: boolean; message: string };
  onUndo?: () => void;
  rescanning: boolean;
  rescanResult?: { ok: boolean; message: string };
  onRescan: () => void;
  rescanDisabled?: boolean;
}) {
  const isStale = item.productLastSync && item.productSyncedAt
    ? new Date(item.productLastSync).getTime() > new Date(item.productSyncedAt).getTime()
    : false;
  const fields  = item.changedFields ?? [];
  const plugins = item.pluginsFired  ?? [];
  return (
    <div className={cn(
      "px-5 py-4 transition-colors",
      checked ? "bg-violet-50/30" : "hover:bg-slate-50/50",
    )}>
      <div className="flex items-start gap-4">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="mt-1 w-4 h-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
        />
        <div className="w-10 h-10 rounded-xl bg-slate-100 overflow-hidden flex-shrink-0">
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={item.title ?? ""}
              className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <ShoppingBag className="w-4 h-4 text-slate-300" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">
                {item.title ?? item.id}
              </p>
              <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                SKU: {item.sku || "—"} · ID: {item.productId ?? item.id}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {isStale && (
                <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] font-semibold">
                  Stale
                </Badge>
              )}
              <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] font-semibold">
                {item.changeCount} fix{item.changeCount === 1 ? "" : "es"}
              </Badge>
            </div>
          </div>
          {plugins.length > 0 && (
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <span className="text-[9px] uppercase tracking-wider text-slate-400 font-mono">Plugins:</span>
              {plugins.map((p) => (
                <span key={p} className="inline-flex items-center px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200 text-[10px] font-medium font-mono">
                  {p}
                </span>
              ))}
            </div>
          )}
          {applyResult && (
            <p className={cn(
              "text-[11px] mt-2 font-medium",
              applyResult.ok ? "text-emerald-700" : "text-rose-700",
            )}>
              {applyResult.message}
            </p>
          )}
          {undoResult && (
            <p className={cn(
              "text-[11px] mt-2 font-medium",
              undoResult.ok ? "text-emerald-700" : "text-rose-700",
            )}>
              {undoResult.message}
            </p>
          )}
          {rescanResult && (
            <p className={cn(
              "text-[11px] mt-1 font-medium",
              rescanResult.ok ? "text-violet-700" : "text-rose-700",
            )}>
              {rescanResult.message}
            </p>
          )}
          <div className="mt-3 rounded-xl border border-slate-100 overflow-hidden">
            <table className="w-full text-[11px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-3 py-1.5 font-semibold text-slate-600 w-32">Field</th>
                  <th className="text-left px-3 py-1.5 font-semibold text-slate-600">Before</th>
                  <th className="px-2 py-1.5 w-6"></th>
                  <th className="text-left px-3 py-1.5 font-semibold text-slate-600">After</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((c, i) => (
                  <tr key={`${c.field}-${i}`} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2 font-mono text-slate-700">{c.field}</td>
                    <td className="px-3 py-2 text-rose-700 break-words">
                      <span className="inline-block max-w-md break-words line-through opacity-80">
                        {previewVal(c.before)}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-slate-300">
                      <ArrowRight className="w-3 h-3 mx-auto" />
                    </td>
                    <td className="px-3 py-2 text-emerald-700 break-words">
                      <span className="inline-block max-w-md break-words font-medium">
                        {previewVal(c.after)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-end gap-2 px-3 py-2 bg-slate-50 border-t border-slate-100">
              <span className="text-[10px] text-slate-500">
                Writes title/description back to the Shopify product; everything
                else as a metafield in <span className="font-mono">omnianalytix_feed</span>.
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={rescanning || applying || rescanDisabled}
                onClick={onRescan}
                className="h-7 px-2.5 text-xs gap-1.5 border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                title={rescanDisabled ? "Rescan budget exhausted — wait for next refill" : "Re-run Shoptimizer for this product only"}
              >
                {rescanning
                  ? <><RefreshCw className="w-3 h-3 animate-spin" />Rescanning…</>
                  : <><Search className="w-3 h-3" />Rescan</>
                }
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={applying || undoing}
                onClick={onApply}
                className="h-7 px-2.5 text-xs gap-1.5 border-violet-200 text-violet-700 hover:bg-violet-50"
              >
                {applying
                  ? <><RefreshCw className="w-3 h-3 animate-spin" />Applying…</>
                  : <><Send className="w-3 h-3" />Apply fix</>
                }
              </Button>
              {onUndo && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={undoing || applying}
                  onClick={onUndo}
                  className="h-7 px-2.5 text-xs gap-1.5 border-amber-200 text-amber-700 hover:bg-amber-50"
                  title="Restore the original Shopify values from the most recent Apply"
                >
                  {undoing
                    ? <><RefreshCw className="w-3 h-3 animate-spin" />Undoing…</>
                    : <><Undo2 className="w-3 h-3" />Undo</>
                  }
                </Button>
              )}
            </div>
          </div>
          <p className="mt-2 text-[10px] text-slate-400 font-mono">
            Scanned{" "}
            {item.scannedAt ? (
              <>
                <span
                  className="text-slate-600 font-semibold"
                  title={formatDate(item.scannedAt)}
                >
                  {formatRelative(item.scannedAt)}
                </span>
                {" · "}
                {formatDate(item.scannedAt)}
              </>
            ) : "—"}
            {item.productLastSync && (
              <> · Product last sync {formatDate(item.productLastSync)}</>
            )}
          </p>
          <FixHistoryDisclosure history={item.history} />
        </div>
      </div>
    </div>
  );
}

/**
 * Collapsible audit trail for a quality fix. Renders nothing when the fix
 * has never been applied; otherwise summarises the latest event in the
 * trigger and reveals the full chronological list on click.
 */
function FixHistoryDisclosure({ history }: { history: FixHistoryEntry[] }) {
  const [open, setOpen] = useState(false);
  if (!history || history.length === 0) return null;

  const last    = history[history.length - 1];
  const summary = describeHistoryEntry(last);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-700 transition-colors"
      >
        <History className="w-3 h-3" />
        <span className="font-medium">History</span>
        <span className="text-slate-400">·</span>
        <span>{summary}</span>
        <ChevronDown
          className={cn(
            "w-3 h-3 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <ol className="mt-2 ml-1 border-l border-slate-200 pl-3 space-y-1.5">
          {history.map((h) => (
            <li key={h.auditId} className="text-[11px] text-slate-600 flex items-start gap-2">
              <span
                className={cn(
                  "inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-semibold mt-0.5 flex-shrink-0",
                  h.action === "apply"
                    ? "bg-violet-100 text-violet-700"
                    : "bg-amber-100 text-amber-700",
                )}
                title={h.action === "apply" ? "Apply" : "Undo"}
              >
                {h.action === "apply" ? <Send className="w-2.5 h-2.5" /> : <Undo2 className="w-2.5 h-2.5" />}
              </span>
              <span className="flex-1">
                <span className="font-medium text-slate-800">
                  {h.action === "apply" ? "Applied" : "Undone"}
                </span>{" "}
                by{" "}
                <span className="inline-flex items-center gap-0.5 font-medium text-slate-700">
                  <User className="w-3 h-3 text-slate-400" />
                  {h.actor?.name || (h.actor?.id != null ? `User #${h.actor.id}` : "system")}
                </span>
                {h.status !== "applied" && (
                  <Badge className="ml-1.5 bg-rose-50 text-rose-700 border-rose-200 text-[9px] font-semibold align-middle">
                    {h.status}
                  </Badge>
                )}
                <span className="text-slate-400"> · {formatDate(h.at)}</span>
                <a
                  href={`${BASE}activity?highlight=${h.auditId}`}
                  title={`Open audit entry #${h.auditId} in Activity Log`}
                  className="inline-flex items-center gap-0.5 ml-1.5 text-violet-500 hover:text-violet-700 transition-colors align-middle"
                  aria-label={`View audit entry #${h.auditId} in the activity log`}
                >
                  <ExternalLink className="w-2.5 h-2.5" />
                  <span className="text-[10px] font-medium">View</span>
                </a>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function describeHistoryEntry(h: FixHistoryEntry): string {
  const verb  = h.action === "apply" ? "Applied" : "Undone";
  const who   = h.actor?.name || (h.actor?.id != null ? `User #${h.actor.id}` : "system");
  return `${verb} by ${who} · ${formatDate(h.at)}`;
}

function NoFixRow({ item, rescanning, rescanResult, onRescan, rescanDisabled }: {
  item: QualityFixRow;
  rescanning: boolean;
  rescanResult?: { ok: boolean; message: string };
  onRescan: () => void;
  rescanDisabled?: boolean;
}) {
  const isStale = item.productLastSync && item.productSyncedAt
    ? new Date(item.productLastSync).getTime() > new Date(item.productSyncedAt).getTime()
    : false;
  return (
    <div className="px-5 py-3 hover:bg-slate-50/50 transition-colors">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-slate-100 overflow-hidden flex-shrink-0">
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={item.title ?? ""}
              className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <ShoppingBag className="w-4 h-4 text-slate-300" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800 truncate">
            {item.title ?? item.id}
          </p>
          <p className="text-[10px] text-slate-400 font-mono mt-0.5">
            SKU: {item.sku || "—"} · ID: {item.productId ?? item.id}
            {item.scannedAt && (
              <>
                {" · scanned "}
                <span
                  className="text-slate-600 font-semibold"
                  title={formatDate(item.scannedAt)}
                >
                  {formatRelative(item.scannedAt)}
                </span>
                {" ("}{formatDate(item.scannedAt)}{")"}
              </>
            )}
          </p>
          {rescanResult && (
            <p className={cn(
              "text-[11px] mt-1 font-medium",
              rescanResult.ok ? "text-violet-700" : "text-rose-700",
            )}>
              {rescanResult.message}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isStale && (
            <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] font-semibold">
              Stale
            </Badge>
          )}
          <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] font-semibold inline-flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> No fixes needed
          </Badge>
          <Button
            size="sm"
            variant="outline"
            disabled={rescanning || rescanDisabled}
            onClick={onRescan}
            className="h-7 px-2.5 text-xs gap-1.5 border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            title={rescanDisabled ? "Rescan budget exhausted — wait for next refill" : "Re-run Shoptimizer for this product only"}
          >
            {rescanning
              ? <><RefreshCw className="w-3 h-3 animate-spin" />Rescanning…</>
              : <><Search className="w-3 h-3" />Rescan</>
            }
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmptyFixesState({ filter, totalRows }: { filter: FixesFilter; totalRows: number }) {
  const messages: Record<FixesFilter, { icon: React.ReactNode; title: string; body: string }> = {
    "with-fixes": {
      icon: <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />,
      title: "No suggested fixes right now.",
      body:  "The scanner ran but didn't find any field changes for the products it inspected.",
    },
    "no-fixes": {
      icon: <CheckCircle2 className="w-8 h-8 text-slate-300 mx-auto" />,
      title: "No clean products in this view.",
      body:  totalRows === 0
        ? "Nothing has been scanned yet. Click Scan now to start."
        : "Switch the filter to see products with suggested fixes.",
    },
    "error": {
      icon: <AlertCircle className="w-8 h-8 text-emerald-500 mx-auto" />,
      title: "No scanner errors.",
      body:  "Every product the scanner touched returned a successful Shoptimizer response.",
    },
    "all": {
      icon: <Wrench className="w-8 h-8 text-slate-300 mx-auto" />,
      title: "Nothing to show.",
      body:  "Click Scan now to populate the table.",
    },
  };
  const m = messages[filter];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center space-y-3">
      {m.icon}
      <p className="text-sm text-slate-700 font-semibold">{m.title}</p>
      <p className="text-xs text-slate-500">{m.body}</p>
    </div>
  );
}

function ErrorList({
  items, totalRows, rescanning,
  rescanningIds, rescanRowResults, onRescanRow,
  bulkRescanning, onRescanAll,
  rescanDisabled,
}: {
  items: QualityFixRow[];
  totalRows: number;
  rescanning: boolean;
  rescanningIds: Set<string>;
  rescanRowResults: Record<string, { ok: boolean; message: string }>;
  onRescanRow: (id: string) => void;
  bulkRescanning: boolean;
  onRescanAll: () => void;
  rescanDisabled?: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center space-y-3">
        <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
        <p className="text-sm text-slate-700 font-semibold">No scanner errors.</p>
        <p className="text-xs text-slate-500">
          {rescanning ? "Rescan in progress…" : `0 of ${totalRows.toLocaleString()} rows on this page errored.`}
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/40 overflow-hidden">
      <div className="px-5 py-3 border-b border-amber-100 bg-amber-50 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-900">
            {totalRows.toLocaleString()} product{totalRows === 1 ? "" : "s"} failed to scan.
          </p>
          <p className="text-[11px] text-amber-700 mt-0.5">
            Shoptimizer returned an error for these items. Use Rescan failed to
            retry just the visible rows without waiting for the next scheduled scan.
          </p>
        </div>
        <Button
          size="sm"
          disabled={bulkRescanning || items.length === 0 || rescanDisabled}
          onClick={onRescanAll}
          className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5 h-8 px-3 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
          title={rescanDisabled ? "Rescan budget exhausted — wait for next refill" : "Re-run Shoptimizer for the visible failed products"}
        >
          {bulkRescanning
            ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Rescanning…</>
            : <><Search className="w-3.5 h-3.5" />Rescan failed ({items.length})</>
          }
        </Button>
      </div>
      <div className="divide-y divide-amber-100">
        {items.map((it) => {
          const rowRescanning = rescanningIds.has(it.id) || bulkRescanning;
          const rowResult     = rescanRowResults[it.id];
          return (
            <div key={it.id} className="px-5 py-3">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">
                    {it.title || it.sku || it.id}
                  </p>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                    SKU: {it.sku || "—"} · ID: {it.productId ?? it.id} · scanned{" "}
                    {it.scannedAt ? (
                      <>
                        <span
                          className="text-slate-700 font-semibold"
                          title={formatDate(it.scannedAt)}
                        >
                          {formatRelative(it.scannedAt)}
                        </span>
                        {" ("}{formatDate(it.scannedAt)}{")"}
                      </>
                    ) : "—"}
                  </p>
                  <p className="text-[11px] text-amber-800 mt-1 break-words">
                    <span className="font-mono opacity-70">[{it.errorCode ?? "ERROR"}]</span>{" "}
                    {it.errorMessage ?? "Unknown error"}
                  </p>
                  {rowResult && (
                    <p className={cn(
                      "text-[11px] mt-1 font-medium",
                      rowResult.ok ? "text-violet-700" : "text-rose-700",
                    )}>
                      {rowResult.message}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={rowRescanning || rescanDisabled}
                  onClick={() => onRescanRow(it.id)}
                  className="h-7 px-2.5 text-xs gap-1.5 border-amber-200 text-amber-700 hover:bg-amber-50 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={rescanDisabled ? "Rescan budget exhausted — wait for next refill" : "Re-run Shoptimizer for this product"}
                >
                  {rescanningIds.has(it.id)
                    ? <><RefreshCw className="w-3 h-3 animate-spin" />Rescanning…</>
                    : <><Search className="w-3 h-3" />Rescan</>
                  }
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── FeedGen stats panel ────────────────────────────────────────────────────
// Headline KPIs + a small spend-vs-approval-rate chart over the last 30 days.
// Powers the "is this feature paying for itself?" question without sending an
// operator off to the BI dashboards.
function FeedgenStatsPanel({ stats }: { stats: FeedgenStatsResponse }) {
  // Lazy-load recharts to keep the dashboard's initial bundle small —
  // operators only pay this cost when they open the Title & Description tab
  // and the panel actually mounts.
  const [R, setR] = useState<typeof import("recharts") | null>(null);
  useEffect(() => {
    let active = true;
    void import("recharts").then((mod) => { if (active) setR(mod); });
    return () => { active = false; };
  }, []);

  const totals = stats.totals;
  // Format estimated USD spend with sensible precision: under $10 keeps cents,
  // anything larger rounds to whole dollars so the headline stays scannable.
  // usd-leak-allow: FeedGen Vertex AI billing is always denominated in USD — not display-currency
  const formatUsd = (n: number): string => {
    if (!Number.isFinite(n)) return "—";
    if (n < 1)  return `$${n.toFixed(3)}`; // usd-leak-allow: FeedGen cost helper — USD only
    if (n < 10) return `$${n.toFixed(2)}`; // usd-leak-allow: FeedGen cost helper — USD only
    return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  };
  const usdLabel       = formatUsd(totals.estimatedUsd);
  const usdPerApproved = totals.usdPerApproved === null ? null : formatUsd(totals.usdPerApproved);
  const tokenLabel =
    totals.totalTokens >= 1_000_000 ? `${(totals.totalTokens / 1_000_000).toFixed(2)}M`
    : totals.totalTokens >= 1_000   ? `${(totals.totalTokens / 1_000).toFixed(1)}k`
    :                                  String(totals.totalTokens);
  const approvalPct =
    totals.approvalRate === null ? "—" : `${Math.round(totals.approvalRate * 100)}%`;

  // usd-leak-allow: pricing tooltip shows raw Vertex AI rate in USD (not display-currency)
  const pricingIsDefault =
    !stats.pricing ||
    (stats.pricing.usingDefaults?.prompt ?? true) ||
    (stats.pricing.usingDefaults?.candidates ?? true);
  const pricingTooltip = stats.pricing // usd-leak-allow: Vertex AI pricing is always in USD
    ? pricingIsDefault
      ? `Using hardcoded Gemini 2.5 Flash defaults: $${stats.pricing.promptUsdPer1M}/1M input, $${stats.pricing.candidatesUsdPer1M}/1M output. ` +
        `Set FEEDGEN_USD_PER_1M_PROMPT_TOKENS / FEEDGEN_USD_PER_1M_CANDIDATES_TOKENS env vars to lock in the correct rates.`
      : `Operator-configured rates: $${stats.pricing.promptUsdPer1M}/1M input tokens and $${stats.pricing.candidatesUsdPer1M}/1M output tokens.`
    : undefined;

  // Map the API series → the shape recharts likes. `approvalPct` is null on
  // days with no offered rewrites; recharts skips nulls gracefully on a Line.
  const data = stats.series.map((p) => ({
    day:          p.day.slice(5),                       // "MM-DD" — tighter axis labels
    usd:          Number(p.estimatedUsd.toFixed(4)),
    tokens:       p.totalTokens,
    approvalPct:  p.approvalRate === null ? null : Math.round(p.approvalRate * 100),
    approved:     p.approved,
    offered:      p.offered,
  }));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">AI cost vs approved feed changes</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Last {stats.days} days</p>
        </div>
        <div className="flex items-center gap-6 text-right">
          <div>
            <p className="text-[10px] uppercase text-slate-500">Approval rate</p>
            <p className="text-lg font-semibold text-emerald-700">{approvalPct}</p>
            <p className="text-[10px] text-slate-500">{totals.approved.toLocaleString()} / {totals.offered.toLocaleString()}</p>
          </div>
          <div title={pricingTooltip}>
            <p className="text-[10px] uppercase text-slate-500 flex items-center gap-1">
              Est. spend
              {pricingIsDefault && (
                <span
                  className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-semibold bg-amber-100 text-amber-700 border border-amber-300 leading-none"
                  title={pricingTooltip}
                >
                  default rates
                </span>
              )}
            </p>
            <p className="text-lg font-semibold text-violet-700">{usdLabel}</p>
            <p className="text-[10px] text-slate-500">
              {usdPerApproved !== null ? `${usdPerApproved} / approved` : `${tokenLabel} tokens`}
            </p>
          </div>
        </div>
      </div>
      <div style={{ width: "100%", height: 160 }}>
        {R ? (
          <R.ResponsiveContainer>
            <R.ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <R.CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <R.XAxis dataKey="day" tick={{ fontSize: 10, fill: "#64748b" }} interval="preserveStartEnd" />
              <R.YAxis
                yAxisId="left"
                tick={{ fontSize: 10, fill: "#64748b" }}
                width={48}
                tickFormatter={(v: number) => v >= 1 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`} /* usd-leak-allow: FeedGen chart Y-axis — Vertex cost is always USD */
              />
              <R.YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: "#64748b" }} width={32} unit="%" />
              <R.Tooltip
                contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e2e8f0" }}
                formatter={(value: unknown, name: string) => {
                  if (name === "Approval rate") return [value === null ? "—" : `${value}%`, name];
                  if (name === "Est. spend")    return [formatUsd(Number(value)), name];
                  return [String(value), name];
                }}
              />
              <R.Bar  yAxisId="left"  dataKey="usd"         name="Est. spend"    fill="#c4b5fd" />
              <R.Line yAxisId="right" dataKey="approvalPct" name="Approval rate" stroke="#059669" strokeWidth={2} dot={false} connectNulls />
            </R.ComposedChart>
          </R.ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-[11px] text-slate-400">
            Loading chart…
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Writeback View ───────────────────────────────────────────────────────────

const WB_STATUS_OPTIONS: Array<{ value: WritebackStatus | "all"; label: string }> = [
  { value: "all",      label: "All" },
  { value: "pending",  label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "applied",  label: "Applied" },
  { value: "failed",   label: "Failed" },
];

function retryClassMeta(cls: RetryClass | undefined): {
  icon: React.ReactNode; color: string; label: string;
} {
  switch (cls) {
    case "non_retryable": return {
      icon: <XCircle className="w-3 h-3" />,
      color: "bg-rose-50 text-rose-700 border-rose-200",
      label: "Validation Error",
    };
    case "quota": return {
      icon: <TimerReset className="w-3 h-3" />,
      color: "bg-amber-50 text-amber-700 border-amber-200",
      label: "Quota / Rate Limit",
    };
    case "transient": return {
      icon: <RefreshCw className="w-3 h-3" />,
      color: "bg-blue-50 text-blue-700 border-blue-200",
      label: "Transient Error",
    };
    case "auth": return {
      icon: <ShieldAlert className="w-3 h-3" />,
      color: "bg-purple-50 text-purple-700 border-purple-200",
      label: "Auth Error",
    };
    default: return {
      icon: <AlertCircle className="w-3 h-3" />,
      color: "bg-slate-50 text-slate-600 border-slate-200",
      label: "Unknown",
    };
  }
}

function WritebackStatusBadge({ status }: { status: WritebackStatus }) {
  const cfg: Record<WritebackStatus, { color: string; icon: React.ReactNode; label: string }> = {
    pending:  { color: "bg-slate-100 text-slate-600 border-slate-200",        icon: <Clock className="w-3 h-3" />,                         label: "Pending"  },
    approved: { color: "bg-blue-50 text-blue-700 border-blue-200",            icon: <CheckCircle2 className="w-3 h-3" />,                   label: "Approved" },
    applied:  { color: "bg-emerald-50 text-emerald-700 border-emerald-200",   icon: <CheckCircle2 className="w-3 h-3" />,                   label: "Applied"  },
    failed:   { color: "bg-rose-50 text-rose-700 border-rose-200",            icon: <AlertCircle className="w-3 h-3" />,                    label: "Failed"   },
  };
  const c = cfg[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-semibold border", c.color)}>
      {c.icon}{c.label}
    </span>
  );
}

export function WritebackView(props: {
  tasks:           WritebackTask[];
  loading:         boolean;
  error:           string | null;
  retrying:        Set<number>;
  retryingAll:     boolean;
  runResult:       WritebackRunResult | null;
  /** Transient per-row outcomes from the most recent bulk retry. Auto-cleared after ~5 s. */
  retryOutcomes:   Map<number, "applied" | "failed">;
  /** Live progress counter while a batch POST is in flight. Null when idle. */
  runProgress?:    { total: number; done: number } | null;
  statusFilter:    WritebackStatus | "all";
  setStatusFilter: (v: WritebackStatus | "all") => void;
  onRetry:         (id: number) => void;
  onRetryAll:      () => void;
  onRefresh:       () => void;
  maxAttempts:     number;
}) {
  const {
    tasks, loading, error, retrying, retryingAll, runResult, retryOutcomes, runProgress, statusFilter, setStatusFilter,
    onRetry, onRetryAll, maxAttempts,
  } = props;
  const isRunning = runProgress !== null && runProgress !== undefined;

  const failed  = tasks.filter((t) => t.status === "failed");
  const applied = tasks.filter((t) => t.status === "applied");
  const retryableFailedCount = tasks.filter(
    (t) => t.status === "failed" && t.latestAttempt?.retry?.retryable === true,
  ).length;
  const exhausted = tasks.filter((t) => t.status === "failed" && t.attemptCount >= maxAttempts);

  return (
    <div className="space-y-5">
      {/* ── Header card ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center">
            <Upload className="w-4 h-4 text-indigo-600" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Merchant Center Write-Backs</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Track approved Shoptimizer fixes pushed to Google Merchant Center. Retry failed tasks with one click.
            </p>
          </div>
        </div>

        {/* Retry All Failed button — only when retryable failures exist */}
        {retryableFailedCount > 0 && (
          <button
            onClick={onRetryAll}
            disabled={retryingAll}
            className={cn(
              "inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all",
              retryingAll
                ? "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
                : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100",
            )}
          >
            {retryingAll
              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              : <RotateCw className="w-3.5 h-3.5" />
            }
            {retryingAll && runProgress
              ? `${runProgress.done} / ${runProgress.total} done…`
              : retryingAll
                ? "Retrying…"
                : `Retry All Failed (${retryableFailedCount})`
            }
          </button>
        )}

        {/* Status filter pills */}
        <div className="ml-auto flex items-center gap-1">
          {WB_STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-semibold transition-all",
                statusFilter === opt.value
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Summary stat cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500 font-medium">Total Tasks</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{tasks.length}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">Write-back items in queue</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500 font-medium">Applied</p>
          <p className="text-2xl font-bold text-emerald-600 mt-1">{applied.length}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">Successfully pushed to GMC</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500 font-medium">Failed</p>
          <p className="text-2xl font-bold text-rose-600 mt-1">{failed.length}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">Need attention or retry</p>
        </div>
        <div className={cn(
          "rounded-2xl border p-4",
          exhausted.length > 0
            ? "border-orange-300 bg-orange-50"
            : "border-slate-200 bg-white",
        )}>
          <div className="flex items-center gap-1.5">
            <p className={cn("text-xs font-medium", exhausted.length > 0 ? "text-orange-700" : "text-slate-500")}>
              Retries Exhausted
            </p>
            {exhausted.length > 0 && (
              <ShieldAlert className="w-3 h-3 text-orange-500 flex-shrink-0" />
            )}
          </div>
          <p className={cn("text-2xl font-bold mt-1", exhausted.length > 0 ? "text-orange-600" : "text-slate-400")}>
            {exhausted.length}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {exhausted.length > 0 ? `Hit ${maxAttempts}-attempt cap — admin action needed` : "No tasks at retry cap"}
          </p>
        </div>
      </div>

      {/* ── Exhausted-retries alert banner ── */}
      {exhausted.length > 0 && (
        <div className="rounded-2xl border border-orange-300 bg-orange-50 px-5 py-4 flex items-start gap-3">
          <ShieldAlert className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-orange-900">
              {exhausted.length} write-back task{exhausted.length === 1 ? "" : "s"} exhausted all {maxAttempts} auto-retries
            </p>
            <p className="text-xs text-orange-700 mt-0.5">
              These tasks will not be retried automatically. An admin must review them and trigger a manual retry or investigate the underlying failure.
            </p>
          </div>
        </div>
      )}

      {/* ── Live progress banner (visible while batch POST is in flight) ── */}
      {isRunning && runProgress && (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-4">
          <div className="flex items-center gap-3">
            <RefreshCw className="w-4 h-4 text-indigo-500 flex-shrink-0 animate-spin" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-indigo-900">
                Applying write-backs — {runProgress.done} / {runProgress.total} done
              </p>
              <p className="text-[11px] text-indigo-600 mt-0.5">
                Each task status updates as it completes. The list refreshes automatically.
              </p>
              {/* Progress bar */}
              <div className="mt-2 h-1.5 w-full rounded-full bg-indigo-200 overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all duration-500"
                  style={{
                    width: runProgress.total > 0
                      ? `${Math.round((runProgress.done / runProgress.total) * 100)}%`
                      : "0%",
                  }}
                />
              </div>
            </div>
            <span className="text-xs font-semibold text-indigo-700 tabular-nums flex-shrink-0">
              {runProgress.total > 0
                ? `${Math.round((runProgress.done / runProgress.total) * 100)}%`
                : "0%"
              }
            </span>
          </div>
        </div>
      )}

      {/* ── Run result banner ── */}
      {!isRunning && runResult && (
        <div className={cn(
          "rounded-2xl border px-5 py-4 flex items-start gap-3",
          runResult.totalFailed === 0
            ? "border-emerald-200 bg-emerald-50"
            : runResult.totalApplied > 0
              ? "border-amber-200 bg-amber-50"
              : "border-rose-200 bg-rose-50",
        )}>
          {runResult.totalFailed === 0
            ? <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
            : <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
          }
          <div>
            <p className="text-sm font-semibold text-slate-800">
              {runResult.totalApplied} of {runResult.totalRequested} task{runResult.totalRequested === 1 ? "" : "s"} applied successfully.
            </p>
            {runResult.totalFailed > 0 && (
              <p className="text-xs text-slate-600 mt-0.5">
                {runResult.totalFailed} failed — see hints below.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Error banner ── */}
      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm font-semibold text-rose-800">{error}</p>
        </div>
      )}

      {/* ── Loading / empty / list ── */}
      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center space-y-3">
          <RefreshCw className="w-6 h-6 text-indigo-500 mx-auto animate-spin" />
          <p className="text-sm text-slate-600">Loading write-back tasks…</p>
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-200 mx-auto flex items-center justify-center">
            <Upload className="w-6 h-6 text-slate-300" />
          </div>
          <p className="text-sm text-slate-600 font-medium">No write-back tasks found.</p>
          <p className="text-xs text-slate-400">
            Approve fixes from the <span className="font-semibold text-slate-600">Quality Fixes</span> tab,
            then approve them via the Task Board and run a write-back to see results here.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="divide-y divide-slate-100">
            {tasks.map((task) => {
              const isRetrying     = retrying.has(task.id);
              const latestRetry    = task.latestAttempt?.retry ?? null;
              const retryClass     = latestRetry?.retryClass as RetryClass | undefined;
              const isRetryable    = latestRetry?.retryable ?? false;
              const retryMeta      = task.status === "failed" ? retryClassMeta(retryClass) : null;
              const isExhausted    = task.status === "failed" && task.attemptCount >= maxAttempts;
              const retryOutcome   = retryOutcomes.get(task.id);

              return (
                <div key={task.id} className={cn(
                  "px-5 py-4",
                  isExhausted
                    ? "bg-orange-50/40"
                    : task.status === "failed" ? "bg-rose-50/20" : "hover:bg-slate-50/50",
                )}>
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Top row: name + status + retry badge */}
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">
                            {task.toolDisplayName}
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                            ID #{task.id}
                            {task.offerId ? ` · Offer: ${task.offerId}` : ""}
                            {" · "}by {task.proposedByName}
                            {" · "}{new Date(task.createdAt).toLocaleString()}
                            {" · "}{task.attemptCount}/{maxAttempts} attempts
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <WritebackStatusBadge status={task.status} />
                          {/* Transient inline outcome badge — visible for ~5 s after bulk retry */}
                          {retryOutcome === "applied" && (
                            <span data-testid="retry-outcome-badge" className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold border border-emerald-300 bg-emerald-50 text-emerald-700 animate-pulse">
                              <CheckCircle2 className="w-3 h-3" />
                              Applied
                            </span>
                          )}
                          {retryOutcome === "failed" && (
                            <span data-testid="retry-outcome-badge" className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold border border-rose-300 bg-rose-50 text-rose-700 animate-pulse">
                              <XCircle className="w-3 h-3" />
                              Failed
                            </span>
                          )}
                          {isExhausted && (
                            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-semibold border border-orange-300 bg-orange-100 text-orange-700">
                              <ShieldAlert className="w-3 h-3" />
                              Retries Exhausted
                            </span>
                          )}
                          {!isExhausted && retryMeta && (
                            <span className={cn(
                              "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-semibold border",
                              retryMeta.color,
                            )}>
                              {retryMeta.icon}
                              {retryMeta.label}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Retry hint */}
                      {task.status === "failed" && latestRetry?.hint && (
                        <div className={cn(
                          "mt-2 rounded-xl border px-3 py-2 text-[11px]",
                          retryClass === "non_retryable"
                            ? "border-rose-200 bg-rose-50 text-rose-800"
                            : "border-amber-200 bg-amber-50 text-amber-900",
                        )}>
                          <span className="font-semibold">Hint: </span>{latestRetry.hint}
                          {latestRetry.retryAfterSec != null && (
                            <span className="ml-2 text-[10px] text-amber-700 font-mono">
                              (retry after {latestRetry.retryAfterSec}s)
                            </span>
                          )}
                        </div>
                      )}

                      {/* Comments / error message */}
                      {task.comments && task.status !== "applied" && (
                        <p className="mt-1.5 text-[11px] text-slate-500 truncate" title={task.comments}>
                          {task.comments}
                        </p>
                      )}
                    </div>

                    {/* Retry button — shown for failed retryable OR any approved task */}
                    {(task.status === "approved" || (task.status === "failed" && isRetryable)) && (
                      <button
                        onClick={() => onRetry(task.id)}
                        disabled={isRetrying}
                        className={cn(
                          "flex-shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all",
                          isRetrying
                            ? "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
                            : "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100",
                        )}
                      >
                        {isRetrying
                          ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          : <TimerReset className="w-3.5 h-3.5" />
                        }
                        {isRetrying ? "Retrying…" : "Retry"}
                      </button>
                    )}

                    {/* Non-retryable indicator */}
                    {task.status === "failed" && !isRetryable && (
                      <span className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-rose-200 bg-rose-50 text-rose-700 cursor-default">
                        <XCircle className="w-3.5 h-3.5" />
                        Fix Required
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
