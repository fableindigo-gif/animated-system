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

// TODO: Insert Client ID — register at https://ads.microsoft.com
const CLIENT_ID = process.env.BING_ADS_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.BING_ADS_CLIENT_SECRET ?? "";

const BING_SCOPES = "https://ads.microsoft.com/msads.manage offline_access";

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
    res.status(503).json({ error: "BING_ADS_CLIENT_ID is not configured." });
    return;
  }

  const orgId = extractOrgIdFromHeader(req);
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, { expiresAt: Date.now() + 10 * 60 * 1000, orgId });

  const domain = appDomain(req);
  const redirectUri = `https://${domain}/api/auth/bing/callback`;

  const url = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", BING_SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "consent");

  logger.info({ redirectUri }, "Starting Bing Ads OAuth");
  res.redirect(url.toString());
});

router.get("/callback", async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;
  const domain = appDomain(req);
  const frontendBase = process.env.FRONTEND_BASE_PATH ?? "";

  const errorRedirect = (errCode: string) =>
    res.redirect(`https://${domain}${frontendBase}/connections?conn_error=${errCode}&conn_platform=bing_ads`);

  if (error) {
    logger.warn({ error }, "Bing Ads OAuth denied by user");
    errorRedirect(error === "access_denied" ? "access_denied" : "insufficient_permissions");
    return;
  }

  const pending = state ? pendingStates.get(state) : undefined;
  if (!state || !pending) {
    logger.warn({ state }, "Bing Ads OAuth: invalid or expired state");
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
    const redirectUri = `https://${domain}/api/auth/bing/callback`;

    const tokenResp = await fetch(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: CLIENT_ID,
          ...(CLIENT_SECRET ? { client_secret: CLIENT_SECRET } : {}),
          redirect_uri: redirectUri,
          code,
          scope: BING_SCOPES,
        }),
      },
    );

    if (!tokenResp.ok) {
      const err = await tokenResp.text();
      logger.error({ err }, "Bing Ads token exchange failed");
      errorRedirect("token_exchange_failed");
      return;
    }

    const tokens = (await tokenResp.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    if (!tokens.access_token) {
      errorRedirect("token_exchange_failed");
      return;
    }

    const credentials = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    };

    const conditions = [eq(platformConnections.platform, "bing_ads")];
    conditions.push(orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId));

    const existing = await db
      .select()
      .from(platformConnections)
      .where(and(...conditions));

    if (existing.length > 0) {
      await db
        .update(platformConnections)
        .set({ credentials: encryptCredentials(credentials), isActive: true, displayName: "Bing Ads (Microsoft)", updatedAt: new Date() })
        .where(and(...conditions));
    } else {
      await db.insert(platformConnections).values({
        platform: "bing_ads",
        displayName: "Bing Ads (Microsoft)",
        credentials: encryptCredentials(credentials),
        isActive: true,
        ...(orgId != null ? { organizationId: orgId } : {}),
      });
    }

    logger.info("Bing Ads OAuth completed — connection stored");
    const wsGoal = await getWorkspaceGoal();
    triggerBackgroundEtl({ purgeGoal: wsGoal, orgId });

    res.redirect(`https://${domain}${frontendBase}/connections?bing_ads=connected`);
  } catch (err) {
    logger.error({ err }, "Bing Ads OAuth callback error");
    errorRedirect("internal_error");
  }
});

export default router;
