/**
 * Google Workspace Background Health Scheduler
 * =============================================
 * Runs a periodic probe (every 2 hours by default) for every organization
 * that has at least one active Google Workspace connection. Results are stored
 * in memory so the cached-health endpoint can serve them instantly without
 * performing a live token refresh on every request.
 *
 * The scheduler intentionally runs *across all organizations* — not just the
 * one in the current HTTP request — so connections that go stale while a user
 * is on a different page are flagged without requiring a page reload or a
 * manual visit to the Connections screen.
 */

import { db, platformConnections } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import {
  WORKSPACE_PLATFORMS,
  probeGoogleConnectionHealth,
  type GoogleConnectionHealth,
  type WorkspacePlatform,
} from "../lib/google-workspace-oauth";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WorkspaceHealthSnapshot {
  checkedAt: string;
  platforms: Record<WorkspacePlatform, GoogleConnectionHealth>;
}

// ─── In-memory result store ───────────────────────────────────────────────────
// Keyed by organizationId (null = no-org / default tenant).
const _cache = new Map<number | null, WorkspaceHealthSnapshot>();

export function getLastWorkspaceHealthForOrg(
  organizationId: number | null,
): WorkspaceHealthSnapshot | null {
  return _cache.get(organizationId) ?? null;
}

// ─── Core probe logic ─────────────────────────────────────────────────────────

async function probeOrg(orgId: number | null): Promise<void> {
  const entries = await Promise.all(
    WORKSPACE_PLATFORMS.map(async (platform) => {
      const health = await probeGoogleConnectionHealth(platform, orgId);
      return [platform, health] as const;
    }),
  );

  const platforms = Object.fromEntries(entries) as Record<
    WorkspacePlatform,
    GoogleConnectionHealth
  >;

  const stalePlatforms = Object.entries(platforms)
    .filter(([, h]) => h.status === "needs_reconnect")
    .map(([p]) => p);

  if (stalePlatforms.length > 0) {
    logger.warn(
      { orgId, stalePlatforms },
      "[WorkspaceHealthScheduler] Stale Google Workspace connections detected",
    );
  }

  _cache.set(orgId, {
    checkedAt: new Date().toISOString(),
    platforms,
  });
}

async function runScheduledProbe(): Promise<void> {
  logger.info("[WorkspaceHealthScheduler] Starting background health probe…");

  // Find every distinct organization that has at least one active Workspace
  // connection. We include the null-org tenant (single-tenant installs).
  const rows = await db
    .select({ organizationId: platformConnections.organizationId })
    .from(platformConnections)
    .where(inArray(platformConnections.platform, WORKSPACE_PLATFORMS as unknown as string[]));

  const orgIds = new Set<number | null>(rows.map((r) => r.organizationId));
  if (orgIds.size === 0) {
    logger.debug("[WorkspaceHealthScheduler] No Workspace connections found — skipping");
    return;
  }

  const results = await Promise.allSettled(
    [...orgIds].map((orgId) => probeOrg(orgId)),
  );

  const failed = results.filter((r) => r.status === "rejected").length;
  logger.info(
    { total: orgIds.size, failed },
    "[WorkspaceHealthScheduler] Background probe complete",
  );
}

// ─── Scheduler entry point ────────────────────────────────────────────────────

const PROBE_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours
const INITIAL_DELAY_MS  = 30_000;              // 30 s after startup

export function startWorkspaceHealthScheduler(): void {
  // First run shortly after boot so fresh results are available quickly.
  setTimeout(() => {
    runScheduledProbe().catch((err) =>
      logger.warn({ err }, "[WorkspaceHealthScheduler] Initial probe failed (non-fatal)"),
    );
  }, INITIAL_DELAY_MS);

  const timer = setInterval(() => {
    runScheduledProbe().catch((err) =>
      logger.warn({ err }, "[WorkspaceHealthScheduler] Scheduled probe failed (non-fatal)"),
    );
  }, PROBE_INTERVAL_MS);

  timer.unref();

  logger.info(
    { intervalMs: PROBE_INTERVAL_MS, initialDelayMs: INITIAL_DELAY_MS },
    "[WorkspaceHealthScheduler] Started",
  );
}
