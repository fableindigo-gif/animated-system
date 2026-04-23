import { useState, useEffect } from "react";
import { trackEvent } from "@/lib/telemetry";
import {
  CheckCircle2, Zap, Loader2, ArrowRight, ShieldCheck,
  Store, AlertCircle, ExternalLink, Globe, Target,
  TrendingUp, Users, Phone, BarChart3, Settings2,
  Check, ChevronRight, Linkedin, Building2, ChevronDown,
} from "lucide-react";
import {
  SiShopify, SiGoogle, SiMeta, SiWoo, SiHubspot,
  SiSalesforce, SiTiktok, SiGoogleanalytics,
} from "react-icons/si";
import { cn } from "@/lib/utils";
import { getPlatformsForGoal, type Goal as StackGoal } from "@/lib/platform-stacks";
import { PrerequisiteHint } from "@/components/connections/prerequisite-hint";
import { useWorkspace } from "@/contexts/workspace-context";
import { authFetch } from "@/lib/auth-fetch";
import { useListConnections } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListConnectionsQueryKey } from "@workspace/api-client-react";
import { COUNTRY_CURRENCY, COUNTRIES } from "@/lib/localization/country-currency";

const BASE_URL = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE_URL.endsWith("/") ? BASE_URL.slice(0, -1) : BASE_URL;
const STORAGE_KEY = "omni_onboarding_complete";

// ─── Persistence ──────────────────────────────────────────────────────────────

export function useOnboardingState() {
  const [complete, setComplete] = useState(() => {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem(STORAGE_KEY) === "true";
  });

  const markComplete = () => {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, "true");
    setComplete(true);
  };

  const reset = () => {
    if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
    setComplete(false);
  };

  return { complete, markComplete, reset };
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Goal = "ecom" | "leadgen" | "hybrid";
type Step = 1 | 2 | 3 | 4;

// ─── Step Dot ─────────────────────────────────────────────────────────────────

function StepDot({ n, current, done }: { n: number; current: number; done: boolean }) {
  return (
    <div className={cn(
      "flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold font-mono border transition-all shrink-0",
      done        ? "bg-[#1a73e8]/15 border-[#1a73e8]/40 text-[#1a73e8]"
      : current === n ? "bg-[#1a73e8]/20 border-[#1a73e8]/40 text-[#1a73e8]"
                  : "bg-surface border-outline-variant/15 text-on-surface-variant",
    )}>
      {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : n}
    </div>
  );
}

// ─── STEP 1: Goal Selection ────────────────────────────────────────────────────

// Brand-consistent palette — all goals use OmniAnalytix blue for selection state.
// Per-goal icons use distinct shapes/emojis for differentiation, not different colours.
const GOALS: Array<{
  id: Goal;
  title: string;
  subtitle: string;
  description: string;
  examples: string;
  icon: React.ReactNode;
  emoji: string;
  checkpoints: string[];
}> = [
  {
    id: "ecom",
    title: "E-Commerce & Sales",
    subtitle: "Physical · Digital · DTC",
    description: "Optimise revenue, ROAS, and inventory-driven ad decisions for online stores.",
    examples: "Shopify, WooCommerce, DTC brands, marketplaces",
    emoji: "🏪",
    icon: <TrendingUp className="w-6 h-6" />,
    checkpoints:  ["Revenue & margin tracking", "POAS & ROAS optimisation", "Out-of-stock ad pausing"],
  },
  {
    id: "leadgen",
    title: "Lead Gen & Pipeline",
    subtitle: "B2B · Forms · Calls",
    description: "Sync CRM data, track cost per lead, and pause ads chasing junk leads.",
    examples: "B2B SaaS, agencies, professional services",
    emoji: "🎯",
    icon: <Users className="w-6 h-6" />,
    checkpoints:  ["CRM pipeline sync", "Cost-per-lead trend tracking", "Offline conversion upload"],
  },
  {
    id: "hybrid",
    title: "Hybrid — Sales + Lead Gen",
    subtitle: "DTC + B2B · Full Funnel",
    description: "Combines e-commerce revenue ops with lead gen pipeline — for businesses that sell direct AND generate qualified leads.",
    examples: "DTC brands with wholesale, SaaS with e-commerce, multi-model businesses",
    emoji: "🔀",
    icon: <BarChart3 className="w-6 h-6" />,
    checkpoints:  ["Dual-funnel analytics", "Revenue + pipeline KPIs", "Cross-channel attribution"],
  },
];

