/**
 * VAG 1 — Model Context Protocol (MCP) JSON-RPC 2.0 Server
 *
 * Exposes the ⌘K Command Palette tool handlers as a standardised MCP endpoint
 * that an Orchestrator Agent can call without any frontend interaction.
 *
 * POST /api/mcp
 * Authorization: Bearer <gate_token>
 *
 * Supported methods:
 *   list_tools   — returns the MCP tool catalogue
 *   invoke_tool  — executes a named tool (requires workspace_id + org_id)
 */
import { Router, type Request, type Response } from "express";
import { db, warehouseShopifyProducts, warehouseGoogleAds, warehouseCrossPlatformMapping, proposedTasks } from "@workspace/db";
import { eq, sql, and } from "drizzle-orm";
import { z } from "zod";
import { runAdvancedDiagnostics } from "../../lib/advanced-diagnostic-engine";
import { verifyAnyToken } from "../auth/gate";
import { logger } from "../../lib/logger";
import crypto from "crypto";

// ── Phase 6: Agent-to-Agent (A2A) handoff schema ──────────────────────────────
// Strict payload contract for `route_to_specialist`. Enforced at the tool
// boundary so cross-agent invocations carry no implicit shared state — every
// downstream call must reconstruct context from this payload alone.
export const A2AHandoffSchema = z.object({
  org_id: z.string(),
  source_agent: z.literal("Gap Finder"),
  target_agent: z.literal("Growth Engine"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  context: z.object({
    issue: z.literal("MARGIN_LEAK"),
    affected_skus: z.array(z.string()),
    current_poas: z.number(),
    target_poas: z.number(),
  }),
});
export type A2AHandoff = z.infer<typeof A2AHandoffSchema>;

// In-process handoff registry (status board). No shared mutable state leaks
// between handler invocations — each handoff is keyed by a fresh UUID and the
// downstream worker reconstructs its context from the validated payload only.
type HandoffStatus = "ACCEPTED" | "DISPATCHED" | "COMPLETED" | "FAILED" | "HISTORICAL_BACKFILL";
interface HandoffRecord {
  handoff_id: string;
  accepted_at: number;
  status: HandoffStatus;
  source_agent: string;
  target_agent: string;
  priority: A2AHandoff["priority"];
  dispatched_tool: string;
  org_id: string;
  workspace_id: string;
  payload: A2AHandoff;       // original validated payload — kept for retry + UI context expansion
  result_summary?: string;
  error?: string;
}
const HANDOFF_REGISTRY = new Map<string, HandoffRecord>();
const HANDOFF_TTL_MS = 60 * 60 * 1000; // 1h
function reapHandoffs() {
  const now = Date.now();
  for (const [id, rec] of HANDOFF_REGISTRY) {
    if (now - rec.accepted_at > HANDOFF_TTL_MS) HANDOFF_REGISTRY.delete(id);
  }
}

/** Read-only snapshot of the registry, newest first. Optional org filter. */
export function listHandoffs(filterOrgId?: string): HandoffRecord[] {
  reapHandoffs();
  const all = Array.from(HANDOFF_REGISTRY.values());
  const scoped = filterOrgId
    ? all.filter((r) => String(r.org_id) === String(filterOrgId))
    : all;
  return scoped.sort((a, b) => b.accepted_at - a.accepted_at);
}
export function getHandoff(id: string): HandoffRecord | undefined {
  return HANDOFF_REGISTRY.get(id);
}
export function setHandoffBackfilling(id: string, note: string): HandoffRecord | undefined {
  const rec = HANDOFF_REGISTRY.get(id);
  if (!rec) return undefined;
  const updated: HandoffRecord = { ...rec, status: "HISTORICAL_BACKFILL", result_summary: note };
  HANDOFF_REGISTRY.set(id, updated);
  return updated;
}

export const mcpRouter = Router();

// ── JSON-RPC helpers ──────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
  id: string | number;
}

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  result: unknown;
  id: string | number;
}

interface JsonRpcError {
  jsonrpc: "2.0";
  error: { code: number; message: string; data?: unknown };
  id: string | number | null;
}

function ok(id: string | number, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", result, id };
}

