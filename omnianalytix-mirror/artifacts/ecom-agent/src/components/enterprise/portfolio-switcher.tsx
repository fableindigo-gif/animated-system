import { useState, useRef, useEffect } from "react";
import {
  ChevronDown, Building2, Plus, AlertCircle, Check,
  Loader2, Settings, ExternalLink, Zap,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/contexts/workspace-context";

function statusDot(status: string) {
  if (status === "active")  return "bg-emerald-400";
  if (status === "pending") return "bg-amber-400 animate-pulse";
  return "bg-on-surface-variant";
}

export function PortfolioSwitcher() {
  const [open, setOpen] = useState(false);
  const [, navigate]    = useLocation();
  const ref             = useRef<HTMLDivElement>(null);
  const { workspaces, activeWorkspace, switchWorkspace, isLoading } = useWorkspace();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const displayName = activeWorkspace?.clientName ?? "No workspace";
  const hasCritical = (activeWorkspace?.criticalAlertCount ?? 0) > 0;

  return (
    <div ref={ref} className="relative shrink-0">

      {/* Trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 px-2.5 py-1.5 rounded-2xl border text-xs font-mono transition-all",
          "bg-white border-outline-variant/15 hover:border-outline hover:bg-surface",
          open && "border-[#0081FB]/50 bg-surface",
          hasCritical && !open && "border-rose-500/40",
        )}
      >
        {isLoading ? (
          <Loader2 className="w-3 h-3 text-on-surface-variant animate-spin" />
        ) : hasCritical ? (
          <AlertCircle className="w-3 h-3 text-rose-400 shrink-0" />
        ) : (
          <Building2 className="w-3 h-3 text-on-surface-variant shrink-0" />
        )}
        <span className="text-on-surface-variant hidden sm:inline">Workspace</span>
        <span className="text-on-surface-variant hidden sm:inline">/</span>
        <span className={cn(
          "font-semibold truncate max-w-[130px]",
          hasCritical ? "text-rose-300" : "text-on-surface",
        )}>
          {displayName}
        </span>
        {activeWorkspace && (
          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", statusDot(activeWorkspace.status))} />
        )}
        <ChevronDown className={cn("w-3 h-3 text-on-surface-variant shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className={cn(
          "absolute top-full left-0 mt-1.5 z-50 w-80 rounded-2xl overflow-hidden",
          "border border-outline-variant/15 shadow-2xl shadow-black/10",
          "backdrop-blur-md bg-white/95",
        )}>
          {/* Header */}
          <div className="px-3 py-2.5 border-b border-outline-variant/15 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-accent-blue" />
              <p className="text-[10px] font-mono text-accent-blue uppercase tracking-widest">
                Client Workspaces
              </p>
            </div>
            <Link href="/agency/command-center" onClick={() => setOpen(false)}>
              <button className="flex items-center gap-1 text-[9px] font-mono text-on-surface-variant hover:text-accent-blue transition-colors">
                Command Center <ExternalLink className="w-2.5 h-2.5" />
              </button>
            </Link>
          </div>

          {/* List */}
          <div className="max-h-64 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-6 gap-2 text-on-surface-variant text-xs font-mono">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading workspaces…
              </div>
            ) : workspaces.length === 0 ? (
              <div className="px-4 py-5 text-center">
                <Building2 className="w-6 h-6 text-on-surface-variant mx-auto mb-2" />
                <p className="text-[11px] font-mono text-on-surface-variant mb-2">No workspaces provisioned</p>
                <Link href="/agency/command-center" onClick={() => setOpen(false)}>
                  <span className="text-[11px] font-mono text-accent-blue hover:underline">Open Command Center →</span>
                </Link>
              </div>
            ) : (
              workspaces.map((ws) => {
                const isSelected = ws.id === activeWorkspace?.id;
                const hasCrit    = ws.criticalAlertCount > 0;
                return (
                  <button
                    key={ws.id}
                    onClick={() => {
                      switchWorkspace(ws.id);
                      setOpen(false);
                      navigate("/");
                    }}
                    className={cn(
                      "w-full flex items-center gap-3 px-3.5 py-2.5 text-xs transition-colors text-left",
                      "hover:bg-surface",
                      isSelected && "bg-accent-blue/5",
                    )}
                  >
                    <span className={cn("w-2 h-2 rounded-full shrink-0 mt-0.5", statusDot(ws.status))} />
                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        "font-semibold truncate",
                        isSelected ? "text-accent-blue" : "text-on-surface",
                      )}>
                        {ws.clientName}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[9px] font-mono text-on-surface-variant">{ws.slug}</span>
                        {(ws.enabledIntegrations as string[]).slice(0, 3).map((id) => (
                          <span key={id} className="text-[8px] font-mono px-1 rounded bg-surface/80 text-on-surface-variant border border-outline-variant/15/40">
                            {id.replace("_", " ")}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {hasCrit && (
                        <span className="flex items-center gap-0.5 text-[8px] font-mono text-rose-400 border border-rose-500/30 rounded px-1">
                          <AlertCircle className="w-2 h-2" /> {ws.criticalAlertCount}
                        </span>
                      )}
                      {isSelected && <Check className="w-3 h-3 text-accent-blue" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-outline-variant/15 flex items-center justify-between px-3 py-2">
            <Link href="/agency/command-center" onClick={() => setOpen(false)}>
              <button className="flex items-center gap-1.5 text-[10px] font-mono text-on-surface-variant hover:text-accent-blue transition-colors py-1">
                <Plus className="w-3 h-3" /> Provision client
              </button>
            </Link>
            <Link href="/connections" onClick={() => setOpen(false)}>
              <button className="flex items-center gap-1.5 text-[10px] font-mono text-on-surface-variant hover:text-on-surface-variant transition-colors py-1">
                <Settings className="w-3 h-3" /> Connections
              </button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
