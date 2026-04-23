import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const lookerTemplates = pgTable("looker_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  lookerDashboardId: text("looker_dashboard_id").notNull(),
  category: text("category").notNull().default("general"),
  reportType: text("report_type").notNull().default("interactive"),
  agencyId: integer("agency_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertLookerTemplateSchema = createInsertSchema(lookerTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type LookerTemplate = typeof lookerTemplates.$inferSelect;
export type InsertLookerTemplate = z.infer<typeof insertLookerTemplateSchema>;
