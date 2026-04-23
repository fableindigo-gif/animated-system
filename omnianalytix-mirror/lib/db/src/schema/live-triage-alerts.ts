import {
  pgTable,
  serial,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

export const liveTriageAlerts = pgTable("live_triage_alerts", {
  id: serial("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().default("default"),
  severity: text("severity").notNull().default("info"),
  type: text("type").notNull().default("Budget"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  platform: text("platform").default(""),
  action: text("action").default(""),
  resolvedStatus: boolean("resolved_status").notNull().default(false),
  contextTag: text("context_tag").default("active"),
  snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
  externalId: text("external_id").default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type LiveTriageAlert = typeof liveTriageAlerts.$inferSelect;
export type InsertLiveTriageAlert = typeof liveTriageAlerts.$inferInsert;
