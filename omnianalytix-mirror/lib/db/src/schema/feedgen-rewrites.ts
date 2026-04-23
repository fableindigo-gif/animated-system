import {
  pgTable,
  text,
  integer,
  doublePrecision,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * product_feedgen_rewrites — one row per warehouse product per rewrite generation.
 *
 * The FeedGen worker scans underperforming products (low CTR / low ROAS via
 * Shopping Insider) and asks Gemini to propose a new title and description.
 * Each generation lands here keyed by `id = warehouse_shopify_products.id`,
 * so the latest rewrite always overwrites the previous one for that SKU.
 *
 * Approval flow reuses the existing Approval Queue (`proposed_tasks`) and the
 * Shoptimizer write-back worker — see routes/feed-enrichment/feedgen.ts.
 */
export const productFeedgenRewrites = pgTable(
  "product_feedgen_rewrites",
  {
    id:                 text("id").primaryKey(), // matches warehouse_shopify_products.id
    tenantId:           text("tenant_id").notNull().default("default"),
    productId:          text("product_id").notNull(),
    sku:                text("sku").notNull().default(""),

    /** Snapshot of the source product at generation time. */
    originalTitle:       text("original_title").notNull().default(""),
    originalDescription: text("original_description").notNull().default(""),

    /** Gemini output. */
    rewrittenTitle:       text("rewritten_title").notNull().default(""),
    rewrittenDescription: text("rewritten_description").notNull().default(""),
    /** 0..100 — Gemini's self-rated quality of the rewrite. */
    qualityScore:         integer("quality_score").notNull().default(0),
    reasoning:            text("reasoning").notNull().default(""),
    /** Which source attributes the rewrite relied on (brand, color, size, etc.). */
    citedAttributes:      jsonb("cited_attributes").$type<string[]>().notNull().default([]),

    /** Performance signals that triggered the rewrite (Shopping Insider). */
    triggerSignals:     jsonb("trigger_signals").$type<{
      impressions?: number;
      clicks?: number;
      ctr?: number;
      cost?: number;
      conversionValue?: number;
      roas?: number;
      reason?: string;
    } | null>().default(null),

    /** Lifecycle: pending → approved → applied | rejected | failed. */
    status:             text("status").notNull().default("pending"),
    approvedTaskId:     integer("approved_task_id"),
    errorCode:          text("error_code"),
    errorMessage:       text("error_message"),

    /** Wall-clock cost of the Gemini call, ms. */
    latencyMs:          doublePrecision("latency_ms").default(0),
    generatedAt:        timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
    approvedAt:         timestamp("approved_at",  { withTimezone: true }),
  },
  (t) => [
    index("product_feedgen_rewrites_tenant_idx").on(t.tenantId),
    index("product_feedgen_rewrites_status_idx").on(t.status),
    index("product_feedgen_rewrites_score_idx").on(t.qualityScore),
    uniqueIndex("product_feedgen_rewrites_pk_uidx").on(t.id),
  ],
);

export type ProductFeedgenRewrite = typeof productFeedgenRewrites.$inferSelect;
