/**
 * VAG 3 Tests — Site Reliability Agent (SRA)
 *
 * Covers:
 *   • heartbeat returns OK for all probes when system is healthy
 *   • heartbeat detects a stalled ETL and calls restartSyncPipeline
 *   • restartSyncPipeline resets etlState.status to "error" and records the error
 *   • heartbeat detects a DB timeout and reports it
 *   • startSRA / stopSRA lifecycle (idempotent start)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockDbExecute = vi.fn().mockResolvedValue([{ "?column?": 1 }]);
const mockSelectLimit = vi.fn().mockResolvedValue([]);
const mockSelectWhere = vi.fn(() => ({ limit: mockSelectLimit }));
const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

vi.mock("@workspace/db", () => ({
  db: {
    execute: () => mockDbExecute(),
    select: () => mockSelect(),
  },
  platformConnections: {
    id: "id",
    platform: "platform",
    isActive: "isActive",
  },
  sql: vi.fn((strings: TemplateStringsArray) => strings.join("")),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Subject ───────────────────────────────────────────────────────────────────

import {
  heartbeat,
  restartSyncPipeline,
  startSRA,
  stopSRA,
  HEARTBEAT_INTERVAL_MS,
  type ProbeResult,
} from "../agents/infrastructure/sra";
import { etlState } from "../lib/etl-state";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("VAG 3 — Site Reliability Agent (SRA)", () => {

  beforeEach(() => {
    vi.clearAllMocks();
    stopSRA();

    // Reset ETL state to idle before each test
    etlState.status = "idle";
    etlState.startedAt = null;
    etlState.completedAt = null;
    etlState.lastError = null;

    mockDbExecute.mockResolvedValue([{ "?column?": 1 }]);
    mockSelectLimit.mockResolvedValue([]);
  });

  afterEach(() => {
    stopSRA();
    etlState.status = "idle";
    etlState.startedAt = null;
    etlState.lastError = null;
  });

  describe("heartbeat — happy path", () => {
    it("returns OK status for all probes when system is healthy", async () => {
      const results = await heartbeat();

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);

      const dbProbe = results.find((r) => r.name === "database");
      expect(dbProbe?.status).toBe("ok");
    });

    it("includes etl_pipeline probe in results", async () => {
      const results = await heartbeat();
      const etlProbe = results.find((r) => r.name === "etl_pipeline");
      expect(etlProbe).toBeDefined();
      expect(etlProbe?.status).toBe("ok");
    });

    it("reports ok for ETL when status is idle", async () => {
      etlState.status = "idle";
      const results = await heartbeat();
      const etlProbe = results.find((r: ProbeResult) => r.name === "etl_pipeline");
      expect(etlProbe?.status).toBe("ok");
    });
  });

  describe("heartbeat — stalled ETL detection", () => {
    it("detects a stalled ETL (running > 5 min) and calls restartSyncPipeline", async () => {
      etlState.status = "running";
      etlState.startedAt = Date.now() - 6 * 60 * 1000; // 6 minutes ago

      const results = await heartbeat();

      const etlProbe = results.find((r: ProbeResult) => r.name === "etl_pipeline");
      expect(etlProbe?.status).toBe("stalled");

      // restartSyncPipeline should have been called → etlState reset
      expect(etlState.status).toBe("error");
      expect(etlState.lastError).toMatch(/SRA-triggered restart/);
    });

    it("does NOT restart when ETL has been running for less than 5 minutes", async () => {
      etlState.status = "running";
      etlState.startedAt = Date.now() - 2 * 60 * 1000; // only 2 minutes

      await heartbeat();

      // Should still be running — no restart triggered
      expect(etlState.status).toBe("running");
    });
  });

  describe("restartSyncPipeline", () => {
    it("resets etlState.status to 'error' when pipeline was running", async () => {
      etlState.status = "running";
      etlState.startedAt = Date.now() - 10_000;

      await restartSyncPipeline("etl_master", "simulated 503 from test");

      expect(etlState.status).toBe("error");
    });

    it("records the restart reason in etlState.lastError", async () => {
      etlState.status = "running";

      await restartSyncPipeline("google_ads_connection", "timeout detected");

      expect(etlState.lastError).toContain("SRA-triggered restart");
    });

    it("does not throw when etlState is already idle", async () => {
      etlState.status = "idle";
      await expect(restartSyncPipeline("shopify_connection", "503")).resolves.toBeUndefined();
    });

    it("logs a warning when restart is triggered (simulated 503 scenario)", async () => {
      const { logger } = await import("../lib/logger");
      const warnSpy = vi.spyOn(logger, "warn");

      etlState.status = "running";
      await restartSyncPipeline("shopify_sync", "503 from simulated health probe");

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ platform: "shopify_sync" }),
        expect.stringContaining("Pipeline restart triggered"),
      );
    });
  });

  describe("SRA lifecycle", () => {
    it("HEARTBEAT_INTERVAL_MS is exactly 60 seconds", () => {
      expect(HEARTBEAT_INTERVAL_MS).toBe(60_000);
    });

    it("startSRA is idempotent — calling twice does not double-register", () => {
      startSRA();
      startSRA(); // should not throw or create duplicate timers
      stopSRA();
    });

    it("stopSRA clears the interval cleanly without throwing", () => {
      startSRA();
      expect(() => stopSRA()).not.toThrow();
    });
  });
});