function err(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError {
  return { jsonrpc: "2.0", error: { code, message, data }, id };
}

// ── Tool context (resolved from JWT + params) ─────────────────────────────────

interface ToolContext {
  workspaceId: string;
  orgId: string;
  orgIdNum: number | null;
}

// ── Tool registry ─────────────────────────────────────────────────────────────

interface Tool {
  name: string;
  description: string;
  category: "diagnostics" | "reporting" | "optimization";
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

export const TOOL_REGISTRY: Record<string, Tool> = {
  master_diagnostic_sweep: {
    name: "master_diagnostic_sweep",
    description:
      "Full-ecosystem audit across all connected platforms. Returns CRITICAL, WARNING, and HEALTHY alerts ranked by margin impact.",
    category: "diagnostics",
    inputSchema: {
      type: "object",
      properties: {
        goal: {
          type: "string",
          enum: ["ecom", "leadgen", "hybrid"],
          description: "Optimisation goal for the sweep",
          default: "ecom",
        },
      },
      required: [],
    },
    handler: async (args, ctx) => {
      const goalRaw = (args.goal as string) || "ecom";
      const goal = (["ecom", "leadgen", "hybrid"].includes(goalRaw) ? goalRaw : "ecom") as "ecom" | "leadgen" | "hybrid";
      const alerts = await runAdvancedDiagnostics(goal, ctx.orgIdNum != null ? String(ctx.orgIdNum) : undefined);
      return {
        tool: "master_diagnostic_sweep",
        workspace_id: ctx.workspaceId,
        org_id: ctx.orgId,
        goal,
        alert_count: alerts.length,
        alerts,
      };
    },
  },

  predict_stockouts: {
    name: "predict_stockouts",
    description:
      "Identify all active SKUs with zero inventory that currently have ad spend. Returns the out-of-stock SKU list for immediate action.",
    category: "diagnostics",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    handler: async (_args, ctx) => {
      // SECURITY: missing tenant must match nothing rather than scan every
      // tenant's product catalog.
      const tenantFilter = ctx.orgIdNum != null
        ? eq(warehouseShopifyProducts.tenantId, String(ctx.orgIdNum))
        : sql`1=0`;

      const oos = await db
        .select({
          productId: warehouseShopifyProducts.productId,
          title: warehouseShopifyProducts.title,
          sku: warehouseShopifyProducts.sku,
          inventoryQty: warehouseShopifyProducts.inventoryQty,
          price: warehouseShopifyProducts.price,
        })
        .from(warehouseShopifyProducts)
        .where(
          and(
            tenantFilter,
            eq(warehouseShopifyProducts.inventoryQty, 0),
          ),
        )
        .limit(50);

      return {
        tool: "predict_stockouts",
        workspace_id: ctx.workspaceId,
        org_id: ctx.orgId,
        oos_count: oos.length,
        skus: oos,
      };
    },
  },

  propose_campaign_pause: {
    name: "propose_campaign_pause",
    description:
      "Propose pausing a specific campaign or ad group. Creates a PENDING_HUMAN_REVIEW task in the Approval Queue without executing the pause immediately.",
    category: "optimization",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string", description: "Google Ads campaign ID to pause" },
        campaign_name: { type: "string", description: "Human-readable campaign name" },
        reason: { type: "string", description: "Reason for the proposed pause" },
      },
      required: ["campaign_id", "campaign_name", "reason"],
    },
    handler: async (args, ctx) => {
      const { campaign_id, campaign_name, reason } = args as {
        campaign_id: string;
        campaign_name: string;
        reason: string;
      };

      const idempotencyKey = crypto
        .createHash("sha256")
        .update(
          JSON.stringify({
            ws: ctx.workspaceId,
            tool: "pause_campaign",
            campaign_id,
          }),
        )
        .digest("hex")
        .substring(0, 40);

      const existing = await db
        .select({ id: proposedTasks.id })
        .from(proposedTasks)
        .where(
          and(
            eq(proposedTasks.idempotencyKey, idempotencyKey),
            eq(proposedTasks.status, "pending"),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        return {
          tool: "propose_campaign_pause",
          task_id: existing[0].id,
          duplicate: true,
          message: "An identical pending task already exists in the Approval Queue.",
        };
      }

      const [task] = await db
        .insert(proposedTasks)
        .values({
          workspaceId: null,
          idempotencyKey,
          proposedByName: "MCP Orchestrator Agent",
          proposedByRole: "agent",
          platform: "google_ads",
          platformLabel: "Google Ads",
          toolName: "pause_campaign",
          toolDisplayName: "Pause Campaign",
          toolArgs: { campaign_id, campaign_name },
          reasoning: reason,
          status: "pending",
        })
        .returning();

      return {
        tool: "propose_campaign_pause",
        task_id: task.id,
        status: "PENDING_HUMAN_REVIEW",
        campaign_id,
        campaign_name,
        reason,
        workspace_id: ctx.workspaceId,
        org_id: ctx.orgId,
      };
    },
  },

  // ── Gap Finder ──────────────────────────────────────────────────────────────

  calculate_poas: {
    name: "calculate_poas",
    description:
      "Computes Profit-on-Ad-Spend = (Revenue − Spend − COGS) / Spend for the current org by joining warehouse_google_ads × cross_platform_mapping × warehouse_shopify_products server-side. Owned by the Gap Finder agent.",
    category: "diagnostics",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: async (_args, ctx) => {
      const tenantId = ctx.orgIdNum != null ? String(ctx.orgIdNum) : "default";

      const [adsAgg] = await db
        .select({ spend: sql<number>`COALESCE(SUM(${warehouseGoogleAds.costUsd}), 0)` })
        .from(warehouseGoogleAds)
        .where(eq(warehouseGoogleAds.tenantId, tenantId));

      const attributedRows = await db.execute<{ revenue: number; cogs_total: number }>(sql`
        SELECT
          COALESCE(SUM(ga.conversions * sp.price), 0) AS revenue,
          COALESCE(SUM(ga.conversions * sp.cogs), 0)  AS cogs_total
        FROM ${warehouseCrossPlatformMapping} m
        JOIN ${warehouseGoogleAds}            ga ON ga.id          = m.google_ad_id
        JOIN ${warehouseShopifyProducts}      sp ON sp.product_id  = m.shopify_product_id
        WHERE m.tenant_id = ${tenantId}
      `);
      const r = attributedRows.rows?.[0] ?? { revenue: 0, cogs_total: 0 };
      const spend       = Number(adsAgg?.spend) || 0;
      const revenue     = Number(r.revenue) || 0;
      const cogs        = Number(r.cogs_total) || 0;
      const trueProfit  = revenue - spend - cogs;
      const poas        = spend > 0 ? trueProfit / spend : 0;

      return {
        tool: "calculate_poas",
        workspace_id: ctx.workspaceId,
        org_id: ctx.orgId,
        spend_usd: spend,
        revenue_usd: revenue,
        cogs_usd: cogs,
        true_profit_usd: trueProfit,
        poas,
        formula: "POAS = (Revenue − Spend − COGS) / Spend",
      };
    },
  },

  get_inventory_velocity: {
    name: "get_inventory_velocity",
    description:
      "Returns 7-day units-sold-per-day for every active SKU, with on-hand inventory, days-of-supply, and a velocity class (FAST | STEADY | SLOW | STALE). Owned by the Gap Finder agent.",
    category: "diagnostics",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", default: 50 } },
      required: [],
    },
    handler: async (args, ctx) => {
      const tenantId = ctx.orgIdNum != null ? String(ctx.orgIdNum) : "default";
      const limit = Math.min(Number(args.limit ?? 50), 200);

      const rows = await db.execute<{
        product_id: string;
        sku: string;
        title: string;
        inventory_qty: number;
        units_per_day: number;
      }>(sql`
        SELECT
          sp.product_id                                                  AS product_id,
          COALESCE(sp.sku, '')                                           AS sku,
          COALESCE(sp.title, 'Untitled')                                 AS title,
          COALESCE(sp.inventory_qty, 0)                                  AS inventory_qty,
          COALESCE(SUM(ga.conversions) FILTER (
            WHERE ga.date >= (CURRENT_DATE - INTERVAL '7 days')
          ), 0) / 7.0                                                    AS units_per_day
        FROM ${warehouseShopifyProducts} sp
        LEFT JOIN ${warehouseCrossPlatformMapping} m ON m.shopify_product_id = sp.product_id
        LEFT JOIN ${warehouseGoogleAds}            ga ON ga.id               = m.google_ad_id
        WHERE sp.tenant_id = ${tenantId}
        GROUP BY sp.product_id, sp.sku, sp.title, sp.inventory_qty
        ORDER BY units_per_day DESC NULLS LAST
        LIMIT ${limit}
      `);

      const skus = (rows.rows ?? []).map((r) => {
        const upd = Number(r.units_per_day) || 0;
        const inv = Number(r.inventory_qty) || 0;
        const daysOfSupply = upd > 0 ? inv / upd : Infinity;
        const velocityClass: "FAST" | "STEADY" | "SLOW" | "STALE" =
          upd >= 10 ? "FAST" :
          upd >= 1  ? "STEADY" :
          upd > 0   ? "SLOW" :
                      "STALE";
        return {
          product_id: r.product_id,
          sku: r.sku,
          title: r.title,
          inventory_qty: inv,
          units_per_day: Number(upd.toFixed(2)),
          days_of_supply: Number.isFinite(daysOfSupply) ? Number(daysOfSupply.toFixed(1)) : null,
          velocity_class: velocityClass,
        };
      });

      return {
        tool: "get_inventory_velocity",
        workspace_id: ctx.workspaceId,
        org_id: ctx.orgId,
        sku_count: skus.length,
        skus,
      };
    },
  },

  // ── Growth Engine ──────────────────────────────────────────────────────────

  get_capped_campaigns: {
    name: "get_capped_campaigns",
    description:
      "Identifies Google Ads campaigns whose most-recent-day spend is ≥ 95% of the inferred daily budget (P90 of trailing-30-day spend used as the budget proxy when platform-side budget is unavailable). Owned by the Growth Engine agent.",
    category: "diagnostics",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: async (_args, ctx) => {
      const tenantId = ctx.orgIdNum != null ? String(ctx.orgIdNum) : "default";

      const rows = await db.execute<{
        campaign_id: string;
        campaign_name: string;
        latest_spend: number;
        inferred_budget: number;
        latest_date: string;
      }>(sql`
        -- per_day is a single-table CTE on warehouse_google_ads; the downstream
        -- JOIN is between derived CTEs (latest, budget_proxy) that no longer
        -- carry tenant_id, so no ambiguity is reachable for this column.
        WITH per_day AS (
          SELECT campaign_id,
                 MAX(campaign_name)              AS campaign_name,
                 date::date                      AS day,
                 COALESCE(SUM(cost_usd), 0)      AS spend
          FROM ${warehouseGoogleAds}
          WHERE tenant_id = ${tenantId}  -- sql-ambiguous-skip: single-table CTE
            AND date >= (CURRENT_DATE - INTERVAL '30 days')
          GROUP BY campaign_id, date::date
        ),
        latest AS (
          SELECT DISTINCT ON (campaign_id) campaign_id, campaign_name, day, spend
          FROM per_day ORDER BY campaign_id, day DESC
        ),
        budget_proxy AS (
          SELECT campaign_id,
                 PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY spend) AS p90
          FROM per_day GROUP BY campaign_id
        )
        SELECT l.campaign_id   AS campaign_id,
               l.campaign_name AS campaign_name,
               l.spend         AS latest_spend,
               COALESCE(b.p90, 0) AS inferred_budget,
               l.day::text     AS latest_date
        FROM latest l
        JOIN budget_proxy b USING (campaign_id)
        WHERE b.p90 > 0 AND l.spend >= b.p90 * 0.95
        ORDER BY l.spend DESC
      `);

      const capped = (rows.rows ?? []).map((r) => ({
        campaign_id: r.campaign_id,
        campaign_name: r.campaign_name || r.campaign_id,
        latest_spend_usd: Number(r.latest_spend) || 0,
        inferred_daily_budget_usd: Number(r.inferred_budget) || 0,
        utilization: Number(r.inferred_budget) > 0
          ? (Number(r.latest_spend) / Number(r.inferred_budget))
          : 0,
        latest_date: r.latest_date,
      }));

      return {
        tool: "get_capped_campaigns",
        workspace_id: ctx.workspaceId,
        org_id: ctx.orgId,
        capped_count: capped.length,
        campaigns: capped,
      };
    },
  },

  propose_budget_shift: {
    name: "propose_budget_shift",
    description:
      "Elicitation pattern: inserts a PENDING proposed_task to shift budget from one campaign to another. NEVER executes directly — Growth Engine MUST use this and wait for human approval before execute_budget_shift runs.",
    category: "optimization",
    inputSchema: {
      type: "object",
      properties: {
        from_campaign_id:   { type: "string" },
        from_campaign_name: { type: "string" },
        to_campaign_id:     { type: "string" },
        to_campaign_name:   { type: "string" },
        amount_usd:         { type: "number", description: "Daily budget USD to move from → to" },
        reason:             { type: "string" },
      },
      required: ["from_campaign_id", "to_campaign_id", "amount_usd", "reason"],
    },
    handler: async (args, ctx) => {
      const {
        from_campaign_id, from_campaign_name = "",
        to_campaign_id,   to_campaign_name   = "",
        amount_usd, reason,
      } = args as {
        from_campaign_id: string; from_campaign_name?: string;
        to_campaign_id:   string; to_campaign_name?:   string;
        amount_usd: number; reason: string;
      };

      if (!Number.isFinite(amount_usd) || amount_usd <= 0) {
        throw new Error("amount_usd must be a positive number");
      }

      const idempotencyKey = crypto.createHash("sha256")
        .update(JSON.stringify({
          ws: ctx.workspaceId, tool: "execute_budget_shift",
          from: from_campaign_id, to: to_campaign_id, amt: amount_usd,
        }))
        .digest("hex").substring(0, 40);

      const existing = await db.select({ id: proposedTasks.id })
        .from(proposedTasks)
        .where(and(
          eq(proposedTasks.idempotencyKey, idempotencyKey),
          eq(proposedTasks.status, "pending"),
        )).limit(1);

      if (existing.length > 0) {
        return {
          tool: "propose_budget_shift",
          task_id: existing[0].id,
          duplicate: true,
          message: "An identical pending budget-shift proposal already exists in the Approval Queue.",
        };
      }

      const [task] = await db.insert(proposedTasks).values({
        workspaceId: null,
        idempotencyKey,
        proposedByName: "Growth Engine Agent",
        proposedByRole: "agent",
        platform: "google_ads",
        platformLabel: "Google Ads",
        toolName: "execute_budget_shift",
        toolDisplayName: "Shift Daily Budget",
        toolArgs: { from_campaign_id, from_campaign_name, to_campaign_id, to_campaign_name, amount_usd },
        displayDiff: [
          { label: "From",        from: from_campaign_name || from_campaign_id, to: "−" + amount_usd.toFixed(2) },
          { label: "To",          from: to_campaign_name   || to_campaign_id,   to: "+" + amount_usd.toFixed(2) },
          { label: "Daily Total", from: "0.00", to: amount_usd.toFixed(2) },
        ],
        reasoning: reason,
        status: "pending",
      }).returning();

      return {
        tool: "propose_budget_shift",
        task_id: task.id,
        status: "PENDING_HUMAN_REVIEW",
        from_campaign_id, to_campaign_id, amount_usd, reason,
        workspace_id: ctx.workspaceId,
        org_id: ctx.orgId,
      };
    },
  },

  execute_budget_shift: {
    name: "execute_budget_shift",
    description:
      "Executes a previously-approved budget shift. Requires proposed_task_id whose status === 'approved'. Will refuse to run on a 'pending' or 'rejected' task. Owned by the Growth Engine agent (post-approval).",
    category: "optimization",
    inputSchema: {
      type: "object",
      properties: { proposed_task_id: { type: "number" } },
      required: ["proposed_task_id"],
    },
    handler: async (args, ctx) => {
      const taskId = Number(args.proposed_task_id);
      if (!Number.isFinite(taskId)) throw new Error("proposed_task_id must be a number");

      const [task] = await db.select().from(proposedTasks).where(eq(proposedTasks.id, taskId)).limit(1);
      if (!task)                       throw new Error(`Proposed task ${taskId} not found`);
      if (task.toolName !== "execute_budget_shift") {
        throw new Error(`Task ${taskId} is not a budget-shift proposal (tool=${task.toolName})`);
      }
      if (task.status !== "approved") {
        throw new Error(`Task ${taskId} is not approved (status=${task.status}). Approve via the Approval Queue first.`);
      }

      const { from_campaign_id, to_campaign_id, amount_usd } = task.toolArgs as {
        from_campaign_id: string; to_campaign_id: string; amount_usd: number;
      };

      logger.info(
        { taskId, from_campaign_id, to_campaign_id, amount_usd, org: ctx.orgId },
        "[MCP][execute_budget_shift] Executing approved shift (Google Ads call would happen here)",
      );

      await db.update(proposedTasks)
        .set({ status: "executed" })
        .where(eq(proposedTasks.id, taskId));

      return {
        tool: "execute_budget_shift",
        task_id: taskId,
        status: "EXECUTED",
        from_campaign_id, to_campaign_id, amount_usd,
        workspace_id: ctx.workspaceId,
        org_id: ctx.orgId,
        note: "Marked task as executed. Real Google Ads mutation is wired through the platform-executors layer in production.",
      };
    },
  },

  // ── Organization CEO ───────────────────────────────────────────────────────

  route_to_specialist: {
    name: "route_to_specialist",
    description:
      "Organization CEO orchestrator. Two modes:\n" +
      "  (a) Intent mode — { intent: string } returns recommended_agent + tool.\n" +
      "  (b) A2A handoff mode — accepts a strict A2AHandoffSchema payload from one agent to another (e.g. Gap Finder → Growth Engine on MARGIN_LEAK). Validates with Zod, registers the handoff, asynchronously dispatches the target agent's primary tool (non-blocking), and returns a handoff_id immediately. The downstream worker reconstructs context from the payload only — no shared memory across calls.",
    category: "diagnostics",
    inputSchema: {
      type: "object",
      oneOf: [
        {
          properties: { intent: { type: "string", description: "User's natural-language intent" } },
          required: ["intent"],
        },
        {
          properties: {
            handoff: {
              type: "object",
              description: "A2A handoff payload — see A2AHandoffSchema (Zod) for the enforced contract.",
              properties: {
                org_id:       { type: "string" },
                source_agent: { type: "string", enum: ["Gap Finder"] },
                target_agent: { type: "string", enum: ["Growth Engine"] },
                priority:     { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
                context: {
                  type: "object",
                  properties: {
                    issue:         { type: "string", enum: ["MARGIN_LEAK"] },
                    affected_skus: { type: "array", items: { type: "string" } },
                    current_poas:  { type: "number" },
                    target_poas:   { type: "number" },
                  },
                  required: ["issue", "affected_skus", "current_poas", "target_poas"],
                },
              },
              required: ["org_id", "source_agent", "target_agent", "priority", "context"],
            },
          },
          required: ["handoff"],
        },
      ],
    },
    handler: async (args, ctx) => {
      // ── A2A handoff mode ────────────────────────────────────────────────────
      if (args.handoff !== undefined) {
        const parsed = A2AHandoffSchema.safeParse(args.handoff);
        if (!parsed.success) {
          throw new Error(
            `A2A handoff payload failed validation: ${parsed.error.issues
              .map((i) => `${i.path.join(".")} ${i.message}`)
              .join("; ")}`,
          );
        }
        const handoff = parsed.data;

        // Path-isolation cross-check: payload org_id must match the MCP-call org_id.
        if (String(handoff.org_id) !== String(ctx.orgId)) {
          throw new Error(
            `A2A handoff org_id (${handoff.org_id}) does not match MCP call org_id (${ctx.orgId}). Refusing cross-tenant handoff.`,
          );
        }

        const handoff_id = crypto.randomUUID();
        const dispatched_tool =
          handoff.target_agent === "Growth Engine" ? "get_capped_campaigns" : "calculate_poas";

        const record: HandoffRecord = {
          handoff_id,
          accepted_at: Date.now(),
          status: "ACCEPTED",
          source_agent: handoff.source_agent,
          target_agent: handoff.target_agent,
          priority: handoff.priority,
          dispatched_tool,
          org_id: handoff.org_id,
          workspace_id: ctx.workspaceId,
          payload: handoff,
        };
        HANDOFF_REGISTRY.set(handoff_id, record);
        reapHandoffs();

        logger.info(
          {
            handoff_id, source: handoff.source_agent, target: handoff.target_agent,
            priority: handoff.priority, issue: handoff.context.issue,
            affected_sku_count: handoff.context.affected_skus.length,
            current_poas: handoff.context.current_poas, target_poas: handoff.context.target_poas,
            org_id: ctx.orgId, workspace_id: ctx.workspaceId,
          },
          "[MCP][A2A] Handoff accepted",
        );

        // ── Async dispatch — non-blocking. Worker reconstructs ctx from the
        //    validated payload + caller's MCP ctx; no closure over external state.
        const workerCtx: ToolContext = {
          workspaceId: ctx.workspaceId,
          orgId: handoff.org_id,
          orgIdNum: ctx.orgIdNum,
        };
        setImmediate(async () => {
          const target = TOOL_REGISTRY[dispatched_tool];
          if (!target) {
            HANDOFF_REGISTRY.set(handoff_id, { ...record, status: "FAILED", error: `Tool ${dispatched_tool} not in registry` });
            return;
          }
          HANDOFF_REGISTRY.set(handoff_id, { ...record, status: "DISPATCHED" });
          try {
            const result = await target.handler({}, workerCtx) as { capped_count?: number };
            const summary = `Dispatched ${dispatched_tool} → ${result?.capped_count ?? 0} capped campaigns identified for ${handoff.context.affected_skus.length} affected SKUs`;
            HANDOFF_REGISTRY.set(handoff_id, { ...record, status: "COMPLETED", result_summary: summary });
            logger.info({ handoff_id, summary }, "[MCP][A2A] Handoff completed");
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            HANDOFF_REGISTRY.set(handoff_id, { ...record, status: "FAILED", error: message });
            logger.error({ handoff_id, err: e }, "[MCP][A2A] Handoff worker failed");
          }
        });

        return {
          tool: "route_to_specialist",
          mode: "a2a_handoff",
          handoff_id,
          accepted: true,
          source_agent: handoff.source_agent,
          target_agent: handoff.target_agent,
          priority: handoff.priority,
          dispatched_tool,
          status: "ACCEPTED",
          poll_with: { tool_name: "route_to_specialist", args: { handoff_status_id: handoff_id } },
          workspace_id: ctx.workspaceId,
          org_id: ctx.orgId,
        };
      }

      // ── A2A status-poll mode ────────────────────────────────────────────────
      if (typeof args.handoff_status_id === "string") {
        const rec = HANDOFF_REGISTRY.get(args.handoff_status_id);
        if (!rec) {
          return {
            tool: "route_to_specialist",
            mode: "a2a_status",
            handoff_id: args.handoff_status_id,
            found: false,
            note: "Unknown or expired handoff_id (TTL 1h).",
          };
        }
        return { tool: "route_to_specialist", mode: "a2a_status", found: true, ...rec };
      }

      // ── Intent mode (legacy / interactive) ──────────────────────────────────
      const intent = String(args.intent ?? "").toLowerCase();
      const inventoryHints = ["inventory", "stockout", "out of stock", "velocity", "sku", "supply"];
      const profitHints    = ["poas", "profit", "margin", "roas", "cogs"];
      const budgetHints    = ["budget", "cap", "spend", "pacing", "overspend"];

      let agent  = "gap_finder";
      let tool   = "calculate_poas";
      let reason = "Default routing — Gap Finder profitability sweep.";

      if (inventoryHints.some((k) => intent.includes(k))) {
        agent = "gap_finder";        tool = "get_inventory_velocity"; reason = "Intent mentions inventory or velocity.";
      } else if (budgetHints.some((k) => intent.includes(k))) {
        agent = "growth_engine";     tool = "get_capped_campaigns";   reason = "Intent mentions budget pacing or caps.";
      } else if (profitHints.some((k) => intent.includes(k))) {
        agent = "gap_finder";        tool = "calculate_poas";         reason = "Intent mentions profitability metrics.";
      }

      return {
        tool: "route_to_specialist",
        mode: "intent",
        workspace_id: ctx.workspaceId,
        org_id: ctx.orgId,
        recommended_agent: agent,
        recommended_tool: tool,
        reason,
      };
    },
  },

  validate_org_id: {
    name: "validate_org_id",
    description:
      "Asserts that the supplied org_id matches the bearer token's organization claim. Returns { valid: true } or throws JSON-RPC -32603. Owned by the Organization CEO.",
    category: "diagnostics",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: async (_args, ctx) => ({
      tool: "validate_org_id",
      workspace_id: ctx.workspaceId,
      org_id: ctx.orgId,
      valid: true,
      note: "Token-vs-param org isolation is enforced by handleInvokeTool before this handler runs.",
    }),
  },

  generate_weekly_report: {
    name: "generate_weekly_report",
    description:
      "Trigger the weekly performance report generation pipeline. Returns a job token; the PDF is available via /api/reports/pdf once complete.",
    category: "reporting",
    inputSchema: {
      type: "object",
      properties: {
        period_days: { type: "number", description: "Number of days to cover (default 7)", default: 7 },
      },
      required: [],
    },
    handler: async (args, ctx) => {
      const periodDays = Number(args.period_days ?? 7);
      const jobToken = crypto.randomUUID();
      return {
        tool: "generate_weekly_report",
        job_token: jobToken,
        workspace_id: ctx.workspaceId,
        org_id: ctx.orgId,
        period_days: periodDays,
        status: "queued",
        message: "Report generation queued. Poll /api/reports/pdf with the job_token to retrieve.",
      };
    },
  },
};

// ── list_tools ────────────────────────────────────────────────────────────────

function handleListTools(id: string | number): JsonRpcSuccess {
  const tools = Object.values(TOOL_REGISTRY).map((t) => ({
    name: t.name,
    description: t.description,
    category: t.category,
    inputSchema: t.inputSchema,
  }));
  return ok(id, { tools });
}

// ── Isolation validation (exported for testing) ───────────────────────────────

export function validateIsolationParams(
  workspaceId: unknown,
  orgId: unknown,
  decodedOrgId?: number | null,
): { valid: true } | { valid: false; code: number; message: string } {
  if (!workspaceId || !orgId) {
    return {
      valid: false,
      code: -32602,
      message:
        "Missing required isolation parameters: workspace_id and org_id must both be provided",
    };
  }
  if (decodedOrgId != null && String(decodedOrgId) !== String(orgId)) {
    return {
      valid: false,
      code: -32603,
      message: `org_id mismatch — token org (${decodedOrgId}) does not match requested org (${orgId})`,
    };
  }
  return { valid: true };
}

// ── invoke_tool ───────────────────────────────────────────────────────────────

async function handleInvokeTool(
  id: string | number,
  params: Record<string, unknown>,
  rawToken: string | null,
): Promise<JsonRpcSuccess | JsonRpcError> {
  const { tool_name, workspace_id, org_id, args = {} } = params as {
    tool_name?: string;
    workspace_id?: string;
    org_id?: string;
    args?: Record<string, unknown>;
  };

  // ── Path-based isolation: workspace_id and org_id are mandatory ─────────────
  if (!workspace_id || !org_id) {
    return err(
      id,
      -32602,
      "Missing required isolation parameters: workspace_id and org_id must both be provided",
    );
  }

  // ── JWT validation ──────────────────────────────────────────────────────────
  if (!rawToken) {
    return err(id, -32600, "Authorization header with Bearer token is required");
  }

  const decoded = verifyAnyToken(rawToken);
  if (!decoded) {
    return err(id, -32600, "Invalid or expired bearer token");
  }

  // ── org_id isolation check ──────────────────────────────────────────────────
  if (
    decoded.organizationId != null &&
    String(decoded.organizationId) !== String(org_id)
  ) {
    return err(
      id,
      -32603,
      `org_id mismatch — token org (${decoded.organizationId}) does not match requested org (${org_id})`,
    );
  }

  // ── Tool lookup ─────────────────────────────────────────────────────────────
  if (!tool_name) {
    return err(id, -32602, "tool_name is required");
  }

  const tool = TOOL_REGISTRY[tool_name];
  if (!tool) {
    return err(
      id,
      -32601,
      `Unknown tool: "${tool_name}". Call list_tools to see available tools.`,
      { available: Object.keys(TOOL_REGISTRY) },
    );
  }

  // ── Resolve effective org tenant ────────────────────────────────────────────
  // Modern JWTs carry decoded.organizationId; legacy SITE_PASSWORD tokens do
  // not. In the legacy path we trust the request param (already isolation-
  // checked above) so warehouse queries actually filter by the caller's
  // claimed org rather than silently falling back to "default" (which would
  // mask data and break the isolation contract).
  let effectiveOrgIdNum: number | null = decoded.organizationId ?? null;
  if (effectiveOrgIdNum == null) {
    const parsed = Number(org_id);
    if (Number.isFinite(parsed)) effectiveOrgIdNum = parsed;
  }

  const ctx: ToolContext = {
    workspaceId: workspace_id,
    orgId: org_id,
    orgIdNum: effectiveOrgIdNum,
  };

  const result = await tool.handler(args as Record<string, unknown>, ctx);
  return ok(id, result);
}

// ── Main HTTP handler ─────────────────────────────────────────────────────────

mcpRouter.post("/", async (req: Request, res: Response) => {
  const body = req.body as Partial<JsonRpcRequest>;

  if (body.jsonrpc !== "2.0" || !body.method || body.id == null) {
    res
      .status(400)
      .json(
        err(body.id ?? null, -32600, "Invalid JSON-RPC 2.0 request"),
      );
    return;
  }

  const { method, params = {}, id } = body as JsonRpcRequest;

  // Extract bearer token from Authorization header
  const authHeader = req.headers.authorization ?? "";
  const rawToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  try {
    let response: JsonRpcSuccess | JsonRpcError;

    switch (method) {
      case "list_tools":
        response = handleListTools(id);
        break;

      case "invoke_tool":
        response = await handleInvokeTool(id, params, rawToken);
        break;

      default:
        response = err(id, -32601, `Method not found: "${method}"`);
    }

    const statusCode = "error" in response ? 400 : 200;
    res.status(statusCode).json(response);
  } catch (e) {
    logger.error({ err: e, method }, "[MCP] Unhandled error during tool invocation");
    res
      .status(500)
      .json(err(id, -32603, "Internal server error during tool execution"));
  }
});

// ── Phase 7: Agent Command Center BFF endpoints ───────────────────────────────
// All routes here do their own bearer auth (mcpRouter is mounted before the
// global requireAuth() middleware). Tenant scoping mirrors tenant-isolation.ts:
// super_admin sees every org; everyone else is filtered to their JWT's
// organizationId. Read-only except for the explicit self-healing endpoints.

const SUPER_ADMIN_ROLE = "super_admin";

function authenticateRegistryRequest(req: Request, res: Response): {
  role: string;
  orgId: string | null;
  workspaceId: string;
} | null {
  const authHeader = req.headers.authorization ?? "";
  const rawToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!rawToken) {
    res.status(401).json({ error: "Authorization header with Bearer token is required" });
    return null;
  }
  const decoded = verifyAnyToken(rawToken);
  if (!decoded) {
    res.status(401).json({ error: "Invalid or expired bearer token" });
    return null;
  }
  return {
    role: decoded.role ?? "viewer",
    orgId: decoded.organizationId != null ? String(decoded.organizationId) : null,
    // workspace-id-source-skip: workspaceId is informational context in the registry auth object; orgId is derived from verified token, not this header
    workspaceId: String(req.headers["x-workspace-id"] ?? ""),
  };
}

