import { useState, useEffect } from "react";
import { authFetch, authPost } from "@/lib/auth-fetch";
import { useWorkspace } from "@/contexts/workspace-context";
import { useCredits } from "@/contexts/credits-context";
import { BuyCreditsModal } from "./buy-credits-modal";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SiMeta, SiGoogleads } from "react-icons/si";
import { cn } from "@/lib/utils";

const BASE     = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

interface GeneratedImage {
  url:           string;
  variantIndex:  number;
  revisedPrompt?: string;
}

export interface AssetReviewContext {
  adId:       string;
  platform:   string;
  imageUrl:   string;
  campaignId?: string;
  adSetId?:   string;
  headline?:  string;
  fatigueScore?: number;
}

interface AssetReviewModalProps {
  open:           boolean;
  onClose:        () => void;
  context:        AssetReviewContext | null;
}

type PushStatus = "idle" | "pushing" | "success" | "error";

interface PushState {
  imageUrl: string;
  platform: string;
  status:   PushStatus;
  detail?:  string;
}

export function AssetReviewModal({ open, onClose, context }: AssetReviewModalProps) {
  const { activeWorkspace }      = useWorkspace();
  const { credits, refresh: refreshCredits } = useCredits();

  const [prompt, setPrompt]           = useState("");
  const [generating, setGenerating]   = useState(false);
  const [images, setImages]           = useState<GeneratedImage[]>([]);
  const [selected, setSelected]       = useState<number | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [genError, setGenError]       = useState<string | null>(null);
  const [variantCount, setVariantCount] = useState(2);
  const [pushState, setPushState]     = useState<PushState | null>(null);
  const [showBuyCredits, setShowBuyCredits] = useState(false);
  const [creditsUsed, setCreditsUsed] = useState(0);
  const [creditsRemaining, setCreditsRemaining] = useState(credits);

  useEffect(() => {
    if (!open) {
      setImages([]);
      setSelected(null);
      setError(null);
      setGenError(null);
      setPushState(null);
      setCreditsUsed(0);
    }
  }, [open]);

  useEffect(() => {
    setCreditsRemaining(credits);
  }, [credits]);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setGenError("Please describe the creative you want to generate.");
      return;
    }
    if (creditsRemaining < variantCount) {
      setGenError(`You need ${variantCount} credits but only have ${creditsRemaining}. Buy more credits to continue.`);
      return;
    }
    setGenerating(true);
    setGenError(null);
    setImages([]);
    setSelected(null);
    try {
      const res  = await authPost(`${API_BASE}api/ai/creative/generate`, {
        prompt:   prompt.trim(),
        imageUrl: context?.imageUrl,
        count:    variantCount,
      });
      const data = await res.json() as {
        images?:           GeneratedImage[];
        creditsUsed?:      number;
        creditsRemaining?: number;
        error?:            string;
        detail?:           string;
        code?:             string;
      };

      if (!res.ok) {
        if (data.code === "INSUFFICIENT_CREDITS") {
          setGenError(`Insufficient credits. You have ${creditsRemaining} but need ${variantCount}.`);
        } else {
          setGenError(data.error ?? "Generation failed. Please try again.");
        }
        return;
      }

      setImages(data.images ?? []);
      setCreditsUsed(data.creditsUsed ?? 0);
      setCreditsRemaining(data.creditsRemaining ?? 0);
      await refreshCredits();
      if (data.images && data.images.length > 0) setSelected(0);
    } catch {
      setGenError("Network error. Please check your connection.");
    } finally {
      setGenerating(false);
    }
  };

  const handlePush = async (targetPlatform: "meta" | "google_ads") => {
    const img = selected !== null ? images[selected] : null;
    if (!img) return;

    setPushState({ imageUrl: img.url, platform: targetPlatform, status: "pushing" });

    try {
      const res  = await authPost(`${API_BASE}api/ai/creative/push`, {
        imageUrl:   img.url,
        platform:   targetPlatform,
        campaignId: context?.campaignId,
        adSetId:    context?.adSetId,
        headline:   context?.headline ?? prompt.substring(0, 40),
        workspaceId: activeWorkspace?.id,
      });
      const data = await res.json() as { success?: boolean; error?: string; detail?: string; configured?: boolean; creativeId?: string; resourceName?: string };

      if (!res.ok) {
        setPushState({
          imageUrl: img.url,
          platform: targetPlatform,
          status:   "error",
          detail:   data.detail ?? data.error ?? "Push failed.",
        });
        return;
      }

      setPushState({
        imageUrl: img.url,
        platform: targetPlatform,
        status:   "success",
        detail:   data.creativeId ?? data.resourceName ?? "Asset added to library",
      });
    } catch {
      setPushState({
        imageUrl: img.url,
        platform: targetPlatform,
        status:   "error",
        detail:   "Network error during push.",
      });
    }
  };

  const selectedImage = selected !== null ? images[selected] : null;

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden max-h-[92dvh] flex flex-col">
          {/* ── Header ── */}
          <DialogHeader className="px-5 py-4 border-b border-slate-200 shrink-0 space-y-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-2xl bg-violet-100 flex items-center justify-center">
                <span className="material-symbols-outlined text-violet-600" style={{ fontSize: 20 }}>
                  auto_awesome
                </span>
              </div>
              <div className="flex-1 text-left">
                <DialogDescription className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                  AI Creative Studio
                </DialogDescription>
                <DialogTitle className="text-sm font-bold text-slate-900">
                  Generate & Review Ad Variants
                </DialogTitle>
              </div>
              <div className="flex-shrink-0 flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-slate-500">Credits:</span>
                <span className={cn(
                  "text-xs font-bold px-2 py-0.5 rounded-full",
                  creditsRemaining > 10
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : creditsRemaining > 0
                    ? "bg-amber-50 text-amber-700 border border-amber-200"
                    : "bg-rose-50 text-rose-700 border border-rose-200",
                )}>
                  {creditsRemaining.toLocaleString()}
                </span>
                <button
                  onClick={() => setShowBuyCredits(true)}
                  className="text-[10px] text-violet-600 hover:underline font-medium"
                >
                  Buy more
                </button>
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto">
            {/* ── Source creative info ── */}
            {context && (
              <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-3">
                {context.imageUrl ? (
                  <img
                    src={context.imageUrl}
                    alt="Source creative"
                    className="w-12 h-12 rounded-lg object-cover border border-slate-200"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-slate-200 flex items-center justify-center">
                    <span className="material-symbols-outlined text-slate-400" style={{ fontSize: 20 }}>image</span>
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-700 truncate">Source: Ad {context.adId}</p>
                  <p className="text-[11px] text-slate-500">{context.platform.toUpperCase()}</p>
                  {context.fatigueScore !== undefined && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                      <span className="text-[10px] text-rose-600 font-mono">Fatigue score: {(context.fatigueScore * 100).toFixed(0)}%</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Prompt input ── */}
            <div className="px-5 pt-4 pb-3 space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Describe your new creative</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g. Modern minimalist product shot with soft white background, golden hour lighting, lifestyle feel. No text overlay."
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 placeholder-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400"
                  rows={3}
                />
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-medium text-slate-600 whitespace-nowrap">Variants:</label>
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      onClick={() => setVariantCount(n)}
                      className={cn(
                        "w-7 h-7 rounded-lg text-xs font-semibold transition-all",
                        variantCount === n
                          ? "bg-violet-600 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                      )}
                    >
                      {n}
                    </button>
                  ))}
                  <span className="text-[10px] text-slate-400">({variantCount} credit{variantCount > 1 ? "s" : ""})</span>
                </div>
                <div className="flex-1" />
                <Button
                  onClick={handleGenerate}
                  disabled={generating || creditsRemaining === 0}
                  size="sm"
                  className="bg-violet-600 hover:bg-violet-700 text-white px-4"
                >
                  {generating ? (
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin mr-1.5" />
                  ) : (
                    <span className="material-symbols-outlined mr-1.5" style={{ fontSize: 16 }}>auto_awesome</span>
                  )}
                  {generating ? "Generating…" : "Generate"}
                </Button>
              </div>
              {creditsRemaining === 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200">
                  <span className="material-symbols-outlined text-amber-500" style={{ fontSize: 16 }}>warning</span>
                  <p className="text-xs text-amber-700">No credits remaining.</p>
                  <button onClick={() => setShowBuyCredits(true)} className="text-xs text-violet-600 hover:underline font-medium ml-1">
                    Buy credits →
                  </button>
                </div>
              )}
              {genError && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-rose-50 border border-rose-200">
                  <span className="material-symbols-outlined text-rose-500 flex-shrink-0 mt-0.5" style={{ fontSize: 16 }}>error</span>
                  <p className="text-xs text-rose-700">{genError}</p>
                </div>
              )}
            </div>

            {/* ── Generating placeholder ── */}
            {generating && (
              <div className="px-5 pb-4">
                <div className="grid grid-cols-2 gap-3">
                  {Array.from({ length: variantCount }).map((_, i) => (
                    <div key={i} className="aspect-square rounded-2xl bg-slate-100 animate-pulse flex flex-col items-center justify-center gap-2">
                      <span className="material-symbols-outlined text-slate-300" style={{ fontSize: 32 }}>auto_awesome</span>
                      <p className="text-[10px] text-slate-400 font-mono">Generating variant {i + 1}…</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Generated variants grid ── */}
            {images.length > 0 && !generating && (
              <div className="px-5 pb-4 space-y-3">
                {creditsUsed > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <p className="text-[11px] text-slate-500">{creditsUsed} credit{creditsUsed > 1 ? "s" : ""} used — {creditsRemaining} remaining</p>
                  </div>
                )}
                <div className={cn("grid gap-3", images.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
                  {images.map((img, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSelected(i)}
                      className={cn(
                        "relative aspect-square rounded-2xl overflow-hidden border-2 transition-all",
                        selected === i
                          ? "border-violet-500 ring-2 ring-violet-400/30"
                          : "border-slate-200 hover:border-slate-300",
                      )}
                    >
                      <img
                        src={img.url}
                        alt={`Variant ${i + 1}`}
                        className="w-full h-full object-cover"
                      />
                      {selected === i && (
                        <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-violet-600 flex items-center justify-center">
                          <span className="material-symbols-outlined text-white" style={{ fontSize: 14 }}>check</span>
                        </div>
                      )}
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/50 to-transparent py-1.5 px-2">
                        <p className="text-[9px] text-white font-mono">Variant {i + 1}</p>
                      </div>
                    </button>
                  ))}
                </div>
                {selectedImage?.revisedPrompt && (
                  <p className="text-[10px] text-slate-400 italic leading-relaxed">
                    DALL-E revised: "{selectedImage.revisedPrompt.substring(0, 140)}{selectedImage.revisedPrompt.length > 140 ? "…" : ""}"
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── Push to platform footer ── */}
          {selectedImage && (
            <div className="px-5 py-4 border-t border-slate-200 bg-slate-50/40 shrink-0" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}>
              {pushState?.status === "success" ? (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200">
                  <span className="material-symbols-outlined text-emerald-500" style={{ fontSize: 18 }}>check_circle</span>
                  <div>
                    <p className="text-xs font-semibold text-emerald-800">Creative pushed successfully</p>
                    {pushState.detail && (
                      <p className="text-[10px] text-emerald-700 font-mono mt-0.5">{pushState.detail}</p>
                    )}
                  </div>
                </div>
              ) : pushState?.status === "error" ? (
                <div className="space-y-2">
                  <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-rose-50 border border-rose-200">
                    <span className="material-symbols-outlined text-rose-500 flex-shrink-0 mt-0.5" style={{ fontSize: 16 }}>error</span>
                    <p className="text-xs text-rose-700">{pushState.detail ?? "Push failed."}</p>
                  </div>
                  <PushButtons context={context} pushing={false} onPush={handlePush} />
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-700">Push selected variant to:</p>
                  <PushButtons
                    context={context}
                    pushing={pushState?.status === "pushing"}
                    onPush={handlePush}
                  />
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <BuyCreditsModal
        open={showBuyCredits}
        onClose={() => setShowBuyCredits(false)}
        currentCredits={creditsRemaining}
      />
    </>
  );
}

function PushButtons({
  context,
  pushing,
  onPush,
}: {
  context: AssetReviewContext | null;
  pushing: boolean;
  onPush: (platform: "meta" | "google_ads") => void;
}) {
  return (
    <div className="flex gap-2">
      <button
        disabled={pushing}
        onClick={() => onPush("meta")}
        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#1877F2] hover:bg-[#1565d8] text-white text-sm font-medium transition-colors disabled:opacity-60"
      >
        {pushing ? (
          <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        ) : (
          <SiMeta className="w-3.5 h-3.5" />
        )}
        Push to Meta
      </button>
      <button
        disabled={pushing}
        onClick={() => onPush("google_ads")}
        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#1a73e8] hover:bg-[#1a66d0] text-white text-sm font-medium transition-colors disabled:opacity-60"
      >
        {pushing ? (
          <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        ) : (
          <SiGoogleads className="w-3.5 h-3.5" />
        )}
        Push to Google
      </button>
    </div>
  );
}
