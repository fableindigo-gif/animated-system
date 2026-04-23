/**
 * Shoptimizer HTTP client.
 *
 * Posts Merchant Center / Google Shopping product payloads to a remote
 * Shoptimizer service (https://github.com/google/shoptimizer) and returns
 * the optimized product alongside the list of plugins that fired.
 *
 * The Shoptimizer service is an external Python/Flask app — this client
 * does NOT host or embed it. Set `SHOPTIMIZER_BASE_URL` to the running
 * service (e.g. `http://localhost:8080` or a Cloud Run URL).
 *
 * Documented endpoint: POST {base}/shoptimizer/v1/shoptimize
 *   request body: { product, plugin_settings? }
 *   response:     { optimized-product, plugins-fired }
 *
 * We intentionally do NOT fall back to returning the unmodified product
 * when the service is unreachable — callers are expected to surface a 503
 * so end users know the optimizer is down.
 */
import { z } from "zod";
import { fetchWithBackoff } from "./fetch-utils";
import { logger } from "./logger";

// ── Schemas ───────────────────────────────────────────────────────────────────

/**
 * Loose schema for a Merchant Center product. Shoptimizer is permissive
 * about which fields are present — we only require an `offerId` so the
 * response can be correlated back to the input. Everything else passes
 * through unchanged.
 */
export const merchantProductSchema = z
  .object({
    offerId: z.string().min(1, "offerId is required"),
    title: z.string().optional(),
    description: z.string().optional(),
    link: z.string().url().optional(),
    imageLink: z.string().url().optional(),
    contentLanguage: z.string().optional(),
    targetCountry: z.string().optional(),
    channel: z.string().optional(),
    availability: z.string().optional(),
    condition: z.string().optional(),
    googleProductCategory: z.union([z.string(), z.number()]).optional(),
    productTypes: z.array(z.string()).optional(),
    brand: z.string().optional(),
    gtin: z.string().optional(),
    mpn: z.string().optional(),
    identifierExists: z.boolean().optional(),
    color: z.string().optional(),
    sizes: z.array(z.string()).optional(),
    gender: z.string().optional(),
    ageGroup: z.string().optional(),
    material: z.string().optional(),
    pattern: z.string().optional(),
    price: z
      .object({ value: z.string().optional(), currency: z.string().optional() })
      .partial()
      .optional(),
  })
  .passthrough();

export type MerchantProduct = z.infer<typeof merchantProductSchema>;

export const pluginSettingsSchema = z.record(z.unknown()).optional();
export type PluginSettings = Record<string, unknown> | undefined;

/**
 * Shoptimizer's response envelope. Field names use kebab-case in the
 * upstream service; we accept either kebab- or camelCase to be defensive.
 */
const pluginResultSchema = z
  .object({
    "results-status": z.string().optional(),
    resultsStatus: z.string().optional(),
    "result-counts": z
      .object({
        "sanitized-attributes": z.array(z.string()).optional(),
        "optimized-attributes": z.array(z.string()).optional(),
        "excluded-attributes": z.array(z.string()).optional(),
      })
      .partial()
      .optional(),
    resultCounts: z.unknown().optional(),
  })
  .passthrough();

export const shoptimizerResponseSchema = z
  .object({
    "optimized-product": merchantProductSchema.optional(),
    optimizedProduct: merchantProductSchema.optional(),
    "plugins-fired": z.array(z.string()).optional(),
    pluginsFired: z.array(z.string()).optional(),
    "plugin-results": z.record(pluginResultSchema).optional(),
    pluginResults: z.record(pluginResultSchema).optional(),
  })
  .passthrough();

export type ShoptimizerResponse = z.infer<typeof shoptimizerResponseSchema>;

// ── Errors ────────────────────────────────────────────────────────────────────

export class ShoptimizerNotConfiguredError extends Error {
  code = "SHOPTIMIZER_NOT_CONFIGURED" as const;
  constructor() {
    super(
      "SHOPTIMIZER_BASE_URL is not set. Point it at a running Shoptimizer service " +
        "(see artifacts/api-server/SHOPTIMIZER.md for setup).",
    );
  }
}

