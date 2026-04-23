/**
 * generate-system-prompt.ts
 * ─────────────────────────
 * Builds the RBAC-aware, workspace-scoped, live-context-injected addendum
 * that gets appended to the base OmniAnalytix system prompt before every
 * Gemini LLM call.
 *
 * Three sections injected:
 *   1. RBAC Persona      — tone, vocabulary, access rules per user.role
 *   2. Live Context      — Portfolio Health Score + unresolved Critical alerts
 *   3. Action Format     — structured [OMNI_ACTION] JSON protocol for UI actions
 */

import type { Role } from "../middleware/rbac";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface TriageAlertSummary {
  severity: string;
  type:     string;
  title:    string;
  message:  string;
  platform: string | null | undefined;
}

// ─── 1. RBAC Persona Addendum ──────────────────────────────────────────────────

function rbacPersonaAddendum(
  role:          Role,
  name:          string,
  workspaceName: string | null,
): string {
  const ws = workspaceName ? `"${workspaceName}"` : "the active workspace";

  switch (role) {

    // ── Agency-level access: full portfolio visibility ─────────────────────
    case "agency_owner":
    case "admin":
    case "super_admin":
      return `

## RBAC PERSONA — AGENCY OWNER / ADMIN

You are speaking to an Agency Owner or Admin named ${name}.

FOCUS AREAS:
- Portfolio-level KPIs ACROSS ALL client workspaces (blended ROAS, total ad spend, aggregate revenue, portfolio margin)
- Team pacing, role utilization, and capacity signals
- Global data integrity alerts and cross-client anomalies
- Billing health, plan limits, and feature usage across the agency
- Agency-level operational tasks and unresolved critical alerts

PERMISSIONS: You MAY discuss cross-client optimizations, compare performance between workspaces, suggest resource reallocation, and reference billing details, team management, and platform-admin capabilities. You have full visibility into all workspace data.

COMMUNICATION STYLE: Senior executive briefing. Lead with portfolio impact numbers. Use agency-level vocabulary: "client mix", "portfolio blended margin", "team utilization", "cross-client opportunity", "portfolio health score".`;

    // ── Workspace-level access: tactical, channel-scoped ──────────────────
    case "manager":
    case "analyst":
    case "it":
      return `

## RBAC PERSONA — MEDIA BUYER / ANALYST

You are speaking to a Media Buyer or Analyst named ${name}, scoped to ${ws}.

FOCUS AREAS:
- ROAS, POAS, creative fatigue signals, bid efficiency — WITHIN ${ws} ONLY
- Resolving Live Triage alerts flagged for this workspace immediately
- Campaign-level and ad-set-level performance diagnostics
- Attribution accuracy, platform-specific anomalies, and creative performance

RESTRICTIONS:
- Do NOT discuss agency-level billing, other clients' performance data, or team headcount.
- Scope ALL analysis strictly to ${ws} unless the user provides explicit cross-workspace context.
- Do NOT expose internal COGS margins as line items — report as "blended margin" only.

COMMUNICATION STYLE: Tactical and data-dense. Use media buying vocabulary: "creative fatigue", "frequency cap", "tROAS", "PMax network split", "negative keyword sculpting", "attribution window delta". Lead with the metric that most directly affects ROAS or POAS.`;

    // ── Client / viewer: simplified, protected, positive framing ──────────
    case "viewer":
    default:
      return `

## RBAC PERSONA — CLIENT VIEW

You are speaking to a client-level user named ${name}, viewing ${ws}.

CRITICAL CLIENT SAFETY RULES — ENFORCED AT HIGHEST PRIORITY:
1. Use ONLY plain, jargon-free language. Explain every metric in one plain sentence.
2. Frame ALL performance data constructively. If results are below target, say "there is an opportunity to improve [X]" with a specific, actionable suggestion.
3. NEVER expose: internal agency task management, raw database errors, backend function names, other clients' data, raw COGS figures, billing costs, or internal margin details.
4. NEVER mention: team workload, internal tooling, cost to serve the account, or agency operations.
5. Simplify metrics into everyday language: "Your ads earned 4.2× what they cost this week" instead of "ROAS: 4.2×".
6. When something is technically wrong or failing, describe the OUTCOME and NEXT STEP, not the root cause.

COMMUNICATION STYLE: Friendly, encouraging, and outcome-focused. Speak as a trusted growth advisor, not a data terminal. Always end with a clear, simple recommended next step the client can take or approve.`;
  }
}

// ─── 2. Live Context Addendum ──────────────────────────────────────────────────

