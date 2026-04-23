import { Router } from "express";
import { db, platformConnections } from "@workspace/db";
import { eq } from "drizzle-orm";
import { compliance_auditDestinationUrl } from "../../lib/platform-executors";
import { getGoogleGenAI, VERTEX_MODEL } from "../../lib/vertex-client";
import { logger } from "../../lib/logger";

const router = Router();

// POST /api/compliance/audit-url
// Body: { url: string, adCopy?: string }
router.post("/audit-url", async (req, res) => {
  const { url, adCopy = "" } = req.body as { url?: string; adCopy?: string };
  if (!url) { res.status(400).json({ error: "url is required" }); return; }

  try {
    const ai = await getGoogleGenAI();
    const result = await compliance_auditDestinationUrl(url, adCopy, ai, VERTEX_MODEL);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "compliance audit error");
    res.status(500).json({ error: "Compliance audit failed" });
  }
});

export default router;
