import { pgTable, serial, integer, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const teamMembers = pgTable("team_members", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  workspaceId: integer("workspace_id"),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull().default("analyst"),
  inviteCode: text("invite_code").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  hasCompletedTour: boolean("has_completed_tour").notNull().default(false),
  agencySetupComplete: boolean("agency_setup_complete").notNull().default(false),
  invitePending: boolean("invite_pending").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("team_members_org_id_idx").on(t.organizationId),
  index("team_members_email_idx").on(t.email),
  index("team_members_workspace_id_idx").on(t.workspaceId),
]);

export const insertTeamMemberSchema = createInsertSchema(teamMembers).omit({
  id: true,
  createdAt: true,
});

export type TeamMember = typeof teamMembers.$inferSelect;
export type InsertTeamMember = z.infer<typeof insertTeamMemberSchema>;

export const ROLES = ["viewer", "analyst", "it", "manager", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  viewer: "Client Viewer",
  analyst: "Media Buyer",
  it: "IT Architect",
  manager: "Account Director",
  admin: "Agency Principal",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  viewer: "Read-only access — can view all data but cannot approve or execute any actions",
  analyst: "Can view data and approve low-impact informational actions only",
  it: "Manages API connections, OAuth integrations, and data warehouse syncs. Restricted from altering campaign budgets.",
  manager: "Can approve medium-impact actions including bid and budget adjustments up to $5k",
  admin: "Full access — can approve all actions including large budget changes and campaign management",
};
