/**
 * SEC-03 follow-up — Audit & lockdown of routes that derived `workspaceId`
 * from the request body or query string without verifying ownership.
 *
 * For each route that accepts a body/query workspaceId we assert two things:
 *   1. A workspaceId belonging to a SIBLING tenant is rejected (403).
 *   2. A workspaceId belonging to the CALLER's organisation is accepted.
 *
 * We use the same lightweight mocking pattern as connections-rbac.test.ts —
 * mock `@workspace/db` so `assertWorkspaceOwnedByOrg`'s SELECT against the
 * `workspaces` table returns a row whose `organizationId` we control.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction, Router } from "express";

interface ExpressLayer {
  route?: ExpressRoute;
  handle: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
}
interface ExpressRoute {
  path: string;
  methods: Record<string, boolean>;
  stack: ExpressLayer[];
}

// ── Tenant fixture state ──────────────────────────────────────────────────────
// `workspaceOrgMap[wsId] = orgId`. Looked up by the mocked `db.select…where`.
const workspaceOrgMap: Record<number, number> = {
  10: 1, // workspace 10 belongs to org 1
  20: 2, // workspace 20 belongs to org 2 (the "sibling tenant")
};
let lastSelectedWorkspaceId: number | null = null;
let inserted: Array<Record<string, unknown>> = [];

vi.mock("@workspace/db", () => {
  const tableSentinel = (cols: string[]): Record<string, string> =>
    Object.fromEntries(cols.map((c) => [c, c]));
  const workspacesTable = tableSentinel(["id", "organizationId"]);
  return {
    db: {
      select: () => ({
        from: () => ({
          where: (cond: { __wsId?: number }) => {
            // The drizzle eq() mock below puts the requested id on the predicate.
            lastSelectedWorkspaceId = cond?.__wsId ?? null;
            return {
              limit: () => {
                if (lastSelectedWorkspaceId == null) return Promise.resolve([]);
                const orgId = workspaceOrgMap[lastSelectedWorkspaceId];
                return Promise.resolve(orgId != null ? [{ organizationId: orgId }] : []);
              },
            };
          },
        }),
      }),
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          inserted.push(v);
          return {
            returning: () => Promise.resolve([{ id: 999, ...v }]),
          };
        },
      }),
    },
    workspaces: workspacesTable,
    customMetrics: tableSentinel(["id", "organizationId", "workspaceId", "createdAt"]),
    workspaceDbCredentials: tableSentinel([
      "id", "workspaceId", "organizationId", "dbType", "label", "host", "port",
      "databaseName", "username", "encryptedPassword", "serviceAccountKey",
      "status", "createdAt",
    ]),
    uploadedDatasets: tableSentinel(["id", "organizationId", "workspaceId", "name", "tableName", "columns", "rowCount", "fileSize", "uploadedBy", "createdAt"]),
    lookerTemplates: tableSentinel(["id", "lookerDashboardId", "createdAt"]),
    insertLookerTemplateSchema: { partial: () => ({ safeParse: () => ({ success: false }) }), safeParse: () => ({ success: false }) },
    pool: {
      connect: () =>
        Promise.resolve({
          query: () => Promise.resolve({ rows: [] }),
          release: () => undefined,
        }),
    },
  };
});

vi.mock("drizzle-orm", () => ({
  // Capture the workspaceId on the predicate so the mocked `where` can read it.
  eq: (col: unknown, val: unknown) => ({ __wsId: typeof val === "number" ? val : Number(val) }),
  and: (...args: unknown[]) => ({ __and: args }),
  desc: (c: unknown) => c,
  isNull: (c: unknown) => c,
  sql: (() => "sql") as unknown,
  inArray: (c: unknown, v: unknown) => ({ __c: c, __v: v }),
}));

vi.mock("../lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/credential-vault", () => ({ encrypt: (s: string) => `enc:${s}` }));

vi.mock("../services/dynamic-query-engine", () => ({
  testConnection: vi.fn(),
  executeUserQuery: vi.fn(),
  getWorkspaceCredentials: vi.fn(),
}));

// ── Looker dep stubs ─────────────────────────────────────────────────────────
const lookerSsoSpy = vi.fn();
vi.mock("../lib/looker-client", () => ({
  getLookerConfig: () => ({ host: "https://looker.example.com" }),
  isLookerApiConfigured: () => true,
  getLookerSDK: () => ({
    ok: <T,>(p: T) => p,
    create_sso_embed_url: (args: Record<string, unknown>) => {
      lookerSsoSpy(args);
      return Promise.resolve({ url: "https://looker.example.com/sso/abc" });
    },
  }),
}));

// ── Multer stub: skip multipart parsing in unit tests ────────────────────────
vi.mock("multer", () => {
  const noopMw = (_req: Request, _res: Response, next: NextFunction) => next();
  const factory = () => ({ single: () => noopMw });
  factory.memoryStorage = () => ({});
  return { default: factory };
});

// papaparse stub — return a single deterministic row regardless of input
vi.mock("papaparse", () => ({
  default: {
    parse: () => ({ data: [{ a: "1", b: "2" }], errors: [] }),
  },
}));

// ── Subjects ─────────────────────────────────────────────────────────────────
import dataModelingRouter from "../routes/data-modeling";
import byodbRouter from "../routes/byodb";
import lookerRouter from "../routes/looker";
import dataUploadRouter from "../routes/data-upload";

// ── Helpers ──────────────────────────────────────────────────────────────────
function findRoute(router: Router, method: string, path: string): ExpressRoute {
  const stack = (router as unknown as Router & { stack: ExpressLayer[] }).stack;
  const layer = stack.find(
    (l) => l.route?.path === path && (l.route as unknown as ExpressRoute)?.methods[method.toLowerCase()],
  );
  if (!layer || !layer.route) throw new Error(`Route not found: ${method} ${path}`);
  return layer.route as unknown as ExpressRoute;
}

function makeRes(): Response & { statusCode: number; body: unknown } {
  const res = { statusCode: 200, body: null as unknown } as Response & { statusCode: number; body: unknown };
  (res as unknown as Record<string, unknown>).status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  (res as unknown as Record<string, unknown>).json = vi.fn((b: unknown) => {
    res.body = b;
    return res;
  });
  return res;
}

function makeReq(orgId: number, body: Record<string, unknown>): Request {
  return {
    rbacUser: { id: 1, organizationId: orgId, name: "Tester", email: "t@e", role: "admin" },
    jwtPayload: { memberId: 1, organizationId: orgId, role: "admin" },
    body,
    params: {},
    query: {},
    log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as unknown as Request["log"],
    headers: {},
  } as unknown as Request;
}

async function runRoute(route: ExpressRoute, req: Request, res: Response): Promise<void> {
  // Run the registered handlers sequentially. Each handler is either a
  // middleware (calls next) or the final handler (writes the response).
  for (const layer of route.stack) {
    let nextCalled = false;
    let nextErr: unknown = undefined;
    const next: NextFunction = (err?: unknown) => {
      nextCalled = true;
      nextErr = err;
    };
    await Promise.resolve(layer.handle(req, res, next));
    if (nextErr) throw nextErr;
    if (!nextCalled) return; // handler ended the response
  }
}

beforeEach(() => {
  inserted = [];
  lastSelectedWorkspaceId = null;
});

// ── data-modeling POST /metrics ──────────────────────────────────────────────
describe("SEC-03 follow-up — POST /api/data-modeling/metrics", () => {
  const route = findRoute(dataModelingRouter, "POST", "/metrics");

  it("rejects (403) a body workspaceId belonging to a sibling tenant", async () => {
    // Caller is org 1. Body workspaceId 20 belongs to org 2.
    const req = makeReq(1, { name: "m", formula: "1+1", workspaceId: 20 });
    const res = makeRes();

    await runRoute(route, req, res);

    expect(res.statusCode).toBe(403);
    expect((res.body as { code: string }).code).toBe("WORKSPACE_NOT_OWNED");
    expect(inserted).toHaveLength(0);
  });

  it("accepts a body workspaceId belonging to the caller's own org", async () => {
    // Caller is org 1. Workspace 10 belongs to org 1.
    const req = makeReq(1, { name: "m", formula: "1+1", workspaceId: 10 });
    const res = makeRes();

    await runRoute(route, req, res);

    expect(res.statusCode).toBe(201);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ organizationId: 1, workspaceId: 10 });
  });
});

// ── looker GET /auth ─────────────────────────────────────────────────────────
describe("SEC-03 follow-up — GET /api/looker/auth", () => {
  const route = findRoute(lookerRouter, "GET", "/auth");

  beforeEach(() => lookerSsoSpy.mockClear());

  it("rejects (403) a query workspace_id belonging to a sibling tenant", async () => {
    // Caller is org 1, has no session workspaceId so the query param is
    // consulted. workspace_id=20 belongs to org 2.
    const req = makeReq(1, {});
    (req as unknown as { query: Record<string, string> }).query = { workspace_id: "20" };
    const res = makeRes();

    await runRoute(route, req, res);

    expect(res.statusCode).toBe(403);
    expect((res.body as { code: string }).code).toBe("WORKSPACE_NOT_OWNED");
    // Critically: the Looker SSO URL was NEVER generated for the foreign
    // workspace_id, so no embed URL with cross-tenant client_id leaks.
    expect(lookerSsoSpy).not.toHaveBeenCalled();
  });

  it("accepts a query workspace_id belonging to the caller's org and stamps it on Looker user_attributes", async () => {
    const req = makeReq(1, {});
    (req as unknown as { query: Record<string, string> }).query = { workspace_id: "10" };
    const res = makeRes();

    await runRoute(route, req, res);

    expect(res.statusCode).toBe(200);
    expect(lookerSsoSpy).toHaveBeenCalledOnce();
    const ssoArgs = lookerSsoSpy.mock.calls[0][0] as { user_attributes: Record<string, string> };
    expect(ssoArgs.user_attributes.workspace_id).toBe("10");
    expect(ssoArgs.user_attributes.client_id).toBe("10");
  });
});

// ── data-upload POST /upload ─────────────────────────────────────────────────
describe("SEC-03 follow-up — POST /api/data-upload/upload", () => {
  const route = findRoute(dataUploadRouter, "POST", "/upload");

  it("rejects (403) a body workspaceId belonging to a sibling tenant", async () => {
    const req = makeReq(1, { workspaceId: "20" });
    (req as unknown as { file: Record<string, unknown> }).file = {
      buffer: Buffer.from("a,b\n1,2\n"),
      originalname: "x.csv",
      size: 8,
    };
    const res = makeRes();

    await runRoute(route, req, res);

    expect(res.statusCode).toBe(403);
    expect((res.body as { code: string }).code).toBe("WORKSPACE_NOT_OWNED");
    // The dataset row was NEVER inserted with a foreign workspaceId.
    expect(inserted.find((r) => "tableName" in r)).toBeUndefined();
  });

  it("accepts a body workspaceId belonging to the caller's own org", async () => {
    const req = makeReq(1, { workspaceId: "10" });
    (req as unknown as { file: Record<string, unknown> }).file = {
      buffer: Buffer.from("a,b\n1,2\n"),
      originalname: "x.csv",
      size: 8,
    };
    const res = makeRes();

    await runRoute(route, req, res);

    expect(res.statusCode).toBe(201);
    const datasetRow = inserted.find((r) => "tableName" in r) as Record<string, unknown>;
    expect(datasetRow).toBeTruthy();
    expect(datasetRow.organizationId).toBe(1);
    expect(datasetRow.workspaceId).toBe(10);
  });
});

// ── byodb POST /credentials ──────────────────────────────────────────────────
describe("SEC-03 follow-up — POST /api/byodb/credentials", () => {
  const route = findRoute(byodbRouter, "POST", "/credentials");

  it("rejects (403) a body workspaceId belonging to a sibling tenant", async () => {
    const req = makeReq(1, {
      dbType: "postgres",
      host: "h", port: 5432, databaseName: "d", username: "u", password: "p",
      workspaceId: 20, // sibling tenant
    });
    const res = makeRes();

    await runRoute(route, req, res);

    expect(res.statusCode).toBe(403);
    expect((res.body as { code: string }).code).toBe("WORKSPACE_NOT_OWNED");
    expect(inserted).toHaveLength(0);
  });

  it("accepts a body workspaceId belonging to the caller's own org", async () => {
    const req = makeReq(1, {
      dbType: "postgres",
      host: "h", port: 5432, databaseName: "d", username: "u", password: "p",
      workspaceId: 10,
    });
    const res = makeRes();

    await runRoute(route, req, res);

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ organizationId: 1, workspaceId: 10 });
  });
});
