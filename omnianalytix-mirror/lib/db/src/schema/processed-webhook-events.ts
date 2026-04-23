import { pgTable, varchar, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const processedWebhookEvents = pgTable(
  "processed_webhook_events",
  {
    provider: varchar("provider", { length: 32 }).notNull(),
    eventId: varchar("event_id", { length: 255 }).notNull(),
    processedAt: timestamp("processed_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: uniqueIndex("processed_webhook_events_provider_event_id_idx").on(t.provider, t.eventId),
  }),
);

export type ProcessedWebhookEvent = typeof processedWebhookEvents.$inferSelect;
