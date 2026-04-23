import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// ─── Feed Enrichment Jobs ─────────────────────────────────────────────────────
// One row per enrichment run triggered per organisation.
// status: "pending" | "running" | "completed" | "failed"
export const feedEnrichmentJobs = pgTable(
  "feed_enrichment_jobs",
  {
    id:              serial("id").primaryKey(),
    organizationId:  integer("organization_id").notNull(),
    workspaceId:     integer("workspace_id"),
    status:          text("status").notNull().default("pending"),
    totalSkus:       integer("total_skus").notNull().default(0),
    processedSkus:   integer("processed_skus").notNull().default(0),
    failedSkus:      integer("failed_skus").notNull().default(0),
    errorMessage:    text("error_message"),
    startedAt:       timestamp("started_at", { withTimezone: true }),
    completedAt:     timestamp("completed_at", { withTimezone: true }),
    createdAt:       timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("feed_enrichment_jobs_org_idx").on(t.organizationId),
  ],
);

export type FeedEnrichmentJob = typeof feedEnrichmentJobs.$inferSelect;
