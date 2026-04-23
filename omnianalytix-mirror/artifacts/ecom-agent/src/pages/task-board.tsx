import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useUserRole, ROLE_LABELS, type Role } from "@/contexts/user-role-context";
import { useHasPermission } from "@/hooks/use-has-permission";
import { authFetch, authPatch } from "@/lib/auth-fetch";
import { queryKeys } from "@/lib/query-keys";
import { QueryErrorState } from "@/components/query-error-state";
import { useToast } from "@/hooks/use-toast";
import { SiGoogleads, SiMeta, SiShopify, SiGoogle } from "react-icons/si";
import {
  Search, ArrowRightLeft, BookOpen, ChevronDown, ChevronUp, User,
  RefreshCw, AlertTriangle, CheckCircle2, Clock, Circle,
  ChevronUp as SortUp, ChevronDown as SortDown, ChevronsUpDown,
  MessageSquare, Timer, Plus, X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { TransferTaskModal } from "@/components/enterprise/transfer-task-modal";
import { CreateTaskModal } from "@/components/enterprise/create-task-modal";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Shared helpers ────────────────────────────────────────────────────────────

function getTimeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000)     return "Just now";
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function getInitials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function Skel({ w = "w-20", h = "h-5" }: { w?: string; h?: string }) {
  return <span className={cn("inline-block rounded-lg animate-pulse bg-slate-200", w, h)} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — COMMAND CENTER (agency_ops_tasks)
// ─────────────────────────────────────────────────────────────────────────────

type OpsStatus   = "not_started" | "in_progress" | "completed";
type OpsPriority = "high" | "medium" | "low";
type SortKey     = "title" | "priority" | "dueDate" | "status" | "assignedToName" | "messagesExchanged" | "avgResponseTimeHours";

interface OpsTask {
  id: number;
  organizationId: number;
  title: string;
  description: string;
  priority: OpsPriority;
  dueDate: string | null;
  status: OpsStatus;
  assignedTo: number | null;
  assignedToName: string;
  messagesExchanged: number;
  avgResponseTimeHours: number;
  createdBy: number | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

interface OpsTotals {
  not_started: number;
  in_progress: number;
  completed: number;
  total: number;
  avgMessagesPerTask: number;
  avgResponseTimeHours: number;
  totalMessages: number;
}

interface OpsResponse {
  tasks: OpsTask[];
  totals: OpsTotals;
  organizationId: number;
  syncedAt: number;
}

const STATUS_CFG: Record<OpsStatus, { label: string; icon: React.ElementType; bar: string; badge: string; dot: string }> = {
  not_started: { label: "Not Started", icon: Circle,       bar: "bg-slate-300",   badge: "bg-slate-100 text-slate-500 border-slate-200",       dot: "bg-slate-400"   },
  in_progress: { label: "In Progress", icon: Clock,        bar: "bg-omni-primary", badge: "bg-blue-50 text-omni-primary border-blue-200",        dot: "bg-omni-primary" },
  completed:   { label: "Completed",   icon: CheckCircle2, bar: "bg-emerald-500",  badge: "bg-emerald-50 text-emerald-700 border-emerald-200",   dot: "bg-emerald-500" },
};

const PRIORITY_CFG: Record<OpsPriority, { badge: string; dot: string }> = {
  high:   { badge: "bg-red-50 text-red-600 border-red-200",     dot: "bg-red-500"    },
  medium: { badge: "bg-amber-50 text-amber-600 border-amber-200", dot: "bg-amber-400" },
  low:    { badge: "bg-slate-50 text-slate-500 border-slate-200", dot: "bg-slate-300" },
};

function StatusBadge({ status }: { status: OpsStatus }) {
  const c = STATUS_CFG[status];
  return (
    <span className={cn("inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border", c.badge)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", c.dot)} />
      {c.label}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: OpsPriority }) {
  const c = PRIORITY_CFG[priority];
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border", c.badge)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", c.dot)} />
      {priority}
    </span>
  );
}

function SortIcon({ col, active, dir }: { col: SortKey; active: SortKey; dir: "asc" | "desc" }) {
  if (col !== active) return <ChevronsUpDown className="w-3 h-3 text-slate-300" />;
  return dir === "asc"
    ? <SortUp className="w-3 h-3 text-omni-primary" />
    : <SortDown className="w-3 h-3 text-omni-primary" />;
}

