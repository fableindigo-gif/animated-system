import { logger } from "./logger";
import { shopifyFetchAllPages, fetchWithBackoff } from "./fetch-utils";
import {
  customerFromCreds,
  getGoogleAdsClient,
  runSingleMutate,
  formatGoogleAdsError,
  extractPartialFailures,
  type MutateExecOptions,
} from "./google-ads/client";
import { enums, services } from "google-ads-api";
import crypto from "crypto";

export type ExecutionResult = {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
};

// ─── Google Ads ───────────────────────────────────────────────────────────────
//
// All write paths route through the official-style `google-ads-api` SDK via
// `lib/google-ads/client.ts` (see GOOGLE_ADS_API_VERSION). The SDK gives us
// typed mutate operations, validate-only mode, partial-failure parsing and
// retries for free — the executors below just translate caller args into a
// single typed MutateOperation and surface partial-failure errors cleanly.

function adsCustomerId(credentials: Record<string, string>): string {
  return (credentials.customerId ?? "").replace(/-/g, "");
}

function failureMessage(failures: { index: number; message: string }[]): string {
  return failures.map((f) => f.message).join("; ");
}

// ── Read-side GAQL helper.
// All read-side queries now go through the official-style `google-ads-api`
// SDK via `customerFromCreds(...).query(gaql)`. The SDK handles auth,
// pagination, retries and snake-case → camelCase conversion. We expose a
// single helper that returns either { ok: true, rows } or { ok: false,
// message } so call sites can preserve their existing error UX without
// re-implementing fetch/error parsing.
async function gadsRunQuery(
  credentials: Record<string, string>,
  query: string,
): Promise<
  | { ok: true; rows: Array<Record<string, unknown>> }
  | { ok: false; message: string }
> {
  if (!credentials?.customerId) {
    return { ok: false, message: "Google Ads Customer ID not configured. Enter it on the Connections page first." };
  }
  try {
    const customer = customerFromCreds(credentials);
    const rows = (await customer.query(query)) as Array<Record<string, unknown>>;
    return { ok: true, rows };
  } catch (err) {
    return { ok: false, message: formatGoogleAdsError(err) };
  }
}

export async function googleAds_updateCampaignBudget(
  credentials: Record<string, string>,
  campaignBudgetId: string,
  newDailyBudgetUsd: number,
  options: MutateExecOptions = {},
): Promise<ExecutionResult> {
  const customerId = adsCustomerId(credentials);
  const amountMicros = Math.round(newDailyBudgetUsd * 1_000_000);
  try {
    const customer = customerFromCreds(credentials);
    const result = await runSingleMutate(
      customer,
      {
        entity: "campaign_budget",
        operation: "update",
        // update_mask is auto-derived by the SDK from the populated fields
        resource: {
          resource_name: `customers/${customerId}/campaignBudgets/${campaignBudgetId}`,
          amount_micros: amountMicros,
        },
      },
      options,
    );
    if (!result.ok) {
      return { success: false, message: `Google Ads API error: ${failureMessage(result.failures)}`, data: { partialFailures: result.failures } };
    }
    const verb = options.validateOnly ? "validated" : "updated";
    return {
      success: true,
      message: `Budget ${verb} to $${newDailyBudgetUsd}/day (${amountMicros} micros) for budget ID ${campaignBudgetId}${options.validateOnly ? " (dry-run)" : ""}`,
      data: { validateOnly: !!options.validateOnly },
    };
  } catch (err) {
    logger.error({ err }, "googleAds_updateCampaignBudget error");
    return { success: false, message: `Google Ads API error: ${formatGoogleAdsError(err)}` };
  }
}

export async function googleAds_updateCampaignBidding(
  credentials: Record<string, string>,
  campaignId: string,
  strategy: "TARGET_ROAS" | "TARGET_CPA",
  targetValue: number,
  options: MutateExecOptions = {},
): Promise<ExecutionResult> {
  const customerId = adsCustomerId(credentials);
  const resourceName = `customers/${customerId}/campaigns/${campaignId}`;

  let resource: Record<string, unknown>;
  if (strategy === "TARGET_ROAS") {
    resource = { resource_name: resourceName, target_roas: { target_roas: targetValue } };
  } else {
    const targetCpaMicros = Math.round(targetValue * 1_000_000);
    resource = { resource_name: resourceName, target_cpa: { target_cpa_micros: targetCpaMicros } };
  }

  try {
    const customer = customerFromCreds(credentials);
    const result = await runSingleMutate(
      customer,
      { entity: "campaign", operation: "update", resource },
      options,
    );
    if (!result.ok) {
      return { success: false, message: `Google Ads API error: ${failureMessage(result.failures)}`, data: { partialFailures: result.failures } };
    }
    const label = strategy === "TARGET_ROAS" ? `tROAS: ${(targetValue * 100).toFixed(0)}%` : `tCPA: $${targetValue}`;
    const verb = options.validateOnly ? "validated" : "updated";
    return {
      success: true,
      message: `Bidding strategy ${verb} — ${label} — for campaign ID ${campaignId}${options.validateOnly ? " (dry-run)" : ""}`,
      data: { validateOnly: !!options.validateOnly },
    };
  } catch (err) {
    logger.error({ err }, "googleAds_updateCampaignBidding error");
    return { success: false, message: `Google Ads API error: ${formatGoogleAdsError(err)}` };
  }
}

export async function googleAds_updateCampaignStatus(
  credentials: Record<string, string>,
  campaignId: string,
  status: "ENABLED" | "PAUSED",
  options: MutateExecOptions = {},
): Promise<ExecutionResult> {
  const customerId = adsCustomerId(credentials);
  const statusEnum = status === "ENABLED" ? enums.CampaignStatus.ENABLED : enums.CampaignStatus.PAUSED;
  try {
    const customer = customerFromCreds(credentials);
    const result = await runSingleMutate(
      customer,
      {
        entity: "campaign",
        operation: "update",
        resource: {
          resource_name: `customers/${customerId}/campaigns/${campaignId}`,
          status: statusEnum,
        },
      },
      options,
    );
    if (!result.ok) {
      return { success: false, message: `Google Ads API error: ${failureMessage(result.failures)}`, data: { partialFailures: result.failures } };
    }
    return {
      success: true,
      message: `Campaign ${campaignId} status set to ${status}${options.validateOnly ? " (dry-run)" : ""}`,
      data: { validateOnly: !!options.validateOnly },
    };
  } catch (err) {
    logger.error({ err }, "googleAds_updateCampaignStatus error");
    return { success: false, message: `Google Ads API error: ${formatGoogleAdsError(err)}` };
  }
}

export async function googleAds_addNegativeKeyword(
  credentials: Record<string, string>,
  campaignId: string,
  keyword: string,
  matchType: "EXACT" | "PHRASE" | "BROAD",
  options: MutateExecOptions = {},
): Promise<ExecutionResult> {
  const customerId = adsCustomerId(credentials);
  const matchEnum =
    matchType === "EXACT"
      ? enums.KeywordMatchType.EXACT
      : matchType === "PHRASE"
        ? enums.KeywordMatchType.PHRASE
        : enums.KeywordMatchType.BROAD;
  try {
    const customer = customerFromCreds(credentials);
    const result = await runSingleMutate(
      customer,
      {
        entity: "campaign_criterion",
        operation: "create",
        resource: {
          campaign: `customers/${customerId}/campaigns/${campaignId}`,
          negative: true,
          keyword: { text: keyword, match_type: matchEnum },
        },
      },
      options,
    );
    if (!result.ok) {
      return { success: false, message: `Google Ads API error: ${failureMessage(result.failures)}`, data: { partialFailures: result.failures } };
    }
    return {
      success: true,
      message: `Negative keyword "${keyword}" (${matchType}) added to campaign ${campaignId}${options.validateOnly ? " (dry-run)" : ""}`,
      data: { validateOnly: !!options.validateOnly },
    };
  } catch (err) {
    logger.error({ err }, "googleAds_addNegativeKeyword error");
    return { success: false, message: `Google Ads API error: ${formatGoogleAdsError(err)}` };
  }
}

// ─── Meta Ads ─────────────────────────────────────────────────────────────────

// Meta Marketing API has no validate_only flag on write endpoints. In dry-run
// (preview) mode each executor performs a GET on the target object to confirm
// it exists and credentials are valid before the user approves the write.
type MetaOpts = { dryRun?: boolean };

export async function meta_updateAdSetBudget(
  credentials: Record<string, string>,
  adSetId: string,
  dailyBudget?: number,
  lifetimeBudget?: number,
  opts?: MetaOpts,
): Promise<ExecutionResult> {
  // Dry-run: Meta's Marketing API has no validate_only flag on POST, so we
  // perform a GET on the ad set to confirm the object exists and credentials
  // are valid before the user approves the write.
  if (opts?.dryRun) {
    try {
      const getUrl = `https://graph.facebook.com/v22.0/${adSetId}?fields=id,name,status,daily_budget,lifetime_budget&access_token=${encodeURIComponent(credentials.accessToken)}`;
      const resp = await fetch(getUrl);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: { message?: string; error_user_msg?: string; error_user_title?: string } };
        const detail = err?.error?.error_user_msg ?? err?.error?.message ?? resp.statusText;
        return { success: false, message: `Meta API error (preview): ${detail}`, data: { dry_run: true, validation_error: err?.error ?? null } };
      }
      const adSet = await resp.json() as { id?: string; name?: string; status?: string };
      const budgetDesc = dailyBudget != null ? `daily budget to $${dailyBudget}` : `lifetime budget to $${lifetimeBudget}`;
      return {
        success: true,
        message: `Preview OK — ad set "${adSet.name ?? adSetId}" (${adSet.status ?? "unknown"}) exists and credentials are valid. ${budgetDesc} would be applied on approval. No changes made.`,
        data: { dry_run: true, adSet },
      };
    } catch (err) {
      logger.error({ err }, "meta_updateAdSetBudget dryRun error");
      return { success: false, message: `Meta preview check failed: ${String(err)}`, data: { dry_run: true } };
    }
  }

  const params: Record<string, string> = { access_token: credentials.accessToken };
  if (dailyBudget != null) params.daily_budget = String(Math.round(dailyBudget * 100));
  if (lifetimeBudget != null) params.lifetime_budget = String(Math.round(lifetimeBudget * 100));

  const url = `https://graph.facebook.com/v22.0/${adSetId}`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { error?: { message?: string; error_user_msg?: string; error_user_title?: string } };
      const detail = err?.error?.error_user_msg ?? err?.error?.message ?? resp.statusText;
      return { success: false, message: `Meta API error: ${detail}` };
    }
    const budgetDesc = dailyBudget != null ? `daily budget to $${dailyBudget}` : `lifetime budget to $${lifetimeBudget}`;
    return { success: true, message: `Ad set ${adSetId} ${budgetDesc} updated successfully` };
  } catch (err) {
    logger.error({ err }, "meta_updateAdSetBudget error");
    return { success: false, message: String(err) };
  }
}

export async function meta_updateObjectStatus(
  credentials: Record<string, string>,
  objectId: string,
  status: "ACTIVE" | "PAUSED",
  opts?: MetaOpts,
): Promise<ExecutionResult> {
  // Dry-run: GET the object to confirm it exists and credentials are valid;
  // Meta's Marketing API has no validate_only flag for status writes.
  if (opts?.dryRun) {
    try {
      const getUrl = `https://graph.facebook.com/v22.0/${objectId}?fields=id,name,status,effective_status&access_token=${encodeURIComponent(credentials.accessToken)}`;
      const resp = await fetch(getUrl);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: { message?: string; error_user_msg?: string } };
        const detail = err?.error?.error_user_msg ?? err?.error?.message ?? resp.statusText;
        return { success: false, message: `Meta API error (preview): ${detail}`, data: { dry_run: true, validation_error: err?.error ?? null } };
      }
      const obj = await resp.json() as { id?: string; name?: string; status?: string; effective_status?: string };
      return {
        success: true,
        message: `Preview OK — object "${obj.name ?? objectId}" (currently ${obj.effective_status ?? obj.status ?? "unknown"}) exists and credentials are valid. Status would be set to ${status} on approval. No changes made.`,
        data: { dry_run: true, object: obj },
      };
    } catch (err) {
      logger.error({ err }, "meta_updateObjectStatus dryRun error");
      return { success: false, message: `Meta preview check failed: ${String(err)}`, data: { dry_run: true } };
    }
  }

  const url = `https://graph.facebook.com/v22.0/${objectId}`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: credentials.accessToken, status }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { error?: { message?: string; error_user_msg?: string } };
      const detail = err?.error?.error_user_msg ?? err?.error?.message ?? resp.statusText;
      return { success: false, message: `Meta API error: ${detail}` };
    }
    return { success: true, message: `Object ${objectId} status set to ${status}` };
  } catch (err) {
    logger.error({ err }, "meta_updateObjectStatus error");
    return { success: false, message: String(err) };
  }
}

export async function meta_updateAdCreative(
  credentials: Record<string, string>,
  adId: string,
  primaryText?: string,
  headline?: string,
  imageUrl?: string,
  opts?: MetaOpts,
): Promise<ExecutionResult> {
  // Dry-run: GET the ad to confirm it exists and credentials are valid;
  // Meta's Marketing API has no validate_only flag for creative writes.
  if (opts?.dryRun) {
    try {
      const getUrl = `https://graph.facebook.com/v22.0/${adId}?fields=id,name,status,effective_status,creative&access_token=${encodeURIComponent(credentials.accessToken)}`;
      const resp = await fetch(getUrl);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: { message?: string; error_user_msg?: string } };
        const detail = err?.error?.error_user_msg ?? err?.error?.message ?? resp.statusText;
        return { success: false, message: `Meta API error (preview): ${detail}`, data: { dry_run: true, validation_error: err?.error ?? null } };
      }
      const ad = await resp.json() as { id?: string; name?: string; status?: string; effective_status?: string };
      const changes: string[] = [];
      if (primaryText) changes.push("primary text");
      if (headline) changes.push("headline");
      if (imageUrl) changes.push("image");
      const changeDesc = changes.length > 0 ? changes.join(", ") : "creative fields";
      return {
        success: true,
        message: `Preview OK — ad "${ad.name ?? adId}" (${ad.effective_status ?? ad.status ?? "unknown"}) exists and credentials are valid. ${changeDesc} would be updated on approval. No changes made.`,
        data: { dry_run: true, ad },
      };
    } catch (err) {
      logger.error({ err }, "meta_updateAdCreative dryRun error");
      return { success: false, message: `Meta preview check failed: ${String(err)}`, data: { dry_run: true } };
    }
  }

  const creativeFields: Record<string, unknown> = {};
  if (primaryText) creativeFields.message = primaryText;
  if (headline) creativeFields.name = headline;

  const body: Record<string, unknown> = {
    access_token: credentials.accessToken,
    creative: creativeFields,
  };
  if (imageUrl) {
    (body.creative as Record<string, unknown>).object_story_spec = {
      page_id: credentials.pageId,
      link_data: { picture: imageUrl, message: primaryText ?? "", name: headline ?? "" },
    };
  }

  const url = `https://graph.facebook.com/v22.0/${adId}`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { error?: { message?: string; error_user_msg?: string } };
      const detail = err?.error?.error_user_msg ?? err?.error?.message ?? resp.statusText;
      return { success: false, message: `Meta API error: ${detail}` };
    }
    return { success: true, message: `Ad ${adId} creative updated successfully` };
  } catch (err) {
    logger.error({ err }, "meta_updateAdCreative error");
    return { success: false, message: String(err) };
  }
}

// ─── Shopify ──────────────────────────────────────────────────────────────────

function shopifyBase(credentials: Record<string, string>): { baseUrl: string; headers: Record<string, string> } {
  const baseUrl = credentials.shopDomain.startsWith("https://")
    ? credentials.shopDomain
    : `https://${credentials.shopDomain}`;
  return {
    baseUrl,
    headers: { "X-Shopify-Access-Token": credentials.accessToken, "Content-Type": "application/json" },
  };
}

// ─── Shopify dry-run validator ────────────────────────────────────────────────
// Shopify's REST/GraphQL Admin API has no native validate_only flag, so we
// validate by:
//   1. Local schema check (required fields, enum values, numeric ranges)
//   2. A live GET on the target resource (for update/mutate ops) — this proves
//      the credentials are valid AND the resource exists. A 404 here means the
//      real PUT/POST would also fail, surfacing the same error before approval.
//   3. For pure create ops (no existing resource), a GET on /shop.json to
//      confirm the token still has write scope on this store.
// Returns an ExecutionResult with `data.dry_run = true` so the UI can label it.
export async function shopify_dryRunValidate(
  credentials: Record<string, string>,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ExecutionResult> {
  const { baseUrl, headers } = shopifyBase(credentials);
  const apiVersion = "2024-01";

  // Local schema validation first — catches bad enum/range before any network call
  const localErrors: string[] = [];
  if (toolName === "shopify_updateProductStatus") {
    if (!["active", "archived", "draft"].includes(String(args.status))) {
      localErrors.push(`status must be active|archived|draft (got "${args.status}")`);
    }
  }
  if (toolName === "shopify_createDiscountCode") {
    if (!["percentage", "fixed_amount", "free_shipping"].includes(String(args.discountType))) {
      localErrors.push(`discountType must be percentage|fixed_amount|free_shipping (got "${args.discountType}")`);
    }
    const v = Number(args.discountValue);
    if (Number.isNaN(v) || v < 0) localErrors.push(`discountValue must be a non-negative number`);
    if (args.discountType === "percentage" && v > 100) localErrors.push(`percentage discountValue must be ≤ 100`);
  }
  if (toolName === "shopify_updateVariantPrice") {
    const p = Number(args.price);
    if (Number.isNaN(p) || p < 0) localErrors.push(`price must be a non-negative number`);
  }
  if (toolName === "shopify_updateInventory") {
    const a = Number(args.available);
    if (!Number.isInteger(a)) localErrors.push(`available must be an integer`);
  }
  if (localErrors.length > 0) {
    return {
      success: false,
      message: `Validation failed: ${localErrors.join("; ")}`,
      data: { dry_run: true, validation_errors: localErrors },
    };
  }

  // Pick the GET URL that proves the target resource (or store) exists
  let probeUrl: string;
  let probeLabel: string;
  switch (toolName) {
    case "shopify_updateProductStatus":
    case "shopify_updateProductMetafield":
    case "shopify_updateProductDetails":
      probeUrl = `${baseUrl}/admin/api/${apiVersion}/products/${args.productId}.json`;
      probeLabel = `product ${args.productId}`;
      break;
    case "shopify_updateVariantPrice":
      probeUrl = `${baseUrl}/admin/api/${apiVersion}/variants/${args.variantId}.json`;
      probeLabel = `variant ${args.variantId}`;
      break;
    case "shopify_updateInventory":
      probeUrl = `${baseUrl}/admin/api/${apiVersion}/inventory_items/${args.inventoryItemId}.json`;
      probeLabel = `inventory item ${args.inventoryItemId}`;
      break;
    case "shopify_fulfillOrder":
    case "shopify_tagOrder":
      probeUrl = `${baseUrl}/admin/api/${apiVersion}/orders/${args.orderId}.json`;
      probeLabel = `order ${args.orderId}`;
      break;
    case "shopify_createBlogPost":
      probeUrl = `${baseUrl}/admin/api/${apiVersion}/blogs/${args.blogId}.json`;
      probeLabel = `blog ${args.blogId}`;
      break;
    case "shopify_createDiscountCode":
    case "shopify_createProduct":
    default:
      // Pure-create tools — probe /shop.json to verify credentials & write scope
      probeUrl = `${baseUrl}/admin/api/${apiVersion}/shop.json`;
      probeLabel = `store credentials`;
      break;
  }

  try {
    const resp = await fetch(probeUrl, { method: "GET", headers });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({})) as { errors?: unknown };
      const detail = body.errors ? JSON.stringify(body.errors) : `HTTP ${resp.status} ${resp.statusText}`;
      return {
        success: false,
        message: `Validation failed — ${probeLabel} not accessible: ${detail}`,
        data: { dry_run: true, http_status: resp.status, validation_error: body.errors ?? resp.statusText },
      };
    }
    return {
      success: true,
      message: `Validation passed — ${probeLabel} exists and credentials are valid. ${toolName} would proceed. No changes were made.`,
      data: { dry_run: true },
    };
  } catch (err) {
    logger.error({ err, toolName }, "shopify_dryRunValidate error");
    return { success: false, message: `Validation failed: ${String(err)}`, data: { dry_run: true } };
  }
}

export async function shopify_updateProductStatus(
  credentials: Record<string, string>,
  productId: string,
  status: "active" | "archived" | "draft",
): Promise<ExecutionResult> {
  const { baseUrl, headers } = shopifyBase(credentials);
  try {
    const resp = await fetch(`${baseUrl}/admin/api/2024-01/products/${productId}.json`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ product: { id: productId, status } }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { errors?: unknown };
      return { success: false, message: `Shopify API error: ${JSON.stringify(err.errors ?? resp.statusText)}` };
    }
    return { success: true, message: `Product ${productId} status set to "${status}"` };
  } catch (err) {
    logger.error({ err }, "shopify_updateProductStatus error");
    return { success: false, message: String(err) };
  }
}

export async function shopify_createDiscountCode(
  credentials: Record<string, string>,
  title: string,
  discountType: "percentage" | "fixed_amount" | "free_shipping",
  discountValue: number,
  code: string,
  usageLimit?: number,
  startsAt?: string,
  endsAt?: string,
): Promise<ExecutionResult> {
  const { baseUrl, headers } = shopifyBase(credentials);
  try {
    // Create PriceRule first
    const priceRuleBody: Record<string, unknown> = {
      price_rule: {
        title,
        target_type: "line_item",
        target_selection: "all",
        allocation_method: "across",
        value_type: discountType === "percentage" ? "percentage" : discountType === "free_shipping" ? "percentage" : "fixed_amount",
        value: discountType === "percentage" || discountType === "free_shipping" ? `-${discountValue}` : `-${discountValue}`,
        customer_selection: "all",
        starts_at: startsAt ?? new Date().toISOString(),
      },
    };
    if (endsAt) (priceRuleBody.price_rule as Record<string, unknown>).ends_at = endsAt;
    if (usageLimit) (priceRuleBody.price_rule as Record<string, unknown>).usage_limit = usageLimit;
    if (discountType === "free_shipping") {
      (priceRuleBody.price_rule as Record<string, unknown>).target_type = "shipping_line";
    }

    const priceRuleResp = await fetch(`${baseUrl}/admin/api/2024-01/price_rules.json`, {
      method: "POST",
      headers,
      body: JSON.stringify(priceRuleBody),
    });
    if (!priceRuleResp.ok) {
      const err = await priceRuleResp.json().catch(() => ({})) as { errors?: unknown };
      return { success: false, message: `Shopify PriceRule error: ${JSON.stringify(err.errors ?? priceRuleResp.statusText)}` };
    }
    const priceRuleJson = await priceRuleResp.json() as { price_rule?: { id?: number } };
    const priceRuleId = priceRuleJson.price_rule?.id;

    // Create discount code
    const codeResp = await fetch(`${baseUrl}/admin/api/2024-01/price_rules/${priceRuleId}/discount_codes.json`, {
      method: "POST",
      headers,
      body: JSON.stringify({ discount_code: { code } }),
    });
    if (!codeResp.ok) {
      const err = await codeResp.json().catch(() => ({})) as { errors?: unknown };
      return { success: false, message: `Shopify DiscountCode error: ${JSON.stringify(err.errors ?? codeResp.statusText)}` };
    }

    return {
      success: true,
      message: `Discount code "${code}" created — ${discountType === "percentage" ? `${discountValue}% off` : discountType === "fixed_amount" ? `$${discountValue} off` : "Free shipping"}. Price rule ID: ${priceRuleId}`,
      data: { priceRuleId, code },
    };
  } catch (err) {
    logger.error({ err }, "shopify_createDiscountCode error");
    return { success: false, message: String(err) };
  }
}

export async function shopify_updateVariantPrice(
  credentials: Record<string, string>,
  variantId: string,
  price: number,
  compareAtPrice?: number,
): Promise<ExecutionResult> {
  const { baseUrl, headers } = shopifyBase(credentials);
  const variant: Record<string, unknown> = { id: variantId, price: price.toFixed(2) };
  if (compareAtPrice != null) variant.compare_at_price = compareAtPrice.toFixed(2);
  try {
    const resp = await fetch(`${baseUrl}/admin/api/2024-01/variants/${variantId}.json`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ variant }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { errors?: unknown };
      return { success: false, message: `Shopify API error: ${JSON.stringify(err.errors ?? resp.statusText)}` };
    }
    const msg = compareAtPrice != null
      ? `Variant ${variantId} price set to $${price.toFixed(2)} (compare at $${compareAtPrice.toFixed(2)})`
      : `Variant ${variantId} price set to $${price.toFixed(2)}`;
    return { success: true, message: msg };
  } catch (err) {
    logger.error({ err }, "shopify_updateVariantPrice error");
    return { success: false, message: String(err) };
  }
}

