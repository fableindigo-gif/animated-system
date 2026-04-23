import { Router } from "express";
import { randomBytes } from "crypto";
import { db, organizations, workspaces, teamMembers, liveTriageAlerts } from "@workspace/db";
import { eq, sql, isNull, and, inArray } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { getAlerts } from "../../lib/alert-store";
import { requireRole, getOrgId } from "../../middleware/rbac";
import { handleRouteError } from "../../lib/route-error-handler";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateSlug(clientName: string): string {
  const base = clientName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const suffix = randomBytes(3).toString("hex");
  return `${base}-${suffix}`;
}

function generateToken(): string {
  return randomBytes(24).toString("hex");
}

// ─── GET /api/workspaces ──────────────────────────────────────────────────────
// Returns all workspaces for admins/managers; scoped to a single workspace for
// team members who have been assigned a specific workspaceId.
router.get("/", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const rbacUser = (req as any).rbacUser as { id: number; role: string } | undefined;

    // Admins, agency owners, super admins, and managers always see all workspaces.
    const isPrivileged =
      rbacUser?.role === "admin" ||
      rbacUser?.role === "agency_owner" ||
      rbacUser?.role === "super_admin" ||
      rbacUser?.role === "manager";

    let scopedWorkspaceId: number | null = null;

    if (!isPrivileged && rbacUser?.id) {
      // Look up the member's workspaceId assignment.
      const [member] = await db
        .select({ workspaceId: teamMembers.workspaceId })
        .from(teamMembers)
        .where(eq(teamMembers.id, rbacUser.id))
        .limit(1);

      scopedWorkspaceId = member?.workspaceId ?? null;
    }

    const orgFilter =
      orgId != null ? eq(workspaces.organizationId, orgId) : isNull(workspaces.organizationId);

    const whereClause =
      scopedWorkspaceId != null
        ? and(orgFilter, eq(workspaces.id, scopedWorkspaceId))
        : orgFilter;

    const rows = await db
      .select()
      .from(workspaces)
      .where(whereClause)
      .orderBy(workspaces.createdAt);

    // Per-workspace aggregation of unresolved critical alerts. We pull from two
    // sources and merge:
    //   1. The persistent `live_triage_alerts` table — the durable record of
    //      every infra/triage alert, keyed by workspace slug.
    //   2. The in-memory `getAlerts()` feed — short-lived programmatic alerts
    //      raised by background workers that don't carry a workspace tag, so
    //      we attribute them to the "default" workspace as before.
    const slugs = rows.map((ws) => ws.slug);
    const dbCounts: Record<string, number> = {};
    if (slugs.length > 0) {
      try {
        const counts = await db
          .select({
            slug: liveTriageAlerts.workspaceId,
            n: sql<number>`count(*)::int`,
          })
          .from(liveTriageAlerts)
          .where(
            and(
              inArray(liveTriageAlerts.workspaceId, slugs),
              eq(liveTriageAlerts.severity, "critical"),
              eq(liveTriageAlerts.resolvedStatus, false),
            ),
          )
          .groupBy(liveTriageAlerts.workspaceId);
        for (const row of counts) {
          dbCounts[row.slug] = Number(row.n) || 0;
        }
      } catch (err) {
        // Don't 500 the workspace listing if alert aggregation fails — degrade
        // to "no critical alerts" rather than blocking the dashboard.
        logger.warn({ err }, "GET /workspaces alert aggregation failed");
      }
    }

    const programmaticAlerts = getAlerts();
    const programmaticCriticalCount = programmaticAlerts.filter(
      (a) => a.severity === "critical",
    ).length;

    const enriched = rows.map((ws) => {
      const persistent = dbCounts[ws.slug] ?? 0;
      const inMemory = ws.slug === "default" ? programmaticCriticalCount : 0;
      return {
        ...ws,
        criticalAlertCount: persistent + inMemory,
      };
    });

    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "GET /workspaces failed");
    res.status(500).json({ error: "Failed to list workspaces" });
  }
});

