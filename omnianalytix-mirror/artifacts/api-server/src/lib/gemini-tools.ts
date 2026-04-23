import type { Tool, FunctionDeclaration } from "./vertex-client";
import {
  googleAds_updateCampaignBudget,
  googleAds_updateCampaignBidding,
  googleAds_updateCampaignStatus,
  googleAds_addNegativeKeyword,
  meta_updateAdSetBudget,
  meta_updateObjectStatus,
  meta_updateAdCreative,
  shopify_updateProductStatus,
  shopify_dryRunValidate,
  shopify_createDiscountCode,
  shopify_updateProductMetafield,
  shopify_updateVariantPrice,
  shopify_updateInventory,
  shopify_updateProductDetails,
  shopify_createProduct,
  shopify_fulfillOrder,
  shopify_tagOrder,
  shopify_createBlogPost,
  gsc_getSites,
  gsc_getTopQueries,
  gsc_getTopPages,
  gsc_getQueryPageBreakdown,
  gsc_getSearchPerformance,
  sheets_listSpreadsheets,
  sheets_createSpreadsheet,
  sheets_readRange,
  sheets_writeRange,
  sheets_appendRows,
  sheets_getMetadata,
  // Phase 3
  shopify_getInventoryItemCOGS,
  shopify_computePOASMetrics,
  googleAds_getPMaxNetworkDistribution,
  gemini_analyzeCreatives,
  // Phase 4
  gemini_generateAdCopyMatrix,
  shopify_updatePageContent,
  shopify_getPages,
  shopify_getBlogs,
  shopify_getProductsByStatus,
  // Phase 5
  shopify_catalogSweep,
  shopify_createMetafieldDefinitions,
  shopify_getMetafieldDefinitions,
  shopify_updateThemeColors,
  // Phase 6
  compliance_auditDestinationUrl,
  // Intelligence Modules
  shopify_calculateSalesVelocity,
  shopify_createLiquidationDiscount,
  shopify_scanCompliancePolicy,
  shopify_optimizeProductSGE,
  shopify_calculateCustomerCLV,
  // Ecosystem Sync — Part 1 (Defensive)
  googleAds_pausePMaxAssetGroup,
  googleAds_listPMaxAssetGroups,
  googleAds_uploadConversionAdjustment,
  gmc_updateProductMetadata,
  gmc_auditProductMismatches,
  gmc_reconcileProduct,
  googleAds_pushCustomerMatchList,
  workspace_getBillingStatus,
  googleAds_reconcileAdPolicy,
  meta_reconcileAdPolicy,
  // Ecosystem Sync — Part 2 (Strategic Audit)
  googleAds_calculateAIAdoptionScore,
  googleAds_calculateAccountHeadroom,
  googleAds_identifyBudgetConstraints,
  googleAds_detectAutomationChurn,
  googleAds_listCampaigns,
  googleAds_listAccessibleCustomers,
  // Store-wide sweep helpers
  shopify_getStoreInventoryHealth,
  shopify_getStoreRevenueSummary,
  // Sprint N: GA4 & CRM
  ga4_deduplicateRevenue,
  crm_syncAudienceToAds,
  // Sprint R: Cross-Platform Synthesis
  crossPlatform_marginBleedXRay,
  crossPlatform_ghostAudienceDeduplicator,
  crossPlatform_crmArbitrage,
  // Sprint R+: Budget Constraint Pipeline
  googleAds_getBudgetConstrainedCampaigns,
  // Extended Google Ads READ catalog
  googleAds_getCampaignBudgetDetails,
  googleAds_listNegativeKeywords,
  googleAds_listAdGroups,
  googleAds_listKeywords,
  googleAds_listSearchTerms,
  googleAds_listConversionActions,
  googleAds_listAds,
  googleAds_listRecommendations,
  // Extended Google Ads EXECUTE catalog
  googleAds_createCampaignBudget,
  googleAds_updateAdGroupStatus,
  googleAds_updateAdStatus,
  googleAds_addPositiveKeyword,
  googleAds_updateKeywordBid,
  googleAds_removeNegativeKeyword,
  googleAds_applyRecommendation,
  type ExecutionResult,
} from "./platform-executors";
import { getGoogleGenAI, VERTEX_MODEL } from "./vertex-client";
import { auditTagInfrastructure } from "./tag-auditor";
import { db, warehouseShopifyProducts, warehouseGoogleAds, warehouseCrossPlatformMapping, platformConnections } from "@workspace/db";
import { sql as drizzleSql, and, eq, isNull } from "drizzle-orm";
import { isWriteTool, validateToolArgs, queueWriteOperation } from "./tool-orchestrator";

// ─── Function Declarations ────────────────────────────────────────────────────

