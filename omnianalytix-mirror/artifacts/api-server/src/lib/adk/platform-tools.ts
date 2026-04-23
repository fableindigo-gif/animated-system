import { FunctionTool as RawFunctionTool } from "@google/adk";
import type { Context } from "@google/adk";
import { db, platformConnections } from "@workspace/db";
import { eq } from "drizzle-orm";
import { dispatchToolCall } from "../gemini-tools";
import { buildFreshGoogleCredentialsMap } from "../google-token-refresh";
import { decryptCredentials } from "../credential-helpers";
import { merchantProductSchema } from "../shoptimizer-client";
import { optimizeOne } from "../../services/shoptimizer-service";
import { getToolDescription } from "../../agents/infrastructure/prompts/loader";

type LooseSchema = {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  items?: unknown;
  enum?: string[];
  description?: string;
};

interface LooseFunctionToolOptions {
  name?: string;
  description: string;
  parameters?: LooseSchema;
  execute: (args: Record<string, unknown>, ctx?: Context) => Promise<unknown> | unknown;
  isLongRunning?: boolean;
}

const FunctionTool = RawFunctionTool as unknown as new (
  opts: LooseFunctionToolOptions,
) => RawFunctionTool;

export interface AdkSessionState {
  orgId: number;
  workspaceId: number;
  userId: number;
}

async function loadCredentials(orgId: number, _workspaceId: number) {
  const connections = await db
    .select()
    .from(platformConnections)
    .where(eq(platformConnections.organizationId, orgId));

  const credMap: Record<string, Record<string, string>> = {};
  for (const conn of connections) {
    try {
      const decrypted = await decryptCredentials(conn.credentials as Record<string, string>);
      credMap[conn.platform] = decrypted;
    } catch {
      // skip broken creds
    }
  }

  const refreshed = await buildFreshGoogleCredentialsMap(
    Object.keys(credMap),
    credMap,
    orgId,
  );
  return refreshed;
}

function getSessionState(ctx: Context): AdkSessionState | null {
  const state = ctx.invocationContext?.session?.state as Record<string, unknown> | undefined;
  if (!state) return null;
  const orgId = typeof state.orgId === "number" ? state.orgId : null;
  const workspaceId = typeof state.workspaceId === "number" ? state.workspaceId : null;
  const userId = typeof state.userId === "number" ? state.userId : null;
  if (!orgId || !workspaceId || !userId) return null;
  return { orgId, workspaceId, userId };
}

async function callTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: Context,
): Promise<Record<string, unknown>> {
  const session = getSessionState(ctx);
  if (!session) {
    return { success: false, message: "Missing org/workspace context in session." };
  }

  const creds = await loadCredentials(session.orgId, session.workspaceId);
  const result = await dispatchToolCall(toolName, args, creds, {
    workspaceId: session.workspaceId,
    organizationId: session.orgId,
  });
  return result as Record<string, unknown>;
}

export const listCampaignsTool = new FunctionTool({
  name: "list_campaigns",
  description: getToolDescription("list_campaigns"),
  parameters: {
    type: "object",
    properties: {
      customer_id: {
        type: "string",
        description: "Optional Google Ads customer ID. Omit to use the connected account.",
      },
    },
    required: [],
  },
  execute: async (args, ctx) => {
    return callTool("googleAds_listCampaigns", args, ctx as Context);
  },
});

export const identifyBudgetConstraintsTool = new FunctionTool({
  name: "identify_budget_constraints",
  description: getToolDescription("identify_budget_constraints"),
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async (args, ctx) => {
    return callTool("identify_budget_constraints", args, ctx as Context);
  },
});

export const calculateAccountHeadroomTool = new FunctionTool({
  name: "calculate_account_headroom",
  description: getToolDescription("calculate_account_headroom"),
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async (args, ctx) => {
    return callTool("calculate_account_headroom", args, ctx as Context);
  },
});

export const computePOASTool = new FunctionTool({
  name: "compute_poas",
  description: getToolDescription("compute_poas"),
  parameters: {
    type: "object",
    properties: {
      productId: {
        type: "string",
        description: "Shopify product ID to analyze.",
      },
      adSpendUsd: {
        type: "number",
        description: "Total ad spend attributed to this product in USD.",
      },
      adAttributedRevenue: {
        type: "number",
        description: "Total ad-attributed revenue in USD.",
      },
      shopifyFeePercent: {
        type: "number",
        description: "Shopify transaction fee percentage (default: 2.9%).",
      },
      shippingCostPerOrder: {
        type: "number",
        description: "Average shipping cost per order in USD (default: 0).",
      },
      returnRatePercent: {
        type: "number",
        description: "Estimated return rate as percentage (default: 5%).",
      },
    },
    required: ["productId", "adSpendUsd", "adAttributedRevenue"],
  },
  execute: async (args, ctx) => {
    return callTool("shopify_computePOASMetrics", args, ctx as Context);
  },
});

