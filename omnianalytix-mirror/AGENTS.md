# OmniAnalytix Agent Workforce Manifest

This file is the **North Star** for every autonomous agent that operates inside the
OmniAnalytix platform. It defines the workforce domains, the tools each agent may
call, and the safety contracts (Human-in-the-Loop / Approval Queue) that gate any
state-changing operation.

All tools are exposed through the **OneMCP** layer at `POST /api/mcp` using the
JSON-RPC 2.0 protocol. Every invocation is scoped by `workspace_id` and `org_id`
(path-based isolation enforced server-side).

---

## Workforce Domains

### Gap Finder
**Mission**: Continuously monitor ROAS vs. POAS divergence and surface inventory-
velocity gaps that cause silent margin leakage.

**Tools**:
- `get_inventory_velocity` — Returns the 7-day units-sold-per-day rate for every
  active SKU together with current on-hand inventory, days-of-supply, and a
  velocity-class label (FAST, STEADY, SLOW, STALE).
- `calculate_poas` — Computes `POAS = (Revenue − Spend − COGS) / Spend` for the
  current org, joining the warehouse fact tables server-side.

**Trigger conditions**:
- Polled by the dashboard every 60 s.
- Re-run automatically when `syncState === "STALE_DATA"` transitions back to
  `OPERATIONAL_POPULATED` (handled by `useAgentExecution.ts` on the client).

---

### Growth Engine
**Mission**: Identify campaigns whose daily spend is hitting their budget cap and
propose corrective budget shifts to the human approver.

**Tools**:
- `get_capped_campaigns` — Identifies campaigns where today's spend ≥ 95 % of the
  inferred daily budget (P90 of trailing-30-day spend used as a budget proxy when
  the platform-side budget value is not in the warehouse).
- `propose_budget_shift` — **Elicitation Pattern**. Inserts a `proposed_tasks`
  row with `status: 'pending'`. The Growth Engine **MUST NOT** call
  `execute_budget_shift` directly.
- `execute_budget_shift` — Reserved for the human-approval path. Only callable
  with a `proposed_task_id` whose status has been flipped to `approved` by an
  Agency Principal or Account Director.

---

### Organization CEO
**Mission**: Top-level orchestrator. Routes incoming user intents and warehouse
events to the correct specialist, validates org isolation, and emits structured
audit trails.

**Tools**:
- `route_to_specialist` — Inspects an incoming intent, returns the agent name
  (`gap_finder` | `growth_engine`) most suited to handle it, plus the recommended
  initial tool to invoke.
- `validate_org_id` — Asserts that the supplied `org_id` matches the bearer
  token's organization claim. Used to enforce path-based isolation at the
  workforce-orchestration layer.

---

## Safety Contracts

### Path-based Isolation
Every MCP tool invocation **must** include `workspace_id` and `org_id`. The
server validates that the bearer token's org claim matches `org_id` before any
warehouse query runs. Mismatches return JSON-RPC error code `-32603`.

### Elicitation Pattern (Human-in-the-Loop)
State-changing tools (budget shifts, campaign pauses, ad-copy edits) **never**
mutate platform state directly. They insert a `proposed_tasks` row with
`status: 'pending'` and surface in the Approval Queue widget. Only after a
human with role `admin` or `manager` clicks "Approve" does the corresponding
`execute_*` tool run.

### Idempotency
Every proposed task is keyed by `sha256({workspace, tool, args})` so duplicate
proposals collapse onto the same pending row. The Approval Queue therefore
never shows the same shift twice.

---

## Adding a New Agent
1. Add the agent's domain section to this file.
2. Add the agent's tools to `TOOL_REGISTRY` in
   `artifacts/api-server/src/routes/mcp/index.ts`.
3. If any tool is state-changing, expose **two** tools: a `propose_*` that
   inserts into `proposed_tasks`, and an `execute_*` callable only via the
   approval flow.
4. Update the `ApprovalQueue` widget if a new platform label is introduced.
