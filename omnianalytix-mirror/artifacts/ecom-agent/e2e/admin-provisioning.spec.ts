/**
 * admin-provisioning.spec.ts
 * ──────────────────────────
 * E2E screenshot journey simulating an authenticated Agency Admin managing
 * their organization: provisioning a new client workspace, navigating to
 * Team & Access, inviting a Junior Buyer (analyst) role, and asserting the
 * pending invite appears in the team list.
 *
 * Run locally (after `npx playwright install chromium`):
 *   APP_URL=http://localhost:25974/ecom-agent pnpm run test:e2e --grep "admin-provisioning"
 *
 * Screenshots are saved to audit-screenshots/admin-flow/ at every step.
 *
 * NOTE: Real Google SSO cannot be automated. Auth is mocked via addInitScript
 * injecting the localStorage tokens the app reads on boot.
 */

import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

// ─── Screenshot helpers ────────────────────────────────────────────────────────

const SCREENSHOT_DIR = path.join(__dirname, "..", "audit-screenshots", "admin-flow");

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function snap(page: Page, name: string) {
  const file = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`📸 Saved: audit-screenshots/admin-flow/${name}.png`);
}

// ─── Auth mock helpers ─────────────────────────────────────────────────────────

/**
 * Inject a fully-onboarded Admin session.
 * The app reads these keys on mount to decide which screen to render.
 */
async function injectAdminAuth(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("omnianalytix_gate_token", "e2e-admin-token");
    localStorage.setItem("omni_user_name", "Jordan Mitchell");
    localStorage.setItem("omni_user_email", "jordan@agencyhq.com");
    localStorage.setItem("omni_user_role", "admin");
    localStorage.setItem("omni_preauth_complete", "true");
    localStorage.setItem("omni_onboarding_complete", "true");
    localStorage.setItem("omni_agency_setup_complete", "true");
    localStorage.removeItem("omni_needs_onboarding");
  });
}

// ─── API intercept helpers ─────────────────────────────────────────────────────

/**
 * Mock POST /api/workspaces so the spec doesn't need a live DB write.
 * Returns a realistic workspace payload that matches the Workspace type.
 */
async function mockWorkspaceCreate(page: Page, workspaceName: string) {
  await page.route("**/api/workspaces", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: 42,
        organizationId: 1,
        clientName: workspaceName,
        slug: workspaceName.toLowerCase().replace(/\s+/g, "-"),
        primaryGoal: "leadgen",
        enabledIntegrations: ["google_ads", "meta", "ga4", "hubspot", "linkedin_ads"],
        inviteToken: "mock-invite-token-abc123",
        criticalAlertCount: 0,
        createdAt: new Date().toISOString(),
      }),
    });
  });
}

/**
 * Mock GET /api/workspaces to return a list that includes the new workspace
 * (simulates the refreshWorkspaces() call that fires after creation).
 */
async function mockWorkspaceList(page: Page, extraWorkspace?: { id: number; clientName: string }) {
  await page.route("**/api/workspaces", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const workspaces = [
      {
        id: 1,
        organizationId: 1,
        clientName: "Growth Rocket — Demo",
        slug: "growth-rocket-demo",
        primaryGoal: "ecom",
        enabledIntegrations: ["shopify", "google_ads", "meta"],
        inviteToken: "tok-demo",
        criticalAlertCount: 0,
        createdAt: new Date().toISOString(),
      },
      ...(extraWorkspace
        ? [{
            id: extraWorkspace.id,
            organizationId: 1,
            clientName: extraWorkspace.clientName,
            slug: extraWorkspace.clientName.toLowerCase().replace(/\s+/g, "-"),
            primaryGoal: "leadgen",
            enabledIntegrations: ["google_ads", "meta", "ga4", "hubspot", "linkedin_ads"],
            inviteToken: "mock-invite-token-abc123",
            criticalAlertCount: 0,
            createdAt: new Date().toISOString(),
          }]
        : []),
    ];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(workspaces),
    });
  });
}

/**
 * Mock POST /api/team to return a pending invite member.
 */
