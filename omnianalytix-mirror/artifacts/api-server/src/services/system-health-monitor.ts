import { db, platformConnections, liveTriageAlerts, warehouseShopifyProducts, warehouseGoogleAds } from "@workspace/db";
import { eq, sql, and, desc, count, max } from "drizzle-orm";
import { logger } from "../lib/logger";
import { recordInfraAlert, resolveInfraAlert } from "../lib/alert-store";
import { getFreshGoogleCredentials } from "../lib/google-token-refresh";
import { decryptCredentials } from "../lib/credential-helpers";
import { customerFromCreds } from "../lib/google-ads/client";
import { getGoogleGenAI, VERTEX_MODEL } from "../lib/vertex-client";
import { etlState } from "../lib/etl-state";
import { getQualityFixesScannerStatus } from "../workers/quality-fixes-scanner";

// The Quality Fixes cron is configured to fire every 30 min. Allow 3x that
// before flagging it as stuck — covers a single missed tick (e.g. a long-
// running batch) without firing spurious alerts.
const QUALITY_FIXES_STALE_MS = 90 * 60 * 1000;

export interface HealthCheckResult {
  check: string;
  ok: boolean;
  latencyMs: number;
  detail?: string;
}

const PROBE_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function isValidShopifyDomain(domain: string): boolean {
  if (!domain || typeof domain !== "string") return false;
  if (domain.endsWith(".myshopify.com")) return true;
  if (/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    const lower = domain.toLowerCase();
    if (lower === "localhost" || lower.startsWith("127.") || lower.startsWith("10.")
        || lower.startsWith("192.168.") || lower.includes("169.254.")
        || lower.includes("metadata.google") || lower.includes("metadata.aws")) {
      return false;
    }
    return true;
  }
  return false;
}

// ─── Data Integrity Validator ─────────────────────────────────────────────────
//
// Replaces the simple SELECT 1 connection ping with a three-stage check:
//
//   Stage 1 — Connectivity:  SELECT 1 with a 5 s timeout (fast-fail)
//   Stage 2 — Freshness:     Verify that warehouse rows were synced within
//                             the last 24 hours (detects stalled ETL jobs)
//   Stage 3 — Drift:         Cross-check live DB row counts against the last
//                             ETL sync counts stored in etlState.lastResult.
//                             > 20 % delta  → detail warning (still ok: true)
//                             > 50 % delta  → check fails (ok: false)
//
// The drift threshold catches silent data-loss scenarios such as a partial ETL
// run, a botched upsert, or a remote API returning fewer records than expected.
// ─────────────────────────────────────────────────────────────────────────────
const DRIFT_WARN_PCT   = 0.20;  // 20 % — surface a warning detail
const DRIFT_FAIL_PCT   = 0.50;  // 50 % — treat as a failure
const STALE_HOURS      = 24;    // Hours before warehouse data is considered stale