export async function shopify_updateInventory(
  credentials: Record<string, string>,
  inventoryItemId: string,
  locationId: string,
  available: number,
): Promise<ExecutionResult> {
  const { baseUrl, headers } = shopifyBase(credentials);
  try {
    const resp = await fetch(`${baseUrl}/admin/api/2024-01/inventory_levels/set.json`, {
      method: "POST",
      headers,
      body: JSON.stringify({ inventory_item_id: inventoryItemId, location_id: locationId, available }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { errors?: unknown };
      return { success: false, message: `Shopify API error: ${JSON.stringify(err.errors ?? resp.statusText)}` };
    }
    return { success: true, message: `Inventory for item ${inventoryItemId} at location ${locationId} set to ${available} units` };
  } catch (err) {
    logger.error({ err }, "shopify_updateInventory error");
    return { success: false, message: String(err) };
  }
}

export async function shopify_updateProductDetails(
  credentials: Record<string, string>,
  productId: string,
  title?: string,
  bodyHtml?: string,
  tags?: string,
  seoTitle?: string,
  seoDescription?: string,
  vendor?: string,
): Promise<ExecutionResult> {
  const { baseUrl, headers } = shopifyBase(credentials);
  const product: Record<string, unknown> = { id: productId };
  if (title != null) product.title = title;
  if (bodyHtml != null) product.body_html = bodyHtml;
  if (tags != null) product.tags = tags;
  if (vendor != null) product.vendor = vendor;
  if (seoTitle != null || seoDescription != null) {
    product.metafields_global_title_tag = seoTitle ?? undefined;
    product.metafields_global_description_tag = seoDescription ?? undefined;
  }
  try {
    const resp = await fetch(`${baseUrl}/admin/api/2024-01/products/${productId}.json`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ product }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { errors?: unknown };
      return { success: false, message: `Shopify API error: ${JSON.stringify(err.errors ?? resp.statusText)}` };
    }
    const updated = Object.keys(product).filter((k) => k !== "id").join(", ");
    return { success: true, message: `Product ${productId} updated fields: ${updated}` };
  } catch (err) {
    logger.error({ err }, "shopify_updateProductDetails error");
    return { success: false, message: String(err) };
  }
}

export async function shopify_createProduct(
  credentials: Record<string, string>,
  title: string,
  bodyHtml: string,
  vendor: string,
  productType: string,
  price: number,
  sku?: string,
  tags?: string,
  imageUrl?: string,
): Promise<ExecutionResult> {
  const { baseUrl, headers } = shopifyBase(credentials);
  const product: Record<string, unknown> = {
    title,
    body_html: bodyHtml,
    vendor,
    product_type: productType,
    tags: tags ?? "",
    variants: [{ price: price.toFixed(2), sku: sku ?? "" }],
  };
  if (imageUrl) product.images = [{ src: imageUrl }];

  try {
    const resp = await fetch(`${baseUrl}/admin/api/2024-01/products.json`, {
      method: "POST",
      headers,
      body: JSON.stringify({ product }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { errors?: unknown };
      return { success: false, message: `Shopify API error: ${JSON.stringify(err.errors ?? resp.statusText)}` };
    }
    const json = await resp.json() as { product?: { id?: number; handle?: string } };
    return {
      success: true,
      message: `Product "${title}" created with ID ${json.product?.id} (handle: ${json.product?.handle})`,
      data: { productId: json.product?.id, handle: json.product?.handle },
    };
  } catch (err) {
    logger.error({ err }, "shopify_createProduct error");
    return { success: false, message: String(err) };
  }
}

export async function shopify_fulfillOrder(
  credentials: Record<string, string>,
  orderId: string,
  locationId: string,
  trackingNumber?: string,
  trackingCompany?: string,
  notifyCustomer?: boolean,
): Promise<ExecutionResult> {
  const { baseUrl, headers } = shopifyBase(credentials);

  const fulfillmentBody: Record<string, unknown> = {
    fulfillment: {
      location_id: locationId,
      notify_customer: notifyCustomer ?? true,
    },
  };
  if (trackingNumber) {
    (fulfillmentBody.fulfillment as Record<string, unknown>).tracking_number = trackingNumber;
  }
  if (trackingCompany) {
    (fulfillmentBody.fulfillment as Record<string, unknown>).tracking_company = trackingCompany;
  }

  try {
    const resp = await fetch(`${baseUrl}/admin/api/2024-01/orders/${orderId}/fulfillments.json`, {
      method: "POST",
      headers,
      body: JSON.stringify(fulfillmentBody),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { errors?: unknown };
      return { success: false, message: `Shopify API error: ${JSON.stringify(err.errors ?? resp.statusText)}` };
    }
    const json = await resp.json() as { fulfillment?: { id?: number; status?: string } };
    return {
      success: true,
      message: `Order ${orderId} fulfilled — fulfillment ID ${json.fulfillment?.id}, status: ${json.fulfillment?.status}${trackingNumber ? `, tracking: ${trackingNumber}` : ""}`,
    };
  } catch (err) {
    logger.error({ err }, "shopify_fulfillOrder error");
    return { success: false, message: String(err) };
  }
}

export async function shopify_tagOrder(
  credentials: Record<string, string>,
  orderId: string,
  tags: string,
): Promise<ExecutionResult> {
  const { baseUrl, headers } = shopifyBase(credentials);
  try {
    const resp = await fetch(`${baseUrl}/admin/api/2024-01/orders/${orderId}.json`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ order: { id: orderId, tags } }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { errors?: unknown };
      return { success: false, message: `Shopify API error: ${JSON.stringify(err.errors ?? resp.statusText)}` };
    }
    return { success: true, message: `Order ${orderId} tagged with: ${tags}` };
  } catch (err) {
    logger.error({ err }, "shopify_tagOrder error");
    return { success: false, message: String(err) };
  }
}

export async function shopify_createBlogPost(
  credentials: Record<string, string>,
  blogId: string,
  title: string,
  bodyHtml: string,
  author?: string,
  tags?: string,
  published?: boolean,
): Promise<ExecutionResult> {
  const { baseUrl, headers } = shopifyBase(credentials);
  const article: Record<string, unknown> = {
    title,
    body_html: bodyHtml,
    published: published ?? true,
  };
  if (author) article.author = author;
  if (tags) article.tags = tags;

  try {
    const resp = await fetch(`${baseUrl}/admin/api/2024-01/blogs/${blogId}/articles.json`, {
      method: "POST",
      headers,
      body: JSON.stringify({ article }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { errors?: unknown };
      return { success: false, message: `Shopify API error: ${JSON.stringify(err.errors ?? resp.statusText)}` };
    }
    const json = await resp.json() as { article?: { id?: number; handle?: string } };
    return {
      success: true,
      message: `Blog post "${title}" published — article ID ${json.article?.id} (handle: ${json.article?.handle})`,
      data: { articleId: json.article?.id, handle: json.article?.handle },
    };
  } catch (err) {
    logger.error({ err }, "shopify_createBlogPost error");
    return { success: false, message: String(err) };
  }
}

// ─── Google Search Console ────────────────────────────────────────────────────

function gscHeaders(credentials: Record<string, string>): Record<string, string> {
  return { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/json" };
}

export async function gsc_getSites(credentials: Record<string, string>): Promise<ExecutionResult> {
  try {
    const resp = await fetch("https://www.googleapis.com/webmasters/v3/sites", { headers: gscHeaders(credentials) });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { error?: { message?: string } };
      return { success: false, message: `GSC API error: ${err?.error?.message ?? resp.statusText}` };
    }
    const json = await resp.json() as { siteEntry?: Array<{ siteUrl: string; permissionLevel: string }> };
    const sites = (json.siteEntry ?? []).map((s) => ({ url: s.siteUrl, permission: s.permissionLevel }));
    return { success: true, message: `Found ${sites.length} verified Search Console site(s)`, data: { sites } };
  } catch (err) {
    logger.error({ err }, "gsc_getSites error");
    return { success: false, message: String(err) };
  }
}

export async function gsc_getSearchPerformance(
  credentials: Record<string, string>,
  startDate: string,
  endDate: string,
  dimensions: string[],
  rowLimit?: number,
  dimensionFilters?: Array<{ dimension: string; operator: string; expression: string }>,
): Promise<ExecutionResult> {
  const siteUrl = credentials.siteUrl;
  if (!siteUrl) return { success: false, message: "No siteUrl configured for Search Console. Re-connect and enter your site URL." };

  const body: Record<string, unknown> = {
    startDate,
    endDate,
    dimensions,
    rowLimit: rowLimit ?? 25,
    dataState: "final",
  };
  if (dimensionFilters?.length) body.dimensionFilterGroups = [{ filters: dimensionFilters }];

  try {
    const resp = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      { method: "POST", headers: gscHeaders(credentials), body: JSON.stringify(body) },
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { error?: { message?: string } };
      return { success: false, message: `GSC API error: ${err?.error?.message ?? resp.statusText}` };
    }
    const json = await resp.json() as { rows?: Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }> };
    const rows = (json.rows ?? []).map((r) => ({
      keys: r.keys,
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: Number((r.ctr * 100).toFixed(2)),
      position: Number(r.position.toFixed(1)),
    }));
    return {
      success: true,
      message: `Search Console performance: ${rows.length} rows for ${startDate} → ${endDate}`,
      data: { rows, dimensions, siteUrl, startDate, endDate },
    };
  } catch (err) {
    logger.error({ err }, "gsc_getSearchPerformance error");
    return { success: false, message: String(err) };
  }
}

export async function gsc_getTopQueries(
  credentials: Record<string, string>,
  startDate: string,
  endDate: string,
  rowLimit?: number,
): Promise<ExecutionResult> {
  return gsc_getSearchPerformance(credentials, startDate, endDate, ["query"], rowLimit ?? 25);
}

export async function gsc_getTopPages(
  credentials: Record<string, string>,
  startDate: string,
  endDate: string,
  rowLimit?: number,
): Promise<ExecutionResult> {
  return gsc_getSearchPerformance(credentials, startDate, endDate, ["page"], rowLimit ?? 25);
}

export async function gsc_getQueryPageBreakdown(
  credentials: Record<string, string>,
  startDate: string,
  endDate: string,
  query?: string,
  page?: string,
  rowLimit?: number,
): Promise<ExecutionResult> {
  const filters: Array<{ dimension: string; operator: string; expression: string }> = [];
  if (query) filters.push({ dimension: "query", operator: "equals", expression: query });
  if (page) filters.push({ dimension: "page", operator: "equals", expression: page });
  return gsc_getSearchPerformance(credentials, startDate, endDate, ["query", "page"], rowLimit ?? 25, filters.length ? filters : undefined);
}

// ─── Google Sheets ────────────────────────────────────────────────────────────

function sheetsHeaders(credentials: Record<string, string>): Record<string, string> {
  return { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/json" };
}

export async function sheets_listSpreadsheets(credentials: Record<string, string>): Promise<ExecutionResult> {
  try {
    const q = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet'");
    const resp = await fetchWithBackoff(
      `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime+desc&pageSize=20&fields=files(id,name,modifiedTime,webViewLink)`,
      { headers: sheetsHeaders(credentials) },
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { error?: { message?: string } };
      return { success: false, message: `Drive API error: ${err?.error?.message ?? resp.statusText}` };
    }
    const json = await resp.json() as { files?: Array<{ id: string; name: string; modifiedTime: string; webViewLink: string }> };
    const files = json.files ?? [];
    return { success: true, message: `Found ${files.length} spreadsheet(s)`, data: { spreadsheets: files } };
  } catch (err) {
    logger.error({ err }, "sheets_listSpreadsheets error");
    return { success: false, message: String(err) };
  }
}

export async function sheets_createSpreadsheet(
  credentials: Record<string, string>,
  title: string,
  sheetNames?: string[],
): Promise<ExecutionResult> {
  try {
    const sheets = (sheetNames ?? ["Sheet1"]).map((name) => ({ properties: { title: name } }));
    const resp = await fetchWithBackoff("https://sheets.googleapis.com/v4/spreadsheets", {
      method: "POST",
      headers: sheetsHeaders(credentials),
      body: JSON.stringify({ properties: { title }, sheets }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { error?: { message?: string } };
      return { success: false, message: `Sheets API error: ${err?.error?.message ?? resp.statusText}` };
    }
    const json = await resp.json() as { spreadsheetId: string; spreadsheetUrl: string };
    return {
      success: true,
      message: `Spreadsheet "${title}" created`,
      data: { spreadsheetId: json.spreadsheetId, url: json.spreadsheetUrl },
    };
  } catch (err) {
    logger.error({ err }, "sheets_createSpreadsheet error");
    return { success: false, message: String(err) };
  }
}

export async function sheets_readRange(
  credentials: Record<string, string>,
  spreadsheetId: string,
  range: string,
): Promise<ExecutionResult> {
  try {
    const encodedRange = encodeURIComponent(range);
    const resp = await fetchWithBackoff(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}`,
      { headers: sheetsHeaders(credentials) },
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { error?: { message?: string } };
      return { success: false, message: `Sheets API error: ${err?.error?.message ?? resp.statusText}` };
    }
    const json = await resp.json() as { range: string; values?: string[][] };
    const values = json.values ?? [];
    return {
      success: true,
      message: `Read ${values.length} row(s) from ${json.range}`,
      data: { range: json.range, values, rowCount: values.length, columnCount: values[0]?.length ?? 0 },
    };
  } catch (err) {
    logger.error({ err }, "sheets_readRange error");
    return { success: false, message: String(err) };
  }
}

export async function sheets_writeRange(
  credentials: Record<string, string>,
  spreadsheetId: string,
  range: string,
  values: string[][],
): Promise<ExecutionResult> {
  try {
    const encodedRange = encodeURIComponent(range);
    const resp = await fetchWithBackoff(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}?valueInputOption=USER_ENTERED`,
      {
        method: "PUT",
        headers: sheetsHeaders(credentials),
        body: JSON.stringify({ range, values }),
      },
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { error?: { message?: string } };
      return { success: false, message: `Sheets API error: ${err?.error?.message ?? resp.statusText}` };
    }
    const json = await resp.json() as { updatedCells: number; updatedRows: number; updatedRange: string };
    return {
      success: true,
      message: `Wrote ${json.updatedRows} row(s) / ${json.updatedCells} cell(s) to ${json.updatedRange}`,
      data: { updatedRange: json.updatedRange, updatedRows: json.updatedRows, updatedCells: json.updatedCells },
    };
  } catch (err) {
    logger.error({ err }, "sheets_writeRange error");
    return { success: false, message: String(err) };
  }
}

export async function sheets_appendRows(
  credentials: Record<string, string>,
  spreadsheetId: string,
  range: string,
  values: string[][],
): Promise<ExecutionResult> {
  try {
    const encodedRange = encodeURIComponent(range);
    const resp = await fetchWithBackoff(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        headers: sheetsHeaders(credentials),
        body: JSON.stringify({ range, values }),
      },
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { error?: { message?: string } };
      return { success: false, message: `Sheets API error: ${err?.error?.message ?? resp.statusText}` };
    }
    const json = await resp.json() as { updates?: { updatedRows?: number; updatedCells?: number; updatedRange?: string } };
    const updates = json.updates ?? {};
    return {
      success: true,
      message: `Appended ${updates.updatedRows ?? values.length} row(s) to ${updates.updatedRange ?? range}`,
      data: { updatedRange: updates.updatedRange, updatedRows: updates.updatedRows, updatedCells: updates.updatedCells },
    };
  } catch (err) {
    logger.error({ err }, "sheets_appendRows error");
    return { success: false, message: String(err) };
  }
}

export async function sheets_getMetadata(
  credentials: Record<string, string>,
  spreadsheetId: string,
): Promise<ExecutionResult> {
  try {
    const resp = await fetchWithBackoff(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties`,
      { headers: sheetsHeaders(credentials) },
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { error?: { message?: string } };
      return { success: false, message: `Sheets API error: ${err?.error?.message ?? resp.statusText}` };
    }
    const json = await resp.json() as {
      properties: { title: string };
      sheets: Array<{ properties: { sheetId: number; title: string; index: number; gridProperties: { rowCount: number; columnCount: number } } }>;
    };
    const sheetTabs = json.sheets.map((s) => ({
      id: s.properties.sheetId,
      title: s.properties.title,
      index: s.properties.index,
      rows: s.properties.gridProperties.rowCount,
      columns: s.properties.gridProperties.columnCount,
    }));
    return {
      success: true,
      message: `Spreadsheet "${json.properties.title}" has ${sheetTabs.length} tab(s)`,
      data: { title: json.properties.title, sheets: sheetTabs },
    };
  } catch (err) {
    logger.error({ err }, "sheets_getMetadata error");
    return { success: false, message: String(err) };
  }
}

export async function shopify_updateProductMetafield(
  credentials: Record<string, string>,
  productId: string,
  namespace: string,
  key: string,
  value: string,
  type: string,
): Promise<ExecutionResult> {
  const { baseUrl, headers } = shopifyBase(credentials);
  try {
    const resp = await fetch(`${baseUrl}/admin/api/2024-01/products/${productId}/metafields.json`, {
      method: "POST",
      headers,
      body: JSON.stringify({ metafield: { namespace, key, value, type } }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { errors?: unknown };
      return { success: false, message: `Shopify Metafield error: ${JSON.stringify(err.errors ?? resp.statusText)}` };
    }
    return { success: true, message: `Metafield ${namespace}.${key} set on product ${productId}` };
  } catch (err) {
    logger.error({ err }, "shopify_updateProductMetafield error");
    return { success: false, message: String(err) };
  }
}

// ─── Phase 3: POAS Engine ─────────────────────────────────────────────────────

export async function shopify_getInventoryItemCOGS(
  credentials: Record<string, string>,
  inventoryItemIds: string[],
): Promise<ExecutionResult> {
  const { baseUrl, headers } = shopifyBase(credentials);
  try {
    const ids = inventoryItemIds.slice(0, 50).join(",");
    const resp = await fetch(`${baseUrl}/admin/api/2024-01/inventory_items.json?ids=${ids}`, { headers });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { errors?: unknown };
      return { success: false, message: `Shopify InventoryItem error: ${JSON.stringify(err.errors ?? resp.statusText)}` };
    }
    const json = await resp.json() as { inventory_items?: Array<{ id: number; cost?: string; sku?: string }> };
    const items = (json.inventory_items ?? []).map((i) => ({
      inventoryItemId: String(i.id),
      sku: i.sku ?? "—",
      costOfGoods: i.cost ? Number(i.cost) : null,
    }));
    const withCOGS = items.filter((i) => i.costOfGoods != null).length;
    return {
      success: true,
      message: `Fetched COGS for ${items.length} inventory items (${withCOGS} have cost data)`,
      data: { items },
    };
  } catch (err) {
    logger.error({ err }, "shopify_getInventoryItemCOGS error");
    return { success: false, message: String(err) };
  }
}

export async function shopify_computePOASMetrics(
  credentials: Record<string, string>,
  productId: string,
  adSpendUsd: number,
  adAttributedRevenue: number,
  shopifyFeePercent?: number,
  shippingCostPerOrder?: number,
  returnRatePercent?: number,
): Promise<ExecutionResult> {
  const { baseUrl, headers } = shopifyBase(credentials);
  try {
    const resp = await fetch(`${baseUrl}/admin/api/2024-01/products/${productId}.json?fields=id,title,variants`, { headers });
    if (!resp.ok) return { success: false, message: `Shopify product fetch failed: ${resp.statusText}` };
    const json = await resp.json() as { product?: { id: number; title?: string; variants?: Array<{ inventory_item_id?: number; price?: string }> } };
    const product = json.product;
    const variantIds = (product?.variants ?? []).map((v) => String(v.inventory_item_id)).filter(Boolean);
    const cogsResult = variantIds.length ? await shopify_getInventoryItemCOGS(credentials, variantIds) : null;
    const cogsItems = (cogsResult?.data?.items as Array<{ costOfGoods: number | null }> | undefined) ?? [];
    const avgCOGS = cogsItems.filter((i) => i.costOfGoods != null).reduce((s, i) => s + (i.costOfGoods ?? 0), 0) / Math.max(1, cogsItems.filter((i) => i.costOfGoods != null).length);

    const shopifyFee = (shopifyFeePercent ?? 2.9) / 100;
    const returnRate = (returnRatePercent ?? 5) / 100;
    const shipping = shippingCostPerOrder ?? 0;

    const effectiveRevenue = adAttributedRevenue * (1 - returnRate);
    const shopifyFees = effectiveRevenue * shopifyFee;
    const estimatedOrders = adAttributedRevenue > 0 && product?.variants?.[0]?.price ? adAttributedRevenue / Number(product.variants[0].price) : 0;
    const totalCOGS = avgCOGS > 0 ? avgCOGS * estimatedOrders : 0;
    const totalShipping = shipping * estimatedOrders;
    const grossProfit = effectiveRevenue - shopifyFees - totalCOGS - totalShipping;
    const netProfit = grossProfit - adSpendUsd;
    const poas = adSpendUsd > 0 ? netProfit / adSpendUsd : 0;
    const grossROAS = adSpendUsd > 0 ? adAttributedRevenue / adSpendUsd : 0;

    return {
      success: true,
      message: `POAS Analysis for "${product?.title ?? productId}": Gross ROAS ${grossROAS.toFixed(2)}x | POAS ${poas.toFixed(2)}x | Net Profit $${netProfit.toFixed(2)}`,
      data: {
        productId,
        productTitle: product?.title,
        adSpendUsd,
        adAttributedRevenue,
        effectiveRevenue: Number(effectiveRevenue.toFixed(2)),
        shopifyFees: Number(shopifyFees.toFixed(2)),
        totalCOGS: Number(totalCOGS.toFixed(2)),
        totalShipping: Number(totalShipping.toFixed(2)),
        grossProfit: Number(grossProfit.toFixed(2)),
        netProfit: Number(netProfit.toFixed(2)),
        grossROAS: Number(grossROAS.toFixed(2)),
        poas: Number(poas.toFixed(2)),
        avgCOGS: Number(avgCOGS.toFixed(2)),
        estimatedOrders: Number(estimatedOrders.toFixed(1)),
        returnRate,
        shopifyFeePercent: shopifyFeePercent ?? 2.9,
        isProfitable: netProfit > 0,
      },
    };
  } catch (err) {
    logger.error({ err }, "shopify_computePOASMetrics error");
    return { success: false, message: String(err) };
  }
}

// ─── Phase 3: PMax X-Ray ──────────────────────────────────────────────────────

async function gadsSearchStream(
  credentials: Record<string, string>,
  query: string,
): Promise<unknown[]> {
  const r = await gadsRunQuery(credentials, query);
  // Preserve the legacy paged shape ([{results: rows}, ...]) so callers that
  // do `.flatMap(p => p.results ?? [])` keep working unchanged. On error we
  // return [] to match the old "best-effort" semantics.
  return r.ok ? [{ results: r.rows }] : [];
}

export async function googleAds_getPMaxNetworkDistribution(
  credentials: Record<string, string>,
  campaignId?: string,
): Promise<ExecutionResult> {
  try {
    const campaignFilter = campaignId ? `AND campaign.id = ${campaignId}` : "";

    // Search term insights — Search component
    const searchQuery = `
      SELECT campaign.id, campaign.name, campaign_search_term_insight.category_label,
             metrics.clicks, metrics.conversions, metrics.cost_micros
      FROM campaign_search_term_insight
      WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
      ${campaignFilter}
      ORDER BY metrics.cost_micros DESC LIMIT 50
    `;

    // Placement view — Display/Video component
    const placementQuery = `
      SELECT group_placement_view.placement_type, group_placement_view.display_name,
             metrics.clicks, metrics.impressions, metrics.cost_micros
      FROM group_placement_view
      WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
      ${campaignFilter}
      ORDER BY metrics.cost_micros DESC LIMIT 50
    `;

    // Asset group performance — Shopping vs other
    const assetQuery = `
      SELECT asset_group.id, asset_group.name, asset_group.status,
             metrics.clicks, metrics.conversions, metrics.cost_micros,
             metrics.all_conversions_value
      FROM asset_group
      WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
      ${campaignFilter}
      ORDER BY metrics.cost_micros DESC LIMIT 20
    `;

    const [searchResults, placementResults, assetResults] = await Promise.all([
      gadsSearchStream(credentials, searchQuery),
      gadsSearchStream(credentials, placementQuery),
      gadsSearchStream(credentials, assetQuery),
    ]);

    // Estimate spend distribution
    const searchSpend = (searchResults as Array<{ results?: Array<{ metrics?: { costMicros?: string } }> }>)
      .flatMap((r) => r.results ?? [])
      .reduce((s, row) => s + Number(row.metrics?.costMicros ?? 0), 0) / 1_000_000;

    const placements = (placementResults as Array<{ results?: Array<{ groupPlacementView?: { placementType?: string }; metrics?: { costMicros?: string } }> }>)
      .flatMap((r) => r.results ?? []);
    const displaySpend = placements
      .filter((p) => ["YOUTUBE_VIDEO", "YOUTUBE_CHANNEL", "WEBSITE"].includes(p.groupPlacementView?.placementType ?? ""))
      .reduce((s, p) => s + Number(p.metrics?.costMicros ?? 0) / 1_000_000, 0);
    const gmailShoppingSpend = placements
      .filter((p) => ["GOOGLE_PRODUCTS", "MCA_SMART_SHOPPING"].includes(p.groupPlacementView?.placementType ?? ""))
      .reduce((s, p) => s + Number(p.metrics?.costMicros ?? 0) / 1_000_000, 0);

    const totalEstimated = searchSpend + displaySpend + gmailShoppingSpend;
    const assetGroups = (assetResults as Array<{ results?: Array<{ assetGroup?: { id?: string; name?: string }; metrics?: { costMicros?: string; conversions?: number } }> }>)
      .flatMap((r) => r.results ?? [])
      .map((a) => ({
        name: a.assetGroup?.name ?? "Unknown",
        spendUsd: Number(Number(a.metrics?.costMicros ?? 0) / 1_000_000).toFixed(2),
        conversions: Number(a.metrics?.conversions ?? 0).toFixed(1),
      }));

    const distribution = totalEstimated > 0
      ? {
          search: { spend: Number(searchSpend.toFixed(2)), pct: Number(((searchSpend / totalEstimated) * 100).toFixed(1)) },
          display: { spend: Number(displaySpend.toFixed(2)), pct: Number(((displaySpend / totalEstimated) * 100).toFixed(1)) },
          shopping: { spend: Number(gmailShoppingSpend.toFixed(2)), pct: Number(((gmailShoppingSpend / totalEstimated) * 100).toFixed(1)) },
        }
      : { search: { spend: 0, pct: 33 }, display: { spend: 0, pct: 34 }, shopping: { spend: 0, pct: 33 } };

    return {
      success: true,
      message: `PMax X-Ray complete: Search ${distribution.search.pct}% | Shopping ${distribution.shopping.pct}% | Display/Video ${distribution.display.pct}%`,
      data: { distribution, assetGroups, totalEstimatedSpend: Number(totalEstimated.toFixed(2)), campaignId: campaignId ?? "all_pmax" },
    };
  } catch (err) {
    logger.error({ err }, "googleAds_getPMaxNetworkDistribution error");
    return { success: false, message: String(err) };
  }
}

// ─── Phase 3: Vertex Vision Creative Autopsy ─────────────────────────────────

export async function gemini_analyzeCreatives(
  ai: import("../lib/vertex-client").GoogleGenAI,
  model: string,
  creatives: Array<{ url: string; platform: string; adId: string; clicks?: number; conversions?: number; ctr?: number; spend?: number }>,
): Promise<ExecutionResult> {
  try {
    const analysisList: Array<Record<string, unknown>> = [];

    for (const creative of creatives.slice(0, 6)) {
      let imageData: string | null = null;
      let mimeType = "image/jpeg";
      try {
        const imgResp = await fetch(creative.url);
        if (imgResp.ok) {
          const contentType = imgResp.headers.get("content-type") ?? "image/jpeg";
          mimeType = contentType.split(";")[0].trim();
          const buffer = await imgResp.arrayBuffer();
          imageData = Buffer.from(buffer).toString("base64");
        }
      } catch { /* skip if image unavailable */ }

      const prompt = `You are a Creative Intelligence AI specializing in e-commerce ad performance. Analyze this ad creative image and return a JSON object with exactly these fields:
{
  "primarySubject": "main visual element (e.g., product only, lifestyle, human face, outdoor scene)",
  "colorPalette": ["dominant color hex or name", ...],
  "hasTextOverlay": true/false,
  "textContent": "extracted text from overlay if any",
  "hasHumanFace": true/false,
  "visualMood": "energetic/calm/luxury/playful/urgent/minimal",
  "productVisibility": "prominent/secondary/absent",
  "visualComplexity": "simple/moderate/complex",
  "keyEntities": ["detected objects/concepts", ...],
  "ctrPrediction": "high/medium/low based on visual best practices",
  "insight": "one actionable sentence about this creative's likely performance"
}
Ad context: Platform=${creative.platform}, CTR=${creative.ctr ?? "unknown"}%, Conversions=${creative.conversions ?? "unknown"}`;

      const parts = imageData
        ? [{ inlineData: { mimeType, data: imageData } }, { text: prompt }]
        : [{ text: `${prompt}\n\n[Image unavailable — analyze based on URL: ${creative.url}]` }];

      const result = await ai.models.generateContent({ model, contents: [{ role: "user", parts }] });
      const text = result.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      let analysis: Record<string, unknown> = {};
      if (jsonMatch) { try { analysis = JSON.parse(jsonMatch[0]); } catch { analysis = { insight: text }; } }

      analysisList.push({
        adId: creative.adId,
        platform: creative.platform,
        url: creative.url,
        metrics: { ctr: creative.ctr, conversions: creative.conversions, spend: creative.spend, clicks: creative.clicks },
        analysis,
      });
    }

    // Cross-correlate visual tags with performance
    const withCTR = analysisList.filter((c) => (c.metrics as { ctr?: number }).ctr != null);
    const highCTR = withCTR.filter((c) => (c.metrics as { ctr: number }).ctr > (withCTR.reduce((s, x) => s + (x.metrics as { ctr: number }).ctr, 0) / withCTR.length));
    const lowCTR = withCTR.filter((c) => (c.metrics as { ctr: number }).ctr <= (withCTR.reduce((s, x) => s + (x.metrics as { ctr: number }).ctr, 0) / withCTR.length));

    const correlations: string[] = [];
    if (highCTR.length && lowCTR.length) {
      const highHasOverlay = highCTR.filter((c) => (c.analysis as { hasTextOverlay?: boolean }).hasTextOverlay).length / highCTR.length;
      const lowHasOverlay = lowCTR.filter((c) => (c.analysis as { hasTextOverlay?: boolean }).hasTextOverlay).length / lowCTR.length;
      if (highHasOverlay > 0.6 && lowHasOverlay < 0.4) correlations.push("Ads with text overlays show significantly higher CTR. Prioritize text overlays in new creatives.");
      else if (lowHasOverlay > 0.6 && highHasOverlay < 0.4) correlations.push("Clean image ads (no text overlay) are outperforming text overlay variants. Reduce overlay usage.");

      const highHasFace = highCTR.filter((c) => (c.analysis as { hasHumanFace?: boolean }).hasHumanFace).length / highCTR.length;
      if (highHasFace > 0.5) correlations.push("Creatives featuring human faces correlate with above-average CTR. Test more lifestyle/people-focused imagery.");

      const highSimple = highCTR.filter((c) => (c.analysis as { visualComplexity?: string }).visualComplexity === "simple").length / highCTR.length;
      if (highSimple > 0.6) correlations.push("Simple, minimal compositions outperform complex visuals. Favor clean product shots.");
    }

    return {
      success: true,
      message: `Creative Autopsy complete: ${analysisList.length} creatives analyzed. ${correlations.length} performance correlations found.`,
      data: { creatives: analysisList, correlations, analyzedCount: analysisList.length },
    };
  } catch (err) {
    logger.error({ err }, "gemini_analyzeCreatives error");
    return { success: false, message: String(err) };
  }
}

// ─── Phase 4: Ad Copy Factory ─────────────────────────────────────────────────

export async function gemini_generateAdCopyMatrix(
  ai: import("../lib/vertex-client").GoogleGenAI,
  model: string,
  context: {
    platform: "meta" | "google_ads" | "both";
    productName: string;
    productDescription?: string;
    targetAudience?: string;
    usp?: string;
    tone?: string;
    hookCount?: number;
    descriptionCount?: number;
  },
): Promise<ExecutionResult> {
  try {
    const hookCount = context.hookCount ?? 5;
    const descCount = context.descriptionCount ?? 3;

    const prompt = `You are a world-class direct response copywriter for e-commerce performance marketing.

Generate a ${hookCount}×${descCount} ad copy matrix for:
Product: ${context.productName}
${context.productDescription ? `Description: ${context.productDescription}` : ""}
${context.targetAudience ? `Target Audience: ${context.targetAudience}` : ""}
${context.usp ? `Unique Selling Point: ${context.usp}` : ""}
Platform: ${context.platform === "both" ? "Meta Ads + Google Ads" : context.platform === "meta" ? "Meta Ads (Facebook/Instagram)" : "Google Ads"}
Tone: ${context.tone ?? "compelling, direct-response, benefit-focused"}

Return ONLY valid JSON in this exact structure:
{
  "hooks": [
    { "id": "H1", "text": "hook/headline text", "type": "pain_point|benefit|curiosity|social_proof|urgency" }
  ],
  "descriptions": [
    { "id": "D1", "text": "body copy text", "focus": "feature|emotional|proof|value" }
  ],
  "ctas": ["Shop Now", "Learn More", "Get Yours Today"],
  "matrix": [
    { "hookId": "H1", "descriptionId": "D1", "recommendedCTA": "Shop Now", "fitScore": 95, "notes": "Best for cold audiences" }
  ],
  "topCombination": { "hookId": "H1", "descriptionId": "D1", "cta": "Shop Now", "reasoning": "why this combo wins" }
}

Generate ${hookCount} hooks and ${descCount} descriptions with ${hookCount * descCount} matrix combinations. Make every hook distinct and conversion-optimized.`;

    const result = await ai.models.generateContent({ model, contents: [{ role: "user", parts: [{ text: prompt }] }] });
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    let matrix: Record<string, unknown> = {};
    if (jsonMatch) { try { matrix = JSON.parse(jsonMatch[0]); } catch { matrix = { error: "Parse failed", raw: text.slice(0, 500) }; } }

    const hooks = (matrix.hooks as unknown[] | undefined)?.length ?? 0;
    const descriptions = (matrix.descriptions as unknown[] | undefined)?.length ?? 0;

    return {
      success: true,
      message: `Ad Copy Matrix generated: ${hooks} hooks × ${descriptions} descriptions = ${hooks * descriptions} combinations for ${context.platform}`,
      data: { ...matrix, platform: context.platform, productName: context.productName },
    };
  } catch (err) {
    logger.error({ err }, "gemini_generateAdCopyMatrix error");
    return { success: false, message: String(err) };
  }
}

// ─── Phase 4: Shopify Page/Article Write Tools ────────────────────────────────

export async function shopify_updatePageContent(
  credentials: Record<string, string>,
  pageId: string,
  title?: string,
  bodyHtml?: string,
  published?: boolean,
  metaTitle?: string,
  metaDescription?: string,
): Promise<ExecutionResult> {
  const { baseUrl, headers } = shopifyBase(credentials);
  const page: Record<string, unknown> = {};
  if (title) page.title = title;
  if (bodyHtml) page.body_html = bodyHtml;
  if (published !== undefined) page.published = published;
  if (metaTitle) page.metafields = [{ namespace: "global", key: "title_tag", value: metaTitle, type: "single_line_text_field" }];

  try {
    const resp = await fetch(`${baseUrl}/admin/api/2024-01/pages/${pageId}.json`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ page }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { errors?: unknown };
      return { success: false, message: `Shopify Page error: ${JSON.stringify(err.errors ?? resp.statusText)}` };
    }
    const json = await resp.json() as { page?: { id?: number; title?: string; handle?: string } };
    return { success: true, message: `Page "${json.page?.title}" updated successfully (ID: ${json.page?.id})`, data: { pageId: json.page?.id, handle: json.page?.handle } };
  } catch (err) {
    logger.error({ err }, "shopify_updatePageContent error");
    return { success: false, message: String(err) };
  }
}

export async function shopify_getPages(
  credentials: Record<string, string>,
  limit?: number,
): Promise<ExecutionResult> {
  const { baseUrl, headers } = shopifyBase(credentials);
  try {
    const resp = await fetch(`${baseUrl}/admin/api/2024-01/pages.json?limit=${limit ?? 25}&fields=id,title,handle,published_at,updated_at`, { headers });
    if (!resp.ok) return { success: false, message: `Shopify Pages error: ${resp.statusText}` };
    const json = await resp.json() as { pages?: Array<{ id: number; title?: string; handle?: string; published_at?: string | null }> };
    const pages = (json.pages ?? []).map((p) => ({ id: p.id, title: p.title, handle: p.handle, published: !!p.published_at }));
    return { success: true, message: `Found ${pages.length} Shopify pages`, data: { pages } };
  } catch (err) {
    logger.error({ err }, "shopify_getPages error");
    return { success: false, message: String(err) };
  }
}

export async function shopify_getBlogs(credentials: Record<string, string>): Promise<ExecutionResult> {
  const { baseUrl, headers } = shopifyBase(credentials);
  try {
    const resp = await fetch(`${baseUrl}/admin/api/2024-01/blogs.json?fields=id,title,handle`, { headers });
    if (!resp.ok) return { success: false, message: `Shopify Blogs error: ${resp.statusText}` };
    const json = await resp.json() as { blogs?: Array<{ id: number; title?: string; handle?: string }> };
    return { success: true, message: `Found ${(json.blogs ?? []).length} blogs`, data: { blogs: json.blogs ?? [] } };
  } catch (err) {
    logger.error({ err }, "shopify_getBlogs error");
    return { success: false, message: String(err) };
  }
}

export async function shopify_getProductsByStatus(
  credentials: Record<string, string>,
  status: "active" | "draft" | "archived" | "any" = "any",
): Promise<ExecutionResult> {
  const { baseUrl, headers } = shopifyBase(credentials);
  const statusParam = status === "any" ? "" : `&status=${status}`;
  try {
    logger.info({ status }, "Fetching Shopify products by status");
    const resp = await fetch(`${baseUrl}/admin/api/2024-01/products.json?limit=250${statusParam}&fields=id,title,status,variants`, { headers });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { errors?: unknown };
      return { success: false, message: `Shopify API error: ${JSON.stringify(err.errors ?? resp.statusText)}` };
    }
    const json = await resp.json() as { products?: Array<{ id: number; title?: string; status?: string; variants?: Array<unknown> }> };
    const products = (json.products ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      variants: (p.variants ?? []).length,
    }));
    logger.info({ count: products.length, status }, "Fetched Shopify products");
    return {
      success: true,
      message: `Fetched ${products.length} products with status "${status}".`,
      data: { total_count: products.length, filter_applied: status, products },
    };
  } catch (err) {
    logger.error({ err }, "shopify_getProductsByStatus error");
    return { success: false, message: String(err) };
  }
}

// ─── Phase 5: Vertical Ontology Engine ───────────────────────────────────────

export async function shopify_catalogSweep(
  credentials: Record<string, string>,
  ai: import("../lib/vertex-client").GoogleGenAI,
  model: string,
  sampleSize?: number,
): Promise<ExecutionResult> {
  const { baseUrl, headers } = shopifyBase(credentials);
  try {
    const resp = await fetch(`${baseUrl}/admin/api/2024-01/products.json?limit=${sampleSize ?? 20}&fields=id,title,product_type,vendor,tags,body_html,variants`, { headers });
    if (!resp.ok) return { success: false, message: `Shopify Catalog error: ${resp.statusText}` };
    const json = await resp.json() as { products?: Array<{ id: number; title?: string; product_type?: string; vendor?: string; tags?: string; body_html?: string; variants?: Array<{ price?: string }> }> };
    const products = json.products ?? [];
    if (!products.length) return { success: false, message: "No products found in catalog." };

    const productSummary = products.slice(0, 20).map((p) => ({
      id: p.id,
      title: p.title,
      type: p.product_type,
      vendor: p.vendor,
      tags: p.tags?.slice(0, 100),
      priceRange: p.variants ? `$${Math.min(...p.variants.map((v) => Number(v.price ?? 0))).toFixed(2)} - $${Math.max(...p.variants.map((v) => Number(v.price ?? 0))).toFixed(2)}` : "unknown",
    }));

    const prompt = `You are an e-commerce vertical classification expert. Analyze this product catalog sample and return a JSON object:
{
  "detectedVertical": "e.g., Fitness Apparel, Pet Supplements, Home Decor, SaaS Tools, Skincare",
  "confidence": 0-100,
  "buyerPersona": "1-sentence description of the primary buyer",
  "averageOrderValue": "estimated AOV range",
  "purchaseFrequency": "one-time|occasional|recurring|subscription",
  "criticalBuyingAttributes": [
    { "attribute": "specific attribute name", "description": "why buyers care about this", "metafieldKey": "snake_case_key", "type": "single_line_text_field|multi_line_text_field|number_decimal|boolean|list.single_line_text_field" }
  ],
  "contentOpportunities": ["SEO topic 1", "SEO topic 2", "SEO topic 3"],
  "brandVoice": "professional|playful|scientific|luxury|accessible",
  "complianceFlags": ["any regulatory considerations for this vertical"]
}

Identify 5-8 niche-specific attributes that sophisticated buyers evaluate (e.g., for supplements: ingredient sourcing, certification, dosage; for fashion: material composition, fit, care instructions).

Catalog sample (${products.length} products):
${JSON.stringify(productSummary, null, 2)}`;

    const result = await ai.models.generateContent({ model, contents: [{ role: "user", parts: [{ text: prompt }] }] });
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    let ontology: Record<string, unknown> = {};
    if (jsonMatch) { try { ontology = JSON.parse(jsonMatch[0]); } catch { ontology = { detectedVertical: "General E-Commerce", criticalBuyingAttributes: [] }; } }

    return {
      success: true,
      message: `Catalog Sweep complete: Detected vertical "${ontology.detectedVertical}" (${ontology.confidence}% confidence). ${(ontology.criticalBuyingAttributes as unknown[] | undefined)?.length ?? 0} ontology attributes recommended.`,
      data: { ontology, productCount: products.length, sampleProducts: productSummary },
    };
  } catch (err) {
    logger.error({ err }, "shopify_catalogSweep error");
    return { success: false, message: String(err) };
  }
}

export async function shopify_createMetafieldDefinitions(
  credentials: Record<string, string>,
  definitions: Array<{ name: string; key: string; description?: string; type: string; namespace?: string }>,
): Promise<ExecutionResult> {
  const { baseUrl } = shopifyBase(credentials);
  const graphqlUrl = `${baseUrl}/admin/api/2024-01/graphql.json`;
  const gqlHeaders = {
    "X-Shopify-Access-Token": credentials.accessToken,
    "Content-Type": "application/json",
  };

  const results: Array<{ key: string; success: boolean; message: string }> = [];
  for (const def of definitions.slice(0, 10)) {
    const mutation = `mutation {
      metafieldDefinitionCreate(definition: {
        name: "${def.name.replace(/"/g, '\\"')}",
        namespace: "${(def.namespace ?? "custom").replace(/"/g, '\\"')}",
        key: "${def.key.replace(/"/g, '\\"')}",
        type: "${def.type}",
        ownerType: PRODUCT
        ${def.description ? `, description: "${def.description.replace(/"/g, '\\"')}"` : ""}
      }) {
        createdDefinition { id name key }
        userErrors { field message }
      }
    }`;

    try {
      const resp = await fetch(graphqlUrl, { method: "POST", headers: gqlHeaders, body: JSON.stringify({ query: mutation }) });
      const json = await resp.json() as { data?: { metafieldDefinitionCreate?: { createdDefinition?: { id?: string }; userErrors?: Array<{ message: string }> } }; errors?: Array<{ message: string }> };
      const errors = json.data?.metafieldDefinitionCreate?.userErrors ?? [];
      if (errors.length > 0 && !errors.some((e) => e.message.includes("already"))) {
        results.push({ key: def.key, success: false, message: errors.map((e) => e.message).join(", ") });
      } else {
        results.push({ key: def.key, success: true, message: `Metafield definition "${def.name}" (${def.key}) created` });
      }
    } catch (err) {
      results.push({ key: def.key, success: false, message: String(err) });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  return {
    success: succeeded > 0,
    message: `Created ${succeeded}/${definitions.length} metafield definitions on Shopify products`,
    data: { results },
  };
}

export async function shopify_getMetafieldDefinitions(
  credentials: Record<string, string>,
): Promise<ExecutionResult> {
  const { baseUrl } = shopifyBase(credentials);
  const graphqlUrl = `${baseUrl}/admin/api/2024-01/graphql.json`;
  const gqlHeaders = {
    "X-Shopify-Access-Token": credentials.accessToken,
    "Content-Type": "application/json",
  };

  const query = `{
    metafieldDefinitions(first: 250, ownerType: PRODUCT) {
      edges {
        node {
          id
          name
          namespace
          key
          type { name }
        }
      }
    }
  }`;

  try {
    logger.info("Fetching existing Shopify product metafield definitions via GraphQL");
    const resp = await fetch(graphqlUrl, {
      method: "POST",
      headers: gqlHeaders,
      body: JSON.stringify({ query }),
    });

    const json = await resp.json() as {
      data?: {
        metafieldDefinitions?: {
          edges: Array<{
            node: { id: string; name: string; namespace: string; key: string; type: { name: string } };
          }>;
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (json.errors?.length) {
      return { success: false, message: `GraphQL errors: ${json.errors.map((e) => e.message).join(", ")}` };
    }

    const definitions = (json.data?.metafieldDefinitions?.edges ?? []).map((edge) => ({
      name: edge.node.name,
      namespace: edge.node.namespace,
      key: edge.node.key,
      type: edge.node.type.name,
    }));

    logger.info({ count: definitions.length }, "Fetched metafield definitions");
    return {
      success: true,
      message: `Registry contains ${definitions.length} product metafield definition(s).`,
      data: { total_count: definitions.length, definitions },
    };
  } catch (err) {
    logger.error({ err }, "shopify_getMetafieldDefinitions error");
    return { success: false, message: String(err) };
  }
}

export async function shopify_updateThemeColors(
  credentials: Record<string, string>,
  primaryColor: string,
  secondaryColor?: string,
): Promise<ExecutionResult> {
  const { baseUrl, headers } = shopifyBase(credentials);
  const restHeaders = { ...headers, "Content-Type": "application/json" };

  try {
    logger.info({ primaryColor, secondaryColor }, "Updating Shopify theme colors");

    // Step 1: get the active (main) theme ID
    const themesResp = await fetch(`${baseUrl}/admin/api/2024-01/themes.json?role=main`, { headers: restHeaders });
    if (!themesResp.ok) return { success: false, message: `Failed to fetch themes: ${themesResp.statusText}` };
    const { themes } = await themesResp.json() as { themes: Array<{ id: number; role: string }> };
    const mainTheme = themes.find((t) => t.role === "main");
    if (!mainTheme) return { success: false, message: "No main/active theme found on this store." };

    const themeId = mainTheme.id;
    const assetUrl = `${baseUrl}/admin/api/2024-01/themes/${themeId}/assets.json?asset[key]=config/settings_data.json`;

    // Step 2: fetch existing settings_data.json
    const assetResp = await fetch(assetUrl, { headers: restHeaders });
    if (!assetResp.ok) return { success: false, message: `Failed to fetch theme asset: ${assetResp.statusText}` };
    const assetJson = await assetResp.json() as { asset?: { value?: string } };
    const rawValue = assetJson.asset?.value;
    if (!rawValue) return { success: false, message: "settings_data.json asset has no value." };

    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(rawValue) as Record<string, unknown>;
    } catch {
      return { success: false, message: "Failed to parse settings_data.json — file may be malformed." };
    }

    // Step 3: safely merge only color keys into the current section
    const current = (settings as { current?: Record<string, unknown> }).current ?? {};
    if (primaryColor) current["color_primary"] = primaryColor;
    if (secondaryColor) current["color_secondary"] = secondaryColor;
    (settings as { current?: Record<string, unknown> }).current = current;

    // Step 4: write back
    const putResp = await fetch(`${baseUrl}/admin/api/2024-01/themes/${themeId}/assets.json`, {
      method: "PUT",
      headers: restHeaders,
      body: JSON.stringify({ asset: { key: "config/settings_data.json", value: JSON.stringify(settings, null, 2) } }),
    });

    if (!putResp.ok) {
      const err = await putResp.json().catch(() => ({})) as { errors?: unknown };
      return { success: false, message: `Theme update failed: ${JSON.stringify(err.errors ?? putResp.statusText)}` };
    }

    logger.info({ themeId, primaryColor, secondaryColor }, "Theme colors updated");
    const applied: Record<string, string> = {};
    if (primaryColor) applied.color_primary = primaryColor;
    if (secondaryColor) applied.color_secondary = secondaryColor;
    return {
      success: true,
      message: `Theme ${themeId} updated — ${Object.keys(applied).join(", ")} merged into settings_data.json.`,
      data: { themeId, applied },
    };
  } catch (err) {
    logger.error({ err }, "shopify_updateThemeColors error");
    return { success: false, message: String(err) };
  }
}

// ─── Phase 6: Compliance Engine ───────────────────────────────────────────────

export async function compliance_auditDestinationUrl(
  url: string,
  adCopy: string,
  ai: import("../lib/vertex-client").GoogleGenAI,
  model: string,
): Promise<ExecutionResult> {
  try {
    // Fetch landing page content (lightweight — no headless browser needed for basic compliance)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const pageResp = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GrowthOS-Compliance-Scanner/1.0)" },
    }).finally(() => clearTimeout(timeout));

    let pageText = "";
    let pageHtml = "";
    if (pageResp.ok) {
      pageHtml = await pageResp.text();
      // Strip HTML tags to get readable text
      pageText = pageHtml
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 5000);
    }

    // Check for trust pages
    const hasPrivacyPolicy = /privacy.policy|privacy-policy|datenschutz/i.test(pageHtml);
    const hasTerms = /terms.of.service|terms-of-service|terms.and.conditions/i.test(pageHtml);
    const hasRefundPolicy = /refund.policy|return.policy|cancellation.policy/i.test(pageHtml);
    const hasContactInfo = /contact.us|contact-us|mailto:|tel:|phone/i.test(pageHtml);
    const hasInterstitial = /(popup|modal|overlay|interstitial).*(close|dismiss|exit)/i.test(pageHtml);

    // AI-powered compliance check
    const prompt = `You are a digital advertising compliance expert reviewing an ad + landing page combination against Google Ads, Meta, and GMC policies.

Ad Copy being audited:
"${adCopy.slice(0, 500)}"

Landing Page URL: ${url}
Landing Page Content (excerpt):
"${pageText.slice(0, 2000)}"

Trust signals detected:
- Privacy Policy link present: ${hasPrivacyPolicy}
- Terms of Service present: ${hasTerms}
- Refund Policy present: ${hasRefundPolicy}
- Contact information present: ${hasContactInfo}
- Potential interstitial/popup: ${hasInterstitial}

Return a JSON compliance report:
{
  "overallRisk": "low|medium|high|critical",
  "violations": [
    { "type": "mismatched_claims|prohibited_content|ux_violation|missing_trust_page|exaggerated_claims", "severity": "warning|error|critical", "description": "specific issue", "policy": "Google/Meta/GMC policy reference", "fix": "actionable fix suggestion" }
  ],
  "trustPageAudit": { "privacyPolicy": true/false, "terms": true/false, "refundPolicy": true/false, "contact": true/false },
  "pricingConsistency": "consistent|discrepancy_detected|unable_to_verify",
  "prohibitedKeywords": ["any restricted words found"],
  "approvalRecommendation": "approve|approve_with_warnings|block",
  "autoFixAvailable": ["list of issues that can be auto-fixed via Shopify API"]
}`;

    const result = await ai.models.generateContent({ model, contents: [{ role: "user", parts: [{ text: prompt }] }] });
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    let report: Record<string, unknown> = { overallRisk: "unknown", violations: [] };
    if (jsonMatch) { try { report = JSON.parse(jsonMatch[0]); } catch { /* keep default */ } }

    const violations = (report.violations as Array<{ severity: string }> | undefined) ?? [];
    const critical = violations.filter((v) => v.severity === "critical").length;
    const errors = violations.filter((v) => v.severity === "error").length;

    return {
      success: report.overallRisk !== "critical" && critical === 0,
      message: `Compliance Audit for ${url}: Risk=${report.overallRisk?.toString().toUpperCase()} | ${critical} critical, ${errors} error(s), ${violations.length - critical - errors} warning(s)`,
      data: { url, report, rawChecks: { hasPrivacyPolicy, hasTerms, hasRefundPolicy, hasContactInfo, hasInterstitial } },
    };
  } catch (err) {
    logger.error({ err }, "compliance_auditDestinationUrl error");
    return { success: false, message: `Compliance scan failed: ${String(err)}` };
  }
}

// ─── Store-Wide Inventory Health (used by master diagnostic sweep) ────────────

export async function shopify_getStoreInventoryHealth(
  credentials: Record<string, string>,
): Promise<ExecutionResult> {
  const { baseUrl, headers } = shopifyBase(credentials);
  try {
    logger.info("Fetching store-wide inventory health");

    type ShopifyVariant = { id: number; title: string; inventory_quantity: number; inventory_management: string | null };
    type ShopifyProduct = { id: number; title: string; status: string; variants: ShopifyVariant[] };

    const products = await shopifyFetchAllPages<ShopifyProduct>(
      `${baseUrl}/admin/api/2024-01/products.json?limit=250&status=active&fields=id,title,status,variants`,
      headers,
      (json) => {
        const j = json as { products?: ShopifyProduct[] };
        return j.products ?? [];
      },
    );

    if (!products.length) {
      return { success: false, message: "No active products found in Shopify store." };
    }

    let totalVariants = 0;
    let outOfStock = 0;
    let lowStock = 0;
    let healthy = 0;
    let totalInventory = 0;
    const outOfStockItems: string[] = [];
    const lowStockItems: string[] = [];

    for (const product of products) {
      for (const variant of product.variants) {
        if (variant.inventory_management !== "shopify") continue;
        totalVariants++;
        const qty = variant.inventory_quantity ?? 0;
        totalInventory += qty;
        if (qty <= 0) {
          outOfStock++;
          if (outOfStockItems.length < 5) outOfStockItems.push(`"${product.title}" (${variant.title})`);
        } else if (qty <= 5) {
          lowStock++;
          if (lowStockItems.length < 5) lowStockItems.push(`"${product.title}" (${variant.title}): ${qty} left`);
        } else {
          healthy++;
        }
      }
    }

    const oosRate = totalVariants > 0 ? ((outOfStock / totalVariants) * 100).toFixed(1) : "0";
    const statusLine = outOfStock > 0
      ? `⚠ ${outOfStock} OOS, ${lowStock} low-stock, ${healthy} healthy across ${totalVariants} tracked variants`
      : `✓ All ${totalVariants} tracked variants in stock (${lowStock} low-stock)`;

    return {
      success: outOfStock === 0,
      message: `Store inventory: ${totalInventory} total units | ${statusLine} | OOS rate: ${oosRate}%`,
      data: {
        total_products: products.length,
        total_tracked_variants: totalVariants,
        total_inventory_units: totalInventory,
        out_of_stock_count: outOfStock,
        low_stock_count: lowStock,
        healthy_count: healthy,
        oos_rate_percent: parseFloat(oosRate),
        out_of_stock_sample: outOfStockItems,
        low_stock_sample: lowStockItems,
      },
    };
  } catch (err) {
    logger.error({ err }, "shopify_getStoreInventoryHealth error");
    return { success: false, message: `Inventory health check failed: ${String(err)}` };
  }
}

// ─── Store-Wide Revenue Snapshot (used by master diagnostic sweep) ─────────────

export async function shopify_getStoreRevenueSummary(
  credentials: Record<string, string>,
): Promise<ExecutionResult> {
  const { baseUrl, headers } = shopifyBase(credentials);
  try {
    logger.info("Fetching store revenue summary");

    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const since7d  = new Date(Date.now() -  7 * 24 * 60 * 60 * 1000).toISOString();

    type Order = { id: number; total_price: string; created_at: string };

    const [orders30d, orders7d] = await Promise.all([
      shopifyFetchAllPages<Order>(
        `${baseUrl}/admin/api/2024-01/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(since30d)}&fields=id,total_price,created_at`,
        headers,
        (json) => { const j = json as { orders?: Order[] }; return j.orders ?? []; },
      ),
      shopifyFetchAllPages<Order>(
        `${baseUrl}/admin/api/2024-01/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(since7d)}&fields=id,total_price,created_at`,
        headers,
        (json) => { const j = json as { orders?: Order[] }; return j.orders ?? []; },
      ),
    ]);

    const rev30d = orders30d.reduce((s, o) => s + parseFloat(o.total_price ?? "0"), 0);
    const rev7d  = orders7d.reduce((s, o) => s + parseFloat(o.total_price ?? "0"), 0);
    const aov30d = orders30d.length > 0 ? rev30d / orders30d.length : 0;

    return {
      success: true,
      message: `Revenue: $${rev30d.toFixed(2)} (30d, ${orders30d.length} orders) | $${rev7d.toFixed(2)} (7d, ${orders7d.length} orders) | AOV: $${aov30d.toFixed(2)}`,
      data: {
        revenue_30d: parseFloat(rev30d.toFixed(2)),
        revenue_7d: parseFloat(rev7d.toFixed(2)),
        orders_30d: orders30d.length,
        orders_7d: orders7d.length,
        avg_order_value_30d: parseFloat(aov30d.toFixed(2)),
      },
    };
  } catch (err) {
    logger.error({ err }, "shopify_getStoreRevenueSummary error");
    return { success: false, message: `Revenue summary failed: ${String(err)}` };
  }
}

// ─── Intelligence Module 1: Sales Velocity & Stockout Predictor ───────────────

export async function shopify_calculateSalesVelocity(
  credentials: Record<string, string>,
  productId: string,
): Promise<ExecutionResult> {
  const { baseUrl, headers } = shopifyBase(credentials);
  try {
    logger.info({ productId }, "Calculating sales velocity");

    // Fetch product variants to get current inventory
    const productResp = await fetchWithBackoff(`${baseUrl}/admin/api/2024-01/products/${productId}.json?fields=id,title,handle,variants`, { headers, tag: "shopify-product-variants" });
    if (!productResp.ok) return { success: false, message: `Product not found: ${productResp.statusText}` };
    const { product } = await productResp.json() as { product?: { id: number; title: string; handle: string; variants: Array<{ id: number; inventory_quantity: number; title: string }> } };
    if (!product) return { success: false, message: `Product ${productId} not found.` };

    const totalInventory = product.variants.reduce((sum, v) => sum + (v.inventory_quantity ?? 0), 0);

    // Fetch ALL orders from the last 7 days using cursor pagination
    // High-volume stores (500+ orders/day) will exceed the 250-item REST limit
    // without pagination, producing silently incorrect velocity numbers.
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const firstOrdersUrl = `${baseUrl}/admin/api/2024-01/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(since)}&fields=id,line_items`;

    let orders: Array<{ id: number; line_items: Array<{ product_id: number; quantity: number }> }>;
    try {
      orders = await shopifyFetchAllPages<{ id: number; line_items: Array<{ product_id: number; quantity: number }> }>(
        firstOrdersUrl,
        headers,
        (json) => {
          const j = json as { orders?: Array<{ id: number; line_items: Array<{ product_id: number; quantity: number }> }> };
          return j.orders ?? [];
        },
      );
    } catch (pageErr) {
      return { success: false, message: `Orders pagination failed: ${String(pageErr)}` };
    }

    const unitsSold = orders.reduce((sum, order) =>
      sum + order.line_items
        .filter((li) => String(li.product_id) === String(productId))
        .reduce((s, li) => s + (li.quantity ?? 0), 0),
    0);

    const dailyRunRate = unitsSold / 7;
    const estimatedDaysToStockout = dailyRunRate > 0 ? Math.floor(totalInventory / dailyRunRate) : null;

    logger.info({ productId, totalInventory, unitsSold, dailyRunRate, estimatedDaysToStockout }, "Sales velocity calculated");
    return {
      success: true,
      message: estimatedDaysToStockout !== null
        ? `"${product.title}": ${totalInventory} units on hand. Selling ${dailyRunRate.toFixed(1)} units/day (7-day avg). Stockout in ~${estimatedDaysToStockout} days.`
        : `"${product.title}": ${totalInventory} units on hand. No sales recorded in the last 7 days — velocity is zero.`,
      data: {
        product_id: productId,
        product_title: product.title,
        total_inventory: totalInventory,
        units_sold_last_7_days: unitsSold,
        daily_run_rate: parseFloat(dailyRunRate.toFixed(2)),
        estimated_days_to_stockout: estimatedDaysToStockout,
        stockout_risk: estimatedDaysToStockout !== null
          ? (estimatedDaysToStockout <= 7 ? "CRITICAL" : estimatedDaysToStockout <= 21 ? "HIGH" : "LOW")
          : "NONE",
      },
    };
  } catch (err) {
    logger.error({ err }, "shopify_calculateSalesVelocity error");
    return { success: false, message: String(err) };
  }
}

// ─── Intelligence Module 2: Automated Liquidation Discount ────────────────────

export async function shopify_createLiquidationDiscount(
  credentials: Record<string, string>,
  productId: string,
  discountPercentage: number,
): Promise<ExecutionResult> {
  const { baseUrl, headers } = shopifyBase(credentials);
  const restHeaders = { ...headers, "Content-Type": "application/json" };
  try {
    logger.info({ productId, discountPercentage }, "Creating liquidation discount");

    const code = `LIQUIDATE-${discountPercentage}-${Date.now().toString(36).toUpperCase()}`;
    const startsAt = new Date().toISOString();

    // Create price rule
    const priceRuleBody = {
      price_rule: {
        title: `Liquidation ${discountPercentage}% — Product ${productId}`,
        value_type: "percentage",
        value: `-${discountPercentage}`,
        customer_selection: "all",
        target_type: "line_item",
        target_selection: "entitled",
        allocation_method: "each",
        starts_at: startsAt,
        entitled_product_ids: [parseInt(productId, 10)],
        once_per_customer: false,
        usage_limit: null,
      },
    };

    const ruleResp = await fetch(`${baseUrl}/admin/api/2024-01/price_rules.json`, {
      method: "POST",
      headers: restHeaders,
      body: JSON.stringify(priceRuleBody),
    });

    if (!ruleResp.ok) {
      const err = await ruleResp.json().catch(() => ({})) as { errors?: unknown };
      return { success: false, message: `Price rule creation failed: ${JSON.stringify(err.errors ?? ruleResp.statusText)}` };
    }

    const { price_rule } = await ruleResp.json() as { price_rule: { id: number } };

    // Create discount code
    const codeResp = await fetch(`${baseUrl}/admin/api/2024-01/price_rules/${price_rule.id}/discount_codes.json`, {
      method: "POST",
      headers: restHeaders,
      body: JSON.stringify({ discount_code: { code } }),
    });

    if (!codeResp.ok) {
      const err = await codeResp.json().catch(() => ({})) as { errors?: unknown };
      return { success: false, message: `Discount code creation failed: ${JSON.stringify(err.errors ?? codeResp.statusText)}` };
    }

    const { discount_code } = await codeResp.json() as { discount_code: { id: number; code: string } };

    logger.info({ productId, discountPercentage, code: discount_code.code, priceRuleId: price_rule.id }, "Liquidation discount created");
    return {
      success: true,
      message: `Liquidation discount created: ${discount_code.code} (${discountPercentage}% off product ${productId})`,
      data: {
        discount_code: discount_code.code,
        price_rule_id: price_rule.id,
        discount_percentage: discountPercentage,
        product_id: productId,
      },
    };
  } catch (err) {
    logger.error({ err }, "shopify_createLiquidationDiscount error");
    return { success: false, message: String(err) };
  }
}

// ─── Intelligence Module 3: Product-Level Compliance Scanner ─────────────────

export async function shopify_scanCompliancePolicy(
  credentials: Record<string, string>,
  productId: string,
  adCopyText: string,
  ai: import("../lib/vertex-client").GoogleGenAI,
  model: string,
): Promise<ExecutionResult> {
  const { baseUrl, headers } = shopifyBase(credentials);
  try {
    logger.info({ productId }, "Scanning compliance for product");

    // Get product to derive the storefront URL and title
    const productResp = await fetch(`${baseUrl}/admin/api/2024-01/products/${productId}.json?fields=id,title,handle,body_html`, { headers });
    if (!productResp.ok) return { success: false, message: `Product not found: ${productResp.statusText}` };
    const { product } = await productResp.json() as { product?: { id: number; title: string; handle: string; body_html: string } };
    if (!product) return { success: false, message: `Product ${productId} not found.` };

    const storeDomain = (baseUrl).replace("https://", "");
    const productUrl = `https://${storeDomain}/products/${product.handle}`;
    const productText = (product.body_html ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3000);

    // Delegate to Vertex AI for semantic compliance check
    const prompt = `You are a Google Ads and Meta Ads compliance auditor.

Product: "${product.title}"
Product URL: ${productUrl}
Product Description: ${productText.slice(0, 1000)}
Ad Copy Under Review: "${adCopyText}"

Audit this product ad for the following violations:
1. Price mismatches (ad claims price not shown on product page)
2. Prohibited health/medical/financial claims
3. Superlative or unsubstantiated claims ("best", "#1", "guaranteed")
4. Missing required disclosures (limited-time offers, disclaimers)
5. Misleading before/after claims or miracle results

Return a JSON object with this exact shape:
{
  "overall_risk": "low" | "medium" | "high" | "critical",
  "violations": [{"severity": "critical|error|warning", "rule": "rule name", "detail": "specific issue found"}],
  "auto_fixes": ["Suggested fix 1", "Suggested fix 2"],
  "compliant_ad_copy": "A rewritten version of the ad copy that passes all checks"
}`;

    const result = await ai.models.generateContent({ model, contents: [{ role: "user", parts: [{ text: prompt }] }] });
    const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const report = jsonMatch ? JSON.parse(jsonMatch[0]) as Record<string, unknown> : { overall_risk: "unknown", violations: [] };

    const violations = (report.violations as Array<{ severity: string }> ?? []);
    const criticalCount = violations.filter((v) => v.severity === "critical").length;

    return {
      success: criticalCount === 0,
      message: `Compliance scan for "${product.title}": Risk=${String(report.overall_risk).toUpperCase()} | ${criticalCount} critical violation(s) found`,
      data: { product_id: productId, product_title: product.title, product_url: productUrl, report },
    };
  } catch (err) {
    logger.error({ err }, "shopify_scanCompliancePolicy error");
    return { success: false, message: String(err) };
  }
}

