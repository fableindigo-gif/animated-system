import { z } from "zod";
import { db, proposedTasks } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { logger } from "./logger";

const NONEMPTY_STRING = z.string().min(1);
const POSITIVE_NUMBER = z.number().positive();
const CAMPAIGN_ID = z.string().min(1).regex(/^\d+$/, "Must be a numeric ID string");

const WRITE_TOOL_SCHEMAS: Record<string, z.ZodObject<z.ZodRawShape>> = {
  googleAds_updateCampaignBudget: z.object({
    campaignBudgetId: CAMPAIGN_ID,
    newDailyBudgetUsd: POSITIVE_NUMBER,
  }),
  googleAds_updateCampaignBidding: z.object({
    campaignId: CAMPAIGN_ID,
    strategy: z.enum(["TARGET_ROAS", "TARGET_CPA"]),
    targetValue: POSITIVE_NUMBER,
  }),
  googleAds_updateCampaignStatus: z.object({
    campaignId: CAMPAIGN_ID,
    status: z.enum(["ENABLED", "PAUSED"]),
  }),
  googleAds_addNegativeKeyword: z.object({
    campaignId: CAMPAIGN_ID,
    keyword: NONEMPTY_STRING,
    matchType: z.enum(["EXACT", "PHRASE", "BROAD"]),
  }),
  meta_updateAdSetBudget: z.object({
    adSetId: NONEMPTY_STRING,
    dailyBudget: z.number().optional(),
    lifetimeBudget: z.number().optional(),
  }),
  meta_updateObjectStatus: z.object({
    objectId: NONEMPTY_STRING,
    status: z.enum(["ACTIVE", "PAUSED"]),
  }),
  meta_updateAdCreative: z.object({
    adId: NONEMPTY_STRING,
    primaryText: z.string().optional(),
    headline: z.string().optional(),
    imageUrl: z.string().url().optional(),
  }),
  shopify_updateProductStatus: z.object({
    productId: NONEMPTY_STRING,
    status: z.enum(["active", "archived", "draft"]),
  }),
  shopify_createDiscountCode: z.object({
    title: NONEMPTY_STRING,
    discountType: z.enum(["percentage", "fixed_amount", "free_shipping"]),
    discountValue: z.number(),
    code: NONEMPTY_STRING,
    usageLimit: z.number().optional(),
    startsAt: z.string().optional(),
    endsAt: z.string().optional(),
  }),
  shopify_updateVariantPrice: z.object({
    variantId: NONEMPTY_STRING,
    price: z.number().nonnegative(),
    compareAtPrice: z.number().nonnegative().optional(),
  }),
  shopify_updateInventory: z.object({
    inventoryItemId: NONEMPTY_STRING,
    locationId: NONEMPTY_STRING,
    available: z.number().int(),
  }),
  shopify_updateProductDetails: z.object({
    productId: NONEMPTY_STRING,
    title: z.string().optional(),
    bodyHtml: z.string().optional(),
    tags: z.string().optional(),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
    vendor: z.string().optional(),
  }),
  shopify_fulfillOrder: z.object({
    orderId: NONEMPTY_STRING,
    locationId: NONEMPTY_STRING,
    trackingNumber: z.string().optional(),
    trackingCompany: z.string().optional(),
    notifyCustomer: z.boolean().optional(),
  }),
  shopify_tagOrder: z.object({
    orderId: NONEMPTY_STRING,
    tags: NONEMPTY_STRING,
  }),
  pause_pmax_asset_group: z.object({
    asset_group_id: NONEMPTY_STRING,
  }),
  sync_poas_conversion_value: z.object({
    gclid: NONEMPTY_STRING,
    net_profit_value: z.number(),
    conversion_action_id: z.string().optional(),
    conversion_date_time: z.string().optional(),
  }),
  create_liquidation_discount: z.object({
    product_id: NONEMPTY_STRING,
    discount_percentage: z.number().min(1).max(99),
  }),
  shopify_updatePageContent: z.object({
    pageId: NONEMPTY_STRING,
    title: z.string().optional(),
    bodyHtml: z.string().optional(),
    published: z.boolean().optional(),
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
  }),
  update_shopify_theme_colors: z.object({
    primary_color: NONEMPTY_STRING,
    secondary_color: z.string().optional(),
  }),
  edit_shopify_storefront_content: z.object({
    pageId: z.string().optional(),
    themeFile: z.string().optional(),
    newHtmlContent: NONEMPTY_STRING,
    editSummary: NONEMPTY_STRING,
  }),
  sync_gmc_sge_metadata: z.object({
    product_id: NONEMPTY_STRING,
    optimized_description: NONEMPTY_STRING,
    merchant_id: z.string().optional(),
  }),
  resolve_gmc_mismatch: z.object({
    product_id: NONEMPTY_STRING,
    corrections: z.record(z.unknown()),
    merchant_id: z.string().optional(),
  }),
  sync_high_ltv_customer_match: z.object({
    user_list_id: NONEMPTY_STRING,
    customer_hashes: z.array(z.string()),
  }),
  sheets_createSpreadsheet: z.object({
    title: NONEMPTY_STRING,
    sheetNames: z.array(z.string()).optional(),
  }),
  sheets_writeRange: z.object({
    spreadsheetId: NONEMPTY_STRING,
    range: NONEMPTY_STRING,
    values: z.array(z.array(z.string())),
  }),
  sheets_appendRows: z.object({
    spreadsheetId: NONEMPTY_STRING,
    range: NONEMPTY_STRING,
    values: z.array(z.array(z.string())),
  }),
  // ── Extended Google Ads EXECUTE catalog ──
  googleAds_createCampaignBudget: z.object({
    name: NONEMPTY_STRING,
    dailyBudgetUsd: POSITIVE_NUMBER,
    deliveryMethod: z.enum(["STANDARD", "ACCELERATED"]).optional(),
  }),
  googleAds_updateAdGroupStatus: z.object({
    adGroupId: CAMPAIGN_ID,
    status: z.enum(["ENABLED", "PAUSED"]),
  }),
  googleAds_updateAdStatus: z.object({
    adGroupAdResourceName: NONEMPTY_STRING,
    status: z.enum(["ENABLED", "PAUSED"]),
  }),
  googleAds_addPositiveKeyword: z.object({
    adGroupId: CAMPAIGN_ID,
    keyword: NONEMPTY_STRING,
    matchType: z.enum(["EXACT", "PHRASE", "BROAD"]),
    cpcBidUsd: z.number().positive().optional(),
  }),
  googleAds_updateKeywordBid: z.object({
    criterionResourceName: NONEMPTY_STRING,
    cpcBidUsd: POSITIVE_NUMBER,
  }),
  googleAds_removeNegativeKeyword: z.object({
    criterionResourceName: NONEMPTY_STRING,
  }),
  googleAds_applyRecommendation: z.object({
    recommendationResourceName: NONEMPTY_STRING,
  }),
};

