import { pgTable, text, jsonb, timestamp, boolean, index } from "drizzle-orm/pg-core";

export const adkSessions = pgTable("adk_sessions", {
  id:          text("id").primaryKey(),
  appName:     text("app_name").notNull(),
  userId:      text("user_id").notNull(),
  state:       jsonb("state").notNull().default({}),
  events:      jsonb("events").notNull().default([]),
  title:       text("title"),
  pinned:      boolean("pinned").notNull().default(false),
  archivedAt:  timestamp("archived_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("adk_sessions_app_user_idx").on(t.appName, t.userId),
  index("adk_sessions_updated_at_idx").on(t.updatedAt),
  index("adk_sessions_pinned_idx").on(t.pinned),
  index("adk_sessions_archived_idx").on(t.archivedAt),
  // Two additional indexes are maintained via raw SQL migrations because drizzle-orm
  // cannot represent operator-class expression indexes:
  //   GIN trigram index (events::text gin_trgm_ops) — 0001_adk_sessions_events_trgm_idx.sql
  //   Composite partial B-tree (app_name, user_id, updated_at DESC) WHERE archived_at IS NULL
  //                                                — 0002_adk_sessions_composite_partial_idx.sql
]);

export type AdkSession = typeof adkSessions.$inferSelect;