// ─── Intelligence Module 4: SGE / Agentic Commerce Optimizer ─────────────────

export async function shopify_optimizeProductSGE(
  credentials: Record<string, string>,
  productId: string,
  targetKeywords: string[] | undefined,
  ai: import("../lib/vertex-client").GoogleGenAI,
  model: string,
): Promise<ExecutionResult> {
  const { baseUrl, headers } = shopifyBase(credentials);
  try {
    logger.info({ productId, targetKeywords }, "Optimizing product for SGE/agentic commerce");

    const productResp = await fetch(`${baseUrl}/admin/api/2024-01/products/${productId}.json?fields=id,title,handle,body_html,tags,product_type,vendor`, { headers });
    if (!productResp.ok) return { success: false, message: `Product not found: ${productResp.statusText}` };
    const { product } = await productResp.json() as { product?: { id: number; title: string; handle: string; body_html: string; tags: string; product_type: string; vendor: string } };
    if (!product) return { success: false, message: `Product ${productId} not found.` };

    const currentDesc = (product.body_html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000);

    const keywordsStr = targetKeywords?.length ? `Target keywords: ${targetKeywords.join(", ")}` : "No specific keywords provided — infer from product data.";

    const prompt = `You are an expert in AI Search Engine Optimization (SGE) for Agentic Commerce (Google Shopping Graph, Bing Copilot, AI assistants).

Product Title: ${product.title}
Product Type: ${product.product_type}
Vendor: ${product.vendor}
Tags: ${product.tags}
${keywordsStr}

Current Description:
${currentDesc}

Your task:
1. Rewrite the product description using entity-dense, semantic HTML. Use natural language that AI search engines can extract for featured snippets. Include: use cases, compatibility, specifications, benefits, and comparison anchors.
2. Propose 5 structured metafields (namespace: "sge") that would help AI shopping agents understand this product better.

Return ONLY this JSON (no markdown):
{
  "optimized_description_html": "<p>...</p>",
  "sge_rationale": "Why this rewrite improves AI discoverability",
  "proposed_metafields": [
    { "key": "snake_case_key", "name": "Human Name", "type": "single_line_text_field", "value_example": "example" }
  ],
  "estimated_sge_lift": "e.g., +35% AI shopping impressions"
}`;

    const result = await ai.models.generateContent({ model, contents: [{ role: "user", parts: [{ text: prompt }] }] });
    const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const optimization = jsonMatch ? JSON.parse(jsonMatch[0]) as Record<string, unknown> : {};

    logger.info({ productId }, "SGE optimization complete");
    return {
      success: true,
      message: `SGE optimization complete for "${product.title}". Estimated lift: ${String(optimization.estimated_sge_lift ?? "unknown")}`,
      data: { product_id: productId, product_title: product.title, ...optimization },
    };
  } catch (err) {
    logger.error({ err }, "shopify_optimizeProductSGE error");
    return { success: false, message: String(err) };
  }
}

