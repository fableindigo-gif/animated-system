/**
 * DrizzleSessionService — persistent ADK session service backed by PostgreSQL via Drizzle.
 *
 * Implements BaseSessionService so it can be dropped into any ADK Runner in place of
 * InMemorySessionService. Session events (full conversation history) are stored as
 * JSONB in the adk_sessions table.
 *
 * TTL: sessions not updated within SESSION_TTL_DAYS are deleted automatically.
 */

import { BaseSessionService } from "@google/adk";
import type { Session, Event } from "@google/adk";
import { randomUUID } from "crypto";
import { eq, and, lt, sql } from "drizzle-orm";
import { db, adkSessions } from "@workspace/db";
import { logger } from "../logger";

const SESSION_TTL_DAYS = Number(process.env.ADK_SESSION_TTL_DAYS ?? 7);

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowMs(): number {
  return Date.now();
}

function ttlCutoff(): Date {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SESSION_TTL_DAYS);
  return cutoff;
}

function rowToSession(row: typeof adkSessions.$inferSelect): Session {
  return {
    id:             row.id,
    appName:        row.appName,
    userId:         row.userId,
    state:          (row.state as Record<string, unknown>) ?? {},
    events:         (row.events as Event[]) ?? [],
    lastUpdateTime: row.updatedAt.getTime(),
  } as unknown as Session;
}

// ── DrizzleSessionService ────────────────────────────────────────────────────

export class DrizzleSessionService extends BaseSessionService {

  async createSession(params: {
    appName:   string;
    userId:    string;
    state?:    Record<string, unknown>;
    sessionId?: string;
  }): Promise<Session> {
    const id        = params.sessionId ?? randomUUID();
    const now       = new Date();
    const stateData = params.state ?? {};

    await db.insert(adkSessions).values({
      id,
      appName:   params.appName,
      userId:    params.userId,
      state:     stateData,
      events:    [],
      createdAt: now,
      updatedAt: now,
    });

    logger.debug({ sessionId: id, appName: params.appName, userId: params.userId }, "[DrizzleSessionService] Session created");

    return {
      id,
      appName:        params.appName,
      userId:         params.userId,
      state:          stateData,
      events:         [],
      lastUpdateTime: now.getTime(),
    } as unknown as Session;
  }

  async getSession(params: {
    appName:   string;
    userId:    string;
    sessionId: string;
    config?:   { numRecentEvents?: number; afterTimestamp?: number };
  }): Promise<Session | undefined> {
    const [row] = await db
      .select()
      .from(adkSessions)
      .where(
        and(
          eq(adkSessions.id,      params.sessionId),
          eq(adkSessions.appName, params.appName),
          eq(adkSessions.userId,  params.userId),
        ),
      )
      .limit(1);

    if (!row) return undefined;

    const session = rowToSession(row);

    // Apply numRecentEvents filter if requested
    if (params.config?.numRecentEvents !== undefined) {
      const events = session.events as Event[];
      (session as unknown as { events: Event[] }).events = events.slice(-params.config.numRecentEvents);
    }

    // Apply afterTimestamp filter if requested
    if (params.config?.afterTimestamp !== undefined) {
      const after = params.config.afterTimestamp;
      const events = session.events as Event[];
      (session as unknown as { events: Event[] }).events = events.filter(
        (e) => ((e as unknown as Record<string, unknown>).timestamp as number ?? 0) > after,
      );
    }

    return session;
  }

  async listSessions(params: {
    appName: string;
    userId:  string;
  }): Promise<{ sessions: Session[] }> {
    const rows = await db
      .select()
      .from(adkSessions)
      .where(
        and(
          eq(adkSessions.appName, params.appName),
          eq(adkSessions.userId,  params.userId),
        ),
      );

    return { sessions: rows.map(rowToSession) };
  }

  async deleteSession(params: {
    appName:   string;
    userId:    string;
    sessionId: string;
  }): Promise<void> {
    await db
      .delete(adkSessions)
      .where(
        and(
          eq(adkSessions.id,      params.sessionId),
          eq(adkSessions.appName, params.appName),
          eq(adkSessions.userId,  params.userId),
        ),
      );

    logger.debug({ sessionId: params.sessionId }, "[DrizzleSessionService] Session deleted");
  }

  async appendEvent({ session, event }: { session: Session; event: Event }): Promise<Event> {
    const sessionAny = session as unknown as {
      id: string; appName: string; userId: string; events: Event[];
    };

    // Atomic JSONB array append — avoids read-modify-write race conditions.
    // The || operator in Postgres appends a single JSON element to the array
    // within the UPDATE, so concurrent calls cannot interleave and drop events.
    await db
      .update(adkSessions)
      .set({
        events:    sql`${adkSessions.events} || ${JSON.stringify(event)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(adkSessions.id,      sessionAny.id),
          eq(adkSessions.appName, sessionAny.appName),
          eq(adkSessions.userId,  sessionAny.userId),
        ),
      );

    // Keep in-memory view consistent (ADK relies on this for the current request)
    sessionAny.events.push(event);

    return event;
  }

  /**
   * Delete sessions not updated within SESSION_TTL_DAYS.
   * Call this periodically (e.g. via setInterval) to keep the table clean.
   */
  async cleanupExpiredSessions(): Promise<number> {
    const cutoff = ttlCutoff();
    const result = await db
      .delete(adkSessions)
      .where(lt(adkSessions.updatedAt, cutoff))
      .returning({ id: adkSessions.id });

    const count = result.length;
    if (count > 0) {
      logger.info({ count, cutoffDays: SESSION_TTL_DAYS }, "[DrizzleSessionService] Expired sessions cleaned up");
    }
    return count;
  }
}

// ── Singleton instance ────────────────────────────────────────────────────────

export const drizzleSessionService = new DrizzleSessionService();

// ── TTL cleanup background job ────────────────────────────────────────────────

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // every hour
let _cleanupStarted = false;

export function startSessionCleanup(): void {
  if (_cleanupStarted) return;
  _cleanupStarted = true;

  const handle = setInterval(async () => {
    try {
      await drizzleSessionService.cleanupExpiredSessions();
    } catch (err) {
      logger.error({ err }, "[DrizzleSessionService] TTL cleanup error");
    }
  }, CLEANUP_INTERVAL_MS);

  // Don't hold the process open for the timer alone
  if (handle.unref) handle.unref();

  logger.info(
    { ttlDays: SESSION_TTL_DAYS, intervalHours: CLEANUP_INTERVAL_MS / 3600000 },
    "[DrizzleSessionService] TTL cleanup job scheduled",
  );
}
