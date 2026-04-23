import { pgTable, serial, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { conversations } from "./conversations";

export const stateSnapshots = pgTable("state_snapshots", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").references(() => conversations.id).notNull(),
  platform: text("platform").notNull(),
  platformLabel: text("platform_label").notNull(),
  toolName: text("tool_name").notNull(),
  toolDisplayName: text("tool_display_name").notNull(),
  toolArgs: jsonb("tool_args").notNull().$type<Record<string, unknown>>(),
  snapshotData: jsonb("snapshot_data").$type<Record<string, unknown>>(),
  displayDiff: jsonb("display_diff").$type<Array<{ label: string; from: string; to: string }>>(),
  reasoning: text("reasoning"),
  opportunityCost: text("opportunity_cost"),
  status: text("status").notNull().default("pending"),
  executionResult: jsonb("execution_result").$type<{ success: boolean; message: string }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  // ── Diagnostic Insight Traceability ─────────────────────────────────────────
  // Links this proposed action back to the specific diagnostic alert that
  // generated the recommendation. Populated when an action is proposed from
  // the Live Triage view (insightId = the alert's string ID, e.g.
  // "gads-budget-0", "diag-margin-leak-critical").
  // Carried through to audit_logs.insight_id on approve/reject so the full
  // activity trail can answer "why was this action taken?".
  sourceAlertId: text("source_alert_id"),
});

export type StateSnapshot = typeof stateSnapshots.$inferSelect;
export type InsertStateSnapshot = typeof stateSnapshots.$inferInsert;
