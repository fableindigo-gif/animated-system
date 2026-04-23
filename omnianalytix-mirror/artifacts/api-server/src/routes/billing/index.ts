import { Router } from "express";
import Stripe from "stripe";
import { logger } from "../../lib/logger";
import { requireAuth, getOrgId } from "../../middleware/rbac";

const router = Router();

// SEC-03: workspaceId for Stripe metadata MUST come from the authenticated
// session — never the request body. Otherwise a logged-in attacker can pass
// another tenant's workspaceId and have the webhook upgrade their plan or
// credit their wallet on a successful payment.
function resolveAuthedWorkspaceId(req: import("express").Request): number | null {
  const ws = req.rbacUser?.workspaceId;
  if (ws != null) return ws;
  return getOrgId(req); // fall back to org-level identity
}

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
const STRIPE_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID ?? "";

let stripe: Stripe | null = null;
if (STRIPE_SECRET_KEY) {
  // Stripe v22 doesn't expose `StripeConfig` on the namespace; the SDK accepts
  // any pinned date-string at runtime, so we cast through `any`.
  stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-04-30.basil" as any });
}

if (!STRIPE_PRICE_ID) {
  logger.warn("[Billing] STRIPE_PRO_PRICE_ID is not set — checkout will use fallback or fail");
}

function appDomain(req: { hostname: string }): string {
  if (process.env.APP_DOMAIN) return process.env.APP_DOMAIN;
  const replitDomains = (process.env.REPLIT_DOMAINS ?? "").split(",").map((d) => d.trim()).filter(Boolean);
  const custom = replitDomains.find((d) => !d.endsWith(".replit.app") && !d.endsWith(".repl.co"));
  return custom ?? replitDomains[0] ?? req.hostname;
}

router.get("/config", (_req, res) => {
  res.json({
    configured: !!stripe,
    hasPublishableKey: !!process.env.STRIPE_PUBLISHABLE_KEY,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? null,
  });
});

router.post("/create-checkout-session", requireAuth(), async (req, res) => {
  if (!stripe) {
    res.status(503).json({
      error: "Stripe is not configured",
      message: "Payment processing is not yet available. Please contact support@omnianalytix.in for Pro access.",
      code: "STRIPE_NOT_CONFIGURED",
    });
    return;
  }

  // SEC-03: Ignore body.workspaceId; trust only the authenticated identity.
  // If the caller still sends a body workspaceId AND it doesn't match the
  // authenticated session, reject explicitly (probably a misbehaving client
  // or active spoofing attempt — fail loud rather than silently overriding).
  // workspace-id-source-skip: read solely to detect mismatch vs authed session (SEC-03 fix)
  const { tier, workspaceId: bodyWorkspaceId } = req.body ?? {};
  const workspaceId = resolveAuthedWorkspaceId(req);
  if (workspaceId == null) {
    res.status(401).json({ error: "Unauthorized", code: "AUTH_REQUIRED" });
    return;
  }
  if (bodyWorkspaceId != null && Number(bodyWorkspaceId) !== Number(workspaceId)) {
    logger.warn(
      { authedWorkspaceId: workspaceId, bodyWorkspaceId, route: "/api/billing/create-checkout-session" },
      "[Billing] Rejecting request: body workspaceId does not match authenticated session (SEC-03)",
    );
    res.status(403).json({ error: "workspaceId mismatch", code: "WORKSPACE_MISMATCH" });
    return;
  }
  const domain = appDomain(req);
  const frontendBase = process.env.FRONTEND_BASE_PATH ?? "";
  const successUrl = `https://${domain}${frontendBase}/?stripe_success=true&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `https://${domain}${frontendBase}/?stripe_cancelled=true`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: STRIPE_PRICE_ID || undefined,
          quantity: 1,
          ...(STRIPE_PRICE_ID
            ? {}
            : {
                price_data: {
                  currency: "usd",
                  product_data: {
                    name: "OmniAnalytix Pro",
                    description: "AI-powered e-commerce execution, rollback, and diagnostics",
                  },
                  unit_amount: 9900,
                  recurring: { interval: "month" },
                },
              }),
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        workspaceId: String(workspaceId ?? ""),
        tier: tier ?? "pro",
      },
      allow_promotion_codes: true,
    });

    logger.info({ sessionId: session.id, tier }, "Stripe Checkout session created");
    res.json({ sessionId: session.id, url: session.url });
  } catch (err) {
    logger.error({ err }, "Failed to create Stripe Checkout session");
    res.status(500).json({ error: "Failed to initiate checkout" });
  }
});

