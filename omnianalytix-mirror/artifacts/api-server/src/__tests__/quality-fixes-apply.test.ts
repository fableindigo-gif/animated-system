/**
 * Quality Fixes Apply worker — unit tests.
 *
 * Verifies the contract of `applyQualityFixToShopify` without touching a
 * real DB or Shopify:
 *   • Maps `title` → product.title PUT and unknown fields → metafields POST.
 *   • Mirrors successful native-field writes onto the warehouse row and
 *     bumps `synced_at`.
 *   • Inserts an `audit_logs` row recording who applied which fix.
 *   • Triggers a single-product rescan after a successful apply.
 *   • Returns ok=false when the fix isn't found for the supplied tenant.
 *   • Returns ok=false when no Shopify connection is configured.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

// ─── In-memory DB doubles ──────────────────────────────────────────────────
interface FakeFix {
  id: string; tenantId: string; status: string;
  productSyncedAt: Date; pluginsFired: string[];
  changedFields: Array<{ field: string; before: unknown; after: unknown }>;
}
interface FakeProduct {
  id: string; tenantId: string; productId: string; sku: string;
  title: string; description: string;
}
interface FakeConn {
  organizationId: number; platform: string;
  credentials: { shop: string; accessToken: string };
}

const state = {
  fix:    null as FakeFix    | null,
  product: null as FakeProduct | null,
  conn:   null as FakeConn   | null,
  productUpdates: [] as Array<{ id: string; values: Record<string, unknown> }>,
  audits: [] as Record<string, unknown>[],
  // Pre-seeded audit_logs rows used by undo tests.
  seededAudits: [] as Array<{ id: number; organizationId: number; toolName: string; toolArgs: Record<string, unknown> }>,
  // Captured raw SQL executions (used to verify the "already undone" probe ran).
  executions: [] as string[],
  // When true, the laterUndo probe returns a row.
  alreadyUndone: false,
};

const rescanMock = vi.fn(async (_ids: string[]) =>
  ({ scanned: 1, refreshed: 1, failed: 0, skipped: false }));

vi.mock("../workers/quality-fixes-scanner", () => ({
  rescanProductsByIds: (...args: unknown[]) => rescanMock(...(args as [string[]])),
}));

vi.mock("@workspace/db", () => {
  const TABLE_FIX     = Symbol("productQualityFixes");
  const TABLE_PRODUCT = Symbol("warehouseShopifyProducts");
  const TABLE_CONN    = Symbol("platformConnections");
  const TABLE_WS      = Symbol("workspaces");
  const TABLE_AUDIT   = Symbol("auditLogs");

  const select = vi.fn((_cols?: unknown) => ({
    from: vi.fn((tbl: symbol) => {
      if (tbl === TABLE_FIX) {
        // .innerJoin(...).where(...).limit(...)
        return {
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(async () => {
                if (state.fix && state.product
                    && state.fix.tenantId === state.product.tenantId) {
                  return [{
                    product_quality_fixes:      state.fix,
                    warehouse_shopify_products: state.product,
                  }];
                }
                return [];
              }),
            })),
          })),
        };
      }
      if (tbl === TABLE_CONN) {
        return {
          where: vi.fn(() => ({
            limit: vi.fn(async () => state.conn ? [state.conn] : []),
          })),
        };
      }
      if (tbl === TABLE_WS) {
        return {
          where: vi.fn(() => ({
            limit: vi.fn(async () => []),
          })),
        };
      }
      if (tbl === TABLE_AUDIT) {
        // Used by undoQualityFixOnShopify to load the original apply row.
        // We just return the first seededAudit — the worker doesn't inspect
        // the predicate, only the row's organizationId/toolName/toolArgs.
        return {
          where: vi.fn(() => ({
            limit: vi.fn(async () => state.seededAudits.length > 0 ? [state.seededAudits[0]] : []),
          })),
        };
      }
      return {
        where: vi.fn(() => ({ limit: vi.fn(async () => []) })),
      };
    }),
  }));

  const execute = vi.fn(async (query: unknown) => {
    // Drizzle sql template renders to a tagged object — stringify for capture.
    state.executions.push(JSON.stringify(query));
    return { rows: state.alreadyUndone ? [{ id: 999 }] : [] };
  });

  const update = vi.fn((tbl: symbol) => ({
    set: vi.fn((values: Record<string, unknown>) => ({
      where: vi.fn(async () => {
        if (tbl === TABLE_PRODUCT && state.product) {
          state.productUpdates.push({ id: state.product.id, values });
        }
      }),
    })),
  }));

  const insert = vi.fn((tbl: symbol) => ({
    values: vi.fn((values: Record<string, unknown>) => ({
      returning: vi.fn(async () => {
        if (tbl === TABLE_AUDIT) {
          state.audits.push(values);
          return [{ id: state.audits.length }];
        }
        return [];
      }),
    })),
  }));

  return {
    db: { select, update, insert, execute },
    productQualityFixes:     TABLE_FIX,
    warehouseShopifyProducts: TABLE_PRODUCT,
    platformConnections:     TABLE_CONN,
    workspaces:              TABLE_WS,
    auditLogs:               TABLE_AUDIT,
  };
});

import {
  applyQualityFixToShopify,
  applyQualityFixesToShopifyBulk,
  undoQualityFixOnShopify,
} from "../workers/quality-fixes-apply";

const PRODUCT: FakeProduct = {
  id: "p1_sku1", tenantId: "42", productId: "p1", sku: "sku1",
  title: "Old title", description: "Old desc",
};
const FIX: FakeFix = {
  id: "p1_sku1", tenantId: "42", status: "ok",
  productSyncedAt: new Date("2026-04-01T00:00:00Z"),
  pluginsFired: ["title-plugin", "color-plugin"],
  changedFields: [
    { field: "title",       before: "Old title", after: "New title" },
    { field: "description", before: "Old desc",  after: "New desc"  },
    { field: "color",       before: null,        after: "blue"      },
  ],
};
const CONN: FakeConn = {
  organizationId: 42, platform: "shopify",
  credentials: { shop: "x.myshopify.com", accessToken: "shpat_abc" },
};

const fetchMock = vi.fn();
beforeEach(() => {
  state.fix = { ...FIX };
  state.product = { ...PRODUCT };
  state.conn = { ...CONN };
  state.productUpdates = [];
  state.audits = [];
  state.seededAudits = [];
  state.executions = [];
  state.alreadyUndone = false;
  rescanMock.mockClear();
  fetchMock.mockReset();
  // Default: every Shopify call succeeds.
  fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "" });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("applyQualityFixToShopify", () => {
  it("writes title/description as product PUT and unknown fields as metafields", async () => {
    const res = await applyQualityFixToShopify({
      fixId: "p1_sku1", organizationId: 42,
      user: { id: 7, name: "Ada", role: "manager" },
    });

    expect(res.ok).toBe(true);
    expect(res.applied).toHaveLength(3);
    // 1 PUT for title+body_html + 1 POST for the color metafield = 2 fetch calls.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const productPut = fetchMock.mock.calls.find(([url, init]) =>
      String(url).endsWith("/products/p1.json") && (init as RequestInit).method === "PUT");
    expect(productPut).toBeDefined();
    const productBody = JSON.parse((productPut![1] as RequestInit).body as string);
    expect(productBody.product).toMatchObject({
      id: "p1", title: "New title", body_html: "New desc",
    });

    const metafieldPost = fetchMock.mock.calls.find(([url, init]) =>
      String(url).includes("/products/p1/metafields.json")
      && (init as RequestInit).method === "POST");
    expect(metafieldPost).toBeDefined();
    const metafieldBody = JSON.parse((metafieldPost![1] as RequestInit).body as string);
    expect(metafieldBody.metafield).toMatchObject({
      namespace: "omnianalytix_feed", key: "color", value: "blue",
    });
  });

  it("mirrors native field writes onto the warehouse row + bumps synced_at", async () => {
    await applyQualityFixToShopify({ fixId: "p1_sku1", organizationId: 42 });
    expect(state.productUpdates).toHaveLength(1);
    const u = state.productUpdates[0]!;
    expect(u.values.title).toBe("New title");
    expect(u.values.description).toBe("New desc");
    expect(u.values.syncedAt).toBeInstanceOf(Date);
  });

  it("records an audit_logs row and triggers a single-product rescan", async () => {
    const res = await applyQualityFixToShopify({
      fixId: "p1_sku1", organizationId: 42,
      user: { id: 7, name: "Ada", role: "manager" },
    });
    expect(res.auditId).toBe(1);
    expect(state.audits).toHaveLength(1);
    const a = state.audits[0]!;
    expect(a.platform).toBe("shopify");
    expect(a.toolName).toBe("shopify_apply_quality_fix");
    expect(a.status).toBe("applied");
    expect(((a.toolArgs as Record<string, unknown>).appliedBy as Record<string, unknown>).name).toBe("Ada");

    expect(rescanMock).toHaveBeenCalledWith(["p1_sku1"]);
    expect(res.rescanned).toBe(true);
  });

  it("returns ok=false when the fix isn't found for the supplied tenant", async () => {
    state.fix = null;
    const res = await applyQualityFixToShopify({ fixId: "missing", organizationId: 42 });
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatch(/not found/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns ok=false when no Shopify connection is configured", async () => {
    state.conn = null;
    const res = await applyQualityFixToShopify({ fixId: "p1_sku1", organizationId: 42 });
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatch(/Shopify connection/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports per-field errors when Shopify rejects a metafield write", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/metafields.json")) {
        return { ok: false, status: 422, text: async () => "invalid value" };
      }
      return { ok: true, status: 200, text: async () => "" };
    });
    const res = await applyQualityFixToShopify({ fixId: "p1_sku1", organizationId: 42 });
    expect(res.ok).toBe(false);
    expect(res.applied.find((a) => a.field === "title")?.ok).toBe(true);
    expect(res.applied.find((a) => a.field === "color")?.ok).toBe(false);
    // Audit row should still be written, with status=failed.
    expect(state.audits[0]!.status).toBe("failed");
  });
});

describe("undoQualityFixOnShopify", () => {
  // Helper — seed an apply audit row matching the FIX/PRODUCT fixtures.
  function seedApplyAudit(overrides: { ok?: boolean } = {}) {
    const ok = overrides.ok ?? true;
    state.seededAudits = [{
      id: 17,
      organizationId: 42,
      toolName: "shopify_apply_quality_fix",
      toolArgs: {
        fixId:     "p1_sku1",
        productId: "p1",
        sku:       "sku1",
        appliedFields: [
          { field: "title",       target: "product",   before: "Old title", after: "New title", ok },
          { field: "description", target: "product",   before: "Old desc",  after: "New desc",  ok },
          { field: "color",       target: "metafield", before: null,        after: "blue",      ok },
        ],
      },
    }];
  }

  it("replays the inverse writes and records a new undo audit row", async () => {
    seedApplyAudit();
    const res = await undoQualityFixOnShopify({
      auditId: 17, organizationId: 42,
      user: { id: 9, name: "Bob", role: "manager" },
    });
    expect(res.ok).toBe(true);
    expect(res.applied).toHaveLength(3);

    // 1 PUT for title+body_html (reverted), 1 POST for the metafield (empty value).
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const productPut = fetchMock.mock.calls.find(([url, init]) =>
      String(url).endsWith("/products/p1.json") && (init as RequestInit).method === "PUT");
    expect(productPut).toBeDefined();
    const productBody = JSON.parse((productPut![1] as RequestInit).body as string);
    expect(productBody.product).toMatchObject({
      id: "p1", title: "Old title", body_html: "Old desc",
    });

    // Mirrors the reverted native values onto the warehouse row.
    expect(state.productUpdates).toHaveLength(1);
    expect(state.productUpdates[0]!.values.title).toBe("Old title");
    expect(state.productUpdates[0]!.values.description).toBe("Old desc");

    // New audit row recorded with toolName=undo and originalAuditId=17.
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]!.toolName).toBe("shopify_undo_quality_fix");
    expect(state.audits[0]!.status).toBe("applied");
    const args = state.audits[0]!.toolArgs as Record<string, unknown>;
    expect(args.originalAuditId).toBe(17);
    expect((args.undoneBy as Record<string, unknown>).name).toBe("Bob");

    // Triggers a single-product rescan keyed by the original fixId.
    expect(rescanMock).toHaveBeenCalledWith(["p1_sku1"]);
    expect(res.rescanned).toBe(true);
  });

  it("only replays fields that successfully wrote at apply time", async () => {
    seedApplyAudit({ ok: false });
    const res = await undoQualityFixOnShopify({ auditId: 17, organizationId: 42 });
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatch(/no fields successfully/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses when the apply has already been undone", async () => {
    seedApplyAudit();
    state.alreadyUndone = true;
    const res = await undoQualityFixOnShopify({ auditId: 17, organizationId: 42 });
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatch(/already been undone/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.audits).toHaveLength(0);
  });

  it("returns ok=false when the audit row isn't found for the supplied tenant", async () => {
    state.seededAudits = [];
    const res = await undoQualityFixOnShopify({ auditId: 999, organizationId: 42 });
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatch(/not found/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects audit rows that aren't quality-fix applies", async () => {
    state.seededAudits = [{
      id: 17, organizationId: 42, toolName: "some_other_tool",
      toolArgs: { fixId: "p1_sku1", appliedFields: [] },
    }];
    const res = await undoQualityFixOnShopify({ auditId: 17, organizationId: 42 });
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatch(/not an apply action/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// NOTE: the token-bucket spacing / burst-cap requirement for the bulk path
// is covered by `shopify-rate-limiter.test.ts` in this same directory.
describe("applyQualityFixesToShopifyBulk", () => {
  it("invokes onProgress once per fix with the right shape and tallies summary counts", async () => {
    // Three apply attempts with distinct outcomes so we can verify the
    // ok / partial / failed buckets each get one tick.
    //
    // Each apply produces 2 fetches against the FIX fixture:
    //   1) PUT /products/p1.json  (title + body_html)
    //   2) POST /products/p1/metafields.json  (color)
    //
    // Apply #1 — both succeed             → ok
    // Apply #2 — PUT fails, POST succeeds → partial (color landed)
    // Apply #3 — PUT fails, POST fails    → failed
    const okResp   = { ok: true,  status: 200, text: async () => "" };
    const failResp = { ok: false, status: 422, text: async () => "shopify rejected" };
    const responses = [okResp, okResp, failResp, okResp, failResp, failResp];
    let call = 0;
    fetchMock.mockImplementation(async () => responses[call++]!);

    const progress: Array<{ fixId: string; index: number; total: number; resultOk: boolean }> = [];

    const summary = await applyQualityFixesToShopifyBulk(
      {
        fixIds: ["p1_sku1", "p2_sku2", "p3_sku3"],
        organizationId: 42,
        user: { id: 7, name: "Ada", role: "manager" },
      },
      async (p) => {
        progress.push({
          fixId:    p.fixId,
          index:    p.index,
          total:    p.total,
          resultOk: p.result.ok,
        });
      },
    );

    expect(progress).toHaveLength(3);
    expect(progress.map((p) => p.fixId)).toEqual(["p1_sku1", "p2_sku2", "p3_sku3"]);
    expect(progress.map((p) => p.index)).toEqual([0, 1, 2]);
    for (const p of progress) expect(p.total).toBe(3);
    expect(progress.map((p) => p.resultOk)).toEqual([true, false, false]);

    expect(summary.total).toBe(3);
    expect(summary.succeeded).toBe(1);
    expect(summary.partial).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.results).toHaveLength(3);
  });

  it("de-duplicates the fixIds before issuing any work", async () => {
    const progress: string[] = [];
    const summary = await applyQualityFixesToShopifyBulk(
      { fixIds: ["p1_sku1", "p1_sku1", "p1_sku1"], organizationId: 42 },
      async (p) => { progress.push(p.fixId); },
    );
    expect(summary.total).toBe(1);
    expect(progress).toEqual(["p1_sku1"]);
  });

  it("does not abort the run when an onProgress consumer throws", async () => {
    const seen: string[] = [];
    const summary = await applyQualityFixesToShopifyBulk(
      { fixIds: ["p1_sku1", "p2_sku2"], organizationId: 42 },
      async (p) => {
        seen.push(p.fixId);
        throw new Error("consumer exploded");
      },
    );
    expect(seen).toEqual(["p1_sku1", "p2_sku2"]);
    expect(summary.total).toBe(2);
    expect(summary.succeeded).toBe(2);
  });
});
