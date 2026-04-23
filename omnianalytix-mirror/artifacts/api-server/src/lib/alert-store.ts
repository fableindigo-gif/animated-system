import { emitTriageAlert, emitTriageClear } from "./triage-emitter";
import { db, webhookThreads, liveTriageAlerts } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export interface ProgrammaticAlert {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  platform: string;
  action?: string;
  pausePayload?: { sku: string; affectedAdIds: string[] };
  ts: string;
}

const MAX_ALERTS = 20;
const _alerts: ProgrammaticAlert[] = [];
let _teamsWebhookUrl: string | null = null;
let _slackWebhookUrl: string | null = null;

export function pushAlert(alert: ProgrammaticAlert): void {
  const idx = _alerts.findIndex((a) => a.id === alert.id);
  if (idx >= 0) {
    _alerts[idx] = alert;
  } else {
    _alerts.unshift(alert);
    if (_alerts.length > MAX_ALERTS) _alerts.length = MAX_ALERTS;
  }

  emitTriageAlert({
    id: alert.id,
    severity: alert.severity,
    title: alert.title,
    detail: alert.detail,
    platform: alert.platform,
    action: alert.action,
    ts: alert.ts,
  });

  if (alert.severity === "critical") {
    void startWarRoomThread(alert);
  }
}

export function getAlerts(): ProgrammaticAlert[] {
  return [..._alerts];
}

/**
 * Idempotently record an infrastructure alert in both the in-memory feed
 * and the persistent `live_triage_alerts` table.
 *
 * Safe to call from anywhere (background workers, the periodic self-audit,
 * etc.) without producing duplicate triage rows or duplicate notifications.
 * On every call we look up unresolved rows for the given `alertId` (matched
 * on `externalId`); if one exists we no-op entirely. Only the FIRST call
 * after the alert is resolved (or has never fired) inserts a DB row, pushes
 * the in-memory alert, and triggers the war-room thread / Slack / Teams
 * webhook side effects.
 */