// We declare schemas with the canonical OpenAPI string types ("object", "string",
// "number", etc.) which is what the Gemini wire protocol actually accepts. The
// SDK's `FunctionDeclaration` type insists on the SchemaType enum at compile
// time, but the enum's runtime values ARE these very strings — so we cast at
// the array boundary rather than rewriting 300+ literals.
const FUNCTION_DECLARATIONS = ([
  // ── Google Ads ──
  {
    name: "googleAds_updateCampaignBudget",
    description: "Update the daily budget for a Google Ads campaign budget. Use when the user approves a budget change or when analysis shows a campaign is limited by budget.",
    parameters: {
      type: "object",
      properties: {
        campaignBudgetId: { type: "string", description: "The numeric ID of the CampaignBudget to update (not the campaign ID)." },
        newDailyBudgetUsd: { type: "number", description: "The new daily budget in USD (e.g. 150.00)." },
      },
      required: ["campaignBudgetId", "newDailyBudgetUsd"],
    },
  },
  {
    name: "googleAds_updateCampaignBidding",
    description: "Update the bidding strategy (tROAS or tCPA) for a Google Ads campaign. Use when adjusting targets based on performance data.",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "The numeric campaign ID." },
        strategy: { type: "string", description: "The bidding strategy type: TARGET_ROAS or TARGET_CPA." },
        targetValue: { type: "number", description: "For TARGET_ROAS: the decimal ROAS target (e.g. 4.0 = 400% ROAS). For TARGET_CPA: the target cost per conversion in USD." },
      },
      required: ["campaignId", "strategy", "targetValue"],
    },
  },
  {
    name: "googleAds_updateCampaignStatus",
    description: "Enable or pause a Google Ads campaign. Use to pause bleeding campaigns or re-enable paused ones.",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "The numeric campaign ID." },
        status: { type: "string", description: "ENABLED to activate, PAUSED to pause." },
      },
      required: ["campaignId", "status"],
    },
  },
  {
    name: "googleAds_addNegativeKeyword",
    description: "Add a negative keyword to a Google Ads campaign to block irrelevant traffic.",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "The numeric campaign ID." },
        keyword: { type: "string", description: "The keyword text to add as negative (without match type brackets)." },
        matchType: { type: "string", description: "EXACT, PHRASE, or BROAD match type for the negative keyword." },
      },
      required: ["campaignId", "keyword", "matchType"],
    },
  },
  // ── Google Ads — Extended READ catalog ──
  {
    name: "googleAds_getCampaignBudgetDetails",
    description: "Read the current daily amount, delivery method, and shared/standalone status of a specific Google Ads campaign budget. Call this BEFORE proposing a budget update so you can show the user the current value.",
    parameters: {
      type: "object",
      properties: { campaignBudgetId: { type: "string", description: "The numeric campaign budget ID (not the campaign ID)." } },
      required: ["campaignBudgetId"],
    },
  },
  {
    name: "googleAds_listNegativeKeywords",
    description: "List the negative keywords currently attached to a campaign (or all campaigns if none specified). Use to audit existing exclusions before adding new ones, or to clean up overly broad negatives.",
    parameters: {
      type: "object",
      properties: { campaignId: { type: "string", description: "Optional numeric campaign ID. If omitted, returns negatives across the whole account." } },
    },
  },
  {
    name: "googleAds_listAdGroups",
    description: "List ad groups with their 30-day spend, clicks, conversions, status, and CPC bid. Filter by campaignId or list account-wide. Returns up to 200 ordered by spend.",
    parameters: {
      type: "object",
      properties: { campaignId: { type: "string", description: "Optional numeric campaign ID to filter to one campaign." } },
    },
  },
  {
    name: "googleAds_listKeywords",
    description: "List positive keywords in a specific ad group with quality score, CPC bid, and 30-day performance. Use for keyword-level optimisation analysis.",
    parameters: {
      type: "object",
      properties: { adGroupId: { type: "string", description: "The numeric ad group ID." } },
      required: ["adGroupId"],
    },
  },
  {
    name: "googleAds_listSearchTerms",
    description: "Pull the actual search terms users entered that triggered ads — the foundation for negative-keyword discovery and intent analysis. Returns top 200 by spend over the chosen date range.",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "Optional numeric campaign ID. Omit for account-wide." },
        daysBack: { type: "number", description: "Lookback window — 7, 30, or 90. Defaults to 30." },
      },
    },
  },
  {
    name: "googleAds_listConversionActions",
    description: "List every conversion action configured in the account (Purchase, Lead, etc.) with type, category, primary-for-goal flag, and default value. Use to audit conversion tracking setup.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "googleAds_listAds",
    description: "List ads (creatives) in an ad group, or account-wide if no ad group given. Returns ad type, status, final URLs, and 30-day performance.",
    parameters: {
      type: "object",
      properties: { adGroupId: { type: "string", description: "Optional numeric ad group ID." } },
    },
  },
  {
    name: "googleAds_listRecommendations",
    description: "List Google Ads' own automated recommendations (e.g. KEYWORD, BUDGET, TARGET_ROAS_OPT_IN) with projected impact. Pair with googleAds_applyRecommendation to enact one.",
    parameters: {
      type: "object",
      properties: { type: { type: "string", description: "Optional recommendation type filter (e.g. KEYWORD, CAMPAIGN_BUDGET, TARGET_CPA_OPT_IN)." } },
    },
  },
  // ── Google Ads — Extended EXECUTE catalog ──
  {
    name: "googleAds_createCampaignBudget",
    description: "Create a new Google Ads campaign budget that can be assigned to one or more campaigns. Returns the new budget ID.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Internal name for the budget (not shown to users)." },
        dailyBudgetUsd: { type: "number", description: "Daily budget in USD (e.g. 75.00)." },
        deliveryMethod: { type: "string", description: "STANDARD (default — paced evenly) or ACCELERATED (spends as fast as possible)." },
      },
      required: ["name", "dailyBudgetUsd"],
    },
  },
  {
    name: "googleAds_updateAdGroupStatus",
    description: "Enable or pause an entire ad group. Use to surgically pause underperforming themes without killing the parent campaign.",
    parameters: {
      type: "object",
      properties: {
        adGroupId: { type: "string", description: "The numeric ad group ID." },
        status: { type: "string", description: "ENABLED or PAUSED." },
      },
      required: ["adGroupId", "status"],
    },
  },
  {
    name: "googleAds_updateAdStatus",
    description: "Enable or pause a single ad creative inside an ad group. Use to kill a fatigued or policy-flagged ad while keeping the rest of the group running.",
    parameters: {
      type: "object",
      properties: {
        adGroupAdResourceName: { type: "string", description: "The full resource name of the ad — e.g. customers/123/adGroupAds/456~789. Get this from googleAds_listAds." },
        status: { type: "string", description: "ENABLED or PAUSED." },
      },
      required: ["adGroupAdResourceName", "status"],
    },
  },
  {
    name: "googleAds_addPositiveKeyword",
    description: "Add a positive (targeting) keyword to an ad group, optionally with a CPC bid override.",
    parameters: {
      type: "object",
      properties: {
        adGroupId: { type: "string", description: "The numeric ad group ID." },
        keyword: { type: "string", description: "The keyword text (without match-type brackets)." },
        matchType: { type: "string", description: "EXACT, PHRASE, or BROAD." },
        cpcBidUsd: { type: "number", description: "Optional CPC bid override in USD." },
      },
      required: ["adGroupId", "keyword", "matchType"],
    },
  },
  {
    name: "googleAds_updateKeywordBid",
    description: "Change the CPC bid on an existing keyword. Use to scale winners up or pull losers down without pausing them.",
    parameters: {
      type: "object",
      properties: {
        criterionResourceName: { type: "string", description: "The full resource name from googleAds_listKeywords — e.g. customers/123/adGroupCriteria/456~789." },
        cpcBidUsd: { type: "number", description: "New max CPC in USD." },
      },
      required: ["criterionResourceName", "cpcBidUsd"],
    },
  },
  {
    name: "googleAds_removeNegativeKeyword",
    description: "Remove a previously-added negative keyword. Use when reviewing the negatives list reveals an over-aggressive exclusion that's blocking valid traffic.",
    parameters: {
      type: "object",
      properties: { criterionResourceName: { type: "string", description: "The full resource name from googleAds_listNegativeKeywords." } },
      required: ["criterionResourceName"],
    },
  },
  {
    name: "googleAds_applyRecommendation",
    description: "Apply one of Google Ads' system-generated recommendations (e.g. add suggested keywords, opt into tROAS). Get the resource name from googleAds_listRecommendations first.",
    parameters: {
      type: "object",
      properties: { recommendationResourceName: { type: "string", description: "The full recommendation resource name." } },
      required: ["recommendationResourceName"],
    },
  },
  // ── Meta Ads ──
  {
    name: "meta_updateAdSetBudget",
    description: "Update the daily or lifetime budget for a Meta Ads ad set. Use when scaling winning ad sets or cutting spend on underperformers.",
    parameters: {
      type: "object",
      properties: {
        adSetId: { type: "string", description: "The Meta ad set ID." },
        dailyBudget: { type: "number", description: "New daily budget in USD. Provide either this or lifetimeBudget." },
        lifetimeBudget: { type: "number", description: "New lifetime budget in USD. Provide either this or dailyBudget." },
      },
      required: ["adSetId"],
    },
  },
  {
    name: "meta_updateObjectStatus",
    description: "Toggle the status of a Meta campaign, ad set, or ad to ACTIVE or PAUSED.",
    parameters: {
      type: "object",
      properties: {
        objectId: { type: "string", description: "The Meta object ID (campaign, ad set, or ad ID)." },
        status: { type: "string", description: "ACTIVE to enable, PAUSED to pause." },
      },
      required: ["objectId", "status"],
    },
  },
  {
    name: "meta_updateAdCreative",
    description: "Update the creative of a Meta ad — change primary text, headline, or swap the image.",
    parameters: {
      type: "object",
      properties: {
        adId: { type: "string", description: "The Meta ad ID to update." },
        primaryText: { type: "string", description: "New primary text / ad copy for the ad." },
        headline: { type: "string", description: "New headline for the ad." },
        imageUrl: { type: "string", description: "URL of the new image to use in the ad creative." },
      },
      required: ["adId"],
    },
  },
  // ── Shopify ──
  {
    name: "shopify_updateProductStatus",
    description: "Change the status of a Shopify product (active, archived, or draft). Use to archive out-of-stock products or activate draft products for campaigns.",
    parameters: {
      type: "object",
      properties: {
        productId: { type: "string", description: "The Shopify product ID (numeric)." },
        status: { type: "string", description: "active, archived, or draft." },
      },
      required: ["productId", "status"],
    },
  },
  {
    name: "shopify_createDiscountCode",
    description: "Create a discount code and price rule in Shopify for ad-led promotions or seasonal sales.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Internal title of the price rule (not shown to customers)." },
        discountType: { type: "string", description: "percentage, fixed_amount, or free_shipping." },
        discountValue: { type: "number", description: "The discount amount — for percentage: 0-100, for fixed_amount: dollar amount." },
        code: { type: "string", description: "The discount code customers will enter (e.g. SUMMER20)." },
        usageLimit: { type: "number", description: "Optional total usage limit across all customers." },
        startsAt: { type: "string", description: "Optional ISO 8601 start datetime." },
        endsAt: { type: "string", description: "Optional ISO 8601 end datetime." },
      },
      required: ["title", "discountType", "discountValue", "code"],
    },
  },
  {
    name: "shopify_updateProductMetafield",
    description: "Add or update a metafield on a Shopify product. Used to enrich product data for AI-powered shopping (SGE) or custom storefront logic.",
    parameters: {
      type: "object",
      properties: {
        productId: { type: "string", description: "The Shopify product ID (numeric)." },
        namespace: { type: "string", description: "Metafield namespace (e.g. custom or seo)." },
        key: { type: "string", description: "Metafield key (e.g. material or search_description)." },
        value: { type: "string", description: "The metafield value." },
        type: { type: "string", description: "Shopify metafield type (e.g. single_line_text_field, multi_line_text_field, json)." },
      },
      required: ["productId", "namespace", "key", "value", "type"],
    },
  },
  {
    name: "shopify_updateVariantPrice",
    description: "Update the price (and optionally compare-at price to show a strikethrough) for a specific Shopify product variant. Use for flash sales, repricing, or margin adjustments.",
    parameters: {
      type: "object",
      properties: {
        variantId: { type: "string", description: "The Shopify variant ID (numeric)." },
        price: { type: "number", description: "New sale price in USD (e.g. 29.99)." },
        compareAtPrice: { type: "number", description: "Optional original/compare-at price in USD to show as strikethrough (e.g. 49.99)." },
      },
      required: ["variantId", "price"],
    },
  },
  {
    name: "shopify_updateInventory",
    description: "Set the available inventory quantity for a product variant at a specific Shopify location. Use to replenish stock, zero-out OOS items, or adjust after audits.",
    parameters: {
      type: "object",
      properties: {
        inventoryItemId: { type: "string", description: "The Shopify inventory item ID (found on the variant)." },
        locationId: { type: "string", description: "The Shopify location ID where inventory should be updated." },
        available: { type: "number", description: "New available quantity (integer)." },
      },
      required: ["inventoryItemId", "locationId", "available"],
    },
  },
  {
    name: "shopify_updateProductDetails",
    description: "Update a Shopify product's title, description (body HTML), tags, vendor, or SEO metadata. Use to improve product listings, fix copy, or optimize for search.",
    parameters: {
      type: "object",
      properties: {
        productId: { type: "string", description: "The Shopify product ID (numeric)." },
        title: { type: "string", description: "New product title." },
        bodyHtml: { type: "string", description: "New product description as HTML." },
        tags: { type: "string", description: "Comma-separated tags to set on the product (replaces existing tags)." },
        seoTitle: { type: "string", description: "SEO page title (shown in search results)." },
        seoDescription: { type: "string", description: "SEO meta description (shown in search result snippets)." },
        vendor: { type: "string", description: "Product vendor/brand name." },
      },
      required: ["productId"],
    },
  },
  {
    name: "shopify_createProduct",
    description: "Create a new product in the Shopify store with a single variant. Use for launching new SKUs, creating campaign-specific landing products, or A/B testing listings.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Product title." },
        bodyHtml: { type: "string", description: "Product description as HTML." },
        vendor: { type: "string", description: "Brand or vendor name." },
        productType: { type: "string", description: "Product type/category (e.g. T-Shirts, Supplements)." },
        price: { type: "number", description: "Default variant price in USD." },
        sku: { type: "string", description: "Optional SKU for the default variant." },
        tags: { type: "string", description: "Optional comma-separated product tags." },
        imageUrl: { type: "string", description: "Optional URL of the product image." },
      },
      required: ["title", "bodyHtml", "vendor", "productType", "price"],
    },
  },
  {
    name: "shopify_fulfillOrder",
    description: "Create a fulfillment for a Shopify order — marks items as shipped and optionally notifies the customer with tracking info.",
    parameters: {
      type: "object",
      properties: {
        orderId: { type: "string", description: "The Shopify order ID (numeric)." },
        locationId: { type: "string", description: "The fulfillment location ID." },
        trackingNumber: { type: "string", description: "Optional shipment tracking number." },
        trackingCompany: { type: "string", description: "Optional shipping carrier name (e.g. UPS, FedEx, USPS)." },
        notifyCustomer: { type: "boolean", description: "Whether to send the customer a shipping notification email (default: true)." },
      },
      required: ["orderId", "locationId"],
    },
  },
  {
    name: "shopify_tagOrder",
    description: "Add tags to a Shopify order for internal classification, fulfillment routing, or CRM segmentation (e.g. 'VIP', 'at-risk', 'influencer').",
    parameters: {
      type: "object",
      properties: {
        orderId: { type: "string", description: "The Shopify order ID (numeric)." },
        tags: { type: "string", description: "Comma-separated tags to apply to the order (replaces existing tags)." },
      },
      required: ["orderId", "tags"],
    },
  },
  {
    name: "shopify_createBlogPost",
    description: "Publish a new blog article on the Shopify store. Use for content marketing, SEO, campaign announcements, or product education posts.",
    parameters: {
      type: "object",
      properties: {
        blogId: { type: "string", description: "The Shopify blog ID to post to (numeric)." },
        title: { type: "string", description: "Blog article title." },
        bodyHtml: { type: "string", description: "Article body content as HTML." },
        author: { type: "string", description: "Optional author name." },
        tags: { type: "string", description: "Optional comma-separated tags for the article." },
        published: { type: "boolean", description: "Whether to publish immediately (default: true). Set false to save as draft." },
      },
      required: ["blogId", "title", "bodyHtml"],
    },
  },
  // ── Google Search Console ──
  {
    name: "gsc_getSites",
    description: "List all Google Search Console properties/sites verified under the connected account. Use to discover which site URL to reference for organic traffic queries.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "gsc_getTopQueries",
    description: "Get the top organic search queries driving traffic to the site from Google Search Console. Returns clicks, impressions, CTR, and average position for each keyword. Use for SEO keyword analysis, content gap identification, and organic traffic audits.",
    parameters: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "Start date in YYYY-MM-DD format (e.g. 2024-01-01). GSC data is typically delayed by 2-3 days." },
        endDate: { type: "string", description: "End date in YYYY-MM-DD format." },
        rowLimit: { type: "number", description: "Number of results to return (default: 25, max: 1000)." },
      },
      required: ["startDate", "endDate"],
    },
  },
  {
    name: "gsc_getTopPages",
    description: "Get the top organic landing pages by clicks from Google Search Console. Returns clicks, impressions, CTR, and position per page URL. Use to identify best-performing content, underperforming pages, and SEO opportunities.",
    parameters: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "Start date in YYYY-MM-DD format." },
        endDate: { type: "string", description: "End date in YYYY-MM-DD format." },
        rowLimit: { type: "number", description: "Number of results to return (default: 25, max: 1000)." },
      },
      required: ["startDate", "endDate"],
    },
  },
  {
    name: "gsc_getQueryPageBreakdown",
    description: "Get a cross-tabulation of queries and pages — which search queries lead to which pages. Optionally filter by a specific query or page URL. Useful for diagnosing cannibalization, identifying which pages rank for specific terms, and content optimization.",
    parameters: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "Start date in YYYY-MM-DD format." },
        endDate: { type: "string", description: "End date in YYYY-MM-DD format." },
        query: { type: "string", description: "Optional: filter to only rows matching this exact search query." },
        page: { type: "string", description: "Optional: filter to only rows matching this exact page URL." },
        rowLimit: { type: "number", description: "Number of results to return (default: 25)." },
      },
      required: ["startDate", "endDate"],
    },
  },
  {
    name: "gsc_getSearchPerformance",
    description: "Flexible Google Search Console search analytics query — choose any combination of dimensions (query, page, country, device, searchAppearance). Use for advanced segmentation like mobile vs desktop, country breakdown, or rich result analysis.",
    parameters: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "Start date in YYYY-MM-DD format." },
        endDate: { type: "string", description: "End date in YYYY-MM-DD format." },
        dimensions: { type: "string", description: "Comma-separated dimensions to group by. Valid values: query, page, country, device, searchAppearance. Example: 'query,country'" },
        rowLimit: { type: "number", description: "Number of results to return (default: 25, max: 1000)." },
      },
      required: ["startDate", "endDate", "dimensions"],
    },
  },
  // ── Google Sheets & Drive ──
  {
    name: "sheets_listSpreadsheets",
    description: "List the 20 most recently modified Google Sheets spreadsheets accessible by the connected account. Returns spreadsheet IDs, names, modified times, and direct links. Use to discover existing spreadsheets before reading or writing.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "sheets_createSpreadsheet",
    description: "Create a new Google Sheets spreadsheet in the user's Drive. Returns the spreadsheet ID and URL. Optionally specify tab/sheet names. Use when the user wants to export data, create a new report, or build a data model in Sheets.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title of the new spreadsheet." },
        sheetNames: { type: "array", items: { type: "string" }, description: "Optional list of tab/sheet names to create (default: ['Sheet1'])." },
      },
      required: ["title"],
    },
  },
  {
    name: "sheets_readRange",
    description: "Read data from a specific range in a Google Sheets spreadsheet. Returns a 2D array of cell values. Use A1 notation for the range (e.g. 'Sheet1!A1:D10' or 'A1:Z').",
    parameters: {
      type: "object",
      properties: {
        spreadsheetId: { type: "string", description: "The spreadsheet ID (from the URL or sheets_listSpreadsheets)." },
        range: { type: "string", description: "A1 notation range to read (e.g. 'Sheet1!A1:D10', 'A:Z', 'Sheet1')." },
      },
      required: ["spreadsheetId", "range"],
    },
  },
  {
    name: "sheets_writeRange",
    description: "Write data to a specific range in a Google Sheets spreadsheet. Overwrites existing data in that range. Values are written with USER_ENTERED input (formulas are parsed). Use for updating existing data or creating structured reports.",
    parameters: {
      type: "object",
      properties: {
        spreadsheetId: { type: "string", description: "The spreadsheet ID." },
        range: { type: "string", description: "A1 notation range to write to (e.g. 'Sheet1!A1')." },
        values: { type: "array", items: { type: "array", items: { type: "string" } }, description: "2D array of values to write. Each inner array is a row." },
      },
      required: ["spreadsheetId", "range", "values"],
    },
  },
  {
    name: "sheets_appendRows",
    description: "Append rows to the end of existing data in a Google Sheets spreadsheet. Finds the last row with data and adds new rows below it. Use for adding new records to an existing sheet without overwriting.",
    parameters: {
      type: "object",
      properties: {
        spreadsheetId: { type: "string", description: "The spreadsheet ID." },
        range: { type: "string", description: "A1 notation range indicating the target sheet/area (e.g. 'Sheet1!A:Z')." },
        values: { type: "array", items: { type: "array", items: { type: "string" } }, description: "2D array of rows to append." },
      },
      required: ["spreadsheetId", "range", "values"],
    },
  },
  {
    name: "sheets_getMetadata",
    description: "Get metadata about a Google Sheets spreadsheet including its title and all sheet tab names with row/column counts. Use to understand the structure of a spreadsheet before reading or writing.",
    parameters: {
      type: "object",
      properties: {
        spreadsheetId: { type: "string", description: "The spreadsheet ID." },
      },
      required: ["spreadsheetId"],
    },
  },
  // ── Phase 3: POAS Engine ──
  {
    name: "shopify_getInventoryItemCOGS",
    description: "Fetch Cost of Goods Sold (COGS) from Shopify InventoryItem API for up to 50 inventory items. Returns the cost field per SKU. Use this BEFORE any POAS/profit calculation to get accurate COGS data.",
    parameters: {
      type: "object",
      properties: {
        inventoryItemIds: { type: "array", items: { type: "string" }, description: "Array of Shopify inventory item IDs (numeric strings) to fetch COGS for." },
      },
      required: ["inventoryItemIds"],
    },
  },
  {
    name: "shopify_computePOASMetrics",
    description: "Compute full POAS (Profit on Ad Spend) for a product. Fetches COGS from Shopify, then calculates Net Profit = Revenue - COGS - Shopify Fees - Shipping - Returns - Ad Spend. POAS = Net Profit / Ad Spend. Use instead of ROAS to evaluate true profitability of ad campaigns.",
    parameters: {
      type: "object",
      properties: {
        productId: { type: "string", description: "Shopify product ID to analyze." },
        adSpendUsd: { type: "number", description: "Total ad spend attributed to this product in USD." },
        adAttributedRevenue: { type: "number", description: "Total ad-attributed revenue for this product in USD." },
        shopifyFeePercent: { type: "number", description: "Shopify transaction fee percentage (default: 2.9%)." },
        shippingCostPerOrder: { type: "number", description: "Average shipping cost per order in USD (default: 0)." },
        returnRatePercent: { type: "number", description: "Estimated return/refund rate as percentage (default: 5%)." },
      },
      required: ["productId", "adSpendUsd", "adAttributedRevenue"],
    },
  },
  // ── Phase 3: PMax X-Ray ──
  {
    name: "googleAds_getPMaxNetworkDistribution",
    description: "X-Ray a Performance Max campaign to estimate how budget is distributed across Search, Shopping, and Display/Video networks. Uses triangulation of search_term_insight, group_placement_view, and asset_group data. Essential for diagnosing PMax cannibalization of existing Shopping campaigns.",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "Optional: specific PMax campaign ID to analyze. Omit to analyze all PMax campaigns." },
      },
      required: [],
    },
  },
  // ── Phase 3: Creative Autopsy ──
  {
    name: "gemini_analyzeCreatives",
    description: "Run a Vertex AI Vision Creative Autopsy on ad creatives. Analyzes image URLs using multimodal AI to extract visual entities (human faces, text overlays, mood, complexity), then cross-correlates visual features with CTR/conversion data to output Creative Intelligence Cards with actionable insights.",
    parameters: {
      type: "object",
      properties: {
        creatives: {
          type: "array",
          description: "Array of creative objects to analyze.",
          items: {
            type: "object",
            properties: {
              url: { type: "string", description: "Direct URL to the ad image." },
              platform: { type: "string", description: "Platform: meta, google_ads, pmax" },
              adId: { type: "string", description: "Ad ID for reference." },
              clicks: { type: "number" },
              conversions: { type: "number" },
              ctr: { type: "number", description: "Click-through rate as percentage." },
              spend: { type: "number", description: "Ad spend in USD." },
            },
            required: ["url", "platform", "adId"],
          },
        },
      },
      required: ["creatives"],
    },
  },
  // ── Phase 4: Ad Copy Factory ──
  {
    name: "gemini_generateAdCopyMatrix",
    description: "Generate a bulk ad copy matrix (5 hooks × 3 descriptions by default) using Vertex AI. Produces direct-response ad copy optimized for the specified platform. Returns all combinations ranked by fit score with a top recommendation. Use before any ad creative deployment.",
    parameters: {
      type: "object",
      properties: {
        platform: { type: "string", description: "Target platform: meta, google_ads, or both." },
        productName: { type: "string", description: "Product or offer name to generate copy for." },
        productDescription: { type: "string", description: "Brief product description for context." },
        targetAudience: { type: "string", description: "Target customer persona (e.g., 'fitness-conscious women 25-40')." },
        usp: { type: "string", description: "Unique selling proposition or key differentiator." },
        tone: { type: "string", description: "Desired tone (e.g., urgent, playful, scientific, luxury, empathetic)." },
        hookCount: { type: "number", description: "Number of hook/headline variants to generate (default: 5, max: 10)." },
        descriptionCount: { type: "number", description: "Number of description/body copy variants (default: 3, max: 5)." },
      },
      required: ["platform", "productName"],
    },
  },
  // ── Phase 4: Shopify CMS ──
  {
    name: "shopify_getPages",
    description: "List all Shopify web pages (non-blog content: About, Contact, FAQ, Policy pages). Use to find pages that need SEO or content improvements.",
    parameters: {
      type: "object",
      properties: { limit: { type: "number", description: "Max pages to return (default: 25)." } },
      required: [],
    },
  },
  {
    name: "shopify_getBlogs",
    description: "List all Shopify blogs. Returns blog IDs and titles. Use to get the correct blogId before creating a blog post with shopify_createBlogPost.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_shopify_products",
    description: "Fetches the current inventory of products from the Shopify store. You can filter the results by product status to count or analyze specific segments.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["active", "draft", "archived", "any"],
          description: "The specific status of the products to retrieve. If the user asks for 'active' products, pass 'active'. If they ask for 'drafts', pass 'draft'. Default is 'any'.",
        },
      },
      required: [],
    },
  },
  {
    name: "shopify_updatePageContent",
    description: "Update a Shopify page's content, title, SEO meta title, or publish status. Use for SEO content injection: updating legal pages (Privacy Policy, Terms of Service, Refund Policy) or improving page descriptions to fix compliance gaps.",
    parameters: {
      type: "object",
      properties: {
        pageId: { type: "string", description: "Shopify page ID." },
        title: { type: "string", description: "New page title (optional)." },
        bodyHtml: { type: "string", description: "New page HTML content (optional). Can include full HTML markup." },
        published: { type: "boolean", description: "Whether to publish the page (optional)." },
        metaTitle: { type: "string", description: "SEO meta title (optional)." },
        metaDescription: { type: "string", description: "SEO meta description (optional)." },
      },
      required: ["pageId"],
    },
  },
  // ── Sprint W: Storefront CMS Editing ──
  {
    name: "edit_shopify_storefront_content",
    description: "Edit a Shopify storefront page or theme file's HTML content. Use when the AI recommends landing page copy changes, hero section rewrites, CTA updates, or visual layout edits on the client's live website. This is a WRITE operation — the edit is NOT applied immediately. It is queued as a PENDING task on the Approval Queue so an Account Director can review the proposed HTML before it goes live.",
    parameters: {
      type: "object",
      properties: {
        pageId: { type: "string", description: "Shopify page ID (numeric). Use shopify_getPages to discover IDs. Required if editing a page." },
        themeFile: { type: "string", description: "Theme Liquid template file path (e.g., 'sections/hero.liquid', 'templates/index.json'). Required if editing a theme file instead of a page." },
        newHtmlContent: { type: "string", description: "The new HTML or Liquid content to replace the existing content. Must be valid HTML/Liquid markup." },
        editSummary: { type: "string", description: "A brief human-readable summary of what changed and why (e.g., 'Rewrote hero headline for higher conversion rate')." },
      },
      required: ["newHtmlContent", "editSummary"],
    },
  },
  // ── Phase 5: Vertical Ontology Engine ──
  {
    name: "shopify_catalogSweep",
    description: "Perform a Catalog Sweep to detect the store's industry vertical and generate a custom Ontology Schema. Samples the product catalog, uses AI to identify the vertical (e.g., 'Fitness Supplements', 'Luxury Skincare'), and recommends 5-8 niche-specific product attributes for Shopify metafield creation. Always run this when first connecting a new Shopify store.",
    parameters: {
      type: "object",
      properties: {
        sampleSize: { type: "number", description: "Number of products to sample for analysis (default: 20, max: 50)." },
      },
      required: [],
    },
  },
  {
    name: "shopify_createMetafieldDefinitions",
    description: "Create Shopify product metafield definitions via GraphQL API. Use after shopify_catalogSweep and user approval to create the vertical-specific custom fields at the Product level. These enable storing niche attributes (e.g., ingredient_source, material_composition, compatibility_list).",
    parameters: {
      type: "object",
      properties: {
        definitions: {
          type: "array",
          description: "Array of metafield definitions to create.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Human-readable name (e.g., 'Ingredient Source')." },
              key: { type: "string", description: "Snake_case key (e.g., 'ingredient_source')." },
              description: { type: "string", description: "Optional description of what this field stores." },
              type: { type: "string", description: "Shopify metafield type: single_line_text_field, multi_line_text_field, number_decimal, boolean, list.single_line_text_field, json, url, color." },
              namespace: { type: "string", description: "Namespace (default: 'custom')." },
            },
            required: ["name", "key", "type"],
          },
        },
      },
      required: ["definitions"],
    },
  },
  {
    name: "update_shopify_theme_colors",
    description: "Modifies the primary and secondary color hex codes in the live Shopify theme settings. Fetches the active theme, safely merges only the color keys into settings_data.json, and writes back without overwriting any other theme architecture. REQUIRES user approval before execution.",
    parameters: {
      type: "object",
      properties: {
        primary_color: {
          type: "string",
          description: "Hex code for the primary brand color (e.g. '#1A1A2E'). Must be a valid 6-digit hex with # prefix.",
        },
        secondary_color: {
          type: "string",
          description: "Hex code for the secondary brand color (optional). Must be a valid 6-digit hex with # prefix.",
        },
      },
      required: ["primary_color"],
    },
  },
  {
    name: "get_metafield_definitions",
    description: "Fetches all existing product metafield definitions (namespaces, keys, and types) from the Shopify store via GraphQL. MUST be used to check for duplicates before proposing or creating new metafields with shopify_createMetafieldDefinitions. Returns the complete registry of custom field schemas.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  // ── Phase 6: Compliance Engine ──
  {
    name: "compliance_auditDestinationUrl",
    description: "Pre-flight compliance scanner: Audits a landing page URL against Google Ads, Meta, and GMC policies before campaign launch. Fetches the page, detects trust pages (Privacy Policy, Terms, Refund Policy), checks for mismatched claims, prohibited keywords, and UX violations. Returns a risk assessment with auto-fix recommendations. MUST run before any campaign launch.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The destination/landing page URL to audit." },
        adCopy: { type: "string", description: "The ad copy text being used (for cross-referencing claims against landing page content)." },
      },
      required: ["url"],
    },
  },
  // ── Intelligence Modules ──
  {
    name: "calculate_sales_velocity",
    description: "Calculates the exact days until a product stocks out based on 7-day trailing sales velocity. Returns daily run rate, current inventory, and stockout risk level (CRITICAL/HIGH/LOW). Use this to determine if ad spend should be tapered, reallocated, or a replenishment alert should be sent.",
    parameters: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "The Shopify Product ID (numeric, as a string)." },
      },
      required: ["product_id"],
    },
  },
  {
    name: "create_liquidation_discount",
    description: "Generates a unique Shopify discount code specifically for slow-moving inventory to liquidate stock. Creates a price rule and returns the generated discount code string. Use when sales velocity is dangerously low or stockout risk is NONE (overstock scenario).",
    parameters: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "The Shopify Product ID to apply the discount to." },
        discount_percentage: { type: "integer", description: "Discount amount as a whole number (e.g., 20 for 20% off). Must be between 1 and 99." },
      },
      required: ["product_id", "discount_percentage"],
    },
  },
  {
    name: "scan_compliance_policy",
    description: "Audits a specific Shopify product against ad copy for Google Ads, Meta Ads, and GMC Terms of Service violations — checks for price mismatches, prohibited health/financial claims, superlatives, and missing disclosures. Returns overall_risk, violation list, auto-fixes, and a rewritten compliant version of the ad copy.",
    parameters: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "The Shopify Product ID to audit." },
        ad_copy_text: { type: "string", description: "The exact ad copy text being used for this product." },
      },
      required: ["product_id", "ad_copy_text"],
    },
  },
  {
    name: "optimize_product_sge",
    description: "Rewrites a product's description with entity-dense semantic HTML optimized for AI Search Engine Ingestion (SGE, Google Shopping Graph, Bing Copilot). Also proposes 5 structured metafields under the 'sge' namespace that help AI shopping agents understand the product better. Use when a product has low AI-shopping impressions or thin content.",
    parameters: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "The Shopify Product ID to optimize." },
        target_keywords: {
          type: "array",
          items: { type: "string" },
          description: "Optional array of target semantic keywords to weave into the rewrite (e.g., ['organic cotton', 'sustainable bedding']).",
        },
      },
      required: ["product_id"],
    },
  },
  {
    name: "calculate_customer_clv",
    description: "Calculates the historical Customer Lifetime Value (CLV), Average Order Value (AOV), and purchase frequency for a specific Shopify customer. Also projects 3-year CLV and assigns a CLV tier (HIGH_VALUE/MID_VALUE/LOW_VALUE) to inform high-LTV ad bidding and retention strategies.",
    parameters: {
      type: "object",
      properties: {
        customer_id: { type: "string", description: "The Shopify Customer ID (numeric, as a string)." },
      },
      required: ["customer_id"],
    },
  },

  // ── Ecosystem Sync — Part 1: Defensive & Compliance ──
  {
    name: "googleAds_listPMaxAssetGroups",
    description: "List all Performance Max Asset Groups in the connected Google Ads account, including their IDs, names, status (ENABLED/PAUSED/REMOVED), and parent campaign. ALWAYS use this tool when the user asks about asset groups, PMax structure, or wants to know what asset groups exist. Do NOT tell the user to check the Google Ads UI — call this tool instead.",
    parameters: {
      type: "object",
      properties: {
        campaign_id: { type: "string", description: "Optional: filter to asset groups under a specific PMax campaign ID." },
        status:      { type: "string", description: "Optional: filter by status — one of ENABLED, PAUSED, REMOVED.", enum: ["ENABLED", "PAUSED", "REMOVED"] },
      },
      required: [],
    },
  },
  {
    name: "pause_pmax_asset_group",
    description: "Pauses a specific Google Ads Performance Max Asset Group via the Asset Groups mutate API. Use when a PMax asset group is cannibalizing branded search, showing low-quality placements, or targeting the wrong audience segment.",
    parameters: {
      type: "object",
      properties: {
        asset_group_id: { type: "string", description: "The numeric Asset Group ID to pause." },
      },
      required: ["asset_group_id"],
    },
  },
  {
    name: "sync_poas_conversion_value",
    description: "Uploads an offline conversion adjustment to Google Ads to feed Net Profit (not revenue) back into the tROAS algorithm. This trains the bidding model on true profit margin, enabling POAS optimization. Requires the GCLID from the original click.",
    parameters: {
      type: "object",
      properties: {
        gclid: { type: "string", description: "The Google Click Identifier (gclid) from the original ad click." },
        net_profit_value: { type: "number", description: "The net profit in USD for this conversion (Revenue - COGS - Fees - Shipping - Returns)." },
        conversion_action_id: { type: "string", description: "The Google Ads Conversion Action ID to adjust." },
        conversion_date_time: { type: "string", description: "The original conversion timestamp in ISO 8601 format." },
      },
      required: ["gclid", "net_profit_value"],
    },
  },
  {
    name: "sync_gmc_sge_metadata",
    description: "Pushes SGE-optimized product metadata (title, description, attributes) to Google Merchant Center via the Content API v2.1. Use after running optimize_product_sge to deploy the AI-rewritten content to GMC.",
    parameters: {
      type: "object",
      properties: {
        merchant_id: { type: "string", description: "The Google Merchant Center merchant ID." },
        product_id: { type: "string", description: "The GMC product ID (typically shopify:{country}:{currency}:{shopify_product_id})." },
        optimized_description: { type: "string", description: "The SGE-optimized HTML description to push to GMC." },
      },
      required: ["merchant_id", "product_id", "optimized_description"],
    },
  },
  {
    name: "gmc_get_feed_status",
    description: "PREFERRED tool for any 'GMC product feed status', 'merchant center health', 'feed approval state', or 'is my product feed approved?' question. Calls the live Google Merchant Center Content API v2.1 directly — does NOT depend on the warehouse or Master Sync. Returns: total products, approved/disapproved/pending/limited counts, healthScore (0-100), top 10 item-level issues, and configured datafeeds. Use this BEFORE attempting any cross-platform warehouse query for GMC questions.",
    parameters: {
      type: "object",
      properties: {
        merchant_id: { type: "string", description: "Optional Google Merchant Center ID. If omitted, uses the merchant_id stored on the connected GMC account." },
      },
    },
  },
  {
    name: "predict_gmc_disapprovals",
    description: "Audits a Shopify product vs its Google Merchant Center counterpart to detect data mismatches that will cause policy disapprovals. Compares title, price, image link, and availability. Returns a ranked list of mismatches by severity (CRITICAL/HIGH/MEDIUM).",
    parameters: {
      type: "object",
      properties: {
        shopify_product_id: { type: "string", description: "The Shopify product ID to audit." },
        gmc_product_id: { type: "string", description: "The corresponding GMC product ID." },
      },
      required: ["shopify_product_id", "gmc_product_id"],
    },
  },
  {
    name: "resolve_gmc_mismatch",
    description: "Patches a Google Merchant Center product to fix detected mismatches using the Content API v2.1. Use immediately after predict_gmc_disapprovals returns mismatches to auto-reconcile and clear pending policy violations.",
    parameters: {
      type: "object",
      properties: {
        merchant_id: { type: "string", description: "The Google Merchant Center merchant ID." },
        product_id: { type: "string", description: "The GMC product ID to patch." },
        corrections: { type: "object", description: "Key-value pairs of fields to correct (e.g., {title: '...', price: {value: '29.99', currency: 'USD'}})." },
      },
      required: ["merchant_id", "product_id", "corrections"],
    },
  },
  {
    name: "sync_high_ltv_customer_match",
    description: "Uploads a list of SHA-256 hashed emails to a Google Ads Customer Match user list. Use to push high-LTV customer cohorts (from calculate_customer_clv) into Google Ads for bid boosting, lookalike expansion, or exclusion of churned customers.",
    parameters: {
      type: "object",
      properties: {
        user_list_id: { type: "string", description: "The Google Ads User List ID (Customer Match list)." },
        customer_hashes: { type: "array", items: { type: "string" }, description: "Array of SHA-256 hashed email addresses (lowercase, trimmed before hashing)." },
      },
      required: ["user_list_id", "customer_hashes"],
    },
  },
  {
    name: "check_workspace_billing_status",
    description: "Queries the Google Cloud Billing API to check the status of a Workspace/GCP billing account — whether it is ACTIVE or SUSPENDED, and retrieves credit limits and invoice metadata.",
    parameters: {
      type: "object",
      properties: {
        billing_account_id: { type: "string", description: "The GCP Billing Account ID (format: XXXXXX-XXXXXX-XXXXXX)." },
      },
      required: ["billing_account_id"],
    },
  },
  {
    name: "resolve_google_ad_disapproval",
    description: "Patches a disapproved Google Ad (AdGroupAd) to clear policy violations such as 'Destination Not Working', mismatched final URLs, or prohibited content. Applies a correction payload via the Google Ads mutate API.",
    parameters: {
      type: "object",
      properties: {
        ad_group_ad_id: { type: "string", description: "The Google Ads AdGroupAd resource ID (format: {adGroupId}~{adId})." },
        correction_payload: { type: "object", description: "Fields to patch on the ad (e.g., {ad: {finalUrls: ['https://...']}} for URL corrections)." },
      },
      required: ["ad_group_ad_id", "correction_payload"],
    },
  },
  {
    name: "resolve_meta_ad_disapproval",
    description: "Patches a rejected Meta Ad to clear policy violations. Supports updating primary text, headline, image hash, or destination URL to bring the ad back into compliance.",
    parameters: {
      type: "object",
      properties: {
        ad_id: { type: "string", description: "The Meta Ad ID to patch." },
        correction_payload: { type: "object", description: "Fields to update on the ad (e.g., {name: '...', creative: {...}})." },
      },
      required: ["ad_id", "correction_payload"],
    },
  },

  // ── Ecosystem Sync — Part 2: Strategic Audit ──
  {
    name: "calculate_ai_adoption_score",
    description: "Queries GAQL to calculate what percentage of total ad spend is running on AI-powered bidding strategies (tROAS, tCPA, Maximize Conversions/Value, PMax) vs manual strategies. Returns an adoption score (0-100%) and letter grade. Essential for QBR presentations and agency pitches.",
    parameters: {
      type: "object",
      properties: {
        customer_id: { type: "string", description: "The Google Ads customer ID (uses connected account if omitted)." },
      },
      required: [],
    },
  },
  {
    name: "calculate_account_headroom",
    description: "Calculates the projected revenue delta of migrating high-ROAS legacy manual campaigns to AI bidding structures. Models a 20-35% ROAS improvement scenario based on Google's benchmark data. Returns revenue headroom range in dollars.",
    parameters: {
      type: "object",
      properties: {
        customer_id: { type: "string", description: "The Google Ads customer ID (uses connected account if omitted)." },
      },
      required: [],
    },
  },
  {
    name: "identify_budget_constraints",
    description: "Queries GAQL for ENABLED campaigns that are LIMITED_BY_BUDGET but still exceeding target ROAS. Calculates estimated missed revenue due to budget caps and recommends specific budget increases. Critical for scaling profitable campaigns.",
    parameters: {
      type: "object",
      properties: {
        customer_id: { type: "string", description: "The Google Ads customer ID (uses connected account if omitted)." },
      },
      required: [],
    },
  },
  {
    name: "detect_automation_churn",
    description: "Compares 28-day vs 7-day AI bidding share to detect if automated features are being manually degraded (e.g., switching from tROAS back to manual CPC). Flags CRITICAL if AI share drops >15pp, HIGH if >5pp. Protects against inadvertent performance regressions.",
    parameters: {
      type: "object",
      properties: {
        customer_id: { type: "string", description: "The Google Ads customer ID (uses connected account if omitted)." },
      },
      required: [],
    },
  },

  // ── Basic Campaign Overview ──
  {
    name: "list_google_ads_campaigns",
    description: "Retrieves a basic list of all currently active Google Ads campaigns with their 30-day spend, impressions, clicks, and conversions. Use this when the user asks for a general overview, campaign count, or wants to know which campaigns are running. Also use this as a first step before any campaign-specific optimisation.",
    parameters: {
      type: "object",
      properties: {
        customer_id: {
          type: "string",
          description: "Override the stored Google Ads customer ID. Leave empty to use the connected account.",
        },
      },
      required: [],
    },
  },

  {
    name: "diagnose_google_ads_connection",
    description: "Validates the stored Google Ads Customer ID by calling Google's listAccessibleCustomers endpoint. Use this whenever Google Ads GAQL queries return 'Not Found', 'Permission Denied', or any 404/403 error — it will show the user exactly which customer IDs their OAuth token can access and whether the stored ID is correct. Also use it when the user reports Google Ads is not connecting or not returning data.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },

  // ── Sprint N: GA4 & CRM Integration ──
  {
    name: "deduplicate_revenue_ga4",
    description: "Pulls Data-Driven Attribution (DDA) revenue from Google Analytics 4 broken down by session source/medium to find discrepancies between Shopify actuals and Meta/Google Ads self-reported conversions. Use when the user asks about attribution accuracy, double-counting, or wants to reconcile ad platform revenue claims against GA4.",
    parameters: {
      type: "object",
      properties: {
        property_id: { type: "string", description: "GA4 property ID (numeric string, e.g. '123456789'). Required." },
        days_back:   { type: "number", description: "Number of days to look back from yesterday. Default: 30." },
      },
      required: ["property_id"],
    },
  },

  {
    name: "sync_crm_audience_to_ads",
    description: "Pulls a specific customer segment from the CRM and pushes SHA-256 hashed emails to a Google Ads Customer Match list for remarketing. Use when the user wants to target a high-LTV segment, re-engage lapsed customers, or sync a Shopify customer cohort into Google Ads audiences.",
    parameters: {
      type: "object",
      properties: {
        segment_name:    { type: "string", description: "Human-readable label for the audience segment, e.g. 'VIPs 60-Day Lapsed'." },
        customer_emails: {
          type: "array",
          items: { type: "string" },
          description: "Array of plaintext customer email addresses to hash and upload.",
        },
        user_list_id: { type: "string", description: "Google Ads Customer Match list ID (numeric string). Must already exist in the Google Ads account." },
      },
      required: ["segment_name", "customer_emails", "user_list_id"],
    },
  },

  // ── Sprint R+: Budget Constraint Pipeline ──
  {
    name: "get_budget_constrained_campaigns",
    description: "Queries Google Ads to find high-performing enabled campaigns that are actively losing impression share specifically because their daily budget is too low (the Scaling Blindspot). Uses a 5% lost-impression-share threshold, ordered by conversions so the most impactful campaigns surface first. Returns each campaign's daily budget, 30-day spend, % of impressions lost to budget, actual conversions, and an estimated missed-conversion count. Use when the user asks about budget constraints, scaling blockers, campaigns limited by budget, impression share loss, or why a campaign isn't getting enough traffic.",
    parameters: {
      type: "object",
      properties: {
        customer_id: { type: "string", description: "Override the target Google Ads client Customer ID (optional — uses stored credentials if omitted)." },
      },
      required: [],
    },
  },

  // ── Sprint R: Cross-Platform Synthesis ──
  {
    name: "analyze_margin_bleed",
    description: "Cross-references Google Ads and Meta ad spend against real-time Shopify COGS, estimated shipping, and platform fees to identify products that show a high advertised ROAS (e.g. 3×) but are actually losing money after true costs — a negative POAS. Returns a ranked list of 'bleeding SKUs' with full cost breakdowns and a verdict for each. Use when the user asks about true profitability, POAS vs ROAS gaps, hidden margin losses, or which products are draining budget.",
    parameters: { type: "object", properties: {}, required: [] },
  },

  {
    name: "calculate_true_blended_cac",
    description: "Compares Shopify's actual bank-in-the-bank revenue (ground truth) against Meta Ads and Google Ads self-reported conversion values for the same period to detect double-counting and attribution inflation. Calculates the true Blended ROAS and true Blended CAC as opposed to the inflated platform-reported figures. Use when the user asks about attribution accuracy, revenue discrepancies, double-counting across platforms, true blended ROAS, or reconciling ad platform revenue claims.",
    parameters: {
      type: "object",
      properties: {
        days_back: { type: "number", description: "Number of days to analyse (7-90). Default: 30." },
      },
      required: [],
    },
  },

  {
    name: "generate_retargeting_arbitrage_list",
    description: "Scans Shopify order history to find loyal customers who are approaching their natural repurchase window (last ordered 30-40 days ago) and are likely to buy again for free via email/SMS. Returns two lists: (1) a CRM priority email list to trigger a free retention flow, and (2) a Customer Match exclusion list formatted for Google Ads and Meta so these customers are removed from paid retargeting — preventing wasted spend on people who would have bought organically anyway. Use when the user asks about suppression audiences, CRM arbitrage, email vs paid overlap, or reducing wasted retargeting spend.",
    parameters: {
      type: "object",
      properties: {
        window_start_days: { type: "number", description: "Start of repurchase window in days since last order. Default: 30." },
        window_end_days:   { type: "number", description: "End of repurchase window in days since last order. Default: 40." },
      },
      required: [],
    },
  },

  // ── Sprint V: Unified Data Warehouse ──
  {
    name: "query_unified_warehouse",
    description: "Queries the internal PostgreSQL data warehouse where Shopify inventory and Google Ads performance are pre-joined. Use this to answer complex cross-platform questions such as: which ads are spending on out-of-stock products, which SKUs have high ad cost but zero inventory, POAS by SKU using warehouse COGS, or any query requiring a join between ad performance and product catalog. Always prefer this over individual platform tools when the answer requires correlating ad data with product data. TABLES: warehouse_shopify_products (id, product_id, sku, handle, title, variant_title, status, inventory_qty, price, cogs, synced_at), warehouse_google_ads (id, campaign_id, campaign_name, ad_group_id, ad_group_name, ad_id, final_url, cost_usd, conversions, impressions, clicks, status, synced_at), warehouse_cross_platform_mapping (id, google_ad_id, shopify_product_id, sku, final_url, match_type, confidence, synced_at). PRE-BUILT VIEWS for common queries: v_ads_on_empty_shelves (ads spending on zero-inventory products, ordered by cost), v_poas_by_sku (POAS per SKU using COGS). Use sync_first:true or remind the user to run a sync if warehouse data may be stale.",
    parameters: {
      type: "object",
      properties: {
        sql_query: {
          type: "string",
          description: "A read-only SELECT SQL query to execute against the warehouse. Must start with SELECT. Can JOIN across warehouse_shopify_products, warehouse_google_ads, and warehouse_cross_platform_mapping. Example: SELECT g.campaign_name, g.cost_usd, s.title, s.inventory_qty FROM warehouse_google_ads g JOIN warehouse_cross_platform_mapping m ON m.google_ad_id = g.ad_id JOIN warehouse_shopify_products s ON s.product_id = m.shopify_product_id WHERE s.inventory_qty = 0 ORDER BY g.cost_usd DESC LIMIT 20",
        },
        sync_first: {
          type: "boolean",
          description: "If true, triggers a full ETL sync before running the query so results are fresh. Default: false.",
        },
      },
      required: ["sql_query"],
    },
  },

  // ── Sprint DB: BYODB — Query User Database ──
  {
    name: "query_user_database",
    description: "Queries the user's own connected database (PostgreSQL, MySQL, Snowflake) that was set up via the BYODB connector on the Connections page. Use this tool when the user asks questions about their own data warehouse, their custom tables, or wants analysis on data that lives outside the OmniAnalytix platform. The query is executed read-only with a 30-second timeout. Maximum 500 rows returned. Before using this tool, confirm the user has a connected database via their Connections page.",
    parameters: {
      type: "object",
      properties: {
        credential_id: {
          type: "number",
          description: "The ID of the database credential to query against. If the user has only one connected database, use that one. If multiple, ask which database they want to query.",
        },
        sql_query: {
          type: "string",
          description: "A read-only SELECT SQL query to execute against the user's database. Must start with SELECT or WITH. No INSERT/UPDATE/DELETE/DROP allowed.",
        },
      },
      required: ["credential_id", "sql_query"],
    },
  },

  // ── Sprint AG: Tag Gateway Audit ──
  {
    name: "audit_website_tag_infrastructure",
    description: "Audits a website URL for Google Tag Gateway (First-Party Mode) readiness. Fetches the page HTML and inspects all <script> tags to determine whether Google Analytics, GTM, and ad-tracking pixels load via third-party domains (Vulnerable — exposed to ITP/ETP/ad-blockers with 15-25% estimated signal loss) or first-party paths (Secured). Returns a full breakdown of each tag with its source domain, risk level, and a remediation summary. Automatically pushes a CRITICAL alert to Live Triage if vulnerable tags are found. Use when the user asks about tag health, signal loss, conversion tracking accuracy, first-party data, or Tag Gateway setup.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The full website URL to audit (e.g. https://example.com). The homepage is sufficient for most audits." },
      },
      required: ["url"],
    },
  },

  // ── Triage Alerts Query ──
  {
    name: "queryTriageAlerts",
    description: "Query the live_triage_alerts table to retrieve current diagnostic alerts for the active workspace. Returns persisted alerts from the Advanced Capabilities Engine including AI MAX (PMax health), Measurement Discrepancy, Pre-Flight Compliance (Policy), Inventory-Aware Margin Leaks (SA360), and Full-Funnel Budget Allocation checks. Use this when the user asks 'What issues need my attention today?', 'Show me active alerts', 'What's wrong with my account?', or any question about current diagnostic findings and platform health.",
    parameters: {
      type: "object",
      properties: {
        severity_filter: { type: "string", description: "Optional filter by severity: 'critical', 'warning', or 'info'. Omit for all severities." },
        type_filter: { type: "string", description: "Optional filter by type: 'Policy', 'Measurement', 'Budget', 'AI_Max', 'Inventory', 'Billing', or 'CRM'. Omit for all types." },
        include_resolved: { type: "boolean", description: "Whether to include resolved alerts. Default false." },
      },
      required: [],
    },
  },

  // ── GOD MODE ──
  {
    name: "run_master_diagnostic_sweep",
    description: "GOD MODE: Executes a full-ecosystem health check across Shopify, Google Ads, Meta Ads, Merchant Center, YouTube, and GA4 simultaneously using Promise.allSettled for fault tolerance. When GA4 is connected it also runs a cross-platform attribution cross-reference: comparing GA4 Data-Driven Attribution (DDA) revenue against platform self-reported conversions to detect double-counting or attribution gaps greater than 15%. Returns an aggregated EXECUTIVE SYSTEM DIAGNOSTIC with findings grouped into 🔴 CRITICAL (margin leaks / policy risk / attribution discrepancies > 15%), 🟡 WARNINGS (scaling constraints / degraded automation / low traffic quality), and 🟢 HEALTHY (confirmed wins / attribution verified). Use this at the start of any new client engagement or when the user asks for a full system audit or attribution health check.",
    parameters: {
      type: "object",
      properties: {
        google_customer_id: { type: "string", description: "Override the connected Google Ads customer ID (optional — uses stored credentials if omitted)." },
        gmc_merchant_id: { type: "string", description: "Override the connected GMC Merchant ID (optional — uses stored credentials if omitted)." },
        ga4_property_id: { type: "string", description: "Override the connected GA4 property ID (optional — uses the property ID stored during Google Workspace setup if omitted)." },
      },
      required: [],
    },
  },
] as unknown) as FunctionDeclaration[];

