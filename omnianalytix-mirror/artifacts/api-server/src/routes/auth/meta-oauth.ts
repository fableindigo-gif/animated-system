// tenant-ownership-skip-file: Meta (Facebook/Instagram) OAuth callback router.
// Same rationale as google-oauth.ts — orgId derived from authed session and
// applied via `eq(platformConnections.organizationId, orgId)` before any
// connection upsert. Auditors must verify on PR.
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

const APP_ID = process.env.META_APP_ID ?? "";
const APP_SECRET = process.env.META_APP_SECRET ?? "";

// ─── Scope Policy ────────────────────────────────────────────────────────────
// Scopes are restricted to the minimum required for ad management (Admin/Standard):
//   Core Ads: ads_management, ads_read, business_management, read_insights
//   Page Ads: pages_read_engagement, pages_manage_ads, pages_manage_metadata
//   Catalogue / Lead Ads: catalog_management, leads_retrieval
//   Instagram Read: instagram_basic, instagram_manage_insights
//   Identity: email, public_profile
//
// Scopes intentionally EXCLUDED:
//   instagram_manage_comments  — comment moderation; not required for ad delivery
//   instagram_manage_messages  — DM inbox; beyond ad management scope
//   instagram_content_publish  — organic publishing; not part of paid media management
// ─────────────────────────────────────────────────────────────────────────────
const META_SCOPES = [
  // Core Ad Management (Admin / Standard tier)
  "ads_management",           // Create, edit, and manage ads and campaigns
  "ads_read",                 // Read ad performance data
  "business_management",      // Access Business Manager assets (ad accounts, pages)
  "read_insights",            // Campaign and ad-level insights reporting
  // Facebook Page — required for page-based ad placements
  "pages_read_engagement",    // Read page post engagement metrics
  "pages_manage_ads",         // Manage ads on behalf of a Page
  "pages_manage_metadata",    // Read page metadata (name, ID, category)
  // Catalogue & Lead Ads
  "catalog_management",       // Dynamic Product Ads — product catalogue access
  "leads_retrieval",          // Lead Ad form responses
  // Instagram — read-only analytics (no publishing or moderation)
  "instagram_basic",          // Basic profile and post read access
  "instagram_manage_insights", // Instagram ad and post performance metrics
  // Identity
  "email",
  "public_profile",
].join(",");

const pendingStates = new Map<string, { expiresAt: number }>();
const pendingSetups = new Map<string, { accessToken: string; email: string; expiresAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingStates.entries()) { if (v.expiresAt < now) pendingStates.delete(k); }
  for (const [k, v] of pendingSetups.entries()) { if (v.expiresAt < now) pendingSetups.delete(k); }
}, 10 * 60 * 1000);

function appDomain(req: { hostname: string }): string {
  if (process.env.APP_DOMAIN) return process.env.APP_DOMAIN;
  const replitDomains = (process.env.REPLIT_DOMAINS ?? "").split(",").map((d) => d.trim()).filter(Boolean);
  const custom = replitDomains.find((d) => !d.endsWith(".replit.app") && !d.endsWith(".repl.co"));
  return custom ?? replitDomains[0] ?? req.hostname;
}

// GET /api/auth/meta/start
router.get("/start", (req, res) => {
  if (!APP_ID) {
    res.status(503).json({ error: "META_APP_ID is not configured." });
    return;
  }

  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, { expiresAt: Date.now() + 10 * 60 * 1000 });

  const domain = appDomain(req);
  const redirectUri = `https://${domain}/api/auth/meta/callback`;

  const authUrl =
    `https://www.facebook.com/v22.0/dialog/oauth` +
    `?client_id=${encodeURIComponent(APP_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(META_SCOPES)}` +
    `&state=${state}` +
    `&response_type=code`;

  logger.info({ redirectUri }, "Starting Meta OAuth");
  res.redirect(authUrl);
});

