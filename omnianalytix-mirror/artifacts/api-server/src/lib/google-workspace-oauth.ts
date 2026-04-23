/**
 * Google Workspace OAuth helpers
 * ===============================
 * Centralizes OAuth client construction, scope definitions, and token refresh
 * for the Workspace connectors (Calendar · Drive · Docs) plus the broader
 * Google connection family that shares the same OAuth flow.
 *
 * The hand-rolled `fetch`-based authorization URL / token exchange / refresh
 * code is replaced by `google-auth-library`'s `OAuth2Client`, which:
 *   - emits a `tokens` event when access tokens are refreshed (so we can
 *     persist the rotated values back to the connection record),
 *   - is the typed object that `googleapis` service clients (Calendar, Drive,
 *     Docs) accept directly as their `auth` parameter.
 */
import { OAuth2Client } from "google-auth-library";
import type { Credentials } from "google-auth-library";
import { db, platformConnections } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { logger } from "./logger";
import { decryptCredentials, encryptCredentials } from "./credential-helpers";

// ─── Scope catalog ──────────────────────────────────────────────────────────
// One source of truth for Workspace connector scopes. Used both when building
// the consent URL and when reasoning about what a stored connection can do.
export const WORKSPACE_SCOPES = {
  google_calendar: ["https://www.googleapis.com/auth/calendar.events"],
  google_drive: ["https://www.googleapis.com/auth/drive.readonly"],
  google_docs: ["https://www.googleapis.com/auth/documents.readonly"],
} as const;

export type WorkspacePlatform = keyof typeof WORKSPACE_SCOPES;

export const WORKSPACE_PLATFORMS = Object.keys(WORKSPACE_SCOPES) as WorkspacePlatform[];

export function isWorkspacePlatform(p: string): p is WorkspacePlatform {
  return (WORKSPACE_PLATFORMS as readonly string[]).includes(p);
}

export function workspaceScopesFor(platform: WorkspacePlatform): readonly string[] {
  return WORKSPACE_SCOPES[platform];
}

export function allWorkspaceScopes(): string[] {
  return Object.values(WORKSPACE_SCOPES).flat();
}

// ─── Client credentials (single lookup point) ───────────────────────────────
export interface GoogleOAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

export function getGoogleOAuthClientCredentials(): GoogleOAuthClientCredentials {
  return {
    clientId: process.env.GOOGLE_ADS_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET ?? "",
  };
}

export function googleOAuthClientConfigured(): boolean {
  const { clientId, clientSecret } = getGoogleOAuthClientCredentials();
  return !!clientId && !!clientSecret;
}

export function buildGoogleRedirectUri(domain: string): string {
  return `https://${domain}/api/auth/google/callback`;
}

/**
 * Build a fresh `OAuth2Client` for the consent / code-exchange leg of the
 * flow. Throws if the OAuth client credentials are not configured.
 */
export function createGoogleOAuth2Client(redirectUri: string): OAuth2Client {
  const { clientId, clientSecret } = getGoogleOAuthClientCredentials();
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google OAuth client credentials not configured (GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET).",
    );
  }
  return new OAuth2Client({ clientId, clientSecret, redirectUri });
}

// ─── Safe error reporting ───────────────────────────────────────────────────
// Google's error responses can echo the failing refresh_token / id_token /
// authorization_code in the body. We must extract only the documented safe
// fields and never log the raw response.
export interface RefreshErrorFields {
  status?: number;
  errorCode: string;
  errorDescription: string;
}

export function safeRefreshErrorFields(err: unknown): RefreshErrorFields {
  let status: number | undefined;
  let errorCode = "unknown_error";
  let errorDescription = "(no description)";

  if (err && typeof err === "object") {
    const anyErr = err as {
      response?: { status?: number; data?: unknown };
      status?: number;
      code?: number | string;
    };

    if (typeof anyErr.response?.status === "number") status = anyErr.response.status;
    else if (typeof anyErr.status === "number") status = anyErr.status;
    else if (typeof anyErr.code === "number") status = anyErr.code;

    const data = anyErr.response?.data;
    if (data && typeof data === "object") {
      const d = data as { error?: unknown; error_description?: unknown };
      if (typeof d.error === "string") errorCode = d.error;
      if (typeof d.error_description === "string") errorDescription = d.error_description;
    }
  }

  return { status, errorCode, errorDescription };
}