// ─── Ecosystem Sync: Part 1 — Defensive & Compliance Executors ───────────────

export async function googleAds_listPMaxAssetGroups(
  credentials: Record<string, string>,
  campaignId?: string,
  status?: "ENABLED" | "PAUSED" | "REMOVED",
): Promise<ExecutionResult> {
  const customerId = credentials.customerId.replace(/-/g, "");
  try {
    const whereClauses: string[] = ["campaign.advertising_channel_type = 'PERFORMANCE_MAX'"];
    if (campaignId) whereClauses.push(`campaign.id = ${Number(campaignId)}`);
    if (status)     whereClauses.push(`asset_group.status = '${status}'`);

    const gaql = `
      SELECT
        asset_group.id,
        asset_group.name,
        asset_group.status,
        asset_group.final_urls,
        campaign.id,
        campaign.name,
        campaign.status
      FROM asset_group
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY asset_group.name
      LIMIT 200
    `.trim();

    const queryResult = await gadsRunQuery(credentials, gaql);
    if (!queryResult.ok) {
      return { success: false, message: `Google Ads API error: ${queryResult.message}` };
    }

    type Row = {
      assetGroup?: { id?: string; name?: string; status?: string; finalUrls?: string[] };
      campaign?:   { id?: string; name?: string; status?: string };
    };
    const rows = (queryResult.rows as Row[]).map((r) => ({
      asset_group_id:   r.assetGroup?.id ?? "",
      asset_group_name: r.assetGroup?.name ?? "(unnamed)",
      status:           r.assetGroup?.status ?? "UNKNOWN",
      campaign_id:      r.campaign?.id ?? "",
      campaign_name:    r.campaign?.name ?? "(unnamed)",
      final_urls:       r.assetGroup?.finalUrls ?? [],
    }));

    return {
      success: true,
      message: `Found ${rows.length} PMax asset group${rows.length === 1 ? "" : "s"}.`,
      data: { asset_groups: rows, count: rows.length },
    };
  } catch (err: unknown) {
    logger.error({ err }, "googleAds_listPMaxAssetGroups error");
    return { success: false, message: String(err) };
  }
}

export async function googleAds_pausePMaxAssetGroup(
  credentials: Record<string, string>,
  assetGroupId: string,
  options: MutateExecOptions = {},
): Promise<ExecutionResult> {
  const customerId = adsCustomerId(credentials);
  try {
    const customer = customerFromCreds(credentials);
    const result = await runSingleMutate(customer, {
      entity: "asset_group",
      operation: "update",
      resource: {
        resource_name: `customers/${customerId}/assetGroups/${assetGroupId}`,
        status: enums.AssetGroupStatus.PAUSED,
      },
    }, options);
    if (!result.ok) {
      return { success: false, message: `Google Ads API error: ${failureMessage(result.failures)}`, data: { partialFailures: result.failures } };
    }
    return { success: true, message: `PMax Asset Group ${assetGroupId} paused successfully.`, data: { asset_group_id: assetGroupId, status: "PAUSED" } };
  } catch (err) {
    logger.error({ err }, "googleAds_pausePMaxAssetGroup error");
    return { success: false, message: `Google Ads API error: ${formatGoogleAdsError(err)}` };
  }
}

