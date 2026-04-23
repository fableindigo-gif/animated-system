/**
 * Dotprompt loader — parses every `.prompt` file under this directory at
 * startup and exposes a typed `renderPrompt(name, vars)` helper.
 *
 * Each `.prompt` file uses Google's Dotprompt format (YAML frontmatter +
 * Handlebars body). See `./README.md` for the full conventions.
 *
 * The loader:
 *   1. Imports every `.prompt` file as a raw string (esbuild's `text` loader
 *      inlines the file contents at build time — no runtime fs access).
 *   2. Parses each one via `Dotprompt.parse()`, which validates frontmatter.
 *   3. Converts the prompt's `input.schema` (Picoschema) into JSON Schema and
 *      compiles an Ajv validator for it at boot.
 *   4. Pre-compiles the Handlebars template once per prompt.
 *   5. On every `renderPrompt(name, vars)` call, validates the supplied
 *      variables against that JSON Schema before rendering.
 *
 * Adding a new prompt:
 *   - Drop a `<name>.prompt` file in this directory.
 *   - Register it in the `PROMPT_SOURCES` map below.
 *   - Use `renderPrompt("<name>", { ...vars })` from agent setup code.
 */

import Handlebars from "handlebars";
import Ajv, { type ValidateFunction } from "ajv";
import { Dotprompt, picoschema, type ParsedPrompt } from "dotprompt";

import omniAssistantSrc from "./omni-assistant.prompt";
import orgCeoSrc from "./org-ceo.prompt";
import gapFinderSrc from "./gap-finder.prompt";
import growthEngineSrc from "./growth-engine.prompt";

// Per-tool description prompts. Each `tools/<tool_name>.prompt` carries the
// canonical `description:` for that ADK FunctionTool in its frontmatter, so the
// description lives next to the rest of the agent prompt corpus instead of
// being inlined as a string literal in the tool definition file.
import listCampaignsSrc from "./tools/list_campaigns.prompt";
import identifyBudgetConstraintsSrc from "./tools/identify_budget_constraints.prompt";
import calculateAccountHeadroomSrc from "./tools/calculate_account_headroom.prompt";
import computePoasSrc from "./tools/compute_poas.prompt";
import calculateSalesVelocitySrc from "./tools/calculate_sales_velocity.prompt";
import getStoreInventoryHealthSrc from "./tools/get_store_inventory_health.prompt";
import getStoreRevenueSummarySrc from "./tools/get_store_revenue_summary.prompt";
import detectAutomationChurnSrc from "./tools/detect_automation_churn.prompt";
import optimizeProductFeedSrc from "./tools/optimize_product_feed.prompt";
import generateFeedRewritesSrc from "./tools/generate_feed_rewrites.prompt";
import queryWarehouseSrc from "./tools/query_warehouse.prompt";
import shoppingCampaignPerformanceSrc from "./tools/shopping_campaign_performance.prompt";
import shoppingTopProductsSrc from "./tools/shopping_top_products.prompt";
import shoppingProductIssuesSrc from "./tools/shopping_product_issues.prompt";
import shoppingAccountHealthSrc from "./tools/shopping_account_health.prompt";
import getSystemHealthSrc from "./tools/get_system_health.prompt";
import listPlatformCapabilitiesSrc from "./tools/list_platform_capabilities.prompt";
import getCappedCampaignsSrc from "./tools/get_capped_campaigns.prompt";
import getInventoryAlertsSrc from "./tools/get_inventory_alerts.prompt";
import getRecentTriageEventsSrc from "./tools/get_recent_triage_events.prompt";
import getCampaignPerformanceSrc from "./tools/get_campaign_performance.prompt";
import omniGetStoreRevenueSummarySrc from "./tools/omni_get_store_revenue_summary.prompt";

/** Every agent prompt shipped with the agent service. */
const PROMPT_SOURCES = {
  "omni-assistant": omniAssistantSrc,
  "org-ceo":        orgCeoSrc,
  "gap-finder":     gapFinderSrc,
  "growth-engine":  growthEngineSrc,
} as const satisfies Record<string, string>;