export class GoogleTokenRefreshError extends Error {
  readonly status?: number;
  readonly errorCode: string;
  constructor(fields: RefreshErrorFields) {
    super(`Google token refresh failed (${fields.status ?? "?"}): ${fields.errorCode}`);
    this.name = "GoogleTokenRefreshError";
    this.status = fields.status;
    this.errorCode = fields.errorCode;
  }
}

// ─── Stored-connection → OAuth2Client ───────────────────────────────────────
async function loadConnection(platform: string, organizationId?: number | null) {
  const where = and(
    eq(platformConnections.platform, platform),
    organizationId != null
      ? eq(platformConnections.organizationId, organizationId)
      : isNull(platformConnections.organizationId),
  );
  const rows = await db.select().from(platformConnections).where(where);
  if (!rows.length || !rows[0].isActive) return null;
  return rows[0];
}

async function persistRotatedTokens(
  connectionId: number,
  current: Record<string, string>,
  tokens: Credentials,
): Promise<void> {
  if (!tokens.access_token) return;

  // Mutate `current` in place so subsequent `tokens` events see the latest
  // refresh_token. If we rebuilt from a frozen snapshot, a later event that
  // only carries `access_token` would silently overwrite a previously
  // rotated refresh_token with the stale original — breaking refresh.
  current.accessToken = tokens.access_token;
  if (tokens.refresh_token) current.refreshToken = tokens.refresh_token;

  await db
    .update(platformConnections)
    .set({ credentials: encryptCredentials({ ...current }), updatedAt: new Date() })
    .where(eq(platformConnections.id, connectionId));
}

export interface AuthorizedClient {
  client: OAuth2Client;
  connectionId: number;
  credentials: Record<string, string>;
}

/**
 * Returns an `OAuth2Client` preloaded with the stored token pair for a given
 * Google connection. The client auto-refreshes access tokens on demand;
 * rotated tokens are persisted back to the connection record via the
 * `tokens` event.
 *
 * Returns `null` if there is no active connection. Throws
 * `GoogleTokenRefreshError`-style failures upward only when the caller
 * actually exercises the client (e.g. on the first API call).
 */
export async function getAuthorizedGoogleClient(
  platform: string,
  organizationId?: number | null,
): Promise<AuthorizedClient | null> {
  const conn = await loadConnection(platform, organizationId);
  if (!conn) return null;

  const creds = decryptCredentials(conn.credentials as Record<string, string>);
  if (!creds.refreshToken) {
    logger.warn({ platform, connectionId: conn.id }, "No refresh token stored — cannot build authorized client.");
    return null;
  }

  const { clientId, clientSecret } = getGoogleOAuthClientCredentials();
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth client credentials not configured.");
  }

  const client = new OAuth2Client({ clientId, clientSecret });
  client.setCredentials({
    access_token: creds.accessToken || undefined,
    refresh_token: creds.refreshToken,
  });

  client.on("tokens", (tokens) => {
    void persistRotatedTokens(conn.id, creds, tokens).catch((err) => {
      logger.warn(
        { err, platform, connectionId: conn.id },
        "Failed to persist refreshed Google tokens",
      );
    });
  });

  return { client, connectionId: conn.id, credentials: creds };
}

// ─── Connection health probe ────────────────────────────────────────────────
// Forces a refresh round-trip so the UI can flag connections whose stored
// refresh_token has been revoked / expired before the user hits a 502 on a
// real Calendar / Drive / Docs call. Routes through `getAuthorizedGoogleClient`
// so a successful probe also persists any rotated tokens via the same `tokens`
// event listener that real API calls use.
export type GoogleConnectionHealth =
  | { status: "not_connected" }
  | { status: "healthy" }
  | { status: "needs_reconnect"; errorCode: string; httpStatus?: number };

export async function probeGoogleConnectionHealth(
  platform: string,
  organizationId?: number | null,
): Promise<GoogleConnectionHealth> {
  const authorized = await getAuthorizedGoogleClient(platform, organizationId);
  if (!authorized) return { status: "not_connected" };

  try {
    await authorized.client.refreshAccessToken();
    return { status: "healthy" };
  } catch (err) {
    const safe = safeRefreshErrorFields(err);
    logger.warn(
      { platform, status: safe.status, errorCode: safe.errorCode },
      "Google connection health probe failed",
    );
    return { status: "needs_reconnect", errorCode: safe.errorCode, httpStatus: safe.status };
  }
}
