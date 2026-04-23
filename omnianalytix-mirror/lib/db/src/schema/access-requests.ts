import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const accessRequests = pgTable("access_requests", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  workspaceId: integer("workspace_id"),
  requesterId: integer("requester_id"),
  requesterName: text("requester_name").notNull(),
  requesterEmail: text("requester_email").notNull(),
  requesterRole: text("requester_role").notNull(),
  actionLabel: text("action_label").notNull(),
  actionContext: text("action_context").notNull().default(""),
  reason: text("reason").notNull().default(""),
  status: text("status").notNull().default("pending"),
  resolvedById: integer("resolved_by_id"),
  resolvedByName: text("resolved_by_name"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("access_requests_org_id_idx").on(t.organizationId),
  index("access_requests_status_idx").on(t.status),
]);

export const insertAccessRequestSchema = createInsertSchema(accessRequests).omit({
  id: true,
  createdAt: true,
  resolvedAt: true,
  resolvedById: true,
  resolvedByName: true,
});

export type AccessRequest = typeof accessRequests.$inferSelect;
export type InsertAccessRequest = z.infer<typeof insertAccessRequestSchema>;
