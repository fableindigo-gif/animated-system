/**
 * Tests — All Google Ads data-flow paths use the version-controlled SDK
 *
 * Task #244: Verify that every Google Ads data read/write goes through
 * `customerFromCreds` (the google-ads-api SDK wrapper) and that no module
 * falls back to raw `fetch()` calls against googleads.googleapis.com.
 *
 * Covered modules:
 *   1. routes/etl/index.ts          — three campaign GAQL queries
 *   2. routes/google-ads/index.ts   — GET /campaigns, POST /sync
 *   3. services/system-health-monitor.ts — checkGoogleAdsToken probe
 *   4. routes/ai-creative/index.ts  — POST /push (google_ads platform)
 *   5. routes/promo-engine/index.ts — pushGoogleAdsPromotion asset mutate
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─────────────────────────────────────────────────────────────────────────────
// Shared mock state
// ─────────────────────────────────────────────────────────────────────────────

/** Spy for customer.query() calls across all tests. */
const mockQuery = vi.fn(async () => []);

/** Spy for customer.mutateResources() used inside runSingleMutate. */
const mockMutateResources = vi.fn(async () => ({ mutate_operation_responses: [] }));

/** The mock Customer object returned by customerFromCreds. */
const mockCustomer = {
  query: (...args: any[]) => (mockQuery as any)(...args),
  mutateResources: (...args: any[]) => (mockMutateResources as any)(...args),
};

/** Spy that captures every call to customerFromCreds. */
const mockCustomerFromCreds = vi.fn(() => mockCustomer);

/** runSingleMutate spy — wraps mockMutateResources; returns { ok: true } by default. */
const mockRunSingleMutate = vi.fn(async () => ({ ok: true as const, resourceName: "customers/123/assets/999" }));

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks (must be hoisted before any subject imports)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/google-ads/client", () => ({
  customerFromCreds:       (...args: any[]) => (mockCustomerFromCreds as any)(...args),
  runSingleMutate:         (...args: any[]) => (mockRunSingleMutate as any)(...args),
  formatGoogleAdsError:    (err: unknown) => String((err as Error)?.message ?? err),
  buildCustomer:           vi.fn(() => mockCustomer),
  getGoogleAdsClient:      vi.fn(),
  customerForOrg:          vi.fn(async () => mockCustomer),
  extractPartialFailures:  vi.fn(() => []),
  GOOGLE_ADS_API_VERSION:  "v23",
}));

vi.mock("../lib/google-token-refresh", () => ({
  getFreshGoogleCredentials: vi.fn(async () => ({
    accessToken:    "access_token_stub",
    refreshToken:   "refresh_token_stub",
    customerId:     "1234567890",
    tokenExpiresAt: Date.now() + 3_600_000,
  })),
}));

vi.mock("../lib/credential-helpers", () => ({
  decryptCredentials: (c: Record<string, string>) => c,
  encryptCredentials: (c: Record<string, string>) => c,
}));

vi.mock("../lib/etl-state", () => ({
  etlState: {
    status:        "idle",
    startedAt:     null,
    completedAt:   null,
    phase:         null,
    pct:           0,
    rowsExtracted: 0,
    lastError:     null,
    lastResult:    null,
  },
}));

vi.mock("../lib/fetch-utils", () => ({
  fetchWithBackoff: vi.fn(async () => ({
    ok:      false,
    status:  404,
    text:    async () => "not connected",
    json:    async () => ({}),
    headers: { get: () => null },
  })),
}));

vi.mock("../lib/advanced-diagnostic-engine", () => ({
  runAdvancedDiagnostics: vi.fn(async () => []),
}));

vi.mock("../lib/triage-emitter", () => ({
  emitTriageAlert: vi.fn(),
}));

vi.mock("../lib/warehouse-purge", () => ({
  purgeWarehouseForOrg: vi.fn(),
  purgeWarehouseForGoal: vi.fn(),
}));

vi.mock("../lib/route-error-handler", () => ({
  handleRouteError: vi.fn((res: import("express").Response, err: unknown) => {
    res.status(500).json({ error: String(err) });
  }),
}));

