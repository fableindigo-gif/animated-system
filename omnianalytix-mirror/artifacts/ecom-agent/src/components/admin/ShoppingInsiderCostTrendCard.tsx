/**
 * ShoppingInsiderCostTrendCard
 *
 * Renders a simple line chart of Shopping Insider BigQuery bytesBilled over
 * time, sourced from GET /api/admin/shopping-insider-cache/history.
 * Intended for the Platform Admin dashboard (super_admin only).
 */

import { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { authFetch } from "@/lib/auth-fetch";
import { Loader2, AlertCircle, TrendingUp } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface CostSample {
  id: number;
  sampledAt: string;
  bytesBilled: number;
  bytesAvoided: number;
  hits: number;
  misses: number;
  hitRate: number | null;
  windowMs: number;
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(2)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(2)} KB`;
  return `${bytes} B`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function ShoppingInsiderCostTrendCard() {
  const [samples, setSamples] = useState<CostSample[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    authFetch(`${BASE}/api/admin/shopping-insider-cache/history?limit=72`)
      .then((r) => r.json())
      .then((data: { ok: boolean; samples: CostSample[] }) => {
        if (!data.ok) throw new Error("API returned ok=false");
        // Reverse to oldest-first for the chart
        setSamples([...data.samples].reverse());
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load history"),
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="h-5 w-5 text-indigo-500" />
        <h2 className="text-base font-semibold text-slate-800">
          Shopping Insider — BigQuery Cost Trend
        </h2>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Per-tick bytesBilled delta inside the rolling alerter window (last 72
        samples). Helps distinguish one-off spikes from gradual spend creep.
      </p>

      {loading && (
        <div className="flex items-center justify-center h-48 text-slate-400 gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading cost history…</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-red-600 text-sm h-48 justify-center">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && samples.length === 0 && (
        <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
          No samples recorded yet — data appears once the alerter fires its first tick.
        </div>
      )}

      {!loading && !error && samples.length > 0 && (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart
            data={samples}
            margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis
              dataKey="sampledAt"
              tickFormatter={(v: string) => fmtTime(v)}
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={(v: number) => fmtBytes(v)}
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              width={72}
            />
            <Tooltip
              formatter={(value: number, name: string) => [
                fmtBytes(value),
                name === "bytesBilled" ? "Bytes Billed" : "Bytes Avoided",
              ]}
              labelFormatter={(label: string) => fmtTime(label)}
              contentStyle={{
                fontSize: 12,
                borderRadius: 8,
                border: "1px solid #e2e8f0",
              }}
            />
            <Legend
              formatter={(value: string) =>
                value === "bytesBilled" ? "Bytes Billed" : "Bytes Avoided"
              }
              wrapperStyle={{ fontSize: 12 }}
            />
            <Line
              type="monotone"
              dataKey="bytesBilled"
              stroke="#6366f1"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="bytesAvoided"
              stroke="#10b981"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
