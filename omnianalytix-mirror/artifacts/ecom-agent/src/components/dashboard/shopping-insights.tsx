import { useState, useEffect, useCallback, useMemo } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { useDateRange } from "@/contexts/date-range-context";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { cn } from "@/lib/utils";
import { formatUsdInDisplay } from "@/lib/fx-format";
import { appendFxAuditToCsv } from "@/lib/fx-audit-csv";
import {
  AlertTriangle,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  ShoppingCart,
  Package,
  Settings2,
  CheckCircle2,
  XCircle,
  Download,
  HeartPulse,
} from "lucide-react";

interface CampaignRow {
  campaign_id: string;
  campaign_name: string;
  customer_id: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversion_value: number;
  ctr: number;
  cpc: number;
  roas: number;
}

interface ProductRow {
  offer_id: string;
  title: string;
  brand: string | null;
  product_type: string | null;
  merchant_id: string;
  country: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversion_value: number;
  roas: number;
}

interface AccountHealthRow {
  merchant_id: string;
  country: string | null;
  total_products: number;
  approved_products: number;
  disapproved_products: number;
  pending_products: number;
  active_products: number;
  approval_rate: number;
}

interface IssueRow {
  offer_id: string;
  title: string;
  merchant_id: string;
  country: string | null;
  destination: string | null;
  servability: string | null;
  issue_code: string;
  issue_description: string | null;
  detail: string | null;
  num_items: number;
}

type FetchState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: T }
  | { status: "config-missing"; message: string }
  | { status: "error"; message: string };

function fmtNum(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v % 1 === 0 ? String(v) : v.toFixed(2);
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatUsdInDisplay(v, { compact: true, decimals: 1 });
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return `${(v * 100).toFixed(2)}%`;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchInsight<T>(path: string): Promise<
  | { kind: "ok"; data: T }
  | { kind: "config-missing"; message: string }
  | { kind: "error"; message: string }
> {
  try {
    const res = await authFetch(`/api/insights/shopping/${path}`);
    if (res.status === 503) {
      const body = await res.json().catch(() => ({}));
      if (body?.code === "BIGQUERY_NOT_CONFIGURED") {
        return {
          kind: "config-missing",
          message:
            body?.message ??
            "Shopping Insider isn't configured on this server.",
        };
      }
      return { kind: "error", message: body?.error ?? "Service unavailable" };
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        kind: "error",
        message: body?.error ?? body?.message ?? `Request failed (${res.status})`,
      };
    }
    const body = await res.json();
    return { kind: "ok", data: body as T };
  } catch (e) {
    return { kind: "error", message: String(e) };
  }
}

async function exportCsv(
  path: string,
  fallbackFilename: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const url = `/api/insights/shopping/${path}${path.includes("?") ? "&" : "?"}format=csv`;
    const res = await authFetch(url);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        ok: false,
        message:
          (body && (body.error || body.message)) ||
          `Export failed (${res.status})`,
      };
    }
    const disposition = res.headers.get("content-disposition") || "";
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match?.[1] ?? fallbackFilename;
    const rawCsv = await res.text();
    const annotatedCsv = appendFxAuditToCsv(rawCsv);
    const blob = new Blob([annotatedCsv], { type: "text/csv" });
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(objectUrl);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

function DownloadCsvButton({
  onClick,
  disabled,
  exporting,
}: {
  onClick: () => void;
  disabled?: boolean;
  exporting?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || exporting}
      title={exporting ? "Exporting full dataset…" : "Download CSV"}
      aria-busy={exporting || undefined}
      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {exporting ? (
        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Download className="w-3.5 h-3.5" />
      )}
      {exporting ? "Exporting…" : "Download CSV"}
    </button>
  );
}

function ConfigEmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-6 py-10 text-center">
      <Settings2 className="w-8 h-8 mx-auto text-amber-500" />
      <h3 className="mt-3 text-sm font-bold text-amber-900">
        Shopping Insider isn't connected yet
      </h3>
      <p className="mt-1 text-xs text-amber-700 max-w-md mx-auto leading-relaxed">
        {message}
      </p>
      <p className="mt-3 text-[11px] text-amber-700/80 max-w-md mx-auto">
        Ask an admin to set <code className="font-mono">SHOPPING_INSIDER_BQ_PROJECT_ID</code>{" "}
        and the Google Cloud service-account credentials on the API server, then
        reload this page.
      </p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-5">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 text-red-600 shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-red-800">
            Couldn't load Shopping Insider data
          </p>
          <p className="text-xs text-red-700 mt-1">{message}</p>
        </div>
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </button>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6 flex items-center justify-center text-slate-400 text-sm">
      <RefreshCw className="w-4 h-4 animate-spin mr-2" />
      Loading…
    </div>
  );
}

