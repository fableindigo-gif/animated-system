/**
 * Quality Fixes Scanner Worker
 * ────────────────────────────
 * Walks the warehouse on a schedule and stores the latest Shoptimizer diff
 * per product in `product_quality_fixes`. The Quality Fixes UI reads from
 * this table instead of calling Shoptimizer on every page load.
 *
 * Refresh policy:
 *   • Products with no quality_fix row yet → scanned.
 *   • Products whose `synced_at` is newer than the stored
 *     `product_synced_at` → re-scanned (the underlying product changed).
 *   • Everything else is skipped (cache hit).
 *
 * The scanner is best-effort and non-fatal: any failure is logged but never
 * crashes the API process. If Shoptimizer is unreachable, the run aborts
 * cleanly and will retry on the next tick.
 */
import {
  db,
  warehouseShopifyProducts,
  productQualityFixes,
  type WarehouseShopifyProduct,
} from "@workspace/db";
import { sql, eq, and, isNull, or, gt, inArray, count } from "drizzle-orm";
import { logger } from "../lib/logger";
import {
  optimizeBatch,
  InfrastructureFailureError,
  type OptimizeRequest,
} from "../services/shoptimizer-service";
import type { MerchantProduct } from "../lib/shoptimizer-client";
import { recordInfraAlert, resolveInfraAlert } from "../lib/alert-store";

/**
 * Shared identifier for the Quality Fixes scanner's infrastructure alert.
 * Kept in sync with `system-health-monitor` so the two writers don't create
 * duplicate triage rows — `recordInfraAlert` dedupes by `externalId`.
 */
export const QUALITY_FIXES_ALERT_ID = "sys_health_quality_fixes_scanner";

const SCAN_BATCH_SIZE = 25;            // products per Shoptimizer call (≤ MAX_BATCH=50)
const DEFAULT_MAX_PER_RUN = 200;       // cap per scheduled tick — keeps runs short
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;   // 30 minutes
const INITIAL_DELAY_MS    = 30_000;           // delay first run after boot

export interface QualityFixesScanResult {
  scanned:    number;
  refreshed:  number;
  failed:     number;
  skipped:    boolean;
  reason?:    string;
}

export type QualityFixesScannerState = "idle" | "running" | "last-error";

export interface QualityFixesScannerStatus {
  state:                QualityFixesScannerState;
  lastRunAt:            string | null;
  lastSuccessfulRunAt:  string | null;
  lastSummary:          QualityFixesScanResult | null;
  lastErrorCode:        string | null;
  lastErrorMessage:     string | null;
}

const _status: QualityFixesScannerStatus = {
  state:               "idle",
  lastRunAt:           null,
  lastSuccessfulRunAt: null,
  lastSummary:         null,
  lastErrorCode:       null,
  lastErrorMessage:    null,
};

export function getQualityFixesScannerStatus(): QualityFixesScannerStatus {
  return { ..._status };
}

/**
 * Count products that still need a (re)scan — missing rows or stale.
 * Best-effort: returns 0 on any DB error so the health surface never throws.
 */
