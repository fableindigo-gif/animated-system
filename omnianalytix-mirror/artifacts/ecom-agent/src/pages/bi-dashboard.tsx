import { useEffect, useState, useCallback } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { formatUsdInDisplay } from "@/lib/fx-format";

const BASE_URL  = import.meta.env.BASE_URL ?? "/";
const API_BASE  = BASE_URL.endsWith("/") ? BASE_URL.slice(0, -1) : BASE_URL;

// ─── Types ────────────────────────────────────────────────────────────────────

interface KPIs {
  totalSpend:   number;
  totalRevenue: number;
  blendedROAS:  number;
  blendedPOAS:  number;
  margin:       number;
  blendedCpl:   number;
}

interface Channel {
  channel:     string;
  spend:       number;
  revenue:     number;
  clicks:      number;
  conversions: number;
  roas:        number;
  cpl:         number;
}

interface Targets {
  roasTarget:   number;
  marginTarget: number;
  cplCap:       number;
  actualROAS:   number;
  actualMargin: number;
  actualCpl:    number;
}

interface SystemLog {
  id:        number;
  type:      string;
  message:   string;
  createdAt: string;
}

interface DashboardData {
  kpis:     KPIs;
  channels: Channel[];
  targets:  Targets;
  logs:     SystemLog[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, dec = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtCurrency(n: number) {
  return formatUsdInDisplay(n, { compact: true, decimals: 1 });
}

function progressPct(actual: number, target: number, invert = false): number {
  if (target === 0) return 0;
  const pct = (actual / target) * 100;
  return invert ? Math.min(100, 100 - Math.max(0, pct - 100)) : Math.min(100, pct);
}

function progressColor(pct: number, good = true): string {
  if (good) return pct >= 90 ? "#22c55e" : pct >= 60 ? "#f59e0b" : "#ef4444";
  return pct <= 90 ? "#22c55e" : pct <= 110 ? "#f59e0b" : "#ef4444";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, trend }: { label: string; value: string; sub?: string; trend?: "up" | "down" | "neutral" }) {
  const trendColor = trend === "up" ? "#22c55e" : trend === "down" ? "#ef4444" : "#94a3b8";
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: 12,
      padding: "22px 24px",
      flex: 1,
      minWidth: 160,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: "#f1f5f9", lineHeight: 1 }}>{value}</div>
      {sub && (
        <div style={{ fontSize: 12, color: trendColor, marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
          {trend === "up" && "▲"} {trend === "down" && "▼"} {sub}
        </div>
      )}
    </div>
  );
}

function ProgressBar({ label, actual, target, format, invert = false, unit = "" }: {
  label:   string;
  actual:  number;
  target:  number;
  format:  (n: number) => string;
  invert?: boolean;
  unit?:   string;
}) {
  const pct   = progressPct(actual, target, invert);
  const color = progressColor(pct, !invert);
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 13, color: "#cbd5e1", fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 13, color: "#f1f5f9", fontWeight: 600 }}>
          {format(actual)}{unit} <span style={{ color: "#475569" }}>/ {format(target)}{unit}</span>
        </span>
      </div>
      <div style={{ height: 6, background: "rgba(255,255,255,0.07)", borderRadius: 99 }}>
        <div style={{ height: 6, width: `${pct}%`, background: color, borderRadius: 99, transition: "width 0.6s ease" }} />
      </div>
    </div>
  );
}

