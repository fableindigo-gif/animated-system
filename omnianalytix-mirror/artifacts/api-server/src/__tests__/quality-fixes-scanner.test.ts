/**
 * Quality Fixes Scanner unit tests.
 *
 * Verifies the scanner's contract without touching a real database or
 * Shoptimizer service:
 *   • Stale-product selection bails when nothing needs scanning.
 *   • Successful Shoptimizer batch upserts an "ok" row with the diff.
 *   • Per-product errors upsert an "error" row.
 *   • Infrastructure failure aborts the run cleanly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const recordInfraAlertMock = vi.fn().mockResolvedValue(undefined);
const resolveInfraAlertMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/alert-store", () => ({
  recordInfraAlert:  (...args: unknown[]) => recordInfraAlertMock(...args),
  resolveInfraAlert: (...args: unknown[]) => resolveInfraAlertMock(...args),
}));

// In-memory "DB" — captures inserts so we can assert on them.
const upserts: Array<{ values: Record<string, unknown>; set: Record<string, unknown> }> = [];
const selectResult = { current: [] as unknown[] };

vi.mock("@workspace/db", () => {
  const onConflictDoUpdate = vi.fn(({ set }: { set: Record<string, unknown> }) => {
    const last = upserts[upserts.length - 1]!;
    last.set = set;
    return Promise.resolve();
  });
  const insert = vi.fn(() => ({
    values: vi.fn((values: Record<string, unknown>) => {
      upserts.push({ values, set: {} });
      return { onConflictDoUpdate };
    }),
  }));
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      leftJoin: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => ({
            then: (cb: (rows: unknown[]) => unknown) =>
              cb(selectResult.current.map((p) => ({ warehouse_shopify_products: p }))),
          })),
        })),
      })),
    })),
  }));
  return {
    db: { insert, select },
    warehouseShopifyProducts: { id: "id", syncedAt: "synced_at" },
    productQualityFixes:      { id: "id", productSyncedAt: "product_synced_at" },
  };
});

const optimizeBatchMock = vi.fn();
vi.mock("../services/shoptimizer-service", async () => {
  const actual = await vi.importActual<typeof import("../services/shoptimizer-service")>(
    "../services/shoptimizer-service",
  );
  return {
    ...actual,
    optimizeBatch: (...args: unknown[]) => optimizeBatchMock(...args),
  };
});

import { runQualityFixesScan } from "../workers/quality-fixes-scanner";
import { InfrastructureFailureError } from "../services/shoptimizer-service";

const PRODUCT = {
  id:           "p1_sku1",
  tenantId:     "default",
  productId:    "p1",
  sku:          "sku1",
  title:        "Cotton shirt",
  description:  "Soft tee",
  imageUrl:     "https://cdn.example/x.jpg",
  price:        19.99,
  inventoryQty: 5,
  syncedAt:     new Date("2026-04-01T00:00:00Z"),
};

beforeEach(() => {
  upserts.length = 0;
  selectResult.current = [];
  optimizeBatchMock.mockReset();
  recordInfraAlertMock.mockClear();
  resolveInfraAlertMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("quality-fixes-scanner", () => {
  it("returns skipped:true when there are no stale products", async () => {
    selectResult.current = [];
    const res = await runQualityFixesScan();
    expect(res.skipped).toBe(true);
    expect(res.scanned).toBe(0);
    expect(optimizeBatchMock).not.toHaveBeenCalled();
  });

  it("upserts an ok row with the Shoptimizer diff for each product", async () => {
    selectResult.current = [PRODUCT];
    optimizeBatchMock.mockResolvedValue({
      totalRequested: 1, totalOptimized: 1, totalFailed: 0,
      results: [{
        ok: true,
        offerId: PRODUCT.id,
        original: { offerId: PRODUCT.id },
        optimized: { offerId: PRODUCT.id, color: "blue" },
        pluginResults: {},
        diff: { offerId: PRODUCT.id, pluginsFired: ["color"], changedFields: [{ field: "color", before: null, after: "blue" }], changeCount: 1 },
      }],
    });

    const res = await runQualityFixesScan();
    expect(res).toMatchObject({ refreshed: 1, failed: 0, skipped: false });
    expect(upserts).toHaveLength(1);
    const u = upserts[0]!;
    expect(u.values).toMatchObject({
      id: PRODUCT.id,
      status: "ok",
      changeCount: 1,
      pluginsFired: ["color"],
    });
    expect(u.set).toMatchObject({ status: "ok", changeCount: 1 });
  });

  it("upserts an error row when a product optimisation fails", async () => {
    selectResult.current = [PRODUCT];
    optimizeBatchMock.mockResolvedValue({
      totalRequested: 1, totalOptimized: 0, totalFailed: 1,
      results: [{
        ok: false,
        offerId: PRODUCT.id,
        error: "bad gtin",
        code: "SHOPTIMIZER_HTTP_ERROR",
      }],
    });

    const res = await runQualityFixesScan();
    expect(res).toMatchObject({ refreshed: 0, failed: 1, skipped: false });
    expect(upserts[0]!.values).toMatchObject({
      id: PRODUCT.id,
      status: "error",
      errorCode: "SHOPTIMIZER_HTTP_ERROR",
    });
  });

  it("aborts the run when Shoptimizer is unreachable (infra failure)", async () => {
    selectResult.current = [PRODUCT];
    optimizeBatchMock.mockRejectedValue(
      new InfrastructureFailureError("SHOPTIMIZER_UNREACHABLE", "down"),
    );

    const res = await runQualityFixesScan();
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe("SHOPTIMIZER_UNREACHABLE");
    expect(upserts).toHaveLength(0);
  });

  it("fires an infra alert on Shoptimizer-unreachable abort and clears it on the next successful run", async () => {
    // 1) First run aborts with an infra failure → alert raised.
    selectResult.current = [PRODUCT];
    optimizeBatchMock.mockRejectedValueOnce(
      new InfrastructureFailureError("SHOPTIMIZER_UNREACHABLE", "down"),
    );
    await runQualityFixesScan();

    expect(recordInfraAlertMock).toHaveBeenCalledTimes(1);
    const payload = recordInfraAlertMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      alertId:  "sys_health_quality_fixes_scanner",
      platform: "Background Worker",
    });
    expect(String(payload.detail)).toMatch(/unreachable/i);
    expect(resolveInfraAlertMock).not.toHaveBeenCalled();

    // 2) Next run with no stale products → recovery, alert cleared exactly once.
    selectResult.current = [];
    await runQualityFixesScan();

    expect(resolveInfraAlertMock).toHaveBeenCalledTimes(1);
    expect(resolveInfraAlertMock).toHaveBeenCalledWith("sys_health_quality_fixes_scanner");

    // 3) A subsequent healthy run must NOT clear again (no transition).
    await runQualityFixesScan();
    expect(resolveInfraAlertMock).toHaveBeenCalledTimes(1);
  });

  it("fires an infra alert when Shoptimizer is not configured", async () => {
    selectResult.current = [PRODUCT];
    optimizeBatchMock.mockRejectedValueOnce(
      new InfrastructureFailureError("SHOPTIMIZER_NOT_CONFIGURED", "missing url"),
    );
    await runQualityFixesScan();

    expect(recordInfraAlertMock).toHaveBeenCalledTimes(1);
    const payload = recordInfraAlertMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(String(payload.detail)).toMatch(/not configured/i);
  });
});
