import { pgTable, serial, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";

export const executionLogs = pgTable("execution_logs", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id"),
  userId: text("user_id"),
  actionType: text("action_type").notNull(),
  snapshotId: integer("snapshot_id"),
  apiEndpoint: text("api_endpoint").notNull(),
  forwardPayload: jsonb("forward_payload").notNull().$type<Record<string, unknown>>(),
  revertPayload: jsonb("revert_payload").$type<Record<string, unknown>>(),
  status: text("status").notNull().default("executed"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ExecutionLog = typeof executionLogs.$inferSelect;
export type InsertExecutionLog = typeof executionLogs.$inferInsert;
