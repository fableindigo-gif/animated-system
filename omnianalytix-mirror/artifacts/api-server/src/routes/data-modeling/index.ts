import { Router } from "express";
import { db, customMetrics } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { getOrgId } from "../../middleware/rbac";
import { assertWorkspaceOwnedByOrg } from "../../middleware/tenant-isolation";

const router = Router();

router.get("/metrics", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return void res.status(401).json({ error: "Unauthorized" });

    const rows = await db
      .select()
      .from(customMetrics)
      .where(eq(customMetrics.organizationId, orgId))
      .orderBy(desc(customMetrics.createdAt));

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /data-modeling/metrics failed");
    res.status(500).json({ error: "Failed to fetch metrics" });
  }
});

router.post("/metrics", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return void res.status(401).json({ error: "Unauthorized" });

    const { name, description, dataType, formula, workspaceId } = req.body as {
      name: string;
      description?: string;
      dataType?: string;
      formula: string;
      workspaceId?: number;
    };

    if (!name?.trim() || !formula?.trim()) {
      return void res.status(400).json({ error: "name and formula are required" });
    }

    // SEC-03 follow-up: a body-supplied workspaceId must belong to the
    // caller's organisation, otherwise we'd be tagging a metric to a
    // sibling tenant's workspace id (data-poisoning vector).
    let resolvedWorkspaceId: number | null = null;
    if (workspaceId != null) {
      const owns = await assertWorkspaceOwnedByOrg(workspaceId, orgId);
      if (!owns) {
        return void res
          .status(403)
          .json({ error: "workspaceId does not belong to your organization", code: "WORKSPACE_NOT_OWNED" });
      }
      resolvedWorkspaceId = workspaceId;
    }

    const [metric] = await db
      .insert(customMetrics)
      .values({
        organizationId: orgId,
        workspaceId: resolvedWorkspaceId,
        name: name.trim(),
        description: description?.trim() || null,
        dataType: dataType || "number",
        formula: formula.trim(),
        createdBy: (req as any).rbacUser?.id ?? null,
      })
      .returning();

    logger.info({ id: metric.id, name }, "Custom metric created");
    res.status(201).json(metric);
  } catch (err) {
    logger.error({ err }, "POST /data-modeling/metrics failed");
    res.status(500).json({ error: "Failed to create metric" });
  }
});

router.delete("/metrics/:id", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return void res.status(401).json({ error: "Unauthorized" });

    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return void res.status(400).json({ error: "Invalid metric id" });
    const [deleted] = await db
      .delete(customMetrics)
      .where(and(eq(customMetrics.id, id), eq(customMetrics.organizationId, orgId)))
      .returning();

    if (!deleted) return void res.status(404).json({ error: "Metric not found" });
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "DELETE /data-modeling/metrics failed");
    res.status(500).json({ error: "Failed to delete metric" });
  }
});

export default router;
