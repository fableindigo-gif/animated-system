import { pgTable, serial, integer, text, doublePrecision, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const hyAdPerformance = pgTable(
  "hy_ad_performance",
  {
    id:              serial("id").primaryKey(),
    workspaceId:     integer("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    date:            text("date").notNull(),
    channel:         text("channel").notNull(),
    campaignType:    text("campaign_type").notNull().default("ecom"),
    spend:           doublePrecision("spend").notNull().default(0),
    clicks:          integer("clicks").notNull().default(0),
    totalConversions: integer("total_conversions").notNull().default(0),
  },
  (t) => ({ uniq: uniqueIndex("hy_adperf_uniq").on(t.workspaceId, t.date, t.channel, t.campaignType) }),
);

export const hyEcomSales = pgTable("hy_ecom_sales", {
  id:            serial("id").primaryKey(),
  workspaceId:   integer("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  date:          text("date").notNull(),
  orderId:       text("order_id").notNull(),
  revenue:       doublePrecision("revenue").notNull().default(0),
  cogs:          doublePrecision("cogs").notNull().default(0),
  shippingCosts: doublePrecision("shipping_costs").notNull().default(0),
});

export const hyCrmLeads = pgTable("hy_crm_leads", {
  id:                serial("id").primaryKey(),
  workspaceId:       integer("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  date:              text("date").notNull(),
  leadId:            text("lead_id").notNull(),
  leadStatus:        text("lead_status").notNull().default("Raw"),
  estimatedDealValue: doublePrecision("estimated_deal_value").notNull().default(0),
  channel:           text("channel"),
});

export const hyTargets = pgTable("hy_targets", {
  id:            serial("id").primaryKey(),
  workspaceId:   integer("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }).unique(),
  roasGoal:      doublePrecision("roas_goal").notNull().default(4.0),
  marginTarget:  doublePrecision("margin_target").notNull().default(35.0),
  cplCap:        doublePrecision("cpl_cap").notNull().default(45.0),
});

export const hySystemLogs = pgTable("hy_system_logs", {
  id:          serial("id").primaryKey(),
  workspaceId: integer("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  type:        text("type").notNull().default("System Request"),
  message:     text("message").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type HyAdPerformance = typeof hyAdPerformance.$inferSelect;
export type HyEcomSale      = typeof hyEcomSales.$inferSelect;
export type HyCrmLead       = typeof hyCrmLeads.$inferSelect;
export type HyTargets       = typeof hyTargets.$inferSelect;
export type HySystemLog     = typeof hySystemLogs.$inferSelect;
