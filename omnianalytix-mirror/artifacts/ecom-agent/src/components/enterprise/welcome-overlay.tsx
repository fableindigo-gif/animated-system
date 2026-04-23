import { useEffect, useRef, useState } from "react";
import { ArrowRight, Sparkles, ShoppingCart, Search, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface WelcomeOverlayProps {
  name: string;
  goal: "ecom" | "leadgen" | "hybrid";
  onFinish: (focusPlatform: string) => void;
  onSkip: () => void;
}

const FOCUS_BY_GOAL: Record<"ecom" | "leadgen" | "hybrid", { platform: string; label: string; icon: typeof ShoppingCart; tagline: string }> = {
  ecom:    { platform: "shopify",          label: "Shopify",           icon: ShoppingCart, tagline: "We'll pull SKUs, orders, and ad spend so you can see margin in minutes." },
  leadgen: { platform: "google_workspace", label: "Google Workspace",  icon: Search,       tagline: "Connect Google to pull Ads, Search Console, and Analytics so you can see CPL in minutes." },
  hybrid:  { platform: "google_workspace", label: "Google Workspace",  icon: Zap,          tagline: "Connect Google first — Shopify and your CRM can follow in any order." },
};

export function WelcomeOverlay({ name, goal, onFinish, onSkip }: WelcomeOverlayProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const focus = FOCUS_BY_GOAL[goal] ?? FOCUS_BY_GOAL.ecom;
  const FocusIcon = focus.icon;
  const firstName = (name || "there").split(/\s+/)[0];

  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryBtnRef = useRef<HTMLButtonElement>(null);

  // Lock body scroll while overlay is mounted.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Move focus to primary CTA on mount and when step changes.
  useEffect(() => {
    primaryBtnRef.current?.focus();
  }, [step]);

  // Escape closes (treated as skip). Tab/Shift-Tab traps focus within dialog.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onSkip();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSkip]);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#0a0a0f]/70 backdrop-blur-md p-4"
      data-testid="welcome-overlay"
    >
      <div className="w-full max-w-[460px]">
        <div className="bg-white rounded-3xl shadow-2xl border border-outline-variant/10 overflow-hidden">

          <div className="h-1 bg-[#f0f1f5]">
            <div
              className="h-full bg-[#2563EB] transition-all duration-500"
              style={{ width: step === 1 ? "50%" : "100%" }}
            />
          </div>

          {step === 1 && (
            <div className="px-8 pt-9 pb-6 text-center" data-testid="welcome-step-1">
              <div className="mx-auto mb-5 w-16 h-16 rounded-full bg-gradient-to-br from-[#2563EB]/15 to-[#2563EB]/5 border border-[#2563EB]/20 flex items-center justify-center">
                <Sparkles className="w-7 h-7 text-[#2563EB]" aria-hidden="true" />
              </div>
              <h2 id="welcome-title" className="text-2xl font-extrabold text-on-surface tracking-tight mb-2">
                Hi {firstName} 👋
              </h2>
              <p className="text-sm text-on-surface-variant leading-relaxed mb-6 max-w-sm mx-auto">
                Welcome to OmniAnalytix. Your workspace is ready. We'll get you to your first insight in
                about a minute — no setup wizards, no spreadsheets.
              </p>
              <div className="grid grid-cols-3 gap-3 mb-7 text-[11px]">
                {[
                  { n: "1", label: "Connect" },
                  { n: "2", label: "Sync" },
                  { n: "3", label: "Insight" },
                ].map((s, i) => (
                  <div key={s.n} className="flex flex-col items-center gap-1.5">
                    <div className={cn(
                      "w-7 h-7 rounded-full flex items-center justify-center font-bold",
                      i === 0 ? "bg-[#2563EB] text-white" : "bg-[#f0f1f5] text-on-surface-variant",
                    )}>
                      {s.n}
                    </div>
                    <span className="font-semibold text-on-surface-variant">{s.label}</span>
                  </div>
                ))}
              </div>
              <button
                ref={step === 1 ? primaryBtnRef : undefined}
                onClick={() => setStep(2)}
                data-testid="welcome-next"
                className="w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-[#2563EB] hover:bg-[#1d4ed8] text-white text-sm font-bold shadow-lg shadow-blue-500/20 transition-all active:scale-[0.98]"
              >
                Let's go <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={onSkip}
                className="mt-3 text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors"
                data-testid="welcome-skip"
              >
                Skip for now
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="px-8 pt-9 pb-6 text-center" data-testid="welcome-step-2">
              <div className="mx-auto mb-5 w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                <FocusIcon className="w-7 h-7 text-emerald-600" aria-hidden="true" />
              </div>
              <h2 className="text-xl font-extrabold text-on-surface tracking-tight mb-2">
                Let's connect {focus.label}
              </h2>
              <p className="text-sm text-on-surface-variant leading-relaxed mb-3 max-w-sm mx-auto">
                {focus.tagline}
              </p>
              <p className="text-xs font-semibold text-emerald-600 mb-6 inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Takes about 60 seconds
              </p>
              <button
                ref={step === 2 ? primaryBtnRef : undefined}
                onClick={() => onFinish(focus.platform)}
                data-testid="welcome-finish"
                className="w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-[#2563EB] hover:bg-[#1d4ed8] text-white text-sm font-bold shadow-lg shadow-blue-500/20 transition-all active:scale-[0.98]"
              >
                Connect {focus.label} <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => setStep(1)}
                className="mt-3 text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors"
              >
                Back
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const WELCOME_PENDING_KEY = "omni_welcome_pending";

export function markWelcomePending() {
  sessionStorage.setItem(WELCOME_PENDING_KEY, "1");
}

export function isWelcomePending(): boolean {
  return sessionStorage.getItem(WELCOME_PENDING_KEY) === "1";
}

export function clearWelcomePending() {
  sessionStorage.removeItem(WELCOME_PENDING_KEY);
}
