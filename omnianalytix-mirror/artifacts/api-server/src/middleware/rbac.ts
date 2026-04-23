import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, teamMembers, auditLogs } from "@workspace/db";
import { logger } from "../lib/logger";
import { verifyAnyToken, type GateJwtPayload } from "../routes/auth/gate";

export type Role = "viewer" | "analyst" | "it" | "manager" | "admin" | "agency_owner" | "super_admin";

const ROLE_RANK: Record<Role, number> = {
  viewer:        0,
  analyst:       1,
  it:            1,
  manager:       2,
  admin:         3,
  agency_owner:  4,
  super_admin:   5,
};

const VALID_ROLES = new Set<string>(Object.keys(ROLE_RANK));

export interface RbacUser {
  id: number;
  organizationId: number | null;
  // Optional workspace scope — populated when the user's session resolves to a
  // specific workspace (otherwise the user has org-wide visibility).
  workspaceId?: number | null;
  name: string;
  email: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      rbacUser?: RbacUser;
      jwtPayload?: GateJwtPayload;
    }
  }
}

function extractJwtPayload(req: Request): GateJwtPayload | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  return verifyAnyToken(auth.slice(7));
}

async function resolveUser(req: Request): Promise<RbacUser | null> {
  const jwtPayload = extractJwtPayload(req);
  if (jwtPayload) {
    req.jwtPayload = jwtPayload;
  }

  if (jwtPayload?.memberId && jwtPayload.role && jwtPayload.name && jwtPayload.email) {
    if (VALID_ROLES.has(jwtPayload.role)) {
      return {
        id: jwtPayload.memberId,
        organizationId: jwtPayload.organizationId ?? null,
        name: jwtPayload.name,
        email: jwtPayload.email,
        role: jwtPayload.role as Role,
      };
    }
  }

  return null;
}

async function logRbacRejection(
  req: Request,
  user: RbacUser | null,
  requiredRole: Role,
) {
  try {
    const orgId = user?.organizationId ?? req.jwtPayload?.organizationId ?? null;
    await db.insert(auditLogs).values({
      organizationId: orgId ?? undefined,
      platform: "system",
      platformLabel: "RBAC",
      toolName: "rbac_enforcement",
      toolDisplayName: "Role-Based Access Control",
      toolArgs: {
        method: req.method,
        path: req.originalUrl,
        userId: user?.id ?? null,
        userName: user?.name ?? "unknown",
        userRole: user?.role ?? "none",
        requiredRole,
        authMethod: req.jwtPayload?.memberId ? "jwt" : "header",
      },
      result: {
        success: false,
        message: user
          ? `Forbidden: role "${user.role}" does not meet minimum "${requiredRole}" for ${req.method} ${req.originalUrl}`
          : `Forbidden: no valid team member identity for ${req.method} ${req.originalUrl}`,
      },
      status: "forbidden",
    });
  } catch (err) {
    logger.error({ err }, "RBAC: failed to log rejection to audit_logs");
  }
}

export function requireRole(minimumRole: Role) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = await resolveUser(req);

    if (!user) {
      await logRbacRejection(req, null, minimumRole);
      res.status(403).json({
        error: "Forbidden",
        message: "A valid team member identity is required for this action.",
        code: "RBAC_NO_IDENTITY",
      });
      return;
    }

    if (ROLE_RANK[user.role] < ROLE_RANK[minimumRole]) {
      logger.warn(
        { userId: user.id, userRole: user.role, requiredRole: minimumRole, path: req.originalUrl },
        "RBAC: insufficient role",
      );
      await logRbacRejection(req, user, minimumRole);
      res.status(403).json({
        error: "Forbidden",
        message: `Your role "${user.role}" does not have permission for this action. Minimum required: "${minimumRole}".`,
        code: "RBAC_INSUFFICIENT_ROLE",
        currentRole: user.role,
        requiredRole: minimumRole,
      });
      return;
    }

    req.rbacUser = user;
    next();
  };
}

const READ_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function readGuard(readMinRole: Role, writeMinRole?: Role) {
  const readCheck = requireRole(readMinRole);
  const writeCheck = writeMinRole ? requireRole(writeMinRole) : readCheck;
  return (req: Request, res: Response, next: NextFunction) => {
    if (READ_HTTP_METHODS.has(req.method)) {
      return readCheck(req, res, next);
    }
    return writeCheck(req, res, next);
  };
}

export function attachUser() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const user = await resolveUser(req);
    if (user) req.rbacUser = user;
    next();
  };
}

export function requireAuth() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.rbacUser) return next();

    const user = await resolveUser(req);
    if (user) {
      req.rbacUser = user;
      return next();
    }

    const jwtPayload = extractJwtPayload(req);
    if (jwtPayload) {
      return next();
    }

    res.status(401).json({
      error: "Unauthorized",
      message: "A valid authentication token is required to access this resource.",
      code: "AUTH_REQUIRED",
    });
  };
}

export function getOrgId(req: Request): number | null {
  return req.rbacUser?.organizationId ?? req.jwtPayload?.organizationId ?? null;
}

/**
 * Phase 2 chokepoint — every tenant-scoped route should call this instead of
 * `getOrgId(req)`. Throws `UnauthorizedTenantError` if the request has no
 * resolved organization, which `handleRouteError` converts to HTTP 401.
 *
 * Use:
 *   const orgId = requireOrgId(req);   // type: number, never null
 *   await assertOwnsAgent(orgId, agentId);
 *   ...
 */
export function requireOrgId(req: Request): number {
  const orgId = getOrgId(req);
  if (orgId == null) throw new UnauthorizedTenantError();
  return orgId;
}

export class UnauthorizedTenantError extends Error {
  readonly httpStatus = 401 as const;
  readonly code = "UNAUTHORIZED" as const;
  constructor() {
    super("Authentication required");
    this.name = "UnauthorizedTenantError";
  }
}
