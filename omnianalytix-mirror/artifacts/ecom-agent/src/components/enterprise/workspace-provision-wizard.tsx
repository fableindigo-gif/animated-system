import { useState } from "react";
import {
  X, Check, Copy, CheckCheck, Loader2,
  Building2, Zap, Globe, LayoutGrid, RefreshCw,
  TrendingUp, Users, ShoppingCart, Mail, Search, Linkedin,
} from "lucide-react";
import {
  SiShopify, SiGoogle, SiMeta, SiWoo, SiHubspot, SiSalesforce,
  SiStripe, SiTiktok, SiZoho,
} from "react-icons/si";
import { cn } from "@/lib/utils";
import { useWorkspace, type Workspace } from "@/contexts/workspace-context";
import { authFetch } from "@/lib/auth-fetch";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Goal catalogue ────────────────────────────────────────────────────────────

type Goal = "ecom" | "leadgen" | "hybrid";

const GOALS: Array<{
  id: Goal;
  label: string;
  sub: string;
  icon: React.ReactNode;
  accent: string;
  bg: string;
  border: string;
  tagline: string;
}> = [
  {
    id: "ecom",
    label: "E-Commerce & Sales",
    sub: "Physical · Digital · DTC",
    icon: <TrendingUp className="w-5 h-5" />,
    accent: "text-emerald-600",
    bg: "bg-emerald-50",
    border: "border-emerald-300",
    tagline: "POAS · ROAS · inventory-driven automation",
  },
  {
    id: "leadgen",
    label: "Lead Gen & Pipeline",
    sub: "B2B · Forms · Calls",
    icon: <Users className="w-5 h-5" />,
    accent: "text-violet-600",
    bg: "bg-violet-50",
    border: "border-violet-300",
    tagline: "CRM sync · CPL arbitrage · offline conversions",
  },
  {
    id: "hybrid",
    label: "Hybrid — Sales + Lead Gen",
    sub: "DTC + B2B · Full Funnel",
    icon: <LayoutGrid className="w-5 h-5" />,
    accent: "text-amber-600",
    bg: "bg-amber-50",
    border: "border-amber-300",
    tagline: "Dual-funnel · revenue + pipeline KPIs",
  },
];

// ─── Integration catalogue (goal-filtered) ────────────────────────────────────

interface IntegrationDef {
  id: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
  goals: Goal[];
  color: string;
  bg: string;
  border: string;
}

const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "shopify", label: "Shopify", desc: "Revenue, inventory, POAS",
    icon: <SiShopify className="w-4 h-4" />, goals: ["ecom", "hybrid"],
    color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200",
  },
  {
    id: "woocommerce", label: "WooCommerce", desc: "Orders, products, customers",
    icon: <SiWoo className="w-4 h-4" />, goals: ["ecom", "hybrid"],
    color: "text-purple-700", bg: "bg-purple-50", border: "border-purple-200",
  },
  {
    id: "google_ads", label: "Google Ads", desc: "Campaigns, ROAS, budget pacing",
    icon: <SiGoogle className="w-4 h-4" />, goals: ["ecom", "leadgen", "hybrid"],
    color: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200",
  },
  {
    id: "meta", label: "Meta Ads", desc: "Facebook + Instagram campaigns",
    icon: <SiMeta className="w-4 h-4" />, goals: ["ecom", "leadgen", "hybrid"],
    color: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200",
  },
  {
    id: "tiktok_ads", label: "TikTok Ads", desc: "Short-form video campaigns",
    icon: <SiTiktok className="w-4 h-4" />, goals: ["ecom", "leadgen", "hybrid"],
    color: "text-slate-700", bg: "bg-slate-50", border: "border-slate-200",
  },
  {
    id: "bing_ads", label: "Microsoft / Bing Ads", desc: "Search & audience campaigns",
    icon: <Search className="w-4 h-4" />, goals: ["ecom", "leadgen", "hybrid"],
    color: "text-sky-700", bg: "bg-sky-50", border: "border-sky-200",
  },
  {
    id: "ga4", label: "Google Analytics 4", desc: "Web traffic, conversion funnels",
    icon: <LayoutGrid className="w-4 h-4" />, goals: ["ecom", "leadgen", "hybrid"],
    color: "text-orange-700", bg: "bg-orange-50", border: "border-orange-200",
  },
  {
    id: "gmc", label: "Google Merchant Center", desc: "Product feeds, Shopping ads",
    icon: <ShoppingCart className="w-4 h-4" />, goals: ["ecom", "hybrid"],
    color: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200",
  },
  {
    id: "klaviyo", label: "Klaviyo", desc: "Email & SMS marketing automation",
    icon: <Mail className="w-4 h-4" />, goals: ["ecom", "hybrid"],
    color: "text-yellow-700", bg: "bg-yellow-50", border: "border-yellow-200",
  },
  {
    id: "stripe", label: "Stripe", desc: "Payment analytics, LTV, churn",
    icon: <SiStripe className="w-4 h-4" />, goals: ["ecom", "hybrid"],
    color: "text-violet-700", bg: "bg-violet-50", border: "border-violet-200",
  },
  {
    id: "hubspot", label: "HubSpot", desc: "CRM pipeline, deal stages",
    icon: <SiHubspot className="w-4 h-4" />, goals: ["leadgen", "hybrid"],
    color: "text-orange-700", bg: "bg-orange-50", border: "border-orange-200",
  },
  {
    id: "salesforce", label: "Salesforce", desc: "Opportunities, leads, accounts",
    icon: <SiSalesforce className="w-4 h-4" />, goals: ["leadgen", "hybrid"],
    color: "text-sky-700", bg: "bg-sky-50", border: "border-sky-200",
  },
  {
    id: "zoho", label: "Zoho CRM", desc: "Leads, contacts, pipelines",
    icon: <SiZoho className="w-4 h-4" />, goals: ["leadgen", "hybrid"],
    color: "text-rose-700", bg: "bg-rose-50", border: "border-rose-200",
  },
  {
    id: "linkedin_ads", label: "LinkedIn Ads", desc: "B2B campaigns, lead gen forms",
    icon: <Linkedin className="w-4 h-4" />, goals: ["leadgen", "hybrid"],
    color: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200",
  },
  {
    id: "headless", label: "Custom / Headless", desc: "Webhook push for any platform",
    icon: <Globe className="w-4 h-4" />, goals: ["ecom", "leadgen", "hybrid"],
    color: "text-slate-700", bg: "bg-slate-50", border: "border-slate-200",
  },
];