export async function getPendingQualityFixesCount(): Promise<number> {
  try {
    const rows = await db
      .select({ n: count() })
      .from(warehouseShopifyProducts)
      .leftJoin(
        productQualityFixes,
        eq(productQualityFixes.id, warehouseShopifyProducts.id),
      )
      .where(
        or(
          isNull(productQualityFixes.id),
          gt(warehouseShopifyProducts.syncedAt, productQualityFixes.productSyncedAt),
        ),
      );
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Build a Merchant Center product payload from a warehouse row. Only
 * the fields Shoptimizer can act on are forwarded — extra fields are
 * passed through but unused.
 */
function toMerchantProduct(row: WarehouseShopifyProduct): MerchantProduct {
  return {
    offerId:     row.id,
    title:       row.title || "",
    description: row.description || "",
    imageLink:   row.imageUrl && /^https?:\/\//.test(row.imageUrl) ? row.imageUrl : undefined,
    price:       row.price ? { value: String(row.price), currency: "USD" } : undefined,
    availability: (row.inventoryQty ?? 0) > 0 ? "in stock" : "out of stock",
  };
}

/**
 * Find products that need (re)scanning: missing rows or stale
 * (`warehouse.synced_at > quality_fixes.product_synced_at`).
 *
 * If `tenantId` is provided the search is scoped to that tenant — used by the
 * REST `/quality-fixes/rescan` endpoint so an authenticated caller can never
 * trigger work against another tenant's products. The unscoped form is reserved
 * for the in-process cron tick which iterates the entire warehouse.
 */
async function selectStaleProducts(limit: number, tenantId?: string): Promise<WarehouseShopifyProduct[]> {
  const stalenessFilter = or(
    isNull(productQualityFixes.id),
    gt(warehouseShopifyProducts.syncedAt, productQualityFixes.productSyncedAt),
  );
  const whereClause = tenantId
    ? and(eq(warehouseShopifyProducts.tenantId, tenantId), stalenessFilter)
    : stalenessFilter;

  return db
    .select()
    .from(warehouseShopifyProducts)
    .leftJoin(
      productQualityFixes,
      eq(productQualityFixes.id, warehouseShopifyProducts.id),
    )
    .where(whereClause)
    .limit(limit)
    .then((rows) =>
      rows.map((r) => (r as { warehouse_shopify_products: WarehouseShopifyProduct }).warehouse_shopify_products),
    );
}

/**
 * Scan up to `maxProducts` stale/new products and persist their diffs.
 * Safe to call ad-hoc (e.g. from a manual "rescan" button) or from a cron.
 */
export async function runQualityFixesScan(
  opts: { maxProducts?: number; tenantId?: string } = {},
): Promise<QualityFixesScanResult> {
  const maxProducts = Math.max(1, opts.maxProducts ?? DEFAULT_MAX_PER_RUN);

  // Capture whether the previous run left the scanner in an errored state
  // BEFORE we flip to "running" — used by `finish()` to decide if a recovery
  // alert clear is needed.
  const wasErroredBefore = _status.state === "last-error";
  _status.state = "running";

  const finish = (result: QualityFixesScanResult): QualityFixesScanResult => {
    const now = new Date().toISOString();
    _status.lastRunAt = now;
    _status.lastSummary = result;

    const isInfraAbort =
      result.skipped &&
      (result.reason === "SHOPTIMIZER_NOT_CONFIGURED" || result.reason === "SHOPTIMIZER_UNREACHABLE");

    if (isInfraAbort) {
      _status.state = "last-error";
      _status.lastErrorCode = result.reason ?? null;
      _status.lastErrorMessage = result.reason ?? null;

      // Notify operators immediately rather than waiting for the periodic
      // self-audit to notice. Fire-and-forget — alert delivery must never
      // crash the scanner. `recordInfraAlert` is idempotent so a stuck
      // scanner that aborts every 30 min won't spam new triage rows.
      const friendly =
        result.reason === "SHOPTIMIZER_NOT_CONFIGURED"
          ? "Shoptimizer service URL is not configured. Quality Fixes scanner is paused."
          : "Shoptimizer service is unreachable. Quality Fixes scanner is paused.";
      void recordInfraAlert({
        alertId:  QUALITY_FIXES_ALERT_ID,
        title:    "Quality Fixes Scanner — Sync Disruption Detected",
        detail:   friendly,
        platform: "Background Worker",
        action:   "Verify Shoptimizer is running and SHOPTIMIZER_URL is set.",
      }).catch((err) => {
        logger.warn({ err }, "[QualityFixesScanner] Failed to record infra alert");
      });
    } else {
      _status.state = "idle";
      _status.lastSuccessfulRunAt = now;
      _status.lastErrorCode = null;
      _status.lastErrorMessage = null;

      // Recovery — clear the alert if the previous run had errored.
      if (wasErroredBefore) {
        void resolveInfraAlert(QUALITY_FIXES_ALERT_ID).catch((err) => {
          logger.warn({ err }, "[QualityFixesScanner] Failed to resolve infra alert");
        });
      }
    }
    return result;
  };

  let stale: WarehouseShopifyProduct[];
  try {
    stale = await selectStaleProducts(maxProducts, opts.tenantId);
  } catch (err) {
    _status.state = "last-error";
    _status.lastRunAt = new Date().toISOString();
    _status.lastErrorCode = "DB_ERROR";
    _status.lastErrorMessage = err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
    throw err;
  }

  if (stale.length === 0) {
    return finish({ scanned: 0, refreshed: 0, failed: 0, skipped: true, reason: "no-stale-products" });
  }

  return finish(await scanProductRows(stale));
}

/**
 * Force-rescan a specific set of products by warehouse id, regardless of
 * staleness. Used by the "Apply fix" flow to refresh a single row right
 * after a Shopify write-back so the UI reflects the new state, and by the
 * per-row / "Rescan failed" buttons in the Quality Fixes UI.
 *
 * When `tenantId` is supplied, the lookup is scoped to that tenant so an
 * authenticated caller can never trigger a Shoptimizer call against
 * products owned by a different tenant — even if they pass foreign ids.
 * Foreign ids are silently dropped.
 */
export async function rescanProductsByIds(
  ids: string[],
  opts: { tenantId?: string } = {},
): Promise<QualityFixesScanResult> {
  if (ids.length === 0) {
    return { scanned: 0, refreshed: 0, failed: 0, skipped: true, reason: "no-ids" };
  }
  const idFilter = inArray(warehouseShopifyProducts.id, ids);
  const where = opts.tenantId
    ? and(eq(warehouseShopifyProducts.tenantId, opts.tenantId), idFilter)
    : idFilter;
  const rows = await db
    .select()
    .from(warehouseShopifyProducts)
    .where(where);
  if (rows.length === 0) {
    return { scanned: 0, refreshed: 0, failed: 0, skipped: true, reason: "no-products-found" };
  }
  return scanProductRows(rows);
}

/**
 * Run Shoptimizer for a concrete set of warehouse rows and upsert the
 * resulting diff into `product_quality_fixes`. Shared by both the staleness
 * scanner and the targeted rescan triggered by the Apply Fix flow.
 */
async function scanProductRows(stale: WarehouseShopifyProduct[]): Promise<QualityFixesScanResult> {
  let refreshed = 0;
  let failed    = 0;

  for (let i = 0; i < stale.length; i += SCAN_BATCH_SIZE) {
    const slice = stale.slice(i, i + SCAN_BATCH_SIZE);
    const requests: OptimizeRequest[] = slice.map((p) => ({ product: toMerchantProduct(p) }));

    let batch;
    try {
      batch = await optimizeBatch(requests);
    } catch (err) {
      // Infra-level failure (Shoptimizer not configured / unreachable / 5xx).
      // Bail out — no point hammering an unhealthy upstream. The scheduler
      // will pick this up again on the next tick.
      if (err instanceof InfrastructureFailureError) {
        logger.warn(
          { code: err.code, msg: err.message, processed: refreshed, remaining: stale.length - i },
          "[QualityFixesScanner] Aborting run — Shoptimizer infrastructure failure",
        );
        return {
          scanned:   refreshed + failed,
          refreshed,
          failed,
          skipped:   true,
          reason:    err.code,
        };
      }
      logger.error({ err }, "[QualityFixesScanner] Unexpected batch error — skipping slice");
      failed += slice.length;
      continue;
    }

    const now = new Date();
    for (let j = 0; j < slice.length; j++) {
      const product = slice[j]!;
      const item    = batch.results[j]!;
      try {
        if (item.ok) {
          await db
            .insert(productQualityFixes)
            .values({
              id:               product.id,
              tenantId:         product.tenantId,
              productId:        product.productId,
              sku:              product.sku ?? "",
              status:           "ok",
              errorCode:        null,
              errorMessage:     null,
              pluginsFired:     item.diff.pluginsFired,
              changedFields:    item.diff.changedFields,
              changeCount:      item.diff.changeCount,
              optimizedProduct: item.optimized as Record<string, unknown>,
              productSyncedAt:  product.syncedAt,
              scannedAt:        now,
            })
            .onConflictDoUpdate({
              target: productQualityFixes.id,
              set: {
                tenantId:         product.tenantId,
                productId:        product.productId,
                sku:              product.sku ?? "",
                status:           "ok",
                errorCode:        null,
                errorMessage:     null,
                pluginsFired:     item.diff.pluginsFired,
                changedFields:    item.diff.changedFields,
                changeCount:      item.diff.changeCount,
                optimizedProduct: item.optimized as Record<string, unknown>,
                productSyncedAt:  product.syncedAt,
                scannedAt:        now,
              },
            });
          refreshed++;
        } else {
          // Per-product failure — store an "error" row so the UI can show
          // why a SKU has no fixes, and so we don't retry it endlessly
          // until the underlying product changes.
          await db
            .insert(productQualityFixes)
            .values({
              id:               product.id,
              tenantId:         product.tenantId,
              productId:        product.productId,
              sku:              product.sku ?? "",
              status:           "error",
              errorCode:        item.code,
              errorMessage:     item.error.substring(0, 500),
              pluginsFired:     [],
              changedFields:    [],
              changeCount:      0,
              optimizedProduct: null,
              productSyncedAt:  product.syncedAt,
              scannedAt:        now,
            })
            .onConflictDoUpdate({
              target: productQualityFixes.id,
              set: {
                status:          "error",
                errorCode:       item.code,
                errorMessage:    item.error.substring(0, 500),
                pluginsFired:    [],
                changedFields:   [],
                changeCount:     0,
                optimizedProduct: null,
                productSyncedAt: product.syncedAt,
                scannedAt:       now,
              },
            });
          failed++;
        }
      } catch (dbErr) {
        logger.error(
          { err: dbErr, productId: product.productId },
          "[QualityFixesScanner] Failed to persist quality-fix row",
        );
        failed++;
      }
    }
  }

  return { scanned: refreshed + failed, refreshed, failed, skipped: false };
}

let cronTimer:   ReturnType<typeof setInterval> | null = null;
let initialTimer: ReturnType<typeof setTimeout>  | null = null;

/**
 * Start a background interval that re-scans stale products. Idempotent —
 * calling start twice will not create overlapping timers.
 */
export function startQualityFixesCron(opts: { intervalMs?: number; initialDelayMs?: number } = {}): void {
  const intervalMs     = Math.max(60_000, opts.intervalMs     ?? DEFAULT_INTERVAL_MS);
  const initialDelayMs = Math.max(0,      opts.initialDelayMs ?? INITIAL_DELAY_MS);

  if (cronTimer) {
    logger.debug("[QualityFixesScanner] Cron already running — skipping start");
    return;
  }

  const tick = () => {
    runQualityFixesScan()
      .then((res) => {
        if (res.skipped) {
          logger.debug({ res }, "[QualityFixesScanner] Tick skipped");
        } else {
          logger.info({ res }, "[QualityFixesScanner] Tick complete");
        }
      })
      .catch((err) => {
        logger.warn({ err }, "[QualityFixesScanner] Tick failed (non-fatal)");
      });
  };

  initialTimer = setTimeout(tick, initialDelayMs);
  initialTimer.unref?.();

  cronTimer = setInterval(tick, intervalMs);
  cronTimer.unref?.();

  logger.info(
    { intervalMs, initialDelayMs },
    "[QualityFixesScanner] Cron started",
  );
}

/** Stop the cron — primarily used in tests. */
export function stopQualityFixesCron(): void {
  if (initialTimer) { clearTimeout(initialTimer);  initialTimer = null; }
  if (cronTimer)    { clearInterval(cronTimer);    cronTimer    = null; }
}

/** Suppress "unused import" for `sql` and `and` (kept for future filtering hooks). */
void sql; void and;
