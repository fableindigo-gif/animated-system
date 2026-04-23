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
 * workspace_sales_targets
 *
 * One row per salesperson per workspace per period.
 * Tracks individual rep performance: target, closed amount (used to compute
 * salesProgress on the API), expenses, and status.
 *
 * `salesProgress` is computed by the API as (closedAmount / salesTarget * 100)
 * and never stored here so the DB stays normalised.
 */
export const workspaceSalesTargets = pgTable(
  "workspace_sales_targets",
  {
    id:               serial("id").primaryKey(),
    workspaceId:      integer("workspace_id").notNull(),
    teamMemberId:     integer("team_member_id"),               // optional link to team_members
    salespersonName:  text("salesperson_name").notNull(),
    salespersonEmail: text("salesperson_email").default(""),
    salesTarget:      doublePrecision("sales_target").notNull().default(0),
    closedAmount:     doublePrecision("closed_amount").notNull().default(0),  // drives salesProgress
    expenses:         doublePrecision("expenses").notNull().default(0),
    status:           text("status").notNull().default("not_started"), // not_started | in_progress | completed
    period:           text("period").notNull().default(""),            // YYYY-MM or YYYY-QN
    createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt:        timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("workspace_sales_targets_ws_idx").on(t.workspaceId),
    index("workspace_sales_targets_period_idx").on(t.workspaceId, t.period),
  ],
);

export const insertWorkspaceSalesTargetSchema = createInsertSchema(workspaceSalesTargets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type WorkspaceSalesTarget       = typeof workspaceSalesTargets.$inferSelect;
export type InsertWorkspaceSalesTarget = z.infer<typeof insertWorkspaceSalesTargetSchema>;

export const SALES_STATUSES = ["not_started", "in_progress", "completed"] as const;
export type SalesStatus = (typeof SALES_STATUSES)[number];
