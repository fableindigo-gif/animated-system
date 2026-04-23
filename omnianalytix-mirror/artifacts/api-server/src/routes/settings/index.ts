/**
 * /api/settings — tenant-scoped configuration.
 *
 * Currently exposes the per-tenant economics (Task #153):
 *   GET  /api/settings/economics
 *   PUT  /api/settings/economics                       — { cogsPct, targetRoas }
 *   PUT  /api/settings/economics/campaigns/:campaignId — { targetRoas | null }
 *
 * Reads are open to any signed-in member of the org; writes require an admin
 * or manager role (same gate as workspace updates).
 */
import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";
import { db, organizations, campaignTargets } from "@workspace/db";
import { DEFAULT_MAX_LOOKBACK_DAYS, DEFAULT_DAILY_ROW_CAP } from "../../lib/ai-gads-usage";
import { getOrgId, requireRole } from "../../middleware/rbac";
import { handleRouteError } from "../../lib/route-error-handler";

const router = Router();

// ── Validation schemas ─────────────────────────────────────────────────────

// COGS as a fraction (0.35 = 35%). Reject obviously-wrong values so a
// fat-fingered "35" doesn't silently flip every margin tile to "−$X".
const cogsPctSchema = z.number().min(0).max(0.95).nullable();
// Target ROAS is a multiplier (4.0 = 400%). Cap at 100x — anything higher
// is almost certainly a unit-confusion error.
const targetRoasSchema = z.number().positive().max(100).nullable();

const economicsBodySchema = z.object({
  cogsPct:    cogsPctSchema.optional(),
  targetRoas: targetRoasSchema.optional(),
});

const campaignTargetBodySchema = z.object({
  targetRoas: targetRoasSchema, // null clears the override
});

// ── Helpers ────────────────────────────────────────────────────────────────

async function loadEconomics(orgId: number) {
  // tenant-ownership-skip: this query is the org's own settings row, scoped
  // by the verified `orgId` from `getOrgId(req)`.
  const [orgRow] = await db
    .select({
      cogsPctDefault:    organizations.cogsPctDefault,
      targetRoasDefault: organizations.targetRoasDefault,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  // tenant-ownership-skip: campaign overrides are filtered by `organizationId`
  // — the verified org id from the request.
  const overrides = await db
    .select({
      campaignId: campaignTargets.campaignId,
      targetRoas: campaignTargets.targetRoas,
      updatedAt:  campaignTargets.updatedAt,
    })
    .from(campaignTargets)
    .where(eq(campaignTargets.organizationId, orgId));

  const campaignOverrides: Record<string, number> = {};
  for (const row of overrides) {
    campaignOverrides[row.campaignId] = row.targetRoas;
  }

  return {
    cogsPct:    orgRow?.cogsPctDefault    ?? null,
    targetRoas: orgRow?.targetRoasDefault ?? null,
    campaignOverrides,
  };
}

// ── Routes ─────────────────────────────────────────────────────────────────

router.get("/economics", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    if (orgId == null) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    res.json(await loadEconomics(orgId));
  } catch (err) {
    handleRouteError(err, req, res, "GET /api/settings/economics", {
      error: "Failed to load economics settings",
    });
  }
});

router.put("/economics", requireRole("admin"), async (req, res) => {
  try {
    const orgId = getOrgId(req);
    if (orgId == null) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const parsed = economicsBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid economics payload",
        detail: parsed.error.message,
        code: "INVALID_INPUT",
      });
      return;
    }

    const updates: Partial<{ cogsPctDefault: number | null; targetRoasDefault: number | null }> = {};
    if (parsed.data.cogsPct !== undefined)    updates.cogsPctDefault    = parsed.data.cogsPct;
    if (parsed.data.targetRoas !== undefined) updates.targetRoasDefault = parsed.data.targetRoas;

    if (Object.keys(updates).length > 0) {
      // tenant-ownership-skip: write scoped to the caller's own organization
      // by the verified `orgId` from `getOrgId(req)`.
      await db.update(organizations).set(updates).where(eq(organizations.id, orgId));
    }

    res.json(await loadEconomics(orgId));
  } catch (err) {
    handleRouteError(err, req, res, "PUT /api/settings/economics", {
      error: "Failed to update economics settings",
    });
  }
});

