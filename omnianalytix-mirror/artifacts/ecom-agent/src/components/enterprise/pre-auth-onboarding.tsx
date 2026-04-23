import { useState } from "react";
import {
  ArrowLeft, X, ArrowRight, ShieldCheck,
  TrendingUp, Users, BarChart3,
  Check, Zap, Activity, Globe,
  ChevronRight, Layers, Shield,
} from "lucide-react";
import {
  SiShopify, SiGoogle, SiMeta, SiWoo, SiHubspot,
  SiSalesforce, SiTiktok, SiGoogleanalytics,
} from "react-icons/si";
import { Linkedin } from "lucide-react";
import { cn } from "@/lib/utils";

const PREAUTH_STORAGE_KEY = "omni_preauth_complete";
const PREAUTH_GOAL_KEY = "omni_preauth_goal";
const PREAUTH_PLATFORMS_KEY = "omni_preauth_platforms";

export function usePreAuthState() {
  const [complete, setComplete] = useState(() => {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem(PREAUTH_STORAGE_KEY) === "true";
  });

  const markComplete = (goal: string, platforms: string[]) => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(PREAUTH_STORAGE_KEY, "true");
      localStorage.setItem(PREAUTH_GOAL_KEY, goal);
      localStorage.setItem(PREAUTH_PLATFORMS_KEY, JSON.stringify(platforms));
    }
    setComplete(true);
  };

  return { complete, markComplete };
}

export function getPreAuthSelections(): { goal: string | null; platforms: string[] } {
  if (typeof localStorage === "undefined") return { goal: null, platforms: [] };
  const goal = localStorage.getItem(PREAUTH_GOAL_KEY);
  try {
    const platforms = JSON.parse(localStorage.getItem(PREAUTH_PLATFORMS_KEY) || "[]");
    return { goal, platforms };
  } catch {
    return { goal, platforms: [] };
  }
}

export function clearPreAuthSelections() {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(PREAUTH_GOAL_KEY);
    localStorage.removeItem(PREAUTH_PLATFORMS_KEY);
  }
}

type Goal = "ecom" | "leadgen" | "hybrid";
type Step = 1 | 2;

const GOALS: Array<{
  id: Goal;
  title: string;
  subtitle: string;
  description: string;
  icon: React.ReactNode;
  checkpoints: string[];
  throughput: string;
  throughputLabel: string;
  statValue: string;
  statLabel: string;
  statusBadge: string;
}> = [
  {
    id: "ecom",
    title: "E-Commerce & Sales",
    subtitle: "Physical · Digital · DTC",
    description: "Optimise revenue, ROAS, and inventory-driven ad decisions for online stores.",
    icon: <TrendingUp className="w-5 h-5" />,
    checkpoints: ["Revenue & margin tracking", "POAS & ROAS optimisation", "Out-of-stock ad pausing"],
    throughput: "Revenue Focus",
    throughputLabel: "Throughput",
    statValue: "94.7%",
    statLabel: "Revenue Accuracy",
    statusBadge: "Popular",
  },
  {
    id: "leadgen",
    title: "Lead Gen & Pipeline",
    subtitle: "B2B · Forms · Calls",
    description: "Sync CRM data, track CPL, and pause ads targeting junk lead segments.",
    icon: <Users className="w-5 h-5" />,
    checkpoints: ["CRM pipeline sync", "CPL arbitrage tracking", "Offline conversion upload"],
    throughput: "Pipeline Focus",
    throughputLabel: "Throughput",
    statValue: "87.3%",
    statLabel: "Lead Quality Score",
    statusBadge: "B2B",
  },
  {
    id: "hybrid",
    title: "Hybrid — Sales + Lead Gen",
    subtitle: "DTC + B2B · Full Funnel",
    description: "Combines e-commerce revenue ops with lead gen pipeline.",
    icon: <BarChart3 className="w-5 h-5" />,
    checkpoints: ["Dual-funnel analytics", "Revenue + pipeline KPIs", "Cross-channel attribution"],
    throughput: "Full Funnel",
    throughputLabel: "Throughput",
    statValue: "98.4%",
    statLabel: "Funnel Coverage",
    statusBadge: "Advanced",
  },
];

interface PlatformDef {
  id: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
  goals: Goal[];
}

