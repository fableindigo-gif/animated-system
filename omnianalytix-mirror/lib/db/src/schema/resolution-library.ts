import { pgTable, serial, text, timestamp, jsonb, integer, boolean } from "drizzle-orm/pg-core";
import { proposedTasks } from "./proposed_tasks";
import { teamMembers } from "./team_members";

export const resolutionLibrary = pgTable("resolution_library", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id"),
  taskId: integer("task_id").references(() => proposedTasks.id),
  savedBy: integer("saved_by").references(() => teamMembers.id),
  savedByName: text("saved_by_name").notNull(),
  platform: text("platform").notNull(),
  platformLabel: text("platform_label").notNull(),
  toolName: text("tool_name").notNull(),
  toolDisplayName: text("tool_display_name").notNull(),
  toolArgs: jsonb("tool_args").notNull().$type<Record<string, unknown>>(),
  originalProblem: text("original_problem").notNull(),
  reasoning: text("reasoning").notNull().default(""),
  displayDiff: jsonb("display_diff").$type<Array<{ label: string; from: string; to: string }>>(),
  tags: jsonb("tags").$type<string[]>().default([]),
  isPublic: boolean("is_public").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ResolutionEntry = typeof resolutionLibrary.$inferSelect;
export type InsertResolutionEntry = typeof resolutionLibrary.$inferInsert;