const TOOL_DISPLAY_NAMES: Record<string, { displayName: string; platform: string; platformLabel: string }> = {
  googleAds_updateCampaignBudget: { displayName: "Update Campaign Budget", platform: "google_ads", platformLabel: "Google Ads" },
  googleAds_updateCampaignBidding: { displayName: "Update Bidding Strategy", platform: "google_ads", platformLabel: "Google Ads" },
  googleAds_updateCampaignStatus: { displayName: "Update Campaign Status", platform: "google_ads", platformLabel: "Google Ads" },
  googleAds_addNegativeKeyword: { displayName: "Add Negative Keyword", platform: "google_ads", platformLabel: "Google Ads" },
  googleAds_createCampaignBudget: { displayName: "Create Campaign Budget", platform: "google_ads", platformLabel: "Google Ads" },
  googleAds_updateAdGroupStatus: { displayName: "Update Ad Group Status", platform: "google_ads", platformLabel: "Google Ads" },
  googleAds_updateAdStatus: { displayName: "Update Ad Status", platform: "google_ads", platformLabel: "Google Ads" },
  googleAds_addPositiveKeyword: { displayName: "Add Keyword", platform: "google_ads", platformLabel: "Google Ads" },
  googleAds_updateKeywordBid: { displayName: "Update Keyword CPC Bid", platform: "google_ads", platformLabel: "Google Ads" },
  googleAds_removeNegativeKeyword: { displayName: "Remove Negative Keyword", platform: "google_ads", platformLabel: "Google Ads" },
  googleAds_applyRecommendation: { displayName: "Apply Google Ads Recommendation", platform: "google_ads", platformLabel: "Google Ads" },
  meta_updateAdSetBudget: { displayName: "Update Ad Set Budget", platform: "meta", platformLabel: "Meta Ads" },
  meta_updateObjectStatus: { displayName: "Update Ad Status", platform: "meta", platformLabel: "Meta Ads" },
  meta_updateAdCreative: { displayName: "Update Ad Creative", platform: "meta", platformLabel: "Meta Ads" },
  shopify_updateProductStatus: { displayName: "Update Product Status", platform: "shopify", platformLabel: "Shopify" },
  shopify_createDiscountCode: { displayName: "Create Discount Code", platform: "shopify", platformLabel: "Shopify" },
  shopify_updateVariantPrice: { displayName: "Update Variant Price", platform: "shopify", platformLabel: "Shopify" },
  shopify_updateInventory: { displayName: "Update Inventory", platform: "shopify", platformLabel: "Shopify" },
  shopify_updateProductDetails: { displayName: "Update Product Details", platform: "shopify", platformLabel: "Shopify" },
  shopify_fulfillOrder: { displayName: "Fulfill Order", platform: "shopify", platformLabel: "Shopify" },
  shopify_tagOrder: { displayName: "Tag Order", platform: "shopify", platformLabel: "Shopify" },
  pause_pmax_asset_group: { displayName: "Pause PMax Asset Group", platform: "google_ads", platformLabel: "Google Ads" },
  sync_poas_conversion_value: { displayName: "Sync POAS Conversion Value", platform: "google_ads", platformLabel: "Google Ads" },
  create_liquidation_discount: { displayName: "Create Liquidation Discount", platform: "shopify", platformLabel: "Shopify" },
  shopify_updatePageContent: { displayName: "Update Page Content", platform: "shopify", platformLabel: "Shopify" },
  update_shopify_theme_colors: { displayName: "Update Theme Colors", platform: "shopify", platformLabel: "Shopify" },
  sync_gmc_sge_metadata: { displayName: "Sync GMC Metadata", platform: "google_ads", platformLabel: "Google Merchant Center" },
  resolve_gmc_mismatch: { displayName: "Resolve GMC Mismatch", platform: "google_ads", platformLabel: "Google Merchant Center" },
  sync_high_ltv_customer_match: { displayName: "Sync Customer Match List", platform: "google_ads", platformLabel: "Google Ads" },
  edit_shopify_storefront_content: { displayName: "Edit Storefront Content", platform: "shopify", platformLabel: "Shopify" },
  sheets_createSpreadsheet: { displayName: "Create Spreadsheet", platform: "google_sheets", platformLabel: "Google Sheets" },
  sheets_writeRange: { displayName: "Write to Spreadsheet", platform: "google_sheets", platformLabel: "Google Sheets" },
  sheets_appendRows: { displayName: "Append to Spreadsheet", platform: "google_sheets", platformLabel: "Google Sheets" },
};

