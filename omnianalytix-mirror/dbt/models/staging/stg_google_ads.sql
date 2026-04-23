-- Light alias layer over the raw warehouse table. Renames columns to the
-- canonical names downstream marts use, so changing the upstream column
-- names only requires editing this one file.
SELECT
    ad_id,
    campaign_name,
    ad_group_name,
    final_url,
    cost_usd,
    conversions,
    impressions,
    clicks,
    conversion_value
FROM {{ source('warehouse', 'warehouse_google_ads') }}
