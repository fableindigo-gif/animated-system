// ─── Resilient Fetch Utilities ────────────────────────────────────────────────
// fetchWithBackoff: Automatic exponential retry on 429 / 5xx responses.
// shopifyFetchAllPages: REST cursor pagination via Link header.

import { logger } from "./logger";

export interface BackoffOptions extends RequestInit {
  maxRetries?: number;
  baseDelayMs?: number;
  tag?: string;
  timeoutMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps the native fetch() with:
 * - Automatic retry on 429 (Too Many Requests) and 5xx server errors
 * - Exponential backoff: baseDelayMs × 2^attempt
 * - Respects Retry-After header from the server when present
 * - Up to maxRetries (default 3) additional attempts
 */
export async function fetchWithBackoff(
  url: string,
  options: BackoffOptions = {},
): Promise<Response> {
  const { maxRetries = 3, baseDelayMs = 500, tag = "fetch", timeoutMs = 30_000, ...fetchOptions } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const existingSignal = fetchOptions.signal;
    if (existingSignal) {
      existingSignal.addEventListener("abort", () => controller.abort(existingSignal.reason));
    }
    const timeoutId = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
    try {
      const resp = await fetch(url, { ...fetchOptions, signal: controller.signal });

      if ((resp.status === 429 || resp.status >= 500) && attempt < maxRetries) {
        const retryAfterHeader = resp.headers.get("Retry-After");
        const delayMs = retryAfterHeader
          ? Math.min(parseInt(retryAfterHeader, 10) * 1000, 30_000)
          : baseDelayMs * Math.pow(2, attempt);

        logger.warn({ tag, url, status: resp.status, attempt, delayMs }, "fetchWithBackoff: retrying");
        await sleep(delayMs);
        continue;
      }

      return resp;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        logger.warn({ tag, url, err, attempt, delayMs }, "fetchWithBackoff: network error, retrying");
        await sleep(delayMs);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`fetchWithBackoff: all ${maxRetries + 1} attempts failed for ${url}`);
}

/**
 * Shopify REST cursor-based full pagination.
 * Follows Link: <url>; rel="next" headers until no more pages.
 * Returns a flat array of all items across all pages.
 *
 * @param firstUrl    - The initial request URL (should include limit=250)
 * @param headers     - Shopify request headers (X-Shopify-Access-Token etc.)
 * @param extractItems - Function to pull the item array out of the raw JSON response
 * @param maxPages    - Hard cap on pages to prevent infinite loops (default 40)
 */
export async function shopifyFetchAllPages<T>(
  firstUrl: string,
  headers: Record<string, string>,
  extractItems: (json: unknown) => T[],
  maxPages = 40,
): Promise<T[]> {
  const all: T[] = [];
  let nextUrl: string | null = firstUrl;
  let page = 0;

  while (nextUrl && page < maxPages) {
    const resp = await fetchWithBackoff(nextUrl, { headers, tag: "shopify-paginate" });

    if (!resp.ok) {
      throw new Error(`Shopify pagination error [page ${page + 1}] HTTP ${resp.status}: ${resp.statusText}`);
    }

    const json = await resp.json();
    const items = extractItems(json);
    all.push(...items);

    // Parse Link header for cursor — format: <url>; rel="next", <url>; rel="previous"
    const linkHeader = resp.headers.get("Link") ?? "";
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    nextUrl = nextMatch ? nextMatch[1] ?? null : null;
    page++;
  }

  return all;
}