async function checkDataIntegrity(): Promise<HealthCheckResult> {
  const start = Date.now();
  const findings: string[] = [];

  // ── Stage 1: Connectivity ──────────────────────────────────────────────────
  try {
    await withTimeout(db.execute(sql`SELECT 1`), 5000, "DB ping");
  } catch (err: any) {
    return {
      check: "database",
      ok: false,
      latencyMs: Date.now() - start,
      detail: `DB unreachable: ${err?.message?.slice(0, 150) ?? "timeout"}`,
    };
  }

  // ── Stage 2: Freshness ────────────────────────────────────────────────────
  try {
    const [shopifyFresh, googleFresh] = await Promise.all([
      db.select({ latest: max(warehouseShopifyProducts.syncedAt) }).from(warehouseShopifyProducts),
      db.select({ latest: max(warehouseGoogleAds.syncedAt) }).from(warehouseGoogleAds),
    ]);

    const staleThresholdMs = STALE_HOURS * 60 * 60 * 1000;
    const now = Date.now();

    const shopifyLatest = shopifyFresh[0]?.latest;
    const googleLatest  = googleFresh[0]?.latest;

    if (shopifyLatest && now - new Date(shopifyLatest).getTime() > staleThresholdMs) {
      findings.push(`Shopify warehouse stale (last sync: ${new Date(shopifyLatest).toISOString()})`);
    }
    if (googleLatest && now - new Date(googleLatest).getTime() > staleThresholdMs) {
      findings.push(`Google Ads warehouse stale (last sync: ${new Date(googleLatest).toISOString()})`);
    }
  } catch {
    // Non-fatal — warehouse tables may not exist yet on fresh installs
  }

  // ── Stage 3: Row-Count Drift ──────────────────────────────────────────────
  if (etlState.lastResult !== null) {
    try {
      const [shopifyCount, googleCount] = await Promise.all([
        db.select({ n: count() }).from(warehouseShopifyProducts),
        db.select({ n: count() }).from(warehouseGoogleAds),
      ]);

      const dbShopify   = Number(shopifyCount[0]?.n ?? 0);
      const dbGoogle    = Number(googleCount[0]?.n ?? 0);
      const etlShopify  = etlState.lastResult.shopify;
      const etlGoogle   = etlState.lastResult.googleAds;

      function driftPct(db: number, etl: number): number {
        if (etl === 0) return 0;
        return Math.abs(db - etl) / etl;
      }

      const shopifyDrift = driftPct(dbShopify, etlShopify);
      const googleDrift  = driftPct(dbGoogle, etlGoogle);

      if (shopifyDrift > DRIFT_FAIL_PCT) {
        findings.push(
          `CRITICAL drift — Shopify: DB has ${dbShopify} rows, last ETL synced ${etlShopify} (${(shopifyDrift * 100).toFixed(0)}% delta)`,
        );
      } else if (shopifyDrift > DRIFT_WARN_PCT) {
        findings.push(
          `Shopify row drift ${(shopifyDrift * 100).toFixed(0)}%: DB ${dbShopify} vs ETL ${etlShopify}`,
        );
      }

      if (googleDrift > DRIFT_FAIL_PCT) {
        findings.push(
          `CRITICAL drift — Google Ads: DB has ${dbGoogle} rows, last ETL synced ${etlGoogle} (${(googleDrift * 100).toFixed(0)}% delta)`,
        );
      } else if (googleDrift > DRIFT_WARN_PCT) {
        findings.push(
          `Google Ads row drift ${(googleDrift * 100).toFixed(0)}%: DB ${dbGoogle} vs ETL ${etlGoogle}`,
        );
      }

      const hasCritical = findings.some((f) => f.startsWith("CRITICAL"));
      if (hasCritical) {
        return {
          check: "database",
          ok: false,
          latencyMs: Date.now() - start,
          detail: findings.join(" | ").slice(0, 300),
        };
      }
    } catch {
      // Non-fatal — row counts are best-effort
    }
  }

  return {
    check: "database",
    ok: true,
    latencyMs: Date.now() - start,
    detail: findings.length > 0 ? findings.join(" | ").slice(0, 300) : undefined,
  };
}

async function checkEtlIntegrity(): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const conns = await db
      .select({ platform: platformConnections.platform, createdAt: platformConnections.createdAt })
      .from(platformConnections)
      .where(eq(platformConnections.isActive, true));

    if (!conns || conns.length === 0) {
      return { check: "etl_integrity", ok: true, latencyMs: Date.now() - start, detail: "No active connections — skipped" };
    }

    const recentAlerts = await db
      .select({ id: liveTriageAlerts.id, title: liveTriageAlerts.title, severity: liveTriageAlerts.severity })
      .from(liveTriageAlerts)
      .where(
        and(
          eq(liveTriageAlerts.resolvedStatus, false),
          sql`${liveTriageAlerts.type} != 'System_Infrastructure'`,
          eq(liveTriageAlerts.severity, "critical"),
        ),
      )
      .orderBy(desc(liveTriageAlerts.createdAt))
      .limit(10);

    if (recentAlerts.length >= 5) {
      return {
        check: "etl_integrity",
        ok: false,
        latencyMs: Date.now() - start,
        detail: `${recentAlerts.length} unresolved critical business alerts across ${conns.length} connections`,
      };
    }

    return { check: "etl_integrity", ok: true, latencyMs: Date.now() - start };
  } catch (err: any) {
    return {
      check: "etl_integrity",
      ok: false,
      latencyMs: Date.now() - start,
      detail: err?.message?.slice(0, 200) ?? "ETL check failed",
    };
  }
}

