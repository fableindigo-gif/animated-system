import {
  pgTable,
  serial,
  integer,
  text,
  doublePrecision,
  timestamp,
  date,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * fx_rates
 *
 * Daily foreign-exchange rates cache. We always store rates with `base = 'USD'`
 * because every numeric value in the OmniAnalytix warehouse is denominated
 * in USD. Storing per-day means historical KPI windows convert at the rate
 * that was in effect on the period end (not today's rate), which is what
 * finance teams expect.
 *
 * Source examples:
 *   - "exchangerate.host"  (free, default)
 *   - "openexchangerates"  (paid, more granular)
 *   - "manual"             (operator hot-fix)
 *
 * Uniqueness: (base, quote, rateDate). Re-fetches upsert by (base,quote,rateDate).
 */
export const fxRates = pgTable(
  "fx_rates",
  {
    id:        serial("id").primaryKey(),
    base:      text("base").notNull().default("USD"),
    quote:     text("quote").notNull(),
    rateDate:  date("rate_date").notNull(),
    rate:      doublePrecision("rate").notNull(),
    source:    text("source").notNull().default("exchangerate.host"),
    fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fx_rates_base_quote_date_idx").on(t.base, t.quote, t.rateDate),
    index("fx_rates_quote_date_idx").on(t.quote, t.rateDate),
  ],
);

export const insertFxRateSchema = createInsertSchema(fxRates).omit({ id: true, fetchedAt: true });
export type InsertFxRate = z.infer<typeof insertFxRateSchema>;
export type FxRate       = typeof fxRates.$inferSelect;

/**
 * fx_overrides
 *
 * Per-workspace operator override. A finance team that wants the dashboard
 * to match their internal books can pin a fixed (base=USD, quote=X) rate
 * that supersedes the daily provider value for ALL date windows. Set to
 * null/delete to fall back to the daily cache.
 */
export const fxOverrides = pgTable(
  "fx_overrides",
  {
    id:           serial("id").primaryKey(),
    workspaceId:  integer("workspace_id").notNull(),
    base:         text("base").notNull().default("USD"),
    quote:        text("quote").notNull(),
    rate:         doublePrecision("rate").notNull(),
    note:         text("note"),
    createdAt:    timestamp("created_at").notNull().defaultNow(),
    updatedAt:    timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fx_overrides_ws_base_quote_idx").on(t.workspaceId, t.base, t.quote),
  ],
);

export const insertFxOverrideSchema = createInsertSchema(fxOverrides).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFxOverride = z.infer<typeof insertFxOverrideSchema>;
export type FxOverride       = typeof fxOverrides.$inferSelect;