/** Every tool description prompt shipped with the agent service. */
const TOOL_PROMPT_SOURCES = {
  list_campaigns:                listCampaignsSrc,
  identify_budget_constraints:   identifyBudgetConstraintsSrc,
  calculate_account_headroom:    calculateAccountHeadroomSrc,
  compute_poas:                  computePoasSrc,
  calculate_sales_velocity:      calculateSalesVelocitySrc,
  get_store_inventory_health:    getStoreInventoryHealthSrc,
  get_store_revenue_summary:     getStoreRevenueSummarySrc,
  detect_automation_churn:       detectAutomationChurnSrc,
  optimize_product_feed:         optimizeProductFeedSrc,
  generate_feed_rewrites:        generateFeedRewritesSrc,
  query_warehouse:               queryWarehouseSrc,
  shopping_campaign_performance: shoppingCampaignPerformanceSrc,
  shopping_top_products:         shoppingTopProductsSrc,
  shopping_product_issues:       shoppingProductIssuesSrc,
  shopping_account_health:       shoppingAccountHealthSrc,
  // Internal omni-assistant tools (defined inline in services/adk-agent.ts).
  get_system_health:               getSystemHealthSrc,
  list_platform_capabilities:      listPlatformCapabilitiesSrc,
  get_capped_campaigns:            getCappedCampaignsSrc,
  get_inventory_alerts:            getInventoryAlertsSrc,
  get_recent_triage_events:        getRecentTriageEventsSrc,
  get_campaign_performance:        getCampaignPerformanceSrc,
  // Distinct from get_store_revenue_summary above — this variant returns the
  // 30d + 7d snapshot used by the omni-assistant chat surface.
  omni_get_store_revenue_summary:  omniGetStoreRevenueSummarySrc,
} as const satisfies Record<string, string>;

export type PromptName = keyof typeof PROMPT_SOURCES;
export type ToolPromptName = keyof typeof TOOL_PROMPT_SOURCES;

interface RegisteredPrompt {
  parsed:    ParsedPrompt;
  template:  HandlebarsTemplateDelegate;
  /** True when the prompt declared an `input.schema` block (even if empty). */
  hasSchema: boolean;
  /** Compiled Ajv validator for the prompt's input. `null` when no schema was declared. */
  validate:  ValidateFunction | null;
}

const dp     = new Dotprompt();
const ajv    = new Ajv({ allErrors: true, strict: false, useDefaults: false });
const REGISTRY: Record<string, RegisteredPrompt> = {};
const TOOL_REGISTRY: Record<string, RegisteredPrompt> = {};

function declaredSchema(parsed: ParsedPrompt): unknown | undefined {
  // dotprompt parses `input.schema:` straight into `parsed.input.schema`.
  // We treat any present value (including `{}`) as "schema declared".
  const input = parsed.input as { schema?: unknown } | undefined;
  if (!input || !("schema" in input)) return undefined;
  return input.schema;
}

async function buildValidator(
  name: string,
  rawSchema: unknown,
): Promise<ValidateFunction> {
  let jsonSchema: unknown;
  try {
    jsonSchema = await picoschema(rawSchema);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[prompts] Failed to parse input schema for "${name}.prompt": ${msg}`);
  }

  // Picoschema returns `null` for an empty schema (`{}`). Build an explicit
  // "no extra properties allowed" schema so callers can't sneak unknown vars in.
  const effectiveSchema =
    jsonSchema && typeof jsonSchema === "object"
      ? { additionalProperties: false, ...(jsonSchema as Record<string, unknown>) }
      : { type: "object", additionalProperties: false, properties: {} };

  try {
    return ajv.compile(effectiveSchema);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[prompts] Failed to compile input schema for "${name}.prompt": ${msg}`);
  }
}

async function compileEntry(
  name: string,
  source: string,
  label: string,
): Promise<RegisteredPrompt> {
  let parsed: ParsedPrompt;
  try {
    parsed = dp.parse(source);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[prompts] Failed to parse "${label}": ${msg}`);
  }

  let template: HandlebarsTemplateDelegate;
  try {
    template = Handlebars.compile(parsed.template, { noEscape: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[prompts] Failed to compile template "${label}": ${msg}`);
  }

  const rawSchema = declaredSchema(parsed);
  const hasSchema = rawSchema !== undefined;
  const validate  = hasSchema ? await buildValidator(name, rawSchema) : null;

  return { parsed, template, hasSchema, validate };
}

function assertDescription(name: string, label: string, entry: RegisteredPrompt): void {
  if (!entry.parsed.description || entry.parsed.description.trim() === "") {
    throw new Error(
      `[prompts] ${label} is missing a non-empty "description" frontmatter field.`,
    );
  }
}