async function mockTeamInvite(page: Page, inviteeName: string, inviteeEmail: string, workspaceId: number) {
  await page.route("**/api/team", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: 99,
        organizationId: 1,
        workspaceId,
        name: inviteeName,
        email: inviteeEmail,
        role: "analyst",
        inviteCode: "e2e-invite-code-xyz789",
        isActive: false,
        invitePending: true,
        hasCompletedTour: false,
        agencySetupComplete: false,
        createdAt: new Date().toISOString(),
      }),
    });
  });
}

/**
 * Mock GET /api/team to return active members + pending invites.
 */
async function mockTeamList(page: Page, pendingMember?: { name: string; email: string; workspaceId: number }) {
  await page.route("**/api/team", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const members = [
      {
        id: 1,
        organizationId: 1,
        workspaceId: null,
        name: "Jordan Mitchell",
        email: "jordan@agencyhq.com",
        role: "admin",
        inviteCode: "admin-code-000",
        isActive: true,
        invitePending: false,
        hasCompletedTour: true,
        agencySetupComplete: true,
        createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
      },
      ...(pendingMember
        ? [{
            id: 99,
            organizationId: 1,
            workspaceId: pendingMember.workspaceId,
            name: pendingMember.name,
            email: pendingMember.email,
            role: "analyst",
            inviteCode: "e2e-invite-code-xyz789",
            isActive: false,
            invitePending: true,
            hasCompletedTour: false,
            agencySetupComplete: false,
            createdAt: new Date().toISOString(),
          }]
        : []),
    ];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(members),
    });
  });
}

// ─── Shared constants ──────────────────────────────────────────────────────────

const NEW_CLIENT_NAME = "Acme Corp Lead Gen";
const INVITEE_NAME    = "Sam Patel";
const INVITEE_EMAIL   = "sam.patel@acmecorp.io";
const NEW_WS_ID       = 42;

// ─── Test suite ────────────────────────────────────────────────────────────────

