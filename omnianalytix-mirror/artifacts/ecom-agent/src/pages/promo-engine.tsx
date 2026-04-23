import { useState, useEffect, useCallback, type ReactNode } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { useSubscription } from "@/contexts/subscription-context";
import { MoneyTile } from "@/components/ui/money-tile";
import { cn } from "@/lib/utils";
import {
  Zap, TrendingDown, Package, DollarSign, PlayCircle, Loader2,
  CheckCircle2, XCircle, Clock, Lock, Crown, RefreshCw, ShoppingCart,
  Target, AlertTriangle, ChevronRight, Sparkles,
} from "lucide-react";
import { SiShopify, SiGoogleads } from "react-icons/si";

const BASE    = import.meta.env.BASE_URL ?? "/";
const API     = BASE.endsWith("/") ? BASE : BASE + "/";

interface PromoStats {
  total:          number | string;
  pending:        number | string;
  approved:       number | string;
  rejected:       number | string;
  total_recovery: number | string;
}

interface PromoTrigger {
  id:                    number;
  product_title:         string | null;
  sku:                   string | null;
  inventory_qty:         number | null;
  avg_poas_7d:           string | null;
  discount_percent:      number | null;
  promo_code:            string | null;
  projected_recovery:    string | null;
  status:                string;
  google_ads_asset_id:   string | null;
  triggered_at:          string;
}

const STATUS_CFG: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
  pending:  { label: "PENDING",  icon: <Clock className="w-3 h-3" />,        cls: "text-amber-600  bg-amber-50  border-amber-200"  },
  approved: { label: "APPROVED", icon: <CheckCircle2 className="w-3 h-3" />, cls: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  executed: { label: "EXECUTED", icon: <CheckCircle2 className="w-3 h-3" />, cls: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  rejected: { label: "REJECTED", icon: <XCircle className="w-3 h-3" />,      cls: "text-rose-600   bg-rose-50   border-rose-200"   },
};

function StatCard({ label, value, icon, sub, accent }: {
  label: string; value: ReactNode; icon: React.ReactNode; sub?: string; accent?: string;
}) {
  return (
    <div className={cn("rounded-2xl border p-5 bg-white flex flex-col gap-2 shadow-sm", accent ?? "border-gray-200")}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</span>
        <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center", accent ? "bg-orange-50" : "bg-gray-50")}>
          {icon}
        </div>
      </div>
      <p className="text-2xl font-bold text-gray-900 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function EliteGate({ onContact }: { onContact: () => void }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/80 backdrop-blur-sm rounded-2xl">
      <div className="text-center max-w-sm px-6 py-8">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-orange-200">
          <Crown className="w-8 h-8 text-white" />
        </div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">OmniAnalytix Elite</h3>
        <p className="text-sm text-gray-500 mb-6 leading-relaxed">
          The Promotional Intelligence Engine automatically detects overstocked, underperforming SKUs and fires 15% flash discounts — synced to Google Ads in real time.
        </p>
        <button
          onClick={onContact}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 text-white text-sm font-semibold shadow-md shadow-orange-200 hover:shadow-lg hover:shadow-orange-300 transition-all"
        >
          <Sparkles className="w-4 h-4" />
          Upgrade to Elite
        </button>
        <p className="text-xs text-gray-400 mt-3">Contact your account manager or email growth@omnianalytix.io</p>
      </div>
    </div>
  );
}

function PoasBadge({ poas }: { poas: number }) {
  const color = poas < 1.0 ? "text-rose-600 bg-rose-50 border-rose-200"
              : poas < 1.5 ? "text-amber-600 bg-amber-50 border-amber-200"
              : "text-emerald-600 bg-emerald-50 border-emerald-200";
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono font-bold border", color)}>
      <TrendingDown className="w-2.5 h-2.5" />
      {poas.toFixed(2)}x
    </span>
  );
}

