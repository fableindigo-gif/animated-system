# Agent prompts (Dotprompt)

This directory holds the system / instruction prompts for OmniAnalytix's ADK
agents. Each prompt lives in its own `.prompt` file and is loaded at startup by
`./loader.ts`.

We use [Google's Dotprompt format](https://github.com/google/dotprompt): YAML
frontmatter (`name`, `model`, `config`, `input.schema`, …) followed by a
Handlebars template body. The frontmatter is the single source of truth for the
prompt's intended model and config — no more inline string literals scattered
across the agent code.

## File format

```prompt
---
name: my-prompt              # logical name (matches the loader registry key)
model: gemini-2.5-pro        # which model the prompt was tuned for
config:
  temperature: 0.2
description: >
  One-line explanation of what this prompt is for.
input:
  schema:
    accountName: string      # required string variable
    timezone?: string        # `?` suffix marks the field optional
---
You are an analyst for {{accountName}}. ...
```

The `input.schema` block uses Dotprompt's
[Picoschema](https://github.com/google/dotprompt/blob/main/spec/picoschema.md)
shorthand. Any key declared without a trailing `?` is required; the loader will
throw a clear error if a caller forgets to pass it.

## Adding a new prompt

1. Create `artifacts/api-server/src/agents/infrastructure/prompts/<name>.prompt`
   following the format above.
2. Open `loader.ts` and:
   - Add `import mySrc from "./<name>.prompt";`
   - Register it in the `PROMPT_SOURCES` map: `"<name>": mySrc`.
3. From your agent / tool wiring code, call:
   ```ts
   import { renderPrompt } from "../../agents/infrastructure/prompts/loader";
   const instruction = renderPrompt("<name>", { /* variables */ });
   ```

## Agent and tool descriptions live here too

Both ADK `LlmAgent({ description })` and `FunctionTool({ description })`
strings — the text that drives LLM tool routing and sub-agent delegation —
are sourced from `.prompt` frontmatter, not inline string literals.

For an **agent** prompt, populate the standard `description:` field in the
agent's existing `<name>.prompt`, then read it from the wiring code:

```ts
import {
  renderPrompt,
  getPromptDescription,
} from "../../agents/infrastructure/prompts/loader";

new LlmAgent({
  name:        "gap_finder",
  description: getPromptDescription("gap-finder"),  // from frontmatter
  instruction: renderPrompt("gap-finder"),          // from body
  // ...
});
```

For a **tool** description, drop a small prompt under `tools/<tool_name>.prompt`
that carries only the description in frontmatter (the body is reserved for an
optional "when to use this tool" hint that we may surface later):

```prompt
---
name: my_tool
description: >
  Single-paragraph description that the LLM uses to decide when to call this
  tool. Mirror the tool's parameter contract in plain language.
---
Optional usage hint that humans can read; not consumed at runtime today.
```

Then register the import in `loader.ts` (in the `TOOL_PROMPT_SOURCES` map) and
read it from the tool wiring:

```ts
import { getToolDescription } from "../../agents/infrastructure/prompts/loader";

new FunctionTool({
  name:        "my_tool",
  description: getToolDescription("my_tool"),
  parameters:  { /* JSON schema */ },
  execute:     async (args, ctx) => { /* ... */ },
});
```

The loader validates at boot that every tool prompt has a non-empty
`description:` and aborts with `[prompts] tools/<name>.prompt is missing a
non-empty "description" frontmatter field.` if you forget.

## How loading works

`build.mjs` configures esbuild's `text` loader for `.prompt` files, so the raw
file contents are inlined into the bundle at build time. At startup the loader:

1. Parses every prompt with `Dotprompt.parse()` — this validates frontmatter.
2. Converts the declared `input.schema` (Picoschema) into JSON Schema via
   Dotprompt's `picoschema()` and compiles an Ajv validator for it.
3. Pre-compiles the Handlebars template body once per prompt.
4. On each `renderPrompt()` call, runs the Ajv validator against the supplied
   variables before rendering.

Any parse / compile failure aborts boot with a `[prompts] ...` error that names
the offending file. Any render-time variable mismatch throws synchronously with
the failing field path and reason — problems surface at first use, not silently.

Two things to know about validation:

- A prompt that declares `input.schema: {}` accepts **no** variables — passing
  any key throws. Use this when a prompt deliberately takes zero inputs.
- A prompt that omits the `input` block entirely is treated as "schema not
  declared" and skips variable validation. Prefer declaring an explicit schema.

## Agent descriptions

Each agent's planner-facing `description:` lives in its own `.prompt`
frontmatter and is read at construction time with `getPromptDescription`:

```ts
import { getPromptDescription } from "../../agents/infrastructure/prompts/loader";
new LlmAgent({ name: "growth_engine", description: getPromptDescription("growth-engine"), ... });
```

`getPromptDescription` throws at first use if the frontmatter `description:`
is missing or empty, so a typo or rename surfaces immediately. When the same
underlying capability needs two distinct planner-facing descriptions (e.g.
the omni-assistant variant of `get_store_revenue_summary`), add a separate
prompt file under `tools/` with the disambiguated name (e.g.
`tools/omni_get_store_revenue_summary.prompt`) and reference that key.

## Out of scope

- Hot-reloading prompts at runtime (load-on-boot is fine).
- An admin UI for editing prompts.
- One-off prompts used by non-agent services elsewhere in the codebase.
- Per-parameter `description` strings on `FunctionTool.parameters.properties.*`
  — these are very granular, fielded JSON-schema docstrings and remain inline
  with the tool definition.
