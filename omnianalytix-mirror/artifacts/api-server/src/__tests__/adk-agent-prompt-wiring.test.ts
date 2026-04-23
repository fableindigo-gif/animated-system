/**
 * ADK Agent Prompt-Wiring Tests
 *
 * Verifies that each live ADK agent (org_ceo, gap_finder, growth_engine,
 * omni_analytix_agent) wires its `instruction` property to the rendered
 * output of its matching .prompt file via the Dotprompt loader — not to a
 * hardcoded inline string.
 *
 * Also asserts that the loader aborts boot with a clear [prompts]-prefixed
 * error when a .prompt source is malformed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ──────────────────────────────────────────────────────────────────────────────
// Module mocks (top-level so Vitest hoisting works correctly)
// ──────────────────────────────────────────────────────────────────────────────

/** Map agent name → options passed to the LlmAgent constructor. */
const capturedAgents = new Map<string, Record<string, unknown>>();

vi.mock("@google/adk", () => {
  class LlmAgent {
    constructor(opts: Record<string, unknown>) {
      capturedAgents.set(opts.name as string, opts);
    }
  }
  class Runner {
    constructor(_opts: unknown) {}
  }
  class FunctionTool {
    constructor(_opts: unknown) {}
  }
  return { LlmAgent, Runner, FunctionTool };
});

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), insert: vi.fn() },
  warehouseGoogleAds:       {},
  warehouseShopifyProducts: {},
  liveTriageAlerts:         {},
  platformConnections:      {},
  workspaces:               {},
  adkSessions:              {},
  biAdPerformance:          {},
  sql:     vi.fn(),
  and:     vi.fn(),
  eq:      vi.fn(),
  desc:    vi.fn(),
  gte:     vi.fn(),
  lte:     vi.fn(),
  ne:      vi.fn(),
  isNull:  vi.fn(),
  inArray: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/system-health-monitor", () => ({
  getLastHealthResults: vi.fn(() => ({ results: [], lastRunAt: null })),
}));

vi.mock("../lib/google-token-refresh", () => ({
  getFreshGoogleCredentials: vi.fn(),
}));

vi.mock("../lib/credential-helpers", () => ({
  decryptCredentials: vi.fn(),
}));

vi.mock("../lib/adk/drizzle-session-service", () => ({
  drizzleSessionService: {},
  startSessionCleanup:   vi.fn(),
}));

vi.mock("../lib/adk/platform-tools", () => ({
  listCampaignsTool:             {},
  getStoreRevenueSummaryTool:    {},
  getStoreInventoryHealthTool:   {},
  computePOASTool:               {},
  calculateSalesVelocityTool:    {},
  queryWarehouseTool:            {},
  optimizeProductFeedTool:       {},
  identifyBudgetConstraintsTool: {},
  calculateAccountHeadroomTool:  {},
  detectAutomationChurnTool:     {},
}));

vi.mock("../lib/adk/shopping-insider-tools", () => ({
  shoppingTopProductsTool:         {},
  shoppingProductIssuesTool:       {},
  shoppingCampaignPerformanceTool: {},
  shoppingAccountHealthTool:       {},
}));

// ──────────────────────────────────────────────────────────────────────────────
// Paths (relative to this test file: src/__tests__/)
// ──────────────────────────────────────────────────────────────────────────────

const LOADER_PATH = "../agents/infrastructure/prompts/loader";
const PROMPTS_DIR = "../agents/infrastructure/prompts";

const REAL_PROMPT_FILES = [
  "omni-assistant",
  "org-ceo",
  "gap-finder",
  "growth-engine",
] as const;
type RealPromptFile = (typeof REAL_PROMPT_FILES)[number];

// ──────────────────────────────────────────────────────────────────────────────
// Sub-agent prompt wiring: org_ceo, gap_finder, growth_engine
//
// Each test resets the module registry so the agent module re-executes its
// top-level LlmAgent construction, allowing capturedAgents to be freshly
// populated for every test.
// ──────────────────────────────────────────────────────────────────────────────

