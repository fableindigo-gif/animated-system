/**
 * FeedGen prompts — ported from Google Marketing Solutions' upstream
 * `feedgen` Apps Script project (https://github.com/google-marketing-solutions/feedgen).
 *
 * The upstream tool is a Google Sheets add-on that asks Gemini to rewrite
 * Merchant Center product titles and descriptions for higher CTR while
 * obeying Google Shopping policy (no promo, ≤150 char title, ≤5000 char
 * description, no emojis unless brand-permitted).
 *
 * We keep the same five-step prompt structure:
 *   1. Persona (e-commerce copywriter, GMC-aware).
 *   2. Source product context — every known attribute, verbatim.
 *   3. Hard rules — character limits, banned phrases, no fabrication.
 *   4. Few-shot rewrite examples (positive + negative).
 *   5. Required JSON response shape.
 *
 * Output is strict JSON the service layer parses + validates.
 */

export interface SourceProduct {
  offerId:       string;
  title:         string;
  description?:  string | null;
  brand?:        string | null;
  productType?:  string | null;
  color?:        string | null;
  size?:         string | null;
  gender?:       string | null;
  material?:     string | null;
  ageGroup?:     string | null;
  customAttributes?: Record<string, string | number | boolean | null | undefined>;
}

export interface FeedgenResponse {
  rewrittenTitle:       string;
  rewrittenDescription: string;
  qualityScore:         number;       // 0..100, Gemini's self-assessment
  reasoning:            string;       // 1-2 sentences explaining the rewrite
  citedAttributes:      string[];     // e.g. ["brand", "color", "size"]
}

export const FEEDGEN_SYSTEM_INSTRUCTION = `
You are a senior e-commerce copywriter who specializes in Google Shopping
feeds (Performance Max / Standard Shopping). You rewrite product titles and
descriptions to lift CTR while staying inside Google Merchant Center policy.
You write in the same language as the source product. You never invent
attributes (brand, size, material, etc.) that aren't in the source data.
`.trim();

const HARD_RULES = `
HARD RULES (any violation makes the response REJECTED — not just down-scored):
- title MUST be ≤ 150 characters.
- description MUST be ≤ 5000 characters.
- DO NOT include promotional copy: no "buy now", "best price",
  "free shipping", "limited offer", "sale", "%", "$ off", "discount",
  "guaranteed", "100%", "act now", "click here".
- DO NOT use emojis or pictographic characters anywhere.
- DO NOT invent attributes that aren't in the SOURCE block. If a fact is
  unknown, omit it.
- citedAttributes MUST be a non-empty list naming the SOURCE keys you used
  (e.g. ["brand","color","size"]). Citing an attribute that isn't present
  in SOURCE is a rule violation.
- Lead the title with the most distinctive search-relevant attribute
  (brand → product type → key feature → variant: color/size/material).
- Description must be 2–4 short paragraphs or 4–8 bullet-style sentences.
`.trim();

const FEW_SHOT_EXAMPLES = `
EXAMPLE 1 (good):
SOURCE:
  brand: "Allbirds"
  productType: "Running Shoes"
  color: "Charcoal"
  size: "10"
  material: "Merino Wool"
  title: "Allbirds Wool Runners"
  description: "Comfortable shoes."
RESPONSE:
{
  "rewrittenTitle": "Allbirds Wool Runners — Charcoal Merino Wool Running Shoes, Size 10",
  "rewrittenDescription": "The Allbirds Wool Runners pair temperature-regulating Merino wool uppers with a lightweight foam midsole, so your feet stay cool on warm runs and warm on cold mornings.\\n\\nThis size 10 charcoal pair is machine-washable, naturally odor-resistant, and built for everyday training.",
  "qualityScore": 88,
  "reasoning": "Lifted brand, product type, color, material, and size into the title; expanded the description to surface comfort + care benefits using only stated attributes.",
  "citedAttributes": ["brand", "productType", "color", "size", "material"]
}

EXAMPLE 2 (bad — violates hard rules):
RESPONSE:
{
  "rewrittenTitle": "🔥 BEST PRICE!! Allbirds Wool Runners — buy now & save 20% 🔥",
  "rewrittenDescription": "Sale! Free shipping! Limited time offer!",
  "qualityScore": 95,
  "reasoning": "Catchy.",
  "citedAttributes": []
}
This response would be rejected: emojis, ALL CAPS, promo phrases, no cited attributes.
`.trim();

function fmtAttr(label: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  return `  ${label}: ${JSON.stringify(str)}`;
}