function ChannelBadge({ ch }: { ch: string }) {
  const isGoogle = ch.toLowerCase().includes("google");
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 10px",
      borderRadius: 99, fontSize: 12, fontWeight: 600,
      background: isGoogle ? "rgba(66,133,244,0.15)" : "rgba(24,119,242,0.15)",
      color: isGoogle ? "#93c5fd" : "#818cf8",
      border: `1px solid ${isGoogle ? "rgba(66,133,244,0.3)" : "rgba(99,102,241,0.3)"}`,
    }}>
      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
        {isGoogle ? "ads_click" : "group"}
      </span>
      {ch}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function BiDashboard() {
  const [data,    setData]    = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [gSyncing, setGSyncing] = useState(false);
  const [gSyncMsg, setGSyncMsg] = useState<string | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [health,  setHealth]  = useState<"healthy" | "warning" | "critical">("healthy");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await authFetch(`${API_BASE}/api/bi/dashboard`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json() as DashboardData;
      setData(json);
      const hasData = json.kpis.totalSpend > 0;
      const roas    = json.kpis.blendedROAS;
      setHealth(!hasData ? "warning" : roas < 2 ? "critical" : roas < json.targets.roasTarget * 0.8 ? "warning" : "healthy");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const seed = async () => {
    setSeeding(true);
    try {
      const r = await authFetch(`${API_BASE}/api/bi/seed`, { method: "POST" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSeeding(false);
    }
  };

  const syncGoogleAds = async () => {
    setGSyncing(true);
    setGSyncMsg(null);
    try {
      const r = await authFetch(`${API_BASE}/api/google-ads/sync`, { method: "POST" });
      const json = await r.json() as { success?: boolean; rows?: number; days?: number; spend?: number; channels?: string[]; error?: string };
      if (!r.ok) throw new Error(json.error ?? `HTTP ${r.status}`);
    setGSyncMsg(`Synced ${json.rows} rows · ${json.days} days · ${formatUsdInDisplay(json.spend ?? 0)} spend`);
      await load();
    } catch (e) {
      setError(`Google Ads sync failed: ${String(e)}`);
    } finally {
      setGSyncing(false);
    }
  };

  const hasData = data && data.kpis.totalSpend > 0;

  const bg      = "#0b0f1a";
  const surface = "rgba(255,255,255,0.04)";
  const border  = "rgba(255,255,255,0.09)";
  const text     = "#f1f5f9";
  const muted   = "#64748b";

  const healthConfig = {
    healthy:  { bg: "rgba(34,197,94,0.12)",  border: "rgba(34,197,94,0.3)",  color: "#4ade80", icon: "check_circle",  label: "All systems healthy — Abley's workspace operating normally" },
    warning:  { bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.3)", color: "#fbbf24", icon: "warning",       label: "2 SKUs flagged: active ad spend with zero inventory (margin leak)" },
    critical: { bg: "rgba(239,68,68,0.12)",  border: "rgba(239,68,68,0.3)",  color: "#f87171", icon: "error",         label: "ROAS critically below target — immediate review required" },
  }[health];

  return (
    <div style={{ minHeight: "100vh", background: bg, color: text, fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "28px 28px 48px" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 24, color: "#60a5fa" }}>query_stats</span>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: text, margin: 0 }}>BI Command Center</h1>
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                padding: "2px 8px", borderRadius: 4, background: "rgba(96,165,250,0.15)", color: "#60a5fa",
              }}>Abley's</span>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: muted }}>Profitability intelligence — blended ROAS, POAS &amp; channel breakdown</p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {gSyncMsg && (
              <span style={{ fontSize: 11, color: "#4ade80", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.25)", borderRadius: 6, padding: "4px 10px" }}>
                ✓ {gSyncMsg}
              </span>
            )}
            <button
              onClick={load}
              disabled={loading}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: 8, border: `1px solid ${border}`,
                background: surface, color: text, fontSize: 13, fontWeight: 500, cursor: "pointer",
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16, color: "#60a5fa" }}>refresh</span>
              Refresh
            </button>
            <button
              onClick={syncGoogleAds}
              disabled={gSyncing}
              title="Pull live campaign metrics from Google Ads API"
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(66,133,244,0.4)",
                background: gSyncing ? "rgba(66,133,244,0.15)" : "rgba(66,133,244,0.1)", color: "#93c5fd",
                fontSize: 13, fontWeight: 500, cursor: gSyncing ? "not-allowed" : "pointer",
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 15, animation: gSyncing ? "spin 1s linear infinite" : "none" }}>
                {gSyncing ? "progress_activity" : "ads_click"}
              </span>
              {gSyncing ? "Syncing…" : "Sync Google Ads"}
            </button>
            <button
              onClick={seed}
              disabled={seeding}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 16px", borderRadius: 8, border: "none",
                background: seeding ? "#1e3a5f" : "#1a56db", color: "#fff",
                fontSize: 13, fontWeight: 600, cursor: seeding ? "not-allowed" : "pointer",
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{seeding ? "hourglass_empty" : "bolt"}</span>
              {seeding ? "Seeding…" : "Seed Abley's Data"}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "12px 16px", marginBottom: 20, color: "#fca5a5", fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* ── Live Triage Banner ── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "12px 16px", borderRadius: 10, marginBottom: 24,
          background: healthConfig.bg, border: `1px solid ${healthConfig.border}`,
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 20, color: healthConfig.color }}>{healthConfig.icon}</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: healthConfig.color }}>{healthConfig.label}</span>
          <span style={{ marginLeft: "auto", fontSize: 11, color: muted }}>Live Triage</span>
        </div>

        {loading && !data && (
          <div style={{ textAlign: "center", padding: "60px 0", color: muted }}>
            <span className="material-symbols-outlined" style={{ fontSize: 36, display: "block", marginBottom: 12 }}>hourglass_empty</span>
            Loading dashboard…
          </div>
        )}

        {!loading && !hasData && (
          <div style={{
            textAlign: "center", padding: "60px 24px",
            background: surface, border: `1px solid ${border}`, borderRadius: 16,
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 40, color: "#60a5fa", display: "block", marginBottom: 12 }}>bar_chart</span>
            <p style={{ color: text, fontWeight: 600, fontSize: 16, margin: "0 0 8px" }}>No data yet</p>
            <p style={{ color: muted, fontSize: 13, margin: "0 0 20px" }}>Click "Seed Abley's Data" to populate 30 days of realistic mock data.</p>
            <button onClick={seed} disabled={seeding} style={{
              padding: "10px 22px", borderRadius: 8, border: "none",
              background: "#1a56db", color: "#fff", fontWeight: 600, fontSize: 14, cursor: "pointer",
            }}>
              {seeding ? "Seeding…" : "Seed Now"}
            </button>
          </div>
        )}

        {hasData && data && (
          <>
            {/* ── Portfolio KPI Header ── */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
              <KpiCard
                label="Total Ad Spend"
                value={fmtCurrency(data.kpis.totalSpend)}
                sub="30-day window"
                trend="neutral"
              />
              <KpiCard
                label="Est. Revenue"
                value={fmtCurrency(data.kpis.totalRevenue)}
                sub={`${fmt(data.kpis.blendedROAS, 1)}x blended return`}
                trend={data.kpis.totalRevenue > data.kpis.totalSpend * 3 ? "up" : "down"}
              />
              <KpiCard
                label="Blended ROAS"
                value={`${fmt(data.kpis.blendedROAS, 2)}x`}
                sub={data.kpis.blendedROAS >= data.targets.roasTarget ? "Above target" : "Below target"}
                trend={data.kpis.blendedROAS >= data.targets.roasTarget ? "up" : "down"}
              />
              <KpiCard
                label="Blended POAS"
                value={`${fmt(data.kpis.blendedPOAS, 2)}x`}
                sub={`${fmt(data.kpis.margin, 1)}% net margin`}
                trend={data.kpis.blendedPOAS > 1 ? "up" : "down"}
              />
            </div>

            {/* ── Two-column layout ── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20, marginBottom: 20 }}>

              {/* ── Performance Grid ── */}
              <div style={{ background: surface, border: `1px solid ${border}`, borderRadius: 14, overflow: "hidden" }}>
                <div style={{ padding: "16px 20px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18, color: "#60a5fa" }}>grid_on</span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>Channel Performance Grid</span>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                        {["Channel", "Spend", "Revenue", "Clicks", "Conversions", "ROAS", "CPL"].map(h => (
                          <th key={h} style={{ padding: "10px 16px", textAlign: h === "Channel" ? "left" : "right", color: muted, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.channels.map((ch, i) => (
                        <tr key={ch.channel} style={{ borderBottom: i < data.channels.length - 1 ? `1px solid ${border}` : "none" }}>
                          <td style={{ padding: "14px 16px" }}><ChannelBadge ch={ch.channel} /></td>
                          <td style={{ padding: "14px 16px", textAlign: "right", color: "#fbbf24", fontWeight: 600 }}>{fmtCurrency(ch.spend)}</td>
                          <td style={{ padding: "14px 16px", textAlign: "right", color: "#4ade80", fontWeight: 600 }}>{fmtCurrency(ch.revenue)}</td>
                          <td style={{ padding: "14px 16px", textAlign: "right", color: text }}>{ch.clicks.toLocaleString()}</td>
                          <td style={{ padding: "14px 16px", textAlign: "right", color: text }}>{ch.conversions.toLocaleString()}</td>
                          <td style={{ padding: "14px 16px", textAlign: "right" }}>
                            <span style={{ color: ch.roas >= data.targets.roasTarget ? "#4ade80" : "#f87171", fontWeight: 700 }}>
                              {fmt(ch.roas, 2)}x
                            </span>
                          </td>
                          <td style={{ padding: "14px 16px", textAlign: "right" }}>
                            <span style={{ color: ch.cpl <= data.targets.cplCap ? "#4ade80" : "#f87171", fontWeight: 700 }}>
                              ${fmt(ch.cpl, 2)}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {/* Totals row */}
                      <tr style={{ background: "rgba(255,255,255,0.03)", borderTop: `1px solid ${border}` }}>
                        <td style={{ padding: "12px 16px", fontWeight: 700, color: text }}>Blended</td>
                        <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "#fbbf24" }}>{fmtCurrency(data.kpis.totalSpend)}</td>
                        <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "#4ade80" }}>{fmtCurrency(data.kpis.totalRevenue)}</td>
                        <td style={{ padding: "12px 16px", textAlign: "right", color: muted }}>—</td>
                        <td style={{ padding: "12px 16px", textAlign: "right", color: muted }}>—</td>
                        <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: data.kpis.blendedROAS >= data.targets.roasTarget ? "#4ade80" : "#f87171" }}>
                          {fmt(data.kpis.blendedROAS, 2)}x
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: data.kpis.blendedCpl <= data.targets.cplCap ? "#4ade80" : "#f87171" }}>
                          ${fmt(data.kpis.blendedCpl, 2)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── Target Metrics Panel ── */}
              <div style={{ background: surface, border: `1px solid ${border}`, borderRadius: 14, padding: "18px 20px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18, color: "#a78bfa" }}>flag</span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>Target Metrics</span>
                </div>

                <ProgressBar
                  label="ROAS Goal"
                  actual={data.targets.actualROAS}
                  target={data.targets.roasTarget}
                  format={(n) => `${fmt(n, 2)}x`}
                />
                <ProgressBar
                  label="Margin Target"
                  actual={data.targets.actualMargin}
                  target={data.targets.marginTarget}
                  format={(n) => `${fmt(n, 1)}`}
                  unit="%"
                />
                <ProgressBar
                  label="CPL Cap"
                  actual={data.targets.actualCpl}
                  target={data.targets.cplCap}
                  format={(n) => fmtCurrency(n)}
                  invert
                />

                <div style={{ marginTop: 20, padding: "12px 14px", background: "rgba(255,255,255,0.04)", borderRadius: 10, border: `1px solid ${border}` }}>
                  <div style={{ fontSize: 11, color: muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>Targets (Abley's)</div>
                  {[
                    { label: "ROAS Goal",       value: `${data.targets.roasTarget}x`           },
                    { label: "Margin Target",   value: `${data.targets.marginTarget}%`          },
                    { label: "CPL Cap",         value: formatUsdInDisplay(data.targets.cplCap)   },
                    { label: "Net Margin",      value: `${fmt(data.kpis.margin, 1)}%`           },
                    { label: "POAS",            value: `${fmt(data.kpis.blendedPOAS, 2)}x`     },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid rgba(255,255,255,0.05)` }}>
                      <span style={{ fontSize: 12, color: muted }}>{label}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: text }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Execution Logs ── */}
            <div style={{ background: surface, border: `1px solid ${border}`, borderRadius: 14, overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", gap: 8 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18, color: "#34d399" }}>terminal</span>
                <span style={{ fontWeight: 600, fontSize: 14 }}>Execution Logs</span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: muted, background: "rgba(255,255,255,0.05)", padding: "2px 8px", borderRadius: 99 }}>
                  {data.logs.length} entries
                </span>
              </div>
              <div style={{ maxHeight: 320, overflowY: "auto", padding: "4px 0" }}>
                {data.logs.length === 0 && (
                  <div style={{ padding: "24px 20px", textAlign: "center", color: muted, fontSize: 13 }}>No log entries yet.</div>
                )}
                {data.logs.map((log) => (
                  <div key={log.id} style={{
                    display: "flex", alignItems: "flex-start", gap: 12,
                    padding: "10px 20px", borderBottom: `1px solid rgba(255,255,255,0.04)`,
                  }}>
                    <span className="material-symbols-outlined" style={{
                      fontSize: 16, marginTop: 1, flexShrink: 0,
                      color: log.type === "Query" ? "#60a5fa" : "#a78bfa",
                    }}>
                      {log.type === "Query" ? "search" : "send"}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: text, marginBottom: 2 }}>{log.message}</div>
                      <div style={{ fontSize: 11, color: muted }}>
                        <span style={{
                          display: "inline-block", marginRight: 8,
                          padding: "1px 6px", borderRadius: 4, fontSize: 10,
                          background: log.type === "Query" ? "rgba(96,165,250,0.12)" : "rgba(167,139,250,0.12)",
                          color: log.type === "Query" ? "#93c5fd" : "#c4b5fd",
                        }}>{log.type}</span>
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
