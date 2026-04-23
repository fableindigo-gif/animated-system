import { useEffect, useState, useCallback, type ReactNode } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { formatUsdInDisplay } from "@/lib/fx-format";
import { appendFxAuditToCsv } from "@/lib/fx-audit-csv";
import { MoneyTile } from "@/components/ui/money-tile";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useFx } from "@/contexts/fx-context";
import { useCurrency } from "@/contexts/currency-context";

const BASE_URL = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE_URL.endsWith("/") ? BASE_URL.slice(0, -1) : BASE_URL;

// ─── Types ────────────────────────────────────────────────────────────────────

interface KPIs {
  totalSpend:          number;
  ecomAdSpend:         number;
  leadAdSpend:         number;
  totalRevenue:        number;
  grossProfit:         number;
  blendedPoas:         number;
  marginPct:           number;
  totalLeads:          number;
  blendedCpl:          number;
  totalDeals:          number;
  totalPipelineRevenue: number;
}

interface Targets {
  roasGoal:     number;
  marginTarget: number;
  cplCap:       number;
  actualPoas:   number;
  actualMargin: number;
  actualCpl:    number;
}

interface Channel {
  channel:     string;
  type:        string;
  spend:       number;
  clicks:      number;
  conversions: number;
  revenue:     number;
  leads:       number;
  deals:       number;
  poas:        number | null;
  cpl:         number | null;
  roas:        number | null;
}

interface Log {
  id:        number;
  type:      string;
  message:   string;
  createdAt: string;
}

interface DashboardData {
  kpis:      KPIs;
  targets:   Targets;
  channels:  Channel[];
  anomalies: string[];
  logs:      Log[];
}

// ─── Palette ──────────────────────────────────────────────────────────────────

const BG     = "#090d18";
const SURF   = "rgba(255,255,255,0.04)";
const BORDER = "rgba(255,255,255,0.08)";
const TEXT   = "#f1f5f9";
const MUTED  = "#64748b";
const ECOM   = "#38bdf8";  // sky blue for e-commerce
const LEAD   = "#a78bfa";  // purple for lead gen
const GREEN  = "#4ade80";
const AMBER  = "#fbbf24";
const RED    = "#f87171";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt    = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
// Renders a USD warehouse value in the user's preferred display currency
// (uses the active FX rate published by FxProvider via fx-runtime).
const fmtUSD = (n: number) => formatUsdInDisplay(n, { decimals: 0 });
const fmtMoney2 = (n: number) => formatUsdInDisplay(n, { decimals: 2 });
const fmtPct = (n: number) => fmt(n, 1) + "%";
const fmtX   = (n: number) => fmt(n, 2) + "x";

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 5, background: "rgba(255,255,255,0.07)", borderRadius: 99, margin: "5px 0" }}>
      <div style={{ height: 5, width: `${Math.min(100, pct)}%`, background: color, borderRadius: 99, transition: "width 0.5s ease" }} />
    </div>
  );
}

function progressColor(pct: number) { return pct >= 90 ? GREEN : pct >= 60 ? AMBER : RED; }

// ─── Command Palette ──────────────────────────────────────────────────────────

const COMMANDS = [
  { label: "Master Diagnostic Sweep", icon: "manage_search",   desc: "Audit all ecom + lead gen channels" },
  { label: "POAS Analysis",           icon: "query_stats",     desc: "Recalculate blended POAS 30-day" },
  { label: "CPL Cap Review",          icon: "price_check",     desc: "Flag channels exceeding CPL cap" },
  { label: "Out-of-Stock Audit",      icon: "inventory_2",     desc: "Find SKUs with active spend, zero inventory" },
  { label: "Margin Deep Dive",        icon: "pie_chart",       desc: "Gross margin by product category" },
  { label: "Pipeline Report",         icon: "funnel",          desc: "Full revenue + deal pipeline overview" },
  { label: "B2B Qualification Check", icon: "verified_user",   desc: "MQL → SQL conversion analysis" },
  { label: "Budget Rebalance",        icon: "balance",         desc: "Optimal ecom / lead gen budget split" },
];

