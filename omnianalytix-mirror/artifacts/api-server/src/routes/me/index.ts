import { Router } from "express";
import { db, workspaces, teamMembers } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { getOrgId } from "../../middleware/rbac";
import { handleRouteError } from "../../lib/route-error-handler";

const router = Router();

/**
 * GET /api/me/workspaces
 * ─────────────────────────────────────────────────────────────────────────────
 * Returns the authenticated user's authorization context:
 *   - role
 *   - organizationId
 *   - workspaceId (their assigned workspace, or null for admins)
 *   - authorizedWorkspaceIds — array of workspace IDs this user may access
 *   - authorizedWorkspaces   — full workspace objects for context hydration
 *
 * Admins/managers see all workspaces in their org.
 * Viewers/analysts/members see only their assigned workspace.
 */
router.get("/workspaces", async (req, res) => {
  try {
    const rbacUser  = (req as unknown as { rbacUser?: { id: number; role: string; workspaceId?: number } }).rbacUser;
    const orgId     = getOrgId(req);
    const userRole  = rbacUser?.role ?? "viewer";
    const isPrivileged = ["super_admin", "admin", "agency_owner", "manager"].includes(userRole);

    const orgFilter = orgId != null
      ? eq(workspaces.organizationId, orgId)
      : isNull(workspaces.organizationId);

    let authorized: Array<typeof workspaces.$inferSelect> = [];

    if (isPrivileged) {
      // tenant-ownership-skip: orgFilter is `eq(workspaces.organizationId,
      // orgId)` declared above; lint can't follow the variable assignment
      // across the conditional branch boundary.
      authorized = await db.select().from(workspaces).where(orgFilter).orderBy(workspaces.createdAt);
    } else {
      let scopedWorkspaceId: number | null = rbacUser?.workspaceId ?? null;

      if (!scopedWorkspaceId && rbacUser?.id) {
        // tenant-ownership-skip: self-scoped read — `rbacUser.id` IS the
        // authed caller's own teamMember PK derived from the session.
        const [member] = await db
          .select({ workspaceId: teamMembers.workspaceId })
          .from(teamMembers)
          .where(eq(teamMembers.id, rbacUser.id))
          .limit(1);
        scopedWorkspaceId = member?.workspaceId ?? null;
      }

      if (scopedWorkspaceId) {
        authorized = await db
          .select()
          .from(workspaces)
          .where(and(orgFilter, eq(workspaces.id, scopedWorkspaceId)))
          .limit(1);
      } else {
        authorized = [];
      }
    }

    res.json({
      role:                  userRole,
      organizationId:        orgId,
      workspaceId:           rbacUser?.workspaceId ?? null,
      authorizedWorkspaceIds: authorized.map((w) => w.id),
      authorizedWorkspaces:  authorized,
    });
  } catch (err) {
    handleRouteError(err, req, res, "GET /api/me/workspaces", { error: "Failed to fetch user workspace authorization" });
  }
});

export default router;
