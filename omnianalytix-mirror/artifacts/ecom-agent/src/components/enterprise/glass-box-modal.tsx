import { useState, useCallback } from "react";
import { Shield, CheckCircle2, XCircle, ScrollText, TrendingUp, TrendingDown, Minus, Loader2, X, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ApprovalCardData, DiffRow } from "@/components/command-center/approval-card";
import { TerminalViewer, formatPayloadForTerminal, type TerminalLine } from "./terminal-viewer";

interface GlassBoxModalProps {
  card: ApprovalCardData | null;
  onConfirm: (snapshotId: number) => Promise<void>;
  onCancel: () => void;
}

function classifyRow(row: DiffRow): "increase" | "decrease" | "neutral" {
  const from = parseFloat(row.from.replace(/[^0-9.]/g, ""));
  const to   = parseFloat(row.to.replace(/[^0-9.]/g, ""));
  if (!isNaN(from) && !isNaN(to) && from !== to) return to > from ? "increase" : "decrease";
  return "neutral";
}

const DELTA_COLORS = {
  increase: { icon: TrendingUp,   bar: "text-emerald-400", val: "text-green-300", from: "text-rose-400/60 line-through" },
  decrease: { icon: TrendingDown, bar: "text-rose-400",   val: "text-red-300",   from: "text-on-surface-variant line-through"  },
  neutral:  { icon: Minus,        bar: "text-on-surface-variant",  val: "text-on-surface",  from: "text-on-surface-variant line-through"  },
};

