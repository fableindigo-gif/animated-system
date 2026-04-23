/**
 * VAG 2 Tests — Remediation Agent
 *
 * Covers:
 *   • isInventoryMarginLeak correctly identifies qualifying alerts
 *   • isInventoryMarginLeak returns false for non-Inventory alerts
 *   • proposeRemediationTask inserts into proposed_tasks with PENDING status
 *   • proposeRemediationTask is idempotent (duplicate pending task → skips insert)
 *   • Triage emitter listener: Inventory alert → remediation task proposed
 *   • Triage emitter listener: non-Inventory alert → no task proposed
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockInsertReturning = vi.fn().mockResolvedValue([{ id: 77 }]);
const mockInsertValues = vi.fn(() => ({ returning: mockInsertReturning }));
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

const mockSelectLimit = vi.fn().mockResolvedValue([]);
const mockSelectWhere = vi.fn(() => ({ limit: mockSelectLimit }));
const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => mockSelect(),
    insert: () => mockInsert(),
  },
  proposedTasks: {
    id: "id",
    idempotencyKey: "idempotencyKey",
    status: "status",
  },
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
  isInventoryMarginLeak,
  proposeRemediationTask,
  startRemediationAgent,
  stopRemediationAgent,
  type RemediationPayload,
} from "../services/remediation-agent";
import { emitTriageAlert } from "../lib/triage-emitter";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAlert(overrides: Partial<{
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  platform: string;
  detail: string;
  action: string;
  ts: string;
}> = {}) {
  return {
    id: "alert-001",
    severity: "critical" as const,
    title: "Margin Leak: 3 active ads wasting spend on out-of-stock SKUs",
    detail: "$450 wasted on zero-inventory products",
    platform: "Inventory · SA360",
    action: "Pause ads on zero-inventory SKUs immediately to stop margin bleed",
    ts: new Date().toISOString(),
    ...overrides,
  };
}

const REMEDIATION_PAYLOAD: RemediationPayload = {
  action: "pause_ads_on_oos_skus",
  alertId: "alert-001",
  platform: "Inventory · SA360",
  detail: "$450 wasted on zero-inventory products",
  suggestedAction: "Pause ads on zero-inventory SKUs immediately",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("VAG 2 — Remediation Agent", () => {

  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectLimit.mockResolvedValue([]);
    mockInsertReturning.mockResolvedValue([{ id: 77 }]);
    stopRemediationAgent();
  });

  afterEach(() => {
    stopRemediationAgent();
  });

  describe("isInventoryMarginLeak (alert classifier)", () => {
    it("returns true for an alert with Inventory platform prefix", () => {
      expect(isInventoryMarginLeak(makeAlert({ platform: "Inventory · SA360" }))).toBe(true);
    });

    it("returns true for an alert with 'out-of-stock' in the title", () => {
      expect(
        isInventoryMarginLeak(
          makeAlert({ platform: "Google Ads", title: "3 ads running on out-of-stock products" }),
        ),
      ).toBe(true);
    });

    it("returns true for an alert with 'margin leak' in the title", () => {
      expect(
        isInventoryMarginLeak(
          makeAlert({ platform: "Google Ads", title: "Margin Leak: zero inventory SKUs" }),
        ),
      ).toBe(true);
    });

    it("returns false for a warning-severity inventory alert (only critical triggers remediation)", () => {
      expect(isInventoryMarginLeak(makeAlert({ severity: "warning" }))).toBe(false);
    });

    it("returns false for a budget-related critical alert", () => {
      expect(
        isInventoryMarginLeak(
          makeAlert({
            platform: "Google Ads",
            title: "Campaign losing 55% impressions to budget cap",
          }),
        ),
      ).toBe(false);
    });

    it("returns false when alert is undefined", () => {
      expect(isInventoryMarginLeak(undefined)).toBe(false);
    });
  });

  describe("proposeRemediationTask", () => {
    it("inserts a new proposed task and returns its id with duplicate:false", async () => {
      mockSelectLimit.mockResolvedValueOnce([]);

      const result = await proposeRemediationTask("alert-001", REMEDIATION_PAYLOAD);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(77);
      expect(result?.duplicate).toBe(false);
    });

    it("is idempotent — skips insert when identical pending task already exists", async () => {
      mockSelectLimit.mockResolvedValueOnce([{ id: 55 }]);

      const result = await proposeRemediationTask("alert-001", REMEDIATION_PAYLOAD);

      expect(result?.id).toBe(55);
      expect(result?.duplicate).toBe(true);
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it("returns null (not throws) when DB insert fails", async () => {
      mockSelectLimit.mockResolvedValueOnce([]);
      mockInsertReturning.mockRejectedValueOnce(new Error("DB connection lost"));

      const result = await proposeRemediationTask("alert-001", REMEDIATION_PAYLOAD);
      expect(result).toBeNull();
    });

    it("sets status to PENDING_HUMAN_REVIEW (status field = 'pending') in the inserted row", async () => {
      mockSelectLimit.mockResolvedValueOnce([]);

      await proposeRemediationTask("alert-001", REMEDIATION_PAYLOAD);

      const insertedValues = (mockInsertValues.mock.calls as unknown as unknown[][])[0]?.[0] as Record<string, unknown>;
      expect(insertedValues.status).toBe("pending");
      expect(insertedValues.toolName).toBe("pause_ads_on_oos_skus");
      expect(insertedValues.proposedByName).toBe("Live Triage Agent");
    });
  });

  describe("Triage emitter integration", () => {
    it("proposes a remediation task when an Inventory critical alert is emitted", async () => {
      startRemediationAgent();

      emitTriageAlert(makeAlert());

      // Allow async handler to settle
      await new Promise((r) => setTimeout(r, 20));

      expect(mockInsert).toHaveBeenCalled();
    });

    it("does NOT propose a task for a non-Inventory critical alert", async () => {
      startRemediationAgent();

      emitTriageAlert(
        makeAlert({
          platform: "Google Ads",
          title: "Campaign over daily budget cap",
        }),
      );

      await new Promise((r) => setTimeout(r, 20));

      expect(mockInsert).not.toHaveBeenCalled();
    });

    it("does NOT propose a task for a warning-severity Inventory alert", async () => {
      startRemediationAgent();

      emitTriageAlert(makeAlert({ severity: "warning" }));

      await new Promise((r) => setTimeout(r, 20));

      expect(mockInsert).not.toHaveBeenCalled();
    });
  });
});
