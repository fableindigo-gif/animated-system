import { useEffect, useState, useCallback } from "react";
import { authFetch } from "@/lib/auth-fetch";

const BASE_URL = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE_URL.endsWith("/") ? BASE_URL.slice(0, -1) : BASE_URL;

// ─── Types ────────────────────────────────────────────────────────────────────

interface KPIs {
  totalSpend:      number;
  totalLeads:      number;
  blendedCpl:      number;
  totalPipeline:   number;
  pipelineRoi:     number;
  totalImpressions: number;
  totalClicks:     number;
  totalForms:      number;
}

interface Funnel {
  raw:       number;
  mql:       number;
  sql:       number;
  closedWon: number;
}

interface Channel {
  channel:   string;
  spend:     number;
  leads:     number;
  mqls:      number;
  sqls:      number;
  pipeline:  number;
  cpl:       number;
  mqlRate:   number;
  sqlRate:   number;
}

interface Targets {
  cplCap:            number;
  monthlyLeadTarget: number;
  pipelineRoiTarget: number;
  actualCpl:         number;
  actualLeads:       number;
  actualPipelineRoi: number;
}

interface Log {
  id:        number;
  type:      string;
  message:   string;
  createdAt: string;
}

interface DashboardData {
  kpis:      KPIs;
  funnel:    Funnel;
  channels:  Channel[];
  targets:   Targets;
  anomalies: string[];
  logs:      Log[];
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

import { formatUsdInDisplay } from "@/lib/fx-format";

function fmt(n: number, dec = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
const fmtUSD   = (n: number) => formatUsdInDisplay(n);
const fmtPct   = (n: number) => fmt(n, 1) + "%";
const fmtMult  = (n: number) => fmt(n, 2) + "x";

function progressColor(pct: number): string {
  return pct >= 90 ? "#22c55e" : pct >= 60 ? "#f59e0b" : "#ef4444";
}

// ─── Palette ──────────────────────────────────────────────────────────────────

const BG     = "#0a0e1a";
const SURF   = "rgba(255,255,255,0.04)";
const BORDER = "rgba(255,255,255,0.09)";
const TEXT   = "#f1f5f9";
const MUTED  = "#64748b";
const ACCENT = "#818cf8"; // indigo for leadgen

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color = TEXT }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: SURF, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "20px 22px", flex: 1, minWidth: 160 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 5, background: "rgba(255,255,255,0.07)", borderRadius: 99, margin: "6px 0" }}>
      <div style={{ height: 5, width: `${Math.min(100, pct)}%`, background: color, borderRadius: 99, transition: "width 0.5s ease" }} />
    </div>
  );
}

function TargetRow({ label, actual, target, formatVal, invert = false }: {
  label: string; actual: number; target: number;
  formatVal: (n: number) => string; invert?: boolean;
}) {
  const pct   = target > 0 ? Math.min(100, (actual / target) * 100) : 0;
  const effPct = invert ? Math.max(0, 100 - Math.max(0, pct - 100)) : pct;
  const color = invert ? progressColor(100 - Math.min(100, Math.max(0, pct - 100))) : progressColor(pct);
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
        <span style={{ color: "#cbd5e1", fontWeight: 500 }}>{label}</span>
        <span style={{ color: TEXT, fontWeight: 600 }}>{formatVal(actual)} <span style={{ color: MUTED }}>/ {formatVal(target)}</span></span>
      </div>
      <Bar pct={effPct} color={color} />
    </div>
  );
}

function FunnelStage({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div style={{ flex: 1, textAlign: "center", padding: "10px 8px", background: SURF, borderRadius: 10, border: `1px solid ${BORDER}` }}>
      <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{count.toLocaleString()}</div>
      {total > 0 && <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>{fmtPct(pct)} of leads</div>}
    </div>
  );
}

