import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";

export const webhookThreads = pgTable("webhook_threads", {
  id: serial("id").primaryKey(),
  alertId: integer("alert_id"),
  taskId: integer("task_id"),
  threadKey: text("thread_key").notNull(),
  channelType: text("channel_type").notNull().default("teams"),
  alertTitle: text("alert_title").notNull(),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type WebhookThread = typeof webhookThreads.$inferSelect;
export type InsertWebhookThread = typeof webhookThreads.$inferInsert;
