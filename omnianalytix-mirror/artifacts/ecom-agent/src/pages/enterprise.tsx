import { useState, useRef, useEffect } from "react";
import { Send, Calendar, ArrowRight, CheckCircle2, X, Loader2 } from "lucide-react";
import {
  SiGoogleads,
  SiMeta,
  SiShopify,
  SiSalesforce,
  SiHubspot,
  SiSnowflake,
  SiPostgresql,
} from "react-icons/si";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

const BASE = import.meta.env.BASE_URL ?? "/";

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

const PLATFORM_CAPABILITIES = [
  {
    title: "AI Command Center",
    desc: "Conversational analytics powered by Gemini 2.5 Pro. Ask questions in plain English across all connected data sources. Get instant analysis, anomaly detection, and one-click campaign actions.",
    icon: "smart_toy",
    metrics: ["Natural language queries", "Cross-platform analysis", "Real-time execution"],
    gradient: "from-[#2563EB] to-indigo-700",
  },
  {
    title: "Account Health & Anomaly Detection",
    desc: "Real-time anomaly detection across every connected platform. Catches margin leaks, budget waste, and performance drops before they impact revenue — with AI-recommended remediation.",
    icon: "emergency",
    metrics: ["Sub-60s detection", "Auto-remediation", "Severity scoring"],
    gradient: "from-rose-600 to-rose-700",
  },
  {
    title: "Auto-ETL Warehouse",
    desc: "Zero-config data pipelines that sync advertising, e-commerce, and CRM data into a unified PostgreSQL warehouse. No engineering required — connect and analyze immediately.",
    icon: "database",
    metrics: ["Zero-config sync", "Unified schema", "Real-time refresh"],
    gradient: "from-emerald-600 to-teal-700",
  },
  {
    title: "Google Advanced Suite",
    desc: "Enterprise-grade Google Ads tooling: AI MAX Auditor for PMax optimization, GTG Integrity Monitor for tag health, Pre-Flight Policy Compliance, and SA360 Inventory-Aware Templating.",
    icon: "auto_awesome",
    metrics: ["PMax auditing", "Tag monitoring", "Policy scanning"],
    gradient: "from-[#4285F4] to-blue-700",
  },
  {
    title: "Cross-Channel Budget Optimizer",
    desc: "Unified billing and pacing across Google Ads, Meta, and Bing. Real-time overspend alerts, automatic budget redistribution, and full-funnel allocation powered by predictive ROAS modeling.",
    icon: "account_balance",
    metrics: ["Multi-channel pacing", "Predictive ROAS", "Auto-redistribution"],
    gradient: "from-amber-600 to-orange-700",
  },
  {
    title: "Trifurcated Analytics Router",
    desc: "Automatically reconfigures KPIs, dashboards, and AI recommendations based on business model — E-Commerce revenue tracking, Lead Gen pipeline health, or Hybrid full-funnel analytics.",
    icon: "route",
    metrics: ["E-Com / Lead Gen / Hybrid", "Dynamic KPIs", "Goal-aware AI"],
    gradient: "from-violet-600 to-purple-700",
  },
];

const INTEGRATION_ECOSYSTEM = [
  { category: "Advertising", platforms: [
    { name: "Google Ads", icon: <SiGoogleads className="w-5 h-5" />, capabilities: ["Campaign management", "Budget pacing", "AI MAX audit", "Conversion tracking", "Asset group optimization"] },
    { name: "Meta Ads", icon: <SiMeta className="w-5 h-5" />, capabilities: ["Ad set performance", "Creative analysis", "Audience insights", "ROAS tracking", "Budget allocation"] },
  ]},
  { category: "E-Commerce", platforms: [
    { name: "Shopify", icon: <SiShopify className="w-5 h-5" />, capabilities: ["Order sync", "Inventory tracking", "SKU-level analytics", "Revenue attribution", "Out-of-stock ad pausing"] },
  ]},
  { category: "CRM & Sales", platforms: [
    { name: "Salesforce", icon: <SiSalesforce className="w-5 h-5" />, capabilities: ["Pipeline tracking", "Lead scoring", "Opportunity management", "Custom objects", "Report sync"] },
    { name: "HubSpot", icon: <SiHubspot className="w-5 h-5" />, capabilities: ["Contact management", "Deal tracking", "Marketing automation", "Attribution reporting", "Workflow triggers"] },
  ]},
  { category: "Data Infrastructure", platforms: [
    { name: "PostgreSQL (BYODB)", icon: <SiPostgresql className="w-5 h-5" />, capabilities: ["Direct AI queries", "Read-only enforcement", "Custom data models", "AES-256 encryption", "Connection pooling"] },
    { name: "Snowflake", icon: <SiSnowflake className="w-5 h-5" />, capabilities: ["Warehouse queries", "Data lake integration", "Cross-cloud analytics", "Secure data sharing", "Usage monitoring"] },
  ]},
];

