/**
 * Verifies that `recordInfraAlert` and `resolveInfraAlert` produce alert
 * notifications only on transitions — repeated calls against an
 * already-active alert MUST NOT re-emit triage events, re-open war-room
 * threads, or re-insert `live_triage_alerts` rows.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const emitTriageAlertMock = vi.fn();
const emitTriageClearMock = vi.fn();
vi.mock("../lib/triage-emitter", () => ({
  emitTriageAlert: (...args: unknown[]) => emitTriageAlertMock(...args),
  emitTriageClear: (...args: unknown[]) => emitTriageClearMock(...args),
}));

// Hoisted so the `vi.mock` factory below (which is itself hoisted) can
// reference these without hitting a TDZ error. The mocked DB layer
// reads/writes `dbState` so consecutive `recordInfraAlert` calls observe
// the effects of previous inserts (matching real DB behaviour).
const {
  dbState,
  triageInsertMock,
  webhookInsertMock,
  updateWhereMock,
  TRIAGE_TABLE,
  WEBHOOK_TABLE,
} = vi.hoisted(() => {
  const dbState = { unresolvedCount: 0, nextId: 1 };
  const TRIAGE_TABLE  = { __table: "live_triage_alerts" };
  const WEBHOOK_TABLE = { __table: "webhook_threads" };
  return {
    dbState,
    TRIAGE_TABLE,
    WEBHOOK_TABLE,
    triageInsertMock: vi.fn(async () => {
      dbState.unresolvedCount += 1;
      dbState.nextId += 1;
    }),
    webhookInsertMock: vi.fn(async () => undefined),
    updateWhereMock: vi.fn(async () => {
      dbState.unresolvedCount = 0;
    }),
  };
});

vi.mock("@workspace/db", () => {
  const insert = vi.fn((table: unknown) => ({
    values: table === TRIAGE_TABLE ? triageInsertMock : webhookInsertMock,
  }));
  const update = vi.fn(() => ({
    set: vi.fn(() => ({ where: updateWhereMock })),
  }));
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () =>
          dbState.unresolvedCount > 0 ? [{ id: dbState.nextId }] : [],
        ),
      })),
    })),
  }));
  return {
    db:               { insert, update, select },
    webhookThreads:   WEBHOOK_TABLE,
    liveTriageAlerts: Object.assign(TRIAGE_TABLE, {
      id:             "id",
      externalId:     "external_id",
      resolvedStatus: "resolved_status",
    }),
  };
});

import {
  recordInfraAlert,
  resolveInfraAlert,
  getAlerts,
} from "../lib/alert-store";

const ALERT_ID = "sys_health_quality_fixes_scanner";
const PAYLOAD = {
  alertId:  ALERT_ID,
  title:    "Quality Fixes Scanner — Sync Disruption Detected",
  detail:   "Shoptimizer service is unreachable. Quality Fixes scanner is paused.",
  platform: "Background Worker",
  action:   "Verify Shoptimizer is running.",
} as const;

beforeEach(() => {
  emitTriageAlertMock.mockClear();
  emitTriageClearMock.mockClear();
  triageInsertMock.mockClear();
  webhookInsertMock.mockClear();
  updateWhereMock.mockClear();
  dbState.unresolvedCount = 0;
  dbState.nextId = 1;
});

describe("alert-store infra helpers", () => {
  it("emits and persists exactly once on the first call (transition)", async () => {
    await recordInfraAlert({ ...PAYLOAD });

    expect(triageInsertMock).toHaveBeenCalledTimes(1);
    expect(emitTriageAlertMock).toHaveBeenCalledTimes(1);
    expect(getAlerts().some((a) => a.id === ALERT_ID)).toBe(true);
  });

  it("no-ops when an unresolved row already exists (no duplicate notification or DB row)", async () => {
    // Simulate another caller having already inserted an unresolved row.
    dbState.unresolvedCount = 1;

    await recordInfraAlert({ ...PAYLOAD });
    await recordInfraAlert({ ...PAYLOAD });
    await recordInfraAlert({ ...PAYLOAD });

    expect(triageInsertMock).not.toHaveBeenCalled();
    expect(emitTriageAlertMock).not.toHaveBeenCalled();
  });

  it("does not re-emit on consecutive failing audits — only the first transition fires", async () => {
    await recordInfraAlert({ ...PAYLOAD });
    await recordInfraAlert({ ...PAYLOAD });
    await recordInfraAlert({ ...PAYLOAD });

    expect(triageInsertMock).toHaveBeenCalledTimes(1);
    expect(emitTriageAlertMock).toHaveBeenCalledTimes(1);
  });

  it("resolveInfraAlert clears in-memory state and updates the DB", async () => {
    await recordInfraAlert({ ...PAYLOAD });
    expect(getAlerts().some((a) => a.id === ALERT_ID)).toBe(true);

    await resolveInfraAlert(ALERT_ID);

    expect(getAlerts().some((a) => a.id === ALERT_ID)).toBe(false);
    expect(emitTriageClearMock).toHaveBeenCalledWith(ALERT_ID);
    expect(updateWhereMock).toHaveBeenCalledTimes(1);
  });

  it("scanner + system-health-monitor share the same alertId without producing duplicate rows", async () => {
    // First caller: the Quality Fixes scanner detects Shoptimizer is down and
    // raises the alert directly (matches the `void recordInfraAlert(...)`
    // call inside `runQualityFixesScan`).
    await recordInfraAlert({
      alertId:  ALERT_ID,
      title:    "Quality Fixes Scanner — Sync Disruption Detected",
      detail:   "Shoptimizer service is unreachable. Quality Fixes scanner is paused.",
      platform: "Background Worker",
      action:   "Verify Shoptimizer is running and SHOPTIMIZER_URL is set.",
    });

    // Second caller: a moment later the periodic self-audit
    // (`runSystemSelfAudit`) also notices the failed `quality_fixes_scanner`
    // check and fires the same alert id with its own copy.
    await recordInfraAlert({
      alertId:  ALERT_ID,
      title:    "Quality Fixes Scanner — Sync Disruption Detected",
      detail:   "Quality Fixes Scanner is unreachable or returned an error.",
      platform: "Background Worker",
      action:   "Investigate Quality Fixes Scanner connectivity and credentials.",
    });

    // And again on the next audit tick — the audit runs on a timer.
    await recordInfraAlert({
      alertId:  ALERT_ID,
      title:    "Quality Fixes Scanner — Sync Disruption Detected",
      detail:   "Quality Fixes Scanner is unreachable or returned an error.",
      platform: "Background Worker",
      action:   "Investigate Quality Fixes Scanner connectivity and credentials.",
    });

    // Despite three calls from two different writers, exactly one DB row and
    // exactly one triage emission must have been produced.
    expect(triageInsertMock).toHaveBeenCalledTimes(1);
    expect(emitTriageAlertMock).toHaveBeenCalledTimes(1);
    expect(getAlerts().filter((a) => a.id === ALERT_ID)).toHaveLength(1);
  });

  it("re-fires after a resolve → re-fail cycle", async () => {
    await recordInfraAlert({ ...PAYLOAD });
    expect(emitTriageAlertMock).toHaveBeenCalledTimes(1);

    await resolveInfraAlert(ALERT_ID);

    // New failure → must transition again.
    await recordInfraAlert({ ...PAYLOAD });
    expect(emitTriageAlertMock).toHaveBeenCalledTimes(2);
    expect(triageInsertMock).toHaveBeenCalledTimes(2);
  });
});
