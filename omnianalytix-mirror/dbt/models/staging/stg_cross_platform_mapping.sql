-- Edges joining Google Ads → Shopify products. Kept as a 1:1 alias so
-- marts can join via this stub instead of referencing the raw table.
SELECT
    google_ad_id,
    shopify_product_id,
    sku,
    final_url,
    match_type,
    confidence,
    synced_at
FROM {{ source('warehouse', 'warehouse_cross_platform_mapping') }}