router.put("/economics/campaigns/:campaignId", requireRole("manager"), async (req, res) => {
  try {
    const orgId = getOrgId(req);
    if (orgId == null) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const campaignId = String(req.params.campaignId ?? "").trim();
    if (!campaignId) {
      res.status(400).json({ error: "Missing campaignId" });
      return;
    }
    const parsed = campaignTargetBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid target ROAS payload",
        detail: parsed.error.message,
        code: "INVALID_INPUT",
      });
      return;
    }

    if (parsed.data.targetRoas == null) {
      // Null body clears the override — campaign falls back to the org default.
      // tenant-ownership-skip: scoped delete on the verified `orgId`.
      await db
        .delete(campaignTargets)
        .where(and(
          eq(campaignTargets.organizationId, orgId),
          eq(campaignTargets.campaignId, campaignId),
        ));
    } else {
      // Upsert by (organizationId, campaignId) — covered by the unique index
      // declared in the schema.
      // tenant-ownership-skip: scoped insert on the verified `orgId`.
      await db
        .insert(campaignTargets)
        .values({
          organizationId: orgId,
          campaignId,
          targetRoas: parsed.data.targetRoas,
        })
        .onConflictDoUpdate({
          target: [campaignTargets.organizationId, campaignTargets.campaignId],
          set: { targetRoas: parsed.data.targetRoas, updatedAt: new Date() },
        });
    }

    res.json(await loadEconomics(orgId));
  } catch (err) {
    handleRouteError(err, req, res, "PUT /api/settings/economics/campaigns/:campaignId", {
      error: "Failed to update per-campaign target ROAS",
    });
  }
});

// ── AI Guardrails: GET /settings/ai-guardrails ─────────────────────────────
// Returns current per-org AI campaign query limits.
router.get("/ai-guardrails", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    if (orgId == null) return res.status(400).json({ error: "No organisation context." });
    const [org] = await db
      .select({ aiMaxLookbackDays: organizations.aiMaxLookbackDays, aiDailyRowCap: organizations.aiDailyRowCap })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    return res.json({
      maxLookbackDays: org?.aiMaxLookbackDays ?? DEFAULT_MAX_LOOKBACK_DAYS,
      dailyRowCap:     org?.aiDailyRowCap     ?? DEFAULT_DAILY_ROW_CAP,
      defaults:        { maxLookbackDays: DEFAULT_MAX_LOOKBACK_DAYS, dailyRowCap: DEFAULT_DAILY_ROW_CAP },
    });
  } catch (err) {
    handleRouteError(err, req, res, "GET /settings/ai-guardrails", { error: "Failed to load AI guardrails." });
    return;
  }
});

// ── AI Guardrails: PUT /settings/ai-guardrails ─────────────────────────────
// Admin/manager only. Update per-org AI query caps. Pass null to revert to default.
const aiGuardrailsBodySchema = z.object({
  maxLookbackDays: z.number().int().min(1).max(365).nullable().optional(),
  dailyRowCap:     z.number().int().min(100).max(1_000_000).nullable().optional(),
});

router.put("/ai-guardrails", requireRole("manager"), async (req, res) => {
  try {
    const orgId = getOrgId(req);
    if (orgId == null) return res.status(400).json({ error: "No organisation context." });
    const parsed = aiGuardrailsBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    const { maxLookbackDays, dailyRowCap } = parsed.data;
    const update: Record<string, unknown> = {};
    if (maxLookbackDays !== undefined) update.aiMaxLookbackDays = maxLookbackDays;
    if (dailyRowCap     !== undefined) update.aiDailyRowCap     = dailyRowCap;
    if (Object.keys(update).length > 0) {
      await db.update(organizations).set(update).where(eq(organizations.id, orgId));
    }
    const [org] = await db
      .select({ aiMaxLookbackDays: organizations.aiMaxLookbackDays, aiDailyRowCap: organizations.aiDailyRowCap })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    return res.json({
      maxLookbackDays: org?.aiMaxLookbackDays ?? DEFAULT_MAX_LOOKBACK_DAYS,
      dailyRowCap:     org?.aiDailyRowCap     ?? DEFAULT_DAILY_ROW_CAP,
    });
  } catch (err) {
    handleRouteError(err, req, res, "PUT /settings/ai-guardrails", { error: "Failed to update AI guardrails." });
    return;
  }
});

export default router;