export class ShoptimizerUnreachableError extends Error {
  code = "SHOPTIMIZER_UNREACHABLE" as const;
  constructor(public baseUrl: string, public cause: unknown) {
    super(
      `Could not reach Shoptimizer at ${baseUrl}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
}

export class ShoptimizerHttpError extends Error {
  code = "SHOPTIMIZER_HTTP_ERROR" as const;
  constructor(public status: number, public body: string) {
    super(`Shoptimizer responded with HTTP ${status}: ${body.slice(0, 200)}`);
  }
}

// ── Client ────────────────────────────────────────────────────────────────────

export interface ShoptimizerClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

export interface OptimizeOptions {
  pluginSettings?: PluginSettings;
  /** Override base URL just for this call (testing). */
  baseUrl?: string;
  timeoutMs?: number;
}

function resolveBaseUrl(override?: string): string {
  const raw = override ?? process.env.SHOPTIMIZER_BASE_URL;
  if (!raw || !raw.trim()) throw new ShoptimizerNotConfiguredError();
  return raw.replace(/\/+$/, "");
}

/**
 * Calls Shoptimizer's `/shoptimizer/v1/shoptimize` endpoint with a single
 * product and returns the parsed response. Throws on missing config,
 * network failure, non-2xx, or response shape mismatch.
 */
export async function shoptimizeProduct(
  product: MerchantProduct,
  opts: OptimizeOptions = {},
): Promise<ShoptimizerResponse> {
  // Validate input early so callers get a typed error before we hit the wire.
  const validated = merchantProductSchema.parse(product);

  const baseUrl = resolveBaseUrl(opts.baseUrl);
  const url = `${baseUrl}/shoptimizer/v1/shoptimize`;

  // Shoptimizer's documented request body uses snake_case `plugin_settings`.
  const body = JSON.stringify({
    product: validated,
    ...(opts.pluginSettings ? { plugin_settings: opts.pluginSettings } : {}),
  });

  let resp: Response;
  try {
    resp = await fetchWithBackoff(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
      tag: "shoptimizer",
      timeoutMs: opts.timeoutMs ?? 15_000,
      maxRetries: 2,
    });
  } catch (err) {
    logger.warn({ err, url }, "shoptimizer: network error");
    throw new ShoptimizerUnreachableError(baseUrl, err);
  }

  const text = await resp.text();
  if (!resp.ok) {
    logger.warn({ status: resp.status, url, body: text.slice(0, 500) }, "shoptimizer: non-2xx response");
    throw new ShoptimizerHttpError(resp.status, text);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new ShoptimizerHttpError(resp.status, `Invalid JSON from Shoptimizer: ${String(err)}`);
  }

  return shoptimizerResponseSchema.parse(json);
}

/**
 * Returns `{ optimizedProduct, pluginsFired, pluginResults }` with the
 * kebab/camel ambiguity collapsed. Useful for the service layer.
 */
export interface NormalizedShoptimizerResult {
  optimizedProduct: MerchantProduct;
  pluginsFired: string[];
  pluginResults: Record<string, unknown>;
}

export class ShoptimizerInvalidResponseError extends Error {
  code = "SHOPTIMIZER_INVALID_RESPONSE" as const;
  constructor(message: string) {
    super(`Shoptimizer returned an invalid response: ${message}`);
  }
}

/**
 * Collapses kebab/camel ambiguity. Throws if neither
 * `optimized-product` nor `optimizedProduct` is present — we never
 * silently fall back to the input, since that would hide upstream
 * failures and violate the no-passthrough contract.
 */
export function normalizeShoptimizerResponse(
  raw: ShoptimizerResponse,
): NormalizedShoptimizerResult {
  const optimizedProduct = raw["optimized-product"] ?? raw.optimizedProduct;
  if (!optimizedProduct) {
    throw new ShoptimizerInvalidResponseError(
      "missing `optimized-product` / `optimizedProduct` field",
    );
  }
  const pluginsFired = raw["plugins-fired"] ?? raw.pluginsFired ?? [];
  const pluginResults =
    (raw["plugin-results"] ?? raw.pluginResults ?? {}) as Record<string, unknown>;
  return { optimizedProduct, pluginsFired, pluginResults };
}