async function checkGoogleAdsToken(): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const creds = await getFreshGoogleCredentials("google_ads");
    if (!creds) {
      return { check: "google_ads_token", ok: true, latencyMs: Date.now() - start, detail: "No active connection — skipped" };
    }
    const refreshToken = creds.refreshToken ?? (creds as Record<string, string>).refresh_token ?? "";
    if (!creds.customerId || !refreshToken) {
      return {
        check: "google_ads_token",
        ok: false,
        latencyMs: Date.now() - start,
        detail: !creds.customerId
          ? "Missing customerId — enter it on the Connections page"
          : "Missing refreshToken — re-authorize the Google Ads connection",
      };
    }

    const normalizedCreds: Record<string, string> = {
      ...(creds as Record<string, string>),
      refreshToken,
      customerId: creds.customerId,
    };

    await withTimeout(
      customerFromCreds(normalizedCreds).query(
        "SELECT customer.id FROM customer LIMIT 1",
      ),
      PROBE_TIMEOUT_MS,
      "Google Ads API",
    );

    return { check: "google_ads_token", ok: true, latencyMs: Date.now() - start };
  } catch (err: any) {
    return {
      check: "google_ads_token",
      ok: false,
      latencyMs: Date.now() - start,
      detail: err?.message?.slice(0, 200) ?? "Google Ads ping failed",
    };
  }
}

async function checkShopifyToken(): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const rows = await db
      .select()
      .from(platformConnections)
      .where(
        and(
          eq(platformConnections.platform, "shopify"),
          eq(platformConnections.isActive, true),
        ),
      );

    if (!rows.length) {
      return { check: "shopify_token", ok: true, latencyMs: Date.now() - start, detail: "No active connection — skipped" };
    }

    const creds = decryptCredentials(rows[0].credentials as Record<string, string>);
    if (!creds.accessToken || !creds.shopDomain) {
      return { check: "shopify_token", ok: false, latencyMs: Date.now() - start, detail: "Missing accessToken or shopDomain" };
    }

    if (!isValidShopifyDomain(creds.shopDomain)) {
      return { check: "shopify_token", ok: false, latencyMs: Date.now() - start, detail: "Invalid or suspicious shop domain" };
    }

    const resp = await withTimeout(
      fetch(
        `https://${creds.shopDomain}/admin/api/2024-01/shop.json`,
        { headers: { "X-Shopify-Access-Token": creds.accessToken } },
      ),
      PROBE_TIMEOUT_MS,
      "Shopify API",
    );

    if (!resp.ok) {
      return {
        check: "shopify_token",
        ok: false,
        latencyMs: Date.now() - start,
        detail: `Shopify API returned ${resp.status}`,
      };
    }

    return { check: "shopify_token", ok: true, latencyMs: Date.now() - start };
  } catch (err: any) {
    return {
      check: "shopify_token",
      ok: false,
      latencyMs: Date.now() - start,
      detail: err?.message?.slice(0, 200) ?? "Shopify ping failed",
    };
  }
}

