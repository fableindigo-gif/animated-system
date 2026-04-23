/**
 * dashboard-pages-smoke.spec.ts
 * ─────────────────────────────
 * Smoke coverage for the ~10 dashboard pages refactored in task #7
 * (admin clients, agent builder, data modeling, agency command center,
 * activity log, workspace settings, forensic, task board, feed
 * enrichment, onboarding wizard).
 *
 * For every page we assert two contracts:
 *
 *   1. The page mounts and a known heading renders. Catches regressions
 *      where a refactor breaks the route, the lazy chunk, or the JSX
 *      that anchors the page (white-screen / blank-shell bugs).
 *
 *   2. When the page's primary data API is forced to fail, the shared
 *      QueryErrorState UI renders (role="alert" + "Try again" button)
 *      instead of a stuck spinner, white screen, or silent empty state.
 *      This pins the error/retry contract introduced by task #7.
 *
 * Pages without a top-level QueryErrorState wired to a single primary
 * endpoint (workspace settings, onboarding wizard) only get the
 * heading-renders test — the refactor for those pages didn't add a
 * page-level shared error UI to assert against.
 *
 * Auth shortcut & fixture pattern match the existing
 * `dashboard-correctness.spec.ts` (mocked localStorage gate token,
 * stubbed `/api/connections` + `/api/workspaces`) so this spec runs
 * against the same Vite dev server with no extra setup.
 */

import { test, expect, type Page } from "@playwright/test";

// ─── Fixture helpers ─────────────────────────────────────────────────────────

interface SeedOpts {
  /** When true, leave the onboarding flag unset so the wizard mounts on `/`. */
  needsOnboarding?: boolean;
}

async function seedAuth(page: Page, opts: SeedOpts = {}) {
  const { needsOnboarding = false } = opts;
  await page.addInitScript(
    ({ needsOnboarding }) => {
      localStorage.setItem("omnianalytix_gate_token", "e2e-smoke-token");
      localStorage.setItem("omni_user_name", "Aria Banerjee");
      localStorage.setItem("omni_user_email", "aria@example.com");
      localStorage.setItem("omni_user_role", "admin");
      localStorage.setItem("omni_preauth_complete", "true");
      localStorage.setItem("omni_agency_setup_complete", "true");
      localStorage.setItem("omni_active_workspace_id", "42");
      if (needsOnboarding) {
        // Wizard mounts when home.tsx sees `omni_onboarding_complete`
        // unset (`useOnboardingState().complete === false`) AND the
        // App-level "auto-complete onboarding" effect doesn't fire —
        // that effect is gated on the `omni_needs_onboarding` flag, so
        // we deliberately leave that key UNSET here.
        localStorage.removeItem("omni_onboarding_complete");
        localStorage.removeItem("omni_needs_onboarding");
      } else {
        localStorage.setItem("omni_onboarding_complete", "true");
        localStorage.removeItem("omni_needs_onboarding");
      }
    },
    { needsOnboarding },
  );
}

/**
 * Stub the cross-cutting endpoints that nearly every page hits via the
 * AppShell (workspace switcher + currency context + connections list).
 * Returning ok-but-empty payloads keeps the shell idle so the only
 * thing left moving is the per-page primary fetch we explicitly
 * exercise in each test.
 */
