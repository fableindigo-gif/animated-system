import { pgTable, serial, text, timestamp, jsonb, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { teamMembers } from "./team_members";

export const proposedTasks = pgTable("proposed_tasks", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id"),
  idempotencyKey: text("idempotency_key"),
  proposedBy: integer("proposed_by").references(() => teamMembers.id),
  proposedByName: text("proposed_by_name").notNull(),
  proposedByRole: text("proposed_by_role").notNull(),
  platform: text("platform").notNull(),
  platformLabel: text("platform_label").notNull(),
  toolName: text("tool_name").notNull(),
  toolDisplayName: text("tool_display_name").notNull(),
  toolArgs: jsonb("tool_args").notNull().$type<Record<string, unknown>>(),
  displayDiff: jsonb("display_diff").$type<Array<{ label: string; from: string; to: string }>>(),
  reasoning: text("reasoning").notNull().default(""),
  snapshotId: integer("snapshot_id"),
  comments: text("comments").notNull().default(""),
  status: text("status").notNull().default("pending"),
  assignedTo: integer("assigned_to").references(() => teamMembers.id),
  assignedToName: text("assigned_to_name"),
  resolvedBy: integer("resolved_by").references(() => teamMembers.id),
  resolvedByName: text("resolved_by_name"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  // Retry bookkeeping for the auto-retry scheduler. Only populated for tasks
  // that move into `failed` with retryable guidance (transient/quota). Used by
  // the writeback retry scheduler to bound runaway retries and to honour the
  // upstream `Retry-After` window before re-draining.
  attemptCount: integer("attempt_count").notNull().default(0),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  lastRetryClass: text("last_retry_class"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_proposed_tasks_idempotency").on(table.idempotencyKey),
]);

export type ProposedTask = typeof proposedTasks.$inferSelect;
export type InsertProposedTask = typeof proposedTasks.$inferInsert;