const PLATFORMS: PlatformDef[] = [
  { id: "shopify", label: "Shopify", desc: "Revenue · inventory · margins", icon: <SiShopify className="w-4 h-4" />, goals: ["ecom", "hybrid"] },
  { id: "woocommerce", label: "WooCommerce", desc: "Orders · products · REST API", icon: <SiWoo className="w-4 h-4" />, goals: ["ecom", "hybrid"] },
  { id: "google_ads", label: "Google Ads", desc: "Campaigns · ROAS · bidding", icon: <SiGoogle className="w-4 h-4" />, goals: ["ecom", "leadgen", "hybrid"] },
  { id: "meta", label: "Meta Ads", desc: "Facebook · Instagram campaigns", icon: <SiMeta className="w-4 h-4" />, goals: ["ecom", "leadgen", "hybrid"] },
  { id: "tiktok", label: "TikTok Ads", desc: "Performance · creative analysis", icon: <SiTiktok className="w-4 h-4" />, goals: ["ecom", "hybrid"] },
  { id: "ga4", label: "Google Analytics 4", desc: "Web traffic · funnels · events", icon: <SiGoogleanalytics className="w-4 h-4" />, goals: ["ecom", "leadgen", "hybrid"] },
  { id: "hubspot", label: "HubSpot", desc: "CRM · pipeline · deal stages", icon: <SiHubspot className="w-4 h-4" />, goals: ["leadgen", "hybrid"] },
  { id: "salesforce", label: "Salesforce", desc: "Opportunities · leads · accounts", icon: <SiSalesforce className="w-4 h-4" />, goals: ["leadgen", "hybrid"] },
  { id: "linkedin_ads", label: "LinkedIn Ads", desc: "B2B campaigns · lead gen forms", icon: <Linkedin className="w-4 h-4" />, goals: ["leadgen", "hybrid"] },
  { id: "headless", label: "Custom / Headless", desc: "Any platform via webhook push", icon: <Globe className="w-4 h-4" />, goals: ["ecom", "leadgen", "hybrid"] },
];

const BASE = import.meta.env.BASE_URL ?? "/";
const heroImg = `${BASE}onboarding-hero.png`;

interface PreAuthOnboardingProps {
  onComplete: (goal: string, platforms: string[]) => void;
  onSkip?: () => void;
  lockout?: boolean;
}

