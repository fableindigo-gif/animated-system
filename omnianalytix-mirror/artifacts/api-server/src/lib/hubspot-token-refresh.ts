import { db, platformConnections } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";
import { decryptCredentials, encryptCredentials } from "./credential-helpers";

const CLIENT_ID = process.env.HUBSPOT_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET ?? "";

export async function refreshHubSpotAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("HubSpot OAuth client credentials not configured (HUBSPOT_CLIENT_ID / HUBSPOT_CLIENT_SECRET).");
  }
  if (!refreshToken) {
    throw new Error("No refresh token available — user must re-authorize HubSpot.");
  }

  const resp = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    logger.error({ err }, "HubSpot token refresh failed");
    throw new Error(`HubSpot token refresh failed: ${err}`);
  }

  const data = (await resp.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!data.access_token) {
    throw new Error(`HubSpot token refresh returned no access_token: ${JSON.stringify(data)}`);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresIn: data.expires_in ?? 21600,
  };
}

export async function getFreshHubSpotCredentials(
  organizationId?: number | null,
): Promise<Record<string, string> | null> {
  const conditions = [eq(platformConnections.platform, "hubspot")];
  if (organizationId != null) conditions.push(eq(platformConnections.organizationId, organizationId));

  const rows = await db.select().from(platformConnections).where(and(...conditions));
  if (!rows.length || !rows[0].isActive) return null;

  const conn = rows[0];
  const rawCreds = conn.credentials as Record<string, string>;
  const creds = decryptCredentials(rawCreds);

  if (!creds.refreshToken) {
    logger.warn("No HubSpot refresh token stored — cannot refresh access token.");
    return creds;
  }

  const expiresAt = creds.expiresAt ? new Date(creds.expiresAt).getTime() : 0;
  if (Date.now() < expiresAt - 60_000) {
    return creds;
  }

  try {
    const refreshed = await refreshHubSpotAccessToken(creds.refreshToken);
    const updatedCreds: Record<string, string> = {
      ...creds,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
    };

    await db
      .update(platformConnections)
      .set({ credentials: encryptCredentials(updatedCreds) })
      .where(eq(platformConnections.id, conn.id));

    logger.info("HubSpot access token refreshed and persisted.");
    return updatedCreds;
  } catch (err) {
    logger.warn({ err }, "HubSpot token refresh failed — falling back to stored access token.");
    return creds;
  }
}
