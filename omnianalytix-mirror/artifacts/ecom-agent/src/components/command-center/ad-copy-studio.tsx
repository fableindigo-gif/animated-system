import { useState } from "react";
import { Copy, Check, Zap, ChevronDown, ChevronUp, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface AdHook { id: string; text: string; type: string }
export interface AdDescription { id: string; text: string; focus: string }
export interface AdMatrix { hookId: string; descriptionId: string; recommendedCTA: string; fitScore: number; notes?: string }
export interface TopCombination { hookId: string; descriptionId: string; cta: string; reasoning: string }

export interface AdCopyMatrixData {
  hooks: AdHook[];
  descriptions: AdDescription[];
  ctas: string[];
  matrix: AdMatrix[];
  topCombination: TopCombination;
  platform: string;
  productName: string;
}

interface AdCopyStudioProps {
  data: AdCopyMatrixData;
  onDeploy?: (combo: { hook: string; description: string; cta: string; platform: string }) => void;
}

const HOOK_TYPE_COLORS: Record<string, string> = {
  pain_point: "text-rose-400 border-rose-400/30 bg-rose-400/5",
  benefit: "text-emerald-400 border-emerald-400/30 bg-emerald-400/5",
  curiosity: "text-amber-400 border-amber-400/30 bg-amber-400/5",
  social_proof: "text-[#60a5fa] border-[#60a5fa]/30 bg-[#60a5fa]/5",
  urgency: "text-orange-400 border-orange-400/30 bg-orange-400/5",
};

const FOCUS_COLORS: Record<string, string> = {
  feature: "text-[#60a5fa]",
  emotional: "text-pink-400",
  proof: "text-emerald-400",
  value: "text-amber-400",
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={handleCopy} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-secondary/60">
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
    </button>
  );
}

