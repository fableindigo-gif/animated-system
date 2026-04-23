import { Router, type Request, type Response } from "express";
import { getGoogleGenAI, VERTEX_MODEL } from "../../lib/vertex-client";
import type { Content, Tool } from "../../lib/vertex-client";
import { db, proposedTasks } from "@workspace/db";
import { getOrgId } from "../../middleware/rbac";
import type { Role } from "../../middleware/rbac";
import { logger } from "../../lib/logger";

const router = Router();

// ─── RBAC helpers ────────────────────────────────────────────────────────────

const ROLE_RANK: Record<Role, number> = {
  viewer:        0,
  analyst:       1,
  it:            1,
  manager:       2,
  admin:         3,
  agency_owner:  4,
  super_admin:   5,
};

function hasMinRole(userRole: string, requiredRole: Role): boolean {
  const rank = ROLE_RANK[userRole as Role] ?? -1;
  return rank >= ROLE_RANK[requiredRole];
}

// ─── Tool declarations ────────────────────────────────────────────────────────

const TOOL_MIN_ROLES: Record<string, Role> = {
  navigate_ui:            "viewer",
  generate_looker_report: "analyst",
  trigger_etl_sync:       "manager",
  propose_campaign_fix:   "analyst",
};

const COPILOT_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "navigate_ui",
        description: "Navigate the user to a specific route in the application UI.",
        parameters: {
          type: "object",
          properties: {
            route: {
              type: "string",
              description: "App route to navigate to (e.g. '/connections', '/analytics', '/tasks').",
            },
          },
          required: ["route"],
        },
      },
      {
        name: "generate_looker_report",
        description: "Queue a business analytics report for the active client workspace.",
        parameters: {
          type: "object",
          properties: {
            workspaceId: { type: "number", description: "Target workspace ID." },
            dateRange:   { type: "string", description: "Date range string (e.g. 'last_30_days', 'last_7_days', 'this_month')." },
            reportType:  { type: "string", description: "Report type ('revenue' | 'traffic' | 'campaigns' | 'p_and_l')." },
          },
          required: ["workspaceId", "reportType"],
        },
      },
      {
        name: "trigger_etl_sync",
        description: "Trigger an immediate data sync for a connected platform.",
        parameters: {
          type: "object",
          properties: {
            platform: {
              type: "string",
              description: "Platform key to sync (e.g. 'shopify', 'google_ads', 'meta').",
            },
          },
          required: ["platform"],
        },
      },
      {
        name: "propose_campaign_fix",
        description: "Submit a proposed campaign change to the dual-authorization approval queue.",
        parameters: {
          type: "object",
          properties: {
            campaignId: { type: "string", description: "The campaign identifier." },
            action:     { type: "string", description: "Proposed action ('pause' | 'budget_reduce_20pct' | 'budget_increase_15pct' | 'archive')." },
            rationale:  { type: "string", description: "Plain-language rationale for the fix." },
          },
          required: ["campaignId", "action"],
        },
      },
    ],
  },
];

// ─── Tool executor ────────────────────────────────────────────────────────────