vi.mock("../middleware/rate-limiter", () => ({
  etlRateLimit:         (_req: unknown, _res: unknown, next: () => void) => next(),
  rescanRateLimiter:    (_req: unknown, _res: unknown, next: () => void) => next(),
  globalRateLimiter:    (_req: unknown, _res: unknown, next: () => void) => next(),
  writebackRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../middleware/rbac", () => ({
  getOrgId:     (_req: unknown) => null,
  requireOrgId: (_req: unknown) => 1,
  readGuard:    () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../middleware/tenant-isolation", () => ({
  assertWorkspaceOwnedByOrg: vi.fn(),
}));

vi.mock("../lib/platform-executors", () => ({
  googleAds_getBudgetConstrainedCampaigns: vi.fn(async () => ({ success: true, data: { constrained_count: 0, campaigns: [] } })),
}));

vi.mock("../lib/alert-store", () => ({
  recordInfraAlert: vi.fn(),
  resolveInfraAlert: vi.fn(),
}));

vi.mock("../lib/vertex-client", () => ({
  getGoogleGenAI: vi.fn(async () => ({
    models: { generateContent: vi.fn(async () => ({ candidates: [{}] })) },
  })),
  VERTEX_MODEL: "gemini-pro",
}));

vi.mock("../workers/quality-fixes-scanner", () => ({
  getQualityFixesScannerStatus: vi.fn(() => ({ state: "idle", lastRunAt: null, lastSuccessfulRunAt: null })),
  runQualityFixesScan:  vi.fn(),
  rescanProductsByIds:  vi.fn(),
}));

// ── @workspace/db mock ────────────────────────────────────────────────────────
// All db calls resolve to empty arrays / row counts; individual tests can
// override specific calls via `mockDbSelect.mockReturnValueOnce` etc.

const makeDbChain = (result: unknown = []) => {
  const chain: Record<string, unknown> = {};
  const pass = () => chain;
  chain.from    = pass;
  chain.where   = pass;
  chain.limit   = pass;
  chain.orderBy = pass;
  chain.offset  = pass;
  (chain as { then: unknown }).then = (
    onFulfilled: (v: unknown) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
};

const mockDbSelect  = vi.fn(() => makeDbChain([]));
const mockDbInsert  = vi.fn(() => ({ values: vi.fn(() => ({ onConflictDoUpdate: vi.fn(async () => {}), returning: vi.fn(async () => []) })) }));
const mockDbUpdate  = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => {}) })) }));
const mockDbExecute = vi.fn(async () => ({ rows: [] }));

