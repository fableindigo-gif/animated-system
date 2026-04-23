/**
 * AI Google Ads Usage Guardrails (Task #159)
 *
 * Provides per-org guardrails for AI-driven Google Ads row reads:
 *   - Per-org configurable max lookback window (default 180 days)
 *   - Per-org daily cap on rows scanned (default 50 000)
 *   - Per-request budget (remaining daily capacity, capped at 5 000 rows)
 *   - Atomic-style increment (read-upsert) + cap signalling
 *   - Helper for operator-visible daily usage metrics
 */

import { db, organizations, aiGadsDailyUsage } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "./logger";

export const DEFAULT_MAX_LOOKBACK_DAYS = 180;
export const DEFAULT_DAILY_ROW_CAP     = 50_000;

/** Hard per-request row ceiling to bound cost from a single AI question. */
export const PER_REQUEST_ROW_CAP = 5_000;

/** Warn when usage hits this fraction of the daily cap. */
const WARN_THRESHOLD = 0.8;

export interface OrgGuardrails {
  maxLookbackDays: number;
  dailyRowCap:     number;
}

/**
 * Fetch the AI guardrail config for an org.
 * Falls back to platform defaults when the org record is missing or has
 * null values for the guardrail columns.
 */
export async function getOrgGuardrails(orgId: number): Promise<OrgGuardrails> {
  try {
    const [org] = await db
      .select({ aiMaxLookbackDays: organizations.aiMaxLookbackDays, aiDailyRowCap: organizations.aiDailyRowCap })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    return {
      maxLookbackDays: org?.aiMaxLookbackDays ?? DEFAULT_MAX_LOOKBACK_DAYS,
      dailyRowCap:     org?.aiDailyRowCap     ?? DEFAULT_DAILY_ROW_CAP,
    };
  } catch (err) {
    logger.warn({ err, orgId }, "[AiGadsUsage] Failed to load org guardrails; using defaults");
    return { maxLookbackDays: DEFAULT_MAX_LOOKBACK_DAYS, dailyRowCap: DEFAULT_DAILY_ROW_CAP };
  }
}

export interface UsageCheckResult {
  /** Rows read today *before* this increment. */
  rowsBefore:  number;
  /** Rows read today *after* this increment. */
  rowsAfter:   number;
  /** The daily cap for this org. */
  dailyRowCap: number;
  /**
   * True when the daily cap is now exhausted (rowsAfter >= cap).
   * Callers should stop making additional GAQL calls for this request.
   */
  capExceeded: boolean;
  /** True when rowsAfter >= WARN_THRESHOLD × dailyRowCap. */
  nearingCap:  boolean;
  /** Fraction consumed after this call (0–1+). */
  usageFraction: number;
}

/**
 * Record rows read and check whether the daily cap is now exhausted.
 *
 * ALWAYS records the rows passed in (they were already fetched from the API
 * by the time this is called), then signals capExceeded so callers can
 * short-circuit any further GAQL requests in the same tool execution.
 *
 * Pre-flight blocking (before any GAQL call) is handled separately by
 * `getTodayRowCount` + `getRequestBudget` at the start of each tool call.
 *
 * @param orgId      - Organisation to update.
 * @param rowCount   - How many rows were read in this GAQL call.
 * @param guardrails - Pre-loaded guardrails (avoids an extra DB round-trip).
 */
