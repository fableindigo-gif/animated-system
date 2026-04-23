// @vitest-environment happy-dom

/**
 * Tests for the stale-workspace banner in AiConversationsPage.
 *
 * Verifies:
 *   • Banner and re-authorize link are present when at least one platform
 *     returns "needs_reconnect" from GET /api/connections/google/health.
 *   • Banner is absent when all platforms are "healthy" or "not_connected".
 *   • The health probe is called exactly once per mount.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

// ── Module mocks (must be declared before the component import) ───────────────

vi.mock("@/lib/auth-fetch", () => ({
  authFetch:   vi.fn(),
  authPost:    vi.fn(),
  authPatch:   vi.fn(),
  authDelete:  vi.fn(),
}));

vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { authFetch } from "@/lib/auth-fetch";
import AiConversationsPage from "../ai-conversations";

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockAuthFetch = authFetch as ReturnType<typeof vi.fn>;

function makeJsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const EMPTY_SESSIONS_RESPONSE = {
  sessions: [],
  total: 0,
  hasMore: false,
};

function setupFetchMock(healthPlatforms: Record<string, { status: string }>) {
  mockAuthFetch.mockImplementation((url: string) => {
    if (typeof url === "string" && url.includes("connections/google/health")) {
      return Promise.resolve(
        makeJsonResponse({
          checkedAt: new Date().toISOString(),
          platforms: healthPlatforms,
        }),
      );
    }
    return Promise.resolve(makeJsonResponse(EMPTY_SESSIONS_RESPONSE));
  });
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // happy-dom doesn't implement scrollIntoView
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AiConversationsPage – stale-workspace banner", () => {
  it("shows the banner and re-authorize link when a platform needs_reconnect", async () => {
    setupFetchMock({
      google_calendar: { status: "needs_reconnect" },
      google_drive:    { status: "healthy" },
    });

    render(<AiConversationsPage />);

    await screen.findByTestId("banner-workspace-stale");
    await screen.findByTestId("link-reauthorize-workspace");
  });

  it("shows the banner when multiple platforms need reconnect", async () => {
    setupFetchMock({
      google_calendar: { status: "needs_reconnect" },
      google_drive:    { status: "needs_reconnect" },
      google_docs:     { status: "needs_reconnect" },
    });

    render(<AiConversationsPage />);

    await screen.findByTestId("banner-workspace-stale");
    await screen.findByTestId("link-reauthorize-workspace");
  });

  it("does not show the banner when all platforms are healthy", async () => {
    setupFetchMock({
      google_calendar: { status: "healthy" },
      google_drive:    { status: "healthy" },
      google_docs:     { status: "healthy" },
    });

    render(<AiConversationsPage />);

    await waitFor(() => {
      expect(screen.queryByTestId("banner-workspace-stale")).toBeNull();
      expect(screen.queryByTestId("link-reauthorize-workspace")).toBeNull();
    });
  });

  it("does not show the banner when all platforms are not_connected", async () => {
    setupFetchMock({
      google_calendar: { status: "not_connected" },
      google_drive:    { status: "not_connected" },
    });

    render(<AiConversationsPage />);

    await waitFor(() => {
      expect(screen.queryByTestId("banner-workspace-stale")).toBeNull();
      expect(screen.queryByTestId("link-reauthorize-workspace")).toBeNull();
    });
  });

  it("does not show the banner when platforms are a mix of healthy and not_connected", async () => {
    setupFetchMock({
      google_calendar: { status: "healthy" },
      google_drive:    { status: "not_connected" },
      google_docs:     { status: "healthy" },
    });

    render(<AiConversationsPage />);

    await waitFor(() => {
      expect(screen.queryByTestId("banner-workspace-stale")).toBeNull();
    });
  });

  it("calls the health probe exactly once per mount", async () => {
    setupFetchMock({ google_calendar: { status: "healthy" } });

    render(<AiConversationsPage />);

    await waitFor(() => {
      const healthCalls = mockAuthFetch.mock.calls.filter(
        ([url]: [string]) => typeof url === "string" && url.includes("connections/google/health"),
      );
      expect(healthCalls).toHaveLength(1);
    });
  });
});
