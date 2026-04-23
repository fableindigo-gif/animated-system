import { MousePointer2 } from "lucide-react";

export interface ClarificationOption {
  label: string;
  value: string;
}

export interface ClarificationState {
  message: string;
  options: ClarificationOption[];
}

interface ClarificationChipsProps {
  state: ClarificationState;
  onSelect: (value: string, label: string) => void;
}

export function ClarificationChips({ state, onSelect }: ClarificationChipsProps) {
  return (
    <div className="mx-4 mb-3 border border-accent-blue/20 bg-surface rounded-2xl overflow-hidden shadow-lg shadow-black/20">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#0081FB]/10 bg-white">
        <MousePointer2 className="w-3 h-3 text-accent-blue shrink-0" />
        <span className="text-[10px] font-mono text-accent-blue uppercase tracking-[0.15em]">
          Select to continue — no open-ended questions
        </span>
      </div>
      <div className="p-3 space-y-2.5">
        <p className="text-[11px] text-on-surface-variant font-mono leading-relaxed px-1">
          {state.message}
        </p>
        <div className="flex flex-wrap gap-2">
          {state.options.map((opt, i) => (
            <button
              key={i}
              onClick={() => onSelect(opt.value, opt.label)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl border border-accent-blue/20 bg-accent-blue/5 hover:bg-accent-blue/15 hover:border-[#0081FB]/60 text-accent-blue text-[11px] font-mono transition-all cursor-pointer active:scale-95"
            >
              <span className="text-accent-blue/50 text-[9px]">{String(i + 1).padStart(2, "0")}</span>
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── JSON Parser ──────────────────────────────────────────────────────────────
// Extracts structured clarification JSON from AI response content.
// Handles both raw JSON and markdown-wrapped JSON blocks.

export function parseClarificationJSON(content: string): {
  isClarification: true;
  state: ClarificationState;
  cleanContent: string;
} | { isClarification: false } {
  const patterns = [
    /```(?:json)?\s*(\{[\s\S]*?"status"\s*:\s*"requires_clarification"[\s\S]*?\})\s*```/,
    /(\{[\s\S]*?"status"\s*:\s*"requires_clarification"[\s\S]*?\})/,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      try {
        const parsed = JSON.parse(match[1]) as {
          status: string;
          message?: string;
          options?: ClarificationOption[];
        };
        if (
          parsed.status === "requires_clarification" &&
          Array.isArray(parsed.options) &&
          parsed.options.length > 0
        ) {
          const before = content.slice(0, match.index).trim();
          return {
            isClarification: true,
            state: {
              message: parsed.message ?? "Multiple matches found. Select to proceed:",
              options: parsed.options.slice(0, 5),
            },
            cleanContent: before || "Multiple options found — select to proceed:",
          };
        }
      } catch {
        /* not valid JSON — continue */
      }
    }
  }

  return { isClarification: false };
}
