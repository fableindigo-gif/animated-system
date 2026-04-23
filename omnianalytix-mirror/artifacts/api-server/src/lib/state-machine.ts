/**
 * State Machine — Time Machine & Human-in-the-Loop
 * Classifies tools as READ vs WRITE, generates display diffs, manages snapshots.
 */

// ─── Tool Classification ───────────────────────────────────────────────────────

export const WRITE_TOOLS = new Set([
  "googleAds_updateCampaignBudget",
  "googleAds_updateCampaignBidding",
  "googleAds_updateCampaignStatus",
  "googleAds_addNegativeKeyword",
  "meta_updateAdSetBudget",
  "meta_updateObjectStatus",
  "meta_updateAdCreative",
  "shopify_updateProductStatus",
  "shopify_createDiscountCode",
  "shopify_updateProductMetafield",
  "shopify_updateVariantPrice",
  "shopify_updateInventory",
  "shopify_updateProductDetails",
  "shopify_createProduct",
  "shopify_fulfillOrder",
  "shopify_tagOrder",
  "shopify_createBlogPost",
  "shopify_updatePageContent",
  "shopify_createMetafieldDefinitions",
  "update_shopify_theme_colors",
  "pause_pmax_asset_group",
  "sync_poas_conversion_value",
  "sync_gmc_sge_metadata",
  "resolve_gmc_mismatch",
  "sync_high_ltv_customer_match",
  "create_liquidation_discount",
  "sheets_createSpreadsheet",
  "sheets_writeRange",
  "sheets_appendRows",
]);

export function isWriteTool(toolName: string): boolean {
  return WRITE_TOOLS.has(toolName);
}

// ─── Platform Mapping ─────────────────────────────────────────────────────────

const TOOL_PLATFORM_MAP: Record<string, string> = {
  googleAds_updateCampaignBudget: "google_ads",
  googleAds_updateCampaignBidding: "google_ads",
  googleAds_updateCampaignStatus: "google_ads",
  googleAds_addNegativeKeyword: "google_ads",
  meta_updateAdSetBudget: "meta",
  meta_updateObjectStatus: "meta",
  meta_updateAdCreative: "meta",
  shopify_updateProductStatus: "shopify",
  shopify_createDiscountCode: "shopify",
  shopify_updateProductMetafield: "shopify",
  shopify_updateVariantPrice: "shopify",
  shopify_updateInventory: "shopify",
  shopify_updateProductDetails: "shopify",
  shopify_createProduct: "shopify",
  shopify_fulfillOrder: "shopify",
  shopify_tagOrder: "shopify",
  shopify_createBlogPost: "shopify",
  sheets_createSpreadsheet: "google_sheets",
  sheets_writeRange: "google_sheets",
  sheets_appendRows: "google_sheets",
};

const PLATFORM_LABELS: Record<string, string> = {
  google_ads: "Google Ads",
  meta: "Meta Ads",
  shopify: "Shopify",
  gmc: "Google Merchant Center",
  gsc: "Google Search Console",
  google_sheets: "Google Sheets",
};

export function getPlatformForTool(toolName: string): string {
  return TOOL_PLATFORM_MAP[toolName] ?? "unknown";
}

export function getPlatformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform;
}

// ─── Tool Display Names ───────────────────────────────────────────────────────

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  googleAds_updateCampaignBudget: "Update Campaign Budget",
  googleAds_updateCampaignBidding: "Update Bidding Strategy",
  googleAds_updateCampaignStatus: "Toggle Campaign Status",
  googleAds_addNegativeKeyword: "Add Negative Keyword",
  meta_updateAdSetBudget: "Update Ad Set Budget",
  meta_updateObjectStatus: "Toggle Object Status",
  meta_updateAdCreative: "Update Ad Creative",
  shopify_updateProductStatus: "Update Product Status",
  shopify_createDiscountCode: "Create Discount Code",
  shopify_updateProductMetafield: "Update Product Metafield",
  shopify_updateVariantPrice: "Update Variant Price",
  shopify_updateInventory: "Set Inventory Level",
  shopify_updateProductDetails: "Update Product Details",
  shopify_createProduct: "Create New Product",
  shopify_fulfillOrder: "Fulfill Order",
  shopify_tagOrder: "Tag Order",
  shopify_createBlogPost: "Publish Blog Post",
};

export function getToolDisplayName(toolName: string): string {
  return TOOL_DISPLAY_NAMES[toolName] ?? toolName.replace(/_/g, " ");
}

// ─── Display Diff Generator ───────────────────────────────────────────────────

export type DiffRow = { label: string; from: string; to: string };

