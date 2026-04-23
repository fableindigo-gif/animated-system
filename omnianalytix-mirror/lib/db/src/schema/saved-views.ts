import { pgTable, serial, text, jsonb, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const savedViews = pgTable(
  "saved_views",
  {
    id:          serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull(),
    userId:      text("user_id").notNull(),
    pageKey:     text("page_key").notNull(),
    name:        text("name").notNull(),
    filters:     jsonb("filters").notNull().$type<Record<string, string[] | string | null>>(),
    datePreset:  text("date_preset"),
    customFrom:  text("custom_from"),
    customTo:    text("custom_to"),
    createdAt:   timestamp("created_at",  { withTimezone: true }).defaultNow().notNull(),
    updatedAt:   timestamp("updated_at",  { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // Saved views are PER-USER per page. Two users in the same workspace can
    // each have a "My view" without collision; one user can't accidentally
    // overwrite another's view of the same name.
    uniqByUserPageName: uniqueIndex("saved_views_user_page_name_uq").on(t.workspaceId, t.userId, t.pageKey, t.name),
  }),
);

export const insertSavedViewSchema = createInsertSchema(savedViews).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type SavedView       = typeof savedViews.$inferSelect;
export type InsertSavedView = z.infer<typeof insertSavedViewSchema>;
