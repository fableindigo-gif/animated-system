import { Router } from "express";
import { db, organizations } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { handleRouteError } from "../../lib/route-error-handler";
import { requireOrgId } from "../../middleware/rbac";

const router = Router();

// ─── Multi-tenant migration note ─────────────────────────────────────────────
// These routes used to look up `organizations.slug = "default"` — a leftover
// from the single-tenant prototype. In a multi-tenant deployment that pattern
// allowed any unauthenticated caller to read AND mutate the agency's name,
// tier, and onboarding payload. All routes now require a resolved tenant via
// requireOrgId(req) and scope every query/mutation to the caller's orgId.

// PATCH /api/organizations/name
// Updates the display name of the caller's organization.
router.patch("/name", async (req, res) => {
  try {
    const orgId = requireOrgId(req);
    const { name } = req.body as { name: string };
    if (!name?.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const [org] = await db
      .update(organizations)
      .set({ name: name.trim() })
      .where(eq(organizations.id, orgId))
      .returning();
    if (!org) { res.status(404).json({ error: "Organization not found" }); return; }
    logger.info({ orgId, name: name.trim() }, "Organization name updated");
    res.json(org);
  } catch (err) {
    handleRouteError(err, req, res, "PATCH /api/organizations/name", { error: "Failed to update organization name" });
  }
});

// PATCH /api/organizations/onboarding
// Saves the goal-routed onboarding payload to the caller's organization.
router.patch("/onboarding", async (req, res) => {
  try {
    const orgId = requireOrgId(req);
    const {
      primaryGoal,
      selectedPlatforms,
      selectedWorkflows,
    } = req.body as {
      primaryGoal: string;
      selectedPlatforms: string[];
      selectedWorkflows: string[];
    };

    if (!primaryGoal || !["ecom", "leadgen"].includes(primaryGoal)) {
      res.status(400).json({ error: "primaryGoal must be 'ecom' or 'leadgen'" });
      return;
    }

    const [updated] = await db
      .update(organizations)
      .set({
        primaryGoal,
        selectedPlatforms: selectedPlatforms ?? [],
        selectedWorkflows: selectedWorkflows ?? [],
      })
      .where(eq(organizations.id, orgId))
      .returning();
    if (!updated) { res.status(404).json({ error: "Organization not found" }); return; }

    logger.info({ orgId, primaryGoal, selectedPlatforms, selectedWorkflows }, "Onboarding payload saved");
    res.json(updated);
  } catch (err) {
    handleRouteError(err, req, res, "PATCH /api/organizations/onboarding", { error: "Failed to save onboarding data" });
  }
});

// GET /api/organizations/onboarding
router.get("/onboarding", async (req, res) => {
  try {
    const orgId = requireOrgId(req);
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) { res.json({ primaryGoal: null, selectedPlatforms: [], selectedWorkflows: [] }); return; }
    res.json({
      name:              org.name,
      primaryGoal:       org.primaryGoal,
      selectedPlatforms: (org.selectedPlatforms as string[]) ?? [],
      selectedWorkflows: (org.selectedWorkflows as string[]) ?? [],
    });
  } catch (err) {
    handleRouteError(err, req, res, "GET /api/organizations/onboarding", { error: "Failed to fetch onboarding data" });
  }
});

// GET /api/organizations/me
// Returns the caller organization's name and tier.
router.get("/me", async (req, res) => {
  try {
    const orgId = requireOrgId(req);
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) { res.json({ name: null, tier: "free" }); return; }
    res.json({ id: org.id, name: org.name, tier: org.subscriptionTier ?? "free" });
  } catch (err) {
    handleRouteError(err, req, res, "GET /api/organizations/me", { error: "Failed to fetch organization" });
  }
});

router.get("/subscription", async (req, res) => {
  try {
    const orgId = requireOrgId(req);
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) { res.json({ tier: "free" }); return; }
    res.json({ tier: org.subscriptionTier ?? "free" });
  } catch (err) {
    handleRouteError(err, req, res, "GET /api/organizations/subscription", { error: "Failed to fetch subscription" });
  }
});

export default router;
