import { pgTable, serial, integer, text, doublePrecision, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const ldAdPerformance = pgTable(
  "ld_ad_performance",
  {
    id:             serial("id").primaryKey(),
    workspaceId:    integer("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    date:           text("date").notNull(),
    channel:        text("channel").notNull(),
    spend:          doublePrecision("spend").notNull().default(0),
    clicks:         integer("clicks").notNull().default(0),
    impressions:    integer("impressions").notNull().default(0),
    formSubmissions: integer("form_submissions").notNull().default(0),
  },
  (t) => ({ uniq: uniqueIndex("ld_adperf_uniq").on(t.workspaceId, t.date, t.channel) }),
);

export const ldCrmLeads = pgTable("ld_crm_leads", {
  id:            serial("id").primaryKey(),
  workspaceId:   integer("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  date:          text("date").notNull(),
  leadId:        text("lead_id").notNull(),
  leadStatus:    text("lead_status").notNull().default("Raw"),
  pipelineValue: doublePrecision("pipeline_value").notNull().default(0),
  channel:       text("channel"),
});

export const ldTargets = pgTable("ld_targets", {
  id:                  serial("id").primaryKey(),
  workspaceId:         integer("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }).unique(),
  cplCap:              doublePrecision("cpl_cap").notNull().default(45),
  monthlyLeadTarget:   integer("monthly_lead_target").notNull().default(200),
  pipelineRoiTarget:   doublePrecision("pipeline_roi_target").notNull().default(5.0),
});

export const ldSystemLogs = pgTable("ld_system_logs", {
  id:          serial("id").primaryKey(),
  workspaceId: integer("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  type:        text("type").notNull().default("System Request"),
  message:     text("message").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type LdAdPerformance = typeof ldAdPerformance.$inferSelect;
export type LdCrmLead       = typeof ldCrmLeads.$inferSelect;
export type LdTargets       = typeof ldTargets.$inferSelect;
export type LdSystemLog     = typeof ldSystemLogs.$inferSelect;
