import type { Request, Response, NextFunction } from "express";
import { db, platformConnections } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getOrgId } from "./rbac";

export function requireActiveConnection() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = getOrgId(req);
      const orgFilter = orgId != null
        ? eq(platformConnections.organizationId, orgId)
        : isNull(platformConnections.organizationId);

      const rows = await db
        .select({ id: platformConnections.id })
        .from(platformConnections)
        .where(and(eq(platformConnections.isActive, true), orgFilter))
        .limit(1);

      if (rows.length === 0) {
        res.status(403).json({
          error: "No active connections",
          message: "At least one active platform connection is required to access this data. Please connect a platform first.",
          code: "NO_ACTIVE_CONNECTION",
        });
        return;
      }

      next();
    } catch (err) {
      logger.error({ err }, "connection-guard: failed to check platform connections");
      next();
    }
  };
}
