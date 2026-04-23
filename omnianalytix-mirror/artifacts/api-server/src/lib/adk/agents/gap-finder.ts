import { LlmAgent } from "@google/adk";
import {
  listCampaignsTool,
  computePOASTool,
  calculateSalesVelocityTool,
  getStoreInventoryHealthTool,
  getStoreRevenueSummaryTool,
  queryWarehouseTool,
  optimizeProductFeedTool,
  generateFeedRewritesTool,
} from "../platform-tools";
import {
  shoppingTopProductsTool,
  shoppingProductIssuesTool,
} from "../shopping-insider-tools";
import {
  renderPrompt,
  getPromptDescription,
} from "../../../agents/infrastructure/prompts/loader";

export const gapFinderAgent = new LlmAgent({
  name: "gap_finder",
  description: getPromptDescription("gap-finder"),
  model: "gemini-2.5-pro",
  instruction: renderPrompt("gap-finder"),
  tools: [
    listCampaignsTool,
    computePOASTool,
    calculateSalesVelocityTool,
    getStoreInventoryHealthTool,
    getStoreRevenueSummaryTool,
    queryWarehouseTool,
    shoppingTopProductsTool,
    shoppingProductIssuesTool,
    optimizeProductFeedTool,
    generateFeedRewritesTool,
  ],
});