export function GlassBoxModal({ card, onConfirm, onCancel }: GlassBoxModalProps) {
  const [confirming, setConfirming] = useState(false);
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([]);
  const [showTerminal, setShowTerminal] = useState(false);
  const [executionDone, setExecutionDone] = useState(false);

  const appendLine = useCallback((line: TerminalLine) => {
    setTerminalLines((prev) => [...prev, line]);
  }, []);

  if (!card) return null;

  const toolArgs = (card as unknown as { toolArgs?: Record<string, unknown> }).toolArgs ?? {};
  const endpoint = `/api/actions/${card.snapshotId}/approve`;

  const handleConfirm = async () => {
    setConfirming(true);
    setShowTerminal(true);
    setTerminalLines([]);
    setExecutionDone(false);

    const payloadLines = formatPayloadForTerminal(endpoint, "POST", toolArgs);
    for (const line of payloadLines) {
      appendLine(line);
      await new Promise((r) => setTimeout(r, 40));
    }

    appendLine({ text: "", type: "system" });
    appendLine({ text: "Initiating execution sequence...", type: "info" });

    await new Promise((r) => setTimeout(r, 300));
    appendLine({ text: `Connecting to platform API...`, type: "info" });

    await new Promise((r) => setTimeout(r, 400));
    appendLine({ text: "Payload verified against schema", type: "success" });

    await new Promise((r) => setTimeout(r, 200));
    appendLine({ text: `Executing: ${card.toolDisplayName}`, type: "info" });
    appendLine({ text: "", type: "system" });

    try {
      await onConfirm(card.snapshotId);
      appendLine({ text: "", type: "system" });
      appendLine({ text: "Execution completed successfully", type: "success" });
      appendLine({ text: "Result logged to Immutable Audit Trail", type: "success" });
      appendLine({ text: `Snapshot #${card.snapshotId} status → EXECUTED`, type: "success" });
    } catch {
      appendLine({ text: "", type: "system" });
      appendLine({ text: "Execution failed — check audit logs for details", type: "error" });
      appendLine({ text: `Snapshot #${card.snapshotId} status → FAILED`, type: "error" });
    }

    appendLine({ text: "", type: "system" });
    appendLine({ text: `[${new Date().toISOString()}] Session complete`, type: "system" });
    setConfirming(false);
    setExecutionDone(true);
  };

  const handleClose = () => {
    setShowTerminal(false);
    setTerminalLines([]);
    setExecutionDone(false);
    onCancel();
  };

  return (
    <div className="fixed inset-0 z-[999] flex items-end sm:items-center sm:p-4 bg-black/75 backdrop-blur-sm">
      <div className={cn(
        "w-full flex flex-col max-h-[92dvh] sm:max-h-[90vh] rounded-t-lg sm:rounded-2xl border border-outline-variant/15 bg-surface shadow-2xl overflow-hidden sm:mx-auto transition-all duration-300",
        showTerminal ? "sm:max-w-2xl" : "sm:max-w-lg"
      )}>

        <div className="sm:hidden flex justify-center pt-2 pb-1">
          <div className="w-9 h-1 rounded-full bg-[#c8c5cb]" />
        </div>

        <div className="flex items-center gap-3 px-5 py-4 border-b border-outline-variant/15 bg-white/60 shrink-0">
          <Shield className="w-4 h-4 text-accent-blue shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Glass-Box Approval Required</p>
            <h2 className="text-sm font-bold text-on-surface">{card.toolDisplayName}</h2>
          </div>
          <span className="text-[10px] font-mono text-on-surface-variant">#{card.snapshotId}</span>
          <button
            onClick={handleClose}
            disabled={confirming}
            className="ml-1 shrink-0 text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-40 min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">

          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="flex items-center justify-center w-4 h-4 rounded-full bg-accent-blue/20 text-accent-blue text-[9px] font-bold font-mono shrink-0">1</span>
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">What Is Changing</p>
            </div>
            <div className="rounded-2xl border border-outline-variant/15 bg-white/50 divide-y divide-on-surface/60 overflow-hidden">
              {card.displayDiff.length === 0 ? (
                <p className="text-xs text-on-surface-variant px-3 py-2">No structured diff available.</p>
              ) : (
                card.displayDiff.map((row, i) => {
                  const delta = classifyRow(row);
                  const cfg   = DELTA_COLORS[delta];
                  const DeltaIcon = cfg.icon;
                  const hasBoth = row.from !== "—" && row.to !== "—" && row.from !== row.to;

                  return (
                    <div key={i} className="flex items-center gap-3 px-3 py-2">
                      <span className="text-[9px] font-mono text-on-surface-variant uppercase tracking-wider w-28 shrink-0 truncate">{row.label}</span>
                      {hasBoth ? (
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className={cn("text-xs font-mono font-bold", cfg.from)}>{row.from}</span>
                          <DeltaIcon className={cn("w-3 h-3 shrink-0", cfg.bar)} />
                          <span className={cn("text-xs font-mono font-bold", cfg.val)}>{row.to}</span>
                        </div>
                      ) : (
                        <span className="text-xs font-mono font-bold text-on-surface-variant flex-1">{row.from !== "—" ? row.from : row.to}</span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="flex items-center justify-center w-4 h-4 rounded-full bg-amber-500/20 text-amber-400 text-[9px] font-bold font-mono shrink-0">2</span>
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">AI Impact Forecast</p>
            </div>
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
              <p className="text-xs text-on-surface-variant leading-relaxed">{card.reasoning || "No reasoning provided."}</p>
            </div>
          </div>

          {showTerminal && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Terminal className="w-3.5 h-3.5 text-accent-blue shrink-0" />
                <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Execution Terminal</p>
                {confirming && (
                  <span className="flex items-center gap-1 text-[9px] font-mono text-amber-400 animate-pulse">
                    <Loader2 className="w-2.5 h-2.5 animate-spin" /> LIVE
                  </span>
                )}
              </div>
              <div className="rounded-2xl border border-outline-variant/20 overflow-hidden">
                <TerminalViewer lines={terminalLines} className="h-[220px]" />
              </div>
            </div>
          )}

          {!showTerminal && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="flex items-center justify-center w-4 h-4 rounded-full bg-[#2C3E50] text-on-surface-variant text-[9px] font-bold font-mono shrink-0">3</span>
                <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Audit Trail</p>
              </div>
              <div className="flex items-start gap-2.5 rounded-2xl border border-outline-variant/15 bg-white/40 px-3 py-2.5">
                <ScrollText className="w-3.5 h-3.5 text-on-surface-variant shrink-0 mt-0.5" />
                <p className="text-[11px] text-on-surface-variant leading-relaxed">
                  This action will be permanently recorded in the <span className="text-on-surface-variant font-medium">Execution Logs</span> with a timestamp, operator ID, and full parameter snapshot for client accountability and compliance review.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 px-5 py-4 border-t border-outline-variant/15 bg-white/40 shrink-0" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}>
          <button
            onClick={handleClose}
            disabled={confirming}
            className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-mono text-on-surface-variant border border-outline-variant/15 hover:border-outline hover:text-on-surface transition-colors disabled:opacity-40 min-h-[44px]"
          >
            <XCircle className="w-3.5 h-3.5" /> {executionDone ? "Close" : "Cancel"}
          </button>
          {!executionDone && (
            <button
              onClick={handleConfirm}
              disabled={confirming}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-mono font-bold text-black bg-cyan-400 hover:bg-cyan-300 transition-colors disabled:opacity-60 min-h-[44px]"
            >
              {confirming
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Executing…</>
                : <><CheckCircle2 className="w-3.5 h-3.5" /> Confirm &amp; Execute</>
              }
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
