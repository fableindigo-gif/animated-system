import { Router } from "express";
import crypto from "crypto";
import { db, platformConnections } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { triggerBackgroundEtl } from "../etl";
import { getWorkspaceGoal } from "../../lib/warehouse-purge";
import { getOrgId } from "../../middleware/rbac";
import { verifyAnyToken } from "./gate";
import { encryptCredentials } from "../../lib/credential-helpers";

function extractOrgIdFromHeader(req: import("express").Request): number | null {
  const fromRbac = getOrgId(req);
  if (fromRbac) return fromRbac;
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const decoded = verifyAnyToken(auth.slice(7));
    if (decoded?.organizationId) return decoded.organizationId;
  }
  const cookieToken = (req as any).cookies?.omni_sso_token;
  if (cookieToken) {
    const decoded = verifyAnyToken(cookieToken);
    if (decoded?.organizationId) return decoded.organizationId;
  }
  return null;
}

const router = Router();

// TODO: Insert Client ID — register at https://api-console.zoho.com
const CLIENT_ID = process.env.ZOHO_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET ?? "";

const ZOHO_SCOPES = [
  "ZohoCRM.modules.ALL",
  "ZohoCRM.settings.ALL",
  "ZohoCRM.users.READ",
].join(",");

const pendingStates = new Map<string, { expiresAt: number; orgId: number | null }>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingStates.entries()) {
    if (v.expiresAt < now) pendingStates.delete(k);
  }
}, 10 * 60 * 1000);

function appDomain(req: { hostname: string }): string {
  if (process.env.APP_DOMAIN) return process.env.APP_DOMAIN;
  const replitDomains = (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const custom = replitDomains.find(
    (d) => !d.endsWith(".replit.app") && !d.endsWith(".repl.co"),
  );
  return custom ?? replitDomains[0] ?? req.hostname;
}

router.get("/start", (req, res) => {
  if (!CLIENT_ID) {
    res.status(503).json({ error: "ZOHO_CLIENT_ID is not configured." });
    return;
  }

  const orgId = extractOrgIdFromHeader(req);
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, { expiresAt: Date.now() + 10 * 60 * 1000, orgId });

  const domain = appDomain(req);
  const redirectUri = `https://${domain}/api/auth/zoho/callback`;

  const accountsDomain = process.env.ZOHO_ACCOUNTS_DOMAIN ?? "accounts.zoho.com";
  const url = new URL(`https://${accountsDomain}/oauth/v2/auth`);
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", ZOHO_SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");

  logger.info({ redirectUri }, "Starting Zoho CRM OAuth");
  res.redirect(url.toString());
});

router.get("/callback", async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;
  const domain = appDomain(req);
  const frontendBase = process.env.FRONTEND_BASE_PATH ?? "";

  const errorRedirect = (errCode: string) =>
    res.redirect(`https://${domain}${frontendBase}/connections?conn_error=${errCode}&conn_platform=zoho`);

  if (error) {
    logger.warn({ error }, "Zoho OAuth denied by user");
    errorRedirect(error === "access_denied" ? "access_denied" : "insufficient_permissions");
    return;
  }

  const pending = state ? pendingStates.get(state) : undefined;
  if (!state || !pending) {
    logger.warn({ state }, "Zoho OAuth: invalid or expired state");
    errorRedirect("internal_error");
    return;
  }
  const orgId = pending.orgId;
  pendingStates.delete(state);

  if (!code) {
    errorRedirect("access_denied");
    return;
  }

  try {
    const redirectUri = `https://${domain}/api/auth/zoho/callback`;
    const accountsDomain = process.env.ZOHO_ACCOUNTS_DOMAIN ?? "accounts.zoho.com";

    const tokenResp = await fetch(
      `https://${accountsDomain}/oauth/v2/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: redirectUri,
          code,
        }),
      },
    );

    if (!tokenResp.ok) {
      const err = await tokenResp.text();
      logger.error({ err }, "Zoho token exchange failed");
      errorRedirect("token_exchange_failed");
      return;
    }

    const tokens = (await tokenResp.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      api_domain?: string;
    };

    if (!tokens.access_token) {
      errorRedirect("token_exchange_failed");
      return;
    }

    const credentials: Record<string, string> = {
      accessToken: tokens.access_token,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      apiDomain: tokens.api_domain ?? "https://www.zohoapis.com",
    };
    if (tokens.refresh_token) {
      credentials.refreshToken = tokens.refresh_token;
    }

    const conditions = [eq(platformConnections.platform, "zoho")];
    conditions.push(orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId));

    const existing = await db
      .select()
      .from(platformConnections)
      .where(and(...conditions));

    if (existing.length > 0) {
      await db
        .update(platformConnections)
        .set({ credentials: encryptCredentials(credentials), isActive: true, displayName: "Zoho CRM", updatedAt: new Date() })
        .where(and(...conditions));
    } else {
      await db.insert(platformConnections).values({
        platform: "zoho",
        displayName: "Zoho CRM",
        credentials: encryptCredentials(credentials),
        isActive: true,
        ...(orgId != null ? { organizationId: orgId } : {}),
      });
    }

    logger.info("Zoho OAuth completed — connection stored");
    const wsGoal = await getWorkspaceGoal();
    triggerBackgroundEtl({ purgeGoal: wsGoal, orgId });

    res.redirect(`https://${domain}${frontendBase}/connections?zoho=connected`);
  } catch (err) {
    logger.error({ err }, "Zoho OAuth callback error");
    errorRedirect("internal_error");
  }
});

export default router;
