import { pgTable, serial, text, timestamp, jsonb, integer, index } from "drizzle-orm/pg-core";
import { conversations } from "./conversations";
import { stateSnapshots } from "./state_snapshots";

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  conversationId: integer("conversation_id").references(() => conversations.id),
  snapshotId: integer("snapshot_id").references(() => stateSnapshots.id),
  platform: text("platform").notNull(),
  platformLabel: text("platform_label").notNull(),
  toolName: text("tool_name").notNull(),
  toolDisplayName: text("tool_display_name").notNull(),
  toolArgs: jsonb("tool_args").notNull().$type<Record<string, unknown>>(),
  displayDiff: jsonb("display_diff").$type<Array<{ label: string; from: string; to: string }>>(),
  result: jsonb("result").$type<{ success: boolean; message: string }>(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  // ── Diagnostic Insight Traceability ─────────────────────────────────────────
  // Copied from state_snapshots.source_alert_id at approve/reject time.
  // Provides a direct link in the activity trail from every executed action
  // back to the specific diagnostic alert that triggered the recommendation.
  // Example values: "gads-budget-0", "diag-margin-leak-critical",
  //                 "diag-inventory-data-stale", "gads-automation-churn".
  // NULL when an action was manually proposed (not generated from an alert).
  insightId: text("insight_id"),
}, (t) => [
  index("audit_logs_org_id_idx").on(t.organizationId),
  index("audit_logs_created_at_idx").on(t.createdAt),
  index("audit_logs_insight_id_idx").on(t.insightId),
]);

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;
