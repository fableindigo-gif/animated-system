import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { authFetch, authPost, authPatch, authDelete } from "@/lib/auth-fetch";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  MessageSquare,
  Plus,
  Send,
  Trash2,
  Loader2,
  RefreshCw,
  Bot,
  Search,
  X,
  User as UserIcon,
  Pin,
  PinOff,
  Pencil,
  Archive,
  ArchiveRestore,
  Check,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";

const PAGE_SIZE = 20;
type DateRange = "all" | "today" | "week" | "older";

const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: "all",   label: "All time" },
  { value: "today", label: "Today" },
  { value: "week",  label: "This week" },
  { value: "older", label: "Older" },
];

const BASE     = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

type WorkspaceStatus = "healthy" | "needs_reconnect" | "not_connected";

interface WorkspaceHealthResult {
  checkedAt: string;
  platforms: Record<string, { status: WorkspaceStatus; errorCode?: string }>;
}

const WORKSPACE_LABELS: Record<string, string> = {
  google_calendar: "Google Calendar",
  google_drive:    "Google Drive",
  google_docs:     "Google Docs",
};

interface SessionSummary {
  sessionId:  string;
  title:      string;
  createdAt:  string;
  updatedAt:  string;
  eventCount: number;
  pinned:     boolean;
  archived:   boolean;
}

