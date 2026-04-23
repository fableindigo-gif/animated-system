import { Router, type Request, type Response } from "express";
import { db, processedWebhookEvents } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { emitTriageAlert } from "../../lib/triage-emitter";
import crypto from "crypto";

const router = Router();

function nowUTC(): string {
  return new Date().toISOString().substring(11, 16) + " UTC";
}

// ── Signature helpers ────────────────────────────────────────────────────────
//
// All endpoints on this router are PUBLIC (mounted before requireAuth) and
// trigger real side effects (warehouse mutations, triage alerts). They MUST
// fail-closed: if no signature secret is configured, or the request lacks a
// valid signature, reject with 401/503. The previous implementation only
// verified Shopify when *both* secret and header existed, leaving every
// other endpoint completely unauthenticated — anyone on the internet could
// POST forged inventory updates and alerts.
//
// Each provider gets its own shared secret env var. Operators must set them
// before exposing the bus to the internet.

function timingSafeStringEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Verify a Shopify webhook HMAC. Returns true only when the secret is set,
 * the header is present, and the computed digest matches.
 */
function verifyShopifyHmac(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const header = req.headers["x-shopify-hmac-sha256"];
  if (typeof header !== "string" || !header) return false;
  const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  const computed = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(header));
  } catch {
    return false;
  }
}

/**
 * Verify a generic shared-secret bearer token (used for the CRM and
 * Stripe-mirror endpoints on this bus, which don't have provider-native
 * signatures because they are internal aggregator hooks).
 */
function verifySharedSecret(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const auth = req.headers.authorization;
  if (typeof auth !== "string" || !auth.startsWith("Bearer ")) return false;
  return timingSafeStringEq(auth.slice(7), secret);
}

interface ShopifyOrderPayload {
  id: number;
  name: string;
  total_price: string;
  financial_status: string;
  fulfillment_status: string | null;
  line_items?: Array<{ product_id: number; sku: string; quantity: number; title: string }>;
  customer?: { id: number; email?: string };
  created_at?: string;
  updated_at?: string;
}

interface ShopifyInventoryPayload {
  inventory_item_id: number;
  location_id: number;
  available: number;
  sku?: string;
}

interface CrmEventPayload {
  event: "deal_won" | "deal_lost" | "lead_created" | "contact_updated";
  platform: string;
  entity_id: string;
  entity_name?: string;
  revenue?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Best-effort idempotency guard. Returns true if this (provider, eventId) was
 * already processed. Otherwise records it and returns false. Race-tolerant via
 * the unique index — concurrent inserts surface as a unique-violation, which
 * we treat as "already processed".
 */
async function alreadyProcessed(provider: string, eventId: string | null | undefined): Promise<boolean> {
  if (!eventId) return false;
  try {
    const inserted = await db
      .insert(processedWebhookEvents)
      .values({ provider, eventId })
      .onConflictDoNothing({ target: [processedWebhookEvents.provider, processedWebhookEvents.eventId] })
      .returning({ eventId: processedWebhookEvents.eventId });
    return inserted.length === 0;
  } catch (err) {
    logger.warn({ err, provider, eventId }, "idempotency check failed — proceeding (open-circuit)");
    return false;
  }
}

router.post("/shopify/orders", async (req: Request, res: Response) => {
  const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.error("SHOPIFY_WEBHOOK_SECRET not set — rejecting webhook");
    return res.status(503).json({ error: "Webhook receiver not configured" });
  }
  if (!verifyShopifyHmac(req, webhookSecret)) {
    logger.warn({ ip: req.ip }, "Shopify order webhook HMAC verification failed");
    return res.status(401).json({ error: "Invalid HMAC signature" });
  }

  try {
    const order = req.body as ShopifyOrderPayload;
    if (!order.id) {
      return res.status(400).json({ error: "Missing order id" });
    }
    if (await alreadyProcessed("shopify_order", String(order.id))) {
      return res.json({ success: true, deduped: true });
    }

    logger.info({ orderId: order.id, name: order.name, total: order.total_price }, "Shopify order webhook received");

    for (const item of order.line_items ?? []) {
      if (!item.sku) continue;
      try {
        await db.execute(sql`
          UPDATE warehouse_shopify_products
          SET inventory_qty = GREATEST(inventory_qty - ${item.quantity}, 0),
              synced_at = NOW()
          WHERE sku = ${item.sku}
        `);
      } catch {
        // SKU may not exist in warehouse yet
      }
    }

    const totalPrice = parseFloat(order.total_price) || 0;
    emitTriageAlert({
      id: `shopify-order-${order.id}`,
      severity: totalPrice > 500 ? "info" : "info",
      title: `New order ${order.name} — $${totalPrice.toFixed(2)}`,
      detail: `${(order.line_items ?? []).length} item(s). Status: ${order.financial_status ?? "pending"}.`,
      platform: "Shopify",
      ts: nowUTC(),
    });

    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Shopify order webhook error");
    return res.status(500).json({ error: "Webhook processing failed" });
  }
});

