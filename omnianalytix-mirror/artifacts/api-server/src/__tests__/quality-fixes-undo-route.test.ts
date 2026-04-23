/**
 * Route-level E2E for POST /api/feed-enrichment/quality-fixes/undo.
 *
 * The undo *worker* has its own unit coverage; this suite locks down the
 * HTTP contract the route layer is responsible for:
 *
 *   • 200 — happy path: every inverse write landed at Shopify
 *   • 404 — audit row missing, or owned by a different tenant
 *           (cross-tenant boundary check)
 *   • 409 — business-rule violation: already undone, original is not an
 *           apply row, or zero successful fields to revert
 *   • 207 — partial success: at least one inverse write landed but at
 *           least one failed at Shopify
 *   • 502 — every inverse write failed at Shopify
 *   • 401 — no tenant context resolved on the request
 *   • 400 — body fails schema validation
 *
 * The worker is stubbed with a tiny in-memory audit store keyed by
 * (auditId → owner orgId + canned outcome) so we can drive each branch
 * deterministically without running the real Shopify HTTP path.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ── Logger ───────────────────────────────────────────────────────────────────
vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

// ── Stubs for unrelated route deps (mirrors the existing tenant test) ────────
vi.mock("../services/shoptimizer-service", () => ({
  MAX_BATCH: 50,
  optimizeBatch: vi.fn(),
  BatchTooLargeError: class extends Error { code = "BATCH_TOO_LARGE" as const; max = 50; },
  InfrastructureFailureError: class extends Error { code = "SHOPTIMIZER_UNREACHABLE" as const; },
}));
vi.mock("../lib/shoptimizer-client", async () => {
  const { z } = await import("zod");
  return { merchantProductSchema: z.object({ offerId: z.string() }).passthrough() };
});
vi.mock("../workers/quality-fixes-scanner", () => ({
  runQualityFixesScan: vi.fn(),
  rescanProductsByIds: vi.fn(),
}));
vi.mock("../workers/feed-enrichment", () => ({ runFeedEnrichment: vi.fn() }));
vi.mock("../workers/shoptimizer-writeback", () => ({
  runShoptimizerWriteback:        vi.fn(),
  runWritebackRetryScheduler:     vi.fn(),
  SHOPTIMIZER_WRITEBACK_TOOL:     "shoptimizer_writeback",
  SHOPTIMIZER_WRITEBACK_PLATFORM: "gmc",
  WRITEBACK_MAX_ATTEMPTS:         5,
  classifyWritebackFailure:       vi.fn(),
}));
vi.mock("../routes/feed-enrichment/feedgen", () => ({ default: express.Router() }));

// ── Tier middleware drives the active tenant per request ─────────────────────
let currentOrgId: number | null = 1;
vi.mock("../middleware/enrichment-tier", () => ({
  checkEnrichmentTier: () => (req: any, _res: any, next: any) => {
    req.enrichmentCtx = currentOrgId == null
      ? null
      : { orgId: currentOrgId, tier: "base", limit: 5000, monthlyUsed: 0, remaining: 5000 };
    next();
  },
  resolveEnrichmentContext: async (req: any) => req.enrichmentCtx ?? null,
  TIER_LIMITS: { enterprise: Infinity, default: 5_000 },
}));

// ── Worker stub: a tiny audit store keyed by id → outcome ────────────────────
type Outcome =
  | { kind: "ok"; productId: string }
  | { kind: "partial"; productId: string }
  | { kind: "shopify_fail"; productId: string }
  | { kind: "already_undone"; productId: string }
  | { kind: "not_apply"; productId: string }
  | { kind: "no_fields"; productId: string };

interface AuditRow { ownerOrgId: number; outcome: Outcome }
const auditStore = new Map<number, AuditRow>();
const undoCalls: Array<{ auditId: number; organizationId: number }> = [];

vi.mock("../workers/quality-fixes-apply", () => ({
  applyQualityFixToShopify:        vi.fn(),
  applyQualityFixesToShopifyBulk:  vi.fn(),
  undoQualityFixOnShopify: vi.fn(async (opts: {
    auditId: number; organizationId: number;
  }) => {
    undoCalls.push({ auditId: opts.auditId, organizationId: opts.organizationId });
    const row = auditStore.get(opts.auditId);
    // Cross-tenant or missing audit → worker returns "not found".
    if (!row || row.ownerOrgId !== opts.organizationId) {
      return {
        ok: false, code: "NOT_FOUND", productId: null, applied: [],
        errors: ["Audit entry not found for this tenant."],
        auditId: null, rescanned: false,
      };
    }
    switch (row.outcome.kind) {
      case "ok":
        return {
          ok: true, code: "OK", productId: row.outcome.productId,
          applied: [{ field: "title", target: "product", ok: true }],
          errors: [], auditId: opts.auditId + 1000, rescanned: true,
        };
      case "partial":
        return {
          ok: false, code: "SHOPIFY_PARTIAL", productId: row.outcome.productId,
          applied: [
            { field: "title", target: "product", ok: true },
            { field: "color", target: "metafield", ok: false, error: "429 — throttled" },
          ],
          errors: ["color: 429 — throttled"],
          auditId: opts.auditId + 1000, rescanned: false,
        };
      case "shopify_fail":
        return {
          ok: false, code: "SHOPIFY_FAILED", productId: row.outcome.productId,
          applied: [
            { field: "title", target: "product", ok: false, error: "500 — boom" },
          ],
          errors: ["title: 500 — boom"],
          auditId: opts.auditId + 1000, rescanned: false,
        };
      case "already_undone":
        return {
          ok: false, code: "ALREADY_UNDONE", productId: row.outcome.productId, applied: [],
          errors: ["This apply has already been undone."],
          auditId: null, rescanned: false,
        };
      case "not_apply":
        return {
          ok: false, code: "NOT_AN_APPLY", productId: row.outcome.productId, applied: [],
          errors: [`Audit entry is not an apply action (toolName=${"shopify_undo_quality_fix"}).`],
          auditId: null, rescanned: false,
        };
      case "no_fields":
        return {
          ok: false, code: "NO_FIELDS", productId: row.outcome.productId, applied: [],
          errors: ["Original apply wrote no fields successfully — nothing to undo."],
          auditId: null, rescanned: false,
        };
    }
  }),
  APPLY_TOOL_NAME: "shopify_apply_quality_fix",
  UNDO_TOOL_NAME:  "shopify_undo_quality_fix",
  APPLY_PLATFORM:  "shopify",
}));

// ── Minimal @workspace/db stub — the undo route never touches the DB
//    directly (only the worker does, and we've stubbed the worker). We just
//    need module-load to succeed for the rest of the route file.
vi.mock("drizzle-orm", async (orig) => {
  const real: any = await (orig as any)();
  return {
    ...real,
    eq: (..._args: any[]) => ({}), gt: (..._args: any[]) => ({}),
    gte: (..._args: any[]) => ({}), inArray: (..._args: any[]) => ({}),
    and: (..._args: any[]) => ({}), desc: (..._args: any[]) => ({}),
    isNull: (..._args: any[]) => ({}), isNotNull: (..._args: any[]) => ({}),
    sql: Object.assign(
      (_strs: TemplateStringsArray, ..._vals: unknown[]) => ({}),
      { raw: (_: string) => ({}) },
    ),
  };
});
vi.mock("@workspace/db", () => {
  const tbl = (name: string) => ({ __table: name });
  return {
    db: {
      select: vi.fn(() => ({ from: vi.fn(() => ({
        innerJoin: vi.fn().mockReturnThis(),
        leftJoin:  vi.fn().mockReturnThis(),
        where:     vi.fn().mockReturnThis(),
        orderBy:   vi.fn().mockReturnThis(),
        offset:    vi.fn().mockReturnThis(),
        limit:     vi.fn().mockResolvedValue([]),
        then:      (r: any) => Promise.resolve([]).then(r),
      })) })),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => []) })) })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => {}) })) })),
      execute: vi.fn(async () => ({ rows: [] })),
    },
    feedEnrichmentJobs:        tbl("feed_enrichment_jobs"),
    warehouseShopifyProducts:  tbl("warehouse_shopify_products"),
    workspaces:                tbl("workspaces"),
    proposedTasks:             tbl("proposed_tasks"),
    productQualityFixes:       tbl("product_quality_fixes"),
    auditLogs:                 tbl("audit_logs"),
  };
});

// ── App boot — supertest drives the express app directly, no listen() ───────
let app: Express;

beforeAll(async () => {
  const { default: feedRouter } = await import("../routes/feed-enrichment/index");
  app = express();
  app.use(express.json());
  app.use("/api/feed-enrichment", feedRouter);
});

beforeEach(() => {
  auditStore.clear();
  undoCalls.length = 0;
  currentOrgId = 1;
});

async function postUndo(body: unknown): Promise<{ status: number; json: any }> {
  const r = await request(app)
    .post("/api/feed-enrichment/quality-fixes/undo")
    .set("content-type", "application/json")
    .send(body as object);
  // supertest decodes JSON automatically when content-type matches.
  return { status: r.status, json: r.body };
}

describe("POST /quality-fixes/undo — route contract", () => {
  it("200 on a fully successful undo", async () => {
    auditStore.set(42, { ownerOrgId: 1, outcome: { kind: "ok", productId: "p1" } });
    const r = await postUndo({ auditId: 42 });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.json.code).toBe("OK");
    expect(r.json.productId).toBe("p1");
    expect(r.json.applied).toHaveLength(1);
    expect(undoCalls).toEqual([{ auditId: 42, organizationId: 1 }]);
  });

  it("404 when the audit row does not exist", async () => {
    const r = await postUndo({ auditId: 999 });
    expect(r.status).toBe(404);
    expect(r.json.ok).toBe(false);
    expect(r.json.code).toBe("NOT_FOUND");
  });

  it("404 when the audit row belongs to a different tenant (cross-tenant rejection)", async () => {
    // Tenant 2 owns audit row 7.
    auditStore.set(7, { ownerOrgId: 2, outcome: { kind: "ok", productId: "t2_p1" } });
    // Tenant 1 attempts to undo it.
    currentOrgId = 1;
    const r = await postUndo({ auditId: 7 });
    expect(r.status).toBe(404);
    expect(r.json.code).toBe("NOT_FOUND");
    // The worker was invoked with the *caller's* orgId, not the row owner's
    // — i.e. the route does not let the client choose which tenant to act as.
    expect(undoCalls).toEqual([{ auditId: 7, organizationId: 1 }]);

    // Sanity: the legitimate owner can still undo their own row.
    currentOrgId = 2;
    const r2 = await postUndo({ auditId: 7 });
    expect(r2.status).toBe(200);
    expect(r2.json.productId).toBe("t2_p1");
    expect(r2.json.code).toBe("OK");
  });

  it("409 when the apply has already been undone", async () => {
    auditStore.set(11, { ownerOrgId: 1, outcome: { kind: "already_undone", productId: "p9" } });
    const r = await postUndo({ auditId: 11 });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("ALREADY_UNDONE");
  });

  it("409 when the audit row is itself an undo, not an apply", async () => {
    auditStore.set(12, { ownerOrgId: 1, outcome: { kind: "not_apply", productId: "p9" } });
    const r = await postUndo({ auditId: 12 });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("NOT_AN_APPLY");
  });

  it("409 when the original apply wrote zero fields successfully", async () => {
    auditStore.set(13, { ownerOrgId: 1, outcome: { kind: "no_fields", productId: "p9" } });
    const r = await postUndo({ auditId: 13 });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("NO_FIELDS");
  });

  it("207 on partial Shopify failure (some inverse writes landed, some didn't)", async () => {
    auditStore.set(20, { ownerOrgId: 1, outcome: { kind: "partial", productId: "p2" } });
    const r = await postUndo({ auditId: 20 });
    expect(r.status).toBe(207);
    expect(r.json.ok).toBe(false);
    expect(r.json.code).toBe("SHOPIFY_PARTIAL");
    expect(r.json.applied.filter((a: any) => a.ok)).toHaveLength(1);
    expect(r.json.applied.filter((a: any) => !a.ok)).toHaveLength(1);
  });

  it("502 when every inverse write failed at Shopify", async () => {
    auditStore.set(21, { ownerOrgId: 1, outcome: { kind: "shopify_fail", productId: "p3" } });
    const r = await postUndo({ auditId: 21 });
    expect(r.status).toBe(502);
    expect(r.json.ok).toBe(false);
    expect(r.json.code).toBe("SHOPIFY_FAILED");
    expect(r.json.applied.every((a: any) => !a.ok)).toBe(true);
  });

  it("401 when no tenant context is resolved", async () => {
    auditStore.set(30, { ownerOrgId: 1, outcome: { kind: "ok", productId: "p4" } });
    currentOrgId = null;
    const r = await postUndo({ auditId: 30 });
    expect(r.status).toBe(401);
    // Worker must not have been touched without a tenant.
    expect(undoCalls).toHaveLength(0);
  });

  it("400 when the body fails schema validation", async () => {
    const r = await postUndo({ auditId: "not-a-number" });
    expect(r.status).toBe(400);
    expect(undoCalls).toHaveLength(0);
  });
});
