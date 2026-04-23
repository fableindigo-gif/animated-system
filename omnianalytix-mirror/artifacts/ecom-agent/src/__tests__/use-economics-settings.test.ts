// @vitest-environment happy-dom
/**
 * Unit tests for the setCampaignTargetRoas function inside useEconomicsSettings.
 *
 * Covers:
 *   - Happy path: successful PUT response updates the hook's settings state
 *     (campaignOverrides, cogsPct, targetRoas) with the data returned by the API.
 *   - Null (clear) path: passing null removes the campaign override from state.
 *   - Error path: a non-ok HTTP response causes setCampaignTargetRoas to throw
 *     with the server's error message, and state is not clobbered.
 *   - Error fallback: when the error body is not parseable, the thrown message
 *     includes the HTTP status code.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ── Mock authFetch before importing the subject ───────────────────────────────
const mockAuthFetch = vi.fn();

vi.mock("@/lib/auth-fetch", () => ({
  authFetch: (...args: unknown[]) => mockAuthFetch(...args),
}));

// ── Subject ───────────────────────────────────────────────────────────────────
import { useEconomicsSettings } from "@/lib/use-economics-settings";

// ── Helpers ───────────────────────────────────────────────────────────────────

type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

function makeOkResponse(body: unknown): FetchResponse {
  return {
    ok:     true,
    status: 200,
    json:   () => Promise.resolve(body),
  };
}

function makeErrorResponse(status: number, body: unknown = {}): FetchResponse {
  return {
    ok:     false,
    status,
    json:   () => Promise.resolve(body),
  };
}

/** Economy settings payload as the API returns it. */
const ECONOMICS_DEFAULTS = {
  cogsPct:           0.3,
  targetRoas:        4.0,
  campaignOverrides: {} as Record<string, number>,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useEconomicsSettings — setCampaignTargetRoas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: initial fetch (GET /api/settings/economics) returns org defaults.
    mockAuthFetch.mockResolvedValue(makeOkResponse(ECONOMICS_DEFAULTS));
  });

  // ── Happy path (save) ──────────────────────────────────────────────────────

  it("updates campaignOverrides with the API response after a successful save", async () => {
    const updatedEconomics = {
      ...ECONOMICS_DEFAULTS,
      campaignOverrides: { "camp-001": 6.5 },
    };

    const { result } = renderHook(() => useEconomicsSettings());

    // Wait for the initial load to complete.
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Queue the PUT response.
    mockAuthFetch.mockResolvedValueOnce(makeOkResponse(updatedEconomics));

    await act(async () => {
      await result.current.setCampaignTargetRoas("camp-001", 6.5);
    });

    expect(result.current.settings?.campaignOverrides["camp-001"]).toBe(6.5);
    expect(result.current.settings?.cogsPct).toBe(0.3);
    expect(result.current.settings?.targetRoas).toBe(4.0);
  });

  it("makes a PUT request to the correct endpoint with the right body", async () => {
    const { result } = renderHook(() => useEconomicsSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockAuthFetch.mockResolvedValueOnce(makeOkResponse(ECONOMICS_DEFAULTS));

    await act(async () => {
      await result.current.setCampaignTargetRoas("camp-xyz", 3.0);
    });

    const [url, init] = mockAuthFetch.mock.calls.find(
      (c) => (c[0] as string).includes("camp-xyz"),
    ) ?? [];

    expect(url).toMatch(/economics\/campaigns\/camp-xyz/);
    expect((init as RequestInit).method).toBe("PUT");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ targetRoas: 3.0 });
  });

  it("URL-encodes the campaignId to handle special characters", async () => {
    const { result } = renderHook(() => useEconomicsSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockAuthFetch.mockResolvedValueOnce(makeOkResponse(ECONOMICS_DEFAULTS));

    await act(async () => {
      await result.current.setCampaignTargetRoas("camp/special&id", 5.0);
    });

    const [[url]] = mockAuthFetch.mock.calls.filter(
      (c) => (c[0] as string).includes("camp"),
    );
    expect(url).toContain("camp%2Fspecial%26id");
  });

  // ── Null clear path ────────────────────────────────────────────────────────

  it("sends null in the body to clear a campaign override", async () => {
    const clearedEconomics = { ...ECONOMICS_DEFAULTS, campaignOverrides: {} };

    const { result } = renderHook(() => useEconomicsSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockAuthFetch.mockResolvedValueOnce(makeOkResponse(clearedEconomics));

    await act(async () => {
      await result.current.setCampaignTargetRoas("camp-001", null);
    });

    expect(result.current.settings?.campaignOverrides).toEqual({});

    const [_url, init] = mockAuthFetch.mock.calls.find(
      (c) => (c[0] as string).includes("camp-001"),
    ) ?? [];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ targetRoas: null });
  });

  it("removes the override from state when the API confirms the clear", async () => {
    // Start with an existing override.
    mockAuthFetch.mockResolvedValueOnce(
      makeOkResponse({
        ...ECONOMICS_DEFAULTS,
        campaignOverrides: { "camp-001": 8.0 },
      }),
    );

    const { result } = renderHook(() => useEconomicsSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings?.campaignOverrides["camp-001"]).toBe(8.0);

    // Now clear it.
    mockAuthFetch.mockResolvedValueOnce(makeOkResponse(ECONOMICS_DEFAULTS));

    await act(async () => {
      await result.current.setCampaignTargetRoas("camp-001", null);
    });

    expect(result.current.settings?.campaignOverrides["camp-001"]).toBeUndefined();
  });

  // ── Error path ─────────────────────────────────────────────────────────────

  it("throws with the server error message when the response is not ok", async () => {
    const { result } = renderHook(() => useEconomicsSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockAuthFetch.mockResolvedValueOnce(
      makeErrorResponse(400, { error: "Invalid target ROAS payload", code: "INVALID_INPUT" }),
    );

    await expect(
      act(async () => {
        await result.current.setCampaignTargetRoas("camp-001", 0);
      }),
    ).rejects.toThrow("Invalid target ROAS payload");
  });

  it("throws with an HTTP status fallback when the error body has no message", async () => {
    const { result } = renderHook(() => useEconomicsSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockAuthFetch.mockResolvedValueOnce(makeErrorResponse(500, {}));

    await expect(
      act(async () => {
        await result.current.setCampaignTargetRoas("camp-001", 5.0);
      }),
    ).rejects.toThrow("HTTP 500");
  });

  it("throws with an HTTP status fallback when the error body is not valid JSON", async () => {
    const { result } = renderHook(() => useEconomicsSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockAuthFetch.mockResolvedValueOnce({
      ok:     false,
      status: 502,
      json:   () => Promise.reject(new SyntaxError("Unexpected token")),
    });

    await expect(
      act(async () => {
        await result.current.setCampaignTargetRoas("camp-001", 5.0);
      }),
    ).rejects.toThrow("HTTP 502");
  });

  it("does not overwrite existing settings state when the call throws", async () => {
    const initialOverrides = { "camp-existing": 4.5 };
    mockAuthFetch.mockResolvedValueOnce(
      makeOkResponse({ ...ECONOMICS_DEFAULTS, campaignOverrides: initialOverrides }),
    );

    const { result } = renderHook(() => useEconomicsSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings?.campaignOverrides["camp-existing"]).toBe(4.5);

    mockAuthFetch.mockResolvedValueOnce(makeErrorResponse(400, { error: "Bad value" }));

    await expect(
      act(async () => {
        await result.current.setCampaignTargetRoas("camp-existing", -1);
      }),
    ).rejects.toThrow();

    // State should be unchanged.
    expect(result.current.settings?.campaignOverrides["camp-existing"]).toBe(4.5);
  });

  // ── State normalisation ────────────────────────────────────────────────────

  it("normalises cogsPct and targetRoas correctly when the API returns numbers", async () => {
    const apiResponse = {
      cogsPct:           0.25,
      targetRoas:        5.0,
      campaignOverrides: { "camp-a": 7.0 },
    };

    const { result } = renderHook(() => useEconomicsSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockAuthFetch.mockResolvedValueOnce(makeOkResponse(apiResponse));

    await act(async () => {
      await result.current.setCampaignTargetRoas("camp-a", 7.0);
    });

    expect(result.current.settings).toEqual({
      cogsPct:           0.25,
      targetRoas:        5.0,
      campaignOverrides: { "camp-a": 7.0 },
    });
  });

  it("normalises cogsPct and targetRoas to null when the API returns non-numeric values", async () => {
    const apiResponse = {
      cogsPct:           "not-a-number",
      targetRoas:        null,
      campaignOverrides: {},
    };

    const { result } = renderHook(() => useEconomicsSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockAuthFetch.mockResolvedValueOnce(makeOkResponse(apiResponse));

    await act(async () => {
      await result.current.setCampaignTargetRoas("camp-001", 4.0);
    });

    expect(result.current.settings?.cogsPct).toBeNull();
    expect(result.current.settings?.targetRoas).toBeNull();
  });
});
