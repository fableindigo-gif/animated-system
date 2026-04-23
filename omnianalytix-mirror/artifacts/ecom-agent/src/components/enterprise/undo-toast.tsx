import { useState, useEffect, useRef } from "react";
import { RotateCcw, CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth-fetch";

const BASE = import.meta.env.BASE_URL ?? "/";
const API = BASE.endsWith("/") ? BASE : BASE + "/";

export interface UndoAction {
  snapshotId: number;
  toolDisplayName: string;
  message: string;
}

interface UndoToastProps {
  action: UndoAction | null;
  onDismiss: () => void;
  onReverted?: () => void;
}

export function UndoToast({ action, onDismiss, onReverted }: UndoToastProps) {
  const [state, setState] = useState<"idle" | "reverting" | "reverted" | "failed">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!action) return;
    setState("idle");
    timerRef.current = setTimeout(onDismiss, 15000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [action, onDismiss]);

  if (!action) return null;

  const handleUndo = async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setState("reverting");
    try {
      const resp = await authFetch(`${API}api/actions/${action.snapshotId}/revert`, { method: "POST" });
      const result = await resp.json() as { success: boolean; message: string };
      setState(result.success ? "reverted" : "failed");
      if (result.success) {
        onReverted?.();
        setTimeout(onDismiss, 3000);
      } else {
        setTimeout(onDismiss, 5000);
      }
    } catch {
      setState("failed");
      setTimeout(onDismiss, 5000);
    }
  };

  return (
    <div className={cn(
      "fixed bottom-6 left-1/2 -translate-x-1/2 z-[900]",
      "flex items-center gap-3 px-5 py-3 rounded-2xl",
      "border shadow-[0_8px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl",
      "animate-in slide-in-from-bottom-4 fade-in duration-300",
      state === "reverted"
        ? "bg-emerald-950/90 border-emerald-500/30"
        : state === "failed"
        ? "bg-red-950/90 border-rose-500/30"
        : "bg-white/95 border-accent-blue/20",
    )}>
      {state === "idle" && (
        <>
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-on-surface truncate">Action Executed Successfully.</p>
            <p className="text-[10px] text-on-surface-variant font-mono truncate">{action.toolDisplayName}</p>
          </div>
          <button
            onClick={() => void handleUndo()}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-[11px] font-bold font-mono",
              "bg-purple-500/15 border border-purple-500/30 text-purple-400",
              "hover:bg-purple-500/25 hover:border-purple-500/50",
              "active:scale-[0.97] transition-all",
            )}
          >
            <RotateCcw className="w-3 h-3" />
            Undo
          </button>
          <button onClick={onDismiss} className="text-on-surface-variant hover:text-on-surface-variant transition-colors shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </>
      )}

      {state === "reverting" && (
        <>
          <Loader2 className="w-4 h-4 text-accent-blue animate-spin shrink-0" />
          <p className="text-xs text-accent-blue font-mono">Reverting action…</p>
        </>
      )}

      {state === "reverted" && (
        <>
          <RotateCcw className="w-4 h-4 text-emerald-400 shrink-0" />
          <p className="text-xs text-emerald-400 font-semibold">Action successfully reverted.</p>
        </>
      )}

      {state === "failed" && (
        <>
          <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <p className="text-xs text-rose-400 font-semibold">Revert failed — check audit log.</p>
          <button onClick={onDismiss} className="text-on-surface-variant hover:text-on-surface-variant transition-colors shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
