# Genkit Evaluation — half-day spike

**Date:** 2026-04-18
**Status:** Spike / decision doc — no production code changed.
**Recommendation (TL;DR):** **Partial adopt.** Keep ADK as the runtime for our
existing agents. Adopt three Genkit pieces incrementally: **Flows** for the
non-agent LLM pipelines (FeedGen, Shoptimizer, Copycat), **Eval harness**
across all `.prompt` files, and **OpenTelemetry tracing** in front of the
ADK Runner. Defer Genkit's RAG indexer until we have a real corpus.

---

## 1. What Genkit actually is

`firebase/genkit` is a TypeScript GenAI framework with four pillars:

| Pillar | What it gives us | Our current equivalent |
| ------ | ---------------- | ---------------------- |
| **Dotprompt** | YAML-frontmatter `.prompt` files with Picoschema input validation. | ✅ **Already adopted.** See `agents/infrastructure/prompts/loader.ts` — we use the standalone `dotprompt` + `picoschema` packages directly, not via Genkit. |
| **Flows** | Composable, typed, traced LLM pipelines (`defineFlow({input, output, fn})`). Streaming, retry, structured output baked in. | Hand-written async functions in `lib/feedgen/service.ts`, `lib/shoptimizer/`, etc. No common shape, no built-in tracing. |
| **RAG** | `defineRetriever`, `defineIndexer`, `defineEmbedder` with built-in adapters for pgvector, Chroma, Vertex AI Vector Search, etc. | ❌ None. Gap Finder grounds itself by querying the warehouse, not retrieving past insights. |
| **Eval harness** | `genkit eval:flow <flow> --input <dataset>` → scores against rubrics (faithfulness, answer relevance, etc.) and emits a report. | ❌ None. Prompt regressions are caught only when production answers go wrong. |
| **OpenTelemetry** | Every flow/prompt/model call automatically becomes a span; first-class Google Cloud Trace + Langfuse exporters. | Manual `logger.info` only. No spans, no token-cost-per-request attribution. |

## 2. POC #1 — Side-by-side: Gap Finder via ADK vs. Genkit Flow

**Setup:** I did NOT install `genkit` into the api-server (would pollute deps
for a spike). Instead I sketched the equivalent code below to make the
trade-off concrete.

**Today (ADK) — `lib/adk/agents/gap-finder.ts`:**
```ts
export const gapFinderAgent = new LlmAgent({
  name: "gap_finder",
  model: "gemini-2.5-pro",
  instruction: renderPrompt("gap-finder"),
  tools: [listCampaignsTool, computePOASTool, /* … 8 more */],
});
// Driven by Runner in services/adk-agent.ts with AsyncLocalStorage
// for org context. Tools are FunctionTool instances.
```

**Equivalent Genkit Flow:**
```ts
import { genkit } from "genkit";
import { googleAI, gemini25Pro } from "@genkit-ai/googleai";

const ai = genkit({ plugins: [googleAI()], model: gemini25Pro });

const gapFinderFlow = ai.defineFlow({
  name: "gapFinder",
  inputSchema: z.object({ orgId: z.number(), question: z.string() }),
  outputSchema: GapFinderReportSchema,   // structured output, validated
}, async ({ orgId, question }) => {
  const { output } = await ai.generate({
    prompt: ai.prompt("gap-finder"),     // reads our existing .prompt file!
    tools: [listCampaignsTool, computePOASTool, /* … */],
    context: { orgId },                  // typed, passed to tool callbacks
  });
  return output;
});
```

**Side-by-side trade-offs:**

| Concern | ADK | Genkit |
| ------- | --- | ------ |
| Multi-turn agent loop (tool → LLM → tool) | ✅ Built into Runner | ✅ Built into `ai.generate({tools})` |
| Sessions / conversation history | ✅ `DrizzleSessionService` already wired | ❌ DIY — Genkit treats each flow run as stateless. Would need to keep our session table. |
| Org-scoped tool context | ⚠️ AsyncLocalStorage hack (works, but invisible in tool signatures) | ✅ First-class `context` param threaded through tools. Cleaner. |
| Structured output | ⚠️ String parse + Zod | ✅ `outputSchema` enforces it; retries on parse failure. |
| Streaming to client | ⚠️ Manual SSE wiring | ✅ `streamFlow()` returns an async iterator. |
| Tracing | ❌ logger.info only | ✅ Free OpenTelemetry spans per LLM call + per tool. |
| Lock-in / eject cost | Low — ADK is just an SDK around Vertex/Gemini. | Medium — flows + plugins are framework-y; you'd rewrite to leave. |

**Verdict for agents:** ADK is fine and migration cost is **high** (rewrite
4 agents, the Runner cache, the session service, and the org-context plumbing).
Stay on ADK for `org-ceo`, `gap-finder`, `growth-engine`, `omni-assistant`.