function GoalStep({ selected, onSelect }: { selected: Goal | null; onSelect: (g: Goal) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-on-surface mb-1">What is your primary conversion goal?</p>
        <p className="text-xs text-on-surface-variant leading-relaxed">
          Your answer personalises your platform stack and AI workflow library. You can change this later.
        </p>
      </div>

      <div className="grid gap-2.5">
        {GOALS.map((g) => {
          const active = selected === g.id;
          return (
            <button
              key={g.id}
              onClick={() => onSelect(g.id)}
              className={cn(
                "relative w-full text-left rounded-2xl border-2 p-4 transition-all duration-200",
                active
                  ? "bg-[#1a73e8]/6 border-[#1a73e8]/50 shadow-[0_0_0_1px_rgba(26,115,232,0.15)]"
                  : "border-outline-variant/15 bg-white/60 hover:border-[#1a73e8]/25 hover:bg-[#1a73e8]/3",
              )}
            >
              {/* Active check badge */}
              {active && (
                <div className="absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center bg-[#1a73e8] shadow-sm">
                  <Check className="w-3 h-3 text-white" />
                </div>
              )}

              <div className="flex items-start gap-3.5">
                {/* Emoji + icon */}
                <div className={cn(
                  "w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border text-xl transition-all",
                  active
                    ? "bg-[#1a73e8]/10 border-[#1a73e8]/25"
                    : "bg-surface border-outline-variant/15",
                )}>
                  {g.emoji}
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <p className={cn("text-sm font-bold", active ? "text-[#1a73e8]" : "text-on-surface")}>{g.title}</p>
                    <span className={cn(
                      "text-[9px] font-mono px-1.5 py-0.5 rounded border shrink-0",
                      active
                        ? "bg-[#1a73e8]/8 border-[#1a73e8]/25 text-[#1a73e8]"
                        : "bg-surface border-outline-variant/15 text-on-surface-variant",
                    )}>
                      {g.subtitle}
                    </span>
                  </div>
                  <p className="text-xs text-on-surface-variant leading-relaxed mb-2">{g.description}</p>

                  {/* Checkpoints */}
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {g.checkpoints.map((cp) => (
                      <span key={cp} className="flex items-center gap-1 text-[10px] font-mono text-on-surface-variant">
                        <Check className={cn("w-2.5 h-2.5 shrink-0", active ? "text-[#1a73e8]" : "text-on-surface-variant")} />
                        {cp}
                      </span>
                    ))}
                  </div>

                  {active && (
                    <div className="mt-2.5 pt-2.5 border-t border-[#1a73e8]/10">
                      <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-wider mb-1.5">Platforms included</p>
                      <div className="flex flex-wrap gap-1.5">
                        {getPlatformsForGoal(g.id).map((sp) => (
                          <span
                            key={sp.id}
                            className={cn(
                              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border",
                              sp.bgColor, sp.color, "border-current/10",
                            )}
                          >
                            {sp.shortLabel ?? sp.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {!selected && (
        <p className="text-center text-[10px] font-mono text-on-surface-variant pt-1">
          Select a goal above to continue →
        </p>
      )}
    </div>
  );
}

// ─── STEP 2: Lead Enrichment ────────────────────────────────────────────────────

const DISCOVERY_SOURCES = [
  "Google Search",
  "ChatGPT",
  "Other LLM / AI Assistant",
  "LinkedIn",
  "Referral / Word of Mouth",
  "Databricks Marketplace",
  "Snowflake Partner Connect",
  "Podcast / Newsletter",
  "Conference / Event",
  "Twitter / X",
  "Product Hunt",
  "Other",
] as const;

function EnrichmentStep({
  companyDomain,
  onDomainChange,
  headquartersCountry,
  onCountryChange,
  discoverySource,
  onSourceChange,
}: {
  companyDomain: string;
  onDomainChange: (v: string) => void;
  headquartersCountry: string;
  onCountryChange: (v: string) => void;
  discoverySource: string;
  onSourceChange: (v: string) => void;
}) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");

  const filteredCountries = countrySearch
    ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(countrySearch.toLowerCase()))
    : COUNTRIES;

  const selectedCountryName = COUNTRIES.find((c) => c.code === headquartersCountry)?.name || "";

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold text-on-surface mb-1">Try OmniAnalytix with your own data</p>
        <p className="text-xs text-on-surface-variant leading-relaxed">
          A few details to tailor your workspace, currency defaults, and compliance settings.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-on-surface mb-1.5">
            Company Website / Domain
          </label>
          <div className="relative">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant pointer-events-none" />
            <input
              type="text"
              value={companyDomain}
              onChange={(e) => onDomainChange(e.target.value)}
              placeholder="yourcompany.com"
              className="w-full bg-white border border-outline-variant/20 rounded-3xl pl-9 pr-4 py-3 text-sm text-on-surface font-mono outline-none focus:border-accent-blue/40 focus:ring-2 focus:ring-accent-blue/10 placeholder:text-on-surface-variant/50 transition-all"
            />
          </div>
          <p className="text-[10px] text-on-surface-variant mt-1.5 font-mono">
            Used for workspace branding and lead enrichment. Optional.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-on-surface mb-1.5">
            Headquarters (Country) <span className="text-error-m3">*</span>
          </label>
          <div className="relative">
            <button
              onClick={() => { setCountryOpen(!countryOpen); setCountrySearch(""); }}
              className={cn(
                "w-full flex items-center justify-between bg-white border rounded-3xl px-4 py-3 text-sm transition-all",
                countryOpen
                  ? "border-accent-blue/40 ring-2 ring-accent-blue/10"
                  : "border-outline-variant/20 hover:border-outline-variant/30",
              )}
            >
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-on-surface-variant" />
                <span className={selectedCountryName ? "text-on-surface" : "text-on-surface-variant/50"}>
                  {selectedCountryName || "Select your country..."}
                </span>
              </div>
              <ChevronDown className={cn("w-4 h-4 text-on-surface-variant transition-transform", countryOpen && "rotate-180")} />
            </button>

            {countryOpen && (
              <div className="absolute z-20 top-full mt-1.5 left-0 right-0 bg-white border border-outline-variant/15 rounded-2xl shadow-xl overflow-hidden">
                <div className="p-2 border-b border-outline-variant/10">
                  <input
                    type="text"
                    value={countrySearch}
                    onChange={(e) => setCountrySearch(e.target.value)}
                    placeholder="Search countries..."
                    className="w-full bg-surface rounded-xl px-3 py-2 text-sm outline-none placeholder:text-on-surface-variant/50"
                    autoFocus
                  />
                </div>
                <div className="max-h-[200px] overflow-y-auto py-1">
                  {filteredCountries.map((c) => (
                    <button
                      key={c.code}
                      onClick={() => {
                        onCountryChange(c.code);
                        setCountryOpen(false);
                      }}
                      className={cn(
                        "w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between",
                        headquartersCountry === c.code
                          ? "bg-accent-blue/8 text-accent-blue font-semibold"
                          : "text-on-surface hover:bg-surface",
                      )}
                    >
                      <span>{c.name}</span>
                      {COUNTRY_CURRENCY[c.code] && (
                        <span className="text-[10px] font-mono text-on-surface-variant">{COUNTRY_CURRENCY[c.code]}</span>
                      )}
                    </button>
                  ))}
                  {filteredCountries.length === 0 && (
                    <p className="px-4 py-3 text-sm text-on-surface-variant">No results</p>
                  )}
                </div>
              </div>
            )}
          </div>
          <p className="text-[10px] text-on-surface-variant mt-1.5 font-mono">
            Automates currency symbol and compliance region for your dashboards.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-on-surface mb-1.5">
            How did you hear about us?
          </label>
          <div className="relative">
            <button
              onClick={() => setSourceOpen(!sourceOpen)}
              className={cn(
                "w-full flex items-center justify-between bg-white border rounded-3xl px-4 py-3 text-sm transition-all",
                sourceOpen
                  ? "border-accent-blue/40 ring-2 ring-accent-blue/10"
                  : "border-outline-variant/20 hover:border-outline-variant/30",
              )}
            >
              <span className={discoverySource ? "text-on-surface" : "text-on-surface-variant/50"}>
                {discoverySource || "Select a source..."}
              </span>
              <ChevronDown className={cn("w-4 h-4 text-on-surface-variant transition-transform", sourceOpen && "rotate-180")} />
            </button>

            {sourceOpen && (
              <div className="absolute z-20 top-full mt-1.5 left-0 right-0 bg-white border border-outline-variant/15 rounded-2xl shadow-xl overflow-hidden">
                <div className="max-h-[220px] overflow-y-auto py-1">
                  {DISCOVERY_SOURCES.map((src) => (
                    <button
                      key={src}
                      onClick={() => {
                        onSourceChange(src);
                        setSourceOpen(false);
                      }}
                      className={cn(
                        "w-full text-left px-4 py-2.5 text-sm transition-colors",
                        discoverySource === src
                          ? "bg-accent-blue/8 text-accent-blue font-semibold"
                          : "text-on-surface hover:bg-surface",
                      )}
                    >
                      {src}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
        <p className="text-[10px] font-mono text-on-surface-variant">
          This information is private and never shared with third parties.
        </p>
      </div>
    </div>
  );
}

// ─── STEP 3: Platform Stack ────────────────────────────────────────────────────

interface PlatformDef {
  id: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
  goals: Goal[];
  connectable: "oauth_shopify" | "oauth_google" | "form_woo" | "webhook_headless" | "soon" | "ready";
  colorText: string;
  colorBg:   string;
  colorBorder: string;
}

const PLATFORMS: PlatformDef[] = [
  {
    id: "shopify", label: "Shopify", desc: "Revenue · inventory · margins",
    icon: <SiShopify className="w-4 h-4" />, goals: ["ecom", "hybrid"],
    connectable: "oauth_shopify",
    colorText: "text-emerald-400", colorBg: "bg-emerald-500/10", colorBorder: "border-emerald-500/30",
  },
  {
    id: "woocommerce", label: "WooCommerce", desc: "Orders · products · REST API",
    icon: <SiWoo className="w-4 h-4" />, goals: ["ecom", "hybrid"],
    connectable: "form_woo",
    colorText: "text-purple-400", colorBg: "bg-purple-500/10", colorBorder: "border-purple-500/30",
  },
  {
    id: "google_ads", label: "Google Ads", desc: "Campaigns · ROAS · bidding",
    icon: <SiGoogle className="w-4 h-4" />, goals: ["ecom", "leadgen", "hybrid"],
    connectable: "oauth_google",
    colorText: "text-[#60a5fa]", colorBg: "bg-primary-container/10", colorBorder: "border-primary-container/30",
  },
  {
    id: "meta", label: "Meta Ads", desc: "Facebook · Instagram campaigns",
    icon: <SiMeta className="w-4 h-4" />, goals: ["ecom", "leadgen", "hybrid"],
    connectable: "soon",
    colorText: "text-[#60a5fa]", colorBg: "bg-primary-container/10", colorBorder: "border-primary-container/30",
  },
  {
    id: "tiktok", label: "TikTok Ads", desc: "Performance · creative analysis",
    icon: <SiTiktok className="w-4 h-4" />, goals: ["ecom", "hybrid"],
    connectable: "soon",
    colorText: "text-pink-400", colorBg: "bg-pink-500/10", colorBorder: "border-pink-500/30",
  },
  {
    id: "ga4", label: "Google Analytics 4", desc: "Web traffic · funnels · events",
    icon: <SiGoogleanalytics className="w-4 h-4" />, goals: ["ecom", "leadgen", "hybrid"],
    connectable: "soon",
    colorText: "text-orange-400", colorBg: "bg-orange-500/10", colorBorder: "border-orange-500/30",
  },
  {
    id: "hubspot", label: "HubSpot", desc: "CRM · pipeline · deal stages",
    icon: <SiHubspot className="w-4 h-4" />, goals: ["leadgen", "hybrid"],
    connectable: "soon",
    colorText: "text-orange-400", colorBg: "bg-orange-500/10", colorBorder: "border-orange-500/30",
  },
  {
    id: "salesforce", label: "Salesforce", desc: "Opportunities · leads · accounts",
    icon: <SiSalesforce className="w-4 h-4" />, goals: ["leadgen", "hybrid"],
    connectable: "soon",
    colorText: "text-sky-400", colorBg: "bg-sky-500/10", colorBorder: "border-sky-500/30",
  },
  {
    id: "linkedin_ads", label: "LinkedIn Ads", desc: "B2B campaigns · lead gen forms",
    icon: <Linkedin className="w-4 h-4" />, goals: ["leadgen", "hybrid"],
    connectable: "soon",
    colorText: "text-[#60a5fa]", colorBg: "bg-primary-container/8", colorBorder: "border-primary-container/30",
  },
  {
    id: "headless", label: "Custom / Headless", desc: "Any platform via webhook push",
    icon: <Globe className="w-4 h-4" />, goals: ["ecom", "leadgen", "hybrid"],
    connectable: "webhook_headless",
    colorText: "text-accent-blue", colorBg: "bg-accent-blue/10", colorBorder: "border-cyan-500/30",
  },
];

// Inline Shopify quick-connect sub-form
function ShopifyQuickConnect({ onDone }: { onDone: () => void }) {
  const [shop, setShop]         = useState("");
  const [shopError, setShopError] = useState("");
  const handleConnect = () => {
    const domain = shop.trim().toLowerCase();
    if (!domain) { setShopError("Enter your .myshopify.com domain."); return; }
    const norm = domain.includes(".myshopify.com") ? domain : `${domain}.myshopify.com`;
    if (!/^[a-zA-Z0-9-]+\.myshopify\.com$/.test(norm)) { setShopError("Must be a valid .myshopify.com domain."); return; }
    window.location.href = `${API_BASE}/api/auth/shopify/start?shop=${encodeURIComponent(norm)}`;
  };
  return (
    <div className="mt-3 space-y-2 border-t border-emerald-500/20 pt-3">
      <input
        type="text"
        value={shop}
        onChange={(e) => { setShop(e.target.value); setShopError(""); }}
        onKeyDown={(e) => e.key === "Enter" && handleConnect()}
        placeholder="my-store.myshopify.com"
        autoFocus
        className="w-full bg-surface border border-outline-variant/15 rounded-2xl px-3 py-2 text-xs text-on-surface font-mono outline-none focus:border-emerald-500/50 placeholder:text-on-surface-variant"
      />
      {shopError && <p className="text-[10px] text-rose-400 font-mono flex items-center gap-1"><AlertCircle className="w-3 h-3" />{shopError}</p>}
      <div className="flex gap-2">
        <button onClick={handleConnect} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-on-surface transition-all">
          <SiShopify className="w-3.5 h-3.5" /> Connect <ExternalLink className="w-3 h-3 opacity-70" />
        </button>
        <button onClick={onDone} className="px-3 py-2 rounded-2xl border border-outline-variant/15 text-[10px] font-mono text-on-surface-variant hover:text-on-surface-variant transition-colors">Later</button>
      </div>
      <p className="flex items-center gap-1 text-[10px] font-mono text-on-surface-variant"><ShieldCheck className="w-3 h-3 text-emerald-500 shrink-0" />OAuth · tokens stored encrypted</p>
    </div>
  );
}

// Inline Google Ads quick-connect sub-form
function GoogleQuickConnect({ onDone }: { onDone: () => void }) {
  const [customerId, setCustomerId] = useState("");
  const [mccId, setMccId]           = useState("");
  const [error, setError]           = useState("");
  const [saving, setSaving]         = useState(false);
  const handleConnect = () => {
    if (!customerId.trim()) { setError("Target Account ID is required."); return; }
    try { sessionStorage.setItem("omni_gads_customer_id", customerId.trim()); sessionStorage.setItem("omni_gads_mcc_id", mccId.trim()); } catch { /* ignore */ }
    setSaving(true);
    window.location.href = `${API_BASE}/api/auth/google/start?platform=google_ads`;
  };
  return (
    <div className="mt-3 space-y-2 border-t border-primary-container/20 pt-3">
      <input type="text" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setError(""); }} placeholder="123-456-7890 (Target Account ID)" autoFocus className="w-full bg-surface border border-outline-variant/15 rounded-2xl px-3 py-2 text-xs text-on-surface font-mono outline-none focus:border-primary-container/50 placeholder:text-on-surface-variant" />
      <input type="text" value={mccId} onChange={(e) => setMccId(e.target.value)} placeholder="100-200-3000 (MCC / Manager — optional)" className="w-full bg-surface border border-outline-variant/15 rounded-2xl px-3 py-2 text-xs text-on-surface font-mono outline-none focus:border-primary-container/50 placeholder:text-on-surface-variant" />
      {error && <p className="text-[10px] text-rose-400 font-mono flex items-center gap-1"><AlertCircle className="w-3 h-3" />{error}</p>}
      <div className="flex gap-2">
        <button onClick={handleConnect} disabled={saving} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-2xl bg-primary-container hover:bg-primary-container disabled:opacity-60 text-xs font-bold text-on-surface transition-all">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <SiGoogle className="w-3.5 h-3.5" />} Connect <ExternalLink className="w-3 h-3 opacity-70" />
        </button>
        <button onClick={onDone} className="px-3 py-2 rounded-2xl border border-outline-variant/15 text-[10px] font-mono text-on-surface-variant hover:text-on-surface-variant transition-colors">Later</button>
      </div>
    </div>
  );
}

// Inline WooCommerce sub-form
function WooQuickConnect({ onDone }: { onDone: () => void }) {
  const [url, setUrl]     = useState("");
  const [key, setKey]     = useState("");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");
  const handleConnect = async () => {
    if (!url.trim() || !key.trim() || !secret.trim()) { setError("All three fields are required."); return; }
    setSaving(true);
    try {
      const storeLabel = url.replace(/^https?:\/\//, "").split("/")[0];
      const resp = await authFetch(`${API_BASE}/api/connections`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "woocommerce", displayName: storeLabel, credentials: { storeUrl: url.trim(), consumerKey: key.trim(), consumerSecret: secret.trim() } }),
      });
      if (!resp.ok) throw new Error();
      onDone();
    } catch { setError("Could not connect. Check credentials."); }
    finally { setSaving(false); }
  };
  return (
    <div className="mt-3 space-y-2 border-t border-purple-500/20 pt-3">
      {[
        { ph: "https://yourstore.com", val: url, set: setUrl, pw: false },
        { ph: "ck_xxxx (Consumer Key)", val: key, set: setKey, pw: false },
        { ph: "cs_xxxx (Consumer Secret)", val: secret, set: setSecret, pw: true },
      ].map(({ ph, val, set, pw }, i) => (
        <input key={i} type={pw ? "password" : "text"} value={val} placeholder={ph} onChange={(e) => { set(e.target.value); setError(""); }} className="w-full bg-surface border border-outline-variant/15 rounded-2xl px-3 py-2 text-xs text-on-surface font-mono outline-none focus:border-purple-500/50 placeholder:text-on-surface-variant" />
      ))}
      {error && <p className="text-[10px] text-rose-400 font-mono flex items-center gap-1"><AlertCircle className="w-3 h-3" />{error}</p>}
      <div className="flex gap-2">
        <button onClick={handleConnect} disabled={saving} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-2xl bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-xs font-bold text-on-surface transition-all">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Store className="w-3.5 h-3.5" />} Connect
        </button>
        <button onClick={onDone} className="px-3 py-2 rounded-2xl border border-outline-variant/15 text-[10px] font-mono text-on-surface-variant hover:text-on-surface-variant transition-colors">Later</button>
      </div>
    </div>
  );
}

// Inline Custom / Headless webhook display
function HeadlessWebhookDisplay({ onDone }: { onDone: () => void }) {
  const webhookUrl = `${API_BASE}/api/webhooks/ecommerce/product-update`;
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <div className="mt-3 space-y-3 border-t border-accent-blue/20 pt-3">
      <p className="text-[10px] font-mono text-on-surface-variant leading-relaxed">
        POST product events to this endpoint from any platform, ERP, or backend:
      </p>
      <div className="flex items-start gap-2 bg-surface border border-accent-blue/20 rounded-2xl px-3 py-2.5">
        <code className="flex-1 text-[9px] font-mono text-accent-blue break-all leading-relaxed">{webhookUrl}</code>
        <button
          onClick={handleCopy}
          className="shrink-0 flex items-center gap-1 px-2 py-1 rounded border border-accent-blue/20 bg-accent-blue/8 text-accent-blue text-[9px] font-mono hover:bg-accent-blue/15 transition-all"
        >
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <div className="rounded-2xl border border-outline-variant/15 bg-white/50 px-3 py-2 space-y-1">
        <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-wider">Required payload fields</p>
        <code className="block text-[9px] font-mono text-on-surface-variant leading-relaxed">
          {`{ event: "out_of_stock" | "deleted" | "in_stock", sku: "SKU-001", product_name: "Widget", inventory_qty: 0 }`}
        </code>
      </div>
      <button onClick={onDone} className="text-[10px] font-mono text-on-surface-variant hover:text-on-surface-variant transition-colors">
        Done
      </button>
    </div>
  );
}

function StackStep({
  goal,
  selected,
  onToggle,
  connections,
}: {
  goal: Goal;
  selected: Set<string>;
  onToggle: (id: string) => void;
  connections: Array<{ platform: string; isActive?: boolean | null }>;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const visible = PLATFORMS.filter((p) => p.goals.includes(goal));
  const isConnected = (id: string) => connections.some((c) => c.platform === id && !!c.isActive);
  const goalMeta = GOALS.find((g) => g.id === goal)!;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-on-surface mb-0.5">Choose your data ecosystem</p>
        <p className="text-xs text-on-surface-variant leading-relaxed">
          Select the platforms in <span className="font-semibold text-[#1a73e8]">{goalMeta.title}</span> scope.
          Quick-connect available for key platforms — others can be wired in from the Connections page.
        </p>
      </div>

      <div className="space-y-2">
        {visible.map((p) => {
          const conn    = isConnected(p.id);
          const active  = selected.has(p.id) || conn;
          const isOpen  = expanded === p.id;
          const canQuickConnect = p.connectable !== "soon" && !conn;

          return (
            <div
              key={p.id}
              className={cn(
                "rounded-2xl border transition-all duration-200",
                active
                  ? cn(p.colorBg, p.colorBorder)
                  : "border-outline-variant/15 bg-white/50 hover:border-outline",
              )}
            >
              <div className="flex items-center gap-3 p-3">
                {/* Select checkbox */}
                <button
                  onClick={() => { onToggle(p.id); if (isOpen && !active) setExpanded(null); }}
                  className={cn(
                    "w-4.5 h-4.5 rounded border-2 flex items-center justify-center shrink-0 transition-all",
                    active ? cn("border-current bg-current/20", p.colorBorder) : "border-on-surface-variant",
                  )}
                  style={{ borderColor: active ? undefined : undefined }}
                >
                  {(active) && <Check className={cn("w-3 h-3", p.colorText)} />}
                </button>

                {/* Icon */}
                <div className={cn("w-7 h-7 rounded-2xl flex items-center justify-center shrink-0 border", p.colorBg, p.colorBorder)}>
                  <span className={p.colorText}>{p.icon}</span>
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={cn("text-xs font-semibold", active ? p.colorText : "text-on-surface-variant")}>{p.label}</p>
                    {conn && (
                      <span className="flex items-center gap-1 text-[8px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-1">
                        <Check className="w-2 h-2" /> Live
                      </span>
                    )}
                    {p.connectable === "soon" && (
                      <span className="text-[8px] font-mono text-on-surface-variant bg-surface border border-outline-variant/15 rounded px-1">
                        Soon
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] font-mono text-on-surface-variant">{p.desc}</p>
                </div>

                {/* Quick connect toggle */}
                {canQuickConnect && (
                  <button
                    onClick={() => setExpanded(isOpen ? null : p.id)}
                    className={cn(
                      "shrink-0 text-[10px] font-mono flex items-center gap-1 transition-colors",
                      isOpen ? p.colorText : "text-on-surface-variant hover:text-on-surface-variant",
                    )}
                  >
                    {isOpen ? "Close" : "Connect"} <ChevronRight className={cn("w-3 h-3 transition-transform", isOpen && "rotate-90")} />
                  </button>
                )}
              </div>

              {/* Quick-connect form */}
              {isOpen && !conn && (
                <div className="px-3 pb-3">
                  {p.connectable === "oauth_shopify"    && <><ShopifyQuickConnect onDone={() => { setExpanded(null); onToggle(p.id); }} /><PrerequisiteHint text="Requires Store Owner permissions to approve read/write scopes." inline /></>}
                  {p.connectable === "oauth_google"     && <><GoogleQuickConnect  onDone={() => { setExpanded(null); onToggle(p.id); }} /><PrerequisiteHint text="Requires Admin or Standard access to your Google Ads account." inline /></>}
                  {p.connectable === "form_woo"         && <WooQuickConnect     onDone={() => { setExpanded(null); onToggle(p.id); }} />}
                  {p.connectable === "webhook_headless" && <HeadlessWebhookDisplay onDone={() => { setExpanded(null); onToggle(p.id); }} />}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selected.size === 0 && !visible.some((p) => isConnected(p.id)) && (
        <p className="text-center text-[10px] font-mono text-on-surface-variant">
          Select at least one platform — or continue and connect later
        </p>
      )}

    </div>
  );
}

// ─── STEP 3: Workflow Selection ────────────────────────────────────────────────

interface WorkflowDef {
  id: string;
  label: string;
  desc: string;
  badge: string;
  badgeColor: string;
  goals: Goal[];
  icon: React.ReactNode;
}

const WORKFLOWS: WorkflowDef[] = [
  {
    id: "margin_bleed_xray",
    label: "Margin Bleed X-Ray",
    desc: "Detects campaigns spending on SKUs with negative contribution margins in real time.",
    badge: "Inventory · POAS",
    badgeColor: "text-rose-400 bg-error-container/10 border-rose-500/20",
    goals: ["ecom", "hybrid"],
    icon: <BarChart3 className="w-4 h-4" />,
  },
  {
    id: "oos_ad_pausing",
    label: "Out-of-Stock Ad Pausing",
    desc: "Auto-pauses Google & Meta ad groups when Shopify inventory hits zero.",
    badge: "Automation",
    badgeColor: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    goals: ["ecom", "hybrid"],
    icon: <Store className="w-4 h-4" />,
  },
  {
    id: "true_poas_tracking",
    label: "True POAS Tracking",
    desc: "Correlates ad spend against actual product margin, not just revenue.",
    badge: "Reporting",
    badgeColor: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    goals: ["ecom", "hybrid"],
    icon: <TrendingUp className="w-4 h-4" />,
  },
  {
    id: "crm_pipeline_sync",
    label: "CRM Pipeline Sync",
    desc: "Pushes ad-attributed leads into HubSpot or Salesforce deal stages automatically.",
    badge: "CRM",
    badgeColor: "text-orange-400 bg-orange-500/10 border-orange-500/20",
    goals: ["leadgen", "hybrid"],
    icon: <Users className="w-4 h-4" />,
  },
  {
    id: "junk_lead_pausing",
    label: "Junk Lead Ad Pausing",
    desc: "Pauses ad sets with high junk-lead rates using CRM close-rate signals.",
    badge: "Automation",
    badgeColor: "text-rose-400 bg-error-container/10 border-rose-500/20",
    goals: ["leadgen", "hybrid"],
    icon: <Target className="w-4 h-4" />,
  },
  {
    id: "offline_conversion_uploader",
    label: "Offline Conversion Uploader",
    desc: "Syncs signed deals and calls back to Google Ads as enhanced conversions.",
    badge: "Tracking",
    badgeColor: "text-[#60a5fa] bg-primary-container/10 border-primary-container/20",
    goals: ["leadgen", "hybrid"],
    icon: <Phone className="w-4 h-4" />,
  },
  {
    id: "cpl_arbitrage",
    label: "CPL Arbitrage",
    desc: "Surfaces channels where qualified CPL is lowest — instantly rebalances budget.",
    badge: "Optimisation",
    badgeColor: "text-violet-400 bg-violet-500/10 border-violet-500/20",
    goals: ["leadgen", "hybrid"],
    icon: <Settings2 className="w-4 h-4" />,
  },
  {
    id: "tag_gateway_signal_recovery",
    label: "First-Party Signal Recovery (Tag Gateway)",
    desc: "Audits your Google Tags for third-party domain exposure and guides Tag Gateway adoption to recover 15-25% lost conversion signals from ITP, ETP, and ad blockers.",
    badge: "Signal Recovery",
    badgeColor: "text-accent-blue bg-accent-blue/10 border-accent-blue/20",
    goals: ["ecom", "leadgen", "hybrid"],
    icon: <ShieldCheck className="w-4 h-4" />,
  },
];

function WorkflowStep({
  goal,
  selected,
  onToggle,
  saving,
  onEnter,
}: {
  goal: Goal;
  selected: Set<string>;
  onToggle: (id: string) => void;
  saving: boolean;
  onEnter: () => void;
}) {
  const visible    = WORKFLOWS.filter((w) => w.goals.includes(goal));
  const goalMeta   = GOALS.find((g) => g.id === goal)!;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-on-surface mb-0.5">Select your workflows</p>
        <p className="text-xs text-on-surface-variant leading-relaxed">
          These AI-powered automations will be pre-configured for your{" "}
          <span className="font-semibold text-[#1a73e8]">{goalMeta.title}</span> stack.
          Select all that apply.
        </p>
      </div>

      <div className="space-y-2">
        {visible.map((w) => {
          const active = selected.has(w.id);
          return (
            <button
              key={w.id}
              onClick={() => onToggle(w.id)}
              className={cn(
                "w-full text-left rounded-2xl border p-3.5 transition-all group",
                active
                  ? "border-accent-blue/30 bg-accent-blue/5 shadow-sm"
                  : "border-outline-variant/15 bg-white/50 hover:border-outline",
              )}
            >
              <div className="flex items-start gap-3">
                {/* Checkbox */}
                <div className={cn(
                  "w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all",
                  active ? "border-[#0081FB] bg-accent-blue/20" : "border-on-surface-variant",
                )}>
                  {active && <Check className="w-2.5 h-2.5 text-accent-blue" />}
                </div>

                {/* Icon */}
                <div className={cn(
                  "w-8 h-8 rounded-2xl flex items-center justify-center shrink-0 border transition-all",
                  active ? "bg-accent-blue/10 border-accent-blue/20 text-accent-blue" : "bg-surface/60 border-outline-variant/15 text-on-surface-variant",
                )}>
                  {w.icon}
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center flex-wrap gap-2 mb-1">
                    <p className={cn("text-xs font-bold", active ? "text-on-surface" : "text-on-surface-variant")}>{w.label}</p>
                    <span className={cn("text-[8px] font-mono px-1.5 py-0.5 rounded border", w.badgeColor)}>{w.badge}</span>
                  </div>
                  <p className="text-[11px] text-on-surface-variant font-mono leading-relaxed">{w.desc}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Connection summary chips */}
      <div className="flex items-center gap-2 flex-wrap px-1">
        <Zap className="w-3 h-3 text-accent-blue shrink-0" />
        <span className="text-[10px] font-mono text-on-surface-variant">
          {selected.size === 0 ? "No workflows selected — you can activate them later" : `${selected.size} workflow${selected.size !== 1 ? "s" : ""} selected`}
        </span>
      </div>

      {/* Enter Command Center CTA */}
      <button
        onClick={onEnter}
        disabled={saving}
        className={cn(
          "relative w-full flex items-center justify-center gap-2.5 py-4 rounded-2xl",
          "text-sm font-bold text-surface transition-all",
          "bg-[#0081FB] hover:bg-[#00c4df] disabled:opacity-70",
          "shadow-lg shadow-[#0081FB]/20",
          !saving && "after:absolute after:inset-0 after:rounded-2xl after:shadow-[0_0_24px_6px_rgba(0,218,248,0.15)] after:pointer-events-none",
        )}
      >
        {saving ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Configuring your Command Center…</>
        ) : (
          <><Zap className="w-4 h-4" /> Enter Command Center <ArrowRight className="w-4 h-4" /></>
        )}
      </button>
    </div>
  );
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

interface OnboardingWizardProps {
  onComplete: () => void;
  onLaunchDiagnostic: () => void;
}

export function OnboardingWizard({ onComplete, onLaunchDiagnostic }: OnboardingWizardProps) {
  const queryClient = useQueryClient();
  // orval's strict UseQueryOptions requires queryKey, but the generated hook
  // injects a default key internally. Cast options to satisfy the type and
  // narrow the data with the connection shape used downstream.
  // The 3-second poll was masking a missing invalidation: connection-dialog
  // already invalidates the connections query on a successful link, so we can
  // rely on react-query's default refetch-on-focus + that invalidation to keep
  // the connection state fresh — no more 20-req/min idle hammering.
  type ConnRow = { platform: string; isActive?: boolean | null };
  const { data: connections = [] as ConnRow[] } = useListConnections() as { data: ConnRow[] | undefined };

  // ── Derived connection flags ───────────────────────────────────────────────
  const shopifyConnected = connections.some((c) => c.platform === "shopify" && !!c.isActive);
  const googleConnected  = connections.some((c) =>
    ["google_ads", "gsc", "youtube"].includes(c.platform ?? "") && !!c.isActive,
  );

  // ── Wizard state ──────────────────────────────────────────────────────────
  const [step, setStep]                   = useState<Step>(1);
  const [goal, setGoal]                   = useState<Goal | null>(null);
  const [companyDomain, setCompanyDomain] = useState("");
  const [headquartersCountry, setHeadquartersCountry] = useState("");
  const [discoverySource, setDiscoverySource] = useState("");
  const [selectedPlatforms, setPlatforms] = useState<Set<string>>(new Set());
  const [selectedWorkflows, setWorkflows] = useState<Set<string>>(new Set());
  const [saving, setSaving]               = useState(false);

  // Auto-populate platforms from existing connections
  useEffect(() => {
    const connected: string[] = [];
    if (shopifyConnected) connected.push("shopify");
    if (googleConnected)  connected.push("google_ads");
    if (connected.length) setPlatforms((prev) => new Set([...prev, ...connected]));
  }, [shopifyConnected, googleConnected]);

  const togglePlatform = (id: string) => setPlatforms((prev) => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const toggleWorkflow = (id: string) => setWorkflows((prev) => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const canAdvanceFromGoal       = goal !== null;
  const canAdvanceFromEnrichment = headquartersCountry !== "";
  const canAdvanceFromStack      = true;

  // ── Enter Command Center ──────────────────────────────────────────────────
  const { activeWorkspace, refreshWorkspaces } = useWorkspace();

  const handleEnter = async () => {
    setSaving(true);
    try {
      // Save goal + platforms + workflows to the active client workspace (sub-account level)
      if (activeWorkspace) {
        await authFetch(`${API_BASE}/api/workspaces/${activeWorkspace.id}/onboarding`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            primaryGoal:         goal,
            companyDomain:       companyDomain.trim() || undefined,
            headquartersCountry: headquartersCountry || undefined,
            discoverySource:     discoverySource || undefined,
            enabledIntegrations: Array.from(selectedPlatforms),
            selectedWorkflows:   Array.from(selectedWorkflows),
          }),
        });
        await refreshWorkspaces();
      }
    } catch { /* non-fatal */ }
    finally {
      setSaving(false);
      queryClient.invalidateQueries({ queryKey: getListConnectionsQueryKey() });
      trackEvent("onboarding_completed", { goal, mode: "standard", workflows: selectedWorkflows.size });
      onComplete();
      if (selectedWorkflows.size > 0 || (shopifyConnected && googleConnected)) {
        setTimeout(onLaunchDiagnostic, 400);
      }
    }
  };

  const STEP_LABELS: ["Goal", "About", "Stack", "Workflows"] = ["Goal", "About", "Stack", "Workflows"];
  const STEP_ICONS = [Target, Building2, Store, Settings2] as const;
  const progressPct = step === 1 ? "20%" : step === 2 ? "45%" : step === 3 ? "70%" : "90%";

  const goalMeta = goal ? GOALS.find((g) => g.id === goal) : null;

  return (
    <div className="fixed inset-0 z-[9999] bg-[rgb(0,35,80)]/60 backdrop-blur-md flex items-end sm:items-center sm:p-4">
      <div className="w-full max-w-3xl flex rounded-t-2xl sm:rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.4)] overflow-hidden" style={{ maxHeight: "92dvh" }}>

        {/* ── Left: Brand Panel ──────────────────────────────────────────── */}
        <div className="hidden md:flex flex-col w-64 shrink-0 overflow-y-auto" style={{ background: "rgb(0,74,198)" }}>
          {/* Logo */}
          <div className="px-7 pt-8 pb-6 border-b border-white/10">
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-8 h-8 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center shrink-0">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <span className="text-[15px] font-bold text-white tracking-tight" style={{ fontFamily: "'Manrope', sans-serif" }}>OmniAnalytix</span>
            </div>
            <p className="text-[10px] text-white/50 font-mono uppercase tracking-widest pl-[42px]">Enterprise AI Intelligence</p>
          </div>

          {/* Step tracker */}
          <div className="px-7 py-6 flex-1">
            <p className="text-[9px] font-mono text-white/40 uppercase tracking-widest mb-4">Setup Progress</p>
            <div className="space-y-1">
              {STEP_LABELS.map((label, i) => {
                const n = i + 1;
                const done    = step > n;
                const current = step === n;
                const StepIcon = STEP_ICONS[i];
                return (
                  <div key={label} className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all",
                    current ? "bg-white/15" : "bg-transparent",
                  )}>
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center shrink-0 border transition-all text-[10px] font-bold",
                      done    ? "bg-white text-[rgb(0,74,198)] border-white"
                      : current ? "bg-white/20 border-white/50 text-white"
                               : "bg-white/8 border-white/15 text-white/35",
                    )}>
                      {done ? <Check className="w-3 h-3" /> : <StepIcon className="w-3 h-3" />}
                    </div>
                    <span className={cn(
                      "text-[12px] font-semibold transition-colors",
                      current ? "text-white" : done ? "text-white/65" : "text-white/30",
                    )}>{label}</span>
                    {current && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white/70 animate-pulse" />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Value props */}
          <div className="px-7 py-6 border-t border-white/10 space-y-2.5">
            {[
              "AI diagnostic engine",
              "Platform-native integrations",
              "Automated workflow builder",
              "Goal-routed analytics",
            ].map((v) => (
              <div key={v} className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-white/50 shrink-0" />
                <span className="text-[11px] text-white/50 leading-tight">{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Right: Content Panel ───────────────────────────────────────── */}
        <div className="flex-1 flex flex-col bg-white min-w-0 overflow-y-auto">

          {/* Mobile-only header bar */}
          <div className="md:hidden flex items-center justify-between px-5 py-3.5 border-b border-outline-variant/15" style={{ background: "rgb(0,74,198)" }}>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-white" />
              <span className="text-[14px] font-bold text-white" style={{ fontFamily: "'Manrope', sans-serif" }}>OmniAnalytix</span>
            </div>
            <span className="text-[10px] font-mono text-white/60 uppercase tracking-wider">Step {step} of 4</span>
          </div>

          {/* Progress bar */}
          <div className="px-6 pt-5 pb-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest">Setup Progress</span>
              <span className="text-[9px] font-mono text-[#1a73e8] tabular-nums font-semibold">{progressPct}</span>
            </div>
            <div className="h-1 rounded-full bg-surface overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{ width: progressPct, background: "linear-gradient(90deg, rgb(0,74,198), #1a73e8)" }}
              />
            </div>

            {/* Mobile step pills */}
            <div className="md:hidden flex items-center gap-0 mt-3">
              {([1, 2, 3, 4] as const).map((s, i) => (
                <div key={s} className="flex items-center flex-1">
                  <div className="flex flex-col items-center gap-1">
                    <StepDot n={s} current={step} done={step > s} />
                    <span className={cn(
                      "text-[8px] font-mono uppercase tracking-widest",
                      step === s ? "text-[#1a73e8] font-bold" : "text-on-surface-variant",
                    )}>
                      {STEP_LABELS[i]}
                    </span>
                  </div>
                  {i < 3 && (
                    <div className={cn(
                      "flex-1 h-px mx-1 mb-3",
                      step > s ? "bg-[#1a73e8]/30" : "bg-surface",
                    )} />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Content area */}
          <div className="flex-1 px-6 py-5">

            {/* Goal badge (steps 2-4) */}
            {goalMeta && step > 1 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl border mb-4 text-xs font-mono bg-[#1a73e8]/6 border-[#1a73e8]/25 text-[#1a73e8]">
                <span className="text-base leading-none">{goalMeta.emoji}</span>
                <span className="font-semibold truncate">{goalMeta.title}</span>
                <span className="text-on-surface-variant shrink-0">· Goal locked</span>
                <button
                  onClick={() => setStep(1)}
                  className="ml-auto text-[9px] text-[#1a73e8] hover:underline shrink-0 transition-colors"
                >
                  Change →
                </button>
              </div>
            )}

            {/* Step content */}
            {step === 1 && (
              <GoalStep selected={goal} onSelect={(g) => { setGoal(g); }} />
            )}
            {step === 2 && goal && (
              <EnrichmentStep
                companyDomain={companyDomain}
                onDomainChange={setCompanyDomain}
                headquartersCountry={headquartersCountry}
                onCountryChange={setHeadquartersCountry}
                discoverySource={discoverySource}
                onSourceChange={setDiscoverySource}
              />
            )}
            {step === 3 && goal && (
              <StackStep goal={goal} selected={selectedPlatforms} onToggle={togglePlatform} connections={connections} />
            )}
            {step === 4 && goal && (
              <WorkflowStep goal={goal} selected={selectedWorkflows} onToggle={toggleWorkflow} saving={saving} onEnter={handleEnter} />
            )}
          </div>

          {/* Footer navigation */}
          <div className="border-t border-outline-variant/10 px-6 py-4 flex items-center justify-between bg-white shrink-0">
            <button
              onClick={() => step > 1 && setStep((s) => (s - 1) as Step)}
              disabled={step === 1}
              className="flex items-center gap-1.5 text-[11px] font-mono text-on-surface-variant hover:text-on-surface disabled:opacity-30 transition-colors"
            >
              ← Back
            </button>

            {step < 4 && (() => {
              const blocked =
                (step === 1 && !canAdvanceFromGoal) ||
                (step === 2 && !canAdvanceFromEnrichment);
              return (
                <button
                  onClick={() => { if (!blocked) setStep((s) => (s + 1) as Step); }}
                  disabled={blocked}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-semibold transition-all",
                    blocked
                      ? "text-on-surface-variant cursor-not-allowed opacity-40"
                      : "bg-[#1a73e8] text-white hover:bg-[#1557b0] shadow-sm active:scale-[0.98]",
                  )}
                >
                  {step === 1 ? "Lock in goal" : step === 2 ? "Continue" : "Skip step"}
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
