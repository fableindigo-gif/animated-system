import { Router, Request, Response } from "express";
import { db, fxOverrides, insertFxOverrideSchema, workspaces } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { getRates } from "../../lib/fx-rates";
import { getOrgId, requireRole } from "../../middleware/rbac";
import { logger } from "../../lib/logger";

const router = Router();

/**
 * Returns true iff `workspaceId` belongs to the caller's organization (or
 * caller has no org scope, i.e. SUPER_ADMIN — handled upstream by RBAC).
 *
 * This is the only thing standing between a tenant and the FX overrides of a
 * sibling tenant on the same instance, so it MUST be called for every
 * mutation/lookup that takes a `workspaceId` from user input.
 */
async function workspaceBelongsToCallerOrg(workspaceId: number, orgId: number | null | undefined): Promise<boolean> {
  if (!orgId) return false;
  const rows = await db
    .select({ organizationId: workspaces.organizationId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1)
    .execute();
  if (!rows.length) return false;
  return rows[0].organizationId === orgId;
}

// ─── GET /api/fx/rates?quotes=INR,GBP&date=YYYY-MM-DD&workspaceId=N ───────────
//
// Returns: { base: "USD", rates: { INR: { rate, source, rateDate }, ... } }
//
// `date` defaults to today. `workspaceId` enables override resolution.
router.get("/rates", async (req: Request, res: Response) => {
  try {
    const quotesRaw = String(req.query.quotes ?? "").trim();
    if (!quotesRaw) {
      return res.status(400).json({ ok: false, message: "`quotes` query param is required (comma-separated ISO codes)" });
    }
    const quotes = quotesRaw.split(",").map((q) => q.trim().toUpperCase()).filter(Boolean);
    if (quotes.length > 25) {
      return res.status(400).json({ ok: false, message: "Too many quotes (max 25 per request)" });
    }
    const dateRaw = String(req.query.date ?? "").trim();
    const date = dateRaw || new Date().toISOString().slice(0, 10);
    if (dateRaw && isNaN(new Date(dateRaw).getTime())) {
      return res.status(400).json({ ok: false, message: "Invalid `date` — expected YYYY-MM-DD" });
    }
    const wsRaw = req.query.workspaceId != null ? Number(req.query.workspaceId) : null;
    let workspaceId: number | null = Number.isFinite(wsRaw) ? wsRaw : null;

    // SECURITY: workspaceId enables per-tenant overrides — gate it by org
    // ownership so a tenant can never probe a sibling's overrides by
    // guessing IDs. If the workspace does not belong to the caller, silently
    // strip it (we still serve global rates) rather than 403 to keep the
    // viewer-level read endpoint resilient.
    if (workspaceId != null) {
      const orgScoped = getOrgId(req);
      const owns = orgScoped ? await workspaceBelongsToCallerOrg(workspaceId, orgScoped) : false;
      if (!owns) workspaceId = null;
    }

    const looked = await getRates(quotes, date, workspaceId);
    const rates: Record<string, { rate: number; source: string; rateDate: string }> = {};
    for (const r of looked) {
      rates[r.quote] = { rate: r.rate, source: r.source, rateDate: r.rateDate };
    }
    return res.json({ ok: true, base: "USD", date, rates });
  } catch (err) {
    logger.error({ err }, "GET /fx/rates error");
    return res.status(500).json({ ok: false, message: "Internal server error" });
  }
});

// ─── GET /api/fx/overrides?workspaceId=N ──────────────────────────────────────
//
// Reading overrides is admin-gated (override values constitute financial
// configuration) AND tenant-isolated to the caller's organization.
router.get("/overrides", requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const workspaceId = Number(req.query.workspaceId);
    if (!Number.isFinite(workspaceId)) {
      return res.status(400).json({ ok: false, message: "`workspaceId` is required" });
    }
    const orgScoped = getOrgId(req);
    if (orgScoped == null) {
      return res.status(403).json({ ok: false, message: "Organization context required" });
    }
    if (!(await workspaceBelongsToCallerOrg(workspaceId, orgScoped))) {
      return res.status(403).json({ ok: false, message: "Workspace does not belong to your organization" });
    }
    const rows = await db.select().from(fxOverrides).where(eq(fxOverrides.workspaceId, workspaceId)).execute();
    return res.json({ ok: true, overrides: rows });
  } catch (err) {
    logger.error({ err }, "GET /fx/overrides error");
    return res.status(500).json({ ok: false, message: "Internal server error" });
  }
});

// ─── PUT /api/fx/overrides — upsert per-workspace override ────────────────────
//
// Mutations require admin role + tenant ownership of the target workspace.
router.put("/overrides", requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const parsed = insertFxOverrideSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, message: "Invalid override payload", issues: parsed.error.issues });
    }
    const { workspaceId, base, quote, rate, note } = parsed.data;
    if (!Number.isFinite(rate) || rate <= 0) {
      return res.status(400).json({ ok: false, message: "`rate` must be a positive number" });
    }
    const orgScoped = getOrgId(req);
    if (orgScoped == null) {
      // Best-effort isolation: if no org context, deny.
      return res.status(403).json({ ok: false, message: "Organization context required" });
    }
    if (!(await workspaceBelongsToCallerOrg(workspaceId, orgScoped))) {
      return res.status(403).json({ ok: false, message: "Workspace does not belong to your organization" });
    }
    const upserted = await db
      .insert(fxOverrides)
      .values({ workspaceId, base: (base ?? "USD").toUpperCase(), quote: quote.toUpperCase(), rate, note: note ?? null })
      .onConflictDoUpdate({
        target: [fxOverrides.workspaceId, fxOverrides.base, fxOverrides.quote],
        set: { rate, note: note ?? null, updatedAt: new Date() },
      })
      .returning();
    return res.json({ ok: true, override: upserted[0] });
  } catch (err) {
    logger.error({ err }, "PUT /fx/overrides error");
    return res.status(500).json({ ok: false, message: "Internal server error" });
  }
});

// ─── DELETE /api/fx/overrides?workspaceId=N&quote=INR ─────────────────────────
router.delete("/overrides", requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const workspaceId = Number(req.query.workspaceId);
    const quote = String(req.query.quote ?? "").trim().toUpperCase();
    if (!Number.isFinite(workspaceId) || !quote) {
      return res.status(400).json({ ok: false, message: "`workspaceId` and `quote` are required" });
    }
    const orgScoped = getOrgId(req);
    if (orgScoped == null) {
      return res.status(403).json({ ok: false, message: "Organization context required" });
    }
    if (!(await workspaceBelongsToCallerOrg(workspaceId, orgScoped))) {
      return res.status(403).json({ ok: false, message: "Workspace does not belong to your organization" });
    }
    await db
      .delete(fxOverrides)
      .where(and(
        eq(fxOverrides.workspaceId, workspaceId),
        eq(fxOverrides.base, "USD"),
        eq(fxOverrides.quote, quote),
      ))
      .execute();
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "DELETE /fx/overrides error");
    return res.status(500).json({ ok: false, message: "Internal server error" });
  }
});

export default router;
