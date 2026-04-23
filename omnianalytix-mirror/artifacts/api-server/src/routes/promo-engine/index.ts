/**
 * Promotional Intelligence Engine
 *
 * Feature:  features.promo_engine_enabled (OmniAnalytix Elite tier)
 * CRON:     Hourly — cross-references warehouse_shopify_products (inventory > 500)
 *           with daily_pnl (7-day avg POAS < 1.5). Fires 15% flash discount.
 * Shopify:  POST /admin/api/2024-01/price_rules.json + discount_codes
 * Google:   Customer Asset (Promotion) pushed to lagging campaigns via Google Ads API
 * Queue:    Pending triggers surfaced in /api/actions/pending as ApprovalCardData
 */

import { Router } from "express";
import { eq, and, desc, sql, inArray, isNull } from "drizzle-orm";
import { db, promoTriggers, platformConnections, organizations, warehouseShopifyProducts } from "@workspace/db";
import { decryptCredentials } from "../../lib/credential-helpers";
import { getFreshGoogleCredentials } from "../../lib/google-token-refresh";
import { logger } from "../../lib/logger";
import { customerFromCreds, formatGoogleAdsError, runSingleMutate } from "../../lib/google-ads/client";
import { getOrgId, requireOrgId } from "../../middleware/rbac";
import { handleRouteError } from "../../lib/route-error-handler";

const router = Router();