// Eagerly parse + compile every prompt. Any failure here aborts boot with a
// clear, prompt-scoped error message. Top-level await is supported in ESM.
//
// Both agent and tool prompts are required to declare a non-empty
// `description:` — the agent description drives ADK sub-agent routing, and
// the tool description drives tool-call selection by the LLM. A missing or
// empty value is treated as a configuration bug and fails boot rather than
// silently degrading routing quality at runtime.
for (const [name, source] of Object.entries(PROMPT_SOURCES)) {
  const label = `${name}.prompt`;
  const entry = await compileEntry(name, source, label);
  assertDescription(name, label, entry);
  REGISTRY[name] = entry;
}

for (const [name, source] of Object.entries(TOOL_PROMPT_SOURCES)) {
  const label = `tools/${name}.prompt`;
  const entry = await compileEntry(name, source, label);
  assertDescription(name, label, entry);
  TOOL_REGISTRY[name] = entry;
}

function formatAjvErrors(errors: ValidateFunction["errors"]): string {
  if (!errors || errors.length === 0) return "(no detail)";
  return errors
    .map((e) => {
      const path = e.instancePath || "(root)";
      return `${path} ${e.message ?? "is invalid"}`.trim();
    })
    .join("; ");
}

/**
 * Render a prompt by name with the supplied variables.
 *
 * Throws a clear error if:
 *   - the prompt name is unknown
 *   - a prompt declared an `input.schema` and the supplied variables don't
 *     conform (missing required keys, unknown keys, wrong types, …)
 */
export function renderPrompt(
  name: PromptName,
  vars: Record<string, unknown> = {},
): string {
  const entry = REGISTRY[name];
  if (!entry) {
    throw new Error(
      `[prompts] Unknown prompt "${name}". Known: ${Object.keys(REGISTRY).join(", ") || "(none)"}`,
    );
  }

  if (entry.hasSchema) {
    // Schema was declared (possibly `{}`). Enforce strictly.
    const validate = entry.validate!;
    if (!validate(vars)) {
      throw new Error(
        `[prompts] Invalid variables for prompt "${name}": ${formatAjvErrors(validate.errors)}`,
      );
    }
  }

  return entry.template(vars).trim();
}

/**
 * Returns the parsed metadata (model, config, frontmatter) for a prompt.
 * Useful for callers that want to honour the prompt's declared model/config.
 */
export function getPromptMetadata(name: PromptName): ParsedPrompt {
  const entry = REGISTRY[name];
  if (!entry) throw new Error(`[prompts] Unknown prompt "${name}".`);
  return entry.parsed;
}

/**
 * Returns the `description` frontmatter field of an agent prompt.
 *
 * Agents pass this to ADK's `LlmAgent({ description })` so the description
 * lives in the same `.prompt` file as the agent's instruction body — single
 * source of truth.
 */
export function getPromptDescription(name: PromptName): string {
  const entry = REGISTRY[name];
  if (!entry) throw new Error(`[prompts] Unknown prompt "${name}".`);
  const desc = entry.parsed.description;
  if (!desc || desc.trim() === "") {
    throw new Error(
      `[prompts] "${name}.prompt" is missing a non-empty "description" frontmatter field.`,
    );
  }
  return desc.trim();
}

/**
 * Returns the `description` for a tool prompt (under `tools/<name>.prompt`).
 *
 * Tool definitions in `lib/adk/{platform,shopping-insider}-tools.ts` use this
 * to populate ADK's `FunctionTool({ description })` so the user-visible
 * description that drives LLM tool routing lives in a `.prompt` file rather
 * than a string literal.
 */
export function getToolDescription(name: ToolPromptName): string {
  const entry = TOOL_REGISTRY[name];
  if (!entry) {
    throw new Error(
      `[prompts] Unknown tool prompt "${name}". Known: ${Object.keys(TOOL_REGISTRY).join(", ") || "(none)"}`,
    );
  }
  // Already validated non-empty at boot in the TOOL_REGISTRY loop above.
  return entry.parsed.description!.trim();
}

/** List the names of every loaded agent prompt — useful for diagnostics. */
export function listPromptNames(): PromptName[] {
  return Object.keys(REGISTRY) as PromptName[];
}

/** List the names of every loaded tool prompt — useful for diagnostics. */
export function listToolPromptNames(): ToolPromptName[] {
  return Object.keys(TOOL_REGISTRY) as ToolPromptName[];
}
