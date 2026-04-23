import { pgTable, text, timestamp, jsonb, integer, uuid, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Server-side report registry. The /api/reports/export-csv and /api/reports/share
 * endpoints look up a report by id, verify the caller's workspace owns it, and
 * generate the export from trusted server-side data sources. The browser never
 * supplies the row data — only the saved-report id and (optionally) filters.
 *
 * `definition` shape:
 *   {
 *     kind: TrustedReportKind,   // e.g. "warehouse_kpis", "warehouse_channels"
 *     filters?: Record<string, unknown>,
 *     title?: string,            // optional display title carried into exports
 *   }
 */
export const savedReports = pgTable(
  "saved_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: integer("workspace_id").notNull(),
    createdBy: integer("created_by"),
    definition: jsonb("definition").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("saved_reports_workspace_idx").on(t.workspaceId)],
);

export const insertSavedReportSchema = createInsertSchema(savedReports).omit({
  id: true,
  createdAt: true,
});

export type SavedReport = typeof savedReports.$inferSelect;
export type InsertSavedReport = z.infer<typeof insertSavedReportSchema>;

/**
 * Discriminator for the trusted server-side data source the report draws from.
 * New dashboards register a new kind here, then add a corresponding fetcher in
 * `routes/reports/index.ts#fetchTrustedReportRows`.
 */
export const TRUSTED_REPORT_KINDS = ["warehouse_kpis", "warehouse_channels"] as const;
export type TrustedReportKind = (typeof TRUSTED_REPORT_KINDS)[number];

export const savedReportDefinitionSchema = z.object({
  kind: z.enum(TRUSTED_REPORT_KINDS),
  filters: z.record(z.string(), z.unknown()).optional(),
  title: z.string().max(200).optional(),
});

export type SavedReportDefinition = z.infer<typeof savedReportDefinitionSchema>;
