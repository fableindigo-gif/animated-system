import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { formatUsdInDisplay } from "@/lib/fx-format";
import { AlertCircle } from "lucide-react";

export interface ProfitTrendPoint {
  date: string;
  spend: number;
  revenue: number;
  cogs: number;
  profit: number;
}

interface ProfitTrendChartProps {
  points: ProfitTrendPoint[];
  hasEnoughHistory: boolean;
  distinctDays?: number;
  minHistoryDays?: number;
  cogsPct?: number;
  days?: number;
  loading?: boolean;
  onGoToSettings?: () => void;
  cogsPctIsDefault?: boolean;
}

function formatAxisMoney(v: number): string {
  if (!Number.isFinite(v)) return "";
  return formatUsdInDisplay(v, { compact: true, decimals: 0 });
}

export function ProfitTrendChart({
  points,
  hasEnoughHistory,
  distinctDays = 0,
  minHistoryDays = 14,
  cogsPct,
  days,
  loading = false,
  onGoToSettings,
  cogsPctIsDefault = true,
}: ProfitTrendChartProps) {
  const displayDays = days ?? points.length;

  const showSkeleton = loading && points.length === 0;

  return (
    <div
      className="bg-white rounded-xl shadow-sm p-5"
      style={{ border: "1px solid rgba(193,198,214,0.2)" }}
    >
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <h3
            className="text-base font-bold text-slate-900"
            style={{ fontFamily: "'Manrope', sans-serif" }}
          >
            Profit Trend · Last {displayDays} days
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Daily ad spend (bars), revenue, and true profit (lines).
          </p>
        </div>
        {cogsPct != null && (
          <button
            onClick={onGoToSettings}
            disabled={!onGoToSettings}
            title={`True Profit uses COGS ${Math.round(cogsPct * 100)}%${cogsPctIsDefault ? " (platform default)" : " (configured)"}${onGoToSettings ? " — click to adjust in Settings → Economics" : ""}`}
            className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-semibold tracking-wide border transition-opacity hover:opacity-80"
            style={{
              background: "rgba(26,115,232,0.06)",
              color: "#1a73e8",
              borderColor: "rgba(26,115,232,0.18)",
              cursor: onGoToSettings ? "pointer" : "default",
            }}
          >
            COGS {Math.round(cogsPct * 100)}%{cogsPctIsDefault ? " ·default" : ""}
            {onGoToSettings && (
              <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path
                  d="M6.5 1H15v8.5M15 1L7 9"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
            )}
          </button>
        )}
      </div>

      {!hasEnoughHistory && !loading && (
        <div
          role="status"
          data-testid="profit-trend-low-history-banner"
          className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300/40 bg-amber-50/70 px-3 py-2.5"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <p className="text-[11px] leading-relaxed text-amber-800">
            <span className="font-semibold">Limited history</span> — warehouse has{" "}
            {distinctDays} day{distinctDays !== 1 ? "s" : ""} of data (need{" "}
            {minHistoryDays} for a reliable trend). Chart shows available data.
          </p>
        </div>
      )}

      <div className="h-64 w-full">
        {showSkeleton ? (
          <div className="h-full w-full animate-pulse rounded-lg bg-slate-100" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={points}
              margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#e6e8ea"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "#6b7280" }}
                interval={Math.max(0, Math.floor(points.length / 9) - 1)}
                tickLine={false}
                axisLine={{ stroke: "#e6e8ea" }}
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 10, fill: "#6b7280" }}
                tickFormatter={formatAxisMoney}
                tickLine={false}
                axisLine={false}
                width={52}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 10, fill: "#6b7280" }}
                tickFormatter={formatAxisMoney}
                tickLine={false}
                axisLine={false}
                width={52}
              />
              <Tooltip
                contentStyle={{
                  border: "1px solid rgba(193,198,214,0.3)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(v: number, name: string) => [
                  formatUsdInDisplay(v, { compact: true, decimals: 2 }),
                  name,
                ]}
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="circle" />
              <Bar
                yAxisId="left"
                dataKey="spend"
                name="Ad Spend"
                fill="#1a73e8"
                fillOpacity={0.55}
                radius={[2, 2, 0, 0]}
                maxBarSize={18}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="revenue"
                name="Revenue"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="profit"
                name="True Profit"
                stroke="#00885d"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
