import type { Readable } from "node:stream";
import { runQuery, createQueryRowStream, safeIdent, getBigQueryConfig, BigQueryConfigError } from "../lib/bigquery-client";
import { withCache, hashKey, recordBypass } from "../lib/shopping-insider-cache";

// Re-export cache helpers so existing callers (and tests) keep working.
// The actual cache + metrics implementation lives in
// `lib/shopping-insider-cache.ts` and is shared across replicas via Redis
// when SHARED_CACHE_REDIS_URL is set.
export {
  clearShoppingInsiderCache,
  shoppingInsiderCacheStats,
} from "../lib/shopping-insider-cache";

/**
 * Shopping Insider service — typed query layer over the BigQuery datasets
 * produced by Google's `shopping_insider` solution
 * (https://github.com/google/shopping_insider).
 *
 * The customer deploys Shopping Insider into their own GCP project; we read
 * from the resulting datasets via a service account. All table/dataset names
 * are configurable via env vars so we can adapt to non-default deployments.
 *
 * Required env vars (validated lazily on first call):
 *   SHOPPING_INSIDER_BQ_PROJECT_ID
 *   SHOPPING_INSIDER_BQ_DATASET           (default: "shopping_insider")
 *   SHOPPING_INSIDER_GCP_SA_KEY  | _FILE  (one is required)
 *
 * Optional table-name overrides:
 *   SHOPPING_INSIDER_TABLE_PRODUCT_DETAILED   (default: product_detailed_materialized)
 *   SHOPPING_INSIDER_TABLE_PRODUCT_HISTORICAL (default: product_historical_metrics_materialized)
 *   SHOPPING_INSIDER_TABLE_ACCOUNT_SUMMARY    (default: account_summary_materialized)
 *   SHOPPING_INSIDER_TABLE_CAMPAIGN_PERF      (default: campaign_performance_materialized)
 *   SHOPPING_INSIDER_TABLE_PRODUCT_ISSUES     (default: product_issues_materialized)
 *
 * Caching:
 *   All four query functions are fronted by a 1-hour in-memory cache (see
 *   `lib/shopping-insider-cache.ts`). Pass `bypassCache: true` to force a
 *   fresh BigQuery hit (the result is NOT written to the cache, so a
 *   subsequent normal call still serves the previously-cached value).
 *   Set `SHOPPING_INSIDER_CACHE_TTL_MS=0` to disable caching globally.
 *
 * Streaming exports:
 *   The `streamXxx` variants below skip the cache and return a Node Readable
 *   that emits rows directly from BigQuery via `createQueryRowStream`. They
 *   exist so very large CSV exports can be piped to the HTTP response without
 *   buffering the full result set in memory.
 */

function tableRef(envKey: string, defaultName: string): string {
  getBigQueryConfig(); // throws BigQueryConfigError early if misconfigured
  const cfg = getBigQueryConfig();
  const dataset = safeIdent(process.env.SHOPPING_INSIDER_BQ_DATASET || "shopping_insider", "dataset");
  const table = safeIdent(process.env[envKey] || defaultName, "table");
  return `\`${cfg.projectId}.${dataset}.${table}\``;
}

export interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealCalendarDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split("-").map((p) => parseInt(p, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function validateDateRange(input: Partial<DateRange>): DateRange {
  const today = new Date();
  const defaultEnd = today.toISOString().slice(0, 10);
  const defaultStart = new Date(today.getTime() - 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const startDate = input.startDate || defaultStart;
  const endDate = input.endDate || defaultEnd;
  if (!isRealCalendarDate(startDate) || !isRealCalendarDate(endDate)) {
    throw new Error("startDate and endDate must be ISO YYYY-MM-DD calendar dates.");
  }
  if (startDate > endDate) {
    throw new Error("startDate must be on or before endDate.");
  }
  // cap window at 365 days
  const startMs = Date.parse(startDate);
  const endMs = Date.parse(endDate);
  if ((endMs - startMs) / (1000 * 60 * 60 * 24) > 365) {
    throw new Error("Date range cannot exceed 365 days.");
  }
  return { startDate, endDate };
}

// ─── Campaign performance ─────────────────────────────────────────────────────

export interface CampaignPerformanceRow {
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

function buildCampaignPerformanceQuery(opts: {
  range: Partial<DateRange>;
  customerId?: string;
  country?: string;
  limit?: number;
}): { sql: string; params: Record<string, unknown>; types: Record<string, string>; range: DateRange } {
  const range = validateDateRange(opts.range);
  const table = tableRef("SHOPPING_INSIDER_TABLE_CAMPAIGN_PERF", "campaign_performance_materialized");

  const where: string[] = ["DATE(date) BETWEEN @startDate AND @endDate"];
  const params: Record<string, unknown> = { startDate: range.startDate, endDate: range.endDate };
  const types: Record<string, string> = { startDate: "DATE", endDate: "DATE" };
  if (opts.customerId) {
    where.push("CAST(customer_id AS STRING) = @customerId");
    params.customerId = opts.customerId;
    types.customerId = "STRING";
  }
  if (opts.country) {
    where.push("UPPER(country_code) = UPPER(@country)");
    params.country = opts.country;
    types.country = "STRING";
  }

  let limitClause = "";
  if (opts.limit !== undefined) {
    params.limit = Math.max(opts.limit, 1);
    types.limit = "INT64";
    limitClause = "LIMIT @limit";
  }

  const sql = `
    SELECT
      CAST(campaign_id AS STRING)   AS campaign_id,
      ANY_VALUE(campaign_name)      AS campaign_name,
      CAST(customer_id AS STRING)   AS customer_id,
      SUM(impressions)              AS impressions,
      SUM(clicks)                   AS clicks,
      SUM(cost)                     AS cost,
      SUM(conversions)              AS conversions,
      SUM(conversion_value)         AS conversion_value,
      SAFE_DIVIDE(SUM(clicks), NULLIF(SUM(impressions), 0))           AS ctr,
      SAFE_DIVIDE(SUM(cost), NULLIF(SUM(clicks), 0))                  AS cpc,
      SAFE_DIVIDE(SUM(conversion_value), NULLIF(SUM(cost), 0))        AS roas
    FROM ${table}
    WHERE ${where.join(" AND ")}
    GROUP BY campaign_id, customer_id
    ORDER BY cost DESC
    ${limitClause}
  `;
  return { sql, params, types, range };
}

export async function getCampaignPerformance(opts: {
  range: Partial<DateRange>;
  customerId?: string;
  country?: string;
  limit?: number;
  bypassCache?: boolean;
}): Promise<CampaignPerformanceRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 100000);
  const { sql, params, types, range } = buildCampaignPerformanceQuery({ ...opts, limit });
  if (opts.bypassCache) {
    recordBypass("getCampaignPerformance");
    return runQuery<CampaignPerformanceRow>(sql, { params, types });
  }
  const key = hashKey(["campaign-performance", range, opts.customerId ?? null, opts.country ?? null, limit]);
  return withCache<CampaignPerformanceRow>("getCampaignPerformance", key, sql, { params, types });
}

/**
 * Streaming variant of getCampaignPerformance — returns a row stream from
 * BigQuery without buffering the full result set in memory. Bypasses the
 * result cache. Pass `limit` to cap row count, omit to stream the entire
 * result set (used by very large CSV exports).
 */
export function streamCampaignPerformance(opts: {
  range: Partial<DateRange>;
  customerId?: string;
  country?: string;
  limit?: number;
}): Readable {
  const { sql, params, types } = buildCampaignPerformanceQuery(opts);
  return createQueryRowStream(sql, { params, types });
}

// ─── Product performance ──────────────────────────────────────────────────────

export type ProductSortBy = "conversions" | "conversion_value" | "roas" | "cost" | "clicks";

export interface ProductPerformanceRow {
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

function buildProductPerformanceQuery(opts: {
  range: Partial<DateRange>;
  sortBy?: ProductSortBy;
  direction?: "top" | "bottom";
  merchantId?: string;
  country?: string;
  limit?: number;
}): {
  sql: string;
  params: Record<string, unknown>;
  types: Record<string, string>;
  range: DateRange;
  sortBy: ProductSortBy;
  direction: "ASC" | "DESC";
} {
  const range = validateDateRange(opts.range);
  const sortBy = opts.sortBy ?? "conversion_value";
  const allowed: ProductSortBy[] = ["conversions", "conversion_value", "roas", "cost", "clicks"];
  if (!allowed.includes(sortBy)) {
    throw new Error(`Invalid sortBy: ${sortBy}. Allowed: ${allowed.join(", ")}`);
  }
  const direction = opts.direction === "bottom" ? "ASC" : "DESC";
  const table = tableRef("SHOPPING_INSIDER_TABLE_PRODUCT_DETAILED", "product_detailed_materialized");

  const where: string[] = ["DATE(date) BETWEEN @startDate AND @endDate"];
  const params: Record<string, unknown> = { startDate: range.startDate, endDate: range.endDate };
  const types: Record<string, string> = { startDate: "DATE", endDate: "DATE" };
  if (opts.merchantId) {
    where.push("CAST(merchant_id AS STRING) = @merchantId");
    params.merchantId = opts.merchantId;
    types.merchantId = "STRING";
  }
  if (opts.country) {
    where.push("UPPER(target_country) = UPPER(@country)");
    params.country = opts.country;
    types.country = "STRING";
  }

  let limitClause = "";
  if (opts.limit !== undefined) {
    params.limit = Math.max(opts.limit, 1);
    types.limit = "INT64";
    limitClause = "LIMIT @limit";
  }

  const sql = `
    SELECT
      CAST(offer_id AS STRING)        AS offer_id,
      ANY_VALUE(title)                AS title,
      ANY_VALUE(brand)                AS brand,
      ANY_VALUE(product_type)         AS product_type,
      CAST(merchant_id AS STRING)     AS merchant_id,
      ANY_VALUE(target_country)       AS country,
      SUM(impressions)                AS impressions,
      SUM(clicks)                     AS clicks,
      SUM(cost)                       AS cost,
      SUM(conversions)                AS conversions,
      SUM(conversion_value)           AS conversion_value,
      SAFE_DIVIDE(SUM(conversion_value), NULLIF(SUM(cost), 0)) AS roas
    FROM ${table}
    WHERE ${where.join(" AND ")}
    GROUP BY offer_id, merchant_id
    ORDER BY ${sortBy} ${direction} NULLS LAST
    ${limitClause}
  `;
  return { sql, params, types, range, sortBy, direction };
}

export async function getProductPerformance(opts: {
  range: Partial<DateRange>;
  sortBy?: ProductSortBy;
  direction?: "top" | "bottom";
  merchantId?: string;
  country?: string;
  limit?: number;
  bypassCache?: boolean;
}): Promise<ProductPerformanceRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100000);
  const { sql, params, types, range, sortBy, direction } = buildProductPerformanceQuery({ ...opts, limit });
  if (opts.bypassCache) {
    recordBypass("getProductPerformance");
    return runQuery<ProductPerformanceRow>(sql, { params, types });
  }
  const key = hashKey([
    "product-performance",
    range,
    sortBy,
    direction,
    opts.merchantId ?? null,
    opts.country ?? null,
    limit,
  ]);
  return withCache<ProductPerformanceRow>("getProductPerformance", key, sql, { params, types });
}

/**
 * Streaming variant of getProductPerformance — returns a row stream from
 * BigQuery without buffering. Bypasses the result cache. Omit `limit` to
 * stream the full result set.
 */
export function streamProductPerformance(opts: {
  range: Partial<DateRange>;
  sortBy?: ProductSortBy;
  direction?: "top" | "bottom";
  merchantId?: string;
  country?: string;
  limit?: number;
}): Readable {
  const { sql, params, types } = buildProductPerformanceQuery(opts);
  return createQueryRowStream(sql, { params, types });
}

// ─── Product issues / disapprovals ────────────────────────────────────────────

export interface ProductIssueRow {
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

function buildProductIssuesQuery(opts: {
  merchantId?: string;
  country?: string;
  servability?: "disapproved" | "demoted" | "all";
  limit?: number;
}): { sql: string; params: Record<string, unknown>; types: Record<string, string> } {
  const table = tableRef("SHOPPING_INSIDER_TABLE_PRODUCT_ISSUES", "product_issues_materialized");

  const where: string[] = ["1 = 1"];
  const params: Record<string, unknown> = {};
  const types: Record<string, string> = {};
  if (opts.merchantId) {
    where.push("CAST(merchant_id AS STRING) = @merchantId");
    params.merchantId = opts.merchantId;
    types.merchantId = "STRING";
  }
  if (opts.country) {
    where.push("UPPER(country) = UPPER(@country)");
    params.country = opts.country;
    types.country = "STRING";
  }
  if (opts.servability && opts.servability !== "all") {
    where.push("LOWER(servability) = LOWER(@servability)");
    params.servability = opts.servability;
    types.servability = "STRING";
  }

  let limitClause = "";
  if (opts.limit !== undefined) {
    params.limit = Math.max(opts.limit, 1);
    types.limit = "INT64";
    limitClause = "LIMIT @limit";
  }

  const sql = `
    SELECT
      CAST(offer_id AS STRING)    AS offer_id,
      ANY_VALUE(title)            AS title,
      CAST(merchant_id AS STRING) AS merchant_id,
      ANY_VALUE(country)          AS country,
      ANY_VALUE(destination)      AS destination,
      ANY_VALUE(servability)      AS servability,
      CAST(issue_code AS STRING)  AS issue_code,
      ANY_VALUE(short_description) AS issue_description,
      ANY_VALUE(detail)            AS detail,
      COUNT(*)                     AS num_items
    FROM ${table}
    WHERE ${where.join(" AND ")}
    GROUP BY offer_id, merchant_id, issue_code
    ORDER BY num_items DESC
    ${limitClause}
  `;
  return { sql, params, types };
}

export async function getProductIssues(opts: {
  merchantId?: string;
  country?: string;
  servability?: "disapproved" | "demoted" | "all";
  limit?: number;
  bypassCache?: boolean;
}): Promise<ProductIssueRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 100000);
  const { sql, params, types } = buildProductIssuesQuery({ ...opts, limit });
  if (opts.bypassCache) {
    recordBypass("getProductIssues");
    return runQuery<ProductIssueRow>(sql, { params, types });
  }
  const key = hashKey([
    "product-issues",
    opts.merchantId ?? null,
    opts.country ?? null,
    opts.servability ?? "all",
    limit,
  ]);
  return withCache<ProductIssueRow>("getProductIssues", key, sql, { params, types });
}

