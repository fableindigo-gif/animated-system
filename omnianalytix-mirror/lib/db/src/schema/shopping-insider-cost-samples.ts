import {
  pgTable,
  serial,
  bigint,
  doublePrecision,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/**
 * shopping_insider_cost_samples — one row per alerter tick.
 *
 * Records the per-tick window deltas emitted by the Shopping Insider cost
 * alerter so that admins can see whether BigQuery spend is creeping upward
 * or was a one-off spike, and so the alerter can use a longer baseline for
 * anomaly detection in future.
 *
 * Columns mirror the WindowStats shape computed in
 * `shopping-insider-cost-alerter.ts`.
 */
export const shoppingInsiderCostSamples = pgTable(
  "shopping_insider_cost_samples",
  {
    id: serial("id").primaryKey(),

    /** Wall-clock time this tick fired (server time, UTC). */
    sampledAt: timestamp("sampled_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    /**
     * BigQuery bytes billed within the rolling window at the time of this
     * tick. Stored as bigint (number mode) — a busy deployment could exceed
     * int4 (2 GB) over a day-long window.
     */
    bytesBilled: bigint("bytes_billed", { mode: "number" }).notNull().default(0),

    /** BigQuery bytes the cache saved within the same window. */
    bytesAvoided: bigint("bytes_avoided", { mode: "number" }).notNull().default(0),

    /** Cache hits within the rolling window. */
    hits: integer("hits").notNull().default(0),

    /** Cache misses within the rolling window. */
    misses: integer("misses").notNull().default(0),

    /**
     * Cache hit rate (hits / (hits + misses)) at tick time, or NULL when no
     * requests landed inside the window.
     */
    hitRate: doublePrecision("hit_rate"),

    /** Duration of the actual rolling window used for this sample (ms). */
    windowMs: integer("window_ms").notNull().default(0),
  },
  (t) => [
    index("shopping_insider_cost_samples_sampled_at_idx").on(t.sampledAt),
  ],
);

export type ShoppingInsiderCostSample =
  typeof shoppingInsiderCostSamples.$inferSelect;
export type InsertShoppingInsiderCostSample =
  typeof shoppingInsiderCostSamples.$inferInsert;
