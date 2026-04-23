/**
 * GAARF client factory
 *
 * Builds a GoogleAdsRestApiClient from credentials stored in platform_connections,
 * mapping our camelCase credential keys to the snake_case keys GAARF expects.
 */

import { GoogleAdsRestApiClient } from "google-ads-api-report-fetcher";
import { db, platformConnections } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { getFreshGoogleCredentials } from "../google-token-refresh";
import { decryptCredentials } from "../credential-helpers";

export interface GaarfClientBundle {
  client: InstanceType<typeof GoogleAdsRestApiClient>;
  customerId: string;
  loginCustomerId?: string;
}

/**
 * Resolve Google Ads credentials for an org and return a ready GAARF client.
 * Throws if no Google Ads connection is found or customerId is missing.
 */
export async function buildGaarfClient(orgId?: number | null): Promise<GaarfClientBundle> {
  const conditions = [eq(platformConnections.platform, "google_ads")];
  if (orgId != null) {
    conditions.push(eq(platformConnections.organizationId, orgId));
  } else {
    conditions.push(isNull(platformConnections.organizationId));
  }

  const rows = await db.select().from(platformConnections).where(and(...conditions));
  if (!rows.length) {
    throw new Error("No Google Ads connection found for this organisation.");
  }

  const creds =
    (await getFreshGoogleCredentials("google_ads", orgId ?? undefined)) ??
    decryptCredentials(rows[0].credentials as Record<string, string>);

  if (!creds.customerId) {
    throw new Error("Google Ads customer ID is not configured for this organisation.");
  }

  const developerToken =
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? creds.developerToken ?? "";
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET ?? "";

  if (!developerToken) {
    throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN is not configured.");
  }

  const customerId = creds.customerId.replace(/-/g, "");
  const loginCustomerId = creds.loginCustomerId
    ? creds.loginCustomerId.replace(/-/g, "")
    : undefined;

  const client = new GoogleAdsRestApiClient({
    developer_token: developerToken,
    client_id: clientId || undefined,
    client_secret: clientSecret || undefined,
    refresh_token: creds.refreshToken,
    login_customer_id: loginCustomerId,
    customer_id: customerId,
  });

  return { client, customerId, loginCustomerId };
}
