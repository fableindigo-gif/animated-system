import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // The axe-core accessibility sweep has its own config
  // (`playwright.a11y.config.ts`) that boots a Vite dev server with the
  // right BASE_PATH, mocks every /api/** call, and applies a per-route
  // baseline. It is invoked via `pnpm run test:a11y` and is also wired
  // as a dedicated CI job. Excluding it here prevents the regular `pnpm
  // e2e` run from trying to execute the spec against the production
  // build (which has no admin localStorage seed and a different prefix).
  testIgnore: ["a11y.spec.ts"],
  outputDir: "./audit-screenshots",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["html", { outputFolder: "playwright-report", open: "never" }], ["list"]],

  use: {
    baseURL: process.env.APP_URL ?? "http://localhost:25974/ecom-agent",
    screenshot: "off",
    video: "off",
    trace: "off",
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // In the Replit Nix sandbox the bundled Chromium binary needs
        // a manual path (the libs Playwright ships against aren't on
        // the dynamic linker search path). Outside Replit we let
        // Playwright pick its own bundled browser as usual.
        ...(process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE
          ? { launchOptions: { executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE } }
          : {}),
      },
    },
  ],
});