async function checkLlmAvailability(): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const ai = await getGoogleGenAI();
    const resp = await withTimeout(
      ai.models.generateContent({
        model: VERTEX_MODEL,
        contents: [{ role: "user", parts: [{ text: "Say OK" }] }],
        config: { maxOutputTokens: 16, temperature: 0 },
      }),
      PROBE_TIMEOUT_MS,
      "Gemini API",
    );
    if (!resp) {
      return { check: "llm_availability", ok: false, latencyMs: Date.now() - start, detail: "No response object from Gemini" };
    }
    const candidates = resp.candidates ?? [];
    if (candidates.length === 0) {
      const text = typeof (resp as any).text === "function" ? (resp as any).text() : "";
      if (text) {
        return { check: "llm_availability", ok: true, latencyMs: Date.now() - start };
      }
      return { check: "llm_availability", ok: false, latencyMs: Date.now() - start, detail: "No candidates in Gemini response" };
    }
    return { check: "llm_availability", ok: true, latencyMs: Date.now() - start };
  } catch (err: any) {
    return {
      check: "llm_availability",
      ok: false,
      latencyMs: Date.now() - start,
      detail: err?.message?.slice(0, 200) ?? "Gemini ping failed",
    };
  }
}

async function checkQualityFixesScanner(): Promise<HealthCheckResult> {
  const start = Date.now();
  const status = getQualityFixesScannerStatus();

  // Cron has not booted yet (boot delay is 30s) — treat as a clean skip so we
  // don't fire a "scanner stuck" alert during the first minute after deploy.
  if (!status.lastRunAt && status.state === "idle") {
    return {
      check:     "quality_fixes_scanner",
      ok:        true,
      latencyMs: Date.now() - start,
      detail:    "Scanner not yet started — skipped",
    };
  }

  if (status.state === "last-error") {
    return {
      check:     "quality_fixes_scanner",
      ok:        false,
      latencyMs: Date.now() - start,
      detail:    `Last run errored (${status.lastErrorCode ?? "unknown"}): ${
        status.lastErrorMessage?.slice(0, 150) ?? "no message"
      }`,
    };
  }

  if (status.lastSuccessfulRunAt) {
    const ageMs = Date.now() - new Date(status.lastSuccessfulRunAt).getTime();
    if (ageMs > QUALITY_FIXES_STALE_MS) {
      const ageMin = Math.round(ageMs / 60_000);
      return {
        check:     "quality_fixes_scanner",
        ok:        false,
        latencyMs: Date.now() - start,
        detail:    `No successful Quality Fixes scan in ${ageMin} min (last: ${status.lastSuccessfulRunAt}). Cron may be stuck.`,
      };
    }
  }

  return { check: "quality_fixes_scanner", ok: true, latencyMs: Date.now() - start };
}

// ── Migration index health check ──────────────────────────────────────────────
//
// Verifies that both raw-SQL-managed indexes on adk_sessions exist.  Drizzle's
// schema push cannot create these (operator-class expression indexes), so they
// live in lib/db/migrations/ and are applied by post-merge.sh.  If the indexes
// are missing, conversation search will fall back to sequential scans and break
// the <150 ms p99 SLO for large session histories.
//
// Checks:
//   adk_sessions_events_trgm_idx        — GIN trigram for ILIKE text search
//   adk_sessions_app_user_updated_active_idx — composite partial B-tree for
//                                              combined text+date queries
// ─────────────────────────────────────────────────────────────────────────────
const REQUIRED_ADK_INDEXES = [
  "adk_sessions_events_trgm_idx",
  "adk_sessions_app_user_updated_active_idx",
] as const;