export function AdCopyStudio({ data, onDeploy }: AdCopyStudioProps) {
  const [expandedMatrix, setExpandedMatrix] = useState(false);
  const [selectedHook, setSelectedHook] = useState<string | null>(data.topCombination?.hookId ?? null);
  const [selectedDesc, setSelectedDesc] = useState<string | null>(data.topCombination?.descriptionId ?? null);

  const { hooks, descriptions, matrix, topCombination } = data;
  const selectedHookObj = hooks.find((h) => h.id === selectedHook);
  const selectedDescObj = descriptions.find((d) => d.id === selectedDesc);
  const selectedCombo = matrix.find((m) => m.hookId === selectedHook && m.descriptionId === selectedDesc);

  const handleDeploy = () => {
    if (!selectedHookObj || !selectedDescObj || !selectedCombo) return;
    onDeploy?.({
      hook: selectedHookObj.text,
      description: selectedDescObj.text,
      cta: selectedCombo.recommendedCTA,
      platform: data.platform,
    });
  };

  return (
    <div className="mx-4 my-2 rounded-2xl border border-amber-500/20 bg-amber-500/5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-amber-500/20">
        <div className="p-1.5 rounded-md bg-amber-500/10">
          <Zap className="w-4 h-4 text-amber-400" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-foreground">Ad Copy Studio</span>
            <Badge variant="outline" className="text-[9px] font-mono text-amber-400 border-amber-500/30">{data.platform.toUpperCase()}</Badge>
          </div>
          <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{data.productName} · {hooks.length} {hooks.length === 1 ? "hook" : "hooks"} × {descriptions.length} {descriptions.length === 1 ? "description" : "descriptions"}</p>
        </div>
      </div>

      {/* Top Recommendation */}
      {topCombination && (
        <div className="px-4 py-3 border-b border-border/30 bg-amber-500/5">
          <div className="flex items-center gap-1.5 text-amber-400 text-xs font-bold mb-2">
            <Star className="w-3.5 h-3.5" />
            Top Recommended Combination
          </div>
          <p className="text-xs text-muted-foreground mb-2 italic">"{topCombination.reasoning}"</p>
          {selectedHookObj && (
            <div className="group flex items-start gap-2 mb-1">
              <span className="text-[9px] font-mono text-amber-400 mt-1 shrink-0">{topCombination.hookId}</span>
              <span className="text-sm text-foreground font-medium flex-1">"{selectedHookObj.text}"</span>
              <CopyButton text={selectedHookObj.text} />
            </div>
          )}
          {selectedDescObj && (
            <div className="group flex items-start gap-2">
              <span className="text-[9px] font-mono text-[#60a5fa] mt-1 shrink-0">{topCombination.descriptionId}</span>
              <span className="text-xs text-muted-foreground flex-1">{selectedDescObj.text}</span>
              <CopyButton text={selectedDescObj.text} />
            </div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="outline" className="text-[9px] font-mono text-emerald-400 border-emerald-400/30">{topCombination.cta}</Badge>
            {selectedCombo && <span className="text-[9px] font-mono text-muted-foreground">Fit Score: {selectedCombo.fitScore}/100</span>}
          </div>
        </div>
      )}

      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Hooks */}
        <div>
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-2">Hooks / Headlines</p>
          <div className="space-y-1.5">
            {hooks.map((h) => (
              <button
                key={h.id}
                onClick={() => setSelectedHook(h.id === selectedHook ? null : h.id)}
                className={cn(
                  "group w-full text-left p-2 rounded-2xl border text-xs transition-all",
                  selectedHook === h.id
                    ? "border-amber-400/40 bg-amber-400/10"
                    : "border-border/30 bg-secondary/10 hover:border-border/60",
                )}
              >
                <div className="flex items-start justify-between gap-1 mb-1">
                  <span className="text-[9px] font-mono text-muted-foreground">{h.id}</span>
                  <div className="flex items-center gap-1">
                    <Badge variant="outline" className={cn("text-[8px] font-mono", HOOK_TYPE_COLORS[h.type] ?? "text-muted-foreground")}>
                      {h.type?.replace(/_/g, " ")}
                    </Badge>
                    <CopyButton text={h.text} />
                  </div>
                </div>
                <p className="text-foreground leading-snug">{h.text}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Descriptions */}
        <div>
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-2">Descriptions / Body Copy</p>
          <div className="space-y-1.5">
            {descriptions.map((d) => (
              <button
                key={d.id}
                onClick={() => setSelectedDesc(d.id === selectedDesc ? null : d.id)}
                className={cn(
                  "group w-full text-left p-2 rounded-2xl border text-xs transition-all",
                  selectedDesc === d.id
                    ? "border-[#60a5fa]/40 bg-[#60a5fa]/10"
                    : "border-border/30 bg-secondary/10 hover:border-border/60",
                )}
              >
                <div className="flex items-start justify-between gap-1 mb-1">
                  <span className="text-[9px] font-mono text-muted-foreground">{d.id}</span>
                  <div className="flex items-center gap-1">
                    <span className={cn("text-[9px] font-mono", FOCUS_COLORS[d.focus] ?? "text-muted-foreground")}>{d.focus}</span>
                    <CopyButton text={d.text} />
                  </div>
                </div>
                <p className="text-foreground/90 leading-snug line-clamp-3">{d.text}</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Deploy Row */}
      {selectedHookObj && selectedDescObj && (
        <div className="px-4 pb-4 flex items-center gap-3">
          <div className="flex-1 text-xs text-muted-foreground">
            Selected: <span className="text-foreground">{selectedHookObj.id}</span> + <span className="text-foreground">{selectedDescObj.id}</span>
            {selectedCombo && <span className="ml-2 text-amber-400">· Fit: {selectedCombo.fitScore}/100</span>}
          </div>
          {onDeploy && (
            <Button size="sm" onClick={handleDeploy} className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-mono text-xs h-8">
              <Zap className="w-3.5 h-3.5" />
              DEPLOY COPY
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => {
            const text = `Hook: ${selectedHookObj.text}\n\nDescription: ${selectedDescObj.text}\n\nCTA: ${selectedCombo?.recommendedCTA ?? ""}`;
            navigator.clipboard.writeText(text);
          }} className="gap-1.5 font-mono text-xs h-8">
            <Copy className="w-3.5 h-3.5" />
            Copy All
          </Button>
        </div>
      )}

      {/* Full Matrix Toggle */}
      {matrix.length > 0 && (
        <div className="border-t border-border/30">
          <button
            onClick={() => setExpandedMatrix(!expandedMatrix)}
            className="w-full flex items-center justify-between px-4 py-2 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>All {matrix.length} {matrix.length === 1 ? "combination" : "combinations"} ranked by fit score</span>
            {expandedMatrix ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {expandedMatrix && (
            <div className="px-4 pb-3 space-y-1 max-h-48 overflow-y-auto">
              {[...matrix].sort((a, b) => b.fitScore - a.fitScore).slice(0, 15).map((m, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground py-1 border-b border-border/10">
                  <span className="font-mono text-amber-400/60 w-5">{i + 1}</span>
                  <span className="font-mono text-[10px] text-amber-400">{m.hookId}</span>
                  <span className="text-muted-foreground/40">+</span>
                  <span className="font-mono text-[10px] text-[#60a5fa]">{m.descriptionId}</span>
                  <span className="ml-auto font-mono text-[10px] text-emerald-400">{m.fitScore}/100</span>
                  <Badge variant="outline" className="text-[8px] font-mono">{m.recommendedCTA}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
