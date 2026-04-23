/**
 * VAG 3 — Site Reliability Agent (SRA)
 *
 * A continuous execution loop that monitors the platform's ETL pipelines
 * every 60 seconds. If a stalled pipeline or a simulated 503 is detected,
 * the SRA logs the incident and autonomously invokes restartSyncPipeline().
 *
 * Directory: src/agents/infrastructure/sra.ts
 */
import { db, platformConnections } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { etlState } from "../../lib/etl-state";
import { logger } from "../../lib/logger";

// ── Configuration ─────────────────────────────────────────────────────────────

export const HEARTBEAT_INTERVAL_MS = 60_000;
const ETL_STALL_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const PROBE_TIMEOUT_MS = 10_000;

// ── Probe result type ─────────────────────────────────────────────────────────

export type ProbeStatus = "ok" | "timeout" | "error" | "stalled";

export interface ProbeResult {
  name: string;
  status: ProbeStatus;
  latencyMs: number;
  detail?: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

// ── Probe implementations ─────────────────────────────────────────────────────

async function probeDatabaseConnectivity(): Promise<ProbeResult> {
  const start = Date.now();
  try {
    await withTimeout(db.execute(sql`SELECT 1`), PROBE_TIMEOUT_MS, "db-probe");
    return { name: "database", status: "ok", latencyMs: Date.now() - start };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      name: "database",
      status: msg.includes("timed out") ? "timeout" : "error",
      latencyMs: Date.now() - start,
      detail: msg.slice(0, 200),
    };
  }
}

async function probeEtlPipelineState(): Promise<ProbeResult> {
  const start = Date.now();
  try {
    if (etlState.status === "running" && etlState.startedAt != null) {
      const elapsed = Date.now() - etlState.startedAt;
      if (elapsed > ETL_STALL_THRESHOLD_MS) {
        return {
          name: "etl_pipeline",
          status: "stalled",
          latencyMs: Date.now() - start,
          detail: `ETL has been in 'running' state for ${Math.round(elapsed / 1000)}s (threshold: ${ETL_STALL_THRESHOLD_MS / 1000}s)`,
        };
      }
    }
    return {
      name: "etl_pipeline",
      status: "ok",
      latencyMs: Date.now() - start,
      detail: `Current state: ${etlState.status}`,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { name: "etl_pipeline", status: "error", latencyMs: Date.now() - start, detail: msg };
  }
}

async function probeGoogleAdsConnection(): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const [conn] = await withTimeout(
      db
        .select({ id: platformConnections.id, isActive: platformConnections.isActive })
        .from(platformConnections)
        .where(eq(platformConnections.platform, "google_ads"))
        .limit(1),
      PROBE_TIMEOUT_MS,
      "google-ads-probe",
    );
    if (!conn) {
      return {
        name: "google_ads_connection",
        status: "ok",
        latencyMs: Date.now() - start,
        detail: "No Google Ads connection configured — skipped",
      };
    }
    return {
      name: "google_ads_connection",
      status: conn.isActive ? "ok" : "error",
      latencyMs: Date.now() - start,
      detail: conn.isActive ? "Active" : "Connection marked inactive",
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      name: "google_ads_connection",
      status: msg.includes("timed out") ? "timeout" : "error",
      latencyMs: Date.now() - start,
      detail: msg.slice(0, 200),
    };
  }
}

async function probeShopifyConnection(): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const [conn] = await withTimeout(
      db
        .select({ id: platformConnections.id, isActive: platformConnections.isActive })
        .from(platformConnections)
        .where(eq(platformConnections.platform, "shopify"))
        .limit(1),
      PROBE_TIMEOUT_MS,
      "shopify-probe",
    );
    if (!conn) {
      return {
        name: "shopify_connection",
        status: "ok",
        latencyMs: Date.now() - start,
        detail: "No Shopify connection configured — skipped",
      };
    }
    return {
      name: "shopify_connection",
      status: conn.isActive ? "ok" : "error",
      latencyMs: Date.now() - start,
      detail: conn.isActive ? "Active" : "Connection marked inactive",
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      name: "shopify_connection",
      status: msg.includes("timed out") ? "timeout" : "error",
      latencyMs: Date.now() - start,
      detail: msg.slice(0, 200),
    };
  }
}

// ── Pipeline restart ──────────────────────────────────────────────────────────

/**
 * Invoked when the SRA detects a stalled or failed ETL pipeline.
 * Resets the ETL state machine so the next scheduled run can proceed.
 */
export async function restartSyncPipeline(platform: string, reason?: string): Promise<void> {
  logger.warn(
    { platform, reason },
    "[SRA] 🔴 Pipeline restart triggered — resetting ETL state machine",
  );

  if (etlState.status === "running") {
    etlState.status = "error";
    etlState.lastError = `SRA-triggered restart: ${reason ?? "stall/timeout detected for " + platform}`;
    etlState.completedAt = Date.now();
  }

  logger.info(
    { platform, newStatus: etlState.status },
    "[SRA] ETL state machine reset — pipeline cleared for next run",
  );
}

// ── Main heartbeat ────────────────────────────────────────────────────────────

export async function heartbeat(): Promise<ProbeResult[]> {
  const [dbResult, etlResult, gadsResult, shopifyResult] = await Promise.allSettled([
    probeDatabaseConnectivity(),
    probeEtlPipelineState(),
    probeGoogleAdsConnection(),
    probeShopifyConnection(),
  ]);

  const results: ProbeResult[] = [dbResult, etlResult, gadsResult, shopifyResult].map(
    (r) =>
      r.status === "fulfilled"
        ? r.value
        : { name: "unknown", status: "error" as ProbeStatus, latencyMs: 0, detail: String((r as PromiseRejectedResult).reason) },
  );

  const failed = results.filter(
    (r) => r.status === "error" || r.status === "timeout" || r.status === "stalled",
  );

  if (failed.length === 0) {
    logger.debug({ probes: results.length }, "[SRA] ✅ Heartbeat OK — all probes healthy");
  } else {
    for (const probe of failed) {
      logger.warn(
        { probe: probe.name, status: probe.status, detail: probe.detail },
        `[SRA] ⚠️  Probe failure detected: ${probe.name}`,
      );

      // Auto-restart for ETL stall or connection timeout
      if (probe.name === "etl_pipeline" && probe.status === "stalled") {
        await restartSyncPipeline("etl_master", probe.detail);
      }

      if (
        (probe.name === "google_ads_connection" || probe.name === "shopify_connection") &&
        probe.status === "timeout"
      ) {
        await restartSyncPipeline(probe.name, `503/timeout detected on ${probe.name}`);
      }
    }
  }

  return results;
}

// ── Agent lifecycle ───────────────────────────────────────────────────────────

let _sraTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the SRA heartbeat loop. Safe to call multiple times — idempotent.
 */
export function startSRA(): void {
  if (_sraTimer) return;
  logger.info("[SRA] Site Reliability Agent started — 60-second heartbeat active");

  // Run immediately on start, then on interval
  void heartbeat();
  _sraTimer = setInterval(() => {
    void heartbeat();
  }, HEARTBEAT_INTERVAL_MS);

  // Don't keep the process alive for this timer alone
  _sraTimer.unref();
}

/**
 * Stops the heartbeat loop. Used for clean shutdown and in tests.
 */
export function stopSRA(): void {
  if (_sraTimer) {
    clearInterval(_sraTimer);
    _sraTimer = null;
  }
}