const SECURITY_FEATURES = [
  { title: "AES-256-GCM Encryption", desc: "All credentials, tokens, and BYODB passwords encrypted at rest with AES-256-GCM. Zero plaintext storage across the entire platform.", icon: "lock", category: "Data Protection" },
  { title: "Multi-Tenant Isolation", desc: "Complete data separation between organizations. Every query, API call, and data access enforces tenant boundaries with row-level security.", icon: "domain", category: "Architecture" },
  { title: "Role-Based Access Control", desc: "Granular RBAC with Admin, Manager, and Member roles. Permission matrices for every action — from campaign changes to data exports.", icon: "admin_panel_settings", category: "Access Control" },
  { title: "Dual-Authorization Workflows", desc: "Campaign changes require two-person approval. Junior buyers propose, senior directors approve. Full SHA-256 audit trail for every action.", icon: "verified_user", category: "Governance" },
  { title: "SSO & Google OAuth", desc: "Enterprise single sign-on via Google OAuth with PKCE. Automatic user provisioning and de-provisioning for team management.", icon: "passkey", category: "Authentication" },
  { title: "Complete Audit Trail", desc: "Every API call, data access, campaign change, and AI interaction logged with timestamps, user IDs, and organization context. Exportable for compliance.", icon: "receipt_long", category: "Compliance" },
  { title: "Read-Only Data Access", desc: "BYODB connections enforced as read-only with 500-row hard caps and query timeouts. Your data is never modified by the platform.", icon: "shield", category: "Data Safety" },
  { title: "99.9% Uptime SLA", desc: "Enterprise-grade infrastructure with redundancy, automatic failover, and real-time health monitoring. Guaranteed availability for mission-critical operations.", icon: "speed", category: "Reliability" },
];

const DEPLOYMENT_FEATURES = [
  { title: "Dedicated Tenant Environment", desc: "Each organization gets an isolated environment with dedicated data storage, custom configurations, and separate API quotas." },
  { title: "Custom Domain & Branding", desc: "White-label the platform with your agency's branding, custom domain, and tailored onboarding flows for your clients." },
  { title: "API Access & Webhooks", desc: "Full REST API access for custom integrations. Real-time webhooks for alerts, campaign changes, and data sync events." },
  { title: "Priority Support & Onboarding", desc: "Dedicated customer success manager, priority ticket queue, and guided onboarding with data migration assistance." },
];

interface EnterprisePageProps {
  onLeadCapture?: () => void;
}

