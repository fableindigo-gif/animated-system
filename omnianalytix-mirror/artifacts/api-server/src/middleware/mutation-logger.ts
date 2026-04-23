import type { Request, Response, NextFunction } from "express";
import { db, auditLogs } from "@workspace/db";
import { logger } from "../lib/logger";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const SKIP_PATHS = [
  "/api/auth/",
  "/api/webhooks/",
];

function shouldSkip(path: string): boolean {
  return SKIP_PATHS.some((p) => path.startsWith(p));
}

export function mutationLogger() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!MUTATION_METHODS.has(req.method)) {
      next();
      return;
    }

    if (shouldSkip(req.originalUrl)) {
      next();
      return;
    }

    const startTime = Date.now();

    const originalEnd = res.end;
    const originalJson = res.json;

    let responseStatus = 0;
    let logged = false;

    function logMutation(statusCode: number) {
      if (logged) return;
      logged = true;
      const user = req.rbacUser;
      const durationMs = Date.now() - startTime;

      const orgId = req.rbacUser?.organizationId ?? req.jwtPayload?.organizationId ?? null;
      const entry = {
        organizationId: orgId ?? undefined,
        platform: "system",
        platformLabel: "Mutation Audit",
        toolName: `${req.method.toLowerCase()}_${req.originalUrl.split("?")[0].replace(/\//g, "_").replace(/^_api_/, "")}`,
        toolDisplayName: `${req.method} ${req.originalUrl.split("?")[0]}`,
        toolArgs: {
          method: req.method,
          path: req.originalUrl.split("?")[0],
          userId: user?.id ?? null,
          userName: user?.name ?? "unknown",
          userRole: user?.role ?? "none",
          authMethod: req.jwtPayload?.memberId ? "jwt" : req.headers["x-team-member-id"] ? "header" : "none",
          durationMs,
        },
        result: {
          success: statusCode < 400,
          message: statusCode < 400
            ? `${req.method} ${req.originalUrl.split("?")[0]} completed (${statusCode})`
            : `${req.method} ${req.originalUrl.split("?")[0]} failed (${statusCode})`,
          statusCode,
        },
        status: statusCode === 403 ? "forbidden" : statusCode < 400 ? "executed" : "failed",
      };

      db.insert(auditLogs).values(entry).catch((err: unknown) => {
        logger.error({ err }, "Mutation logger: failed to write audit log");
      });
    }

    res.json = function (this: typeof res, body?: unknown) {
      responseStatus = res.statusCode;
      logMutation(responseStatus);
      return originalJson.call(this, body);
    } as typeof res.json;

    res.end = function (this: typeof res, ...args: Parameters<typeof originalEnd>) {
      responseStatus = res.statusCode;
      logMutation(responseStatus);
      return originalEnd.apply(this, args);
    } as typeof res.end;

    next();
  };
}