// ─── POST /api/billing/credits/checkout ──────────────────────────────────────
// Creates a Stripe one-time checkout session to purchase a block of AI Creative
// credits. The amount purchased is set by `creditPack` (defaults to 1000).
// Metadata includes type: "ai_credits" and creditAmount so the webhook knows
// to top up org.aiCreativeCredits rather than upgrade the subscription.
const CREDIT_PACKS = {
  starter:     { credits: 1000, cents: 1900,  label: "Starter (1,000 credits)" },
  growth:      { credits: 5000, cents: 7900,  label: "Growth (5,000 credits)"  },
  professional:{ credits: 20000, cents: 24900, label: "Pro (20,000 credits)"   },
} as const;

router.post("/credits/checkout", requireAuth(), async (req, res) => {
  if (!stripe) {
    res.status(503).json({
      error:   "Stripe is not configured",
      message: "Payment processing is not available. Contact support@omnianalytix.in.",
      code:    "STRIPE_NOT_CONFIGURED",
    });
    return;
  }

  // SEC-03: Ignore body.workspaceId; trust only the authenticated identity.
  const { pack = "starter" } = req.body ?? {};
  const workspaceId = resolveAuthedWorkspaceId(req);
  if (workspaceId == null) {
    res.status(401).json({ error: "Unauthorized", code: "AUTH_REQUIRED" });
    return;
  }
  const packConfig = CREDIT_PACKS[pack as keyof typeof CREDIT_PACKS] ?? CREDIT_PACKS.starter;
  const domain = appDomain(req);
  const frontendBase = process.env.FRONTEND_BASE_PATH ?? "";
  const successUrl = `https://${domain}${frontendBase}/?credits_success=true&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl  = `https://${domain}${frontendBase}/`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        quantity: 1,
        price_data: {
          currency:     "usd",
          product_data: {
            name:        "OmniAnalytix AI Creative Studio",
            description: packConfig.label,
            images:      [],
          },
          unit_amount: packConfig.cents,
        },
      }],
      success_url: successUrl,
      cancel_url:  cancelUrl,
      metadata: {
        type:         "ai_credits",
        creditAmount: String(packConfig.credits),
        pack,
        workspaceId:  String(workspaceId ?? ""),
      },
      allow_promotion_codes: true,
    });

    logger.info({ sessionId: session.id, pack, credits: packConfig.credits }, "AI Credits checkout session created");
    res.json({ sessionId: session.id, url: session.url, credits: packConfig.credits });
  } catch (err) {
    logger.error({ err }, "Failed to create credits checkout session");
    res.status(500).json({ error: "Failed to initiate checkout" });
  }
});

router.get("/portal", async (req, res) => {
  if (!stripe) {
    res.status(503).json({ error: "Stripe is not configured" });
    return;
  }

  const { customerId } = req.query as Record<string, string>;
  if (!customerId) {
    res.status(400).json({ error: "customerId is required" });
    return;
  }

  const domain = appDomain(req);
  const frontendBase = process.env.FRONTEND_BASE_PATH ?? "";

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `https://${domain}${frontendBase}/`,
    });
    res.json({ url: session.url });
  } catch (err) {
    logger.error({ err }, "Failed to create portal session");
    res.status(500).json({ error: "Failed to open billing portal" });
  }
});

export default router;
