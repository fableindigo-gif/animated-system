/**
 * VAG 2 — Path-Based Tenant Isolation Middleware
 *
 * Prevents cross-tenant data access by verifying that any org or workspace
 * ID present in the request URL belongs to the authenticated user's
 * organisation. Super-admins bypass this check (they manage all tenants).
 *
 * Usage:
 *   router.get("/:orgId/data", requireSameOrg("orgId"), handler)
 *   router.get("/:id/data",    requireWorkspaceOwnership(),  handler)
 */
import type { Request, Response, NextFunction } from "express";
import { db, workspaces } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getOrgId } from "./rbac";
import { logger } from "../lib/logger";

const SUPER_ADMIN_ROLE = "super_admin";

function isSuperAdmin(req: Request): boolean {
  return (req.jwtPayload as { role?: string } | undefined)?.role === SUPER_ADMIN_ROLE;
}

/**
 * requireSameOrg(paramName?)
 *
 * Validates that the numeric org ID in `req.params[paramName]` (default "id")
 * matches the authenticated user's organisationId.
 *
 * Returns 403 when:
 *   - The user has no org context (unauthenticated or orphaned account)
 *   - The URL org ID does not match the user's org
 *
 * Super-admins always pass through.
 */
export function requireSameOrg(paramName = "id") {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (isSuperAdmin(req)) return next();

    const userOrgId = getOrgId(req);
    if (userOrgId == null) {
      logger.warn(
        { path: req.originalUrl },
        "[TenantIsolation] Rejected: no organisation context in token",
      );
      res.status(403).json({
        error: "Forbidden",
        message: "Your account is not linked to an organisation.",
        code: "TENANT_NO_ORG",
      });
      return;
    }

    const paramValue = req.params[paramName];
    if (!paramValue) return next();

    // Express params are always string at runtime, but some typings widen
    // to string|string[]; coerce to be safe.
    const requestedOrgId = parseInt(String(paramValue), 10);
    if (isNaN(requestedOrgId)) return next();

    if (requestedOrgId !== userOrgId) {
      logger.warn(
        {
          userId: req.rbacUser?.id,
          userOrgId,
          requestedOrgId,
          path: req.originalUrl,
        },
        "[TenantIsolation] 🔴 Cross-tenant access attempt blocked",
      );
      res.status(403).json({
        error: "Forbidden",
        message: "You do not have access to this organisation.",
        code: "TENANT_ORG_MISMATCH",
      });
      return;
    }

    next();
  };
}

/**
 * requireWorkspaceOwnership()
 *
 * Validates that the workspace identified by `req.params.id` belongs to the
 * authenticated user's organisation.
 *
 * Lookups are done against the workspaces table. Returns 404 (not 403) for
 * workspaces outside the user's org so as not to leak the existence of
 * foreign workspaces.
 *
 * Super-admins always pass through.
 */
export function requireWorkspaceOwnership() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (isSuperAdmin(req)) return next();

    const userOrgId = getOrgId(req);
    if (userOrgId == null) {
      res.status(403).json({
        error: "Forbidden",
        message: "Your account is not linked to an organisation.",
        code: "TENANT_NO_ORG",
      });
      return;
    }

    const wsId = parseInt(String(req.params.id), 10);
    if (isNaN(wsId)) return next();

    try {
      const [ws] = await db
        .select({ organizationId: workspaces.organizationId })
        .from(workspaces)
        .where(eq(workspaces.id, wsId))
        .limit(1);

      if (!ws) {
        res.status(404).json({ error: "Workspace not found" });
        return;
      }

      if (ws.organizationId !== userOrgId) {
        logger.warn(
          {
            userId: req.rbacUser?.id,
            userOrgId,
            workspaceId: wsId,
            workspaceOrgId: ws.organizationId,
            path: req.originalUrl,
          },
          "[TenantIsolation] 🔴 Cross-tenant workspace access attempt blocked",
        );
        res.status(404).json({ error: "Workspace not found" });
        return;
      }

      next();
    } catch (err) {
      logger.error({ err }, "[TenantIsolation] DB error during workspace ownership check");
      res.status(500).json({ error: "Internal server error" });
    }
  };
}

/**
 * assertWorkspaceOwnedByOrg(workspaceId, orgId)
 *
 * Phase 2 chokepoint helper — returns true iff the given workspace belongs to
 * the given organisation. Use whenever a route receives a workspaceId from the
 * request body or query string and you need to confirm the caller owns it.
 *
 * Returns false on missing org context, missing/invalid workspaceId, or
 * cross-tenant ownership. Never throws.
 */
export async function assertWorkspaceOwnedByOrg(
  workspaceId: number | null | undefined,
  orgId: number | null | undefined,
): Promise<boolean> {
  if (orgId == null || workspaceId == null || !Number.isFinite(workspaceId)) return false;
  try {
    const [ws] = await db
      .select({ organizationId: workspaces.organizationId })
      .from(workspaces)
      .where(eq(workspaces.id, Number(workspaceId)))
      .limit(1);
    return !!ws && ws.organizationId === orgId;
  } catch (err) {
    logger.error({ err, workspaceId, orgId }, "[TenantIsolation] assertWorkspaceOwnedByOrg DB error");
    return false;
  }
}
