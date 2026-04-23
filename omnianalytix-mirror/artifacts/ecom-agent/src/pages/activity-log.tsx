import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-fetch";
import { queryKeys } from "@/lib/query-keys";
import { QueryErrorState } from "@/components/query-error-state";
import { AppShell } from "@/components/layout/app-shell";
import { cn } from "@/lib/utils";
import {
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  AlertCircle,
} from "lucide-react";

const BASE     = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

interface AuditLogEntry {
  id:               number;
  organizationId:   number | null;
  conversationId:   number | null;
  snapshotId:       number | null;
  platform:         string;
  platformLabel:    string;
  toolName:         string;
  toolDisplayName:  string;
  toolArgs:         Record<string, unknown>;
  displayDiff:      Array<{ label: string; from: string; to: string }> | null;
  result:           { success: boolean; message: string } | null;
  status:           string;
  createdAt:        string;
  insightId:        string | null;
}

interface PaginatedAuditLog {
  data:       AuditLogEntry[];
  page:       number;
  pageSize:   number;
  total:      number;
  totalPages: number;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function StatusIcon({ status }: { status: string }) {
  if (status === "applied" || status === "approved" || status === "success") {
    return <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />;
  }
  if (status === "rejected" || status === "failed" || status === "error") {
    return <XCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />;
  }
  return <Clock className="w-4 h-4 text-slate-400 flex-shrink-0" />;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    applied:  "bg-emerald-50 text-emerald-700 border-emerald-200",
    approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
    success:  "bg-emerald-50 text-emerald-700 border-emerald-200",
    rejected: "bg-rose-50 text-rose-700 border-rose-200",
    failed:   "bg-rose-50 text-rose-700 border-rose-200",
    error:    "bg-rose-50 text-rose-700 border-rose-200",
    pending:  "bg-amber-50 text-amber-700 border-amber-200",
  };
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border",
      map[status] ?? "bg-slate-100 text-slate-600 border-slate-200",
    )}>
      {status}
    </span>
  );
}

function DiffPill({ from, to, label }: { from: string; to: string; label: string }) {
  return (
    <div className="text-[11px] text-slate-600 flex items-start gap-1.5 py-0.5">
      <span className="font-medium text-slate-500 w-24 flex-shrink-0 truncate">{label}</span>
      <span className="line-through text-slate-400 max-w-[120px] truncate" title={from}>{from}</span>
      <span className="text-slate-400">→</span>
      <span className="font-medium text-emerald-700 max-w-[120px] truncate" title={to}>{to}</span>
    </div>
  );
}

