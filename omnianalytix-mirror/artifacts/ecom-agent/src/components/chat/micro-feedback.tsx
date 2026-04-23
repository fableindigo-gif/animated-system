import { useState } from "react";
import { ThumbsUp, ThumbsDown, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth-fetch";

const BASE = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

const QUICK_REASONS = [
  "Inaccurate Data",
  "Bad AI Advice",
  "UI Glitch / Broken",
  "Confusing / Hard to Read",
  "Too Slow",
] as const;

type Reason = typeof QUICK_REASONS[number];

interface MicroFeedbackProps {
  messageExcerpt?: string;
}

export function MicroFeedback({ messageExcerpt }: MicroFeedbackProps) {
  const [sentiment, setSentiment] = useState<"up" | "down" | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<Set<Reason>>(new Set());
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done">("idle");

  const toggleReason = (r: Reason) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(r) ? next.delete(r) : next.add(r);
      return next;
    });
  };

  const handleThumbsUp = async () => {
    if (status === "done" || sentiment === "up") return;
    setSentiment("up");
    setExpanded(false);
    setStatus("submitting");
    try {
      await authFetch(`${API_BASE}api/system/feedback/micro`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentiment: "up", reasons: [], textContext: "", messageExcerpt: messageExcerpt ?? "" }),
      });
    } catch { /* best-effort */ }
    setStatus("done");
  };

  const handleThumbsDown = () => {
    if (status === "done") return;
    if (sentiment === "down" && expanded) {
      setExpanded(false);
      setSentiment(null);
      return;
    }
    setSentiment("down");
    setExpanded(true);
  };

  const handleSubmit = async () => {
    if (selected.size === 0 || status === "submitting") return;
    setStatus("submitting");
    try {
      await authFetch(`${API_BASE}api/system/feedback/micro`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sentiment: "down",
          reasons: Array.from(selected),
          textContext: text.trim(),
          messageExcerpt: messageExcerpt ?? "",
        }),
      });
    } catch { /* best-effort */ }
    setStatus("done");
    setExpanded(false);
  };

  return (
    <div className="mt-1">
      {/* Thumbs row — sits inline with the action toolbar */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={handleThumbsUp}
          title="Good response"
          disabled={status === "done"}
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono transition-colors",
            sentiment === "up"
              ? "text-emerald-400"
              : "text-on-surface-variant hover:text-on-surface-variant hover:bg-surface",
            "disabled:cursor-default",
          )}
        >
          {status === "done" && sentiment === "up"
            ? <Check className="w-3 h-3 text-emerald-400" />
            : <ThumbsUp className="w-3 h-3" />
          }
        </button>

        <button
          onClick={handleThumbsDown}
          title="Flag this response"
          disabled={status === "done"}
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono transition-colors",
            sentiment === "down"
              ? "text-rose-400"
              : "text-on-surface-variant hover:text-on-surface-variant hover:bg-surface",
            status === "done" && "cursor-default",
          )}
        >
          {status === "done" && sentiment === "down"
            ? <Check className="w-3 h-3 text-rose-400" />
            : <ThumbsDown className="w-3 h-3" />
          }
        </button>

        {status === "done" && (
          <span className="text-[10px] font-mono text-on-surface-variant ml-1">Thanks for the feedback</span>
        )}
      </div>

      {/* Expandable chip panel — slides in below thumbs row */}
      {expanded && status !== "done" && (
        <div className="mt-2 rounded-2xl border border-outline-variant/15 bg-white/70 p-3 space-y-3 animate-in slide-in-from-top-1 duration-150">
          {/* Header */}
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">
            What went wrong?
          </p>

          {/* Quick-select chips */}
          <div className="flex flex-wrap gap-1.5">
            {QUICK_REASONS.map((reason) => {
              const isActive = selected.has(reason);
              return (
                <button
                  key={reason}
                  onClick={() => toggleReason(reason)}
                  className={cn(
                    "text-xs border rounded-full px-2.5 py-1 transition-all duration-100 font-mono",
                    isActive
                      ? "bg-error-container border-error-m3/20 text-error-m3"
                      : "border-outline-variant/15 text-on-surface-variant hover:bg-surface hover:text-on-surface hover:border-outline",
                  )}
                >
                  {reason}
                </button>
              );
            })}
          </div>

          {/* Optional details textarea */}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add details (Optional)..."
            rows={2}
            className="w-full bg-surface border border-outline-variant/15 rounded-md px-3 py-2 text-xs font-mono text-on-surface-variant placeholder:text-on-surface-variant outline-none focus:border-outline resize-none transition-colors"
          />

          {/* Actions */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => { setExpanded(false); setSentiment(null); setSelected(new Set()); setText(""); }}
              className="text-[10px] font-mono text-on-surface-variant hover:text-on-surface-variant transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={selected.size === 0 || status === "submitting"}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-mono font-semibold transition-all",
                selected.size > 0
                  ? "bg-error-container border border-error-m3/20 text-error-m3 hover:bg-[#fecdd3]"
                  : "bg-surface border border-outline-variant/15 text-on-surface-variant cursor-not-allowed",
              )}
            >
              {status === "submitting"
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Sending…</>
                : "Submit"
              }
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
