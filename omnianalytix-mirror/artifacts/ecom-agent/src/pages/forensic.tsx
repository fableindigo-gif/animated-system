import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "react-resizable-panels";
import {
  ShoppingCart, BarChart3, TrendingUp, TrendingDown, AlertTriangle,
  GripVertical, Filter, Calendar, Search, Package, Megaphone,
  DollarSign, Eye, MousePointer, ShoppingBag, Tag, Layers, RefreshCw,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/contexts/workspace-context";
import { useCurrency } from "@/contexts/currency-context";
import { authFetch } from "@/lib/auth-fetch";

const BASE_URL = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE_URL.endsWith("/") ? BASE_URL.slice(0, -1) : BASE_URL;

type DateRange = "7d" | "14d" | "30d" | "90d";

interface ShopifyEvent {
  id: string;
  date: string;
  sku: string;
  productName: string;
  revenue: number;
  orders: number;
  units: number;
  source: string;
  conversionRate: number;
}

interface AdEvent {
  id: string;
  date: string;
  campaignName: string;
  platform: "Google Ads" | "Meta Ads";
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  attributedRevenue: number;
  roas: number;
  matchedSku: string | null;
}

interface LeakEntry {
  sku: string;
  productName: string;
  shopifyRevenue: number;
  adSpend: number;
  adAttributedRevenue: number;
  discrepancy: number;
  discrepancyPct: number;
  severity: "critical" | "warning" | "info";
}

type WorkspaceGoal = "ecom" | "leadgen" | "hybrid";

interface LeadEvent {
  id: string;
  date: string;
  leadName: string;
  company: string;
  stage: "MQL" | "SQL" | "Opportunity" | "Closed Won" | "Closed Lost";
  source: string;
  value: number;
  score: number;
}

interface FunnelLeak {
  stage: string;
  entered: number;
  exited: number;
  dropRate: number;
  adSpend: number;
  costPerLead: number;
  severity: "critical" | "warning" | "info";
}

function dateRangeToDays(dr: DateRange): number {
  return dr === "7d" ? 7 : dr === "14d" ? 14 : dr === "30d" ? 30 : 90;
}

interface ForensicDataState {
  shopify: ShopifyEvent[];
  ads: AdEvent[];
  leaks: LeakEntry[];
  loading: boolean;
  error: string | null;
}

function useForensicData(dateRange: DateRange, searchTerm: string): ForensicDataState {
  const days = dateRangeToDays(dateRange);
  const query = useQuery({
    queryKey: queryKeys.forensicEcom(days),
    queryFn: async () => {
      const [productsRes, channelsRes, leaksRes] = await Promise.all([
        authFetch(`${API_BASE}/api/warehouse/products?days=${days}&page_size=100`),
        authFetch(`${API_BASE}/api/warehouse/channels?days=${days}&page_size=100`),
        authFetch(`${API_BASE}/api/warehouse/margin-leaks?days=${days}&page_size=100`),
      ]);
      if (!productsRes.ok && !channelsRes.ok && !leaksRes.ok) {
        throw new Error("Failed to load forensic data");
      }
      const productsJson = productsRes.ok ? await productsRes.json() : { data: [] };
      const channelsJson = channelsRes.ok ? await channelsRes.json() : { data: [] };
      const leaksJson = leaksRes.ok ? await leaksRes.json() : { data: [] };

      const products: any[] = productsJson.data ?? [];
      const channels: any[] = channelsJson.data ?? [];
      const leakRows: any[] = leaksJson.data ?? [];

      const shopify: ShopifyEvent[] = products.map((p: any, i: number) => ({
        id: `sp-${i}`,
        date: new Date().toISOString().slice(0, 10),
        sku: p.sku ?? "Unknown SKU",
        productName: p.name ?? p.productTitle ?? "Untitled",
        revenue: Number(p.revenue) || 0,
        orders: Math.round(Number(p.spend) > 0 ? Number(p.revenue) / (Number(p.spend) / (Number(p.conversions) || 1)) : 0),
        units: Math.round(Number(p.conversions) || 0),
        source: p.platform ?? "Google",
        conversionRate: Number(p.netMargin) || 0,
      }));

      const ads: AdEvent[] = channels.map((c: any, i: number) => ({
        id: `ad-${i}`,
        date: new Date().toISOString().slice(0, 10),
        campaignName: c.campaignName ?? "Unnamed",
        platform: "Google Ads" as const,
        spend: Number(c.spend) || 0,
        impressions: Number(c.impressions) || 0,
        clicks: Number(c.clicks) || 0,
        conversions: Number(c.conversions) || 0,
        attributedRevenue: (Number(c.conversions) || 0) * (Number(c.roas) > 0 ? Number(c.spend) * Number(c.roas) / (Number(c.conversions) || 1) : 0),
        roas: Number(c.roas) || 0,
        matchedSku: null,
      }));

      const skuRevenueMap = new Map<string, number>();
      shopify.forEach((s) => {
        skuRevenueMap.set(s.sku, (skuRevenueMap.get(s.sku) ?? 0) + s.revenue);
      });

      const leaks: LeakEntry[] = leakRows.map((l: any) => {
        const shopRev = skuRevenueMap.get(l.sku) ?? 0;
        const adSpend = Number(l.wastedSpend) || 0;
        const adAttr = 0;
        const disc = adAttr - shopRev;
        const discPct = shopRev > 0 ? parseFloat(((disc / shopRev) * 100).toFixed(1)) : adSpend > 0 ? -100 : 0;
        const sev: LeakEntry["severity"] = Math.abs(discPct) > 30 ? "critical" : Math.abs(discPct) > 10 ? "warning" : "info";
        return {
          sku: l.sku ?? "Unknown SKU",
          productName: l.productTitle ?? "Untitled",
          shopifyRevenue: shopRev,
          adSpend,
          adAttributedRevenue: adAttr,
          discrepancy: disc,
          discrepancyPct: discPct,
          severity: sev,
        };
      });

      return { shopify, ads, leaks };
    },
  });

  const raw = query.data ?? { shopify: [], ads: [], leaks: [] };

  const filtered = useMemo(() => {
    if (!searchTerm) return raw;
    const term = searchTerm.toLowerCase();
    return {
      shopify: raw.shopify.filter((e) => e.productName.toLowerCase().includes(term) || e.sku.toLowerCase().includes(term)),
      ads: raw.ads.filter((e) => e.campaignName.toLowerCase().includes(term) || (e.matchedSku?.toLowerCase().includes(term) ?? false)),
      leaks: raw.leaks.filter((e) => e.productName.toLowerCase().includes(term) || e.sku.toLowerCase().includes(term)),
    };
  }, [raw, searchTerm]);

  return { ...filtered, loading: query.isLoading, error: query.isError ? "Failed to load forensic data" : null };
}

interface LeadgenDataState {
  leads: LeadEvent[];
  ads: AdEvent[];
  funnelLeaks: FunnelLeak[];
  loading: boolean;
  error: string | null;
}

function useLeadgenData(dateRange: DateRange, searchTerm: string): LeadgenDataState {
  const days = dateRangeToDays(dateRange);
  const query = useQuery({
    queryKey: queryKeys.forensicLeadgen(days),
    queryFn: async () => {
      const [channelsRes, pipelineRes] = await Promise.all([
        authFetch(`${API_BASE}/api/warehouse/channels?days=${days}&page_size=100`),
        authFetch(`${API_BASE}/api/warehouse/pipeline-triage?days=${days}`),
      ]);
      if (!channelsRes.ok && !pipelineRes.ok) throw new Error("Failed to load lead data");
      const channelsJson = channelsRes.ok ? await channelsRes.json() : { data: [] };
      const pipelineJson = pipelineRes.ok ? await pipelineRes.json() : { data: [] };

      const channels: any[] = channelsJson.data ?? [];
      const pipelineStages: any[] = pipelineJson.data ?? [];

      const leads: LeadEvent[] = pipelineStages.map((s: any, i: number) => {
        const convRate = Number(s.convRate) || 0;
        const severity = convRate < 0.01 ? "Closed Lost" : convRate < 0.05 ? "MQL" : convRate < 0.1 ? "SQL" : convRate < 0.2 ? "Opportunity" : "Closed Won";
        return {
          id: `lead-${i}`,
          date: new Date().toISOString().slice(0, 10),
          leadName: s.campaignName ?? `Campaign ${i + 1}`,
          company: "—",
          stage: severity as LeadEvent["stage"],
          source: "Google Ads",
          value: Number(s.spend) || 0,
          score: Math.min(100, Math.round(convRate * 100)),
        };
      });

      const ads: AdEvent[] = channels.map((c: any, i: number) => ({
        id: `lad-${i}`,
        date: new Date().toISOString().slice(0, 10),
        campaignName: c.campaignName ?? "Unnamed",
        platform: "Google Ads" as const,
        spend: Number(c.spend) || 0,
        impressions: Number(c.impressions) || 0,
        clicks: Number(c.clicks) || 0,
        conversions: Number(c.conversions) || 0,
        attributedRevenue: Number(c.spend) * (Number(c.roas) || 0),
        roas: Number(c.roas) || 0,
        matchedSku: null,
      }));

      const totalImpressions = ads.reduce((s, a) => s + a.impressions, 0);
      const totalClicks = ads.reduce((s, a) => s + a.clicks, 0);
      const totalConversions = ads.reduce((s, a) => s + a.conversions, 0);
      const totalSpend = ads.reduce((s, a) => s + a.spend, 0);

      const funnelLeaks: FunnelLeak[] = [];
      if (totalImpressions > 0) {
        const clickRate = totalImpressions > 0 ? ((totalImpressions - totalClicks) / totalImpressions) * 100 : 0;
        funnelLeaks.push({
          stage: "Impression → Click",
          entered: totalImpressions,
          exited: totalClicks,
          dropRate: parseFloat(clickRate.toFixed(1)),
          adSpend: totalSpend,
          costPerLead: totalImpressions > 0 ? parseFloat((totalSpend / totalImpressions).toFixed(2)) : 0,
          severity: clickRate > 98 ? "warning" : "info",
        });
      }
      if (totalClicks > 0) {
        const convRate = totalClicks > 0 ? ((totalClicks - totalConversions) / totalClicks) * 100 : 0;
        funnelLeaks.push({
          stage: "Click → Conversion",
          entered: totalClicks,
          exited: totalConversions,
          dropRate: parseFloat(convRate.toFixed(1)),
          adSpend: totalSpend,
          costPerLead: totalConversions > 0 ? parseFloat((totalSpend / totalConversions).toFixed(2)) : 0,
          severity: convRate > 95 ? "critical" : convRate > 80 ? "warning" : "info",
        });
      }

      return { leads, ads, funnelLeaks };
    },
  });

  const raw = query.data ?? { leads: [], ads: [], funnelLeaks: [] };

  const filtered = useMemo(() => {
    if (!searchTerm) return raw;
    const term = searchTerm.toLowerCase();
    return {
      leads: raw.leads.filter((l) => l.leadName.toLowerCase().includes(term) || l.company.toLowerCase().includes(term)),
      ads: raw.ads.filter((e) => e.campaignName.toLowerCase().includes(term)),
      funnelLeaks: raw.funnelLeaks,
    };
  }, [raw, searchTerm]);

  return { ...filtered, loading: query.isLoading, error: query.isError ? "Failed to load lead data" : null };
}

function ForensicHeader({
  dateRange,
  setDateRange,
  searchTerm,
  setSearchTerm,
  leaks,
  ads,
}: {
  dateRange: DateRange;
  setDateRange: (d: DateRange) => void;
  searchTerm: string;
  setSearchTerm: (s: string) => void;
  leaks: LeakEntry[];
  ads: AdEvent[];
}) {
  const criticalCount = leaks.filter((l) => l.severity === "critical").length;
  const unmappedCount = ads.filter((a) => a.matchedSku === null).length;
  const infoCount = leaks.filter((l) => l.severity === "info").length;

  return (
    <div className="shrink-0 border-b border-outline-variant/15 bg-white">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Layers className="w-4 h-4 text-accent-blue shrink-0" />
          <h1 className="text-sm font-bold text-on-surface truncate">Forensic Auditor</h1>
          <span className="text-xs sm:text-[9px] font-bold text-on-secondary-container px-1.5 py-0.5 rounded-full bg-surface-container-low">
            SPLIT VIEW
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-on-surface-variant" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filter SKU or campaign..."
              className="pl-7 pr-3 py-1.5 text-xs sm:text-[11px] bg-surface-container-low border border-outline-variant/20 rounded-2xl text-on-surface placeholder:text-on-surface-variant focus:border-accent-blue/40 focus:outline-none w-48"
            />
          </div>

          <div className="flex items-center rounded-2xl border border-outline-variant/20 bg-surface-container-low overflow-hidden">
            {(["7d", "14d", "30d", "90d"] as DateRange[]).map((d) => (
              <button
                key={d}
                onClick={() => setDateRange(d)}
                className={cn(
                  "px-2.5 py-1.5 text-xs sm:text-[10px] font-semibold transition-colors",
                  dateRange === d
                    ? "bg-accent-blue/10 text-accent-blue"
                    : "text-on-secondary-container hover:text-on-surface"
                )}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 px-4 pb-2.5">
        {criticalCount > 0 && <LeakSummaryBadge severity="critical" count={criticalCount} label="Revenue Leaks" />}
        {unmappedCount > 0 && <LeakSummaryBadge severity="warning" count={unmappedCount} label="Unmapped SKU" />}
        {infoCount > 0 && <LeakSummaryBadge severity="info" count={infoCount} label="Over-Attribution" />}
      </div>
    </div>
  );
}

function LeakSummaryBadge({ severity, count, label }: { severity: string; count: number; label: string }) {
  const colors: Record<string, string> = {
    critical: "bg-error-container border-error-m3/20 text-error-m3",
    warning: "bg-amber-50 border-amber-200 text-amber-600",
    info: "bg-primary-container/10 border-primary-container/20 text-accent-blue",
  };
  return (
    <span className={cn("text-xs sm:text-[10px] font-bold px-2 py-0.5 rounded-full border", colors[severity])}>
      {count} {label}
    </span>
  );
}

function ShopifyPanel({ events, selectedSku, onSelectSku }: {
  events: ShopifyEvent[];
  selectedSku: string | null;
  onSelectSku: (sku: string | null) => void;
}) {
  const { currencySymbol: sym } = useCurrency();
  const totalRevenue = events.reduce((s, e) => s + e.revenue, 0);
  const totalOrders = events.reduce((s, e) => s + e.orders, 0);

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="shrink-0 px-4 py-3 border-b border-outline-variant/15">
        <div className="flex items-center gap-2 mb-2">
          <ShoppingCart className="w-3.5 h-3.5 text-emerald-600" />
          <span className="text-xs sm:text-[10px] font-bold text-emerald-700 uppercase tracking-widest">
            Shopify / Frontend Data
          </span>
        </div>
        <div className="flex gap-4">
          <div>
            <p className="text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase">Revenue</p>
            <p className="text-sm font-bold text-on-surface">{sym}{totalRevenue.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase">Orders</p>
            <p className="text-sm font-bold text-on-surface">{totalOrders.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase">Events</p>
            <p className="text-sm font-bold text-on-surface">{events.length}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-container-low">
            <tr>
              <th className="text-left text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-2">Date</th>
              <th className="text-left text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-2">Product</th>
              <th className="text-right text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-2">Revenue</th>
              <th className="text-right text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-2">Orders</th>
              <th className="text-right text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-2">CVR</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr
                key={e.id}
                onClick={() => onSelectSku(selectedSku === e.sku ? null : e.sku)}
                className={cn(
                  "cursor-pointer border-b ghost-border transition-colors",
                  selectedSku === e.sku
                    ? "bg-accent-blue/5 border-l-2 border-l-accent-blue"
                    : "hover:bg-surface"
                )}
              >
                <td className="text-xs sm:text-[11px] text-on-surface-variant px-3 py-2">{e.date.slice(5)}</td>
                <td className="px-3 py-2">
                  <div className="text-xs sm:text-[11px] text-on-surface">{e.productName}</div>
                  <div className="text-xs sm:text-[9px] text-on-surface-variant">{e.sku}</div>
                </td>
                <td className="text-right text-xs sm:text-[11px] font-medium text-emerald-600 px-3 py-2">{sym}{e.revenue.toLocaleString()}</td>
                <td className="text-right text-xs sm:text-[11px] text-on-surface-variant px-3 py-2">{e.orders}</td>
                <td className="text-right text-xs sm:text-[11px] text-on-surface-variant px-3 py-2">{e.conversionRate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdPlatformPanel({ events, selectedSku }: {
  events: AdEvent[];
  selectedSku: string | null;
}) {
  const { currencySymbol: sym } = useCurrency();
  const filtered = selectedSku
    ? events.filter((e) => e.matchedSku === selectedSku)
    : events;

  const totalSpend = filtered.reduce((s, e) => s + e.spend, 0);
  const totalConversions = filtered.reduce((s, e) => s + e.conversions, 0);
  const totalAttrRevenue = filtered.reduce((s, e) => s + e.attributedRevenue, 0);
  const blendedRoas = totalSpend > 0 ? totalAttrRevenue / totalSpend : 0;

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="shrink-0 px-4 py-3 border-b border-outline-variant/15">
        <div className="flex items-center gap-2 mb-2">
          <Megaphone className="w-3.5 h-3.5 text-accent-blue" />
          <span className="text-xs sm:text-[10px] font-bold text-accent-blue uppercase tracking-widest">
            Ad Platform Attribution
          </span>
          {selectedSku && (
            <span className="text-xs sm:text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-accent-blue/10 text-accent-blue">
              Filtered: {selectedSku}
            </span>
          )}
        </div>
        <div className="flex gap-4">
          <div>
            <p className="text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase">Spend</p>
            <p className="text-sm font-bold text-on-surface">{sym}{totalSpend.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase">Conversions</p>
            <p className="text-sm font-bold text-on-surface">{totalConversions}</p>
          </div>
          <div>
            <p className="text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase">Blended ROAS</p>
            <p className={cn("text-sm font-bold", blendedRoas >= 4 ? "text-emerald-600" : blendedRoas >= 2 ? "text-amber-500" : "text-error-m3")}>
              {blendedRoas.toFixed(1)}x
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-container-low">
            <tr>
              <th className="text-left text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-2">Date</th>
              <th className="text-left text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-2">Campaign</th>
              <th className="text-right text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-2">Spend</th>
              <th className="text-right text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-2">Conv</th>
              <th className="text-right text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-2">ROAS</th>
              <th className="text-center text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-2">SKU</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id} className="border-b ghost-border hover:bg-surface transition-colors">
                <td className="text-xs sm:text-[11px] text-on-surface-variant px-3 py-2">{e.date.slice(5)}</td>
                <td className="px-3 py-2">
                  <div className="text-xs sm:text-[11px] text-on-surface truncate max-w-[180px]">{e.campaignName}</div>
                  <div className={cn("text-xs sm:text-[9px] font-medium", e.platform === "Google Ads" ? "text-primary-container" : "text-violet-500")}>{e.platform}</div>
                </td>
                <td className="text-right text-xs sm:text-[11px] font-medium text-error-m3 px-3 py-2">{sym}{e.spend.toLocaleString()}</td>
                <td className="text-right text-xs sm:text-[11px] text-on-surface-variant px-3 py-2">{e.conversions}</td>
                <td className={cn("text-right text-xs sm:text-[11px] font-bold px-3 py-2", e.roas >= 5 ? "text-emerald-600" : e.roas >= 3 ? "text-amber-500" : "text-error-m3")}>
                  {e.roas.toFixed(1)}x
                </td>
                <td className="text-center px-3 py-2">
                  {e.matchedSku ? (
                    <span className="text-xs sm:text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600">{e.matchedSku}</span>
                  ) : (
                    <span className="text-xs sm:text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600">Unmapped</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-xs sm:text-[11px] text-on-surface-variant py-8">
                  No ad data {selectedSku ? `linked to ${selectedSku}` : "found"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LeakSummaryPanel({ leaks }: { leaks: LeakEntry[] }) {
  const { currencySymbol: sym } = useCurrency();
  return (
    <div className="shrink-0 border-t border-outline-variant/15 bg-white">
      <div className="flex items-center gap-2 px-4 py-2 border-b ghost-border">
        <AlertTriangle className="w-3 h-3 text-error-m3" />
        <span className="text-xs sm:text-[9px] font-bold text-error-m3 uppercase tracking-widest">
          Attribution Discrepancy Matrix
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-surface-container-low">
              <th className="text-left text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-1.5">SKU</th>
              <th className="text-right text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-1.5">Shopify Rev</th>
              <th className="text-right text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-1.5">Ad Spend</th>
              <th className="text-right text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-1.5">Ad Attributed</th>
              <th className="text-right text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-1.5">Gap</th>
              <th className="text-center text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-1.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {leaks.map((l) => (
              <tr key={l.sku} className="border-b ghost-border">
                <td className="px-3 py-1.5">
                  <div className="text-xs sm:text-[11px] text-on-surface">{l.productName}</div>
                  <div className="text-xs sm:text-[9px] text-on-surface-variant">{l.sku}</div>
                </td>
                <td className="text-right text-xs sm:text-[11px] font-medium text-emerald-600 px-3 py-1.5">{sym}{l.shopifyRevenue.toLocaleString()}</td>
                <td className="text-right text-xs sm:text-[11px] font-medium text-error-m3 px-3 py-1.5">{sym}{l.adSpend.toLocaleString()}</td>
                <td className="text-right text-xs sm:text-[11px] font-medium text-accent-blue px-3 py-1.5">{sym}{l.adAttributedRevenue.toLocaleString()}</td>
                <td className={cn("text-right text-xs sm:text-[11px] font-bold px-3 py-1.5",
                  l.discrepancy > 0 ? "text-emerald-600" : l.discrepancyPct < -30 ? "text-error-m3" : "text-amber-500"
                )}>
                  {l.discrepancy > 0 ? "+" : ""}{l.discrepancyPct.toFixed(1)}%
                </td>
                <td className="text-center px-3 py-1.5">
                  {l.severity === "critical" && (
                    <span className="text-xs sm:text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-error-container text-error-m3">LEAK</span>
                  )}
                  {l.severity === "warning" && (
                    <span className="text-xs sm:text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600">UNMAPPED</span>
                  )}
                  {l.severity === "info" && (
                    <span className="text-xs sm:text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-primary-container/10 text-accent-blue">OVER</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LeadPipelinePanel({ leads }: { leads: LeadEvent[] }) {
  const { currencySymbol: sym } = useCurrency();
  const totalValue = leads.reduce((s, l) => s + l.value, 0);
  const avgScore = leads.length > 0 ? Math.round(leads.reduce((s, l) => s + l.score, 0) / leads.length) : 0;

  const STAGE_COLORS: Record<string, string> = {
    MQL: "bg-blue-50 text-blue-600",
    SQL: "bg-indigo-50 text-indigo-600",
    Opportunity: "bg-violet-50 text-violet-600",
    "Closed Won": "bg-emerald-50 text-emerald-600",
    "Closed Lost": "bg-red-50 text-red-500",
  };

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="shrink-0 px-4 py-3 border-b border-outline-variant/15">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-3.5 h-3.5 text-indigo-600" />
          <span className="text-xs sm:text-[10px] font-bold text-indigo-700 uppercase tracking-widest">CRM Lead Pipeline</span>
        </div>
        <div className="flex gap-4">
          <div>
            <p className="text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase">Pipeline Value</p>
            <p className="text-sm font-bold text-on-surface">{sym}{totalValue.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase">Leads</p>
            <p className="text-sm font-bold text-on-surface">{leads.length}</p>
          </div>
          <div>
            <p className="text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase">Avg Score</p>
            <p className={cn("text-sm font-bold", avgScore >= 70 ? "text-emerald-600" : avgScore >= 50 ? "text-amber-500" : "text-error-m3")}>{avgScore}</p>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-container-low">
            <tr>
              <th className="text-left text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-2">Date</th>
              <th className="text-left text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-2">Lead</th>
              <th className="text-center text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-2">Stage</th>
              <th className="text-right text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-2">Value</th>
              <th className="text-right text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-2">Score</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} className="border-b ghost-border hover:bg-surface transition-colors">
                <td className="text-xs sm:text-[11px] text-on-surface-variant px-3 py-2">{l.date.slice(5)}</td>
                <td className="px-3 py-2">
                  <div className="text-xs sm:text-[11px] text-on-surface">{l.leadName}</div>
                  <div className="text-xs sm:text-[9px] text-on-surface-variant">{l.company} · {l.source}</div>
                </td>
                <td className="text-center px-3 py-2">
                  <span className={cn("text-xs sm:text-[9px] font-bold px-1.5 py-0.5 rounded-full", STAGE_COLORS[l.stage] ?? "bg-gray-50 text-gray-600")}>{l.stage}</span>
                </td>
                <td className="text-right text-xs sm:text-[11px] font-medium text-emerald-600 px-3 py-2">{sym}{l.value.toLocaleString()}</td>
                <td className="text-right px-3 py-2">
                  <span className={cn("text-xs sm:text-[11px] font-bold", l.score >= 70 ? "text-emerald-600" : l.score >= 50 ? "text-amber-500" : "text-error-m3")}>{l.score}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FunnelLeakPanel({ funnelLeaks }: { funnelLeaks: FunnelLeak[] }) {
  const { currencySymbol: sym } = useCurrency();
  return (
    <div className="shrink-0 border-t border-outline-variant/15 bg-white">
      <div className="flex items-center gap-2 px-4 py-2 border-b ghost-border">
        <AlertTriangle className="w-3 h-3 text-error-m3" />
        <span className="text-xs sm:text-[9px] font-bold text-error-m3 uppercase tracking-widest">Funnel Drop-Off Analysis</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-surface-container-low">
              <th className="text-left text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-1.5">Stage</th>
              <th className="text-right text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-1.5">Entered</th>
              <th className="text-right text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-1.5">Exited</th>
              <th className="text-right text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-1.5">Drop %</th>
              <th className="text-right text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-1.5">CPL</th>
              <th className="text-center text-xs sm:text-[9px] font-semibold text-on-secondary-container uppercase px-3 py-1.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {funnelLeaks.map((f) => (
              <tr key={f.stage} className="border-b ghost-border">
                <td className="text-xs sm:text-[11px] text-on-surface font-medium px-3 py-1.5">{f.stage}</td>
                <td className="text-right text-xs sm:text-[11px] text-on-surface-variant px-3 py-1.5">{f.entered.toLocaleString()}</td>
                <td className="text-right text-xs sm:text-[11px] text-on-surface-variant px-3 py-1.5">{f.exited.toLocaleString()}</td>
                <td className={cn("text-right text-xs sm:text-[11px] font-bold px-3 py-1.5", f.dropRate > 90 ? "text-error-m3" : f.dropRate > 50 ? "text-amber-500" : "text-emerald-600")}>{f.dropRate.toFixed(1)}%</td>
                <td className="text-right text-xs sm:text-[11px] font-medium text-on-surface px-3 py-1.5">{sym}{f.costPerLead.toFixed(2)}</td>
                <td className="text-center px-3 py-1.5">
                  {f.severity === "critical" && <span className="text-xs sm:text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-error-container text-error-m3">BOTTLENECK</span>}
                  {f.severity === "warning" && <span className="text-xs sm:text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600">WATCH</span>}
                  {f.severity === "info" && <span className="text-xs sm:text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-primary-container/10 text-accent-blue">NORMAL</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Forensic() {
  const [dateRange, setDateRange] = useState<DateRange>("7d");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const { activeWorkspace } = useWorkspace();
  const [hybridTab, setHybridTab] = useState<"ecom" | "leadgen">("ecom");

  const resolvedGoal: WorkspaceGoal = useMemo(() => {
    const raw = activeWorkspace?.primaryGoal;
    if (raw === "leadgen" || raw === "hybrid") return raw;
    return "ecom";
  }, [activeWorkspace?.primaryGoal]);

  const ecomData = useForensicData(dateRange, searchTerm);
  const leadgenData = useLeadgenData(dateRange, searchTerm);

  const showEcom = resolvedGoal === "ecom" || (resolvedGoal === "hybrid" && hybridTab === "ecom");
  const showLeadgen = resolvedGoal === "leadgen" || (resolvedGoal === "hybrid" && hybridTab === "leadgen");

  const isLoading = (showEcom && ecomData.loading) || (showLeadgen && leadgenData.loading);
  const loadError = showEcom ? ecomData.error : leadgenData.error;

  return (
    <div className="h-screen flex flex-col bg-surface text-on-surface overflow-hidden relative">
      <ForensicHeader
        dateRange={dateRange}
        setDateRange={setDateRange}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        leaks={showEcom ? ecomData.leaks : []}
        ads={showEcom ? ecomData.ads : leadgenData.ads}
      />

      {resolvedGoal === "hybrid" && (
        <div className="shrink-0 flex items-center gap-1 px-4 py-2 border-b border-outline-variant/15 bg-white">
          <button onClick={() => setHybridTab("ecom")} className={cn("px-3 py-1.5 text-xs sm:text-[11px] font-semibold rounded-xl transition-colors", hybridTab === "ecom" ? "bg-accent-blue/10 text-accent-blue" : "text-on-surface-variant hover:text-on-surface")}>
            SKU Forensics
          </button>
          <button onClick={() => setHybridTab("leadgen")} className={cn("px-3 py-1.5 text-xs sm:text-[11px] font-semibold rounded-xl transition-colors", hybridTab === "leadgen" ? "bg-indigo-100 text-indigo-600" : "text-on-surface-variant hover:text-on-surface")}>
            Lead Funnel
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col">
        {isLoading && (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 text-accent-blue animate-spin" />
              <span className="text-xs font-medium text-on-surface-variant">Loading forensic data…</span>
            </div>
          </div>
        )}

        {!isLoading && loadError && (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center">
              <AlertTriangle className="w-6 h-6 text-amber-500" />
              <span className="text-xs font-medium text-on-surface-variant">{loadError}</span>
              <span className="text-xs sm:text-[10px] text-on-surface-variant">Connect your data sources to populate this view</span>
            </div>
          </div>
        )}

        {!isLoading && !loadError && showEcom && (
          <>
            <PanelGroup direction="horizontal" className="flex-1">
              <Panel defaultSize={50} minSize={30}>
                <ShopifyPanel events={ecomData.shopify} selectedSku={selectedSku} onSelectSku={setSelectedSku} />
              </Panel>
              <PanelResizeHandle className="w-2 bg-surface-container-low hover:bg-accent-blue/10 transition-colors flex items-center justify-center group cursor-col-resize">
                <GripVertical className="w-3 h-3 text-outline-variant group-hover:text-accent-blue transition-colors" />
              </PanelResizeHandle>
              <Panel defaultSize={50} minSize={30}>
                <AdPlatformPanel events={ecomData.ads} selectedSku={selectedSku} />
              </Panel>
            </PanelGroup>
            <LeakSummaryPanel leaks={ecomData.leaks} />
          </>
        )}

        {!isLoading && !loadError && showLeadgen && (
          <>
            <PanelGroup direction="horizontal" className="flex-1">
              <Panel defaultSize={50} minSize={30}>
                <LeadPipelinePanel leads={leadgenData.leads} />
              </Panel>
              <PanelResizeHandle className="w-2 bg-surface-container-low hover:bg-indigo-100/30 transition-colors flex items-center justify-center group cursor-col-resize">
                <GripVertical className="w-3 h-3 text-outline-variant group-hover:text-indigo-500 transition-colors" />
              </PanelResizeHandle>
              <Panel defaultSize={50} minSize={30}>
                <AdPlatformPanel events={leadgenData.ads} selectedSku={null} />
              </Panel>
            </PanelGroup>
            <FunnelLeakPanel funnelLeaks={leadgenData.funnelLeaks} />
          </>
        )}
      </div>
    </div>
  );
}