export default function ActivityLogPage() {
  const [location] = useLocation();
  const params     = new URLSearchParams(window.location.search);
  const highlightId = params.get("highlight") ? Number(params.get("highlight")) : null;

  const [page, setPage]           = useState(1);

  const highlightRef = useRef<HTMLLIElement | null>(null);
  const PAGE_SIZE    = 25;

  const entriesQuery = useQuery({
    queryKey: queryKeys.auditLog(page, PAGE_SIZE),
    queryFn: async () => {
      const res = await authFetch(`${API_BASE}api/actions/audit?page=${page}&pageSize=${PAGE_SIZE}`);
      if (!res.ok) throw new Error("Failed to load activity log");
      return (await res.json()) as PaginatedAuditLog;
    },
  });
  const entries     = entriesQuery.data?.data ?? [];
  const totalPages  = entriesQuery.data?.totalPages ?? 1;
  const total       = entriesQuery.data?.total ?? 0;
  const loading     = entriesQuery.isLoading;
  const error       = entriesQuery.isError ? "Failed to load activity log" : null;
  const fetchEntries = (p: number) => { setPage(p); };

  // Focused entry lookup — only fires when there's a `?highlight=` query.
  const focusedEntryQuery = useQuery({
    queryKey: queryKeys.auditLogEntry(highlightId ?? 0),
    enabled: highlightId != null,
    queryFn: async () => {
      const res = await authFetch(`${API_BASE}api/actions/audit/${highlightId}`);
      if (res.status === 404) return { __notFound: true } as const;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as AuditLogEntry;
    },
  });
  const focusLoading  = focusedEntryQuery.isLoading;
  const focusNotFound = !!(focusedEntryQuery.data && (focusedEntryQuery.data as { __notFound?: boolean }).__notFound);
  const focusedEntry  = focusNotFound ? null : (focusedEntryQuery.data as AuditLogEntry | undefined) ?? null;

  useEffect(() => {
    if (!highlightRef.current) return;
    const timer = setTimeout(() => {
      highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
    return () => clearTimeout(timer);
  }, [entries, highlightId]);

  const isOnCurrentPage = entries.some((e) => e.id === highlightId);

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center">
              <Activity className="w-4.5 h-4.5 text-violet-600" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">Activity Log</h1>
              <p className="text-[12px] text-slate-500">
                {total > 0 ? `${total} entries` : "Full audit trail of AI actions"}
              </p>
            </div>
          </div>
          {highlightId && (
            <a
              href={`${BASE}feed-enrichment`}
              className="inline-flex items-center gap-1.5 text-[12px] text-violet-600 hover:underline"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Back to Quality Fixes
            </a>
          )}
        </div>

        {/* ── Focused entry banner (when coming from a deep link) ─────────── */}
        {highlightId && (
          <div className="mb-6">
            {focusLoading && (
              <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-[12px] text-violet-700 flex items-center gap-2">
                <div className="w-3.5 h-3.5 rounded-full border-2 border-violet-300 border-t-violet-600 animate-spin" />
                Loading audit entry #{highlightId}…
              </div>
            )}
            {focusNotFound && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                Audit entry #{highlightId} was not found or belongs to a different workspace.
              </div>
            )}
            {focusedEntry && !isOnCurrentPage && (
              <div className={cn(
                "rounded-xl border px-4 py-3 mb-2",
                "border-violet-300 bg-violet-50 ring-2 ring-violet-300/50",
              )}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-500 mb-2">
                  Linked audit entry #{focusedEntry.id}
                </p>
                <AuditEntryCard entry={focusedEntry} highlighted />
              </div>
            )}
          </div>
        )}

        {/* ── List ───────────────────────────────────────────────────────── */}
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] text-rose-700 mb-4">
            {error}
          </div>
        )}

        {loading ? (
          <ul className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="h-20 rounded-xl bg-slate-100 animate-pulse" />
            ))}
          </ul>
        ) : entries.length === 0 ? (
          <div className="text-center py-16 text-slate-400 text-sm">
            No activity recorded yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => {
              const isHighlighted = entry.id === highlightId;
              return (
                <li
                  key={entry.id}
                  id={`audit-entry-${entry.id}`}
                  ref={isHighlighted ? highlightRef : null}
                  className={cn(
                    "rounded-xl border transition-all duration-300",
                    isHighlighted
                      ? "border-violet-400 bg-violet-50 ring-2 ring-violet-300/50 shadow-sm"
                      : "border-slate-200 bg-white hover:bg-slate-50",
                  )}
                >
                  <AuditEntryCard entry={entry} highlighted={isHighlighted} />
                </li>
              );
            })}
          </ul>
        )}

        {/* ── Pagination ─────────────────────────────────────────────────── */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between mt-6">
            <button
              disabled={page <= 1}
              onClick={() => { void fetchEntries(page - 1); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Previous
            </button>
            <span className="text-[12px] text-slate-500">
              Page {page} of {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => { void fetchEntries(page + 1); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function AuditEntryCard({ entry, highlighted }: { entry: AuditLogEntry; highlighted?: boolean }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <StatusIcon status={entry.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-slate-800 truncate">
              {entry.toolDisplayName}
            </span>
            <StatusBadge status={entry.status} />
            <span className="text-[10px] text-slate-400 font-mono bg-slate-100 px-1.5 py-0.5 rounded">
              #{entry.id}
            </span>
            {highlighted && (
              <span className="text-[10px] font-semibold text-violet-600 bg-violet-100 px-1.5 py-0.5 rounded-full">
                linked
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[11px] text-slate-500">{entry.platformLabel}</span>
            <span className="text-slate-300">·</span>
            <span className="text-[11px] text-slate-400">{formatDate(entry.createdAt)}</span>
            {entry.insightId && (
              <>
                <span className="text-slate-300">·</span>
                <span className="text-[10px] font-mono text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                  {entry.insightId}
                </span>
              </>
            )}
          </div>

          {entry.result?.message && (
            <p className="text-[11px] text-slate-600 mt-1.5 leading-relaxed">
              {entry.result.message}
            </p>
          )}

          {entry.displayDiff && entry.displayDiff.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {entry.displayDiff.map((d, i) => (
                <DiffPill key={i} label={d.label} from={d.from} to={d.to} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
