import app from "./app";
import { logger } from "./lib/logger";
import { db, organizations, workspaces, platformConnections } from "@workspace/db";
import { runWritebackRetryScheduler } from "./workers/shoptimizer-writeback";
import { eq, sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import { runSystemSelfAudit } from "./services/system-health-monitor";
import { startSRA } from "./agents/infrastructure/sra";
import { startRemediationAgent } from "./services/remediation-agent";
import { encryptCredentials } from "./lib/credential-helpers";
import { validateBigQueryOnBoot } from "./lib/bigquery-client";
import { encrypt as _credentialVaultEncryptProbe } from "./lib/credential-vault";
import { startShoppingInsiderCostAlerter } from "./lib/shopping-insider-cost-alerter";
import { startWorkspaceHealthScheduler } from "./services/workspace-health-scheduler";

// SEC-06: Boot-time invariant — outside dev/test, refuse to start the server
// if DB_CREDENTIAL_ENCRYPTION_KEY is not set. The vault's encrypt() throws
// when the dedicated key is missing, so a single test-encrypt at boot
// surfaces misconfiguration before any request can be served and before any
// credential is ever encrypted with a fallback secret.
{
  const env = (process.env.NODE_ENV ?? "").toLowerCase();
  const isDevOrTest = env === "development" || env === "test";
  if (!isDevOrTest) {
    try {
      _credentialVaultEncryptProbe("boot-probe");
    } catch (err) {
      logger.fatal(
        { err: err instanceof Error ? err.message : String(err), nodeEnv: process.env.NODE_ENV },
        "[Boot] Credential vault is not safely configured — refusing to start (SEC-06). " +
        "Set DB_CREDENTIAL_ENCRYPTION_KEY to a 32-byte random hex secret.",
      );
      process.exit(1);
    }
  }
}

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "[Process] Unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "[Process] Uncaught exception — shutting down");
  process.exit(1);
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // ── Seed default organization + workspace ────────────────────────────────────
  void (async () => {
    try {
      let [org] = await db.select().from(organizations).where(eq(organizations.slug, "default"));
      if (!org) {
        [org] = await db.insert(organizations).values({ name: "OmniAnalytix Agency", slug: "default" }).returning();
        logger.info("Seeded default organization");
      }

      const existing = await db.select().from(workspaces).where(eq(workspaces.organizationId, org.id));
      if (existing.length === 0) {
        await db.insert(workspaces).values({
          organizationId:      org.id,
          clientName:          "Default Workspace",
          slug:                "default",
          enabledIntegrations: ["google_ads", "shopify", "meta", "ga4"],
          inviteToken:         randomBytes(24).toString("hex"),
          status:              "active",
          notes:               "Auto-provisioned on first boot",
        });
        logger.info("Seeded default workspace");
      }
    } catch (seedErr) {
      logger.warn({ err: seedErr }, "Startup seed failed (non-fatal)");
    }

    try {
      await db.execute(sql`
        CREATE OR REPLACE VIEW v_ads_on_empty_shelves AS
        SELECT
          ga.campaign_name, ga.ad_group_name, ga.ad_id, ga.final_url,
          ga.cost_usd, ga.impressions, ga.clicks, ga.conversions,
          ga.status AS ad_status,
          sp.title AS product_title, sp.sku, sp.inventory_qty,
          sp.price AS product_price, sp.status AS product_status,
          m.match_type, m.confidence, ga.tenant_id
        FROM warehouse_google_ads ga
        JOIN warehouse_cross_platform_mapping m ON m.google_ad_id = ga.ad_id
        JOIN warehouse_shopify_products sp ON sp.product_id = m.shopify_product_id
        WHERE sp.inventory_qty <= 0
        ORDER BY ga.cost_usd DESC
      `);
      await db.execute(sql`
        CREATE OR REPLACE VIEW v_poas_by_sku AS
        SELECT
          sp.sku, sp.title AS product_title, sp.price AS product_price,
          sp.cogs, sp.inventory_qty,
          SUM(ga.cost_usd) AS total_ad_spend,
          SUM(ga.conversions) AS total_conversions,
          SUM(ga.clicks) AS total_clicks,
          SUM(ga.impressions) AS total_impressions,
          CASE WHEN SUM(ga.cost_usd) > 0 THEN
            (SUM(ga.conversions) * sp.price - SUM(ga.cost_usd) - SUM(ga.conversions) * COALESCE(sp.cogs, 0)) / SUM(ga.cost_usd)
          ELSE 0 END AS poas,
          CASE WHEN SUM(ga.cost_usd) > 0 THEN
            SUM(ga.conversions) * sp.price / SUM(ga.cost_usd)
          ELSE 0 END AS gross_roas,
          ga.tenant_id
        FROM warehouse_shopify_products sp
        JOIN warehouse_cross_platform_mapping m ON m.shopify_product_id = sp.product_id
        JOIN warehouse_google_ads ga ON ga.ad_id = m.google_ad_id
        GROUP BY sp.sku, sp.title, sp.price, sp.cogs, sp.inventory_qty, ga.tenant_id
        ORDER BY total_ad_spend DESC
      `);
      logger.info("Warehouse views ensured (v_ads_on_empty_shelves, v_poas_by_sku)");
    } catch (viewErr) {
      logger.warn({ err: viewErr }, "Warehouse view creation failed (non-fatal)");
    }

    try {
      const SENSITIVE_KEYS = ["accessToken", "refreshToken", "developerToken", "serviceAccountKey"];
      const allConns = await db.select({ id: platformConnections.id, credentials: platformConnections.credentials }).from(platformConnections);
      let backfilled = 0;
      for (const conn of allConns) {
        const creds = conn.credentials as Record<string, string> | null;
        if (!creds) continue;
        let needsEncrypt = false;
        for (const k of SENSITIVE_KEYS) {
          const v = creds[k];
          if (v && !v.includes(":")) {
            needsEncrypt = true;
            break;
          }
        }
        if (needsEncrypt) {
          await db.update(platformConnections).set({ credentials: encryptCredentials(creds) }).where(eq(platformConnections.id, conn.id));
          backfilled++;
        }
      }
      if (backfilled > 0) {
        logger.info({ count: backfilled }, "Backfilled plaintext credentials with encryption");
      }
    } catch (backfillErr) {
      logger.warn({ err: backfillErr }, "Credential backfill failed (non-fatal)");
    }
  })();

  // ── Shopping Insider BigQuery boot validation (non-fatal) ────────────────────
  // Logs a clear status line so misconfiguration is visible at startup rather
  // than only on first request. We do not crash the server if Shopping Insider
  // is intentionally not configured for this deployment.
  void (async () => {
    try {
      const result = await validateBigQueryOnBoot();
      if (result.ok) {
        logger.info({ detail: result.message }, "[ShoppingInsider] BigQuery validated on boot");
      } else {
        logger.warn(
          { detail: result.message },
          "[ShoppingInsider] BigQuery not configured or unreachable — /api/insights/shopping/* endpoints will return 503 BIGQUERY_NOT_CONFIGURED until fixed",
        );
      }
    } catch (err) {
      logger.warn({ err }, "[ShoppingInsider] Boot validation threw unexpectedly");
    }
  })();

  // ── Agentic services startup ─────────────────────────────────────────────────
  startRemediationAgent();
  startSRA();

  // ── Shopping Insider BigQuery cost alerter ───────────────────────────────────
  startShoppingInsiderCostAlerter();

  // ── Google Workspace background health scheduler (every 2 h) ─────────────────
  startWorkspaceHealthScheduler();

  // ── Promotional Intelligence Engine CRON (hourly) ────────────────────────────
  (async () => {
    try {
      const { startPromoCron } = await import("./routes/promo-engine/index");
      startPromoCron();
    } catch (err) {
      logger.warn({ err }, "PromoEngine CRON failed to start (non-fatal)");
    }
  })();

  // ── FX rates daily refresh ───────────────────────────────────────────────────
  (async () => {
    try {
      const { startFxRatesCron } = await import("./lib/fx-rates");
      startFxRatesCron();
    } catch (err) {
      logger.warn({ err }, "[FX] daily cron failed to start (non-fatal)");
    }
  })();

  const HEALTH_INTERVAL_MS = 15 * 60 * 1000;
  setTimeout(() => {
    runSystemSelfAudit().catch((err) =>
      logger.warn({ err }, "[HealthMonitor] Initial audit failed (non-fatal)"),
    );
  }, 10_000);

  const healthTimer = setInterval(() => {
    runSystemSelfAudit().catch((err) =>
      logger.warn({ err }, "[HealthMonitor] Scheduled audit failed (non-fatal)"),
    );
  }, HEALTH_INTERVAL_MS);
  healthTimer.unref();

  // ── Quality Fixes scanner CRON (refreshes Shoptimizer diffs in background) ──
  (async () => {
    try {
      const { startQualityFixesCron } = await import("./workers/quality-fixes-scanner");
      startQualityFixesCron();
    } catch (err) {
      logger.warn({ err }, "[QualityFixesScanner] Failed to start (non-fatal)");
    }
  })();

  // ── FeedGen runner CRON (refreshes AI title/description rewrites) ──────────
  // Disabled by default in dev (FEEDGEN_CRON_ENABLED=1 to opt in) so we don't
  // burn Vertex quota on every restart. Production turns it on explicitly.
  if (process.env.FEEDGEN_CRON_ENABLED === "1") {
    (async () => {
      try {
        const { startFeedgenCron } = await import("./workers/feedgen-runner");
        startFeedgenCron();
      } catch (err) {
        logger.warn({ err }, "[feedgen-runner] Failed to start (non-fatal)");
      }
    })();
  }

  // ── FeedGen crash-recovery sweeper ────────────────────────────────────────
  // Always on (cheap DB-only sweep — no Vertex calls). Rescues rows stuck in
  // `processing` past PROCESSING_TIMEOUT_MS so a crashed worker doesn't hold
  // SKUs hostage for hours waiting for the next selection tick to notice.
  (async () => {
    try {
      const { startFeedgenRecoveryCron } = await import("./workers/feedgen-runner");
      startFeedgenRecoveryCron();
    } catch (err) {
      logger.warn({ err }, "[FeedgenRecovery] Failed to start (non-fatal)");
    }
  })();

  // ── Writeback retry scheduler ─────────────────────────────────────────────
  // Periodically drains failed-but-retryable Merchant Center write-back tasks
  // whose `next_retry_at` window has elapsed. Non-retryable failures (auth /
  // validation) are never picked up — they have no `next_retry_at`.
  // Interval is configurable via WRITEBACK_RETRY_INTERVAL_MS (default: 5 min).
  const WRITEBACK_RETRY_INTERVAL_MS = (() => {
    const raw = process.env.WRITEBACK_RETRY_INTERVAL_MS;
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
      logger.warn({ raw }, "[WritebackRetry] Invalid WRITEBACK_RETRY_INTERVAL_MS — using default 5 min");
    }
    return 5 * 60 * 1_000; // 5 minutes
  })();
  logger.info({ intervalMs: WRITEBACK_RETRY_INTERVAL_MS }, "[WritebackRetry] Scheduler registered");
  const retryDrainTimer = setInterval(() => {
    runWritebackRetryScheduler().catch((err) =>
      logger.warn({ err }, "[WritebackRetry] Scheduler tick failed (non-fatal)"),
    );
  }, WRITEBACK_RETRY_INTERVAL_MS);
  retryDrainTimer.unref();
});
