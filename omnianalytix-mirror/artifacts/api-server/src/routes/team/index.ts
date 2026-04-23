import { Router } from "express";
import { eq, and, sql, isNull } from "drizzle-orm";
import { db, teamMembers, workspaces } from "@workspace/db";
import { parsePagination, paginatedResponse } from "../../lib/pagination";
import { getOrgId, requireRole } from "../../middleware/rbac";
import { generateInviteToken, verifyInviteToken } from "../../lib/invite-token";

const router = Router();

const VALID_ROLES = ["viewer", "analyst", "it", "manager", "admin"] as const;
type ValidRole = typeof VALID_ROLES[number];

async function countOrgAdmins(orgId: number): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`COUNT(*)::int` })
    .from(teamMembers)
    .where(and(eq(teamMembers.organizationId, orgId), eq(teamMembers.role, "admin"), eq(teamMembers.isActive, true)));
  return row?.c ?? 0;
}

// ─── GET /api/team ────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const wantsPagination = req.query.page !== undefined;
    const { page, pageSize, offset } = parsePagination(req.query as Record<string, unknown>);

    const orgFilter = orgId != null ? eq(teamMembers.organizationId, orgId) : isNull(teamMembers.organizationId);

    if (wantsPagination) {
      // tenant-ownership-skip: orgFilter = eq(teamMembers.organizationId,
      // orgId) declared above. Lint doesn't recognize the variable name.
      const [totalRow] = await db.select({ c: sql<number>`COUNT(*)::int` }).from(teamMembers).where(orgFilter);
      const totalCount = totalRow?.c ?? 0;
      // tenant-ownership-skip: same orgFilter as above.
      const members = await db.select().from(teamMembers).where(orgFilter).orderBy(teamMembers.createdAt).limit(pageSize).offset(offset);
      res.json(paginatedResponse(members, totalCount, page, pageSize));
    } else {
      const members = await db.select().from(teamMembers).where(orgFilter).orderBy(teamMembers.createdAt);
      res.json(members);
    }
  } catch (err) {
    req.log.error({ err }, "Failed to list team members");
    res.status(500).json({ error: "Failed to list team members" });
  }
});

// ─── POST /api/team (Invite) ──────────────────────────────────────────────────
// Requires admin. Accepts: { name, email, role, workspaceId? }
// Generates a signed JWT stored in inviteCode. The JWT encodes email, role,
// workspaceId, organizationId, and type ("team" | "client"). Expires in 48 h.

