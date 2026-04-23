/**
 * Preview (dry-run) tests for Meta and Shopify writes through dispatchToolCall.
 *
 * The Approval Queue's /preview endpoint calls dispatchToolCall with
 * `dryRun: true`. For Meta this must append `?validate_only=true` to the
 * Marketing API POST. For Shopify (no native validate_only) it must do a
 * GET on the target resource and surface real per-operation errors.
 *
 * These tests verify both happy-path and validation-failure cases, and
 * crucially, that no mutating call is issued in dry-run mode.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dispatchToolCall } from "../lib/gemini-tools";

const META_CREDS = { accessToken: "fake-meta-token", pageId: "123" };
const SHOPIFY_CREDS = { accessToken: "fake-shop-token", shopDomain: "https://demo.myshopify.com" };

// Helper: build a Response-like object the global fetch mock returns.
function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }) as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Preview · Meta dry-run", () => {
  it("appends ?validate_only=true and returns success when Meta validates", async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ success: true }));

    const result = await dispatchToolCall(
      "meta_updateAdSetBudget",
      { adSetId: "9999", dailyBudget: 250 },
      { meta: META_CREDS },
      { bypassQueue: true, dryRun: true },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("/9999");
    expect(calledUrl).toContain("validate_only=true");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Validation passed/i);
    expect(result.data).toMatchObject({ dry_run: true });
  });

  it("surfaces Meta's per-operation validation error inline", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResp(
        { error: { message: "Invalid parameter", error_user_msg: "Daily budget below the minimum (USD 1.00)" } },
        400,
      ),
    );

    const result = await dispatchToolCall(
      "meta_updateAdSetBudget",
      { adSetId: "9999", dailyBudget: 0.01 },
      { meta: META_CREDS },
      { bypassQueue: true, dryRun: true },
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("Daily budget below the minimum");
    expect(result.data).toMatchObject({ dry_run: true });
  });

  it("does NOT append validate_only when dryRun is false (real write path)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ success: true }));

    await dispatchToolCall(
      "meta_updateObjectStatus",
      { objectId: "777", status: "PAUSED" },
      { meta: META_CREDS },
      { bypassQueue: true, dryRun: false },
    );

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).not.toContain("validate_only");
  });
});

describe("Preview · Shopify dry-run", () => {
  it("issues a GET on the target product (not PUT) and returns success", async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ product: { id: 42, status: "active" } }));

    const result = await dispatchToolCall(
      "shopify_updateProductStatus",
      { productId: "42", status: "archived" },
      { shopify: SHOPIFY_CREDS },
      { bypassQueue: true, dryRun: true },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/products/42.json");
    expect(init?.method).toBe("GET");
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Validation passed/i);
    expect(result.data).toMatchObject({ dry_run: true });
  });

  it("rejects locally invalid enum values without any network call", async () => {
    const result = await dispatchToolCall(
      "shopify_updateProductStatus",
      { productId: "42", status: "bogus-state" },
      { shopify: SHOPIFY_CREDS },
      { bypassQueue: true, dryRun: true },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/active.*archived.*draft|enum/i);
  });

  it("surfaces a 404 from the Shopify GET probe as a preview failure", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResp({ errors: "Not Found" }, 404),
    );

    const result = await dispatchToolCall(
      "shopify_updateVariantPrice",
      { variantId: "doesnt-exist", price: 19.99 },
      { shopify: SHOPIFY_CREDS },
      { bypassQueue: true, dryRun: true },
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/variant doesnt-exist not accessible/);
    expect(result.data).toMatchObject({ dry_run: true, http_status: 404 });
  });

  it("probes /shop.json for create-only tools (no existing target resource)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ shop: { id: 1 } }));

    const result = await dispatchToolCall(
      "shopify_createDiscountCode",
      { title: "T", discountType: "percentage", discountValue: 15, code: "FLASH15" },
      { shopify: SHOPIFY_CREDS },
      { bypassQueue: true, dryRun: true },
    );

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("/shop.json");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("GET");
    expect(result.success).toBe(true);
  });

  it("rejects invalid percentage discount values locally", async () => {
    const result = await dispatchToolCall(
      "shopify_createDiscountCode",
      { title: "T", discountType: "percentage", discountValue: 250, code: "TOOMUCH" },
      { shopify: SHOPIFY_CREDS },
      { bypassQueue: true, dryRun: true },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/percentage discountValue must be ≤ 100/);
  });
});
