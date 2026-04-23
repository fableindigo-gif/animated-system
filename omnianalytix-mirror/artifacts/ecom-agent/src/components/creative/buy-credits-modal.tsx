import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { authFetch, authPost } from "@/lib/auth-fetch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BASE     = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

interface BuyCreditsModalProps {
  open:     boolean;
  onClose:  () => void;
  currentCredits?: number;
}

const PACKS = [
  {
    key:       "starter",
    credits:   1000,
    price:     "$19",
    perCredit: "$0.019",
    label:     "Starter",
    popular:   false,
    desc:      "Best for exploration and small campaigns",
  },
  {
    key:       "growth",
    credits:   5000,
    price:     "$79",
    perCredit: "$0.016",
    label:     "Growth",
    popular:   true,
    desc:      "Most popular — best value for active teams",
  },
  {
    key:       "professional",
    credits:   20000,
    price:     "$249",
    perCredit: "$0.012",
    label:     "Professional",
    popular:   false,
    desc:      "High-volume agencies running continuous refresh cycles",
  },
] as const;

type PackKey = typeof PACKS[number]["key"];

export function BuyCreditsModal({ open, onClose, currentCredits = 0 }: BuyCreditsModalProps) {
  const [selected, setSelected] = useState<PackKey>("growth");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  const handlePurchase = async () => {
    setLoading(true);
    setError("");
    try {
      const configRes = await authFetch(`${API_BASE}api/billing/config`);
      const config    = await configRes.json() as { configured: boolean; publishableKey: string | null };

      const res  = await authPost(`${API_BASE}api/billing/credits/checkout`, { pack: selected });
      const data = await res.json() as { url?: string; sessionId?: string; error?: string; message?: string; code?: string };

      if (!res.ok) {
        setError(data.message ?? data.error ?? "Checkout failed. Please try again.");
        return;
      }

      if (data.url) {
        window.location.href = data.url;
        return;
      }
      // Stripe.js v3+ removed `redirectToCheckout`; the backend must always
      // return a hosted-checkout `url`. If we got here without one, surface a
      // clear error rather than silently dropping the user on an empty state.
      setError("Unable to start checkout (missing redirect URL). Please contact support@omnianalytix.in.");
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden max-h-[92dvh] flex flex-col">
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
              <DialogTitle className="text-sm font-bold text-slate-900">Buy Generation Credits</DialogTitle>
            </div>
          </div>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {/* Current balance */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200">
            <span className="material-symbols-outlined text-slate-400" style={{ fontSize: 16 }}>
              credit_card
            </span>
            <span className="text-xs text-slate-600">
              Current balance: <strong className="text-slate-900">{currentCredits.toLocaleString()}</strong> credits
            </span>
          </div>

          {/* Pack selector */}
          <div className="space-y-2">
            {PACKS.map((pack) => (
              <button
                key={pack.key}
                type="button"
                onClick={() => setSelected(pack.key)}
                className={cn(
                  "w-full flex items-center gap-4 p-4 rounded-2xl border text-left transition-all relative",
                  selected === pack.key
                    ? "border-violet-400 bg-violet-50/60 ring-1 ring-violet-400/20"
                    : "border-slate-200 hover:border-slate-300 hover:bg-slate-50",
                )}
              >
                {pack.popular && (
                  <span className="absolute -top-2 left-4 text-[9px] font-bold bg-violet-500 text-white px-2 py-0.5 rounded-full tracking-wide">
                    MOST POPULAR
                  </span>
                )}
                <div className={cn(
                  "w-10 h-10 rounded-xl flex flex-col items-center justify-center flex-shrink-0",
                  selected === pack.key ? "bg-violet-100" : "bg-slate-100",
                )}>
                  <span className="text-base font-bold leading-none" style={{ color: selected === pack.key ? "#7c3aed" : "#64748b" }}>
                    {pack.credits >= 10000 ? `${pack.credits / 1000}k` : pack.credits >= 1000 ? `${pack.credits / 1000}k` : pack.credits}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className={cn("text-sm font-semibold", selected === pack.key ? "text-violet-700" : "text-slate-700")}>
                      {pack.label}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">{pack.perCredit} each</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">{pack.desc}</p>
                </div>
                <div className="flex-shrink-0 text-right">
                  <span className={cn("text-base font-bold", selected === pack.key ? "text-violet-700" : "text-slate-700")}>
                    {pack.price}
                  </span>
                  <p className="text-[10px] text-slate-400 font-mono">{pack.credits.toLocaleString()} credits</p>
                </div>
              </button>
            ))}
          </div>

          {/* What 1 credit buys */}
          <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-3 flex gap-2.5">
            <span className="material-symbols-outlined text-blue-400 flex-shrink-0 mt-0.5" style={{ fontSize: 16 }}>info</span>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              1 credit = 1 AI-generated image variant (1024×1024, DALL-E 3).
              Credits never expire. Each generation run uses 1 credit per variant.
            </p>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
              <p className="text-xs text-rose-700">{error}</p>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-200 bg-slate-50/40 space-y-2 shrink-0" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}>
          <Button
            onClick={handlePurchase}
            disabled={loading}
            className="w-full min-h-[44px] bg-violet-600 hover:bg-violet-700 text-white"
            size="lg"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>auto_awesome</span>
            )}
            {loading ? "Redirecting to Stripe…" : `Purchase ${PACKS.find((p) => p.key === selected)?.price} Pack`}
          </Button>
          <Button
            onClick={onClose}
            variant="ghost"
            className="w-full text-[11px] font-mono text-slate-500 hover:text-slate-700 min-h-[44px]"
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