function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const filtered = COMMANDS.filter(c => c.label.toLowerCase().includes(q.toLowerCase()) || c.desc.toLowerCase().includes(q.toLowerCase()));

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "flex-start", justifyContent: "center",
      paddingTop: 80, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: 560, background: "#13192b", borderRadius: 14, border: "1px solid rgba(255,255,255,0.12)",
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: MUTED }}>search</span>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search diagnostic commands…"
            style={{ flex: 1, background: "none", border: "none", outline: "none", color: TEXT, fontSize: 15 }} />
          <span style={{ fontSize: 11, color: MUTED, padding: "2px 6px", border: `1px solid ${BORDER}`, borderRadius: 4 }}>ESC</span>
        </div>
        <div style={{ maxHeight: 380, overflowY: "auto" }}>
          {filtered.length === 0 && (
            <div style={{ padding: "24px", textAlign: "center", color: MUTED, fontSize: 13 }}>No commands found</div>
          )}
          {filtered.map((cmd, i) => (
            <div key={i} onClick={onClose}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", cursor: "pointer",
                borderBottom: "1px solid rgba(255,255,255,0.04)" }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
              onMouseLeave={e => (e.currentTarget.style.background = "")}>
              <div style={{ width: 34, height: 34, borderRadius: 8, background: "rgba(99,102,241,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 17, color: LEAD }}>{cmd.icon}</span>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: TEXT }}>{cmd.label}</div>
                <div style={{ fontSize: 12, color: MUTED }}>{cmd.desc}</div>
              </div>
              <span className="material-symbols-outlined" style={{ fontSize: 15, color: MUTED, marginLeft: "auto" }}>arrow_forward</span>
            </div>
          ))}
        </div>
        <div style={{ padding: "8px 16px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", gap: 16, fontSize: 11, color: MUTED }}>
          <span>↑↓ Navigate</span><span>↵ Run</span><span>ESC Close</span>
        </div>
      </div>
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, accent = TEXT, tag }: {
  label: string; value: ReactNode; sub?: ReactNode; accent?: string; tag?: { label: string; color: string };
}) {
  return (
    <div style={{ background: SURF, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "18px 20px", flex: 1, minWidth: 150 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.09em" }}>{label}</div>
        {tag && <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 99, background: `${tag.color}22`, color: tag.color, border: `1px solid ${tag.color}44` }}>{tag.label}</span>}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: accent, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: MUTED, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

// ─── Target Row ───────────────────────────────────────────────────────────────

function TargetRow({ label, actual, target, formatVal, invert = false, color }: {
  label: string; actual: number; target: number; formatVal: (n: number) => ReactNode; invert?: boolean; color: string;
}) {
  const rawPct = target > 0 ? (actual / target) * 100 : 0;
  const barPct = invert ? Math.max(0, 100 - Math.max(0, rawPct - 100)) : Math.min(100, rawPct);
  const col    = invert ? progressColor(barPct) : progressColor(rawPct);
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
        <span style={{ color: "#cbd5e1", fontWeight: 500, display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "inline-block" }} />
          {label}
        </span>
        <span style={{ color: TEXT, fontWeight: 600 }}>{formatVal(actual)} <span style={{ color: MUTED }}>/ {formatVal(target)}</span></span>
      </div>
      <Bar pct={barPct} color={col} />
    </div>
  );
}

// ─── Channel Badge ────────────────────────────────────────────────────────────

function ChannelBadge({ ch, type }: { ch: string; type: string }) {
  const isEcom = type === "ecom";
  const color  = isEcom ? ECOM : LEAD;
  const map: Record<string, string> = {
    "Google Shopping": "shopping_bag", "Google Search": "search", "Google Search B2B": "business",
    "Meta": "groups", "Meta B2B": "business_center", "LinkedIn": "work",
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px", borderRadius: 99, fontSize: 12,
      fontWeight: 600, background: `${color}18`, color, border: `1px solid ${color}33` }}>
      <span className="material-symbols-outlined" style={{ fontSize: 13 }}>{map[ch] ?? "ads_click"}</span>
      {ch}
    </span>
  );
}

