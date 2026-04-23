import {
  pgTable,
  serial,
  integer,
  text,
  doublePrecision,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * workspace_financials
 *
 * Stores one row per calendar month per workspace.  Raw inputs: revenue,
 * COGS, operating expenses, interest expense, and tax expense.  All derived
 * figures (gross profit, operating income, EBT, net income) are computed by
 * the API and never stored here to keep the source of truth clean.
 */
export const workspaceFinancials = pgTable(
  "workspace_financials",
  {
    id:                serial("id").primaryKey(),
    workspaceId:       integer("workspace_id").notNull(),
    month:             text("month").notNull(),                              // "YYYY-MM"
    revenue:           doublePrecision("revenue").notNull().default(0),
    cogs:              doublePrecision("cogs").notNull().default(0),
    operatingExpenses: doublePrecision("operating_expenses").notNull().default(0),
    interestExpense:   doublePrecision("interest_expense").notNull().default(0),
    taxExpense:        doublePrecision("tax_expense").notNull().default(0),
    notes:             text("notes"),
    createdAt:         timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt:         timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("workspace_financials_ws_month_uidx").on(t.workspaceId, t.month),
    index("workspace_financials_ws_idx").on(t.workspaceId),
  ],
);

export const insertWorkspaceFinancialSchema = createInsertSchema(workspaceFinancials).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type WorkspaceFinancial       = typeof workspaceFinancials.$inferSelect;
export type InsertWorkspaceFinancial = z.infer<typeof insertWorkspaceFinancialSchema>;
