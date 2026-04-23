import { Router } from "express";
import { eq, desc, sql, ilike, or, and } from "drizzle-orm";
import { db, resolutionLibrary, workspaces } from "@workspace/db";
import { getOrgId } from "../../middleware/rbac";

const router = Router();

function orgResolutionFilter(req: import("express").Request) {
  const orgId = getOrgId(req);
  if (!orgId) return undefined;
  return sql`${resolutionLibrary.workspaceId} IN (SELECT ${workspaces.id} FROM ${workspaces} WHERE ${workspaces.organizationId} = ${orgId})`;
}

router.get("/", async (req, res) => {
  try {
    const orgScope = orgResolutionFilter(req);
    const search = req.query.search as string | undefined;
    const platform = req.query.platform as string | undefined;

    const conditions: ReturnType<typeof eq>[] = [];

    if (orgScope) {
      conditions.push(orgScope);
    }

    if (platform) {
      conditions.push(eq(resolutionLibrary.platform, platform));
    }

    let query = db.select().from(resolutionLibrary).orderBy(desc(resolutionLibrary.createdAt)).$dynamic();

    if (search) {
      const searchFilter = or(
        ilike(resolutionLibrary.toolDisplayName, `%${search}%`),
        ilike(resolutionLibrary.originalProblem, `%${search}%`),
        ilike(resolutionLibrary.reasoning, `%${search}%`),
      );
      conditions.push(searchFilter!);
    }

    if (conditions.length > 0) {
      query = query.where(conditions.length === 1 ? conditions[0] : and(...conditions));
    }

    const entries = await query;
    res.json(entries);
  } catch (err) {
    req.log.error({ err }, "Failed to list resolution library");
    res.status(500).json({ error: "Failed to list resolution library" });
  }
});

router.get("/stats", async (req, res) => {
  try {
    const orgScope = orgResolutionFilter(req);

    const [row] = orgScope
      ? await db.select({ c: sql<number>`COUNT(*)::int` }).from(resolutionLibrary).where(orgScope)
      : await db.select({ c: sql<number>`COUNT(*)::int` }).from(resolutionLibrary);

    const platformQuery = db
      .select({
        platform: resolutionLibrary.platform,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(resolutionLibrary)
      .$dynamic();

    const platforms = orgScope
      ? await platformQuery.where(orgScope).groupBy(resolutionLibrary.platform)
      : await platformQuery.groupBy(resolutionLibrary.platform);

    res.json({ total: row?.c ?? 0, byPlatform: platforms });
  } catch {
    res.json({ total: 0, byPlatform: [] });
  }
});

export default router;
