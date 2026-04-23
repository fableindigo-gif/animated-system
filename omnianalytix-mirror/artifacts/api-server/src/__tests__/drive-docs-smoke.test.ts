/**
 * Smoke-test route coverage — GET /api/integrations/drive/recent
 *                              GET /api/integrations/docs/:docId
 *
 * Covers:
 *   • not-connected (getAuthorizedGoogleClient → null)  → 404
 *   • stale token   (googleapis throws invalid_grant)   → 401 + errorCode shape
 *   • happy path    (googleapis returns data)           → 200 + stable shape
 *
 * All external I/O is stubbed; no real DB or Google API calls are made.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// ── Mocks (must precede subject imports) ──────────────────────────────────────

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  platformConnections: {
    id: "id",
    platform: "platform",
    organizationId: "organizationId",
    isActive: "isActive",
    credentials: "credentials",
  },
}));

vi.mock("../lib/credential-helpers", () => ({
  encryptCredentials: (c: Record<string, string>) => c,
  decryptCredentials: (c: Record<string, string>) => c,
}));

vi.mock("../middleware/rbac", () => ({
  getOrgId: () => null,
}));

vi.mock("../routes/auth/gate", () => ({
  verifyAnyToken: () => null,
}));

// Controllable stub for getAuthorizedGoogleClient and safeRefreshErrorFields
const mockGetAuthorizedGoogleClient = vi.fn();
const mockSafeRefreshErrorFields = vi.fn();

vi.mock("../lib/google-workspace-oauth", () => ({
  getAuthorizedGoogleClient: (...args: unknown[]) => mockGetAuthorizedGoogleClient(...args),
  safeRefreshErrorFields: (err: unknown) => mockSafeRefreshErrorFields(err),
}));

// Controllable googleapis stubs
const mockFilesList = vi.fn();
const mockDocsGet = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    drive: () => ({ files: { list: mockFilesList } }),
    docs:  () => ({ documents: { get: mockDocsGet } }),
  },
}));

// ── Server setup ──────────────────────────────────────────────────────────────

import integrationsRouter from "../routes/integrations/index";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/integrations", integrationsRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server?.close();
});

beforeEach(() => {
  mockGetAuthorizedGoogleClient.mockReset();
  mockSafeRefreshErrorFields.mockReset();
  mockFilesList.mockReset();
  mockDocsGet.mockReset();
});

// ── Drive: GET /api/integrations/drive/recent ─────────────────────────────────

describe("GET /api/integrations/drive/recent", () => {
  it("returns 404 when Drive is not connected", async () => {
    mockGetAuthorizedGoogleClient.mockResolvedValue(null);

    const res = await fetch(`${baseUrl}/api/integrations/drive/recent`);
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("error");
    expect(String(body.error)).toMatch(/not connected/i);
  });

  it("returns 401 with errorCode shape when token is stale (invalid_grant)", async () => {
    const fakeClient = { setCredentials: vi.fn(), on: vi.fn() };
    mockGetAuthorizedGoogleClient.mockResolvedValue({ client: fakeClient });

    const grantError = { response: { status: 401, data: { error: "invalid_grant", error_description: "Token has been expired" } } };
    mockFilesList.mockRejectedValue(grantError);
    mockSafeRefreshErrorFields.mockReturnValue({ status: 401, errorCode: "invalid_grant", errorDescription: "Token has been expired" });

    const res = await fetch(`${baseUrl}/api/integrations/drive/recent`);
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("errorCode", "invalid_grant");
    expect(String(body.error)).toMatch(/invalid_grant/);
  });

  it("returns 200 with stable shape on success", async () => {
    const fakeClient = { setCredentials: vi.fn(), on: vi.fn() };
    mockGetAuthorizedGoogleClient.mockResolvedValue({ client: fakeClient });

    mockFilesList.mockResolvedValue({
      data: {
        files: [
          { id: "file-1", name: "Report.docx", mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-04-01T00:00:00Z", webViewLink: "https://drive.google.com/file/d/file-1" },
          { id: "file-2", name: "Budget.xlsx", mimeType: "application/vnd.google-apps.spreadsheet", modifiedTime: "2026-03-28T00:00:00Z", webViewLink: "https://drive.google.com/file/d/file-2" },
        ],
      },
    });

    const res = await fetch(`${baseUrl}/api/integrations/drive/recent`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      success: true,
      count: 2,
    });
    const files = body.files as Array<Record<string, unknown>>;
    expect(Array.isArray(files)).toBe(true);
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({
      id: "file-1",
      name: "Report.docx",
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: "2026-04-01T00:00:00Z",
      webViewLink: expect.stringContaining("drive.google.com"),
    });
  });

  it("clamps limit query param to 25", async () => {
    const fakeClient = { setCredentials: vi.fn(), on: vi.fn() };
    mockGetAuthorizedGoogleClient.mockResolvedValue({ client: fakeClient });
    mockFilesList.mockResolvedValue({ data: { files: [] } });

    await fetch(`${baseUrl}/api/integrations/drive/recent?limit=999`);
    expect(mockFilesList).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 25 }),
    );
  });
});

// ── Docs: GET /api/integrations/docs/:docId ───────────────────────────────────

describe("GET /api/integrations/docs/:docId", () => {
  it("returns 400 for an invalid docId", async () => {
    const res = await fetch(`${baseUrl}/api/integrations/docs/bad.doc.id`);
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("error");
    expect(String(body.error)).toMatch(/invalid/i);
  });

  it("returns 404 when Docs is not connected", async () => {
    mockGetAuthorizedGoogleClient.mockResolvedValue(null);

    const res = await fetch(`${baseUrl}/api/integrations/docs/validDocId123`);
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("error");
    expect(String(body.error)).toMatch(/not connected/i);
  });

  it("returns 401 with errorCode shape when token is stale (invalid_grant)", async () => {
    const fakeClient = { setCredentials: vi.fn(), on: vi.fn() };
    mockGetAuthorizedGoogleClient.mockResolvedValue({ client: fakeClient });

    const grantError = { response: { status: 401, data: { error: "invalid_grant", error_description: "Token has been expired" } } };
    mockDocsGet.mockRejectedValue(grantError);
    mockSafeRefreshErrorFields.mockReturnValue({ status: 401, errorCode: "invalid_grant", errorDescription: "Token has been expired" });

    const res = await fetch(`${baseUrl}/api/integrations/docs/validDocId123`);
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("errorCode", "invalid_grant");
    expect(String(body.error)).toMatch(/invalid_grant/);
  });

  it("returns 200 with stable shape on success", async () => {
    const fakeClient = { setCredentials: vi.fn(), on: vi.fn() };
    mockGetAuthorizedGoogleClient.mockResolvedValue({ client: fakeClient });

    mockDocsGet.mockResolvedValue({
      data: {
        documentId: "validDocId123",
        title: "Q1 Strategy",
        revisionId: "rev-42",
        body: {
          content: new Array(7).fill({}),
        },
      },
    });

    const res = await fetch(`${baseUrl}/api/integrations/docs/validDocId123`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      success: true,
      documentId: "validDocId123",
      title: "Q1 Strategy",
      revisionId: "rev-42",
      elementCount: 7,
    });
  });
});