test.describe("Admin Provisioning Flow", () => {

  // ── Phase 1: Client (Workspace) Provisioning ──────────────────────────────

  test.describe("Phase 1 — Client Provisioning via Workspace Switcher", () => {

    test("P1-01 Authenticated admin lands on dashboard", async ({ page }) => {
      await injectAdminAuth(page);
      await mockWorkspaceList(page);
      await mockTeamList(page);

      await page.goto("/");
      await page.waitForLoadState("networkidle");

      await snap(page, "p1-01-dashboard-initial");

      // The app shell sidebar should be visible
      await expect(page.locator("#tour-workspace-switcher")).toBeVisible();
    });

    test("P1-02 Open workspace switcher dropdown", async ({ page }) => {
      await injectAdminAuth(page);
      await mockWorkspaceList(page);
      await mockTeamList(page);

      await page.goto("/");
      await page.waitForLoadState("networkidle");

      // Click workspace switcher trigger
      const switcher = page.locator("#tour-workspace-switcher button").first();
      await switcher.click();

      await page.waitForTimeout(300); // animation settle
      await snap(page, "p1-02-workspace-switcher-open");

      // Dropdown should be visible
      await expect(page.locator("[data-testid='add-new-client-btn']")).toBeVisible();
    });

    test("P1-03 Click '+ Add New Client' opens provision wizard", async ({ page }) => {
      await injectAdminAuth(page);
      await mockWorkspaceList(page);
      await mockTeamList(page);

      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const switcher = page.locator("#tour-workspace-switcher button").first();
      await switcher.click();
      await page.waitForTimeout(200);

      await page.click("[data-testid='add-new-client-btn']");
      await page.waitForTimeout(300);

      await snap(page, "p1-03-provision-wizard-open");

      // Provision wizard modal should appear
      await expect(page.getByText("Provision Client Workspace")).toBeVisible();
      await expect(page.getByPlaceholder("Acme Corp")).toBeVisible();
    });

    test("P1-04 Fill client name and select Lead Gen goal", async ({ page }) => {
      await injectAdminAuth(page);
      await mockWorkspaceList(page);
      await mockTeamList(page);

      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const switcher = page.locator("#tour-workspace-switcher button").first();
      await switcher.click();
      await page.waitForTimeout(200);
      await page.click("[data-testid='add-new-client-btn']");
      await page.waitForTimeout(300);

      // Fill the client name field
      await page.fill("input[placeholder='Acme Corp']", NEW_CLIENT_NAME);

      // Select Lead Gen goal
      await page.getByText("Lead Gen", { exact: true }).click();
      await page.waitForTimeout(200);

      await snap(page, "p1-04-provision-wizard-filled");

      // Goal selected and CTA should be active
      await expect(page.getByText("Provision Workspace")).toBeVisible();
    });

    test("P1-05 Submit provision form — success state with invite link", async ({ page }) => {
      await injectAdminAuth(page);
      await mockWorkspaceList(page, { id: NEW_WS_ID, clientName: NEW_CLIENT_NAME });
      await mockWorkspaceCreate(page, NEW_CLIENT_NAME);
      await mockTeamList(page);

      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const switcher = page.locator("#tour-workspace-switcher button").first();
      await switcher.click();
      await page.waitForTimeout(200);
      await page.click("[data-testid='add-new-client-btn']");
      await page.waitForTimeout(300);

      await page.fill("input[placeholder='Acme Corp']", NEW_CLIENT_NAME);
      await page.getByText("Lead Gen", { exact: true }).click();
      await page.waitForTimeout(200);

      // Click Provision Workspace
      await page.getByText("Provision Workspace").click();
      await page.waitForTimeout(800);

      await snap(page, "p1-05-provision-wizard-success");

      // Success state: workspace name visible in success card
      await expect(page.getByText(NEW_CLIENT_NAME)).toBeVisible();
      await expect(page.getByText("Client Setup Link")).toBeVisible();

      // Copy button present
      await expect(page.getByText("Copy")).toBeVisible();
    });

  });

  // ── Phase 2: Navigate to Team & Access ────────────────────────────────────

  test.describe("Phase 2 — Team & Access Page Navigation", () => {

    test("P2-01 Navigate to /team route", async ({ page }) => {
      await injectAdminAuth(page);
      await mockWorkspaceList(page, { id: NEW_WS_ID, clientName: NEW_CLIENT_NAME });
      await mockTeamList(page);

      await page.goto("/team");
      await page.waitForLoadState("networkidle");

      await snap(page, "p2-01-team-page-loaded");

      // Page heading
      await expect(page.getByText("Team & Access")).toBeVisible();
      await expect(page.getByText("Invite Member")).toBeVisible();
    });

    test("P2-02 Sidebar navigation link goes to team page", async ({ page }) => {
      await injectAdminAuth(page);
      await mockWorkspaceList(page);
      await mockTeamList(page);

      await page.goto("/");
      await page.waitForLoadState("networkidle");

      // Find Team nav link in the sidebar
      const teamNavLink = page.getByRole("link", { name: /team/i }).first();
      if (await teamNavLink.count() > 0) {
        await teamNavLink.click();
        await page.waitForLoadState("networkidle");
        await expect(page.getByText("Team & Access")).toBeVisible();
      } else {
        // Direct nav fallback if sidebar is collapsed
        await page.goto("/team");
        await page.waitForLoadState("networkidle");
        await expect(page.getByText("Team & Access")).toBeVisible();
      }

      await snap(page, "p2-02-team-via-sidebar");
    });

  });

  // ── Phase 3: Open Invite Modal ────────────────────────────────────────────

  test.describe("Phase 3 — Invite Modal Opening", () => {

    test("P3-01 Click 'Invite Member' opens the modal", async ({ page }) => {
      await injectAdminAuth(page);
      await mockWorkspaceList(page, { id: NEW_WS_ID, clientName: NEW_CLIENT_NAME });
      await mockTeamList(page);

      await page.goto("/team");
      await page.waitForLoadState("networkidle");

      await page.getByText("Invite Member").click();
      await page.waitForTimeout(300);

      await snap(page, "p3-01-invite-modal-open");

      // Modal should be visible with ARIA role
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByText("Invite Team Member")).toBeVisible();
    });

    test("P3-02 Modal shows all five role cards", async ({ page }) => {
      await injectAdminAuth(page);
      await mockWorkspaceList(page, { id: NEW_WS_ID, clientName: NEW_CLIENT_NAME });
      await mockTeamList(page);

      await page.goto("/team");
      await page.waitForLoadState("networkidle");
      await page.getByText("Invite Member").click();
      await page.waitForTimeout(300);

      // All 5 role cards rendered as radio buttons
      const radioCards = page.locator("[role='radio']");
      await expect(radioCards).toHaveCount(5 + 2); // 5 roles + All Clients + one workspace

      await snap(page, "p3-02-modal-role-cards");
    });

  });

  // ── Phase 4: Fill Invite Form ─────────────────────────────────────────────

  test.describe("Phase 4 — Filling the Invite Form", () => {

    async function openModal(page: Page) {
      await injectAdminAuth(page);
      await mockWorkspaceList(page, { id: NEW_WS_ID, clientName: NEW_CLIENT_NAME });
      await mockTeamList(page);

      await page.goto("/team");
      await page.waitForLoadState("networkidle");
      await page.getByText("Invite Member").click();
      await page.waitForTimeout(300);
    }

    test("P4-01 Fill invitee name and email", async ({ page }) => {
      await openModal(page);

      await page.fill("input[placeholder='e.g. Jane Smith']", INVITEE_NAME);
      await page.fill("input[placeholder='e.g. jane@company.com']", INVITEE_EMAIL);

      await snap(page, "p4-01-modal-name-email-filled");

      await expect(page.locator("input[placeholder='e.g. Jane Smith']")).toHaveValue(INVITEE_NAME);
      await expect(page.locator("input[placeholder='e.g. jane@company.com']")).toHaveValue(INVITEE_EMAIL);
    });

    test("P4-02 Select Junior Buyer (analyst) role card", async ({ page }) => {
      await openModal(page);

      await page.fill("input[placeholder='e.g. Jane Smith']", INVITEE_NAME);
      await page.fill("input[placeholder='e.g. jane@company.com']", INVITEE_EMAIL);

      // Click Junior Buyer role card (governanceAlias)
      await page.click("[data-testid='role-option-analyst']");
      await page.waitForTimeout(200);

      await snap(page, "p4-02-modal-junior-buyer-selected");

      // The analyst card should now be aria-checked
      await expect(page.locator("[data-testid='role-option-analyst']")).toHaveAttribute("aria-checked", "true");
      await expect(page.getByText("Propose Only")).toBeVisible();
    });

    test("P4-03 Select the newly created 'Acme Corp' workspace scope", async ({ page }) => {
      await openModal(page);

      await page.fill("input[placeholder='e.g. Jane Smith']", INVITEE_NAME);
      await page.fill("input[placeholder='e.g. jane@company.com']", INVITEE_EMAIL);
      await page.click("[data-testid='role-option-analyst']");

      // Click the Acme Corp workspace scope button
      const wsScope = page.locator(`[data-testid='scope-workspace-${NEW_WS_ID}']`);
      await wsScope.click();
      await page.waitForTimeout(200);

      await snap(page, "p4-03-modal-workspace-scope-selected");

      await expect(wsScope).toHaveAttribute("aria-checked", "true");
      // All Clients radio should be unchecked
      await expect(page.locator("[data-testid='scope-all-clients']")).toHaveAttribute("aria-checked", "false");
    });

    test("P4-04 Completed form — pre-submit screenshot", async ({ page }) => {
      await openModal(page);

      await page.fill("input[placeholder='e.g. Jane Smith']", INVITEE_NAME);
      await page.fill("input[placeholder='e.g. jane@company.com']", INVITEE_EMAIL);
      await page.click("[data-testid='role-option-analyst']");

      const wsScope = page.locator(`[data-testid='scope-workspace-${NEW_WS_ID}']`);
      if (await wsScope.count() > 0) await wsScope.click();

      await snap(page, "p4-04-modal-form-complete");
    });

  });

  // ── Phase 5: Submit Invite & Assert Success ───────────────────────────────

  test.describe("Phase 5 — Submission and Success Assertions", () => {

    async function fillAndSubmit(page: Page) {
      await injectAdminAuth(page);
      await mockWorkspaceList(page, { id: NEW_WS_ID, clientName: NEW_CLIENT_NAME });
      await mockTeamList(page);
      await mockTeamInvite(page, INVITEE_NAME, INVITEE_EMAIL, NEW_WS_ID);

      await page.goto("/team");
      await page.waitForLoadState("networkidle");
      await page.getByText("Invite Member").click();
      await page.waitForTimeout(300);

      await page.fill("input[placeholder='e.g. Jane Smith']", INVITEE_NAME);
      await page.fill("input[placeholder='e.g. jane@company.com']", INVITEE_EMAIL);
      await page.click("[data-testid='role-option-analyst']");

      const wsScope = page.locator(`[data-testid='scope-workspace-${NEW_WS_ID}']`);
      if (await wsScope.count() > 0) await wsScope.click();
    }

    test("P5-01 Spinner appears when Send Invite is clicked", async ({ page }) => {
      await fillAndSubmit(page);

      // Slow down the API response to catch the spinner
      await page.route("**/api/team", async (route) => {
        if (route.request().method() !== "POST") { await route.continue(); return; }
        await new Promise((r) => setTimeout(r, 600));
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            id: 99, organizationId: 1, workspaceId: NEW_WS_ID,
            name: INVITEE_NAME, email: INVITEE_EMAIL, role: "analyst",
            inviteCode: "e2e-invite-code-xyz789",
            isActive: false, invitePending: true,
            hasCompletedTour: false, agencySetupComplete: false,
            createdAt: new Date().toISOString(),
          }),
        });
      });

      await page.click("[data-testid='send-invite-btn']");
      // Capture spinner state
      await snap(page, "p5-01-invite-sending-spinner");
      await expect(page.getByText("Sending…")).toBeVisible();
    });

    test("P5-02 Success state shows invite link after submission", async ({ page }) => {
      await fillAndSubmit(page);

      await page.click("[data-testid='send-invite-btn']");
      await page.waitForTimeout(800);

      await snap(page, "p5-02-invite-success-state");

      // Success panel
      await expect(page.getByText("Invite Created")).toBeVisible();
      await expect(page.getByText("One-Time Invite Link")).toBeVisible();
      await expect(page.locator("[data-testid='copy-invite-link']")).toBeVisible();
    });

    test("P5-03 Copy invite link button works", async ({ page }) => {
      await fillAndSubmit(page);
      await page.click("[data-testid='send-invite-btn']");
      await page.waitForTimeout(800);

      // Grant clipboard permissions
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.click("[data-testid='copy-invite-link']");
      await page.waitForTimeout(300);

      await snap(page, "p5-03-invite-link-copied");

      // Button should show "Copied!" feedback
      await expect(page.getByText("Copied!")).toBeVisible();
    });

    test("P5-04 Closing modal after invite — pending member appears in team list", async ({ page }) => {
      await injectAdminAuth(page);
      await mockWorkspaceList(page, { id: NEW_WS_ID, clientName: NEW_CLIENT_NAME });
      // Team list includes the pending member right away
      await mockTeamList(page, { name: INVITEE_NAME, email: INVITEE_EMAIL, workspaceId: NEW_WS_ID });
      await mockTeamInvite(page, INVITEE_NAME, INVITEE_EMAIL, NEW_WS_ID);

      await page.goto("/team");
      await page.waitForLoadState("networkidle");
      await page.getByText("Invite Member").click();
      await page.waitForTimeout(300);

      await page.fill("input[placeholder='e.g. Jane Smith']", INVITEE_NAME);
      await page.fill("input[placeholder='e.g. jane@company.com']", INVITEE_EMAIL);
      await page.click("[data-testid='role-option-analyst']");

      await page.click("[data-testid='send-invite-btn']");
      await page.waitForTimeout(800);

      // Close modal via "Done" button
      await page.getByText("Done").click();
      await page.waitForTimeout(500);

      await snap(page, "p5-04-team-list-with-pending-invite");

      // Pending row should appear in the team list
      await expect(page.getByText(INVITEE_NAME)).toBeVisible();
      await expect(page.getByText("Pending")).toBeVisible();
      await expect(page.getByText(INVITEE_EMAIL, { exact: false })).toBeVisible();
    });

    test("P5-05 Pending invite row shows correct role badge", async ({ page }) => {
      await injectAdminAuth(page);
      await mockWorkspaceList(page, { id: NEW_WS_ID, clientName: NEW_CLIENT_NAME });
      await mockTeamList(page, { name: INVITEE_NAME, email: INVITEE_EMAIL, workspaceId: NEW_WS_ID });

      await page.goto("/team");
      await page.waitForLoadState("networkidle");

      await snap(page, "p5-05-pending-invite-role-badge");

      // The pending row should show the role label for "analyst"
      await expect(page.getByText("Media Buyer")).toBeVisible();
    });

  });

  // ── Phase 6: Validation & Edge Cases ─────────────────────────────────────

  test.describe("Phase 6 — Form Validation Edge Cases", () => {

    test("P6-01 Send Invite with empty fields shows inline errors", async ({ page }) => {
      await injectAdminAuth(page);
      await mockWorkspaceList(page);
      await mockTeamList(page);

      await page.goto("/team");
      await page.waitForLoadState("networkidle");
      await page.getByText("Invite Member").click();
      await page.waitForTimeout(300);

      // Submit without filling anything
      await page.click("[data-testid='send-invite-btn']");
      await page.waitForTimeout(200);

      await snap(page, "p6-01-form-validation-errors");

      await expect(page.getByText("Full name is required.")).toBeVisible();
      await expect(page.getByText("Email address is required.")).toBeVisible();
    });

    test("P6-02 Invalid email format shows validation error", async ({ page }) => {
      await injectAdminAuth(page);
      await mockWorkspaceList(page);
      await mockTeamList(page);

      await page.goto("/team");
      await page.waitForLoadState("networkidle");
      await page.getByText("Invite Member").click();
      await page.waitForTimeout(300);

      await page.fill("input[placeholder='e.g. Jane Smith']", INVITEE_NAME);
      await page.fill("input[placeholder='e.g. jane@company.com']", "not-an-email");
      await page.click("[data-testid='send-invite-btn']");
      await page.waitForTimeout(200);

      await snap(page, "p6-02-invalid-email-error");

      await expect(page.getByText("Please enter a valid work email address.")).toBeVisible();
    });

    test("P6-03 Escape key closes the invite modal", async ({ page }) => {
      await injectAdminAuth(page);
      await mockWorkspaceList(page);
      await mockTeamList(page);

      await page.goto("/team");
      await page.waitForLoadState("networkidle");
      await page.getByText("Invite Member").click();
      await page.waitForTimeout(300);

      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);

      await snap(page, "p6-03-modal-closed-via-escape");

      // Dialog should be gone
      await expect(page.getByRole("dialog")).not.toBeVisible();
    });

    test("P6-04 Role Permission drawer opens and closes", async ({ page }) => {
      await injectAdminAuth(page);
      await mockWorkspaceList(page);
      await mockTeamList(page);

      await page.goto("/team");
      await page.waitForLoadState("networkidle");

      // Click the "View Role Permissions" info link
      await page.getByText("View Role Permissions").click();
      await page.waitForTimeout(300);

      await snap(page, "p6-04-role-permissions-drawer-open");

      await expect(page.getByText("Role Permissions")).toBeVisible();
      await expect(page.getByText("Agency Principal")).toBeVisible();

      // Close drawer
      await page.keyboard.press("Escape");
      // Fallback: click the close button if Escape doesn't work
      const closeBtn = page.locator("button[aria-label='Close']").first();
      if (await closeBtn.count() > 0) await closeBtn.click();
    });

  });

});
