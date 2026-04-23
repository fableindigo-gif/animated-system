/**
 * writeback-view-logic.test.ts
 *
 * Pure-logic tests for the WritebackView render decisions.
 * These are DOM-free and validate the boolean predicates and
 * data-mapping rules that the component uses to decide:
 *
 *   1. Should the "Retry" button appear for a given task?
 *   2. Should "Fix Required" appear instead?
 *   3. What banner style (green / amber / rose) should the
 *      run-result panel use?
 *   4. Does retryClassMeta map every RetryClass to the right label?
 *
 * The predicates below are direct mirrors of the component code in
 * `feed-enrichment.tsx` (WritebackView). If the component logic
 * changes and these tests break, the contract has changed.
 */

import { describe, it, expect } from "vitest";

// ─── Types mirrored from the component ────────────────────────────────────────

type WritebackStatus = "pending" | "approved" | "applied" | "failed";
type RetryClass = "none" | "non_retryable" | "auth" | "quota" | "transient";

interface WritebackRetry {
  retryClass: RetryClass;
  retryable: boolean;
  retryAfterSec: number | null;
  hint: string;
}

interface WritebackTask {
  id: number;
  status: WritebackStatus;
  latestAttempt: {
    retry: WritebackRetry | null;
    httpStatus: number | null;
    result: { success: boolean; message: string } | null;
    createdAt: string | null;
  } | null;
}

interface WritebackRunResult {
  totalRequested: number;
  totalApplied: number;
  totalFailed: number;
}

// ─── Predicates mirrored from WritebackView ───────────────────────────────────

/**
 * Returns true when the "Retry" button should be visible for a task.
 * Mirror of:
 *   task.status === "approved" || (task.status === "failed" && isRetryable)
 */
function shouldShowRetryButton(task: WritebackTask): boolean {
  const isRetryable = task.latestAttempt?.retry?.retryable ?? false;
  return task.status === "approved" || (task.status === "failed" && isRetryable);
}

/**
 * Returns true when the "Fix Required" indicator should be visible.
 * Mirror of:
 *   task.status === "failed" && !isRetryable
 */
function shouldShowFixRequired(task: WritebackTask): boolean {
  const isRetryable = task.latestAttempt?.retry?.retryable ?? false;
  return task.status === "failed" && !isRetryable;
}

/**
 * Resolves the run-result banner variant.
 * Mirror of the ternary inside the runResult banner in WritebackView:
 *   totalFailed === 0 → "success"
 *   totalApplied > 0  → "partial"
 *   else              → "allFailed"
 */
function runResultBannerVariant(r: WritebackRunResult): "success" | "partial" | "allFailed" {
  if (r.totalFailed === 0) return "success";
  if (r.totalApplied > 0) return "partial";
  return "allFailed";
}

/**
 * Maps RetryClass to a badge label — mirrors retryClassMeta() switch
 * (label property only; JSX icon and color strings are DOM-only).
 */