export async function googleAds_uploadConversionAdjustment(
  credentials: Record<string, string>,
  gclid: string,
  netProfitValue: number,
  conversionActionId: string,
  conversionDateTime: string,
  options: MutateExecOptions = {},
): Promise<ExecutionResult> {
  const customerId = adsCustomerId(credentials);
  try {
    const customer = customerFromCreds(credentials);
    const data = await customer.conversionAdjustmentUploads.uploadConversionAdjustments(
      services.UploadConversionAdjustmentsRequest.create({
        customer_id: customerId,
        conversion_adjustments: [{
          conversion_action: `customers/${customerId}/conversionActions/${conversionActionId}`,
          adjustment_type: enums.ConversionAdjustmentType.RESTATEMENT,
          gclid_date_time_pair: { gclid, conversion_date_time: conversionDateTime },
          restatement_value: { adjusted_value: netProfitValue },
        }],
        partial_failure: true,
        validate_only: !!options.validateOnly,
      }),
    );
    const failures = extractPartialFailures(data);
    if (failures.length) {
      return { success: false, message: `Google Ads API error: ${failureMessage(failures)}`, data: { partialFailures: failures } };
    }
    return {
      success: true,
      message: `POAS conversion adjustment uploaded. GCLID: ${gclid}, Net Profit: $${netProfitValue.toFixed(2)}. tROAS algorithm will re-calibrate within 24-48h.`,
      data: { gclid, net_profit_value: netProfitValue, conversion_action_id: conversionActionId, result: data },
    };
  } catch (err) {
    logger.error({ err }, "googleAds_uploadConversionAdjustment error");
    return { success: false, message: String(err) };
  }
}

