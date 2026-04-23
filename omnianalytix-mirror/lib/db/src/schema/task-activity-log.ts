import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { proposedTasks } from "./proposed_tasks";
import { teamMembers } from "./team_members";

export const taskActivityLog = pgTable("task_activity_log", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").references(() => proposedTasks.id).notNull(),
  actorId: integer("actor_id").references(() => teamMembers.id),
  actorName: text("actor_name").notNull(),
  actorRole: text("actor_role").notNull(),
  action: text("action").notNull(),
  note: text("note").notNull().default(""),
  targetMemberId: integer("target_member_id").references(() => teamMembers.id),
  targetMemberName: text("target_member_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type TaskActivity = typeof taskActivityLog.$inferSelect;
export type InsertTaskActivity = typeof taskActivityLog.$inferInsert;