describe("ADK sub-agent prompt wiring", () => {
  beforeEach(() => {
    vi.resetModules();
    capturedAgents.clear();
  });

  it('org_ceo: instruction equals renderPrompt("org-ceo")', async () => {
    const [loaderMod] = await Promise.all([
      import(LOADER_PATH),
      import("../lib/adk/agents/org-ceo"),
    ]);
    const { renderPrompt } = loaderMod as { renderPrompt: (name: string) => string };

    const expected = renderPrompt("org-ceo");
    expect(typeof expected).toBe("string");
    expect(expected.length).toBeGreaterThan(0);

    const captured = capturedAgents.get("org_ceo");
    expect(captured, 'LlmAgent was not constructed with name "org_ceo"').toBeDefined();
    expect(captured!.instruction).toBe(expected);
  });

  it('gap_finder: instruction equals renderPrompt("gap-finder")', async () => {
    const [loaderMod] = await Promise.all([
      import(LOADER_PATH),
      import("../lib/adk/agents/gap-finder"),
    ]);
    const { renderPrompt } = loaderMod as { renderPrompt: (name: string) => string };

    const expected = renderPrompt("gap-finder");
    expect(typeof expected).toBe("string");
    expect(expected.length).toBeGreaterThan(0);

    const captured = capturedAgents.get("gap_finder");
    expect(captured, 'LlmAgent was not constructed with name "gap_finder"').toBeDefined();
    expect(captured!.instruction).toBe(expected);
  });

  it('growth_engine: instruction equals renderPrompt("growth-engine")', async () => {
    const [loaderMod] = await Promise.all([
      import(LOADER_PATH),
      import("../lib/adk/agents/growth-engine"),
    ]);
    const { renderPrompt } = loaderMod as { renderPrompt: (name: string) => string };

    const expected = renderPrompt("growth-engine");
    expect(typeof expected).toBe("string");
    expect(expected.length).toBeGreaterThan(0);

    const captured = capturedAgents.get("growth_engine");
    expect(captured, 'LlmAgent was not constructed with name "growth_engine"').toBeDefined();
    expect(captured!.instruction).toBe(expected);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// omni_analytix_agent prompt wiring
//
// This agent is constructed lazily inside getRunner() (not exported). We
// trigger it via the exported runAdkAgent(), which internally calls getRunner.
// The call will throw after construction (mocked session service has no
// methods) — that's fine, capturedAgents is already populated by then.
//
// IMPORTANT: GEMINI_API_KEY must be set BEFORE the adk-agent module is
// imported because the module captures it at the top level:
//   const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// ──────────────────────────────────────────────────────────────────────────────

describe("omni_analytix_agent prompt wiring", () => {
  beforeEach(() => {
    vi.resetModules();
    capturedAgents.clear();
  });

  it('instruction equals renderPrompt("omni-assistant")', async () => {
    process.env.GEMINI_API_KEY = "test-key";

    type RunFn = (prompt: string, userId: string, sessionId?: string, orgId?: number | null) => Promise<unknown>;
    let runAdkAgent: RunFn;
    let renderPrompt: (name: string) => string;

    try {
      const [loaderMod, agentMod] = await Promise.all([
        import(LOADER_PATH),
        import("../services/adk-agent"),
      ]);
      renderPrompt = (loaderMod as { renderPrompt: (name: string) => string }).renderPrompt;
      runAdkAgent  = (agentMod as { runAdkAgent: RunFn }).runAdkAgent;
    } finally {
      delete process.env.GEMINI_API_KEY;
    }

    const expected = renderPrompt("omni-assistant");
    expect(typeof expected).toBe("string");
    expect(expected.length).toBeGreaterThan(0);

    try {
      await runAdkAgent("hi", "u1", undefined, null);
    } catch {
      // Expected — mocked runner has no .run() method.
    }

    const captured = capturedAgents.get("omni_analytix_agent");
    expect(captured, 'LlmAgent("omni_analytix_agent") was never constructed').toBeDefined();
    expect(captured!.instruction).toBe(expected);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Boot-time failure guard
//
// The loader runs eagerly at import time (top-level await). A malformed prompt
// must abort the whole module with a [prompts]-scoped error so no agent can
// silently start with a broken instruction.
// ──────────────────────────────────────────────────────────────────────────────

function mockPromptSources(sources: Partial<Record<RealPromptFile, string>>) {
  for (const name of REAL_PROMPT_FILES) {
    const src =
      sources[name] ??
      `---\nname: ${name}\nmodel: gemini-2.0-flash\ninput:\n  schema: {}\n---\nstub body for ${name}`;
    vi.doMock(`${PROMPTS_DIR}/${name}.prompt`, () => ({ default: src }));
  }
}

describe("Loader boot-time failure guard", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    for (const name of REAL_PROMPT_FILES) {
      vi.doUnmock(`${PROMPTS_DIR}/${name}.prompt`);
    }
  });

  it("aborts boot with [prompts] error when org-ceo declares an invalid schema type", async () => {
    mockPromptSources({
      "org-ceo": [
        "---",
        "name: org-ceo",
        "model: gemini-2.5-pro",
        "input:",
        "  schema:",
        "    myField: not_a_real_type",
        "---",
        "body",
      ].join("\n"),
    });

    await expect(import(LOADER_PATH)).rejects.toThrow(
      /\[prompts\] Failed to (parse|compile) input schema for "org-ceo\.prompt"/,
    );
  });

  it("aborts boot with [prompts] error when gap-finder declares an invalid schema type", async () => {
    mockPromptSources({
      "gap-finder": [
        "---",
        "name: gap-finder",
        "model: gemini-2.5-pro",
        "input:",
        "  schema:",
        "    anotherField: not_a_real_type",
        "---",
        "body",
      ].join("\n"),
    });

    await expect(import(LOADER_PATH)).rejects.toThrow(
      /\[prompts\] Failed to (parse|compile) input schema for "gap-finder\.prompt"/,
    );
  });

  it("registers all four prompt names when all sources are healthy", async () => {
    mockPromptSources({});

    const { listPromptNames } = await import(LOADER_PATH) as { listPromptNames: () => string[] };
    expect(listPromptNames().sort()).toEqual([...REAL_PROMPT_FILES].sort());
  });
});
