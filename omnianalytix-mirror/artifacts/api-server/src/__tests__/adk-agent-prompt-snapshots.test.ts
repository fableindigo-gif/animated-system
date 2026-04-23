/**
 * Agent Prompt Snapshot Tests
 *
 * Locks in the exact rendered content of every agent .prompt file so that any
 * accidental edit — removing a safety rule, renaming a tool, deleting routing
 * logic — produces a clear snapshot-diff failure in CI and requires an
 * explicit `pnpm vitest --update-snapshots` to accept the change.
 *
 * These tests import the real loader (no mocks) against the real .prompt
 * files.  The vitest config's `load-prompt-as-text` plugin inlines each
 * .prompt as a raw string, so no filesystem access is needed at test runtime.
 *
 * To intentionally update a prompt:
 *   1. Edit the .prompt file.
 *   2. Run:  pnpm vitest --update-snapshots
 *   3. Commit the updated .snap file together with the prompt change.
 */

import { describe, expect, it } from "vitest";

const LOADER_PATH = "../agents/infrastructure/prompts/loader";

describe("agent prompt content snapshots", () => {
  it('omni-assistant prompt body matches snapshot', async () => {
    const { renderPrompt } = await import(LOADER_PATH) as {
      renderPrompt: (name: string) => string;
    };
    expect(renderPrompt("omni-assistant")).toMatchSnapshot();
  });

  it('org-ceo prompt body matches snapshot', async () => {
    const { renderPrompt } = await import(LOADER_PATH) as {
      renderPrompt: (name: string) => string;
    };
    expect(renderPrompt("org-ceo")).toMatchSnapshot();
  });

  it('gap-finder prompt body matches snapshot', async () => {
    const { renderPrompt } = await import(LOADER_PATH) as {
      renderPrompt: (name: string) => string;
    };
    expect(renderPrompt("gap-finder")).toMatchSnapshot();
  });

  it('growth-engine prompt body matches snapshot', async () => {
    const { renderPrompt } = await import(LOADER_PATH) as {
      renderPrompt: (name: string) => string;
    };
    expect(renderPrompt("growth-engine")).toMatchSnapshot();
  });
});
