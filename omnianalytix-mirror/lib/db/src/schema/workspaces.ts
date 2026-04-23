import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizations } from "./organizations";

export const workspaces = pgTable("workspaces", {
  id:                  serial("id").primaryKey(),
  organizationId:      integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  clientName:          text("client_name").notNull(),
  slug:                text("slug").notNull().unique(),
  primaryGoal:         text("primary_goal"),
  enabledIntegrations: jsonb("enabled_integrations").notNull().$type<string[]>().default([]),
  selectedWorkflows:   jsonb("selected_workflows").$type<string[]>(),
  inviteToken:         text("invite_token").notNull().unique(),
  status:              text("status").notNull().default("active"),
  notes:               text("notes"),
  webhookUrl:          text("webhook_url"),
  websiteUrl:          text("website_url"),
  discoverySource:     text("discovery_source"),
  headquartersCountry: text("headquarters_country"),
  billingThreshold:    integer("billing_threshold").default(5000),
  createdAt:           timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertWorkspaceSchema = createInsertSchema(workspaces).omit({
  id: true,
  createdAt: true,
});

export type Workspace       = typeof workspaces.$inferSelect;
export type InsertWorkspace  = z.infer<typeof insertWorkspaceSchema>;