router.post("/shopify/inventory", async (req: Request, res: Response) => {
  const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.error("SHOPIFY_WEBHOOK_SECRET not set — rejecting webhook");
    return res.status(503).json({ error: "Webhook receiver not configured" });
  }
  if (!verifyShopifyHmac(req, webhookSecret)) {
    logger.warn({ ip: req.ip }, "Shopify inventory webhook HMAC verification failed");
    return res.status(401).json({ error: "Invalid HMAC signature" });
  }

  try {
    const payload = req.body as ShopifyInventoryPayload;
    if (!payload.inventory_item_id) {
      return res.status(400).json({ error: "Missing inventory_item_id" });
    }
    if (await alreadyProcessed("shopify_inventory", `${payload.inventory_item_id}-${payload.available}`)) {
      return res.json({ success: true, deduped: true });
    }

    logger.info({ inventoryItemId: payload.inventory_item_id, available: payload.available }, "Shopify inventory webhook received");

    const sku = payload.sku ?? String(payload.inventory_item_id);
    const newQty = payload.available ?? 0;

    try {
      await db.execute(sql`
        UPDATE warehouse_shopify_products
        SET inventory_qty = ${newQty},
            status = CASE WHEN ${newQty} <= 0 THEN 'out_of_stock' ELSE 'active' END,
            synced_at = NOW()
        WHERE sku = ${sku} OR handle = ${sku}
      `);
    } catch {
      // Non-blocking
    }

    if (newQty <= 0) {
      let affectedAds: Array<{ campaign_name: string; cost_usd: number }> = [];
      try {
        const result = await db.execute<{ campaign_name: string; cost_usd: number }>(sql`
          SELECT g.campaign_name, g.cost_usd
          FROM warehouse_google_ads g
          JOIN warehouse_cross_platform_mapping m ON m.google_ad_id = g.ad_id
          JOIN warehouse_shopify_products s ON s.product_id = m.shopify_product_id
          WHERE (s.sku = ${sku} OR s.handle = ${sku})
            AND g.status = 'ENABLED' AND g.cost_usd > 0
          ORDER BY g.cost_usd DESC LIMIT 5
        `);
        affectedAds = (result as { rows: typeof affectedAds }).rows ?? [];
      } catch { /* silent */ }

      const totalSpend = affectedAds.reduce((s, a) => s + (Number(a.cost_usd) || 0), 0);
      emitTriageAlert({
        id: `inv-depleted-${sku}-${Date.now()}`,
        severity: affectedAds.length > 0 ? "critical" : "warning",
        title: affectedAds.length > 0
          ? `[OUT OF STOCK] SKU "${sku}" — ${affectedAds.length} ads spending $${totalSpend.toFixed(0)} on empty shelf`
          : `Inventory depleted: SKU "${sku}"`,
        detail: affectedAds.length > 0
          ? `Campaigns: ${affectedAds.map(a => a.campaign_name).join(", ")}. Pause immediately.`
          : `SKU "${sku}" inventory hit zero. No active ad spend detected.`,
        platform: "Shopify",
        action: affectedAds.length > 0 ? `Pause ${affectedAds.length} related ad(s)` : undefined,
        ts: nowUTC(),
      });
    }

    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Shopify inventory webhook error");
    return res.status(500).json({ error: "Webhook processing failed" });
  }
});

