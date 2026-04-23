import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { GtgConfigModal } from "@/components/connections/gtg-config-modal";
import { useListConnections } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { useWorkspace } from "@/contexts/workspace-context";

type PlatformKey = "google_ads" | "shopify" | "meta" | "hubspot" | "salesforce";

interface EngineDefinition {
  name: string;
  description: string;
  icon: string;
  group: string;
  requires: PlatformKey[];
  requireMode: "any" | "all";
  alwaysActive?: boolean;
  statusLabel?: string;
  configurable?: boolean;
  valueMetric?: string;
  capabilities?: string[];
}

const ENGINE_DEFS: EngineDefinition[] = [
  {
    name: "AI MAX Auditor",
    description: "Continuously audits AI MAX campaign structures for asset group hygiene, signal coverage, and search theme alignment.",
    icon: "auto_awesome",
    group: "Google Advanced Suite",
    requires: ["google_ads"],
    requireMode: "all",
    valueMetric: "Catches avg. $2.4K/mo in wasted PMax spend",
    capabilities: ["Asset group audit", "Signal coverage", "Search theme alignment"],
  },
  {
    name: "GTG Integrity Monitor",
    description: "Google Tag Gateway diagnostics — real-time measurement drop-off alerts, consent-mode gap detection, and tag firing validation.",
    icon: "sell",
    group: "Google Advanced Suite",
    requires: ["google_ads"],
    requireMode: "all",
    configurable: true,
    valueMetric: "Prevents measurement drop-offs before they impact data",
    capabilities: ["Tag validation", "Consent-mode audit", "Drop-off alerts"],
  },
  {
    name: "Pre-Flight Policy Compliance",
    description: "Scans campaigns against Google Ads policy requirements before launch. Catches disapprovals, trademark violations, and restricted content.",
    icon: "verified_user",
    group: "Google Advanced Suite",
    requires: ["google_ads"],
    requireMode: "all",
    valueMetric: "Eliminates policy rejections before spend begins",
    capabilities: ["Policy scanning", "Trademark checks", "Content compliance"],
  },
  {
    name: "SA360 Inventory-Aware Templating",
    description: "Syncs SA360 feed templates with live inventory. Pauses ads for out-of-stock SKUs and auto-generates templates for new products.",
    icon: "inventory_2",
    group: "Google Advanced Suite",
    requires: ["google_ads", "shopify"],
    requireMode: "all",
    valueMetric: "Stops spend on out-of-stock products in real time",
    capabilities: ["Feed sync", "OOS ad pausing", "Auto-templating"],
  },
  {
    name: "Full-Funnel Allocator",
    description: "Optimizes budget distribution across awareness, consideration, and conversion tiers using cross-channel incrementality signals.",
    icon: "account_tree",
    group: "Google Advanced Suite",
    requires: ["google_ads"],
    requireMode: "all",
    valueMetric: "Avg. 18% improvement in cross-channel ROAS",
    capabilities: ["Incrementality modeling", "Budget optimization", "Tier allocation"],
  },
  {
    name: "Account Health & Anomaly Detection",
    description: "Real-time anomaly detection across all connected platforms. Catches margin leaks, budget waste, and performance drops with AI-recommended fixes.",
    icon: "emergency",
    group: "Core Engines",
    requires: ["google_ads", "shopify", "meta"],
    requireMode: "any",
    valueMetric: "99% of critical alerts auto-resolved in < 60 seconds",
    capabilities: ["Anomaly detection", "Margin leak prevention", "AI remediation"],
  },
  {
    name: "Auto-ETL Warehouse",
    description: "Zero-config data pipelines that sync Shopify, Google Ads, Meta, and CRM data into a unified PostgreSQL warehouse.",
    icon: "database",
    group: "Core Engines",
    requires: ["google_ads", "shopify", "meta", "hubspot", "salesforce"],
    requireMode: "any",
    valueMetric: "Replaces $5K+/mo in custom ETL engineering costs",
    capabilities: ["Zero-config sync", "Unified schema", "Real-time refresh"],
  },
  {
    name: "AI Command Center",
    description: "Conversational interface powered by Gemini 2.5 Pro. Natural language queries, instant analysis, and one-click execution.",
    icon: "smart_toy",
    group: "Core Engines",
    requires: [],
    requireMode: "any",
    alwaysActive: true,
    valueMetric: "73% reduction in manual reporting time",
    capabilities: ["Natural language queries", "Cross-platform analysis", "One-click actions"],
  },
  {
    name: "Trifurcated Router",
    description: "Automatically reconfigures dashboards, KPIs, and recommendations based on your business model — E-Commerce, Lead Gen, or Hybrid.",
    icon: "route",
    group: "Core Engines",
    requires: [],
    requireMode: "any",
    alwaysActive: true,
    valueMetric: "Dynamic KPIs tailored to your business model",
    capabilities: ["Goal-aware AI", "Dynamic dashboards", "KPI reconfiguration"],
  },
  {
    name: "Unified Billing & Pacing",
    description: "Cross-platform budget tracking with spend pacing, overspend alerts, and automatic budget redistribution across channels.",
    icon: "account_balance",
    group: "Advanced Tools",
    requires: ["google_ads", "meta"],
    requireMode: "any",
    valueMetric: "Prevents overspend with real-time budget pacing",
    capabilities: ["Multi-channel tracking", "Overspend alerts", "Auto-redistribution"],
  },
];

