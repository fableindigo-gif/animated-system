import { Router } from "express";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, accessRequests, workspaces } from "@workspace/db";
import { getOrgId, requireRole } from "../../middleware/rbac";

const router = Router();

const VALID_STATUSES = ["pending", "granted", "dismissed"] as const;
type ValidStatus = typeof VALID_STATUSES[number];

// ─── POST /api/team/access-requests ───────────────────────────────────────────
// Any authenticated member can submit. Records a request that the workspace
// admin can grant or dismiss from settings. Email/in-app notification surface
// is the admin's "Access requests" tab in settings (rendered from GET below).

router.post("/", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const caller = req.rbacUser;
    const { actionLabel, actionContext, reason, workspaceId } = req.body as {
      actionLabel?: string;
      actionContext?: string;
      reason?: string;
      workspaceId?: number | null;
    };

    if (!actionLabel || typeof actionLabel !== "string") {
      res.status(400).json({ error: "actionLabel is required" });
      return;
    }
    if (!caller) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // Tenant scoping for workspaceId: clients can pass an arbitrary workspaceId,
    // so we validate it belongs to the caller's org. Reject mismatches outright
    // rather than silently falling back to null — a wrong workspaceId is a bug
    // we want surfaced.
    let scopedWorkspaceId: number | null = null;
    if (workspaceId !== undefined && workspaceId !== null) {
      if (typeof workspaceId !== "number" || !Number.isFinite(workspaceId)) {
        res.status(400).json({ error: "workspaceId must be a number" });
        return;
      }
      const orgWhere = orgId != null
        ? and(eq(workspaces.id, workspaceId), eq(workspaces.organizationId, orgId))
        : and(eq(workspaces.id, workspaceId), isNull(workspaces.organizationId));
      const [ws] = await db.select({ id: workspaces.id }).from(workspaces).where(orgWhere).limit(1);
      if (!ws) {
        res.status(403).json({ error: "workspaceId does not belong to your organization" });
        return;
      }
      scopedWorkspaceId = workspaceId;
    }

    const [created] = await db
      .insert(accessRequests)
      .values({
        organizationId: orgId,
        workspaceId: scopedWorkspaceId,
        requesterId: caller.id,
        requesterName: caller.name ?? caller.email ?? "Unknown",
        requesterEmail: caller.email ?? "",
        requesterRole: caller.role ?? "viewer",
        actionLabel: actionLabel.slice(0, 200),
        actionContext: (actionContext ?? "").slice(0, 500),
        reason: (reason ?? "").slice(0, 500),
        status: "pending",
      })
      .returning();

    res.status(201).json(created);
  } catch (err) {
    req.log.error({ err }, "Failed to create access request");
    res.status(500).json({ error: "Failed to submit access request" });
  }
});

// ─── GET /api/team/access-requests ────────────────────────────────────────────
// Admin-only. Defaults to `pending` requests; ?status=all returns every row.

router.get("/", requireRole("admin"), async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const status = String(req.query.status ?? "pending");
    const orgFilter = orgId != null
      ? eq(accessRequests.organizationId, orgId)
      : isNull(accessRequests.organizationId);
    // tenant-ownership-skip: orgFilter constrains to the caller's org.
    const whereClause = status === "all"
      ? orgFilter
      : and(orgFilter, eq(accessRequests.status, status));

    const rows = await db
      .select()
      .from(accessRequests)
      .where(whereClause)
      .orderBy(desc(accessRequests.createdAt))
      .limit(200);

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list access requests");
    res.status(500).json({ error: "Failed to list access requests" });
  }
});

// ─── PATCH /api/team/access-requests/:id ──────────────────────────────────────
// Admin-only. Mark a request granted or dismissed. Granting does NOT auto-
// promote the user — admin still adjusts the role via the existing members
// surface. This just clears the request from the pending list.

router.patch("/:id", requireRole("admin"), async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const caller = req.rbacUser;
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const { status } = req.body as { status?: string };
    if (!status || !VALID_STATUSES.includes(status as ValidStatus) || status === "pending") {
      res.status(400).json({ error: `status must be one of: granted, dismissed` });
      return;
    }

    const ownerWhere = orgId != null
      ? and(eq(accessRequests.id, id), eq(accessRequests.organizationId, orgId))
      : and(eq(accessRequests.id, id), isNull(accessRequests.organizationId));

    const [updated] = await db
      .update(accessRequests)
      .set({
        status,
        resolvedById: caller?.id ?? null,
        resolvedByName: caller?.name ?? caller?.email ?? null,
        resolvedAt: sql`NOW()`,
      })
      .where(ownerWhere)
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Access request not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update access request");
    res.status(500).json({ error: "Failed to update access request" });
  }
});

export default router;
