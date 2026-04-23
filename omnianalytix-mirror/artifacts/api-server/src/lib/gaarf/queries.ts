/**
 * Named GAQL query library.
 *
 * Each entry is a named query template following GAARF's extended GAQL syntax:
 *   - Aliases via AS keyword
 *   - Nested resource extraction via :path syntax
 *   - Virtual column arithmetic
 *   - Macros: {start_date}, {end_date} are substituted at execution time
 *
 * Usage: import { GAARF_QUERIES } and pick by name, then pass to executor.
 */

export interface GaarfQueryTemplate {
  name: string;
  description: string;
  gaql: string;
  /** Macros that must be supplied at runtime (e.g. start_date, end_date) */
  requiredMacros?: string[];
  /** Optional macros with defaults */
  defaultMacros?: Record<string, string>;
}

/** Trailing 30 days — used as default date range */
const DEFAULT_MACROS = {
  start_date: ":LAST_30_DAYS",
  end_date: ":TODAY",
};

export const GAARF_QUERIES: Record<string, GaarfQueryTemplate> = {
  campaign_performance: {
    name: "campaign_performance",
    description: "Campaign-level impressions, clicks, cost, conversions and ROAS for a date range",
    defaultMacros: DEFAULT_MACROS,
    gaql: `
SELECT
  customer.id AS account_id,
  customer.descriptive_name AS account_name,
  campaign.id AS campaign_id,
  campaign.name AS campaign_name,
  campaign.status AS status,
  campaign.advertising_channel_type AS channel,
  metrics.impressions AS impressions,
  metrics.clicks AS clicks,
  metrics.cost_micros / 1000000 AS cost_usd,
  metrics.conversions AS conversions,
  metrics.conversions_value AS revenue,
  metrics.search_impression_share AS impression_share,
  segments.date AS date
FROM campaign
WHERE segments.date BETWEEN '{start_date}' AND '{end_date}'
  AND campaign.status != 'REMOVED'
ORDER BY metrics.cost_micros DESC
    `.trim(),
  },

  ad_group_performance: {
    name: "ad_group_performance",
    description: "Ad-group level performance metrics",
    defaultMacros: DEFAULT_MACROS,
    gaql: `
SELECT
  campaign.id AS campaign_id,
  campaign.name AS campaign_name,
  ad_group.id AS ad_group_id,
  ad_group.name AS ad_group_name,
  ad_group.status AS status,
  metrics.impressions AS impressions,
  metrics.clicks AS clicks,
  metrics.cost_micros / 1000000 AS cost_usd,
  metrics.conversions AS conversions,
  metrics.conversions_value AS revenue,
  segments.date AS date
FROM ad_group
WHERE segments.date BETWEEN '{start_date}' AND '{end_date}'
  AND ad_group.status != 'REMOVED'
ORDER BY metrics.cost_micros DESC
    `.trim(),
  },

  keyword_performance: {
    name: "keyword_performance",
    description: "Keyword-level bids, quality scores, and performance",
    defaultMacros: DEFAULT_MACROS,
    gaql: `
SELECT
  campaign.id AS campaign_id,
  campaign.name AS campaign_name,
  ad_group.id AS ad_group_id,
  ad_group.name AS ad_group_name,
  ad_group_criterion.criterion_id AS keyword_id,
  ad_group_criterion.keyword.text AS keyword,
  ad_group_criterion.keyword.match_type AS match_type,
  ad_group_criterion.cpc_bid_micros / 1000000 AS cpc_bid_usd,
  ad_group_criterion.quality_info.quality_score AS quality_score,
  ad_group_criterion.status AS status,
  metrics.impressions AS impressions,
  metrics.clicks AS clicks,
  metrics.cost_micros / 1000000 AS cost_usd,
  metrics.conversions AS conversions,
  segments.date AS date
FROM keyword_view
WHERE segments.date BETWEEN '{start_date}' AND '{end_date}'
  AND ad_group_criterion.status != 'REMOVED'
ORDER BY metrics.cost_micros DESC
    `.trim(),
  },

  shopping_performance: {
    name: "shopping_performance",
    description: "Shopping campaign product-level performance",
    defaultMacros: DEFAULT_MACROS,
    gaql: `
SELECT
  campaign.id AS campaign_id,
  campaign.name AS campaign_name,
  segments.product_item_id AS product_id,
  segments.product_title AS product_title,
  segments.product_brand AS brand,
  segments.product_type_l1 AS category_l1,
  metrics.impressions AS impressions,
  metrics.clicks AS clicks,
  metrics.cost_micros / 1000000 AS cost_usd,
  metrics.conversions AS conversions,
  metrics.conversions_value AS revenue,
  segments.date AS date
FROM shopping_performance_view
WHERE segments.date BETWEEN '{start_date}' AND '{end_date}'
ORDER BY metrics.cost_micros DESC
    `.trim(),
  },

  budget_utilisation: {
    name: "budget_utilisation",
    description: "Campaign budget amounts and current spend vs budget",
    defaultMacros: DEFAULT_MACROS,
    gaql: `
SELECT
  campaign.id AS campaign_id,
  campaign.name AS campaign_name,
  campaign.status AS status,
  campaign_budget.amount_micros / 1000000 AS daily_budget_usd,
  campaign_budget.type AS budget_type,
  metrics.cost_micros / 1000000 AS cost_usd,
  metrics.impressions AS impressions,
  metrics.clicks AS clicks,
  segments.date AS date
FROM campaign
WHERE segments.date = '{start_date}'
  AND campaign.status = 'ENABLED'
ORDER BY metrics.cost_micros DESC
    `.trim(),
  },

  account_structure: {
    name: "account_structure",
    description: "Account → Campaign → Ad Group hierarchy mapping",
    gaql: `
SELECT
  customer.id AS account_id,
  customer.descriptive_name AS account_name,
  customer.currency_code AS currency,
  campaign.id AS campaign_id,
  campaign.name AS campaign_name,
  campaign.status AS campaign_status,
  campaign.advertising_channel_type AS channel,
  ad_group.id AS ad_group_id,
  ad_group.name AS ad_group_name,
  ad_group.status AS ad_group_status
FROM ad_group
WHERE campaign.status != 'REMOVED'
  AND ad_group.status != 'REMOVED'
ORDER BY campaign.id, ad_group.id
    `.trim(),
  },

  search_terms: {
    name: "search_terms",
    description: "Search term report — which actual queries triggered ads",
    defaultMacros: DEFAULT_MACROS,
    gaql: `
SELECT
  campaign.id AS campaign_id,
  campaign.name AS campaign_name,
  ad_group.id AS ad_group_id,
  ad_group.name AS ad_group_name,
  search_term_view.search_term AS search_term,
  search_term_view.status AS status,
  metrics.impressions AS impressions,
  metrics.clicks AS clicks,
  metrics.cost_micros / 1000000 AS cost_usd,
  metrics.conversions AS conversions
FROM search_term_view
WHERE segments.date BETWEEN '{start_date}' AND '{end_date}'
ORDER BY metrics.impressions DESC
    `.trim(),
  },
};
