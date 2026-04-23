import { cn } from "@/lib/utils";

export interface EtlStatus {
  etlStatus: "idle" | "running" | "complete" | "error";
  etlPhase: string;
  etlPct: number;
  etlRowsExtracted?: number;
  lastResult?: {
    shopify: number;
    googleAds: number;
    mapping: number;
    durationMs: number;
  } | null;
  lastError?: string | null;
}

const PLATFORM_LABELS: Record<string, string> = {
  shopify:      "Shopify",
  woocommerce:  "WooCommerce",
  google_ads:   "Google Ads",
  meta:         "Meta",
  bing_ads:     "Microsoft Ads",
  hubspot:      "HubSpot",
  salesforce:   "Salesforce",
  zoho:         "Zoho",
  klaviyo:      "Klaviyo",
  stripe:       "Stripe",
  google_workspace: "Google Workspace",
};

export function platformLabel(platform?: string | null): string {
  if (!platform) return "your data source";
  return PLATFORM_LABELS[platform] ?? platform.replace(/_/g, " ");
}

interface EtlSyncBannerProps {
  /**
   * Platform identifier (e.g. "shopify", "google_ads", "hubspot"). Used for
   * the banner title; falls back to "your data source" when omitted.
   */
  platform?: string | null;
  /** Optional human-readable account/store name appended to the title. */
  accountName?: string;
  etl: EtlStatus | null;
  onDismiss?: () => void;
  onGoHome?: () => void;
  /** CTA label when the sync completes. Defaults to "Run AI diagnostic sweep". */
  doneCtaLabel?: string;
}

/**
 * Generalised post-OAuth ETL progress banner. Used on the Connections page
 * after any platform OAuth callback completes (shopify, google_ads, meta,
 * hubspot, …) and surfaces the warehouse hydration progress in plain English.
 *
 * Design contract:
 *   • idle/running → indeterminate phase + percent bar + "warehouse will be
 *     ready in seconds — connect other platforms while you wait" hint
 *   • complete    → emerald celebration with the run summary (rows · ad links
 *     · duration) and a CTA to run the diagnostic sweep
 *   • error       → red banner with the lastError string verbatim
 */
export function EtlSyncBanner({
  platform,
  accountName,
  etl,
  onDismiss,
  onGoHome,
  doneCtaLabel = "Run AI diagnostic sweep",
}: EtlSyncBannerProps) {
  const isDone  = etl?.etlStatus === "complete";
  const isError = etl?.etlStatus === "error";
  const label   = platformLabel(platform);
  const titleSuffix = accountName ? `${label} (${accountName})` : label;

  return (
    <section className={cn(
      "bg-white border rounded-2xl p-5 shadow-sm transition-all",
      isDone  ? "border-emerald-300 bg-emerald-50"
              : isError
              ? "border-[#F87171] bg-error-container"
              : "border-primary-container/20 bg-primary-container/10/50",
    )}>
      <div className="flex items-center gap-3 mb-3">
        <div className={cn(
          "w-10 h-10 rounded-2xl flex items-center justify-center shrink-0",
          isDone ? "bg-emerald-100" : isError ? "bg-[var(--color-status-error-soft-bg)]" : "bg-[var(--color-status-info-soft-bg)]",
        )}>
          <span className={cn(
            "material-symbols-outlined text-xl",
            isDone ? "text-emerald-600" : isError ? "text-error-m3" : "text-primary-container animate-pulse",
          )}>
            {isDone ? "check_circle" : isError ? "error" : "sync"}
          </span>
        </div>
        <div className="flex-1">
          <p className={cn(
            "text-sm font-bold",
            isDone ? "text-emerald-700" : isError ? "text-on-error-container" : "text-on-surface",
          )}>
            {isDone ? `${label} sync complete` : isError ? "Sync encountered an issue" : `Syncing ${titleSuffix}…`}
          </p>
          <p className="text-xs text-secondary mt-0.5">
            {isDone && etl?.lastResult
              ? `${etl.lastResult.shopify + etl.lastResult.googleAds} rows · ${etl.lastResult.mapping} ad links · ${(etl.lastResult.durationMs / 1000).toFixed(1)}s`
              : isError
              ? etl?.lastError ?? "Unknown error"
              : (etl?.etlPhase ?? `Connecting to ${label}…`)}
          </p>
        </div>
        {isDone && onDismiss && (
          <button onClick={onDismiss} className="text-[10px] font-bold text-on-surface-variant hover:text-on-surface-variant transition-colors px-2 uppercase">dismiss</button>
        )}
      </div>

      {!isDone && !isError && (
        <div className="mb-3">
          <div className="h-1 bg-surface-container-highest rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-primary-container transition-all duration-700" style={{ width: `${etl?.etlPct ?? 5}%` }} />
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">{etl?.etlPhase ?? "Initialising…"}</span>
            <span className="text-[10px] font-bold text-primary-container">{etl?.etlPct ?? 5}%</span>
          </div>
        </div>
      )}

      {isDone && onGoHome && (
        <button onClick={onGoHome} className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95 uppercase">
          <span className="material-symbols-outlined text-sm">bolt</span>
          {doneCtaLabel}
        </button>
      )}

      {!isDone && !isError && (
        <p className="text-[10px] text-on-surface-variant">Warehouse will be ready in seconds — connect other platforms while you wait.</p>
      )}
    </section>
  );
}
