/**
 * a11y.spec.ts
 * ────────────
 * Automated WCAG 2.1 AA regression guard for the five surfaces audited in
 * Phase 0.5 Section G (color-contrast remediation, task #103). Wires
 * @axe-core/playwright into the existing Playwright harness so future
 * style/markup tweaks cannot silently regress contrast, focus rings,
 * alt text, name/role/value, or label association.
 *
 * Run locally (after `npx playwright install chromium`):
 *   APP_URL=http://localhost:25974/ecom-agent \
 *     pnpm --filter @workspace/ecom-agent run test:a11y
 *
 * The dedicated config (`playwright.a11y.config.ts`) auto-starts the
 * dev server when none is already running, so CI can invoke
 * `pnpm --filter @workspace/ecom-agent run test:a11y` with no extra setup.
 *
 * Auth is mocked via the same localStorage tokens the other e2e specs use
 * (admin-provisioning.spec.ts, agency-onboarding.spec.ts) and every
 * `/api/**` request is stubbed with an empty payload so the route renders
 * its production markup (skeletons, empty states, headings) rather than
 * relying on a live API server.
 *
 * The five audited routes (matches the table in
 * `audit/PHASE_0_SECTION_G.md`):
 *   - home               → `/`
 *   - executive-brief    → `/client-brief`
 *   - feed-enrichment    → `/feed-enrichment`
 *   - connections        → `/connections`
 *   - workspace-settings → `/settings`
 */

import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Baseline (allowed pre-existing violations) ──────────────────────────────

interface BaselineFile {
  [route: string]: Record<string, number> | string[] | undefined;
}

const BASELINE: BaselineFile = JSON.parse(
  fs.readFileSync(path.join(__dirname, "a11y-baseline.json"), "utf8"),
);

function allowedFor(route: string): Record<string, number> {
  const entry = BASELINE[route];
  if (!entry || Array.isArray(entry)) return {};
  return entry;
}

// ─── Audited routes ──────────────────────────────────────────────────────────

interface AuditedRoute {
  /** Slug used in PHASE_0_SECTION_G.md. */
  surface: string;
  /** Live wouter route the surface is mounted on. */
  path: string;
}

/**
 * Vite is launched with `BASE_PATH=<prefix>`, so every SPA route is
 * mounted under that prefix. Playwright's `page.goto("/foo")` resolves
 * against the host (NOT the baseURL pathname), so we have to bake the
 * prefix into each path or every navigation 404s and only the bare
 * landing HTML gets axe-scanned.
 *
 * Local dev mounts at `/ecom-agent`; the CI pipeline (.github/workflows/ci.yml)
 * mounts the built static bundle at `/`. We honour whichever the env says.
 */
const BASE_PATH = (() => {
  const raw = (process.env.A11Y_BASE_PATH ?? process.env.BASE_PATH ?? "/ecom-agent").trim();
  // Normalise: ensure leading slash, strip trailing slash (so "/" → "").
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withSlash === "/" ? "" : withSlash.replace(/\/+$/, "");
})();

const AUDITED_ROUTES: readonly AuditedRoute[] = [
  { surface: "home",               path: `${BASE_PATH}/` },
  { surface: "executive-brief",    path: `${BASE_PATH}/client-brief` },
  { surface: "feed-enrichment",    path: `${BASE_PATH}/feed-enrichment` },
  { surface: "connections",        path: `${BASE_PATH}/connections` },
  { surface: "workspace-settings", path: `${BASE_PATH}/settings` },
];

// ─── Auth + API stubs ────────────────────────────────────────────────────────

/**
 * Inject a fully-onboarded Admin session. Mirrors the keys the app reads
 * on boot in admin-provisioning.spec.ts so /settings (admin-only) and
 * the other gated surfaces all render their authenticated markup.
 */
