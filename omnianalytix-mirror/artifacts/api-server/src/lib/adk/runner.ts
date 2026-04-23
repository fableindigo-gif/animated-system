import { Runner } from "@google/adk";
import { ensureAdkCredentials } from "./setup";
import { orgCeoAgent } from "./agents/org-ceo";
import { drizzleSessionService, startSessionCleanup } from "./drizzle-session-service";

ensureAdkCredentials();

export const sessionService = drizzleSessionService;

export const adkRunner = new Runner({
  agent: orgCeoAgent,
  appName: "omnianalytix",
  sessionService,
});

startSessionCleanup();

export type { Runner };