async function stubBaseline(page: Page) {
  // Catch-all (LOWEST priority — Playwright matches the most-recently
  // added route first, so anything registered after this overrides it).
  // Reason: the Vite dev server we point at doesn't proxy `/api/**` to
  // the api-server, so any un-stubbed call would hit the SPA fallback
  // (HTML body, `res.json()` throws) and crash the page's React tree
  // through the ErrorBoundary. Returning `200 []` for every unknown
  // /api/* path keeps the page interactive and lets us assert on the
  // chrome / heading without enumerating every side-fetch each
  // dashboard makes.
  await page.route(/\/api\//, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  // The Vite dev server we point at doesn't proxy `/api/**` to the
  // api-server, so the unauthenticated AuthGate verify call would
  // otherwise hit the SPA fallback (HTML body, json() throws) and the
  // gate would clear our seeded token and redirect to the sign-in
  // prompt. Stubbing the verify endpoint to "valid" keeps the seeded
  // admin role and lets the dashboard mount.
  await page.route(/\/api\/auth\/gate\/verify(?:\?|$)/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        valid: true,
        authMethod: "sso",
        memberId: 1,
        role: "admin",
        name: "Aria Banerjee",
        email: "aria@example.com",
        organizationId: 1,
      }),
    }),
  );
  // Connections — generated client expects an array of platform records.
  // Returning `[]` keeps the AppShell's `useListConnections` resolved
  // (so onboarding wizard's `!isLoadingConnections` becomes true) and
  // is the actual production response shape (see api-server
  // routes/connections/index.ts:40).
  await page.route(/\/api\/connections(?:\?|$)/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route(/\/api\/workspaces(?:\?|$|\/active|\/42(?:\?|$|\/))/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      // Workspace shape mirrors `Workspace` in src/types/shared.ts.
      // Several pages (e.g. agency command center) render
      // `WorkspaceCard` for every workspace and access fields like
      // `enabledIntegrations.length` and `criticalAlertCount`
      // unconditionally — missing fields would crash the page through
      // the ErrorBoundary, so the fixture must be complete.
      body: JSON.stringify([
        {
          id: 42,
          organizationId: 1,
          clientName: "Acme",
          companyName: "Acme",
          slug: "acme",
          primaryGoal: null,
          enabledIntegrations: [],
          selectedWorkflows: [],
          inviteToken: "tok",
          status: "active",
          notes: null,
          webhookUrl: null,
          websiteUrl: null,
          discoverySource: null,
          headquartersCountry: "US",
          billingThreshold: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          criticalAlertCount: 0,
          currency: "USD",
          goalType: "E-COMMERCE",
        },
      ]),
    }),
  );
  // The agency command center renders <HandoffRegistry/>, which polls
  // `/api/mcp/registry` and reads `data.handoffs.length` *unconditionally*
  // once `data` is set. The catch-all returns `[]`, so `data.handoffs`
  // would be `undefined` → `.length` would throw and the ErrorBoundary
  // would swallow the entire page (including the "Agency Overview"
  // heading). Returning the real response shape keeps the registry
  // panel idle.
  await page.route(/\/api\/mcp\/registry(?:\?|$)/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ scope: "platform", count: 0, handoffs: [] }),
    }),
  );
  await page.route(/\/api\/fx\/rates/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, rates: { USD: { rate: 1, source: "cache", rateDate: "2026-04-20" } } }),
    }),
  );
}

/**
 * Force the given URL pattern(s) to 500 so the page's primary
 * react-query / async load fails and the shared error state renders.
 *
 * Routes are registered BEFORE `stubBaseline` is called so the failure
 * matcher wins over any later success matcher for the same URL.
 */
async function failRoutes(page: Page, patterns: RegExp[]) {
  for (const pattern of patterns) {
    await page.route(pattern, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Forced failure for e2e smoke spec" }),
      }),
    );
  }
}

/** QueryErrorState renders a role="alert" wrapper containing "Try again". */
async function assertSharedErrorState(page: Page) {
  const alert = page.getByRole("alert").filter({ hasText: /Try again/i }).first();
  await expect(
    alert,
    "Expected the shared QueryErrorState (role=alert + 'Try again' button) to render after a forced API failure",
  ).toBeVisible({ timeout: 15_000 });
}

// ─── Page matrix ─────────────────────────────────────────────────────────────
//
// Each entry pins the route, a known heading the refactor must keep
// rendering, and (where applicable) the primary API endpoint(s) that
// gate the page's main content. Pages without a `failPatterns` entry
// don't have a top-level shared error UI to assert against and only
// get the heading-renders test.

interface PageCase {
  name:           string;
  path:           string;
  heading:        RegExp;
  /** Endpoints to force-500 so the primary load fails. */
  failPatterns?: RegExp[];
  /** Optional extra setup before navigation (e.g. onboarding flags). */
  setup?:         (page: Page) => Promise<void>;
  /**
   * Optional interaction to run after navigation but before asserting
   * the shared error UI — used for pages whose QueryErrorState surface
   * is gated behind a tab/view switch (e.g. task board).
   */
  preErrorAssert?: (page: Page) => Promise<void>;
}

