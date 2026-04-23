/**
 * WorkspaceSelector
 * -----------------
 * Compact workspace switcher for the Command Overview header in the right pane.
 *
 * Uses Radix UI DropdownMenu (via the shadcn/ui wrapper) which renders the
 * menu into a portal — entirely bypassing any parent overflow:hidden or
 * z-index stacking context that would clip a naive absolute dropdown.
 *
 * Typography:
 *   • Trigger label  → font-heading (Google Sans → Roboto) for the active name
 *   • Dropdown items → Roboto (inherited from body font-sans)
 *
 * Motion:
 *   • Entry: scale 95% → 100% + fade-in over 150ms ease-out
 *   • Exit:  scale 100% → 95% + fade-out over 100ms
 *   Both driven by Radix data-state attributes + tw-animate-css utilities.
 */

import { ChevronDown, Check, AlertTriangle, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/contexts/workspace-context";

// ─── Palette helpers ───────────────────────────────────────────────────────────

const HUE_PALETTE = [
  "#1a73e8", "#00897b", "#8e24aa", "#e53935",
  "#f57c00", "#0288d1", "#43a047", "#c0392b",
];

function wsColor(id: number) {
  return HUE_PALETTE[id % HUE_PALETTE.length];
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

const GOAL_LABELS: Record<string, string> = {
  ecom:    "E-commerce",
  leadgen: "Lead Gen",
  hybrid:  "Hybrid",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function WorkspaceSelector() {
  const { workspaces, activeWorkspace, switchWorkspace, isLoading } = useWorkspace();

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-slate-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span className="text-sm">Loading…</span>
      </div>
    );
  }

  const color = activeWorkspace ? wsColor(activeWorkspace.id) : "#1a73e8";

  return (
    <DropdownMenu>
      {/* ── Trigger ──────────────────────────────────────────────────────── */}
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "group flex items-center gap-1.5 px-2.5 py-1.5 rounded-md",
            "text-slate-700 hover:bg-slate-100/90 active:bg-slate-100",
            "transition-colors duration-150 ease-out",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
          )}
        >
          {/* Active workspace avatar */}
          {activeWorkspace && (
            <div
              className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold text-white shrink-0 shadow-sm"
              style={{ background: color }}
              aria-hidden="true"
            >
              {initials(activeWorkspace.clientName)}
            </div>
          )}

          {/* Active workspace name — Google Sans via font-heading */}
          <span className="font-heading font-semibold text-sm text-slate-800 max-w-[180px] truncate">
            {activeWorkspace?.clientName ?? "Select Workspace"}
          </span>

          {/* Chevron rotates when open via Radix data-state */}
          <ChevronDown
            className={cn(
              "w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-150",
              "group-data-[state=open]:rotate-180",
            )}
          />
        </button>
      </DropdownMenuTrigger>

      {/* ── Menu content (rendered in a portal — no z-index clipping) ───── */}
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className={cn(
          // Layout
          "min-w-[240px] max-h-72 overflow-y-auto rounded-xl p-1",
          // Background — solid white for 4.5:1 contrast on all text
          "bg-white border border-slate-200/70",
          // Elevation — shadow-xl lifts it clearly above the Operational Tasks list
          "shadow-xl",
          // Entry animation: zoom-in-95 + fade-in over 150ms ease-out
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          // Exit animation: zoom-out-95 + fade-out over 100ms
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          // Slide direction — slides from slightly above when anchored below trigger
          "data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1",
          // Duration
          "duration-150",
        )}
      >
        {/* Section label */}
        <div className="px-2.5 py-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-sans">
            Client Workspaces
          </p>
        </div>
        <DropdownMenuSeparator className="bg-slate-100 -mx-1 mb-0.5" />

        {/* Workspace list */}
        {workspaces.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-5 px-4">
            No workspaces available
          </p>
        ) : (
          workspaces.map((ws) => {
            const active = ws.id === activeWorkspace?.id;
            const c = wsColor(ws.id);
            const goal = ws.primaryGoal ? (GOAL_LABELS[ws.primaryGoal] ?? ws.primaryGoal) : null;

            return (
              <DropdownMenuItem
                key={ws.id}
                onClick={() => switchWorkspace(ws.id)}
                className={cn(
                  // Base item layout
                  "flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer",
                  // Interaction states
                  "hover:bg-slate-50 focus:bg-slate-50",
                  // Active workspace gets a subtle blue tint
                  active && "bg-blue-50/60 hover:bg-blue-50 focus:bg-blue-50",
                  // Remove default outline ring from shadcn
                  "focus:outline-none",
                )}
              >
                {/* Workspace avatar */}
                <div
                  className="w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                  style={{ background: c }}
                  aria-hidden="true"
                >
                  {initials(ws.clientName)}
                </div>

                {/* Name + goal — Roboto body font (inherited) */}
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    "text-sm font-medium truncate leading-tight",
                    active ? "text-blue-700" : "text-slate-800",
                  )}>
                    {ws.clientName}
                  </p>
                  {goal && (
                    <p className="text-[10px] text-slate-400 leading-tight mt-px">{goal}</p>
                  )}
                </div>

                {/* Right side: alert badge + active checkmark */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {(ws.criticalAlertCount ?? 0) > 0 && (
                    <span className="flex items-center gap-0.5 text-[10px] font-bold text-red-600 bg-red-50 border border-red-100 px-1.5 py-0.5 rounded-full">
                      <AlertTriangle className="w-2.5 h-2.5" />
                      {ws.criticalAlertCount}
                    </span>
                  )}
                  {active && (
                    <Check size={14} className="text-blue-600 shrink-0" aria-label="Active workspace" />
                  )}
                </div>
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
