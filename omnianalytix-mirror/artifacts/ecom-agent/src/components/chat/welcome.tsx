import { useState, useEffect } from "react";
import { TrendingDown, ShieldAlert, BarChart3, ArrowRight, Loader2, RefreshCw, CheckCircle2 } from "lucide-react";
import { useWorkspace } from "@/contexts/workspace-context";
import { useListConnections } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth-fetch";
import { Link } from "wouter";

const BASE = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

type Severity = "critical" | "warning" | "info";

interface TriageAlert {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  platform: string;
  action?: string;
  ts: string;
}

const ECOM_FALLBACKS = [
  {
    id: "fb-1", severity: "warning" as Severity,
    icon: TrendingDown, platform: "Google Ads",
    headline: "Run full POAS analysis",
    sub: "Identify which campaigns are generating real margin vs. vanity ROAS",
    prompt: "Run a full POAS analysis across all active campaigns and identify which ones are unprofitable after COGS.",
  },
  {
    id: "fb-2", severity: "info" as Severity,
    icon: ShieldAlert, platform: "Inventory",
    headline: "Check for ads on empty shelves",
    sub: "Detect campaigns wasting budget on zero-inventory SKUs",
    prompt: "Identify all active ad campaigns pointing to out-of-stock Shopify products and recommend immediate pauses.",
  },
  {
    id: "fb-3", severity: "info" as Severity,
    icon: BarChart3, platform: "PMax",
    headline: "Run PMax X-Ray diagnostic",
    sub: "Audit your Performance Max network distribution and asset coverage",
    prompt: "Run a PMax X-Ray to show my network distribution, asset group performance, and identify any spend leaks.",
  },
];

const LEADGEN_FALLBACKS = [
  {
    id: "lb-1", severity: "warning" as Severity,
    icon: TrendingDown, platform: "Google Ads",
    headline: "Audit blended CAC across all channels",
    sub: "Identify which channels are delivering quality pipeline vs. expensive dead leads",
    prompt: "Audit my customer acquisition cost across all active campaigns and identify which ones are driving unqualified leads.",
  },
  {
    id: "lb-2", severity: "info" as Severity,
    icon: ShieldAlert, platform: "Pipeline",
    headline: "Flag campaigns with zero conversions",
    sub: "Surface high-spend campaigns with poor MQL-to-pipeline conversion",
    prompt: "Identify all campaigns with significant spend but zero or near-zero conversion rates and recommend budget reallocation.",
  },
  {
    id: "lb-3", severity: "info" as Severity,
    icon: BarChart3, platform: "Attribution",
    headline: "Run pipeline quality triage",
    sub: "Detect CPL outliers and attribution gaps across your lead gen stack",
    prompt: "Run a pipeline quality triage across my active campaigns. Flag any CPL outliers and attribution gaps.",
  },
];

const HYBRID_FALLBACKS = [
  {
    id: "hb-1", severity: "warning" as Severity,
    icon: TrendingDown, platform: "Full Funnel",
    headline: "Cross-funnel performance audit",
    sub: "Compare e-commerce revenue and lead pipeline health side by side",
    prompt: "Run a cross-funnel performance audit. Show POAS and margin metrics alongside CAC and pipeline velocity. Identify where each funnel is leaking budget.",
  },
  {
    id: "hb-2", severity: "info" as Severity,
    icon: ShieldAlert, platform: "Revenue + Pipeline",
    headline: "Dual-funnel budget efficiency",
    sub: "Detect overspend across both direct sales and lead gen channels",
    prompt: "Analyse budget allocation across both e-commerce and lead gen campaigns. Flag channels where spend exceeds returns in either funnel.",
  },
  {
    id: "hb-3", severity: "info" as Severity,
    icon: BarChart3, platform: "Attribution",
    headline: "Unified attribution check",
    sub: "Verify conversion attribution across both sales and pipeline stages",
    prompt: "Run a unified attribution audit across all channels. Cross-reference e-commerce conversions with pipeline stage progression to find attribution gaps.",
  },
];


