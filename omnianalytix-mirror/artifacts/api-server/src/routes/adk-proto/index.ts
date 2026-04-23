/**
 * ADK REST Protocol — compatible with google/adk-web developer UI
 *
 * Implements the subset of the ADK API server protocol needed for adk-web:
 *   GET  /list-apps
 *   POST /run
 *   POST /run_sse
 *   GET  /apps/:app/users/:user/sessions
 *   POST /apps/:app/users/:user/sessions
 *   GET  /apps/:app/users/:user/sessions/:sessionId
 *   DEL  /apps/:app/users/:user/sessions/:sessionId
 *   GET  /apps/:app/users/:user/sessions/:sessionId/events
 *   GET  /debug/trace/session/:sessionId
 *
 * These routes are intentionally mounted WITHOUT requireAuth() so that
 * adk-web (an Angular dev UI) can reach them directly. They are only
 * accessible from within the Replit environment and should not be exposed
 * in production without an additional auth layer.
 */

import { Router } from "express";
import { createUserContent } from "@google/genai";
import { adkRunner, sessionService } from "../../lib/adk/runner";
import { z } from "zod";

const router = Router();

const APP_NAME = "omnianalytix";

const DEFAULT_ORG_ID = 1;
const DEFAULT_WORKSPACE_ID = 1;
const DEFAULT_USER_ID = 1;

// ── List apps ─────────────────────────────────────────────────────────────────

router.get("/list-apps", (_req, res) => {
  res.json([APP_NAME]);
});

// ── Session management ────────────────────────────────────────────────────────

router.get("/apps/:app/users/:user/sessions", async (req, res) => {
  try {
    const { app, user } = req.params;
    const sessions = await sessionService.listSessions({ appName: app, userId: user });
    res.json(sessions.sessions ?? []);
  } catch (err) {
    // silent-catch-ok: ADK proto proxy — error forwarded to caller as JSON; upstream ADK logs the trace
    res.status(500).json({ error: String(err) });
  }
});

router.post("/apps/:app/users/:user/sessions", async (req, res) => {
  try {
    const { app, user } = req.params;
    const session = await sessionService.createSession({
      appName: app,
      userId: user,
      state: {
        orgId: DEFAULT_ORG_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        userId: DEFAULT_USER_ID,
      },
    });
    res.json(session);
  } catch (err) {
    // silent-catch-ok: ADK proto proxy — error forwarded to caller as JSON; upstream ADK logs the trace
    res.status(500).json({ error: String(err) });
  }
});

router.get("/apps/:app/users/:user/sessions/:sessionId", async (req, res) => {
  try {
    const { app, user, sessionId } = req.params;
    const session = await sessionService.getSession({ appName: app, userId: user, sessionId });
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(session);
  } catch (err) {
    // silent-catch-ok: ADK proto proxy — error forwarded to caller as JSON; upstream ADK logs the trace
    res.status(500).json({ error: String(err) });
  }
});

router.delete("/apps/:app/users/:user/sessions/:sessionId", async (req, res) => {
  try {
    const { app, user, sessionId } = req.params;
    await sessionService.deleteSession({ appName: app, userId: user, sessionId });
    res.json({ deleted: true });
  } catch (err) {
    // silent-catch-ok: ADK proto proxy — error forwarded to caller as JSON; upstream ADK logs the trace
    res.status(500).json({ error: String(err) });
  }
});

router.get("/apps/:app/users/:user/sessions/:sessionId/events", async (req, res) => {
  try {
    const { app, user, sessionId } = req.params;
    const session = await sessionService.getSession({ appName: app, userId: user, sessionId });
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(session.events ?? []);
  } catch (err) {
    // silent-catch-ok: ADK proto proxy — error forwarded to caller as JSON; upstream ADK logs the trace
    res.status(500).json({ error: String(err) });
  }
});

// ── Run (non-streaming) ───────────────────────────────────────────────────────

const RunBody = z.object({
  appName: z.string().default(APP_NAME),
  userId: z.string(),
  sessionId: z.string().optional(),
  newMessage: z.object({
    parts: z.array(z.object({
      text: z.string().optional(),
      functionResponse: z.any().optional(),
    })),
    role: z.string().default("user"),
  }),
  streaming: z.boolean().optional(),
  stateDelta: z.any().optional(),
});

