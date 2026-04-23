import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const workspaceDbCredentials = pgTable("workspace_db_credentials", {
  id:                serial("id").primaryKey(),
  workspaceId:       integer("workspace_id").notNull(),
  organizationId:    integer("organization_id").notNull(),
  dbType:            text("db_type").notNull(),
  label:             text("label"),
  host:              text("host").notNull(),
  port:              integer("port").notNull(),
  databaseName:      text("database_name").notNull(),
  username:          text("username").notNull(),
  encryptedPassword: text("encrypted_password").notNull(),
  serviceAccountKey: text("service_account_key"),
  status:            text("status").notNull().default("pending"),
  lastTestedAt:      timestamp("last_tested_at", { withTimezone: true }),
  createdAt:         timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertDbCredentialSchema = createInsertSchema(workspaceDbCredentials).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type WorkspaceDbCredential       = typeof workspaceDbCredentials.$inferSelect;
export type InsertWorkspaceDbCredential = z.infer<typeof insertDbCredentialSchema>;