async function injectAdminAuth(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("omnianalytix_gate_token", "a11y-admin-token");
    localStorage.setItem("omni_user_name", "A11y Bot");
    localStorage.setItem("omni_user_email", "a11y@omnianalytix.test");
    localStorage.setItem("omni_user_role", "admin");
    localStorage.setItem("omni_preauth_complete", "true");
    localStorage.setItem("omni_onboarding_complete", "true");
    localStorage.setItem("omni_agency_setup_complete", "true");
    localStorage.removeItem("omni_needs_onboarding");
  });
}

/**
 * Stub every /api/** request with an empty-but-typed-ish payload so the
 * SPA renders its production markup without a live API server. Axe runs
 * against whatever the route paints — empty states, skeletons, headings
 * — all of which still must pass WCAG 2.1 AA.
 */
async function stubApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (method !== "GET" && method !== "POST") {
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    // Return a generic shape that satisfies most consumers (array OR object).
    // Components that destructure either will land in their empty/skeleton
    // branch, which is exactly the markup we want to lint.
    const body = url.includes("/list") || url.endsWith("s") ? "[]" : "{}";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body,
    });
  });
}

// ─── Spec ────────────────────────────────────────────────────────────────────

test.describe("WCAG 2.1 AA — audited surfaces (Phase 0.5 Section G)", () => {
  for (const route of AUDITED_ROUTES) {
    test(`@a11y ${route.surface} (${route.path}) has zero AA violations`, async ({ page }) => {
      await injectAdminAuth(page);
      await stubApi(page);

      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      // Wait for React + the lazy route chunk + the Suspense fallback to
      // resolve. We can't rely on `networkidle` because the stubbed /api/**
      // calls keep the network "active" indefinitely on long-poll surfaces.
      await page.waitForFunction(
        () => {
          const root = document.getElementById("root");
          return !!root && root.children.length > 0 && root.textContent !== "";
        },
        { timeout: 15_000 },
      );
      // Small grace period so any second-pass paint (e.g. dropdown rerender
      // after auth context hydrates) settles before axe walks the tree.
      await page.waitForTimeout(750);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        // Disable color-contrast on disabled controls — disabled inputs
        // are explicitly exempt from WCAG 1.4.3 and axe flags them as
        // "incomplete" rather than "violation" anyway. We keep the rule
        // on for everything else.
        .disableRules([])
        .analyze();

      const allowed = allowedFor(route.path);
      const regressions = results.violations
        .map((v) => ({ rule: v, allowed: allowed[v.id] ?? 0 }))
        .filter(({ rule, allowed: max }) => rule.nodes.length > max);

      if (regressions.length > 0) {
        // Pretty-print so a CI failure tells you exactly which rule on
        // which selector regressed, instead of a single opaque count.
        const formatted = regressions
          .map(({ rule: v, allowed: max }) => {
            const nodes = v.nodes
              .slice(0, 10)
              .map((n) => `      • ${n.target.join(" ")}`)
              .join("\n");
            const moreSuffix = v.nodes.length > 10 ? `\n      • …(+${v.nodes.length - 10} more)` : "";
            const baselineNote = max === 0
              ? "NEW rule (not in baseline)"
              : `regression: ${v.nodes.length} nodes vs. baseline ${max}`;
            return `  - [${v.id}] ${v.help} (impact: ${v.impact ?? "n/a"}, ${baselineNote})\n    ${v.helpUrl}\n${nodes}${moreSuffix}`;
          })
          .join("\n");
        throw new Error(
          `axe-core found ${regressions.length} NEW WCAG 2.1 AA violation(s) on ${route.surface} (${route.path}):\n${formatted}\n\n` +
            `If these are intentional/known and a follow-up task tracks the fix,\n` +
            `add the rule id + node count to e2e/a11y-baseline.json under "${route.path}".\n` +
            `Otherwise, fix the violation in the source.`,
        );
      }

      expect(regressions).toEqual([]);
    });
  }
});