function ChannelIcon({ ch }: { ch: string }) {
  const isGoogle = ch === "Google";
  const isMeta   = ch === "Meta";
  const isHub    = ch === "HubSpot";
  const isSF     = ch === "Salesforce";
  const color    = isGoogle ? "#4285F4" : isMeta ? "#1877F2" : isHub ? "#FF7A59" : isSF ? "#00A1E0" : MUTED;
  const icon     = isGoogle ? "ads_click" : isMeta ? "group" : isHub ? "hub" : isSF ? "cloud" : "link";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px", borderRadius: 99,
      fontSize: 12, fontWeight: 600, background: `${color}22`, color, border: `1px solid ${color}44` }}>
      <span className="material-symbols-outlined" style={{ fontSize: 13 }}>{icon}</span>
      {ch}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function LeadgenDashboard() {
  const [data,     setData]    = useState<DashboardData | null>(null);
  const [loading,  setLoading] = useState(true);
  const [seeding,  setSeeding] = useState(false);
  const [gSyncing, setGSyncing] = useState(false);
  const [gSyncMsg, setGSyncMsg] = useState<string | null>(null);
  const [error,    setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await authFetch(`${API_BASE}/api/leadgen/dashboard`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json() as DashboardData);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const seed = async () => {
    setSeeding(true);
    try {
      const r = await authFetch(`${API_BASE}/api/leadgen/seed`, { method: "POST" });
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

  const hasData = data && data.kpis.totalLeads > 0;

  return (
    <div style={{ minHeight: "100dvh", background: BG, color: TEXT, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "26px 26px 56px" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 22, color: ACCENT }}>funnel</span>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: TEXT, margin: 0 }}>Lead Generation Command Center</h1>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                padding: "2px 8px", borderRadius: 4, background: `${ACCENT}22`, color: ACCENT }}>Laedgen</span>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: MUTED }}>Google Ads + Meta + HubSpot + Salesforce — unified lead pipeline intelligence</p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {gSyncMsg && (
              <span style={{ fontSize: 11, color: "#4ade80", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.25)", borderRadius: 6, padding: "4px 10px" }}>
                ✓ {gSyncMsg}
              </span>
            )}
            <button onClick={load} disabled={loading} style={{ display: "flex", alignItems: "center", gap: 6,
              padding: "8px 14px", borderRadius: 8, border: `1px solid ${BORDER}`, background: SURF, color: TEXT,
              fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 15, color: ACCENT }}>refresh</span>
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
              background: seeding ? "#312e81" : "#4f46e5", color: "#fff",
              fontSize: 13, fontWeight: 600, cursor: seeding ? "not-allowed" : "pointer" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 15 }}>{seeding ? "hourglass_empty" : "bolt"}</span>
              {seeding ? "Seeding…" : "Seed Laedgen Data"}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10,
            padding: "12px 16px", marginBottom: 18, color: "#fca5a5", fontSize: 13 }}>{error}</div>
        )}

        {/* ── Live Triage Banner ── */}
        {hasData && (
          <div style={{ marginBottom: 22 }}>
            {data.anomalies.length === 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderRadius: 10,
                background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18, color: "#4ade80" }}>check_circle</span>
                <span style={{ fontSize: 13, fontWeight: 500, color: "#4ade80" }}>All systems healthy — no pipeline anomalies detected</span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: MUTED }}>Live Triage</span>
              </div>
            ) : (
              <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 10, padding: "12px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18, color: "#fbbf24" }}>warning</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#fbbf24" }}>Live Triage — {data.anomalies.length} alert{data.anomalies.length > 1 ? "s" : ""} detected</span>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: MUTED }}>Live Triage</span>
                </div>
                {data.anomalies.map((a, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0",
                    fontSize: 12, color: "#fde68a", borderTop: i > 0 ? "1px solid rgba(245,158,11,0.15)" : "none" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 13, color: "#f59e0b" }}>circle</span>
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
            <span className="material-symbols-outlined" style={{ fontSize: 40, color: ACCENT, display: "block", marginBottom: 12 }}>funnel</span>
            <p style={{ color: TEXT, fontWeight: 600, fontSize: 16, margin: "0 0 8px" }}>No pipeline data yet</p>
            <p style={{ color: MUTED, fontSize: 13, margin: "0 0 20px" }}>Click "Seed Laedgen Data" to populate 30 days of B2B SaaS mock data.</p>
            <button onClick={seed} disabled={seeding} style={{ padding: "10px 22px", borderRadius: 8, border: "none",
              background: "#4f46e5", color: "#fff", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
              {seeding ? "Seeding…" : "Seed Now"}
            </button>
          </div>
        )}

        {hasData && data && (
          <>
            {/* ── KPI Header ── */}
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
              <KpiCard label="Total Ad Spend"   value={fmtUSD(data.kpis.totalSpend)}   sub="30-day window"                  color="#fbbf24" />
              <KpiCard label="Total Leads"      value={data.kpis.totalLeads.toLocaleString()} sub={`${data.kpis.totalForms} form submissions`} color="#60a5fa" />
              <KpiCard label="Blended CPL"      value={"$" + fmt(data.kpis.blendedCpl, 2)}
                sub={data.kpis.blendedCpl <= data.targets.cplCap ? "Within cap ✓" : "Exceeds $" + data.targets.cplCap + " cap ⚠"}
                color={data.kpis.blendedCpl <= data.targets.cplCap ? "#4ade80" : "#f87171"} />
              <KpiCard label="Pipeline Value"  value={fmtUSD(data.kpis.totalPipeline)} sub={`${fmtMult(data.kpis.pipelineRoi)} pipeline ROI`} color="#a78bfa" />
            </div>

            {/* ── Funnel Strip ── */}
            <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
              <FunnelStage label="Raw Leads" count={data.funnel.raw}       total={data.kpis.totalLeads} color="#60a5fa" />
              <div style={{ display: "flex", alignItems: "center", color: MUTED, fontSize: 18 }}>›</div>
              <FunnelStage label="MQLs"      count={data.funnel.mql}       total={data.kpis.totalLeads} color="#a78bfa" />
              <div style={{ display: "flex", alignItems: "center", color: MUTED, fontSize: 18 }}>›</div>
              <FunnelStage label="SQLs"      count={data.funnel.sql}       total={data.kpis.totalLeads} color="#fbbf24" />
              <div style={{ display: "flex", alignItems: "center", color: MUTED, fontSize: 18 }}>›</div>
              <FunnelStage label="Closed Won" count={data.funnel.closedWon} total={data.kpis.totalLeads} color="#4ade80" />
            </div>

            {/* ── Two-column layout ── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 18, marginBottom: 18 }}>

              {/* ── Lead Quality Grid ── */}
              <div style={{ background: SURF, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: "hidden" }}>
                <div style={{ padding: "14px 18px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 17, color: ACCENT }}>grid_on</span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>Lead Quality Grid — by Source</span>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                        {["Source", "Spend", "Leads", "MQLs", "MQL Rate", "SQLs", "SQL Rate", "CPL", "Pipeline"].map(h => (
                          <th key={h} style={{ padding: "9px 14px", textAlign: h === "Source" ? "left" : "right",
                            color: MUTED, fontWeight: 600, fontSize: 10, textTransform: "uppercase",
                            letterSpacing: "0.06em", borderBottom: `1px solid ${BORDER}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.channels.map((ch, i) => (
                        <tr key={ch.channel} style={{ borderBottom: i < data.channels.length - 1 ? `1px solid ${BORDER}` : "none" }}>
                          <td style={{ padding: "12px 14px" }}><ChannelIcon ch={ch.channel} /></td>
                          <td style={{ padding: "12px 14px", textAlign: "right", color: "#fbbf24", fontWeight: 600 }}>{fmtUSD(ch.spend)}</td>
                          <td style={{ padding: "12px 14px", textAlign: "right", color: "#60a5fa", fontWeight: 600 }}>{ch.leads.toLocaleString()}</td>
                          <td style={{ padding: "12px 14px", textAlign: "right", color: TEXT }}>{ch.mqls.toLocaleString()}</td>
                          <td style={{ padding: "12px 14px", textAlign: "right", color: TEXT }}>{fmtPct(ch.mqlRate)}</td>
                          <td style={{ padding: "12px 14px", textAlign: "right", color: TEXT }}>{ch.sqls.toLocaleString()}</td>
                          <td style={{ padding: "12px 14px", textAlign: "right", color: TEXT }}>{fmtPct(ch.sqlRate)}</td>
                          <td style={{ padding: "12px 14px", textAlign: "right" }}>
                            <span style={{ color: ch.cpl <= data.targets.cplCap ? "#4ade80" : "#f87171", fontWeight: 700 }}>
                              ${fmt(ch.cpl, 2)}
                            </span>
                          </td>
                          <td style={{ padding: "12px 14px", textAlign: "right", color: "#a78bfa", fontWeight: 600 }}>{fmtUSD(ch.pipeline)}</td>
                        </tr>
                      ))}
                      {/* Totals */}
                      <tr style={{ background: "rgba(255,255,255,0.03)", borderTop: `1px solid ${BORDER}` }}>
                        <td style={{ padding: "11px 14px", fontWeight: 700, color: TEXT }}>Blended</td>
                        <td style={{ padding: "11px 14px", textAlign: "right", fontWeight: 700, color: "#fbbf24" }}>{fmtUSD(data.kpis.totalSpend)}</td>
                        <td style={{ padding: "11px 14px", textAlign: "right", fontWeight: 700, color: "#60a5fa" }}>{data.kpis.totalLeads.toLocaleString()}</td>
                        <td style={{ padding: "11px 14px", textAlign: "right", color: MUTED }}>{data.funnel.mql.toLocaleString()}</td>
                        <td style={{ padding: "11px 14px", textAlign: "right", color: MUTED }}>
                          {data.kpis.totalLeads > 0 ? fmtPct((data.funnel.mql / data.kpis.totalLeads) * 100) : "—"}
                        </td>
                        <td style={{ padding: "11px 14px", textAlign: "right", color: MUTED }}>{data.funnel.sql.toLocaleString()}</td>
                        <td style={{ padding: "11px 14px", textAlign: "right", color: MUTED }}>
                          {data.funnel.mql > 0 ? fmtPct((data.funnel.sql / data.funnel.mql) * 100) : "—"}
                        </td>
                        <td style={{ padding: "11px 14px", textAlign: "right", fontWeight: 700,
                          color: data.kpis.blendedCpl <= data.targets.cplCap ? "#4ade80" : "#f87171" }}>
                          ${fmt(data.kpis.blendedCpl, 2)}
                        </td>
                        <td style={{ padding: "11px 14px", textAlign: "right", fontWeight: 700, color: "#a78bfa" }}>{fmtUSD(data.kpis.totalPipeline)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── Target Metrics Panel ── */}
              <div style={{ background: SURF, border: `1px solid ${BORDER}`, borderRadius: 14, padding: "16px 18px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 17, color: "#c4b5fd" }}>flag</span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>Target Metrics</span>
                </div>

                <TargetRow label="CPL Cap"             actual={data.targets.actualCpl}         target={data.targets.cplCap}            formatVal={(n) => "$" + fmt(n, 2)} invert />
                <TargetRow label="Monthly Lead Target" actual={data.targets.actualLeads}       target={data.targets.monthlyLeadTarget} formatVal={(n) => n.toFixed(0)} />
                <TargetRow label="Pipeline ROI Target" actual={data.targets.actualPipelineRoi} target={data.targets.pipelineRoiTarget} formatVal={(n) => fmtMult(n)} />

                <div style={{ marginTop: 18, padding: "12px 14px", background: "rgba(255,255,255,0.04)", borderRadius: 10, border: `1px solid ${BORDER}` }}>
                  <div style={{ fontSize: 10, color: MUTED, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>Targets (Laedgen)</div>
                  {[
                    { label: "CPL Cap",         value: "$" + data.targets.cplCap },
                    { label: "Monthly Leads",   value: data.targets.monthlyLeadTarget.toLocaleString() },
                    { label: "Pipeline ROI",    value: fmtMult(data.targets.pipelineRoiTarget) },
                    { label: "Actual CPL",      value: "$" + fmt(data.targets.actualCpl, 2) },
                    { label: "Pipeline Value",  value: fmtUSD(data.kpis.totalPipeline) },
                    { label: "MQL Count",       value: data.funnel.mql.toLocaleString() },
                    { label: "SQL Count",       value: data.funnel.sql.toLocaleString() },
                    { label: "Closed Won",      value: data.funnel.closedWon.toLocaleString() },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0",
                      borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <span style={{ fontSize: 11, color: MUTED }}>{label}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: TEXT }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Execution Logs ── */}
            <div style={{ background: SURF, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: "hidden" }}>
              <div style={{ padding: "13px 18px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 8 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 17, color: "#34d399" }}>terminal</span>
                <span style={{ fontWeight: 600, fontSize: 14 }}>Execution Logs</span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: MUTED, background: "rgba(255,255,255,0.05)",
                  padding: "2px 8px", borderRadius: 99 }}>{data.logs.length} entries</span>
              </div>
              <div style={{ maxHeight: 300, overflowY: "auto", padding: "4px 0" }}>
                {data.logs.length === 0 && (
                  <div style={{ padding: "24px 18px", textAlign: "center", color: MUTED, fontSize: 13 }}>No log entries yet.</div>
                )}
                {data.logs.map((log) => (
                  <div key={log.id} style={{ display: "flex", alignItems: "flex-start", gap: 12,
                    padding: "9px 18px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 15, marginTop: 1, flexShrink: 0,
                      color: log.type === "Query" ? "#60a5fa" : "#a78bfa" }}>
                      {log.type === "Query" ? "search" : "send"}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: TEXT, marginBottom: 2 }}>{log.message}</div>
                      <div style={{ fontSize: 11, color: MUTED }}>
                        <span style={{ display: "inline-block", marginRight: 8, padding: "1px 6px", borderRadius: 4, fontSize: 10,
                          background: log.type === "Query" ? "rgba(96,165,250,0.12)" : "rgba(167,139,250,0.12)",
                          color: log.type === "Query" ? "#93c5fd" : "#c4b5fd" }}>{log.type}</span>
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