// ─── Feature flag check ───────────────────────────────────────────────────────
async function isEliteTier(orgId: number | null): Promise<boolean> {
  if (!orgId) {
    const [org] = await db.select({ tier: organizations.subscriptionTier }).from(organizations).where(eq(organizations.slug, "default")).limit(1);
    return org?.tier === "enterprise" || org?.tier === "elite";
  }
  const [org] = await db.select({ tier: organizations.subscriptionTier }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  return org?.tier === "enterprise" || org?.tier === "elite";
}

// ─── Shopify Price Rule + Discount Code creation ──────────────────────────────
async function createShopifyPromo(creds: Record<string, string>, productTitle: string): Promise<{
  priceRuleId: string;
  discountCodeId: string;
  promoCode: string;
}> {
  const shop        = creds.shop ?? creds.shopUrl ?? "";
  const accessToken = creds.accessToken ?? creds.access_token ?? "";
  const shopHost    = shop.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const apiBase     = `https://${shopHost}/admin/api/2024-01`;

  const suffix    = Math.random().toString(36).substring(2, 8).toUpperCase();
  const promoCode = `FLASH15-${suffix}`;
  const startsAt  = new Date().toISOString();
  const endsAt    = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(); // 72h window

  const priceRuleBody = {
    price_rule: {
      title:                  `Flash Sale 15% — ${productTitle.substring(0, 40)}`,
      target_type:            "line_item",
      target_selection:       "all",
      allocation_method:      "across",
      value_type:             "percentage",
      value:                  "-15.0",
      customer_selection:     "all",
      starts_at:              startsAt,
      ends_at:                endsAt,
      usage_limit:            500,
      once_per_customer:      false,
    },
  };

  const priceRuleResp = await fetch(`${apiBase}/price_rules.json`, {
    method:  "POST",
    headers: { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" },
    body:    JSON.stringify(priceRuleBody),
  });

  if (!priceRuleResp.ok) {
    const errBody = await priceRuleResp.text();
    throw new Error(`Shopify price_rule creation failed: ${priceRuleResp.status} — ${errBody.substring(0, 200)}`);
  }

  const { price_rule } = await priceRuleResp.json() as { price_rule: { id: number } };
  const priceRuleId    = String(price_rule.id);

  const codeResp = await fetch(`${apiBase}/price_rules/${priceRuleId}/discount_codes.json`, {
    method:  "POST",
    headers: { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" },
    body:    JSON.stringify({ discount_code: { code: promoCode } }),
  });

  if (!codeResp.ok) {
    throw new Error(`Shopify discount_code creation failed: ${codeResp.status}`);
  }

  const { discount_code } = await codeResp.json() as { discount_code: { id: number } };

  return { priceRuleId, discountCodeId: String(discount_code.id), promoCode };
}

// ─── Google Ads Promotion Asset ───────────────────────────────────────────────
async function pushGoogleAdsPromotion(creds: Record<string, string>, promoCode: string, productTitle: string): Promise<string | null> {
  const resolvedCustomerId = creds.customerId ?? creds.customer_id ?? creds.managerId ?? "";
  const resolvedRefreshToken = creds.refreshToken ?? creds.refresh_token ?? "";
  if (!resolvedCustomerId || !resolvedRefreshToken) return null;

  const creds2: Record<string, string> = {
    ...creds,
    customerId:        resolvedCustomerId,
    refreshToken:      resolvedRefreshToken,
    managerCustomerId: creds.managerCustomerId ?? creds.manager_customer_id ?? creds.loginCustomerId ?? "",
  };

  const startsOn = new Date().toISOString().split("T")[0]!.replace(/-/g, "");
  const endsOn   = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString().split("T")[0]!.replace(/-/g, "");

  try {
    const customer = customerFromCreds(creds2);
    const result = await runSingleMutate(customer, {
      entity: "asset" as const,
      operation: "create" as const,
      resource: {
        name: `PromoEngine — ${promoCode}`,
        promotion_asset: {
          promotion_code:     promoCode,
          percent_off:        15_000_000,
          promotion_target:   productTitle.substring(0, 60),
          start_date:         startsOn,
          end_date:           endsOn,
          occasion:           "NONE",
          redemption_channel: ["STORE"],
        },
      } as Record<string, unknown>,
    });
    if (!result.ok) {
      logger.warn({ failures: result.failures, promoCode }, "Google Ads promotion asset push failed (non-fatal)");
      return null;
    }
    return result.resourceName ?? null;
  } catch (err) {
    logger.warn({ err: formatGoogleAdsError(err), promoCode }, "Google Ads promotion asset push failed (non-fatal)");
    return null;
  }
}

// ─── Core CRON analysis logic ─────────────────────────────────────────────────
type TriggerResult = { triggered: number; skipped: number; errors: number };

export async function runPromoAnalysis(orgId: number): Promise<TriggerResult> {
  // PHASE-3 FIX (Apr 2026): orgId was previously `number | null`, and the
  // hourly cron passed `null` — meaning every query below ran across the
  // entire universe of warehouse rows for ALL tenants. Promo triggers were
  // then stuffed back into the queue with `organizationId: undefined`, so
  // an Elite-tier customer's POAS slump could trigger a "promo" attached to
  // no tenant at all, and the approval flow used whichever Shopify
  // connection drizzle returned first. Now strictly per-tenant; the cron
  // (startPromoCron) enumerates Elite orgs and calls us once per org.
  //
  // Additional fixes in this revision:
  //   • Switched the POAS source from the non-existent `daily_pnl` table
  //     (which silently exception-ed on every product since this feature
  //     shipped) to the existing `v_poas_by_sku` warehouse view, which
  //     already carries `tenant_id`. NOTE: v_poas_by_sku has no date
  //     dimension, so the resulting POAS is a *current snapshot* — not
  //     the original "7-day rolling" intent. Restoring true 7-day windows
  //     requires either (a) adding a synced_at-aware view, or (b) building
  //     a time-aggregated query over warehouse_google_ads + mapping +
  //     warehouse_shopify_products. Tracked as deferred work; current
  //     behaviour still surfaces low-POAS triggers, just not time-windowed.
  //   • Replaced concatenated raw SQL (`'${sku.replace(...)}'`) with
  //     parameterised drizzle `sql` templates — closes a SQL-injection
  //     hole in the SKU and product_id lookup.
  //   • All warehouse + dedup queries now scope on `tenant_id` /
  //     `organization_id`.
  const result: TriggerResult = { triggered: 0, skipped: 0, errors: 0 };
  const tenantId = String(orgId); // warehouse tables store tenant_id as text

  // ── 1. Find high-inventory products for THIS tenant only ────────────────────
  const highInvRows = await db
    .select({
      product_key:   warehouseShopifyProducts.id,
      product_id:    warehouseShopifyProducts.productId,
      sku:           warehouseShopifyProducts.sku,
      product_title: warehouseShopifyProducts.title,
      inventory_qty: warehouseShopifyProducts.inventoryQty,
      cogs:          warehouseShopifyProducts.cogs,
    })
    .from(warehouseShopifyProducts)
    .where(and(
      eq(warehouseShopifyProducts.tenantId, tenantId),
      sql`${warehouseShopifyProducts.inventoryQty} > 500`,
    ))
    .limit(50);

  if (!highInvRows.length) return result;

  // ── 2. For each, compute 7-day avg POAS from v_poas_by_sku ──────────────────
  for (const product of highInvRows) {
    try {
      // Parameterised — no SQL injection on user-controlled sku.
      // SNAPSHOT POAS: see deferred work note above; this is current-state,
      // not 7-day windowed. Variable name kept for promo_triggers.avg_poas_7d
      // column compatibility, but semantically it is a snapshot value.
      // sql-ambiguous-skip: v_poas_by_sku is a single-relation view; no JOIN ambiguity on tenant_id/sku.
      const poasRows = await db.execute(sql`
        SELECT AVG(poas) AS avg_poas
        FROM v_poas_by_sku
        WHERE tenant_id = ${tenantId}
          AND sku = ${product.sku ?? ""}
      `);

      const avgPoas = parseFloat(String((poasRows.rows[0] as { avg_poas?: unknown })?.avg_poas ?? "99"));
      // We no longer have an `avg_profit` column in v_poas_by_sku; project
      // recovery from inventory + COGS instead (units × cogs × 0.15 boost).
      const cogsNum   = Number(product.cogs ?? 0);
      const invNum    = Number(product.inventory_qty ?? 0);
      const avgProfit = cogsNum * invNum * 0.10; // conservative 10 % per-unit margin proxy

      if (isNaN(avgPoas) || avgPoas >= 1.5) {
        result.skipped++;
        continue;
      }

      // ── 3. Dedup: skip if already pending/approved for THIS org this week ───
      const existing = await db
        .select({ id: promoTriggers.id })
        .from(promoTriggers)
        .where(and(
          eq(promoTriggers.organizationId, orgId),
          eq(promoTriggers.productId, product.product_id),
          inArray(promoTriggers.status, ["pending", "approved", "executed"]),
          sql`${promoTriggers.triggeredAt} >= CURRENT_DATE - INTERVAL '7 days'`,
        ))
        .limit(1);

      if (existing.length) { result.skipped++; continue; }

      // ── 4. Projected recovery: est. 15% boost in POAS × avg daily revenue ────
      const projectedRecovery = Math.max(0, Math.abs(avgProfit) * 0.15 * 7).toFixed(2);

      // ── 5. Get Shopify connection (always per-org now) ──────────────────────
      const [shopifyConn] = await db
        .select()
        .from(platformConnections)
        .where(and(
          eq(platformConnections.platform, "shopify"),
          eq(platformConnections.organizationId, orgId),
        ))
        .limit(1);

      if (!shopifyConn) {
        // Insert trigger without Shopify code — will show in queue for manual action
        await db.insert(promoTriggers).values({
          organizationId:    orgId,
          productId:         product.product_id,
          productTitle:      product.product_title ?? null,
          sku:               product.sku ?? null,
          inventoryQty:      Number(product.inventory_qty ?? 0),
          avgPoas7d:         String(avgPoas.toFixed(4)),
          discountPercent:   15,
          projectedRecovery: projectedRecovery,
          status:            "pending",
        });
        result.triggered++;
        continue;
      }

      const shopifyCreds = decryptCredentials(shopifyConn.credentials as Record<string, string>);

      // ── 6. Create Shopify price rule + code ───────────────────────────────────
      let priceRuleId: string | undefined;
      let discountCodeId: string | undefined;
      let promoCode: string | undefined;
      let googleAdsAssetId: string | undefined;

      try {
        const shopifyResult    = await createShopifyPromo(shopifyCreds, product.product_title ?? "Product");
        priceRuleId            = shopifyResult.priceRuleId;
        discountCodeId         = shopifyResult.discountCodeId;
        promoCode              = shopifyResult.promoCode;

        // ── 7. Push Google Ads Promotion Asset (per-org) ──────────────────────
        const [gadsConn] = await db
          .select()
          .from(platformConnections)
          .where(and(
            eq(platformConnections.platform, "google_ads"),
            eq(platformConnections.organizationId, orgId),
          ))
          .limit(1);

        if (gadsConn && promoCode) {
          const freshCreds = (await getFreshGoogleCredentials("google_ads", orgId)) ?? decryptCredentials(gadsConn.credentials as Record<string, string>);
          googleAdsAssetId = (await pushGoogleAdsPromotion(freshCreds, promoCode, product.product_title ?? "Product")) ?? undefined;
        }
      } catch (shopifyErr) {
        logger.warn({ err: shopifyErr, sku: product.sku, orgId }, "Shopify promo creation failed — saving pending trigger without code");
      }

      // ── 8. Insert trigger into approval queue ─────────────────────────────────
      await db.insert(promoTriggers).values({
        organizationId:       orgId,
        productId:            product.product_id,
        productTitle:         product.product_title ?? null,
        sku:                  product.sku ?? null,
        inventoryQty:         Number(product.inventory_qty ?? 0),
        avgPoas7d:            String(avgPoas.toFixed(4)),
        discountPercent:      15,
        promoCode:            promoCode ?? undefined,
        shopifyPriceRuleId:   priceRuleId ?? undefined,
        shopifyDiscountCodeId: discountCodeId ?? undefined,
        googleAdsAssetId:     googleAdsAssetId ?? undefined,
        projectedRecovery:    projectedRecovery,
        status:               "pending",
      });

      logger.info({ orgId, sku: product.sku, avgPoas, promoCode, projectedRecovery }, "PromoEngine: trigger created");
      result.triggered++;
    } catch (err) {
      logger.error({ err, orgId, sku: product.sku }, "PromoEngine: error processing product");
      result.errors++;
    }
  }

  return result;
}

// ─── Approve a promo trigger (execute if not yet executed) ────────────────────
export async function approvePromoTrigger(triggerId: number, orgId: number | null): Promise<{ success: boolean; message: string }> {
  // CVE-9 (Apr 2026, Phase 2C): pre-fix this loaded + updated by `id` only.
  // The orgId param was passed in but only used downstream for the Shopify
  // connection lookup — meaning any authenticated analyst could approve a
  // promo trigger belonging to a DIFFERENT organization simply by guessing
  // the id. Now scopes both the SELECT and the UPDATE to (id, organizationId).
  const orgWhere = orgId != null
    ? eq(promoTriggers.organizationId, orgId)
    : isNull(promoTriggers.organizationId);
  const [trigger] = await db
    .select()
    .from(promoTriggers)
    .where(and(eq(promoTriggers.id, triggerId), orgWhere))
    .limit(1);
  if (!trigger) return { success: false, message: "Trigger not found" };
  if (trigger.status !== "pending") return { success: false, message: `Trigger status is '${trigger.status}' — not pending` };

  try {
    // If Shopify code not yet created (e.g., Shopify was offline at trigger time), create now
    let promoCode           = trigger.promoCode ?? undefined;
    let shopifyPriceRuleId  = trigger.shopifyPriceRuleId ?? undefined;
    let shopifyDiscountCodeId = trigger.shopifyDiscountCodeId ?? undefined;

    if (!promoCode) {
      const shopifyConds = orgId != null
        ? and(eq(platformConnections.platform, "shopify"), eq(platformConnections.organizationId, orgId))
        : eq(platformConnections.platform, "shopify");
      const [shopifyConn] = await db.select().from(platformConnections).where(shopifyConds!).limit(1);

      if (shopifyConn) {
        const creds  = decryptCredentials(shopifyConn.credentials as Record<string, string>);
        const result = await createShopifyPromo(creds, trigger.productTitle ?? "Product");
        promoCode            = result.promoCode;
        shopifyPriceRuleId   = result.priceRuleId;
        shopifyDiscountCodeId = result.discountCodeId;
      }
    }

    await db.update(promoTriggers).set({
      status:               "approved",
      approvedAt:           new Date(),
      executedAt:           new Date(),
      promoCode:            promoCode,
      shopifyPriceRuleId:   shopifyPriceRuleId,
      shopifyDiscountCodeId: shopifyDiscountCodeId,
    }).where(and(eq(promoTriggers.id, triggerId), orgWhere));

    const code = promoCode ? ` — code: ${promoCode}` : "";
    return { success: true, message: `Flash sale approved and activated${code}.` };
  } catch (err) {
    logger.error({ err, triggerId }, "Failed to approve promo trigger");
    return { success: false, message: String(err).substring(0, 200) };
  }
}

// ─── Format trigger as ApprovalCardData (for actions/pending) ─────────────────
export function formatTriggerAsApprovalCard(t: typeof promoTriggers.$inferSelect) {
  const poas = parseFloat(String(t.avgPoas7d ?? "0"));
  const inv  = t.inventoryQty ?? 0;
  const rec  = parseFloat(String(t.projectedRecovery ?? "0"));

  return {
    snapshotId:       -(t.id),               // negative ID = promo trigger
    platform:         "shopify",
    platformLabel:    "Shopify + Google Ads",
    toolName:         "promo_engine_discount",
    toolDisplayName:  `Liquidate Stock: ${t.productTitle ?? t.sku ?? "Product"}`,
    toolArgs:         {
      promoTriggerId:    t.id,
      productId:         t.productId,
      productTitle:      t.productTitle,
      sku:               t.sku,
      discountPercent:   t.discountPercent,
      promoCode:         t.promoCode,
      projectedRecovery: t.projectedRecovery,
    },
    displayDiff: [
      { label: "Product",          from: "—",             to: t.productTitle ?? t.sku ?? "—" },
      { label: "Inventory",        from: "—",             to: `${inv.toLocaleString()} units` },
      { label: "7-Day Avg POAS",   from: `${poas.toFixed(2)}x`, to: "→ Target ≥1.5x" },
      { label: "Discount",         from: "0%",            to: "15% off (Flash Sale)" },
      { label: "Promo Code",       from: "—",             to: t.promoCode ?? "To be generated" },
      { label: "Projected Recovery", from: "—",           to: rec > 0 ? `$${rec.toFixed(0)}` : "Calculated on approve" },
    ],
    reasoning: `POAS alert: ${t.productTitle ?? t.sku} has been below 1.5x for 7 consecutive days (current: ${poas.toFixed(2)}x) while holding ${inv.toLocaleString()} units in inventory. A 15% flash discount is projected to clear excess stock and lift true profit by an estimated $${rec.toFixed(0)} over 7 days. The promo code will be pushed to Google Ads as a Promotion Asset attached to all lagging campaigns.`,
    status:           t.status as "pending" | "executed" | "rejected",
    executionMessage: t.errorMessage ?? undefined,
  };
}

// ─── CRON scheduler (hourly) ──────────────────────────────────────────────────
let cronRunning = false;

export function startPromoCron() {
  const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  const runCron = async () => {
    if (cronRunning) return;
    cronRunning = true;
    try {
      // PHASE-3 FIX (Apr 2026): cron previously called runPromoAnalysis(null)
      // which scanned warehouse rows globally and stuffed orphan triggers
      // into promo_triggers. Now we enumerate Elite-tier orgs and run once
      // per org so each tenant's analysis stays scoped to its own data.
      // Architect-flagged regression fix: isEliteTier() treats both
      // 'elite' AND 'enterprise' as feature-enabled, so the cron filter
      // must match — otherwise enterprise customers see promo_engine_enabled
      // in the API but never get scheduled analysis runs.
      const eligibleOrgs = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(inArray(organizations.subscriptionTier, ["elite", "enterprise"]));

      if (!eligibleOrgs.length) {
        logger.debug("PromoEngine: CRON skipped — no Elite/Enterprise-tier orgs");
        return;
      }

      logger.info({ orgCount: eligibleOrgs.length }, "PromoEngine: CRON analysis started");
      const totals = { triggered: 0, skipped: 0, errors: 0 };
      for (const { id } of eligibleOrgs) {
        try {
          const r = await runPromoAnalysis(id);
          totals.triggered += r.triggered;
          totals.skipped   += r.skipped;
          totals.errors    += r.errors;
        } catch (err) {
          logger.error({ err, orgId: id }, "PromoEngine: per-org CRON failed");
          totals.errors++;
        }
      }
      logger.info(totals, "PromoEngine: CRON complete");
    } catch (err) {
      logger.error({ err }, "PromoEngine: CRON error");
    } finally {
      cronRunning = false;
    }
  };

  // Run immediately on startup (after 10s delay for DB to settle)
  setTimeout(() => { void runCron(); }, 10_000);
  setInterval(() => { void runCron(); }, INTERVAL_MS);

  logger.info("PromoEngine: CRON scheduled (hourly)");
}

// ═════════════════════════════════════════════════════════════════════════════
// REST ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/promo-engine/status
router.get("/status", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const elite = await isEliteTier(orgId);
    res.json({ enabled: elite, feature: "promo_engine_enabled", tier: elite ? "elite" : "non-elite" });
  } catch {
    res.json({ enabled: false });
  }
});

// GET /api/promo-engine/stats
router.get("/stats", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    // CVE-10 (Apr 2026, Phase 2C): pre-fix declared `orgFilter` as a sql``
    // template but the actual `sql.raw(...)` block IGNORED it and used inline
    // string interpolation — including a `1=1` fallback when orgId was null,
    // which leaked aggregate stats across every tenant. Now uses the sql``
    // template via parameter binding (no .raw), with a `1=0` fail-closed
    // fallback when org context is absent.
    const orgFilter = orgId != null
      ? sql`${promoTriggers.organizationId} = ${orgId}`
      : sql`1=0`;

    const result = await db.execute(sql`
      SELECT
        COUNT(*)                                                                                       AS total,
        COUNT(*) FILTER (WHERE status = 'pending')                                                     AS pending,
        COUNT(*) FILTER (WHERE status IN ('approved','executed'))                                      AS approved,
        COUNT(*) FILTER (WHERE status = 'rejected')                                                    AS rejected,
        COALESCE(SUM(projected_recovery::numeric) FILTER (WHERE status IN ('approved','executed')), 0) AS total_recovery
      FROM promo_triggers
      WHERE ${orgFilter}
    `);
    const stats = result.rows[0];

    res.json(stats ?? { total: 0, pending: 0, approved: 0, rejected: 0, total_recovery: 0 });
  } catch (err) {
    logger.error({ err }, "promo-engine stats error");
    res.status(500).json({ error: "Failed to load stats" });
  }
});

