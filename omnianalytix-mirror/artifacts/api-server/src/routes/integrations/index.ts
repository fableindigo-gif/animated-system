/**
 * /api/integrations — Simple Connector Hub
 * ==========================================
 * Routes:
 *   POST   /api/integrations/connect           — Save any API-key connector
 *   DELETE /api/integrations/:platform         — Remove a connector
 *   POST   /api/integrations/slack/test        — Fire a test Slack alert
 *   POST   /api/integrations/slack/alert       — Route an alert to Slack webhook
 *   POST   /api/integrations/calendar/event    — Create a Google Calendar diagnostic event
 *   GET    /api/integrations/drive/recent      — Smoke-test: list recent Drive files
 *   GET    /api/integrations/docs/:docId       — Smoke-test: fetch a Google Doc by ID
 *   GET    /api/integrations/playbook-docs     — List playbook→doc URL mappings
 *   PUT    /api/integrations/playbook-docs     — Save a playbook→doc URL mapping
 */
import { Router } from "express";
import { google } from "googleapis";
import { db, platformConnections } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { getOrgId } from "../../middleware/rbac";
import { verifyAnyToken } from "../auth/gate";
import { encryptCredentials } from "../../lib/credential-helpers";
import {
  getAuthorizedGoogleClient,
  safeRefreshErrorFields,
} from "../../lib/google-workspace-oauth";

const router = Router();

function resolveOrgId(req: import("express").Request): number | null {
  const fromRbac = getOrgId(req);
  if (fromRbac) return fromRbac;
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const decoded = verifyAnyToken(auth.slice(7));
    if (decoded?.organizationId) return decoded.organizationId;
  }
  return null;
}

const SUPPORTED_SIMPLE_PLATFORMS = [
  "tiktok_ads",
  "linkedin_ads",
  "amazon_ads",
  "slack",
  "stripe",
  "klaviyo",
] as const;

type SimplePlatform = (typeof SUPPORTED_SIMPLE_PLATFORMS)[number];

function isSupportedPlatform(p: string): p is SimplePlatform {
  return (SUPPORTED_SIMPLE_PLATFORMS as readonly string[]).includes(p);
}

const PLATFORM_LABELS: Record<SimplePlatform, string> = {
  tiktok_ads:   "TikTok Ads",
  linkedin_ads: "LinkedIn Ads",
  amazon_ads:   "Amazon Ads",
  slack:        "Slack",
  stripe:       "Stripe",
  klaviyo:      "Klaviyo",
};

// ─── POST /api/integrations/connect ──────────────────────────────────────────
router.post("/connect", async (req, res) => {
  const { platform, credentials: rawCreds, displayName } = req.body as {
    platform: string;
    credentials: Record<string, string>;
    displayName?: string;
  };

  if (!platform || !isSupportedPlatform(platform)) {
    return res.status(400).json({ error: `Unsupported platform: ${platform}. Supported: ${SUPPORTED_SIMPLE_PLATFORMS.join(", ")}` });
  }
  if (!rawCreds || typeof rawCreds !== "object") {
    return res.status(400).json({ error: "credentials object is required" });
  }

  const orgId = resolveOrgId(req);
  const label = displayName || PLATFORM_LABELS[platform];
  const encrypted = encryptCredentials(rawCreds);

  try {
    const where = and(
      eq(platformConnections.platform, platform),
      orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId),
    );
    const existing = await db.select().from(platformConnections).where(where);
    if (existing.length > 0) {
      // tenant-ownership-skip: `existing[0]` came from an org-scoped SELECT
      // above (`where = and(platform, organizationId == orgId)`); update by
      // its PK is bound to the same scope.
      await db.update(platformConnections)
        .set({ credentials: encrypted, displayName: label, isActive: true, updatedAt: new Date() })
        .where(eq(platformConnections.id, existing[0].id));
    } else {
      await db.insert(platformConnections).values({
        platform,
        displayName: label,
        credentials: encrypted,
        isActive: true,
        ...(orgId ? { organizationId: orgId } : {}),
      });
    }
    logger.info({ platform, label, orgId }, "Simple connector saved");
    return res.json({ success: true, platform, displayName: label });
  } catch (err) {
    logger.error({ err, platform }, "Failed to save connector");
    return res.status(500).json({ error: "Failed to save connection" });
  }
});

