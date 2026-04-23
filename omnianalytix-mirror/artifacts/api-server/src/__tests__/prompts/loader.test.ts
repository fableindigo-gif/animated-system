import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LOADER_PATH = "../../agents/infrastructure/prompts/loader";
const PROMPTS_DIR = "../../agents/infrastructure/prompts";

const REAL_PROMPT_FILES = [
  "omni-assistant",
  "org-ceo",
  "gap-finder",
  "growth-engine",
] as const;

/**
 * Mock the four `*.prompt` static imports so we can exercise the loader's
 * boot-time parsing/validation paths in isolation. The loader itself is
 * dynamically imported per-test (via `vi.resetModules()`) so its top-level
 * await re-runs against the mocked sources.
 */
function mockPromptSources(sources: Partial<Record<(typeof REAL_PROMPT_FILES)[number], string>>) {
  for (const name of REAL_PROMPT_FILES) {
    const src =
      sources[name] ??
      [
        "---",
        `name: ${name}`,
        "model: gemini-2.0-flash",
        // Boot-time guard requires a non-empty description on every prompt;
        // bake one in by default so per-test stubs can stay focused on the
        // schema / template surface they actually want to exercise.
        `description: stub description for ${name} (test fixture)`,
        "input:",
        "  schema: {}",
        "---",
        `stub body for ${name}`,
      ].join("\n");
    vi.doMock(`${PROMPTS_DIR}/${name}.prompt`, () => ({ default: src }));
  }
}

describe("Dotprompt loader (real prompts)", () => {
  it("renders the omni-assistant prompt to its expected text", async () => {
    const { renderPrompt } = await import(LOADER_PATH);
    const text = renderPrompt("omni-assistant");
    expect(text).toContain("OmniAnalytix AI assistant");
    expect(text).toContain("get_system_health");
  });

  it("lists every registered prompt", async () => {
    const { listPromptNames } = await import(LOADER_PATH);
    expect(listPromptNames().sort()).toEqual([...REAL_PROMPT_FILES].sort());
  });

  it("throws a clear error for an unknown prompt name", async () => {
    const { renderPrompt } = await import(LOADER_PATH);
    expect(() => renderPrompt("does-not-exist" as never)).toThrow(
      /\[prompts\] Unknown prompt "does-not-exist"/,
    );
  });

  it("throws when an unknown variable is supplied (additionalProperties: false)", async () => {
    const { renderPrompt } = await import(LOADER_PATH);
    expect(() => renderPrompt("omni-assistant", { rogue: 1 })).toThrow(
      /\[prompts\] Invalid variables for prompt "omni-assistant"/,
    );
  });

  it("exposes each agent prompt's frontmatter description via getPromptDescription", async () => {
    const { getPromptDescription } = await import(LOADER_PATH);
    for (const name of REAL_PROMPT_FILES) {
      const desc = getPromptDescription(name);
      expect(desc, `agent prompt "${name}" must declare a non-empty description`).toBeTruthy();
      expect(desc.length).toBeGreaterThan(20);
    }
  });

  it("exposes each tool prompt's frontmatter description via getToolDescription", async () => {
    const { getToolDescription, listToolPromptNames } = await import(LOADER_PATH);
    const names = listToolPromptNames();
    expect(names.length).toBeGreaterThanOrEqual(15);
    for (const name of names) {
      const desc = getToolDescription(name);
      expect(desc, `tool prompt "${name}" must declare a non-empty description`).toBeTruthy();
      expect(desc.length).toBeGreaterThan(20);
    }
  });

  it("throws a clear error for an unknown tool prompt name", async () => {
    const { getToolDescription } = await import(LOADER_PATH);
    expect(() => getToolDescription("does_not_exist" as never)).toThrow(
      /\[prompts\] Unknown tool prompt "does_not_exist"/,
    );
  });
});

describe("Dotprompt loader (mocked sources)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock(`${PROMPTS_DIR}/omni-assistant.prompt`);
    vi.doUnmock(`${PROMPTS_DIR}/org-ceo.prompt`);
    vi.doUnmock(`${PROMPTS_DIR}/gap-finder.prompt`);
    vi.doUnmock(`${PROMPTS_DIR}/growth-engine.prompt`);
  });

  it("throws when a required variable is missing", async () => {
    mockPromptSources({
      "omni-assistant": [
        "---",
        "name: omni-assistant",
        "model: gemini-2.0-flash",
        "description: stub description (test fixture)",
        "input:",
        "  schema:",
        "    account: string",
        "    timezone?: string",
        "---",
        "Hello {{account}}",
      ].join("\n"),
    });

    const { renderPrompt } = await import(LOADER_PATH);
    expect(() => renderPrompt("omni-assistant" as never)).toThrow(
      /\[prompts\] Invalid variables for prompt "omni-assistant".*account/,
    );
  });

  // The loader's strongest boot-time guard is on the prompt's declared
  // `input.schema`. (Dotprompt's underlying YAML parser silently swallows
  // malformed frontmatter rather than throwing — so frontmatter-shape
  // problems show up later through schema/picoschema parsing.) We assert
  // that a broken schema aborts boot with a prompt-scoped error so a
  // typo in a real prompt file is caught at startup, not on first use.
  it("aborts boot with a prompt-scoped error when input.schema is invalid", async () => {
    mockPromptSources({
      "growth-engine": [
        "---",
        "name: growth-engine",
        "model: gemini-2.0-flash",
        "input:",
        "  schema:",
        "    foo: not_a_real_type",
        "---",
        "body",
      ].join("\n"),
    });

    await expect(import(LOADER_PATH)).rejects.toThrow(
      /\[prompts\] Failed to (parse|compile) input schema for "growth-engine\.prompt"/,
    );
  });
});
