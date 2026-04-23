import { useState } from "react";
import { Eye, TrendingUp, TrendingDown, Minus, Lightbulb, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useCredits } from "@/contexts/credits-context";
import { AssetReviewModal, type AssetReviewContext } from "@/components/creative/asset-review-modal";
import { BuyCreditsModal } from "@/components/creative/buy-credits-modal";

export interface CreativeAnalysis {
  primarySubject?: string;
  colorPalette?: string[];
  hasTextOverlay?: boolean;
  textContent?: string;
  hasHumanFace?: boolean;
  visualMood?: string;
  productVisibility?: string;
  visualComplexity?: string;
  keyEntities?: string[];
  ctrPrediction?: string;
  insight?: string;
}

export interface CreativeCard {
  adId: string;
  platform: string;
  url: string;
  metrics: { ctr?: number; conversions?: number; spend?: number; clicks?: number };
  analysis: CreativeAnalysis;
  fatigueScore?: number;
  campaignId?: string;
  adSetId?: string;
}

export interface CreativeAutopsyData {
  creatives: CreativeCard[];
  correlations: string[];
  analyzedCount: number;
}

interface CreativeIntelligenceCardProps {
  data: CreativeAutopsyData;
}

const MOOD_COLORS: Record<string, string> = {
  energetic: "text-amber-400 border-amber-400/30 bg-amber-400/10",
  calm: "text-[#60a5fa] border-[#60a5fa]/30 bg-[#60a5fa]/10",
  luxury: "text-purple-400 border-purple-400/30 bg-purple-400/10",
  playful: "text-pink-400 border-pink-400/30 bg-pink-400/10",
  urgent: "text-rose-400 border-rose-400/30 bg-rose-400/10",
  minimal: "text-gray-400 border-gray-400/30 bg-gray-400/10",
};

const CTR_ICONS = {
  high: <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />,
  medium: <Minus className="w-3.5 h-3.5 text-amber-400" />,
  low: <TrendingDown className="w-3.5 h-3.5 text-rose-400" />,
};

// A creative is considered fatigued if:
// - ctrPrediction is "low", or
// - fatigueScore >= 0.6
function isFatigued(creative: CreativeCard): boolean {
  if (creative.analysis.ctrPrediction === "low") return true;
  if (creative.fatigueScore != null && creative.fatigueScore >= 0.6) return true;
  return false;
}