// GET /api/promo-engine/triggers
router.get("/triggers", async (req, res) => {
  try {
    const orgId      = getOrgId(req);
    const statusRaw  = typeof req.query.status === "string" ? req.query.status : undefined;
    const limitRaw   = Number(req.query.limit ?? 50);
    const limit      = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 200)) : 50;

    // Pre-Apr 2026 this built `whereClause` via string interpolation and ran
    // `sql.raw(...)`. orgId was a number (safe) but status was user-controlled
    // and only escaped via naive `'` → `''` substitution — fragile against
    // backslash / Unicode injection tricks. Rewritten to Drizzle query builder
    // with parameter binding (Phase 2C CVE, fixed Apr 2026).
    const VALID_STATUSES = ["pending", "approved", "rejected", "executed"] as const;
    const status = statusRaw && (VALID_STATUSES as readonly string[]).includes(statusRaw)
      ? statusRaw
      : undefined;

    const conds = [];
    if (orgId != null) conds.push(eq(promoTriggers.organizationId, orgId));
    else               conds.push(sql`1=0`); // no org context → return nothing
    if (status)        conds.push(eq(promoTriggers.status, status));

    const rows = await db
      .select()
      .from(promoTriggers)
      .where(and(...conds))
      .orderBy(desc(promoTriggers.triggeredAt))
      .limit(limit);

    res.json({ triggers: rows });
  } catch (err) {
    logger.error({ err }, "promo-engine list error");
    res.status(500).json({ error: "Failed to list triggers" });
  }
});