**Verdict for non-agent LLM pipelines** (FeedGen rewrite, Shoptimizer
suggestion synthesis, future Copycat / Keyword Platform): these are
**single-prompt, structured-output, no-tools** workloads. They fit Genkit
Flows perfectly. Migrating `lib/feedgen/service.ts` to a Flow would let us
delete the manual `validateFeedgenResponse()` wrapper and get tracing +
the eval harness for free.

## 3. POC #2 — RAG over past Shopping Insider insights

**Goal of the POC:** Ground Gap Finder's `compute_poas` answers in past
human-reviewed insights from previous weeks ("we already flagged SKU-1234
last month, the buyer manually approved a 20% bid cut, ROAS recovered").

**Setup sketch:**
```ts
const insightsIndexer = ai.defineIndexer({ name: "insights", embedder: vertexAI.textEmbedding004 });
const insightsRetriever = ai.defineRetriever({ name: "insights", /* pgvector adapter */ });

// Index past insights once, on the cron that already runs Shopping Insider:
await ai.index({ indexer: insightsIndexer, documents: pastInsights });

// At query time, retrieve before generating:
const docs = await ai.retrieve({ retriever: insightsRetriever, query: question, k: 5 });
const { output } = await ai.generate({ prompt, tools, context: { docs } });
```

**Honest evaluation of value-add:**
- We have **no existing corpus** of past insights — we'd have to backfill
  one. The Shopping Insider tables store metrics, not narrative analyses.
- Most "past context" the agent needs is already query-able directly
  (warehouse SQL is more accurate than embedding similarity for "what was
  spend on SKU-1234 last month").
- Where RAG would win: (a) **customer SOPs** ("our agency policy is to
  never bid > $5 CPC on apparel"), (b) **past chat transcripts** so the
  agent remembers what a buyer asked last week.

**Verdict:** Don't build RAG infrastructure yet. **Bookmark.** Revisit
when we ship the customer-SOPs feature or when the chat-history search
task (Task #59 on the backlog) lands and gives us a real corpus.

## 4. POC #3 — Eval harness on `gap-finder.prompt`

**Setup sketch:**
```ts
// genkit-eval.ts
const dataset = [
  { input: { question: "Which campaigns are spending on out-of-stock SKUs?" },
    reference: "should mention v_ads_on_empty_shelves" },
  { input: { question: "What's our best-performing campaign by POAS?" },
    reference: "should call compute_poas before answering" },
  // ... 20 more golden cases
];

await ai.evaluate({
  evaluators: ["genkitEval/faithfulness", "genkitEval/answerRelevancy"],
  dataset,
  flow: gapFinderFlow,
});
```

**This is the highest-leverage piece of Genkit for us.** Today, every
prompt change to `gap-finder.prompt` or `org-ceo.prompt` is shipped blind.
A 20-case eval suite per agent, run on every PR, would catch:
- Prompt edits that quietly stop the agent from calling required tools
  (we've already had this happen — the early `omni-assistant` prompt
  forgot to mention `get_system_health`).
- Regressions when we upgrade Gemini model versions.
- Hallucination drift when we add a new tool to the agent's toolbelt.

**Verdict: ADOPT.** Run the eval harness in CI. This is worth a follow-up
task.

## 5. Migration cost & dependency footprint

| Item | Cost |
| ---- | ---- |
| Add `genkit` + `@genkit-ai/googleai` deps | +~3MB transitively. Tree-shakes well. |
| Migrate FeedGen service.ts to a Flow | ~1 day. Delete ~30 LOC of manual JSON-mode + retry code. |
| Migrate Shoptimizer suggester to a Flow | ~1 day. Same pattern. |
| Wire eval harness into CI | ~1 day per agent (writing the 20-case dataset is the real cost). |
| Add OpenTelemetry exporter (Cloud Trace) | ~half-day if we adopt flows. Free if we don't. |
| Migrate ADK agents → Genkit | **Don't.** ~1 week, no real win, breaks our session service. |

## 6. Final recommendation

**PARTIAL ADOPT.**

1. **Adopt now (next sprint):**
   - Wire `genkit eval:flow` into CI for `gap-finder` and `org-ceo`.
     Start with a 10-case golden dataset per agent; grow over time.
   - When the next non-agent LLM pipeline lands (Copycat, Keyword Platform),
     write it as a Genkit Flow from day 1. Don't retro-fit existing ones
     unless we're already touching them.
2. **Adopt opportunistically:**
   - When we touch `lib/feedgen/service.ts` again (e.g. for follow-up #76
     Shopping Insider POAS), migrate it to a Flow at the same time.
   - When we add OpenTelemetry to anything, do it via Genkit's built-in
     Cloud Trace exporter so we get LLM spans for free.
3. **Defer:**
   - RAG. Revisit when there's a real corpus (customer SOPs, chat search).
   - Migrating ADK agents. ADK is doing its job; the Runner + session
     service work; AsyncLocalStorage is ugly but contained.

**Net dependency footprint if we adopt:** +1 production dep
(`@genkit-ai/googleai`) + 1 dev dep (`genkit-cli` for eval).

**Net code reduction if we migrate FeedGen + Shoptimizer:** ~60 LOC of
manual retry / JSON-mode / error-shape code goes away.