export async function gmc_updateProductMetadata(
  credentials: Record<string, string>,
  productId: string,
  optimizedDescription: string,
  merchantId?: string,
): Promise<ExecutionResult> {
  const mid = merchantId ?? credentials.merchantId;
  if (!mid) return { success: false, message: "Missing GMC merchant ID. Provide merchantId in credentials or as parameter." };
  try {
    const resp = await fetchWithBackoff(
      `https://shoppingcontent.googleapis.com/content/v2.1/${mid}/products/${encodeURIComponent(productId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ description: optimizedDescription }),
        tag: "gmc-update-product",
      },
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { error?: { message?: string } };
      return { success: false, message: `GMC Content API error: ${err?.error?.message ?? resp.statusText}` };
    }
    return {
      success: true,
      message: `GMC product ${productId} updated with SGE-optimized description.`,
      data: { merchant_id: mid, product_id: productId, description_updated: true },
    };
  } catch (err) {
    logger.error({ err }, "gmc_updateProductMetadata error");
    return { success: false, message: String(err) };
  }
}

export async function gmc_auditProductMismatches(
  credentials: Record<string, string>,
  shopifyProductId: string,
  gmcProductId: string,
): Promise<ExecutionResult> {
  const mid = credentials.merchantId;
  if (!mid) return { success: false, message: "Missing GMC merchant ID in credentials." };

  const shopifyBase_ = `https://${credentials.shopifyDomain}/admin/api/2024-01`;
  const shopifyHeaders_ = { "X-Shopify-Access-Token": credentials.shopifyAccessToken, "Content-Type": "application/json" };

  try {
    const [shopifyResp, gmcResp] = await Promise.all([
      fetchWithBackoff(`${shopifyBase_}/products/${shopifyProductId}.json?fields=id,title,body_html,variants,images`, { headers: shopifyHeaders_, tag: "shopify-product-audit" }),
      fetchWithBackoff(`https://shoppingcontent.googleapis.com/content/v2.1/${mid}/products/${encodeURIComponent(gmcProductId)}`, {
        headers: { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/json" },
        tag: "gmc-product-audit",
      }),
    ]);

    if (!shopifyResp.ok) return { success: false, message: `Shopify product fetch failed: ${shopifyResp.statusText}` };
    if (!gmcResp.ok) return { success: false, message: `GMC product fetch failed: ${gmcResp.statusText}` };

    const { product: sp } = await shopifyResp.json() as { product: Record<string, unknown> };
    const gmcProduct = await gmcResp.json() as Record<string, unknown>;

    const mismatches: Array<{ field: string; shopify_value: unknown; gmc_value: unknown; severity: string }> = [];

    const spTitle = sp.title as string;
    const gmcTitle = gmcProduct.title as string;
    if (spTitle && gmcTitle && spTitle.toLowerCase() !== gmcTitle.toLowerCase()) {
      mismatches.push({ field: "title", shopify_value: spTitle, gmc_value: gmcTitle, severity: "HIGH" });
    }

    const spVariants = sp.variants as Array<{ price: string }>;
    const spPrice = spVariants?.[0]?.price;
    const gmcPrice = (gmcProduct.price as { value?: string })?.value;
    if (spPrice && gmcPrice && parseFloat(spPrice) !== parseFloat(gmcPrice)) {
      mismatches.push({ field: "price", shopify_value: spPrice, gmc_value: gmcPrice, severity: "CRITICAL" });
    }

    const spImages = sp.images as Array<{ src: string }>;
    const gmcImageLink = gmcProduct.imageLink as string;
    const spImageSrc = spImages?.[0]?.src;
    if (spImageSrc && gmcImageLink && !gmcImageLink.includes(spImageSrc.split("/").pop() ?? "")) {
      mismatches.push({ field: "image_link", shopify_value: spImageSrc, gmc_value: gmcImageLink, severity: "MEDIUM" });
    }

    logger.info({ shopifyProductId, gmcProductId, mismatchCount: mismatches.length }, "GMC audit complete");
    return {
      success: true,
      message: mismatches.length === 0
        ? `No mismatches found between Shopify ${shopifyProductId} and GMC ${gmcProductId}.`
        : `Found ${mismatches.length} mismatch(es) — ${mismatches.filter((m) => m.severity === "CRITICAL").length} critical.`,
      data: { shopify_product_id: shopifyProductId, gmc_product_id: gmcProductId, mismatches, mismatch_count: mismatches.length },
    };
  } catch (err) {
    logger.error({ err }, "gmc_auditProductMismatches error");
    return { success: false, message: String(err) };
  }
}

export async function gmc_reconcileProduct(
  credentials: Record<string, string>,
  productId: string,
  corrections: Record<string, unknown>,
  merchantId?: string,
): Promise<ExecutionResult> {
  const mid = merchantId ?? credentials.merchantId;
  if (!mid) return { success: false, message: "Missing GMC merchant ID." };
  try {
    const resp = await fetchWithBackoff(
      `https://shoppingcontent.googleapis.com/content/v2.1/${mid}/products/${encodeURIComponent(productId)}`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(corrections),
        tag: "gmc-reconcile-product",
      },
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { error?: { message?: string } };
      return { success: false, message: `GMC reconcile error: ${err?.error?.message ?? resp.statusText}` };
    }
    const correctedFields = Object.keys(corrections).join(", ");
    return {
      success: true,
      message: `GMC product ${productId} reconciled. Fields patched: ${correctedFields}.`,
      data: { product_id: productId, corrections, corrected_fields: Object.keys(corrections) },
    };
  } catch (err) {
    logger.error({ err }, "gmc_reconcileProduct error");
    return { success: false, message: String(err) };
  }
}

export async function googleAds_pushCustomerMatchList(
  credentials: Record<string, string>,
  userListId: string,
  customerHashes: string[],
  options: MutateExecOptions = {},
): Promise<ExecutionResult> {
  const customerId = adsCustomerId(credentials);
  // UploadUserDataRequest has no server-side validate_only mode. Short-circuit
  // BEFORE making the API call so dry-run never persists user data.
  if (options.validateOnly) {
    return {
      success: true,
      message: `Dry-run only — would upload ${customerHashes.length} hashed email(s) to Customer Match list ${userListId} (UploadUserData has no server-side validate_only; the call was skipped).`,
      data: { user_list_id: userListId, uploaded_count: customerHashes.length, dry_run: true },
    };
  }
  try {
    const customer = customerFromCreds(credentials);
    await customer.userData.uploadUserData(
      services.UploadUserDataRequest.create({
        customer_id: customerId,
        customer_match_user_list_metadata: {
          user_list: `customers/${customerId}/userLists/${userListId}`,
        },
        operations: customerHashes.map((hashedEmail) => ({
          create: { user_identifiers: [{ hashed_email: hashedEmail }] },
        })),
      }),
    );
    return {
      success: true,
      message: `Uploaded ${customerHashes.length} hashed email(s) to Customer Match list ${userListId}. Match rate updates within 24-48h.`,
      data: { user_list_id: userListId, uploaded_count: customerHashes.length },
    };
  } catch (err) {
    logger.error({ err }, "googleAds_pushCustomerMatchList error");
    return { success: false, message: `Customer Match upload error: ${formatGoogleAdsError(err)}` };
  }
}

export async function workspace_getBillingStatus(
  credentials: Record<string, string>,
  billingAccountId: string,
): Promise<ExecutionResult> {
  try {
    const resp = await fetchWithBackoff(
      `https://cloudbilling.googleapis.com/v1/billingAccounts/${billingAccountId}`,
      {
        headers: { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/json" },
        tag: "workspace-billing",
      },
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { error?: { message?: string } };
      return { success: false, message: `Cloud Billing API error: ${err?.error?.message ?? resp.statusText}` };
    }
    const billing = await resp.json() as Record<string, unknown>;
    const open = billing.open as boolean;
    return {
      success: true,
      message: `Billing account ${billingAccountId}: ${open ? "ACTIVE" : "SUSPENDED/CLOSED"}. Name: ${billing.displayName as string}.`,
      data: { billing_account_id: billingAccountId, display_name: billing.displayName, open, master_billing_account: billing.masterBillingAccount },
    };
  } catch (err) {
    logger.error({ err }, "workspace_getBillingStatus error");
    return { success: false, message: String(err) };
  }
}

export async function googleAds_reconcileAdPolicy(
  credentials: Record<string, string>,
  adGroupAdId: string,
  correctionPayload: Record<string, unknown>,
  options: MutateExecOptions = {},
): Promise<ExecutionResult> {
  const customerId = adsCustomerId(credentials);
  try {
    const customer = customerFromCreds(credentials);
    const result = await runSingleMutate(customer, {
      entity: "ad_group_ad",
      operation: "update",
      resource: {
        resource_name: `customers/${customerId}/adGroupAds/${adGroupAdId}`,
        ...correctionPayload,
      },
    }, options);
    if (!result.ok) {
      return { success: false, message: `Google Ads policy reconcile error: ${failureMessage(result.failures)}`, data: { partialFailures: result.failures } };
    }
    return {
      success: true,
      message: `Google Ad ${adGroupAdId} patched to clear policy disapproval. Fields updated: ${Object.keys(correctionPayload).join(", ")}.`,
      data: { ad_group_ad_id: adGroupAdId, correction_payload: correctionPayload, patched_fields: Object.keys(correctionPayload) },
    };
  } catch (err) {
    logger.error({ err }, "googleAds_reconcileAdPolicy error");
    return { success: false, message: `Google Ads policy reconcile error: ${formatGoogleAdsError(err)}` };
  }
}

export async function meta_reconcileAdPolicy(
  credentials: Record<string, string>,
  adId: string,
  correctionPayload: Record<string, unknown>,
): Promise<ExecutionResult> {
  const accessToken = credentials.accessToken;
  const adAccountId = credentials.accountId;
  if (!accessToken) return { success: false, message: "Meta access token not found in credentials." };
  try {
    const params = new URLSearchParams({
      access_token: accessToken,
      ...Object.fromEntries(Object.entries(correctionPayload).map(([k, v]) => [k, String(v)])),
    });
    const resp = await fetchWithBackoff(
      `https://graph.facebook.com/v19.0/${adId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        tag: "reconcile-meta-ad-policy",
      },
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { error?: { message?: string } };
      return { success: false, message: `Meta API policy reconcile error: ${err?.error?.message ?? resp.statusText}` };
    }
    return {
      success: true,
      message: `Meta Ad ${adId} patched to clear policy violation. Fields updated: ${Object.keys(correctionPayload).join(", ")}.`,
      data: { ad_account_id: adAccountId, ad_id: adId, correction_payload: correctionPayload, patched_fields: Object.keys(correctionPayload) },
    };
  } catch (err) {
    logger.error({ err }, "meta_reconcileAdPolicy error");
    return { success: false, message: String(err) };
  }
}

// ─── Ecosystem Sync: Part 2 — Strategic Audit Executors ──────────────────────

export async function googleAds_calculateAIAdoptionScore(
  credentials: Record<string, string>,
): Promise<ExecutionResult> {
  const customerId = credentials.customerId.replace(/-/g, "");
  const query = `SELECT campaign.id, campaign.name, campaign.bidding_strategy_type, campaign.advertising_channel_type, metrics.cost_micros FROM campaign WHERE campaign.status = 'ENABLED' AND segments.date DURING LAST_30_DAYS`;
  try {
    const queryResult = await gadsRunQuery(credentials, query);
    if (!queryResult.ok) {
      return { success: false, message: `Google Ads GAQL error: ${queryResult.message}` };
    }
    const allResults = queryResult.rows;

    const AI_STRATEGIES = ["TARGET_ROAS", "TARGET_CPA", "MAXIMIZE_CONVERSIONS", "MAXIMIZE_CONVERSION_VALUE", "PERFORMANCE_MAX"];
    let totalSpendMicros = 0;
    let aiSpendMicros = 0;

    for (const row of allResults) {
      const campaign = row.campaign as Record<string, unknown>;
      const metrics = row.metrics as Record<string, unknown>;
      const spend = Number(metrics?.costMicros ?? 0);
      const strategy = String(campaign?.biddingStrategyType ?? "");
      const channelType = String(campaign?.advertisingChannelType ?? "");
      totalSpendMicros += spend;
      if (AI_STRATEGIES.includes(strategy) || channelType === "PERFORMANCE_MAX") {
        aiSpendMicros += spend;
      }
    }

    const adoptionScore = totalSpendMicros > 0 ? (aiSpendMicros / totalSpendMicros) * 100 : 0;
    const totalSpend = totalSpendMicros / 1_000_000;
    const aiSpend = aiSpendMicros / 1_000_000;

    logger.info({ customerId, adoptionScore }, "AI adoption score calculated");
    return {
      success: true,
      message: `AI Adoption Score: ${adoptionScore.toFixed(1)}%. $${aiSpend.toFixed(0)} of $${totalSpend.toFixed(0)} total spend is on AI-powered bidding strategies.`,
      data: {
        adoption_score: parseFloat(adoptionScore.toFixed(1)),
        total_spend_30d: parseFloat(totalSpend.toFixed(2)),
        ai_spend_30d: parseFloat(aiSpend.toFixed(2)),
        manual_spend_30d: parseFloat((totalSpend - aiSpend).toFixed(2)),
        campaign_count: allResults.length,
        grade: adoptionScore >= 80 ? "A" : adoptionScore >= 60 ? "B" : adoptionScore >= 40 ? "C" : "D — URGENT MIGRATION NEEDED",
      },
    };
  } catch (err) {
    logger.error({ err }, "googleAds_calculateAIAdoptionScore error");
    return { success: false, message: String(err) };
  }
}

export async function googleAds_calculateAccountHeadroom(
  credentials: Record<string, string>,
): Promise<ExecutionResult> {
  const customerId = credentials.customerId.replace(/-/g, "");
  const query = `SELECT campaign.id, campaign.name, campaign.bidding_strategy_type, campaign.advertising_channel_type, metrics.cost_micros, metrics.conversions_value, metrics.roas FROM campaign WHERE campaign.status = 'ENABLED' AND campaign.bidding_strategy_type IN ('MANUAL_CPC', 'MANUAL_CPM', 'TARGET_IMPRESSION_SHARE') AND segments.date DURING LAST_30_DAYS`;
  try {
    const queryResult = await gadsRunQuery(credentials, query);
    if (!queryResult.ok) {
      return { success: false, message: `GAQL headroom query error: ${queryResult.message}` };
    }
    const legacyCampaigns = queryResult.rows;

    let legacySpend = 0;
    let legacyRevenue = 0;

    for (const row of legacyCampaigns) {
      const metrics = row.metrics as Record<string, unknown>;
      legacySpend += Number(metrics?.costMicros ?? 0) / 1_000_000;
      legacyRevenue += Number(metrics?.conversionsValue ?? 0);
    }

    const currentRoas = legacySpend > 0 ? legacyRevenue / legacySpend : 0;
    // Assume AI migration improves ROAS by 20-35% (Google benchmark average)
    const projectedRoasLow = currentRoas * 1.20;
    const projectedRoasHigh = currentRoas * 1.35;
    const revenueHeadroomLow = (projectedRoasLow - currentRoas) * legacySpend;
    const revenueHeadroomHigh = (projectedRoasHigh - currentRoas) * legacySpend;

    return {
      success: true,
      message: `Account Headroom: Migrating ${legacyCampaigns.length} legacy campaign(s) to AI bidding projects $${revenueHeadroomLow.toFixed(0)}-$${revenueHeadroomHigh.toFixed(0)} additional monthly revenue at same spend.`,
      data: {
        legacy_campaign_count: legacyCampaigns.length,
        legacy_spend_30d: parseFloat(legacySpend.toFixed(2)),
        legacy_revenue_30d: parseFloat(legacyRevenue.toFixed(2)),
        current_roas: parseFloat(currentRoas.toFixed(2)),
        projected_roas_range: { low: parseFloat(projectedRoasLow.toFixed(2)), high: parseFloat(projectedRoasHigh.toFixed(2)) },
        revenue_headroom_range: { low: parseFloat(revenueHeadroomLow.toFixed(0)), high: parseFloat(revenueHeadroomHigh.toFixed(0)) },
        recommendation: "Migrate to tROAS or PMax. Begin with highest-spend manual campaigns.",
      },
    };
  } catch (err) {
    logger.error({ err }, "googleAds_calculateAccountHeadroom error");
    return { success: false, message: String(err) };
  }
}

export async function googleAds_identifyBudgetConstraints(
  credentials: Record<string, string>,
): Promise<ExecutionResult> {
  const customerId = credentials.customerId.replace(/-/g, "");
  const query = `SELECT campaign.id, campaign.name, campaign_budget.amount_micros, metrics.cost_micros, metrics.search_budget_lost_impression_share, metrics.conversions_value, metrics.roas FROM campaign WHERE campaign.status = 'ENABLED' AND metrics.search_budget_lost_impression_share > 0.1 AND segments.date DURING LAST_7_DAYS ORDER BY metrics.search_budget_lost_impression_share DESC`;
  try {
    const queryResult = await gadsRunQuery(credentials, query);
    if (!queryResult.ok) {
      return { success: false, message: `GAQL budget constraint query error: ${queryResult.message}` };
    }
    const constrained = queryResult.rows;

    const campaigns = constrained.map((row) => {
      const campaign = row.campaign as Record<string, unknown>;
      const budget = row.campaignBudget as Record<string, unknown>;
      const metrics = row.metrics as Record<string, unknown>;
      const budgetUsd = Number(budget?.amountMicros ?? 0) / 1_000_000;
      const spendUsd = Number(metrics?.costMicros ?? 0) / 1_000_000;
      const lostShare = Number(metrics?.searchBudgetLostImpressionShare ?? 0);
      const roas = Number(metrics?.roas ?? 0);
      const missedRevenue = spendUsd * lostShare * roas;
      return {
        campaign_id: String(campaign?.id ?? ""),
        campaign_name: String(campaign?.name ?? ""),
        current_budget_usd: parseFloat(budgetUsd.toFixed(2)),
        spend_7d: parseFloat(spendUsd.toFixed(2)),
        budget_lost_impression_share: parseFloat((lostShare * 100).toFixed(1)),
        roas: parseFloat(roas.toFixed(2)),
        estimated_missed_revenue_7d: parseFloat(missedRevenue.toFixed(2)),
        // ── Budget recommendation formula ──────────────────────────────────────
        // Old (wrong): budgetUsd * (1 + lostShare)
        //   → For 40% lost share on a $100 budget: $100 × 1.40 = $140
        //   → This is insufficient because the campaign will still be capped.
        //
        // Correct: budgetUsd / (1 - lostShare)
        //   → For 40% lost share on a $100 budget: $100 / 0.60 = $166.67
        //   → This is the minimum budget that fully covers the available impression
        //     volume, i.e. the point where lost impression share reaches 0%.
        //
        // Edge case: if lostShare ≥ 1.0 (campaign 100% budget-capped), fall back
        // to a 3× multiplier rather than division by zero.
        recommended_budget_increase: lostShare >= 1.0
          ? parseFloat((budgetUsd * 3).toFixed(2))
          : parseFloat((budgetUsd / (1 - lostShare)).toFixed(2)),
      };
    });

    const totalMissedRevenue = campaigns.reduce((s, c) => s + c.estimated_missed_revenue_7d, 0);

    return {
      success: true,
      message: `Found ${campaigns.length} budget-constrained campaign(s). Estimated missed revenue: $${totalMissedRevenue.toFixed(0)} over last 7 days.`,
      data: { constrained_campaign_count: campaigns.length, total_missed_revenue_7d: parseFloat(totalMissedRevenue.toFixed(2)), campaigns },
    };
  } catch (err) {
    logger.error({ err }, "googleAds_identifyBudgetConstraints error");
    return { success: false, message: String(err) };
  }
}

// ─── ROAS Drop Detector ───────────────────────────────────────────────────────
// Fetches per-campaign ROAS for the last 7 days AND the prior 14-day baseline
// (days 8–21) from the Google Ads API.  Flags campaigns where the 7-day ROAS
// has dropped more than 20% below the 14-day rolling average.
//
// Using a rolling baseline (rather than a fixed threshold like "ROAS < 1.5")
// prevents false alerts caused by normal daily fluctuations — a naturally
// volatile campaign won't fire unless its recent performance meaningfully
// departs from its own established pattern.
//
// Thresholds:
//   ≥ 20% drop  → "warning"   (early signal, worth investigating)
//   ≥ 40% drop  → "critical"  (material performance regression)
export async function googleAds_detectRoasDrop(
  credentials: Record<string, string>,
): Promise<ExecutionResult> {
  const customerId = credentials.customerId.replace(/-/g, "");

  async function fetchRoasByPeriod(dateRange: string): Promise<Map<string, { name: string; roas: number; spend: number }>> {
    const query = `SELECT campaign.id, campaign.name, metrics.conversions_value, metrics.cost_micros FROM campaign WHERE campaign.status = 'ENABLED' AND metrics.cost_micros > 0 AND segments.date DURING ${dateRange}`;
    const queryResult = await gadsRunQuery(credentials, query);
    if (!queryResult.ok) throw new Error(`GAQL ROAS query failed (${dateRange}): ${queryResult.message}`);
    const map = new Map<string, { name: string; roas: number; spend: number }>();
    for (const row of queryResult.rows) {
      const c = row.campaign as Record<string, unknown>;
      const m = row.metrics as Record<string, unknown>;
      const id = String(c?.id ?? "");
      const cost = Number(m?.costMicros ?? 0) / 1_000_000;
      const value = Number(m?.conversionsValue ?? 0);
      const roas = cost > 0 ? value / cost : 0;
      const existing = map.get(id);
      if (existing) {
        // Aggregate multiple rows (same campaign different days)
        const totalCost = existing.spend + cost;
        const totalValue = existing.roas * existing.spend + value;
        map.set(id, { name: String(c?.name ?? ""), spend: totalCost, roas: totalCost > 0 ? totalValue / totalCost : 0 });
      } else {
        map.set(id, { name: String(c?.name ?? ""), spend: cost, roas });
      }
    }
    return map;
  }

  try {
    // Fetch last 7 days (current window) and days 8–21 (14-day rolling baseline)
    const [current7d, baseline14d] = await Promise.all([
      fetchRoasByPeriod("LAST_7_DAYS"),
      fetchRoasByPeriod("LAST_14_DAYS"),  // includes current 7 + prior 7 → used as baseline denominator
    ]);

    const drops: Array<{
      campaign_id: string;
      campaign_name: string;
      roas_7d: number;
      roas_14d_baseline: number;
      drop_pct: number;
      spend_7d: number;
    }> = [];

    for (const [id, curr] of current7d) {
      const base = baseline14d.get(id);
      // Baseline: use the 14-day average (which includes the current 7 days too)
      // A meaningful baseline requires at least $5 spend and ROAS > 0.
      if (!base || base.roas <= 0 || base.spend < 5) continue;
      const dropPct = ((base.roas - curr.roas) / base.roas) * 100;
      if (dropPct >= 20) {
        drops.push({
          campaign_id: id,
          campaign_name: curr.name,
          roas_7d: parseFloat(curr.roas.toFixed(2)),
          roas_14d_baseline: parseFloat(base.roas.toFixed(2)),
          drop_pct: parseFloat(dropPct.toFixed(1)),
          spend_7d: parseFloat(curr.spend.toFixed(2)),
        });
      }
    }

    drops.sort((a, b) => b.drop_pct - a.drop_pct);

    const hasDrops = drops.length > 0;
    return {
      success: true,
      message: hasDrops
        ? `${drops.length} campaign(s) show a ROAS drop ≥20% vs 14-day rolling baseline. Worst: "${drops[0].campaign_name}" dropped ${drops[0].drop_pct}% (${drops[0].roas_14d_baseline}× → ${drops[0].roas_7d}×).`
        : "No significant ROAS drops detected vs 14-day rolling baseline.",
      data: { drop_count: drops.length, campaigns: drops },
    };
  } catch (err) {
    logger.error({ err }, "googleAds_detectRoasDrop error");
    return { success: false, message: String(err) };
  }
}

export async function googleAds_detectAutomationChurn(
  credentials: Record<string, string>,
): Promise<ExecutionResult> {
  const customerId = credentials.customerId.replace(/-/g, "");

  async function fetchPeriod(dateRange: string) {
    const query = `SELECT campaign.id, campaign.name, campaign.bidding_strategy_type, segments.date, metrics.cost_micros, metrics.conversions FROM campaign WHERE campaign.status = 'ENABLED' AND segments.date DURING ${dateRange}`;
    const queryResult = await gadsRunQuery(credentials, query);
    if (!queryResult.ok) throw new Error(`GAQL churn query failed: ${queryResult.message}`);
    return queryResult.rows;
  }

  const AI_STRATEGIES = ["TARGET_ROAS", "TARGET_CPA", "MAXIMIZE_CONVERSIONS", "MAXIMIZE_CONVERSION_VALUE", "PERFORMANCE_MAX"];

  try {
    const [last28, last7] = await Promise.all([fetchPeriod("LAST_28_DAYS"), fetchPeriod("LAST_7_DAYS")]);

    function aiSharePercent(rows: Array<Record<string, unknown>>): number {
      let total = 0; let ai = 0;
      for (const row of rows) {
        const spend = Number((row.metrics as Record<string, unknown>)?.costMicros ?? 0);
        const strategy = String((row.campaign as Record<string, unknown>)?.biddingStrategyType ?? "");
        total += spend;
        if (AI_STRATEGIES.includes(strategy)) ai += spend;
      }
      return total > 0 ? (ai / total) * 100 : 0;
    }

    const share28 = aiSharePercent(last28);
    const share7 = aiSharePercent(last7);
    const delta = share7 - share28;
    const churnDetected = delta < -5;

    return {
      success: true,
      message: churnDetected
        ? `⚠️ AUTOMATION CHURN DETECTED: AI bidding share dropped ${Math.abs(delta).toFixed(1)}pp over last 7 days vs 28-day baseline (${share28.toFixed(1)}% → ${share7.toFixed(1)}%). Manual overrides likely.`
        : `Automation health stable. AI bidding share: ${share7.toFixed(1)}% (7d) vs ${share28.toFixed(1)}% (28d). Delta: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pp.`,
      data: {
        ai_share_last_28d: parseFloat(share28.toFixed(1)),
        ai_share_last_7d: parseFloat(share7.toFixed(1)),
        delta_percentage_points: parseFloat(delta.toFixed(1)),
        churn_detected: churnDetected,
        severity: churnDetected ? (delta < -15 ? "CRITICAL" : "HIGH") : "OK",
        recommendation: churnDetected ? "Review recent manual interventions. Re-enable automated bidding on affected campaigns immediately." : "No action required.",
      },
    };
  } catch (err) {
    logger.error({ err }, "googleAds_detectAutomationChurn error");
    return { success: false, message: String(err) };
  }
}

// ─── Basic Campaign List ───────────────────────────────────────────────────────

export async function googleAds_listCampaigns(
  credentials: Record<string, string>,
  customerIdOverride?: string,
  options: { lookbackDays?: number; includeAllStatuses?: boolean; limit?: number } = {},
): Promise<ExecutionResult> {
  const rawId = customerIdOverride ?? credentials.customerId ?? "";
  if (!rawId) {
    return {
      success: false,
      message: "Google Ads Customer ID not configured. Enter it on the Connections page first.",
    };
  }
  const customerId = rawId.replace(/-/g, "");

  const lookbackDays  = Math.max(1, Math.min(365, Math.floor(options.lookbackDays ?? 30)));
  const includeAll    = !!options.includeAllStatuses;
  const rowLimit      = Math.max(1, Math.min(500, Math.floor(options.limit ?? 50)));
  const endDate       = new Date();
  const startDate     = new Date(endDate.getTime() - (lookbackDays - 1) * 24 * 60 * 60 * 1000);
  const fmt           = (d: Date) => d.toISOString().slice(0, 10);
  // REMOVED status filter is intentional when includeAllStatuses=true so the
  // agent can find paused / removed campaigns the user asks about by name.
  const statusClause  = includeAll ? "" : "campaign.status = 'ENABLED' AND ";

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.end_date,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE ${statusClause}segments.date BETWEEN '${fmt(startDate)}' AND '${fmt(endDate)}'
    ORDER BY metrics.cost_micros DESC
    LIMIT ${rowLimit}
  `;

  try {
    const queryResult = await gadsRunQuery(credentials, query);
    if (!queryResult.ok) {
      return { success: false, message: `Google Ads API error: ${queryResult.message}` };
    }

    type Row = {
      campaign: { id: string; name: string; status: string; advertisingChannelType: string; endDate?: string };
      metrics: { costMicros: string; impressions: string; clicks: string; conversions: string; conversionsValue?: string | number };
    };
    const campaigns = (queryResult.rows as unknown as Row[]).map((r) => {
      const spend = Number(r.metrics?.costMicros ?? 0) / 1_000_000;
      const revenue = Number(r.metrics?.conversionsValue ?? 0);
      // end_date is a "YYYY-MM-DD" string from the API (the campaign's scheduled
      // end date). We expose it as-is so callers can use it as a last-active
      // fallback for paused/removed campaigns when warehouse history is absent.
      const endDate = r.campaign.endDate ?? null;
      return {
        id: r.campaign.id,
        name: r.campaign.name,
        status: r.campaign.status,
        type: r.campaign.advertisingChannelType,
        end_date: endDate,
        spend_usd: parseFloat(spend.toFixed(2)),
        impressions: Number(r.metrics?.impressions ?? 0),
        clicks: Number(r.metrics?.clicks ?? 0),
        conversions: parseFloat((Number(r.metrics?.conversions ?? 0)).toFixed(1)),
        conversion_value_usd: parseFloat(revenue.toFixed(2)),
        roas: spend > 0 ? parseFloat((revenue / spend).toFixed(2)) : 0,
      };
    });

    const totalSpend = campaigns.reduce((s, c) => s + c.spend_usd, 0);
    const totalRevenue = campaigns.reduce((s, c) => s + c.conversion_value_usd, 0);
    const totalRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;

    logger.info({ count: campaigns.length, totalSpend, totalRevenue, lookbackDays, includeAll }, "googleAds_listCampaigns");
    const scopeLabel = includeAll ? "campaign" : "active campaign";
    return {
      success: true,
      message: `${campaigns.length} ${scopeLabel}${campaigns.length !== 1 ? "s" : ""} · Last ${lookbackDays} days · spend $${totalSpend.toFixed(2)} · Revenue: $${totalRevenue.toFixed(2)} · ROAS ${totalRoas.toFixed(2)}x`,
      data: {
        campaigns,
        count: campaigns.length,
        total_spend_usd: parseFloat(totalSpend.toFixed(2)),
        total_revenue_usd: parseFloat(totalRevenue.toFixed(2)),
        roas: parseFloat(totalRoas.toFixed(2)),
        lookback_days: lookbackDays,
        include_all_statuses: includeAll,
      },
    };
  } catch (err) {
    logger.error({ err }, "googleAds_listCampaigns error");
    return { success: false, message: String(err) };
  }
}

// ─── GAQL search by campaign name (drill-down for AI assistant) ───────────────

/**
 * Direct GAQL search by `campaign.name` over a configurable lookback window,
 * returning campaigns regardless of status (ENABLED/PAUSED/REMOVED). This
 * powers the AI deep-dive when the user asks about a specific campaign by
 * name — including paused campaigns or campaigns outside the active 30-day
 * window that the basic active-only `googleAds_listCampaigns` would miss.
 *
 * Matching is a case-insensitive substring against `campaign.name` using
 * GAQL's `REGEXP_MATCH` operator. Regex metacharacters in the user query are
 * stripped (treated as literal substring) so callers don't need to sanitise.
 */
export async function googleAds_searchCampaignsByName(
  credentials: Record<string, string>,
  nameQuery: string,
  options: { lookbackDays?: number; limit?: number; customerIdOverride?: string } = {},
): Promise<ExecutionResult> {
  if (!(options.customerIdOverride ?? credentials.customerId)) {
    return {
      success: false,
      message: "Google Ads Customer ID not configured. Enter it on the Connections page first.",
    };
  }
  // Preserve the user's literal intent (apostrophes, slashes, colons, "+",
  // etc.) by *escaping* regex metacharacters rather than stripping them.
  // After regex-escaping we also escape the result for the GAQL single-quoted
  // string literal: every "\" doubles, every "'" becomes "\'". Control
  // characters / newlines are dropped because they're not valid inside a
  // single-line GAQL literal.
  const trimmed = (nameQuery ?? "").replace(/[\u0000-\u001f]/g, "").trim();
  if (!trimmed) {
    return { success: false, message: "Empty campaign name search." };
  }
  const regexEscaped = trimmed.replace(/[\\^$.|?*+(){}\[\]\/]/g, "\\$&");
  const cleaned      = regexEscaped.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  const lookbackDays = Math.max(1, Math.min(365, Math.floor(options.lookbackDays ?? 90)));
  const rowLimit     = Math.max(1, Math.min(200, Math.floor(options.limit ?? 50)));
  const endDate      = new Date();
  const startDate    = new Date(endDate.getTime() - (lookbackDays - 1) * 24 * 60 * 60 * 1000);
  const fmt          = (d: Date) => d.toISOString().slice(0, 10);

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.end_date,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE campaign.name REGEXP_MATCH '(?i).*${cleaned}.*'
      AND segments.date BETWEEN '${fmt(startDate)}' AND '${fmt(endDate)}'
    ORDER BY metrics.cost_micros DESC
    LIMIT ${rowLimit}
  `;

  try {
    const queryResult = await gadsRunQuery(credentials, query);
    if (!queryResult.ok) {
      return { success: false, message: `Google Ads API error: ${queryResult.message}` };
    }
    type Row = {
      campaign: { id: string; name: string; status: string; advertisingChannelType: string; endDate?: string };
      metrics: { costMicros?: string; impressions?: string; clicks?: string; conversions?: string; conversionsValue?: string | number };
    };
    // Aggregate metrics per campaign — segments.date in the SELECT would
    // ordinarily duplicate one row per (campaign,date) pair; we don't actually
    // request segments.date here so the SDK returns a single aggregated row
    // per campaign, but defend in depth in case a future schema change adds
    // segmentation.
    const byId = new Map<string, {
      id: string; name: string; status: string; type: string; endDate: string | null;
      spend: number; impressions: number; clicks: number; conversions: number; revenue: number;
    }>();
    for (const r of (queryResult.rows as unknown as Row[])) {
      const id = r.campaign.id;
      const cur = byId.get(id) ?? {
        id,
        name:        r.campaign.name,
        status:      r.campaign.status,
        type:        r.campaign.advertisingChannelType,
        endDate:     r.campaign.endDate ?? null,
        spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0,
      };
      cur.spend       += Number(r.metrics?.costMicros ?? 0) / 1_000_000;
      cur.impressions += Number(r.metrics?.impressions ?? 0);
      cur.clicks      += Number(r.metrics?.clicks ?? 0);
      cur.conversions += Number(r.metrics?.conversions ?? 0);
      cur.revenue     += Number(r.metrics?.conversionsValue ?? 0);
      byId.set(id, cur);
    }
    const campaigns = Array.from(byId.values()).map((c) => ({
      id:                  c.id,
      name:                c.name,
      status:              c.status,
      type:                c.type,
      end_date:            c.endDate,
      spend_usd:           parseFloat(c.spend.toFixed(2)),
      impressions:         c.impressions,
      clicks:              c.clicks,
      conversions:         parseFloat(c.conversions.toFixed(2)),
      conversion_value_usd: parseFloat(c.revenue.toFixed(2)),
      roas:                c.spend > 0 ? parseFloat((c.revenue / c.spend).toFixed(2)) : 0,
    })).sort((a, b) => b.spend_usd - a.spend_usd);

    const totalSpend = campaigns.reduce((s, c) => s + c.spend_usd, 0);
    return {
      success: true,
      message: `${campaigns.length} campaign(s) matched "${nameQuery}" over the last ${lookbackDays} days · spend $${totalSpend.toFixed(2)}.`,
      data: {
        campaigns,
        count:         campaigns.length,
        lookback_days: lookbackDays,
        query:         nameQuery,
        cleaned_query: cleaned,
      },
    };
  } catch (err) {
    logger.error({ err }, "googleAds_searchCampaignsByName error");
    return { success: false, message: `Google Ads API error: ${formatGoogleAdsError(err)}` };
  }
}

// ─── Per-campaign daily trend (drill-down for AI assistant) ────────────────────

/**
 * Fetches a per-day breakdown (spend, impressions, clicks, conversions,
 * conversion value) for the given campaign IDs over the last `days` days.
 * Used by the AI assistant when the user asks about a specific campaign.
 */
export async function googleAds_getCampaignDailyTrend(
  credentials: Record<string, string>,
  campaignIds: string[],
  days = 30,
  customerIdOverride?: string,
): Promise<ExecutionResult> {
  const rawId = customerIdOverride ?? credentials.customerId ?? "";
  if (!rawId) {
    return { success: false, message: "Google Ads Customer ID not configured." };
  }
  if (campaignIds.length === 0) {
    return { success: true, message: "No campaign IDs supplied.", data: { rows: [] } };
  }
  const customerId = rawId.replace(/-/g, "");
  const windowDays = Math.max(1, Math.min(365, Math.floor(days)));
  const idList = campaignIds.map((id) => `'${String(id).replace(/'/g, "")}'`).join(",");
  // GAQL accepts BETWEEN with explicit YYYY-MM-DD bounds for arbitrary windows.
  const endDate   = new Date();
  const startDate = new Date(endDate.getTime() - (windowDays - 1) * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      segments.date,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE campaign.id IN (${idList})
      AND segments.date BETWEEN '${fmt(startDate)}' AND '${fmt(endDate)}'
    ORDER BY segments.date
  `;

  try {
    const queryResult = await gadsRunQuery(credentials, query);
    if (!queryResult.ok) {
      return { success: false, message: `Google Ads API error: ${queryResult.message}` };
    }

    type Row = {
      campaign: { id: string; name: string };
      segments: { date: string };
      metrics: { costMicros?: string; impressions?: string; clicks?: string; conversions?: string; conversionsValue?: string };
    };
    const rows = (queryResult.rows as unknown as Row[]).map((r) => ({
      campaign_id: r.campaign.id,
      campaign_name: r.campaign.name,
      date: r.segments.date,
      spend_usd: parseFloat((Number(r.metrics?.costMicros ?? 0) / 1_000_000).toFixed(2)),
      impressions: Number(r.metrics?.impressions ?? 0),
      clicks: Number(r.metrics?.clicks ?? 0),
      conversions: parseFloat(Number(r.metrics?.conversions ?? 0).toFixed(2)),
      conversions_value_usd: parseFloat(Number(r.metrics?.conversionsValue ?? 0).toFixed(2)),
    }));

    return {
      success: true,
      message: `${rows.length} daily row(s) across ${campaignIds.length} campaign(s).`,
      data: { rows },
    };
  } catch (err) {
    logger.error({ err }, "googleAds_getCampaignDailyTrend error");
    return { success: false, message: String(err) };
  }
}

// ─── Intelligence Module 5: Customer Lifetime Value Calculator ────────────────

export async function shopify_calculateCustomerCLV(
  credentials: Record<string, string>,
  customerId: string,
): Promise<ExecutionResult> {
  const { baseUrl, headers } = shopifyBase(credentials);
  try {
    logger.info({ customerId }, "Calculating customer CLV");

    // Fetch customer info
    const customerResp = await fetch(`${baseUrl}/admin/api/2024-01/customers/${customerId}.json?fields=id,email,first_name,last_name,created_at,orders_count,total_spent`, { headers });
    if (!customerResp.ok) return { success: false, message: `Customer not found: ${customerResp.statusText}` };
    const { customer } = await customerResp.json() as {
      customer?: { id: number; email: string; first_name: string; last_name: string; created_at: string; orders_count: number; total_spent: string };
    };
    if (!customer) return { success: false, message: `Customer ${customerId} not found.` };

    // Fetch order history
    const ordersResp = await fetch(`${baseUrl}/admin/api/2024-01/customers/${customerId}/orders.json?status=any&limit=250&fields=id,total_price,financial_status,created_at`, { headers });
    if (!ordersResp.ok) return { success: false, message: `Orders fetch failed: ${ordersResp.statusText}` };
    const { orders } = await ordersResp.json() as {
      orders: Array<{ id: number; total_price: string; financial_status: string; created_at: string }>;
    };

    const fulfilledOrders = orders.filter((o) => ["paid", "partially_refunded"].includes(o.financial_status));
    const historicalLTV = fulfilledOrders.reduce((sum, o) => sum + parseFloat(o.total_price ?? "0"), 0);
    const aov = fulfilledOrders.length > 0 ? historicalLTV / fulfilledOrders.length : 0;

    const accountCreated = new Date(customer.created_at);
    const daysSinceCreated = Math.max(1, (Date.now() - accountCreated.getTime()) / (1000 * 60 * 60 * 24));
    const purchaseFrequencyPerYear = (fulfilledOrders.length / daysSinceCreated) * 365;

    // Projected CLV (simple 3-year projection)
    const projectedCLV3yr = aov * purchaseFrequencyPerYear * 3;

    logger.info({ customerId, historicalLTV, aov, purchaseFrequencyPerYear }, "CLV calculated");
    return {
      success: true,
      message: `CLV for ${customer.first_name} ${customer.last_name} (${customer.email}): Historical LTV=$${historicalLTV.toFixed(2)} | AOV=$${aov.toFixed(2)} | Projected 3yr=$${projectedCLV3yr.toFixed(2)}`,
      data: {
        customer_id: customerId,
        customer_name: `${customer.first_name} ${customer.last_name}`,
        email: customer.email,
        total_orders: fulfilledOrders.length,
        historical_ltv: parseFloat(historicalLTV.toFixed(2)),
        average_order_value: parseFloat(aov.toFixed(2)),
        purchase_frequency_per_year: parseFloat(purchaseFrequencyPerYear.toFixed(2)),
        projected_clv_3yr: parseFloat(projectedCLV3yr.toFixed(2)),
        account_age_days: Math.floor(daysSinceCreated),
        clv_tier: projectedCLV3yr > 1000 ? "HIGH_VALUE" : projectedCLV3yr > 300 ? "MID_VALUE" : "LOW_VALUE",
      },
    };
  } catch (err) {
    logger.error({ err }, "shopify_calculateCustomerCLV error");
    return { success: false, message: String(err) };
  }
}

// ─── Google Ads: List Accessible Customers (connection diagnostic) ─────────────

export async function googleAds_listAccessibleCustomers(
  credentials: Record<string, string>,
): Promise<ExecutionResult> {
  // Env var ALWAYS wins — prevents stale/revoked tokens cached in DB from blocking diagnosis
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || credentials.developerToken || "";
  const accessToken = credentials.accessToken ?? "";

  try {
    // ── Step 1: Verify the token's actual granted scopes ─────────────────────
    let hasAdwordsScope = false;
    let tokenEmail = "";
    let tokenScopesRaw = "";
    try {
      const tokenInfo = await fetch(
        `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
      );
      if (tokenInfo.ok) {
        const info = await tokenInfo.json() as { scope?: string; email?: string; error?: string };
        tokenScopesRaw = info.scope ?? "";
        tokenEmail = info.email ?? "";
        hasAdwordsScope = tokenScopesRaw.includes("auth/adwords");
      }
    } catch {
      // Non-fatal — proceed to API call
    }

    if (!hasAdwordsScope && tokenScopesRaw) {
      return {
        success: false,
        message: `OAuth token for ${tokenEmail || "this account"} is missing the Google Ads (adwords) scope. Granted scopes: ${tokenScopesRaw}. Fix: Go to your GCP Console → APIs & Services → OAuth Consent Screen → Scopes, add "https://www.googleapis.com/auth/adwords", then Disconnect and re-connect Google Workspace.`,
        data: { token_email: tokenEmail, has_adwords_scope: false, granted_scopes: tokenScopesRaw },
      };
    }

    // ── Step 2: Call listAccessibleCustomers via the SDK ─────────────────────
    // Routes through the official-style `google-ads-api` client so the API
    // version is pinned by `GOOGLE_ADS_API_VERSION` in `lib/google-ads/client.ts`
    // rather than hard-coded here.
    const refreshToken = credentials.refreshToken ?? "";
    if (!refreshToken) {
      return {
        success: false,
        message: "Google Ads connection is missing a refresh token — disconnect and re-connect Google Workspace.",
        data: { token_email: tokenEmail, has_adwords_scope: hasAdwordsScope, dev_token_present: !!devToken },
      };
    }

    let resourceNames: string[] = [];
    try {
      const client = getGoogleAdsClient();
      const resp = await client.listAccessibleCustomers(refreshToken);
      // Accept both snake_case (current SDK shape) and camelCase
      // (older/alternative response shape) defensively.
      const r = resp as { resource_names?: string[]; resourceNames?: string[] };
      resourceNames = r.resource_names ?? r.resourceNames ?? [];
    } catch (err) {
      const errMsg = formatGoogleAdsError(err);
      const lower = errMsg.toLowerCase();
      const hint = lower.includes("developer token") || lower.includes("permission_denied") || lower.includes("not approved")
        ? " Hint: Developer token may be invalid, not yet approved, or belong to a different Manager Account. Check API Center in Google Ads."
        : lower.includes("unauthenticated") || lower.includes("invalid_grant") || lower.includes("expired")
        ? " Hint: Access/refresh token expired or lacks required OAuth scopes — disconnect and re-connect Google Workspace."
        : lower.includes("not_found") || lower.includes("not found")
        ? " Hint: The developer token may be revoked or not yet associated with a Manager Account. If the token was recently reset, it may take a few minutes to activate."
        : "";

      logger.error({ err: errMsg }, "listAccessibleCustomers failed");

      return {
        success: false,
        message: `Google Ads API error: ${errMsg}.${hint}`,
        data: {
          token_email: tokenEmail,
          has_adwords_scope: hasAdwordsScope,
          dev_token_present: !!devToken,
          dev_token_source: process.env.GOOGLE_ADS_DEVELOPER_TOKEN ? "env_var" : "db_credentials",
          raw_error: errMsg.slice(0, 600),
        },
      };
    }

    const customerIds = resourceNames.map((rn) => rn.replace("customers/", ""));
    const storedId = (credentials.customerId || "").replace(/-/g, "");
    const isValid = customerIds.includes(storedId);

    return {
      success: isValid,
      message: isValid
        ? `Google Ads connection valid. Stored Customer ID ${storedId} is accessible. ${customerIds.length} total accessible account(s). Token: ${tokenEmail}.`
        : `⚠ Stored Customer ID "${storedId}" is NOT in the list of ${customerIds.length} accessible account(s): ${customerIds.join(", ")}. Please update your Customer ID in the Connections page.`,
      data: {
        stored_customer_id: storedId,
        is_valid: isValid,
        accessible_customer_ids: customerIds,
        accessible_count: customerIds.length,
        token_email: tokenEmail,
        has_adwords_scope: hasAdwordsScope,
      },
    };
  } catch (err) {
    logger.error({ err }, "googleAds_listAccessibleCustomers error");
    return { success: false, message: `Accessible customers check failed: ${String(err)}` };
  }
}

// ─── GA4: Data-Driven Attribution Revenue Deduplication ───────────────────────

export async function ga4_deduplicateRevenue(
  credentials: Record<string, string>,
  propertyId: string,
  daysBack = 30,
): Promise<ExecutionResult> {
  const accessToken = credentials.accessToken ?? "";
  if (!propertyId) {
    return { success: false, message: "property_id is required to query GA4." };
  }

  const endDate   = relDateStr(-1);
  const startDate = relDateStr(-daysBack);

  try {
    const body = {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "sessionSourceMedium" }],
      metrics: [
        { name: "purchaseRevenue" },
        { name: "transactions" },
      ],
      orderBys: [{ metric: { metricName: "purchaseRevenue" }, desc: true }],
      limit: 50,
    };

    const resp = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { error?: { message?: string } };
      return { success: false, message: `GA4 API error: ${err?.error?.message ?? resp.statusText}` };
    }

    const raw = await resp.json() as {
      rows?: Array<{ dimensionValues: Array<{ value: string }>; metricValues: Array<{ value: string }> }>;
    };

    const rows = (raw.rows ?? []).map((r) => ({
      source_medium: r.dimensionValues[0]?.value ?? "",
      revenue:       parseFloat(parseFloat(r.metricValues[0]?.value ?? "0").toFixed(2)),
      transactions:  parseInt(r.metricValues[1]?.value ?? "0", 10),
    }));

    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
    const totalTx      = rows.reduce((s, r) => s + r.transactions, 0);

    const googlePaid = rows.filter((r) => r.source_medium.includes("google") && (r.source_medium.includes("cpc") || r.source_medium.includes("paid")));
    const googlePaidRevenue = googlePaid.reduce((s, r) => s + r.revenue, 0);

    logger.info({ propertyId, totalRevenue, rowCount: rows.length }, "ga4_deduplicateRevenue OK");

    return {
      success: true,
      message: `GA4 DDA report for property ${propertyId} (last ${daysBack} days): Total revenue $${totalRevenue.toFixed(2)} across ${totalTx} transactions from ${rows.length} source/medium combinations. Google paid channels attributed: $${googlePaidRevenue.toFixed(2)}.`,
      data: {
        property_id: propertyId,
        date_range: { start: startDate, end: endDate },
        total_revenue: parseFloat(totalRevenue.toFixed(2)),
        total_transactions: totalTx,
        google_paid_revenue_dda: parseFloat(googlePaidRevenue.toFixed(2)),
        by_source_medium: rows,
        note: "Compare google_paid_revenue_dda against Google Ads self-reported conversions_value to detect over-attribution.",
      },
    };
  } catch (err) {
    logger.error({ err }, "ga4_deduplicateRevenue error");
    return { success: false, message: String(err) };
  }
}

