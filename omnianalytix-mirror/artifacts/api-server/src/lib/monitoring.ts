/**
 * monitoring.ts — Phase 1: Backend Observability
 *
 * Initialises Sentry for Node/Express. Gracefully no-ops when SENTRY_DSN is
 * absent so local development and CI pipelines are never impacted.
 *
 * PII Scrubbing:
 *  - Strips email, name, phone from all event contexts.
 *  - Strips Authorization, Cookie, and X-* auth headers from request payloads.
 *  - Strips request body and cookies entirely (may contain credentials).
 */

import * as Sentry from "@sentry/node";
import type { Express, Request, Response, NextFunction } from "express";

const DSN = process.env.SENTRY_DSN;

const PII_KEYS = new Set([
  "email", "name", "full_name", "first_name", "last_name",
  "phone", "address", "ip_address", "username", "password",
]);

const SENSITIVE_HEADERS = new Set([
  "authorization", "cookie", "set-cookie",
  "x-api-key", "x-auth-token", "x-gate-token",
]);

function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (PII_KEYS.has(k.toLowerCase())) {
      out[k] = "[Filtered]";
    } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      out[k] = scrubObject(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function initSentry(): void {
  if (!DSN) return;

  Sentry.init({
    dsn:         DSN,
    environment: process.env.NODE_ENV ?? "development",
    release:     process.env.APP_VERSION,

    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.05 : 1.0,

    beforeSend(event) {
      // Wipe user object — keep only opaque ID
      if (event.user) {
        event.user = { id: event.user.id };
      }

      // Strip sensitive request fields. Sentry's request typing varies by
      // SDK version — funnel through unknown to stay version-proof.
      if (event.request) {
        (event.request as { data?: unknown }).data       = "[Filtered]";
        (event.request as { cookies?: unknown }).cookies = "[Filtered]";

        if (event.request.headers) {
          const cleaned: Record<string, string> = {};
          for (const [k, v] of Object.entries(event.request.headers as Record<string, unknown>)) {
            cleaned[k] = SENSITIVE_HEADERS.has(k.toLowerCase())
              ? "[Filtered]"
              : String(v);
          }
          event.request.headers = cleaned;
        }

        // Strip query string — may contain OAuth state tokens
        event.request.query_string = "[Filtered]";
      }

      // Scrub arbitrary extra context
      if (event.extra) {
        event.extra = scrubObject(event.extra as Record<string, unknown>);
      }

      return event;
    },
  });
}

/**
 * Attach Sentry request-handler middleware BEFORE all other routes.
 * Only registers middleware when Sentry is initialised.
 */
export function attachSentryRequestHandler(app: Express): void {
  if (!DSN) return;
  app.use(Sentry.Handlers.requestHandler());
}

/**
 * Attach Sentry error-handler middleware AFTER all routes, BEFORE the
 * custom global error handler.  Sentry must intercept first so it can
 * record the original error before we reformat the response.
 */
export function attachSentryErrorHandler(app: Express): void {
  if (!DSN) return;
  app.use(Sentry.Handlers.errorHandler());
}

/**
 * Manually capture a server-side exception with optional workspace context.
 * Safe to call when Sentry is uninitialised.
 */
export function captureServerException(
  error: unknown,
  context?: { workspaceId?: number | null; userId?: number | null; extra?: Record<string, unknown> },
): void {
  if (!DSN) return;

  Sentry.withScope((scope) => {
    if (context?.workspaceId != null) scope.setTag("workspace_id", String(context.workspaceId));
    if (context?.userId      != null) scope.setTag("user_id",      String(context.userId));
    if (context?.extra) scope.setExtras(context.extra);
    Sentry.captureException(error);
  });
}

// Re-export for convenience so callers don't need to import @sentry/node directly
export { Sentry };
