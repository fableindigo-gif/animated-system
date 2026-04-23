import {
  pgTable,
  serial,
  integer,
  text,
  doublePrecision,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * agency_ops_tasks
 *
 * Generic operational tasks scoped to organizationId (agency level) so
 * directors can see work across all client workspaces.  Separate from
 * proposed_tasks which are AI-generated campaign-action proposals.
 *
 * salesProgress and leftover are computed at the API layer and never stored.
 */
export const agencyOpsTasks = pgTable(
  "agency_ops_tasks",
  {
    id:                   serial("id").primaryKey(),
    organizationId:       integer("organization_id").notNull(),
    title:                text("title").notNull(),
    description:          text("description").notNull().default(""),
    priority:             text("priority").notNull().default("medium"),   // high | medium | low
    dueDate:              timestamp("due_date", { withTimezone: true }),
    status:               text("status").notNull().default("not_started"), // not_started | in_progress | completed
    assignedTo:           integer("assigned_to"),
    assignedToName:       text("assigned_to_name").notNull().default(""),
    messagesExchanged:    integer("messages_exchanged").notNull().default(0),
    avgResponseTimeHours: doublePrecision("avg_response_time_hours").notNull().default(0),
    createdBy:            integer("created_by"),
    createdByName:        text("created_by_name").notNull().default(""),
    createdAt:            timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt:            timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("agency_ops_tasks_org_idx").on(t.organizationId),
    index("agency_ops_tasks_status_idx").on(t.organizationId, t.status),
    index("agency_ops_tasks_priority_idx").on(t.organizationId, t.priority),
  ],
);

export const insertAgencyOpsTaskSchema = createInsertSchema(agencyOpsTasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type AgencyOpsTask       = typeof agencyOpsTasks.$inferSelect;
export type InsertAgencyOpsTask = z.infer<typeof insertAgencyOpsTaskSchema>;

export const OPS_PRIORITIES = ["high", "medium", "low"]                          as const;
export const OPS_STATUSES   = ["not_started", "in_progress", "completed"]        as const;
export type OpsPriority = (typeof OPS_PRIORITIES)[number];
export type OpsStatus   = (typeof OPS_STATUSES)[number];
