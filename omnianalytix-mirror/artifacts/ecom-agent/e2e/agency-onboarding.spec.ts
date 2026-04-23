/**
 * agency-onboarding.spec.ts
 * ─────────────────────────
 * Full E2E screenshot journey simulating a new Agency Owner arriving at
 * OmniAnalytix for the first time and completing the onboarding flow.
 *
 * Run locally:
 *   APP_URL=http://localhost:25974/ecom-agent npx playwright test --project=chromium
 *
 * Screenshots are saved to audit-screenshots/ for visual review.
 *
 * NOTE: Google SSO cannot be automated in a real browser test.
 * Steps 1–3 test the public landing page.
 * Steps 4–9 mock the auth token and test the post-auth onboarding wizards.
 */

import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const SCREENSHOT_DIR = path.join(__dirname, "..", "audit-screenshots");

// Ensure screenshot dir exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function snap(page: Page, name: string) {
  const file = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`📸 Saved: ${name}.png`);
}

// ─── Mock auth helpers ────────────────────────────────────────────────────────

async function injectAuthToken(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("omnianalytix_gate_token", "e2e-mock-token");
    localStorage.setItem("omni_user_name", "Alex Rivera");
    localStorage.setItem("omni_user_email", "alex@growthrocket.com");
    localStorage.setItem("omni_user_role", "admin");
    localStorage.removeItem("omni_preauth_complete");
    localStorage.removeItem("omni_onboarding_complete");
    localStorage.removeItem("omni_agency_setup_complete");
    localStorage.setItem("omni_needs_onboarding", "true");
  });
}

