import { OAuth2Client } from "google-auth-library";
import { db, platformConnections } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";
import { decryptCredentials, encryptCredentials } from "./credential-helpers";
import {
  getGoogleOAuthClientCredentials,
  GoogleTokenRefreshError,
  safeRefreshErrorFields,
} from "./google-workspace-oauth";

export { GoogleTokenRefreshError } from "./google-workspace-oauth";

/**
 * Exchange a refresh token for a new access token via the typed
 * `OAuth2Client` from `google-auth-library`. Throws
 * `GoogleTokenRefreshError` on failure with only safe fields surfaced —
 * the raw provider response (which can echo refresh_token / id_token
 * material) is never logged.
 */
export async function refreshGoogleAccessToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = getGoogleOAuthClientCredentials();
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth client credentials not configured (GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET).");
  }
  if (!refreshToken) {
    throw new Error("No refresh token available — user must re-authorize.");
  }

  const client = new OAuth2Client({ clientId, clientSecret });
  client.setCredentials({ refresh_token: refreshToken });

  let credentials;
  try {
    ({ credentials } = await client.refreshAccessToken());
  } catch (err) {
    // SEC-07: Google's error response can echo the failing refresh_token /
    // id_token / authorization_code. Only structured safe fields are logged.
    const safe = safeRefreshErrorFields(err);
    logger.error(
      { status: safe.status, errorCode: safe.errorCode, errorDescription: safe.errorDescription },
      "Google token refresh failed",
    );
    throw new GoogleTokenRefreshError(safe);
  }

  if (!credentials.access_token) {
    // SEC-07: don't surface the entire response — it may contain other
    // sensitive token material (id_token, refresh_token if rotation enabled).
    throw new Error("Google token refresh returned no access_token");
  }

  return credentials.access_token;
}

/**
 * Load credentials for a Google platform from the DB, refresh the access token
 * using the stored refresh token, persist the new access token back to the DB,
 * and return the updated credentials ready for API calls.
 *
 * Returns null if the platform is not connected.
 */
export async function getFreshGoogleCredentials(
  platform: string,
  organizationId?: number | null,
): Promise<Record<string, string> | null> {
  const conditions = [eq(platformConnections.platform, platform)];
  if (organizationId != null) conditions.push(eq(platformConnections.organizationId, organizationId));

  const rows = await db
    .select()
    .from(platformConnections)
    .where(and(...conditions));

  if (!rows.length || !rows[0].isActive) return null;

  const conn = rows[0];
  const rawCreds = conn.credentials as Record<string, string>;
  const creds = decryptCredentials(rawCreds);

  if (!creds.refreshToken) {
    logger.warn({ platform }, "No refresh token stored — cannot refresh access token.");
    return creds;
  }

  try {
    const newAccessToken = await refreshGoogleAccessToken(creds.refreshToken);
    const updatedCreds = { ...creds, accessToken: newAccessToken };

    await db
      .update(platformConnections)
      .set({ credentials: encryptCredentials(updatedCreds) })
      .where(eq(platformConnections.id, conn.id));

    logger.info({ platform }, "Google access token refreshed and persisted.");
    return updatedCreds;
  } catch (err) {
    logger.warn({ platform, err }, "Token refresh failed — falling back to stored access token.");
    return creds;
  }
}

/**
 * Refresh all active Google platform connections at once and return a
 * credentialsByPlatform map with fresh access tokens.
 */
export async function buildFreshGoogleCredentialsMap(
  platforms: string[],
  allCreds: Record<string, Record<string, string>>,
  organizationId?: number | null,
): Promise<Record<string, Record<string, string>>> {
  const googlePlatforms = ["google_ads", "gmc", "gsc", "youtube", "google_sheets"];
  const result: Record<string, Record<string, string>> = { ...allCreds };

  await Promise.all(
    platforms
      .filter((p) => googlePlatforms.includes(p))
      .map(async (platform) => {
        const fresh = await getFreshGoogleCredentials(platform, organizationId);
        if (fresh) result[platform] = fresh;
      }),
  );

  return result;
}
