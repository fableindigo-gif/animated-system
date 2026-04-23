import { useState, useRef, useEffect } from "react";
import { Loader2, ArrowRight, Users, TrendingUp, BarChart3, X, Calendar, Send, CheckCircle2, Shield, Database, Zap, Lock, GitBranch, Menu, ChevronRight, Star } from "lucide-react";
import {
  SiGoogleads,
  SiMeta,
  SiShopify,
  SiSalesforce,
  SiHubspot,
  SiLooker,
  SiSnowflake,
  SiDatabricks,
  SiPostgresql,
  SiMysql,
} from "react-icons/si";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

const BASE = import.meta.env.BASE_URL ?? "/";

function useCountUp(end: number, duration = 2000) {
  const [val, setVal] = useState(0);
  const [started, setStarted] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setStarted(true); },
      { threshold: 0.3 },
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!started) return;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) { setVal(end); return; }
    let raf: number;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(eased * end));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, end, duration]);

  return { ref, val };
}

function FadeIn({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: delay / 1000 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function BentoCard({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: delay / 1000 }}
      whileHover={{ y: -3, boxShadow: "0 16px 40px rgba(0,0,0,0.07)" }}
      className={cn(
        "bg-white rounded-3xl p-8 shadow-[0_1px_4px_rgba(0,0,0,0.05)] border border-[#e8e8ed] transition-colors duration-200",
        className,
      )}
    >
      {children}
    </motion.div>
  );
}

// ─── Hero Dashboard Mockup ───────────────────────────────────────────────────
function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#FFFFFF" d="M21.35 11.1H12v2.95h5.35c-.23 1.5-1.7 4.4-5.35 4.4-3.22 0-5.85-2.66-5.85-5.95s2.63-5.95 5.85-5.95c1.83 0 3.06.78 3.76 1.45l2.56-2.46C16.74 3.93 14.6 3 12 3 6.98 3 3 6.98 3 12s3.98 9 9 9c5.2 0 8.65-3.65 8.65-8.8 0-.6-.07-1.05-.15-1.5z"/>
    </svg>
  );
}

