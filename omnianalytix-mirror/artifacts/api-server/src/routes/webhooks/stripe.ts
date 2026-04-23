import { Router, raw } from "express";
import Stripe from "stripe";
import { db, organizations, workspaces, processedWebhookEvents } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../../lib/logger";

/**
 * Idempotency guard for Stripe webhooks.
 *
 * Stripe will retry deliveries on any non-2xx, on connection errors, and
 * sometimes spuriously even after a 200. Without dedupe, retries of
 * `checkout.session.completed` would re-credit `aiCreativeCredits` and
 * re-apply subscription transitions on every replay — a money-printing
 * primitive for an attacker who can replay observed deliveries.
 *
 * We insert the event id into `processed_webhook_events` with a unique
 * index; if the row already exists the function returns true and the
 * caller short-circuits before mutating any billing state.
 */
async function isStripeEventProcessed(eventId: string): Promise<boolean> {
  try {
    const inserted = await db
      .insert(processedWebhookEvents)
      .values({ provider: "stripe", eventId })
      .onConflictDoNothing({ target: [processedWebhookEvents.provider, processedWebhookEvents.eventId] })
      .returning({ eventId: processedWebhookEvents.eventId });
    return inserted.length === 0;
  } catch (err) {
    // Fail-closed on dedupe storage outages: better to skip a replay than to
    // double-credit. The webhook will be retried by Stripe; once the table is
    // healthy again the legitimate delivery will go through.
    logger.error({ err, eventId }, "Stripe idempotency check failed — skipping event for safety");
    return true;
  }
}

const router = Router();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";

let stripe: Stripe | null = null;
if (STRIPE_SECRET_KEY) {
  // Stripe Node SDK v22 removed both `LatestApiVersion` and `StripeConfig`
  // type aliases. Build options without strict typing to keep the pinned
  // api-version literal while satisfying the new constructor signature.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opts = { apiVersion: "2025-04-30.basil" } as any;
  stripe = new Stripe(STRIPE_SECRET_KEY, opts);
}

async function resolveOrgByCustomerId(customerId: string) {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.stripeCustomerId, customerId))
    .limit(1);
  return org ?? null;
}

async function resolveOrgBySubscriptionId(subscriptionId: string) {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.stripeSubscriptionId, subscriptionId))
    .limit(1);
  return org ?? null;
}