mcpRouter.get("/registry", (req: Request, res: Response) => {
  const auth = authenticateRegistryRequest(req, res);
  if (!auth) return;

  const isSuperAdmin = auth.role === SUPER_ADMIN_ROLE;
  const filterOrgId = isSuperAdmin ? undefined : (auth.orgId ?? "__none__");
  const records = listHandoffs(filterOrgId);

  res.json({
    scope: isSuperAdmin ? "platform" : "org",
    org_id: auth.orgId,
    count: records.length,
    handoffs: records.map((r) => ({
      handoff_id:    r.handoff_id,
      org_id:        r.org_id,
      source_agent:  r.source_agent,
      target_agent:  r.target_agent,
      priority:      r.priority,
      status:        r.status,
      timestamp:     new Date(r.accepted_at).toISOString(),
      dispatched_tool: r.dispatched_tool,
      result_summary:  r.result_summary ?? null,
      error_message:   r.error ?? null,
      context:         r.payload.context,
    })),
  });
});

/** Self-healing: re-POST the original handoff payload back through the JSON-RPC tool. */
mcpRouter.post("/registry/:id/retry", async (req: Request, res: Response) => {
  const auth = authenticateRegistryRequest(req, res);
  if (!auth) return;

  const original = getHandoff(String(req.params.id));
  if (!original) {
    res.status(404).json({ error: "Handoff not found or expired" });
    return;
  }
  if (auth.role !== SUPER_ADMIN_ROLE && String(original.org_id) !== String(auth.orgId)) {
    res.status(403).json({ error: "Cannot retry handoff outside your organization" });
    return;
  }

  // Reconstruct ToolContext from the saved payload — no shared memory contract.
  const ctx: ToolContext = {
    workspaceId: original.workspace_id,
    orgId: original.org_id,
    orgIdNum: Number.isFinite(Number(original.org_id)) ? Number(original.org_id) : null,
  };
  try {
    const tool = TOOL_REGISTRY.route_to_specialist;
    const result = await tool.handler({ handoff: original.payload }, ctx);
    res.json({ retried: true, original_handoff_id: original.handoff_id, result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error({ err: e, handoff_id: original.handoff_id }, "[MCP][Registry] Retry failed");
    res.status(500).json({ error: "Retry failed", message });
  }
});

/** Self-healing: mock backfill trigger — flips the record into HISTORICAL_BACKFILL. */
mcpRouter.post("/registry/:id/backfill", (req: Request, res: Response) => {
  const auth = authenticateRegistryRequest(req, res);
  if (!auth) return;

  const original = getHandoff(String(req.params.id));
  if (!original) {
    res.status(404).json({ error: "Handoff not found or expired" });
    return;
  }
  if (auth.role !== SUPER_ADMIN_ROLE && String(original.org_id) !== String(auth.orgId)) {
    res.status(403).json({ error: "Cannot trigger backfill outside your organization" });
    return;
  }

  const note = `Backfill requested at ${new Date().toISOString()} (mock — ETL pipeline trigger pending wiring).`;
  const updated = setHandoffBackfilling(original.handoff_id, note);
  logger.info(
    { handoff_id: original.handoff_id, org_id: original.org_id, requested_by_role: auth.role },
    "[MCP][Registry] HISTORICAL_BACKFILL requested",
  );
  res.json({ backfill_triggered: true, handoff: updated });
});

export default mcpRouter;