interface SessionMessage {
  role:      "user" | "assistant" | "system";
  text:      string;
  timestamp: number | null;
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const s = Math.floor(ms / 1000);
  if (s < 60)         return "just now";
  if (s < 3600)       return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)      return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7)  return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function AiConversationsPage() {
  const [sessions, setSessions]               = useState<SessionSummary[]>([]);
  const [total, setTotal]                     = useState(0);
  const [hasMore, setHasMore]                 = useState(false);
  const [loadingList, setLoadingList]         = useState(true);
  const [loadingMore, setLoadingMore]         = useState(false);
  const [searchInput, setSearchInput]         = useState("");
  const [searchQuery, setSearchQuery]         = useState("");
  const [dateRange, setDateRange]             = useState<DateRange>("all");
  const [showArchived, setShowArchived]       = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages]               = useState<SessionMessage[]>([]);
  const [loadingHistory, setLoadingHistory]   = useState(false);
  const [input, setInput]                     = useState("");
  const [sending, setSending]                 = useState(false);
  const [error, setError]                     = useState<string | null>(null);
  const [renamingId, setRenamingId]           = useState<string | null>(null);
  const [renameDraft, setRenameDraft]         = useState("");
  const [workspaceHealth, setWorkspaceHealth] = useState<WorkspaceHealthResult | null>(null);
  const bottomRef                             = useRef<HTMLDivElement>(null);
  const renameInputRef                        = useRef<HTMLInputElement>(null);
  const titlePollTimersRef                    = useRef<ReturnType<typeof setTimeout>[]>([]);

  // ── Probe Google Workspace connection health once on mount ────────────────
  // Result is cached in state; no re-probe on subsequent messages.
  useEffect(() => {
    authFetch(`${API_BASE}api/connections/google/health`)
      .then((res) => (res.ok ? (res.json() as Promise<WorkspaceHealthResult>) : Promise.resolve(null)))
      .then((data) => { if (data) setWorkspaceHealth(data); })
      .catch(() => {});
  }, []);

  // ── Cancel pending title-poll timers on unmount ───────────────────────────
  useEffect(() => {
    return () => {
      for (const id of titlePollTimersRef.current) clearTimeout(id);
    };
  }, []);

  // ── Derive which workspace platforms need re-authorization ────────────────
  const staleWorkspacePlatforms = useMemo(() => {
    if (!workspaceHealth) return [];
    return Object.entries(workspaceHealth.platforms)
      .filter(([, health]) => health.status === "needs_reconnect")
      .map(([platform]) => WORKSPACE_LABELS[platform] ?? platform);
  }, [workspaceHealth]);

  // ── Debounce the search box (350 ms) ──────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ── Build the URL for /sessions with current filters ──────────────────────
  const buildSessionsUrl = useCallback((offset: number) => {
    const params = new URLSearchParams();
    if (searchQuery)             params.set("q",         searchQuery);
    if (dateRange !== "all")     params.set("dateRange", dateRange);
    if (showArchived)            params.set("archived",  "1");
    params.set("limit",  String(PAGE_SIZE));
    params.set("offset", String(offset));
    return `${API_BASE}api/ai-agents/sessions?${params.toString()}`;
  }, [searchQuery, dateRange, showArchived]);

  // ── Load (reset) session list whenever filters change ─────────────────────
  const loadSessions = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const res = await authFetch(buildSessionsUrl(0));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        sessions: SessionSummary[];
        total:    number;
        hasMore:  boolean;
      };
      setSessions(data.sessions ?? []);
      setTotal(data.total ?? 0);
      setHasMore(Boolean(data.hasMore));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversations");
    } finally {
      setLoadingList(false);
    }
  }, [buildSessionsUrl]);

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  // ── Load more (append next page) ──────────────────────────────────────────
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await authFetch(buildSessionsUrl(sessions.length));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        sessions: SessionSummary[];
        total:    number;
        hasMore:  boolean;
      };
      setSessions((prev) => [...prev, ...(data.sessions ?? [])]);
      setTotal(data.total ?? 0);
      setHasMore(Boolean(data.hasMore));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }, [buildSessionsUrl, hasMore, loadingMore, sessions.length]);

  const filterActive = useMemo(
    () => Boolean(searchQuery) || dateRange !== "all",
    [searchQuery, dateRange],
  );

  // ── Load history when a session is selected ───────────────────────────────
  const loadHistory = useCallback(async (sessionId: string) => {
    setLoadingHistory(true);
    setMessages([]);
    try {
      const res = await authFetch(`${API_BASE}api/ai-agents/sessions/${encodeURIComponent(sessionId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { session: { messages: SessionMessage[] } };
      setMessages(data.session?.messages ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversation");
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (activeSessionId) void loadHistory(activeSessionId);
    else                 setMessages([]);
  }, [activeSessionId, loadHistory]);

  // ── Auto-scroll on new messages ───────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  // ── Focus the rename input when editing begins ────────────────────────────
  useEffect(() => {
    if (renamingId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingId]);

  // ── Start a new conversation ──────────────────────────────────────────────
  function startNew() {
    setActiveSessionId(null);
    setMessages([]);
    setError(null);
  }

  // ── Send a prompt (creates a new session if none active) ──────────────────
  async function sendPrompt() {
    const prompt = input.trim();
    if (!prompt || sending) return;

    setError(null);
    setInput("");
    setSending(true);
    setMessages((prev) => [...prev, { role: "user", text: prompt, timestamp: Date.now() }]);

    try {
      const res = await authPost(`${API_BASE}api/ai-agents/run`, {
        prompt,
        sessionId: activeSessionId ?? undefined,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { output: string; sessionId: string; isNewSession?: boolean };
      setMessages((prev) => [...prev, { role: "assistant", text: data.output, timestamp: Date.now() }]);

      if (!activeSessionId) {
        setActiveSessionId(data.sessionId);
      }
      void loadSessions();

      // Poll once after ~3 s to pick up the AI-generated title for brand-new sessions.
      // The title is written to the DB in the background after the run returns,
      // so the initial loadSessions() call above usually arrives before it's ready.
      if (data.isNewSession) {
        const newId = data.sessionId;
        const timerId = setTimeout(async () => {
          titlePollTimersRef.current = titlePollTimersRef.current.filter((t) => t !== timerId);
          try {
            const titleRes = await authFetch(
              `${API_BASE}api/ai-agents/sessions/${encodeURIComponent(newId)}`,
            );
            if (!titleRes.ok) return;
            const titleData = (await titleRes.json()) as { session: { title?: string } };
            const smartTitle = titleData.session?.title;
            if (smartTitle) {
              setSessions((prev) =>
                prev.map((s) => (s.sessionId === newId ? { ...s, title: smartTitle } : s)),
              );
            }
          } catch {
            // Silently ignore — the title will appear on the next manual navigation.
          }
        }, 3000);
        titlePollTimersRef.current.push(timerId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Request failed";
      setError(msg);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: `⚠️ ${msg}`, timestamp: Date.now() },
      ]);
    } finally {
      setSending(false);
    }
  }

  // ── Patch a session (title / pinned / archived) ───────────────────────────
  async function patchSession(sessionId: string, body: Record<string, unknown>) {
    try {
      const res = await authPatch(
        `${API_BASE}api/ai-agents/sessions/${encodeURIComponent(sessionId)}`,
        body,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      void loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update conversation");
    }
  }

  // ── Inline rename ─────────────────────────────────────────────────────────
  function beginRename(s: SessionSummary) {
    setRenamingId(s.sessionId);
    setRenameDraft(s.title);
  }
  function cancelRename() {
    setRenamingId(null);
    setRenameDraft("");
  }
  async function commitRename(sessionId: string) {
    const next = renameDraft.trim();
    setRenamingId(null);
    setRenameDraft("");
    // Empty string clears the title (server falls back to derived title)
    await patchSession(sessionId, { title: next.length > 0 ? next : null });
  }

  // ── Pin / unpin ───────────────────────────────────────────────────────────
  async function togglePin(s: SessionSummary) {
    await patchSession(s.sessionId, { pinned: !s.pinned });
  }

  // ── Archive / restore ─────────────────────────────────────────────────────
  async function toggleArchive(s: SessionSummary) {
    if (activeSessionId === s.sessionId && !s.archived) startNew();
    await patchSession(s.sessionId, { archived: !s.archived });
  }

  // ── Delete a past conversation ────────────────────────────────────────────
  async function deleteSession(sessionId: string) {
    if (!confirm("Delete this conversation? This cannot be undone.")) return;
    try {
      const res = await authDelete(`${API_BASE}api/ai-agents/sessions/${encodeURIComponent(sessionId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (activeSessionId === sessionId) startNew();
      void loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete conversation");
    }
  }

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-64px)] bg-slate-50">
        {/* ── Sidebar: session list ──────────────────────────────────────── */}
        <aside className="w-72 shrink-0 border-r border-slate-200 bg-white flex flex-col">
          <div className="p-3 border-b border-slate-200 flex items-center gap-2">
            <Button
              size="sm"
              className="flex-1"
              onClick={startNew}
              data-testid="button-new-conversation"
            >
              <Plus className="w-4 h-4 mr-1" />
              New conversation
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void loadSessions()}
              title="Refresh"
              aria-label="Refresh conversations"
            >
              <RefreshCw className={cn("w-4 h-4", loadingList && "animate-spin")} />
            </Button>
          </div>

          {/* ── Search + date filter ──────────────────────────────────────── */}
          <div className="px-3 pt-3 pb-2 border-b border-slate-200 space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search conversations…"
                className="w-full pl-8 pr-7 py-1.5 text-xs rounded-md border border-slate-200 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                aria-label="Search conversations"
                data-testid="input-search-conversations"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label="Clear search"
                  data-testid="button-clear-search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Date range filter">
              {DATE_RANGE_OPTIONS.map((opt) => {
                const active = dateRange === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDateRange(opt.value)}
                    aria-pressed={active}
                    className={cn(
                      "text-[11px] px-2 py-0.5 rounded-full border transition",
                      active
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50",
                    )}
                    data-testid={`button-filter-${opt.value}`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
              <span>{showArchived ? "Showing all (incl. archived)" : "Active conversations"}</span>
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                className="text-blue-600 hover:underline"
                data-testid="button-toggle-archived"
              >
                {showArchived ? "Hide archived" : "Show archived"}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto" data-testid="list-conversations">
            {loadingList ? (
              <div className="p-6 text-center text-sm text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin inline-block mr-1" />
                Loading…
              </div>
            ) : sessions.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500" data-testid="text-empty-conversations">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                {filterActive ? (
                  <>
                    No conversations match your filters.<br />
                    <button
                      type="button"
                      onClick={() => { setSearchInput(""); setDateRange("all"); }}
                      className="text-blue-600 hover:underline mt-2 inline-block"
                      data-testid="button-clear-filters"
                    >
                      Clear filters
                    </button>
                  </>
                ) : (
                  <>
                    No past conversations yet.<br />
                    Start one on the right.
                  </>
                )}
              </div>
            ) : (
              <ul className="py-1">
                {sessions.map((s) => {
                  const isActive   = s.sessionId === activeSessionId;
                  const isRenaming = renamingId === s.sessionId;
                  return (
                    <li key={s.sessionId}>
                      <div
                        className={cn(
                          "group w-full px-3 py-2.5 flex items-start gap-2 hover:bg-slate-50 transition cursor-pointer",
                          isActive && "bg-blue-50 hover:bg-blue-50",
                          s.archived && "opacity-60",
                        )}
                        onClick={() => { if (!isRenaming) setActiveSessionId(s.sessionId); }}
                        data-testid={`item-conversation-${s.sessionId}`}
                      >
                        {s.pinned ? (
                          <Pin className={cn(
                            "w-4 h-4 mt-0.5 shrink-0 fill-current",
                            isActive ? "text-blue-600" : "text-amber-500",
                          )} />
                        ) : (
                          <MessageSquare className={cn(
                            "w-4 h-4 mt-0.5 shrink-0",
                            isActive ? "text-blue-600" : "text-slate-400",
                          )} />
                        )}
                        <div className="flex-1 min-w-0">
                          {isRenaming ? (
                            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <input
                                ref={renameInputRef}
                                value={renameDraft}
                                onChange={(e) => setRenameDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter")  { e.preventDefault(); void commitRename(s.sessionId); }
                                  if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
                                }}
                                className="flex-1 min-w-0 text-sm rounded border border-blue-300 px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-200"
                                data-testid={`input-rename-${s.sessionId}`}
                                maxLength={200}
                              />
                              <button
                                type="button"
                                onClick={() => void commitRename(s.sessionId)}
                                className="text-emerald-600 hover:text-emerald-700"
                                aria-label="Save name"
                                data-testid={`button-rename-save-${s.sessionId}`}
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={cancelRename}
                                className="text-slate-400 hover:text-slate-600"
                                aria-label="Cancel rename"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <>
                              <p
                                className={cn(
                                  "text-sm truncate",
                                  isActive ? "text-blue-900 font-medium" : "text-slate-700",
                                )}
                                onDoubleClick={(e) => { e.stopPropagation(); beginRename(s); }}
                                title="Double-click to rename"
                              >
                                {s.title}
                              </p>
                              <p className="text-[11px] text-slate-400 mt-0.5">
                                {formatRelative(s.updatedAt)} · {s.eventCount} {s.eventCount === 1 ? "event" : "events"}
                                {s.archived && <span className="ml-1 text-slate-500">· archived</span>}
                              </p>
                            </>
                          )}
                        </div>

                        {!isRenaming && (
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); void togglePin(s); }}
                              className={cn(
                                "p-0.5 transition",
                                s.pinned ? "text-amber-500 hover:text-amber-600" : "text-slate-400 hover:text-amber-500",
                              )}
                              aria-label={s.pinned ? "Unpin conversation" : "Pin conversation"}
                              title={s.pinned ? "Unpin" : "Pin to top"}
                              data-testid={`button-pin-${s.sessionId}`}
                            >
                              {s.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); beginRename(s); }}
                              className="p-0.5 text-slate-400 hover:text-blue-600 transition"
                              aria-label="Rename conversation"
                              title="Rename"
                              data-testid={`button-rename-${s.sessionId}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); void toggleArchive(s); }}
                              className="p-0.5 text-slate-400 hover:text-slate-700 transition"
                              aria-label={s.archived ? "Restore conversation" : "Archive conversation"}
                              title={s.archived ? "Restore" : "Archive"}
                              data-testid={`button-archive-${s.sessionId}`}
                            >
                              {s.archived
                                ? <ArchiveRestore className="w-3.5 h-3.5" />
                                : <Archive className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); void deleteSession(s.sessionId); }}
                              className="p-0.5 text-slate-400 hover:text-rose-600 transition"
                              aria-label="Delete conversation"
                              title="Delete"
                              data-testid={`button-delete-${s.sessionId}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {!loadingList && sessions.length > 0 && (
              <div className="px-3 py-3 border-t border-slate-100 text-center space-y-2">
                <p className="text-[11px] text-slate-400" data-testid="text-conversations-count">
                  Showing {sessions.length} of {total}
                </p>
                {hasMore && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                    className="w-full"
                    data-testid="button-load-more"
                  >
                    {loadingMore ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />Loading…</>
                    ) : (
                      "Load more"
                    )}
                  </Button>
                )}
              </div>
            )}
          </div>
        </aside>

        {/* ── Main: messages + input ──────────────────────────────────────── */}
        <section className="flex-1 flex flex-col min-w-0">
          <header className="px-6 py-4 border-b border-slate-200 bg-white">
            <h1 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Bot className="w-5 h-5 text-blue-600" />
              AI Conversations
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {activeSessionId
                ? "Resuming a past conversation — your history is preserved."
                : "Pick a past conversation or start a new one."}
            </p>
          </header>

          {staleWorkspacePlatforms.length > 0 && (
            <div
              className="mx-6 mt-4 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3"
              data-testid="banner-workspace-stale"
            >
              <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-800">
                  Google Workspace connection needs re-authorization
                </p>
                <p className="text-xs text-amber-700 mt-0.5">
                  {staleWorkspacePlatforms.join(", ")} {staleWorkspacePlatforms.length === 1 ? "has" : "have"} a revoked or
                  expired token. AI requests that use {staleWorkspacePlatforms.length === 1 ? "this service" : "these services"} will
                  fail until you re-authorize.
                </p>
              </div>
              <a
                href={`${API_BASE}api/auth/google/start?platform=workspace`}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium px-3 py-1.5 transition-colors"
                data-testid="link-reauthorize-workspace"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Re-authorize Google Workspace
              </a>
            </div>
          )}

          <div
            className="flex-1 overflow-y-auto px-6 py-6 space-y-4"
            data-testid="region-messages"
          >
            {loadingHistory ? (
              <div className="text-center text-sm text-slate-500 py-12">
                <Loader2 className="w-5 h-5 animate-spin inline-block mr-1" />
                Loading conversation…
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center text-slate-400 py-16">
                <Bot className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                <p className="text-sm">Ask the OmniAnalytix agent anything to begin.</p>
              </div>
            ) : (
              messages.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex gap-3 max-w-3xl",
                    m.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto",
                  )}
                  data-testid={`message-${m.role}-${i}`}
                >
                  <div
                    className={cn(
                      "shrink-0 w-7 h-7 rounded-full flex items-center justify-center",
                      m.role === "user" ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-700",
                    )}
                  >
                    {m.role === "user"
                      ? <UserIcon className="w-3.5 h-3.5" />
                      : <Bot className="w-3.5 h-3.5" />}
                  </div>
                  <div
                    className={cn(
                      "rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed shadow-sm",
                      m.role === "user"
                        ? "bg-blue-600 text-white rounded-tr-sm"
                        : "bg-white border border-slate-200 text-slate-800 rounded-tl-sm",
                    )}
                  >
                    {m.text}
                  </div>
                </div>
              ))
            )}
            {sending && (
              <div className="flex gap-3 max-w-3xl mr-auto">
                <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center bg-slate-200 text-slate-700">
                  <Bot className="w-3.5 h-3.5" />
                </div>
                <div className="rounded-2xl px-4 py-2.5 text-sm bg-white border border-slate-200 text-slate-500 italic shadow-sm">
                  Thinking…
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {error && (
            <div className="px-6 py-2 text-xs text-rose-600 bg-rose-50 border-t border-rose-100" data-testid="text-error">
              {error}
            </div>
          )}

          <div className="border-t border-slate-200 bg-white p-4">
            <div className="flex items-end gap-2 max-w-3xl mx-auto">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendPrompt();
                  }
                }}
                placeholder="Ask the AI agent…"
                disabled={sending}
                rows={1}
                className="flex-1 resize-none rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 max-h-32"
                data-testid="input-prompt"
              />
              <Button
                onClick={() => void sendPrompt()}
                disabled={!input.trim() || sending}
                data-testid="button-send-prompt"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