// ─── WorkspaceProvisionWizard ──────────────────────────────────────────────────

interface WorkspaceProvisionWizardProps {
  onClose: () => void;
  onCreated?: (ws: Workspace) => void;
}

export function WorkspaceProvisionWizard({ onClose, onCreated }: WorkspaceProvisionWizardProps) {
  const { refreshWorkspaces, switchWorkspace } = useWorkspace();

  const [step, setStep]                     = useState<1 | 2>(1);
  const [clientName, setClientName]         = useState("");
  const [notes, setNotes]                   = useState("");
  const [goal, setGoal]                     = useState<Goal | null>(null);
  const [selectedIntegrations, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving]                 = useState(false);
  const [error, setError]                   = useState("");
  const [created, setCreated]               = useState<Workspace | null>(null);
  const [copied, setCopied]                 = useState(false);
  const [regenLoading, setRegenLoading]     = useState(false);

  const toggleIntegration = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const pickGoal = (g: Goal) => {
    setGoal(g);
    if (g === "ecom")         setSelected(new Set(["google_ads", "shopify", "meta", "ga4", "gmc"]));
    else if (g === "hybrid")  setSelected(new Set(["google_ads", "shopify", "meta", "ga4", "hubspot", "klaviyo"]));
    else                      setSelected(new Set(["google_ads", "meta", "ga4", "hubspot", "linkedin_ads"]));
  };

  const visibleIntegrations = goal
    ? INTEGRATIONS.filter((i) => i.goals.includes(goal))
    : [];

  const setupLink = created
    ? `${window.location.origin}${BASE}/connections?workspace=${created.slug}&token=${created.inviteToken}`
    : "";

  const handleCopy = () => {
    if (!setupLink) return;
    navigator.clipboard.writeText(setupLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleRegenToken = async () => {
    if (!created) return;
    setRegenLoading(true);
    try {
      const res = await authFetch(`/api/workspaces/${created.id}/regenerate-token`, { method: "POST" });
      if (!res.ok) throw new Error();
      const { inviteToken } = await res.json() as { inviteToken: string };
      setCreated({ ...created, inviteToken });
    } catch { } finally { setRegenLoading(false); }
  };

  const handleCreate = async () => {
    if (!clientName.trim()) { setError("Client name is required."); return; }
    setSaving(true);
    setError("");
    try {
      const res = await authFetch(`${BASE}/api/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName:          clientName.trim(),
          primaryGoal:         goal ?? undefined,
          enabledIntegrations: Array.from(selectedIntegrations),
          notes:               notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || body?.error || "Failed to create workspace");
      }
      const ws: Workspace = await res.json();
      setCreated(ws);
      await refreshWorkspaces();
      onCreated?.(ws);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Could not provision workspace. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDone = () => {
    if (created) switchWorkspace(created.id);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center sm:p-4"
      onClick={() => !saving && !created && onClose()}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden sm:mx-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div className="px-6 pt-6 pb-4 border-b border-outline-variant/15">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-container/10 flex items-center justify-center">
                <Building2 className="w-5 h-5 text-primary-container" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-on-surface">
                  {created ? "Workspace Provisioned" : "Provision Client Workspace"}
                </h2>
                <p className="text-sm text-on-surface-variant mt-0.5">
                  {created
                    ? "Share the setup link with your client."
                    : step === 1
                    ? "Step 1 of 2 — Client details & goal"
                    : "Step 2 of 2 — Choose integrations"}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-on-surface-variant hover:text-on-surface transition-colors p-1 rounded-lg hover:bg-surface"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          {/* Step progress bar */}
          {!created && (
            <div className="flex gap-1.5">
              {[1, 2].map((s) => (
                <div
                  key={s}
                  className={cn(
                    "h-1 flex-1 rounded-full transition-all duration-300",
                    s <= step ? "bg-primary-container" : "bg-outline-variant/20",
                  )}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Body ──────────────────────────────────────────────────────────── */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[75dvh] sm:max-h-[65vh]">

          {!created ? (
            <>
              {/* ── Step 1: Client details & goal ── */}
              {step === 1 && (
                <>
                  {/* Client Name */}
                  <div>
                    <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Client / Brand Name *</label>
                    <input
                      type="text"
                      placeholder="Acme Corp"
                      value={clientName}
                      autoFocus
                      onChange={(e) => { setClientName(e.target.value); setError(""); }}
                      onKeyDown={(e) => { if (e.key === "Enter" && clientName.trim() && goal) { setStep(2); } }}
                      className="w-full px-4 py-2.5 border border-outline-variant/15 rounded-xl text-sm focus:ring-2 focus:ring-primary-container/20 focus:border-primary-container/30 outline-none transition-all"
                    />
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Notes (optional)</label>
                    <textarea
                      placeholder="e.g. AU e-commerce brand, managing Google Ads + Shopify"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      className="w-full px-4 py-2.5 border border-outline-variant/15 rounded-xl text-sm focus:ring-2 focus:ring-primary-container/20 focus:border-primary-container/30 outline-none transition-all resize-none"
                    />
                  </div>

                  {/* Primary Goal */}
                  <div>
                    <label className="block text-xs font-bold text-on-surface-variant mb-2">Primary Goal *</label>
                    <div className="grid grid-cols-3 gap-2">
                      {GOALS.map((g) => {
                        const active = goal === g.id;
                        return (
                          <button
                            key={g.id}
                            onClick={() => pickGoal(g.id)}
                            className={cn(
                              "flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border-2 transition-all text-center",
                              active
                                ? cn(g.bg, g.border)
                                : "border-outline-variant/15 hover:border-outline-variant/30 bg-white",
                            )}
                          >
                            <span className={cn("transition-colors", active ? g.accent : "text-on-surface-variant")}>{g.icon}</span>
                            <span className={cn("text-[11px] font-bold leading-tight", active ? g.accent : "text-on-surface-variant")}>
                              {g.id === "ecom" ? "E-Commerce" : g.id === "leadgen" ? "Lead Gen" : "Hybrid"}
                            </span>
                            {active && (
                              <span className={cn("text-[9px] font-mono leading-tight text-center", g.accent)}>{g.sub}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {goal && (
                      <p className="text-[10px] text-on-surface-variant mt-2 leading-relaxed">
                        {GOALS.find((g) => g.id === goal)?.tagline}
                      </p>
                    )}
                  </div>

                  {error && <p className="text-sm text-error-m3 font-medium">{error}</p>}
                </>
              )}

              {/* ── Step 2: Integrations ── */}
              {step === 2 && goal && (
                <>
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-container-low border border-outline-variant/10">
                    <div className="w-8 h-8 rounded-lg bg-primary-container/10 flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4 text-primary-container" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-on-surface">{clientName}</p>
                      <p className="text-[11px] text-on-surface-variant">
                        {GOALS.find((g) => g.id === goal)?.label}
                      </p>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-bold text-on-surface-variant">Integrations to activate</label>
                      <span className="text-[10px] text-on-surface-variant font-mono">
                        {selectedIntegrations.size} selected
                      </span>
                    </div>
                    <p className="text-[11px] text-on-surface-variant mb-3 leading-relaxed">
                      Pre-selected based on your goal. Toggle to customise — you can always add more later.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {visibleIntegrations.map((integ) => {
                        const active = selectedIntegrations.has(integ.id);
                        return (
                          <button
                            key={integ.id}
                            onClick={() => toggleIntegration(integ.id)}
                            className={cn(
                              "flex items-center gap-2.5 px-3 py-2.5 rounded-xl border-2 text-left transition-all relative",
                            active
                              ? cn(integ.bg, integ.border)
                              : "bg-white border-outline-variant/15 hover:border-outline-variant/30",
                          )}
                        >
                          <span className={cn("shrink-0 transition-colors", active ? integ.color : "text-on-surface-variant")}>
                            {integ.icon}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className={cn("text-[11px] font-semibold truncate", active ? integ.color : "text-on-surface-variant")}>
                              {integ.label}
                            </p>
                            <p className="text-[9px] text-on-surface-variant truncate">{integ.desc}</p>
                          </div>
                          {active && (
                            <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center">
                              <Check className="w-2.5 h-2.5 text-white" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {error && <p className="text-sm text-error-m3 font-medium">{error}</p>}
              </>
            )}
            </>
          ) : (
            /* ── Success view ────────────────────────────────────────────────── */
            <>
              <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                  <Check className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-emerald-800">{created.clientName}</p>
                  <p className="text-xs text-emerald-600 mt-0.5">
                    {created.primaryGoal === "ecom" ? "E-Commerce" : created.primaryGoal === "hybrid" ? "Hybrid" : "Lead Gen"}
                    {" "}&middot; {(created.enabledIntegrations as string[]).length} integration{(created.enabledIntegrations as string[]).length !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Client Setup Link</label>
                <p className="text-xs text-on-surface-variant mb-3 leading-relaxed">
                  Share this secure link so your client can connect their own platforms.
                </p>
                <div className="rounded-xl border border-outline-variant/15 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-surface-container-low border-b border-outline-variant/15">
                    <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">Secure URL</span>
                    <button
                      onClick={handleRegenToken}
                      disabled={regenLoading}
                      className="flex items-center gap-1 text-[10px] font-mono text-on-surface-variant hover:text-on-surface transition-colors"
                    >
                      {regenLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                      Regenerate
                    </button>
                  </div>
                  <div className="flex items-start gap-2 p-3">
                    <code className="flex-1 text-[10px] font-mono text-on-surface-variant break-all leading-relaxed">{setupLink}</code>
                    <button
                      onClick={handleCopy}
                      className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-outline-variant/15 bg-white hover:bg-surface text-on-surface-variant text-[10px] font-mono transition-all"
                    >
                      {copied ? <><CheckCheck className="w-3 h-3" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy</>}
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Goal", value: created.primaryGoal === "ecom" ? "E-Commerce" : created.primaryGoal === "leadgen" ? "Lead Gen" : created.primaryGoal === "hybrid" ? "Hybrid" : "—" },
                  { label: "Workspace", value: created.slug },
                  { label: "Platforms", value: String((created.enabledIntegrations as string[]).length) },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-xl border border-outline-variant/15 bg-surface-container-low px-3 py-2.5">
                    <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-wider mb-1">{stat.label}</p>
                    <p className="text-[11px] font-mono text-on-surface truncate">{stat.value}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── Footer ────────────────────────────────────────────────────────── */}
        <div className="px-6 pb-6 pt-4 border-t border-outline-variant/15 flex gap-3">
          {!created ? (
            step === 1 ? (
              <>
                <button
                  onClick={onClose}
                  className="flex-1 py-2.5 border border-outline-variant/15 rounded-xl text-sm font-bold text-on-surface-variant hover:bg-surface transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (!clientName.trim()) { setError("Client name is required."); return; }
                    if (!goal) { setError("Please select a primary goal."); return; }
                    setError("");
                    setStep(2);
                  }}
                  disabled={!clientName.trim() || !goal}
                  className={cn(
                    "flex-[2] py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2",
                    clientName.trim() && goal
                      ? "bg-primary-container text-white hover:bg-primary-m3 active:scale-[0.98]"
                      : "bg-surface-container-low text-on-surface-variant cursor-not-allowed",
                  )}
                >
                  Continue — Choose Integrations →
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setStep(1)}
                  disabled={saving}
                  className="flex-1 py-2.5 border border-outline-variant/15 rounded-xl text-sm font-bold text-on-surface-variant hover:bg-surface transition-all"
                >
                  ← Back
                </button>
                <button
                  onClick={handleCreate}
                  disabled={saving}
                  className="flex-[2] py-2.5 rounded-xl text-sm font-bold bg-primary-container text-white hover:bg-primary-m3 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                  {saving ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Provisioning…</>
                  ) : (
                    <><Zap className="w-4 h-4" /> Provision Workspace</>
                  )}
                </button>
              </>
            )
          ) : (
            <>
              <button
                onClick={onClose}
                className="flex-1 py-2.5 border border-outline-variant/15 rounded-xl text-sm font-bold text-on-surface-variant hover:bg-surface transition-all"
              >
                Close
              </button>
              <button
                onClick={handleDone}
                className="flex-[2] py-2.5 rounded-xl text-sm font-bold bg-primary-container text-white hover:bg-primary-m3 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <Zap className="w-4 h-4" /> Switch to {created.clientName}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
