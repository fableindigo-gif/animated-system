import type express from "express";
import { logger } from "./logger";
import { getOrgId } from "../middleware/rbac";
import { TenantOwnershipError } from "./tenant-guards";
import { UnauthorizedTenantError } from "../middleware/rbac";

/**
 * PII-safe email mask: `alice@example.com` → `a***@example.com`.
 * Returns `null` when the input is missing/falsy. Used to keep raw email
 * addresses out of info-level audit logs that may be exported to third-party
 * sinks (Datadog, Sentry, etc.) without strict per-field RBAC.
 */
function maskEmail(email: string | null | undefined): string | null {
  if (!email || typeof email !== "string") return null;
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local  = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head   = local[0] ?? "*";
  return `${head}***@${domain}`;
}

/**
 * Standard error responder for Express route handlers.
 *
 * Replaces the (very common, very dangerous) pattern of:
 *
 *   } catch (err) {
 *     res.status(500).json({ error: "..." });   // silently swallows the bug
 *   }
 *
 * Every silent catch becomes a bug factory: the user sees a 500, the deployment
 * log shows pino-http's "request errored" wrapper but no stack, and the actual
 * exception is gone forever. This helper guarantees that every 500 returned
 * from a route is paired with a structured error log carrying enough context
 * (route, method, orgId, query, params, full stack) to root-cause it without
 * needing a second deploy to "add some logging".
 *
 * Usage:
 *
 *   } catch (err) {
 *     return handleRouteError(err, req, res, "GET /api/warehouse/kpis", {
 *       error:  "Failed to compute warehouse KPIs",
 *       detail: "An unexpected error occurred",
 *     });
 *   }
 *
 * If `body` is omitted, returns the default `{ error, code: "INTERNAL_ERROR" }`.
 * If the response has already been sent (e.g. error during streaming), only logs.
 */
export function handleRouteError(
  err: unknown,
  req: express.Request,
  res: express.Response,
  route: string,
  body?: { error: string; detail?: string; code?: string; status?: number },
): void {
  // Auth + tenant ownership failures are EXPECTED control flow, not server
  // bugs. We log them at info level (audit trail) instead of error level
  // (would pollute Sentry / on-call dashboards), and always return 404 for
  // ownership rejections — never 403 — so we don't reveal whether the
  // resource exists in some other tenant.
  if (err instanceof UnauthorizedTenantError) {
    logger.info(
      {
        route,
        method:    req.method,
        path:      req.originalUrl,
        ip:        req.ip,
        userId:    req.rbacUser?.id ?? null,
        // Email is masked (`a***@domain.tld`) at info level. Forensics
        // tooling that joins by userId can still resolve the full address
        // from `team_members`; raw email never appears in third-party log
        // sinks (Datadog/Sentry/etc).
        userEmail: maskEmail(req.rbacUser?.email),
        // Token-derived identity (useful when the principal exists in JWT
        // but no rbacUser was hydrated — e.g. orphaned/revoked membership).
        tokenMemberId: req.jwtPayload?.memberId ?? null,
        tokenEmail:    maskEmail(req.jwtPayload?.email),
      },
      `${route} → unauthorized (no tenant)`,
    );
    if (res.headersSent) return;
    res.status(err.httpStatus).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof TenantOwnershipError) {
    logger.info(
      {
        route,
        method:    req.method,
        path:      req.originalUrl,
        ip:        req.ip,
        orgId:     safeOrgId(req),
        userId:    req.rbacUser?.id ?? null,
        userEmail: maskEmail(req.rbacUser?.email),
        userRole:  req.rbacUser?.role ?? null,
        resource:  err.resource,
        // Forensic value: which id did they probe? Repeated 404s with
        // sequential ids look like enumeration; a single mistyped id does not.
        attemptedResourceId: err.id,
      },
      `${route} → tenant ownership rejected`,
    );
    if (res.headersSent) return;
    res.status(err.httpStatus).json({ error: err.message, code: err.code });
    return;
  }

  const e = err as { message?: string; code?: string | number; stack?: string };
  logger.error(
    {
      err: {
        message: e?.message,
        code: e?.code,
        stack: e?.stack?.slice(0, 2000),
      },
      orgId: safeOrgId(req),
      route,
      method: req.method,
      query: req.query,
      params: req.params,
    },
    `${route} handler failed`,
  );

  if (res.headersSent) return;

  const status = body?.status ?? 500;
  res.status(status).json({
    error: body?.error ?? "Internal server error",
    detail: body?.detail,
    code: body?.code ?? "INTERNAL_ERROR",
  });
}

/**
 * Async route wrapper — converts thrown errors into handleRouteError calls
 * automatically. Use this for new routes so the catch block can be omitted
 * entirely:
 *
 *   router.get("/foo", wrapRoute("GET /api/foo", async (req, res) => {
 *     const data = await mayThrow();
 *     res.json(data);
 *   }));
 */
export function wrapRoute(
  route: string,
  handler: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<unknown>,
  errorBody?: { error: string; detail?: string; code?: string },
) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      handleRouteError(err, req, res, route, errorBody);
    }
  };
}

function safeOrgId(req: express.Request): number | null {
  try {
    return getOrgId(req);
  } catch {
    return null;
  }
}