export function generateDisplayDiff(
  toolName: string,
  args: Record<string, unknown>,
): DiffRow[] {
  switch (toolName) {
    case "googleAds_updateCampaignBudget":
      return [
        { label: "Campaign Budget ID", from: "—", to: String(args.campaignBudgetId) },
        { label: "Daily Budget", from: "current", to: `$${Number(args.newDailyBudgetUsd).toFixed(2)}/day` },
      ];
    case "googleAds_updateCampaignBidding":
      return [
        { label: "Campaign ID", from: "—", to: String(args.campaignId) },
        { label: "Bidding Strategy", from: "current", to: String(args.strategy) },
        { label: "Target Value", from: "current", to: args.strategy === "TARGET_ROAS" ? `${Number(args.targetValue).toFixed(2)}x ROAS` : `$${Number(args.targetValue).toFixed(2)} CPA` },
      ];
    case "googleAds_updateCampaignStatus":
      return [
        { label: "Campaign ID", from: "—", to: String(args.campaignId) },
        { label: "Status", from: "current", to: String(args.status) },
      ];
    case "googleAds_addNegativeKeyword":
      return [
        { label: "Negative Keyword", from: "—", to: `"${String(args.keyword)}"` },
        { label: "Match Type", from: "—", to: String(args.matchType) },
        { label: "Campaign ID", from: "—", to: String(args.campaignId) },
      ];
    case "meta_updateAdSetBudget":
      return [
        { label: "Ad Set ID", from: "—", to: String(args.adSetId) },
        ...(args.dailyBudget != null ? [{ label: "Daily Budget", from: "current", to: `$${Number(args.dailyBudget).toFixed(2)}/day` }] : []),
        ...(args.lifetimeBudget != null ? [{ label: "Lifetime Budget", from: "current", to: `$${Number(args.lifetimeBudget).toFixed(2)}` }] : []),
      ];
    case "meta_updateObjectStatus":
      return [
        { label: "Object ID", from: "—", to: String(args.objectId) },
        { label: "Status", from: "current", to: String(args.status) },
      ];
    case "meta_updateAdCreative":
      return [
        { label: "Ad ID", from: "—", to: String(args.adId) },
        ...(args.primaryText ? [{ label: "Primary Text", from: "current", to: String(args.primaryText).slice(0, 60) + (String(args.primaryText).length > 60 ? "…" : "") }] : []),
        ...(args.headline ? [{ label: "Headline", from: "current", to: String(args.headline) }] : []),
      ];
    case "shopify_updateVariantPrice":
      return [
        { label: "Variant ID", from: "—", to: String(args.variantId) },
        { label: "Price", from: "current", to: `$${Number(args.price).toFixed(2)}` },
        ...(args.compareAtPrice != null ? [{ label: "Compare-At Price", from: "current", to: `$${Number(args.compareAtPrice).toFixed(2)}` }] : []),
      ];
    case "shopify_updateProductStatus":
      return [
        { label: "Product ID", from: "—", to: String(args.productId) },
        { label: "Status", from: "current", to: String(args.status) },
      ];
    case "shopify_createDiscountCode":
      return [
        { label: "Code", from: "—", to: String(args.code) },
        { label: "Type", from: "—", to: String(args.discountType) },
        { label: "Value", from: "—", to: args.discountType === "percentage" ? `${args.discountValue}%` : `$${Number(args.discountValue).toFixed(2)}` },
        ...(args.usageLimit ? [{ label: "Usage Limit", from: "—", to: String(args.usageLimit) }] : []),
      ];
    case "shopify_updateInventory":
      return [
        { label: "Inventory Item ID", from: "—", to: String(args.inventoryItemId) },
        { label: "Available Units", from: "current", to: String(args.available) },
        { label: "Location ID", from: "—", to: String(args.locationId) },
      ];
    case "shopify_updateProductDetails":
      return [
        { label: "Product ID", from: "—", to: String(args.productId) },
        ...(args.title ? [{ label: "Title", from: "current", to: String(args.title).slice(0, 50) }] : []),
        ...(args.seoTitle ? [{ label: "SEO Title", from: "current", to: String(args.seoTitle).slice(0, 50) }] : []),
        ...(args.seoDescription ? [{ label: "SEO Description", from: "current", to: String(args.seoDescription).slice(0, 80) + "…" }] : []),
        ...(args.tags ? [{ label: "Tags", from: "current", to: String(args.tags).slice(0, 60) }] : []),
      ];
    case "shopify_createProduct":
      return [
        { label: "Product Title", from: "—", to: String(args.title) },
        { label: "Price", from: "—", to: `$${Number(args.price).toFixed(2)}` },
        { label: "Vendor", from: "—", to: String(args.vendor) },
        { label: "Type", from: "—", to: String(args.productType) },
      ];
    case "shopify_fulfillOrder":
      return [
        { label: "Order ID", from: "—", to: String(args.orderId) },
        { label: "Location ID", from: "—", to: String(args.locationId) },
        ...(args.trackingNumber ? [{ label: "Tracking #", from: "—", to: String(args.trackingNumber) }] : []),
        ...(args.trackingCompany ? [{ label: "Carrier", from: "—", to: String(args.trackingCompany) }] : []),
      ];
    case "shopify_tagOrder":
      return [
        { label: "Order ID", from: "—", to: String(args.orderId) },
        { label: "Tags", from: "current", to: String(args.tags) },
      ];
    case "shopify_createBlogPost":
      return [
        { label: "Blog ID", from: "—", to: String(args.blogId) },
        { label: "Title", from: "—", to: String(args.title).slice(0, 60) },
        { label: "Status", from: "—", to: args.published === false ? "Draft" : "Published" },
      ];
    case "shopify_updateProductMetafield":
      return [
        { label: "Product ID", from: "—", to: String(args.productId) },
        { label: "Metafield", from: "—", to: `${args.namespace}.${args.key}` },
        { label: "Value", from: "current", to: String(args.value).slice(0, 60) },
      ];
    default:
      return [{ label: "Action", from: "—", to: toolName }];
  }
}