// NOTE: The real Stripe webhook lives at POST /api/webhooks/stripe and verifies
// `stripe-signature` against STRIPE_WEBHOOK_SECRET. This bus mirror only fires
// triage UI alerts and accepts an internal aggregator forwarding payload — it
// MUST be authenticated with WEBHOOK_BUS_SHARED_SECRET (a server-to-server
// bearer token), otherwise anyone could spam fake "payment failed" alerts.
router.post("/stripe/events", async (req: Request, res: Response) => {
  const sharedSecret = process.env.WEBHOOK_BUS_SHARED_SECRET;
  if (!sharedSecret) {
    logger.error("WEBHOOK_BUS_SHARED_SECRET not set — rejecting bus webhook");
    return res.status(503).json({ error: "Webhook receiver not configured" });
  }
  if (!verifySharedSecret(req, sharedSecret)) {
    logger.warn({ ip: req.ip }, "Stripe bus webhook auth failed");
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const event = req.body as { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
    if (!event.type) {
      return res.status(400).json({ error: "Missing event type" });
    }
    if (event.id && (await alreadyProcessed("stripe_bus", event.id))) {
      return res.json({ success: true, deduped: true });
    }

    logger.info({ type: event.type }, "Stripe event received via master bus");

    const obj = event.data?.object ?? {};

    switch (event.type) {
      case "invoice.payment_succeeded": {
        emitTriageAlert({
          id: `stripe-paid-${String(obj.id ?? Date.now())}`,
          severity: "info",
          title: `Payment received: $${(Number(obj.amount_paid ?? 0) / 100).toFixed(2)}`,
          detail: `Invoice ${String(obj.number ?? obj.id ?? "")} paid successfully.`,
          platform: "Stripe",
          ts: nowUTC(),
        });
        break;
      }
      case "invoice.payment_failed": {
        emitTriageAlert({
          id: `stripe-failed-${String(obj.id ?? Date.now())}`,
          severity: "critical",
          title: `Payment failed: $${(Number(obj.amount_due ?? 0) / 100).toFixed(2)}`,
          detail: `Invoice ${String(obj.number ?? obj.id ?? "")} payment failed. Subscription may be at risk.`,
          platform: "Stripe",
          ts: nowUTC(),
        });
        break;
      }
      case "customer.subscription.deleted": {
        emitTriageAlert({
          id: `stripe-churn-${String(obj.id ?? Date.now())}`,
          severity: "warning",
          title: `Subscription canceled`,
          detail: `Customer subscription ${String(obj.id ?? "")} has been canceled.`,
          platform: "Stripe",
          ts: nowUTC(),
        });
        break;
      }
      default:
        logger.info({ type: event.type }, "Unhandled Stripe event type");
    }

    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Stripe master-bus webhook error");
    return res.status(500).json({ error: "Webhook processing failed" });
  }
});

router.post("/crm/events", async (req: Request, res: Response) => {
  const sharedSecret = process.env.WEBHOOK_BUS_SHARED_SECRET;
  if (!sharedSecret) {
    logger.error("WEBHOOK_BUS_SHARED_SECRET not set — rejecting bus webhook");
    return res.status(503).json({ error: "Webhook receiver not configured" });
  }
  if (!verifySharedSecret(req, sharedSecret)) {
    logger.warn({ ip: req.ip }, "CRM bus webhook auth failed");
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const payload = req.body as CrmEventPayload;
    if (!payload.event || !payload.platform) {
      return res.status(400).json({ error: "Missing event or platform" });
    }

    logger.info({ event: payload.event, platform: payload.platform, entityId: payload.entity_id }, "CRM event received");

    const severityMap: Record<string, "critical" | "warning" | "info"> = {
      deal_won: "info",
      deal_lost: "warning",
      lead_created: "info",
      contact_updated: "info",
    };

    const titleMap: Record<string, string> = {
      deal_won: `Deal won: "${payload.entity_name ?? payload.entity_id}"${payload.revenue ? ` — $${payload.revenue.toFixed(2)}` : ""}`,
      deal_lost: `Deal lost: "${payload.entity_name ?? payload.entity_id}"`,
      lead_created: `New lead: "${payload.entity_name ?? payload.entity_id}"`,
      contact_updated: `Contact updated: "${payload.entity_name ?? payload.entity_id}"`,
    };

    emitTriageAlert({
      id: `crm-${payload.event}-${payload.entity_id}-${Date.now()}`,
      severity: severityMap[payload.event] ?? "info",
      title: titleMap[payload.event] ?? `CRM event: ${payload.event}`,
      detail: `Platform: ${payload.platform}. Entity: ${payload.entity_id}.${payload.revenue ? ` Revenue: $${payload.revenue.toFixed(2)}.` : ""}`,
      platform: payload.platform,
      ts: nowUTC(),
    });

    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "CRM webhook error");
    return res.status(500).json({ error: "Webhook processing failed" });
  }
});

router.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", bus: "master-webhook-bus", uptime: process.uptime() });
});

export default router;
