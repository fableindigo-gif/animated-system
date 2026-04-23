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

const CLIENT_ID = process.env.SALESFORCE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.SALESFORCE_CLIENT_SECRET ?? "";

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
    res.status(503).json({ error: "SALESFORCE_CLIENT_ID is not configured." });
    return;
  }

  const orgId = extractOrgIdFromHeader(req);
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, { expiresAt: Date.now() + 10 * 60 * 1000, orgId });

  const domain = appDomain(req);
  const redirectUri = `https://${domain}/api/auth/salesforce/callback`;

  const loginDomain = process.env.SALESFORCE_LOGIN_DOMAIN ?? "login.salesforce.com";

  const url = new URL(`https://${loginDomain}/services/oauth2/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "api refresh_token");
  url.searchParams.set("state", state);

  res.redirect(url.toString());
});

router.get("/callback", async (req, res) => {
  const { code, state } = req.query as Record<string, string>;
  const domain = appDomain(req);
  const frontendBase = process.env.FRONTEND_BASE_PATH ?? "";

  const errorRedirect = (errCode: string) => res.redirect(`https://${domain}${frontendBase}/connections?conn_error=${errCode}&conn_platform=salesforce`);

  const pending = state ? pendingStates.get(state) : undefined;
  if (!state || !pending) {
    logger.warn({ state }, "Salesforce OAuth: invalid or expired state");
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
    const redirectUri = `https://${domain}/api/auth/salesforce/callback`;
    const loginDomain = process.env.SALESFORCE_LOGIN_DOMAIN ?? "login.salesforce.com";

    const tokenResp = await fetch(
      `https://${loginDomain}/services/oauth2/token`,
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
      logger.error({ err }, "Salesforce token exchange failed");
      errorRedirect("token_exchange_failed");
      return;
    }

    const tokens = (await tokenResp.json()) as {
      access_token: string;
      refresh_token: string;
      instance_url: string;
      id: string;
    };

    const conditions = [eq(platformConnections.platform, "salesforce")];
    conditions.push(orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId));

    const existing = await db
      .select()
      .from(platformConnections)
      .where(and(...conditions));

    const credentials = encryptCredentials({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      instanceUrl: tokens.instance_url,
    });

    if (existing.length > 0) {
      await db
        .update(platformConnections)
        .set({
          credentials,
          isActive: true,
          displayName: "Salesforce CRM",
          updatedAt: new Date(),
        })
        .where(and(...conditions));
    } else {
      await db.insert(platformConnections).values({
        platform: "salesforce",
        displayName: "Salesforce CRM",
        credentials,
        isActive: true,
        ...(orgId != null ? { organizationId: orgId } : {}),
      });
    }

    logger.info(
      { instanceUrl: tokens.instance_url },
      "Salesforce OAuth completed — connection stored",
    );
    const wsGoal = await getWorkspaceGoal();
    triggerBackgroundEtl({ purgeGoal: wsGoal, orgId });

    res.redirect(
      `https://${domain}${frontendBase}/connections?salesforce=connected`,
    );
  } catch (err) {
    logger.error({ err }, "Salesforce OAuth callback error");
    errorRedirect("internal_error");
  }
});

export default router;