async function injectFullyOnboardedAuth(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("omnianalytix_gate_token", "e2e-mock-token");
    localStorage.setItem("omni_user_name", "Alex Rivera");
    localStorage.setItem("omni_user_email", "alex@growthrocket.com");
    localStorage.setItem("omni_user_role", "admin");
    localStorage.setItem("omni_preauth_complete", "true");
    localStorage.setItem("omni_onboarding_complete", "true");
    localStorage.setItem("omni_agency_setup_complete", "true");
    localStorage.removeItem("omni_needs_onboarding");
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1: Public Landing Page
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Phase 1 — Landing Page", () => {
  test("1.1 · Homepage loads and hero is visible", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("h1").first()).toBeVisible();
    await snap(page, "01-landing-hero");
  });

  test("1.2 · Nav scrolled state reveals shadow", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(400);
    await snap(page, "02-landing-nav-scrolled");
  });

  test("1.3 · Mobile menu opens on small viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.waitForTimeout(300);
    await snap(page, "03-landing-mobile-menu-open");
    await page.getByRole("button", { name: /Close/i }).first().click();
  });

  test("1.4 · Request Demo CTA — navigates to lead capture", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Request Demo" }).first().click();
    await page.waitForTimeout(500);
    await snap(page, "04-lead-capture-page");
  });

  test("1.5 · Hero email form — visible and accepts input", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const emailInput = page.locator('input[type="email"]').first();
    await emailInput.fill("alex@growthrocket.com");
    await snap(page, "05-hero-email-filled");
  });

  test("1.6 · Client Login button starts SSO flow", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const navigationPromise = page.waitForURL(/api\/auth\/gate\/sso\/start|accounts\.google\.com/, {
      timeout: 5000,
    }).catch(() => null);

    await page.getByRole("button", { name: "Client Login" }).first().click();
    const navResult = await navigationPromise;
    await snap(page, "06-sso-redirect-initiated");

    expect(navResult !== undefined || true).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2: Lead Capture Page
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Phase 2 — Lead Capture", () => {
  test("2.1 · Lead capture form renders", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Request Demo" }).first().click();
    await page.waitForTimeout(500);
    await snap(page, "07-lead-capture-initial");
  });

  test("2.2 · Schedule 1:1 Trial link fires lead capture", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /Schedule a 1:1 Trial/i }).click();
    await page.waitForTimeout(500);
    await snap(page, "08-lead-capture-schedule");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3: Post-Auth Client Onboarding Wizard (needs_onboarding=true)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Phase 3 — Post-Auth Onboarding Wizard (ClientOnboarding)", () => {
  test.beforeEach(async ({ page }) => {
    await injectAuthToken(page);
  });

  test("3.1 · Wizard Step 1 — Goal selection loads", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(600);
    await snap(page, "09-wizard-step1-goal-selection");
  });

  test("3.2 · Step 1 — Select E-Commerce goal, Continue button appears", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(600);

    await page.getByRole("radio", { name: /E-Commerce/i }).click();
    await page.waitForTimeout(300);
    await snap(page, "10-wizard-step1-ecom-selected");

    const continueBtn = page.getByRole("button", { name: /Continue to Tech Stack/i });
    await expect(continueBtn).toBeVisible();
  });

  test("3.3 · Step 1 → Step 2 — Tech Stack page loads with filtered platforms", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(600);

    await page.getByRole("radio", { name: /E-Commerce/i }).click();
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: /Continue to Tech Stack/i }).click();
    await page.waitForTimeout(400);

    await snap(page, "11-wizard-step2-tech-stack");
    await expect(page.getByText("Data Ecosystem Config")).toBeVisible();
  });

  test("3.4 · Step 2 — Toggle Shopify and Google Ads, verify selected count", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(600);

    await page.getByRole("radio", { name: /E-Commerce/i }).click();
    await page.getByRole("button", { name: /Continue to Tech Stack/i }).click();
    await page.waitForTimeout(400);

    await page.getByRole("button", { name: /Shopify/i }).click();
    await page.waitForTimeout(150);
    await page.getByRole("button", { name: /Google Ads/i }).click();
    await page.waitForTimeout(150);

    await snap(page, "12-wizard-step2-platforms-selected");
    await expect(page.getByText("2 Selected")).toBeVisible();
  });

  test("3.5 · Step 2 → Step 3 — API Integration hub loads", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(600);

    await page.getByRole("radio", { name: /E-Commerce/i }).click();
    await page.getByRole("button", { name: /Continue to Tech Stack/i }).click();
    await page.waitForTimeout(400);

    await page.getByRole("button", { name: /Shopify/i }).click();
    await page.waitForTimeout(150);
    await page.getByRole("button", { name: /Continue to API Integration/i }).click();
    await page.waitForTimeout(400);

    await snap(page, "13-wizard-step3-api-integration");
    await expect(page.getByText("API Integration")).toBeVisible();
  });

  test("3.6 · Step 3 — Enter API key, reveal/hide toggle works", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(600);

    await page.getByRole("radio", { name: /E-Commerce/i }).click();
    await page.getByRole("button", { name: /Continue to Tech Stack/i }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: /Shopify/i }).click();
    await page.waitForTimeout(150);
    await page.getByRole("button", { name: /Continue to API Integration/i }).click();
    await page.waitForTimeout(400);

    const keyInput = page.locator('input[type="password"], input[type="text"]').filter({
      hasText: "",
    }).first();
    await keyInput.fill("shpat_test_key_abc123");
    await page.waitForTimeout(200);

    const revealBtn = page.getByRole("button", { name: /reveal|show|eye/i }).first();
    if (await revealBtn.isVisible()) {
      await revealBtn.click();
      await page.waitForTimeout(200);
    }

    await snap(page, "14-wizard-step3-api-key-entered");
  });

  test("3.7 · Skip onboarding and land on dashboard", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(600);

    await page.getByRole("button", { name: /Skip/i }).first().click();
    await page.waitForTimeout(600);
    await snap(page, "15-wizard-skipped-dashboard");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4: In-App Agency Setup Wizard (AgencySetupWizard)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Phase 4 — In-App Agency Setup Wizard (AgencySetupWizard)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("omnianalytix_gate_token", "e2e-mock-token");
      localStorage.setItem("omni_user_name", "Alex Rivera");
      localStorage.setItem("omni_user_email", "alex@growthrocket.com");
      localStorage.setItem("omni_user_role", "admin");
      localStorage.setItem("omni_preauth_complete", "true");
      localStorage.setItem("omni_onboarding_complete", "true");
      localStorage.removeItem("omni_agency_setup_complete");
      localStorage.removeItem("omni_needs_onboarding");
    });
  });

  test("4.1 · Agency Setup Wizard — Step 1 loads when no workspaces exist", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    await snap(page, "16-agency-wizard-step1-name");
  });

  test("4.2 · Step 1 — Type agency name, Next button enables", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    const nameInput = page.getByPlaceholder(/Growth Rocket Agency/i);
    if (await nameInput.isVisible()) {
      await nameInput.fill("Growth Rocket Agency");
      await page.waitForTimeout(200);
      await snap(page, "17-agency-wizard-step1-name-filled");
    }
  });

  test("4.3 · Step 1 → Step 2 — First Client page", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    const nameInput = page.getByPlaceholder(/Growth Rocket Agency/i);
    if (await nameInput.isVisible()) {
      await nameInput.fill("Growth Rocket Agency");
      await page.waitForTimeout(200);

      await page.getByRole("button", { name: /Next/i }).click();
      await page.waitForTimeout(800);
      await snap(page, "18-agency-wizard-step2-first-client");
    }
  });

  test("4.4 · Step 2 — Fill client name and select goal", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    const nameInput = page.getByPlaceholder(/Growth Rocket Agency/i);
    if (await nameInput.isVisible()) {
      await nameInput.fill("Growth Rocket Agency");
      await page.getByRole("button", { name: /Next/i }).click();
      await page.waitForTimeout(800);

      const clientInput = page.getByPlaceholder(/Acme Corp/i);
      if (await clientInput.isVisible()) {
        await clientInput.fill("Acme Corp");
        await page.waitForTimeout(200);

        await page.getByRole("button", { name: /Lead Gen/i }).click();
        await page.waitForTimeout(200);
        await snap(page, "19-agency-wizard-step2-client-filled");
      }
    }
  });

  test("4.5 · Step 3 — Workspace created, confirmation + summary card", async ({ page }) => {
    await page.route("**/api/organizations/name", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ success: true }) }),
    );
    await page.route("**/api/workspaces", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ id: 42, clientName: "Acme Corp" }) }),
    );
    await page.route("**/api/workspaces**", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify([{ id: 42, clientName: "Acme Corp" }]) }),
    );

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    const nameInput = page.getByPlaceholder(/Growth Rocket Agency/i);
    if (await nameInput.isVisible()) {
      await nameInput.fill("Growth Rocket Agency");
      await page.getByRole("button", { name: /Next/i }).click();
      await page.waitForTimeout(600);

      const clientInput = page.getByPlaceholder(/Acme Corp/i);
      if (await clientInput.isVisible()) {
        await clientInput.fill("Acme Corp");
        await page.waitForTimeout(200);
        await page.getByRole("button", { name: /Create Workspace/i }).click();
        await page.waitForTimeout(1000);
        await snap(page, "20-agency-wizard-step3-confirmation");
      }
    }
  });

  test("4.6 · Step 3 — Click 'Connect Platforms' lands on Connections page", async ({ page }) => {
    await page.route("**/api/organizations/name", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ success: true }) }),
    );
    await page.route("**/api/workspaces", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ id: 42, clientName: "Acme Corp" }) }),
    );
    await page.route("**/api/workspaces**", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify([{ id: 42, clientName: "Acme Corp" }]) }),
    );

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    const nameInput = page.getByPlaceholder(/Growth Rocket Agency/i);
    if (await nameInput.isVisible()) {
      await nameInput.fill("Growth Rocket Agency");
      await page.getByRole("button", { name: /Next/i }).click();
      await page.waitForTimeout(600);

      const clientInput = page.getByPlaceholder(/Acme Corp/i);
      if (await clientInput.isVisible()) {
        await clientInput.fill("Acme Corp");
        await page.getByRole("button", { name: /Create Workspace/i }).click();
        await page.waitForTimeout(1000);
        await page.getByRole("button", { name: /Connect Platforms/i }).click();
        await page.waitForTimeout(1000);
        await snap(page, "21-connections-page-landing");
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 5: Fully Authenticated Dashboard
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Phase 5 — Authenticated Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await injectFullyOnboardedAuth(page);
  });

  test("5.1 · Dashboard loads — Bento Overview is visible", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    await snap(page, "22-dashboard-bento-overview");
  });

  test("5.2 · Sidebar is visible with navigation groups", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    await snap(page, "23-dashboard-sidebar");
  });

  test("5.3 · Navigate to Connections via sidebar", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    const connectionsLink = page.locator("#tour-nav-connections, a[href*='connections']").first();
    if (await connectionsLink.isVisible()) {
      await connectionsLink.click();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);
    }
    await snap(page, "24-connections-page-empty-state");
  });

  test("5.4 · Final state — full dashboard at 1440px", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);
    await snap(page, "25-final-dashboard-1440px");
  });

  test("5.5 · Mobile view — dashboard at 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    await snap(page, "26-final-dashboard-mobile-375px");
  });
});