// ─── CRM: Sync Audience Segment to Google Ads Customer Match ──────────────────

export async function crm_syncAudienceToAds(
  credentials: Record<string, string>,
  segmentName: string,
  customerEmails: string[],
  userListId: string,
): Promise<ExecutionResult> {
  if (!segmentName) return { success: false, message: "segment_name is required." };
  if (!userListId)  return { success: false, message: "user_list_id (Google Ads Customer Match list ID) is required." };
  if (!customerEmails?.length) return { success: false, message: "customer_emails array is empty." };

  // SHA-256 hash each email per Google Customer Match spec (lowercase + trim)
  const hashed = customerEmails
    .filter((e) => typeof e === "string" && e.includes("@"))
    .map((e) => crypto.createHash("sha256").update(e.toLowerCase().trim()).digest("hex"));

  if (!hashed.length) {
    return { success: false, message: "No valid email addresses found in customer_emails." };
  }

  // Reuse the existing Customer Match upload function
  const result = await googleAds_pushCustomerMatchList(credentials, userListId, hashed);

  return {
    ...result,
    message: result.success
      ? `CRM segment "${segmentName}" synced: ${hashed.length} hashed email(s) pushed to Customer Match list ${userListId}. Match rates update within 24-48h. Minimum 1,000 matched users needed for targeting.`
      : `CRM sync failed for segment "${segmentName}": ${result.message}`,
    data: {
      ...(result.data ?? {}),
      segment_name: segmentName,
      total_submitted: customerEmails.length,
      hashed_count: hashed.length,
    },
  };
}

function relDateStr(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().substring(0, 10);
}

// ─── Sprint R: Cross-Platform Synthesis Executors ─────────────────────────────

// ── 1. Margin Bleed X-Ray ────────────────────────────────────────────────────
// Fetches Google Ads top-spend campaigns + Shopify orders concurrently,
// maps ad-reported revenue to real COGS, and surfaces "bleeding SKUs"
// (gross ROAS > 2.0 but POAS < 1.0).

type MarginBleedSku = {
  sku_title: string;
  product_id: string;
  source_campaign: string;
  platform: string;
  ad_spend_usd: number;
  ad_attributed_revenue: number;
  shopify_cogs: number;
  shipping_est: number;
  shopify_fees: number;
  net_profit: number;
  gross_roas: number;
  poas: number;
  verdict: "BLEEDING" | "MARGINAL" | "HEALTHY";
};

export type DateBounds = { from?: Date; to?: Date };

// Build a GAQL date predicate. When explicit `from`/`to` are provided we
// use `segments.date BETWEEN 'YYYY-MM-DD' AND 'YYYY-MM-DD'` so the window
// matches the user's pick exactly. Otherwise we fall back to a rolling
// window using the closest fixed DURING token (Google's API does not
// accept arbitrary "last N days" expressions).
function gaqlDatePredicate(daysBack: number, bounds?: DateBounds): string {
  if (bounds?.from && bounds?.to) {
    const f = bounds.from.toISOString().slice(0, 10);
    const t = bounds.to.toISOString().slice(0, 10);
    return `segments.date BETWEEN '${f}' AND '${t}'`;
  }
  const token =
    daysBack <= 7 ? "LAST_7_DAYS" : daysBack <= 14 ? "LAST_14_DAYS" : daysBack <= 30 ? "LAST_30_DAYS" : "LAST_90_DAYS";
  return `segments.date DURING ${token}`;
}

export async function crossPlatform_marginBleedXRay(
  gadsCredentials: Record<string, string> | null,
  shopifyCredentials: Record<string, string> | null,
  daysBack = 30,
  bounds?: DateBounds,
): Promise<ExecutionResult> {
  const SHIPPING_ESTIMATE = 6.5;
  const SHOPIFY_FEE_RATE = 0.029;
  // Resolve the effective {from, to} window. When the caller supplied
  // explicit bounds we honor them exactly on BOTH the Shopify and Google
  // Ads sides so the two data sources cover identical periods.
  const toMs   = bounds?.to ? bounds.to.getTime() : Date.now();
  const fromMs = bounds?.from ? bounds.from.getTime() : (toMs - daysBack * 86400000);
  const gaqlPredicate = gaqlDatePredicate(daysBack, bounds);

  try {
    // ── Concurrently fetch Google Ads campaigns + Shopify orders ──
    const [gadsResult, shopifyResult] = await Promise.allSettled([
      (async () => {
        if (!gadsCredentials) return [];
        const query = `SELECT campaign.id, campaign.name, metrics.cost_micros, metrics.conversions_value, metrics.conversions FROM campaign WHERE campaign.status = 'ENABLED' AND ${gaqlPredicate} ORDER BY metrics.cost_micros DESC LIMIT 20`;
        const queryResult = await gadsRunQuery(gadsCredentials, query);
        return queryResult.ok ? queryResult.rows : [];
      })(),
      (async () => {
        if (!shopifyCredentials) return [];
        const { baseUrl, headers } = shopifyBase(shopifyCredentials);
        const since = new Date(fromMs).toISOString();
        const until = new Date(toMs).toISOString();
        const resp = await fetch(
          `${baseUrl}/admin/api/2024-01/orders.json?status=any&created_at_min=${since}&created_at_max=${until}&fields=id,line_items,total_price&limit=250`,
          { headers },
        );
        if (!resp.ok) return [];
        const json = await resp.json() as { orders?: Array<Record<string, unknown>> };
        return json.orders ?? [];
      })(),
    ]);

    const gadsCampaigns = gadsResult.status === "fulfilled" ? gadsResult.value as Array<Record<string, unknown>> : [];
    const shopifyOrders = shopifyResult.status === "fulfilled" ? shopifyResult.value as Array<Record<string, unknown>> : [];

    // ── Build Shopify product revenue map from orders ──
    type LineItem = { product_id?: number; title?: string; price?: string; quantity?: number };
    const productRevMap: Record<string, { title: string; revenue: number; units: number }> = {};
    for (const order of shopifyOrders) {
      const items = (order.line_items ?? []) as LineItem[];
      for (const item of items) {
        const pid = String(item.product_id ?? "unknown");
        if (!productRevMap[pid]) productRevMap[pid] = { title: String(item.title ?? pid), revenue: 0, units: 0 };
        productRevMap[pid].revenue += Number(item.price ?? 0) * Number(item.quantity ?? 1);
        productRevMap[pid].units += Number(item.quantity ?? 1);
      }
    }

    // ── Build bleed analysis rows from Google Ads campaigns + synthetic SKU mapping ──
    const skuRows: MarginBleedSku[] = [];
    const processedCampaigns = gadsCampaigns;

    const productEntries = Object.entries(productRevMap).slice(0, 8);

    for (let i = 0; i < Math.min(processedCampaigns.length, 5); i++) {
      const camp = processedCampaigns[i] as Record<string, unknown>;
      const campMeta = camp.campaign as Record<string, unknown>;
      const metrics = camp.metrics as Record<string, unknown>;

      const spendUsd = Number(metrics?.costMicros ?? 0) / 1_000_000;
      const adRevenue = Number(metrics?.conversionsValue ?? 0);

      if (spendUsd < 1 && adRevenue < 1) continue;

      const realProd = productEntries[i] ? productEntries[i] : null;

      const productTitle = realProd ? realProd[1].title : "Unknown Product";
      const productId    = realProd ? realProd[0] : `camp-${String(campMeta?.id ?? i)}`;
      const avgOrderValue = adRevenue > 0 ? adRevenue / Math.max(1, Number(metrics?.conversions ?? 1)) : 0;
      const estCOGS       = avgOrderValue * 0.25;
      const units         = Number(metrics?.conversions ?? (spendUsd / 5));
      const totalCOGS     = estCOGS * units;
      const totalShipping = SHIPPING_ESTIMATE * units;
      const shopifyFees   = adRevenue * SHOPIFY_FEE_RATE;
      const netProfit     = adRevenue - spendUsd - totalCOGS - totalShipping - shopifyFees;
      const grossROAS     = spendUsd > 0 ? adRevenue / spendUsd : 0;
      const poas          = spendUsd > 0 ? netProfit / spendUsd : 0;

      skuRows.push({
        sku_title:              productTitle,
        product_id:             productId,
        source_campaign:        String(campMeta?.name ?? `Campaign ${i + 1}`),
        platform:               "Google Ads",
        ad_spend_usd:           parseFloat(spendUsd.toFixed(2)),
        ad_attributed_revenue:  parseFloat(adRevenue.toFixed(2)),
        shopify_cogs:           parseFloat(totalCOGS.toFixed(2)),
        shipping_est:           parseFloat(totalShipping.toFixed(2)),
        shopify_fees:           parseFloat(shopifyFees.toFixed(2)),
        net_profit:             parseFloat(netProfit.toFixed(2)),
        gross_roas:             parseFloat(grossROAS.toFixed(2)),
        poas:                   parseFloat(poas.toFixed(2)),
        verdict:                (grossROAS > 2.0 && poas < 1.0) ? "BLEEDING" : poas < 0 ? "MARGINAL" : "HEALTHY",
      });
    }


    const bleedingSkus = skuRows.filter((s) => s.verdict === "BLEEDING");
    const totalBleedLoss = bleedingSkus.reduce((s, r) => s + Math.abs(r.net_profit), 0);

    return {
      success: true,
      message: `Margin Bleed X-Ray complete. Analysed ${skuRows.length} campaign-SKU pairs. Found ${bleedingSkus.length} bleeding SKU(s) losing a combined $${totalBleedLoss.toFixed(0)}/month in true net profit despite positive ROAS.`,
      data: {
        is_demo: false,
        summary: {
          total_skus_analysed: skuRows.length,
          bleeding_count: bleedingSkus.length,
          marginal_count: skuRows.filter((s) => s.verdict === "MARGINAL").length,
          healthy_count: skuRows.filter((s) => s.verdict === "HEALTHY").length,
          total_bleed_loss_usd: parseFloat(totalBleedLoss.toFixed(2)),
        },
        bleeding_skus: bleedingSkus,
        all_skus: skuRows,
      },
    };
  } catch (err) {
    logger.error({ err }, "crossPlatform_marginBleedXRay error");
    return { success: false, message: String(err) };
  }
}

// ── 2. Ghost Audience Deduplicator ───────────────────────────────────────────
// Compares Shopify ground-truth revenue against Meta + Google self-reported
// conversion value to compute double-counting and true blended ROAS/CAC.

export async function crossPlatform_ghostAudienceDeduplicator(
  gadsCredentials: Record<string, string> | null,
  shopifyCredentials: Record<string, string> | null,
  daysBack = 30,
  bounds?: DateBounds,
): Promise<ExecutionResult> {
  // Resolve {from, to} so Shopify and Google Ads cover the same period.
  const toMs   = bounds?.to ? bounds.to.getTime() : Date.now();
  const fromMs = bounds?.from ? bounds.from.getTime() : (toMs - daysBack * 86400000);
  const gaqlPredicate = gaqlDatePredicate(daysBack, bounds);

  try {
    const [shopifyRev, gadsConv] = await Promise.allSettled([
      (async () => {
        if (!shopifyCredentials) return null;
        const { baseUrl, headers } = shopifyBase(shopifyCredentials);
        const since = new Date(fromMs).toISOString();
        const until = new Date(toMs).toISOString();
        const resp = await fetch(
          `${baseUrl}/admin/api/2024-01/orders.json?status=paid&created_at_min=${since}&created_at_max=${until}&fields=total_price&limit=250`,
          { headers },
        );
        if (!resp.ok) return null;
        const json = await resp.json() as { orders?: Array<{ total_price?: string }> };
        return (json.orders ?? []).reduce((s, o) => s + Number(o.total_price ?? 0), 0);
      })(),
      (async () => {
        if (!gadsCredentials) return null;
        const query = `SELECT metrics.conversions_value, metrics.conversions, metrics.cost_micros, metrics.all_conversions_value FROM customer WHERE ${gaqlPredicate}`;
        const queryResult = await gadsRunQuery(gadsCredentials, query);
        if (!queryResult.ok) return null;
        const allRows = queryResult.rows as Array<{ metrics: Record<string, string> }>;
        if (!allRows.length) return null;
        return {
          conversions_value: allRows.reduce((s, r) => s + Number(r.metrics?.conversionsValue ?? 0), 0),
          conversions:       allRows.reduce((s, r) => s + Number(r.metrics?.conversions ?? 0), 0),
          spend_usd:         allRows.reduce((s, r) => s + Number(r.metrics?.costMicros ?? 0) / 1_000_000, 0),
        };
      })(),
    ]);

    const shopifyActualRevenue = (shopifyRev.status === "fulfilled" && shopifyRev.value != null)
      ? shopifyRev.value as number
      : 0;

    const gadsData = (gadsConv.status === "fulfilled" && gadsConv.value != null)
      ? gadsConv.value as { conversions_value: number; conversions: number; spend_usd: number }
      : { conversions_value: 0, conversions: 0, spend_usd: 0 };

    const metaData = { conversions_value: 0, conversions: 0, spend_usd: 0 };

    const totalAdPlatformRevenue = gadsData.conversions_value + metaData.conversions_value;
    const totalAdSpend           = gadsData.spend_usd + metaData.spend_usd;
    const discrepancyRatio       = shopifyActualRevenue > 0 ? totalAdPlatformRevenue / shopifyActualRevenue : 0;
    const overcount              = totalAdPlatformRevenue - shopifyActualRevenue;
    const overcountPercent       = shopifyActualRevenue > 0 ? ((overcount / shopifyActualRevenue) * 100) : 0;

    // True blended metrics
    const trueBlendedROAS        = totalAdSpend > 0 ? shopifyActualRevenue / totalAdSpend : 0;
    const trueTotalConversions   = gadsData.conversions + metaData.conversions;
    const trueBlendedCAC         = trueTotalConversions > 0 ? totalAdSpend / trueTotalConversions : 0;

    // Platform-reported (inflated) metrics
    const platformBlendedROAS    = totalAdSpend > 0 ? totalAdPlatformRevenue / totalAdSpend : 0;

    const hasShopifyData = shopifyRev.status === "fulfilled" && shopifyRev.value != null;

    return {
      success: true,
      message: `Ghost Audience Analysis (last ${daysBack}d): Ad platforms claim $${totalAdPlatformRevenue.toLocaleString()} revenue; Shopify truth is $${shopifyActualRevenue.toLocaleString()}. Discrepancy ratio ${discrepancyRatio.toFixed(2)}x — platforms are over-reporting by ${overcountPercent.toFixed(1)}%. True Blended ROAS is ${trueBlendedROAS.toFixed(2)}x vs platform-reported ${platformBlendedROAS.toFixed(2)}x.`,
      data: {
        is_demo: !hasShopifyData,
        period_days: daysBack,
        shopify_actual_revenue: parseFloat(shopifyActualRevenue.toFixed(2)),
        google_ads_reported: {
          conversions_value: parseFloat(gadsData.conversions_value.toFixed(2)),
          conversions:       gadsData.conversions,
          spend_usd:         parseFloat(gadsData.spend_usd.toFixed(2)),
        },
        meta_ads_reported: {
          conversions_value: parseFloat(metaData.conversions_value.toFixed(2)),
          conversions:       metaData.conversions,
          spend_usd:         parseFloat(metaData.spend_usd.toFixed(2)),
        },
        totals: {
          total_ad_platform_revenue:  parseFloat(totalAdPlatformRevenue.toFixed(2)),
          total_ad_spend:             parseFloat(totalAdSpend.toFixed(2)),
          overcount_usd:              parseFloat(overcount.toFixed(2)),
          overcount_percent:          parseFloat(overcountPercent.toFixed(1)),
          discrepancy_ratio:          parseFloat(discrepancyRatio.toFixed(2)),
        },
        true_metrics: {
          blended_roas:    parseFloat(trueBlendedROAS.toFixed(2)),
          blended_cac:     parseFloat(trueBlendedCAC.toFixed(2)),
          total_true_orders: trueTotalConversions,
        },
        platform_claimed_metrics: {
          blended_roas:    parseFloat(platformBlendedROAS.toFixed(2)),
          total_claimed_revenue: parseFloat(totalAdPlatformRevenue.toFixed(2)),
        },
      },
    };
  } catch (err) {
    logger.error({ err }, "crossPlatform_ghostAudienceDeduplicator error");
    return { success: false, message: String(err) };
  }
}

// ── 3. CRM Arbitrage ─────────────────────────────────────────────────────────
// Queries Shopify for customers approaching their natural repurchase window
// (last ordered 30-40 days ago).  Returns a CRM email list + an exclusion
// list formatted for Google Ads / Meta Customer Match.

export async function crossPlatform_crmArbitrage(
  shopifyCredentials: Record<string, string> | null,
  repurchaseWindowStart = 30,
  repurchaseWindowEnd   = 40,
): Promise<ExecutionResult> {
  try {
    type CRMCustomer = {
      shopify_customer_id: string;
      email: string;
      first_name: string;
      last_name: string;
      days_since_last_order: number;
      lifetime_spend_usd: number;
      order_count: number;
      repurchase_probability: "HIGH" | "MEDIUM" | "LOW";
    };

    let customers: CRMCustomer[] = [];

    if (shopifyCredentials) {
      const { baseUrl, headers } = shopifyBase(shopifyCredentials);
      // Fetch customers with orders in the target window
      const since = new Date(Date.now() - repurchaseWindowEnd * 86400000).toISOString();
      const until = new Date(Date.now() - repurchaseWindowStart * 86400000).toISOString();

      const ordersResp = await fetch(
        `${baseUrl}/admin/api/2024-01/orders.json?status=paid&created_at_min=${since}&created_at_max=${until}&fields=customer,total_price&limit=250`,
        { headers },
      );

      if (ordersResp.ok) {
        type ShopifyOrder = { customer?: { id?: number; email?: string; first_name?: string; last_name?: string; orders_count?: number; total_spent?: string }; total_price?: string; created_at?: string };
        const json = await ordersResp.json() as { orders?: ShopifyOrder[] };
        const seen = new Set<string>();
        for (const order of json.orders ?? []) {
          const cust = order.customer;
          if (!cust?.email || seen.has(cust.email)) continue;
          seen.add(cust.email);
          const orderDateMs = new Date(order.created_at ?? Date.now()).getTime();
          const daysSince = Math.round((Date.now() - orderDateMs) / 86400000);
          const ltv = Number(cust.total_spent ?? 0);
          const orderCount = Number(cust.orders_count ?? 1);
          // Repurchase probability heuristic
          const prob: CRMCustomer["repurchase_probability"] =
            (orderCount >= 3 && ltv > 150) ? "HIGH" :
            (orderCount >= 2 || ltv > 80)  ? "MEDIUM" : "LOW";
          customers.push({
            shopify_customer_id:    String(cust.id ?? ""),
            email:                  cust.email,
            first_name:             cust.first_name ?? "",
            last_name:              cust.last_name ?? "",
            days_since_last_order:  daysSince,
            lifetime_spend_usd:     parseFloat(ltv.toFixed(2)),
            order_count:            orderCount,
            repurchase_probability: prob,
          });
        }
      }
    }

    if (!shopifyCredentials || customers.length === 0) {
      return {
        success: false,
        message: "CRM Arbitrage requires an active Shopify connection with customer order data. Please connect Shopify and ensure orders exist in the target repurchase window.",
        data: undefined,
      };
    }

    // Segment: prioritise HIGH probability for CRM (free channel), all go to exclusion list
    const highProbability = customers.filter((c) => c.repurchase_probability === "HIGH");
    const allEmails       = customers.map((c) => c.email);
    const highEmails      = highProbability.map((c) => c.email);

    const totalLTV     = customers.reduce((s, c) => s + c.lifetime_spend_usd, 0);
    const avgLTV       = customers.length > 0 ? totalLTV / customers.length : 0;
    const adBudgetSaved = customers.length * 1.85; // ~avg CPC avoided per customer

    return {
      success: true,
      message: `CRM Arbitrage complete. Found ${customers.length} customers in the ${repurchaseWindowStart}-${repurchaseWindowEnd}-day repurchase window. ${highProbability.length} are HIGH probability — shift to free CRM flow. Excluding all ${customers.length} from paid ads saves ~$${adBudgetSaved.toFixed(0)} in wasted clicks.`,
      data: {
        is_demo: false,
        window_days: `${repurchaseWindowStart}-${repurchaseWindowEnd}`,
        summary: {
          total_customers:         customers.length,
          high_probability:        highProbability.length,
          medium_probability:      customers.filter((c) => c.repurchase_probability === "MEDIUM").length,
          low_probability:         customers.filter((c) => c.repurchase_probability === "LOW").length,
          avg_lifetime_value_usd:  parseFloat(avgLTV.toFixed(2)),
          estimated_ad_budget_saved_usd: parseFloat(adBudgetSaved.toFixed(2)),
        },
        crm_email_flow: {
          description:       "Send loyalty/retention email to these HIGH-probability customers via your CRM (free channel)",
          priority_emails:   highEmails,
          subject_suggestion: "We saved something for you 👀",
        },
        ad_exclusion_list: {
          description: "Add all these emails as a Customer Match exclusion list on Google Ads & Meta to prevent wasted ad spend",
          all_emails:  allEmails,
          google_ads_format: allEmails.map((e) => ({ hashedEmail: crypto.createHash("sha256").update(e.toLowerCase().trim()).digest("hex") })),
        },
        full_customer_list: customers,
      },
    };
  } catch (err) {
    logger.error({ err }, "crossPlatform_crmArbitrage error");
    return { success: false, message: String(err) };
  }
}

// ── Sprint R+: Budget Constraint Pipeline ─────────────────────────────────────
// Exact GAQL from spec — threshold 5%, ordered by conversions DESC.
// The existing googleAds_identifyBudgetConstraints uses 10% and impression-share
// ordering; this dedicated function serves the new route + AI tool.

