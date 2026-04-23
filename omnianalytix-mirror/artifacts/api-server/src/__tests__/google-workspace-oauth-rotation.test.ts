/**
 * Regression test for Google Workspace OAuth refresh-token rotation.
 *
 * The `tokens` event from `OAuth2Client` only includes `refresh_token` when
 * Google rotates it. The persistence layer must mutate the in-memory creds
 * object so that a later event carrying only `access_token` does NOT
 * overwrite a previously-rotated refresh_token with the stale original.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const updateSet = vi.fn();
const updateWhere = vi.fn();

vi.mock("@workspace/db", () => {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: async () => [
            {
              id: 42,
              isActive: true,
              credentials: { accessToken: "enc-old-access", refreshToken: "enc-rt-v1" },
            },
          ],
        }),
      }),
      update: () => ({
        set: (vals: unknown) => {
          updateSet(vals);
          return { where: updateWhere };
        },
      }),
    },
    platformConnections: { id: "id_col", platform: "p_col", organizationId: "o_col" },
  };
});

vi.mock("../lib/credential-helpers", () => ({
  // Identity decrypt: pretend the stored "enc-*" strings round-trip.
  decryptCredentials: (c: Record<string, string>) => ({
    accessToken: c.accessToken.replace(/^enc-/, ""),
    refreshToken: c.refreshToken.replace(/^enc-/, ""),
  }),
  encryptCredentials: (c: Record<string, string>) => ({ ...c }),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Capture the `tokens` listener so the test can drive it directly.
let tokensListener: ((tokens: { access_token?: string; refresh_token?: string }) => void) | null = null;
const setCredentialsMock = vi.fn();
vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    setCredentials = setCredentialsMock;
    on(event: string, cb: (t: { access_token?: string; refresh_token?: string }) => void) {
      if (event === "tokens") tokensListener = cb;
    }
  },
}));

process.env.GOOGLE_ADS_CLIENT_ID = "cid";
process.env.GOOGLE_ADS_CLIENT_SECRET = "csec";

import { getAuthorizedGoogleClient } from "../lib/google-workspace-oauth";

describe("Workspace OAuth — refresh_token rotation persistence", () => {
  beforeEach(() => {
    updateSet.mockReset();
    updateWhere.mockReset();
    setCredentialsMock.mockReset();
    tokensListener = null;
  });

  it("does not overwrite a rotated refresh_token when a later event lacks refresh_token", async () => {
    const authorized = await getAuthorizedGoogleClient("google_calendar", null);
    expect(authorized).not.toBeNull();
    expect(tokensListener).toBeTypeOf("function");

    // 1st rotation — Google returns a new refresh_token alongside access_token.
    tokensListener!({ access_token: "access-v2", refresh_token: "rt-v2" });
    // The persistRotatedTokens path is async; await a microtask flush.
    await new Promise((r) => setImmediate(r));

    expect(updateSet).toHaveBeenCalledTimes(1);
    expect(updateSet.mock.calls[0][0].credentials).toMatchObject({
      accessToken: "access-v2",
      refreshToken: "rt-v2",
    });

    // 2nd rotation — Google returns only access_token. The persisted
    // credentials must keep refreshToken=rt-v2, NOT regress to rt-v1.
    tokensListener!({ access_token: "access-v3" });
    await new Promise((r) => setImmediate(r));

    expect(updateSet).toHaveBeenCalledTimes(2);
    expect(updateSet.mock.calls[1][0].credentials).toMatchObject({
      accessToken: "access-v3",
      refreshToken: "rt-v2",
    });
  });
});
