{{
  config(
    materialized = 'table',
    indexes = [
      { 'columns': ['sku'], 'unique': True },
      { 'columns': ['poas'] },
    ]
  )
}}

-- Profit-On-Ad-Spend per SKU. Direct dbt port of public.v_poas_by_sku.
-- Uses warehouse COGS (NOT a fee/shipping-aware POAS — that calc lives in
-- the runtime compute_poas tool which adds platform fees, returns, and
-- shipping). This mart is the lower-bound estimate the agent uses for
-- candidate selection.
WITH ads AS (
    SELECT
        m.shopify_product_id,
        SUM(g.cost_usd)    AS total_ad_spend,
        SUM(g.conversions) AS total_conversions
    FROM {{ ref('stg_google_ads') }}             AS g
    JOIN {{ ref('stg_cross_platform_mapping') }} AS m ON m.google_ad_id = g.ad_id
    GROUP BY m.shopify_product_id
)
SELECT
    s.sku,
    s.title  AS product_title,
    s.price,
    s.cogs,
    ROUND(CAST(s.price - s.cogs AS NUMERIC), 2)        AS gross_profit_per_unit,
    CAST(a.total_ad_spend    AS NUMERIC)               AS total_ad_spend,
    CAST(a.total_conversions AS NUMERIC)               AS total_conversions,
    CASE
        WHEN a.total_ad_spend > 0
        THEN ROUND(
            CAST(a.total_conversions * (s.price - s.cogs) / a.total_ad_spend AS NUMERIC),
            2
        )
        ELSE NULL
    END                                                AS poas
FROM {{ ref('stg_shopify_products') }} AS s
JOIN ads                                a ON a.shopify_product_id = s.product_id
