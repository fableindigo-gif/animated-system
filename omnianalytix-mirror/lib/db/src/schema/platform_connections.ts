import { pgTable, serial, integer, text, timestamp, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const platformConnections = pgTable("platform_connections", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  platform: text("platform").notNull(),
  displayName: text("display_name").notNull(),
  credentials: jsonb("credentials").notNull().$type<Record<string, string>>(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("platform_connections_org_id_idx").on(t.organizationId),
  index("platform_connections_platform_idx").on(t.platform),
]);

export const insertPlatformConnectionSchema = createInsertSchema(platformConnections).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type PlatformConnection = typeof platformConnections.$inferSelect;
export type InsertPlatformConnection = z.infer<typeof insertPlatformConnectionSchema>;
