import { Router } from "express";
import { eq, and, isNull } from "drizzle-orm";
import { db, platformConnections } from "@workspace/db";
import { getOrgGuardrails, getOrgDailyUsage } from "../../lib/ai-gads-usage";
import { logger } from "../../lib/logger";
import { decryptCredentials } from "../../lib/credential-helpers";
import { setTeamsWebhookUrl } from "../../lib/alert-store";
import { pingCache, getCacheRollingStats, getCacheHitRateHistory } from "../../lib/cache";
import { getOrgId } from "../../middleware/rbac";
import {
  shopify_calculateSalesVelocity,
  googleAds_calculateAIAdoptionScore,
  googleAds_identifyBudgetConstraints,
  shopify_computePOASMetrics,
  googleAds_getPMaxNetworkDistribution,
} from "../../lib/platform-executors";

const router = Router();

// ─── GET /system/diagnostic-sweep ────────────────────────────────────────────
// God Mode: concurrent full-ecosystem audit via Promise.allSettled
router.get("/diagnostic-sweep", async (req, res) => {
  try {
    const sysOrgId = getOrgId(req);
    const sysConditions = sysOrgId != null
      ? eq(platformConnections.organizationId, sysOrgId)
      : isNull(platformConnections.organizationId);
    const connections = await db.select().from(platformConnections).where(sysConditions);
    const credsByPlatform: Record<string, Record<string, string>> = {};
    for (const conn of connections) {
      if (conn.isActive) {
        credsByPlatform[conn.platform] = decryptCredentials(conn.credentials as Record<string, string>);
      }
    }

    const gads = credsByPlatform["google_ads"];
    const shopify = credsByPlatform["shopify"];

    // ── Run all audits concurrently — failures don't block others ──
    const [
      inventoryResult,
      aiAdoptionResult,
      budgetResult,
      poasResult,
      pmaxResult,
    ] = await Promise.allSettled([
      shopify
        ? shopify_calculateSalesVelocity(shopify, "all")
        : Promise.resolve({ success: false, message: "Shopify not connected." }),

      gads
        ? googleAds_calculateAIAdoptionScore(gads)
        : Promise.resolve({ success: false, message: "Google Ads not connected." }),

      gads
        ? googleAds_identifyBudgetConstraints(gads)
        : Promise.resolve({ success: false, message: "Google Ads not connected." }),

      // Per-product POAS requires productId/spend/revenue inputs that this
      // diagnostic-sweep endpoint does not have. Surface a clear "not applicable"
      // result so the sweep payload stays well-typed without invoking the executor.
      Promise.resolve({
        success: false,
        message: shopify
          ? "POAS sweep requires per-product input — use the per-SKU view."
          : "Shopify not connected.",
      }) as Promise<{ success: boolean; message: string; data?: Record<string, unknown> }>,

      gads
        ? googleAds_getPMaxNetworkDistribution(gads)
        : Promise.resolve({ success: false, message: "Google Ads not connected." }),
    ]);

    const extract = (settled: PromiseSettledResult<{ success: boolean; message: string; data?: Record<string, unknown> }>) =>
      settled.status === "fulfilled"
        ? settled.value
        : { success: false, message: settled.reason instanceof Error ? settled.reason.message : String(settled.reason) };

    const inventory  = extract(inventoryResult);
    const aiAdoption = extract(aiAdoptionResult);
    const budget     = extract(budgetResult);
    const poas       = extract(poasResult);
    const pmax       = extract(pmaxResult);

    // ── Aggregate into severity buckets ──
    const critical_issues: string[] = [];
    const warnings: string[] = [];
    const healthy_metrics: string[] = [];

    // POAS analysis
    if (poas.success) {
      const msg = poas.message ?? "";
      if (msg.toLowerCase().includes("negative") || msg.toLowerCase().includes("loss")) {
        critical_issues.push(`POAS: ${msg}`);
      } else {
        healthy_metrics.push(`POAS: ${msg}`);
      }
    }

    // Budget constraints
    if (budget.success) {
      const msg = budget.message ?? "";
      if (msg.toLowerCase().includes("limited") || msg.toLowerCase().includes("capped") || msg.toLowerCase().includes("constrained")) {
        critical_issues.push(`Budget: ${msg}`);
      } else {
        warnings.push(`Budget: ${msg}`);
      }
    } else if (budget.message !== "Google Ads not connected.") {
      warnings.push(`Budget audit error: ${budget.message}`);
    }

    // AI adoption
    if (aiAdoption.success) {
      const msg = aiAdoption.message ?? "";
      if (msg.toLowerCase().includes("grade: d") || msg.toLowerCase().includes("grade: f") || msg.includes("<30%")) {
        critical_issues.push(`AI Adoption: ${msg}`);
      } else if (msg.toLowerCase().includes("grade: c") || msg.includes("<60%")) {
        warnings.push(`AI Adoption: ${msg}`);
      } else {
        healthy_metrics.push(`AI Adoption: ${msg}`);
      }
    }

    // Inventory / stockouts
    if (inventory.success) {
      const msg = inventory.message ?? "";
      if (msg.toLowerCase().includes("critical") || msg.toLowerCase().includes("0 days") || msg.toLowerCase().includes("stockout")) {
        critical_issues.push(`Inventory: ${msg}`);
      } else if (msg.toLowerCase().includes("risk") || msg.toLowerCase().includes("low")) {
        warnings.push(`Inventory: ${msg}`);
      } else {
        healthy_metrics.push(`Inventory: ${msg}`);
      }
    }

    // PMax cannibalization
    if (pmax.success) {
      const msg = pmax.message ?? "";
      if (msg.toLowerCase().includes("cannibal") || msg.toLowerCase().includes("display >30%")) {
        warnings.push(`PMax: ${msg}`);
      } else {
        healthy_metrics.push(`PMax: ${msg}`);
      }
    }

    // Connected platform count
    const connectedCount = connections.filter((c) => c.isActive).length;
    healthy_metrics.push(`Platforms connected: ${connectedCount}`);

    logger.info({ critical: critical_issues.length, warnings: warnings.length }, "Diagnostic sweep complete");

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        critical_count: critical_issues.length,
        warning_count: warnings.length,
        healthy_count: healthy_metrics.length,
      },
      critical_issues,
      warnings,
      healthy_metrics,
      raw: { inventory, aiAdoption, budget, poas, pmax },
    });
  } catch (err) {
    logger.error({ err }, "Diagnostic sweep error");
    res.status(500).json({ success: false, error: "Diagnostic sweep failed", details: "An unexpected error occurred" });
  }
});

