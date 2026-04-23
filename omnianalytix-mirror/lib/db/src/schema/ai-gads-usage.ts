import { pgTable, serial, integer, date, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

/**
 * Per-org, per-day Google Ads row read counter for AI-driven queries.
 *
 * Incremented atomically (INSERT … ON CONFLICT DO UPDATE) each time the
 * `get_campaign_performance` ADK tool executes a GAQL call.  Used to
 * enforce `ai_daily_row_cap` and expose an operator-visible metric.
 *
 * One row per (organization_id, usage_date) pair.
 */
export const aiGadsDailyUsage = pgTable("ai_gads_daily_usage", {
  id:             serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  usageDate:      date("usage_date").notNull(),
  rowsRead:       integer("rows_read").notNull().default(0),
  queryCount:     integer("query_count").notNull().default(0),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  orgDateUniq: uniqueIndex("ai_gads_usage_org_date_uq").on(t.organizationId, t.usageDate),
}));

export type AiGadsDailyUsage = typeof aiGadsDailyUsage.$inferSelect;
