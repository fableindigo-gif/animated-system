import { LlmAgent } from "@google/adk";
import { gapFinderAgent } from "./gap-finder";
import { growthEngineAgent } from "./growth-engine";
import {
  listCampaignsTool,
  getStoreRevenueSummaryTool,
  getStoreInventoryHealthTool,
} from "../platform-tools";
import {
  renderPrompt,
  getPromptDescription,
} from "../../../agents/infrastructure/prompts/loader";

export const orgCeoAgent = new LlmAgent({
  name: "org_ceo",
  description: getPromptDescription("org-ceo"),
  model: "gemini-2.5-pro",
  instruction: renderPrompt("org-ceo"),
  subAgents: [gapFinderAgent, growthEngineAgent],
  tools: [listCampaignsTool, getStoreRevenueSummaryTool, getStoreInventoryHealthTool],
});
