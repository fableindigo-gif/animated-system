import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { UnifiedBillingHub } from "@/components/dashboard/unified-billing-hub";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/contexts/currency-context";

export default function BillingHubPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { currencySymbol } = useCurrency();
  const [budgetTarget, setBudgetTarget] = useState(() => localStorage.getItem("omni_monthly_budget_target") || "");
  const [budgetSaved, setBudgetSaved] = useState(!!localStorage.getItem("omni_monthly_budget_target"));

  const handleSaveBudget = () => {
    const val = budgetTarget.replace(/[^0-9.]/g, "");
    if (!val || parseFloat(val) <= 0) {
      toast({ title: "Invalid Amount", description: "Enter a positive monthly budget.", variant: "destructive" });
      return;
    }
    localStorage.setItem("omni_monthly_budget_target", val);
    setBudgetSaved(true);
    toast({ title: "Budget Target Saved", description: `Monthly ceiling set to ${currencySymbol}${Number(val).toLocaleString()}` });
  };

  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8 sm:py-12">
        <button
          onClick={() => navigate("/")}
          className="inline-flex items-center gap-1.5 text-sm text-on-surface-variant hover:text-on-surface transition-colors mb-6 group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to Dashboard
        </button>
        <div className="mb-8">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary-container mb-2">Finance</p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-on-surface">Unified Billing & Pacing</h1>
          <p className="text-sm text-on-surface-variant mt-2 max-w-lg leading-relaxed">
            Cross-platform budget tracking with spend pacing, overspend alerts, and automatic budget redistribution.
          </p>
        </div>

        <section className="bg-white border ghost-border rounded-2xl p-6 shadow-sm mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center">
              <span className="material-symbols-outlined text-xl text-amber-600">account_balance</span>
            </div>
            <div>
              <h2 className="font-bold text-sm text-on-surface">Monthly Budget Target</h2>
              <p className="text-[10px] text-on-surface-variant mt-0.5">Cross-platform spend ceiling for pacing & overspend alerts</p>
            </div>
          </div>
          <p className="text-xs text-on-surface-variant mb-4">
            Set the maximum cross-platform monthly ad spend. The pacing engine and overspend detection algorithms will query this target.
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-on-surface-variant font-medium">{currencySymbol}</span>
              <input
                type="text"
                inputMode="decimal"
                value={budgetTarget}
                onChange={(e) => { setBudgetTarget(e.target.value); setBudgetSaved(false); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveBudget(); }}
                placeholder="50,000"
                className="w-full text-sm border border-outline-variant/15 rounded-2xl bg-surface pl-8 pr-4 py-3 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-300 outline-none transition-all placeholder:text-on-surface-variant font-mono"
              />
            </div>
            <button
              onClick={handleSaveBudget}
              disabled={!budgetTarget.trim()}
              className={cn(
                "px-5 py-3 text-xs font-bold rounded-2xl transition-all active:scale-95 flex items-center gap-2 shrink-0",
                budgetSaved
                  ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                  : "bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50",
              )}
            >
              {budgetSaved ? (
                <><span className="material-symbols-outlined text-sm">check_circle</span> Saved</>
              ) : (
                <><span className="material-symbols-outlined text-sm">save</span> Save Target</>
              )}
            </button>
          </div>
          {budgetSaved && budgetTarget && (
            <p className="text-[10px] text-emerald-600 mt-2 flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px]">check_circle</span>
              Monthly budget ceiling: {currencySymbol}{Number(budgetTarget.replace(/[^0-9.]/g, "")).toLocaleString()} — pacing engine active.
            </p>
          )}
        </section>

        <UnifiedBillingHub />
      </div>
    </div>
  );
}