export const calculateSalesVelocityTool = new FunctionTool({
  name: "calculate_sales_velocity",
  description: getToolDescription("calculate_sales_velocity"),
  parameters: {
    type: "object",
    properties: {
      product_id: {
        type: "string",
        description: "Shopify product ID to analyze.",
      },
    },
    required: ["product_id"],
  },
  execute: async (args, ctx) => {
    return callTool("calculate_sales_velocity", args, ctx as Context);
  },
});

export const getStoreInventoryHealthTool = new FunctionTool({
  name: "get_store_inventory_health",
  description: getToolDescription("get_store_inventory_health"),
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async (args, ctx) => {
    return callTool("get_store_inventory_health", args, ctx as Context);
  },
});

export const getStoreRevenueSummaryTool = new FunctionTool({
  name: "get_store_revenue_summary",
  description: getToolDescription("get_store_revenue_summary"),
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async (args, ctx) => {
    return callTool("get_store_revenue_summary", args, ctx as Context);
  },
});

export const detectAutomationChurnTool = new FunctionTool({
  name: "detect_automation_churn",
  description: getToolDescription("detect_automation_churn"),
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async (args, ctx) => {
    return callTool("detect_automation_churn", args, ctx as Context);
  },
});

export const optimizeProductFeedTool = new FunctionTool({
  name: "optimize_product_feed",
  description: getToolDescription("optimize_product_feed"),
  parameters: {
    type: "object",
    properties: {
      product: {
        type: "object",
        description:
          "Merchant Center product payload. MUST include `offerId`. Other fields (title, description, brand, gtin, color, sizes, googleProductCategory, identifierExists, etc.) are optional and forwarded as-is.",
      },
      pluginSettings: {
        type: "object",
        description:
          "Optional Shoptimizer plugin settings (e.g. enabling/disabling individual plugins). See the Shoptimizer docs.",
      },
    },
    required: ["product"],
  },
  execute: async (args) => {
    const a = args as { product?: unknown; pluginSettings?: Record<string, unknown> };
    const parsed = merchantProductSchema.safeParse(a.product);
    if (!parsed.success) {
      return {
        success: false,
        message: "Invalid product payload: " + parsed.error.message,
      };
    }
    const result = await optimizeOne({
      product: parsed.data,
      pluginSettings: a.pluginSettings,
    });
    if (!result.ok) {
      return {
        success: false,
        code: result.code,
        message: result.error,
        offerId: result.offerId,
      };
    }
    return {
      success: true,
      offerId: result.offerId,
      pluginsFired: result.diff.pluginsFired,
      changeCount: result.diff.changeCount,
      changedFields: result.diff.changedFields,
      optimizedProduct: result.optimized,
    };
  },
});

export const generateFeedRewritesTool = new FunctionTool({
  name: "generate_feed_rewrites",
  description: getToolDescription("generate_feed_rewrites"),
  parameters: {
    type: "object",
    properties: {
      productIds: {
        type: "array",
        items: { type: "string" },
        description:
          "Specific warehouse product IDs to rewrite (max 25). Use this when the user named SKUs explicitly.",
      },
      maxProducts: {
        type: "number",
        description:
          "When productIds is omitted, the worker auto-selects up to this many SKUs (default 10, max 25).",
      },
      mode: {
        type: "string",
        enum: ["underperformer", "stale"],
        description:
          "Selection strategy when productIds is omitted. 'underperformer' (default) ranks SKUs by ascending gross ROAS from the per-tenant v_poas_by_sku view (Shopping Insider / GAARF data), tie-broken by total ad spend DESC. 'stale' falls back to price DESC for tenants without ROAS data.",
      },
    },
    required: [],
  },
  execute: async (args, ctx) => {
    const session = getSessionState(ctx as Context);
    if (!session) {
      return { success: false, message: "Missing org/workspace context in session." };
    }
    const a = args as { productIds?: string[]; maxProducts?: number; mode?: "underperformer" | "stale" };
    const { runFeedgenScan } = await import("../../workers/feedgen-runner");
    const result = await runFeedgenScan({
      tenantId:    String(session.orgId),
      productIds:  Array.isArray(a.productIds) && a.productIds.length > 0
        ? a.productIds.slice(0, 25)
        : undefined,
      maxProducts: typeof a.maxProducts === "number"
        ? Math.max(1, Math.min(a.maxProducts, 25))
        : 10,
      mode:        a.mode === "stale" || a.mode === "underperformer" ? a.mode : "underperformer",
    });
    return { success: true, ...result };
  },
});

export const queryWarehouseTool = new FunctionTool({
  name: "query_warehouse",
  description: getToolDescription("query_warehouse"),
  parameters: {
    type: "object",
    properties: {
      sql: {
        type: "string",
        description: "Read-only SQL SELECT query to execute against the warehouse.",
      },
      limit: {
        type: "number",
        description: "Maximum rows to return (default 50, max 200).",
      },
    },
    required: ["sql"],
  },
  execute: async (args, ctx) => {
    return callTool("query_warehouse", args, ctx as Context);
  },
});