export default function PromoEnginePage() {
  const { isElite, isLoading: tierLoading } = useSubscription();
  const [stats, setStats]       = useState<PromoStats | null>(null);
  const [triggers, setTriggers] = useState<PromoTrigger[]>([]);
  const [loading, setLoading]   = useState(true);
  const [running, setRunning]   = useState(false);
  const [acting, setActing]     = useState<Record<number, boolean>>({});
  const [runResult, setRunResult] = useState<{ triggered: number; skipped: number } | null>(null);
  const [showGate, setShowGate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statsResp, trigResp] = await Promise.all([
        authFetch(`${API}api/promo-engine/stats`),
        authFetch(`${API}api/promo-engine/triggers?limit=100`),
      ]);
      if (statsResp.ok) setStats(await statsResp.json());
      if (trigResp.ok)  setTriggers((await trigResp.json()).triggers ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!tierLoading) void load();
  }, [tierLoading, load]);

  useEffect(() => {
    if (!tierLoading && !isElite) setShowGate(true);
  }, [tierLoading, isElite]);

  const handleRunNow = async () => {
    if (!isElite) { setShowGate(true); return; }
    setRunning(true);
    setRunResult(null);
    try {
      const resp = await authFetch(`${API}api/promo-engine/run`, { method: "POST" });
      const data = await resp.json() as { triggered?: number; skipped?: number };
      setRunResult({ triggered: data.triggered ?? 0, skipped: data.skipped ?? 0 });
      await load();
    } finally {
      setRunning(false);
    }
  };

  const handleApprove = async (id: number) => {
    setActing((p) => ({ ...p, [id]: true }));
    try {
      await authFetch(`${API}api/promo-engine/triggers/${id}/approve`, { method: "POST" });
      await load();
    } finally {
      setActing((p) => ({ ...p, [id]: false }));
    }
  };

  const handleReject = async (id: number) => {
    setActing((p) => ({ ...p, [id]: true }));
    try {
      await authFetch(`${API}api/promo-engine/triggers/${id}/reject`, { method: "POST" });
      await load();
    } finally {
      setActing((p) => ({ ...p, [id]: false }));
    }
  };

  const totalRecovery = parseFloat(String(stats?.total_recovery ?? "0"));

  return (
    <div className="min-h-screen bg-gray-50/50 p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-500 to-rose-500 flex items-center justify-center shadow-md shadow-orange-200">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900">Promotional Intelligence Engine</h1>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-gradient-to-r from-orange-500 to-rose-500 text-white">
                <Crown className="w-2.5 h-2.5" />
                ELITE
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              Automatically fires 15% flash discounts when inventory is high and POAS is dropping
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            className="p-2 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => void handleRunNow()}
            disabled={running}
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all",
              isElite
                ? "bg-gradient-to-r from-orange-500 to-rose-500 text-white shadow-md shadow-orange-200 hover:shadow-lg hover:shadow-orange-300"
                : "bg-gray-100 text-gray-400 cursor-not-allowed",
            )}
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            {running ? "Analyzing…" : "Run Analysis"}
          </button>
        </div>
      </div>

      {/* Run result toast */}
      {runResult && (
        <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Analysis complete — {runResult.triggered} trigger(s) created, {runResult.skipped} SKU(s) skipped
        </div>
      )}

      {/* Trigger logic explainer */}
      <div className="mb-6 p-4 rounded-2xl bg-white border border-orange-100 flex items-start gap-4 shadow-sm">
        <AlertTriangle className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
              <Package className="w-3.5 h-3.5 text-orange-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-800">Inventory Signal</p>
              <p className="text-gray-500 text-xs">Stock &gt; 500 units</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-rose-100 flex items-center justify-center shrink-0">
              <TrendingDown className="w-3.5 h-3.5 text-rose-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-800">POAS Signal</p>
              <p className="text-gray-500 text-xs">7-day avg POAS &lt; 1.5x</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
              <Zap className="w-3.5 h-3.5 text-emerald-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-800">Auto Action</p>
              <p className="text-gray-500 text-xs">15% flash promo → Shopify + Google Ads</p>
            </div>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-300 shrink-0 mt-0.5" />
      </div>

      {/* Stats row */}
      <div className={cn("grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6 relative", !isElite && "pointer-events-none")}>
        {!isElite && showGate && (
          <EliteGate onContact={() => window.open("mailto:growth@omnianalytix.io", "_blank")} />
        )}
        <StatCard
          label="Total Triggers"
          value={loading ? "—" : Number(stats?.total ?? 0)}
          icon={<Zap className="w-4 h-4 text-orange-500" />}
          sub="All time"
          accent="border-orange-200"
        />
        <StatCard
          label="Pending Review"
          value={loading ? "—" : Number(stats?.pending ?? 0)}
          icon={<Clock className="w-4 h-4 text-amber-500" />}
          sub="Awaiting approval"
        />
        <StatCard
          label="Approved"
          value={loading ? "—" : Number(stats?.approved ?? 0)}
          icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />}
          sub="Flash sales activated"
        />
        <StatCard
          label="Est. Recovery"
          value={loading ? "—" : <MoneyTile usd={totalRecovery} decimals={0} />}
          icon={<DollarSign className="w-4 h-4 text-orange-500" />}
          sub="Projected profit lift"
          accent="border-orange-200"
        />
      </div>

      {/* Triggers table */}
      <div className={cn("bg-white rounded-2xl border border-gray-200 shadow-sm relative", !isElite && "pointer-events-none")}>
        {!isElite && showGate && (
          <EliteGate onContact={() => window.open("mailto:growth@omnianalytix.io", "_blank")} />
        )}

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">Automated Trigger Queue</h2>
          <span className="text-xs text-gray-400">{triggers.length} item(s)</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-orange-400 animate-spin" />
          </div>
        ) : triggers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Target className="w-10 h-10 mb-3 text-gray-200" />
            <p className="text-sm font-medium">No triggers yet</p>
            <p className="text-xs mt-1">Run the analysis to detect overstocked, low-POAS SKUs</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {triggers.map((t) => {
              const poas     = parseFloat(t.avg_poas_7d ?? "0");
              const inv      = t.inventory_qty ?? 0;
              const rec      = parseFloat(t.projected_recovery ?? "0");
              const statusCfg = STATUS_CFG[t.status] ?? STATUS_CFG.pending!;
              const isActing  = acting[t.id];

              return (
                <div key={t.id} className="px-5 py-4 hover:bg-gray-50/50 transition-colors">
                  <div className="flex items-start gap-4">
                    {/* Product info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-sm font-semibold text-gray-900 truncate">
                          {t.product_title ?? t.sku ?? "Unknown Product"}
                        </span>
                        {t.sku && t.sku !== t.product_title && (
                          <span className="text-xs font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                            {t.sku}
                          </span>
                        )}
                        <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border", statusCfg.cls)}>
                          {statusCfg.icon}
                          {statusCfg.label}
                        </span>
                      </div>

                      <div className="flex items-center gap-4 flex-wrap text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Package className="w-3 h-3" />
                          {inv.toLocaleString()} units
                        </span>
                        <span className="flex items-center gap-1">
                          POAS: <PoasBadge poas={poas} />
                        </span>
                        {t.promo_code && (
                          <span className="flex items-center gap-1">
                            <SiShopify className="w-3 h-3 text-emerald-500" />
                            <code className="font-mono text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded border border-orange-100">
                              {t.promo_code}
                            </code>
                          </span>
                        )}
                        {t.google_ads_asset_id && (
                          <span className="flex items-center gap-1 text-blue-500">
                            <SiGoogleads className="w-3 h-3" />
                            Ad asset synced
                          </span>
                        )}
                        {rec > 0 && (
                          <span className="flex items-center gap-1 text-emerald-600 font-semibold">
                            <DollarSign className="w-3 h-3" />
                            <MoneyTile usd={rec} decimals={0} /> projected recovery
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    {t.status === "pending" && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => void handleReject(t.id)}
                          disabled={!!isActing}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-500 hover:border-rose-200 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40 transition-colors"
                        >
                          {isActing ? <Loader2 className="w-3 h-3 animate-spin" /> : "✕ Reject"}
                        </button>
                        <button
                          onClick={() => void handleApprove(t.id)}
                          disabled={!!isActing}
                          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold bg-gradient-to-r from-orange-500 to-rose-500 text-white shadow-sm shadow-orange-200 hover:shadow-md hover:shadow-orange-300 disabled:opacity-50 transition-all"
                        >
                          {isActing ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShoppingCart className="w-3 h-3" />}
                          {isActing ? "Activating…" : "Approve & Activate"}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Approval reasoning */}
                  {t.status === "pending" && (
                    <div className="mt-3 p-3 rounded-xl bg-orange-50 border border-orange-100">
                      <p className="text-xs text-orange-700 leading-relaxed">
                        <span className="font-semibold">Liquidate Stock:</span> Approve 15% discount for{" "}
                        <strong>{t.product_title ?? t.sku}</strong> to improve POAS from{" "}
                        <strong>{poas.toFixed(2)}x → ≥1.5x</strong>.{" "}
                        {rec > 0 && <>Projected Profit Recovery: <strong><MoneyTile usd={rec} decimals={0} /></strong> over 7 days.</>}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Feature explainer (non-elite blurred) */}
      {!isElite && !tierLoading && (
        <div className="mt-4 p-4 rounded-2xl bg-white border border-gray-200 text-center">
          <Lock className="w-5 h-5 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-400">
            Upgrade to <strong className="text-gray-600">OmniAnalytix Elite</strong> to unlock the Promotional Intelligence Engine
          </p>
        </div>
      )}
    </div>
  );
}
