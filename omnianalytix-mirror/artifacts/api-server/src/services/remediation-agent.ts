/**
 * VAG 2 — Remediation Agent
 *
 * Listens on the triage event emitter and automatically pushes a
 * PENDING_HUMAN_REVIEW task to the Approval Queue whenever a critical
 * Inventory/margin-leak alert is detected (out-of-stock SKUs with active
 * ad spend).
 *
 * No human interaction required — the loop closes autonomously.
 */
import { db, proposedTasks } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { triageEmitter, type TriageEvent } from "../lib/triage-emitter";
import { logger } from "../lib/logger";
import crypto from "crypto";

// ── Core service function (exported for testing) ──────────────────────────────

export interface RemediationPayload {
  action: "pause_ads_on_oos_skus";
  alertId: string;
  platform: string;
  detail: string;
  suggestedAction: string;
}

/**
 * Inserts a proposed remediation task into the Approval Queue.
 * Idempotent — if an identical pending task already exists it returns early.
 *
 * @returns The created (or existing) task row, or null on DB error.
 */
export async function proposeRemediationTask(
  alertId: string,
  payload: RemediationPayload,
): Promise<{ id: number; duplicate: boolean } | null> {
  try {
    const idempotencyKey = crypto
      .createHash("sha256")
      .update(JSON.stringify({ alertId, action: payload.action, platform: payload.platform }))
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
      logger.debug(
        { alertId, taskId: existing[0].id },
        "[RemediationAgent] Duplicate remediation task — skipping",
      );
      return { id: existing[0].id, duplicate: true };
    }

    const [task] = await db
      .insert(proposedTasks)
      .values({
        workspaceId: null,
        idempotencyKey,
        proposedByName: "Live Triage Agent",
        proposedByRole: "agent",
        platform: payload.platform,
        platformLabel: "Google Ads · Inventory",
        toolName: "pause_ads_on_oos_skus",
        toolDisplayName: "Pause Ads on Out-of-Stock SKUs",
        toolArgs: {
          alert_id: alertId,
          action: payload.action,
          detail: payload.detail,
        },
        displayDiff: [
          { label: "Campaign status", from: "ENABLED", to: "PAUSED" },
          { label: "Trigger", from: "alert", to: alertId },
        ],
        reasoning: payload.suggestedAction,
        status: "pending",
      })
      .returning();

    logger.info(
      { alertId, taskId: task.id },
      "[RemediationAgent] Proposed remediation task created",
    );

    return { id: task.id, duplicate: false };
  } catch (err) {
    logger.error({ err, alertId }, "[RemediationAgent] Failed to propose remediation task");
    return null;
  }
}

// ── Classifier ────────────────────────────────────────────────────────────────

/**
 * Returns true when the alert is an out-of-stock / margin-leak Inventory alert
 * that warrants an autonomous remediation proposal.
 */
export function isInventoryMarginLeak(alert: TriageEvent["alert"]): boolean {
  if (!alert) return false;
  if (alert.severity !== "critical") return false;
  // Detect by platform prefix OR title keywords
  if (alert.platform?.includes("Inventory")) return true;
  const titleLower = alert.title?.toLowerCase() ?? "";
  return titleLower.includes("out-of-stock") || titleLower.includes("margin leak");
}

// ── Triage event listener ─────────────────────────────────────────────────────

function handleTriageEvent(event: TriageEvent): void {
  if (event.type !== "alert" || !event.alert) return;
  if (!isInventoryMarginLeak(event.alert)) return;

  const alert = event.alert;

  logger.warn(
    { alertId: alert.id, title: alert.title },
    "[RemediationAgent] Inventory margin-leak detected — proposing remediation task",
  );

  void proposeRemediationTask(alert.id, {
    action: "pause_ads_on_oos_skus",
    alertId: alert.id,
    platform: alert.platform,
    detail: alert.detail,
    suggestedAction:
      alert.action ??
      "Pause all active ads linked to zero-inventory SKUs to stop margin bleed immediately.",
  });
}

let _started = false;

/**
 * Attaches the remediation agent listener to the global triage emitter.
 * Safe to call multiple times — only registers once.
 */
export function startRemediationAgent(): void {
  if (_started) return;
  _started = true;
  triageEmitter.on("triage", handleTriageEvent);
  logger.info("[RemediationAgent] Started — listening for Inventory margin-leak alerts");
}

/**
 * Detaches the listener. Primarily used in tests.
 */
export function stopRemediationAgent(): void {
  triageEmitter.off("triage", handleTriageEvent);
  _started = false;
}
