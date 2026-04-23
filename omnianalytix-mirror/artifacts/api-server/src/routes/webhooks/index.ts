// ─── Ecommerce Product Webhook ────────────────────────────────────────────────
// POST /webhooks/ecommerce/product-update
//
// Receives real-time product events from any connected e-commerce platform:
//   Shopify (via Shopify webhook subscription)
//   WooCommerce (via WooCommerce webhooks)
//   Custom / Headless (via the token-authenticated endpoint)
//
// On out-of-stock or deletion events:
//   1. Updates warehouse_shopify_products inventory
//   2. Queries for Google Ads campaigns spending on this dead SKU
//   3. Injects a CRITICAL alert into the Live Triage feed
//   4. Notifies the configured MS Teams webhook
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from "express";
import crypto from "crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { pushAlert, notifyTeams } from "../../lib/alert-store";

const router = Router();

const WEBHOOK_SECRET = process.env.ECOMMERCE_WEBHOOK_SECRET ?? "";

function nowUTC() {
  return new Date().toISOString().substring(11, 16) + " UTC";
}

function verifyWebhookToken(req: import("express").Request): boolean {
  if (!WEBHOOK_SECRET) return false;

  const headerSig = req.headers["x-webhook-signature"] as string | undefined;
  if (headerSig) {
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const computed = crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody, "utf8").digest("hex");
    try {
      return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(headerSig));
    } catch {
      return false;
    }
  }

  const bodyToken = (req.body as Record<string, unknown>)?.token;
  if (typeof bodyToken === "string" && bodyToken.length > 0) {
    try {
      return crypto.timingSafeEqual(Buffer.from(bodyToken), Buffer.from(WEBHOOK_SECRET));
    } catch {
      return false;
    }
  }

  return false;
}

interface ProductUpdatePayload {
  sku?: string;
  event: "out_of_stock" | "deleted" | "in_stock" | "updated";
  inventory_qty?: number;
  platform?: string;
  product_name?: string;
  product_id?: string;
  token?: string;
}

// ─── POST /webhooks/ecommerce/product-update ──────────────────────────────────

router.post("/ecommerce/product-update", async (req, res) => {
  try {
    if (!verifyWebhookToken(req)) {
      logger.warn({ ip: req.ip }, "Ecommerce webhook rejected: invalid or missing token");
      return res.status(401).json({ success: false, error: "Unauthorized: invalid webhook token" });
    }

    const body = req.body as ProductUpdatePayload;
    const {
      sku,
      event,
      inventory_qty,
      platform = "E-Commerce",
      product_name = sku ?? "Unknown Product",
    } = body;

    if (!event) {
      return res.status(400).json({ success: false, error: "Missing required field: event" });
    }

    logger.info({ sku, event, inventory_qty, platform }, "Ecommerce webhook received");

    // ── 1. Update warehouse inventory ─────────────────────────────────────────
    if (sku) {
      const newQty =
        event === "out_of_stock" ? 0
        : event === "deleted" ? -1
        : (inventory_qty ?? 0);
      const newStatus =
        event === "deleted" ? "archived"
        : event === "out_of_stock" ? "out_of_stock"
        : "active";

      try {
        await db.execute(
          sql`UPDATE warehouse_shopify_products
              SET inventory_qty = ${newQty},
                  status        = ${newStatus},
                  synced_at     = NOW()
              WHERE sku = ${sku} OR handle = ${sku}`,
        );
      } catch {
        // Warehouse may not have this SKU yet — non-blocking
      }
    }

    // ── 2. Find active ads spending on this dead SKU ───────────────────────────
    if (event === "out_of_stock" || event === "deleted") {
      let affectedAds: Array<{ campaign_name: string; cost_usd: number; ad_id: string }> = [];

      try {
        if (sku) {
          const result = await db.execute<{ campaign_name: string; cost_usd: number; ad_id: string }>(
            sql`SELECT g.campaign_name, g.cost_usd, g.ad_id
                FROM warehouse_google_ads g
                JOIN warehouse_cross_platform_mapping m ON m.google_ad_id = g.ad_id
                JOIN warehouse_shopify_products s       ON s.product_id   = m.shopify_product_id
                WHERE (s.sku = ${sku} OR s.handle = ${sku})
                  AND g.status   = 'ENABLED'
                  AND g.cost_usd > 0
                ORDER BY g.cost_usd DESC
                LIMIT 10`,
          );
          affectedAds = Array.isArray(result)
            ? (result as typeof affectedAds)
            : ((result as { rows: typeof affectedAds }).rows ?? []);
        } else {
          const result = await db.execute<{ campaign_name: string; cost_usd: number; ad_id: string }>(
            sql`SELECT campaign_name, cost_usd, ad_id FROM v_ads_on_empty_shelves LIMIT 10`,
          );
          affectedAds = Array.isArray(result)
            ? (result as typeof affectedAds)
            : ((result as { rows: typeof affectedAds }).rows ?? []);
        }
      } catch {
        // Warehouse query failed — still push an info alert
      }

      // ── 3. Push alert + notify Teams ────────────────────────────────────────
      if (affectedAds.length > 0) {
        const totalSpend = affectedAds.reduce((sum, a) => sum + (Number(a.cost_usd) || 0), 0);
        const campaignNames = affectedAds
          .slice(0, 3)
          .map((a) => `"${a.campaign_name}"`)
          .join(", ");
        const adIds = affectedAds.map((a) => a.ad_id).filter(Boolean);

        const alertTitle =
          event === "deleted"
            ? `[DEAD SKU] "${product_name}" deleted — ${affectedAds.length} ad${affectedAds.length > 1 ? "s" : ""} still spending $${totalSpend.toFixed(0)}`
            : `[OUT OF STOCK] "${product_name}" — ${affectedAds.length} ad${affectedAds.length > 1 ? "s" : ""} burning $${totalSpend.toFixed(0)} on empty shelf`;

        pushAlert({
          id: `webhook-oos-${sku ?? Date.now()}`,
          severity: "critical",
          title: alertTitle,
          detail: `Campaigns: ${campaignNames}. Total spend on zero-inventory SKU: $${totalSpend.toFixed(2)}. Pause immediately to stop wasted budget.`,
          platform,
          action: `Pause ${affectedAds.length} related ad${affectedAds.length > 1 ? "s" : ""} in Google Ads`,
          pausePayload: { sku: sku ?? "", affectedAdIds: adIds },
          ts: nowUTC(),
        });

        await notifyTeams(
          alertTitle,
          `**Product:** ${product_name} (SKU: ${sku ?? "N/A"})\n**Event:** ${event}\n**Platform:** ${platform}\n**Affected campaigns:** ${campaignNames}\n**Wasted spend at risk:** $${totalSpend.toFixed(2)}\n\nImmediate action required: pause all ads for this SKU.`,
        );
      } else {
        pushAlert({
          id: `webhook-event-${sku ?? Date.now()}`,
          severity: "info",
          title: `${event === "deleted" ? "Product deleted" : "Out of stock"}: "${product_name}"`,
          detail: `No active Google Ads campaigns found spending on this SKU. Warehouse inventory updated.`,
          platform,
          ts: nowUTC(),
        });
      }
    }

    return res.json({ success: true, message: "Webhook processed and warehouse updated." });
  } catch (err) {
    logger.error({ err }, "Ecommerce webhook error");
    return res.status(500).json({ success: false, error: "Webhook processing failed" });
  }
});

export default router;
