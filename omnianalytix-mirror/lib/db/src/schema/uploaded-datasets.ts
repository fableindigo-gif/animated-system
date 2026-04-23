import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const uploadedDatasets = pgTable("uploaded_datasets", {
  id:              serial("id").primaryKey(),
  organizationId:  integer("organization_id").notNull(),
  workspaceId:     integer("workspace_id"),
  name:            text("name").notNull(),
  tableName:       text("table_name").notNull().unique(),
  columns:         jsonb("columns").notNull().$type<string[]>().default([]),
  rowCount:        integer("row_count").notNull().default(0),
  fileSize:        integer("file_size"),
  uploadedBy:      integer("uploaded_by"),
  createdAt:       timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertUploadedDatasetSchema = createInsertSchema(uploadedDatasets).omit({
  id: true,
  createdAt: true,
});

export type UploadedDataset       = typeof uploadedDatasets.$inferSelect;
export type InsertUploadedDataset = z.infer<typeof insertUploadedDatasetSchema>;