// ─── DELETE /api/integrations/:platform ──────────────────────────────────────
router.delete("/:platform", async (req, res) => {
  const { platform } = req.params;
  const orgId = resolveOrgId(req);
  try {
    const where = and(
      eq(platformConnections.platform, platform),
      orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId),
    );
    const rows = await db.select({ id: platformConnections.id }).from(platformConnections).where(where);
    for (const row of rows) {
      // tenant-ownership-skip: `row` came from an org-scoped SELECT above; the
      // delete-by-id loop is bound to that scope. (Could be replaced by a
      // single `delete().where(where)` — preserved as loop for parity with
      // pre-refactor logging behavior.)
      await db.delete(platformConnections).where(eq(platformConnections.id, row.id));
    }
    logger.info({ platform, deleted: rows.length }, "Connector disconnected");
    return res.json({ success: true, platform, deleted: rows.length });
  } catch (err) {
    logger.error({ err, platform }, "Failed to disconnect");
    return res.status(500).json({ error: "Failed to disconnect" });
  }
});

// ─── POST /api/integrations/slack/test ───────────────────────────────────────
router.post("/slack/test", async (req, res) => {
  const orgId = resolveOrgId(req);
  try {
    const where = and(
      eq(platformConnections.platform, "slack"),
      orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId),
    );
    const rows = await db.select().from(platformConnections).where(where);
    if (!rows.length || !rows[0].isActive) {
      return res.status(404).json({ error: "Slack not connected. Connect via Platform Integrations first." });
    }
    const creds = rows[0].credentials as Record<string, string>;
    const webhookUrl = creds.webhookUrl;
    if (!webhookUrl) {
      return res.status(400).json({ error: "No Slack webhook URL stored. Reconnect Slack." });
    }

    const payload = {
      text: "✅ *OmniAnalytix Test Alert* — Slack integration is working correctly.",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "✅ *OmniAnalytix → Slack connection verified*\n_This is a test message from your Agency Logic Engine._",
          },
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: `Sent at ${new Date().toISOString()}` }],
        },
      ],
    };

    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const body = await resp.text();
      logger.warn({ body }, "Slack test message failed");
      return res.status(502).json({ error: `Slack returned ${resp.status}: ${body}` });
    }

    return res.json({ success: true, message: "Test alert delivered to Slack." });
  } catch (err) {
    logger.error({ err }, "Slack test error");
    return res.status(500).json({ error: "Failed to send Slack test" });
  }
});