async function checkConversationSearchIndexes(): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const rows = await db.execute(sql`
      SELECT indexname
      FROM   pg_indexes
      WHERE  tablename = 'adk_sessions'
        AND  indexname IN (
          'adk_sessions_events_trgm_idx',
          'adk_sessions_app_user_updated_active_idx'
        )
    `);

    const found = new Set((rows as unknown as { indexname: string }[]).map((r) => r.indexname));
    const missing = REQUIRED_ADK_INDEXES.filter((n) => !found.has(n));

    if (missing.length > 0) {
      return {
        check:     "conversation_search_indexes",
        ok:        false,
        latencyMs: Date.now() - start,
        detail:    `Missing indexes on adk_sessions: ${missing.join(", ")}. Run lib/db/migrations/*.sql to restore fast conversation search.`,
      };
    }

    return { check: "conversation_search_indexes", ok: true, latencyMs: Date.now() - start };
  } catch (err: any) {
    return {
      check:     "conversation_search_indexes",
      ok:        false,
      latencyMs: Date.now() - start,
      detail:    err?.message?.slice(0, 200) ?? "Index presence check failed",
    };
  }
}

const CHECK_LABELS: Record<string, string> = {
  database: "Data Integrity (Warehouse)",
  etl_integrity: "Data Sync Pipeline",
  google_ads_token: "Google Ads API",
  shopify_token: "Shopify API",
  llm_availability: "AI Engine (Gemini)",
  quality_fixes_scanner: "Quality Fixes Scanner",
  conversation_search_indexes: "Conversation Search Indexes",
};

const CHECK_PLATFORMS: Record<string, string> = {
  database: "Infrastructure",
  etl_integrity: "Data Pipeline",
  google_ads_token: "Google Ads",
  shopify_token: "Shopify",
  llm_availability: "Vertex AI",
  quality_fixes_scanner: "Background Worker",
  conversation_search_indexes: "Infrastructure",
};

let _lastResults: HealthCheckResult[] = [];
let _lastRunAt: string | null = null;
const _activeAlertIds = new Set<string>();

export function getLastHealthResults() {
  return { results: _lastResults, lastRunAt: _lastRunAt };
}

export async function runSystemSelfAudit(): Promise<HealthCheckResult[]> {
  logger.info("[HealthMonitor] Starting system self-audit…");
  const auditStart = Date.now();

  const results = await Promise.allSettled([
    checkDataIntegrity(),
    checkEtlIntegrity(),
    checkGoogleAdsToken(),
    checkShopifyToken(),
    checkLlmAvailability(),
    checkQualityFixesScanner(),
    checkConversationSearchIndexes(),
  ]);

  const checks: HealthCheckResult[] = results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { check: "unknown", ok: false, latencyMs: 0, detail: String(r.reason) },
  );

  _lastResults = checks;
  _lastRunAt = new Date().toISOString();

  const currentFailIds = new Set<string>();

  for (const check of checks) {
    const alertId = `sys_health_${check.check}`;
    const isSkipped = check.detail?.includes("skipped");

    if (!check.ok && !isSkipped) {
      currentFailIds.add(alertId);

      const label = CHECK_LABELS[check.check] ?? check.check;
      const platform = CHECK_PLATFORMS[check.check] ?? "System";

      // `recordInfraAlert` is idempotent (no-ops when an unresolved row with
      // the same externalId exists), so it's safe to call on every audit
      // tick — and safe even when the originating worker (e.g. the Quality
      // Fixes scanner) has already raised the same alert directly.
      await recordInfraAlert({
        alertId,
        title:    `${label} — Sync Disruption Detected`,
        detail:   check.detail ?? `${label} is unreachable or returned an error.`,
        platform,
        action:   `Investigate ${label} connectivity and credentials.`,
      });

      _activeAlertIds.add(alertId);
    }
  }

  for (const prevId of _activeAlertIds) {
    if (!currentFailIds.has(prevId)) {
      _activeAlertIds.delete(prevId);
      await resolveInfraAlert(prevId);
    }
  }

  const totalMs = Date.now() - auditStart;
  const passCount = checks.filter((c) => c.ok).length;
  logger.info(
    { passCount, failCount: currentFailIds.size, totalMs },
    `[HealthMonitor] Self-audit complete: ${passCount}/${checks.length} passed (${totalMs}ms)`,
  );

  return checks;
}
