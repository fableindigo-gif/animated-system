/**
 * Shoptimizer client + service unit tests.
 *
 * Covers:
 *   • Missing SHOPTIMIZER_BASE_URL → ShoptimizerNotConfiguredError → 503-style item.
 *   • Successful optimize call produces the expected per-field diff.
 *   • Network failure surfaces as ShoptimizerUnreachableError.
 *   • optimizeBatch rejects oversized batches and collapses uniform infra
 *     failures into an InfrastructureFailureError.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  shoptimizeProduct,
  ShoptimizerNotConfiguredError,
  ShoptimizerUnreachableError,
  ShoptimizerInvalidResponseError,
  normalizeShoptimizerResponse,
} from "../lib/shoptimizer-client";
import {
  optimizeOne,
  optimizeBatch,
  BatchTooLargeError,
  InfrastructureFailureError,
  MAX_BATCH,
} from "../services/shoptimizer-service";

const ORIGINAL_ENV = process.env.SHOPTIMIZER_BASE_URL;

beforeEach(() => {
  delete process.env.SHOPTIMIZER_BASE_URL;
});

afterEach(() => {
  if (ORIGINAL_ENV) process.env.SHOPTIMIZER_BASE_URL = ORIGINAL_ENV;
  else delete process.env.SHOPTIMIZER_BASE_URL;
  vi.restoreAllMocks();
});

describe("shoptimizer-client", () => {
  it("throws ShoptimizerNotConfiguredError when env var is unset", async () => {
    await expect(shoptimizeProduct({ offerId: "SKU-1" })).rejects.toBeInstanceOf(
      ShoptimizerNotConfiguredError,
    );
  });

  it("posts to /shoptimizer/v1/shoptimize and returns the parsed response", async () => {
    process.env.SHOPTIMIZER_BASE_URL = "http://shop.test";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          "optimized-product": { offerId: "SKU-1", color: "blue" },
          "plugins-fired": ["color"],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ) as Response,
    );

    const out = await shoptimizeProduct({ offerId: "SKU-1", color: "" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://shop.test/shoptimizer/v1/shoptimize");
    expect((init as RequestInit).method).toBe("POST");

    const norm = normalizeShoptimizerResponse(out);
    expect(norm.optimizedProduct.color).toBe("blue");
    expect(norm.pluginsFired).toEqual(["color"]);
  });

  it("posts product + snake_case plugin_settings exactly as documented", async () => {
    process.env.SHOPTIMIZER_BASE_URL = "http://shop.test";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          "optimized-product": { offerId: "SKU-1" },
          "plugins-fired": [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ) as Response,
    );

    await shoptimizeProduct(
      { offerId: "SKU-1", title: "x" },
      { pluginSettings: { color: { enabled: true } } },
    );

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toHaveProperty("product");
    expect(body.product.offerId).toBe("SKU-1");
    expect(body).toHaveProperty("plugin_settings");
    expect(body).not.toHaveProperty("plugin-settings");
    expect(body.plugin_settings).toEqual({ color: { enabled: true } });
  });

  it("throws ShoptimizerInvalidResponseError when optimized-product is missing", () => {
    expect(() => normalizeShoptimizerResponse({ "plugins-fired": [] } as never))
      .toThrow(ShoptimizerInvalidResponseError);
  });

  it("wraps network errors in ShoptimizerUnreachableError", async () => {
    process.env.SHOPTIMIZER_BASE_URL = "http://shop.test";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(shoptimizeProduct({ offerId: "SKU-1" })).rejects.toBeInstanceOf(
      ShoptimizerUnreachableError,
    );
  });
});

describe("shoptimizer-service: optimizeOne", () => {
  it("returns a structured per-field diff when fields change", async () => {
    process.env.SHOPTIMIZER_BASE_URL = "http://shop.test";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          "optimized-product": {
            offerId: "SKU-1",
            title: "Mens cotton blue shirt",
            color: "blue",
            identifierExists: true,
          },
          "plugins-fired": ["title-word-order", "color", "identifier-exists"],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ) as Response,
    );

    const result = await optimizeOne({
      product: {
        offerId: "SKU-1",
        title: "blue shirt mens cotton",
        color: "",
        identifierExists: false,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diff.changeCount).toBe(3);
    const fields = result.diff.changedFields.map((c) => c.field).sort();
    expect(fields).toEqual(["color", "identifierExists", "title"]);
    expect(result.diff.pluginsFired).toContain("color");
  });

  it("maps a missing-config failure to a typed error item", async () => {
    const result = await optimizeOne({ product: { offerId: "SKU-1" } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("SHOPTIMIZER_NOT_CONFIGURED");
  });
});

describe("shoptimizer-service: optimizeBatch", () => {
  it("rejects batches over MAX_BATCH", async () => {
    const requests = Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({
      product: { offerId: `SKU-${i}` },
    }));
    await expect(optimizeBatch(requests)).rejects.toBeInstanceOf(BatchTooLargeError);
  });

  it("collapses uniform infra failures into InfrastructureFailureError", async () => {
    // No env var set → every item fails with SHOPTIMIZER_NOT_CONFIGURED.
    const requests = [
      { product: { offerId: "SKU-1" } },
      { product: { offerId: "SKU-2" } },
    ];
    await expect(optimizeBatch(requests)).rejects.toBeInstanceOf(InfrastructureFailureError);
  });

  it("treats uniform upstream 5xx as infrastructure failure (→ 503)", async () => {
    process.env.SHOPTIMIZER_BASE_URL = "http://shop.test";
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("upstream is down", { status: 503 }) as Response,
    );
    await expect(
      optimizeBatch([
        { product: { offerId: "SKU-1" } },
        { product: { offerId: "SKU-2" } },
      ]),
    ).rejects.toBeInstanceOf(InfrastructureFailureError);
  }, 15_000);

  it("does NOT collapse 4xx per-product errors into 503", async () => {
    process.env.SHOPTIMIZER_BASE_URL = "http://shop.test";
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("bad product", { status: 400 }) as Response,
    );
    const out = await optimizeBatch([
      { product: { offerId: "SKU-1" } },
      { product: { offerId: "SKU-2" } },
    ]);
    expect(out.totalFailed).toBe(2);
    expect(out.results.every((r) => !r.ok)).toBe(true);
  });
});