export function renderSourceBlock(product: SourceProduct): string {
  const lines: string[] = [];
  lines.push(`  offerId: ${JSON.stringify(product.offerId)}`);
  for (const [k, v] of Object.entries({
    brand:       product.brand,
    productType: product.productType,
    color:       product.color,
    size:        product.size,
    gender:      product.gender,
    material:    product.material,
    ageGroup:    product.ageGroup,
    title:       product.title,
    description: product.description,
  })) {
    const line = fmtAttr(k, v);
    if (line) lines.push(line);
  }
  for (const [k, v] of Object.entries(product.customAttributes ?? {})) {
    const line = fmtAttr(k, v);
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

export function buildFeedgenPrompt(product: SourceProduct): string {
  return `${HARD_RULES}

${FEW_SHOT_EXAMPLES}

SOURCE:
${renderSourceBlock(product)}

Respond with ONLY a single JSON object matching the example response schema.
Do not wrap the JSON in markdown fences. Do not add commentary outside the JSON.
`.trim();
}

// Promo phrases — kept broad on purpose. Anything matching this regex is a
// hard reject, never just a score deduction. Google Merchant Center will
// disapprove any of these in titles/descriptions.
const BANNED_PROMO_RE =
  /(buy now|best price|free shipping|limited offer|limited time|\bsale\b|%\s*off|\$\s*off|\bdiscount\b|guaranteed|\b100\s*%|act now|click here)/i;
const EMOJI_RE = /\p{Extended_Pictographic}/u;

/** Set of source-attribute keys actually present (non-empty) on a product. */
export function sourceAttributeKeys(product: SourceProduct): Set<string> {
  const keys = new Set<string>();
  const add = (k: string, v: unknown) => {
    if (v === null || v === undefined) return;
    if (typeof v === "string" && v.trim() === "") return;
    keys.add(k);
  };
  add("brand",       product.brand);
  add("productType", product.productType);
  add("color",       product.color);
  add("size",        product.size);
  add("gender",      product.gender);
  add("material",    product.material);
  add("ageGroup",    product.ageGroup);
  add("title",       product.title);
  add("description", product.description);
  for (const [k, v] of Object.entries(product.customAttributes ?? {})) add(k, v);
  return keys;
}

/**
 * Validate Gemini's structured response against our hard rules.
 *
 * Rejects (returns `{ok: false}`) on:
 *   - missing/oversize title or description
 *   - invalid qualityScore
 *   - any banned promo phrase
 *   - any emoji / pictographic char
 *   - empty citedAttributes
 *   - any cited attribute not present in the source product
 *
 * `source` is optional only so the validator can be unit-tested in isolation;
 * production callers (service.ts) always pass it so we can verify citations.
 */
export function validateFeedgenResponse(
  raw: unknown,
  source?: SourceProduct,
): { ok: true; value: FeedgenResponse } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Response was not a JSON object." };
  }
  const obj = raw as Record<string, unknown>;
  const title = typeof obj.rewrittenTitle === "string" ? obj.rewrittenTitle.trim() : "";
  const desc  = typeof obj.rewrittenDescription === "string" ? obj.rewrittenDescription.trim() : "";
  const score = typeof obj.qualityScore === "number" ? obj.qualityScore : Number(obj.qualityScore);
  const reasoning = typeof obj.reasoning === "string" ? obj.reasoning.trim() : "";
  const cited = Array.isArray(obj.citedAttributes)
    ? (obj.citedAttributes.filter((s) => typeof s === "string" && s.trim() !== "") as string[])
        .map((s) => s.trim())
    : [];

  if (!title) return { ok: false, error: "Missing rewrittenTitle." };
  if (title.length > 150) return { ok: false, error: `Title exceeds 150 chars (${title.length}).` };
  if (!desc) return { ok: false, error: "Missing rewrittenDescription." };
  if (desc.length > 5000) return { ok: false, error: `Description exceeds 5000 chars (${desc.length}).` };
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    return { ok: false, error: "qualityScore must be a number 0..100." };
  }

  // Hard fail on any banned promo phrase or emoji — these are GMC violations,
  // not "stylistic" issues. We never let them into the approval queue.
  if (BANNED_PROMO_RE.test(title) || BANNED_PROMO_RE.test(desc)) {
    return { ok: false, error: "Contains banned promotional phrase (GMC policy)." };
  }
  if (EMOJI_RE.test(title + desc)) {
    return { ok: false, error: "Contains emoji / pictographic character (GMC policy)." };
  }

  // Citations: must be non-empty and every cited attribute must really exist
  // on the source product. This is what stops Gemini from "citing" attributes
  // it actually fabricated.
  if (cited.length === 0) {
    return { ok: false, error: "citedAttributes must be a non-empty list." };
  }
  if (source) {
    const validKeys = sourceAttributeKeys(source);
    const bogus = cited.filter((c) => !validKeys.has(c));
    if (bogus.length > 0) {
      return {
        ok: false,
        error: `citedAttributes references unknown source keys: ${bogus.join(", ")}`,
      };
    }
  }

  return {
    ok: true,
    value: {
      rewrittenTitle:       title,
      rewrittenDescription: desc,
      qualityScore:         Math.round(score),
      reasoning:            reasoning || "(no reasoning provided)",
      citedAttributes:      cited,
    },
  };
}