export default function EnterprisePage({ onLeadCapture }: EnterprisePageProps) {
  const [scrolled, setScrolled] = useState(false);
  const [activeIntegration, setActiveIntegration] = useState(0);
  const [showContactModal, setShowContactModal] = useState(false);
  const [contactForm, setContactForm] = useState({ name: "", email: "", company: "", employees: "", message: "" });
  const [contactSubmitted, setContactSubmitted] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <div className="min-h-screen bg-white text-[#1a1c1f] antialiased overflow-x-hidden font-sans">

      <header className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
        scrolled ? "bg-white/80 backdrop-blur-xl shadow-[0_1px_3px_rgba(0,0,0,0.06)]" : "bg-transparent",
      )}>
        <div className="max-w-7xl mx-auto px-6 lg:px-8 h-16 flex items-center justify-between">
          <a href={BASE} className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#2563EB] text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>grid_view</span>
            <span className="text-xl font-bold tracking-tighter">OmniAnalytix</span>
          </a>
          <nav className="hidden md:flex items-center gap-8">
            <a href="#capabilities" className="text-[#434655] font-medium tracking-tight hover:text-[#1a1c1f] transition-colors text-sm">Capabilities</a>
            <a href="#integrations" className="text-[#434655] font-medium tracking-tight hover:text-[#1a1c1f] transition-colors text-sm">Integrations</a>
            <a href="#security" className="text-[#434655] font-medium tracking-tight hover:text-[#1a1c1f] transition-colors text-sm">Security</a>
            <a href="#deployment" className="text-[#434655] font-medium tracking-tight hover:text-[#1a1c1f] transition-colors text-sm">Deployment</a>
          </nav>
          <div className="flex items-center gap-3">
            <a href={BASE} className="text-[#434655] font-medium hover:text-[#1a1c1f] transition-colors hidden sm:block text-sm">Back to Home</a>
            <button onClick={() => setShowContactModal(true)} className="bg-[#2563EB] text-white px-5 py-2.5 rounded-full text-sm font-bold shadow-lg shadow-blue-500/20 hover:bg-[#1e40af] active:scale-95 transition-all">
              Talk to Sales
            </button>
          </div>
        </div>
      </header>

      <main>
        <section className="pt-36 sm:pt-44 pb-24 px-6 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-slate-900 via-slate-900 to-[#0f172a]" />
          <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[900px] h-[500px] rounded-full bg-[#2563EB]/20 blur-[160px] pointer-events-none" />
          <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent" />

          <div className="max-w-5xl mx-auto text-center relative z-10">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 text-white/80 text-sm font-semibold mb-8 border border-white/10 backdrop-blur-sm">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                </span>
                Enterprise Platform
              </span>
            </motion.div>

            <motion.h1 initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.2 }} className="text-4xl sm:text-5xl md:text-7xl font-extrabold tracking-tighter leading-[1.08] mb-6 text-white">
              AI-powered analytics<br className="hidden sm:block" />
              <span className="text-[#60a5fa]">built for enterprise scale</span>
            </motion.h1>

            <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.35 }} className="text-base sm:text-lg text-white/60 max-w-2xl mx-auto mb-10 leading-relaxed font-medium">
              Unified marketing intelligence across 47+ platforms. Multi-tenant architecture with full data isolation, RBAC, encrypted credential vaults, and AI that executes — not just reports.
            </motion.p>

            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.45 }} className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-8">
              <button onClick={() => setShowContactModal(true)} className="w-full sm:w-auto px-8 py-4 bg-white text-slate-900 rounded-2xl font-bold text-base shadow-lg hover:bg-blue-50 active:scale-[0.97] transition-all flex items-center justify-center gap-3">
                <Send className="w-5 h-5" /> Talk to Sales
              </button>
              <button onClick={() => onLeadCapture?.()} className="w-full sm:w-auto px-8 py-4 bg-white/10 text-white border-2 border-white/20 rounded-2xl font-bold text-base hover:bg-white/20 transition-all backdrop-blur-sm flex items-center justify-center gap-2">
                <Calendar className="w-4 h-4" /> Schedule a Demo
              </button>
            </motion.div>

            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }} className="flex flex-wrap items-center justify-center gap-6 text-white/40 text-xs font-medium">
              {["SOC 2 Type II", "GDPR Compliant", "99.9% SLA", "AES-256 Encryption", "SSO / SAML"].map((badge) => (
                <span key={badge} className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/60" />
                  {badge}
                </span>
              ))}
            </motion.div>
          </div>
        </section>

        <section className="py-24 px-6 bg-white" id="capabilities">
          <div className="max-w-6xl mx-auto">
            <FadeIn>
              <div className="text-center mb-16">
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#2563EB]/5 text-[#2563EB] text-[11px] font-bold uppercase tracking-widest mb-4">
                  Platform Capabilities
                </span>
                <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tighter mb-4">
                  10 engines powering your<br className="hidden sm:block" /> marketing intelligence
                </h2>
                <p className="text-[#434655] text-base max-w-lg mx-auto font-medium">
                  Every engine activates automatically as you connect platforms. No configuration required.
                </p>
              </div>
            </FadeIn>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {PLATFORM_CAPABILITIES.map((cap, i) => (
                <FadeIn key={cap.title} delay={i * 60}>
                  <div className="bg-white rounded-3xl border border-[#e8e8ed] p-7 flex flex-col h-full hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
                    <div className={cn("w-12 h-12 rounded-2xl bg-gradient-to-br flex items-center justify-center mb-5", cap.gradient)}>
                      <span className="material-symbols-outlined text-white text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>{cap.icon}</span>
                    </div>
                    <h3 className="text-lg font-bold tracking-tight mb-2">{cap.title}</h3>
                    <p className="text-sm text-[#434655] leading-relaxed flex-1 mb-4">{cap.desc}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {cap.metrics.map((m) => (
                        <span key={m} className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-[#F2F2F7] text-[#434655]">{m}</span>
                      ))}
                    </div>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </section>

        <section className="py-24 px-6 bg-[#F2F2F7]" id="integrations">
          <div className="max-w-6xl mx-auto">
            <FadeIn>
              <div className="text-center mb-16">
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-bold uppercase tracking-widest mb-4 border border-emerald-200/40">
                  Integration Ecosystem
                </span>
                <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tighter mb-4">
                  Deep integrations,<br className="hidden sm:block" /> not just connections
                </h2>
                <p className="text-[#434655] text-base max-w-lg mx-auto font-medium">
                  Every integration goes beyond data sync — enabling AI-driven actions, real-time monitoring, and automated workflows.
                </p>
              </div>
            </FadeIn>

            <div className="flex flex-wrap justify-center gap-2 mb-10">
              {INTEGRATION_ECOSYSTEM.map((cat, i) => (
                <button
                  key={cat.category}
                  onClick={() => setActiveIntegration(i)}
                  className={cn(
                    "px-5 py-2.5 rounded-full text-sm font-semibold transition-all",
                    activeIntegration === i
                      ? "bg-[#2563EB] text-white shadow-lg shadow-blue-500/15"
                      : "bg-white text-[#434655] hover:bg-white/80 border border-[#e8e8ed]",
                  )}
                >
                  {cat.category}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {INTEGRATION_ECOSYSTEM[activeIntegration].platforms.map((platform) => (
                <FadeIn key={platform.name}>
                  <div className="bg-white rounded-3xl border border-[#e8e8ed] p-7 hover:shadow-md transition-all">
                    <div className="flex items-center gap-4 mb-5">
                      <div className="w-12 h-12 rounded-2xl bg-[#F2F2F7] flex items-center justify-center text-[#434655]">
                        {platform.icon}
                      </div>
                      <div>
                        <h3 className="text-lg font-bold tracking-tight">{platform.name}</h3>
                        <p className="text-xs text-[#737686] font-medium">OAuth 2.0 + Zero-config ETL</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {platform.capabilities.map((cap) => (
                        <div key={cap} className="flex items-center gap-2.5 text-sm text-[#434655]">
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                          {cap}
                        </div>
                      ))}
                    </div>
                  </div>
                </FadeIn>
              ))}
            </div>

            <FadeIn delay={200}>
              <div className="mt-8 text-center">
                <p className="text-sm text-[#434655] font-medium">
                  Also supports: Google Analytics 4, Google Search Console, Bing Ads, WooCommerce, Zoho CRM, MySQL, BigQuery, Databricks, Looker, and more
                </p>
              </div>
            </FadeIn>
          </div>
        </section>

        <section className="py-24 px-6 bg-white" id="security">
          <div className="max-w-6xl mx-auto">
            <FadeIn>
              <div className="text-center mb-16">
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-50 text-violet-700 text-[11px] font-bold uppercase tracking-widest mb-4 border border-violet-200/40">
                  Security & Compliance
                </span>
                <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tighter mb-4">
                  Enterprise security<br className="hidden sm:block" /> without compromise
                </h2>
                <p className="text-[#434655] text-base max-w-lg mx-auto font-medium">
                  Built from the ground up with multi-tenant isolation, encrypted credential vaults, and comprehensive audit trails.
                </p>
              </div>
            </FadeIn>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {SECURITY_FEATURES.map((feature, i) => (
                <FadeIn key={feature.title} delay={i * 50}>
                  <div className="bg-[#F2F2F7] rounded-2xl p-6 border border-[#e8e8ed] hover:shadow-sm transition-all h-full flex flex-col">
                    <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center mb-4 shadow-sm">
                      <span className="material-symbols-outlined text-[#2563EB] text-lg">{feature.icon}</span>
                    </div>
                    <span className="text-[9px] font-bold uppercase tracking-widest text-[#737686] mb-2">{feature.category}</span>
                    <h3 className="text-sm font-bold text-[#1a1c1f] mb-2">{feature.title}</h3>
                    <p className="text-xs text-[#434655] leading-relaxed flex-1">{feature.desc}</p>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </section>

        <section className="py-24 px-6 bg-[#F2F2F7]" id="deployment">
          <div className="max-w-6xl mx-auto">
            <FadeIn>
              <div className="text-center mb-16">
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-[11px] font-bold uppercase tracking-widest mb-4 border border-amber-200/40">
                  Enterprise Deployment
                </span>
                <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tighter mb-4">
                  Deploy on your terms
                </h2>
                <p className="text-[#434655] text-base max-w-lg mx-auto font-medium">
                  Flexible deployment with dedicated environments, custom branding, and priority support.
                </p>
              </div>
            </FadeIn>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-12">
              {DEPLOYMENT_FEATURES.map((feature, i) => (
                <FadeIn key={feature.title} delay={i * 80}>
                  <div className="bg-white rounded-3xl border border-[#e8e8ed] p-8 hover:shadow-md transition-all">
                    <h3 className="text-lg font-bold tracking-tight mb-3">{feature.title}</h3>
                    <p className="text-sm text-[#434655] leading-relaxed">{feature.desc}</p>
                  </div>
                </FadeIn>
              ))}
            </div>

            <FadeIn delay={200}>
              <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-3xl p-10 sm:p-16 text-center text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 w-96 h-96 bg-[#2563EB]/10 rounded-full -translate-y-1/2 translate-x-1/3 blur-3xl pointer-events-none" />
                <div className="relative z-10">
                  <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tighter mb-4">Ready to scale your agency with AI?</h2>
                  <p className="text-white/60 text-base max-w-md mx-auto mb-8 font-medium">Get a personalized demo showing how OmniAnalytix integrates with your existing stack.</p>
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                    <button onClick={() => setShowContactModal(true)} className="w-full sm:w-auto px-8 py-4 bg-white text-slate-900 rounded-2xl font-bold text-base hover:bg-blue-50 active:scale-[0.97] transition-all shadow-lg flex items-center justify-center gap-2">
                      <Send className="w-5 h-5" /> Talk to Sales
                    </button>
                    <button onClick={() => onLeadCapture?.()} className="w-full sm:w-auto px-8 py-4 bg-white/10 text-white border-2 border-white/20 rounded-2xl font-bold text-base hover:bg-white/20 transition-all backdrop-blur-sm flex items-center justify-center gap-2">
                      <Calendar className="w-4 h-4" /> Schedule a Demo
                    </button>
                  </div>
                </div>
              </div>
            </FadeIn>
          </div>
        </section>
      </main>

      <footer className="bg-white pt-16 pb-10 px-6 border-t border-[#e8e8ed]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#2563EB] text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>grid_view</span>
            <span className="text-xl font-bold tracking-tighter">OmniAnalytix</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-[#434655] font-medium">
            <a href={BASE} className="hover:text-[#2563EB] transition-colors">Home</a>
            <a href={`${BASE}privacy-policy`} className="hover:text-[#2563EB] transition-colors">Privacy Policy</a>
          </div>
          <p className="text-sm text-[#737686] font-medium">&copy; 2026 OmniAnalytix Inc.</p>
        </div>
      </footer>

      {showContactModal && (
        <div
          className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
          onClick={() => setShowContactModal(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
              e.preventDefault();
              setShowContactModal(false);
            }
          }}
          role="button"
          tabIndex={0}
          aria-label="Close enterprise sales dialog"
        >
          <div
            className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-300"
            role="dialog"
            aria-modal="true"
            aria-labelledby="enterprise-contact-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="px-6 pt-6 pb-4 border-b border-[#e8e8ed]">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-[#2563EB]/10 flex items-center justify-center">
                    <Send className="w-4 h-4 text-[#2563EB]" />
                  </div>
                  <h2 id="enterprise-contact-title" className="text-lg font-bold tracking-tight">Talk to Enterprise Sales</h2>
                </div>
                <button onClick={() => setShowContactModal(false)} aria-label="Close enterprise sales dialog" className="w-8 h-8 rounded-full hover:bg-[#F2F2F7] flex items-center justify-center transition-colors">
                  <X className="w-4 h-4 text-[#434655]" />
                </button>
              </div>
              <p className="text-sm text-[#434655]">Tell us about your agency and we'll prepare a personalized demo.</p>
            </div>
            {contactSubmitted ? (
              <div className="p-8 text-center">
                <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-7 h-7 text-emerald-500" />
                </div>
                <h3 className="text-lg font-bold mb-2">We'll be in touch</h3>
                <p className="text-sm text-[#434655] leading-relaxed mb-6">Our enterprise team will reach out within 24 hours with a tailored demo plan.</p>
                <button onClick={() => setShowContactModal(false)} className="px-6 py-2.5 bg-[#2563EB] text-white rounded-full text-sm font-bold hover:bg-[#1e40af] transition-colors">Done</button>
              </div>
            ) : (
              <div className="p-5 space-y-3.5">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="enterprise-contact-name" className="block text-xs font-semibold mb-1.5">Full Name *</label>
                    <input id="enterprise-contact-name" type="text" value={contactForm.name} onChange={(e) => setContactForm((f) => ({ ...f, name: e.target.value }))} placeholder="Jane Smith" className="w-full bg-white border border-[#e8e8ed] rounded-xl px-4 py-3 text-sm outline-none focus:border-[#2563EB]/40 focus:ring-2 focus:ring-[#2563EB]/10 placeholder:text-[#737686]/40 transition-all" />
                  </div>
                  <div>
                    <label htmlFor="enterprise-contact-company" className="block text-xs font-semibold mb-1.5">Company *</label>
                    <input id="enterprise-contact-company" type="text" value={contactForm.company} onChange={(e) => setContactForm((f) => ({ ...f, company: e.target.value }))} placeholder="Acme Agency" className="w-full bg-white border border-[#e8e8ed] rounded-xl px-4 py-3 text-sm outline-none focus:border-[#2563EB]/40 focus:ring-2 focus:ring-[#2563EB]/10 placeholder:text-[#737686]/40 transition-all" />
                  </div>
                </div>
                <div>
                  <label htmlFor="enterprise-contact-email" className="block text-xs font-semibold mb-1.5">Work Email *</label>
                  <input id="enterprise-contact-email" type="email" value={contactForm.email} onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))} placeholder="jane@company.com" className="w-full bg-white border border-[#e8e8ed] rounded-xl px-4 py-3 text-sm outline-none focus:border-[#2563EB]/40 focus:ring-2 focus:ring-[#2563EB]/10 placeholder:text-[#737686]/40 transition-all" />
                </div>
                <div>
                  <label htmlFor="enterprise-contact-team-size" className="block text-xs font-semibold mb-1.5">Team Size</label>
                  <select id="enterprise-contact-team-size" value={contactForm.employees} onChange={(e) => setContactForm((f) => ({ ...f, employees: e.target.value }))} className="w-full bg-white border border-[#e8e8ed] rounded-xl px-4 py-3 text-sm outline-none focus:border-[#2563EB]/40 focus:ring-2 focus:ring-[#2563EB]/10 text-[#434655] transition-all">
                    <option value="">Select team size</option>
                    <option value="1-10">1-10 employees</option>
                    <option value="11-50">11-50 employees</option>
                    <option value="51-200">51-200 employees</option>
                    <option value="200+">200+ employees</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="enterprise-contact-message" className="block text-xs font-semibold mb-1.5">What are you looking to solve? <span className="text-[#737686] font-normal">(optional)</span></label>
                  <textarea id="enterprise-contact-message" value={contactForm.message} onChange={(e) => setContactForm((f) => ({ ...f, message: e.target.value }))} rows={3} placeholder="e.g., Unified reporting across Google + Meta, replacing manual QBRs..." className="w-full bg-white border border-[#e8e8ed] rounded-xl px-4 py-3 text-sm outline-none focus:border-[#2563EB]/40 focus:ring-2 focus:ring-[#2563EB]/10 placeholder:text-[#737686]/40 transition-all resize-none" />
                </div>
                <button onClick={async () => {
                  try {
                    const apiBase = BASE.endsWith("/") ? BASE : BASE + "/";
                    await fetch(`${apiBase}api/leads`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ source: "enterprise", ...contactForm }),
                    });
                  } catch { /* still show success UI */ }
                  setContactSubmitted(true);
                }} disabled={!contactForm.name.trim() || !contactForm.email.trim()} className="w-full py-3.5 bg-[#2563EB] text-white rounded-full text-sm font-bold flex items-center justify-center gap-2 hover:bg-[#1e40af] active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-blue-500/15">
                  <Send className="w-4 h-4" /> Contact Enterprise Sales
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
