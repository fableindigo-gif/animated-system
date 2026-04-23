-- Light alias layer over the raw Shopify products warehouse table.
SELECT
    product_id,
    sku,
    title,
    price,
    cogs,
    inventory_qty,
    tenant_id
FROM {{ source('warehouse', 'warehouse_shopify_products') }}
