import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, teamMembers } from "@workspace/db";
import { verifyInviteToken } from "../../lib/invite-token";

const router = Router();

// ─── GET /api/invite/:token ────────────────────────────────────────────────────
// Public endpoint. Verifies JWT signature and expiry, checks invitePending,
// and returns safe display info. Does NOT consume the invite.

router.get("/:token", async (req, res) => {
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

// ─── POST /api/invite/:token/consume ──────────────────────────────────────────
// Public endpoint. Atomically marks the invite as consumed (invitePending → false,
// isActive → true). Uses an AND condition in the UPDATE to prevent double-consume.

router.post("/:token/consume", async (req, res) => {
  try {
    let payload;
    try {
      payload = verifyInviteToken(req.params.token);
    } catch {
      res.status(401).json({ error: "Invalid or expired invite link." });
      return;
    }

    // tenant-ownership-skip: payload.memberId comes from a JWT signed by us
    // (verifyInviteToken above). The signed token IS the tenancy proof; the
    // invitee has no org context yet, by definition of the public invite flow.
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
