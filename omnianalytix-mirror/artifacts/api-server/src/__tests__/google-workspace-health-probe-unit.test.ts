/**
 * Unit tests for `probeGoogleConnectionHealth`.
 *
 * Exercises the three possible outcomes:
 *   - not_connected  — no active connection row in the DB
 *   - healthy        — `refreshAccessToken` resolves successfully
 *   - needs_reconnect — `refreshAccessToken` rejects (revoked / expired token)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { refreshAccessToken } = vi.hoisted(() => ({
  refreshAccessToken: vi.fn(),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

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
    updatedAt: "updatedAt",
  },
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/credential-helpers", () => ({
  decryptCredentials: (c: Record<string, string>) => ({ ...c }),
  encryptCredentials: (c: Record<string, string>) => ({ ...c }),
}));

vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    setCredentials = vi.fn();
    on = vi.fn();
    refreshAccessToken = refreshAccessToken;
  },
}));

process.env.GOOGLE_ADS_CLIENT_ID = "test-client-id";
process.env.GOOGLE_ADS_CLIENT_SECRET = "test-client-secret";

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { db } from "@workspace/db";
import { probeGoogleConnectionHealth, GoogleTokenRefreshError } from "../lib/google-workspace-oauth";

// ─── Helper ───────────────────────────────────────────────────────────────────

function mockDbConnection(conn: object | null) {
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
    from: () => ({
      where: async () => (conn ? [conn] : []),
    }),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("probeGoogleConnectionHealth — unit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns not_connected when there is no active connection row", async () => {
    mockDbConnection(null);

    const result = await probeGoogleConnectionHealth("google_calendar", null);

    expect(result).toEqual({ status: "not_connected" });
  });

  it("returns healthy when refreshAccessToken resolves", async () => {
    mockDbConnection({
      id: 1,
      isActive: true,
      credentials: { accessToken: "old-access", refreshToken: "valid-rt" },
    });
    refreshAccessToken.mockResolvedValueOnce({ credentials: { access_token: "new-access" } });

    const result = await probeGoogleConnectionHealth("google_calendar", null);

    expect(result).toEqual({ status: "healthy" });
  });

  it("returns needs_reconnect with errorCode and httpStatus when refreshAccessToken throws a structured error", async () => {
    mockDbConnection({
      id: 2,
      isActive: true,
      credentials: { accessToken: "stale", refreshToken: "revoked-rt" },
    });
    refreshAccessToken.mockRejectedValueOnce({
      response: {
        status: 400,
        data: {
          error: "invalid_grant",
          error_description: "Token has been expired or revoked.",
        },
      },
    });

    const result = await probeGoogleConnectionHealth("google_drive", 99);

    expect(result).toMatchObject({
      status: "needs_reconnect",
      errorCode: "invalid_grant",
      httpStatus: 400,
    });
  });

  it("returns needs_reconnect with unknown_error when the error carries no structured data", async () => {
    mockDbConnection({
      id: 3,
      isActive: true,
      credentials: { accessToken: "tok", refreshToken: "rt" },
    });
    refreshAccessToken.mockRejectedValueOnce(new Error("network failure"));

    const result = await probeGoogleConnectionHealth("google_docs", null);

    expect(result).toMatchObject({
      status: "needs_reconnect",
      errorCode: "unknown_error",
    });
  });

  it("returns needs_reconnect when a GoogleTokenRefreshError is thrown", async () => {
    mockDbConnection({
      id: 4,
      isActive: true,
      credentials: { accessToken: "tok", refreshToken: "rt" },
    });
    refreshAccessToken.mockRejectedValueOnce(
      new GoogleTokenRefreshError({ status: 401, errorCode: "token_revoked", errorDescription: "Token revoked." }),
    );

    const result = await probeGoogleConnectionHealth("google_calendar", null);

    expect(result).toMatchObject({
      status: "needs_reconnect",
      httpStatus: 401,
    });
  });
});