export function PreAuthOnboarding({ onComplete, onSkip, lockout }: PreAuthOnboardingProps) {
  const [step, setStep] = useState<Step>(1);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [selectedPlatforms, setPlatforms] = useState<Set<string>>(new Set());

  const togglePlatform = (id: string) => setPlatforms((prev) => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const handleProceedToAuth = () => {
    if (!goal) return;
    onComplete(goal, Array.from(selectedPlatforms));
  };

  const visible = goal ? PLATFORMS.filter((p) => p.goals.includes(goal)) : [];
  const pct = step === 1 ? (goal ? 50 : 25) : 75;

  return (
    <div className="min-h-screen w-full bg-white text-on-surface antialiased font-[Inter,system-ui,sans-serif]">
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-gray-100">
        <div className="flex items-center justify-between px-5 py-3.5 max-w-lg mx-auto">
          <button
            onClick={step === 2 ? () => setStep(1) : undefined}
            disabled={step === 1}
            aria-label="Go back"
            className={cn(
              "w-9 h-9 rounded-full flex items-center justify-center transition-colors",
              step === 2 ? "hover:bg-gray-100 cursor-pointer" : "opacity-30 cursor-default"
            )}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="text-[15px] font-semibold tracking-tight">OmniAnalytix</span>
          {!lockout && (
            <button
              aria-label="Skip to sign in"
              title="Skip to sign in"
              className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              onClick={() => {
                if (onSkip) {
                  onSkip();
                } else if (goal) {
                  onComplete(goal, Array.from(selectedPlatforms));
                }
              }}
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      <main className="max-w-lg mx-auto px-5 pt-8 pb-32">
        {step === 1 && (
          <>
            <div className="mb-8">
              <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-primary-container mb-3 block">
                Setup · Step 1 of 2
              </span>
              <h1 className="text-[28px] leading-[1.15] font-extrabold tracking-tight text-[#111] mb-3">
                Conversion<br />Intelligence<br />Engine
              </h1>
              <p className="text-[14px] leading-relaxed text-gray-500 max-w-[320px]">
                Select your conversion goal to personalise your AI workflow library, diagnostic engine, and platform stack.
              </p>
            </div>

            <div className="flex gap-2.5 mb-10">
              <span className="px-4 py-2 text-[13px] font-semibold border border-primary-container/30 rounded-full bg-primary-container/5 text-primary-container">
                Step 1 of 2
              </span>
              {goal && (
                <span className="px-4 py-2 text-[13px] font-semibold border border-emerald-200 rounded-full bg-emerald-50 text-emerald-600">
                  {GOALS.find(g => g.id === goal)?.title}
                </span>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-6">
              <div className="p-5 pb-3">
                <div className="flex items-start justify-between mb-1">
                  <div>
                    <h3 className="text-[15px] font-bold text-[#111]">Real-time<br />Performance</h3>
                    <p className="text-[11px] text-gray-400 mt-1 leading-snug">
                      Global analytics distribution vs.<br />local diagnostic clusters.
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-100 rounded-2xl px-2.5 py-1.5">
                    <Activity className="w-3 h-3 text-gray-400" />
                    <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Live<br />Monitor</span>
                  </div>
                </div>
              </div>
              <div className="relative h-[120px] mx-4 mb-4 rounded-2xl overflow-hidden">
                <img
                  src={heroImg}
                  alt="OmniAnalytix dashboard preview showing live performance metrics"
                  className="absolute inset-0 w-full h-full object-cover"
                  style={{ objectPosition: "center 30%" }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                <div className="absolute bottom-3 left-4">
                  <span className="text-[22px] font-extrabold text-white tracking-tight">{goal ? GOALS.find(g => g.id === goal)?.statValue ?? "98.42" : "98.42"}%</span>
                  <p className="text-[9px] font-semibold text-white/60 uppercase tracking-widest mt-0.5">
                    {goal ? GOALS.find(g => g.id === goal)?.statLabel ?? "Uptime Efficiency" : "Uptime Efficiency"}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-2xl bg-gray-50 flex items-center justify-center">
                  <Zap className="w-4 h-4 text-gray-600" />
                </div>
                <div>
                  <h3 className="text-[14px] font-bold text-[#111]">AI Processing</h3>
                  <p className="text-[11px] text-gray-400 leading-snug">Advanced inference cycles across<br />connected platforms.</p>
                </div>
              </div>
              <div className="mt-4">
                <div className="w-full bg-gray-100 h-1 rounded-full overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Setup progress">
                  <div
                    className="bg-[#111] h-full rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex justify-between mt-2">
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Setup Progress</span>
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{pct}% Complete</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-6">
              <div className="p-5 pb-3">
                <h3 className="text-[15px] font-bold text-[#111] mb-1">Available Goals</h3>
                <p className="text-[11px] text-gray-400">Select your primary conversion objective.</p>
              </div>
              <div role="radiogroup" aria-label="Conversion goal selection" className="px-3 pb-3 space-y-1">
                {GOALS.map((g) => {
                  const active = goal === g.id;
                  return (
                    <button
                      key={g.id}
                      onClick={() => setGoal(g.id)}
                      role="radio"
                      aria-checked={active}
                      aria-label={g.title}
                      className={cn(
                        "w-full flex items-center gap-3.5 p-3.5 rounded-2xl transition-all cursor-pointer text-left group",
                        active
                          ? "bg-gray-50 ring-1 ring-gray-200"
                          : "hover:bg-gray-50/60",
                      )}
                    >
                      <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors",
                        active ? "bg-[#111] text-white" : "bg-gray-100 text-gray-500",
                      )}>
                        {g.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-[13px] font-semibold text-[#111] truncate">{g.title}</h4>
                        </div>
                        <p className="text-[11px] text-gray-400 truncate">{g.subtitle}</p>
                      </div>
                      <span className={cn(
                        "text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide shrink-0 transition-colors",
                        active
                          ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                          : "bg-gray-50 text-gray-400 border border-gray-100",
                      )}>
                        {active ? "Active" : g.statusBadge}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {goal && (
              <div className="bg-gradient-to-br from-gray-50 to-[#eff6ff]/30 rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-[15px] font-bold text-[#111] mb-1">Capabilities</h3>
                    <p className="text-[11px] text-gray-400">Modules enabled for {GOALS.find(g => g.id === goal)?.title}.</p>
                  </div>
                  <div className="w-8 h-8 rounded-2xl bg-[#dbeafe]/50 flex items-center justify-center">
                    <Layers className="w-4 h-4 text-primary-container" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {GOALS.find(g => g.id === goal)?.checkpoints.map((cp, i) => (
                    <div key={cp} className={cn(
                      "rounded-2xl px-3.5 py-3 text-center",
                      i === 0 ? "bg-white border border-gray-100 col-span-2" : "bg-white border border-gray-100",
                    )}>
                      <span className={cn(
                        "text-[13px] font-bold block mb-0.5",
                        i === 0 ? "text-primary-container" : "text-[#111]"
                      )}>
                        {i === 0 ? "Enabled" : i === 1 ? "Active" : "Ready"}
                      </span>
                      <span className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">{cp}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {goal && (
              <button
                onClick={() => setStep(2)}
                className="w-full flex items-center justify-center gap-2.5 px-6 py-3.5 bg-[#111] text-white text-[13px] font-semibold rounded-2xl hover:bg-[#222] transition-colors active:scale-[0.98] mb-6"
              >
                Continue to Stack Selection
                <ArrowRight className="w-4 h-4" />
              </button>
            )}

            {!goal && (
              <p className="text-center text-[12px] text-gray-400 pt-2 mb-6">Select a goal above to continue</p>
            )}
          </>
        )}

        {step === 2 && goal && (
          <>
            <div className="mb-8">
              <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-primary-container mb-3 block">
                Setup · Step 2 of 2
              </span>
              <h1 className="text-[28px] leading-[1.15] font-extrabold tracking-tight text-[#111] mb-3">
                Data<br />Ecosystem<br />Config
              </h1>
              <p className="text-[14px] leading-relaxed text-gray-500 max-w-[320px]">
                Select the platforms you currently use. You'll securely connect them after signing in.
              </p>
            </div>

            <div className="flex gap-2.5 mb-10">
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2 text-[13px] font-semibold border border-gray-200 rounded-full hover:bg-gray-50 transition-colors"
              >
                Change Goal
              </button>
              <span className="px-4 py-2 text-[13px] font-semibold border border-gray-200 rounded-full bg-gray-50" aria-label={`${selectedPlatforms.size} platforms selected`}>
                {selectedPlatforms.size} Selected
              </span>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-6 flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-full bg-[#111] text-white flex items-center justify-center shrink-0">
                {GOALS.find((g) => g.id === goal)?.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-[#111] truncate">{GOALS.find((g) => g.id === goal)?.title}</p>
                <p className="text-[11px] text-gray-400">{GOALS.find((g) => g.id === goal)?.subtitle}</p>
              </div>
              <span className="text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide bg-emerald-50 text-emerald-600 border border-emerald-200 shrink-0">
                Active
              </span>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-2xl bg-gray-50 flex items-center justify-center">
                  <Zap className="w-4 h-4 text-gray-600" />
                </div>
                <div>
                  <h3 className="text-[14px] font-bold text-[#111]">AI Processing</h3>
                  <p className="text-[11px] text-gray-400 leading-snug">Connecting platform data streams.</p>
                </div>
              </div>
              <div className="mt-4">
                <div className="w-full bg-gray-100 h-1 rounded-full overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Setup progress">
                  <div
                    className="bg-[#111] h-full rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex justify-between mt-2">
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Setup Progress</span>
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{pct}% Complete</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-6">
              <div className="p-5 pb-3">
                <h3 className="text-[15px] font-bold text-[#111] mb-1">Available Platforms</h3>
                <p className="text-[11px] text-gray-400">Toggle the platforms you plan to connect.</p>
              </div>
              <div className="px-3 pb-3 space-y-1">
                {visible.map((p) => {
                  const active = selectedPlatforms.has(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => togglePlatform(p.id)}
                      aria-pressed={active}
                      aria-label={`${p.label}${active ? " (selected)" : ""}`}
                      className={cn(
                        "w-full flex items-center gap-3.5 p-3.5 rounded-2xl transition-all cursor-pointer text-left group",
                        active
                          ? "bg-gray-50 ring-1 ring-gray-200"
                          : "hover:bg-gray-50/60",
                      )}
                    >
                      <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors",
                        active ? "bg-[#111] text-white" : "bg-gray-100 text-gray-500",
                      )}>
                        {p.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-[13px] font-semibold text-[#111] truncate">{p.label}</h4>
                        <p className="text-[11px] text-gray-400 truncate">{p.desc}</p>
                      </div>
                      <div className={cn(
                        "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all shrink-0",
                        active ? "bg-[#111] border-[#111]" : "border-gray-200",
                      )}>
                        {active && <Check className="w-3 h-3 text-white" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={handleProceedToAuth}
                className="w-full flex items-center justify-center gap-2.5 px-6 py-3.5 bg-[#111] text-white text-[13px] font-semibold rounded-2xl hover:bg-[#222] transition-colors active:scale-[0.98]"
              >
                <Shield className="w-4 h-4" />
                Continue to Sign In
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => setStep(1)}
                className="w-full text-center text-[12px] font-medium text-gray-400 hover:text-gray-600 transition-colors py-2"
              >
                ← Back to Goals
              </button>
            </div>
          </>
        )}

        <footer className="mt-16 text-center">
          <p className="text-[13px] font-semibold text-[#111] mb-1">OmniAnalytix Enterprise</p>
          <p className="text-[10px] text-gray-400 mb-4">© 2026 OmniAnalytix Inc. All rights reserved.</p>
          <div className="flex items-center justify-center gap-6">
            <a href={`${BASE}privacy-policy`} className="text-[11px] font-medium text-gray-400 uppercase tracking-wider hover:text-gray-600 transition-colors">Privacy</a>
          </div>
        </footer>
      </main>
    </div>
  );
}
