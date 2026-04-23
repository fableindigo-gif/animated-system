/**
 * WorkspaceSwitcher
 * -----------------
 * Prominent dropdown in the sidebar showing the active client workspace.
 * Fetches the list from WorkspaceContext (backed by GET /api/workspaces).
 * Switching instantly updates global context → all authFetch calls pick up
 * the new X-Workspace-Id header automatically.
 */
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { Loader2, Plus, Search, Check, AlertTriangle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspace, type Workspace } from "@/contexts/workspace-context";
import { WorkspaceProvisionWizard } from "@/components/enterprise/workspace-provision-wizard";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

// Derive initials from client name
function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

// Consistent hue per workspace ID
const HUE_PALETTE = [
  "#1a73e8", "#00897b", "#8e24aa", "#e53935",
  "#f57c00", "#0288d1", "#43a047", "#c0392b",
];
function wsColor(id: number) {
  return HUE_PALETTE[id % HUE_PALETTE.length];
}

// AddClientForm removed — replaced by WorkspaceProvisionWizard for goal + integration selection

// ─── Main Component ───────────────────────────────────────────────────────────

export function WorkspaceSwitcher() {
  const [, navigate]   = useLocation();
  const { workspaces, activeWorkspace, switchWorkspace, isLoading, refreshWorkspaces } = useWorkspace();

  const [open, setOpen]                     = useState(false);
  const [query, setQuery]                   = useState("");
  const [showProvisionWizard, setShowProvisionWizard] = useState(false);
  const containerRef                        = useRef<HTMLDivElement>(null);
  const triggerRef                          = useRef<HTMLButtonElement | HTMLDivElement>(null);
  const dropdownRef                         = useRef<HTMLDivElement>(null);
  const searchRef                           = useRef<HTMLInputElement>(null);

  // Dropdown portal position — calculated from trigger's bounding rect on open.
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  function openDropdown() {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 6, left: rect.left, width: rect.width });
    }
    setQuery("");
    setOpen(true);
  }

  function closeDropdown() {
    setOpen(false);
    setQuery("");
    setDropdownPos(null);
  }

  // Close on outside click — must check both the container and the portal dropdown.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const inContainer = containerRef.current?.contains(e.target as Node);
      const inDropdown  = dropdownRef.current?.contains(e.target as Node);
      if (!inContainer && !inDropdown) closeDropdown();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 80);
  }, [open]);

  const filtered = workspaces.filter((w) =>
    w.clientName.toLowerCase().includes(query.toLowerCase()),
  );

  function handleSelect(ws: Workspace) {
    switchWorkspace(ws.id);
    closeDropdown();
  }

  function handleCreated(ws: Workspace) {
    switchWorkspace(ws.id);
    setShowProvisionWizard(false);
    setOpen(false);
    sessionStorage.setItem("omni_new_workspace", ws.clientName);
    navigate("/connections");
  }

  const color = activeWorkspace ? wsColor(activeWorkspace.id) : "#1a73e8";
  const userRole = (localStorage.getItem("omni_user_role") ?? "member").toLowerCase();
  const isAdmin = userRole === "admin" || userRole === "agency_owner" || userRole === "super_admin";

  // Admins can always open the switcher — even with one workspace — so "+ Add Client" is reachable
  const canSwitch = workspaces.length > 1 || isAdmin;

  return (
    <div id="tour-workspace-switcher" className="relative px-3 mb-1" ref={containerRef}>
      {/* ── Trigger: clickable only when multiple workspaces ── */}
      {canSwitch ? (
        <button
          ref={triggerRef as React.RefObject<HTMLButtonElement>}
          onClick={openDropdown}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all group"
          style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.14)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.16)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 text-white/60 animate-spin shrink-0" />
          ) : (
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold text-white shrink-0"
              style={{ background: color }}
            >
              {activeWorkspace ? initials(activeWorkspace.clientName) : "?"}
            </div>
          )}
          <div className="flex-1 min-w-0 text-left">
            <p className="text-[12px] font-bold text-white truncate leading-tight">
              {isLoading ? "Loading…" : (activeWorkspace?.clientName ?? "No Client")}
            </p>
            <p className="text-[10px] text-white/45 leading-tight mt-px">
              {workspaces.length} workspace{workspaces.length !== 1 ? "s" : ""}
            </p>
          </div>
          <ChevronDown
            className={cn("w-3.5 h-3.5 text-white/50 shrink-0 transition-transform", open && "rotate-180")}
          />
        </button>
      ) : (
        /* Static display when only one workspace (non-admin, single-client view) */
        <div
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl"
          style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 text-white/60 animate-spin shrink-0" />
          ) : (
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold text-white shrink-0"
              style={{ background: color }}
            >
              {activeWorkspace ? initials(activeWorkspace.clientName) : "?"}
            </div>
          )}
          <div className="flex-1 min-w-0 text-left">
            <p className="text-[12px] font-bold text-white truncate leading-tight">
              {isLoading ? "Loading…" : (activeWorkspace?.clientName ?? "No Client")}
            </p>
            <p className="text-[10px] text-white/45 leading-tight mt-px">Active workspace</p>
          </div>
        </div>
      )}

      {/* ── Dropdown — rendered in a portal at body level to escape overflow:hidden ── */}
      {open && canSwitch && dropdownPos && createPortal(
        <div
          ref={dropdownRef}
          className="rounded-xl overflow-hidden shadow-2xl animate-in fade-in slide-in-from-top-2 duration-150"
          style={{
            position: "fixed",
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            zIndex: 9100,
            background: "#0a1628",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          {/* Search */}
          <div className="p-2 border-b border-white/10">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/10">
              <Search className="w-3 h-3 text-white/40 shrink-0" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search clients…"
                className="flex-1 text-[12px] text-white placeholder-white/30 bg-transparent focus:outline-none"
              />
              {query && (
                <button onClick={() => setQuery("")} className="text-white/30 hover:text-white/60 text-[10px]">✕</button>
              )}
            </div>
          </div>

          {/* Workspace list */}
          <div className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="text-[11px] text-white/30 text-center py-4">No clients found</p>
            ) : (
              filtered.map((ws) => {
                const active = ws.id === activeWorkspace?.id;
                const c      = wsColor(ws.id);
                return (
                  <button
                    key={ws.id}
                    onClick={() => handleSelect(ws)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-all"
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                      style={{ background: c }}
                    >
                      {initials(ws.clientName)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-[12px] font-semibold truncate", active ? "text-white" : "text-white/75")}>
                        {ws.clientName}
                      </p>
                      <p className="text-[10px] text-white/35 capitalize leading-tight">{ws.primaryGoal ?? "ecom"}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {ws.criticalAlertCount > 0 && (
                        <span className="flex items-center gap-0.5 text-[10px] font-bold text-red-300 bg-red-500/20 px-1.5 py-0.5 rounded-full">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          {ws.criticalAlertCount}
                        </span>
                      )}
                      {active && <Check className="w-3.5 h-3.5 text-[#4fc3f7]" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Add Client — admin only → opens full provision wizard */}
          {isAdmin && (
            <div className="p-2 border-t border-white/10">
              <button
                data-testid="add-new-client-btn"
                onClick={() => { setShowProvisionWizard(true); closeDropdown(); }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-semibold transition-all"
                style={{ color: "#4fc3f7" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(79,195,247,0.1)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <Plus className="w-3.5 h-3.5" />
                Add New Client
              </button>
            </div>
          )}
        </div>,
        document.body,
      )}

      {/* Provision Wizard — rendered as a portal overlay */}
      {showProvisionWizard && (
        <WorkspaceProvisionWizard
          onClose={() => setShowProvisionWizard(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