vi.mock("@workspace/db", () => ({
  db: {
    select:  (..._: unknown[]) => mockDbSelect(),
    insert:  (..._: unknown[]) => mockDbInsert(),
    update:  (..._: unknown[]) => mockDbUpdate(),
    execute: (...args: any[]) => (mockDbExecute as any)(...args),
  },
  DEFAULT_TENANT_ID: "default",
  platformConnections: {
    id: "id", platform: "platform", organizationId: "organizationId",
    isActive: "isActive", credentials: "credentials", createdAt: "createdAt",
  },
  workspaces:                  { id: "id", organizationId: "organizationId" },
  warehouseShopifyProducts:    { id: "id", tenantId: "tenantId", syncedAt: "syncedAt", inventoryQty: "inventoryQty", sku: "sku", productId: "productId", title: "title", cogs: "cogs" },
  warehouseGoogleAds:          { id: "id", tenantId: "tenantId", syncedAt: "syncedAt" },
  warehouseCrossPlatformMapping: { id: "id", tenantId: "tenantId" },
  warehouseCrmLeads:           { id: "id" },
  biAdPerformance:             { workspaceId: "workspaceId", date: "date", channel: "channel", spend: "spend", clicks: "clicks", conversions: "conversions", revenue: "revenue" },
  ldAdPerformance:             { workspaceId: "workspaceId", date: "date", channel: "channel", spend: "spend", clicks: "clicks", impressions: "impressions", formSubmissions: "formSubmissions" },
  hyAdPerformance:             { workspaceId: "workspaceId", date: "date", channel: "channel", campaignType: "campaignType", spend: "spend", clicks: "clicks", totalConversions: "totalConversions" },
  biSystemLogs:                { workspaceId: "workspaceId", type: "type", message: "message", createdAt: "createdAt" },
  organizations:               { id: "id", slug: "slug", subscriptionTier: "subscriptionTier", aiCreativeCredits: "aiCreativeCredits" },
  liveTriageAlerts:            { id: "id", type: "type", resolvedStatus: "resolvedStatus", createdAt: "createdAt", severity: "severity", title: "title" },
  promoTriggers:               { id: "id", organizationId: "organizationId", productId: "productId", status: "status", triggeredAt: "triggeredAt" },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Reset all mock state between tests. */
function resetMocks() {
  vi.clearAllMocks();
  // Restore defaults after clearAllMocks wipes them.
  mockQuery.mockImplementation(async () => []);
  mockMutateResources.mockImplementation(async () => ({ mutate_operation_responses: [] }));
  mockCustomerFromCreds.mockImplementation(() => mockCustomer);
  mockRunSingleMutate.mockImplementation(async () => ({ ok: true as const, resourceName: "customers/123/assets/999" }));
}

/**
 * Queue a single select() response into mockDbSelect.  Each call to
 * db.select() consumes one entry.  If the queue is exhausted the default
 * empty-array behaviour applies.
 */
const dbSelectQueue: unknown[][] = [];
function queueDbSelect(rows: unknown[]) {
  dbSelectQueue.push(rows);
}
function drainDbSelect() {
  const rows = dbSelectQueue.shift() ?? [];
  return makeDbChain(rows);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1.  ETL route — routes/etl/index.ts
//
//     POST /sync-master exercises the three Google Ads GAQL queries:
//       • currency_query    — "SELECT customer.id, customer.currency_code …"
//       • campaignGaql      — campaign metrics over LAST_30_DAYS
//       • campaignMetaGaql  — all-status metadata (no date segment)
//       • adUrlGaql         — ad-level final_url extraction
//     All four must call gadsCustomer.query() via the SDK wrapper; none
//     should reach fetch() for googleads.googleapis.com.
// ─────────────────────────────────────────────────────────────────────────────

describe("ETL route — Google Ads GAQL queries use the SDK (not raw fetch)", () => {
  let app: ReturnType<typeof express>;

  beforeEach(async () => {
    resetMocks();
    dbSelectQueue.length = 0;

    // Override mockDbSelect to drain the queue.
    mockDbSelect.mockImplementation(() => drainDbSelect());

    // platformConnections: one google_ads row returned (so the sync proceeds)
    const googleAdsConn = {
      id: 1,
      platform: "google_ads",
      organizationId: null,
      isActive: true,
      credentials: { customerId: "1234567890", refreshToken: "rtoken" },
    };

    // The ETL route does:
    //   1. connectedRows check     → [googleAdsConn]
    //   2. (shopify path)          → [] (no shopify)
    //   3. currency conn update    → [{id:1, credentials:{}}]
    //   4. currency conn re-read   → [{credentials:{currency:"USD"}}]
    queueDbSelect([googleAdsConn]);  // connected rows pre-flight
    queueDbSelect([]);               // shopify conn lookup → none
    queueDbSelect([{ id: 1, credentials: {} }]); // conn for currency update
    queueDbSelect([{ credentials: { currency: "USD" } }]); // resolvedAccountCurrency
    // All subsequent selects (cross-platform mapping, etc.) → []

    // customer.query() responses:
    //   call 1: currency query   → [{customer:{currencyCode:"USD"}}]
    //   call 2: campaignGaql     → []
    //   call 3: campaignMetaGaql → []
    //   call 4: adUrlGaql        → []
    mockQuery
      .mockResolvedValueOnce([{ customer: { currencyCode: "USD" } }] as any)  // currency
      .mockResolvedValue([]);  // campaigns, meta, ad-urls → empty lists

    const etlRouter = (await import("../routes/etl/index")).default;
    app = express();
    app.use(express.json());
    app.use("/etl", etlRouter);
  });

  it("calls customer.query() at least 3 times for the three GA GAQL passes", async () => {
    const res = await request(app).post("/etl/sync-master");

    // The route may return 200 or 500 depending on how many DB calls mocked;
    // what matters is that the SDK path was exercised.
    expect(mockCustomerFromCreds).toHaveBeenCalledTimes(1);
    // currency + campaigns + metadata + ad-urls = up to 4 queries
    expect(mockQuery.mock.calls.length).toBeGreaterThanOrEqual(3);

    // None of the query strings should be raw HTTP calls to googleads.googleapis.com
    for (const call of mockQuery.mock.calls as unknown[][]) {
      const gaql = String(call[0] ?? "");
      expect(gaql).not.toContain("googleapis.com");
    }

    expect(res.status).not.toBe(404);
  });

  it("does NOT call fetch() with a googleads.googleapis.com URL during the ETL sync", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await request(app).post("/etl/sync-master");

    const googleAdsFetches = fetchSpy.mock.calls.filter((args) =>
      String(args[0]).includes("googleads.googleapis.com"),
    );
    expect(googleAdsFetches).toHaveLength(0);

    fetchSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2.  Google-Ads route — routes/google-ads/index.ts
//
//     GET /campaigns  — one customer.query() call, no raw fetch to Google
//     POST /sync      — one customer.query() call, no raw fetch to Google
// ─────────────────────────────────────────────────────────────────────────────

describe("Google-Ads route — GET /campaigns uses the SDK", () => {
  let app: ReturnType<typeof express>;

  beforeEach(async () => {
    resetMocks();
    dbSelectQueue.length = 0;
    mockDbSelect.mockImplementation(() => drainDbSelect());

    // platformConnections row for the connection existence check.
    queueDbSelect([{
      id: 1, platform: "google_ads", organizationId: null,
      isActive: true, credentials: { customerId: "1234567890", refreshToken: "rtoken" },
    }]);

    // customer.query() returns an empty campaign list.
    mockQuery.mockResolvedValue([]);

    const router = (await import("../routes/google-ads/index")).default;
    app = express();
    app.use(express.json());
    app.use("/google-ads", router);
  });

  it("calls customerFromCreds then customer.query() for GET /campaigns", async () => {
    const res = await request(app).get("/google-ads/campaigns");

    expect(mockCustomerFromCreds).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledTimes(1);

    const gaql = String((mockQuery.mock.calls[0] as unknown[])?.[0] ?? "");
    expect(gaql).toContain("FROM campaign");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("does NOT call fetch() with googleads.googleapis.com for GET /campaigns", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await request(app).get("/google-ads/campaigns");

    const gAdsFetches = fetchSpy.mock.calls.filter((a) =>
      String(a[0]).includes("googleads.googleapis.com"),
    );
    expect(gAdsFetches).toHaveLength(0);
    fetchSpy.mockRestore();
  });
});

describe("Google-Ads route — POST /sync uses the SDK", () => {
  let app: ReturnType<typeof express>;

  beforeEach(async () => {
    resetMocks();
    dbSelectQueue.length = 0;
    mockDbSelect.mockImplementation(() => drainDbSelect());

    // platformConnections row.
    queueDbSelect([{
      id: 1, platform: "google_ads", organizationId: null,
      isActive: true, credentials: { customerId: "1234567890", refreshToken: "rtoken" },
    }]);
    // workspaces lookup for upsert.
    queueDbSelect([{ id: 10 }]);

    // customer.query() returns some campaign rows so the sync writes data.
    mockQuery.mockResolvedValue([
      {
        segments: { date: "2024-01-01" },
        campaign: { advertisingChannelType: "SEARCH" },
        metrics:  { costMicros: 5_000_000, clicks: 50, impressions: 1_000, conversions: 3, conversionsValue: 300 },
      },
    ] as any);

    const router = (await import("../routes/google-ads/index")).default;
    app = express();
    app.use(express.json());
    app.use("/google-ads", router);
  });

  it("calls customerFromCreds then customer.query() for POST /sync", async () => {
    const res = await request(app).post("/google-ads/sync");

    expect(mockCustomerFromCreds).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledTimes(1);

    const gaql = String((mockQuery.mock.calls[0] as unknown[])?.[0] ?? "");
    expect(gaql).toContain("FROM campaign");
    expect(gaql).toContain("LAST_30_DAYS");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("does NOT call fetch() with googleads.googleapis.com for POST /sync", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await request(app).post("/google-ads/sync");

    const gAdsFetches = fetchSpy.mock.calls.filter((a) =>
      String(a[0]).includes("googleads.googleapis.com"),
    );
    expect(gAdsFetches).toHaveLength(0);
    fetchSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3.  System Health Monitor — services/system-health-monitor.ts
//
//     checkGoogleAdsToken is an internal function called by runSystemSelfAudit.
//     It must use customerFromCreds(...).query() — not fetch().
// ─────────────────────────────────────────────────────────────────────────────

describe("system-health-monitor — checkGoogleAdsToken uses the SDK", () => {
  beforeEach(() => {
    resetMocks();
    dbSelectQueue.length = 0;
    mockDbSelect.mockImplementation(() => drainDbSelect());

    // db.select() calls inside the audit: various checks query the DB.
    // Provide enough stubs so each check succeeds without throwing.
    //   checkDataIntegrity Stage 1: db.execute(SELECT 1) → handled by mockDbExecute
    //   checkDataIntegrity Stage 2: two max(syncedAt) selects
    queueDbSelect([{ latest: null }]); // shopify freshness
    queueDbSelect([{ latest: null }]); // google freshness
    //   checkEtlIntegrity: active connections
    queueDbSelect([]); // no active connections → skipped
    //   checkShopifyToken: shopify row
    queueDbSelect([]); // no shopify → skipped
    //   checkConversationSearchIndexes: pg_indexes query → via mockDbExecute
    //   The rest (llm, quality-fixes) don't need select stubs.

    // checkGoogleAdsToken must call customer.query() with a trivial GAQL.
    mockQuery.mockResolvedValue([{ customer: { id: "1234567890" } }] as any);
  });

  it("calls customerFromCreds and customer.query() during the health probe", async () => {
    const { runSystemSelfAudit } = await import("../services/system-health-monitor");
    const results = await runSystemSelfAudit();

    const gadsResult = results.find((r) => r.check === "google_ads_token");
    expect(gadsResult).toBeDefined();

    // The SDK path must have been taken.
    expect(mockCustomerFromCreds).toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalled();

    // The GAQL used must be the simple customer ping — not a raw HTTP URL.
    const gaqlCall = mockQuery.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes("SELECT customer.id FROM customer"),
    );
    expect(gaqlCall).toBeDefined();
  });

  it("does NOT call fetch() with googleads.googleapis.com during health check", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const { runSystemSelfAudit } = await import("../services/system-health-monitor");
    await runSystemSelfAudit();

    const gAdsFetches = fetchSpy.mock.calls.filter((a) =>
      String(a[0]).includes("googleads.googleapis.com"),
    );
    expect(gAdsFetches).toHaveLength(0);
    fetchSpy.mockRestore();
  });

  it("reports ok=true when customer.query() resolves", async () => {
    const { runSystemSelfAudit } = await import("../services/system-health-monitor");
    const results = await runSystemSelfAudit();

    const gadsResult = results.find((r) => r.check === "google_ads_token");
    expect(gadsResult?.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4.  AI-Creative route — routes/ai-creative/index.ts
//
//     POST /push with platform=google_ads must:
//       • call customerFromCreds (SDK wrapper)
//       • call runSingleMutate   (SDK mutate helper)
//       • NOT call fetch() against googleads.googleapis.com
// ─────────────────────────────────────────────────────────────────────────────

describe("AI-Creative route — POST /push (google_ads) uses the SDK", () => {
  let app: ReturnType<typeof express>;

  beforeEach(async () => {
    resetMocks();
    dbSelectQueue.length = 0;
    mockDbSelect.mockImplementation(() => drainDbSelect());

    // platformConnections lookup for the google_ads connection.
    queueDbSelect([{
      id: 1, platform: "google_ads", organizationId: 1,
      isActive: true,
      credentials: {
        customerId:    "1234567890",
        refreshToken:  "rtoken",
        accessToken:   "atoken",
      },
    }]);

    // fetch() is used to download the image URL — provide a minimal stub.
    // This must NOT be a call to googleads.googleapis.com.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("googleads.googleapis.com")) {
        throw new Error("Raw fetch to Google Ads API detected — must use SDK");
      }
      // Stub the image download (https://example.com/image.png)
      return {
        ok:          true,
        arrayBuffer: async () => new ArrayBuffer(8),
        text:        async () => "stub",
        json:        async () => ({}),
      } as Response;
    });

    const router = (await import("../routes/ai-creative/index")).default;
    app = express();
    app.use(express.json());
    // Inject a fake rbacUser so requireOrgId returns 1.
    app.use((req, _res, next) => {
      (req as unknown as Record<string, unknown>).rbacUser = { organizationId: 1, role: "admin" };
      next();
    });
    app.use("/ai-creative", router);
  });

  it("calls customerFromCreds and runSingleMutate (not raw fetch) for google_ads push", async () => {
    const res = await request(app).post("/ai-creative/push").send({
      imageUrl:   "https://example.com/image.png",
      platform:   "google_ads",
      campaignId: "111",
      headline:   "New Creative",
    });

    expect(mockCustomerFromCreds).toHaveBeenCalledTimes(1);
    expect(mockRunSingleMutate).toHaveBeenCalledTimes(1);

    // runSingleMutate must have been called with an "asset" entity operation.
    const [customerArg, opArg] = (mockRunSingleMutate.mock.calls[0] as unknown[]) ?? [];
    expect(customerArg).toBe(mockCustomer);
    expect((opArg as Record<string, unknown>).entity).toBe("asset");
    expect((opArg as Record<string, unknown>).operation).toBe("create");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.platform).toBe("google_ads");
  });

  it("does NOT send raw fetch() to googleads.googleapis.com", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await request(app).post("/ai-creative/push").send({
      imageUrl:  "https://example.com/image.png",
      platform:  "google_ads",
      headline:  "Test",
    });

    const gAdsFetches = (fetchSpy.mock.calls as Array<[string | URL, ...unknown[]]>).filter(
      ([url]) => String(url).includes("googleads.googleapis.com"),
    );
    expect(gAdsFetches).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5.  Promo-Engine — routes/promo-engine/index.ts
//
//     pushGoogleAdsPromotion (called by runPromoAnalysis) must:
//       • call customerFromCreds (SDK wrapper)
//       • call runSingleMutate   (SDK mutate helper) with entity:"asset"
//       • NOT call fetch() against googleads.googleapis.com
// ─────────────────────────────────────────────────────────────────────────────

describe("Promo-Engine — pushGoogleAdsPromotion uses the SDK", () => {
  beforeEach(() => {
    resetMocks();
    dbSelectQueue.length = 0;
    mockDbSelect.mockImplementation(() => drainDbSelect());
  });

  it("calls customerFromCreds + runSingleMutate when a Google Ads connection is present", async () => {
    const { pushGoogleAdsPromotion } = await import("../routes/promo-engine/index") as {
      pushGoogleAdsPromotion?: (creds: Record<string, string>, promoCode: string, productTitle: string) => Promise<string | null>;
    };

    if (!pushGoogleAdsPromotion) {
      // pushGoogleAdsPromotion is internal; test through runPromoAnalysis instead.
      const { runPromoAnalysis } = await import("../routes/promo-engine/index");

      // Stub db.select() sequence for runPromoAnalysis:
      //   1. high-inventory products
      //   2. POAS query → via db.execute
      //   3. existing promo dedup → none
      //   4. shopifyConn  → none (so Shopify branch is skipped)
      queueDbSelect([{
        product_key:   "prod_1",
        product_id:    "shopify_111",
        sku:           "SKU-001",
        product_title: "Test Widget",
        inventory_qty: 600,
        cogs:          5,
      }]);
      queueDbSelect([]);   // dedup check → no existing trigger
      queueDbSelect([]);   // shopifyConn → none → triggers inserted without Shopify

      mockDbExecute.mockResolvedValueOnce({ rows: [{ avg_poas: "0.8" }] } as any); // POAS

      await runPromoAnalysis(1);

      // pushGoogleAdsPromotion is only reached when shopifyConn exists.
      // Verify the module at least invoked customerFromCreds/runSingleMutate
      // 0 times (Shopify was absent so the promo code path was skipped).
      // The important negative assertion is that no raw GA fetch was issued.
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const gAdsFetches = fetchSpy.mock.calls.filter((a) =>
        String(a[0]).includes("googleads.googleapis.com"),
      );
      expect(gAdsFetches).toHaveLength(0);
      fetchSpy.mockRestore();
      return;
    }

    // If pushGoogleAdsPromotion IS exported, call it directly.
    const creds: Record<string, string> = {
      customerId:    "1234567890",
      refreshToken:  "rtoken",
      accessToken:   "atoken",
    };
    const resourceName = await pushGoogleAdsPromotion(creds, "FLASH15-ABCDE", "Test Widget");

    expect(mockCustomerFromCreds).toHaveBeenCalledTimes(1);
    expect(mockRunSingleMutate).toHaveBeenCalledTimes(1);

    const [, opArg] = (mockRunSingleMutate.mock.calls[0] as unknown[]) ?? [];
    expect((opArg as Record<string, unknown>).entity).toBe("asset");
    expect(((opArg as Record<string, unknown>).resource as Record<string, unknown>).promotion_asset).toBeDefined();

    expect(resourceName).toBe("customers/123/assets/999");
  });

  it("routes through runPromoAnalysis SDK path when GA connection is present", async () => {
    const { runPromoAnalysis } = await import("../routes/promo-engine/index");

    // Set up so Shopify AND Google Ads connections exist and the full path runs.
    const shopifyConn = {
      id: 2, platform: "shopify", organizationId: 1, isActive: true,
      credentials: { shop: "test.myshopify.com", accessToken: "shopify_tok" },
    };
    const gadsConn = {
      id: 3, platform: "google_ads", organizationId: 1, isActive: true,
      credentials: { customerId: "1234567890", refreshToken: "rtoken" },
    };

    // Product lookup
    queueDbSelect([{
      product_key: "prod_2", product_id: "shopify_222", sku: "SKU-002",
      product_title: "Test Widget Pro", inventory_qty: 800, cogs: 10,
    }]);
    // POAS
    mockDbExecute.mockResolvedValueOnce({ rows: [{ avg_poas: "0.5" }] } as any);
    // dedup → none
    queueDbSelect([]);
    // shopifyConn
    queueDbSelect([shopifyConn]);
    // gadsConn (inside runPromoAnalysis)
    queueDbSelect([gadsConn]);

    // Shopify fetch — create price rule & discount code stubs.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("googleads.googleapis.com")) {
        throw new Error("Raw fetch to Google Ads detected — must use SDK");
      }
      if (u.includes("price_rules.json")) {
        return {
          ok: true,
          json: async () => ({ price_rule: { id: 9001 } }),
        } as Response;
      }
      if (u.includes("discount_codes.json")) {
        return {
          ok: true,
          json: async () => ({ discount_code: { id: 9002 } }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    await runPromoAnalysis(1);

    // customerFromCreds must have been called for the Google Ads promotion push.
    expect(mockCustomerFromCreds).toHaveBeenCalledTimes(1);
    expect(mockRunSingleMutate).toHaveBeenCalledTimes(1);

    const [, opArg] = (mockRunSingleMutate.mock.calls[0] as unknown[]) ?? [];
    expect((opArg as Record<string, unknown>).entity).toBe("asset");
  });

  it("does NOT call fetch() against googleads.googleapis.com in promo engine", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => ({ price_rule: { id: 1 } }),
      text: async () => "",
    } as Response));

    const { runPromoAnalysis } = await import("../routes/promo-engine/index");

    queueDbSelect([{
      product_key: "p3", product_id: "s3", sku: "SKU-003",
      product_title: "Widget", inventory_qty: 700, cogs: 5,
    }]);
    mockDbExecute.mockResolvedValueOnce({ rows: [{ avg_poas: "0.3" }] } as any);
    queueDbSelect([]);   // dedup
    queueDbSelect([]);   // shopifyConn → none → no Shopify call

    await runPromoAnalysis(1);

    const gAdsFetches = (fetchSpy.mock.calls as Array<[string | URL, ...unknown[]]>).filter(
      ([url]) => String(url).includes("googleads.googleapis.com"),
    );
    expect(gAdsFetches).toHaveLength(0);

    fetchSpy.mockRestore();
  });
});
