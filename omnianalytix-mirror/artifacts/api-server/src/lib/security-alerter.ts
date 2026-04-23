/**
 * security-alerter.ts
 *
 * Fires real-time admin notifications whenever a cross-user session access
 * attempt is detected (event: "session_ownership_mismatch").
 *
 * Supported channels (configure via environment variables):
 *
 * | Env var                            | Description                                              |
 * | ---------------------------------- | -------------------------------------------------------- |
 * | SECURITY_ALERT_SLACK_WEBHOOK_URL   | Slack Incoming Webhook URL — posts a formatted message   |
 * | SECURITY_ALERT_COOLDOWN_MS         | Min ms between alerts for the same sessionId (default 60 000 — 1 min) |
 *
 * When no channel is configured the function is a no-op (the caller's
 * logger.warn remains the sole trace).
 *
 * Usage:
 *   await notifySessionOwnershipMismatch({ orgId, memberId, sessionId, source });
 */

import { logger } from "./logger";

export interface SessionMismatchAlert {
  orgId:     string | number;
  memberId:  string | number;
  sessionId: string;
  source:    "getAdkSession" | "deleteAdkSession";
  timestamp?: string;
}

const SLACK_WEBHOOK_URL = process.env.SECURITY_ALERT_SLACK_WEBHOOK_URL ?? "";

const DEFAULT_COOLDOWN_MS = 60_000;
const _rawCooldown = Number(process.env.SECURITY_ALERT_COOLDOWN_MS);
const COOLDOWN_MS = Number.isFinite(_rawCooldown) && _rawCooldown > 0
  ? _rawCooldown
  : DEFAULT_COOLDOWN_MS;

const lastAlertAt = new Map<string, number>();

function isOnCooldown(sessionId: string): boolean {
  const last = lastAlertAt.get(sessionId);
  if (last === undefined) return false;
  return Date.now() - last < COOLDOWN_MS;
}

function markAlerted(sessionId: string): void {
  lastAlertAt.set(sessionId, Date.now());
  if (lastAlertAt.size > 1000) {
    const oldest = lastAlertAt.keys().next().value;
    if (oldest !== undefined) lastAlertAt.delete(oldest);
  }
}

async function sendSlackAlert(alert: SessionMismatchAlert & { timestamp: string }): Promise<void> {
  const text = [
    ":rotating_light: *Security Alert — Cross-User Session Access Attempt*",
    `• *org*: \`${alert.orgId}\``,
    `• *member*: \`${alert.memberId}\``,
    `• *session*: \`${alert.sessionId}\``,
    `• *source*: \`${alert.source}\``,
    `• *time*: ${alert.timestamp}`,
  ].join("\n");

  const res = await fetch(SLACK_WEBHOOK_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ text }),
  });

  if (!res.ok) {
    logger.warn(
      { status: res.status, sessionId: alert.sessionId },
      "[SecurityAlerter] Slack webhook returned non-OK status",
    );
  }
}

/**
 * Send a real-time admin alert for a detected session ownership mismatch.
 * Call this immediately after emitting the logger.warn so the log entry and
 * the push notification are always paired.
 *
 * The function never throws — all errors are logged at warn level so a
 * broken notification channel cannot affect the calling request.
 */
export async function notifySessionOwnershipMismatch(
  alert: SessionMismatchAlert,
): Promise<void> {
  const timestamp = alert.timestamp ?? new Date().toISOString();
  const full = { ...alert, timestamp };

  if (isOnCooldown(alert.sessionId)) {
    logger.debug(
      { sessionId: alert.sessionId },
      "[SecurityAlerter] Alert suppressed — cooldown active",
    );
    return;
  }

  markAlerted(alert.sessionId);

  const tasks: Promise<void>[] = [];

  if (SLACK_WEBHOOK_URL) {
    tasks.push(
      sendSlackAlert(full).catch((err) =>
        logger.warn({ err, sessionId: alert.sessionId }, "[SecurityAlerter] Slack delivery failed"),
      ),
    );
  }

  if (tasks.length === 0) {
    logger.debug(
      { sessionId: alert.sessionId },
      "[SecurityAlerter] No notification channel configured — alert logged only (set SECURITY_ALERT_SLACK_WEBHOOK_URL to enable push alerts)",
    );
    return;
  }

  await Promise.all(tasks);
}