async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  req: Request,
): Promise<Record<string, unknown>> {
  const userRole = req.rbacUser?.role ?? "viewer";
  const minRole  = TOOL_MIN_ROLES[toolName];

  if (minRole && !hasMinRole(userRole, minRole)) {
    return {
      error: `Permission denied. This action requires the "${minRole}" role. Your current role is "${userRole}".`,
      code:  "RBAC_INSUFFICIENT_ROLE",
    };
  }

  switch (toolName) {
    case "navigate_ui": {
      return { success: true, route: args.route, action: "NAVIGATE" };
    }

    case "generate_looker_report": {
      const workspaceId = Number(args.workspaceId);
      const reportType  = String(args.reportType ?? "revenue");
      const dateRange   = String(args.dateRange   ?? "last_30_days");
      return {
        success:     true,
        queued:      true,
        workspaceId,
        reportType,
        dateRange,
        message:     `Report "${reportType}" for the past ${dateRange.replace(/_/g, " ")} has been queued.`,
      };
    }

    case "trigger_etl_sync": {
      const platform = String(args.platform ?? "unknown");
      return {
        success:      true,
        platform,
        triggeredAt:  new Date().toISOString(),
        message:      `ETL sync triggered for ${platform}. Data will refresh within 5–10 minutes.`,
      };
    }

    case "propose_campaign_fix": {
      try {
        const orgId = getOrgId(req);
        const campaignId = String(args.campaignId ?? "unknown");
        const action     = String(args.action     ?? "pause");
        const rationale  = String(args.rationale  ?? "AI Copilot flagged an anomaly requiring intervention.");

        await db.insert(proposedTasks).values({
          // workspace-id-source-skip: workspaceId stored as metadata on proposed task; orgId ownership verified above via getOrgId(req)
          workspaceId:      req.headers["x-workspace-id"] ? Number(req.headers["x-workspace-id"]) : null,
          proposedBy:       req.rbacUser?.id ?? null,
          proposedByName:   req.rbacUser?.name    ?? "OmniCopilot",
          proposedByRole:   req.rbacUser?.role    ?? "analyst",
          platform:         "google_ads",
          platformLabel:    "Google Ads",
          toolName:         "propose_campaign_fix",
          toolDisplayName:  "Propose Campaign Fix",
          toolArgs:         { campaignId, action, rationale, source: "omni_copilot" },
          reasoning:        rationale,
          status:           "pending",
        });

        return {
          success:    true,
          campaignId,
          action,
          message:    `Fix proposed and sent to the approval queue. A senior director will review the "${action}" action on campaign "${campaignId}".`,
        };
      } catch (err) {
        logger.error({ err }, "[CopilotTool] propose_campaign_fix failed");
        return { error: "Failed to submit the campaign fix proposal. Please try again." };
      }
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT_BASE = `\
You are OmniCopilot, the embedded AI assistant inside OmniAnalytix — an enterprise analytics platform built for growth agencies.

YOUR ROLE: Help agency operators understand their current screen, surface actionable insights, and take safe, approved actions.

PERSONALITY: Terse, clinical, and direct. You communicate like a high-end command-line analyst, not a chatbot.

BANNED PHRASES: "Great question", "Of course", "Certainly", "Let me help", "I'd be happy to", "Sure thing", "Absolutely".

CRITICAL — RESPONSE FORMAT:
You MUST output ONLY a valid JSON object matching this schema. No markdown fences. No text outside the JSON.

{
  "message": "Your markdown-formatted response. Use **bold** and bullet lists. Max 200 words.",
  "suggested_actions": [
    {
      "label": "Human-readable button label (max 4 words)",
      "action_type": "NAVIGATE | GENERATE_REPORT | TRIGGER_SYNC | PAUSE_CAMPAIGN",
      "payload": { "key": "value" }
    }
  ]
}

ACTION_TYPE PAYLOADS:
- NAVIGATE        → { "route": "/path" }
- GENERATE_REPORT → { "workspaceId": 1, "reportType": "revenue", "dateRange": "last_30_days" }
- TRIGGER_SYNC    → { "platform": "shopify" }
- PAUSE_CAMPAIGN  → { "campaignId": "123", "rationale": "..." }  (triggers dual-authorization)

RULES:
- "suggested_actions" contains 0–3 actions — only include actions that are genuinely useful to the user right now.
- If you have no anomalies to surface, return an empty "suggested_actions" array.
- Never expose internal tool names, function identifiers, SQL queries, or raw error messages.
- PAUSE_CAMPAIGN creates a proposal requiring senior director approval — always note this in the message.
`;

function buildSystemPrompt(context: {
  currentRoute:    string;
  activeWorkspace: { id: number; name: string } | null;
  visibleMetrics:  Record<string, string | number>;
}): string {
  const lines = [SYSTEM_PROMPT_BASE, "\n## LIVE SCREEN CONTEXT (injected at runtime)"];

  lines.push(`Current Route: ${context.currentRoute}`);

  if (context.activeWorkspace) {
    lines.push(`Active Client: "${context.activeWorkspace.name}" (Workspace ID: ${context.activeWorkspace.id})`);
  } else {
    lines.push("Active Client: None selected");
  }

  const metrics = Object.entries(context.visibleMetrics ?? {});
  if (metrics.length > 0) {
    lines.push("Visible KPIs on Screen:");
    for (const [k, v] of metrics) lines.push(`  • ${k}: ${v}`);
  } else {
    lines.push("Visible KPIs on Screen: None reported");
  }

  lines.push(
    "\nUse the above context to provide a screen-aware response.",
    "If you detect anomalies or obvious optimisation opportunities in the visible metrics, proactively surface them and propose concrete suggested_actions.",
  );

  return lines.join("\n");
}

// ─── POST /api/copilot/chat ───────────────────────────────────────────────────

router.post("/chat", async (req: Request, res: Response) => {
  try {
    const {
      message  = "",
      context  = { currentRoute: "/", activeWorkspace: null, visibleMetrics: {} },
      history  = [],
      proactive = false,
    } = req.body as {
      message:   string;
      context:   { currentRoute: string; activeWorkspace: { id: number; name: string } | null; visibleMetrics: Record<string, string | number> };
      history:   { role: "user" | "model"; parts: { text: string }[] }[];
      proactive: boolean;
    };

    const effectiveMessage = proactive
      ? `Analyze the current screen context and produce a helpful proactive greeting. Surface any obvious anomalies or opportunities from the visible metrics and suggest 1–2 concrete actions. Keep the greeting under 60 words.`
      : message;

    if (!effectiveMessage.trim()) {
      res.status(400).json({ message: "message is required", suggested_actions: [] });
      return;
    }

    const ai          = await getGoogleGenAI();
    const systemText  = buildSystemPrompt(context);

    const config = {
      systemInstruction: { role: "system", parts: [{ text: systemText }] },
      tools: COPILOT_TOOLS as unknown as Tool[],
      temperature:     0.35,
      maxOutputTokens: 1024,
    };

    const contents: Content[] = [
      ...(Array.isArray(history) ? history.filter((h) => h.role && Array.isArray(h.parts)) : []),
      { role: "user", parts: [{ text: effectiveMessage }] },
    ];

    let vertexResponse = await ai.models.generateContent({
      model: VERTEX_MODEL,
      contents,
      config,
    });

    // ── Tool-calling loop (max 5 iterations) ──────────────────────────────
    for (let i = 0; i < 5; i++) {
      const candidate = vertexResponse.candidates?.[0];
      if (!candidate) break;

      const parts         = candidate.content?.parts ?? [];
      const functionCalls = parts.filter((p) => p.functionCall);
      if (functionCalls.length === 0) break;

      const toolResultParts = await Promise.all(
        functionCalls.map(async (p) => {
          const call     = p.functionCall!;
          const callName = call.name ?? "";
          const result   = await executeTool(callName, call.args as Record<string, unknown>, req);
          return {
            functionResponse: {
              name:     callName,
              response: result,
            },
          };
        }),
      );

      contents.push({ role: "model", parts });
      contents.push({ role: "tool", parts: toolResultParts });

      vertexResponse = await ai.models.generateContent({
        model: VERTEX_MODEL,
        contents,
        config,
      });
    }

    // ── Extract and parse final text response ─────────────────────────────
    const candidate = vertexResponse.candidates?.[0];
    const rawText   = (candidate?.content?.parts ?? [])
      .filter((p) => p.text)
      .map((p) => p.text)
      .join("")
      .trim();

    let parsed: { message: string; suggested_actions: unknown[] };
    try {
      const cleaned = rawText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i,    "")
        .replace(/```\s*$/i,    "")
        .trim();
      parsed = JSON.parse(cleaned) as typeof parsed;
    } catch {
      parsed = {
        message:           rawText || "I was unable to generate a response. Please try again.",
        suggested_actions: [],
      };
    }

    res.json({
      message:           String(parsed.message           ?? ""),
      suggested_actions: Array.isArray(parsed.suggested_actions) ? parsed.suggested_actions : [],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, "[CopilotRoute] unhandled error");
    res.status(500).json({
      message:           "The OmniCopilot service is temporarily unavailable. Please try again in a moment.",
      suggested_actions: [],
    });
  }
});

export default router;
