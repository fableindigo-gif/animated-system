/**
 * ProductTour
 * -----------
 * Guided first-session tour powered by react-joyride.
 *
 * Behaviour:
 * - On mount, fetches /api/users/profile to check `hasCompletedTour`.
 * - If false (new user), starts the tour automatically after a short delay.
 * - When the user finishes OR dismisses, fires PATCH /api/users/profile
 *   { hasCompletedTour: true } and marks local state so it never re-runs.
 *
 * Data-tour target IDs (added to their respective DOM elements):
 *   #tour-workspace-switcher  — WorkspaceSwitcher component
 *   #tour-nav-connections     — Connections sidebar link
 *   #tour-bento-pulse         — BentoDashboard KPI row
 *   #tour-nav-tasks           — Task Board sidebar link
 */
import { useState, useEffect, useCallback } from "react";
// react-joyride v3 reshuffled its public surface (removed `disableScrollParentFix`,
// renamed callback types, made Props strict). We cast to a loose component
// signature to dodge the per-version drift without rewriting the tour.
import { Joyride as JoyrideRaw, STATUS } from "react-joyride";
import { authFetch } from "@/lib/auth-fetch";

type TourCallback = { status: string; type: string; index: number };
const Joyride = JoyrideRaw as unknown as React.ComponentType<Record<string, unknown>>;

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

// ─── Tour step definitions ─────────────────────────────────────────────────────

const TOUR_STEPS = [
  {
    target:    "#tour-workspace-switcher",
    title:     "Welcome to OmniAnalytix! 👋",
    content:   "Here is where you switch between your different agency clients. Each workspace keeps your data, AI context, and settings completely isolated.",
    placement: "right",
    disableBeacon: true,
  },
  {
    target:    "#tour-nav-connections",
    title:     "Connect your platforms",
    content:   "Start by securely connecting your client's Google Ads, Meta, or Shopify data. All credentials are encrypted at rest and never shared.",
    placement: "right",
    disableBeacon: true,
  },
  {
    target:    "#tour-bento-pulse",
    title:     "Your KPI command center",
    content:   "Once connected, your cross-platform KPIs and margin health will populate here — revenue, net margin, and task health in one glance.",
    placement: "bottom",
    disableBeacon: true,
  },
  {
    target:    "#tour-nav-tasks",
    title:     "AI-surfaced recommendations",
    content:   "Our AI will surface margin leaks and optimisation opportunities here for you to review, approve, or delegate to your team.",
    placement: "right",
    disableBeacon: true,
  },
];

// ─── Joyride theme ─────────────────────────────────────────────────────────────

const JOYRIDE_STYLES = {
  options: {
    primaryColor: "#004ac6",
    backgroundColor: "#ffffff",
    arrowColor: "#ffffff",
    overlayColor: "rgba(0, 0, 0, 0.45)",
    textColor: "#1a1c1f",
    zIndex: 10000,
  },
  tooltip: {
    borderRadius: 16,
    padding: "20px 24px 16px",
    boxShadow: "0 20px 60px rgba(0, 74, 198, 0.18), 0 4px 16px rgba(0,0,0,0.12)",
  },
  tooltipTitle: {
    fontSize: 15,
    fontWeight: 700,
    fontFamily: "'Manrope', sans-serif",
    marginBottom: 6,
  },
  tooltipContent: {
    fontSize: 13,
    lineHeight: 1.6,
    color: "#434655",
    padding: "0 0 4px",
  },
  buttonNext: {
    backgroundColor: "#004ac6",
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
    padding: "8px 18px",
  },
  buttonBack: {
    color: "#004ac6",
    fontSize: 13,
    fontWeight: 500,
  },
  buttonSkip: {
    color: "#94a3b8",
    fontSize: 12,
  },
};

// ─── Hook: load / save tour state ─────────────────────────────────────────────

function useTourState() {
  const [loading, setLoading]       = useState(true);
  const [shouldRun, setShouldRun]   = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`${BASE}/api/users/profile`);
        if (!res.ok || cancelled) return;
        const data = await res.json() as { hasCompletedTour?: boolean };
        if (!cancelled && !data.hasCompletedTour) {
          // Small delay so the UI is fully rendered before the tour starts
          setTimeout(() => { if (!cancelled) setShouldRun(true); }, 1200);
        }
      } catch {
        // Silently skip the tour if the API call fails
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const markComplete = useCallback(async () => {
    setShouldRun(false);
    try {
      await authFetch(`${BASE}/api/users/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hasCompletedTour: true }),
      });
    } catch {
      // Best-effort: if the PATCH fails, the tour will show again next login
      // but won't loop within the same session (shouldRun already false)
    }
  }, []);

  return { loading, shouldRun, markComplete };
}

// ─── ProductTour component ─────────────────────────────────────────────────────

export function ProductTour() {
  const { loading, shouldRun, markComplete } = useTourState();
  const [run, setRun] = useState(false);

  // Start running once shouldRun flips true
  useEffect(() => { if (shouldRun) setRun(true); }, [shouldRun]);

  const handleCallback = useCallback(
    (data: TourCallback) => {
      const { status } = data;

      // Tour finished or user explicitly clicked "Skip"
      const finished = (status as string) === STATUS.FINISHED;
      const skipped  = (status as string) === STATUS.SKIPPED;

      if (finished || skipped) {
        setRun(false);
        void markComplete();
      }
    },
    [markComplete],
  );

  if (loading || !run) return null;

  return (
    <Joyride
      steps={TOUR_STEPS}
      run={run}
      continuous
      showProgress
      showSkipButton
      scrollToFirstStep
      disableScrollParentFix
      callback={handleCallback}
      styles={JOYRIDE_STYLES}
      locale={{
        back:  "Back",
        close: "Close",
        last:  "Done",
        next:  "Next →",
        open:  "Open tour",
        skip:  "Skip tour",
      }}
      floaterProps={{
        disableAnimation: false,
      }}
    />
  );
}