// ─── POST /api/workspaces ─────────────────────────────────────────────────────
// Create a new client workspace.
router.post("/", async (req, res): Promise<void> => {
  try {
    const { clientName, enabledIntegrations = [], notes, primaryGoal, selectedWorkflows } = req.body as {
      clientName: string;
      enabledIntegrations?: string[];
      notes?: string;
      primaryGoal?: string;
      selectedWorkflows?: string[];
    };

    if (!clientName?.trim()) {
      res.status(400).json({ error: "clientName is required" });
      return;
    }

    // Resolve the org from the requesting user's JWT, falling back to "default"
    const orgId = getOrgId(req);
    let org: typeof organizations.$inferSelect | undefined;
    if (orgId != null) {
      [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    }
    if (!org) {
      [org] = await db.select().from(organizations).where(eq(organizations.slug, "default"));
    }
    if (!org) {
      [org] = await db.insert(organizations).values({ name: "Default Agency", slug: "default" }).returning();
    }

    const slug        = generateSlug(clientName.trim());
    const inviteToken = generateToken();

    const [created] = await db.insert(workspaces).values({
      organizationId:      org.id,
      clientName:          clientName.trim(),
      slug,
      primaryGoal:         primaryGoal ?? null,
      selectedWorkflows:   selectedWorkflows ?? null,
      enabledIntegrations: enabledIntegrations as string[],
      inviteToken,
      status: "active",
      notes: notes ?? null,
    }).returning();

    res.status(201).json({ ...created, criticalAlertCount: 0 });
  } catch (err) {
    logger.error({ err }, "POST /workspaces failed");
    res.status(500).json({ error: "Failed to create workspace" });
  }
});

// ─── PATCH /api/workspaces/:id ────────────────────────────────────────────────
router.patch("/:id", async (req, res): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(String(req.params.id), 10);

    {
      const [ws] = await db.select({ orgId: workspaces.organizationId }).from(workspaces).where(eq(workspaces.id, id)).limit(1);
      const ownerMatch = ws && (orgId != null ? ws.orgId === orgId : ws.orgId == null);
      if (!ownerMatch) { res.status(404).json({ error: "Workspace not found" }); return; }
    }

    const { clientName, enabledIntegrations, status, notes, primaryGoal, selectedWorkflows, websiteUrl } = req.body as Partial<{
      clientName: string;
      enabledIntegrations: string[];
      status: string;
      notes: string;
      primaryGoal: string;
      selectedWorkflows: string[];
      websiteUrl: string;
    }>;

    const updates: Record<string, unknown> = {};
    if (clientName          !== undefined) updates.clientName = clientName;
    if (enabledIntegrations !== undefined) updates.enabledIntegrations = enabledIntegrations;
    if (status              !== undefined) updates.status = status;
    if (notes               !== undefined) updates.notes = notes;
    if (primaryGoal         !== undefined) updates.primaryGoal = primaryGoal;
    if (selectedWorkflows   !== undefined) updates.selectedWorkflows = selectedWorkflows;
    if (websiteUrl          !== undefined) {
      if (websiteUrl) {
        try {
          const parsed = new URL(websiteUrl);
          if (!["http:", "https:"].includes(parsed.protocol)) {
            res.status(400).json({ error: "websiteUrl must use http or https" });
            return;
          }
          if (["localhost", "127.0.0.1", "0.0.0.0", "[::]", "[::1]"].includes(parsed.hostname) || parsed.hostname.endsWith(".local")) {
            res.status(400).json({ error: "websiteUrl must be a public domain" });
            return;
          }
        } catch {
          res.status(400).json({ error: "websiteUrl must be a valid URL" });
          return;
        }
      }
      updates.websiteUrl = websiteUrl;
    }

    const [updated] = await db
      .update(workspaces)
      .set(updates)
      .where(eq(workspaces.id, id))
      .returning();

    if (!updated) { res.status(404).json({ error: "Workspace not found" }); return; }
    res.json({ ...updated, criticalAlertCount: 0 });
  } catch (err) {
    logger.error({ err }, "PATCH /workspaces/:id failed");
    res.status(500).json({ error: "Failed to update workspace" });
  }
});

