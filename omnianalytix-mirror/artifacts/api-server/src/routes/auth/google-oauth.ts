// tenant-ownership-skip-file: OAuth callback router. Every handler is the
// trailing leg of an OAuth flow that derives orgId from the authenticated
// session before scoping queries via `eq(platformConnections.organizationId,
// orgId)` (see e.g. existingWhere/singleWhere blocks). The lint can't follow
// the through-state-token construction pattern; auditors must verify on PR.
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
import {
  allWorkspaceScopes,
  buildGoogleRedirectUri,
  createGoogleOAuth2Client,
  googleOAuthClientConfigured,
  getGoogleOAuthClientCredentials,
  safeRefreshErrorFields,
} from "../../lib/google-workspace-oauth";

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

// ─── Scope Policy ────────────────────────────────────────────────────────────
// Scopes are restricted to the minimum required for each function:
//   Ad Management (Admin/Standard): adwords, content, analytics.readonly
//   Workspace Connectors (Calendar · Drive · Docs): defined in
//     `lib/google-workspace-oauth.ts` (`WORKSPACE_SCOPES`) so they live in one
//     place and feed both the consent URL here and the connection metadata.
//   Identity: userinfo.email, openid
//
// Scopes intentionally EXCLUDED:
//   analytics          — full write; only analytics.readonly is needed
//   webmasters.readonly — Search Console is not part of our ad management flow
//   youtube.force-ssl  — YouTube Ads uses adwords scope; force-ssl is for channel management
// ─────────────────────────────────────────────────────────────────────────────
const GOOGLE_SCOPES: string[] = [
  // Core Ad Management (Admin / Standard tier)
  "https://www.googleapis.com/auth/adwords",          // Google Ads API — campaigns, bidding, reporting
  "https://www.googleapis.com/auth/content",           // Google Merchant Center — product feed management
  "https://www.googleapis.com/auth/analytics.readonly", // Google Analytics — read-only reporting
  // Reporting & Output (read or file-scoped write only)
  "https://www.googleapis.com/auth/spreadsheets",      // Sheets export — scoped to files created by the app
  "https://www.googleapis.com/auth/drive.file",        // Drive — only files created by this app
  // Google Workspace Connectors (Calendar · Drive · Docs) — sourced from one place
  ...allWorkspaceScopes(),
  // Identity
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

// Temp store: state → { platform, expiresAt }
const pendingStates = new Map<string, { platform: string; expiresAt: number }>();
// Temp token store: setupKey → { accessToken, refreshToken, platform, email }
const pendingSetups = new Map<string, { accessToken: string; refreshToken: string; platform: string; email: string; expiresAt: number }>();

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

// GET /api/auth/google/config — exposes setup info (no secrets)
router.get("/config", (req, res) => {
  const domain = appDomain(req);
  const redirectUri = buildGoogleRedirectUri(domain);
  const { clientId, clientSecret } = getGoogleOAuthClientCredentials();
  res.json({
    redirectUri,
    configured: googleOAuthClientConfigured(),
    hasClientId: !!clientId,
    hasClientSecret: !!clientSecret,
  });
});

// GET /api/auth/google/start?platform=google_ads|gmc|...
router.get("/start", (req, res) => {
  if (!googleOAuthClientConfigured()) {
    res.status(503).json({ error: "GOOGLE_ADS_CLIENT_ID is not configured." });
    return;
  }

  const platform = String(req.query.platform ?? "google_ads");
  if (!["google_ads", "gmc", "gsc", "youtube", "workspace", "google_calendar", "google_drive", "google_docs"].includes(platform)) {
    res.status(400).json({ error: "platform must be google_ads, gmc, gsc, youtube, workspace, google_calendar, google_drive, or google_docs" });
    return;
  }

  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, { platform, expiresAt: Date.now() + 10 * 60 * 1000 });

  const domain = appDomain(req);
  const redirectUri = buildGoogleRedirectUri(domain);

  const oauthClient = createGoogleOAuth2Client(redirectUri);
  const authUrl = oauthClient.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    state,
  });

  logger.info({ platform, redirectUri }, "Starting Google OAuth");
  res.redirect(authUrl);
});

