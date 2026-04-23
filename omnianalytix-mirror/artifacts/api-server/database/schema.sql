-- ============================================================
-- OmniAnalytix — Unified Data Warehouse Schema
-- Sprint V: ETL Pipeline
--
-- These tables are managed by Drizzle ORM and are already live
-- in the Replit PostgreSQL instance via lib/db/src/schema/warehouse.ts
-- This file is a human-readable reference / export.
-- ============================================================

-- ── Clients ──────────────────────────────────────────────────────────────────
-- Registry of managed ad accounts. One row per client / MCC sub-account.
CREATE TABLE IF NOT EXISTS clients (
  id      SERIAL PRIMARY KEY,
  name    TEXT NOT NULL,
  mcc_id  TEXT                           -- Google Ads MCC Customer ID
);

-- ── Shopify Products ──────────────────────────────────────────────────────────
-- One row per product variant (identified by SKU).
-- Synced from Shopify Admin API on every ETL run.
CREATE TABLE IF NOT EXISTS warehouse_shopify_products (
  id             TEXT PRIMARY KEY,        -- "{product_id}_{sku}"
  product_id     TEXT        NOT NULL,
  sku            TEXT        NOT NULL DEFAULT '',
  handle         TEXT        NOT NULL DEFAULT '',  -- URL handle, e.g. "blue-widget"
  title          TEXT        NOT NULL DEFAULT '',
  variant_title  TEXT,
  status         TEXT                 DEFAULT 'active',  -- active | draft | archived
  inventory_qty  INTEGER              DEFAULT 0,
  price          DOUBLE PRECISION     DEFAULT 0,
  cogs           DOUBLE PRECISION     DEFAULT 0,   -- sourced from inventory_items.cost
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Google Ads ────────────────────────────────────────────────────────────────
-- One row per enabled ad (campaign + ad_group + ad_id).
-- Synced from Google Ads API (GAQL) on every ETL run with 30-day metrics.
CREATE TABLE IF NOT EXISTS warehouse_google_ads (
  id             TEXT PRIMARY KEY,        -- "{campaign_id}_{ad_group_id}_{ad_id}"
  campaign_id    TEXT        NOT NULL,
  campaign_name  TEXT                 DEFAULT '',
  ad_group_id    TEXT        NOT NULL,
  ad_group_name  TEXT                 DEFAULT '',
  ad_id          TEXT        NOT NULL,
  final_url      TEXT                 DEFAULT '',  -- destination URL of the ad
  cost_usd       DOUBLE PRECISION     DEFAULT 0,   -- 30-day spend in USD
  conversions    DOUBLE PRECISION     DEFAULT 0,   -- 30-day reported conversions
  impressions    INTEGER              DEFAULT 0,
  clicks         INTEGER              DEFAULT 0,
  status         TEXT                 DEFAULT 'ENABLED',
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Cross-Platform Mapping ───────────────────────────────────────────────────
-- Joins warehouse_shopify_products.product_id to warehouse_google_ads.ad_id.
-- Built automatically by the ETL by extracting the Shopify product handle
-- from each ad's final_url (pattern: /products/{handle}).
CREATE TABLE IF NOT EXISTS warehouse_cross_platform_mapping (
  id                 TEXT PRIMARY KEY,      -- "{ad_id}_{product_id}"
  google_ad_id       TEXT        NOT NULL,
  shopify_product_id TEXT        NOT NULL,
  sku                TEXT                 DEFAULT '',
  final_url          TEXT                 DEFAULT '',
  match_type         TEXT                 DEFAULT 'handle',  -- handle | sku | query_param | path_segment
  confidence         TEXT                 DEFAULT 'HIGH',    -- HIGH | MEDIUM | LOW
  synced_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (google_ad_id, shopify_product_id)
);

-- ── Useful Analytical Views ───────────────────────────────────────────────────

-- View: ads promoting out-of-stock products (highest cost first)
CREATE OR REPLACE VIEW v_ads_on_empty_shelves AS
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
FROM warehouse_google_ads g
JOIN warehouse_cross_platform_mapping m ON m.google_ad_id = g.ad_id
JOIN warehouse_shopify_products       s ON s.product_id   = m.shopify_product_id
WHERE s.inventory_qty = 0
ORDER BY g.cost_usd DESC;

-- View: POAS by SKU (Profit-On-Ad-Spend using warehouse COGS)
CREATE OR REPLACE VIEW v_poas_by_sku AS
SELECT
  s.sku,
  s.title              AS product_title,
  s.price,
  s.cogs,
  ROUND(CAST(s.price - s.cogs AS NUMERIC), 2)                    AS gross_profit_per_unit,
  CAST(SUM(g.cost_usd)    AS NUMERIC)                            AS total_ad_spend,
  CAST(SUM(g.conversions) AS NUMERIC)                            AS total_conversions,
  CASE
    WHEN SUM(g.cost_usd) > 0
    THEN ROUND(CAST(SUM(g.conversions) * (s.price - s.cogs) / SUM(g.cost_usd) AS NUMERIC), 2)
    ELSE NULL
  END                  AS poas
FROM warehouse_shopify_products       s
JOIN warehouse_cross_platform_mapping m ON m.shopify_product_id = s.product_id
JOIN warehouse_google_ads             g ON g.ad_id               = m.google_ad_id
GROUP BY s.sku, s.title, s.price, s.cogs
ORDER BY poas DESC NULLS LAST;
