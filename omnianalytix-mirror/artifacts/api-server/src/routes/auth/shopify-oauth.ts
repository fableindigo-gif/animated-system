import { Router } from "express";
import crypto from "crypto";
import { db, platformConnections } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { triggerBackgroundEtl } from "../etl";
import { getWorkspaceGoal } from "../../lib/warehouse-purge";
import { verifyAnyToken } from "./gate";
import { getOrgId } from "../../middleware/rbac";
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

const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET ?? "";

// ─── Scope Policy ────────────────────────────────────────────────────────────
// Store Owner (analytics + ad attribution) — minimal required set.
// Principle: read-only unless a specific write operation is in the ETL.
//
// Write scopes granted:
//   write_products — COGS field updates written back to variant metafields
//
// All other write_*, customer_write_*, unauthenticated_write_* and
// storefront-API scopes are EXCLUDED — they grant destructive store-level
// permissions that a read-only analytics platform must never hold.
// ─────────────────────────────────────────────────────────────────────────────
const REQUIRED_SCOPES = [
  // Products & Inventory — ETL warehouse sync (warehouse_shopify_products)
  "read_products",    // Product catalogue, titles, handles, status
  "write_products",   // COGS write-back to variant metafields
  "read_inventory",   // Inventory quantities and cost-per-item (COGS source)
  "read_locations",   // Multi-location inventory resolution

  // Orders — POAS / revenue attribution calculations
  "read_orders",      // Order line items, revenue, discounts, refunds

  // Customers — attribution (gclid / fbclid source matching)
  "read_customers",   // Customer email + UTM / click-ID fields (read-only)

  // Analytics & Marketing Attribution
  "read_analytics",         // Shopify native analytics
  "read_marketing_events",  // UTM campaign event attribution

  // Reports — export to Shopify native report tables
  "read_reports",

  // Fulfilment context — required for accurate net-revenue in POAS
  "read_fulfillments",    // Fulfilment status for shipped-only revenue
  "read_shipping",        // Shipping zones and rates
].join(",");

function appDomain(req: { hostname: string }): string {
  if (process.env.APP_DOMAIN) return process.env.APP_DOMAIN;
  const replitDomains = (process.env.REPLIT_DOMAINS ?? "").split(",").map((d) => d.trim()).filter(Boolean);
  // Prefer the custom domain (non .replit.app) if available
  const custom = replitDomains.find((d) => !d.endsWith(".replit.app") && !d.endsWith(".repl.co"));
  return custom ?? replitDomains[0] ?? req.hostname;
}

// In-memory state store for CSRF protection (includes orgId for tenant scoping)
const pendingStates = new Map<string, { shop: string; organizationId: number | null; expiresAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [state, data] of pendingStates.entries()) {
    if (data.expiresAt < now) pendingStates.delete(state);
  }
}, 10 * 60 * 1000);

function verifyHmac(params: Record<string, string>, secret: string): boolean {
  const { hmac, ...rest } = params;
  if (!hmac) return false;
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("&");
  const digest = crypto.createHmac("sha256", secret).update(message).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
}

// GET /api/auth/shopify/start?shop=mystore.myshopify.com
router.get("/start", (req, res) => {
  if (!CLIENT_ID) {
    res.status(503).json({ error: "SHOPIFY_CLIENT_ID is not configured. Add it as an environment variable." });
    return;
  }

  const shop = String(req.query.shop ?? "").toLowerCase().trim();
  if (!shop || !shop.match(/^[a-zA-Z0-9-]+\.myshopify\.com$/)) {
    res.status(400).json({ error: "Invalid shop domain. Must be in format: mystore.myshopify.com" });
    return;
  }

  let orgId = extractOrgIdFromHeader(req);
  if (!orgId && typeof req.query.token === "string" && req.query.token) {
    const decoded = verifyAnyToken(req.query.token);
    if (decoded?.organizationId) orgId = decoded.organizationId;
  }
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, { shop, organizationId: orgId, expiresAt: Date.now() + 10 * 60 * 1000 });

  const domain = appDomain(req);
  const redirectUri = `https://${domain}/api/auth/shopify/callback`;

  const installUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${CLIENT_ID}` +
    `&scope=${REQUIRED_SCOPES}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  logger.info({ shop, redirectUri }, "Starting Shopify OAuth");
  res.redirect(installUrl);
});

// GET /api/auth/shopify/callback
router.get("/callback", async (req, res) => {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    res.status(503).send("Shopify OAuth not configured.");
    return;
  }

  const { code, shop, state, hmac, ...rest } = req.query as Record<string, string>;
  const domain = appDomain(req);
  const frontendBase = process.env.FRONTEND_BASE_PATH ?? "";
  const errorRedirect = (errCode: string) => res.redirect(`https://${domain}${frontendBase}/connections?conn_error=${errCode}&conn_platform=shopify`);

  const pending = state ? pendingStates.get(state) : null;
  if (!pending || pending.shop !== shop) {
    errorRedirect("internal_error");
    return;
  }
  pendingStates.delete(state);

  const allParams = { code, shop, state, hmac, ...rest };
  if (!verifyHmac(allParams, CLIENT_SECRET)) {
    errorRedirect("insufficient_permissions");
    return;
  }

  try {
    const tokenResp = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code }),
    });

    if (!tokenResp.ok) {
      const err = await tokenResp.text();
      logger.error({ shop, err }, "Shopify token exchange failed");
      errorRedirect("token_exchange_failed");
      return;
    }

    const tokenData = (await tokenResp.json()) as { access_token: string; scope: string };
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      errorRedirect("token_exchange_failed");
      return;
    }

    const callbackOrgId = pending.organizationId;
    const shopifyWhere = and(
      eq(platformConnections.platform, "shopify"),
      callbackOrgId != null ? eq(platformConnections.organizationId, callbackOrgId) : isNull(platformConnections.organizationId),
    );
    const existing = await db.select().from(platformConnections).where(shopifyWhere);
    const shopEntry = existing.find((c) => (c.credentials as Record<string, string>).shopDomain === shop);

    const encCreds = encryptCredentials({ shopDomain: shop, accessToken });
    if (shopEntry) {
      await db
        .update(platformConnections)
        .set({ credentials: encCreds, isActive: true, updatedAt: new Date() })
        .where(eq(platformConnections.id, shopEntry.id));
      logger.info({ shop, connectionId: shopEntry.id }, "Shopify connection updated via OAuth");
    } else {
      await db.insert(platformConnections).values({
        platform: "shopify",
        displayName: shop,
        credentials: encCreds,
        isActive: true,
        ...(callbackOrgId ? { organizationId: callbackOrgId } : {}),
      });
      logger.info({ shop }, "Shopify connection created via OAuth");
    }

    const goal = await getWorkspaceGoal();
    triggerBackgroundEtl({ purgeGoal: goal, orgId: callbackOrgId });

    const domain = appDomain(req);
    const frontendBase = process.env.FRONTEND_BASE_PATH ?? "";
    res.redirect(`https://${domain}${frontendBase}/connections?shopify=connected&shop=${encodeURIComponent(shop)}`);
  } catch (err) {
    logger.error({ err }, "Shopify OAuth callback error");
    errorRedirect("internal_error");
  }
});

export default router;
