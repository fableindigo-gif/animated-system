import { pgTable, serial, integer, text, doublePrecision, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const biAdPerformance = pgTable(
  "bi_ad_performance",
  {
    id:          serial("id").primaryKey(),
    workspaceId: integer("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    date:        text("date").notNull(),
    channel:     text("channel").notNull(),
    spend:       doublePrecision("spend").notNull().default(0),
    clicks:      integer("clicks").notNull().default(0),
    conversions: integer("conversions").notNull().default(0),
    revenue:     doublePrecision("revenue").notNull().default(0),
  },
  (t) => ({ uniq: uniqueIndex("bi_adperf_uniq").on(t.workspaceId, t.date, t.channel) }),
);

export const biStoreMetrics = pgTable(
  "bi_store_metrics",
  {
    id:            serial("id").primaryKey(),
    workspaceId:   integer("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    date:          text("date").notNull(),
    totalRevenue:  doublePrecision("total_revenue").notNull().default(0),
    cogs:          doublePrecision("cogs").notNull().default(0),
    shippingCosts: doublePrecision("shipping_costs").notNull().default(0),
  },
  (t) => ({ uniq: uniqueIndex("bi_store_uniq").on(t.workspaceId, t.date) }),
);

export const biTargets = pgTable("bi_targets", {
  id:           serial("id").primaryKey(),
  workspaceId:  integer("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }).unique(),
  roasTarget:   doublePrecision("roas_target").notNull().default(4.0),
  marginTarget: doublePrecision("margin_target").notNull().default(35),
  cplCap:       doublePrecision("cpl_cap").notNull().default(45),
});

export const biSystemLogs = pgTable("bi_system_logs", {
  id:          serial("id").primaryKey(),
  workspaceId: integer("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  type:        text("type").notNull().default("System Request"),
  message:     text("message").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type BiAdPerformance  = typeof biAdPerformance.$inferSelect;
export type BiStoreMetrics   = typeof biStoreMetrics.$inferSelect;
export type BiTargets        = typeof biTargets.$inferSelect;
export type BiSystemLog      = typeof biSystemLogs.$inferSelect;
