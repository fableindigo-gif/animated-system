import { Router } from "express";
import { db, organizations, teamMembers, platformConnections, workspaces } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { getOrgId } from "../../middleware/rbac";
import { randomBytes } from "crypto";
import shoppingInsiderCacheRouter from "./shopping-insider-cache";
import shoppingInsiderAlerterConfigRouter from "./shopping-insider-alerter-config";

const SUPER_ADMIN_ROLE = "super_admin";

const router = Router();

router.use("/shopping-insider-cache", shoppingInsiderCacheRouter);
router.use("/shopping-insider-alerter-config", shoppingInsiderAlerterConfigRouter);

router.get("/organizations", async (req, res) => {
  try {
    const isSuperAdmin =
      (req.jwtPayload as { role?: string } | undefined)?.role === SUPER_ADMIN_ROLE ||
      req.rbacUser?.role === SUPER_ADMIN_ROLE;

    // ── Tenant-scoped query ──────────────────────────────────────────────────
    // Super-admins see all organisations (platform management).
    // Every other user is strictly limited to their own organisation.
    let baseQuery = db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        subscriptionTier: organizations.subscriptionTier,
        createdAt: organizations.createdAt,
      })
      .from(organizations);

    if (!isSuperAdmin) {
      const orgId = getOrgId(req);
      if (orgId == null) {
        res.status(403).json({
          error: "Forbidden",
          message: "Your account is not associated with an organisation.",
          code: "TENANT_NO_ORG",
        });
        return;
      }
      baseQuery = baseQuery.where(eq(organizations.id, orgId)) as typeof baseQuery;
    }

    const rows = await baseQuery.orderBy(organizations.createdAt);

    const enriched = await Promise.all(
      rows.map(async (org) => {
        const [memberRow] = await db
          .select({ c: sql<number>`COUNT(*)::int` })
          .from(teamMembers)
          .where(eq(teamMembers.organizationId, org.id));
        const [connRow] = await db
          .select({ c: sql<number>`COUNT(*)::int` })
          .from(platformConnections)
          .where(eq(platformConnections.organizationId, org.id));
        const [wsRow] = await db
          .select({ c: sql<number>`COUNT(*)::int` })
          .from(workspaces)
          .where(eq(workspaces.organizationId, org.id));
        return {
          ...org,
          memberCount: memberRow?.c ?? 0,
          connectionCount: connRow?.c ?? 0,
          workspaceCount: wsRow?.c ?? 0,
        };
      }),
    );

    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "GET /admin/organizations failed");
    res.status(500).json({ error: "Failed to list organizations" });
  }
});

router.post("/organizations", async (req, res) => {
  try {
    const { name, slug, adminEmail, goal } = req.body as {
      name: string;
      slug: string;
      adminEmail?: string;
      goal?: string;
    };

    if (!name?.trim() || !slug?.trim()) {
      res.status(400).json({ error: "name and slug are required" });
      return;
    }

    const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, "");
    const [existing] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, cleanSlug));
    if (existing) {
      res.status(409).json({ error: `Organization with slug "${cleanSlug}" already exists` });
      return;
    }

    const [org] = await db
      .insert(organizations)
      .values({ name: name.trim(), slug: cleanSlug, subscriptionTier: "pro" })
      .returning();

    const [ws] = await db
      .insert(workspaces)
      .values({
        organizationId: org.id,
        clientName: name.trim(),
        slug: cleanSlug,
        status: "active",
        primaryGoal: goal || "ecom",
        inviteToken: randomBytes(16).toString("hex"),
      })
      .returning();

    if (adminEmail?.trim()) {
      await db.insert(teamMembers).values({
        organizationId: org.id,
        name: adminEmail.split("@")[0],
        email: adminEmail.trim().toLowerCase(),
        role: "admin",
        isActive: true,
        inviteCode: randomBytes(8).toString("hex"),
      });
    }

    logger.info({ orgId: org.id, slug: cleanSlug, adminEmail }, "Admin provisioned new organization");
    res.status(201).json({ organization: org, workspace: ws });
  } catch (err) {
    logger.error({ err }, "POST /admin/organizations failed");
    res.status(500).json({ error: "Failed to create organization" });
  }
});

export default router;
