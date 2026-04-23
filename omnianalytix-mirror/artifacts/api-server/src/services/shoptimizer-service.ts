/**
 * Shoptimizer service layer.
 *
 * Wraps the raw HTTP client with:
 *   • Single + batch optimization (capped at MAX_BATCH).
 *   • A structured field-level diff (which fields changed and how).
 *   • Friendly error mapping so HTTP routes and ADK tools can share logic.
 */
import {
  type MerchantProduct,
  type PluginSettings,
  shoptimizeProduct,
  normalizeShoptimizerResponse,
  ShoptimizerHttpError,
  ShoptimizerNotConfiguredError,
  ShoptimizerUnreachableError,
  ShoptimizerInvalidResponseError,
} from "../lib/shoptimizer-client";
import { logger } from "../lib/logger";

export const MAX_BATCH = 50;

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface OptimizeDiff {
  offerId: string;
  pluginsFired: string[];
  changedFields: FieldChange[];
  /** Number of fields whose value differs from the input. */
  changeCount: number;
}

export interface OptimizeResultItem {
  ok: true;
  offerId: string;
  original: MerchantProduct;
  optimized: MerchantProduct;
  diff: OptimizeDiff;
  pluginResults: Record<string, unknown>;
}

export interface OptimizeErrorItem {
  ok: false;
  offerId: string;
  error: string;
  code: string;
}

export type OptimizeItem = OptimizeResultItem | OptimizeErrorItem;

export interface BatchOptimizeResult {
  totalRequested: number;
  totalOptimized: number;
  totalFailed: number;
  results: OptimizeItem[];
}

// ── Diff ──────────────────────────────────────────────────────────────────────

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",")}}`;
}

function diffProducts(before: MerchantProduct, after: MerchantProduct): FieldChange[] {
  const changes: FieldChange[] = [];
  const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const b = (before as Record<string, unknown>)[k];
    const a = (after as Record<string, unknown>)[k];
    if (stableStringify(b) !== stableStringify(a)) {
      changes.push({ field: k, before: b ?? null, after: a ?? null });
    }
  }
  return changes;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface OptimizeRequest {
  product: MerchantProduct;
  pluginSettings?: PluginSettings;
}

export async function optimizeOne(req: OptimizeRequest): Promise<OptimizeItem> {
  const offerId = req.product.offerId;
  try {
    const raw = await shoptimizeProduct(req.product, { pluginSettings: req.pluginSettings });
    const { optimizedProduct, pluginsFired, pluginResults } = normalizeShoptimizerResponse(raw);
    const changedFields = diffProducts(req.product, optimizedProduct);
    return {
      ok: true,
      offerId,
      original: req.product,
      optimized: optimizedProduct,
      pluginResults,
      diff: {
        offerId,
        pluginsFired,
        changedFields,
        changeCount: changedFields.length,
      },
    };
  } catch (err) {
    return mapErrorToItem(offerId, err);
  }
}

export async function optimizeBatch(
  requests: OptimizeRequest[],
  opts: { concurrency?: number } = {},
): Promise<BatchOptimizeResult> {
  if (requests.length === 0) {
    return { totalRequested: 0, totalOptimized: 0, totalFailed: 0, results: [] };
  }
  if (requests.length > MAX_BATCH) {
    throw new BatchTooLargeError(requests.length, MAX_BATCH);
  }

  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 5, 10));
  const results: OptimizeItem[] = new Array(requests.length);

  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= requests.length) return;
      results[i] = await optimizeOne(requests[i]!);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  const totalOptimized = results.filter((r) => r.ok).length;
  const totalFailed = results.length - totalOptimized;

  // If EVERY request failed with an infrastructure-level cause, surface
  // it as a single error so the caller can return 503 instead of a
  // misleading "all 50 products had errors" 200. Infra causes:
  //   • SHOPTIMIZER_NOT_CONFIGURED — env var missing
  //   • SHOPTIMIZER_UNREACHABLE    — network failure
  //   • SHOPTIMIZER_HTTP_ERROR     — but only when upstream returned 5xx
  //                                  (i.e. the service itself is down /
  //                                   broken, not "this product was bad")
  if (totalFailed === results.length && results.length > 0) {
    const allInfra = results.every((r) => isInfraFailure(r as OptimizeErrorItem));
    if (allInfra) {
      const first = results[0] as OptimizeErrorItem;
      const code: InfrastructureFailureError["code"] =
        first.code === "SHOPTIMIZER_NOT_CONFIGURED"
          ? "SHOPTIMIZER_NOT_CONFIGURED"
          : "SHOPTIMIZER_UNREACHABLE";
      throw new InfrastructureFailureError(code, first.error);
    }
  }

  return {
    totalRequested: requests.length,
    totalOptimized,
    totalFailed,
    results,
  };
}

// ── Error helpers ─────────────────────────────────────────────────────────────

export class BatchTooLargeError extends Error {
  code = "BATCH_TOO_LARGE" as const;
  constructor(public size: number, public max: number) {
    super(`Batch of ${size} exceeds maximum of ${max}.`);
  }
}

export class InfrastructureFailureError extends Error {
  code: "SHOPTIMIZER_NOT_CONFIGURED" | "SHOPTIMIZER_UNREACHABLE";
  constructor(
    code: "SHOPTIMIZER_NOT_CONFIGURED" | "SHOPTIMIZER_UNREACHABLE",
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}

function isInfraFailure(item: OptimizeErrorItem): boolean {
  if (item.code === "SHOPTIMIZER_NOT_CONFIGURED") return true;
  if (item.code === "SHOPTIMIZER_UNREACHABLE") return true;
  // Treat upstream 5xx as the service being unavailable, not as
  // per-product validation errors.
  if (item.code === "SHOPTIMIZER_HTTP_ERROR") {
    const m = item.error.match(/HTTP (\d{3})/);
    if (m && Number(m[1]) >= 500) return true;
  }
  return false;
}

function mapErrorToItem(offerId: string, err: unknown): OptimizeErrorItem {
  if (err instanceof ShoptimizerNotConfiguredError) {
    return { ok: false, offerId, error: err.message, code: err.code };
  }
  if (err instanceof ShoptimizerUnreachableError) {
    return { ok: false, offerId, error: err.message, code: err.code };
  }
  if (err instanceof ShoptimizerHttpError) {
    return { ok: false, offerId, error: err.message, code: err.code };
  }
  if (err instanceof ShoptimizerInvalidResponseError) {
    return { ok: false, offerId, error: err.message, code: err.code };
  }
  logger.warn({ err, offerId }, "shoptimizer-service: unexpected error");
  const msg = err instanceof Error ? err.message : String(err);
  return { ok: false, offerId, error: msg, code: "SHOPTIMIZER_UNKNOWN_ERROR" };
}
