import { FunctionTool as RawFunctionTool, type Context } from "@google/adk";
import {
  getCampaignPerformance,
  getProductPerformance,
  getProductIssues,
  getAccountHealth,
  type ProductSortBy,
} from "../../services/shopping-insider";
import { BigQueryConfigError } from "../bigquery-client";
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

async function safeRun<T>(fn: () => Promise<T>) {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (err) {
    if (err instanceof BigQueryConfigError) {
      return {
        success: false,
        message:
          "Shopping Insider BigQuery is not configured on the API server. Ask an admin to set the SHOPPING_INSIDER_* environment variables (see api-server/SHOPPING_INSIDER.md).",
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Shopping Insider query failed: ${message}` };
  }
}

export const shoppingCampaignPerformanceTool = new FunctionTool({
  name: "shopping_campaign_performance",
  description: getToolDescription("shopping_campaign_performance"),
  parameters: {
    type: "object",
    properties: {
      start_date: { type: "string", description: "ISO date YYYY-MM-DD. Defaults to 28 days ago." },
      end_date: { type: "string", description: "ISO date YYYY-MM-DD. Defaults to today." },
      customer_id: { type: "string", description: "Optional Google Ads customer ID to filter to a single account." },
      country: { type: "string", description: "Optional ISO country code (e.g. US, GB) to restrict results." },
      limit: { type: "number", description: "Max campaigns to return (default 100, max 1000)." },
    },
    required: [],
  },
  execute: async (args) => {
    return safeRun(() =>
      getCampaignPerformance({
        range: { startDate: args.start_date as string | undefined, endDate: args.end_date as string | undefined },
        customerId: args.customer_id as string | undefined,
        country: args.country as string | undefined,
        limit: args.limit as number | undefined,
      }),
    );
  },
});

export const shoppingTopProductsTool = new FunctionTool({
  name: "shopping_top_products",
  description: getToolDescription("shopping_top_products"),
  parameters: {
    type: "object",
    properties: {
      start_date: { type: "string", description: "ISO date YYYY-MM-DD. Defaults to 28 days ago." },
      end_date: { type: "string", description: "ISO date YYYY-MM-DD. Defaults to today." },
      sort_by: {
        type: "string",
        enum: ["conversions", "conversion_value", "roas", "cost", "clicks"],
        description: "Metric to rank by. Default conversion_value.",
      },
      direction: {
        type: "string",
        enum: ["top", "bottom"],
        description: "Top performers (default) or bottom performers.",
      },
      merchant_id: { type: "string", description: "Optional Merchant Center ID filter." },
      country: { type: "string", description: "Optional ISO country code filter." },
      limit: { type: "number", description: "Max products to return (default 25, max 500)." },
    },
    required: [],
  },
  execute: async (args) => {
    return safeRun(() =>
      getProductPerformance({
        range: { startDate: args.start_date as string | undefined, endDate: args.end_date as string | undefined },
        sortBy: args.sort_by as ProductSortBy | undefined,
        direction: args.direction === "bottom" ? "bottom" : "top",
        merchantId: args.merchant_id as string | undefined,
        country: args.country as string | undefined,
        limit: args.limit as number | undefined,
      }),
    );
  },
});

export const shoppingProductIssuesTool = new FunctionTool({
  name: "shopping_product_issues",
  description: getToolDescription("shopping_product_issues"),
  parameters: {
    type: "object",
    properties: {
      merchant_id: { type: "string", description: "Optional Merchant Center ID filter." },
      country: { type: "string", description: "Optional ISO country code filter." },
      servability: {
        type: "string",
        enum: ["disapproved", "demoted", "all"],
        description: "Filter by servability status. Default returns all.",
      },
      limit: { type: "number", description: "Max issue rows to return (default 100, max 1000)." },
    },
    required: [],
  },
  execute: async (args) => {
    return safeRun(() =>
      getProductIssues({
        merchantId: args.merchant_id as string | undefined,
        country: args.country as string | undefined,
        servability: args.servability as "disapproved" | "demoted" | "all" | undefined,
        limit: args.limit as number | undefined,
      }),
    );
  },
});

export const shoppingAccountHealthTool = new FunctionTool({
  name: "shopping_account_health",
  description: getToolDescription("shopping_account_health"),
  parameters: {
    type: "object",
    properties: {
      merchant_id: { type: "string", description: "Optional Merchant Center ID filter." },
    },
    required: [],
  },
  execute: async (args) => {
    return safeRun(() => getAccountHealth({ merchantId: args.merchant_id as string | undefined }));
  },
});

export const shoppingInsiderTools = [
  shoppingCampaignPerformanceTool,
  shoppingTopProductsTool,
  shoppingProductIssuesTool,
  shoppingAccountHealthTool,
];