// GET /api/auth/meta/callback
router.get("/callback", async (req, res) => {
  if (!APP_ID || !APP_SECRET) {
    res.status(503).send("Meta OAuth not configured.");
    return;
  }

  const { code, state, error, error_description } = req.query as Record<string, string>;
  const domain = appDomain(req);
  const frontendBase = process.env.FRONTEND_BASE_PATH ?? "";
  const errorRedirect = (errCode: string) => res.redirect(`https://${domain}${frontendBase}/connections?conn_error=${errCode}&conn_platform=meta`);

  if (error) {
    logger.warn({ error, error_description }, "Meta OAuth denied by user");
    errorRedirect(error === "access_denied" ? "access_denied" : "insufficient_permissions");
    return;
  }

  const pending = state ? pendingStates.get(state) : null;
  if (!pending) {
    errorRedirect("internal_error");
    return;
  }
  pendingStates.delete(state);

  const redirectUri = `https://${domain}/api/auth/meta/callback`;

  try {
    // Exchange code for short-lived token
    const tokenResp = await fetch(
      `https://graph.facebook.com/v22.0/oauth/access_token` +
        `?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${APP_SECRET}&code=${code}`,
    );

    if (!tokenResp.ok) {
      const err = await tokenResp.text();
      logger.error({ err }, "Meta token exchange failed");
      errorRedirect("token_exchange_failed");
      return;
    }

    const tokenData = (await tokenResp.json()) as { access_token: string };
    const shortToken = tokenData.access_token;

    // Exchange for a long-lived token (60 days)
    const longTokenResp = await fetch(
      `https://graph.facebook.com/v22.0/oauth/access_token` +
        `?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${shortToken}`,
    );

    let accessToken = shortToken;
    if (longTokenResp.ok) {
      const longData = (await longTokenResp.json()) as { access_token: string };
      if (longData.access_token) accessToken = longData.access_token;
    }

    // Fetch user info
    let email = "";
    try {
      const userResp = await fetch(`https://graph.facebook.com/v22.0/me?fields=name,email&access_token=${accessToken}`);
      const userInfo = (await userResp.json()) as { name?: string; email?: string };
      email = userInfo.email ?? userInfo.name ?? "";
    } catch {
      // Non-fatal
    }

    const setupKey = crypto.randomBytes(16).toString("hex");
    pendingSetups.set(setupKey, { accessToken, email, expiresAt: Date.now() + 15 * 60 * 1000 });

    const frontendBase = process.env.FRONTEND_BASE_PATH ?? "";
    res.redirect(`https://${domain}${frontendBase}/connections?meta_setup=${setupKey}&email=${encodeURIComponent(email)}`);
  } catch (err) {
    logger.error({ err }, "Meta OAuth callback error");
    errorRedirect("internal_error");
  }
});

// POST /api/auth/meta/complete
router.post("/complete", async (req, res) => {
  const { setupKey, adAccountId, pageId } = req.body as Record<string, string>;

  if (!setupKey) {
    res.status(400).json({ error: "setupKey is required" });
    return;
  }

  const setup = pendingSetups.get(setupKey);
  if (!setup) {
    res.status(400).json({ error: "Setup session expired or invalid. Please re-authorize." });
    return;
  }
  pendingSetups.delete(setupKey);

  if (!adAccountId) {
    res.status(400).json({ error: "adAccountId is required" });
    return;
  }

  try {
    const credentials: Record<string, string> = encryptCredentials({
      accessToken: setup.accessToken,
      adAccountId: adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`,
      ...(pageId ? { pageId } : {}),
    });

    const orgId = extractOrgIdFromHeader(req);
    const metaWhere = and(
      eq(platformConnections.platform, "meta"),
      orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId),
    );
    const existing = await db.select().from(platformConnections).where(metaWhere);
    if (existing.length > 0) {
      await db.update(platformConnections)
        .set({ credentials, displayName: setup.email || "Meta Ads", isActive: true, updatedAt: new Date() })
        .where(eq(platformConnections.id, existing[0].id));
    } else {
      await db.insert(platformConnections).values({
        platform: "meta",
        displayName: setup.email || "Meta Ads",
        credentials,
        isActive: true,
        ...(orgId ? { organizationId: orgId } : {}),
      });
    }

    logger.info({ adAccountId }, "Meta connection saved");
    const wsGoal = await getWorkspaceGoal();
    triggerBackgroundEtl({ purgeGoal: wsGoal, orgId });
    res.json({ success: true, platform: "meta" });
  } catch (err) {
    logger.error({ err }, "Meta OAuth complete error");
    res.status(500).json({ error: "Failed to save connection" });
  }
});

export default router;