/**
 * Streaming variant of getProductIssues — returns a row stream from BigQuery
 * without buffering. Bypasses the result cache. Omit `limit` to stream the
 * full result set.
 */
export function streamProductIssues(opts: {
  merchantId?: string;
  country?: string;
  servability?: "disapproved" | "demoted" | "all";
  limit?: number;
}): Readable {
  const { sql, params, types } = buildProductIssuesQuery(opts);
  return createQueryRowStream(sql, { params, types });
}

// ─── Account-level health ─────────────────────────────────────────────────────

export interface AccountHealthRow {
  merchant_id: string;
  country: string | null;
  total_products: number;
  approved_products: number;
  disapproved_products: number;
  pending_products: number;
  active_products: number;
  approval_rate: number;
}

export async function getAccountHealth(opts: { merchantId?: string; country?: string; bypassCache?: boolean }): Promise<AccountHealthRow[]> {
  const table = tableRef("SHOPPING_INSIDER_TABLE_ACCOUNT_SUMMARY", "account_summary_materialized");
  const where: string[] = ["1 = 1"];
  const params: Record<string, unknown> = {};
  const types: Record<string, string> = {};
  if (opts.merchantId) {
    where.push("CAST(merchant_id AS STRING) = @merchantId");
    params.merchantId = opts.merchantId;
    types.merchantId = "STRING";
  }
  if (opts.country) {
    where.push("UPPER(country) = UPPER(@country)");
    params.country = opts.country;
    types.country = "STRING";
  }
  const sql = `
    SELECT
      CAST(merchant_id AS STRING) AS merchant_id,
      ANY_VALUE(country)          AS country,
      SUM(total_products)         AS total_products,
      SUM(approved_products)      AS approved_products,
      SUM(disapproved_products)   AS disapproved_products,
      SUM(pending_products)       AS pending_products,
      SUM(active_products)        AS active_products,
      SAFE_DIVIDE(SUM(approved_products), NULLIF(SUM(total_products), 0)) AS approval_rate
    FROM ${table}
    WHERE ${where.join(" AND ")}
    GROUP BY merchant_id
    ORDER BY total_products DESC
  `;
  if (opts.bypassCache) {
    recordBypass("getAccountHealth");
    return runQuery<AccountHealthRow>(sql, { params, types });
  }
  const key = hashKey(["account-health", opts.merchantId ?? null, opts.country ?? null]);
  return withCache<AccountHealthRow>("getAccountHealth", key, sql, { params, types });
}

export { BigQueryConfigError };
