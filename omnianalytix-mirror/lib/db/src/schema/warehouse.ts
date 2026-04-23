import {
  pgTable,
  text,
  integer,
  doublePrecision,
  timestamp,
  uniqueIndex,
  index,
  jsonb,
} from "drizzle-orm/pg-core";

// Default tenant used in single-tenant deployments.
// When multi-tenancy is introduced, populate this from the authenticated user's ID.
export const DEFAULT_TENANT_ID = "default";

// ─── Warehouse: Shopify Products ──────────────────────────────────────────────
// Synced from Shopify Admin API — one row per variant (sku).
// ETL key: (product_id, sku) — upserted on every sync run.
export const warehouseShopifyProducts = pgTable(
  "warehouse_shopify_products",
  {
    id:            text("id").primaryKey(),              // "{productId}_{sku}" composite
    tenantId:      text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    productId:     text("product_id").notNull(),
    sku:           text("sku").notNull().default(""),
    handle:        text("handle").notNull().default(""), // e.g. "blue-widget"
    title:         text("title").notNull().default(""),
    variantTitle:  text("variant_title").default(""),
    status:        text("status").default("active"),     // active | draft | archived
    inventoryQty:  integer("inventory_qty").default(0),
    price:         doublePrecision("price").default(0),
    cogs:          doublePrecision("cogs").default(0),   // cost from inventory_items
    imageUrl:      text("image_url").default(""),        // Shopify CDN product image URL
    brandLogoUrl:  text("brand_logo_url").default(""),   // optional vendor/brand logo URL
    description:   text("description").default(""),      // product body_html stripped of HTML
    llmAttributes: jsonb("llm_attributes").$type<{
      shape?: string;
      occasion?: string;
      finish?: string;
      activity?: string;
      [key: string]: string | undefined;
    } | null>().default(null),                           // LLM-extracted conversational attributes
    llmEnrichedAt: timestamp("llm_enriched_at", { withTimezone: true }), // null = not yet enriched
    syncedAt:      timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("warehouse_shopify_products_tenant_idx").on(t.tenantId),
  ],
);

// ─── Warehouse: Google Ads ─────────────────────────────────────────────────────
// Synced from Google Ads API — one row per campaign (campaign-level aggregates).
// adGroupId / adId are sentinel "campaign_level" values for all non-PMax campaigns.
// PMax campaigns are stored here at campaign level; their asset group breakdown
// lives in warehouse_google_ads_asset_groups (see below).
// ETL key: campaignId — upserted on every sync run.
export const warehouseGoogleAds = pgTable(
  "warehouse_google_ads",
  {
    id:           text("id").primaryKey(),               // "{campaignId}_{adGroupId}_{adId}"
    tenantId:     text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    campaignId:   text("campaign_id").notNull(),
    campaignName: text("campaign_name").default(""),
    adGroupId:    text("ad_group_id").notNull(),
    adGroupName:  text("ad_group_name").default(""),
    adId:              text("ad_id").notNull(),
    finalUrl:          text("final_url").default(""),
    costUsd:           doublePrecision("cost_usd").default(0),
    // conversionValue: the actual conversion value reported by Google Ads
    // (sum of conversion event values, e.g. purchase revenue). This is the
    // authoritative attributed-revenue figure — do NOT proxy with
    // `conversions * product.price`, which is always $0 when SKU mapping
    // is incomplete. Populated at campaign level from metrics.conversions_value.
    conversionValue:   doublePrecision("conversion_value").default(0),
    conversions:       doublePrecision("conversions").default(0),
    impressions:       integer("impressions").default(0),
    clicks:            integer("clicks").default(0),
    status:            text("status").default("ENABLED"),
    // accountCurrency: ISO-4217 code of the Google Ads account (e.g. "INR").
    // The costUsd column stores values in THIS currency — the name is a
    // historical misnomer. Downstream callers must apply FX conversion
    // before displaying as USD.
    accountCurrency:         text("account_currency").default("USD"),
    // advertisingChannelType: from campaign.advertising_channel_type in the
    // Google Ads API. Used to route PMax vs. traditional campaign logic
    // throughout the diagnostic engine and AI tool layer.
    advertisingChannelType:  text("advertising_channel_type").default("SEARCH"),
    syncedAt:          timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("warehouse_google_ads_tenant_idx").on(t.tenantId),
    index("warehouse_google_ads_campaign_idx").on(t.campaignId),
  ],
);

// ─── Warehouse: Google Ads Asset Groups (PMax) ───────────────────────────────
// Performance Max campaigns do not use ad groups or individual ads — they use
// asset groups instead.  This table stores one row per asset group per campaign
// so that URL presence, asset diversity, and spend can be attributed correctly
// at the right granularity (asset group, not the dummy "ad group" layer).
//
// ETL: populated on every sync run, keyed on "{campaignId}_{assetGroupId}".
// Consumers: advanced-diagnostic-engine (compliance check), AI tool
//            (get_campaign_performance PMax drill-down).
export const warehouseGoogleAdsAssetGroups = pgTable(
  "warehouse_google_ads_asset_groups",
  {
    id:              text("id").primaryKey(),             // "{campaignId}_{assetGroupId}"
    tenantId:        text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    campaignId:      text("campaign_id").notNull(),
    campaignName:    text("campaign_name").default(""),
    assetGroupId:    text("asset_group_id").notNull(),
    assetGroupName:  text("asset_group_name").default(""),
    // finalUrls: array of destination URLs on this asset group.
    // An empty array (or null) means the asset group is missing final URLs —
    // the compliance check uses this directly so the count matches the drill-down.
    finalUrls:       jsonb("final_urls").$type<string[]>().default([]),
    status:          text("status").default("ENABLED"),
    costUsd:         doublePrecision("cost_usd").default(0),
    conversionValue: doublePrecision("conversion_value").default(0),
    conversions:     doublePrecision("conversions").default(0),
    impressions:     integer("impressions").default(0),
    clicks:          integer("clicks").default(0),
    accountCurrency: text("account_currency").default("USD"),
    syncedAt:        timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("warehouse_google_ads_asset_groups_tenant_idx").on(t.tenantId),
    index("warehouse_google_ads_asset_groups_campaign_idx").on(t.campaignId),
  ],
);

