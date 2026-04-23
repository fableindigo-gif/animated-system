import { Router } from "express";
import { createUserContent } from "@google/genai";
import { adkRunner, sessionService } from "../../lib/adk/runner";
import { getOrgId } from "../../middleware/rbac";
import { z } from "zod";

const router = Router();

const RunBody = z.object({
  message: z.string().min(1).max(8000),
  sessionId: z.string().optional(),
});

router.post("/run", async (req, res) => {
  try {
    const parsed = RunBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", issues: parsed.error.issues });
      return;
    }

    const { message, sessionId: clientSessionId } = parsed.data;

    const orgId = getOrgId(req);
    if (!orgId) {
      res.status(401).json({ error: "Unauthorized — no org context" });
      return;
    }

    const userId = req.rbacUser?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized — no user context" });
      return;
    }

    const workspaceId = req.rbacUser?.workspaceId;
    if (!workspaceId) {
      res.status(401).json({ error: "Unauthorized — no workspace context" });
      return;
    }

    const appName = "omnianalytix";
    const userIdStr = String(userId);

    let sessionId = clientSessionId;
    if (!sessionId) {
      const session = await sessionService.createSession({
        appName,
        userId: userIdStr,
        state: { orgId, workspaceId, userId },
      });
      sessionId = session.id;
    } else {
      const existing = await sessionService.getSession({
        appName,
        userId: userIdStr,
        sessionId,
      });
      if (!existing) {
        const session = await sessionService.createSession({
          appName,
          userId: userIdStr,
          sessionId,
          state: { orgId, workspaceId, userId },
        });
        sessionId = session.id;
      }
    }

    const userMessage = createUserContent(message);

    let responseText = "";
    let finalAgentName = "org_ceo";

    for await (const event of adkRunner.runAsync({
      userId: userIdStr,
      sessionId,
      newMessage: userMessage,
    })) {
      if ((event as unknown as { isFinalResponse?: () => boolean }).isFinalResponse?.()) {
        const parts = event.content?.parts ?? [];
        responseText = parts
          .map((p: { text?: string }) => p.text ?? "")
          .join("")
          .trim();
        finalAgentName = event.author ?? "org_ceo";
      }
    }

    res.json({
      sessionId,
      agent: finalAgentName,
      response: responseText || "No response generated.",
    });
  } catch (err) {
    // silent-catch-ok: ADK agent route — error message returned to client; upstream ADK runner logs the full trace
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: "ADK agent error", message });
  }
});

router.delete("/session/:sessionId", async (req, res) => {
  try {
    const userId = req.rbacUser?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    await sessionService.deleteSession({
      appName: "omnianalytix",
      userId: String(userId),
      sessionId: req.params.sessionId,
    });
    res.json({ deleted: true });
  } catch (err) {
    // silent-catch-ok: ADK session delete — error message returned to client; upstream ADK runner logs the full trace
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: "Failed to delete session", message });
  }
});

export default router;