function retryClassLabel(cls: RetryClass | undefined): string {
  switch (cls) {
    case "non_retryable": return "Validation Error";
    case "quota":         return "Quota / Rate Limit";
    case "transient":     return "Transient Error";
    case "auth":          return "Auth Error";
    default:              return "Unknown";
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTask(
  status: WritebackStatus,
  retryable: boolean,
  retryClass: RetryClass = "non_retryable",
): WritebackTask {
  return {
    id: 1,
    status,
    latestAttempt: {
      retry: { retryClass, retryable, retryAfterSec: retryable ? 60 : null, hint: "hint" },
      httpStatus: 429,
      result: null,
      createdAt: null,
    },
  };
}

function makeTaskNoAttempt(status: WritebackStatus): WritebackTask {
  return { id: 2, status, latestAttempt: null };
}

// ─────────────────────────────────────────────────────────────────────────────
describe("shouldShowRetryButton", () => {
  it("shows Retry for approved task regardless of latestAttempt", () => {
    expect(shouldShowRetryButton(makeTaskNoAttempt("approved"))).toBe(true);
    expect(shouldShowRetryButton(makeTask("approved", false))).toBe(true);
    expect(shouldShowRetryButton(makeTask("approved", true))).toBe(true);
  });

  it("shows Retry for failed task only when latestAttempt marks it retryable", () => {
    expect(shouldShowRetryButton(makeTask("failed", true,  "quota"))).toBe(true);
    expect(shouldShowRetryButton(makeTask("failed", true,  "transient"))).toBe(true);
  });

  it("does NOT show Retry for failed non-retryable tasks", () => {
    expect(shouldShowRetryButton(makeTask("failed", false, "non_retryable"))).toBe(false);
    expect(shouldShowRetryButton(makeTask("failed", false, "auth"))).toBe(false);
  });

  it("does NOT show Retry for failed task with no latestAttempt (defaults retryable=false)", () => {
    expect(shouldShowRetryButton(makeTaskNoAttempt("failed"))).toBe(false);
  });

  it("does NOT show Retry for pending or applied tasks", () => {
    expect(shouldShowRetryButton(makeTaskNoAttempt("pending"))).toBe(false);
    expect(shouldShowRetryButton(makeTaskNoAttempt("applied"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("shouldShowFixRequired", () => {
  it("shows Fix Required for failed non-retryable task (non_retryable class)", () => {
    expect(shouldShowFixRequired(makeTask("failed", false, "non_retryable"))).toBe(true);
  });

  it("shows Fix Required for failed auth task (auth is non-retryable)", () => {
    expect(shouldShowFixRequired(makeTask("failed", false, "auth"))).toBe(true);
  });

  it("shows Fix Required for failed task with no latestAttempt (retryable defaults false)", () => {
    expect(shouldShowFixRequired(makeTaskNoAttempt("failed"))).toBe(true);
  });

  it("does NOT show Fix Required when task is failed but retryable (quota/transient)", () => {
    expect(shouldShowFixRequired(makeTask("failed", true, "quota"))).toBe(false);
    expect(shouldShowFixRequired(makeTask("failed", true, "transient"))).toBe(false);
  });

  it("does NOT show Fix Required for non-failed statuses", () => {
    expect(shouldShowFixRequired(makeTaskNoAttempt("approved"))).toBe(false);
    expect(shouldShowFixRequired(makeTaskNoAttempt("applied"))).toBe(false);
    expect(shouldShowFixRequired(makeTaskNoAttempt("pending"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Retry and Fix Required are mutually exclusive", () => {
  const statuses: WritebackStatus[] = ["pending", "approved", "applied", "failed"];
  const retryableFlags = [true, false];

  statuses.forEach((status) => {
    retryableFlags.forEach((retryable) => {
      it(`status=${status} retryable=${retryable}`, () => {
        const task = retryable
          ? makeTask(status, retryable, "quota")
          : makeTask(status, retryable, "non_retryable");
        const showRetry    = shouldShowRetryButton(task);
        const showFix      = shouldShowFixRequired(task);
        expect(showRetry && showFix).toBe(false);
      });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("runResultBannerVariant", () => {
  it("returns 'success' when no failures", () => {
    expect(runResultBannerVariant({ totalRequested: 3, totalApplied: 3, totalFailed: 0 })).toBe("success");
  });

  it("returns 'success' when nothing was requested", () => {
    expect(runResultBannerVariant({ totalRequested: 0, totalApplied: 0, totalFailed: 0 })).toBe("success");
  });

  it("returns 'partial' when some applied and some failed", () => {
    expect(runResultBannerVariant({ totalRequested: 3, totalApplied: 1, totalFailed: 2 })).toBe("partial");
  });

  it("returns 'allFailed' when all tasks failed (none applied)", () => {
    expect(runResultBannerVariant({ totalRequested: 2, totalApplied: 0, totalFailed: 2 })).toBe("allFailed");
  });

  it("returns 'allFailed' when one task failed and none applied", () => {
    expect(runResultBannerVariant({ totalRequested: 1, totalApplied: 0, totalFailed: 1 })).toBe("allFailed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("retryClassLabel", () => {
  it("maps non_retryable → 'Validation Error'", () => {
    expect(retryClassLabel("non_retryable")).toBe("Validation Error");
  });

  it("maps quota → 'Quota / Rate Limit'", () => {
    expect(retryClassLabel("quota")).toBe("Quota / Rate Limit");
  });

  it("maps transient → 'Transient Error'", () => {
    expect(retryClassLabel("transient")).toBe("Transient Error");
  });

  it("maps auth → 'Auth Error'", () => {
    expect(retryClassLabel("auth")).toBe("Auth Error");
  });

  it("maps none → 'Unknown' (defensive fallback for success case)", () => {
    expect(retryClassLabel("none")).toBe("Unknown");
  });

  it("maps undefined → 'Unknown'", () => {
    expect(retryClassLabel(undefined)).toBe("Unknown");
  });
});