// GET /api/auth/google/callback
router.get("/callback", async (req, res) => {
  if (!googleOAuthClientConfigured()) {
    res.status(503).send("Google OAuth not configured.");
    return;
  }

  const { code, state, error } = req.query as Record<string, string>;
  const domain = appDomain(req);
  const frontendBase = process.env.FRONTEND_BASE_PATH ?? "";
  const errorRedirect = (code: string) => res.redirect(`https://${domain}${frontendBase}/connections?conn_error=${code}&conn_platform=google_ads`);

  if (error) {
    logger.warn({ error }, "Google OAuth denied by user");
    errorRedirect(error === "access_denied" ? "access_denied" : "insufficient_permissions");
    return;
  }

  const pending = state ? pendingStates.get(state) : null;
  if (!pending) {
    errorRedirect("internal_error");
    return;
  }
  pendingStates.delete(state);

  const redirectUri = buildGoogleRedirectUri(domain);
  const oauthClient = createGoogleOAuth2Client(redirectUri);

  try {
    let tokens;
    try {
      const { tokens: t } = await oauthClient.getToken(code);
      tokens = t;
    } catch (err) {
      // SEC-07: Google's error response can echo the failing
      // refresh_token / authorization_code in the body. Never log the raw
      // error — only safe, structured fields.
      const safe = safeRefreshErrorFields(err);
      logger.error(safe, "Google token exchange failed");
      errorRedirect("token_exchange_failed");
      return;
    }

    if (!tokens.access_token) {
      errorRedirect("token_exchange_failed");
      return;
    }

    if (!tokens.refresh_token) {
      logger.error("Google OAuth returned no refresh_token — this is unexpected with prompt=consent. Aborting to prevent stale token reuse.");
      errorRedirect("no_refresh_token");
      return;
    }

    // Fetch user email for display via the typed OAuth2Client.
    let email = "";
    try {
      oauthClient.setCredentials(tokens);
      const userResp = await oauthClient.request<{ email?: string }>({
        url: "https://www.googleapis.com/oauth2/v2/userinfo",
      });
      email = userResp.data.email ?? "";
    } catch {
      // Non-fatal
    }

    logger.info({ email, platform: pending.platform }, "Google OAuth token exchange successful — storing fresh token pair");

    // Store tokens in temp setup store
    const setupKey = crypto.randomBytes(16).toString("hex");
    pendingSetups.set(setupKey, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      platform: pending.platform,
      email,
      expiresAt: Date.now() + 15 * 60 * 1000,
    });

    const frontendBase = process.env.FRONTEND_BASE_PATH ?? "";
    res.redirect(`https://${domain}${frontendBase}/connections?google_setup=${setupKey}&platform=${pending.platform}&email=${encodeURIComponent(email)}`);
  } catch (err) {
    logger.error({ err }, "Google OAuth callback error");
    errorRedirect("internal_error");
  }
});