// ─── GET /system/cache-health ────────────────────────────────────────────────
// Reports shared-cache backend ("memory" | "redis"), a quick PING result, and
// the last error timestamp. Always returns 200 — a broken cache surfaces as
// { ok: false, reason } so the dashboard pill can flip red without the route
// itself becoming a failure mode.
router.get("/cache-health", async (_req, res) => {
  try {
    const health = await pingCache();
    return res.json(health);
  } catch (err) {
    // pingCache() is supposed to never throw, but belt-and-suspenders.
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "cache-health unexpected throw");
    const rolling = getCacheRollingStats();
    return res.json({
      ok: false,
      backend: "memory",
      configuredBackend: process.env.SHARED_CACHE_REDIS_URL ? "redis" : "memory",
      pingMs: null,
      reason,
      lastErrorAt: new Date().toISOString(),
      lastErrorReason: reason,
      hitRate: rolling.hitRate,
      hitsLastHour: rolling.hits,
      missesLastHour: rolling.misses,
      bypassesLastHour: rolling.bypasses,
      history: getCacheHitRateHistory(),
    });
  }
});

// ─── POST /system/feedback ────────────────────────────────────────────────────
// Accepts bug reports & feedback from the HelpDrawer UI
router.post("/feedback", async (req, res) => {
  try {
    const { category, description } = req.body as { category?: string; description?: string };
    if (!category || !description?.trim()) {
      return res.status(400).json({ success: false, error: "category and description are required" });
    }
    logger.info({ category, description: description.slice(0, 500) }, "User feedback received");
    return res.json({ success: true, message: "Feedback received. Thank you!" });
  } catch (err) {
    logger.error({ err }, "Feedback submission error");
    return res.status(500).json({ success: false, error: "Failed to save feedback" });
  }
});

// ─── POST /system/feedback/micro ─────────────────────────────────────────────
// Accepts inline thumbs-up / thumbs-down micro-feedback from chat messages
router.post("/feedback/micro", async (req, res) => {
  try {
    const { sentiment, reasons = [], textContext = "", messageExcerpt = "" } =
      req.body as { sentiment?: string; reasons?: string[]; textContext?: string; messageExcerpt?: string };
    if (!sentiment || !["up", "down"].includes(sentiment)) {
      return res.status(400).json({ success: false, error: "sentiment must be 'up' or 'down'" });
    }
    logger.info(
      { sentiment, reasons, textContext: textContext.slice(0, 300), excerpt: messageExcerpt.slice(0, 200) },
      "Micro-feedback received",
    );
    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Micro-feedback error");
    return res.status(500).json({ success: false, error: "Failed to save micro-feedback" });
  }
});

// ─── POST /system/alerts/webhook ──────────────────────────────────────────────
// Stores webhook URL and optionally sends a test ping; Live Triage will call this URL for critical alerts
router.post("/alerts/webhook", async (req, res) => {
  try {
    const { webhookUrl } = req.body as { webhookUrl?: string };
    if (!webhookUrl?.startsWith("http")) {
      return res.status(400).json({ success: false, error: "A valid webhook URL is required" });
    }
    logger.info({ webhookUrl }, "Webhook URL saved");
    setTeamsWebhookUrl(webhookUrl);

    // Fire a verification ping to the webhook (non-blocking, best-effort)
    fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "✅ OmniAnalytix webhook connected. Critical Live Triage alerts will be sent here.",
        source: "OmniAnalytix",
      }),
    }).catch(() => { /* ignore if webhook unreachable */ });

    return res.json({ success: true, message: "Webhook URL saved and test ping sent." });
  } catch (err) {
    logger.error({ err }, "Webhook save error");
    return res.status(500).json({ success: false, error: "Failed to save webhook URL" });
  }
});

// ─── GET /system/ai-gads-usage ───────────────────────────────────────────────
// Operator metric: AI-driven Google Ads row reads per day (Task #159).
// Returns guardrails config + daily usage for last N days.
router.get("/ai-gads-usage", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    if (orgId == null) return res.status(400).json({ error: "No organisation context." });
    const days = Math.max(1, Math.min(90, Number(req.query.days ?? 30)));
    const guardrails = await getOrgGuardrails(orgId);
    const usage = await getOrgDailyUsage(orgId, guardrails, days);
    return res.json({
      guardrails: {
        maxLookbackDays: guardrails.maxLookbackDays,
        dailyRowCap:     guardrails.dailyRowCap,
      },
      usage,
    });
  } catch (err) {
    logger.error({ err }, "ai-gads-usage fetch error");
    return res.status(500).json({ error: "Failed to retrieve AI Ads usage." });
  }
});

export default router;