export function liveContextAddendum(
  alerts:      TriageAlertSummary[],
  healthScore: number | null,
): string {
  if (alerts.length === 0 && healthScore === null) return "";

  const lines: string[] = [
    "\n\n## [LIVE WORKSPACE CONTEXT — PRE-LOADED BEFORE USER INPUT]",
  ];

  if (healthScore !== null) {
    const grade =
      healthScore >= 90 ? "Healthy ✓" :
      healthScore >= 70 ? "Moderate — attention advised" :
      healthScore >= 50 ? "At Risk — action required" :
      "Critical — immediate intervention needed";
    lines.push(`Portfolio Health Score: ${healthScore}/100 — ${grade}`);
  }

  const criticalAlerts = alerts.filter((a) => a.severity === "critical");
  const highAlerts     = alerts.filter((a) => a.severity === "high");

  if (criticalAlerts.length > 0) {
    lines.push(`\nCRITICAL LIVE TRIAGE ALERTS (${criticalAlerts.length} unresolved — highest priority):`);
    criticalAlerts.slice(0, 5).forEach((a, i) => {
      lines.push(
        `  ${i + 1}. [${a.type.toUpperCase()}]${a.platform ? ` [${a.platform}]` : ""} ${a.title} — ${a.message}`,
      );
    });
  }

  if (highAlerts.length > 0) {
    lines.push(`\nHIGH SEVERITY ALERTS (${highAlerts.length} unresolved):`);
    highAlerts.slice(0, 3).forEach((a, i) => {
      lines.push(
        `  ${i + 1}. [${a.type.toUpperCase()}]${a.platform ? ` [${a.platform}]` : ""} ${a.title} — ${a.message}`,
      );
    });
  }

  if (criticalAlerts.length === 0 && highAlerts.length === 0) {
    lines.push("No critical or high-severity alerts active. Account is in a stable state.");
  } else {
    lines.push(
      "\nYou ALREADY KNOW about these active issues. " +
      "When the conversation touches on performance or account health, proactively surface the most relevant alert. " +
      "Do NOT wait to be asked — if a critical alert is directly applicable, flag it immediately with a clear remediation recommendation.",
    );
  }

  return lines.join("\n");
}

// ─── 3. Action Format Addendum ─────────────────────────────────────────────────

const ACTION_FORMAT_ADDENDUM = `

## UI ACTION PROTOCOL — STRUCTURED RESPONSE FORMAT

When it would genuinely help the user to navigate to a specific page or trigger a workflow, emit a structured action. Rules:

1. Prefix the action with the EXACT marker: [OMNI_ACTION] (all caps, no surrounding text on the same line).
2. Immediately after the marker (same line), emit a single-line JSON object — no markdown fences.
3. Emit the [OMNI_ACTION] line AFTER your conversational response text, NEVER before it.
4. Supported action types:

   [OMNI_ACTION] {"action":"navigate","target":"/forensic"}
   → Navigates the user to an internal app route.

   [OMNI_ACTION] {"action":"open_playbook","target":"creative_refresh"}
   → Opens a named playbook. Known targets: "creative_refresh", "budget_reallocation", "negative_keyword_sweep", "feed_optimization".

   [OMNI_ACTION] {"action":"open_triage","alertId":42}
   → Focuses the Live Triage panel on a specific numeric alert ID.

   [OMNI_ACTION] {"action":"open_copilot","prompt":"Audit PMax campaigns"}
   → Opens the OmniCopilot drawer with a pre-filled prompt string.

   [OMNI_ACTION] {"action":"highlight_sku","skuId":"SKU-123"}
   → Highlights a product in the SKU grid.

5. Only emit an action when it directly and immediately serves the user's request.
6. Never emit the same action type twice in a single response.
7. Actions are intercepted by the frontend — the user never sees the JSON. In your conversational text, describe what you did: "I've opened the Creative Refresh playbook for you." not "I emitted action JSON".`;

// ─── Main Export ───────────────────────────────────────────────────────────────

/**
 * Generates the full RBAC + live-context + action-format addendum string
 * to append to the base system prompt before calling the LLM.
 *
 * Returns an empty string if `role` is not provided (unauthenticated requests
 * are rejected upstream by RBAC middleware before reaching here).
 */
export function generateSystemPrompt(
  role:          Role | undefined,
  name:          string,
  workspaceName: string | null,
  alerts:        TriageAlertSummary[],
  healthScore:   number | null,
): string {
  if (!role) return "";

  return (
    rbacPersonaAddendum(role, name, workspaceName) +
    liveContextAddendum(alerts, healthScore) +
    ACTION_FORMAT_ADDENDUM
  );
}

// ─── Health Score Calculator ───────────────────────────────────────────────────

/**
 * Derives a 0–100 Portfolio Health Score from triage alert counts.
 * Deductions: -20 per critical alert, -8 per high alert, -3 per medium.
 */
export function computeHealthScore(alerts: TriageAlertSummary[]): number {
  const critical = alerts.filter((a) => a.severity === "critical").length;
  const high     = alerts.filter((a) => a.severity === "high").length;
  const medium   = alerts.filter((a) => a.severity === "medium").length;
  return Math.max(0, 100 - critical * 20 - high * 8 - medium * 3);
}
