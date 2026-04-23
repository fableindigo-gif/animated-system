// @vitest-environment happy-dom

/**
 * Component tests for WritebackView.
 *
 * Renders the real WritebackView component (exported from feed-enrichment.tsx)
 * with controlled props and asserts visible UI output:
 *
 *   • "Retry" button present for approved tasks
 *   • "Retry" button present for failed + retryable tasks (quota, transient)
 *   • "Fix Required" indicator present for failed + non-retryable tasks
 *   • Neither control present for applied / pending tasks
 *   • Run-result banner shows correct summary text
 *   • Retry hint text rendered for failed tasks
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";

// ── Mock modules imported by feed-enrichment.tsx that WritebackView doesn't use ─

vi.mock("@/lib/auth-fetch", () => ({
  authFetch: vi.fn(),
  authPost:  vi.fn(),
}));

vi.mock("@/contexts/workspace-context", () => ({
  useWorkspace: vi.fn(() => ({
    workspace: null,
    workspaces: [],
    setWorkspace: vi.fn(),
    refreshWorkspaces: vi.fn(),
  })),
  WorkspaceProvider: ({ children }: any) => children,
}));

vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(() => ({ toast: vi.fn() })),
  toast: vi.fn(),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { WritebackView } from "../pages/feed-enrichment";

// ── Helpers ───────────────────────────────────────────────────────────────────

type Ret = { retryClass: string; retryable: boolean; retryAfterSec: number | null; hint: string };

function makeTask(opts: {
  id?: number;
  status: "pending" | "approved" | "applied" | "failed";
  retry?: Ret | null;
  attemptCount?: number;
}) {
  return {
    id: opts.id ?? 1,
    status: opts.status,
    toolDisplayName: `Fix offer #${opts.id ?? 1}`,
    comments: "",
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    offerId: `offer-${opts.id ?? 1}`,
    proposedByName: "Alice",
    attemptCount: opts.attemptCount ?? 1,
    latestAttempt: opts.retry !== undefined
      ? { retry: opts.retry, httpStatus: 429, result: null, createdAt: null }
      : null,
  } as any;
}

const noopFilter   = vi.fn();
const noopRetry    = vi.fn();
const noopRetryAll = vi.fn();
const noopRefresh  = vi.fn();

function renderView(tasks: any[], runResult: any = null, retryOutcomes: Map<number, "applied" | "failed"> = new Map()) {
  render(
    <WritebackView
      tasks={tasks}
      loading={false}
      error={null}
      retrying={new Set()}
      retryingAll={false}
      runResult={runResult}
      retryOutcomes={retryOutcomes}
      statusFilter="all"
      setStatusFilter={noopFilter}
      onRetry={noopRetry}
      onRetryAll={noopRetryAll}
      onRefresh={noopRefresh}
      maxAttempts={5}
    />,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
describe("WritebackView — Retry button visibility", () => {
  it("shows Retry for an approved task", () => {
    renderView([makeTask({ id: 1, status: "approved", retry: null })]);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("shows Retry for a failed + quota (retryable) task", () => {
    renderView([makeTask({
      id: 2, status: "failed",
      retry: { retryClass: "quota", retryable: true, retryAfterSec: 60, hint: "Quota hit. Retry after 60s." },
    })]);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("shows Retry for a failed + transient (retryable) task", () => {
    renderView([makeTask({
      id: 3, status: "failed",
      retry: { retryClass: "transient", retryable: true, retryAfterSec: 30, hint: "5xx transient error." },
    })]);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("does NOT show Retry for a failed non-retryable task", () => {
    renderView([makeTask({
      id: 4, status: "failed",
      retry: { retryClass: "non_retryable", retryable: false, retryAfterSec: null, hint: "Fix the diff." },
    })]);
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("does NOT show Retry for a failed auth task", () => {
    renderView([makeTask({
      id: 5, status: "failed",
      retry: { retryClass: "auth", retryable: false, retryAfterSec: null, hint: "Reconnect GMC." },
    })]);
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("does NOT show Retry for applied task", () => {
    renderView([makeTask({ id: 6, status: "applied", retry: null })]);
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("does NOT show Retry for pending task", () => {
    renderView([makeTask({ id: 7, status: "pending", retry: null })]);
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("WritebackView — Fix Required indicator", () => {
  it("shows Fix Required for failed non-retryable task", () => {
    renderView([makeTask({
      id: 10, status: "failed",
      retry: { retryClass: "non_retryable", retryable: false, retryAfterSec: null, hint: "Fix the diff." },
    })]);
    expect(screen.getByText(/fix required/i)).toBeInTheDocument();
  });

  it("shows Fix Required for failed auth task (also non-retryable)", () => {
    renderView([makeTask({
      id: 11, status: "failed",
      retry: { retryClass: "auth", retryable: false, retryAfterSec: null, hint: "Reconnect GMC." },
    })]);
    expect(screen.getByText(/fix required/i)).toBeInTheDocument();
  });

  it("shows Fix Required for failed task with no latestAttempt", () => {
    renderView([makeTask({ id: 12, status: "failed", retry: undefined })]);
    expect(screen.getByText(/fix required/i)).toBeInTheDocument();
  });

  it("does NOT show Fix Required for failed retryable task", () => {
    renderView([makeTask({
      id: 13, status: "failed",
      retry: { retryClass: "quota", retryable: true, retryAfterSec: 60, hint: "Quota hit." },
    })]);
    expect(screen.queryByText(/fix required/i)).toBeNull();
  });

  it("does NOT show Fix Required for approved task", () => {
    renderView([makeTask({ id: 14, status: "approved", retry: null })]);
    expect(screen.queryByText(/fix required/i)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("WritebackView — run-result banner", () => {
  it("shows success summary when all tasks applied", () => {
    renderView([], { totalRequested: 3, totalApplied: 3, totalFailed: 0, results: [] });
    expect(screen.getByText(/3 of 3 task/i)).toBeInTheDocument();
    expect(screen.queryByText(/failed — see hints/i)).toBeNull();
  });

  it("shows failure count when some tasks failed", () => {
    renderView([], { totalRequested: 3, totalApplied: 1, totalFailed: 2, results: [] });
    expect(screen.getByText(/1 of 3 task/i)).toBeInTheDocument();
    expect(screen.getByText(/2 failed/i)).toBeInTheDocument();
  });

  it("shows all-failed summary when none applied", () => {
    renderView([], { totalRequested: 2, totalApplied: 0, totalFailed: 2, results: [] });
    expect(screen.getByText(/0 of 2 task/i)).toBeInTheDocument();
    expect(screen.getByText(/2 failed/i)).toBeInTheDocument();
  });

  it("does not render a banner when runResult is null", () => {
    renderView([], null);
    expect(screen.queryByText(/of \d+ task/i)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("WritebackView — per-row retry outcomes (bulk retry)", () => {
  it("shows 'Applied' badge on a row whose id is in retryOutcomes as applied", () => {
    const task = makeTask({ id: 30, status: "applied", retry: null });
    renderView([task], null, new Map([[30, "applied"]]));
    const badge = screen.getByTestId("retry-outcome-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Applied");
  });

  it("shows 'Failed' badge on a row whose id is in retryOutcomes as failed", () => {
    const task = makeTask({
      id: 31, status: "failed",
      retry: { retryClass: "transient", retryable: true, retryAfterSec: null, hint: "Transient." },
    });
    renderView([task], null, new Map([[31, "failed"]]));
    const badge = screen.getByTestId("retry-outcome-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Failed");
  });

  it("shows no inline outcome badge when retryOutcomes is empty", () => {
    const task = makeTask({ id: 32, status: "applied", retry: null });
    renderView([task], null, new Map());
    expect(screen.queryByTestId("retry-outcome-badge")).toBeNull();
  });

  it("shows no inline badge on a row not included in retryOutcomes", () => {
    const task = makeTask({ id: 33, status: "applied", retry: null });
    renderView([task], null, new Map([[99, "applied"]]));
    expect(screen.queryByTestId("retry-outcome-badge")).toBeNull();
  });

  it("badge disappears when retryOutcomes is cleared (simulates 5-s timer expiry)", () => {
    const task = makeTask({ id: 34, status: "applied", retry: null });
    const { rerender } = render(
      <WritebackView
        tasks={[task]}
        loading={false}
        error={null}
        retrying={new Set()}
        retryingAll={false}
        runResult={null}
        retryOutcomes={new Map([[34, "applied"]])}
        statusFilter="all"
        setStatusFilter={noopFilter}
        onRetry={noopRetry}
        onRetryAll={noopRetryAll}
        onRefresh={noopRefresh}
        maxAttempts={5}
      />,
    );
    expect(screen.getByTestId("retry-outcome-badge")).toBeInTheDocument();
    act(() => {
      rerender(
        <WritebackView
          tasks={[task]}
          loading={false}
          error={null}
          retrying={new Set()}
          retryingAll={false}
          runResult={null}
          retryOutcomes={new Map()}
          statusFilter="all"
          setStatusFilter={noopFilter}
          onRetry={noopRetry}
          onRetryAll={noopRetryAll}
          onRefresh={noopRefresh}
          maxAttempts={5}
        />,
      );
    });
    expect(screen.queryByTestId("retry-outcome-badge")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("WritebackView — retry hint text", () => {
  it("renders hint from latestAttempt for failed tasks", () => {
    renderView([makeTask({
      id: 20, status: "failed",
      retry: { retryClass: "quota", retryable: true, retryAfterSec: 60, hint: "Quota hit. Retry after 60s." },
    })]);
    expect(screen.getByText(/quota hit/i)).toBeInTheDocument();
  });

  it("does not render hint box for non-failed tasks", () => {
    renderView([makeTask({
      id: 21, status: "applied",
      retry: { retryClass: "none", retryable: false, retryAfterSec: null, hint: "OK" },
    })]);
    expect(screen.queryByText(/hint:/i)).toBeNull();
  });
});