const STATUS_LABELS: Record<string, string> = {
  "AI MAX Auditor": "Auditing",
  "GTG Integrity Monitor": "Active",
  "Pre-Flight Policy Compliance": "Scanning",
  "Full-Funnel Allocator": "Optimizing",
  "Account Health & Anomaly Detection": "Monitoring",
  "Auto-ETL Warehouse": "Syncing",
  "AI Command Center": "Ready",
  "Trifurcated Router": "Running",
  "Unified Billing & Pacing": "Tracking",
};

const KNOWN_PLATFORMS: ReadonlySet<string> = new Set(["google_ads", "shopify", "meta", "hubspot", "salesforce"]);

const GROUP_ORDER = ["Google Advanced Suite", "Core Engines", "Advanced Tools"];

const GROUP_META: Record<string, { accent: string; iconBg: string; dotColor: string }> = {
  "Google Advanced Suite": { accent: "text-[#4285F4]", iconBg: "bg-[#4285F4]/10", dotColor: "bg-[#4285F4]" },
  "Core Engines": { accent: "text-primary-container", iconBg: "bg-primary-container/10", dotColor: "bg-primary-container" },
  "Advanced Tools": { accent: "text-amber-600", iconBg: "bg-amber-50", dotColor: "bg-amber-500" },
};

