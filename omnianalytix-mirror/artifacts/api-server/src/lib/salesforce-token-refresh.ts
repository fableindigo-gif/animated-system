import { db, platformConnections } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";
import { decryptCredentials, encryptCredentials } from "./credential-helpers";

const CLIENT_ID = process.env.SALESFORCE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.SALESFORCE_CLIENT_SECRET ?? "";

export async function refreshSalesforceAccessToken(refreshToken: string, instanceUrl?: string): Promise<string> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Salesforce OAuth client credentials not configured (SALESFORCE_CLIENT_ID / SALESFORCE_CLIENT_SECRET).");
  }
  if (!refreshToken) {
    throw new Error("No refresh token available — user must re-authorize Salesforce.");
  }

  const loginDomain = process.env.SALESFORCE_LOGIN_DOMAIN ?? "login.salesforce.com";

  const resp = await fetch(`https://${loginDomain}/services/oauth2/token`, {
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
    logger.error({ err }, "Salesforce token refresh failed");
    throw new Error(`Salesforce token refresh failed: ${err}`);
  }

  const data = (await resp.json()) as { access_token?: string; error?: string };
  if (!data.access_token) {
    throw new Error(`Salesforce token refresh returned no access_token: ${JSON.stringify(data)}`);
  }

  return data.access_token;
}

export async function getFreshSalesforceCredentials(
  organizationId?: number | null,
): Promise<Record<string, string> | null> {
  const conditions = [eq(platformConnections.platform, "salesforce")];
  if (organizationId != null) conditions.push(eq(platformConnections.organizationId, organizationId));

  const rows = await db.select().from(platformConnections).where(and(...conditions));
  if (!rows.length || !rows[0].isActive) return null;

  const conn = rows[0];
  const rawCreds = conn.credentials as Record<string, string>;
  const creds = decryptCredentials(rawCreds);

  if (!creds.refreshToken) {
    logger.warn("No Salesforce refresh token stored — cannot refresh access token.");
    return creds;
  }

  try {
    const newAccessToken = await refreshSalesforceAccessToken(creds.refreshToken, creds.instanceUrl);
    const updatedCreds = { ...creds, accessToken: newAccessToken };

    await db
      .update(platformConnections)
      .set({ credentials: encryptCredentials(updatedCreds) })
      .where(eq(platformConnections.id, conn.id));

    logger.info("Salesforce access token refreshed and persisted.");
    return updatedCreds;
  } catch (err) {
    logger.warn({ err }, "Salesforce token refresh failed — falling back to stored access token.");
    return creds;
  }
}