// ─── FX Row Audit ─────────────────────────────────────────────────────────────
//
// One info icon per channel row. On hover it reveals the underlying USD amounts,
// the rate applied, the rate date, and the rate source — giving full FX
// provenance without placing a tooltip on every money cell (which would create
// a hover-trap on a dense table).

function FxRowAudit({
  spendUsd,
  moneyUsd,
  moneyLabel,
  cplUsd,
}: {
  spendUsd:   number;
  moneyUsd:   number;
  moneyLabel: string;
  cplUsd?:    number;
}) {
  const { rate, rateDate, source, loading } = useFx();
  const { currencyCode, formatUsd } = useCurrency();

  if (currencyCode.toUpperCase() === "USD") return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label="FX audit details for this row"
          style={{
            background: "none", border: "none", cursor: "help",
            padding: "2px 4px", color: MUTED, opacity: 0.55,
            display: "inline-flex", alignItems: "center",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 13 }}>info</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="text-xs" style={{ maxWidth: 230 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{
            fontWeight: 700, fontSize: 10, textTransform: "uppercase",
            letterSpacing: "0.08em", opacity: 0.55,
            paddingBottom: 4, borderBottom: "1px solid rgba(255,255,255,0.12)",
            marginBottom: 2,
          }}>
            FX Audit
          </div>
          <div>Spend: <span style={{ fontWeight: 600 }}>{formatUsd(spendUsd, { decimals: 0 })}</span></div>
          {cplUsd != null && (
            <div>CPL: <span style={{ fontWeight: 600 }}>{formatUsd(cplUsd, { decimals: 2 })}</span></div>
          )}
          <div>{moneyLabel}: <span style={{ fontWeight: 600 }}>{formatUsd(moneyUsd, { decimals: 0 })}</span></div>
          <div style={{
            opacity: 0.65, marginTop: 4, paddingTop: 4,
            borderTop: "1px solid rgba(255,255,255,0.12)",
          }}>
            1 USD = {rate.toFixed(4)} {currencyCode} · {rateDate}
          </div>
          <div style={{ opacity: 0.5, textTransform: "capitalize" }}>
            {loading ? "Loading rate…" : `Source: ${source}`}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

type ActiveTab = "all" | "ecom" | "leadgen";

export default function HybridDashboard() {
  const [data,        setData]        = useState<DashboardData | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [seeding,     setSeeding]     = useState(false);
  const [gSyncing,    setGSyncing]    = useState(false);
  const [gSyncMsg,    setGSyncMsg]    = useState<string | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [tab,         setTab]         = useState<ActiveTab>("all");
  const [palOpen,     setPalOpen]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await authFetch(`${API_BASE}/api/hybrid/dashboard`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json() as DashboardData);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setPalOpen(p => !p); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const seed = async () => {
    setSeeding(true);
    try {
      const r = await authFetch(`${API_BASE}/api/hybrid/seed`, { method: "POST" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await load();
    } catch (e) { setError(String(e)); }
    finally { setSeeding(false); }
  };

  const syncGoogleAds = async () => {
    setGSyncing(true);
    setGSyncMsg(null);
    try {
      const r = await authFetch(`${API_BASE}/api/google-ads/sync`, { method: "POST" });
      const json = await r.json() as { success?: boolean; rows?: number; days?: number; spend?: number; error?: string };
      if (!r.ok) throw new Error(json.error ?? `HTTP ${r.status}`);
      setGSyncMsg(`Synced ${json.rows} rows · ${json.days} days · ${fmtUSD(json.spend ?? 0)} spend`);
      await load();
    } catch (e) { setError(`Google Ads sync failed: ${String(e)}`); }
    finally { setGSyncing(false); }
  };

  const hasData = data && (data.kpis.totalSpend > 0 || data.kpis.totalLeads > 0);
  const displayChannels = (data?.channels ?? []).filter(c =>
    tab === "all" ? true : tab === "ecom" ? c.type === "ecom" : c.type === "leadgen"
  );

  function downloadChannelCsv() {
    const csvCell = (v: string | number) => {
      const s = String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = [
      "Channel", "Type",
      "Spend (USD)", "Clicks", "Conversions/Leads",
      "POAS/CPL (USD)", "Revenue/Deals (USD)",
    ];
    const rows = displayChannels.map(ch => [
      csvCell(ch.channel),
      csvCell(ch.type === "ecom" ? "DTC" : "B2B"),
      csvCell(ch.spend.toFixed(2)),
      csvCell(ch.clicks),
      csvCell(ch.type === "ecom" ? ch.conversions : ch.leads),
      csvCell(ch.type === "ecom"
        ? (ch.poas != null ? ch.poas.toFixed(4) : "")
        : (ch.cpl  != null ? ch.cpl.toFixed(2)  : "")),
      csvCell(ch.type === "ecom" ? ch.revenue.toFixed(2) : ch.deals.toFixed(2)),
    ].join(","));
    const csv = appendFxAuditToCsv([headers.join(","), ...rows].join("\n"));
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = "hybrid-channels.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ minHeight: "100vh", background: BG, color: TEXT, fontFamily: "system-ui, sans-serif" }}>
      {palOpen && <CommandPalette onClose={() => setPalOpen(false)} />}

      <div style={{ maxWidth: 1440, margin: "0 auto", padding: "24px 24px 60px" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 22, color: AMBER }}>hub</span>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: TEXT, margin: 0 }}>Hybrid Command Center</h1>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                padding: "2px 8px", borderRadius: 4, background: `${AMBER}22`, color: AMBER, border: `1px solid ${AMBER}44` }}>Hybrid</span>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: MUTED }}>Shopify DTC + B2B Lead Gen — unified pipeline intelligence</p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button onClick={() => setPalOpen(true)} style={{ display: "flex", alignItems: "center", gap: 6,
              padding: "8px 14px", borderRadius: 8, border: `1px solid ${BORDER}`, background: SURF, color: TEXT,
              fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 15, color: MUTED }}>search</span>
              Command Palette
              <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 4, border: `1px solid ${BORDER}`, color: MUTED }}>⌘K</span>
            </button>
            {gSyncMsg && (
              <span style={{ fontSize: 11, color: "#4ade80", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.25)", borderRadius: 6, padding: "4px 10px" }}>
                ✓ {gSyncMsg}
              </span>
            )}
            <button onClick={load} disabled={loading} style={{ display: "flex", alignItems: "center", gap: 6,
              padding: "8px 14px", borderRadius: 8, border: `1px solid ${BORDER}`, background: SURF, color: TEXT,
              fontSize: 13, cursor: "pointer" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 15, color: ECOM }}>refresh</span>
              Refresh
            </button>
            <button onClick={syncGoogleAds} disabled={gSyncing} title="Pull live campaign data from Google Ads API"
              style={{ display: "flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(66,133,244,0.4)",
                background: gSyncing ? "rgba(66,133,244,0.15)" : "rgba(66,133,244,0.1)", color: "#93c5fd",
                fontSize: 13, fontWeight: 500, cursor: gSyncing ? "not-allowed" : "pointer" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                {gSyncing ? "progress_activity" : "ads_click"}
              </span>
              {gSyncing ? "Syncing…" : "Sync Google Ads"}
            </button>
            <button onClick={seed} disabled={seeding} style={{ display: "flex", alignItems: "center", gap: 6,
              padding: "8px 16px", borderRadius: 8, border: "none",
              background: seeding ? "#783f04" : "#d97706", color: "#fff",
              fontSize: 13, fontWeight: 600, cursor: seeding ? "not-allowed" : "pointer" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 15 }}>{seeding ? "hourglass_empty" : "bolt"}</span>
              {seeding ? "Seeding…" : "Seed Hybrid Data"}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10,
            padding: "12px 16px", marginBottom: 18, color: "#fca5a5", fontSize: 13 }}>{error}</div>
        )}

        {/* ── Live Triage ── */}
        {hasData && (
          <div style={{ marginBottom: 20 }}>
            {data.anomalies.length === 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderRadius: 10,
                background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.25)" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 17, color: GREEN }}>check_circle</span>
                <span style={{ fontSize: 13, fontWeight: 500, color: GREEN }}>All channels healthy — no ecom or lead gen anomalies detected</span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: MUTED }}>Live Triage</span>
              </div>
            ) : (
              <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.28)", borderRadius: 10, padding: "12px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 17, color: AMBER }}>warning</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: AMBER }}>Live Triage — {data.anomalies.length} alert{data.anomalies.length > 1 ? "s" : ""}</span>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: MUTED }}>Live Triage</span>
                </div>
                {data.anomalies.map((a, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8,
                    padding: "5px 0", fontSize: 12, color: "#fde68a",
                    borderTop: i > 0 ? "1px solid rgba(245,158,11,0.12)" : "none" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 12, color: AMBER, flexShrink: 0 }}>circle</span>
                    {a}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {loading && !data && (
          <div style={{ textAlign: "center", padding: "60px 0", color: MUTED }}>
            <span className="material-symbols-outlined" style={{ fontSize: 36, display: "block", marginBottom: 12 }}>hourglass_empty</span>
            Loading dashboard…
          </div>
        )}

        {!loading && !hasData && (
          <div style={{ textAlign: "center", padding: "56px 24px", background: SURF, border: `1px solid ${BORDER}`, borderRadius: 16 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 40, color: AMBER, display: "block", marginBottom: 12 }}>hub</span>
            <p style={{ color: TEXT, fontWeight: 600, fontSize: 16, margin: "0 0 8px" }}>No data yet</p>
            <p style={{ color: MUTED, fontSize: 13, margin: "0 0 20px" }}>Seed 30 days of high-end furniture brand data — DTC ecom + B2B lead gen.</p>
            <button onClick={seed} disabled={seeding} style={{ padding: "10px 22px", borderRadius: 8, border: "none",
              background: "#d97706", color: "#fff", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
              {seeding ? "Seeding…" : "Seed Data Now"}
            </button>
          </div>
        )}

        {hasData && data && (
          <>
            {/* ── KPI Header ── */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
              <KpiCard label="Total Ad Spend"
                value={<MoneyTile usd={data.kpis.totalSpend} compact decimals={0} />}
                sub={<>Ecom <MoneyTile usd={data.kpis.ecomAdSpend} compact decimals={0} /> · Lead <MoneyTile usd={data.kpis.leadAdSpend} compact decimals={0} /></>}
                accent={AMBER} />
              <KpiCard label="Ecom Revenue"
                value={<MoneyTile usd={data.kpis.totalRevenue} compact decimals={0} />}
                sub={<>Gross profit <MoneyTile usd={data.kpis.grossProfit} compact decimals={0} /></>}
                accent={ECOM} tag={{ label: "DTC", color: ECOM }} />
              <KpiCard label="Blended POAS"          value={fmtX(data.kpis.blendedPoas)}
                sub={data.kpis.blendedPoas >= data.targets.roasGoal ? `Goal ${fmtX(data.targets.roasGoal)} ✓` : `Goal ${fmtX(data.targets.roasGoal)} ⚠`}
                accent={data.kpis.blendedPoas >= data.targets.roasGoal ? GREEN : RED} />
              <KpiCard label="Total Leads"           value={data.kpis.totalLeads.toLocaleString()}
                sub={<>Deal pipeline <MoneyTile usd={data.kpis.totalDeals} compact decimals={0} /></>}
                accent={LEAD} tag={{ label: "B2B", color: LEAD }} />
              <KpiCard label="Blended CPL"
                value={<MoneyTile usd={data.kpis.blendedCpl} decimals={2} />}
                sub={data.kpis.blendedCpl <= data.targets.cplCap
                  ? "Within cap ✓"
                  : <>Cap <MoneyTile usd={data.targets.cplCap} decimals={2} /> exceeded ⚠</>}
                accent={data.kpis.blendedCpl <= data.targets.cplCap ? GREEN : RED} />
            </div>

            {/* ── Pipeline Banner ── */}
            <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
              {([
                { label: "Ecom Revenue",      value: <MoneyTile usd={data.kpis.totalRevenue}        compact decimals={0} />, color: ECOM },
                { label: "B2B Deal Pipeline", value: <MoneyTile usd={data.kpis.totalDeals}          compact decimals={0} />, color: LEAD },
                { label: "Total Pipeline",    value: <MoneyTile usd={data.kpis.totalPipelineRevenue} compact decimals={0} />, color: AMBER },
                { label: "Gross Margin",      value: fmtPct(data.kpis.marginPct),                                              color: data.kpis.marginPct >= data.targets.marginTarget ? GREEN : RED },
              ] as { label: string; value: ReactNode; color: string }[]).map((s) => (
                <div key={s.label} style={{ flex: 1, background: SURF, border: `1px solid ${BORDER}`, borderRadius: 10,
                  padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: MUTED }}>{s.label}</span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: s.color }}>{s.value}</span>
                </div>
              ))}
            </div>

            {/* ── Two-column ── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, marginBottom: 16 }}>

              {/* ── Performance Grid ── */}
              <div style={{ background: SURF, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: "hidden" }}>
                <div style={{ padding: "13px 16px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 17, color: AMBER }}>grid_on</span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>Performance Grid</span>
                  <div style={{ display: "flex", alignItems: "center", marginLeft: "auto", gap: 8 }}>
                    <div style={{ display: "flex", background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: 3, gap: 2 }}>
                      {(["all", "ecom", "leadgen"] as ActiveTab[]).map(t => (
                        <button key={t} onClick={() => setTab(t)} style={{
                          padding: "4px 12px", borderRadius: 6, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer",
                          background: tab === t ? (t === "ecom" ? `${ECOM}22` : t === "leadgen" ? `${LEAD}22` : "rgba(255,255,255,0.1)") : "none",
                          color: tab === t ? (t === "ecom" ? ECOM : t === "leadgen" ? LEAD : TEXT) : MUTED,
                        }}>
                          {t === "all" ? "All" : t === "ecom" ? "Direct Sales" : "Lead Gen"}
                        </button>
                      ))}
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={downloadChannelCsv}
                          disabled={displayChannels.length === 0}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            padding: "4px 10px", borderRadius: 7, border: `1px solid ${BORDER}`,
                            background: SURF, color: MUTED, fontSize: 11, fontWeight: 600,
                            cursor: displayChannels.length === 0 ? "not-allowed" : "pointer",
                            opacity: displayChannels.length === 0 ? 0.4 : 1,
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 13 }}>download</span>
                          CSV
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs" style={{ maxWidth: 240 }}>
                        Download channel data as CSV. Includes FX audit metadata (rate, date, source) when display currency ≠ USD.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "rgba(255,255,255,0.025)" }}>
                        {["Channel", "Type", "Spend", "Clicks", "Conversions / Leads", "POAS / CPL", "Revenue / Deals"].map(h => (
                          <th key={h} style={{ padding: "9px 14px", textAlign: h === "Channel" || h === "Type" ? "left" : "right",
                            color: MUTED, fontWeight: 600, fontSize: 10, textTransform: "uppercase",
                            letterSpacing: "0.06em", borderBottom: `1px solid ${BORDER}` }}>{h}</th>
                        ))}
                        <th style={{ padding: "9px 14px", textAlign: "center", borderBottom: `1px solid ${BORDER}`, width: 36 }}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span style={{ cursor: "help", display: "inline-flex", alignItems: "center", gap: 3,
                                color: MUTED, fontWeight: 600, fontSize: 10, textTransform: "uppercase",
                                letterSpacing: "0.06em" }}>
                                <span className="material-symbols-outlined" style={{ fontSize: 12 }}>currency_exchange</span>
                                FX
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs" style={{ maxWidth: 220 }}>
                              Hover any row for its underlying USD values, FX rate, rate date, and rate source.
                              Hidden when display currency is USD.
                            </TooltipContent>
                          </Tooltip>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayChannels.map((ch, i) => (
                        <tr key={ch.channel} style={{ borderBottom: i < displayChannels.length - 1 ? `1px solid ${BORDER}` : "none" }}>
                          <td style={{ padding: "12px 14px" }}><ChannelBadge ch={ch.channel} type={ch.type} /></td>
                          <td style={{ padding: "12px 14px" }}>
                            <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
                              background: ch.type === "ecom" ? `${ECOM}18` : `${LEAD}18`,
                              color: ch.type === "ecom" ? ECOM : LEAD }}>
                              {ch.type === "ecom" ? "DTC" : "B2B"}
                            </span>
                          </td>
                          <td style={{ padding: "12px 14px", textAlign: "right", color: AMBER, fontWeight: 600 }}>{fmtUSD(ch.spend)}</td>
                          <td style={{ padding: "12px 14px", textAlign: "right", color: MUTED }}>{ch.clicks.toLocaleString()}</td>
                          <td style={{ padding: "12px 14px", textAlign: "right", color: TEXT, fontWeight: 500 }}>
                            {ch.type === "ecom" ? ch.conversions.toLocaleString() + " conv" : ch.leads.toLocaleString() + " leads"}
                          </td>
                          <td style={{ padding: "12px 14px", textAlign: "right", fontWeight: 700 }}>
                            {ch.type === "ecom" && ch.poas != null && (
                              <span style={{ color: ch.poas >= (data.targets.roasGoal) ? GREEN : RED }}>{fmtX(ch.poas)}</span>
                            )}
                            {ch.type === "leadgen" && ch.cpl != null && (
                              <span style={{ color: ch.cpl <= data.targets.cplCap ? GREEN : RED }}>{fmtMoney2(ch.cpl)}</span>
                            )}
                          </td>
                          <td style={{ padding: "12px 14px", textAlign: "right", fontWeight: 600,
                            color: ch.type === "ecom" ? ECOM : LEAD }}>
                            {ch.type === "ecom" ? fmtUSD(ch.revenue) : fmtUSD(ch.deals)}
                          </td>
                          <td style={{ padding: "12px 14px", textAlign: "center" }}>
                            <FxRowAudit
                              spendUsd={ch.spend}
                              moneyUsd={ch.type === "ecom" ? ch.revenue : ch.deals}
                              moneyLabel={ch.type === "ecom" ? "Revenue" : "Deals"}
                              cplUsd={ch.type === "leadgen" && ch.cpl != null ? ch.cpl : undefined}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {displayChannels.length === 0 && (
                    <div style={{ padding: "24px", textAlign: "center", color: MUTED, fontSize: 13 }}>No channels in this view.</div>
                  )}
                </div>
              </div>

              {/* ── Target Metrics Panel ── */}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

                {/* Ecom targets */}
                <div style={{ background: SURF, border: `1px solid ${ECOM}33`, borderRadius: 14, padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 14 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16, color: ECOM }}>shopping_bag</span>
                    <span style={{ fontWeight: 600, fontSize: 13, color: ECOM }}>E-Commerce Targets</span>
                  </div>
                  <TargetRow label="ROAS Goal"    actual={data.targets.actualPoas}   target={data.targets.roasGoal}      formatVal={fmtX}   color={ECOM} />
                  <TargetRow label="Margin Target" actual={data.targets.actualMargin} target={data.targets.marginTarget}  formatVal={fmtPct} color={ECOM} />
                </div>

                {/* Lead gen targets */}
                <div style={{ background: SURF, border: `1px solid ${LEAD}33`, borderRadius: 14, padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 14 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16, color: LEAD }}>funnel</span>
                    <span style={{ fontWeight: 600, fontSize: 13, color: LEAD }}>Lead Gen Targets</span>
                  </div>
                  <TargetRow
                    label="CPL Cap"
                    actual={data.targets.actualCpl}
                    target={data.targets.cplCap}
                    formatVal={(n) => <MoneyTile usd={n} decimals={2} />}
                    invert
                    color={LEAD}
                  />
                  <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: `1px solid ${BORDER}` }}>
                    {([
                      { label: "Total Leads",    value: data.kpis.totalLeads.toLocaleString() },
                      { label: "Deal Pipeline",  value: <MoneyTile usd={data.kpis.totalDeals} compact decimals={0} /> },
                      { label: "Blended CPL",    value: <MoneyTile usd={data.kpis.blendedCpl} decimals={2} /> },
                    ] as { label: string; value: ReactNode }[]).map(({ label, value }) => (
                      <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0",
                        borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 11 }}>
                        <span style={{ color: MUTED }}>{label}</span>
                        <span style={{ color: TEXT, fontWeight: 600 }}>{value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Pipeline summary */}
                <div style={{ background: SURF, border: `1px solid ${AMBER}33`, borderRadius: 14, padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16, color: AMBER }}>account_balance</span>
                    <span style={{ fontWeight: 600, fontSize: 13, color: AMBER }}>Holistic Pipeline</span>
                  </div>
                  {([
                    { label: "Ecom Revenue",    value: <MoneyTile usd={data.kpis.totalRevenue}         compact decimals={0} />, color: ECOM },
                    { label: "B2B Pipeline",    value: <MoneyTile usd={data.kpis.totalDeals}           compact decimals={0} />, color: LEAD },
                    { label: "Total",           value: <MoneyTile usd={data.kpis.totalPipelineRevenue} compact decimals={0} />, color: AMBER },
                    { label: "Total Ad Spend",  value: <MoneyTile usd={data.kpis.totalSpend}           compact decimals={0} />, color: MUTED },
                  ] as { label: string; value: ReactNode; color: string }[]).map(({ label, value, color }) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0",
                      borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 11 }}>
                      <span style={{ color: MUTED }}>{label}</span>
                      <span style={{ color, fontWeight: 700 }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Execution Logs ── */}
            <div style={{ background: SURF, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 8 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 17, color: GREEN }}>terminal</span>
                <span style={{ fontWeight: 600, fontSize: 14 }}>Execution Logs</span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: MUTED, background: "rgba(255,255,255,0.05)",
                  padding: "2px 8px", borderRadius: 99 }}>{data.logs.length} entries</span>
              </div>
              <div style={{ maxHeight: 280, overflowY: "auto", padding: "4px 0" }}>
                {data.logs.length === 0 && (
                  <div style={{ padding: "24px", textAlign: "center", color: MUTED, fontSize: 13 }}>No log entries yet.</div>
                )}
                {data.logs.map((log) => (
                  <div key={log.id} style={{ display: "flex", alignItems: "flex-start", gap: 12,
                    padding: "9px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 15, marginTop: 1, flexShrink: 0,
                      color: log.type === "Query" ? ECOM : LEAD }}>
                      {log.type === "Query" ? "search" : "send"}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: TEXT, marginBottom: 2 }}>{log.message}</div>
                      <div style={{ fontSize: 11, color: MUTED }}>
                        <span style={{ display: "inline-block", marginRight: 8, padding: "1px 6px", borderRadius: 4, fontSize: 10,
                          background: log.type === "Query" ? `${ECOM}18` : `${LEAD}18`,
                          color: log.type === "Query" ? ECOM : LEAD }}>{log.type}</span>
                        {new Date(log.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
