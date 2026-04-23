import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from "recharts";
import type { TooltipProps } from "recharts";
import { Crosshair, TrendingDown, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useFx } from "@/contexts/fx-context";
import { useCurrency } from "@/contexts/currency-context";
import { MoneyTile } from "@/components/ui/money-tile";

export interface PMaxDistribution {
  search: { spend: number; pct: number };
  display: { spend: number; pct: number };
  shopping: { spend: number; pct: number };
}

export interface PMaxXRayData {
  distribution: PMaxDistribution;
  assetGroups: Array<{ name: string; spendUsd: string; conversions: string }>;
  totalEstimatedSpend: number;
  campaignId: string;
}

interface PMaxXRayProps {
  data: PMaxXRayData;
}

const NETWORK_COLORS = {
  search: "#4A9EFF",
  shopping: "#00D4AA",
  display: "#FF6B6B",
};

type PiePayload = { name: string; value: number; spend: number; color: string };

/**
 * Custom Recharts tooltip that mirrors the FX audit trail shown by
 * `<MoneyTile>`: USD source amount, active exchange rate, rate date, and
 * rate source. Recharts `content` prop receives a real React component so
 * hooks are available here, unlike the primitive `formatter` callback.
 */
function PieAuditTooltip({ active, payload }: TooltipProps<number, string>) {
  const { rate, rateDate, source, loading, formatFromUsd } = useFx();
  const { currencyCode, formatUsd } = useCurrency();
  const isUsd = currencyCode.toUpperCase() === "USD";

  if (!active || !payload?.length) return null;
  const entry = payload[0]?.payload as PiePayload | undefined;
  if (!entry) return null;

  const spendUsd   = entry.spend ?? 0;
  const pct        = entry.value ?? 0;
  const formatted  = formatFromUsd(spendUsd, { decimals: 0 });

  return (
    <div
      style={{
        background:   "#12192D",
        border:       "1px solid #2A3550",
        borderRadius: "8px",
        color:        "#fff",
        padding:      "10px 14px",
        minWidth:     "180px",
        fontSize:     "12px",
        lineHeight:   "1.6",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4, color: entry.color }}>
        {entry.name}
      </div>
      <div style={{ fontWeight: 600 }}>
        {pct}% · {formatted}
      </div>
      {!isUsd && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #2A3550", opacity: 0.8 }}>
          <div>{formatUsd(spendUsd, { decimals: 2 })} (USD)</div>
          <div style={{ opacity: 0.75 }}>
            1 USD = {rate.toFixed(4)} {currencyCode} · {rateDate}
          </div>
          <div style={{ opacity: 0.6, textTransform: "capitalize" }}>
            {loading ? "loading rate…" : `source: ${source}`}
          </div>
        </div>
      )}
    </div>
  );
}

const IDEAL_SHOPPING_PCT = 50;
const CANNIBALIZATION_THRESHOLD = 30;

export function PMaxXRay({ data }: PMaxXRayProps) {
  const { distribution, assetGroups, totalEstimatedSpend } = data;

  const pieData = [
    { name: "Search", value: distribution.search.pct, spend: distribution.search.spend, color: NETWORK_COLORS.search },
    { name: "Shopping", value: distribution.shopping.pct, spend: distribution.shopping.spend, color: NETWORK_COLORS.shopping },
    { name: "Display/Video", value: distribution.display.pct, spend: distribution.display.spend, color: NETWORK_COLORS.display },
  ];

  const shoppingUnderallocated = distribution.shopping.pct < IDEAL_SHOPPING_PCT - 15;
  const displayDominant = distribution.display.pct > CANNIBALIZATION_THRESHOLD;
  const cannibalizationRisk = shoppingUnderallocated && displayDominant;

  return (
    <div className="mx-4 my-2 rounded-2xl border border-primary-container/20 bg-primary-container/5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-primary-container/20">
        <div className="p-1.5 rounded-md bg-primary-container/10">
          <Crosshair className="w-4 h-4 text-[#60a5fa]" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-foreground">PMax X-Ray</span>
            <Badge variant="outline" className="text-[9px] font-mono text-[#60a5fa] border-primary-container/30">NETWORK DISTRIBUTION</Badge>
          </div>
          <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
            Est. Spend: <MoneyTile usd={totalEstimatedSpend} decimals={0} />
          </p>
        </div>
        {cannibalizationRisk && (
          <Badge variant="outline" className="text-[9px] font-mono text-rose-400 border-rose-500/30 bg-error-container/10 gap-1">
            <AlertTriangle className="w-2.5 h-2.5" />
            CANNIBALIZATION RISK
          </Badge>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-0 sm:divide-x divide-border/30">
        {/* Pie Chart */}
        <div className="flex-1 p-4">
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-3">Budget Allocation</p>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {pieData.map((entry) => (
                    <Cell key={entry.name ?? entry.color} fill={entry.color} stroke="transparent" />
                  ))}
                </Pie>
                <Tooltip content={<PieAuditTooltip />} />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(value) => <span className="text-xs text-muted-foreground">{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Stats + Alerts */}
        <div className="sm:w-[220px] p-4 space-y-3 border-t sm:border-t-0 border-border/30">
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">Network Breakdown</p>
          {pieData.map((network) => (
            <div key={network.name}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium" style={{ color: network.color }}>{network.name}</span>
                <span className="text-xs font-mono font-bold" style={{ color: network.color }}>{network.value}%</span>
              </div>
              <div className="h-1.5 bg-secondary/30 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${network.value}%`, backgroundColor: network.color }} />
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                <MoneyTile usd={network.spend} decimals={0} /> estimated
              </p>
            </div>
          ))}

          {cannibalizationRisk && (
            <div className="mt-3 p-2 bg-error-container/10 rounded-2xl border border-rose-500/20">
              <div className="flex items-center gap-1.5 text-rose-400 text-xs font-bold mb-1">
                <TrendingDown className="w-3 h-3" />
                Cannibalization Alert
              </div>
              <p className="text-[10px] text-rose-400/80">Shopping underallocated ({distribution.shopping.pct}%). Display/Video consuming {distribution.display.pct}% — may be competing with Shopping inventory.</p>
            </div>
          )}
        </div>
      </div>

      {/* Asset Groups */}
      {assetGroups.length > 0 && (
        <div className="px-4 pb-4 border-t border-border/30 pt-3">
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-2">Asset Groups</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {assetGroups.slice(0, 4).map((ag, i) => (
              <div key={i} className="bg-secondary/20 rounded-2xl px-3 py-2">
                <p className="text-xs font-medium text-foreground truncate">{ag.name}</p>
                <p className="text-[10px] font-mono text-muted-foreground">
                  <MoneyTile usd={parseFloat(ag.spendUsd) || 0} decimals={0} /> spend · {ag.conversions} conv
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