function CommandCenter() {
  const { toast } = useToast();
  const [data, setData]         = useState<OpsResponse | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(false);
  const [search, setSearch]     = useState("");
  const [statusFilter, setStatusFilter]     = useState<OpsStatus | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<OpsPriority | "all">("all");
  const [sortKey, setSortKey]   = useState<SortKey>("priority");
  const [sortDir, setSortDir]   = useState<"asc" | "desc">("asc");
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState<OpsPriority>("medium");
  const [newStatus, setNewStatus]     = useState<OpsStatus>("not_started");
  const [newAssignee, setNewAssignee] = useState("");
  const [newDesc, setNewDesc]         = useState("");
  const [submitting, setSubmitting]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const res = await authFetch(`${BASE}/api/tasks/ops`);
      if (!res.ok) { setError(true); return; }
      setData((await res.json()) as OpsResponse);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  }

  const PRIORITY_ORDER: Record<OpsPriority, number> = { high: 0, medium: 1, low: 2 };
  const STATUS_ORDER:   Record<OpsStatus, number>   = { not_started: 0, in_progress: 1, completed: 2 };

  const rows = useMemo(() => {
    let list = data?.tasks ?? [];
    if (statusFilter !== "all")   list = list.filter((r) => r.status === statusFilter);
    if (priorityFilter !== "all") list = list.filter((r) => r.priority === priorityFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) => r.title.toLowerCase().includes(q)
          || r.description.toLowerCase().includes(q)
          || r.assignedToName.toLowerCase().includes(q),
      );
    }
    return list.slice().sort((a, b) => {
      let diff = 0;
      if (sortKey === "priority")          diff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      else if (sortKey === "status")       diff = STATUS_ORDER[a.status]   - STATUS_ORDER[b.status];
      else if (sortKey === "dueDate")      diff = (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
      else if (sortKey === "title")        diff = a.title.localeCompare(b.title);
      else if (sortKey === "assignedToName") diff = a.assignedToName.localeCompare(b.assignedToName);
      else diff = (a[sortKey] as number) - (b[sortKey] as number);
      return sortDir === "asc" ? diff : -diff;
    });
  }, [data, statusFilter, priorityFilter, search, sortKey, sortDir]);

  async function cycleStatus(task: OpsTask) {
    const next: Record<OpsStatus, OpsStatus> = {
      not_started: "in_progress",
      in_progress: "completed",
      completed:   "not_started",
    };
    const newStatus = next[task.status];
    setUpdatingId(task.id);
    try {
      const res = await authPatch(`${BASE}/api/tasks/ops/${task.id}`, { status: newStatus });
      if (res.ok) {
        const updated = (await res.json()) as OpsTask;
        setData((prev) => prev
          ? { ...prev, tasks: prev.tasks.map((t) => (t.id === task.id ? updated : t)) }
          : prev,
        );
      } else {
        toast({ title: "Error", description: "Could not update status.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Network error.", variant: "destructive" });
    } finally { setUpdatingId(null); }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setSubmitting(true);
    try {
      const res = await authFetch(`${BASE}/api/tasks/ops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(), description: newDesc.trim(),
          priority: newPriority, status: newStatus,
          assignedToName: newAssignee.trim(),
        }),
      });
      if (res.ok) {
        toast({ title: "Task Created", description: `"${newTitle.trim()}" added to the board.` });
        setNewTitle(""); setNewDesc(""); setNewAssignee("");
        setNewPriority("medium"); setNewStatus("not_started");
        setShowNewForm(false);
        void load();
      } else {
        toast({ title: "Error", description: "Could not create task.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Network error.", variant: "destructive" });
    } finally { setSubmitting(false); }
  }

  const totals = data?.totals;

  const TH = ({ label, col }: { label: string; col: SortKey }) => (
    <th
      className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400 cursor-pointer hover:text-slate-600 select-none whitespace-nowrap"
      onClick={() => toggleSort(col)}
    >
      <div className="flex items-center gap-1">
        {label}
        <SortIcon col={col} active={sortKey} dir={sortDir} />
      </div>
    </th>
  );

  return (
    <div className="flex flex-col gap-6">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Command Center</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Agency-wide operational tasks ·{" "}
            {totals ? `${totals.total} total · ${totals.completed} completed` : "Loading…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-omni-primary transition-colors rounded-xl px-3 py-1.5 hover:bg-blue-50 active:scale-95 disabled:opacity-40"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            Refresh
          </button>
          <NewTaskButton showNewForm={showNewForm} onToggle={() => setShowNewForm((v) => !v)} />
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && !loading && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          Failed to load tasks. Check your connection and try refreshing.
        </div>
      )}

      {/* ── Status KPI cards ── */}
      <div className="grid grid-cols-3 gap-4">
        {(["not_started", "in_progress", "completed"] as const).map((s) => {
          const c = STATUS_CFG[s];
          const Icon = c.icon;
          const count = totals?.[s] ?? 0;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter((prev) => prev === s ? "all" : s)}
              className={cn(
                "rounded-2xl border p-5 text-left flex flex-col gap-2 shadow-sm transition-all hover:shadow-md active:scale-[0.98]",
                statusFilter === s
                  ? "border-omni-primary ring-2 ring-omni-primary/20 bg-blue-50"
                  : "border-slate-200 bg-white",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{c.label}</span>
                <Icon className={cn("w-4 h-4", s === "completed" ? "text-emerald-500" : s === "in_progress" ? "text-omni-primary" : "text-slate-400")} />
              </div>
              {loading ? <Skel w="w-12" h="h-8" /> : (
                <span className="text-3xl font-bold tabular-nums text-slate-900">{count}</span>
              )}
              {!loading && totals && (
                <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden mt-1">
                  <div
                    className={cn("h-full rounded-full", c.bar)}
                    style={{ width: totals.total ? `${(count / totals.total) * 100}%` : "0%" }}
                  />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Teamwork Health widget ── */}
      {!loading && totals && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4">Teamwork Health</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
            <div className="flex items-start gap-3">
              <span className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                <MessageSquare className="w-4 h-4 text-violet-600" />
              </span>
              <div>
                <p className="text-xl font-bold tabular-nums text-slate-900">{totals.avgMessagesPerTask.toFixed(1)}</p>
                <p className="text-[11px] text-slate-400 leading-tight mt-0.5">Avg messages<br/>per task</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                <Timer className="w-4 h-4 text-amber-600" />
              </span>
              <div>
                <p className="text-xl font-bold tabular-nums text-slate-900">{totals.avgResponseTimeHours.toFixed(1)}h</p>
                <p className="text-[11px] text-slate-400 leading-tight mt-0.5">Avg response<br/>time</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              </span>
              <div>
                <p className="text-xl font-bold tabular-nums text-slate-900">
                  {totals.total ? Math.round((totals.completed / totals.total) * 100) : 0}%
                </p>
                <p className="text-[11px] text-slate-400 leading-tight mt-0.5">Completion<br/>rate</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
                <MessageSquare className="w-4 h-4 text-omni-primary" />
              </span>
              <div>
                <p className="text-xl font-bold tabular-nums text-slate-900">{totals.totalMessages}</p>
                <p className="text-[11px] text-slate-400 leading-tight mt-0.5">Total<br/>messages</p>
              </div>
            </div>
          </div>
          {/* Operational drag indicator */}
          {totals.avgResponseTimeHours > 4 && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              High average response time ({totals.avgResponseTimeHours.toFixed(1)}h) detected — consider unblocking in-progress tasks.
            </div>
          )}
        </div>
      )}

      {/* ── New task inline form ── */}
      <AnimatePresence>
        {showNewForm && (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            onSubmit={handleCreate}
            className="overflow-hidden"
          >
            <div className="rounded-2xl border border-omni-primary/30 bg-blue-50/40 p-5 flex flex-col gap-4">
              <p className="text-sm font-semibold text-slate-700">New Operational Task</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label htmlFor="ops-task-title" className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1 block">Title *</label>
                  <input
                    id="ops-task-title"
                    required
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="e.g. Q3 Campaign Launch — Acme Corp"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-omni-primary/30"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="ops-task-description" className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1 block">Description</label>
                  <textarea
                    id="ops-task-description"
                    rows={2}
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="Brief description of the deliverable…"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-omni-primary/30 resize-none"
                  />
                </div>
                <div>
                  <label htmlFor="ops-task-priority" className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1 block">Priority</label>
                  <select
                    id="ops-task-priority"
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as OpsPriority)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-omni-primary/30"
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="ops-task-status" className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1 block">Status</label>
                  <select
                    id="ops-task-status"
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value as OpsStatus)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-omni-primary/30"
                  >
                    <option value="not_started">Not Started</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="ops-task-assignee" className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1 block">Assigned To</label>
                  <input
                    id="ops-task-assignee"
                    value={newAssignee}
                    onChange={(e) => setNewAssignee(e.target.value)}
                    placeholder="Team member name"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-omni-primary/30"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={submitting || !newTitle.trim()}
                  className="flex items-center gap-2 bg-omni-primary text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
                >
                  {submitting
                    ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    : <Plus className="w-3.5 h-3.5" />}
                  Create Task
                </button>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks, assignees…"
            className="w-full rounded-xl border border-slate-200 bg-white pl-8 pr-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-omni-primary/30"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Priority chips */}
        <div className="flex flex-wrap gap-1.5">
          {(["all", "high", "medium", "low"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPriorityFilter(p)}
              className={cn(
                "px-2.5 py-1 rounded-full text-[11px] font-semibold border capitalize transition-colors",
                priorityFilter === p
                  ? "bg-omni-primary text-white border-omni-primary"
                  : "bg-white text-slate-500 border-slate-200 hover:border-slate-300",
              )}
            >
              {p === "all" ? "All Priority" : p}
            </button>
          ))}
        </div>
      </div>

      {/* ── Task table ── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <TH label="Task"              col="title"               />
                <TH label="Priority"          col="priority"            />
                <TH label="Status"            col="status"              />
                <TH label="Assigned To"       col="assignedToName"      />
                <TH label="Due"               col="dueDate"             />
                <TH label="Messages"          col="messagesExchanged"   />
                <TH label="Avg Response (h)"  col="avgResponseTimeHours"/>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="px-4 py-3"><Skel w="w-48" /></td>
                      <td className="px-4 py-3"><Skel w="w-14" /></td>
                      <td className="px-4 py-3"><Skel w="w-20" /></td>
                      <td className="px-4 py-3"><Skel w="w-28" /></td>
                      <td className="px-4 py-3"><Skel w="w-16" /></td>
                      <td className="px-4 py-3"><Skel w="w-8" /></td>
                      <td className="px-4 py-3"><Skel w="w-12" /></td>
                    </tr>
                  ))
                : rows.length === 0
                  ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-slate-400 text-sm">
                        No tasks match the current filters.
                      </td>
                    </tr>
                  )
                  : rows.map((task) => (
                      <tr
                        key={task.id}
                        className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors group"
                      >
                        {/* Title + description */}
                        <td className="px-4 py-3 max-w-[260px]">
                          <p className="font-semibold text-slate-800 truncate">{task.title}</p>
                          {task.description && (
                            <p className="text-[11px] text-slate-400 truncate mt-0.5">{task.description}</p>
                          )}
                        </td>

                        {/* Priority */}
                        <td className="px-4 py-3">
                          <PriorityBadge priority={task.priority} />
                        </td>

                        {/* Status — click to cycle */}
                        <td className="px-4 py-3">
                          <button
                            onClick={() => void cycleStatus(task)}
                            disabled={updatingId === task.id}
                            title="Click to advance status"
                            className="transition-opacity disabled:opacity-50"
                          >
                            <StatusBadge status={task.status} />
                          </button>
                        </td>

                        {/* Assigned to */}
                        <td className="px-4 py-3">
                          {task.assignedToName ? (
                            <div className="flex items-center gap-2">
                              <span className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-[9px] font-bold text-omni-primary shrink-0">
                                {getInitials(task.assignedToName)}
                              </span>
                              <span className="text-xs text-slate-700 truncate max-w-[100px]">{task.assignedToName}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>

                        {/* Due date */}
                        <td className="px-4 py-3">
                          {task.dueDate ? (
                            <span className={cn(
                              "text-xs font-medium",
                              new Date(task.dueDate) < new Date() && task.status !== "completed"
                                ? "text-red-500"
                                : "text-slate-500",
                            )}>
                              {new Date(task.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>

                        {/* Messages exchanged */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <MessageSquare className="w-3 h-3 text-slate-300" />
                            <span className="text-xs tabular-nums font-semibold text-slate-600">{task.messagesExchanged}</span>
                          </div>
                        </td>

                        {/* Avg response time */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <Timer className="w-3 h-3 text-slate-300" />
                            <span className={cn(
                              "text-xs tabular-nums font-semibold",
                              task.avgResponseTimeHours > 4 ? "text-amber-600" : "text-slate-600",
                            )}>
                              {task.avgResponseTimeHours.toFixed(1)}h
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))
              }
            </tbody>
          </table>
        </div>

        {/* Table footer */}
        {!loading && rows.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
            <p className="text-xs text-slate-400">{rows.length} task{rows.length !== 1 ? "s" : ""} shown</p>
            {(statusFilter !== "all" || priorityFilter !== "all" || search) && (
              <button
                onClick={() => { setStatusFilter("all"); setPriorityFilter("all"); setSearch(""); }}
                className="text-xs text-omni-primary hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — AI PROPOSALS (existing proposed_tasks queue — preserved exactly)
// ─────────────────────────────────────────────────────────────────────────────

interface ProposedTask {
  id: number;
  workspaceId: number | null;
  proposedBy: number | null;
  proposedByName: string;
  proposedByRole: string;
  platform: string;
  platformLabel: string;
  toolName: string;
  toolDisplayName: string;
  toolArgs: Record<string, unknown>;
  displayDiff: Array<{ label: string; from: string; to: string }> | null;
  reasoning: string;
  snapshotId: number | null;
  comments: string;
  status: string;
  assignedTo: number | null;
  assignedToName: string | null;
  resolvedBy: number | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

interface ActivityEntry {
  id: number;
  taskId: number;
  actorName: string;
  actorRole: string;
  action: string;
  note: string;
  targetMemberName: string | null;
  createdAt: string;
}

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  google_ads: <SiGoogleads className="w-4 h-4 text-[#4285F4]" />,
  meta:       <SiMeta className="w-4 h-4 text-[#0081FB]" />,
  shopify:    <SiShopify className="w-4 h-4 text-[#96bf48]" />,
  gmc:        <SiGoogle className="w-4 h-4 text-[#EA4335]" />,
  gsc:        <Search className="w-3.5 h-3.5 text-[#4285F4]" />,
};

const PLATFORM_ACCENT: Record<string, string> = {
  google_ads: "border-l-[#4285F4]",
  meta:       "border-l-[#0081FB]",
  shopify:    "border-l-[#96bf48]",
  gmc:        "border-l-[#EA4335]",
  gsc:        "border-l-[#4285F4]",
};

const ROLE_BADGE_COLORS: Record<string, string> = {
  admin:   "bg-primary-container/10 text-primary-container",
  manager: "bg-amber-50 text-amber-700",
  it:      "bg-purple-50 text-purple-700",
  analyst: "bg-emerald-50 text-emerald-700",
  viewer:  "bg-surface-container-low text-on-surface-variant",
};

type TabFilter = "pending" | "approved" | "rejected" | "all";

function AIProposals() {
  const { currentUser } = useUserRole();
  const { toast } = useToast();
  const queryClient                       = useQueryClient();
  const [activeTab, setActiveTab]         = useState<TabFilter>("pending");
  const [actingId, setActingId]           = useState<number | null>(null);
  const [selectedIds, setSelectedIds]     = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading]     = useState(false);
  const [transferTask, setTransferTask]   = useState<{ id: number; title: string } | null>(null);
  const [expandedActivityId, setExpandedActivityId] = useState<number | null>(null);
  const [activityLog, setActivityLog]     = useState<Record<number, ActivityEntry[]>>({});
  const [savingToLibrary, setSavingToLibrary] = useState<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Tasks are scoped per-tab — react-query handles cancellation when the tab
  // changes mid-flight, so we no longer hand-roll an AbortController here.
  const tasksQuery = useQuery({
    queryKey: queryKeys.tasks(activeTab),
    queryFn: async () => {
      const url = activeTab === "all"
        ? `${BASE}/api/tasks`
        : `${BASE}/api/tasks?status=${activeTab}`;
      const res = await authFetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return Array.isArray(data) ? (data as ProposedTask[]) : [];
    },
  });
  const tasks   = tasksQuery.data ?? [];
  const loading = tasksQuery.isLoading;
  // Invalidate the entire `tasks` namespace, not just the active tab — an
  // approve in "pending" needs to refresh "approved" / "all" caches too,
  // otherwise the count badges and other tabs go stale until the user
  // navigates away and back.
  const fetchTasks = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.tasksAll() }),
    [queryClient],
  );

  // Reset selection whenever the user switches tabs.
  useEffect(() => { setSelectedIds(new Set()); }, [activeTab]);

  const notifyTaskCountChanged = () => window.dispatchEvent(new CustomEvent("omni:task-count-changed"));

  const handleApprove = async (id: number) => {
    setActingId(id);
    try {
      const res = await authPatch(`${BASE}/api/tasks/${id}/approve`, {});
      if (res.ok) {
        toast({ title: "Task Approved", description: "The action has been approved and queued for execution." });
        fetchTasks(); notifyTaskCountChanged();
      } else {
        toast({ title: "Error", description: "Could not approve this task.", variant: "destructive" });
      }
    } catch { toast({ title: "Error", description: "Network error.", variant: "destructive" }); }
    finally { setActingId(null); }
  };

  const handleReject = async (id: number) => {
    setActingId(id);
    try {
      const res = await authPatch(`${BASE}/api/tasks/${id}/reject`, {});
      if (res.ok) {
        toast({ title: "Task Rejected", description: "The proposed fix has been rejected." });
        fetchTasks(); notifyTaskCountChanged();
      } else {
        toast({ title: "Error", description: "Could not reject this task.", variant: "destructive" });
      }
    } catch { toast({ title: "Error", description: "Network error.", variant: "destructive" }); }
    finally { setActingId(null); }
  };

  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    try {
      const res = await authPatch(`${BASE}/api/tasks/bulk-approve`, { ids: Array.from(selectedIds) });
      if (res.ok) {
        const data = await res.json();
        toast({ title: "Bulk Approved", description: `${data.approved} task${data.approved !== 1 ? "s" : ""} approved and queued.` });
        setSelectedIds(new Set()); fetchTasks(); notifyTaskCountChanged();
      } else {
        toast({ title: "Error", description: "Bulk approval failed.", variant: "destructive" });
      }
    } catch { toast({ title: "Error", description: "Network error.", variant: "destructive" }); }
    finally { setBulkLoading(false); }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const pendingTasks = tasks.filter((t) => t.status === "pending");
    if (selectedIds.size === pendingTasks.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(pendingTasks.map((t) => t.id)));
  };

  const fetchActivity = async (taskId: number) => {
    if (expandedActivityId === taskId) { setExpandedActivityId(null); return; }
    setExpandedActivityId(taskId);
    if (activityLog[taskId]) return;
    try {
      const res = await authFetch(`${BASE}/api/tasks/${taskId}/activity`);
      if (res.ok) {
        const data = await res.json();
        setActivityLog((prev) => ({ ...prev, [taskId]: Array.isArray(data) ? data : [] }));
      }
    } catch { /* silent */ }
  };

  const handleSaveToLibrary = async (taskId: number) => {
    setSavingToLibrary(taskId);
    try {
      const res = await authFetch(`${BASE}/api/tasks/${taskId}/save-to-library`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) toast({ title: "Saved to Resolution Base", description: "This fix is now available in the team library." });
      else        toast({ title: "Error", description: "Could not save to library.", variant: "destructive" });
    } catch { toast({ title: "Error", description: "Network error.", variant: "destructive" }); }
    finally { setSavingToLibrary(null); }
  };

  const canExecute = currentUser ? ["admin", "manager"].includes(currentUser.role) : false;

  const TABS: { id: TabFilter; label: string; icon: string }[] = [
    { id: "pending",  label: "Pending",  icon: "pending_actions" },
    { id: "approved", label: "Approved", icon: "check_circle"    },
    { id: "rejected", label: "Rejected", icon: "cancel"          },
    { id: "all",      label: "All",      icon: "list"            },
  ];

  const pendingCount = tasks.filter((t) => t.status === "pending").length;
  const showBulkBar  = selectedIds.size > 0 && canExecute;

  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <div className="max-w-5xl mx-auto p-6 sm:p-10 pt-0">

        <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-4 mb-8">
          <div className="space-y-1">
            <span className="label-sm text-on-surface-variant">AI Ops</span>
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tighter leading-[1.1] text-on-surface tight-heading">
              Approval Queue
            </h1>
            <p className="text-on-surface-variant max-w-lg text-sm font-medium">
              Review proposed fixes from your team. Approve to execute or reject to dismiss.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setShowCreateModal(true)}
              className="shrink-0 btn-primary-glow px-5 py-3 text-sm flex items-center gap-2 active:scale-95 transition-transform"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              Create Task
            </button>
            {activeTab === "pending" && pendingCount > 0 && canExecute && pendingCount > 1 && (
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-2 text-xs font-semibold text-on-surface-variant hover:text-on-surface transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">
                  {selectedIds.size === pendingCount ? "deselect" : "select_all"}
                </span>
                {selectedIds.size === pendingCount ? "Deselect All" : "Select All"}
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 mb-8 border-b border-outline-variant/15">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-all border-b-2 -mb-px",
                activeTab === tab.id
                  ? "border-primary-container text-primary-container"
                  : "border-transparent text-on-surface-variant hover:text-on-surface",
              )}
            >
              <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
              {tab.label}
              {tab.id === "pending" && pendingCount > 0 && (
                <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full">{pendingCount}</span>
              )}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-44 rounded-xl bg-surface-container-lowest ghost-border animate-pulse" />
            ))}
          </div>
        ) : tasksQuery.isError ? (
          <QueryErrorState
            title="Couldn't load tasks"
            error={tasksQuery.error}
            onRetry={() => tasksQuery.refetch()}
          />
        ) : tasks.length === 0 ? (
          <div className="bg-surface-container-lowest rounded-xl ghost-border p-16 text-center ambient-shadow-sm">
            <span className="material-symbols-outlined text-5xl text-surface-container-highest mb-4 block">
              {activeTab === "pending" ? "task_alt" : activeTab === "approved" ? "verified" : activeTab === "rejected" ? "block" : "inbox"}
            </span>
            <p className="text-sm font-semibold text-on-surface-variant">
              {activeTab === "pending" ? "No pending approvals" : `No ${activeTab} tasks`}
            </p>
            <p className="text-xs text-on-surface-variant mt-1">
              {activeTab === "pending"
                ? "When team members propose fixes, they'll appear here for your review."
                : "Tasks will appear here as they are processed."}
            </p>
          </div>
        ) : (
          <div className={cn("space-y-4", showBulkBar && "pb-24")}>
            {tasks.map((task) => {
              const isPending  = task.status === "pending";
              const isSelected = selectedIds.has(task.id);
              return (
                <motion.div
                  key={task.id}
                  layout
                  className={cn(
                    "bg-surface-container-lowest rounded-xl ghost-border overflow-hidden border-l-4 transition-all hover:shadow-md",
                    PLATFORM_ACCENT[task.platform] || "border-l-outline-variant",
                    isSelected && "ring-2 ring-primary-container/30",
                    task.status === "approved" && "opacity-80",
                    task.status === "rejected" && "border-l-error-m3/30",
                  )}
                >
                  <div className="p-6">
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div className="flex items-center gap-3">
                        {isPending && canExecute && (
                          <button
                            onClick={() => toggleSelect(task.id)}
                            className={cn(
                              "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all",
                              isSelected
                                ? "bg-primary-container border-primary-container text-white"
                                : "border-outline-variant hover:border-outline",
                            )}
                          >
                            {isSelected && <span className="material-symbols-outlined text-[14px]">check</span>}
                          </button>
                        )}
                        <div className="w-10 h-10 rounded-xl bg-surface-container-low ghost-border flex items-center justify-center">
                          {PLATFORM_ICONS[task.platform] || (
                            <span className="material-symbols-outlined text-on-surface-variant text-lg">build</span>
                          )}
                        </div>
                        <div>
                          <h3 className={cn("font-bold text-sm text-on-surface", task.status === "rejected" && "line-through opacity-60")}>
                            {task.toolDisplayName}
                          </h3>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-primary-container bg-primary-container/10 px-2 py-0.5 rounded-full">AI Agent</span>
                            <span className="text-[10px] text-on-surface-variant">
                              {task.platformLabel} · #{task.id} · {getTimeAgo(task.createdAt)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <span className={cn(
                        "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest shrink-0",
                        task.status === "pending"  ? "bg-amber-50 text-amber-700 border border-amber-200"
                          : task.status === "approved" ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : task.status === "rejected" ? "bg-error-container text-on-error-container border border-error-m3/20"
                          : "bg-surface-container-low text-on-surface-variant border border-outline-variant/15",
                      )}>
                        {task.status}
                      </span>
                    </div>

                    {task.displayDiff && task.displayDiff.length > 0 && (
                      <div className="bg-surface-container-low rounded-xl p-4 mb-4 space-y-2">
                        {task.displayDiff.map((row, i) => {
                          const fromNum  = parseFloat(row.from.replace(/[^0-9.]/g, ""));
                          const toNum    = parseFloat(row.to.replace(/[^0-9.]/g, ""));
                          const isChange = row.from !== "—" && row.to !== "—" && row.from !== row.to;
                          const isIncrease = !isNaN(fromNum) && !isNaN(toNum) && toNum > fromNum;
                          return (
                            <div key={i} className="flex items-center justify-between text-sm">
                              <span className="text-xs font-medium text-on-surface-variant uppercase tracking-wider">{row.label}</span>
                              <div className="flex items-center gap-2">
                                {isChange && <span className="text-xs text-on-surface-variant line-through">{row.from}</span>}
                                <span className="material-symbols-outlined text-[14px] text-outline-variant">arrow_forward</span>
                                <span className={cn(
                                  "text-xs font-bold",
                                  isChange ? (isIncrease ? "text-emerald-600" : "text-error-m3") : "text-on-surface",
                                )}>
                                  {row.to}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {task.reasoning && (
                      <div className="mb-4">
                        <p className="label-sm text-on-surface-variant mb-1">AI Rationale</p>
                        <p className="text-xs text-on-surface-variant leading-relaxed">{task.reasoning}</p>
                      </div>
                    )}

                    {task.comments && (
                      <div className="mb-4 bg-primary-container/5 rounded-xl p-3 border border-primary-container/15">
                        <p className="label-sm text-primary-container mb-1">Proposer's Note</p>
                        <p className="text-xs text-primary-m3 leading-relaxed">{task.comments}</p>
                      </div>
                    )}

                    {task.assignedToName && (
                      <div className="flex items-center gap-2 mb-3 bg-purple-50/50 rounded-2xl p-2.5 border border-purple-100">
                        <User className="w-3 h-3 text-purple-500 shrink-0" />
                        <span className="text-[10px] font-semibold text-purple-700">Assigned to {task.assignedToName}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-3 border-t border-outline-variant/10">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-primary-container/10 flex items-center justify-center text-[10px] font-bold text-primary-container">
                          {getInitials(task.proposedByName)}
                        </div>
                        <div>
                          <span className="text-xs font-medium text-on-surface">{task.proposedByName}</span>
                          <span className={cn("ml-2 text-[10px] font-semibold px-2 py-0.5 rounded-2xl", ROLE_BADGE_COLORS[task.proposedByRole] || ROLE_BADGE_COLORS.viewer)}>
                            {ROLE_LABELS[task.proposedByRole as Role] || task.proposedByRole}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setTransferTask({ id: task.id, title: task.toolDisplayName })}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-outline-variant/15 text-on-surface-variant text-[10px] font-semibold hover:bg-surface-container-low hover:border-outline-variant transition-all active:scale-95"
                        >
                          <ArrowRightLeft className="w-3 h-3" />
                          Transfer
                        </button>
                        <button
                          onClick={() => fetchActivity(task.id)}
                          className="flex items-center gap-1 px-2.5 py-2 rounded-xl border border-outline-variant/15 text-on-surface-variant text-[10px] font-semibold hover:bg-surface-container-low transition-all"
                        >
                          {expandedActivityId === task.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          Log
                        </button>

                        {task.status === "pending" && canExecute && (
                          <>
                            <button
                              onClick={() => handleReject(task.id)}
                              disabled={actingId === task.id}
                              className="px-3 py-2 rounded-xl border border-error-m3/20 text-error-m3 text-xs font-semibold hover:bg-error-container transition-all active:scale-95 disabled:opacity-50"
                            >
                              Reject
                            </button>
                            <button
                              onClick={() => handleApprove(task.id)}
                              disabled={actingId === task.id}
                              className="px-3 py-2 rounded-xl bg-primary-container hover:bg-primary-m3 text-white text-xs font-semibold transition-all active:scale-95 disabled:opacity-50 flex items-center gap-1.5"
                            >
                              {actingId === task.id
                                ? <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                                : <span className="material-symbols-outlined text-[14px]">bolt</span>}
                              Approve & Deploy
                            </button>
                          </>
                        )}
                        {task.status === "pending" && !canExecute && currentUser && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 text-[10px] font-bold uppercase tracking-wide cursor-default select-none" title="Your role cannot approve.">
                            <span className="material-symbols-outlined text-[13px]">rate_review</span>
                            Awaiting Director Approval
                          </span>
                        )}
                        {task.status === "approved" && canExecute && (
                          <button
                            onClick={() => handleSaveToLibrary(task.id)}
                            disabled={savingToLibrary === task.id}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-2xl border border-emerald-200 text-emerald-600 text-[10px] font-semibold hover:bg-emerald-50 transition-all active:scale-95 disabled:opacity-50"
                          >
                            <BookOpen className="w-3 h-3" />
                            {savingToLibrary === task.id ? "Saving..." : "Save to Library"}
                          </button>
                        )}
                        {task.status !== "pending" && task.resolvedByName && !canExecute && (
                          <span className="text-[10px] text-on-surface-variant">
                            {task.status === "approved" ? "Approved" : "Rejected"} by {task.resolvedByName}
                          </span>
                        )}
                      </div>
                    </div>

                    <AnimatePresence>
                      {expandedActivityId === task.id && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-3 pt-3 border-t border-[rgba(200,197,203,0.08)]">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-2">Activity Log</p>
                            {(!activityLog[task.id] || activityLog[task.id].length === 0) ? (
                              <p className="text-[11px] text-on-surface-variant py-2">No activity recorded yet.</p>
                            ) : (
                              <div className="space-y-2">
                                {activityLog[task.id].map((entry) => (
                                  <div key={entry.id} className="flex items-start gap-2.5">
                                    <div className="w-5 h-5 rounded-full bg-surface-container-low flex items-center justify-center shrink-0 mt-0.5">
                                      <User className="w-2.5 h-2.5 text-on-surface-variant" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[11px] text-on-surface">
                                        <span className="font-semibold">{entry.actorName}</span>
                                        {entry.action === "transfer" && entry.targetMemberName && (
                                          <> transferred to <span className="font-semibold">{entry.targetMemberName}</span></>
                                        )}
                                        {entry.action === "saved_to_library" && <> saved to Resolution Base</>}
                                        {entry.action !== "transfer" && entry.action !== "saved_to_library" && <> {entry.action}</>}
                                      </p>
                                      {entry.note && <p className="text-[10px] text-on-surface-variant mt-0.5 italic">"{entry.note}"</p>}
                                      <p className="text-[9px] text-on-surface-variant mt-0.5">{getTimeAgo(entry.createdAt)}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      <AnimatePresence>
        {showBulkBar && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
          >
            <div className="flex items-center gap-4 bg-white/95 backdrop-blur-xl ghost-border shadow-2xl rounded-xl px-6 py-3.5">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full bg-primary-container text-white flex items-center justify-center text-xs font-bold">
                  {selectedIds.size}
                </span>
                <span className="text-sm font-medium text-on-surface">task{selectedIds.size > 1 ? "s" : ""} selected</span>
              </div>
              <div className="w-px h-6 bg-surface-container-highest" />
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-xs font-semibold text-on-surface-variant hover:text-on-surface transition-colors px-3 py-2"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkApprove}
                disabled={bulkLoading}
                className="flex items-center gap-2 bg-primary-container hover:bg-primary-m3 text-white px-5 py-2.5 rounded-xl text-sm font-semibold active:scale-95 transition-all disabled:opacity-50"
              >
                {bulkLoading
                  ? <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                  : <span className="material-symbols-outlined text-[16px]">done_all</span>}
                Approve Selected
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {transferTask && (
        <TransferTaskModal
          open={!!transferTask}
          onClose={() => setTransferTask(null)}
          taskId={transferTask.id}
          taskTitle={transferTask.title}
          onTransferred={() => { fetchTasks(); toast({ title: "Task Transferred", description: "The task has been reassigned." }); }}
        />
      )}

      {showCreateModal && (
        <CreateTaskModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => fetchTasks()}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT — tabbed page shell
// ─────────────────────────────────────────────────────────────────────────────

// ─── NewTaskButton — permission-gated ────────────────────────────────────────

function NewTaskButton({ showNewForm, onToggle }: { showNewForm: boolean; onToggle: () => void }) {
  const { permitted } = useHasPermission("analyst");
  return (
    <div className="relative group/newbtn">
      <button
        onClick={permitted ? onToggle : undefined}
        disabled={!permitted}
        data-testid="btn-add-new-audit"
        aria-disabled={!permitted}
        className={cn(
          "flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl transition-all active:scale-95",
          showNewForm
            ? "bg-slate-100 text-slate-600"
            : "bg-omni-primary text-white hover:opacity-90",
          !permitted && "opacity-50 cursor-not-allowed",
        )}
      >
        {showNewForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
        {showNewForm ? "Cancel" : "New Task"}
      </button>
      {!permitted && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 rounded-lg bg-slate-800 text-white text-[11px] whitespace-nowrap opacity-0 group-hover/newbtn:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg">
          Analyst access required
        </div>
      )}
    </div>
  );
}

type MainTab = "command-center" | "ai-proposals";

const MAIN_TABS: { id: MainTab; label: string; icon: string; desc: string }[] = [
  { id: "command-center", label: "Command Center", icon: "dashboard",      desc: "Agency-wide operational tasks" },
  { id: "ai-proposals",   label: "AI Proposals",   icon: "smart_toy",      desc: "AI-generated campaign actions" },
];

export default function TaskBoard() {
  const [mainTab, setMainTab] = useState<MainTab>("command-center");

  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <div className="max-w-6xl mx-auto p-6 sm:p-10">

        {/* Page header */}
        <div className="mb-8 space-y-1">
          <span className="label-sm text-on-surface-variant">Agency Ops</span>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tighter leading-[1.1] text-on-surface tight-heading">
            Media Buying Action Items
          </h1>
          <p className="text-on-surface-variant max-w-lg text-sm font-medium">
            Operational command center and AI proposal queue for your media buying team.
          </p>
        </div>

        {/* Top-level tab switcher */}
        <div className="flex items-center gap-1 mb-8 border-b border-outline-variant/15">
          {MAIN_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setMainTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-all border-b-2 -mb-px",
                mainTab === tab.id
                  ? "border-omni-primary text-omni-primary"
                  : "border-transparent text-on-surface-variant hover:text-on-surface",
              )}
            >
              <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Panel content */}
        {mainTab === "command-center" && <CommandCenter />}
        {mainTab === "ai-proposals"   && <AIProposals />}
      </div>
    </div>
  );
}