export function CreativeIntelligenceCard({ data }: CreativeIntelligenceCardProps) {
  const { creatives, correlations } = data;
  const { credits, hasAddon }       = useCredits();

  const [reviewCtx,       setReviewCtx]       = useState<AssetReviewContext | null>(null);
  const [showReview,      setShowReview]       = useState(false);
  const [showBuyCredits,  setShowBuyCredits]   = useState(false);

  const fatigued = creatives.filter(isFatigued);

  const openStudio = (creative: CreativeCard) => {
    if (!hasAddon && credits === 0) {
      setShowBuyCredits(true);
      return;
    }
    setReviewCtx({
      adId:         creative.adId,
      platform:     creative.platform,
      imageUrl:     creative.url,
      campaignId:   creative.campaignId,
      adSetId:      creative.adSetId,
      fatigueScore: creative.fatigueScore,
    });
    setShowReview(true);
  };

  return (
    <>
      <div className="mx-4 my-2 rounded-2xl border border-purple-500/20 bg-purple-500/5 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-purple-500/20">
          <div className="p-1.5 rounded-md bg-purple-500/10">
            <Eye className="w-4 h-4 text-purple-400" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-foreground">Creative Autopsy</span>
              <Badge variant="outline" className="text-[9px] font-mono text-purple-400 border-purple-500/30">VERTEX AI VISION</Badge>
            </div>
            <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{data.analyzedCount} creatives analyzed</p>
          </div>
          {credits > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-violet-500/10 border border-violet-500/20">
              <Sparkles className="w-3 h-3 text-violet-400" />
              <span className="text-[9px] font-mono text-violet-400">{credits} credits</span>
            </div>
          )}
        </div>

        {/* ── Fatigue upsell banner ── */}
        {fatigued.length > 0 && (
          <div className={cn(
            "mx-3 mt-3 rounded-xl border px-3 py-2.5 flex items-center gap-3",
            hasAddon || credits > 0
              ? "border-violet-400/30 bg-violet-500/8"
              : "border-amber-400/30 bg-amber-500/8",
          )}>
            <div className={cn(
              "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0",
              hasAddon || credits > 0 ? "bg-violet-500/15" : "bg-amber-500/15",
            )}>
              <Sparkles className={cn("w-3.5 h-3.5", hasAddon || credits > 0 ? "text-violet-400" : "text-amber-400")} />
            </div>
            <div className="flex-1 min-w-0">
              {hasAddon || credits > 0 ? (
                <>
                  <p className="text-xs font-semibold text-violet-300">
                    {fatigued.length} fatigued creative{fatigued.length > 1 ? "s" : ""} detected
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Fix instantly with AI Creative Studio — generate fresh variants below.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs font-semibold text-amber-300">
                    {fatigued.length} fatigued creative{fatigued.length > 1 ? "s" : ""} detected
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Fix instantly with AI Creative Studio{" "}
                    <span className="text-amber-400 font-medium">(Upgrade Required)</span>
                  </p>
                </>
              )}
            </div>
            <button
              onClick={() => {
                if (credits > 0) {
                  openStudio(fatigued[0]);
                } else {
                  setShowBuyCredits(true);
                }
              }}
              className={cn(
                "text-[10px] font-semibold px-2.5 py-1.5 rounded-lg border transition-all whitespace-nowrap",
                hasAddon || credits > 0
                  ? "border-violet-400/40 text-violet-300 hover:bg-violet-500/15"
                  : "border-amber-400/40 text-amber-300 hover:bg-amber-500/15",
              )}
            >
              {hasAddon || credits > 0 ? "Fix Now" : "Get Credits"}
            </button>
          </div>
        )}

        {/* Intelligence Correlations */}
        {correlations.length > 0 && (
          <div className="px-4 py-3 border-b border-border/30 bg-amber-500/5 mt-2">
            <div className="flex items-center gap-1.5 text-amber-400 text-xs font-bold mb-2">
              <Lightbulb className="w-3.5 h-3.5" />
              Performance Correlations
            </div>
            <div className="space-y-1.5">
              {correlations.map((c, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-amber-400/60 shrink-0 mt-0.5">▶</span>
                  <span className="text-foreground/90">{c}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Individual Creative Cards */}
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {creatives.slice(0, 4).map((creative, i) => {
            const fatigued = isFatigued(creative);
            return (
              <div key={i} className={cn(
                "rounded-2xl border overflow-hidden",
                fatigued ? "border-rose-500/30 bg-rose-500/5" : "border-border/30 bg-secondary/10",
              )}>
                {/* Creative Image Preview */}
                <div className="relative h-24 bg-secondary/20 overflow-hidden">
                  {creative.url && (
                    <img
                      src={creative.url}
                      alt={`Creative ${creative.adId}`}
                      className={cn("w-full h-full object-cover", fatigued ? "opacity-60" : "opacity-80")}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  <div className="absolute bottom-2 left-2 flex items-center gap-1">
                    {creative.analysis.ctrPrediction && CTR_ICONS[creative.analysis.ctrPrediction as keyof typeof CTR_ICONS]}
                    <span className="text-[9px] font-mono text-white">CTR {creative.metrics.ctr != null ? `${creative.metrics.ctr}%` : creative.analysis.ctrPrediction ?? "?"}</span>
                  </div>
                  <div className="absolute top-2 right-2 flex items-center gap-1">
                    {fatigued && (
                      <span className="text-[8px] font-mono bg-rose-500/80 border border-rose-400/40 text-white px-1.5 py-0.5 rounded-full">FATIGUED</span>
                    )}
                    <Badge variant="outline" className="text-[8px] font-mono bg-black/60 border-white/20 text-white">{creative.platform}</Badge>
                  </div>
                </div>

                {/* Analysis Tags */}
                <div className="p-2 space-y-1.5">
                  {creative.analysis.visualMood && (
                    <Badge variant="outline" className={cn("text-[8px] font-mono", MOOD_COLORS[creative.analysis.visualMood] ?? "text-muted-foreground")}>
                      {creative.analysis.visualMood}
                    </Badge>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {creative.analysis.hasTextOverlay && (
                      <span className="text-[8px] px-1.5 py-0.5 bg-primary-container/10 text-[#60a5fa] rounded-full border border-primary-container/20">text overlay</span>
                    )}
                    {creative.analysis.hasHumanFace && (
                      <span className="text-[8px] px-1.5 py-0.5 bg-pink-500/10 text-pink-400 rounded-full border border-pink-500/20">human face</span>
                    )}
                    {creative.analysis.visualComplexity && (
                      <span className="text-[8px] px-1.5 py-0.5 bg-secondary/30 text-muted-foreground rounded-full border border-border/30">{creative.analysis.visualComplexity}</span>
                    )}
                  </div>
                  {creative.analysis.insight && (
                    <p className="text-[10px] text-muted-foreground leading-tight line-clamp-2">{creative.analysis.insight}</p>
                  )}
                  {creative.metrics.spend != null && (
                    <p className="text-[9px] font-mono text-muted-foreground/60">${creative.metrics.spend.toFixed(0)} spend · {creative.metrics.conversions ?? 0} conv</p>
                  )}

                  {/* Per-card refresh CTA (only for fatigued creatives) */}
                  {fatigued && (
                    <button
                      onClick={() => openStudio(creative)}
                      className="w-full mt-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 text-[9px] font-semibold text-violet-400 hover:bg-violet-500/20 transition-colors"
                    >
                      <Sparkles className="w-2.5 h-2.5" />
                      {credits > 0 ? "Generate replacement" : "Fix with AI Studio"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <AssetReviewModal
        open={showReview}
        onClose={() => setShowReview(false)}
        context={reviewCtx}
      />

      <BuyCreditsModal
        open={showBuyCredits}
        onClose={() => setShowBuyCredits(false)}
        currentCredits={credits}
      />
    </>
  );
}
