import React from "react";
import {
  ResponsiveContainer,
  BarChart, Bar, Cell,
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { formatUsdInDisplay } from "@/lib/fx-format";

const SIDE_COLORS = ["#1a73e8", "#f4511e", "#0f9d58", "#ab47bc", "#e37400"];

export interface ComparisonPayload {
  mode: "comparison";
  sides: Array<Record<string, unknown>>;
  aligned_daily_trend?: Array<Record<string, unknown>>;
  trend_available?: boolean;
  window_days?: number;
}

function formatNumber(value: unknown, opts: { currency?: string; decimals?: number } = {}): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const decimals = opts.decimals ?? (Math.abs(n) >= 100 ? 0 : 2);
  const formatted = n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return opts.currency ? `${opts.currency} ${formatted}` : formatted;
}

function StatCard({ label, value, color }: { label: string; value: string | null; color: string }) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-slate-400 uppercase tracking-wide" style={{ fontSize: "9px" }}>{label}</span>
      <span className="font-semibold tabular-nums" style={{ fontSize: "12px", color }}>
        {value ?? "—"}
      </span>
    </div>
  );
}

export function CampaignComparisonCard({ payload }: { payload: ComparisonPayload }) {
  const sides = Array.isArray(payload.sides) ? payload.sides : [];
  const trend = Array.isArray(payload.aligned_daily_trend) ? payload.aligned_daily_trend : [];
  const trendAvailable = Boolean(payload.trend_available) && trend.length > 0;
  const windowDays = Number(payload.window_days ?? 30);

  const sideLabel = (s: Record<string, unknown>) =>
    String(s.query ?? `Side ${sides.indexOf(s)}`);

  const fmtUsd = (v: unknown) =>
    v != null && Number.isFinite(Number(v)) ? formatUsdInDisplay(Number(v)) : null;
  const fmtX = (v: unknown) =>
    v != null && Number.isFinite(Number(v)) ? `${Number(v).toFixed(2)}x` : null;
  const fmtN = (v: unknown) =>
    v != null && Number.isFinite(Number(v))
      ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })
      : null;

  const totalsBarData = (() => {
    const metrics = [
      { key: "spend_usd",   label: "Spend ($)"   },
      { key: "revenue_usd", label: "Revenue ($)" },
    ];
    return metrics.map(({ key, label }) => {
      const row: Record<string, unknown> = { name: label };
      sides.forEach((s, idx) => {
        const totals = (s.totals ?? {}) as Record<string, unknown>;
        row[`side_${idx}`] = totals[key] != null ? Number(totals[key]) : 0;
      });
      return row;
    });
  })();

  const roasBarData = sides.map((s, idx) => {
    const totals = (s.totals ?? {}) as Record<string, unknown>;
    return {
      name: sideLabel(s),
      ROAS: totals.roas != null ? Number(totals.roas) : 0,
      color: SIDE_COLORS[idx % SIDE_COLORS.length],
    };
  });

  const trendChartData = trend.map((row) => {
    const point: Record<string, unknown> = {
      date: String(row.date ?? "").slice(5),
    };
    sides.forEach((_, idx) => {
      const sd = row[`side_${idx}`] as Record<string, unknown> | null | undefined;
      point[`side_${idx}_spend`] = sd?.spend_usd != null ? Number(sd.spend_usd) : null;
    });
    return point;
  });

  return (
    <div className="space-y-3 text-[11px]">
      <p className="text-slate-400" style={{ fontSize: "10px" }}>
        {sides.length}-way comparison · last {windowDays}d
      </p>

      {/* Per-side stat cards */}
      <div className="flex flex-col gap-2">
        {sides.map((s, idx) => {
          const totals = (s.totals ?? {}) as Record<string, unknown>;
          const color = SIDE_COLORS[idx % SIDE_COLORS.length];
          return (
            <div
              key={idx}
              className="rounded-md px-2.5 py-2 space-y-1.5"
              style={{
                background: "rgba(255,255,255,0.7)",
                border: `1px solid rgba(0,0,0,0.06)`,
                borderLeftColor: color,
                borderLeftWidth: "3px",
              }}
            >
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                <span className="font-semibold text-slate-700 truncate">{sideLabel(s)}</span>
                <span className="text-slate-400 ml-auto" style={{ fontSize: "9px" }}>
                  {Number(s.matched_count ?? 0)} matched
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1">
                <StatCard label="Spend"   value={fmtUsd(totals.spend_usd)}   color="#1e293b" />
                <StatCard label="Revenue" value={fmtUsd(totals.revenue_usd)} color="#0f9d58" />
                <StatCard
                  label="ROAS"
                  value={fmtX(totals.roas)}
                  color={
                    totals.roas != null && Number(totals.roas) >= 3
                      ? "#0f9d58"
                      : totals.roas != null && Number(totals.roas) < 1
                      ? "#ea4335"
                      : "#1e293b"
                  }
                />
                <StatCard label="Conv." value={fmtN(totals.conversions)} color="#1e293b" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Grouped bar chart — spend & revenue per side */}
      {sides.length > 0 && (
        <div>
          <p className="text-slate-400 mb-1" style={{ fontSize: "10px" }}>Spend & Revenue by group</p>
          <ResponsiveContainer width="100%" height={130}>
            <BarChart data={totalsBarData} margin={{ top: 2, right: 4, left: 0, bottom: 2 }} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 9, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
                width={38}
                tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
              />
              <Tooltip
                contentStyle={{ fontSize: "10px", borderRadius: "6px", border: "1px solid rgba(0,74,198,0.15)" }}
                formatter={(value: number, name: string) => [formatUsdInDisplay(value), name]}
              />
              <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: "9px", paddingTop: "4px" }} />
              {sides.map((s, idx) => (
                <Bar
                  key={idx}
                  dataKey={`side_${idx}`}
                  name={sideLabel(s)}
                  fill={SIDE_COLORS[idx % SIDE_COLORS.length]}
                  radius={[2, 2, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ROAS bar chart */}
      {roasBarData.some((r) => (r.ROAS as number) > 0) && (
        <div>
          <p className="text-slate-400 mb-1" style={{ fontSize: "10px" }}>ROAS by group</p>
          <ResponsiveContainer width="100%" height={80}>
            <BarChart data={roasBarData} layout="vertical" margin={{ top: 2, right: 4, left: 4, bottom: 2 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 9, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `${v.toFixed(1)}x`}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 9, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
                width={70}
              />
              <Tooltip
                contentStyle={{ fontSize: "10px", borderRadius: "6px", border: "1px solid rgba(0,74,198,0.15)" }}
                formatter={(value: number) => [`${value.toFixed(2)}x`, "ROAS"]}
              />
              <Bar dataKey="ROAS" radius={[0, 2, 2, 0]}>
                {roasBarData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.color as string} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Multi-line daily spend trend */}
      {trendAvailable ? (
        <div>
          <p className="text-slate-400 mb-1" style={{ fontSize: "10px" }}>Daily spend trend</p>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={trendChartData} margin={{ top: 2, right: 4, left: 0, bottom: 2 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 8, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
                interval={Math.floor(trendChartData.length / 5)}
              />
              <YAxis
                tick={{ fontSize: 8, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
                width={36}
                tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
              />
              <Tooltip
                contentStyle={{ fontSize: "10px", borderRadius: "6px", border: "1px solid rgba(0,74,198,0.15)" }}
                formatter={(value: unknown, name: string) => {
                  const n = Number(value);
                  return Number.isFinite(n) ? [formatUsdInDisplay(n), name] : ["—", name];
                }}
              />
              <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: "9px", paddingTop: "4px" }} />
              {sides.map((s, idx) => (
                <Line
                  key={idx}
                  type="monotone"
                  dataKey={`side_${idx}_spend`}
                  name={sideLabel(s)}
                  stroke={SIDE_COLORS[idx % SIDE_COLORS.length]}
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-slate-400 italic" style={{ fontSize: "10px" }}>
          Daily trend unavailable — totals shown above.
        </p>
      )}
    </div>
  );
}

export function parseComparisonPayload(content: string): ComparisonPayload | null {
  const jsonBlockRe = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/g;
  let match: RegExpExecArray | null;
  while ((match = jsonBlockRe.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed && parsed.mode === "comparison" && Array.isArray(parsed.sides)) {
        return parsed as ComparisonPayload;
      }
    } catch {
    }
  }
  try {
    const trimmed = content.trim();
    if (trimmed.startsWith("{")) {
      const parsed = JSON.parse(trimmed);
      if (parsed && parsed.mode === "comparison" && Array.isArray(parsed.sides)) {
        return parsed as ComparisonPayload;
      }
    }
  } catch {
  }
  return null;
}
