/**
 * Feed Enrichment Worker
 * ─────────────────────
 * Fetches Shopify products that have not yet been LLM-tagged, calls Gemini 2.5 Flash
 * to extract conversational search attributes (Shape, Occasion, Finish, Activity),
 * writes the results back to Shopify as Metafields, and updates progress in the DB.
 *
 * Called by POST /api/feed-enrichment/run.
 * Runs in-process as a non-blocking async background task.
 */

import { ai } from "@workspace/integrations-gemini-ai";
import { batchProcess } from "@workspace/integrations-gemini-ai/batch";
import {
  db,
  warehouseShopifyProducts,
  platformConnections,
  feedEnrichmentJobs,
  workspaces,
} from "@workspace/db";
import { eq, isNull, and, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const SHOPIFY_API_VERSION = "2024-01";
const METAFIELD_NAMESPACE = "omnianalytix_feed";
const GEMINI_MODEL        = "gemini-2.5-flash";

// ─── Type definitions ─────────────────────────────────────────────────────────
export interface EnrichmentAttributes {
  shape?:    string;
  occasion?: string;
  finish?:   string;
  activity?: string;
  // Schema permits forward-compatible LLM-extracted attributes
  [key: string]: string | undefined;
}

export interface EnrichmentRunOptions {
  jobId:          number;
  organizationId: number;
  workspaceId?:   number;
  limit:          number;
  tenantId?:      string;
}

// ─── Shopify metafield write-back ─────────────────────────────────────────────
async function writeShopifyMetafields(
  shop:        string,
  accessToken: string,
  productId:   string,
  attrs:       EnrichmentAttributes,
): Promise<{ success: boolean; errors: string[] }> {
  const errors: string[] = [];
  const entries = Object.entries(attrs).filter(([, v]) => v && v !== "unknown" && v !== "n/a");

  for (const [key, value] of entries) {
    try {
      const resp = await fetch(
        `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}/metafields.json`,
        {
          method:  "POST",
          headers: {
            "Content-Type":           "application/json",
            "X-Shopify-Access-Token": accessToken,
          },
          body: JSON.stringify({
            metafield: {
              namespace: METAFIELD_NAMESPACE,
              key,
              value:     String(value),
              type:      "single_line_text_field",
            },
          }),
        },
      );

      if (!resp.ok) {
        const body = await resp.text();
        errors.push(`${key}: ${resp.status} — ${body.substring(0, 200)}`);
      }
    } catch (err) {
      errors.push(`${key}: network error — ${String(err)}`);
    }
  }

  return { success: errors.length === 0, errors };
}

// ─── LLM attribute extraction (Gemini) ───────────────────────────────────────
async function extractAttributes(product: {
  title:       string;
  description: string;
  imageUrl:    string;
}): Promise<EnrichmentAttributes | null> {
  const prompt = [
    "You are an e-commerce attribute extraction engine.",
    "Given the product details below, extract these conversational search attributes.",
    'Return ONLY valid strict JSON with exactly these keys: "shape", "occasion", "finish", "activity".',
    'Use concise values (1-3 words). Use "n/a" if an attribute is not applicable.',
    "Do not include explanations or markdown fences.",
    "",
    `Title: ${product.title}`,
    product.description ? `Description: ${product.description.substring(0, 400)}` : "",
    product.imageUrl    ? `Image URL: ${product.imageUrl}` : "",
  ].filter(Boolean).join("\n");

  const response = await ai.models.generateContent({
    model:    GEMINI_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config:   {
      maxOutputTokens:  8192,
      temperature:      0.1,
      responseMimeType: "application/json",
    },
  });

  const raw = response.text?.trim() ?? "";
  if (!raw) return null;

  const json   = raw.replace(/^```json?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(json) as EnrichmentAttributes;

  if (typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return {
    shape:    typeof parsed.shape    === "string" ? parsed.shape    : undefined,
    occasion: typeof parsed.occasion === "string" ? parsed.occasion : undefined,
    finish:   typeof parsed.finish   === "string" ? parsed.finish   : undefined,
    activity: typeof parsed.activity === "string" ? parsed.activity : undefined,
  };
}

// ─── Main worker function ─────────────────────────────────────────────────────
export async function runFeedEnrichment(opts: EnrichmentRunOptions): Promise<void> {
  const { jobId, organizationId, workspaceId, limit, tenantId } = opts;
  const jobLog = logger.child({ jobId, organizationId });

  // Mark job as running
  await db
    .update(feedEnrichmentJobs)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(feedEnrichmentJobs.id, jobId));

  // Resolve Shopify connection for this org/workspace
  let shopConnection: { shop: string; accessToken: string } | null = null;
  try {
    const resolveConn = async (orgId: number) => {
      const [conn] = await db
        .select()
        .from(platformConnections)
        .where(and(
          eq(platformConnections.organizationId, orgId),
          eq(platformConnections.platform, "shopify"),
        ))
        .limit(1);
      if (conn?.credentials) {
        const creds = conn.credentials as Record<string, string>;
        if (creds.accessToken && creds.shop) return { shop: creds.shop, accessToken: creds.accessToken };
      }
      return null;
    };

    if (workspaceId) {
      const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
      if (ws) shopConnection = await resolveConn(ws.organizationId);
    }
    if (!shopConnection) shopConnection = await resolveConn(organizationId);
  } catch (err) {
    jobLog.warn({ err }, "Could not resolve Shopify connection — skipping metafield write-back");
  }

  // Fetch unenriched products up to the tier limit
  const unenrichedProducts = await db
    .select({
      id:          warehouseShopifyProducts.id,
      productId:   warehouseShopifyProducts.productId,
      title:       warehouseShopifyProducts.title,
      description: warehouseShopifyProducts.description,
      imageUrl:    warehouseShopifyProducts.imageUrl,
    })
    .from(warehouseShopifyProducts)
    .where(and(
      isNull(warehouseShopifyProducts.llmEnrichedAt),
      // SECURITY: enrichment must be tenant-scoped. If tenantId is missing
      // we deliberately match nothing rather than scan every tenant's catalog.
      tenantId ? eq(warehouseShopifyProducts.tenantId, tenantId) : sql`1=0`,
    ))
    .limit(Math.min(limit, 1000));

  const totalSkus = unenrichedProducts.length;
  await db
    .update(feedEnrichmentJobs)
    .set({ totalSkus })
    .where(eq(feedEnrichmentJobs.id, jobId));

  jobLog.info({ totalSkus, limit, model: GEMINI_MODEL }, "Starting Gemini feed enrichment run");

  // ── Process with batchProcess (rate-limited, retried concurrency) ───────────
  await batchProcess(
    unenrichedProducts,
    async (product) => {
      let attrs: EnrichmentAttributes | null = null;
      try {
        attrs = await extractAttributes({
          title:       product.title,
          description: product.description ?? "",
          imageUrl:    product.imageUrl    ?? "",
        });
      } catch (err) {
        jobLog.warn({ err, title: product.title }, "Gemini extraction failed — skipping");
      }

      if (!attrs) {
        await db
          .update(feedEnrichmentJobs)
          .set({ failedSkus: sql`${feedEnrichmentJobs.failedSkus} + 1` })
          .where(eq(feedEnrichmentJobs.id, jobId));
        return;
      }

      // Write attributes to warehouse
      await db
        .update(warehouseShopifyProducts)
        .set({ llmAttributes: attrs, llmEnrichedAt: new Date() })
        .where(eq(warehouseShopifyProducts.id, product.id));

      // Write metafields to Shopify (if connected)
      if (shopConnection) {
        const { errors } = await writeShopifyMetafields(
          shopConnection.shop,
          shopConnection.accessToken,
          product.productId,
          attrs,
        );
        if (errors.length) {
          jobLog.warn({ productId: product.productId, errors }, "Some metafield writes failed");
        }
      }

      await db
        .update(feedEnrichmentJobs)
        .set({ processedSkus: sql`${feedEnrichmentJobs.processedSkus} + 1` })
        .where(eq(feedEnrichmentJobs.id, jobId));
    },
    { concurrency: 3, retries: 5 },
  );

  // Fetch final counts to determine job status
  const [finalJob] = await db
    .select({ processedSkus: feedEnrichmentJobs.processedSkus, failedSkus: feedEnrichmentJobs.failedSkus })
    .from(feedEnrichmentJobs)
    .where(eq(feedEnrichmentJobs.id, jobId))
    .limit(1);

  const finalStatus =
    finalJob && finalJob.failedSkus === totalSkus && totalSkus > 0 ? "failed" : "completed";

  await db
    .update(feedEnrichmentJobs)
    .set({ status: finalStatus, completedAt: new Date() })
    .where(eq(feedEnrichmentJobs.id, jobId));

  jobLog.info({ totalSkus, finalStatus, model: GEMINI_MODEL }, "Feed enrichment run complete");
}
