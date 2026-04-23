import { LlmAgent } from "@google/adk";
import {
  listCampaignsTool,
  identifyBudgetConstraintsTool,
  calculateAccountHeadroomTool,
  detectAutomationChurnTool,
  queryWarehouseTool,
} from "../platform-tools";
import {
  shoppingCampaignPerformanceTool,
  shoppingTopProductsTool,
  shoppingProductIssuesTool,
  shoppingAccountHealthTool,
} from "../shopping-insider-tools";
import {
  renderPrompt,
  getPromptDescription,
} from "../../../agents/infrastructure/prompts/loader";

export const growthEngineAgent = new LlmAgent({
  name: "growth_engine",
  description: getPromptDescription("growth-engine"),
  model: "gemini-2.5-pro",
  instruction: renderPrompt("growth-engine"),
  tools: [
    listCampaignsTool,
    identifyBudgetConstraintsTool,
    calculateAccountHeadroomTool,
    detectAutomationChurnTool,
    queryWarehouseTool,
    shoppingCampaignPerformanceTool,
    shoppingTopProductsTool,
    shoppingProductIssuesTool,
    shoppingAccountHealthTool,
  ],
});