export default function CapabilitiesHub() {
  const [, navigate] = useLocation();
  const [gtgModalOpen, setGtgModalOpen] = useState(false);
  const [gtgConfigured, setGtgConfigured] = useState(() => !!localStorage.getItem("omni_gtg_config"));
  const [gtgConfig, setGtgConfig] = useState(() => {
    const saved = localStorage.getItem("omni_gtg_config");
    return saved ? JSON.parse(saved) : null;
  });
  const { activeWorkspace } = useWorkspace();

  const resolvedGoal = useMemo(() => {
    const raw = activeWorkspace?.primaryGoal;
    if (raw === "leadgen" || raw === "hybrid") return raw;
    return "ecom";
  }, [activeWorkspace?.primaryGoal]);

  const { data: connections, isLoading } = useListConnections();

  const activePlatforms = useMemo(() => {
    const set = new Set<PlatformKey>();
    if (!connections) return set;
    for (const c of connections) {
      const p = c.platform as string;
      if (c.isActive && p && KNOWN_PLATFORMS.has(p)) {
        set.add(p as PlatformKey);
      }
    }
    return set;
  }, [connections, resolvedGoal]);

  const engines = useMemo(() => {
    return ENGINE_DEFS.map((def) => {
      let active = false;
      if (def.alwaysActive) {
        active = true;
      } else if (def.requires.length === 0) {
        active = true;
      } else if (def.requireMode === "any") {
        active = def.requires.some((p) => activePlatforms.has(p));
      } else {
        active = def.requires.every((p) => activePlatforms.has(p));
      }

      const connectedCount = def.requires.filter((p) => activePlatforms.has(p)).length;

      return {
        ...def,
        active,
        statusLabel: active ? STATUS_LABELS[def.name] : undefined,
        connectedCount,
        totalRequired: def.requires.length,
      };
    });
  }, [activePlatforms]);

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    engines: engines.filter((e) => e.group === group),
  }));

  const activeCount = engines.filter((e) => e.active).length;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8 sm:py-12">
      <div className="mb-10">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary-container mb-2">Platform Intelligence</p>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-on-surface">Capabilities & Engines</h1>
        <p className="text-sm text-on-surface-variant mt-2 max-w-lg leading-relaxed">
          Every engine powering OmniAnalytix — from the Google Advanced Suite to real-time
          triage and data orchestration. Connect platforms to activate more engines.
        </p>
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant bg-surface-container-low px-3 py-1.5 rounded-full">
            {isLoading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <>
                <span className="text-emerald-600 font-bold">{activeCount}</span>
                <span>/</span>
                <span>{engines.length}</span>
              </>
            )}
            <span>engines active</span>
          </span>
          {!isLoading && activePlatforms.size > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-full">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              {activePlatforms.size} {activePlatforms.size === 1 ? "platform" : "platforms"} connected
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
        {[
          { metric: "73%", label: "Less manual reporting", icon: "schedule", bg: "bg-blue-50", accent: "text-[#2563EB]" },
          { metric: "<60s", label: "Anomaly detection", icon: "emergency", bg: "bg-rose-50", accent: "text-rose-600" },
          { metric: "$18K", label: "Avg. margin saved/mo", icon: "savings", bg: "bg-emerald-50", accent: "text-emerald-600" },
          { metric: "47+", label: "Unified platforms", icon: "hub", bg: "bg-violet-50", accent: "text-violet-600" },
        ].map((stat) => (
          <div key={stat.label} className={cn("rounded-2xl p-4 border ghost-border flex flex-col items-center text-center", stat.bg)}>
            <span className={cn("material-symbols-outlined text-lg mb-1", stat.accent)}>{stat.icon}</span>
            <p className={cn("text-xl font-extrabold tracking-tighter", stat.accent)}>{stat.metric}</p>
            <p className="text-[10px] font-medium text-on-surface-variant mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      {grouped.map(({ group, engines: groupEngines }) => {
        const meta = GROUP_META[group];
        const groupActive = groupEngines.filter((e) => e.active).length;
        return (
          <div key={group} className="mb-10">
            <div className="flex items-center gap-2 mb-4">
              <div className={cn("w-2 h-2 rounded-full", meta.dotColor)} />
              <h2 className={cn("text-xs font-bold uppercase tracking-[0.15em]", meta.accent)}>{group}</h2>
              <span className="text-[10px] text-on-surface-variant font-medium ml-1">
                {groupActive}/{groupEngines.length} active
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {groupEngines.map((engine) => {
                const isGtg = engine.name === "GTG Integrity Monitor";
                return (
                <div
                  key={engine.name}
                  className={cn(
                    "rounded-2xl border shadow-sm hover:shadow-md transition-shadow p-5 sm:p-6 flex flex-col",
                    engine.active
                      ? "bg-white border-outline-variant/15"
                      : "bg-surface-container-lowest border-outline-variant/10 opacity-80"
                  )}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className={cn(
                      "w-10 h-10 rounded-2xl flex items-center justify-center",
                      engine.active ? meta.iconBg : "bg-surface-container-low"
                    )}>
                      <span className={cn(
                        "material-symbols-outlined text-lg",
                        engine.active ? meta.accent : "text-on-surface-variant/60"
                      )} style={{ fontVariationSettings: "'FILL' 1" }}>
                        {engine.icon}
                      </span>
                    </div>
                    {engine.active ? (
                      <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full text-[10px] font-bold">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                        </span>
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 bg-surface-container-low text-on-surface-variant px-2.5 py-1 rounded-full text-[10px] font-bold">
                        <span className="w-2 h-2 rounded-full bg-outline-variant" />
                        Inactive
                      </span>
                    )}
                  </div>

                  <h3 className={cn("text-sm font-bold mb-1.5", engine.active ? "text-on-surface" : "text-on-surface-variant")}>{engine.name}</h3>
                  <p className="text-[12px] text-on-surface-variant leading-relaxed mb-2">{engine.description}</p>

                  {engine.valueMetric && (
                    <div className={cn(
                      "text-[10px] font-semibold px-2.5 py-1.5 rounded-xl mb-2 flex items-center gap-1.5",
                      engine.active
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                        : "bg-surface-container-low text-on-surface-variant/70"
                    )}>
                      <span className="material-symbols-outlined text-[12px]">trending_up</span>
                      {engine.valueMetric}
                    </div>
                  )}

                  {engine.capabilities && engine.capabilities.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {engine.capabilities.map((cap) => (
                        <span key={cap} className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-surface-container-low text-on-surface-variant">
                          {cap}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex-1" />

                  {!engine.active && engine.requires.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {engine.requires.map((p) => (
                        <span key={p} className={cn(
                          "text-[9px] font-mono px-2 py-0.5 rounded-full",
                          activePlatforms.has(p)
                            ? "bg-emerald-50 text-emerald-600"
                            : "bg-surface-container-low text-on-surface-variant"
                        )}>
                          {activePlatforms.has(p) ? "\u2713" : "\u00D7"} {p.replace("_", " ")}
                        </span>
                      ))}
                    </div>
                  )}

                  {isGtg && gtgConfigured && gtgConfig && engine.active && (
                    <div className="mt-3 p-3 bg-emerald-50 rounded-2xl border border-emerald-100 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                        </span>
                        <span className="text-[10px] font-bold text-emerald-700 uppercase">Active — Monitoring</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-1">
                        <div className="text-[10px] text-emerald-600">
                          <span className="font-semibold">Status:</span> Monitoring
                        </div>
                      </div>
                      <p className="text-[10px] text-emerald-600 font-mono truncate">{gtgConfig.trackingDomain}</p>
                    </div>
                  )}

                  <div className="mt-4 pt-3 border-t ghost-border">
                    {engine.active ? (
                      <div className="flex items-center justify-between">
                        {engine.name === "SA360 Inventory-Aware Templating" ? (
                          <>
                            <span className="text-[10px] font-semibold text-emerald-600">
                              {engine.statusLabel || "Running"}
                            </span>
                            <button
                              onClick={() => {
                                sessionStorage.setItem("omni_prefill_prompt", "Run the SA360 Inventory-Aware diagnostic sweep. Sync feed templates with live inventory, identify out-of-stock SKUs with active ads, and auto-generate templates for new products.");
                                navigate("/");
                              }}
                              className="text-[10px] font-bold text-primary-container hover:text-[#1e3a5f] transition-colors flex items-center gap-1"
                            >
                              <span className="material-symbols-outlined text-[12px]">biotech</span>
                              Run Diagnostic
                            </button>
                          </>
                        ) : isGtg ? (
                          <>
                            <span className="text-[10px] font-semibold text-emerald-600">
                              {engine.statusLabel || "Running"}
                            </span>
                            <button
                              onClick={() => setGtgModalOpen(true)}
                              className="text-[10px] font-bold text-primary-container hover:text-[#1e3a5f] transition-colors flex items-center gap-1"
                            >
                              <span className="material-symbols-outlined text-[12px]">settings</span>
                              Configure
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="text-[10px] font-semibold text-emerald-600">
                              {engine.statusLabel || "Running"}
                            </span>
                            <span className="text-[10px] text-on-surface-variant">Autonomous</span>
                          </>
                        )}
                      </div>
                    ) : (
                      <Link href={
                        engine.name === "Unified Billing & Pacing" ? "/billing-hub"
                        : "/connections"
                      }>
                        <button className="w-full bg-primary-container/10 text-primary-container text-[11px] font-semibold py-2 rounded-2xl hover:bg-primary-container/20 active:scale-[0.98] transition-all flex items-center justify-center gap-1.5">
                          <span className="material-symbols-outlined text-[14px]">cable</span>
                          {engine.name === "Unified Billing & Pacing" ? "Configure" : "Connect Platform"}
                        </button>
                      </Link>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <GtgConfigModal
        open={gtgModalOpen}
        onClose={() => setGtgModalOpen(false)}
        onSave={(config) => {
          setGtgConfig(config);
          setGtgConfigured(true);
        }}
      />
    </div>
  );
}