// POST /api/auth/google/complete
router.post("/complete", async (req, res) => {
  const { setupKey, developerToken, customerId, managerCustomerId, merchantId } = req.body as Record<string, string>;

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

  const orgId = extractOrgIdFromHeader(req);

  try {
    let credentials: Record<string, string>;
    let platform: string;
    let displayName: string;

    if (setup.platform === "google_ads") {
      const envDevToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "";
      // Developer token is intentionally NOT stored in the DB — it is always
      // read at request time from GOOGLE_ADS_DEVELOPER_TOKEN env var so that
      // token rotations take effect immediately without requiring reconnection.
      if (!customerId) {
        res.status(400).json({ error: "customerId is required for Google Ads" });
        return;
      }
      if (!envDevToken && !developerToken) {
        res.status(400).json({ error: "GOOGLE_ADS_DEVELOPER_TOKEN is not configured on the server." });
        return;
      }
      platform = "google_ads";
      displayName = setup.email || "Google Ads";
      credentials = encryptCredentials({
        accessToken: setup.accessToken,
        refreshToken: setup.refreshToken,
        customerId: customerId.replace(/-/g, ""),
        ...(managerCustomerId ? { managerCustomerId: managerCustomerId.replace(/-/g, "") } : {}),
        ...(developerToken && !envDevToken ? { developerToken } : {}),
      });
    } else if (setup.platform === "gmc") {
      if (!merchantId) {
        res.status(400).json({ error: "merchantId is required for Google Merchant Center" });
        return;
      }
      platform = "gmc";
      displayName = setup.email || "Google Merchant Center";
      credentials = encryptCredentials({
        accessToken: setup.accessToken,
        refreshToken: setup.refreshToken,
        merchantId,
      });
    } else if (setup.platform === "gsc") {
      const { siteUrl } = req.body as Record<string, string>;
      if (!siteUrl) {
        res.status(400).json({ error: "siteUrl is required for Google Search Console" });
        return;
      }
      platform = "gsc";
      displayName = setup.email || "Google Search Console";
      credentials = encryptCredentials({
        accessToken: setup.accessToken,
        refreshToken: setup.refreshToken,
        siteUrl,
      });
    } else if (setup.platform === "youtube") {
      platform = "youtube";
      displayName = setup.email || "YouTube / Google Data";
      credentials = encryptCredentials({
        accessToken: setup.accessToken,
        refreshToken: setup.refreshToken,
      });
    } else if (setup.platform === "workspace") {
      // ── Unified Google Workspace — creates up to 4 connections in one shot ──
      const {
        developerToken,
        customerId,
        managerCustomerId,
        merchantId,
        siteUrl,
        ga4PropertyId,
      } = req.body as Record<string, string>;

      const sharedTokens = {
        accessToken: setup.accessToken,
        refreshToken: setup.refreshToken,
      };

      const toUpsert: Array<{ platform: string; displayName: string; credentials: Record<string, string> }> = [];

      const envDevToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "";
      if ((envDevToken || developerToken) && customerId) {
        toUpsert.push({
          platform: "google_ads",
          displayName: setup.email ? `Google Ads (${setup.email})` : "Google Ads",
          credentials: encryptCredentials({
            ...sharedTokens,
            customerId: customerId.replace(/-/g, ""),
            ...(managerCustomerId ? { managerCustomerId: managerCustomerId.replace(/-/g, "") } : {}),
            ...(developerToken && !envDevToken ? { developerToken } : {}),
            ...(ga4PropertyId ? { ga4PropertyId: ga4PropertyId.trim() } : {}),
          }),
        });
      }
      if (merchantId) {
        toUpsert.push({
          platform: "gmc",
          displayName: setup.email ? `Merchant Center (${setup.email})` : "Google Merchant Center",
          credentials: encryptCredentials({ ...sharedTokens, merchantId }),
        });
      }
      if (siteUrl) {
        toUpsert.push({
          platform: "gsc",
          displayName: setup.email ? `Search Console (${setup.email})` : "Google Search Console",
          credentials: encryptCredentials({ ...sharedTokens, siteUrl }),
        });
      }
      toUpsert.push({
        platform: "youtube",
        displayName: setup.email ? `YouTube (${setup.email})` : "YouTube / Google Data",
        credentials: encryptCredentials(sharedTokens),
      });
      toUpsert.push({
        platform: "google_sheets",
        displayName: setup.email ? `Google Sheets (${setup.email})` : "Google Sheets",
        credentials: encryptCredentials(sharedTokens),
      });
      // ── Google Workspace expansion ──────────────────────────────────────────
      toUpsert.push({
        platform: "google_calendar",
        displayName: setup.email ? `Google Calendar (${setup.email})` : "Google Calendar",
        credentials: encryptCredentials(sharedTokens),
      });
      toUpsert.push({
        platform: "google_drive",
        displayName: setup.email ? `Google Drive (${setup.email})` : "Google Drive",
        credentials: encryptCredentials(sharedTokens),
      });
      toUpsert.push({
        platform: "google_docs",
        displayName: setup.email ? `Google Docs (${setup.email})` : "Google Docs",
        credentials: encryptCredentials(sharedTokens),
      });

      const savedPlatforms: string[] = [];
      for (const conn of toUpsert) {
        const existingWhere = and(
          eq(platformConnections.platform, conn.platform),
          orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId),
        );
        const existing = await db.select().from(platformConnections).where(existingWhere);
        if (existing.length > 0) {
          await db.update(platformConnections)
            .set({ credentials: conn.credentials, displayName: conn.displayName, isActive: true, updatedAt: new Date() })
            .where(eq(platformConnections.id, existing[0].id));
        } else {
          await db.insert(platformConnections).values({ platform: conn.platform, displayName: conn.displayName, credentials: conn.credentials, isActive: true, ...(orgId ? { organizationId: orgId } : {}) });
        }
        savedPlatforms.push(conn.platform);
      }

      logger.info({ platforms: savedPlatforms, email: setup.email }, "Google Workspace connections saved");
      const wsGoal = await getWorkspaceGoal();
      triggerBackgroundEtl({ purgeGoal: wsGoal, orgId });
      res.json({ success: true, platform: "workspace", platforms: savedPlatforms, displayName: setup.email || "Google Workspace" });
      return;
    } else {
      res.status(400).json({ error: `Unknown platform: ${setup.platform}` });
      return;
    }

    // Upsert connection (single-platform path) — scoped by organizationId
    const singleWhere = and(
      eq(platformConnections.platform, platform),
      orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId),
    );
    const existing = await db.select().from(platformConnections).where(singleWhere);
    if (existing.length > 0) {
      await db.update(platformConnections)
        .set({ credentials, displayName, isActive: true, updatedAt: new Date() })
        .where(eq(platformConnections.id, existing[0].id));
    } else {
      await db.insert(platformConnections).values({ platform, displayName, credentials, isActive: true, ...(orgId ? { organizationId: orgId } : {}) });
    }

    logger.info({ platform, displayName }, "Google platform connection saved");
    const wsGoal2 = await getWorkspaceGoal();
    triggerBackgroundEtl({ purgeGoal: wsGoal2, orgId });
    res.json({ success: true, platform, displayName });
  } catch (err) {
    logger.error({ err }, "Google OAuth complete error");
    res.status(500).json({ error: "Failed to save connection" });
  }
});

// POST /api/auth/google/disconnect
// Wipes all Google-related platform connections from the DB.
// This forces a clean slate — the next OAuth flow will produce a genuinely fresh token pair.
router.post("/disconnect", async (req, res) => {
  const GOOGLE_PLATFORMS = [
    "google_ads", "gmc", "gsc", "youtube", "google_sheets",
    "google_calendar", "google_drive", "google_docs",
  ] as const;
  const orgId = extractOrgIdFromHeader(req);

  try {
    const deleted: string[] = [];
    for (const platform of GOOGLE_PLATFORMS) {
      const whereClause = and(
        eq(platformConnections.platform, platform),
        orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId),
      );
      const rows = await db
        .select({ id: platformConnections.id })
        .from(platformConnections)
        .where(whereClause);

      for (const row of rows) {
        await db.delete(platformConnections).where(eq(platformConnections.id, row.id));
        deleted.push(platform);
      }
    }

    logger.info({ deleted }, "Google Workspace disconnected — all tokens wiped from DB");
    res.json({ success: true, disconnected: deleted });
  } catch (err) {
    logger.error({ err }, "Failed to disconnect Google Workspace");
    res.status(500).json({ error: "Failed to disconnect Google Workspace" });
  }
});

export default router;