export async function recordInfraAlert(input: {
  alertId: string;
  workspaceId?: string;
  severity?: "critical" | "warning" | "info";
  title: string;
  detail: string;
  platform: string;
  action?: string;
}): Promise<void> {
  const severity = input.severity ?? "critical";

  // Determine whether this is a transition (no unresolved row exists) or a
  // repeat call against an already-active alert. We must dedupe BOTH the DB
  // insert AND the in-memory `pushAlert` — `pushAlert` triggers
  // `emitTriageAlert` and (for criticals) `startWarRoomThread`, so calling
  // it on every audit tick would spam notifications and re-open war-room
  // threads.
  let isTransition = true;
  try {
    const existing = await db
      .select({ id: liveTriageAlerts.id })
      .from(liveTriageAlerts)
      .where(
        and(
          eq(liveTriageAlerts.externalId, input.alertId),
          eq(liveTriageAlerts.resolvedStatus, false),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      isTransition = false;
    } else {
      await db.insert(liveTriageAlerts).values({
        workspaceId:    input.workspaceId ?? "default",
        severity,
        type:           "System_Infrastructure",
        title:          input.title,
        message:        input.detail,
        platform:       input.platform,
        action:         input.action ?? `Investigate ${input.platform} connectivity and credentials.`,
        externalId:     input.alertId,
        resolvedStatus: false,
      });
    }
  } catch (err) {
    console.error("[AlertStore] Failed to persist infra triage alert:", err);
  }

  if (!isTransition) return;

  pushAlert({
    id:       input.alertId,
    severity,
    title:    input.title,
    detail:   input.detail,
    platform: input.platform,
    action:   input.action,
    ts:       new Date().toISOString(),
  });
}

/**
 * Counterpart to `recordInfraAlert` — clears the in-memory alert and marks
 * any unresolved DB rows for this `alertId` as resolved.
 */
export async function resolveInfraAlert(alertId: string): Promise<void> {
  clearAlert(alertId);
  try {
    await db
      .update(liveTriageAlerts)
      .set({ resolvedStatus: true, updatedAt: new Date() })
      .where(
        and(
          eq(liveTriageAlerts.externalId, alertId),
          eq(liveTriageAlerts.resolvedStatus, false),
        ),
      );
  } catch (err) {
    console.error("[AlertStore] Failed to resolve infra triage alert:", err);
  }
}

export function clearAlert(id: string): void {
  const idx = _alerts.findIndex((a) => a.id === id);
  if (idx >= 0) {
    _alerts.splice(idx, 1);
    emitTriageClear(id);
  }
}

export function setTeamsWebhookUrl(url: string): void {
  _teamsWebhookUrl = url;
}

export function getTeamsWebhookUrl(): string | null {
  return _teamsWebhookUrl;
}

export function setSlackWebhookUrl(url: string): void {
  _slackWebhookUrl = url;
}

async function startWarRoomThread(alert: ProgrammaticAlert): Promise<void> {
  const threadKey = `war-room-${alert.id}-${Date.now()}`;

  try {
    await db.insert(webhookThreads).values({
      alertId: parseInt(alert.id.replace(/\D/g, ""), 10) || null,
      threadKey,
      channelType: _slackWebhookUrl ? "slack" : "teams",
      alertTitle: alert.title,
      status: "open",
    });
  } catch (err) { console.error("[AlertStore] Failed to insert webhook thread:", err); }

  if (_slackWebhookUrl) {
    try {
      const resp = await fetch(_slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `*CRITICAL ALERT*\n*${alert.title}*\n${alert.detail}\n_Platform: ${alert.platform} · ${alert.ts}_`,
          thread_ts: threadKey,
        }),
      });
      if (resp.ok) {
        const data = await resp.json().catch(() => ({}));
        if ((data as Record<string, unknown>).ts) {
          await db.update(webhookThreads)
            .set({ threadKey: (data as Record<string, string>).ts })
            .where(eq(webhookThreads.threadKey, threadKey))
            .catch((err: unknown) => { console.error("[AlertStore] Failed to update Slack threadKey:", err); });
        }
      }
    } catch (err) { console.error("[AlertStore] Slack webhook delivery failed:", err); }
  }

  await notifyTeams(
    `CRITICAL: ${alert.title}`,
    `${alert.detail}\n\nThread ID: ${threadKey}\nPlatform: ${alert.platform}\nTime: ${alert.ts}`
  );
}

export async function sendWarRoomUpdate(alertId: string, status: string, message: string): Promise<void> {
  try {
    const numericId = parseInt(alertId.replace(/\D/g, ""), 10);
    if (isNaN(numericId)) return;

    const threads = await db.select()
      .from(webhookThreads)
      .where(and(eq(webhookThreads.alertId, numericId), eq(webhookThreads.status, "open")));

    for (const thread of threads) {
      if (_slackWebhookUrl && thread.channelType === "slack") {
        await fetch(_slackWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `*Status Update: ${status}*\n${message}\n_Updated: ${new Date().toISOString()}_`,
            thread_ts: thread.threadKey,
          }),
        }).catch(() => {});
      }

      if (_teamsWebhookUrl && thread.channelType === "teams") {
        await notifyTeams(
          `UPDATE: ${thread.alertTitle} → ${status}`,
          `${message}\n\nThread: ${thread.threadKey}`
        );
      }

      await db.update(webhookThreads)
        .set({ status, updatedAt: new Date() })
        .where(eq(webhookThreads.id, thread.id))
        .catch((err: unknown) => { console.error("[AlertStore] Failed to update thread status:", err); });
    }
  } catch (err) { console.error("[AlertStore] sendWarRoomUpdate failed:", err); }
}

export async function notifyTeams(title: string, text: string): Promise<void> {
  if (!_teamsWebhookUrl) return;
  try {
    await fetch(_teamsWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        themeColor: "FF0000",
        summary: title,
        sections: [
          {
            activityTitle: "OmniAnalytix Critical Alert",
            activitySubtitle: title,
            text,
            facts: [
              { name: "Source", value: "OmniAnalytix Live Triage" },
              { name: "Time", value: new Date().toISOString() },
            ],
          },
        ],
      }),
    });
  } catch (err) {
    console.error("[AlertStore] Teams webhook delivery failed:", err);
  }
}
