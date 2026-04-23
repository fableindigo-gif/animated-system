import { Router, type Request } from "express";
import { eq, and, asc } from "drizzle-orm";
import { db, savedViews, workspaces } from "@workspace/db";
import { handleRouteError } from "../../lib/route-error-handler";
import { getOrgId } from "../../middleware/rbac";

function getUserId(req: Request): string | null {
  const id = req.rbacUser?.id ?? req.jwtPayload?.memberId ?? null;
  return id == null ? null : String(id);
}
import { logger } from "../../lib/logger";

const router = Router();

function getWorkspaceId(req: Request): number | null {
  const header = req.headers["x-workspace-id"];
  const query  = req.query.workspaceId;
  const raw    = (typeof header === "string" ? header : null) ?? (typeof query === "string" ? query : null);
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Tenant-isolation guard for saved-views: verifies the caller's org owns the
 * workspace they're operating on. Returns null if access is denied (caller
 * MUST stop processing); returns the validated wsId otherwise. We return 404
 * (not 403) on cross-tenant attempts to avoid leaking workspace existence.
 */
async function assertWorkspaceOwnership(req: Request, wsId: number): Promise<boolean> {
  const orgId = getOrgId(req);
  if (orgId == null) return false;
  const [ws] = await db
    .select({ organizationId: workspaces.organizationId })
    .from(workspaces)
    .where(eq(workspaces.id, wsId))
    .limit(1);
  if (!ws) return false;
  if (ws.organizationId !== orgId) {
    logger.warn(
      { userOrgId: orgId, workspaceId: wsId, workspaceOrgId: ws.organizationId, path: req.originalUrl },
      "[SavedViews] cross-tenant access blocked",
    );
    return false;
  }
  return true;
}

const PAGE_KEY_RE = /^[a-z0-9_\-:]{1,64}$/i;
const NAME_MAX = 60;

function badRequest(res: Parameters<typeof handleRouteError>[2], msg: string) {
  return res.status(400).json({ ok: false, error: msg });
}

// ─── GET /api/saved-views?workspaceId=&pageKey= ────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const wsId = getWorkspaceId(req);
    if (!wsId) return badRequest(res, "Missing workspaceId");
    const pageKey = typeof req.query.pageKey === "string" ? req.query.pageKey : "";
    if (!PAGE_KEY_RE.test(pageKey)) return badRequest(res, "Invalid pageKey");
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthenticated" });
    if (!(await assertWorkspaceOwnership(req, wsId))) {
      return res.status(404).json({ ok: false, error: "Workspace not found" });
    }

    const rows = await db
      .select()
      .from(savedViews)
      .where(and(
        eq(savedViews.workspaceId, wsId),
        eq(savedViews.userId, userId),
        eq(savedViews.pageKey, pageKey),
      ))
      .orderBy(asc(savedViews.name));

    return res.json({ ok: true, views: rows });
  } catch (err) {
    return handleRouteError(err, req, res, "GET /saved-views", { error: "Failed to load saved views" });
  }
});

// ─── POST /api/saved-views ─────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const body = req.body ?? {};
    const wsId = Number(body.workspaceId);
    const pageKey = typeof body.pageKey === "string" ? body.pageKey : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!Number.isFinite(wsId) || wsId <= 0) return badRequest(res, "Invalid workspaceId");
    if (!PAGE_KEY_RE.test(pageKey)) return badRequest(res, "Invalid pageKey");
    if (!name || name.length > NAME_MAX) return badRequest(res, "Invalid name");
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthenticated" });
    if (!(await assertWorkspaceOwnership(req, wsId))) {
      return res.status(404).json({ ok: false, error: "Workspace not found" });
    }

    // Filters payload — accept a JSON object of string→string[]. Anything else
    // is dropped silently so a malformed UI cannot poison the DB.
    const rawFilters = body.filters ?? {};
    const filters: Record<string, string[]> = {};
    if (rawFilters && typeof rawFilters === "object") {
      for (const [k, v] of Object.entries(rawFilters as Record<string, unknown>)) {
        if (Array.isArray(v) && v.every((x) => typeof x === "string") && v.length <= 50) {
          filters[k] = v.slice(0, 50);
        }
      }
    }

    const datePreset = typeof body.datePreset === "string" ? body.datePreset.slice(0, 16) : null;
    const customFrom = typeof body.customFrom === "string" ? body.customFrom.slice(0, 40) : null;
    const customTo   = typeof body.customTo   === "string" ? body.customTo.slice(0, 40)   : null;

    // Atomic upsert via Postgres ON CONFLICT — avoids the select-then-insert
    // race that would otherwise 500 when two clients save the same view name
    // concurrently.
    const inserted = await db
      .insert(savedViews)
      .values({ workspaceId: wsId, userId, pageKey, name, filters, datePreset, customFrom, customTo })
      .onConflictDoUpdate({
        target: [savedViews.workspaceId, savedViews.userId, savedViews.pageKey, savedViews.name],
        set: { filters, datePreset, customFrom, customTo, updatedAt: new Date() },
      })
      .returning({ id: savedViews.id });

    return res.json({ ok: true, id: inserted[0]?.id });
  } catch (err) {
    return handleRouteError(err, req, res, "POST /saved-views", { error: "Failed to save view" });
  }
});

// ─── DELETE /api/saved-views/:id ───────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const wsId = getWorkspaceId(req);
    if (!wsId) return badRequest(res, "Missing workspaceId");
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return badRequest(res, "Invalid id");
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthenticated" });
    if (!(await assertWorkspaceOwnership(req, wsId))) {
      return res.status(404).json({ ok: false, error: "Workspace not found" });
    }

    await db
      .delete(savedViews)
      .where(and(
        eq(savedViews.id, id),
        eq(savedViews.workspaceId, wsId),
        eq(savedViews.userId, userId),
      ));

    return res.json({ ok: true });
  } catch (err) {
    return handleRouteError(err, req, res, "DELETE /saved-views/:id", { error: "Failed to delete view" });
  }
});

export default router;