function DashboardMockup() {
  return (
    <div className="w-full bg-white rounded-3xl border border-[#e8e8ed] shadow-[0_24px_64px_rgba(25,28,30,0.1)] overflow-hidden">
      <div className="bg-[#0f172a] px-5 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-white text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>analytics</span>
          <span className="text-white text-[13px] font-bold tracking-tight">OmniAnalytix</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-emerald-400 text-[10px] font-bold">Live</span>
        </div>
      </div>
      <div className="p-5 bg-[#f7f9fb] space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Blended POAS", value: "3.84×", color: "text-blue-600", bg: "bg-blue-50" },
            { label: "Ad Spend", value: "$42.3K", color: "text-on-surface", bg: "bg-white" },
            { label: "Margin", value: "+18.2%", color: "text-emerald-600", bg: "bg-emerald-50" },
          ].map((kpi) => (
            <div key={kpi.label} className={cn("rounded-2xl p-3 border border-[#e8e8ed]", kpi.bg)}>
              <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">{kpi.label}</p>
              <p className={cn("text-[18px] font-bold font-mono leading-none", kpi.color)}>{kpi.value}</p>
            </div>
          ))}
        </div>
        <div className="bg-white rounded-2xl border border-[#e8e8ed] p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Channel Performance</span>
            <span className="text-[9px] text-[#2563EB] font-semibold">Last 7 days</span>
          </div>
          <div className="flex items-end gap-1.5" style={{ height: 56 }}>
            {[55, 72, 48, 88, 64, 95, 80].map((h, i) => (
              <div
                key={i}
                className={cn("flex-1 rounded-t-md transition-all", i === 5 ? "bg-[#2563EB]" : "bg-[#2563EB]/20")}
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        </div>
        <div className="bg-rose-50 rounded-2xl border border-rose-200/40 p-3.5 flex items-start gap-3">
          <span className="material-symbols-outlined text-rose-500 text-[18px] shrink-0">warning</span>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-rose-800">Anomaly Detected</p>
            <p className="text-[10px] text-rose-600 truncate">2 campaigns spending on out-of-stock SKUs · $1,240/day</p>
          </div>
          <button className="text-[9px] font-bold text-[#2563EB] bg-white rounded-lg px-2.5 py-1 shrink-0 border border-[#2563EB]/20">Fix</button>
        </div>
        <div className="bg-white rounded-2xl border border-[#e8e8ed] p-3.5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-lg bg-[#2563EB]/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-[#2563EB] text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
            </div>
            <span className="text-[10px] font-bold text-[#1a1c1f]">AI Command Center</span>
          </div>
          <div className="bg-[#f7f9fb] rounded-xl px-3 py-2 text-[10px] text-[#434655] font-mono">
            Which campaigns overspent yesterday?
          </div>
        </div>
      </div>
    </div>
  );
}

const AI_STEPS = [
  {
    id: "ask",
    label: "Ask a question",
    title: "Chat like you'd ask a teammate",
    desc: "Type in natural language — \"Which campaigns overspent yesterday?\" — and OmniAnalytix queries every connected platform instantly.",
    mockLines: [
      { role: "user" as const, text: "Which campaigns overspent their daily budget yesterday?" },
      { role: "ai" as const, text: "I found 3 campaigns that exceeded their daily cap across Google Ads and Meta. Campaign \"Summer Sale 2026\" overspent by $420 (127% of budget). Let me break down each one..." },
    ],
  },
  {
    id: "triage",
    label: "Get anomaly alerts",
    title: "Real-time anomaly detection catches issues first",
    desc: "OmniAnalytix continuously monitors your campaigns, flagging budget overruns, pixel drops, and out-of-stock SKU spend before they become costly.",
    mockLines: [
      { role: "alert" as const, text: "🔴 CRITICAL: 2 campaigns spending $1,240/day on out-of-stock SKUs" },
      { role: "alert" as const, text: "🟡 WARNING: Meta pixel firing rate dropped 34% on checkout page" },
      { role: "ai" as const, text: "I've prepared 1-click fixes for both issues. Shall I pause the affected ad groups and notify your pixel team?" },
    ],
  },
  {
    id: "act",
    label: "Take action",
    title: "Execute changes conversationally",
    desc: "Pause campaigns, reallocate budgets, update Shopify pages, or generate client reports — all through natural language commands with approval workflows.",
    mockLines: [
      { role: "user" as const, text: "Pause all campaigns targeting out-of-stock products and reallocate that budget to top performers" },
      { role: "ai" as const, text: "✅ Paused 2 campaigns (saving $1,240/day)\n✅ Reallocated $620 to \"Brand Awareness Q2\" (top ROAS: 4.2x)\n✅ Reallocated $620 to \"Retarget - Cart Abandon\" (CVR: 8.1%)" },
    ],
  },
  {
    id: "monitor",
    label: "Monitor & iterate",
    title: "Context carries over, insights compound",
    desc: "Every conversation builds on what came before. Ask follow-up questions, compare time periods, or drill into any metric — OmniAnalytix remembers your context.",
    mockLines: [
      { role: "user" as const, text: "How did those reallocations perform over the last 48 hours?" },
      { role: "ai" as const, text: "Great results. Brand Awareness Q2 saw a 23% lift in impressions with ROAS holding at 3.9x. Cart Abandon retarget converted 142 additional sales ($18,400 revenue). Net impact: +$16,540 vs. the paused campaigns." },
    ],
  },
];

const DECISION_TABS = [
  {
    id: "triage",
    label: "Anomaly Triage",
    title: "Identify what's impacting key metrics",
    desc: "Real-time detection of budget overruns, pixel failures, inventory mismatches, and conversion drops across all channels. 1-click AI resolution for every alert.",
    icon: "speed",
  },
  {
    id: "allocate",
    label: "Budget Allocation",
    title: "Optimize spend across every channel",
    desc: "Predictive ROAS modeling powers cross-channel budget allocation with pre-flight policy checks. Full-funnel optimization from awareness to conversion.",
    icon: "account_balance",
  },
  {
    id: "diagnose",
    label: "Campaign Diagnostics",
    title: "Understand what happened and why",
    desc: "Drill into Performance Max constraints, asset group performance, search term quality, and audience overlap. AI-powered root cause analysis in seconds.",
    icon: "troubleshoot",
  },
  {
    id: "report",
    label: "Client Reporting",
    title: "Deliver insights to stakeholders instantly",
    desc: "Generate sanitized, white-label executive summaries and shareable client briefs. Automated weekly reports with KPIs, optimizations, and next steps.",
    icon: "summarize",
  },
];

const TOOL_CARDS = [
  { title: "Dashboards", desc: "Custom visualizations, drill-downs, filters, and real-time KPI monitoring across every connected platform.", icon: "dashboard", gradient: "from-blue-500 to-blue-700" },
  { title: "Spreadsheets", desc: "Familiar formulas, forecasting, and modeling on top of live, governed data. Full CSV support with rich formatting.", icon: "table_chart", gradient: "from-emerald-500 to-emerald-700" },
  { title: "Data Modeling", desc: "Visual schema builder with calculated fields, custom metrics, and cross-source joins — no SQL required.", icon: "schema", gradient: "from-violet-500 to-violet-700" },
  { title: "SQL & BYODB", desc: "Raw SQL in an intelligent IDE with autocomplete. Bring your own database — PostgreSQL, MySQL, Snowflake, BigQuery.", icon: "code", gradient: "from-amber-500 to-amber-700" },
];

const PERSONA_TABS = [
  {
    id: "agency",
    label: "Agency Principals",
    title: "Stop losing margin to manual work",
    points: [
      "Unified command center replaces 8+ MarTech tools",
      "Two-person approval keeps sensitive changes safe",
      "White-label client portals auto-generated weekly",
      "Proactive budget pacing with overspend alerts",
    ],
    quote: "OmniAnalytix replaced our entire reporting stack. We saved 40+ hours per week across the team and caught a $12K budget leak in the first week.",
    author: "VP of Media, Growth Agency",
    icon: "business_center",
  },
  {
    id: "buyer",
    label: "Media Buyers",
    title: "Get answers in seconds, not hours",
    points: [
      "Ask questions in plain English — AI queries every platform",
      "1-click anomaly resolution with full audit trail",
      "Cross-channel attribution without manual spreadsheet merges",
      "Performance Max constraint analysis and asset optimization",
    ],
    quote: "I used to spend 3 hours building weekly reports. Now I ask the AI and have a client-ready brief in 2 minutes.",
    author: "Senior Media Buyer",
    icon: "trending_up",
  },
  {
    id: "data",
    label: "Data & IT Teams",
    title: "Ship analytics without slowing your roadmap",
    points: [
      "Bring your own database with AES-256-GCM encrypted credentials",
      "Zero-config ETL pipelines with auto-schema detection",
      "Embedded analytics with SSO, row-level security, and signed URLs",
      "Full Git-style version control for data model changes",
    ],
    quote: "The BYODB feature let us connect our warehouse in minutes. The encryption and read-only enforcement gave our security team confidence from day one.",
    author: "Head of Data Engineering",
    icon: "engineering",
  },
];

export default function LandingPage({
  onEnter,
  onSsoStart,
  onLeadCapture,
}: {
  onEnter: () => void;
  onSsoStart: () => void;
  onLeadCapture?: () => void;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [activeDecision, setActiveDecision] = useState(0);
  const [activePersona, setActivePersona] = useState(0);
  const [heroEmail, setHeroEmail] = useState("");
  const [closerForm, setCloserForm] = useState({ email: "", company: "", spend: "$100k - $500k" });
  const [closerSubmitted, setCloserSubmitted] = useState(false);
  const [closerLoading, setCloserLoading] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const stat1 = useCountUp(18400, 2200);
  const stat2 = useCountUp(47, 1800);
  const stat3 = useCountUp(99, 1600);

  const currentStep = AI_STEPS[activeStep];
  const currentDecision = DECISION_TABS[activeDecision];
  const currentPersona = PERSONA_TABS[activePersona];

  function handleHeroSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (heroEmail) sessionStorage.setItem("omni_prefill_email", heroEmail);
    onLeadCapture?.();
  }

  function handleCloserSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!closerForm.email) return;
    setCloserLoading(true);
    setTimeout(() => { setCloserLoading(false); setCloserSubmitted(true); }, 1200);
  }

  return (
    <div className="min-h-screen bg-white text-[#1a1c1f] antialiased overflow-x-hidden font-sans">

      {/* ── NAV ──────────────────────────────────────────────────────────────── */}
      <header className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
        scrolled ? "bg-white/85 backdrop-blur-xl shadow-[0_1px_4px_rgba(0,0,0,0.07)]" : "bg-transparent",
      )}>
        <div className="max-w-7xl mx-auto px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-[#2563EB] flex items-center justify-center">
              <span className="material-symbols-outlined text-white text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>analytics</span>
            </div>
            <span className="text-xl font-bold tracking-tighter text-[#1a1c1f]">OmniAnalytix</span>
          </div>
          <nav className="hidden md:flex items-center gap-7">
            {[
              { href: "#ai-walkthrough", label: "AI Platform" },
              { href: "#features", label: "Solutions" },
              { href: "#google-suite", label: "Google Suite" },
              { href: "#integrations", label: "Integrations" },
              { href: "#security", label: "Enterprise" },
            ].map((link) => (
              <a key={link.href} href={link.href} className="text-[#434655] font-medium tracking-tight hover:text-[#1a1c1f] transition-colors text-sm">
                {link.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <button onClick={onSsoStart} className="text-[#434655] font-medium hover:text-[#1a1c1f] transition-colors hidden sm:block text-sm" data-testid="header-sign-in">
              Sign In
            </button>
            <button
              onClick={onSsoStart}
              data-testid="header-start-free"
              className="bg-[#2563EB] text-white px-5 py-2.5 rounded-full text-sm font-bold shadow-lg shadow-blue-500/25 hover:bg-[#1d4ed8] active:scale-95 transition-all hidden sm:inline-flex items-center gap-2"
            >
              <GoogleGlyph className="w-4 h-4" /> Start free
            </button>
            <button
              onClick={() => onLeadCapture?.()}
              className="text-[#434655] font-medium hover:text-[#1a1c1f] transition-colors hidden lg:block text-sm"
            >
              Request Demo
            </button>
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden w-10 h-10 flex items-center justify-center rounded-xl hover:bg-black/5 transition-colors"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5 text-[#434655]" />
            </button>
          </div>
        </div>
      </header>

      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-[200] md:hidden"
          onClick={() => setMobileMenuOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
              e.preventDefault();
              setMobileMenuOpen(false);
            }
          }}
          role="button"
          tabIndex={0}
          aria-label="Close menu"
        >
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" aria-hidden="true" />
          <div
            className="absolute right-0 top-0 bottom-0 w-72 bg-white shadow-2xl animate-in slide-in-from-right duration-200"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile navigation menu"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-[#e8e8ed]">
              <span className="font-bold tracking-tight">OmniAnalytix</span>
              <button onClick={() => setMobileMenuOpen(false)} aria-label="Close mobile navigation menu" className="w-8 h-8 rounded-full hover:bg-[#F2F2F7] flex items-center justify-center transition-colors">
                <X className="w-4 h-4 text-[#434655]" />
              </button>
            </div>
            <nav className="flex flex-col p-3">
              {[
                { href: "#ai-walkthrough", label: "AI Platform" },
                { href: "#features", label: "Solutions" },
                { href: "#google-suite", label: "Google Suite" },
                { href: "#integrations", label: "Integrations" },
                { href: "#security", label: "Enterprise" },
              ].map((link) => (
                <a key={link.label} href={link.href} onClick={() => setMobileMenuOpen(false)} className="px-4 py-3 rounded-xl text-sm font-medium text-[#434655] hover:bg-[#2563EB]/5 hover:text-[#2563EB] transition-colors">
                  {link.label}
                </a>
              ))}
            </nav>
            <div className="px-5 pt-3 space-y-3 border-t border-[#e8e8ed] mt-2">
              <button
                onClick={() => { setMobileMenuOpen(false); onSsoStart(); }}
                data-testid="mobile-start-free"
                className="w-full py-3 bg-[#2563EB] text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-500/20 hover:bg-[#1d4ed8] transition-all inline-flex items-center justify-center gap-2"
              >
                <GoogleGlyph className="w-4 h-4" /> Start free with Google
              </button>
              <p className="text-[11px] text-[#6b6f7d] text-center font-medium px-2">
                Free during onboarding · paid plans from $49/mo
              </p>
              <button onClick={() => { setMobileMenuOpen(false); onLeadCapture?.(); }} className="w-full py-2.5 border border-[#e8e8ed] rounded-xl text-sm font-bold text-[#1a1c1f] hover:bg-[#f8f9fb] transition-all">
                Request Demo
              </button>
              <button onClick={() => { setMobileMenuOpen(false); onSsoStart(); }} className="w-full py-2 text-sm font-medium text-muted-foreground hover:text-[#434655] transition-colors text-center">
                Sign In
              </button>
            </div>
          </div>
        </div>
      )}

      <main>

        {/* ═══ HERO — Split layout ═══════════════════════════════════════════ */}
        <section className="relative pt-24 pb-16 sm:pt-28 sm:pb-20 px-6 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#2563EB]/[0.03] via-transparent to-white pointer-events-none" />
          <div className="absolute -top-40 left-1/2 -translate-x-1/4 w-[800px] h-[600px] rounded-full bg-[#2563EB]/[0.04] blur-[140px] pointer-events-none" />

          <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-14 items-center relative">

            {/* Left: copy + form */}
            <div>
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.05 }}
              >
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#2563EB]/6 text-[#2563EB] text-[12px] font-bold mb-7 border border-[#2563EB]/12 tracking-wide uppercase">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#2563EB] opacity-60" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#2563EB]" />
                  </span>
                  Powered by Google's most advanced AI
                </div>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.65, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
                className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tighter leading-[1.08] mb-5"
              >
                Catch the leaks.{" "}
                <span className="text-[#2563EB]">Defend your margin.</span>
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.28 }}
                className="text-base sm:text-lg text-[#434655] max-w-lg mb-8 leading-relaxed font-medium"
              >
                Enterprise AI analytics, secured for agencies. OmniAnalytix surfaces budget overruns, pixel drops, and out-of-stock spend across Shopify, Google Ads &amp; your CRM — then helps you fix them in one click, with a human in the loop.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.38 }}
                className="max-w-lg mb-3"
              >
                <button
                  type="button"
                  onClick={onSsoStart}
                  data-testid="hero-start-free"
                  className="w-full sm:w-auto whitespace-nowrap bg-gradient-to-br from-[#2563EB] to-[#1d4ed8] text-white px-7 py-4 rounded-2xl font-bold text-sm shadow-xl shadow-blue-500/25 active:scale-[0.97] transition-all inline-flex items-center justify-center gap-2.5"
                >
                  <GoogleGlyph className="w-4 h-4" />
                  Start free with Google
                  <ArrowRight className="w-4 h-4" />
                </button>
                <p className="text-xs text-[#6b6f7d] mt-2.5 font-medium" data-testid="hero-pricing-hint">
                  Free during onboarding · no credit card · paid plans start at <span className="font-bold text-[#1a1c1f]">$49/mo</span> when you go live.
                </p>
              </motion.div>

              <motion.form
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.44 }}
                onSubmit={handleHeroSubmit}
                className="flex flex-col sm:flex-row gap-3 max-w-lg mb-5"
              >
                <input
                  type="email"
                  required
                  value={heroEmail}
                  onChange={(e) => setHeroEmail(e.target.value)}
                  placeholder="Or enter your work email for a demo"
                  className="flex-1 rounded-2xl border border-[#e8e8ed] bg-white/80 px-5 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]/40 text-[#1a1c1f] placeholder:text-[#b0b3c1] shadow-sm"
                />
                <button
                  type="submit"
                  className="whitespace-nowrap border border-[#e8e8ed] bg-white text-[#1a1c1f] px-6 py-3.5 rounded-2xl font-bold text-sm hover:bg-[#f8f9fb] active:scale-[0.97] transition-all flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" /> Request Demo
                </button>
              </motion.form>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.5 }}
                className="flex flex-col gap-3"
              >
                <button onClick={() => onLeadCapture?.()} className="inline-flex items-center gap-2 text-sm text-[#434655] font-medium hover:text-[#2563EB] transition-colors">
                  <Calendar className="w-4 h-4 opacity-60" /> Book a 1:1 demo <ChevronRight className="w-3.5 h-3.5 opacity-50" />
                </button>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  {["SOC 2 Type II", "GDPR", "AES-256", "99.9% SLA"].map((badge) => (
                    <span key={badge} className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-semibold">
                      <Shield className="w-3 h-3 text-emerald-500" /> {badge}
                    </span>
                  ))}
                </div>
              </motion.div>
            </div>

            {/* Right: dashboard mockup + floating KPI */}
            <div className="relative hidden lg:block">
              <motion.div
                initial={{ opacity: 0, x: 32, scale: 0.98 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                transition={{ duration: 0.7, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <DashboardMockup />
              </motion.div>

              {/* Floating KPI glass chip — top left */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.7 }}
                className="absolute -top-5 -left-8 bg-white/80 backdrop-blur-xl rounded-2xl p-4 shadow-xl border border-[#e8e8ed] z-10"
              >
                <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Avg. Margin Saved</p>
                <p className="text-2xl font-extrabold text-emerald-600 tracking-tight">+$18K<span className="text-sm font-semibold text-muted-foreground">/mo</span></p>
              </motion.div>

              {/* Floating KPI glass chip — bottom right */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.85 }}
                className="absolute -bottom-4 -right-6 bg-white/80 backdrop-blur-xl rounded-2xl p-4 shadow-xl border border-[#e8e8ed] z-10"
              >
                <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">LTV Lift</p>
                <p className="text-2xl font-extrabold text-[#2563EB] tracking-tight">+24.8%</p>
              </motion.div>

              <motion.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 1.0 }}
                className="mt-8 text-center text-[12px] text-muted-foreground font-medium leading-relaxed max-w-md mx-auto"
              >
                Live anomaly detection on your blended marketing data — POAS (profit on ad spend), LTV, margin — across every channel.
              </motion.p>
            </div>
          </div>
        </section>

        {/* ═══ TRUST MARQUEE ═══════════════════════════════════════════════════ */}
        <section className="py-8 px-6 bg-white border-t border-b border-[#e8e8ed]/60 overflow-hidden">
          <div className="max-w-7xl mx-auto">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground text-center mb-5">
              Connect everything you already use
            </p>
            <div className="relative">
              <div className="absolute left-0 top-0 bottom-0 w-16 sm:w-24 bg-gradient-to-r from-white to-transparent z-10 pointer-events-none" />
              <div className="absolute right-0 top-0 bottom-0 w-16 sm:w-24 bg-gradient-to-l from-white to-transparent z-10 pointer-events-none" />
              <div className="flex animate-marquee gap-12 sm:gap-16 items-center w-max">
                {[...Array(2)].map((_, setIdx) => (
                  <div key={setIdx} className="flex items-center gap-12 sm:gap-16 shrink-0">
                    {[
                      { icon: <SiGoogleads className="w-5 h-5" aria-hidden="true" />, name: "Google Ads" },
                      { icon: <SiMeta className="w-5 h-5" aria-hidden="true" />, name: "Meta Ads" },
                      { icon: <SiShopify className="w-5 h-5" aria-hidden="true" />, name: "Shopify" },
                      { icon: <SiSalesforce className="w-5 h-5" aria-hidden="true" />, name: "Salesforce" },
                      { icon: <SiHubspot className="w-5 h-5" aria-hidden="true" />, name: "HubSpot" },
                      { icon: <SiLooker className="w-5 h-5" aria-hidden="true" />, name: "Looker" },
                      { icon: <SiSnowflake className="w-5 h-5" aria-hidden="true" />, name: "Snowflake" },
                      { icon: <SiDatabricks className="w-5 h-5" aria-hidden="true" />, name: "Databricks" },
                    ].map((item) => (
                      <div key={`${setIdx}-${item.name}`} className="flex flex-col items-center gap-1.5 shrink-0 group">
                        <div className="text-[#1a1c1f]/25 group-hover:text-[#1a1c1f]/50 transition-all duration-300 grayscale group-hover:grayscale-0">{item.icon}</div>
                        <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground transition-colors">{item.name}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ═══ SECURITY TRUST BADGES ═══════════════════════════════════════════ */}
        <section className="py-10 px-6 bg-[#f7f9fb] border-b border-[#e8e8ed]/60">
          <div className="max-w-4xl mx-auto flex flex-wrap justify-center gap-10">
            {[
              { icon: "verified_user", title: "AES-256-GCM", sub: "Military-grade Encryption" },
              { icon: "hub", title: "Tenant Isolation", sub: "Zero-bleed Data Silos" },
              { icon: "lock_person", title: "Granular RBAC", sub: "Identity-first Access" },
              { icon: "gpp_good", title: "SOC 2 Type II", sub: "Audit-ready Compliance" },
              { icon: "passkey", title: "SSO / SAML", sub: "Single Sign-On" },
            ].map((b) => (
              <div key={b.title} className="flex items-center gap-3">
                <span className="material-symbols-outlined text-[#2563EB] text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>{b.icon}</span>
                <div>
                  <p className="text-sm font-bold text-[#1a1c1f] leading-none mb-0.5">{b.title}</p>
                  <p className="text-xs text-muted-foreground">{b.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ═══ STATS BAND ══════════════════════════════════════════════════════ */}
        <section className="py-16 px-6 bg-white">
          <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { prefix: "$", ref: stat1.ref, val: stat1.val.toLocaleString(), suffix: "", label: "avg. monthly margin saved per agency", accent: "text-emerald-600" },
              { prefix: "", ref: stat2.ref, val: String(stat2.val), suffix: "+", label: "platforms connected per tenant", accent: "text-[#2563EB]" },
              { prefix: "", ref: stat3.ref, val: String(stat3.val), suffix: ".9%", label: "guaranteed uptime SLA", accent: "text-violet-600" },
            ].map((s, i) => (
              <FadeIn key={i} delay={i * 100} className="bg-[#f7f9fb] rounded-3xl border border-[#e8e8ed] p-8 flex flex-col text-center">
                <p className={cn("text-5xl font-extrabold tracking-tighter mb-2 font-mono", s.accent)}>
                  {s.prefix}<span ref={s.ref}>{s.val}</span>{s.suffix}
                </p>
                <p className="text-sm text-[#434655] font-medium">{s.label}</p>
              </FadeIn>
            ))}
          </div>
        </section>

        {/* ═══ AI WALKTHROUGH ══════════════════════════════════════════════════ */}
        <section className="py-24 px-6 bg-[#F2F2F7]" id="ai-walkthrough">
          <div className="max-w-6xl mx-auto">
            <FadeIn>
              <div className="text-center mb-16">
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#2563EB]/8 text-[#2563EB] text-[11px] font-bold uppercase tracking-widest mb-5 border border-[#2563EB]/12">
                  <Zap className="w-3 h-3" /> AI Command Center
                </span>
                <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tighter mb-4">
                  Get insights without waiting in line.
                </h2>
                <p className="text-[#434655] text-base max-w-lg mx-auto font-medium">
                  From question to action in one conversation.
                </p>
              </div>
            </FadeIn>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              <div className="lg:col-span-4 flex flex-row lg:flex-col gap-2 overflow-x-auto lg:overflow-visible pb-4 lg:pb-0">
                {AI_STEPS.map((step, i) => (
                  <button
                    key={step.id}
                    onClick={() => setActiveStep(i)}
                    className={cn(
                      "flex items-center gap-3 px-5 py-4 rounded-2xl text-left transition-all whitespace-nowrap lg:whitespace-normal shrink-0 lg:shrink lg:w-full",
                      activeStep === i
                        ? "bg-[#2563EB] text-white shadow-lg shadow-blue-500/20"
                        : "bg-white text-[#434655] hover:bg-white/80 border border-[#e8e8ed]",
                    )}
                  >
                    <span className={cn(
                      "w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold shrink-0",
                      activeStep === i ? "bg-white/20 text-white" : "bg-[#F2F2F7] text-[#434655]",
                    )}>
                      {i + 1}
                    </span>
                    <span className="font-semibold text-sm">{step.label}</span>
                  </button>
                ))}
              </div>
              <div className="lg:col-span-8">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentStep.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    className="bg-white rounded-3xl border border-[#e8e8ed] shadow-sm overflow-hidden"
                  >
                    <div className="px-6 sm:px-8 pt-8 pb-4">
                      <h3 className="text-xl sm:text-2xl font-bold tracking-tight mb-2">{currentStep.title}</h3>
                      <p className="text-[#434655] text-sm leading-relaxed">{currentStep.desc}</p>
                    </div>
                    <div className="px-6 sm:px-8 pb-8 space-y-3">
                      {currentStep.mockLines.map((line, li) => (
                        <motion.div
                          key={li}
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: li * 0.12 }}
                          className={cn("flex", line.role === "user" ? "justify-end" : "justify-start")}
                        >
                          <div className={cn(
                            "rounded-2xl px-4 py-3 text-sm leading-relaxed max-w-[85%]",
                            line.role === "user"
                              ? "bg-[#2563EB] text-white rounded-br-sm"
                              : line.role === "alert"
                                ? "bg-rose-50 text-rose-900 border border-rose-200/60"
                                : "bg-white text-[#1a1c1f] border border-[#e8e8ed]",
                          )}>
                            <span className="whitespace-pre-line">{line.text}</span>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ FEATURE DEEP DIVES (alternating) ═══════════════════════════════ */}
        <section className="py-8 bg-white" id="features">

          {/* Feature 1 — Forensic Auditor */}
          <div className="max-w-7xl mx-auto px-6 py-20">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              <FadeIn className="order-2 lg:order-1">
                <div className="bg-[#f7f9fb] rounded-3xl p-5 border border-[#e8e8ed] shadow-inner">
                  <div className="bg-white rounded-2xl border border-[#e8e8ed] shadow-sm overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-[#e8e8ed] flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Forensic Audit — BYODB</span>
                      <span className="text-[9px] px-2 py-0.5 bg-blue-50 text-[#2563EB] rounded-full font-bold border border-blue-100">Connected</span>
                    </div>
                    <div className="p-5 space-y-3">
                      {[
                        { label: "Snowflake Warehouse", value: "orders_v2", status: "ok" },
                        { label: "Attribution Model", value: "Multi-touch (Data-driven)", status: "ok" },
                        { label: "COGS Source", value: "bigquery.prod.cogs", status: "ok" },
                        { label: "Margin Leak Identified", value: "-$4,280 / AU market", status: "warn" },
                      ].map((row) => (
                        <div key={row.label} className="flex items-center justify-between py-2 border-b border-[#e8e8ed]/60 last:border-0">
                          <span className="text-[11px] text-[#434655]">{row.label}</span>
                          <span className={cn(
                            "text-[11px] font-bold font-mono",
                            row.status === "warn" ? "text-amber-600" : "text-emerald-600",
                          )}>{row.value}</span>
                        </div>
                      ))}
                    </div>
                    <div className="px-5 pb-5">
                      <div className="bg-[#2563EB]/5 rounded-2xl p-4 border border-[#2563EB]/10">
                        <p className="text-[10px] font-bold text-[#2563EB] mb-1">AI ROOT CAUSE</p>
                        <p className="text-[11px] text-[#434655] leading-relaxed">3 campaigns in the AU market are targeting products with &lt;10 units in stock. Recommend pausing and reallocating $4,280/month to top-ROAS SKUs.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </FadeIn>
              <FadeIn delay={100} className="order-1 lg:order-2">
                <span className="text-[#2563EB] font-bold text-xs tracking-widest uppercase mb-4 block">Analysis Framework</span>
                <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tighter mb-5">Forensic Auditor &amp; BYODB</h2>
                <p className="text-[#434655] text-base leading-relaxed mb-7">
                  Stop guessing why margins are slipping. The Forensic Auditor traces every conversion path back to its source, cross-referencing your own warehouse via Bring Your Own Database (BYODB) connectivity. Direct Snowflake &amp; BigQuery linkage with AES-256-GCM credential encryption.
                </p>
                <ul className="space-y-3 mb-8">
                  {[
                    "Direct Snowflake & BigQuery Linkage",
                    "Multi-touch Attribution Modeling",
                    "COGS-aware Margin Analysis",
                    "Read-only enforcement with 500-row caps",
                  ].map((point) => (
                    <li key={point} className="flex items-center gap-3 text-sm text-[#434655]">
                      <CheckCircle2 className="w-4 h-4 text-[#2563EB] shrink-0" />
                      {point}
                    </li>
                  ))}
                </ul>
                <button onClick={() => onLeadCapture?.()} className="inline-flex items-center gap-2 text-[#2563EB] font-semibold text-sm hover:gap-3 transition-all">
                  See it live <ArrowRight className="w-4 h-4" />
                </button>
              </FadeIn>
            </div>
          </div>

          {/* Feature 2 — Account Health */}
          <div className="bg-[#f7f9fb] py-20">
            <div className="max-w-7xl mx-auto px-6">
              <div className="grid lg:grid-cols-2 gap-16 items-center">
                <FadeIn>
                  <span className="text-[#2563EB] font-bold text-xs tracking-widest uppercase mb-4 block">Portfolio Health</span>
                  <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tighter mb-5">Account Health &amp; Anomaly Detection</h2>
                  <p className="text-[#434655] text-base leading-relaxed mb-7">
                    Real-time anomaly detection flags broken pixels, margin leaks, or CPA spikes the moment they happen. With one click, push updates to Shopify or Google Ads without switching tabs — with full dual-authorization before any action goes live.
                  </p>
                  <ul className="space-y-3 mb-8">
                    {[
                      "Sub-minute anomaly detection across all channels",
                      "1-click optimization with AI-prepared fix drafts",
                      "Shopify inventory sync & ad pausing",
                      "Dual-authorization — no unsanctioned changes",
                    ].map((point) => (
                      <li key={point} className="flex items-center gap-3 text-sm text-[#434655]">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        {point}
                      </li>
                    ))}
                  </ul>
                  <button onClick={() => onLeadCapture?.()} className="inline-flex items-center gap-2 bg-[#1a1c1f] text-white px-6 py-3 rounded-xl font-semibold text-sm shadow-lg hover:bg-[#2d2f34] transition-colors">
                    <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>shopping_bag</span>
                    See Live Demo
                  </button>
                </FadeIn>
                <FadeIn delay={120}>
                  <div className="bg-white rounded-3xl shadow-2xl overflow-hidden border border-[#e8e8ed]">
                    <div className="bg-[#f7f9fb] px-6 py-4 flex items-center justify-between border-b border-[#e8e8ed]">
                      <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Live Alert Feed</span>
                      <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                    </div>
                    <div className="p-5 space-y-3">
                      <div className="p-4 bg-rose-50/60 rounded-2xl flex items-start gap-4 border border-rose-200/30">
                        <span className="material-symbols-outlined text-rose-500">warning</span>
                        <div className="flex-grow min-w-0">
                          <p className="font-bold text-sm text-[#1a1c1f] mb-1">Conversion Anomaly Detected</p>
                          <p className="text-xs text-[#434655] mb-3">Cart-to-Checkout drop increased by 45% in AU market.</p>
                          <button className="text-xs font-bold text-[#2563EB] px-3 py-1.5 bg-[#2563EB]/8 rounded-lg border border-[#2563EB]/15">
                            1-Click Fix
                          </button>
                        </div>
                      </div>
                      <div className="p-4 bg-amber-50/60 rounded-2xl flex items-start gap-4 border border-amber-200/30">
                        <span className="material-symbols-outlined text-amber-500">inventory_2</span>
                        <div className="flex-grow min-w-0">
                          <p className="font-bold text-sm text-[#1a1c1f] mb-1">Out-of-Stock SKU Spend</p>
                          <p className="text-xs text-[#434655] mb-3">2 campaigns targeting OOS products · $1,240/day at risk.</p>
                          <div className="flex gap-2">
                            <button className="text-xs font-bold text-[#2563EB] px-3 py-1.5 bg-[#2563EB]/8 rounded-lg border border-[#2563EB]/15">Pause Campaigns</button>
                            <button className="text-xs font-bold text-[#434655] px-3 py-1.5 bg-white rounded-lg border border-[#e8e8ed]">Dismiss</button>
                          </div>
                        </div>
                      </div>
                      <div className="p-4 bg-white rounded-2xl flex items-start gap-4 border border-[#e8e8ed]">
                        <span className="material-symbols-outlined text-emerald-500">check_circle</span>
                        <div>
                          <p className="font-bold text-sm text-[#1a1c1f]">Data Sync Complete</p>
                          <p className="text-xs text-[#434655]">Google Ads GCLID mapping updated · 14,280 records.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </FadeIn>
              </div>
            </div>
          </div>

          {/* Feature 3 — Enterprise Governance */}
          <div className="max-w-7xl mx-auto px-6 py-20">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              <FadeIn className="order-2 lg:order-1">
                <div className="bg-[#f7f9fb] rounded-3xl p-5 border border-[#e8e8ed]">
                  <div className="bg-white rounded-2xl border border-[#e8e8ed] shadow-sm p-6">
                    <div className="flex items-center justify-between mb-6">
                      <h4 className="font-bold text-sm text-[#1a1c1f]">Approval Workflow</h4>
                      <span className="px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-[10px] font-bold tracking-widest uppercase border border-amber-200/40">Pending Review</span>
                    </div>
                    <div className="bg-[#f7f9fb] rounded-xl p-4 mb-5 space-y-2 border border-[#e8e8ed]">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Proposed Action</p>
                      <p className="text-sm font-semibold text-[#1a1c1f]">Reallocate $8,400 from Brand Awareness → Retarget</p>
                      <p className="text-xs text-[#434655]">AI confidence: 94% · Projected ROAS improvement: +0.8x</p>
                    </div>
                    <div className="flex items-center gap-3 mb-6">
                      {["Requested by", "Awaiting approval from", "Estimated impact"].map((step, i) => (
                        <div key={step} className="flex-1">
                          <div className={cn(
                            "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mx-auto mb-1.5",
                            i < 1 ? "bg-[#2563EB] text-white" : i === 1 ? "bg-amber-400 text-white" : "bg-[#f7f9fb] text-[#434655] border border-[#e8e8ed]",
                          )}>
                            {i + 1}
                          </div>
                          <p className="text-[8px] text-center text-muted-foreground leading-tight">{step}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-3">
                      <button className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm transition-colors">
                        Approve Action
                      </button>
                      <button className="flex-1 py-3 border-2 border-[#e8e8ed] rounded-xl font-bold text-sm text-[#434655] hover:border-[#2563EB]/20 transition-colors">
                        Request Edit
                      </button>
                    </div>
                  </div>
                </div>
              </FadeIn>
              <FadeIn delay={100} className="order-1 lg:order-2">
                <span className="text-[#2563EB] font-bold text-xs tracking-widest uppercase mb-4 block">Privacy &amp; Trust</span>
                <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tighter mb-5">Enterprise Governance</h2>
                <p className="text-[#434655] text-base leading-relaxed mb-7">
                  Full audit trails for every AI-generated insight. Our human-in-the-loop engine ensures no automated action executes without senior stakeholder approval — maintaining total brand control and regulatory compliance.
                </p>
                <ul className="space-y-3 mb-8">
                  {[
                    "Dual-authorization for every AI-proposed campaign change",
                    "SHA-256 audit trail — immutable and exportable",
                    "RBAC with granular per-resource permissions",
                    "SOC 2 Type II, GDPR, and SSO/SAML compliance",
                  ].map((point) => (
                    <li key={point} className="flex items-center gap-3 text-sm text-[#434655]">
                      <CheckCircle2 className="w-4 h-4 text-violet-500 shrink-0" />
                      {point}
                    </li>
                  ))}
                </ul>
                <button onClick={() => onLeadCapture?.()} className="inline-flex items-center gap-2 text-[#2563EB] font-semibold text-sm hover:gap-3 transition-all">
                  View compliance docs <ArrowRight className="w-4 h-4" />
                </button>
              </FadeIn>
            </div>
          </div>
        </section>

        {/* ═══ MAKE DECISIONS FASTER — tabbed showcase ═══ */}
        <section className="py-24 px-6 bg-[#F2F2F7]" id="decisions">
          <div className="max-w-6xl mx-auto">
            <FadeIn>
              <div className="text-center mb-14">
                <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tighter mb-4">Make decisions faster with AI</h2>
                <p className="text-[#434655] text-base max-w-lg mx-auto font-medium">
                  From anomaly detection to client delivery — every workflow accelerated by intelligence.
                </p>
              </div>
            </FadeIn>
            <div className="flex flex-wrap justify-center gap-2 mb-10">
              {DECISION_TABS.map((tab, i) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveDecision(i)}
                  className={cn(
                    "px-5 py-2.5 rounded-full text-sm font-semibold transition-all",
                    activeDecision === i
                      ? "bg-[#2563EB] text-white shadow-lg shadow-blue-500/15"
                      : "bg-white text-[#434655] hover:bg-[#e8e8ed] border border-[#e8e8ed]",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={currentDecision.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.35 }}
                className="bg-white rounded-3xl p-8 sm:p-12 border border-[#e8e8ed] shadow-sm"
              >
                <div className="max-w-2xl">
                  <div className="w-14 h-14 rounded-2xl bg-[#2563EB]/10 flex items-center justify-center mb-6">
                    <span className="material-symbols-outlined text-[#2563EB] text-2xl">{currentDecision.icon}</span>
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-bold tracking-tight mb-4">{currentDecision.title}</h3>
                  <p className="text-[#434655] text-base leading-relaxed mb-8">{currentDecision.desc}</p>
                  <button onClick={() => onLeadCapture?.()} className="inline-flex items-center gap-2 text-[#2563EB] font-semibold text-sm hover:gap-3 transition-all">
                    See it in action <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </section>

        {/* ═══ FAMILIAR TOOLS ═══ */}
        <section className="py-24 px-6 bg-white" id="tools">
          <div className="max-w-6xl mx-auto">
            <FadeIn>
              <div className="text-center mb-14">
                <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tighter mb-4">
                  Use familiar analytics tools,<br className="hidden sm:block" /> all in one place
                </h2>
                <p className="text-[#434655] text-base max-w-xl mx-auto font-medium">
                  From dashboards to raw SQL — every tool your team needs, unified under one AI-powered platform.
                </p>
              </div>
            </FadeIn>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {TOOL_CARDS.map((card, i) => (
                <BentoCard key={card.title} className="flex flex-col min-h-[220px]" delay={i * 80}>
                  <div className={cn("w-12 h-12 rounded-2xl bg-gradient-to-br flex items-center justify-center mb-5", card.gradient)}>
                    <span className="material-symbols-outlined text-white text-xl">{card.icon}</span>
                  </div>
                  <h3 className="text-lg font-bold tracking-tight mb-2">{card.title}</h3>
                  <p className="text-[#434655] text-sm leading-relaxed flex-1">{card.desc}</p>
                </BentoCard>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ GOOGLE ADVANCED SUITE ═══ */}
        <section className="py-24 px-6 bg-[#F2F2F7]" id="google-suite">
          <div className="max-w-6xl mx-auto">
            <FadeIn>
              <div className="text-center mb-14">
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-[#2563EB] text-[11px] font-bold uppercase tracking-widest mb-5 border border-blue-100">
                  <SiGoogleads className="w-3 h-3" aria-hidden="true" />
                  Exclusive Elite Framework
                </span>
                <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tighter mb-3">Powered by Advanced Google Suite</h2>
                <p className="text-[#434655] text-base max-w-xl mx-auto font-medium">
                  Advanced Google Ads auditing &amp; automation tools built for high-volume agencies.
                </p>
              </div>
            </FadeIn>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {[
                { title: "AI MAX Auditor", desc: "Performance Max constraint analysis and asset group optimization. Identify wasted spend across every PMax signal.", icon: "auto_fix_high", gradient: "from-blue-600 to-indigo-700" },
                { title: "Google Tag Gateway (GTG)", desc: "Integrity monitoring for your tag infrastructure. Detect consent signal drift and container misconfigurations instantly.", icon: "verified_user", gradient: "from-emerald-600 to-teal-700" },
                { title: "SA360 Inventory-Aware Templating", desc: "Dynamic ad templates that respect real-time inventory levels. Never promote out-of-stock products again.", icon: "inventory_2", gradient: "from-violet-600 to-purple-700" },
                { title: "Full-Funnel Allocator", desc: "Pre-flight policy checks and cross-channel budget allocation powered by predictive ROAS modeling.", icon: "account_tree", gradient: "from-amber-600 to-orange-700" },
              ].map((card, i) => (
                <BentoCard key={card.title} className="flex flex-col min-h-[220px]" delay={i * 80}>
                  <div className={cn("w-11 h-11 rounded-2xl bg-gradient-to-br flex items-center justify-center mb-5", card.gradient)}>
                    <span className="material-symbols-outlined text-white text-xl">{card.icon}</span>
                  </div>
                  <h3 className="text-lg font-bold tracking-tight mb-2">{card.title}</h3>
                  <p className="text-[#434655] text-sm leading-relaxed flex-1">{card.desc}</p>
                  <div className="flex items-center gap-1.5 mt-4 text-[#2563EB] text-xs font-semibold">
                    Learn more <span className="material-symbols-outlined text-sm">arrow_forward</span>
                  </div>
                </BentoCard>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ PERSONA-BASED SECTIONS ══════════════════════════════════════════ */}
        <section className="py-24 px-6 bg-white" id="personas">
          <div className="max-w-6xl mx-auto">
            <FadeIn>
              <div className="text-center mb-14">
                <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tighter mb-4">
                  Purpose-built for<br className="hidden sm:block" /> every role
                </h2>
                <p className="text-[#434655] text-base max-w-lg mx-auto font-medium">
                  Whether you run a growth agency, buy media, or run data infrastructure — OmniAnalytix has a workflow for you.
                </p>
              </div>
            </FadeIn>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-4 flex flex-row lg:flex-col gap-2 overflow-x-auto lg:overflow-visible pb-4 lg:pb-0">
                {PERSONA_TABS.map((p, i) => (
                  <button
                    key={p.id}
                    onClick={() => setActivePersona(i)}
                    className={cn(
                      "px-5 py-4 rounded-2xl text-left transition-all whitespace-nowrap lg:whitespace-normal shrink-0 lg:shrink lg:w-full border",
                      activePersona === i
                        ? "bg-[#2563EB]/5 border-[#2563EB]/20 shadow-sm"
                        : "bg-white border-[#e8e8ed] hover:bg-[#f7f9fb]",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                        activePersona === i ? "bg-[#2563EB]/10" : "bg-[#F2F2F7]",
                      )}>
                        <span className={cn(
                          "material-symbols-outlined text-lg",
                          activePersona === i ? "text-[#2563EB]" : "text-[#434655]",
                        )}>{p.icon}</span>
                      </div>
                      <span className={cn(
                        "font-semibold text-sm",
                        activePersona === i ? "text-[#1a1c1f]" : "text-[#434655]",
                      )}>{p.label}</span>
                    </div>
                  </button>
                ))}
              </div>
              <div className="lg:col-span-8">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentPersona.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.3 }}
                    className="bg-[#f7f9fb] rounded-3xl border border-[#e8e8ed] shadow-sm overflow-hidden"
                  >
                    <div className="p-6 sm:p-8">
                      <h3 className="text-xl sm:text-2xl font-bold tracking-tight mb-6">{currentPersona.title}</h3>
                      <ul className="space-y-3 mb-8">
                        {currentPersona.points.map((point, pi) => (
                          <motion.li
                            key={pi}
                            initial={{ opacity: 0, x: 12 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: pi * 0.08 }}
                            className="flex items-start gap-3 text-sm text-[#434655] leading-relaxed"
                          >
                            <CheckCircle2 className="w-4 h-4 text-[#2563EB] shrink-0 mt-0.5" />
                            {point}
                          </motion.li>
                        ))}
                      </ul>
                      <div className="border-t border-[#e8e8ed] pt-6 flex items-start gap-4">
                        <div className="w-10 h-10 rounded-full bg-[#2563EB]/10 flex items-center justify-center shrink-0">
                          <Star className="w-4 h-4 text-[#2563EB]" />
                        </div>
                        <div>
                          <blockquote className="text-[#1a1c1f] text-sm leading-relaxed italic mb-2">
                            "{currentPersona.quote}"
                          </blockquote>
                          <p className="text-xs text-muted-foreground font-semibold">{currentPersona.author}</p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ INTEGRATION ECOSYSTEM ════════════════════════════════════════════ */}
        <section className="py-24 px-6 bg-[#F2F2F7]" id="integrations">
          <div className="max-w-6xl mx-auto">
            <FadeIn>
              <div className="text-center mb-14">
                <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tighter mb-4">
                  Connect your entire stack<br className="hidden sm:block" /> in minutes
                </h2>
                <p className="text-[#434655] text-base max-w-lg mx-auto font-medium">
                  OAuth-based integrations with zero-config ETL. Your data stays in your control.
                </p>
              </div>
            </FadeIn>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              {[
                { name: "Google Ads", icon: <SiGoogleads className="w-5 h-5" aria-hidden="true" />, desc: "Campaign spend, ROAS, conversions, AI MAX audit", category: "Advertising" },
                { name: "Meta Ads", icon: <SiMeta className="w-5 h-5" aria-hidden="true" />, desc: "Ad sets, creative performance, audience insights", category: "Advertising" },
                { name: "Shopify", icon: <SiShopify className="w-5 h-5" aria-hidden="true" />, desc: "Orders, inventory, SKUs, revenue attribution", category: "E-Commerce" },
                { name: "Salesforce", icon: <SiSalesforce className="w-5 h-5" aria-hidden="true" />, desc: "Pipeline, lead scoring, opportunity tracking", category: "CRM" },
                { name: "HubSpot", icon: <SiHubspot className="w-5 h-5" aria-hidden="true" />, desc: "Contacts, deals, marketing automation data", category: "CRM" },
                { name: "Snowflake", icon: <SiSnowflake className="w-5 h-5" aria-hidden="true" />, desc: "Direct warehouse queries, data lake integration", category: "Data" },
                { name: "Looker", icon: <SiLooker className="w-5 h-5" aria-hidden="true" />, desc: "Embedded BI dashboards, secure signed URLs", category: "BI" },
                { name: "PostgreSQL", icon: <SiPostgresql className="w-5 h-5" aria-hidden="true" />, desc: "BYODB — query your own database with AI", category: "Data" },
                { name: "Databricks", icon: <SiDatabricks className="w-5 h-5" aria-hidden="true" />, desc: "Lakehouse analytics, MLflow model integration", category: "Data" },
              ].map((item, i) => (
                <FadeIn key={item.name} delay={i * 50}>
                  <div className="bg-white rounded-2xl border border-[#e8e8ed] p-5 flex items-start gap-4 transition-all hover:shadow-md hover:-translate-y-0.5 h-full">
                    <div className="w-10 h-10 rounded-xl bg-[#F2F2F7] flex items-center justify-center shrink-0 text-[#434655]">
                      {item.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold text-[#1a1c1f]">{item.name}</span>
                        <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground bg-[#F2F2F7] px-2 py-0.5 rounded-full">{item.category}</span>
                      </div>
                      <p className="text-xs text-[#434655] leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                </FadeIn>
              ))}
            </div>
            <FadeIn delay={300}>
              <div className="text-center">
                <p className="text-sm text-[#434655] font-medium mb-1">Plus MySQL, BigQuery, WooCommerce, Bing Ads, Zoho CRM, and more</p>
                <button onClick={() => onLeadCapture?.()} className="inline-flex items-center gap-2 text-[#2563EB] font-semibold text-sm hover:gap-3 transition-all mt-2">
                  See all integrations <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* ═══ ENTERPRISE SECURITY & COMPLIANCE ════════════════════════════════ */}
        <section className="py-24 px-6 bg-white" id="security">
          <div className="max-w-6xl mx-auto">
            <FadeIn>
              <div className="text-center mb-14">
                <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tighter mb-4">
                  Safely launch and scale AI<br className="hidden sm:block" /> in your organization
                </h2>
                <p className="text-[#434655] text-base max-w-lg mx-auto font-medium">
                  Enterprise-grade security, governance, and compliance — built in from day one.
                </p>
              </div>
            </FadeIn>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
              {[
                { title: "Data Encryption", desc: "AES-256-GCM encrypted credential vault. Bring your own database with zero plaintext storage. Read-only enforcement with 500-row hard caps.", icon: <Lock className="w-5 h-5" />, bg: "bg-blue-50", color: "text-[#2563EB]" },
                { title: "Approval Workflows", desc: "Dual-authorization for campaign changes. Junior buyers propose, senior directors approve. Full SHA-256 audit trail for every action.", icon: <Shield className="w-5 h-5" />, bg: "bg-violet-50", color: "text-violet-600" },
                { title: "Version Control", desc: "Git-style branching for data models. Tune AI context without impacting live dashboards. Roll back changes safely at any time.", icon: <GitBranch className="w-5 h-5" />, bg: "bg-emerald-50", color: "text-emerald-600" },
              ].map((card, i) => (
                <BentoCard key={card.title} className="flex flex-col min-h-[220px]" delay={i * 100}>
                  <div className={cn("w-11 h-11 rounded-2xl flex items-center justify-center mb-5", card.bg)}>
                    <span className={card.color}>{card.icon}</span>
                  </div>
                  <h3 className="text-lg font-bold tracking-tight mb-2">{card.title}</h3>
                  <p className="text-[#434655] text-sm leading-relaxed flex-1">{card.desc}</p>
                </BentoCard>
              ))}
            </div>
            <FadeIn delay={200}>
              <div className="bg-[#f7f9fb] rounded-3xl p-8 sm:p-10 border border-[#e8e8ed]">
                <h3 className="text-sm font-bold text-center mb-6 text-[#1a1c1f] uppercase tracking-widest">Compliance &amp; Certifications</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
                  {[
                    { label: "SOC 2 Type II", icon: "verified_user", desc: "Audit-ready" },
                    { label: "GDPR", icon: "shield", desc: "Data privacy" },
                    { label: "SSO / SAML", icon: "passkey", desc: "Single sign-on" },
                    { label: "RBAC", icon: "admin_panel_settings", desc: "Role-based access" },
                    { label: "99.9% SLA", icon: "speed", desc: "Guaranteed uptime" },
                    { label: "Tenant Isolation", icon: "lock", desc: "Data separation" },
                  ].map((badge) => (
                    <div key={badge.label} className="flex flex-col items-center text-center p-4 bg-white rounded-2xl border border-[#e8e8ed] hover:shadow-sm transition-all">
                      <div className="w-10 h-10 rounded-xl bg-[#2563EB]/5 flex items-center justify-center mb-2">
                        <span className="material-symbols-outlined text-[#2563EB] text-lg">{badge.icon}</span>
                      </div>
                      <p className="text-xs font-bold text-[#1a1c1f] mb-0.5">{badge.label}</p>
                      <p className="text-[10px] text-muted-foreground">{badge.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* ═══ WHAT HAPPENS AFTER YOU REQUEST A DEMO ═════════════════════════ */}
        <section className="py-20 px-6 bg-white border-t border-[#e8e8ed]/60">
          <div className="max-w-5xl mx-auto">
            <FadeIn>
              <div className="text-center mb-12">
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#2563EB]/8 text-[#2563EB] text-[11px] font-bold uppercase tracking-widest mb-5 border border-[#2563EB]/12">
                  What happens next
                </span>
                <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tighter text-[#1a1c1f] mb-3">
                  After you request a demo
                </h2>
                <p className="text-[#434655] text-base max-w-xl mx-auto leading-relaxed">
                  No surprises, no auto-billed trial. Just a short conversation and a guided walkthrough on data that looks like yours.
                </p>
              </div>
            </FadeIn>
            <div className="grid md:grid-cols-3 gap-6">
              {[
                {
                  step: "01",
                  title: "You submit the form",
                  desc: "Takes about 30 seconds. No credit card. We only ask for what we need to route you to the right person.",
                  icon: "send",
                },
                {
                  step: "02",
                  title: "We reach out within 2 business days",
                  desc: "A short call to understand your stack, your channels, and what \"good\" looks like for your team.",
                  icon: "call",
                },
                {
                  step: "03",
                  title: "You see OmniAnalytix on your data",
                  desc: "A guided 30-minute demo using sample data that mirrors your channels — so you can judge the fit, not the polish.",
                  icon: "insights",
                },
              ].map((item, i) => (
                <FadeIn key={item.step} delay={i * 80}>
                  <div className="h-full bg-[#f7f9fb] rounded-3xl border border-[#e8e8ed] p-7 flex flex-col">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-xl bg-[#2563EB]/10 flex items-center justify-center">
                        <span className="material-symbols-outlined text-[#2563EB] text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>{item.icon}</span>
                      </div>
                      <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground font-mono">{item.step}</span>
                    </div>
                    <h3 className="text-base font-bold text-[#1a1c1f] mb-2 tracking-tight">{item.title}</h3>
                    <p className="text-sm text-[#434655] leading-relaxed">{item.desc}</p>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ DARK CLOSER — Lead Gen CTA ══════════════════════════════════════ */}
        <section className="relative bg-[#0f172a] py-24 px-6 overflow-hidden">
          <div className="absolute top-0 right-0 w-2/3 h-full bg-[#2563EB]/10 blur-[180px] rounded-full translate-x-1/3 -translate-y-1/4 pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-1/2 h-1/2 bg-indigo-900/20 blur-[120px] rounded-full -translate-x-1/4 translate-y-1/4 pointer-events-none" />

          <div className="max-w-7xl mx-auto relative z-10">
            <div className="grid lg:grid-cols-2 gap-16 items-start">

              {/* Left: value prop */}
              <div>
                <h2 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white mb-6 leading-[1.1] tracking-tighter">
                  Ready to stop<br />leaking margin?
                </h2>
                <p className="text-slate-400 text-lg mb-10 max-w-md leading-relaxed">
                  Join 150+ enterprise agencies scaling with OmniAnalytix. Book your custom architectural review — personalized to your data stack.
                </p>
                <div className="space-y-4 mb-10">
                  {[
                    { icon: "speed", label: "30-minute onboarding. First insight within an hour." },
                    { icon: "workspace_premium", label: "SOC 2 Type II certified. GDPR compliant." },
                    { icon: "verified_user", label: "No data leaves your perimeter. BYODB architecture." },
                    { icon: "support_agent", label: "Dedicated solutions engineer for every enterprise client." },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-white/8 flex items-center justify-center shrink-0 border border-white/10">
                        <span className="material-symbols-outlined text-slate-300 text-xl">{item.icon}</span>
                      </div>
                      <span className="text-slate-300 text-sm font-medium">{item.label}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex -space-x-2">
                    {["bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500"].map((color, i) => (
                      <div key={i} className={cn("w-8 h-8 rounded-full border-2 border-[#0f172a] flex items-center justify-center text-white text-[10px] font-bold", color)}>
                        {["JD", "ML", "AK", "SR"][i]}
                      </div>
                    ))}
                  </div>
                  <p className="text-slate-400 text-sm"><span className="text-white font-semibold">150+</span> agencies trust OmniAnalytix</p>
                </div>
              </div>

              {/* Right: lead capture form */}
              <div className="bg-white rounded-3xl p-8 shadow-2xl">
                {closerSubmitted ? (
                  <div className="py-12 text-center">
                    <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-5">
                      <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                    </div>
                    <h3 className="text-xl font-bold text-[#1a1c1f] mb-2">You're on the list!</h3>
                    <p className="text-[#434655] text-sm">Our solutions team will reach out within 24 hours to schedule your custom architectural review.</p>
                  </div>
                ) : (
                  <form onSubmit={handleCloserSubmit} className="space-y-5">
                    <div>
                      <h3 className="text-xl font-bold text-[#1a1c1f] mb-1">Request a Custom Demo</h3>
                      <p className="text-sm text-muted-foreground">Personalized to your agency's data stack and goals.</p>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Work Email *</label>
                      <input
                        type="email"
                        required
                        value={closerForm.email}
                        onChange={(e) => setCloserForm((f) => ({ ...f, email: e.target.value }))}
                        placeholder="name@agency.com"
                        className="w-full bg-[#f7f9fb] border border-[#e8e8ed] rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/25 focus:border-[#2563EB]/40 text-[#1a1c1f] placeholder:text-[#b0b3c1]"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Company</label>
                        <input
                          type="text"
                          value={closerForm.company}
                          onChange={(e) => setCloserForm((f) => ({ ...f, company: e.target.value }))}
                          placeholder="Agency Name"
                          className="w-full bg-[#f7f9fb] border border-[#e8e8ed] rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/25 text-[#1a1c1f] placeholder:text-[#b0b3c1]"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor="closer-monthly-spend" className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Monthly Ad Spend</label>
                        <select
                          id="closer-monthly-spend"
                          value={closerForm.spend}
                          onChange={(e) => setCloserForm((f) => ({ ...f, spend: e.target.value }))}
                          className="w-full bg-[#f7f9fb] border border-[#e8e8ed] rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/25 text-[#1a1c1f]"
                        >
                          <option>$100k - $500k</option>
                          <option>$500k - $2M</option>
                          <option>$2M+</option>
                        </select>
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={closerLoading}
                      className="w-full bg-[#2563EB] hover:bg-[#1d4ed8] text-white py-4 rounded-xl font-bold shadow-lg shadow-blue-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-70"
                    >
                      {closerLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      {closerLoading ? "Submitting…" : "Request Custom Demo"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onLeadCapture?.()}
                      className="w-full text-[#2563EB] font-semibold text-sm py-2 hover:underline"
                    >
                      Book a 1:1 demo instead →
                    </button>
                    <p className="text-[10px] text-muted-foreground text-center">No spam. Your info is only used to book your demo.</p>
                  </form>
                )}
              </div>
            </div>
          </div>
        </section>

      </main>

      {/* ═══ FOOTER ══════════════════════════════════════════════════════════════ */}
      <footer className="w-full border-t border-slate-200 bg-slate-50">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 px-8 py-16 max-w-7xl mx-auto">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-xl bg-[#2563EB] flex items-center justify-center">
                <span className="material-symbols-outlined text-white text-[13px]" style={{ fontVariationSettings: "'FILL' 1" }}>analytics</span>
              </div>
              <span className="text-base font-bold text-[#1a1c1f] tracking-tight">OmniAnalytix</span>
            </div>
            <p className="text-slate-500 text-sm leading-relaxed max-w-xs">Elevating agency intelligence through precision AI and secure data infrastructure.</p>
            <p className="text-xs text-slate-400">© 2025 OmniAnalytix Inc. All rights reserved.</p>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-900 tracking-widest uppercase mb-6">Product</p>
            <ul className="space-y-3">
              {["AI Platform", "Dashboards", "Integrations", "Security", "Enterprise"].map((item) => (
                <li key={item}><a href="#" onClick={(e) => e.preventDefault()} className="text-slate-500 text-sm hover:text-slate-900 transition-colors cursor-default">{item}</a></li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-900 tracking-widest uppercase mb-6">Resources</p>
            <ul className="space-y-3">
              {["API Docs", "Help Center", "Blog", "Changelog", "Status"].map((item) => (
                <li key={item}><a href="#" onClick={(e) => e.preventDefault()} className="text-slate-500 text-sm hover:text-slate-900 transition-colors cursor-default">{item}</a></li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-900 tracking-widest uppercase mb-6">Legal</p>
            <ul className="space-y-3">
              {["Privacy Policy", "Terms of Service", "GDPR", "Cookie Policy"].map((item) => (
                <li key={item}><a href="#" onClick={(e) => e.preventDefault()} className="text-slate-500 text-sm hover:text-slate-900 transition-colors cursor-default">{item}</a></li>
              ))}
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}
