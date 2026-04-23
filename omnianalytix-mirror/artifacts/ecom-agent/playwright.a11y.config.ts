/**
 * playwright.a11y.config.ts
 * ─────────────────────────
 * Dedicated Playwright config for the WCAG 2.1 AA regression guard
 * (`e2e/a11y.spec.ts`). Kept separate from the screenshot-journey
 * config so:
 *
 *   1. `pnpm --filter @workspace/ecom-agent run test:a11y` runs ONLY
 *      the axe checks (fast, deterministic, no screenshots).
 *   2. The a11y job can auto-start the dev server in CI without
 *      altering the behavior of the existing `test:e2e` config which
 *      assumes the server is already up.
 *
 * Port: the dev server requires `PORT` (vite.config.ts throws if
 * unset). We pin `25974` here to match the default `APP_URL` used by
 * the other specs and the `playwright.config.ts` `baseURL`.
 */

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 25974);
const BASE_URL = process.env.APP_URL ?? `http://localhost:${PORT}/ecom-agent`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /a11y\.spec\.ts$/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],

  use: {
    baseURL: BASE_URL,
    screenshot: "off",
    video: "off",
    trace: "off",
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  },

  webServer: {
    command: `pnpm --filter @workspace/ecom-agent run dev`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { PORT: String(PORT), BASE_PATH: "/ecom-agent" },
    stdout: "ignore",
    stderr: "pipe",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
