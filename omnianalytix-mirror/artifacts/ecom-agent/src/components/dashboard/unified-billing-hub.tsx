import { useState, useEffect, useMemo } from "react";
import { DollarSign, ExternalLink, Loader2, RefreshCw, AlertCircle, CalendarDays, X, TrendingUp } from "lucide-react";
import { SiGoogleads, SiMeta } from "react-icons/si";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth-fetch";
import { formatUsdInDisplay } from "@/lib/fx-format";
import { useCurrency } from "@/contexts/currency-context";

const BASE = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

function thirtyDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

interface SpendRow {
  date: string;
  spend: number;
  platform: string;
}

interface BillingData {
  totalOutstanding: number;
  currency: string;
  spendByDay: SpendRow[];
  totalSpend30d: number;
  platforms: {
    google_ads: { connected: boolean; accountId: string | null; spend30d: number; billingUrl: string | null };
    meta: { connected: boolean; accountId: string | null; spend30d: number; billingUrl: string | null };
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function fmtCurrency(val: number, _sym: string): string {
  return formatUsdInDisplay(val, { decimals: 2 });
}

function fmtDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function UnifiedBillingHub() {
  const { currencySymbol: sym } = useCurrency();
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo());
  const [dateTo, setDateTo] = useState(todayISO());
  const [dateFilterActive, setDateFilterActive] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`${API_BASE}api/billing-hub/invoices`);
      if (!res.ok) throw new Error("Failed to load billing data");
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const filteredSpend = useMemo(() => {
    if (!data) return [];
    if (!dateFilterActive) return data.spendByDay ?? [];
    const lo = dateFrom <= dateTo ? dateFrom : dateTo;
    const hi = dateFrom <= dateTo ? dateTo : dateFrom;
    return (data.spendByDay ?? []).filter((r) => r.date >= lo && r.date <= hi);
  }, [data, dateFilterActive, dateFrom, dateTo]);