// ─── POST /api/integrations/slack/alert ──────────────────────────────────────
// Body: { alertType, title, description, severity, actionUrl? }
router.post("/slack/alert", async (req, res) => {
  const { alertType, title, description, severity, actionUrl } = req.body as {
    alertType: string;
    title: string;
    description: string;
    severity?: "info" | "warning" | "critical";
    actionUrl?: string;
  };
  const orgId = resolveOrgId(req);

  try {
    const where = and(
      eq(platformConnections.platform, "slack"),
      orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId),
    );
    const rows = await db.select().from(platformConnections).where(where);
    if (!rows.length || !rows[0].isActive) {
      return res.status(404).json({ error: "Slack not connected" });
    }
    const creds = rows[0].credentials as Record<string, string>;
    const webhookUrl = creds.webhookUrl;
    if (!webhookUrl) return res.status(400).json({ error: "No webhook URL" });

    const icon = severity === "critical" ? "🔴" : severity === "warning" ? "🟡" : "🔵";
    const blocks: object[] = [
      {
        type: "header",
        text: { type: "plain_text", text: `${icon} OmniAnalytix Alert`, emoji: true },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${title}*\n${description}` },
        fields: [
          { type: "mrkdwn", text: `*Type*\n${alertType}` },
          { type: "mrkdwn", text: `*Severity*\n${severity ?? "info"}` },
        ],
      },
    ];

    if (actionUrl) {
      blocks.push({
        type: "actions",
        elements: [{
          type: "button",
          text: { type: "plain_text", text: "View in OmniAnalytix", emoji: true },
          url: actionUrl,
          style: "primary",
        }],
      });
    }

    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `Sent by OmniAnalytix Agency Logic Engine · ${new Date().toISOString()}` }],
    });

    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks }),
    });

    if (!resp.ok) {
      return res.status(502).json({ error: `Slack error ${resp.status}` });
    }
    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Slack alert error");
    return res.status(500).json({ error: "Failed to send alert" });
  }
});

// ─── POST /api/integrations/calendar/event ───────────────────────────────────
// Creates a 15-minute Google Calendar event for a diagnostic sweep.
// Body: { summary?, description?, startIso?, durationMins? }
router.post("/calendar/event", async (req, res) => {
  const {
    summary = "OmniAnalytix: Master Diagnostic Sweep",
    description = "AI-scheduled diagnostic sweep. Review Account Health alerts in OmniAnalytix after this meeting.",
    startIso,
    durationMins = 15,
  } = req.body as { summary?: string; description?: string; startIso?: string; durationMins?: number };

  const orgId = resolveOrgId(req);

  try {
    const authorized = await getAuthorizedGoogleClient("google_calendar", orgId);
    if (!authorized) {
      return res.status(404).json({ error: "Google Calendar not connected. Re-authorize Google Workspace with Calendar scope." });
    }

    const start = startIso ? new Date(startIso) : new Date(Date.now() + 15 * 60 * 1000);
    const end = new Date(start.getTime() + durationMins * 60 * 1000);

    const calendar = google.calendar({ version: "v3", auth: authorized.client });

    let created;
    try {
      const resp = await calendar.events.insert({
        calendarId: "primary",
        requestBody: {
          summary,
          description,
          start: { dateTime: start.toISOString(), timeZone: "UTC" },
          end: { dateTime: end.toISOString(), timeZone: "UTC" },
          reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 5 }] },
        },
      });
      created = resp.data;
    } catch (err) {
      // Surface refresh / API failures with only safe fields so a stale
      // connection is easy to diagnose without leaking token material.
      const safe = safeRefreshErrorFields(err);
      logger.warn(safe, "Google Calendar event creation failed");
      const status = safe.status ?? 502;
      return res.status(status).json({ error: `Google Calendar API error: ${safe.errorCode}`, errorCode: safe.errorCode });
    }

    logger.info({ eventId: created.id, summary }, "Google Calendar diagnostic event created");
    return res.json({
      success: true,
      eventId: created.id,
      htmlLink: created.htmlLink,
      summary: created.summary,
      start: start.toISOString(),
      end: end.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Calendar event error");
    return res.status(500).json({ error: "Failed to create calendar event" });
  }
});

// ─── GET /api/integrations/drive/recent ──────────────────────────────────────
// Smoke-test endpoint: lists the caller's most recently modified Drive files
// using the typed `getAuthorizedGoogleClient` helper. Exists so connect /
// refresh / disconnect of the `google_drive` platform is exercised end-to-end
// (otherwise a stale Drive token would only surface when a real feature ships).
// Query: ?limit=N (default 10, max 25)
router.get("/drive/recent", async (req, res) => {
  const orgId = resolveOrgId(req);
  const requested = Number.parseInt(String(req.query.limit ?? "10"), 10);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 25) : 10;

  try {
    const authorized = await getAuthorizedGoogleClient("google_drive", orgId);
    if (!authorized) {
      return res.status(404).json({ error: "Google Drive not connected. Re-authorize Google Workspace with Drive scope." });
    }

    const drive = google.drive({ version: "v3", auth: authorized.client });

    try {
      const resp = await drive.files.list({
        pageSize: limit,
        orderBy: "modifiedTime desc",
        fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
      });
      const files = (resp.data.files ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        modifiedTime: f.modifiedTime,
        webViewLink: f.webViewLink,
      }));
      return res.json({ success: true, count: files.length, files });
    } catch (err) {
      const safe = safeRefreshErrorFields(err);
      logger.warn(safe, "Google Drive list failed");
      const status = safe.status ?? 502;
      return res.status(status).json({ error: `Google Drive API error: ${safe.errorCode}`, errorCode: safe.errorCode });
    }
  } catch (err) {
    logger.error({ err }, "Drive recent error");
    return res.status(500).json({ error: "Failed to list Drive files" });
  }
});

// ─── GET /api/integrations/docs/:docId ───────────────────────────────────────
// Smoke-test endpoint: fetches a single Google Doc by ID using the typed
// `getAuthorizedGoogleClient` helper. Exists so connect / refresh / disconnect
// of the `google_docs` platform is exercised end-to-end via the same OAuth
// surface as Calendar.
router.get("/docs/:docId", async (req, res) => {
  const orgId = resolveOrgId(req);
  const docId = req.params.docId;
  if (!docId || !/^[A-Za-z0-9_-]+$/.test(docId)) {
    return res.status(400).json({ error: "Invalid Google Doc ID" });
  }

  try {
    const authorized = await getAuthorizedGoogleClient("google_docs", orgId);
    if (!authorized) {
      return res.status(404).json({ error: "Google Docs not connected. Re-authorize Google Workspace with Docs scope." });
    }

    const docs = google.docs({ version: "v1", auth: authorized.client });

    try {
      const resp = await docs.documents.get({ documentId: docId });
      const doc = resp.data;
      // Count body elements as a cheap "fetched non-empty content" signal
      // without echoing the full document body back to the caller.
      const elementCount = doc.body?.content?.length ?? 0;
      return res.json({
        success: true,
        documentId: doc.documentId,
        title: doc.title,
        revisionId: doc.revisionId,
        elementCount,
      });
    } catch (err) {
      const safe = safeRefreshErrorFields(err);
      logger.warn(safe, "Google Docs fetch failed");
      const status = safe.status ?? 502;
      return res.status(status).json({ error: `Google Docs API error: ${safe.errorCode}`, errorCode: safe.errorCode });
    }
  } catch (err) {
    logger.error({ err }, "Docs fetch error");
    return res.status(500).json({ error: "Failed to fetch Google Doc" });
  }
});

// ─── GET /api/integrations/playbook-docs ─────────────────────────────────────
// Returns stored playbook→Google Doc URL mappings for this org.
router.get("/playbook-docs", async (req, res) => {
  const orgId = resolveOrgId(req);
  try {
    const where = and(
      eq(platformConnections.platform, "google_docs"),
      orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId),
    );
    const rows = await db.select().from(platformConnections).where(where);
    if (!rows.length) {
      return res.json({ connected: false, mappings: [] });
    }
    const creds = rows[0].credentials as Record<string, string>;
    const mappings: Array<{ alertType: string; docUrl: string; docTitle?: string }> = [];
    for (const [key, val] of Object.entries(creds)) {
      if (key.startsWith("playbook_")) {
        const [, alertType] = key.split("playbook_");
        try {
          const parsed = JSON.parse(val) as { docUrl: string; docTitle?: string };
          mappings.push({ alertType, ...parsed });
        } catch {
          mappings.push({ alertType, docUrl: val });
        }
      }
    }
    return res.json({ connected: true, mappings });
  } catch (err) {
    logger.error({ err }, "Playbook docs fetch error");
    return res.status(500).json({ error: "Failed to fetch playbook docs" });
  }
});

// ─── PUT /api/integrations/playbook-docs ─────────────────────────────────────
// Body: { alertType, docUrl, docTitle? }
// Saves a Google Doc URL as the playbook for a given alert type.
router.put("/playbook-docs", async (req, res) => {
  const { alertType, docUrl, docTitle } = req.body as { alertType: string; docUrl: string; docTitle?: string };
  if (!alertType || !docUrl) {
    return res.status(400).json({ error: "alertType and docUrl are required" });
  }
  if (!docUrl.startsWith("https://docs.google.com/")) {
    return res.status(400).json({ error: "docUrl must be a Google Docs URL (https://docs.google.com/...)" });
  }
  const orgId = resolveOrgId(req);

  try {
    const where = and(
      eq(platformConnections.platform, "google_docs"),
      orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId),
    );
    const rows = await db.select().from(platformConnections).where(where);
    const key = `playbook_${alertType}`;
    const value = JSON.stringify({ docUrl, docTitle: docTitle ?? alertType });

    if (rows.length > 0) {
      const existingCreds = rows[0].credentials as Record<string, string>;
      const updated = { ...existingCreds, [key]: value };
      // tenant-ownership-skip: `rows[0]` came from an org-scoped SELECT above
      // (this is the upsert path for the google_docs alert sink).
      await db.update(platformConnections)
        .set({ credentials: updated, updatedAt: new Date() })
        .where(eq(platformConnections.id, rows[0].id));
    } else {
      await db.insert(platformConnections).values({
        platform: "google_docs",
        displayName: "Google Docs Playbooks",
        credentials: encryptCredentials({ [key]: value }),
        isActive: true,
        ...(orgId ? { organizationId: orgId } : {}),
      });
    }
    logger.info({ alertType, docUrl }, "Playbook doc mapping saved");
    return res.json({ success: true, alertType, docUrl });
  } catch (err) {
    logger.error({ err }, "Playbook doc save error");
    return res.status(500).json({ error: "Failed to save playbook doc" });
  }
});

export default router;
