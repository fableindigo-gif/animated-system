import {
  pgTable,
  text,
  integer,
  bigint,
  doublePrecision,
  timestamp,
  serial,
  index,
} from "drizzle-orm/pg-core";

/**
 * feedgen_runs — one row per FeedGen worker invocation.
 *
 * Audits the per-run cost (Vertex token usage) against the per-run output
 * (rewrites generated, later approval rate). Powers the "AI cost vs approved
 * feed changes" chart on the Title & Description tab so the team can confirm
 * the feature is paying for itself.
 *
 * Approval rate is NOT stored here: a run's rewrites can be approved hours or
 * days later via the Approval Queue. The dashboard derives approval rate by
 * joining `product_feedgen_rewrites.generated_at` (date-bucketed) against the
 * status column at query time.
 *
 * Token counts default to 0 because Vertex occasionally omits `usageMetadata`
 * on errored responses — we never want a NULL panic in a billing dashboard.
 */
export const feedgenRuns = pgTable(
  "feedgen_runs",
  {
    id:                serial("id").primaryKey(),
    tenantId:          text("tenant_id").notNull().default("default"),

    /** Selection mode that picked the candidates ("underperformer" | "stale" | "targeted"). */
    mode:              text("mode").notNull().default("underperformer"),
    /** "completed" for runs that called Vertex; "skipped" for no-candidates / concurrent-run / etc. */
    status:            text("status").notNull().default("completed"),
    /** Optional reason when status='skipped' (mirrors FeedgenRunResult.reason). */
    skipReason:        text("skip_reason"),

    /** Counts mirror FeedgenRunResult — scanned = generated + failed. */
    scanned:           integer("scanned").notNull().default(0),
    generated:         integer("generated").notNull().default(0),
    failed:            integer("failed").notNull().default(0),

    /**
     * Vertex token usage, summed across every per-SKU call in this run.
     * `bigint` because a long backfill could cumulatively wrap int4.
     */
    promptTokens:      bigint("prompt_tokens",     { mode: "number" }).notNull().default(0),
    candidatesTokens:  bigint("candidates_tokens", { mode: "number" }).notNull().default(0),
    totalTokens:       bigint("total_tokens",      { mode: "number" }).notNull().default(0),

    /** Median gross ROAS of the SKUs picked, when available (see FeedgenRunResult.medianRoas). */
    medianRoas:        doublePrecision("median_roas"),

    startedAt:         timestamp("started_at",  { withTimezone: true }).defaultNow().notNull(),
    finishedAt:        timestamp("finished_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("feedgen_runs_tenant_idx").on(t.tenantId),
    index("feedgen_runs_started_at_idx").on(t.startedAt),
  ],
);

export type FeedgenRun = typeof feedgenRuns.$inferSelect;