async function ensureSession(appName: string, userId: string, sessionId?: string) {
  if (!sessionId) {
    const session = await sessionService.createSession({
      appName,
      userId,
      state: { orgId: DEFAULT_ORG_ID, workspaceId: DEFAULT_WORKSPACE_ID, userId: DEFAULT_USER_ID },
    });
    return session.id;
  }
  const existing = await sessionService.getSession({ appName, userId, sessionId });
  if (!existing) {
    const session = await sessionService.createSession({
      appName,
      userId,
      sessionId,
      state: { orgId: DEFAULT_ORG_ID, workspaceId: DEFAULT_WORKSPACE_ID, userId: DEFAULT_USER_ID },
    });
    return session.id;
  }
  return sessionId;
}

router.post("/run", async (req, res) => {
  try {
    const parsed = RunBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
      return;
    }
    const { appName, userId, sessionId: rawSessionId, newMessage } = parsed.data;
    const sessionId = await ensureSession(appName, userId, rawSessionId);

    const textPart = newMessage.parts.find(p => p.text);
    const userContent = createUserContent(textPart?.text ?? "");

    const events: unknown[] = [];
    for await (const event of adkRunner.runAsync({ userId, sessionId, newMessage: userContent })) {
      events.push(serializeEvent(event));
    }
    res.json(events);
  } catch (err) {
    // silent-catch-ok: ADK proto proxy — error forwarded to caller as JSON; upstream ADK logs the trace
    res.status(500).json({ error: String(err) });
  }
});

// ── Run SSE (streaming) ───────────────────────────────────────────────────────

router.post("/run_sse", async (req, res) => {
  try {
    const parsed = RunBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
      return;
    }
    const { appName, userId, sessionId: rawSessionId, newMessage } = parsed.data;
    const sessionId = await ensureSession(appName, userId, rawSessionId);

    const textPart = newMessage.parts.find(p => p.text);
    const userContent = createUserContent(textPart?.text ?? "");

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    for await (const event of adkRunner.runAsync({ userId, sessionId, newMessage: userContent })) {
      const serialized = serializeEvent(event);
      res.write(`data: ${JSON.stringify(serialized)}\n\n`);
    }

    res.end();
  } catch (err) {
    // silent-catch-ok: SSE streaming error — written as a final SSE event so the client can display it; inner catch handles write failure gracefully
    try {
      res.write(`data: ${JSON.stringify({ error: String(err) })}\n\n`);
      res.end();
    } catch {
      // silent-catch-ok: SSE write failed (connection already closed) — end the response silently
      res.status(500).end();
    }
  }
});

// ── Debug / trace stubs ───────────────────────────────────────────────────────

router.get("/debug/trace/session/:sessionId", async (req, res) => {
  try {
    const session = await sessionService.getSession({
      appName: APP_NAME,
      userId: "dev",
      sessionId: req.params.sessionId,
    });
    if (!session) {
      res.json([]);
      return;
    }
    res.json((session.events ?? []).map((e: unknown) => serializeEvent(e)));
  } catch {
    res.json([]);
  }
});

router.get("/debug/trace/:eventId", (_req, res) => {
  res.json({ spans: [] });
});

// ── Serialization helper ──────────────────────────────────────────────────────

function serializeEvent(event: unknown): Record<string, unknown> {
  if (!event || typeof event !== "object") return {};
  const e = event as Record<string, unknown>;

  const content = e.content as Record<string, unknown> | undefined;
  const parts = (content?.parts ?? []) as unknown[];
  const actions = e.actions as Record<string, unknown> | undefined;

  return {
    id: e.id ?? crypto.randomUUID(),
    author: e.author ?? "org_ceo",
    invocationId: e.invocationId,
    timestamp: e.timestamp ?? Date.now(),
    content: content
      ? {
          role: content.role ?? "model",
          parts: parts.map((p: unknown) => {
            const part = p as Record<string, unknown>;
            return {
              text: part.text,
              functionCall: part.functionCall,
              functionResponse: part.functionResponse,
              thought: part.thought,
            };
          }),
        }
      : undefined,
    actions: actions
      ? {
          stateDelta: actions.stateDelta,
          transferToAgent: actions.transferToAgent,
          finishReason: actions.finishReason,
        }
      : undefined,
    longRunningToolIds: e.longRunningToolIds,
  };
}

export default router;
