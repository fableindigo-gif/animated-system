/**
 * Platform Admin Dashboard
 * ─────────────────────────
 * Accessible only to users with role === "super_admin".
 * Displays global KPI metrics, the lead pipeline, and the tenant directory.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Building2, Users, LayoutDashboard, TrendingUp, DollarSign,
  RefreshCw, ChevronDown, CheckCircle, Archive, Mail, Globe,
  Calendar, Clock, BadgeCheck, Zap, ShieldCheck, Loader2, ExternalLink, AlertCircle,
  Settings, Save, RotateCcw, ChevronRight, Cpu,
} from "lucide-react";
import { authFetch } from "@/lib/auth-fetch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { MoneyTile } from "@/components/ui/money-tile";
import { ShoppingInsiderCostTrendCard } from "@/components/admin/ShoppingInsiderCostTrendCard";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────

interface Metrics {
  totalOrgs: number;
  totalActiveUsers: number;
  totalActiveWorkspaces: number;
  totalLeads: number;
  newLeads: number;
  syncsToday: number;
  estimatedMrrUsd: number;
  tierBreakdown: { tier: string; count: number }[];
}

interface Lead {
  id: number;
  source: string;
  email: string;
  name: string | null;
  website: string | null;
  company: string | null;
  revenueModel: string | null;
  attribution: string | null;
  scheduledDate: string | null;
  scheduledTime: string | null;
  status: string;
  notes: string | null;
  createdAt: string;
}

interface Tenant {
  id: number;
  name: string;
  slug: string;
  subscriptionTier: string;
  createdAt: string;
  activeMembers: number;
  workspaceCount: number;
  pendingInvites: number;
  health: "onboarded" | "active" | "new";
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

interface AlerterConfig {
  bytesThreshold: number | null;
  hitRateFloor: number | null;
  cooldownMs: number | null;
}

interface AlerterConfigResponse {
  ok: boolean;
  config: AlerterConfig;
  envDefaults: AlerterConfig;
  dbOverrides: AlerterConfig;
}

interface FeedgenSpendTenant {
  tenantId: string;
  promptTokens: number;
  candidatesTokens: number;
  usd: number;
}

interface FeedgenSpendMonth {
  month: string;
  label: string;
  totalUsd: number;
  tenants: FeedgenSpendTenant[];
}

interface FeedgenSpend {
  months: FeedgenSpendMonth[];
  pricing: { promptUsdPer1M: number; candidatesUsdPer1M: number; currency: string };
}

// ─── Status badge helpers ──────────────────────────────────────────────────────

const LEAD_STATUS_STYLES: Record<string, string> = {
  new: "bg-blue-50 text-blue-700 border border-blue-200",
  contacted: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  archived: "bg-slate-100 text-slate-500 border border-slate-200",
};

const TIER_STYLES: Record<string, string> = {
  free: "bg-slate-100 text-slate-600 border border-slate-200",
  starter: "bg-sky-50 text-sky-700 border border-sky-200",
  pro: "bg-violet-50 text-violet-700 border border-violet-200",
  enterprise: "bg-amber-50 text-amber-700 border border-amber-200",
};

const HEALTH_STYLES: Record<string, string> = {
  new: "bg-yellow-50 text-yellow-700",
  active: "bg-emerald-50 text-emerald-700",
  onboarded: "bg-blue-50 text-blue-700",
};

function StatusPill({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cn("text-[11px] font-semibold px-2.5 py-0.5 rounded-full uppercase tracking-wide", className)}>
      {label}
    </span>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon, label, value, sub, accent,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="relative bg-white rounded-2xl border border-slate-200 px-6 py-5 flex gap-4 items-start shadow-sm hover:shadow-md transition-shadow overflow-hidden">
      <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center shrink-0", accent ?? "bg-[#004ac6]/10")}>
        <Icon className={cn("w-5 h-5", accent ? "text-white" : "text-[#004ac6]")} />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-slate-900 tracking-tight leading-none">{value}</p>
        <p className="text-sm font-medium text-slate-600 mt-1 leading-tight">{label}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Lead Row Actions ──────────────────────────────────────────────────────────

function LeadActions({ lead, onUpdate }: { lead: Lead; onUpdate: (id: number, status: string) => void }) {
  const [open, setOpen] = useState(false);

  const setStatus = (status: string) => {
    onUpdate(lead.id, status);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 transition-colors"
      >
        Actions <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl shadow-xl border border-slate-200 z-10 overflow-hidden">
          {lead.status !== "contacted" && (
            <button
              onClick={() => setStatus("contacted")}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-emerald-700 hover:bg-emerald-50 transition-colors"
            >
              <CheckCircle className="w-4 h-4" /> Mark Contacted
            </button>
          )}
          {lead.status !== "new" && (
            <button
              onClick={() => setStatus("new")}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-blue-700 hover:bg-blue-50 transition-colors"
            >
              <Mail className="w-4 h-4" /> Mark New
            </button>
          )}
          {lead.status !== "archived" && (
            <button
              onClick={() => setStatus("archived")}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <Archive className="w-4 h-4" /> Archive
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function PlatformAdmin() {
  const { toast } = useToast();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [feedgenSpend, setFeedgenSpend] = useState<FeedgenSpend | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [leadFilter, setLeadFilter] = useState<"all" | "new" | "contacted" | "archived">("all");
  const [tenantSearch, setTenantSearch] = useState("");
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  // ── Alerter config state
  const [alerterConfig, setAlerterConfig] = useState<AlerterConfigResponse | null>(null);
  const [alerterDraft, setAlerterDraft] = useState<{
    bytesThreshold: string;
    hitRateFloor: string;
    cooldownMs: string;
  }>({ bytesThreshold: "", hitRateFloor: "", cooldownMs: "" });
  const [alerterSaving, setAlerterSaving] = useState(false);

  const fetchAlerterConfig = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/admin/shopping-insider-alerter-config`);
      if (res.ok) {
        const data: AlerterConfigResponse = await res.json();
        setAlerterConfig(data);
        setAlerterDraft({
          bytesThreshold: data.config.bytesThreshold != null ? String(data.config.bytesThreshold) : "",
          hitRateFloor: data.config.hitRateFloor != null ? String(data.config.hitRateFloor) : "",
          cooldownMs: data.config.cooldownMs != null ? String(data.config.cooldownMs) : "",
        });
      }
    } catch {
      // non-fatal
    }
  }, []);

  const saveAlerterConfig = useCallback(async () => {
    setAlerterSaving(true);
    try {
      const payload: Record<string, number | null> = {
        bytesThreshold: alerterDraft.bytesThreshold !== "" ? Number(alerterDraft.bytesThreshold) : null,
        hitRateFloor: alerterDraft.hitRateFloor !== "" ? Number(alerterDraft.hitRateFloor) : null,
        cooldownMs: alerterDraft.cooldownMs !== "" ? Number(alerterDraft.cooldownMs) : null,
      };
      const res = await authFetch(`${BASE}/api/admin/shopping-insider-alerter-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Save failed");
      const data: AlerterConfigResponse = await res.json();
      setAlerterConfig(data);
      toast({ title: "Alerter thresholds saved", description: "Changes take effect on the next alerter tick." });
    } catch {
      toast({ title: "Failed to save alerter config", variant: "destructive" });
    } finally {
      setAlerterSaving(false);
    }
  }, [alerterDraft, toast]);

  const resetAlerterDraft = useCallback(() => {
    if (!alerterConfig) return;
    setAlerterDraft({
      bytesThreshold: alerterConfig.config.bytesThreshold != null ? String(alerterConfig.config.bytesThreshold) : "",
      hitRateFloor: alerterConfig.config.hitRateFloor != null ? String(alerterConfig.config.hitRateFloor) : "",
      cooldownMs: alerterConfig.config.cooldownMs != null ? String(alerterConfig.config.cooldownMs) : "",
    });
  }, [alerterConfig]);

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [metricsRes, leadsRes, tenantsRes, feedgenRes] = await Promise.all([
        authFetch(`${BASE}/api/platform/metrics`),
        authFetch(`${BASE}/api/platform/leads`),
        authFetch(`${BASE}/api/platform/tenants`),
        authFetch(`${BASE}/api/platform/feedgen-spend`),
      ]);

      if (metricsRes.ok) setMetrics(await metricsRes.json());
      if (leadsRes.ok) setLeads(await leadsRes.json());
      if (tenantsRes.ok) setTenants(await tenantsRes.json());
      if (feedgenRes.ok) {
        const data: FeedgenSpend = await feedgenRes.json();
        setFeedgenSpend(data);
        if (data.months.length > 0) {
          setExpandedMonth((prev) => prev ?? data.months[0].month);
        }
      }

      if (!metricsRes.ok || !leadsRes.ok || !tenantsRes.ok) {
        toast({ title: "Partial load error", description: "Some platform data could not be fetched.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", description: "Could not reach the platform API.", variant: "destructive" });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchAll();
    fetchAlerterConfig();
  }, [fetchAll, fetchAlerterConfig]);

  const updateLeadStatus = useCallback(async (id: number, status: string) => {
    const prevLeads = [...leads];
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
    try {
      const res = await authFetch(`${BASE}/api/platform/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("API error");
      toast({ title: `Lead marked as ${status}` });
    } catch {
      setLeads(prevLeads);
      toast({ title: "Update failed", variant: "destructive" });
    }
  }, [leads, toast]);

  // ── Filtered data
  const filteredLeads = leads.filter((l) => leadFilter === "all" || l.status === leadFilter);
  const filteredTenants = tenants.filter((t) =>
    tenantSearch === "" ||
    t.name.toLowerCase().includes(tenantSearch.toLowerCase()) ||
    t.slug.toLowerCase().includes(tenantSearch.toLowerCase()),
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-[#004ac6]" />
          <p className="text-sm font-medium">Loading Platform Admin…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50 px-6 py-8 max-w-[1400px] mx-auto">

      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <ShieldCheck className="w-5 h-5 text-[#004ac6]" />
            <h1 className="text-2xl font-bold text-slate-900" style={{ fontFamily: "'Manrope', sans-serif" }}>
              Platform Admin
            </h1>
          </div>
          <p className="text-sm text-slate-500">Full visibility across all tenants, leads, and platform health.</p>
        </div>
        <button
          onClick={() => fetchAll(true)}
          disabled={refreshing}
          className="flex items-center gap-2 text-sm font-medium text-slate-600 border border-slate-200 bg-white rounded-xl px-4 py-2 hover:bg-slate-50 transition-colors disabled:opacity-60"
        >
          <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* ── KPI Grid ── */}
      {metrics && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <KpiCard
            icon={Building2}
            label="Total Agencies"
            value={metrics.totalOrgs}
            sub={`${metrics.tierBreakdown.find((t) => t.tier === "free")?.count ?? 0} on free tier`}
          />
          <KpiCard
            icon={Users}
            label="Active Users"
            value={metrics.totalActiveUsers}
          />
          <KpiCard
            icon={LayoutDashboard}
            label="Active Workspaces"
            value={metrics.totalActiveWorkspaces}
          />
          <KpiCard
            icon={DollarSign}
            label="Est. MRR"
            value={<MoneyTile usd={metrics.estimatedMrrUsd} decimals={0} />}
            sub="Based on subscription tiers"
            accent="bg-emerald-500"
          />
          <KpiCard
            icon={Mail}
            label="Total Leads"
            value={metrics.totalLeads}
            sub={`${metrics.newLeads} new`}
          />
          <KpiCard
            icon={Zap}
            label="API Syncs Today"
            value={metrics.syncsToday}
          />
          <KpiCard
            icon={TrendingUp}
            label="Paid Tenants"
            value={metrics.tierBreakdown.filter((t) => t.tier !== "free").reduce((s, t) => s + t.count, 0)}
          />
          <KpiCard
            icon={BadgeCheck}
            label="Enterprise Tenants"
            value={metrics.tierBreakdown.find((t) => t.tier === "enterprise")?.count ?? 0}
            accent="bg-amber-500"
          />
        </div>
      )}

      {/* ── Shopping Insider Cost Trend ── */}
      <div className="mb-8">
        <ShoppingInsiderCostTrendCard />
      </div>

      {/* ── FeedGen Monthly Spend ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm mb-8 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Cpu className="w-4 h-4 text-violet-600" />
            <div>
              <h2 className="text-base font-semibold text-slate-900" style={{ fontFamily: "'Manrope', sans-serif" }}>
                FeedGen Monthly Spend
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Estimated Vertex AI cost by calendar month — all tenants
                {feedgenSpend && (
                  <span className="ml-1 text-slate-400">
                    · ${feedgenSpend.pricing.promptUsdPer1M}/1M prompt · ${feedgenSpend.pricing.candidatesUsdPer1M}/1M output
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>

        {!feedgenSpend ? (
          <div className="flex items-center justify-center py-10 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm">Loading spend data…</span>
          </div>
        ) : feedgenSpend.months.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-slate-400">
            <Cpu className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-sm">No FeedGen runs recorded yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {feedgenSpend.months.map((m) => {
              const isCurrentMonth = m.month === new Date().toISOString().slice(0, 7);
              const isOpen = expandedMonth === m.month;
              return (
                <div key={m.month}>
                  <button
                    onClick={() => setExpandedMonth(isOpen ? null : m.month)}
                    className="w-full flex items-center justify-between px-6 py-3.5 hover:bg-slate-50/60 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <ChevronRight className={cn("w-4 h-4 text-slate-400 transition-transform", isOpen && "rotate-90")} />
                      <span className="text-sm font-semibold text-slate-800">{m.label}</span>
                      {isCurrentMonth && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200 uppercase tracking-wide">
                          MTD
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-6 text-right">
                      <span className="text-xs text-slate-500">{m.tenants.length} tenant{m.tenants.length !== 1 ? "s" : ""}</span>
                      <span className="text-sm font-bold text-slate-900 tabular-nums">
                        ${m.totalUsd.toFixed(4)}
                      </span>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-6 pb-4 pt-0">
                      <table className="w-full text-sm border border-slate-100 rounded-xl overflow-hidden">
                        <thead>
                          <tr className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                            <th className="px-4 py-2.5 text-left">Tenant</th>
                            <th className="px-4 py-2.5 text-right">Prompt tokens</th>
                            <th className="px-4 py-2.5 text-right">Output tokens</th>
                            <th className="px-4 py-2.5 text-right">Est. USD</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {m.tenants.map((t) => (
                            <tr key={t.tenantId} className="hover:bg-slate-50/60 transition-colors">
                              <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{t.tenantId}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-slate-600 text-xs">
                                {t.promptTokens.toLocaleString()}
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-slate-600 text-xs">
                                {t.candidatesTokens.toLocaleString()}
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900 text-xs">
                                ${t.usd.toFixed(4)}
                              </td>
                            </tr>
                          ))}
                          <tr className="bg-violet-50/40 font-semibold">
                            <td className="px-4 py-2.5 text-xs text-slate-700">Total</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-xs text-slate-700">
                              {m.tenants.reduce((s, t) => s + t.promptTokens, 0).toLocaleString()}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-xs text-slate-700">
                              {m.tenants.reduce((s, t) => s + t.candidatesTokens, 0).toLocaleString()}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-xs text-violet-700">
                              ${m.totalUsd.toFixed(4)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Lead Pipeline ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm mb-8 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900" style={{ fontFamily: "'Manrope', sans-serif" }}>
              Lead Pipeline
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">All Request Demo &amp; Enterprise Contact submissions</p>
          </div>
          <div className="flex items-center gap-1.5 rounded-xl bg-slate-100 p-1">
            {(["all", "new", "contacted", "archived"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setLeadFilter(f)}
                className={cn(
                  "px-3 py-1 text-xs font-semibold rounded-lg transition-colors",
                  leadFilter === f
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700",
                )}
              >
                {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                {f !== "all" && (
                  <span className="ml-1.5 tabular-nums text-[10px] opacity-70">
                    {leads.filter((l) => l.status === f).length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {filteredLeads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <AlertCircle className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm">No leads in this category yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="px-6 py-3 text-left">Contact</th>
                  <th className="px-6 py-3 text-left">Source</th>
                  <th className="px-6 py-3 text-left">Website / Model</th>
                  <th className="px-6 py-3 text-left">Scheduled</th>
                  <th className="px-6 py-3 text-left">Status</th>
                  <th className="px-6 py-3 text-left">Submitted</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredLeads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-slate-50/60 transition-colors group">
                    <td className="px-6 py-3.5">
                      <p className="font-medium text-slate-900 truncate max-w-[180px]">{lead.name ?? "—"}</p>
                      <a href={`mailto:${lead.email}`} className="text-xs text-[#004ac6] hover:underline">{lead.email}</a>
                      {lead.company && <p className="text-xs text-slate-400 mt-0.5">{lead.company}</p>}
                    </td>
                    <td className="px-6 py-3.5">
                      <StatusPill
                        label={lead.source}
                        className={lead.source === "enterprise" ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-blue-50 text-blue-700 border border-blue-200"}
                      />
                    </td>
                    <td className="px-6 py-3.5">
                      {lead.website ? (
                        <a
                          href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-xs text-[#004ac6] hover:underline truncate max-w-[140px]"
                        >
                          <Globe className="w-3 h-3 shrink-0" />
                          {lead.website}
                          <ExternalLink className="w-3 h-3 shrink-0 opacity-50" />
                        </a>
                      ) : <span className="text-slate-400 text-xs">—</span>}
                      {lead.revenueModel && (
                        <p className="text-xs text-slate-500 mt-0.5 capitalize">{lead.revenueModel}</p>
                      )}
                    </td>
                    <td className="px-6 py-3.5">
                      {lead.scheduledDate ? (
                        <div className="text-xs text-slate-700">
                          <div className="flex items-center gap-1"><Calendar className="w-3 h-3 text-slate-400" />{lead.scheduledDate}</div>
                          <div className="flex items-center gap-1 mt-0.5"><Clock className="w-3 h-3 text-slate-400" />{lead.scheduledTime}</div>
                        </div>
                      ) : <span className="text-slate-400 text-xs">Not scheduled</span>}
                    </td>
                    <td className="px-6 py-3.5">
                      <StatusPill label={lead.status} className={LEAD_STATUS_STYLES[lead.status] ?? ""} />
                    </td>
                    <td className="px-6 py-3.5 text-xs text-slate-500 whitespace-nowrap">
                      {new Date(lead.createdAt).toLocaleDateString("en-US", {
                        month: "short", day: "numeric", year: "numeric",
                      })}
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <LeadActions lead={lead} onUpdate={updateLeadStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── BigQuery Alerter Settings ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm mb-8 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Settings className="w-4 h-4 text-[#004ac6]" />
            <div>
              <h2 className="text-base font-semibold text-slate-900" style={{ fontFamily: "'Manrope', sans-serif" }}>
                BigQuery Spend Alerter
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Thresholds are applied on the next alerter tick — no server restart required.
              </p>
            </div>
          </div>
        </div>
        <div className="px-6 py-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Bytes Threshold */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
                Bytes-Billed Threshold
              </label>
              <input
                type="number"
                min={0}
                placeholder={
                  alerterConfig?.envDefaults.bytesThreshold != null
                    ? `Env default: ${alerterConfig.envDefaults.bytesThreshold}`
                    : "Unset (alerter disabled)"
                }
                value={alerterDraft.bytesThreshold}
                onChange={(e) =>
                  setAlerterDraft((d) => ({ ...d, bytesThreshold: e.target.value }))
                }
                className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#004ac6]/20 focus:border-[#004ac6]/40"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Fire when bytesBilled over the window exceeds this value. Leave blank to inherit env var.
              </p>
              {alerterConfig?.dbOverrides.bytesThreshold != null && (
                <p className="text-[11px] text-amber-600 mt-1">
                  DB override active: {alerterConfig.dbOverrides.bytesThreshold}
                </p>
              )}
            </div>

            {/* Hit-Rate Floor */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
                Cache Hit-Rate Floor
              </label>
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                placeholder={
                  alerterConfig?.envDefaults.hitRateFloor != null
                    ? `Env default: ${alerterConfig.envDefaults.hitRateFloor}`
                    : "Unset (alerter disabled)"
                }
                value={alerterDraft.hitRateFloor}
                onChange={(e) =>
                  setAlerterDraft((d) => ({ ...d, hitRateFloor: e.target.value }))
                }
                className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#004ac6]/20 focus:border-[#004ac6]/40"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Fraction 0–1. Fire when hit rate falls below this floor. Leave blank to inherit env var.
              </p>
              {alerterConfig?.dbOverrides.hitRateFloor != null && (
                <p className="text-[11px] text-amber-600 mt-1">
                  DB override active: {alerterConfig.dbOverrides.hitRateFloor}
                </p>
              )}
            </div>

            {/* Cooldown */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
                Alert Cooldown (ms)
              </label>
              <input
                type="number"
                min={0}
                placeholder={
                  alerterConfig?.envDefaults.cooldownMs != null
                    ? `Env default: ${alerterConfig.envDefaults.cooldownMs}`
                    : "Default: 3600000 (1 h)"
                }
                value={alerterDraft.cooldownMs}
                onChange={(e) =>
                  setAlerterDraft((d) => ({ ...d, cooldownMs: e.target.value }))
                }
                className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#004ac6]/20 focus:border-[#004ac6]/40"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Minimum gap between repeated alerts of the same type. Leave blank to inherit env var.
              </p>
              {alerterConfig?.dbOverrides.cooldownMs != null && (
                <p className="text-[11px] text-amber-600 mt-1">
                  DB override active: {alerterConfig.dbOverrides.cooldownMs}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 mt-5 pt-4 border-t border-slate-100">
            <button
              onClick={resetAlerterDraft}
              className="flex items-center gap-1.5 text-sm font-medium text-slate-500 border border-slate-200 rounded-xl px-4 py-2 hover:bg-slate-50 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
            <button
              onClick={saveAlerterConfig}
              disabled={alerterSaving}
              className="flex items-center gap-1.5 text-sm font-semibold text-white bg-[#004ac6] rounded-xl px-5 py-2 hover:bg-[#003da8] transition-colors disabled:opacity-60"
            >
              {alerterSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save thresholds
            </button>
          </div>
        </div>
      </div>

      {/* ── Tenant Directory ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900" style={{ fontFamily: "'Manrope', sans-serif" }}>
              Tenant Directory
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">{tenants.length} registered agencies</p>
          </div>
          <input
            type="text"
            placeholder="Search by name or slug…"
            value={tenantSearch}
            onChange={(e) => setTenantSearch(e.target.value)}
            className="text-sm border border-slate-200 rounded-xl px-3 py-2 w-56 focus:outline-none focus:ring-2 focus:ring-[#004ac6]/20 focus:border-[#004ac6]/40"
          />
        </div>

        {filteredTenants.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Building2 className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm">No tenants found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="px-6 py-3 text-left">Organization</th>
                  <th className="px-6 py-3 text-left">Tier</th>
                  <th className="px-6 py-3 text-left">Members</th>
                  <th className="px-6 py-3 text-left">Workspaces</th>
                  <th className="px-6 py-3 text-left">Health</th>
                  <th className="px-6 py-3 text-left">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredTenants.map((tenant) => (
                  <tr key={tenant.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-6 py-3.5">
                      <p className="font-semibold text-slate-900">{tenant.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5 font-mono">{tenant.slug}</p>
                    </td>
                    <td className="px-6 py-3.5">
                      <StatusPill
                        label={tenant.subscriptionTier}
                        className={TIER_STYLES[tenant.subscriptionTier] ?? "bg-slate-100 text-slate-600 border border-slate-200"}
                      />
                    </td>
                    <td className="px-6 py-3.5">
                      <span className="text-slate-900 font-medium">{tenant.activeMembers}</span>
                      {tenant.pendingInvites > 0 && (
                        <span className="ml-1.5 text-xs text-amber-600">+{tenant.pendingInvites} pending</span>
                      )}
                    </td>
                    <td className="px-6 py-3.5 text-slate-700">{tenant.workspaceCount}</td>
                    <td className="px-6 py-3.5">
                      <span className={cn("text-[11px] font-semibold px-2.5 py-0.5 rounded-full capitalize", HEALTH_STYLES[tenant.health])}>
                        {tenant.health}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-xs text-slate-500">
                      {new Date(tenant.createdAt).toLocaleDateString("en-US", {
                        month: "short", day: "numeric", year: "numeric",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
