import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const leads = pgTable("leads", {
  id:            serial("id").primaryKey(),
  source:        text("source").notNull().default("demo"),    // "demo" | "enterprise"
  email:         text("email").notNull(),
  name:          text("name"),
  website:       text("website"),
  company:       text("company"),
  employees:     text("employees"),
  revenueModel:  text("revenue_model"),
  attribution:   text("attribution"),
  scheduledDate: text("scheduled_date"),
  scheduledTime: text("scheduled_time"),
  message:       text("message"),
  status:        text("status").notNull().default("new"),     // "new" | "contacted" | "archived"
  notes:         text("notes"),
  createdAt:     timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("leads_status_idx").on(t.status),
  index("leads_created_at_idx").on(t.createdAt),
]);

export const insertLeadSchema = createInsertSchema(leads).omit({
  id: true,
  createdAt: true,
});

export type Lead         = typeof leads.$inferSelect;
export type InsertLead   = z.infer<typeof insertLeadSchema>;

export const LEAD_STATUSES = ["new", "contacted", "archived"] as const;
export type LeadStatus = typeof LEAD_STATUSES[number];