router.post("/", requireRole("admin"), async (req, res) => {
  try {
    const orgId = getOrgId(req);
    // workspace-id-source-skip: body workspaceId verified inline below via eq(workspaces.organizationId, orgId)
    const { name, email, role, workspaceId } = req.body as {
      name?: string;
      email?: string;
      role?: string;
      workspaceId?: number | null;
    };

    if (!name || !email || !role) {
      res.status(400).json({ error: "name, email, and role are required" });
      return;
    }
    if (!VALID_ROLES.includes(role as ValidRole)) {
      res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(", ")}` });
      return;
    }

    let resolvedWorkspaceId: number | null = null;
    if (workspaceId != null) {
      const [ws] = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(
          orgId != null
            ? and(eq(workspaces.id, workspaceId), eq(workspaces.organizationId, orgId))
            : eq(workspaces.id, workspaceId),
        )
        .limit(1);
      if (!ws) {
        res.status(400).json({ error: "workspaceId not found or does not belong to your organization" });
        return;
      }
      resolvedWorkspaceId = ws.id;
    }

    // Insert the row first (without inviteCode) to get the generated `id`,
    // then immediately update with the JWT that embeds the memberId.
    const [draft] = await db
      .insert(teamMembers)
      .values({
        organizationId: orgId,
        workspaceId: resolvedWorkspaceId,
        name,
        email,
        role,
        inviteCode: "pending",
        isActive: false,
        invitePending: true,
      })
      .returning();

    const inviteCode = generateInviteToken({
      memberId: draft.id,
      email,
      role,
      workspaceId: resolvedWorkspaceId,
      organizationId: orgId ?? null,
      type: resolvedWorkspaceId != null ? "client" : "team",
    });

    const [member] = await db
      .update(teamMembers)
      .set({ inviteCode })
      .where(eq(teamMembers.id, draft.id))
      .returning();

    res.status(201).json(member);
  } catch (err) {
    req.log.error({ err }, "Failed to create team member");
    res.status(500).json({ error: "Failed to create team member" });
  }
});

// ─── PATCH /api/team/:id ──────────────────────────────────────────────────────

router.patch("/:id", requireRole("admin"), async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    // Tenant-scope at SELECT (was load-then-check pre-Apr 2026 refactor).
    const ownerWhere = orgId != null
      ? and(eq(teamMembers.id, id), eq(teamMembers.organizationId, orgId))
      : and(eq(teamMembers.id, id), isNull(teamMembers.organizationId));
    const [existing] = await db.select().from(teamMembers).where(ownerWhere).limit(1);
    if (!existing) { res.status(404).json({ error: "Team member not found" }); return; }

    // workspace-id-source-skip: body workspaceId verified inline below via eq(workspaces.organizationId, orgId)
    const { role, isActive, workspaceId } = req.body as { role?: string; isActive?: boolean; workspaceId?: number | null };
    const patch: Partial<{ role: string; isActive: boolean; workspaceId: number | null }> = {};

    if (role !== undefined) {
      if (!VALID_ROLES.includes(role as ValidRole)) {
        res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(", ")}` });
        return;
      }
      if (existing.role === "admin" && role !== "admin" && orgId) {
        const adminCount = await countOrgAdmins(orgId);
        if (adminCount <= 1) {
          res.status(409).json({ error: "Cannot demote the last admin. Promote another member first." });
          return;
        }
      }
      patch.role = role;
    }
    if (isActive !== undefined) {
      if (!isActive && existing.role === "admin" && orgId) {
        const adminCount = await countOrgAdmins(orgId);
        if (adminCount <= 1) {
          res.status(409).json({ error: "Cannot deactivate the last admin." });
          return;
        }
      }
      patch.isActive = isActive;
    }
    if (workspaceId !== undefined) {
      if (workspaceId != null) {
        const [ws] = await db
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(
            orgId != null
              ? and(eq(workspaces.id, workspaceId), eq(workspaces.organizationId, orgId))
              : eq(workspaces.id, workspaceId),
          )
          .limit(1);
        if (!ws) {
          res.status(400).json({ error: "workspaceId not found or does not belong to your organization" });
          return;
        }
        patch.workspaceId = ws.id;
      } else {
        patch.workspaceId = null;
      }
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "No valid fields to update" });
      return;
    }
    const [updated] = await db.update(teamMembers).set(patch).where(eq(teamMembers.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Team member not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update team member");
    res.status(500).json({ error: "Failed to update team member" });
  }
});

// ─── DELETE /api/team/invites/:id ─────────────────────────────────────────────
// Requires admin. Instantly revokes a pending invite by hard-deleting the row.
// Must be registered BEFORE DELETE /:id so Express routes it correctly.

router.delete("/invites/:id", requireRole("admin"), async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    // Tenant-scope at SELECT (was load-then-check pre-Apr 2026 refactor).
    const ownerWhere = orgId != null
      ? and(eq(teamMembers.id, id), eq(teamMembers.organizationId, orgId))
      : and(eq(teamMembers.id, id), isNull(teamMembers.organizationId));
    const [existing] = await db
      .select()
      .from(teamMembers)
      .where(ownerWhere)
      .limit(1);

    if (!existing) { res.status(404).json({ error: "Invite not found" }); return; }

    if (!existing.invitePending) {
      res.status(409).json({ error: "This invite has already been accepted and cannot be revoked." });
      return;
    }

    await db.delete(teamMembers).where(eq(teamMembers.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to revoke invite");
    res.status(500).json({ error: "Failed to revoke invite" });
  }
});

// ─── DELETE /api/team/:id ─────────────────────────────────────────────────────