const PAGES: PageCase[] = [
  {
    name: "admin clients",
    path: "/admin/clients",
    heading: /^Client Accounts$/,
    failPatterns: [/\/api\/admin\/organizations(?:\?|$)/],
  },
  {
    name: "agent builder",
    path: "/agent-builder",
    heading: /^AI Agent Builder$/,
    failPatterns: [/\/api\/ai-agents(?:\?|$)/],
  },
  {
    name: "data modeling",
    path: "/data-modeling",
    heading: /^Custom Attribution Logic$/,
    failPatterns: [/\/api\/data-modeling\/metrics(?:\?|$)/],
  },
  {
    name: "agency command center",
    path: "/agency/command-center",
    heading: /^Agency Overview$/,
    failPatterns: [/\/api\/admin\/organizations(?:\?|$)/],
  },
  {
    name: "activity log",
    path: "/activity",
    heading: /^Activity Log$/,
    failPatterns: [/\/api\/actions\/audit(?:\?|$|\/)/],
  },
  {
    name: "workspace settings",
    path: "/settings",
    heading: /^Settings$/,
    // SettingsPage defaults to the Account tab which has no top-level
    // QueryErrorState. The Economics tab does, but reaching it requires
    // user interaction — out of scope for a smoke test.
  },
  {
    name: "forensic",
    path: "/forensic",
    heading: /^Forensic Auditor$/,
    failPatterns: [/\/api\/warehouse\/products(?:\?|$)/, /\/api\/warehouse\/channels(?:\?|$)/, /\/api\/warehouse\/margin-leaks(?:\?|$)/],
  },
  {
    name: "task board",
    path: "/tasks",
    heading: /Command Center/,
    // The page's shared QueryErrorState is wired to `tasksQuery`, which
    // fetches `/api/tasks` (or `/api/tasks?status=…`). The negative
    // lookahead avoids accidentally clobbering `/api/tasks/ops`, which
    // feeds a sibling component with its own non-shared error banner.
    failPatterns: [/\/api\/tasks(?!\/ops)(?:\?|$)/],
    // The QueryErrorState surface lives inside the "AI Proposals" tab
    // (the default tab is "Command Center", which uses a different
    // endpoint and renders its own custom error banner). Switch tabs
    // so the failed `tasksQuery` actually mounts and renders the
    // shared error state.
    preErrorAssert: async (page) => {
      await page.getByRole("button", { name: /AI Proposals/i }).click();
    },
  },
  {
    name: "feed enrichment",
    path: "/feed-enrichment",
    heading: /^Feed Enrichment$/,
    // The page-mount Products fetch hits
    // `/api/feed-enrichment/products` and feeds `productsQuery`, which
    // is the query wired to the shared QueryErrorState surface.
    failPatterns: [/\/api\/feed-enrichment\/products(?:\?|$)/],
  },
  {
    name: "onboarding wizard",
    path: "/",
    // The wizard renders its sidebar progress label unconditionally on
    // every step — used as a stable anchor across step changes.
    heading: /Setup Progress/i,
    setup: (page) => seedAuth(page, { needsOnboarding: true }),
  },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe("Dashboard pages smoke — heading renders", () => {
  for (const pc of PAGES) {
    test(`${pc.name} · mounts at ${pc.path} and renders "${pc.heading}"`, async ({ page }) => {
      if (pc.setup) {
        await pc.setup(page);
      } else {
        await seedAuth(page);
      }
      await stubBaseline(page);

      await page.goto(pc.path);
      await page.waitForLoadState("networkidle");

      await expect(
        page.getByText(pc.heading).first(),
        `Expected heading matching ${pc.heading} on ${pc.path}`,
      ).toBeVisible({ timeout: 20_000 });
    });
  }
});

test.describe("Dashboard pages smoke — shared error UI on API failure", () => {
  for (const pc of PAGES) {
    if (!pc.failPatterns?.length) continue;
    test(`${pc.name} · forced API 500 surfaces the shared QueryErrorState`, async ({ page }) => {
      if (pc.setup) {
        await pc.setup(page);
      } else {
        await seedAuth(page);
      }
      // Playwright matches routes in *reverse* registration order
      // (most recently added wins) — so register the baseline
      // catch-all first and the failure overrides last.
      await stubBaseline(page);
      await failRoutes(page, pc.failPatterns);

      await page.goto(pc.path);
      await page.waitForLoadState("networkidle");

      if (pc.preErrorAssert) {
        await pc.preErrorAssert(page);
      }

      await assertSharedErrorState(page);
    });
  }
});