// POST /api/promo-engine/run — manual trigger of CRON analysis
router.post("/run", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    if (orgId == null) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!(await isEliteTier(orgId))) {
      res.status(403).json({ error: "Requires OmniAnalytix Elite tier" });
      return;
    }
    const result = await runPromoAnalysis(orgId);
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error({ err }, "promo-engine manual run error");
    res.status(500).json({ error: "Analysis failed" });
  }
});

// POST /api/promo-engine/triggers/:id/approve
router.post("/triggers/:id/approve", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const orgId  = getOrgId(req);
  const result = await approvePromoTrigger(id, orgId);
  res.status(result.success ? 200 : 500).json(result);
});

// POST /api/promo-engine/triggers/:id/reject
router.post("/triggers/:id/reject", async (req, res) => {
  const id    = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const orgId = requireOrgId(req);
  try {
    // Tenant-scope the UPDATE: only mutate if the trigger belongs to caller's org.
    // Pre-fix this handler accepted any id and updated globally — any authed user
    // could reject any org's promo trigger (Phase 2C CVE, fixed Apr 2026).
    const result = await db
      .update(promoTriggers)
      .set({ status: "rejected", rejectedAt: new Date() })
      .where(and(eq(promoTriggers.id, id), eq(promoTriggers.organizationId, orgId)))
      .returning({ id: promoTriggers.id });
    if (result.length === 0) {
      // Use 404 (not 403) to avoid existence-enumeration; matches tenant-guards.ts policy.
      res.status(404).json({ error: "Trigger not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    handleRouteError(err, req, res, "POST /api/promo-engine/triggers/:id/reject", { error: "Failed to reject" });
  }
});

export default router;