export const GEMINI_TOOLS: Tool[] = [{ functionDeclarations: FUNCTION_DECLARATIONS }];

// ─── Pre-flight Connection Guard ──────────────────────────────────────────────
// Returns a structured missing_connection error when a required platform isn't
// connected. The LLM uses this structured response to provide polished guidance
// instead of dumping raw errors.

const PLATFORM_LABELS: Record<string, string> = {
  google_ads: "Google Ads",
  meta: "Meta Ads",
  shopify: "Shopify",
  gsc: "Google Search Console",
  gmc: "Google Merchant Center",
  ga4: "Google Analytics 4",
  crm: "CRM (Salesforce / HubSpot)",
};

function missingConnectionError(platform: string): ExecutionResult {
  const label = PLATFORM_LABELS[platform] ?? platform;
  return {
    success: false,
    message: JSON.stringify({
      status: "missing_connection",
      platform,
      platformLabel: label,
      action: "connect",
      userMessage: `${label} is not connected. Connect it from the Connections page to enable this capability.`,
    }),
  };
}

// Map tool name prefixes to the platform key they require
function getRequiredPlatform(toolName: string): string | null {
  if (toolName.startsWith("googleAds_") || toolName.startsWith("google_ads_")) return "google_ads";
  if (toolName.startsWith("meta_")) return "meta";
  if (toolName.startsWith("shopify_")) return "shopify";
  if (toolName.startsWith("gsc_")) return "gsc";
  if (toolName.startsWith("sheets_")) return "google_sheets";
  // gmc_get_feed_status resolves credentials from a GMC connection at dispatch
  // time, so it must NOT be auto-blocked by the google_ads gate.
  if (toolName === "gmc_get_feed_status") return null;
  if (toolName.startsWith("gmc_")) return "google_ads";
  if (toolName.startsWith("ga4_")) return "google_ads";
  if (toolName.startsWith("crm_")) return "crm";
  if (toolName.startsWith("crossPlatform_")) return null;
  // Alias-named tools
  if (["pause_pmax_asset_group", "sync_poas_conversion_value", "calculate_ai_adoption_score",
       "calculate_account_headroom", "identify_budget_constraints", "detect_automation_churn",
       "check_workspace_billing_status", "resolve_google_ad_disapproval",
       "sync_gmc_sge_metadata", "predict_gmc_disapprovals", "resolve_gmc_mismatch",
       "sync_high_ltv_customer_match", "get_budget_constrained_campaigns"].includes(toolName)) return "google_ads";
  if (["resolve_meta_ad_disapproval"].includes(toolName)) return "meta";
  if (["calculate_sales_velocity", "create_liquidation_discount", "scan_compliance_policy",
       "optimize_product_sge", "calculate_customer_clv", "get_shopify_products",
       "get_metafield_definitions", "update_shopify_theme_colors",
       "get_store_inventory_health", "get_store_revenue_summary"].includes(toolName)) return "shopify";
  return null;
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function dispatchToolCall(
  name: string,
  args: Record<string, unknown>,
  credentialsByPlatform: Record<string, Record<string, string>>,
  options?: { workspaceId?: string | number | null; bypassQueue?: boolean; organizationId?: number; dryRun?: boolean },
): Promise<ExecutionResult> {
  const requiredPlatform = getRequiredPlatform(name);
  if (requiredPlatform && !credentialsByPlatform[requiredPlatform]) {
    return missingConnectionError(requiredPlatform);
  }
  if (isWriteTool(name) && !options?.bypassQueue) {
    const validation = validateToolArgs(name, args);
    if (!validation.valid) {
      return { success: false, message: validation.error ?? "Tool argument validation failed." };
    }
    const queueResult = await queueWriteOperation(
      name,
      validation.sanitizedArgs ?? args,
      options?.workspaceId ?? null,
      typeof args._reasoning === "string" ? args._reasoning : undefined,
    );
    if (queueResult.duplicate) {
      return { success: true, message: queueResult.message };
    }
    return {
      success: true,
      message: queueResult.message,
      data: { taskId: queueResult.taskId, queued: true },
    };
  }

  if (isWriteTool(name)) {
    const validation = validateToolArgs(name, args);
    if (!validation.valid) {
      return { success: false, message: validation.error ?? "Tool argument validation failed." };
    }
  }

  const gads = credentialsByPlatform["google_ads"];
  const meta = credentialsByPlatform["meta"];
  const shopify = credentialsByPlatform["shopify"];
  const gsc = credentialsByPlatform["gsc"];
  const gsheets = credentialsByPlatform["google_sheets"];

  // Validate-only / dry-run flag plumbed through to Google Ads SDK mutations
  // so the Approval Queue can preview the effect of a write without persisting.
  const gadsOpts = { validateOnly: !!options?.dryRun };
  // Same flag for Meta — executors perform a GET on the target object to verify
  // it exists and credentials are valid (Marketing API has no validate_only flag).
  const metaOpts = { dryRun: !!options?.dryRun };

  switch (name) {
    case "googleAds_updateCampaignBudget":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_updateCampaignBudget(gads, String(args.campaignBudgetId), Number(args.newDailyBudgetUsd), gadsOpts);

    case "googleAds_updateCampaignBidding":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_updateCampaignBidding(gads, String(args.campaignId), args.strategy as "TARGET_ROAS" | "TARGET_CPA", Number(args.targetValue), gadsOpts);

    case "googleAds_updateCampaignStatus":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_updateCampaignStatus(gads, String(args.campaignId), args.status as "ENABLED" | "PAUSED", gadsOpts);

    case "googleAds_addNegativeKeyword":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_addNegativeKeyword(gads, String(args.campaignId), String(args.keyword), args.matchType as "EXACT" | "PHRASE" | "BROAD", gadsOpts);

    // ── Extended Google Ads READ catalog ──
    case "googleAds_getCampaignBudgetDetails":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_getCampaignBudgetDetails(gads, String(args.campaignBudgetId));
    case "googleAds_listNegativeKeywords":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_listNegativeKeywords(gads, args.campaignId ? String(args.campaignId) : undefined);
    case "googleAds_listAdGroups":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_listAdGroups(gads, args.campaignId ? String(args.campaignId) : undefined);
    case "googleAds_listKeywords":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_listKeywords(gads, String(args.adGroupId));
    case "googleAds_listSearchTerms":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_listSearchTerms(gads, args.campaignId ? String(args.campaignId) : undefined, args.daysBack ? Number(args.daysBack) : 30);
    case "googleAds_listConversionActions":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_listConversionActions(gads);
    case "googleAds_listAds":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_listAds(gads, args.adGroupId ? String(args.adGroupId) : undefined);
    case "googleAds_listRecommendations":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_listRecommendations(gads, args.type ? String(args.type) : undefined);

    // ── Extended Google Ads EXECUTE catalog ──
    case "googleAds_createCampaignBudget":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_createCampaignBudget(gads, String(args.name), Number(args.dailyBudgetUsd), (args.deliveryMethod as "STANDARD" | "ACCELERATED" | undefined) ?? "STANDARD", gadsOpts);
    case "googleAds_updateAdGroupStatus":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_updateAdGroupStatus(gads, String(args.adGroupId), args.status as "ENABLED" | "PAUSED", gadsOpts);
    case "googleAds_updateAdStatus":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_updateAdStatus(gads, String(args.adGroupAdResourceName), args.status as "ENABLED" | "PAUSED", gadsOpts);
    case "googleAds_addPositiveKeyword":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_addPositiveKeyword(gads, String(args.adGroupId), String(args.keyword), args.matchType as "EXACT" | "PHRASE" | "BROAD", args.cpcBidUsd != null ? Number(args.cpcBidUsd) : undefined, gadsOpts);
    case "googleAds_updateKeywordBid":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_updateKeywordBid(gads, String(args.criterionResourceName), Number(args.cpcBidUsd), gadsOpts);
    case "googleAds_removeNegativeKeyword":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_removeNegativeKeyword(gads, String(args.criterionResourceName), gadsOpts);
    case "googleAds_applyRecommendation":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_applyRecommendation(gads, String(args.recommendationResourceName), gadsOpts);

    case "meta_updateAdSetBudget":
      if (!meta) return { success: false, message: "Meta Ads not connected." };
      return meta_updateAdSetBudget(meta, String(args.adSetId), args.dailyBudget as number | undefined, args.lifetimeBudget as number | undefined, metaOpts);

    case "meta_updateObjectStatus":
      if (!meta) return { success: false, message: "Meta Ads not connected." };
      return meta_updateObjectStatus(meta, String(args.objectId), args.status as "ACTIVE" | "PAUSED", metaOpts);

    case "meta_updateAdCreative":
      if (!meta) return { success: false, message: "Meta Ads not connected." };
      return meta_updateAdCreative(meta, String(args.adId), args.primaryText as string | undefined, args.headline as string | undefined, args.imageUrl as string | undefined, metaOpts);

    case "shopify_updateProductStatus":
      if (!shopify) return { success: false, message: "Shopify not connected." };
      if (options?.dryRun) return shopify_dryRunValidate(shopify, name, args);
      return shopify_updateProductStatus(shopify, String(args.productId), args.status as "active" | "archived" | "draft");

    case "shopify_createDiscountCode":
      if (!shopify) return { success: false, message: "Shopify not connected." };
      if (options?.dryRun) return shopify_dryRunValidate(shopify, name, args);
      return shopify_createDiscountCode(shopify, String(args.title), args.discountType as "percentage" | "fixed_amount" | "free_shipping", Number(args.discountValue), String(args.code), args.usageLimit as number | undefined, args.startsAt as string | undefined, args.endsAt as string | undefined);

    case "shopify_updateProductMetafield":
      if (!shopify) return { success: false, message: "Shopify not connected." };
      if (options?.dryRun) return shopify_dryRunValidate(shopify, name, args);
      return shopify_updateProductMetafield(shopify, String(args.productId), String(args.namespace), String(args.key), String(args.value), String(args.type));

    case "shopify_updateVariantPrice":
      if (!shopify) return { success: false, message: "Shopify not connected." };
      if (options?.dryRun) return shopify_dryRunValidate(shopify, name, args);
      return shopify_updateVariantPrice(shopify, String(args.variantId), Number(args.price), args.compareAtPrice != null ? Number(args.compareAtPrice) : undefined);

    case "shopify_updateInventory":
      if (!shopify) return { success: false, message: "Shopify not connected." };
      if (options?.dryRun) return shopify_dryRunValidate(shopify, name, args);
      return shopify_updateInventory(shopify, String(args.inventoryItemId), String(args.locationId), Number(args.available));

    case "shopify_updateProductDetails":
      if (!shopify) return { success: false, message: "Shopify not connected." };
      if (options?.dryRun) return shopify_dryRunValidate(shopify, name, args);
      return shopify_updateProductDetails(shopify, String(args.productId), args.title as string | undefined, args.bodyHtml as string | undefined, args.tags as string | undefined, args.seoTitle as string | undefined, args.seoDescription as string | undefined, args.vendor as string | undefined);

    case "shopify_createProduct":
      if (!shopify) return { success: false, message: "Shopify not connected." };
      if (options?.dryRun) return shopify_dryRunValidate(shopify, name, args);
      return shopify_createProduct(shopify, String(args.title), String(args.bodyHtml), String(args.vendor), String(args.productType), Number(args.price), args.sku as string | undefined, args.tags as string | undefined, args.imageUrl as string | undefined);

    case "shopify_fulfillOrder":
      if (!shopify) return { success: false, message: "Shopify not connected." };
      if (options?.dryRun) return shopify_dryRunValidate(shopify, name, args);
      return shopify_fulfillOrder(shopify, String(args.orderId), String(args.locationId), args.trackingNumber as string | undefined, args.trackingCompany as string | undefined, args.notifyCustomer as boolean | undefined);

    case "shopify_tagOrder":
      if (!shopify) return { success: false, message: "Shopify not connected." };
      if (options?.dryRun) return shopify_dryRunValidate(shopify, name, args);
      return shopify_tagOrder(shopify, String(args.orderId), String(args.tags));

    case "shopify_createBlogPost":
      if (!shopify) return { success: false, message: "Shopify not connected." };
      if (options?.dryRun) return shopify_dryRunValidate(shopify, name, args);
      return shopify_createBlogPost(shopify, String(args.blogId), String(args.title), String(args.bodyHtml), args.author as string | undefined, args.tags as string | undefined, args.published as boolean | undefined);

    case "gsc_getSites":
      if (!gsc) return { success: false, message: "Google Search Console not connected." };
      return gsc_getSites(gsc);

    case "gsc_getTopQueries":
      if (!gsc) return { success: false, message: "Google Search Console not connected." };
      return gsc_getTopQueries(gsc, String(args.startDate), String(args.endDate), args.rowLimit as number | undefined);

    case "gsc_getTopPages":
      if (!gsc) return { success: false, message: "Google Search Console not connected." };
      return gsc_getTopPages(gsc, String(args.startDate), String(args.endDate), args.rowLimit as number | undefined);

    case "gsc_getQueryPageBreakdown":
      if (!gsc) return { success: false, message: "Google Search Console not connected." };
      return gsc_getQueryPageBreakdown(gsc, String(args.startDate), String(args.endDate), args.query as string | undefined, args.page as string | undefined, args.rowLimit as number | undefined);

    case "gsc_getSearchPerformance": {
      if (!gsc) return { success: false, message: "Google Search Console not connected." };
      const dims = String(args.dimensions).split(",").map((d) => d.trim()).filter(Boolean);
      return gsc_getSearchPerformance(gsc, String(args.startDate), String(args.endDate), dims, args.rowLimit as number | undefined);
    }

    // ── Google Sheets & Drive ──
    case "sheets_listSpreadsheets":
      if (!gsheets) return { success: false, message: "Google Sheets not connected." };
      return sheets_listSpreadsheets(gsheets);

    case "sheets_createSpreadsheet":
      if (!gsheets) return { success: false, message: "Google Sheets not connected." };
      return sheets_createSpreadsheet(gsheets, String(args.title), args.sheetNames as string[] | undefined);

    case "sheets_readRange":
      if (!gsheets) return { success: false, message: "Google Sheets not connected." };
      return sheets_readRange(gsheets, String(args.spreadsheetId), String(args.range));

    case "sheets_writeRange":
      if (!gsheets) return { success: false, message: "Google Sheets not connected." };
      return sheets_writeRange(gsheets, String(args.spreadsheetId), String(args.range), args.values as string[][]);

    case "sheets_appendRows":
      if (!gsheets) return { success: false, message: "Google Sheets not connected." };
      return sheets_appendRows(gsheets, String(args.spreadsheetId), String(args.range), args.values as string[][]);

    case "sheets_getMetadata":
      if (!gsheets) return { success: false, message: "Google Sheets not connected." };
      return sheets_getMetadata(gsheets, String(args.spreadsheetId));

    // ── Phase 3: POAS Engine ──
    case "shopify_getInventoryItemCOGS":
      if (!shopify) return { success: false, message: "Shopify not connected." };
      return shopify_getInventoryItemCOGS(shopify, args.inventoryItemIds as string[]);

    case "shopify_computePOASMetrics": {
      if (!shopify) return { success: false, message: "Shopify not connected." };
      const ai = await getGoogleGenAI();
      return shopify_computePOASMetrics(shopify, String(args.productId), Number(args.adSpendUsd), Number(args.adAttributedRevenue), args.shopifyFeePercent as number | undefined, args.shippingCostPerOrder as number | undefined, args.returnRatePercent as number | undefined);
    }

    // ── Phase 3: PMax X-Ray ──
    case "googleAds_getPMaxNetworkDistribution":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_getPMaxNetworkDistribution(gads, args.campaignId as string | undefined);

    // ── Phase 3: Creative Autopsy ──
    case "gemini_analyzeCreatives": {
      const ai = await getGoogleGenAI();
      return gemini_analyzeCreatives(ai, VERTEX_MODEL, args.creatives as Array<{ url: string; platform: string; adId: string; clicks?: number; conversions?: number; ctr?: number; spend?: number }>);
    }

    // ── Phase 4: Ad Copy Factory ──
    case "gemini_generateAdCopyMatrix": {
      const ai = await getGoogleGenAI();
      return gemini_generateAdCopyMatrix(ai, VERTEX_MODEL, {
        platform: args.platform as "meta" | "google_ads" | "both",
        productName: String(args.productName),
        productDescription: args.productDescription as string | undefined,
        targetAudience: args.targetAudience as string | undefined,
        usp: args.usp as string | undefined,
        tone: args.tone as string | undefined,
        hookCount: args.hookCount as number | undefined,
        descriptionCount: args.descriptionCount as number | undefined,
      });
    }

    // ── Phase 4: Shopify CMS ──
    case "shopify_getPages":
      if (!shopify) return { success: false, message: "Shopify not connected." };
      return shopify_getPages(shopify, args.limit as number | undefined);

    case "shopify_getBlogs":
      if (!shopify) return { success: false, message: "Shopify not connected." };
      return shopify_getBlogs(shopify);

    case "get_shopify_products":
      if (!shopify) return { success: false, message: "Shopify not connected." };
      return shopify_getProductsByStatus(shopify, (args.status as "active" | "draft" | "archived" | "any" | undefined) ?? "any");

    case "shopify_updatePageContent":
      if (!shopify) return { success: false, message: "Shopify not connected." };
      return shopify_updatePageContent(shopify, String(args.pageId), args.title as string | undefined, args.bodyHtml as string | undefined, args.published as boolean | undefined, args.metaTitle as string | undefined, args.metaDescription as string | undefined);

    // ── Phase 5: Vertical Ontology Engine ──
    case "shopify_catalogSweep": {
      if (!shopify) return { success: false, message: "Shopify not connected." };
      const ai = await getGoogleGenAI();
      return shopify_catalogSweep(shopify, ai, VERTEX_MODEL, args.sampleSize as number | undefined);
    }

    case "shopify_createMetafieldDefinitions":
      if (!shopify) return { success: false, message: "Shopify not connected." };
      return shopify_createMetafieldDefinitions(shopify, args.definitions as Array<{ name: string; key: string; description?: string; type: string; namespace?: string }>);

    case "get_metafield_definitions":
      if (!shopify) return { success: false, message: "Shopify not connected." };
      return shopify_getMetafieldDefinitions(shopify);

    case "update_shopify_theme_colors":
      if (!shopify) return { success: false, message: "Shopify not connected." };
      return shopify_updateThemeColors(shopify, String(args.primary_color), args.secondary_color as string | undefined);

    // ── Phase 6: Compliance Engine ──
    case "compliance_auditDestinationUrl": {
      const ai = await getGoogleGenAI();
      return compliance_auditDestinationUrl(String(args.url), args.adCopy ? String(args.adCopy) : "", ai, VERTEX_MODEL);
    }

    // ── Intelligence Modules ──
    case "calculate_sales_velocity":
      if (!shopify) return { success: false, message: "Shopify not connected." };
      return shopify_calculateSalesVelocity(shopify, String(args.product_id));

    case "create_liquidation_discount":
      if (!shopify) return { success: false, message: "Shopify not connected." };
      return shopify_createLiquidationDiscount(shopify, String(args.product_id), Number(args.discount_percentage));

    case "scan_compliance_policy": {
      if (!shopify) return { success: false, message: "Shopify not connected." };
      const ai = await getGoogleGenAI();
      return shopify_scanCompliancePolicy(shopify, String(args.product_id), String(args.ad_copy_text ?? ""), ai, VERTEX_MODEL);
    }

    case "optimize_product_sge": {
      if (!shopify) return { success: false, message: "Shopify not connected." };
      const ai = await getGoogleGenAI();
      return shopify_optimizeProductSGE(shopify, String(args.product_id), args.target_keywords as string[] | undefined, ai, VERTEX_MODEL);
    }

    case "calculate_customer_clv":
      if (!shopify) return { success: false, message: "Shopify not connected." };
      return shopify_calculateCustomerCLV(shopify, String(args.customer_id));

    // ── Ecosystem Sync Part 1: Defensive ──

    case "googleAds_listPMaxAssetGroups":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_listPMaxAssetGroups(
        gads,
        args.campaign_id ? String(args.campaign_id) : undefined,
        args.status as "ENABLED" | "PAUSED" | "REMOVED" | undefined,
      );

    case "pause_pmax_asset_group":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_pausePMaxAssetGroup(gads, String(args.asset_group_id), gadsOpts);

    case "sync_poas_conversion_value":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_uploadConversionAdjustment(
        gads,
        String(args.gclid),
        Number(args.net_profit_value),
        String(args.conversion_action_id ?? ""),
        String(args.conversion_date_time ?? new Date().toISOString()),
        gadsOpts,
      );

    case "sync_gmc_sge_metadata":
      if (!gads) return { success: false, message: "Google Ads/GMC credentials not connected." };
      return gmc_updateProductMetadata(gads, String(args.product_id), String(args.optimized_description), args.merchant_id as string | undefined);

    case "gmc_get_feed_status": {
      // Live GMC Content API call — bypasses the warehouse entirely.
      // Looks up an active GMC connection for the org to get accessToken + merchantId.
      const orgId = options?.organizationId ?? null;
      const orgFilter = orgId != null
        ? eq(platformConnections.organizationId, orgId)
        : isNull(platformConnections.organizationId);
      const gmcRows = await db
        .select()
        .from(platformConnections)
        .where(and(eq(platformConnections.platform, "gmc"), orgFilter))
        .limit(1);
      if (gmcRows.length === 0) {
        return {
          success: false,
          message: "Google Merchant Center is not connected. Direct the user to /connections to connect a GMC account, then retry.",
          data: { suggested_action: "open_connections_page", platform: "gmc" },
        };
      }
      const { decryptCredentials } = await import("./credential-helpers");
      const creds = decryptCredentials(gmcRows[0].credentials as Record<string, string>);
      const merchantId = (typeof args.merchant_id === "string" && args.merchant_id) || creds.merchantId;
      if (!merchantId) {
        return { success: false, message: "merchant_id not provided and not stored on the GMC connection." };
      }
      const { fetchGmcData } = await import("./platform-fetchers");
      const result = await fetchGmcData({ ...creds, merchantId }, gmcRows[0].id, gmcRows[0].displayName ?? "Google Merchant Center");
      if (!result.success) {
        return { success: false, message: result.error ?? "GMC fetch failed." };
      }
      return {
        success: true,
        message: `GMC feed status: ${(result.data as { summary?: { totalProducts?: number; approved?: number } })?.summary?.totalProducts ?? 0} products tracked.`,
        data: result.data,
      };
    }

    case "predict_gmc_disapprovals":
      if (!gads) return { success: false, message: "Google Ads/GMC credentials not connected." };
      return gmc_auditProductMismatches(gads, String(args.shopify_product_id), String(args.gmc_product_id));

    case "resolve_gmc_mismatch":
      if (!gads) return { success: false, message: "Google Ads/GMC credentials not connected." };
      return gmc_reconcileProduct(gads, String(args.product_id), args.corrections as Record<string, unknown>, args.merchant_id as string | undefined);

    case "sync_high_ltv_customer_match":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_pushCustomerMatchList(gads, String(args.user_list_id), args.customer_hashes as string[], gadsOpts);

    case "check_workspace_billing_status":
      if (!gads) return { success: false, message: "Google Ads/GCP credentials not connected." };
      return workspace_getBillingStatus(gads, String(args.billing_account_id));

    case "resolve_google_ad_disapproval":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_reconcileAdPolicy(gads, String(args.ad_group_ad_id), args.correction_payload as Record<string, unknown>, gadsOpts);

    case "resolve_meta_ad_disapproval":
      if (!meta) return { success: false, message: "Meta Ads not connected." };
      return meta_reconcileAdPolicy(meta, String(args.ad_id), args.correction_payload as Record<string, unknown>);

    // ── Ecosystem Sync Part 2: Strategic Audit ──

    case "calculate_ai_adoption_score":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_calculateAIAdoptionScore(gads);

    case "calculate_account_headroom":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_calculateAccountHeadroom(gads);

    case "identify_budget_constraints":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_identifyBudgetConstraints(gads);

    case "detect_automation_churn":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_detectAutomationChurn(gads);

    case "list_google_ads_campaigns":
      if (!gads) return { success: false, message: "Google Ads not connected." };
      return googleAds_listCampaigns(gads, args.customer_id ? String(args.customer_id) : undefined);

    case "diagnose_google_ads_connection":
      if (!gads) return { success: false, message: "Google Ads not connected — no credentials found in platform connections." };
      return googleAds_listAccessibleCustomers(gads);

    // ── Sprint N: GA4 & CRM Integration ──────────────────────────────────────
    case "deduplicate_revenue_ga4": {
      const ga4Creds = gads ?? credentialsByPlatform["gsc"] ?? credentialsByPlatform["youtube"];
      if (!ga4Creds) return { success: false, message: "A connected Google account is required. Connect Google Workspace first." };
      return ga4_deduplicateRevenue(
        ga4Creds,
        String(args.property_id ?? ""),
        args.days_back ? Number(args.days_back) : 30,
      );
    }

    case "sync_crm_audience_to_ads": {
      if (!gads) return { success: false, message: "Google Ads not connected. Connect it on the Connections page first." };
      return crm_syncAudienceToAds(
        gads,
        String(args.segment_name ?? ""),
        (args.customer_emails as string[]) ?? [],
        String(args.user_list_id ?? ""),
      );
    }

    // ── Sprint R+: Budget Constraint Pipeline ────────────────────────────────
    case "get_budget_constrained_campaigns": {
      if (!gads) return { success: false, message: "Google Ads not connected. Please link your account on the Connections page." };
      const customerIdOverride = typeof args.customer_id === "string" ? args.customer_id : undefined;
      return googleAds_getBudgetConstrainedCampaigns(gads, customerIdOverride);
    }

    // ── Sprint R: Cross-Platform Synthesis ──────────────────────────────────
    case "analyze_margin_bleed": {
      return crossPlatform_marginBleedXRay(gads ?? null, shopify ?? null);
    }

    case "calculate_true_blended_cac": {
      const daysBack = typeof args.days_back === "number" ? args.days_back : 30;
      return crossPlatform_ghostAudienceDeduplicator(gads ?? null, shopify ?? null, daysBack);
    }

    case "generate_retargeting_arbitrage_list": {
      const winStart = typeof args.window_start_days === "number" ? args.window_start_days : 30;
      const winEnd   = typeof args.window_end_days   === "number" ? args.window_end_days   : 40;
      return crossPlatform_crmArbitrage(shopify ?? null, winStart, winEnd);
    }

    // ── GOD MODE ────────────────────────────────────────────────────────────
    case "run_master_diagnostic_sweep": {
      // GA4 property ID: arg override → stored credential → skip
      const ga4ArgId     = typeof args.ga4_property_id === "string" ? args.ga4_property_id.trim() : "";
      const ga4StoredId  = typeof gads?.ga4PropertyId === "string" ? gads.ga4PropertyId.trim() : "";
      const ga4PropertyId = ga4ArgId || ga4StoredId;

      const storeDomain = shopify?.shop ? `https://${shopify.shop.replace(/\.myshopify\.com$/, ".com")}` : "";

      const [inventoryR, aiAdoptionR, budgetR, poasR, pmaxR, ga4R, tagAuditR] = await Promise.allSettled([
        shopify
          ? shopify_getStoreInventoryHealth(shopify)
          : Promise.resolve({ success: false, message: "Shopify not connected — no inventory data." }),
        gads
          ? googleAds_calculateAIAdoptionScore(gads)
          : Promise.resolve({ success: false, message: "Google Ads not connected — AI adoption score unavailable." }),
        gads
          ? googleAds_identifyBudgetConstraints(gads)
          : Promise.resolve({ success: false, message: "Google Ads not connected — budget analysis unavailable." }),
        shopify
          ? shopify_getStoreRevenueSummary(shopify)
          : Promise.resolve({ success: false, message: "Shopify not connected — revenue data unavailable." }),
        gads
          ? googleAds_getPMaxNetworkDistribution(gads)
          : Promise.resolve({ success: false, message: "Google Ads not connected — PMax data unavailable." }),
        ga4PropertyId && gads
          ? ga4_deduplicateRevenue(gads, ga4PropertyId)
          : Promise.resolve({ success: false, message: ga4PropertyId ? "Google credentials unavailable for GA4." : "GA4 property ID not configured — skipping attribution cross-reference." }),
        storeDomain
          ? auditTagInfrastructure(storeDomain).then(r => ({ success: r.status !== "error", message: r.summary, data: r as unknown as Record<string, unknown> } as ExecutionResult))
          : Promise.resolve({ success: false, message: "No store domain available — tag audit skipped." } as ExecutionResult),
      ]);

      const ext = (r: PromiseSettledResult<ExecutionResult>) =>
        r.status === "fulfilled" ? r.value : { success: false, message: r.reason instanceof Error ? r.reason.message : String(r.reason) };

      const inventory  = ext(inventoryR);
      const aiAdoption = ext(aiAdoptionR);
      const budget     = ext(budgetR);
      const poas       = ext(poasR);
      const pmax       = ext(pmaxR);
      const ga4        = ext(ga4R);
      const tagAudit   = ext(tagAuditR);

      // ── Attribution cross-reference: flag if GA4 DDA paid revenue exists ──
      let attributionNote = "GA4 attribution cross-reference not available (property ID not configured).";
      if (ga4.success && ga4.data) {
        const ga4Data = ga4.data as { by_source_medium?: Array<{ source_medium: string; revenue: number }>; total_revenue?: number };
        const totalGa4 = ga4Data.total_revenue ?? 0;
        const paidRows = (ga4Data.by_source_medium ?? []).filter(r =>
          r.source_medium.toLowerCase().includes("cpc") ||
          r.source_medium.toLowerCase().includes("paid") ||
          r.source_medium.toLowerCase().includes("google") ||
          r.source_medium.toLowerCase().includes("facebook"),
        );
        const paidGa4 = paidRows.reduce((s, r) => s + r.revenue, 0);
        attributionNote = `GA4 DDA total revenue: $${totalGa4.toFixed(2)} | Paid channel revenue: $${paidGa4.toFixed(2)}. Cross-reference against Google Ads and Meta self-reported conversions to detect attribution overlap > 15%.`;
      } else {
        attributionNote = `GA4: ${ga4.message}`;
      }

      const platforms = Object.keys(credentialsByPlatform).join(", ") || "none";
      const summary = [
        `Connected platforms: ${platforms}`,
        `Inventory health: ${inventory.message}`,
        `AI Adoption: ${aiAdoption.message}`,
        `Budget Constraints: ${budget.message}`,
        `Revenue summary: ${poas.message}`,
        `PMax Network: ${pmax.message}`,
        `Attribution (GA4 DDA): ${attributionNote}`,
        `Tag Infrastructure: ${tagAudit.message}`,
      ].join("\n");

      return {
        success: true,
        message: summary,
        data: {
          inventory:   inventory.data  ?? { message: inventory.message },
          aiAdoption:  aiAdoption.data ?? { message: aiAdoption.message },
          budget:      budget.data     ?? { message: budget.message },
          poas:        poas.data       ?? { message: poas.message },
          pmax:        pmax.data       ?? { message: pmax.message },
          ga4Attribution: ga4.data     ?? { message: ga4.message },
          tagInfrastructure: tagAudit.data ?? { message: tagAudit.message },
        },
      };
    }

    // ── Sprint AG: Tag Gateway Audit ────────────────────────────────────────
    case "audit_website_tag_infrastructure": {
      const targetUrl = typeof args.url === "string" ? args.url.trim() : "";
      if (!targetUrl) return { success: false, message: "url is required." };
      const auditResult = await auditTagInfrastructure(targetUrl);
      return {
        success: auditResult.status !== "error",
        message: auditResult.summary,
        data: auditResult as unknown as Record<string, unknown>,
      };
    }

    // ── Sprint V: Unified Data Warehouse ─────────────────────────────────────
    case "query_unified_warehouse": {
      const rawSql = typeof args.sql_query === "string" ? args.sql_query.trim() : "";
      if (!rawSql) return { success: false, message: "sql_query is required." };

      // ── Layer 1: Fast pre-flight checks ────────────────────────────────────
      // Must start with SELECT (catches most naive injection attempts)
      if (!/^(SELECT|WITH)\s/i.test(rawSql)) {
        return { success: false, message: "Only SELECT queries are permitted against the warehouse." };
      }

      // Detect destructive keywords anywhere in the query, including inside CTEs.
      // Example bypass attempt: WITH x AS (DELETE FROM ...) SELECT * FROM x
      const DESTRUCTIVE_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|COPY|EXECUTE|DO\s+\$\$)\b/i;
      if (DESTRUCTIVE_KEYWORDS.test(rawSql)) {
        return {
          success: false,
          message: "Query rejected: destructive SQL keyword detected. Only read-only SELECT queries are permitted.",
        };
      }

      // Detect function calls known to cause side effects
      const SIDE_EFFECT_FUNCTIONS = /\b(setval|nextval|pg_sleep|dblink|lo_import|lo_export|copy_to|copy_from)\s*\(/i;
      if (SIDE_EFFECT_FUNCTIONS.test(rawSql)) {
        return {
          success: false,
          message: "Query rejected: side-effect function call detected.",
        };
      }

      // Optional: trigger a sync before querying
      if (args.sync_first === true) {
        try {
          const syncResp = await fetch(`${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/etl/sync-master`, {
            method: "POST",
          });
          if (!syncResp.ok) {
            console.error(`[GeminiTools] ETL sync-master trigger returned ${syncResp.status}`);
          }
        } catch (err) {
          console.error("[GeminiTools] ETL sync-master trigger failed (non-fatal):", err);
        }
      }

      try {
        // Strip trailing semicolon, enforce row cap
        const safeSql = rawSql.replace(/;\s*$/, "");
        const limited = /\bLIMIT\s+\d+/i.test(safeSql)
          ? safeSql
          : `${safeSql} LIMIT 200`;

        // ── Layer 2: Read-only DB transaction ──────────────────────────────
        // PostgreSQL enforces read-only at the transaction level regardless of
        // what the query string contains. This is the definitive fence.
        const result = await db.transaction(
          async (tx) => tx.execute(drizzleSql.raw(limited)),
          { accessMode: "read only" },
        );
        const rows = result.rows as Record<string, unknown>[];

        if (rows.length === 0) {
          // ── Diagnostic: distinguish "no connections" vs "never synced" vs
          // "synced but no match". This replaces the old generic "run Master
          // Sync" suggestion which dead-ends users who haven't connected any
          // platform yet.
          const orgId = options?.organizationId ?? null;
          const orgFilter = orgId != null
            ? eq(platformConnections.organizationId, orgId)
            : isNull(platformConnections.organizationId);
          // Org-scope warehouse sync timestamps so we don't leak another
          // tenant's last-sync time when reporting "synced_but_no_match".
          const tenantId = orgId != null ? String(orgId) : "default";
          const [conns, [latestShopify], [latestAds]] = await Promise.all([
            db.select({ platform: platformConnections.platform })
              .from(platformConnections).where(orgFilter),
            db.select({ syncedAt: warehouseShopifyProducts.syncedAt })
              .from(warehouseShopifyProducts)
              .where(eq(warehouseShopifyProducts.tenantId, tenantId))
              .orderBy(drizzleSql`${warehouseShopifyProducts.syncedAt} DESC NULLS LAST`)
              .limit(1),
            db.select({ syncedAt: warehouseGoogleAds.syncedAt })
              .from(warehouseGoogleAds)
              .where(eq(warehouseGoogleAds.tenantId, tenantId))
              .orderBy(drizzleSql`${warehouseGoogleAds.syncedAt} DESC NULLS LAST`)
              .limit(1),
          ]);
          const connected = Array.from(new Set(conns.map((c) => c.platform)));
          const lastSync = [latestShopify?.syncedAt, latestAds?.syncedAt]
            .filter((d): d is Date => d instanceof Date)
            .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

          let diagnosis: string;
          let suggested_action: string;
          let actionable_message: string;
          if (connected.length === 0) {
            diagnosis = "no_platforms_connected";
            suggested_action = "open_connections_page";
            actionable_message =
              "No platforms are connected for this workspace, so the warehouse has nothing to populate from. " +
              "Direct the user to /connections to connect Shopify, Google Ads, and/or Google Merchant Center. " +
              "Do NOT suggest running Master Sync — it will be a no-op until at least one platform is connected. " +
              "If the question concerns Google Merchant Center, prefer the gmc_get_feed_status tool which queries the live GMC API.";
          } else if (lastSync === null) {
            diagnosis = "connected_but_never_synced";
            suggested_action = "run_master_sync";
            actionable_message =
              `Connected platforms (${connected.join(", ")}) have never been synced into the warehouse. ` +
              "Trigger Master Sync (POST /api/etl/sync-master) or pass sync_first:true on the next call.";
          } else {
            diagnosis = "synced_but_no_match";
            suggested_action = "refine_query";
            actionable_message =
              `Warehouse last synced at ${lastSync.toISOString()} (connected: ${connected.join(", ")}), ` +
              "but the query genuinely returned 0 rows. Broaden the filter (date range, status, SKU pattern) or use a different tool.";
          }

          return {
            success: true,
            message: `Query returned 0 rows — ${diagnosis}.`,
            data: {
              row_count: 0,
              rows: [],
              diagnosis,
              connected_platforms: connected,
              last_warehouse_sync: lastSync ? lastSync.toISOString() : null,
              suggested_action,
              actionable_message,
            },
          };
        }

        const columns = Object.keys(rows[0]);
        return {
          success: true,
          message: `Warehouse query returned ${rows.length} row(s). Columns: ${columns.join(", ")}.`,
          data: {
            row_count: rows.length,
            columns,
            rows,
            note: rows.length === 200 ? "Result capped at 200 rows — add a more specific WHERE clause to narrow results." : undefined,
          },
        };
      } catch (err) {
        return { success: false, message: `Warehouse query error: ${String(err)}` };
      }
    }

    // ── Sprint DB: BYODB — Query User Database ───────────────────────────
    case "query_user_database": {
      const credId = typeof args.credential_id === "number" ? args.credential_id : 0;
      const rawSql = typeof args.sql_query === "string" ? args.sql_query.trim() : "";
      if (!credId) return { success: false, message: "credential_id is required." };
      if (!rawSql) return { success: false, message: "sql_query is required." };

      try {
        const { executeUserQuery } = await import("../services/dynamic-query-engine");
        const orgId = options?.organizationId || 0;
        if (!orgId) return { success: false, message: "Organization context is required to query user databases." };

        const result = await executeUserQuery(credId, orgId, rawSql);
        return result;
      } catch (err) {
        return { success: false, message: `User DB query error: ${String(err)}` };
      }
    }

    case "queryTriageAlerts": {
      try {
        const { queryPersistedAlerts } = await import("./advanced-diagnostic-engine");
        const allAlerts = await queryPersistedAlerts("default");

        let filtered = allAlerts;
        if (args.severity_filter) {
          filtered = filtered.filter((a) => a.severity === String(args.severity_filter).toLowerCase());
        }
        if (args.type_filter) {
          filtered = filtered.filter((a) => a.type === String(args.type_filter));
        }
        if (!args.include_resolved) {
          filtered = filtered.filter((a) => !a.resolvedStatus);
        }

        const summary = filtered.map((a) => ({
          id: a.id,
          severity: a.severity,
          type: a.type,
          title: a.title,
          message: a.message,
          platform: a.platform,
          action: a.action,
          resolved: a.resolvedStatus,
          timestamp: a.createdAt.toISOString(),
        }));

        const critCount = summary.filter((a) => a.severity === "critical").length;
        const warnCount = summary.filter((a) => a.severity === "warning").length;
        const infoCount = summary.filter((a) => a.severity === "info").length;

        return {
          success: true,
          message: `Found ${summary.length} active alert(s): ${critCount} critical, ${warnCount} warning, ${infoCount} info.`,
          data: { alert_count: summary.length, critical: critCount, warning: warnCount, info: infoCount, alerts: summary },
        };
      } catch (err) {
        return { success: false, message: `Failed to query triage alerts: ${String(err)}` };
      }
    }

    default:
      return { success: false, message: `Unknown tool: ${name}` };
  }
}