  const filteredTotal = useMemo(
    () => filteredSpend.reduce((s, r) => s + (Number(r.spend) || 0), 0),
    [filteredSpend],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-on-surface-variant" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-error-m3/20 bg-error-container p-6 text-center">
        <AlertCircle className="w-8 h-8 text-rose-400 mx-auto mb-2" />
        <p className="text-sm text-on-error-container">{error}</p>
        <button onClick={fetchData} className="mt-3 text-xs text-error-m3 underline">Retry</button>
      </div>
    );
  }

  if (!data) return null;

  const hasPlatforms = data.platforms.google_ads.connected || data.platforms.meta.connected;

  if (!hasPlatforms) {
    return (
      <div className="rounded-2xl border border-outline-variant/15 bg-white p-8 text-center">
        <DollarSign className="w-10 h-10 text-outline-variant mx-auto mb-3" />
        <p className="text-sm font-medium text-on-surface-variant">No ad platforms connected</p>
        <p className="text-xs text-on-surface-variant mt-1">Connect Google Ads or Meta Ads to view billing data.</p>
      </div>
    );
  }

  const maxSpend = Math.max(...filteredSpend.map((r) => r.spend), 1);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-outline-variant/15 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-2xl bg-on-surface flex items-center justify-center">
              <DollarSign className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-on-surface">Billing Hub</h3>
              <p className="text-[11px] text-on-surface-variant">Cross-platform spend & billing</p>
            </div>
          </div>
          <button
            onClick={fetchData}
            className="p-2 rounded-2xl hover:bg-surface transition-colors text-on-surface-variant hover:text-on-surface-variant"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        <div className="rounded-2xl border ghost-border bg-surface/50 p-4 mb-4">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-[0.15em] mb-1">Total Ad Spend (30d)</p>
          <p className="text-2xl font-bold font-mono text-on-surface">
            {fmtCurrency(data.totalSpend30d ?? 0, sym)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          {data.platforms.google_ads.connected && (
            <div className="rounded-2xl border ghost-border bg-white p-3.5">
              <div className="flex items-center gap-2 mb-2">
                <SiGoogleads className="w-4 h-4 text-[#4285F4]" />
                <span className="text-xs font-medium text-on-surface-variant">Google Ads</span>
              </div>
              <p className="text-lg font-bold font-mono text-on-surface">
                {fmtCurrency(data.platforms.google_ads.spend30d ?? 0, sym)}
              </p>
              <p className="text-[10px] text-on-surface-variant mt-0.5">30-day spend</p>
              {data.platforms.google_ads.billingUrl && (
                <a
                  href={data.platforms.google_ads.billingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-[10px] text-primary-container font-medium hover:underline"
                >
                  View in Google Ads <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
            </div>
          )}
          {data.platforms.meta.connected && (
            <div className="rounded-2xl border ghost-border bg-white p-3.5">
              <div className="flex items-center gap-2 mb-2">
                <SiMeta className="w-4 h-4 text-[#1877F2]" />
                <span className="text-xs font-medium text-on-surface-variant">Meta Ads</span>
              </div>
              <p className="text-lg font-bold font-mono text-on-surface">
                {fmtCurrency(data.platforms.meta.spend30d ?? 0, sym)}
              </p>
              <p className="text-[10px] text-on-surface-variant mt-0.5">30-day spend</p>
              {data.platforms.meta.billingUrl && (
                <a
                  href={data.platforms.meta.billingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-[10px] text-primary-container font-medium hover:underline"
                >
                  View in Meta <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">
            <TrendingUp className="w-3 h-3" />
            Campaign Spend {dateFilterActive ? `(${fmtCurrency(filteredTotal, sym)})` : ""}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setDateFilterActive(true); }}
              className="text-[11px] border border-zinc-200 rounded-2xl bg-white px-2.5 py-1.5 focus:ring-2 focus:ring-primary-container/20 focus:border-primary-container/40 outline-none transition-all text-on-surface-variant"
            />
            <span className="text-[10px] text-outline-variant">—</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setDateFilterActive(true); }}
              className="text-[11px] border border-zinc-200 rounded-2xl bg-white px-2.5 py-1.5 focus:ring-2 focus:ring-primary-container/20 focus:border-primary-container/40 outline-none transition-all text-on-surface-variant"
            />
            {dateFilterActive && (
              <button
                onClick={() => { setDateFilterActive(false); setDateFrom(thirtyDaysAgo()); setDateTo(todayISO()); }}
                className="p-1 rounded-2xl hover:bg-surface-container-low transition-colors text-on-surface-variant"
                title="Clear date filter"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {filteredSpend.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <CalendarDays className="w-6 h-6 text-outline-variant mx-auto mb-2" />
            <p className="text-xs font-medium text-on-surface-variant">No spend data for the selected date range.</p>
            {dateFilterActive && (
              <button
                onClick={() => { setDateFilterActive(false); setDateFrom(thirtyDaysAgo()); setDateTo(todayISO()); }}
                className="mt-2 text-[10px] text-primary-container font-semibold hover:underline"
              >
                Show all data
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-0">
            <div className="flex items-center gap-1 px-3 py-2 border-b ghost-border">
              <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider w-32">Campaign</span>
              <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider flex-1">Spend</span>
              <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider w-16 text-right">Amount</span>
            </div>
            {filteredSpend.map((row, i) => (
              <div
                key={`${row.date}-${i}`}
                className="flex items-center gap-1 px-3 py-2.5 border-b border-[#f9f9fe] last:border-b-0 hover:bg-surface/50 transition-colors"
              >
                <span className="text-[11px] font-medium text-on-surface w-32 truncate" title={row.date}>{row.date}</span>
                <div className="flex-1 h-4 bg-surface-container-low rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-400 to-indigo-500 rounded-full transition-all duration-300"
                    style={{ width: `${Math.max((row.spend / maxSpend) * 100, 2)}%` }}
                  />
                </div>
                <span className="text-[11px] font-mono font-semibold text-on-surface w-16 text-right">
                  {fmtCurrency(row.spend, sym)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