// ─── handleCreditsPurchase ────────────────────────────────────────────────────
// Handles a completed Stripe Checkout session where metadata.type === "ai_credits".
// Adds the purchased credit amount to the organisation's ai_creative_credits counter.
async function handleCreditsPurchase(session: Stripe.Checkout.Session) {
  const creditAmount = parseInt(session.metadata?.creditAmount ?? "0", 10);
  if (!creditAmount || creditAmount <= 0) {
    logger.warn({ sessionId: session.id }, "credits purchase: creditAmount missing or zero in metadata");
    return;
  }

  const workspaceId = session.metadata?.workspaceId;
  const customerId  = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;

  let org = customerId ? await resolveOrgByCustomerId(customerId) : null;

  if (!org && workspaceId) {
    const wsId = Number(workspaceId);
    if (!Number.isNaN(wsId)) {
      const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId)).limit(1);
      if (ws) {
        const [o] = await db.select().from(organizations).where(eq(organizations.id, ws.organizationId)).limit(1);
        org = o ?? null;
      }
    }
  }

  if (!org) {
    logger.error({ customerId, sessionId: session.id }, "credits purchase: no organisation found");
    return;
  }

  await db
    .update(organizations)
    .set({ aiCreativeCredits: sql`${organizations.aiCreativeCredits} + ${creditAmount}` })
    .where(eq(organizations.id, org.id));

  logger.info(
    { orgId: org.id, creditAmount, pack: session.metadata?.pack },
    "AI Creative credits added via Stripe webhook",
  );
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  // ── AI Credits purchase (one-time payment) ─────────────────────────────────
  // When metadata.type === "ai_credits" we top up the org's credits counter
  // rather than changing the subscription tier.
  if (session.metadata?.type === "ai_credits") {
    await handleCreditsPurchase(session);
    return;
  }

  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id ?? null;
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : (session.subscription as Stripe.Subscription | null)?.id ?? null;
  const workspaceId = session.metadata?.workspaceId;
  const tier = session.metadata?.tier ?? "pro";

  if (!customerId) {
    logger.warn({ sessionId: session.id }, "Stripe checkout.session.completed: no customer ID");
    return;
  }

  let org = await resolveOrgByCustomerId(customerId);

  if (!org && workspaceId) {
    const { workspaces } = await import("@workspace/db");
    const wsId = Number(workspaceId);
    if (!Number.isNaN(wsId)) {
      const [ws] = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, wsId))
        .limit(1);

      if (ws) {
        [org] = await db
          .select()
          .from(organizations)
          .where(eq(organizations.id, ws.organizationId))
          .limit(1);
      }
    }
  }

  if (!org) {
    logger.error(
      { customerId, sessionId: session.id, workspaceId },
      "No organization found for Stripe checkout — cannot activate subscription without a valid org mapping",
    );
    return;
  }

  await db
    .update(organizations)
    .set({
      subscriptionTier: tier,
      stripeCustomerId: customerId,
      ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
    })
    .where(eq(organizations.id, org.id));

  logger.info(
    { orgId: org.id, customerId, subscriptionId, tier },
    "Subscription activated via Stripe webhook",
  );
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id ?? null;

  if (!customerId) return;

  const org = await resolveOrgByCustomerId(customerId);
  if (!org) {
    logger.warn({ customerId }, "invoice.payment_failed: no matching organization");
    return;
  }

  await db
    .update(organizations)
    .set({ subscriptionTier: "past_due" })
    .where(eq(organizations.id, org.id));

  logger.warn(
    { orgId: org.id, customerId, invoiceId: invoice.id },
    "Payment failed — subscription marked past_due",
  );
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const subscriptionId = subscription.id;
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id ?? null;

  let org = await resolveOrgBySubscriptionId(subscriptionId);
  if (!org && customerId) {
    org = await resolveOrgByCustomerId(customerId);
  }

  if (!org) {
    logger.warn({ subscriptionId, customerId }, "subscription.deleted: no matching organization");
    return;
  }

  await db
    .update(organizations)
    .set({
      subscriptionTier: "free",
      stripeSubscriptionId: null,
    })
    .where(eq(organizations.id, org.id));

  logger.info(
    { orgId: org.id, subscriptionId },
    "Subscription cancelled — reverted to free tier",
  );
}

router.post(
  "/stripe",
  raw({ type: "application/json" }),
  async (req, res) => {
    if (!stripe) {
      logger.warn("Stripe webhook received but Stripe SDK not configured");
      res.status(503).json({ error: "Stripe not configured" });
      return;
    }

    const sig = req.headers["stripe-signature"] as string | undefined;
    if (!sig) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }

    if (!STRIPE_WEBHOOK_SECRET) {
      logger.error("STRIPE_WEBHOOK_SECRET not set — cannot verify webhook signatures");
      res.status(500).json({ error: "Webhook secret not configured" });
      return;
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error({ err: message }, "Stripe webhook signature verification failed");
      res.status(400).json({ error: `Webhook verification failed: ${message}` });
      return;
    }

    logger.info({ eventId: event.id, type: event.type }, "Stripe webhook received");

    if (await isStripeEventProcessed(event.id)) {
      logger.info({ eventId: event.id, type: event.type }, "Stripe webhook already processed — skipping (idempotent)");
      res.json({ received: true, deduped: true });
      return;
    }

    try {
      switch (event.type) {
        case "checkout.session.completed":
          await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
          break;

        case "invoice.payment_failed":
          await handlePaymentFailed(event.data.object as Stripe.Invoice);
          break;

        case "customer.subscription.deleted":
          await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          break;

        default:
          logger.debug({ type: event.type }, "Unhandled Stripe event type");
      }
    } catch (err) {
      logger.error({ err, eventType: event.type, eventId: event.id }, "Stripe webhook handler error");
      res.status(500).json({ error: "Webhook handler error" });
      return;
    }

    res.json({ received: true });
  },
);

export default router;