// ─── Warehouse: Cross-Platform Mapping ───────────────────────────────────────
// Joins Shopify SKU / product handle to Google Ads final_url.
// ETL builds this automatically by extracting handles/SKUs from final_urls.
export const warehouseCrossPlatformMapping = pgTable(
  "warehouse_cross_platform_mapping",
  {
    id:               text("id").primaryKey(),           // "{adId}_{productId}"
    tenantId:         text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    googleAdId:       text("google_ad_id").notNull(),
    shopifyProductId: text("shopify_product_id").notNull(),
    sku:              text("sku").default(""),
    finalUrl:         text("final_url").default(""),
    matchType:        text("match_type").default("handle"), // handle | sku | query_param
    confidence:       text("confidence").default("HIGH"),   // HIGH | MEDIUM | LOW
    syncedAt:         timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("cross_platform_mapping_ad_product_uidx").on(t.googleAdId, t.shopifyProductId),
  ],
);

// ─── Warehouse: CRM Leads (Salesforce / HubSpot) ────────────────────────────
// Synced from CRM APIs — one row per lead/contact.
// ETL key: (crm_provider, crm_lead_id) — upserted on every sync run.
export const warehouseCrmLeads = pgTable(
  "warehouse_crm_leads",
  {
    id:              text("id").primaryKey(),
    tenantId:        text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    crmProvider:     text("crm_provider").notNull(),
    crmLeadId:       text("crm_lead_id").notNull(),
    email:           text("email").default(""),
    firstName:       text("first_name").default(""),
    lastName:        text("last_name").default(""),
    company:         text("company").default(""),
    leadStatus:      text("lead_status").default("new"),
    lifecycleStage:  text("lifecycle_stage").default("lead"),
    source:          text("source").default(""),
    utmSource:       text("utm_source").default(""),
    utmMedium:       text("utm_medium").default(""),
    utmCampaign:     text("utm_campaign").default(""),
    gclid:           text("gclid").default(""),
    fbclid:          text("fbclid").default(""),
    conversionValue: doublePrecision("conversion_value").default(0),
    convertedAt:     timestamp("converted_at", { withTimezone: true }),
    closedAt:        timestamp("closed_at", { withTimezone: true }),
    dealAmount:      doublePrecision("deal_amount").default(0),
    dealName:        text("deal_name").default(""),
    probability:     doublePrecision("probability").default(0),   // 0-100
    pipelineStage:   text("pipeline_stage").default("discovery"), // discovery|proposal|negotiation|closed_won|closed_lost
    syncedAt:        timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("crm_leads_provider_id_uidx").on(t.crmProvider, t.crmLeadId),
  ],
);

// ─── Warehouse: Product Quality Fixes (Shoptimizer pre-computed diffs) ───────
// One row per warehouse product. Populated by the quality-fixes scanner
// worker. The Quality Fixes UI reads from this table instead of hitting the
// external Shoptimizer service on every page load.
//
// Staleness model: `productSyncedAt` snapshots the warehouse product's
// `synced_at` at the time the scan ran. The scanner refreshes any row whose
// `productSyncedAt` is older than the live product's `synced_at`, plus rows
// that don't exist yet.
export const productQualityFixes = pgTable(
  "product_quality_fixes",
  {
    id:               text("id").primaryKey(),                       // matches warehouse_shopify_products.id
    tenantId:         text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    productId:        text("product_id").notNull(),
    sku:              text("sku").notNull().default(""),
    status:           text("status").notNull().default("ok"),        // "ok" | "error"
    errorCode:        text("error_code"),
    errorMessage:     text("error_message"),
    pluginsFired:     jsonb("plugins_fired").$type<string[]>().notNull().default([]),
    changedFields:    jsonb("changed_fields").$type<Array<{ field: string; before: unknown; after: unknown }>>().notNull().default([]),
    changeCount:      integer("change_count").notNull().default(0),
    optimizedProduct: jsonb("optimized_product").$type<Record<string, unknown> | null>().default(null),
    productSyncedAt:  timestamp("product_synced_at", { withTimezone: true }).notNull(),
    scannedAt:        timestamp("scanned_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("product_quality_fixes_tenant_idx").on(t.tenantId),
    index("product_quality_fixes_change_count_idx").on(t.changeCount),
  ],
);

export type ProductQualityFix          = typeof productQualityFixes.$inferSelect;
export type WarehouseShopifyProduct    = typeof warehouseShopifyProducts.$inferSelect;
export type WarehouseGoogleAd          = typeof warehouseGoogleAds.$inferSelect;
export type WarehouseCrossPlatformMap  = typeof warehouseCrossPlatformMapping.$inferSelect;
export type WarehouseCrmLead           = typeof warehouseCrmLeads.$inferSelect;
