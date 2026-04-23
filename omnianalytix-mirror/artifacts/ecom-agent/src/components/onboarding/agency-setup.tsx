/**
 * AgencySetupWizard
 * -----------------
 * 3-step first-login onboarding: Agency Name → First Client → Connect Platforms.
 * Fires when the user has no workspaces yet (blank-slate state).
 * Each step is fully wired to the backend via authFetch / authPost.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Building2, Users, Cable, Check, ChevronRight, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { authPost, authFetch } from "@/lib/auth-fetch";
import { useWorkspace } from "@/contexts/workspace-context";
import { getPreAuthSelections } from "@/components/enterprise/pre-auth-onboarding";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

type Goal = "ecom" | "leadgen" | "hybrid";

const GOALS: { id: Goal; label: string; description: string; icon: string }[] = [
  { id: "ecom",    label: "E-Commerce",   description: "Shopify, Google Shopping, Meta Ads",  icon: "storefront" },
  { id: "leadgen", label: "Lead Gen",     description: "Google Search, Meta, CRM integrations", icon: "track_changes" },
  { id: "hybrid",  label: "Hybrid",       description: "Both e-commerce and lead generation",  icon: "hub" },
];

const STEPS = [
  { n: 1, label: "Agency",   icon: Building2 },
  { n: 2, label: "Client",   icon: Users },
  { n: 3, label: "Connect",  icon: Cable },
];

interface Props {
  onComplete: () => void;
}

export function AgencySetupWizard({ onComplete }: Props) {
  const [, navigate] = useLocation();
  const { refreshWorkspaces, switchWorkspace } = useWorkspace();

  const { goal: preAuthGoal } = getPreAuthSelections();

  const [step, setStep]           = useState(1);
  const [agencyName, setAgencyName] = useState("");
  const [clientName, setClientName] = useState("");
  const [goal, setGoal]           = useState<Goal>((preAuthGoal as Goal) ?? "ecom");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [newWorkspaceId, setNewWorkspaceId] = useState<number | null>(null);

  // ─── Step 1: Save agency name ────────────────────────────────────────────────
  async function handleAgencyNext() {
    if (!agencyName.trim()) { setError("Please enter your agency name."); return; }
    setError(null);
    setLoading(true);
    try {
      const res = await authFetch(`${BASE}/api/organizations/name`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: agencyName.trim() }),
        skipWorkspace: true,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? "Failed to save agency name");
      }
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  // ─── Step 2: Create first workspace ──────────────────────────────────────────
  async function handleClientCreate() {
    if (!clientName.trim()) { setError("Please enter a client name."); return; }
    setError(null);
    setLoading(true);
    try {
      const res = await authPost(`${BASE}/api/workspaces`, {
        clientName: clientName.trim(),
        primaryGoal: goal,
        enabledIntegrations: [],
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? "Failed to create workspace");
      }
      const ws = await res.json() as { id: number };
      setNewWorkspaceId(ws.id);
      // Switch context to the freshly created workspace
      await refreshWorkspaces();
      switchWorkspace(ws.id);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  // ─── Step 3: Go to Connections ───────────────────────────────────────────────
  function handleGoToConnections() {
    localStorage.setItem("omni_agency_setup_complete", "true");
    onComplete();
    navigate("/connections");
  }

  async function handleSkip() {
    localStorage.setItem("omni_agency_setup_complete", "true");
    try {
      await authFetch(`${BASE}/api/users/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agencySetupComplete: true }),
      });
    } catch {
    }
    onComplete();
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="px-8 pt-8 pb-6 border-b border-slate-100">
          {/* Step progress */}
          <div className="flex items-center gap-0 mb-6">
            {STEPS.map((s, i) => {
              const done    = step > s.n;
              const current = step === s.n;
              const Icon    = s.icon;
              return (
                <div key={s.n} className="flex items-center gap-0">
                  <div className="flex flex-col items-center gap-1.5">
                    <div className={cn(
                      "w-9 h-9 rounded-full flex items-center justify-center transition-all",
                      done    ? "bg-[#1a73e8] text-white"
                      : current ? "bg-[#1a73e8]/10 text-[#1a73e8] ring-2 ring-[#1a73e8]/30"
                               : "bg-slate-100 text-slate-400",
                    )}>
                      {done ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                    </div>
                    <span className={cn(
                      "text-[10px] font-bold uppercase tracking-wider",
                      current ? "text-[#1a73e8]" : done ? "text-slate-500" : "text-slate-300",
                    )}>{s.label}</span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={cn("w-20 h-px mx-2 mb-4", step > s.n ? "bg-[#1a73e8]" : "bg-slate-200")} />
                  )}
                </div>
              );
            })}
          </div>

          {step === 1 && (
            <>
              <div className="w-12 h-12 rounded-xl bg-[#1a73e8]/10 flex items-center justify-center mb-4">
                <Building2 className="w-6 h-6 text-[#1a73e8]" />
              </div>
              <h2 className="text-xl font-bold text-slate-900" style={{ fontFamily: "'Manrope', sans-serif" }}>Name your Agency</h2>
              <p className="text-sm text-slate-500 mt-1">This is your top-level organization. You'll manage all client workspaces under it.</p>
            </>
          )}
          {step === 2 && (
            <>
              <div className="w-12 h-12 rounded-xl bg-[#1a73e8]/10 flex items-center justify-center mb-4">
                <Users className="w-6 h-6 text-[#1a73e8]" />
              </div>
              <h2 className="text-xl font-bold text-slate-900" style={{ fontFamily: "'Manrope', sans-serif" }}>Add your first Client</h2>
              <p className="text-sm text-slate-500 mt-1">Each client gets their own isolated workspace with separate connections, campaigns, and data.</p>
            </>
          )}
          {step === 3 && (
            <>
              <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center mb-4">
                <Check className="w-6 h-6 text-emerald-600" />
              </div>
              <h2 className="text-xl font-bold text-slate-900" style={{ fontFamily: "'Manrope', sans-serif" }}>
                "{clientName}" is ready!
              </h2>
              <p className="text-sm text-slate-500 mt-1">Now connect their ad platforms so the AI can start analysing performance.</p>
            </>
          )}
        </div>

        {/* Body */}
        <div className="px-8 py-6 space-y-4">

          {/* ── Step 1 ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label htmlFor="agency-setup-agency-name" className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wider">Agency / Company Name</label>
                <input
                  id="agency-setup-agency-name"
                  type="text"
                  value={agencyName}
                  onChange={(e) => { setAgencyName(e.target.value); setError(null); }}
                  onKeyDown={(e) => e.key === "Enter" && void handleAgencyNext()}
                  placeholder="e.g. Growth Rocket Agency"
                  autoFocus
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/30 focus:border-[#1a73e8] transition-all"
                />
              </div>
              <p className="text-xs text-slate-400">
                This is used across reports, client portals, and AI output. You can update it later in Settings.
              </p>
            </div>
          )}

          {/* ── Step 2 ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label htmlFor="agency-setup-client-name" className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wider">Client Name</label>
                <input
                  id="agency-setup-client-name"
                  type="text"
                  value={clientName}
                  onChange={(e) => { setClientName(e.target.value); setError(null); }}
                  onKeyDown={(e) => e.key === "Enter" && void handleClientCreate()}
                  placeholder="e.g. Acme Corp"
                  autoFocus
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/30 focus:border-[#1a73e8] transition-all"
                />
              </div>
              <div role="group" aria-labelledby="agency-setup-client-goal-label">
                <span id="agency-setup-client-goal-label" className="block text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wider">Client Goal</span>
                <div className="grid grid-cols-3 gap-2">
                  {GOALS.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => setGoal(g.id)}
                      className={cn(
                        "p-3 rounded-xl border text-left transition-all",
                        goal === g.id
                          ? "border-[#1a73e8] bg-[#1a73e8]/5 ring-1 ring-[#1a73e8]/20"
                          : "border-slate-200 hover:border-slate-300 hover:bg-slate-50",
                      )}
                    >
                      <span className="material-symbols-outlined text-[20px] block mb-1" style={{ color: goal === g.id ? "#1a73e8" : "#94a3b8" }}>
                        {g.icon}
                      </span>
                      <p className={cn("text-xs font-bold", goal === g.id ? "text-[#1a73e8]" : "text-slate-700")}>{g.label}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">{g.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Step 3 ── */}
          {step === 3 && (
            <div className="space-y-3">
              {/* Summary card */}
              <div className="bg-slate-50 rounded-xl p-4 space-y-2 border border-slate-100">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Agency</span>
                  <span className="font-semibold text-slate-900">{agencyName}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">First Client</span>
                  <span className="font-semibold text-slate-900">{clientName}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Goal</span>
                  <span className="font-semibold text-slate-900">{GOALS.find((g) => g.id === goal)?.label}</span>
                </div>
              </div>
              <div className="bg-[#1a73e8]/5 border border-[#1a73e8]/15 rounded-xl p-4">
                <p className="text-xs text-[#1a73e8] font-semibold flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px]">info</span>
                  Next: connect Google Ads, Shopify, or Meta so the AI can pull live data.
                </p>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-xs text-red-500 flex items-center gap-1.5 bg-red-50 px-3 py-2 rounded-lg">
              <span className="material-symbols-outlined text-[14px]">error</span>
              {error}
            </p>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-8 pb-8 flex items-center justify-between">
          <button
            onClick={handleSkip}
            className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
          >
            {step === 3 ? "Skip for now" : "Set up later"}
          </button>

          {step === 1 && (
            <button
              onClick={() => void handleAgencyNext()}
              disabled={loading || !agencyName.trim()}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#1a73e8] text-white text-sm font-semibold rounded-xl hover:bg-[#1557b0] disabled:opacity-50 transition-all active:scale-[0.98]"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Next <ChevronRight className="w-4 h-4" /></>}
            </button>
          )}

          {step === 2 && (
            <div className="flex items-center gap-3">
              <button onClick={() => setStep(1)} className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors">
                Back
              </button>
              <button
                onClick={() => void handleClientCreate()}
                disabled={loading || !clientName.trim()}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#1a73e8] text-white text-sm font-semibold rounded-xl hover:bg-[#1557b0] disabled:opacity-50 transition-all active:scale-[0.98]"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Create Workspace <ChevronRight className="w-4 h-4" /></>}
              </button>
            </div>
          )}

          {step === 3 && (
            <button
              onClick={handleGoToConnections}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#1a73e8] text-white text-sm font-semibold rounded-xl hover:bg-[#1557b0] transition-all active:scale-[0.98]"
            >
              Connect Platforms <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Helper: should we show the wizard? ───────────────────────────────────────
// Plain function (not a hook) — no React hooks inside, safe to call anywhere.

export function agencySetupNeeded(
  workspaces: { id: number }[],
  isLoading: boolean,
): boolean {
  if (isLoading) return false;
  if (localStorage.getItem("omni_agency_setup_complete") === "true") return false;
  return workspaces.length === 0;
}

/** @deprecated use agencySetupNeeded (non-hook) */
export const useAgencySetupNeeded = agencySetupNeeded;