export function isWriteTool(toolName: string): boolean {
  return toolName in WRITE_TOOL_SCHEMAS;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitizedArgs?: Record<string, unknown>;
}

export function validateToolArgs(toolName: string, args: Record<string, unknown>): ValidationResult {
  const schema = WRITE_TOOL_SCHEMAS[toolName];
  if (!schema) {
    return { valid: true, sanitizedArgs: args };
  }

  const result = schema.safeParse(args);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    return { valid: false, error: `Validation failed for ${toolName}: ${issues}` };
  }

  const data = result.data as Record<string, unknown>;

  if (toolName === "edit_shopify_storefront_content" && !data.pageId && !data.themeFile) {
    return { valid: false, error: "Validation failed for edit_shopify_storefront_content: either pageId or themeFile must be provided" };
  }

  return { valid: true, sanitizedArgs: data };
}

function computeIdempotencyKey(workspaceId: string | number | null, toolName: string, args: Record<string, unknown>): string {
  const payload = JSON.stringify({ ws: workspaceId, tool: toolName, args });
  return crypto.createHash("sha256").update(payload).digest("hex").substring(0, 40);
}

export interface QueueResult {
  queued: boolean;
  taskId?: number;
  duplicate?: boolean;
  message: string;
}

export async function queueWriteOperation(
  toolName: string,
  validatedArgs: Record<string, unknown>,
  workspaceId: string | number | null,
  reasoning?: string,
): Promise<QueueResult> {
  const meta = TOOL_DISPLAY_NAMES[toolName];
  if (!meta) {
    return { queued: false, message: `Unknown write tool: ${toolName}. Cannot queue.` };
  }

  const idempotencyKey = computeIdempotencyKey(workspaceId, toolName, validatedArgs);

  const existing = await db.select({ id: proposedTasks.id, status: proposedTasks.status })
    .from(proposedTasks)
    .where(and(
      eq(proposedTasks.idempotencyKey, idempotencyKey),
      eq(proposedTasks.status, "pending"),
    ))
    .limit(1);

  if (existing.length > 0) {
    logger.info({ toolName, idempotencyKey, existingId: existing[0].id }, "Duplicate write operation blocked by idempotency key");
    return {
      queued: false,
      duplicate: true,
      taskId: existing[0].id,
      message: `This exact operation is already pending approval (Task #${existing[0].id}). No duplicate was created.`,
    };
  }

  const [task] = await db.insert(proposedTasks).values({
    workspaceId: typeof workspaceId === "number" ? workspaceId : null,
    idempotencyKey,
    proposedByName: "AI Agent",
    proposedByRole: "ai",
    platform: meta.platform,
    platformLabel: meta.platformLabel,
    toolName,
    toolDisplayName: meta.displayName,
    toolArgs: validatedArgs,
    reasoning: reasoning || "AI-generated recommendation pending human review.",
    status: "pending",
    comments: "",
  }).returning();

  logger.info({ toolName, taskId: task.id, idempotencyKey }, "Write operation queued for approval");

  return {
    queued: true,
    taskId: task.id,
    message: `Operation "${meta.displayName}" has been queued as Task #${task.id} for admin approval. No external API call was made — the action will only execute after an authorized team member approves it in the Approval Queue.`,
  };
}