router.delete("/:id", requireRole("admin"), async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const callerId = req.rbacUser?.id;
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    if (callerId === id) {
      res.status(409).json({ error: "You cannot remove yourself. Ask another admin to remove you." });
      return;
    }

    // Tenant-scope at SELECT (was load-then-check pre-Apr 2026 refactor).
    const ownerWhere = orgId != null
      ? and(eq(teamMembers.id, id), eq(teamMembers.organizationId, orgId))
      : and(eq(teamMembers.id, id), isNull(teamMembers.organizationId));
    const [existing] = await db.select().from(teamMembers).where(ownerWhere).limit(1);
    if (!existing) { res.status(404).json({ error: "Team member not found" }); return; }

    if (existing.role === "admin" && orgId) {
      const adminCount = await countOrgAdmins(orgId);
      if (adminCount <= 1) {
        res.status(409).json({ error: "Cannot remove the last admin from the organization." });
        return;
      }
    }

    await db.delete(teamMembers).where(eq(teamMembers.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete team member");
    res.status(500).json({ error: "Failed to delete team member" });
  }
});

// ─── GET /api/team/invite/:token ──────────────────────────────────────────────
// Public endpoint. Verifies the JWT signature and expiry, then checks that the
// invite is still pending (not yet consumed). Returns safe member info.

router.get("/invite/:token", async (req, res) => {
  try {
    let payload;
    try {
      payload = verifyInviteToken(req.params.token);
    } catch {
      res.status(401).json({ error: "Invalid or expired invite link." });
      return;
    }

    const [member] = await db
      .select({
        id: teamMembers.id,
        name: teamMembers.name,
        email: teamMembers.email,
        role: teamMembers.role,
        workspaceId: teamMembers.workspaceId,
        organizationId: teamMembers.organizationId,
        invitePending: teamMembers.invitePending,
      })
      .from(teamMembers)
      .where(eq(teamMembers.id, payload.memberId))
      .limit(1);

    if (!member) {
      res.status(404).json({ error: "Invite not found." });
      return;
    }
    if (!member.invitePending) {
      res.status(410).json({ error: "This invite has already been used or revoked." });
      return;
    }

    res.json({
      memberId: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
      workspaceId: member.workspaceId,
      organizationId: member.organizationId,
      type: payload.type,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to look up invite token");
    res.status(500).json({ error: "Failed to look up invite" });
  }
});

// ─── POST /api/team/invite/:token/consume ─────────────────────────────────────
// Public endpoint. Called when the invitee accepts and completes registration.
// Verifies the JWT, checks invitePending, then atomically marks it consumed
// by setting invitePending = false and isActive = true.

router.post("/invite/:token/consume", async (req, res) => {
  try {
    let payload;
    try {
      payload = verifyInviteToken(req.params.token);
    } catch {
      res.status(401).json({ error: "Invalid or expired invite link." });
      return;
    }

    // tenant-ownership-skip: payload.memberId comes from a JWT signed by us
    // (verifyInviteToken above). The signed token IS the tenancy proof; no
    // org context exists for an unauthenticated invitee yet.
    const [member] = await db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.id, payload.memberId))
      .limit(1);

    if (!member) {
      res.status(404).json({ error: "Invite not found." });
      return;
    }
    if (!member.invitePending) {
      res.status(410).json({ error: "This invite has already been used or revoked." });
      return;
    }

    const [activated] = await db
      .update(teamMembers)
      .set({ invitePending: false, isActive: true })
      .where(and(eq(teamMembers.id, member.id), eq(teamMembers.invitePending, true)))
      .returning();

    if (!activated) {
      res.status(410).json({ error: "This invite has already been used or revoked." });
      return;
    }

    res.json({
      success: true,
      memberId: activated.id,
      name: activated.name,
      email: activated.email,
      role: activated.role,
      workspaceId: activated.workspaceId,
      organizationId: activated.organizationId,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to consume invite token");
    res.status(500).json({ error: "Failed to accept invite" });
  }
});

export default router;