export async function checkAndIncrementUsage(
  orgId:      number,
  rowCount:   number,
  guardrails: OrgGuardrails,
): Promise<UsageCheckResult> {
  const today = new Date().toISOString().slice(0, 10);

  try {
    // Read current value to compute before/after.
    const [existing] = await db
      .select({ rowsRead: aiGadsDailyUsage.rowsRead })
      .from(aiGadsDailyUsage)
      .where(and(
        eq(aiGadsDailyUsage.organizationId, orgId),
        eq(aiGadsDailyUsage.usageDate, today),
      ))
      .limit(1);

    const rowsBefore = existing?.rowsRead ?? 0;

    // Always record actual rows consumed — they were fetched before this call.
    await db
      .insert(aiGadsDailyUsage)
      .values({
        organizationId: orgId,
        usageDate:      today,
        rowsRead:       rowCount,
        queryCount:     1,
        updatedAt:      new Date(),
      })
      .onConflictDoUpdate({
        target: [aiGadsDailyUsage.organizationId, aiGadsDailyUsage.usageDate],
        set: {
          rowsRead:   sql`${aiGadsDailyUsage.rowsRead} + ${rowCount}`,
          queryCount: sql`${aiGadsDailyUsage.queryCount} + 1`,
          updatedAt:  new Date(),
        },
      });

    const rowsAfter     = rowsBefore + rowCount;
    const capExceeded   = rowsAfter >= guardrails.dailyRowCap;
    const fraction      = rowsAfter / guardrails.dailyRowCap;

    if (capExceeded) {
      logger.warn({ orgId, today, rowsBefore, rowsAfter, cap: guardrails.dailyRowCap },
        "[AiGadsUsage] Daily cap reached — caller should stop further GAQL");
    } else {
      logger.info({ orgId, today, rowsBefore, rowsAfter, cap: guardrails.dailyRowCap, fraction },
        "[AiGadsUsage] Row usage incremented");
    }

    return {
      rowsBefore,
      rowsAfter,
      dailyRowCap:   guardrails.dailyRowCap,
      capExceeded,
      nearingCap:    fraction >= WARN_THRESHOLD,
      usageFraction: fraction,
    };
  } catch (err) {
    // Fail-closed: cannot safely track usage → block further GAQL calls.
    logger.error({ err, orgId }, "[AiGadsUsage] Failed to update usage counter; blocking call (fail-closed)");
    return {
      rowsBefore:    0,
      rowsAfter:     0,
      dailyRowCap:   guardrails.dailyRowCap,
      capExceeded:   true,
      nearingCap:    true,
      usageFraction: 1,
    };
  }
}

/**
 * Pre-flight: read today's row count for an org (does NOT increment).
 * Used at the start of each tool call to gate the entire execution.
 */
export async function getTodayRowCount(orgId: number): Promise<number> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [row] = await db
      .select({ rowsRead: aiGadsDailyUsage.rowsRead })
      .from(aiGadsDailyUsage)
      .where(and(
        eq(aiGadsDailyUsage.organizationId, orgId),
        eq(aiGadsDailyUsage.usageDate, today),
      ))
      .limit(1);
    return row?.rowsRead ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Per-request row budget: how many rows this single tool invocation may read.
 *
 * Computed as the lesser of:
 *  - The remaining daily capacity (cap − rowsToday), and
 *  - PER_REQUEST_ROW_CAP (a hard ceiling per question).
 *
 * Callers use this to gate individual GAQL call estimates before making them.
 */
export function getRequestBudget(rowsToday: number, guardrails: OrgGuardrails): number {
  const remaining = Math.max(0, guardrails.dailyRowCap - rowsToday);
  return Math.min(remaining, PER_REQUEST_ROW_CAP);
}

export interface DailyUsageRow {
  date:        string;
  rowsRead:    number;
  queryCount:  number;
  capPct:      number;
  dailyRowCap: number;
}

/**
 * Fetch recent daily usage rows for an org (newest first, up to `days` days).
 * Used by the operator metrics endpoint.
 */
export async function getOrgDailyUsage(
  orgId:      number,
  guardrails: OrgGuardrails,
  days        = 30,
): Promise<DailyUsageRow[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const rows = await db
    .select({
      usageDate:  aiGadsDailyUsage.usageDate,
      rowsRead:   aiGadsDailyUsage.rowsRead,
      queryCount: aiGadsDailyUsage.queryCount,
    })
    .from(aiGadsDailyUsage)
    .where(and(
      eq(aiGadsDailyUsage.organizationId, orgId),
      sql`${aiGadsDailyUsage.usageDate} >= ${cutoffDate}`,
    ))
    .orderBy(sql`${aiGadsDailyUsage.usageDate} DESC`);

  return rows.map((r) => ({
    date:        r.usageDate,
    rowsRead:    r.rowsRead,
    queryCount:  r.queryCount,
    capPct:      parseFloat(((r.rowsRead / guardrails.dailyRowCap) * 100).toFixed(1)),
    dailyRowCap: guardrails.dailyRowCap,
  }));
}
