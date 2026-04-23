import { pgTable, serial, text, timestamp, boolean, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sharedReports = pgTable("shared_reports", {
  id: serial("id").primaryKey(),
  shareId: text("share_id").notNull().unique(),
  workspaceId: integer("workspace_id").notNull(),
  agencyName: text("agency_name"),
  reportTitle: text("report_title").notNull().default("Performance Report"),
  reportData: jsonb("report_data").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertSharedReportSchema = createInsertSchema(sharedReports).omit({
  id: true,
  createdAt: true,
});

export type SharedReport = typeof sharedReports.$inferSelect;
export type InsertSharedReport = z.infer<typeof insertSharedReportSchema>;
