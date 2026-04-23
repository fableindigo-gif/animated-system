import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const customMetrics = pgTable("custom_metrics", {
  id:              serial("id").primaryKey(),
  organizationId:  integer("organization_id").notNull(),
  workspaceId:     integer("workspace_id"),
  name:            text("name").notNull(),
  description:     text("description"),
  dataType:        text("data_type").notNull().default("number"),
  formula:         text("formula").notNull(),
  createdBy:       integer("created_by"),
  createdAt:       timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertCustomMetricSchema = createInsertSchema(customMetrics).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CustomMetric       = typeof customMetrics.$inferSelect;
export type InsertCustomMetric = z.infer<typeof insertCustomMetricSchema>;
