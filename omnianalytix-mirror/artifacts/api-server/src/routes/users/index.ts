/**
 * /api/users/profile
 * ------------------
 * Read and update the authenticated team member's profile.
 *
 * GET  /api/users/profile            → returns { id, name, email, role, hasCompletedTour, agencySetupComplete }
 * PATCH /api/users/profile           → body { hasCompletedTour?: boolean; agencySetupComplete?: boolean } → saves to DB
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, teamMembers } from "@workspace/db";
import { requireAuth, attachUser } from "../../middleware/rbac";
import { logger } from "../../lib/logger";

const router = Router();

// Both endpoints require the user to be logged in
// `attachUser` and `requireAuth` are middleware *factories* — calling them
// returns the actual middleware. Passing the factory directly to `router.use`
// causes Express to treat it as middleware that never calls `next()`, which
// silently hangs every request to this router.
router.use(attachUser());
router.use(requireAuth());

// ─── GET /api/users/profile ────────────────────────────────────────────────────
router.get("/profile", async (req, res) => {
  try {
    const memberId = req.rbacUser?.id;
    if (!memberId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    // tenant-ownership-skip: self-scoped read — `memberId` is the authed
    // caller's own teamMember PK, derived from the session (req.rbacUser.id).
    const rows = await db
      .select({
        id:                  teamMembers.id,
        name:                teamMembers.name,
        email:               teamMembers.email,
        role:                teamMembers.role,
        hasCompletedTour:    teamMembers.hasCompletedTour,
        agencySetupComplete: teamMembers.agencySetupComplete,
      })
      .from(teamMembers)
      .where(eq(teamMembers.id, memberId))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    res.json(rows[0]);
  } catch (err) {
    logger.error({ err }, "[users/profile GET] Failed");
    res.status(500).json({ error: "Failed to load profile" });
  }
});

// ─── PATCH /api/users/profile ──────────────────────────────────────────────────
const patchSchema = z.object({
  hasCompletedTour:    z.boolean().optional(),
  agencySetupComplete: z.boolean().optional(),
  name:                z.string().min(1).max(120).optional(),
}).strict();

router.patch("/profile", async (req, res) => {
  try {
    const memberId = req.rbacUser?.id;
    if (!memberId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", issues: parsed.error.issues });
      return;
    }

    const updates: Partial<typeof teamMembers.$inferInsert> = {};
    if (parsed.data.hasCompletedTour    !== undefined) updates.hasCompletedTour    = parsed.data.hasCompletedTour;
    if (parsed.data.agencySetupComplete !== undefined) updates.agencySetupComplete = parsed.data.agencySetupComplete;
    if (parsed.data.name                !== undefined) updates.name                = parsed.data.name;

    if (Object.keys(updates).length === 0) {
      res.json({ ok: true });
      return;
    }

    await db
      .update(teamMembers)
      .set(updates)
      .where(eq(teamMembers.id, memberId));

    logger.info({ memberId, updates }, "[users/profile PATCH] Updated");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[users/profile PATCH] Failed");
    res.status(500).json({ error: "Failed to update profile" });
  }
});

export default router;
