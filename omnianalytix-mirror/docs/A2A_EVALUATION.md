# Agent-to-Agent (A2A) Protocol Evaluation — half-day spike

**Date:** 2026-04-18
**Status:** Spike / decision doc — no production code changed.
**Recommendation (TL;DR):** **Bookmark, do not adopt yet.** Build a small
internal A2A wrapper around `org-ceo` only when we have a concrete
external counterparty — until then, A2A solves a problem we don't have.
Re-evaluate in 6 months.

---

## 1. What A2A is

`google-a2a/A2A` is an open protocol (HTTP + JSON-RPC + Server-Sent Events)
for agents to **discover and call other agents across organisational
boundaries**. The core surfaces:

| Surface | Purpose |
| ------- | ------- |
| **Agent Card** (`/.well-known/agent.json`) | Public manifest: name, description, capabilities, supported skills, auth scheme. Lets any A2A client discover what an agent can do. |
| **`tasks/send`** | Submit a task (a prompt + optional artifacts). Returns a task id. |
| **`tasks/get` / `tasks/cancel`** | Poll or cancel. |
| **`tasks/sendSubscribe`** (SSE) | Stream incremental updates back. |
| **Artifacts** | Files / structured data attached to a task (PDFs, JSON, images). |
| **Auth** | OAuth 2.0 / API key / mTLS — declared in the Agent Card. |

It is to agents what OpenAPI is to REST APIs: a contract that lets two
independently-built systems talk without bespoke integration code.

## 2. What it would look like to expose `org-ceo` over A2A

Sketch (NOT implemented — this is the design):

```ts
// experiments/a2a-poc/server.ts (hypothetical)
import { A2AServer } from "@a2a/server";
import { runAdkAgent } from "../../artifacts/api-server/src/services/adk-agent";

const server = new A2AServer({
  agentCard: {
    name: "OmniAnalytix Org CEO",
    description: "Growth-agency-grade analyst for ROAS, POAS, and inventory health across Google Ads + Shopify.",
    url: "https://api.omnianalytix.in/a2a",
    capabilities: { streaming: true, pushNotifications: false },
    skills: [
      { id: "ask-about-campaigns", name: "Ask about campaign performance",
        examples: ["What's our ROAS this week?", "Which campaigns are budget-capped?"] },
      { id: "ask-about-inventory", name: "Ask about inventory health",
        examples: ["Which SKUs are out of stock?"] },
    ],
    authentication: { schemes: ["bearer"] },
  },
  taskHandler: async (task, ctx) => {
    // Map A2A bearer token → our internal orgId via partner_api_keys table.
    const orgId = await resolvePartnerOrg(ctx.authToken);
    if (!orgId) return { state: "failed", message: "Unknown partner token" };

    const result = await runAdkAgent({
      message: task.message.parts.find(p => p.type === "text")?.text ?? "",
      orgId,
      sessionId: task.id, // tie A2A task id → ADK session
    });

    return {
      state: "completed",
      message: { role: "agent", parts: [{ type: "text", text: result.output }] },
      artifacts: result.toolCalls.length > 0
        ? [{ name: "tool_trace", parts: [{ type: "data", data: result.toolCalls }] }]
        : undefined,
    };
  },
});
```

The mapping is clean — our `runAdkAgent` already returns
`{ output, sessionId, toolCalls }`, which lines up 1:1 with A2A's
`{ message, id, artifacts }` shape.

## 3. Use cases relevant to OmniAnalytix

I evaluated four hypothetical A2A integrations:

| Counterparty | Scenario | Real value? |
| ------------ | -------- | ----------- |
| **Partner agency's ops agent** | Their internal agent calls our `org-ceo` to pull a weekly client report instead of hitting our REST API. | Marginal — they could just hit our REST API. A2A wins only if they want to compose our agent into a longer multi-agent reasoning chain on their side. |
| **Vendor inventory agent** (e.g. supplier exposes their stock as an A2A agent) | Our `growth-engine` agent calls supplier's agent to ask "when can you restock SKU-1234?" before recommending a bid increase. | **Strong.** This is exactly the federation use case A2A was built for. But it requires the vendor to also have an A2A agent — none currently do. |
| **Internal cross-service** (org-ceo calls gap-finder over A2A inside our own backend) | Use A2A as the bus between our own agents. | Negative value — adds network hops, auth, schema overhead for something that's currently one process. ADK's `SubAgent` already covers this. |
| **Customer's own agent** (the agency runs their own LLM agent and wants ours as a tool) | The customer's agent calls our A2A `org-ceo` to fetch analytics. | Possible, but customers asking for this don't exist yet. Today they just use our chat UI. |

**The only use case with real value (vendor federation) requires
counterparties that don't exist today.**

## 4. Risks of adopting now

1. **Auth model is unsettled.** A2A's auth section ("declare your scheme
   in the Agent Card") punts most of the hard work — multi-tenant key
   rotation, per-tenant rate limits, and audit logging are all on us.
   We'd have to build a `partner_api_keys` table, scope tokens per skill,
   and surface usage in the dashboard. That's a 1-week project on its own
   before any A2A code is written.
2. **Streaming costs.** `tasks/sendSubscribe` is SSE — long-lived
   connections that blow up our existing per-request log model. Would
   need infra changes.
3. **Spec velocity.** A2A is pre-1.0; the spec has shifted twice in the
   last year. Building a public A2A endpoint locks us into spec churn.
4. **No clients today.** Exposing an endpoint nobody calls is pure cost.

## 5. What I'd actually do if/when we adopt

A staged rollout that minimises lock-in:

1. **Phase 0 (now):** Bookmark. Add A2A to the integrations roadmap;
   monitor the spec.
2. **Phase 1 (when first vendor publishes an A2A Agent Card):**
   Build an A2A **client** in our `growth-engine` agent, expose vendor
   inventory queries as a Genkit tool. This is read-only and low-risk.
3. **Phase 2 (when first paying partner agency asks):**
   Build the A2A **server** wrapper around `org-ceo`. Auth via
   `partner_api_keys`; rate-limit per partner; pipe usage into the same
   billing surface as our REST API.
4. **Phase 3 (only if A2A reaches 1.0 and we have ≥3 partners):**
   First-class A2A as a peer to our REST API.

## 6. Final recommendation

**BOOKMARK.** No code, no endpoint, no dependencies — yet.

**Triggers to re-evaluate:**
- A vendor in our integration list (Shopify, Google Ads, Meta, etc.)
  publishes an A2A Agent Card.
- A partner agency asks us for programmatic agent access (today they
  ask for REST or webhooks).
- A2A spec hits 1.0.

**Cost of waiting:** zero. The mapping from `runAdkAgent` to A2A is
shallow (~50 LOC); we can add it in days when the trigger fires.

**Cost of adopting now:** ~2 weeks of partner-API-key infrastructure,
SSE plumbing, and Agent Card maintenance for an endpoint with no
callers. Not worth it.
