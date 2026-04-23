/**
 * SEC-07 regression test: refreshGoogleAccessToken must NEVER log the raw
 * provider response body. Google's error responses can echo back the failing
 * refresh_token / id_token / authorization_code, so a careless log would
 * leak credentials. The fix logs only structured safe fields (status,
 * errorCode, errorDescription).
 *
 * Refresh now goes through `OAuth2Client.refreshAccessToken()` from
 * `google-auth-library`. The library throws a GaxiosError-shaped object whose
 * `response.data` mirrors the provider body. The redaction guard lives in
 * `safeRefreshErrorFields` and must keep working against that shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock heavy dependencies before importing the subject ──────────────────────
vi.mock("@workspace/db", () => ({
  db: {},
  platformConnections: {},
}));

vi.mock("../lib/credential-helpers", () => ({
  decryptCredentials: vi.fn(),
  encryptCredentials: vi.fn(),
}));

// Capture every call to logger.error / logger.warn so we can assert no field
// or message contains the secret refresh_token / id_token material.
const errorCalls: unknown[][] = [];
const warnCalls: unknown[][] = [];
vi.mock("../lib/logger", () => ({
  logger: {
    error: (...args: unknown[]) => errorCalls.push(args),
    warn: (...args: unknown[]) => warnCalls.push(args),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Force the OAuth env vars so the function doesn't bail out before refresh.
process.env.GOOGLE_ADS_CLIENT_ID = "test-client-id";
process.env.GOOGLE_ADS_CLIENT_SECRET = "test-client-secret";

// Mock OAuth2Client so we don't touch the network. Each test injects its own
// failure shape via mockRefresh.
const mockRefresh = vi.fn();
vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    setCredentials = vi.fn();
    refreshAccessToken = mockRefresh;
  },
}));

import { refreshGoogleAccessToken } from "../lib/google-token-refresh";

const SECRET_REFRESH_TOKEN = "1//SECRET-REFRESH-TOKEN-VALUE-aabbcc-must-not-leak";
const SECRET_ID_TOKEN = "ey.SECRET-ID-TOKEN-MATERIAL-eyJ.signature";

describe("SEC-07 — google-token-refresh log redaction", () => {
  beforeEach(() => {
    errorCalls.length = 0;
    warnCalls.length = 0;
    mockRefresh.mockReset();
  });

  it("does not log the raw provider response body when token refresh fails (JSON error)", async () => {
    // Google's error body — note that it deliberately includes a token-like
    // field to simulate the historic case where Google echoed the failing
    // material back. The implementation must not surface this in logs.
    const errorBody = {
      error: "invalid_grant",
      error_description: "Token has been expired or revoked.",
      // historical/adversarial echo:
      refresh_token: SECRET_REFRESH_TOKEN,
      id_token: SECRET_ID_TOKEN,
    };
    // Shape mirrors gaxios error: `.response.{status,data}`.
    const gaxiosErr = Object.assign(new Error("Bad Request"), {
      response: { status: 400, data: errorBody },
    });
    mockRefresh.mockRejectedValue(gaxiosErr);

    await expect(refreshGoogleAccessToken("input-refresh-token")).rejects.toThrow();

    // Verify SOMETHING was logged (so we know the test exercised the code).
    expect(errorCalls.length).toBeGreaterThan(0);

    // Walk every logged value and confirm no secret material appears anywhere.
    const flat = JSON.stringify([...errorCalls, ...warnCalls]);
    expect(flat).not.toContain(SECRET_REFRESH_TOKEN);
    expect(flat).not.toContain(SECRET_ID_TOKEN);
    // Belt-and-suspenders: the structured log must have only the documented
    // safe fields. The error message string is allowed to include errorCode.
    expect(flat).toContain("invalid_grant");
    expect(flat).toContain("400");
  });

  it("does not log the raw provider response body when token refresh fails (non-JSON body)", async () => {
    // If Google returns a non-JSON body (e.g. 502 from a proxy), gaxios may
    // surface `response.data` as an opaque string. The raw text MUST NOT be
    // logged.
    const rawBody = `<html>Internal proxy error — token=${SECRET_REFRESH_TOKEN}</html>`;
    const gaxiosErr = Object.assign(new Error("Bad Gateway"), {
      response: { status: 502, data: rawBody },
    });
    mockRefresh.mockRejectedValue(gaxiosErr);

    await expect(refreshGoogleAccessToken("input-refresh-token")).rejects.toThrow();

    const flat = JSON.stringify([...errorCalls, ...warnCalls]);
    expect(flat).not.toContain(SECRET_REFRESH_TOKEN);
    expect(flat).not.toContain("Internal proxy error");
  });
});
