/**
 * requireSuperAdmin
 * ------------------
 * Platform-level middleware that sits ABOVE the standard agency RBAC system.
 * It verifies the bearer JWT and ensures the token carries role = "super_admin".
 *
 * A SUPER_ADMIN is not restricted to a single organizationId — their JWT may
 * contain organizationId: null. The role is set directly in team_members.role
 * in the database; the only way to elevate a user is via a direct DB update.
 *
 * Attach to any /api/platform/* router to enforce platform-level access.
 */

import type { Request, Response, NextFunction } from "express";
import { verifyAnyToken } from "../routes/auth/gate";
import { logger } from "../lib/logger";

export const SUPER_ADMIN_ROLE = "super_admin" as const;

export interface SuperAdminContext {
  memberId: number | null;
  email: string;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      superAdmin?: SuperAdminContext;
    }
  }
}

/**
 * Express middleware that gates access to platform-owner-only routes.
 * Requires a valid gate JWT with role === "super_admin".
 */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Platform access requires a valid authentication token.",
      code: "PLATFORM_AUTH_REQUIRED",
    });
    return;
  }

  const token = auth.slice(7);
  const payload = verifyAnyToken(token);

  if (!payload) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Invalid or expired token.",
      code: "PLATFORM_INVALID_TOKEN",
    });
    return;
  }

  if (payload.role !== SUPER_ADMIN_ROLE) {
    logger.warn(
      { role: payload.role, path: req.originalUrl },
      "Platform access denied — role is not super_admin",
    );
    res.status(403).json({
      error: "Forbidden",
      message: "This endpoint is restricted to platform owners.",
      code: "PLATFORM_FORBIDDEN",
    });
    return;
  }

  req.superAdmin = {
    memberId: payload.memberId ?? null,
    email: payload.email ?? "unknown",
    name: payload.name ?? "Platform Owner",
  };

  next();
}