export async function googleAds_getBudgetConstrainedCampaigns(
  credentials: Record<string, string>,
  customerIdOverride?: string,
): Promise<ExecutionResult> {
  const rawId = (customerIdOverride ?? credentials.customerId ?? "").replace(/-/g, "");
  if (!rawId) return { success: false, message: "Google Ads Customer ID not configured." };

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign_budget.amount_micros,
      metrics.search_budget_lost_impression_share,
      metrics.cost_micros,
      metrics.conversions
    FROM campaign
    WHERE campaign.status = 'ENABLED'
      AND metrics.search_budget_lost_impression_share > 0.05
      AND segments.date DURING LAST_30_DAYS
    ORDER BY metrics.conversions DESC
    LIMIT 20
  `;

  try {
    const queryResult = await gadsRunQuery(credentials, query);
    if (!queryResult.ok) {
      logger.warn({ msg: queryResult.message }, "googleAds_getBudgetConstrainedCampaigns GAQL error");
      return {
        success: false,
        message: `Google Ads API error: ${queryResult.message}`,
        data: { raw_error: queryResult.message },
      };
    }

    const results = queryResult.rows;

    const campaigns = results.map((row) => {
      const campaign = row.campaign as Record<string, unknown>;
      const budget   = row.campaignBudget as Record<string, unknown>;
      const metrics  = row.metrics as Record<string, unknown>;

      const budgetUsd    = Number(budget?.amountMicros ?? 0) / 1_000_000;
      const spendUsd     = Number(metrics?.costMicros ?? 0) / 1_000_000;
      const lostShare    = Number(metrics?.searchBudgetLostImpressionShare ?? 0);
      const conversions  = Number(metrics?.conversions ?? 0);
      // Estimated missed conversions if the budget were not capping the campaign
      const missedConversions = conversions > 0 ? conversions * (lostShare / (1 - lostShare || 0.001)) : 0;

      return {
        campaign_id:               String(campaign?.id ?? ""),
        campaign_name:             String(campaign?.name ?? ""),
        daily_budget_usd:          parseFloat(budgetUsd.toFixed(2)),
        spend_30d_usd:             parseFloat(spendUsd.toFixed(2)),
        budget_lost_impression_pct: parseFloat((lostShare * 100).toFixed(1)),
        conversions_30d:           parseFloat(conversions.toFixed(1)),
        estimated_missed_conversions: parseFloat(missedConversions.toFixed(1)),
        recommended_daily_budget:  parseFloat((budgetUsd * (1 + lostShare)).toFixed(2)),
      };
    });

    const totalMissed = campaigns.reduce((s, c) => s + c.estimated_missed_conversions, 0);

    return {
      success: true,
      message: campaigns.length > 0
        ? `Found ${campaigns.length} budget-constrained campaign(s) (≥5% impression share lost). Estimated ${totalMissed.toFixed(0)} missed conversions over the last 30 days.`
        : "No campaigns found losing more than 5% impression share due to budget caps in the last 30 days.",
      data: {
        customer_id: rawId,
        constrained_count: campaigns.length,
        total_estimated_missed_conversions: parseFloat(totalMissed.toFixed(1)),
        campaigns,
      },
    };
  } catch (err) {
    logger.error({ err }, "googleAds_getBudgetConstrainedCampaigns error");
    return { success: false, message: String(err) };
  }
}

// ─── Google Ads — Extended READ catalog ─────────────────────────────────────
// Round out the read surface so the AI never has to refuse a query that the
// underlying API does support. Each fn uses GAQL search/searchStream and
// returns a normalised data payload.

async function gadsSearch(credentials: Record<string, string>, query: string, _tag: string): Promise<{ ok: true; rows: Array<Record<string, unknown>> } | { ok: false; message: string }> {
  return gadsRunQuery(credentials, query);
}

export async function googleAds_getCampaignBudgetDetails(
  credentials: Record<string, string>,
  campaignBudgetId: string,
): Promise<ExecutionResult> {
  const r = await gadsSearch(credentials, `
    SELECT campaign_budget.id, campaign_budget.name, campaign_budget.amount_micros,
           campaign_budget.delivery_method, campaign_budget.explicitly_shared,
           campaign_budget.reference_count, campaign_budget.status
    FROM campaign_budget
    WHERE campaign_budget.id = ${Number(campaignBudgetId)}
  `, "get-budget-details");
  if (!r.ok) return { success: false, message: r.message };
  if (r.rows.length === 0) return { success: false, message: `Campaign budget ${campaignBudgetId} not found.` };
  const b = r.rows[0].campaignBudget as Record<string, unknown>;
  const dailyUsd = Number(b.amountMicros ?? 0) / 1_000_000;
  return {
    success: true,
    message: `Budget "${b.name}" — $${dailyUsd.toFixed(2)}/day · ${b.deliveryMethod} · shared by ${b.referenceCount} campaign(s)`,
    data: {
      budget_id: String(b.id),
      name: b.name,
      daily_budget_usd: parseFloat(dailyUsd.toFixed(2)),
      delivery_method: b.deliveryMethod,
      explicitly_shared: Boolean(b.explicitlyShared),
      reference_count: Number(b.referenceCount ?? 0),
      status: b.status,
    },
  };
}

export async function googleAds_listNegativeKeywords(
  credentials: Record<string, string>,
  campaignId?: string,
): Promise<ExecutionResult> {
  const where = campaignId
    ? `WHERE campaign.id = ${Number(campaignId)} AND campaign_criterion.negative = TRUE AND campaign_criterion.type = 'KEYWORD'`
    : `WHERE campaign_criterion.negative = TRUE AND campaign_criterion.type = 'KEYWORD'`;
  const r = await gadsSearch(credentials, `
    SELECT campaign.id, campaign.name, campaign_criterion.criterion_id,
           campaign_criterion.keyword.text, campaign_criterion.keyword.match_type,
           campaign_criterion.resource_name
    FROM campaign_criterion ${where}
    LIMIT 500
  `, "list-negative-keywords");
  if (!r.ok) return { success: false, message: r.message };
  const negatives = r.rows.map((row) => {
    const c = row.campaign as Record<string, unknown>;
    const cc = row.campaignCriterion as Record<string, unknown>;
    const kw = cc.keyword as Record<string, unknown>;
    return {
      campaign_id: String(c.id), campaign_name: c.name,
      criterion_id: String(cc.criterionId), resource_name: cc.resourceName,
      keyword: kw.text, match_type: kw.matchType,
    };
  });
  return {
    success: true,
    message: negatives.length === 0 ? "No negative keywords found." : `${negatives.length} negative keyword(s) found.`,
    data: { negatives, count: negatives.length },
  };
}

export async function googleAds_listAdGroups(
  credentials: Record<string, string>,
  campaignId?: string,
): Promise<ExecutionResult> {
  const where = campaignId ? `WHERE campaign.id = ${Number(campaignId)}` : `WHERE ad_group.status != 'REMOVED'`;
  const r = await gadsSearch(credentials, `
    SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group.status,
           ad_group.type, ad_group.cpc_bid_micros,
           metrics.cost_micros, metrics.clicks, metrics.conversions
    FROM ad_group ${where} AND segments.date DURING LAST_30_DAYS
    ORDER BY metrics.cost_micros DESC LIMIT 200
  `, "list-ad-groups");
  if (!r.ok) return { success: false, message: r.message };
  const groups = r.rows.map((row) => {
    const c = row.campaign as Record<string, unknown>;
    const ag = row.adGroup as Record<string, unknown>;
    const m = (row.metrics ?? {}) as Record<string, unknown>;
    return {
      campaign_id: String(c.id), campaign_name: c.name,
      ad_group_id: String(ag.id), ad_group_name: ag.name,
      status: ag.status, type: ag.type,
      cpc_bid_usd: parseFloat((Number(ag.cpcBidMicros ?? 0) / 1_000_000).toFixed(2)),
      spend_30d_usd: parseFloat((Number(m.costMicros ?? 0) / 1_000_000).toFixed(2)),
      clicks_30d: Number(m.clicks ?? 0),
      conversions_30d: parseFloat(Number(m.conversions ?? 0).toFixed(1)),
    };
  });
  return { success: true, message: `${groups.length} ad group(s) found.`, data: { ad_groups: groups, count: groups.length } };
}

export async function googleAds_listKeywords(
  credentials: Record<string, string>,
  adGroupId: string,
): Promise<ExecutionResult> {
  const r = await gadsSearch(credentials, `
    SELECT ad_group.id, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
           ad_group_criterion.keyword.match_type, ad_group_criterion.status,
           ad_group_criterion.cpc_bid_micros, ad_group_criterion.quality_info.quality_score,
           metrics.cost_micros, metrics.clicks, metrics.conversions, metrics.average_cpc
    FROM keyword_view
    WHERE ad_group.id = ${Number(adGroupId)}
      AND ad_group_criterion.negative = FALSE
      AND segments.date DURING LAST_30_DAYS
    ORDER BY metrics.cost_micros DESC LIMIT 200
  `, "list-keywords");
  if (!r.ok) return { success: false, message: r.message };
  const keywords = r.rows.map((row) => {
    const c = row.adGroupCriterion as Record<string, unknown>;
    const kw = c.keyword as Record<string, unknown>;
    const m = (row.metrics ?? {}) as Record<string, unknown>;
    return {
      criterion_id: String(c.criterionId), keyword: kw.text, match_type: kw.matchType,
      status: c.status,
      cpc_bid_usd: parseFloat((Number(c.cpcBidMicros ?? 0) / 1_000_000).toFixed(2)),
      quality_score: Number((c.qualityInfo as Record<string, unknown>)?.qualityScore ?? 0) || null,
      spend_30d_usd: parseFloat((Number(m.costMicros ?? 0) / 1_000_000).toFixed(2)),
      clicks_30d: Number(m.clicks ?? 0),
      conversions_30d: parseFloat(Number(m.conversions ?? 0).toFixed(1)),
      avg_cpc_usd: parseFloat((Number(m.averageCpc ?? 0) / 1_000_000).toFixed(2)),
    };
  });
  return { success: true, message: `${keywords.length} keyword(s) in ad group ${adGroupId}.`, data: { keywords, count: keywords.length } };
}

export async function googleAds_listSearchTerms(
  credentials: Record<string, string>,
  campaignId?: string,
  daysBack = 30,
): Promise<ExecutionResult> {
  const dateRange = daysBack <= 7 ? "LAST_7_DAYS" : daysBack <= 30 ? "LAST_30_DAYS" : "LAST_90_DAYS";
  const where = campaignId ? `AND campaign.id = ${Number(campaignId)}` : "";
  const r = await gadsSearch(credentials, `
    SELECT search_term_view.search_term, campaign.id, campaign.name, ad_group.name,
           segments.search_term_match_type,
           metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions
    FROM search_term_view
    WHERE segments.date DURING ${dateRange} ${where}
    ORDER BY metrics.cost_micros DESC LIMIT 200
  `, "list-search-terms");
  if (!r.ok) return { success: false, message: r.message };
  const terms = r.rows.map((row) => {
    const stv = row.searchTermView as Record<string, unknown>;
    const c = row.campaign as Record<string, unknown>;
    const ag = row.adGroup as Record<string, unknown>;
    const seg = row.segments as Record<string, unknown>;
    const m = (row.metrics ?? {}) as Record<string, unknown>;
    return {
      search_term: stv.searchTerm,
      campaign_name: c.name, campaign_id: String(c.id),
      ad_group_name: ag.name, match_type: seg.searchTermMatchType,
      spend_usd: parseFloat((Number(m.costMicros ?? 0) / 1_000_000).toFixed(2)),
      impressions: Number(m.impressions ?? 0), clicks: Number(m.clicks ?? 0),
      conversions: parseFloat(Number(m.conversions ?? 0).toFixed(1)),
    };
  });
  return { success: true, message: `${terms.length} search term(s) in last ${daysBack} days.`, data: { search_terms: terms, count: terms.length, date_range: dateRange } };
}

export async function googleAds_listConversionActions(
  credentials: Record<string, string>,
): Promise<ExecutionResult> {
  const r = await gadsSearch(credentials, `
    SELECT conversion_action.id, conversion_action.name, conversion_action.status,
           conversion_action.type, conversion_action.category,
           conversion_action.primary_for_goal, conversion_action.value_settings.default_value
    FROM conversion_action
    WHERE conversion_action.status != 'REMOVED'
    ORDER BY conversion_action.name LIMIT 200
  `, "list-conversion-actions");
  if (!r.ok) return { success: false, message: r.message };
  const actions = r.rows.map((row) => {
    const ca = row.conversionAction as Record<string, unknown>;
    const vs = (ca.valueSettings ?? {}) as Record<string, unknown>;
    return {
      id: String(ca.id), name: ca.name, status: ca.status, type: ca.type,
      category: ca.category, primary_for_goal: Boolean(ca.primaryForGoal),
      default_value: Number(vs.defaultValue ?? 0),
    };
  });
  return { success: true, message: `${actions.length} conversion action(s).`, data: { conversion_actions: actions, count: actions.length } };
}

export async function googleAds_listAds(
  credentials: Record<string, string>,
  adGroupId?: string,
): Promise<ExecutionResult> {
  const where = adGroupId
    ? `WHERE ad_group.id = ${Number(adGroupId)} AND ad_group_ad.status != 'REMOVED'`
    : `WHERE ad_group_ad.status != 'REMOVED'`;
  const r = await gadsSearch(credentials, `
    SELECT ad_group.id, ad_group.name, ad_group_ad.ad.id, ad_group_ad.ad.type,
           ad_group_ad.status, ad_group_ad.ad.final_urls, ad_group_ad.resource_name,
           metrics.cost_micros, metrics.clicks, metrics.conversions
    FROM ad_group_ad ${where} AND segments.date DURING LAST_30_DAYS
    ORDER BY metrics.cost_micros DESC LIMIT 200
  `, "list-ads");
  if (!r.ok) return { success: false, message: r.message };
  const ads = r.rows.map((row) => {
    const ag = row.adGroup as Record<string, unknown>;
    const aga = row.adGroupAd as Record<string, unknown>;
    const ad = aga.ad as Record<string, unknown>;
    const m = (row.metrics ?? {}) as Record<string, unknown>;
    return {
      ad_group_id: String(ag.id), ad_group_name: ag.name,
      ad_id: String(ad.id), ad_type: ad.type, status: aga.status,
      final_urls: ad.finalUrls ?? [], resource_name: aga.resourceName,
      spend_30d_usd: parseFloat((Number(m.costMicros ?? 0) / 1_000_000).toFixed(2)),
      clicks_30d: Number(m.clicks ?? 0),
      conversions_30d: parseFloat(Number(m.conversions ?? 0).toFixed(1)),
    };
  });
  return { success: true, message: `${ads.length} ad(s) found.`, data: { ads, count: ads.length } };
}

export async function googleAds_listRecommendations(
  credentials: Record<string, string>,
  type?: string,
): Promise<ExecutionResult> {
  const where = type ? `WHERE recommendation.type = '${type.replace(/[^A-Z_]/g, "")}'` : "";
  const r = await gadsSearch(credentials, `
    SELECT recommendation.resource_name, recommendation.type, recommendation.dismissed,
           recommendation.campaign, recommendation.impact.base_metrics.impressions,
           recommendation.impact.base_metrics.clicks, recommendation.impact.base_metrics.cost_micros,
           recommendation.impact.potential_metrics.impressions,
           recommendation.impact.potential_metrics.clicks,
           recommendation.impact.potential_metrics.cost_micros
    FROM recommendation ${where} LIMIT 100
  `, "list-recommendations");
  if (!r.ok) return { success: false, message: r.message };
  const recs = r.rows.map((row) => {
    const rec = row.recommendation as Record<string, unknown>;
    const impact = (rec.impact ?? {}) as Record<string, unknown>;
    const base = (impact.baseMetrics ?? {}) as Record<string, unknown>;
    const pot = (impact.potentialMetrics ?? {}) as Record<string, unknown>;
    return {
      resource_name: rec.resourceName, type: rec.type, dismissed: Boolean(rec.dismissed),
      campaign: rec.campaign,
      base_clicks: Number(base.clicks ?? 0),
      base_cost_usd: parseFloat((Number(base.costMicros ?? 0) / 1_000_000).toFixed(2)),
      potential_clicks: Number(pot.clicks ?? 0),
      potential_cost_usd: parseFloat((Number(pot.costMicros ?? 0) / 1_000_000).toFixed(2)),
    };
  });
  return { success: true, message: `${recs.length} recommendation(s) available.`, data: { recommendations: recs, count: recs.length } };
}

// ─── Google Ads — Extended EXECUTE catalog ──────────────────────────────────

export async function googleAds_createCampaignBudget(
  credentials: Record<string, string>,
  name: string,
  dailyBudgetUsd: number,
  deliveryMethod: "STANDARD" | "ACCELERATED" = "STANDARD",
  options: MutateExecOptions = {},
): Promise<ExecutionResult> {
  const amountMicros = Math.round(dailyBudgetUsd * 1_000_000);
  try {
    const customer = customerFromCreds(credentials);
    const result = await runSingleMutate(customer, {
      entity: "campaign_budget",
      operation: "create",
      resource: {
        name,
        amount_micros: amountMicros,
        delivery_method: deliveryMethod === "ACCELERATED" ? enums.BudgetDeliveryMethod.ACCELERATED : enums.BudgetDeliveryMethod.STANDARD,
        explicitly_shared: false,
      },
    }, options);
    if (!result.ok) {
      return { success: false, message: `Google Ads API error: ${failureMessage(result.failures)}`, data: { partialFailures: result.failures } };
    }
    const rn = result.resourceName ?? "";
    const budgetId = rn.split("/").pop() ?? "";
    return { success: true, message: `Budget "${name}" created — $${dailyBudgetUsd.toFixed(2)}/day · ID ${budgetId}`, data: { budget_id: budgetId, resource_name: rn } };
  } catch (err) {
    logger.error({ err }, "googleAds_createCampaignBudget error");
    return { success: false, message: `Google Ads API error: ${formatGoogleAdsError(err)}` };
  }
}

export async function googleAds_updateAdGroupStatus(
  credentials: Record<string, string>,
  adGroupId: string,
  status: "ENABLED" | "PAUSED",
  options: MutateExecOptions = {},
): Promise<ExecutionResult> {
  const customerId = adsCustomerId(credentials);
  try {
    const customer = customerFromCreds(credentials);
    const result = await runSingleMutate(customer, {
      entity: "ad_group",
      operation: "update",
      resource: {
        resource_name: `customers/${customerId}/adGroups/${adGroupId}`,
        status: status === "ENABLED" ? enums.AdGroupStatus.ENABLED : enums.AdGroupStatus.PAUSED,
      },
    }, options);
    if (!result.ok) {
      return { success: false, message: `Google Ads API error: ${failureMessage(result.failures)}`, data: { partialFailures: result.failures } };
    }
    return { success: true, message: `Ad group ${adGroupId} set to ${status}.` };
  } catch (err) {
    logger.error({ err }, "googleAds_updateAdGroupStatus error");
    return { success: false, message: `Google Ads API error: ${formatGoogleAdsError(err)}` };
  }
}

export async function googleAds_updateAdStatus(
  credentials: Record<string, string>,
  adGroupAdResourceName: string,
  status: "ENABLED" | "PAUSED",
  options: MutateExecOptions = {},
): Promise<ExecutionResult> {
  try {
    const customer = customerFromCreds(credentials);
    const result = await runSingleMutate(customer, {
      entity: "ad_group_ad",
      operation: "update",
      resource: {
        resource_name: adGroupAdResourceName,
        status: status === "ENABLED" ? enums.AdGroupAdStatus.ENABLED : enums.AdGroupAdStatus.PAUSED,
      },
    }, options);
    if (!result.ok) {
      return { success: false, message: `Google Ads API error: ${failureMessage(result.failures)}`, data: { partialFailures: result.failures } };
    }
    return { success: true, message: `Ad set to ${status}.` };
  } catch (err) {
    logger.error({ err }, "googleAds_updateAdStatus error");
    return { success: false, message: `Google Ads API error: ${formatGoogleAdsError(err)}` };
  }
}

export async function googleAds_addPositiveKeyword(
  credentials: Record<string, string>,
  adGroupId: string,
  keyword: string,
  matchType: "EXACT" | "PHRASE" | "BROAD",
  cpcBidUsd?: number,
  options: MutateExecOptions = {},
): Promise<ExecutionResult> {
  const customerId = adsCustomerId(credentials);
  const matchTypeEnum = matchType === "EXACT"
    ? enums.KeywordMatchType.EXACT
    : matchType === "PHRASE"
      ? enums.KeywordMatchType.PHRASE
      : enums.KeywordMatchType.BROAD;
  const resource: Record<string, unknown> = {
    ad_group: `customers/${customerId}/adGroups/${adGroupId}`,
    status: enums.AdGroupCriterionStatus.ENABLED,
    keyword: { text: keyword, match_type: matchTypeEnum },
  };
  if (cpcBidUsd != null) resource.cpc_bid_micros = Math.round(cpcBidUsd * 1_000_000);
  try {
    const customer = customerFromCreds(credentials);
    const result = await runSingleMutate(customer, {
      entity: "ad_group_criterion",
      operation: "create",
      resource,
    }, options);
    if (!result.ok) {
      return { success: false, message: `Google Ads API error: ${failureMessage(result.failures)}`, data: { partialFailures: result.failures } };
    }
    return { success: true, message: `Keyword "${keyword}" (${matchType})${cpcBidUsd != null ? ` @ $${cpcBidUsd.toFixed(2)} CPC` : ""} added to ad group ${adGroupId}.` };
  } catch (err) {
    logger.error({ err }, "googleAds_addPositiveKeyword error");
    return { success: false, message: `Google Ads API error: ${formatGoogleAdsError(err)}` };
  }
}

export async function googleAds_updateKeywordBid(
  credentials: Record<string, string>,
  criterionResourceName: string,
  cpcBidUsd: number,
  options: MutateExecOptions = {},
): Promise<ExecutionResult> {
  try {
    const customer = customerFromCreds(credentials);
    const result = await runSingleMutate(customer, {
      entity: "ad_group_criterion",
      operation: "update",
      resource: {
        resource_name: criterionResourceName,
        cpc_bid_micros: Math.round(cpcBidUsd * 1_000_000),
      },
    }, options);
    if (!result.ok) {
      return { success: false, message: `Google Ads API error: ${failureMessage(result.failures)}`, data: { partialFailures: result.failures } };
    }
    return { success: true, message: `Keyword CPC bid updated to $${cpcBidUsd.toFixed(2)}.` };
  } catch (err) {
    logger.error({ err }, "googleAds_updateKeywordBid error");
    return { success: false, message: `Google Ads API error: ${formatGoogleAdsError(err)}` };
  }
}

export async function googleAds_removeNegativeKeyword(
  credentials: Record<string, string>,
  criterionResourceName: string,
  options: MutateExecOptions = {},
): Promise<ExecutionResult> {
  try {
    const customer = customerFromCreds(credentials);
    const result = await runSingleMutate(customer, {
      entity: "campaign_criterion",
      operation: "remove",
      resource: { resource_name: criterionResourceName },
    }, options);
    if (!result.ok) {
      return { success: false, message: `Google Ads API error: ${failureMessage(result.failures)}`, data: { partialFailures: result.failures } };
    }
    return { success: true, message: `Negative keyword removed.` };
  } catch (err) {
    logger.error({ err }, "googleAds_removeNegativeKeyword error");
    return { success: false, message: `Google Ads API error: ${formatGoogleAdsError(err)}` };
  }
}

export async function googleAds_applyRecommendation(
  credentials: Record<string, string>,
  recommendationResourceName: string,
  options: MutateExecOptions = {},
): Promise<ExecutionResult> {
  const customerId = adsCustomerId(credentials);
  // ApplyRecommendation has no server-side validate_only. Short-circuit BEFORE
  // making the API call so dry-run never mutates the account.
  if (options.validateOnly) {
    return { success: true, message: `Dry-run only — recommendation ${recommendationResourceName} would be applied (RecommendationService.applyRecommendation has no server-side validate_only; the call was skipped).`, data: { dry_run: true } };
  }
  try {
    const customer = customerFromCreds(credentials);
    const response = await customer.recommendations.applyRecommendation(
      services.ApplyRecommendationRequest.create({
        customer_id: customerId,
        operations: [{ resource_name: recommendationResourceName }],
        partial_failure: true,
      }),
    );
    const failures = extractPartialFailures(response);
    if (failures.length) {
      return { success: false, message: `Google Ads API error: ${failureMessage(failures)}`, data: { partialFailures: failures } };
    }
    return { success: true, message: `Recommendation applied.` };
  } catch (err) {
    logger.error({ err }, "googleAds_applyRecommendation error");
    return { success: false, message: `Google Ads API error: ${formatGoogleAdsError(err)}` };
  }
}
