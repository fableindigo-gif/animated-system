import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
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

interface StripeUpgradeModalProps {
  open: boolean;
  onClose: () => void;
}

const PRO_FEATURES = [
  { icon: "bolt", label: "Automated platform fixes", detail: "Execute AI-recommended actions across Google Ads, Meta, and Shopify" },
  { icon: "history", label: "One-click rollback", detail: "Undo any executed action with full state restoration" },
  { icon: "verified_user", label: "Glass-Box approval flow", detail: "Enterprise-grade audit trail with diff visualization" },
  { icon: "trending_up", label: "Priority diagnostics", detail: "Advanced PMax auditor, margin leak detection, and pipeline triage" },
];

export function StripeUpgradeModal({ open, onClose }: StripeUpgradeModalProps) {
  const [loading, setLoading] = useState(false);
  const [stripeConfig, setStripeConfig] = useState<{ configured: boolean; publishableKey: string | null } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    authFetch("/api/billing/config")
      .then((r) => r.json())
      .then((d) => setStripeConfig(d as { configured: boolean; publishableKey: string | null }))
      .catch(() => setStripeConfig({ configured: false, publishableKey: null }));
  }, [open]);

  const handleUpgrade = async () => {
    setLoading(true);
    setError("");

    try {
      const res = await authPost("/api/billing/create-checkout-session", {
        tier: "pro",
      });

      const data = (await res.json()) as { sessionId?: string; url?: string; error?: string; message?: string; code?: string };

      if (!res.ok) {
        if (data.code === "STRIPE_NOT_CONFIGURED") {
          setError(data.message ?? "Payment processing is not yet available.");
        } else {
          setError(data.error ?? "Something went wrong. Please try again.");
        }
        return;
      }

      if (data.url) {
        window.location.href = data.url;
        return;
      }

      // Stripe.js v3+ removed `redirectToCheckout`; the backend must always
      // return a hosted-checkout `url`. If we got here without one, surface a
      // clear error rather than silently dropping the user.
      setError("Unable to start checkout (missing redirect URL). Contact support@omnianalytix.in for Pro access.");
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden max-h-[92dvh] sm:max-h-[85vh] flex flex-col">

        <DialogHeader className="px-5 py-4 border-b ghost-border shrink-0 space-y-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-primary" style={{ fontSize: 20 }}>bolt</span>
            </div>
            <div className="flex-1 min-w-0 text-left">
              <DialogDescription className="text-[10px] font-mono uppercase tracking-widest">Upgrade Required</DialogDescription>
              <DialogTitle className="text-sm font-bold text-on-surface">Unlock Pro Execution</DialogTitle>
            </div>
          </div>
        </DialogHeader>

        <div className="p-5 space-y-5 overflow-y-auto flex-1">
          <div className="text-center">
            <p className="text-lg font-bold text-on-surface font-[system-ui]">
              Diagnosis is <span className="text-emerald-600">free</span>.
              <br />
              The cure is <span className="text-primary">Pro</span>.
            </p>
            <p className="text-xs text-on-surface-variant mt-2 font-mono">
              Upgrade to execute automated platform fixes and rollback features.
            </p>
          </div>

          <div className="space-y-2">
            {PRO_FEATURES.map((f) => (
              <div key={f.label} className="flex items-start gap-3 p-3 rounded-2xl border ghost-border bg-surface-container-low/50">
                <div className="w-7 h-7 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="material-symbols-outlined text-primary" style={{ fontSize: 16 }}>{f.icon}</span>
                </div>
                <div className="flex-1">
                  <p className="text-xs font-semibold text-on-surface">{f.label}</p>
                  <p className="text-[10px] text-on-surface-variant mt-0.5">{f.detail}</p>
                </div>
                <span className="material-symbols-outlined text-primary/40 mt-1 shrink-0" style={{ fontSize: 16 }}>check_circle</span>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-low/60 p-4">
            <div className="flex items-baseline gap-2 justify-center">
              <span className="text-2xl font-bold text-on-surface font-[system-ui]">$99</span>
              <span className="text-xs text-on-surface-variant font-mono">/month per workspace</span>
            </div>
            <p className="text-center text-[10px] text-on-surface-variant mt-1 font-mono">Cancel anytime &middot; 14-day money-back guarantee</p>
          </div>

          {error && (
            <div className="rounded-2xl border border-error-m3/20 bg-error-container px-4 py-3">
              <p className="text-xs text-on-error-container font-mono">{error}</p>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t ghost-border bg-surface-container-low/40 space-y-2 shrink-0" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}>
          <Button
            onClick={() => void handleUpgrade()}
            disabled={loading}
            className="w-full min-h-[44px] bg-on-surface hover:bg-on-surface/90 text-white"
            size="lg"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="material-symbols-outlined" style={{ fontSize: 18 }}>bolt</span>}
            {loading ? "Processing…" : "Upgrade to Pro"}
          </Button>
          <Button
            onClick={onClose}
            variant="ghost"
            className="w-full text-[11px] font-mono text-on-surface-variant hover:text-on-surface-variant min-h-[44px]"
          >
            Continue with free diagnostics
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
