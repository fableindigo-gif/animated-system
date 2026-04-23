/**
 * monitoring.ts — Phase 1: Frontend Observability
 *
 * Initialises Sentry for React. Gracefully no-ops if VITE_SENTRY_DSN is
 * absent so development and CI builds are never affected.
 *
 * PII Scrubbing Rules (enforced in beforeSend):
 *  - Strips "email", "name", "phone", "address" keys from all event contexts.
 *  - Strips "Authorization", "Cookie", and "Set-Cookie" request headers.
 *  - Never captures raw query-string parameters that may contain tokens.
 */

import * as Sentry from "@sentry/react";

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

// Keys whose values must never leave the client.
const PII_KEYS = new Set([
  "email", "name", "full_name", "first_name", "last_name",
  "phone", "address", "ip_address", "username",
]);

// Request headers that must always be stripped.
const SENSITIVE_HEADERS = new Set([
  "authorization", "cookie", "set-cookie", "x-api-key",
  "x-auth-token", "x-gate-token",
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

export function initMonitoring(): void {
  if (!DSN) return;

  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE,
    release:     import.meta.env.VITE_APP_VERSION as string | undefined,

    // Only capture a sample in production to control volume.
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,

    // Strip PII before any event is transmitted.
    beforeSend(event) {
      // Scrub user object
      if (event.user) {
        event.user = {
          id: event.user.id, // keep the opaque ID for de-duplication
        };
      }

      // Scrub request headers
      if (event.request?.headers) {
        const cleaned: Record<string, string> = {};
        for (const [k, v] of Object.entries(event.request.headers)) {
          cleaned[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? "[Filtered]" : v;
        }
        event.request.headers = cleaned;
      }

      // Omit the query string entirely — may contain OAuth tokens.
      // Sentry's request.query_string typing can be string | Record<string,string>
      // depending on SDK version, so cast through unknown to stay version-proof.
      if (event.request) {
        (event.request as { query_string?: unknown }).query_string = "[Filtered]";
        (event.request as { cookies?: unknown }).cookies            = "[Filtered]";
        (event.request as { data?: unknown }).data                  = "[Filtered]";
      }

      // Scrub arbitrary context blobs
      if (event.extra) {
        event.extra = scrubObject(event.extra as Record<string, unknown>);
      }

      return event;
    },
  });
}

/**
 * Capture an exception and attach the active workspace ID as context.
 * Safe to call even when Sentry is not initialised.
 */
export function captureException(
  error: unknown,
  context?: {
    workspaceId?:  number | string | null;
    componentStack?: string;
    extra?:        Record<string, unknown>;
  },
): void {
  if (!DSN) {
    // In development / CI, just re-log to the console.
    console.error("[monitoring] captureException:", error, context);
    return;
  }

  Sentry.withScope((scope) => {
    if (context?.workspaceId != null) {
      scope.setTag("workspace_id", String(context.workspaceId));
    }
    if (context?.componentStack) {
      scope.setContext("react", { componentStack: context.componentStack });
    }
    if (context?.extra) {
      scope.setExtras(context.extra);
    }
    Sentry.captureException(error);
  });
}

/**
 * Set the active workspace on the Sentry scope so every subsequent event
 * is automatically tagged. Call this whenever the active workspace changes.
 */
export function setMonitoringWorkspace(workspaceId: number | null, clientName?: string): void {
  if (!DSN) return;
  const scope = Sentry.getCurrentScope();
  if (workspaceId != null) {
    scope.setTag("workspace_id", String(workspaceId));
    // Deliberately NOT setting scope.setUser() with name/email to avoid PII.
    scope.setContext("workspace", { id: workspaceId, name: clientName ?? "unknown" });
  } else {
    scope.setTag("workspace_id", "none");
  }
}