// ─── DELETE /api/workspaces/:id ───────────────────────────────────────────────
// Soft-delete: marks workspace as archived.
router.delete("/:id", requireRole("admin"), async (req, res): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(String(req.params.id), 10);

    {
      const [ws] = await db.select({ orgId: workspaces.organizationId }).from(workspaces).where(eq(workspaces.id, id)).limit(1);
      const ownerMatch = ws && (orgId != null ? ws.orgId === orgId : ws.orgId == null);
      if (!ownerMatch) { res.status(404).json({ error: "Workspace not found" }); return; }
    }

    const [archived] = await db
      .update(workspaces)
      .set({ status: "archived" })
      .where(eq(workspaces.id, id))
      .returning();
    if (!archived) { res.status(404).json({ error: "Workspace not found" }); return; }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "DELETE /workspaces/:id failed");
    res.status(500).json({ error: "Failed to archive workspace" });
  }
});

// ─── PATCH /api/workspaces/:id/onboarding ────────────────────────────────────
// Saves the goal-routed onboarding intent for a specific client workspace.
router.patch("/:id/onboarding", async (req, res): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(String(req.params.id), 10);

    {
      const [ws] = await db.select({ orgId: workspaces.organizationId }).from(workspaces).where(eq(workspaces.id, id)).limit(1);
      const ownerMatch = ws && (orgId != null ? ws.orgId === orgId : ws.orgId == null);
      if (!ownerMatch) { res.status(404).json({ error: "Workspace not found" }); return; }
    }

    const { primaryGoal, companyDomain, discoverySource, headquartersCountry, enabledIntegrations, selectedWorkflows } = req.body as {
      primaryGoal?: string;
      companyDomain?: string;
      discoverySource?: string;
      headquartersCountry?: string;
      enabledIntegrations?: string[];
      selectedWorkflows?: string[];
    };

    if (primaryGoal && !["ecom", "leadgen", "hybrid"].includes(primaryGoal)) {
      res.status(400).json({ error: "primaryGoal must be 'ecom', 'leadgen', or 'hybrid'" });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (primaryGoal         !== undefined) updates.primaryGoal        = primaryGoal;
    if (companyDomain       !== undefined) updates.websiteUrl         = companyDomain;
    if (discoverySource     !== undefined) updates.discoverySource    = discoverySource;
    if (headquartersCountry !== undefined) updates.headquartersCountry = headquartersCountry;
    if (enabledIntegrations !== undefined) updates.enabledIntegrations = enabledIntegrations;
    if (selectedWorkflows   !== undefined) updates.selectedWorkflows   = selectedWorkflows;

    const [updated] = await db
      .update(workspaces)
      .set(updates)
      .where(eq(workspaces.id, id))
      .returning();

    if (!updated) { res.status(404).json({ error: "Workspace not found" }); return; }
    logger.info({ id, primaryGoal, selectedWorkflows }, "Workspace onboarding saved");
    res.json({ ...updated, criticalAlertCount: 0 });
  } catch (err) {
    logger.error({ err }, "PATCH /workspaces/:id/onboarding failed");
    res.status(500).json({ error: "Failed to save workspace onboarding" });
  }
});

// ─── POST /api/workspaces/:id/regenerate-token ───────────────────────────────
router.post("/:id/regenerate-token", requireRole("admin"), async (req, res): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(String(req.params.id), 10);

    {
      const [ws] = await db.select({ orgId: workspaces.organizationId }).from(workspaces).where(eq(workspaces.id, id)).limit(1);
      const ownerMatch = ws && (orgId != null ? ws.orgId === orgId : ws.orgId == null);
      if (!ownerMatch) { res.status(404).json({ error: "Workspace not found" }); return; }
    }

    const [updated] = await db
      .update(workspaces)
      .set({ inviteToken: generateToken() })
      .where(eq(workspaces.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Workspace not found" }); return; }
    res.json({ inviteToken: updated.inviteToken });
  } catch (err) {
    handleRouteError(err, req, res, "POST /api/workspaces/:id/regenerate-token", { error: "Failed to regenerate token" });
  }
});

export default router;
