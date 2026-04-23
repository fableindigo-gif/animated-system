/**
 * FeedGen service layer — orchestrates Vertex AI Gemini calls and validates
 * responses against GMC rules. Used by the FeedGen worker (scheduled scans),
 * the FeedGen REST routes (`/api/feed-enrichment/feedgen/*`) and the ADK
 * `generate_feed_rewrites` tool.
 */
import { getGoogleGenAI, VERTEX_MODEL } from "../vertex-client";
import {
  buildFeedgenPrompt,
  FEEDGEN_SYSTEM_INSTRUCTION,
  validateFeedgenResponse,
  type FeedgenResponse,
  type SourceProduct,
} from "./prompts";
import { logger } from "../logger";

export const FEEDGEN_MAX_BATCH = 25;

/**
 * Per-call Vertex token usage. Defaults to zero when Vertex omits
 * `usageMetadata` (it sometimes does on errored responses) so the worker
 * can sum these unconditionally without NaN risk.
 */
export interface FeedgenTokenUsage {
  promptTokens:     number;
  candidatesTokens: number;
  totalTokens:      number;
}

export interface FeedgenSuccess {
  ok: true;
  offerId: string;
  rewrite: FeedgenResponse;
  latencyMs: number;
  usage: FeedgenTokenUsage;
}

export interface FeedgenFailure {
  ok: false;
  offerId: string;
  errorCode: "VERTEX_ERROR" | "INVALID_JSON" | "VALIDATION_FAILED" | "EMPTY_RESPONSE";
  errorMessage: string;
  latencyMs: number;
  usage: FeedgenTokenUsage;
}

export type FeedgenResult = FeedgenSuccess | FeedgenFailure;

/**
 * Strip a `\`\`\`json … \`\`\`` fence if Gemini decided to ignore the
 * "no markdown" instruction (it does this 1-2% of the time).
 */
function stripJsonFence(s: string): string {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) return fenced[1].trim();
  return s.trim();
}

const ZERO_USAGE: FeedgenTokenUsage = { promptTokens: 0, candidatesTokens: 0, totalTokens: 0 };

function readUsage(resp: { usageMetadata?: unknown } | undefined): FeedgenTokenUsage {
  const u = resp?.usageMetadata as
    | { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
    | undefined;
  if (!u) return { ...ZERO_USAGE };
  const pick = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
  return {
    promptTokens:     pick(u.promptTokenCount),
    candidatesTokens: pick(u.candidatesTokenCount),
    totalTokens:      pick(u.totalTokenCount),
  };
}

async function generateOne(product: SourceProduct): Promise<FeedgenResult> {
  const startedAt = Date.now();
  let usage: FeedgenTokenUsage = { ...ZERO_USAGE };
  try {
    const ai = await getGoogleGenAI();

    const resp = await ai.models.generateContent({
      model: VERTEX_MODEL,
      contents: [{ role: "user", parts: [{ text: buildFeedgenPrompt(product) }] }],
      config: {
        systemInstruction: { role: "system", parts: [{ text: FEEDGEN_SYSTEM_INSTRUCTION }] },
        responseMimeType: "application/json",
        temperature: 0.4,
        maxOutputTokens: 2048,
      },
    });
    const latencyMs = Date.now() - startedAt;
    usage = readUsage(resp);

    const text = resp.candidates?.[0]?.content?.parts
      ?.map((p) => ("text" in p ? p.text : ""))
      .join("")
      .trim();
    if (!text) {
      return {
        ok: false, offerId: product.offerId,
        errorCode: "EMPTY_RESPONSE",
        errorMessage: "Gemini returned an empty response.",
        latencyMs, usage,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsonFence(text));
    } catch (err) {
      return {
        ok: false, offerId: product.offerId,
        errorCode: "INVALID_JSON",
        errorMessage: `Failed to parse Gemini response as JSON: ${(err as Error).message}`,
        latencyMs, usage,
      };
    }

    const validated = validateFeedgenResponse(parsed, product);
    if (!validated.ok) {
      return {
        ok: false, offerId: product.offerId,
        errorCode: "VALIDATION_FAILED",
        errorMessage: validated.error,
        latencyMs, usage,
      };
    }

    return { ok: true, offerId: product.offerId, rewrite: validated.value, latencyMs, usage };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, offerId: product.offerId }, "[feedgen] Vertex call failed");
    return {
      ok: false, offerId: product.offerId,
      errorCode: "VERTEX_ERROR",
      errorMessage: msg.substring(0, 500),
      latencyMs, usage,
    };
  }
}

export async function generateRewrite(product: SourceProduct): Promise<FeedgenResult> {
  return generateOne(product);
}

/**
 * Generate rewrites with bounded concurrency. Defaults to 4 in-flight
 * Vertex calls — Gemini 2.5 Pro tolerates this without quota churn for
 * single-tenant workloads, and stays well clear of Vertex' 60 RPM default.
 */
export async function generateRewriteBatch(
  products: SourceProduct[],
  opts: { concurrency?: number } = {},
): Promise<FeedgenResult[]> {
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, 8));
  const results: FeedgenResult[] = new Array(products.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= products.length) return;
      results[i] = await generateOne(products[i]);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