function EmptyState({
  label,
  actions,
}: {
  label: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-xs text-slate-500">
      <div>{label}</div>
      {actions && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}

function SectionCard({
  title,
  icon,
  description,
  action,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-start justify-between mb-4 gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-indigo-50 text-indigo-600 p-2">{icon}</div>
          <div>
            <h2 className="text-base font-bold text-slate-900">{title}</h2>
            {description && (
              <p className="text-xs text-slate-500 mt-0.5">{description}</p>
            )}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function ShoppingInsights() {
  const { dateRange, refreshKey } = useDateRange();
  const [country, setCountry] = useState("");
  const [merchantId, setMerchantId] = useState("");
  const [productSort, setProductSort] = useState<"top" | "bottom">("top");
  const [reloadKey, setReloadKey] = useState(0);

  const [campaigns, setCampaigns] = useState<FetchState<CampaignRow[]>>({
    status: "idle",
  });
  const [products, setProducts] = useState<FetchState<ProductRow[]>>({
    status: "idle",
  });
  const [issues, setIssues] = useState<FetchState<IssueRow[]>>({
    status: "idle",
  });
  const [health, setHealth] = useState<FetchState<AccountHealthRow[]>>({
    status: "idle",
  });

  const [exportingCampaigns, setExportingCampaigns] = useState(false);
  const [exportingProducts, setExportingProducts] = useState(false);
  const [exportingIssues, setExportingIssues] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const range = useMemo(
    () => ({
      start: isoDate(dateRange.from),
      end: isoDate(dateRange.to),
    }),
    [dateRange.from, dateRange.to],
  );

  const queryParams = useMemo(() => {
    const trimmedCountry = country.trim().toUpperCase();
    const trimmedMerchant = merchantId.trim();
    return { country: trimmedCountry, merchantId: trimmedMerchant };
  }, [country, merchantId]);

  const buildQS = useCallback(
    (extra: Record<string, string | undefined> = {}) => {
      const params = new URLSearchParams();
      params.set("start_date", range.start);
      params.set("end_date", range.end);
      if (queryParams.country) params.set("country", queryParams.country);
      if (queryParams.merchantId) params.set("merchant_id", queryParams.merchantId);
      for (const [k, v] of Object.entries(extra)) {
        if (v) params.set(k, v);
      }
      return params.toString();
    },
    [range, queryParams],
  );

  // ─── Fetch campaigns ──
  useEffect(() => {
    let cancelled = false;
    setCampaigns({ status: "loading" });
    const params = new URLSearchParams();
    params.set("start_date", range.start);
    params.set("end_date", range.end);
    if (queryParams.country) params.set("country", queryParams.country);
    params.set("limit", "25");
    fetchInsight<{ rows: CampaignRow[] }>(`campaigns?${params.toString()}`).then((r) => {
      if (cancelled) return;
      if (r.kind === "ok") setCampaigns({ status: "ok", data: r.data.rows });
      else if (r.kind === "config-missing")
        setCampaigns({ status: "config-missing", message: r.message });
      else setCampaigns({ status: "error", message: r.message });
    });
    return () => {
      cancelled = true;
    };
  }, [range, queryParams.country, refreshKey, reloadKey]);

  // ─── Fetch products ──
  useEffect(() => {
    let cancelled = false;
    setProducts({ status: "loading" });
    const qs = buildQS({
      sort_by: "roas",
      direction: productSort,
      limit: "10",
    });
    fetchInsight<{ rows: ProductRow[] }>(`products?${qs}`).then((r) => {
      if (cancelled) return;
      if (r.kind === "ok") setProducts({ status: "ok", data: r.data.rows });
      else if (r.kind === "config-missing")
        setProducts({ status: "config-missing", message: r.message });
      else setProducts({ status: "error", message: r.message });
    });
    return () => {
      cancelled = true;
    };
  }, [buildQS, productSort, refreshKey, reloadKey]);

  // ─── Fetch issues ──
  useEffect(() => {
    let cancelled = false;
    setIssues({ status: "loading" });
    const params = new URLSearchParams();
    params.set("servability", "disapproved");
    params.set("limit", "25");
    if (queryParams.country) params.set("country", queryParams.country);
    if (queryParams.merchantId) params.set("merchant_id", queryParams.merchantId);
    fetchInsight<{ rows: IssueRow[] }>(`issues?${params.toString()}`).then((r) => {
      if (cancelled) return;
      if (r.kind === "ok") setIssues({ status: "ok", data: r.data.rows });
      else if (r.kind === "config-missing")
        setIssues({ status: "config-missing", message: r.message });
      else setIssues({ status: "error", message: r.message });
    });
    return () => {
      cancelled = true;
    };
  }, [queryParams.country, queryParams.merchantId, refreshKey, reloadKey]);

  // ─── Fetch account health ──
  useEffect(() => {
    let cancelled = false;
    setHealth({ status: "loading" });
    const params = new URLSearchParams();
    if (queryParams.merchantId) params.set("merchant_id", queryParams.merchantId);
    if (queryParams.country) params.set("country", queryParams.country);
    const qs = params.toString();
    fetchInsight<{ rows: AccountHealthRow[] }>(
      `account-health${qs ? `?${qs}` : ""}`,
    ).then((r) => {
      if (cancelled) return;
      if (r.kind === "ok") setHealth({ status: "ok", data: r.data.rows });
      else if (r.kind === "config-missing")
        setHealth({ status: "config-missing", message: r.message });
      else setHealth({ status: "error", message: r.message });
    });
    return () => {
      cancelled = true;
    };
  }, [queryParams.merchantId, queryParams.country, refreshKey, reloadKey]);

  // If every section reports config-missing, show a single banner instead.
  const allMissing =
    campaigns.status === "config-missing" &&
    products.status === "config-missing" &&
    issues.status === "config-missing" &&
    health.status === "config-missing";

  const reload = () => setReloadKey((k) => k + 1);

  return (
    <div className="flex flex-col gap-6">
      {/* Header / filters */}
      {/* NB: Shopping Insights uses its own country + merchant_id inputs which
          are already plumbed into the BigQuery queries; the global FilterBar
          is intentionally NOT mounted here to avoid a split-brain filter UX.
          See FILTERS_COVERAGE.md. */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Shopping Insights</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Live Google Ads + Merchant Center performance from your Shopping
            Insider BigQuery dataset.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker />
          <input
            type="text"
            value={country}
            onChange={(e) => setCountry(e.target.value.slice(0, 2))}
            placeholder="Country (e.g. US)"
            className="w-32 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400"
          />
          <input
            type="text"
            value={merchantId}
            onChange={(e) => setMerchantId(e.target.value)}
            placeholder="Merchant ID"
            className="w-40 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400"
          />
          <button
            onClick={reload}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {exportError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 text-red-600 shrink-0" />
          <div className="flex-1 text-xs text-red-700">
            <span className="font-semibold text-red-800">Export failed:</span>{" "}
            {exportError}
          </div>
          <button
            onClick={() => setExportError(null)}
            className="text-xs font-semibold text-red-700 hover:text-red-900"
          >
            Dismiss
          </button>
        </div>
      )}

      {allMissing ? (
        <ConfigEmptyState
          message={
            (campaigns.status === "config-missing" && campaigns.message) ||
            "Shopping Insider isn't configured on this server."
          }
        />
      ) : (
        <>
          {/* ─── Account health KPI strip ───────────────────── */}
          <SectionCard
            title="Feed health"
            icon={<HeartPulse className="w-4 h-4" />}
            description="Account-level Merchant Center status per merchant"
          >
            {health.status === "loading" && <LoadingState />}
            {health.status === "config-missing" && (
              <ConfigEmptyState message={health.message} />
            )}
            {health.status === "error" && (
              <ErrorState message={health.message} onRetry={reload} />
            )}
            {health.status === "ok" && health.data.length === 0 && (() => {
              const hasCountry = !!queryParams.country;
              const hasMerchant = !!queryParams.merchantId;
              let label: string;
              if (hasCountry && hasMerchant) {
                label = `No merchants match merchant ID "${queryParams.merchantId}" in ${queryParams.country}.`;
              } else if (hasCountry) {
                label = `No merchants in ${queryParams.country}. Try clearing the country filter to see all merchants.`;
              } else if (hasMerchant) {
                label = `No account health data for merchant ID "${queryParams.merchantId}".`;
              } else {
                label = "No account health data available.";
              }
              const buttonClass =
                "inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100";
              return (
                <EmptyState
                  label={label}
                  actions={
                    hasCountry || hasMerchant ? (
                      <>
                        {hasCountry && (
                          <button
                            type="button"
                            onClick={() => setCountry("")}
                            className={buttonClass}
                          >
                            Clear country filter
                          </button>
                        )}
                        {hasMerchant && (
                          <button
                            type="button"
                            onClick={() => setMerchantId("")}
                            className={buttonClass}
                          >
                            Clear merchant filter
                          </button>
                        )}
                      </>
                    ) : undefined
                  }
                />
              );
            })()}
            {health.status === "ok" && health.data.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {health.data.map((h) => {
                  const rate = h.approval_rate ?? 0;
                  const rateColor =
                    rate >= 0.95
                      ? "text-emerald-600"
                      : rate >= 0.8
                        ? "text-amber-600"
                        : "text-red-600";
                  const rateBg =
                    rate >= 0.95
                      ? "bg-emerald-50 border-emerald-200"
                      : rate >= 0.8
                        ? "bg-amber-50 border-amber-200"
                        : "bg-red-50 border-red-200";
                  const isSelected =
                    queryParams.merchantId === h.merchant_id;
                  return (
                    <button
                      key={h.merchant_id}
                      type="button"
                      onClick={() =>
                        setMerchantId(isSelected ? "" : h.merchant_id)
                      }
                      aria-pressed={isSelected}
                      title={
                        isSelected
                          ? "Clear merchant filter"
                          : `Filter to merchant ${h.merchant_id}`
                      }
                      className={cn(
                        "text-left rounded-xl border p-4 flex flex-col gap-3 transition-all cursor-pointer",
                        "hover:shadow-md hover:-translate-y-0.5 hover:border-indigo-300",
                        "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2",
                        "active:translate-y-0 active:shadow-sm",
                        rateBg,
                        isSelected &&
                          "ring-2 ring-indigo-500 ring-offset-2 border-indigo-400",
                      )}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            Merchant
                          </div>
                          <div className="text-sm font-mono text-slate-800 flex items-center gap-1.5 flex-wrap">
                            <span>{h.merchant_id}</span>
                            {h.country ? (
                              <button
                                type="button"
                                onClick={() => setCountry(h.country ?? "")}
                                title={`Filter by country ${h.country}`}
                                className={cn(
                                  "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors",
                                  queryParams.country === h.country
                                    ? "border-indigo-300 bg-indigo-100 text-indigo-700"
                                    : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100",
                                )}
                              >
                                {h.country}
                              </button>
                            ) : null}
                          </div>
                        </div>
                        <div className={cn("text-2xl font-bold tabular-nums", rateColor)}>
                          {fmtPct(h.approval_rate)}
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-center">
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            Total
                          </div>
                          <div className="text-sm font-bold text-slate-900 tabular-nums">
                            {fmtNum(h.total_products)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            Active
                          </div>
                          <div className="text-sm font-bold text-emerald-700 tabular-nums">
                            {fmtNum(h.active_products)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            Disapp.
                          </div>
                          <div className="text-sm font-bold text-red-700 tabular-nums">
                            {fmtNum(h.disapproved_products)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            Pending
                          </div>
                          <div className="text-sm font-bold text-amber-700 tabular-nums">
                            {fmtNum(h.pending_products)}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* ─── Campaign performance ───────────────────────── */}
          <SectionCard
            title="Campaign performance"
            icon={<ShoppingCart className="w-4 h-4" />}
            description={`Top campaigns by spend over ${dateRange.label.toLowerCase()}`}
            action={
              <DownloadCsvButton
                disabled={campaigns.status !== "ok"}
                exporting={exportingCampaigns}
                onClick={async () => {
                  setExportError(null);
                  setExportingCampaigns(true);
                  const params = new URLSearchParams();
                  params.set("start_date", range.start);
                  params.set("end_date", range.end);
                  if (queryParams.country) params.set("country", queryParams.country);
                  const result = await exportCsv(
                    `campaigns?${params.toString()}`,
                    `shopping-insights-campaigns_${range.start}_${range.end}.csv`,
                  );
                  setExportingCampaigns(false);
                  if (!result.ok) setExportError(result.message);
                }}
              />
            }
          >
            {campaigns.status === "loading" && <LoadingState />}
            {campaigns.status === "config-missing" && (
              <ConfigEmptyState message={campaigns.message} />
            )}
            {campaigns.status === "error" && (
              <ErrorState message={campaigns.message} onRetry={reload} />
            )}
            {campaigns.status === "ok" && campaigns.data.length === 0 && (
              <EmptyState label="No campaign data for this date range." />
            )}
            {campaigns.status === "ok" && campaigns.data.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Campaign
                      </th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Impr.
                      </th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Clicks
                      </th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                        CTR
                      </th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Cost
                      </th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Conv.
                      </th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Revenue
                      </th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                        ROAS
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {campaigns.data.map((c) => (
                      <tr key={`${c.customer_id}:${c.campaign_id}`} className="hover:bg-slate-50">
                        <td className="px-3 py-2 text-slate-800">
                          <div className="font-medium truncate max-w-[260px]">
                            {c.campaign_name || c.campaign_id}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            {c.customer_id}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-700 tabular-nums">{fmtNum(c.impressions)}</td>
                        <td className="px-3 py-2 text-right text-slate-700 tabular-nums">{fmtNum(c.clicks)}</td>
                        <td className="px-3 py-2 text-right text-slate-700 tabular-nums">{fmtPct(c.ctr)}</td>
                        <td className="px-3 py-2 text-right text-slate-700 tabular-nums">{fmtMoney(c.cost)}</td>
                        <td className="px-3 py-2 text-right text-slate-700 tabular-nums">{fmtNum(c.conversions)}</td>
                        <td className="px-3 py-2 text-right text-slate-700 tabular-nums">{fmtMoney(c.conversion_value)}</td>
                        <td
                          className={cn(
                            "px-3 py-2 text-right tabular-nums font-semibold",
                            c.roas >= 3
                              ? "text-emerald-600"
                              : c.roas >= 1
                                ? "text-slate-700"
                                : "text-red-600",
                          )}
                        >
                          {c.roas != null && isFinite(c.roas) ? `${c.roas.toFixed(2)}×` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* ─── Products ───────────────────────── */}
          <SectionCard
            title={productSort === "top" ? "Top products" : "Bottom products"}
            icon={
              productSort === "top" ? (
                <TrendingUp className="w-4 h-4" />
              ) : (
                <TrendingDown className="w-4 h-4" />
              )
            }
            description="Ranked by ROAS over the selected date range"
            action={
              <div className="flex items-center gap-2">
                <DownloadCsvButton
                  disabled={products.status !== "ok"}
                  exporting={exportingProducts}
                  onClick={async () => {
                    setExportError(null);
                    setExportingProducts(true);
                    const qs = buildQS({
                      sort_by: "roas",
                      direction: productSort,
                    });
                    const result = await exportCsv(
                      `products?${qs}`,
                      `shopping-insights-products-${productSort}_${range.start}_${range.end}.csv`,
                    );
                    setExportingProducts(false);
                    if (!result.ok) setExportError(result.message);
                  }}
                />
                <div className="inline-flex rounded-xl border border-slate-200 overflow-hidden text-xs">
                <button
                  onClick={() => setProductSort("top")}
                  className={cn(
                    "px-3 py-1.5 font-semibold inline-flex items-center gap-1.5",
                    productSort === "top"
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-slate-600 hover:bg-slate-50",
                  )}
                >
                  <TrendingUp className="w-3 h-3" /> Top
                </button>
                <button
                  onClick={() => setProductSort("bottom")}
                  className={cn(
                    "px-3 py-1.5 font-semibold inline-flex items-center gap-1.5 border-l border-slate-200",
                    productSort === "bottom"
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-slate-600 hover:bg-slate-50",
                  )}
                >
                  <TrendingDown className="w-3 h-3" /> Bottom
                </button>
                </div>
              </div>
            }
          >
            {products.status === "loading" && <LoadingState />}
            {products.status === "config-missing" && (
              <ConfigEmptyState message={products.message} />
            )}
            {products.status === "error" && (
              <ErrorState message={products.message} onRetry={reload} />
            )}
            {products.status === "ok" && products.data.length === 0 && (
              <EmptyState label="No product performance data for this date range." />
            )}
            {products.status === "ok" && products.data.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Product
                      </th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Brand
                      </th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Clicks
                      </th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Cost
                      </th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Conv.
                      </th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Revenue
                      </th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                        ROAS
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {products.data.map((p) => (
                      <tr key={`${p.merchant_id}:${p.offer_id}`} className="hover:bg-slate-50">
                        <td className="px-3 py-2 text-slate-800">
                          <div className="font-medium truncate max-w-[280px]">
                            {p.title || p.offer_id}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            {p.offer_id} · {p.country ?? "—"}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-600 text-xs">
                          {p.brand ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-700 tabular-nums">{fmtNum(p.clicks)}</td>
                        <td className="px-3 py-2 text-right text-slate-700 tabular-nums">{fmtMoney(p.cost)}</td>
                        <td className="px-3 py-2 text-right text-slate-700 tabular-nums">{fmtNum(p.conversions)}</td>
                        <td className="px-3 py-2 text-right text-slate-700 tabular-nums">{fmtMoney(p.conversion_value)}</td>
                        <td
                          className={cn(
                            "px-3 py-2 text-right tabular-nums font-semibold",
                            p.roas >= 3
                              ? "text-emerald-600"
                              : p.roas >= 1
                                ? "text-slate-700"
                                : "text-red-600",
                          )}
                        >
                          {p.roas != null && isFinite(p.roas) ? `${p.roas.toFixed(2)}×` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* ─── Disapprovals ───────────────────────── */}
          <SectionCard
            title="Product disapprovals"
            icon={<Package className="w-4 h-4" />}
            description="Items currently disapproved in Merchant Center"
            action={
              <DownloadCsvButton
                disabled={issues.status !== "ok"}
                exporting={exportingIssues}
                onClick={async () => {
                  setExportError(null);
                  setExportingIssues(true);
                  const params = new URLSearchParams();
                  params.set("servability", "disapproved");
                  if (queryParams.country) params.set("country", queryParams.country);
                  if (queryParams.merchantId)
                    params.set("merchant_id", queryParams.merchantId);
                  const result = await exportCsv(
                    `issues?${params.toString()}`,
                    `shopping-insights-disapprovals_${range.start}_${range.end}.csv`,
                  );
                  setExportingIssues(false);
                  if (!result.ok) setExportError(result.message);
                }}
              />
            }
          >
            {issues.status === "loading" && <LoadingState />}
            {issues.status === "config-missing" && (
              <ConfigEmptyState message={issues.message} />
            )}
            {issues.status === "error" && (
              <ErrorState message={issues.message} onRetry={reload} />
            )}
            {issues.status === "ok" && issues.data.length === 0 && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-6 flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <div>
                  <p className="text-sm font-semibold text-emerald-900">
                    No disapprovals
                  </p>
                  <p className="text-xs text-emerald-700">
                    Every product in this scope is currently servable.
                  </p>
                </div>
              </div>
            )}
            {issues.status === "ok" && issues.data.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Product
                      </th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Issue
                      </th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Destination
                      </th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Items
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {issues.data.map((row, i) => (
                      <tr
                        key={`${row.merchant_id}:${row.offer_id}:${row.issue_code}:${i}`}
                        className="hover:bg-slate-50"
                      >
                        <td className="px-3 py-2 text-slate-800">
                          <div className="font-medium truncate max-w-[260px]">
                            {row.title || row.offer_id}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            {row.offer_id} · {row.country ?? "—"}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          <div className="flex items-start gap-1.5">
                            <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                            <div>
                              <div className="text-xs font-semibold text-slate-800">
                                {row.issue_description ?? row.issue_code}
                              </div>
                              {row.detail && (
                                <div className="text-[11px] text-slate-500 mt-0.5 max-w-[420px]">
                                  {row.detail}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-600 text-xs">
                          {row.destination ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-700 tabular-nums">
                          {fmtNum(row.num_items)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}