const SEV: Record<Severity, { border: string; bg: string; badge: string; dot: string }> = {
  critical: {
    border: "border-error-m3/20", bg: "bg-error-container/50",
    badge: "text-error-m3 bg-error-container border-error-m3/20", dot: "bg-error-container",
  },
  warning: {
    border: "border-amber-200", bg: "bg-amber-50/50",
    badge: "text-amber-600 bg-amber-50 border-amber-200", dot: "bg-amber-500",
  },
  info: {
    border: "border-primary-container/20", bg: "bg-primary-container/10/30",
    badge: "text-accent-blue bg-primary-container/10 border-primary-container/20", dot: "bg-accent-blue",
  },
};

function AlertRow({ item, onStart }: { item: { severity: Severity; platform: string; headline: string; sub: string; prompt: string }; onStart: (p: string) => void }) {
  const s = SEV[item.severity];
  return (
    <button
      onClick={() => onStart(item.prompt)}
      className={cn(
        "w-full text-left rounded-2xl border p-3.5 transition-all group hover:brightness-[0.98] active:scale-[0.99]",
        s.border, s.bg,
      )}
    >
      <div className="flex items-start gap-3">
        <span className={cn("shrink-0 w-1.5 h-1.5 rounded-full mt-2", s.dot)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full border", s.badge)}>
              {item.platform}
            </span>
            <span className="text-xs font-semibold text-on-surface">{item.headline}</span>
          </div>
          <p className="text-[11px] text-on-surface-variant leading-relaxed">{item.sub}</p>
        </div>
        <ArrowRight className="w-3.5 h-3.5 shrink-0 text-outline-variant group-hover:text-on-surface-variant mt-0.5 transition-colors" />
      </div>
    </button>
  );
}

function triageToRow(alert: TriageAlert) {
  return {
    severity: alert.severity,
    platform: alert.platform,
    headline: alert.title,
    sub: alert.detail,
    prompt: alert.action
      ? `${alert.title}. Recommended action: ${alert.action}. Please analyse this issue and provide a step-by-step resolution plan.`
      : `Analyse this issue and provide a resolution: ${alert.title}`,
  };
}

interface GettingStartedProps {
  connections: Array<{ platform: string; isActive: boolean }>;
}

const STEPS = [
  { key: "shopify",    label: "Connect Shopify",      description: "Link your store for product and order data", icon: "shopping_bag", platform: "shopify" },
  { key: "google_ads", label: "Connect Google Ads",    description: "Import campaigns, keywords, and performance", icon: "ads_click",    platform: "google_ads" },
  { key: "diagnostic", label: "Run First Diagnostic",  description: "Get AI-powered insights on your data",       icon: "search_insights", platform: null },
];

function GettingStarted({ connections }: GettingStartedProps) {
  const hasShopify = connections.some((c) => c.platform === "shopify" && c.isActive);
  const hasGoogle  = connections.some((c) => ["google_ads", "gsc"].includes(c.platform) && c.isActive);

  const stepStatus = [hasShopify, hasGoogle, false];
  const currentStep = stepStatus.findIndex((done) => !done);

  if (hasShopify && hasGoogle) return null;

  return (
    <div className="w-full rounded-2xl border border-outline-variant/15 bg-white p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-2xl bg-accent-blue/10 flex items-center justify-center">
          <span className="material-symbols-outlined text-accent-blue" style={{ fontSize: 18 }}>rocket_launch</span>
        </div>
        <div>
          <p className="text-sm font-bold text-on-surface">Getting Started</p>
          <p className="text-[11px] text-on-surface-variant">Complete these steps to unlock AI diagnostics</p>
        </div>
      </div>

      <div className="flex items-center gap-1 px-1">
        {STEPS.map((_, i) => (
          <div
            key={i}
            className={cn(
              "flex-1 h-1 rounded-full transition-all",
              stepStatus[i] ? "bg-emerald-500" : i === currentStep ? "bg-accent-blue" : "bg-surface-container-highest",
            )}
          />
        ))}
      </div>

      <div className="space-y-2">
        {STEPS.map((step, i) => {
          const done = stepStatus[i];
          const active = i === currentStep;
          return (
            <div key={step.key} className={cn(
              "flex items-center gap-3 px-3 py-3 rounded-2xl border transition-all",
              done ? "border-outline-variant/15 bg-surface/50" : active ? "border-accent-blue/30 bg-accent-blue/5" : "ghost-border bg-surface/50 opacity-50",
            )}>
              <div className={cn(
                "w-7 h-7 rounded-2xl flex items-center justify-center shrink-0",
                done ? "bg-emerald-500 text-white" : active ? "bg-accent-blue/10 text-accent-blue" : "bg-surface-container-low text-on-surface-variant",
              )}>
                {done ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{step.icon}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn("text-xs font-semibold", done ? "text-emerald-700 line-through" : "text-on-surface")}>{step.label}</p>
                <p className="text-[10px] text-on-surface-variant">{step.description}</p>
              </div>
              {active && step.platform && (
                <Link href="/connections">
                  <button className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-[11px] font-semibold text-white bg-accent-blue hover:bg-accent-blue/90 transition-colors active:scale-95">
                    Connect <ArrowRight className="w-3 h-3" />
                  </button>
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ChatWelcomeProps {
  onStart: (prompt: string) => void;
}

export function ChatWelcome({ onStart }: ChatWelcomeProps) {
  const { activeWorkspace } = useWorkspace();
  const goal = activeWorkspace?.primaryGoal;
  const fallbacks = goal === "hybrid" ? HYBRID_FALLBACKS : goal === "leadgen" ? LEADGEN_FALLBACKS : ECOM_FALLBACKS;

  const { data: connections = [] } = useListConnections();
  const hasShopify = connections.some((c) => c.platform === "shopify" && c.isActive);
  const hasGoogle  = connections.some((c) => ["google_ads", "gsc"].includes(c.platform) && c.isActive);
  const showStepper = !hasShopify || !hasGoogle;

  const [liveAlerts, setLiveAlerts]   = useState<TriageAlert[]>([]);
  const [triageState, setTriageState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [refreshedAt, setRefreshedAt] = useState("");

  const loadTriage = async () => {
    setTriageState("loading");
    try {
      const resp = await authFetch(`${API_BASE}api/live-triage?goal=${goal || "ecom"}`);
      if (!resp.ok) { setTriageState("error"); return; }
      const data = await resp.json() as { alerts: TriageAlert[]; refreshedAt: string };
      setLiveAlerts(data.alerts ?? []);
      setRefreshedAt(data.refreshedAt ?? "");
      setTriageState("done");
    } catch {
      setTriageState("error");
    }
  };

  useEffect(() => { void loadTriage(); }, []);

  const showItems: Array<{ severity: Severity; platform: string; headline: string; sub: string; prompt: string }> =
    liveAlerts.length > 0
      ? liveAlerts.slice(0, 4).map(triageToRow)
      : fallbacks;

  const isLive = triageState === "done" && liveAlerts.length > 0;

  return (
    <div className="flex flex-col items-center justify-start min-h-full p-4 pt-5 w-full max-w-3xl mx-auto space-y-5 animate-in fade-in duration-500">

      {showStepper && (
        <GettingStarted connections={connections} />
      )}

      <div className="w-full flex items-center justify-between">
        <div className="flex items-center gap-2">
          {triageState === "loading" ? (
            <Loader2 className="w-2.5 h-2.5 text-accent-blue animate-spin" />
          ) : isLive ? (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
          ) : (
            <span className="w-2 h-2 rounded-full bg-[#c8c5cb]" />
          )}
          <span className="text-[10px] font-semibold text-on-secondary-container uppercase tracking-widest">
            {isLive ? "Live Triage" : triageState === "loading" ? "Loading triage…" : "Suggested Actions"}
          </span>
          {isLive && refreshedAt && (
            <span className="text-[9px] text-on-surface-variant">· {refreshedAt}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {triageState !== "loading" && (
            <button
              onClick={() => void loadTriage()}
              className="text-on-surface-variant hover:text-on-surface transition-colors"
              title="Refresh triage"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <div className="w-full space-y-2">
        {triageState === "loading" ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-[64px] rounded-2xl border ghost-border bg-surface animate-pulse" />
            ))}
          </div>
        ) : (
          showItems.map((item, idx) => (
            <AlertRow key={idx} item={item} onStart={onStart} />
          ))
        )}
      </div>

    </div>
  );
}
