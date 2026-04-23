{{
  config(
    materialized = 'table',
    indexes = [
      { 'columns': ['campaign_name'] },
      { 'columns': ['cost_usd'] },
    ]
  )
}}

-- Ads currently spending budget on out-of-stock SKUs. Direct dbt port of
-- public.v_ads_on_empty_shelves (defined in artifacts/api-server/database/
-- schema.sql). Materialised as a TABLE here — the original is a view, but
-- this query is heavy enough that the agent's `query_warehouse` tool was
-- already hitting it on every gap-finder run, and a table cuts that to a
-- single index lookup.
SELECT
    g.campaign_name,
    g.ad_group_name,
    g.final_url,
    g.cost_usd,
    g.conversions,
    s.title              AS product_title,
    s.sku,
    s.inventory_qty,
    s.price,
    m.confidence         AS mapping_confidence
FROM {{ ref('stg_google_ads') }}              AS g
JOIN {{ ref('stg_cross_platform_mapping') }}  AS m ON m.google_ad_id      = g.ad_id
JOIN {{ ref('stg_shopify_products') }}        AS s ON s.product_id        = m.shopify_product_id
WHERE s.inventory_qty = 0
