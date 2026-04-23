/**
 * dashboard-correctness.spec.ts
 * ─────────────────────────────
 * Pins the rendering contracts of the Performance & AI Logs dashboard.
 *
 * Each test seeds a deterministic fixture session — mocked auth via
 * localStorage (matches admin-provisioning.spec.ts and
 * agency-onboarding.spec.ts), an INR-headquartered workspace, an INR
 * FX rate marked `cache` (so the runtime trust gate doesn't degrade to
 * USD), a populated `/api/dashboard/unified-state` payload, a single
 * deterministic Performance Grid row, and a `navigator.language(s)`
 * override to `en-IN` set before any app code reads it.
 *
 * Several contracts intentionally FAIL on `main` today — they document
 * the bugs that task #142 will fix. Once that task lands, every
 * assertion here must hold.
 *
 * Contracts (matches the task plan in
 *   .local/tasks/dashboard-correctness-playwright-tests.md):
 *
 *   1. Currency — every monetary KPI tile starts with `₹`; the POAS
 *      explainer copy uses `₹1` not `$1`; every Spend cell in the
 *      Performance Grid starts with `₹`.
 *   2. Count formatting — count cells match `^[0-9,]+(\.[0-9])?[KMB]?$`.
 *   3. Greeting shape — `^Welcome back, [^']+$` (no possessive `'s`).
 *   4. Stale-data UX — at most ONE stale banner AND when visible the
 *      Margin-Leak Triage card never shows its "All clear" empty state.
 *   5. Magnitude casing — compact suffixes are consistent (all K/M/B or
 *      all k/m/b).
 *   6. Locale-aware dates — for an en-IN user, no rendered date uses US
 *      `M/D/YYYY` ordering anywhere on the page.
 *   7. Locale-aware sync timestamp — the Last sync surface explicitly
 *      contains the expected `DD/MM/YYYY` for the fixture timestamp.
 */

import { test, expect, type Page } from "@playwright/test";

// ─── Deterministic fixture clock ─────────────────────────────────────────────
//
// We pin the "last sync" timestamp to a known calendar date so contract
// #7 can assert against the literal `DD/MM/YYYY` string the dashboard
// must render under en-IN.

// 23 Mar 2026 — pinned to a date whose day-of-month is > 12 so the
// resulting DD/MM/YYYY string (`23/03/2026`) cannot collide with any
// valid M/D/YYYY parse. This is what lets the negative US-format check
// in contract #7 stay strict without false-positiving on the expected
// en-IN string.
const LAST_SYNC_AT_MS    = Date.UTC(2026, 2, 23, 8, 0, 0);
const LAST_SYNC_DDMMYYYY = "23/03/2026";

interface FixtureOpts {
  /** Display name written to localStorage. Greeting derives from the first token. */
  userName?: string;
  /** ISO currency code stored as the manual override. */
  currency?: string;
  /**
   * If set, overrides the fixture clock for the unified-state payload.
   * Defaults to LAST_SYNC_AT_MS so contract #7 can pin a literal date.
   */
  lastSyncedAtMs?: number;
}

async function injectFixtureSession(page: Page, opts: FixtureOpts = {}) {
  const { userName = "Aria Banerjee", currency = "INR" } = opts;
  await page.addInitScript(
    ({ userName, currency }) => {
      // Force navigator.language(s) so date formatters that pass `undefined`
      // resolve to en-IN. Set first so it's in place before any app code
      // reads it.
      Object.defineProperty(navigator, "language",  { configurable: true, get: () => "en-IN" });
      Object.defineProperty(navigator, "languages", { configurable: true, get: () => ["en-IN", "en"] });

      // Auth bypass — same shortcut used by the other two e2e specs.
      localStorage.setItem("omnianalytix_gate_token", "e2e-correctness-token");
      localStorage.setItem("omni_user_name", userName);
      localStorage.setItem("omni_user_email", "aria@example.in");
      localStorage.setItem("omni_user_role", "admin");
      localStorage.setItem("omni_preauth_complete", "true");
      localStorage.setItem("omni_onboarding_complete", "true");
      localStorage.setItem("omni_agency_setup_complete", "true");
      localStorage.setItem("omni_currency_override", currency);
    },
    { userName, currency },
  );
}

async function mockDashboardApis(page: Page, opts: FixtureOpts = {}) {
  const { currency = "INR", lastSyncedAtMs = LAST_SYNC_AT_MS } = opts;

  // Workspace list — INR-headquartered so even before the user override
  // is read, the resolution chain wants INR.
  await page.route(/\/api\/workspaces(\?|$|\/active)/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: 42,
          clientName: "Acme India",
          companyName: "Acme India",
          headquartersCountry: "IN",
          currency,
          goalType: "E-COMMERCE",
        },
      ]),
    }),
  );

  // FX rate — pretend USD→INR is ~83.5. `cache` (not `fallback`) keeps the
  // runtime trust gate from degrading the symbol back to `$`.
  await page.route(/\/api\/fx\/rates/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        rates: {
          [currency]: { rate: currency === "USD" ? 1 : 83.5, source: "cache", rateDate: "2026-04-20" },
        },
      }),
    }),
  );

  // Unified dashboard state — populated tenant, sync timestamp pinned for
  // contract #7. With a 9-day-old sync we are unambiguously STALE_DATA, so
  // exactly one stale banner should render (contract #4).
  await page.route(/\/api\/dashboard\/unified-state/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        syncState: "STALE_DATA",
        goalType: "E-COMMERCE",
        lastSyncedAt: lastSyncedAtMs,
        workspaceId: 42,
        workspaceName: "Acme India",
        ecommerce: {
          spendUsd: 12_345,
          revenueUsd: 67_890,
          cogsUsd: 23_456,
          trueProfitUsd: 32_089,
          poas: 2.6,
          conversions: 233, // integer — used by contract #2
          marginLeaks: [],
        },
        leadgen: null,
        meta: {
          computedAtMs: Date.now(),
          etlPhase: "idle",
          etlPct: 100,
          isStale: true,
        },
      }),
    }),
  );

  // Performance Grid — one deterministic campaign row so the per-column
  // currency and count assertions have a real cell to check. Schema is
  // `{ data, total_count, has_more, syncedAt }` (see performance-grid.tsx
  // lines 446–459).
  await page.route(/\/api\/warehouse\/channels/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: "camp_e2e_1",
            name: "E2E Fixture · Diwali Bundle",
            status: "ACTIVE",
            spend: 1_234.56,
            roas: 3.2,
            conversions: 87,
            cpa: 14.19,
            revenue: 3_950.59,
            clicks: 5_120,
            impressions: 412_000,
            ctr: 0.0124,
          },
        ],
        total_count: 1,
        has_more: false,
        syncedAt: lastSyncedAtMs,
      }),
    }),
  );

  // Bento side-fetches — empty-but-OK so a flaky network can't make a
  // formatting bug pass.
  await page.route(/\/api\/financials/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ records: [], totals: { totalRevenue: 0, totalNetIncome: 0 } }),
    }),
  );
  await page.route(/\/api\/tasks\/ops/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tasks: [], totals: { in_progress: 12, completed: 87 } }),
    }),
  );
  await page.route(/\/api\/etl\/crm-(leads|sales)/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ deals: [], reps: [], totals: {} }),
    }),
  );
  // Connections — Performance Grid gates its row rendering on at least
  // one ACTIVE connection (`activeConnCount > 0` in performance-grid.tsx).
  // Without this the grid drops to its "Connect Accounts" empty state and
  // our column-based contracts have no cells to assert against.
  await page.route(/\/api\/connections/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        connections: [
          {
            id: "conn_e2e_meta",
            provider: "meta_ads",
            isActive: true,
            displayName: "Meta Ads (E2E fixture)",
          },
        ],
      }),
    }),
  );
}

async function gotoDashboard(page: Page) {
  await page.goto("/");
  // Wait until the dashboard chrome is mounted before asserting on text —
  // otherwise we race the Suspense boundary. We watch for the "Welcome
  // back," greeting since that is rendered by AppShell unconditionally.
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/Welcome back,/).first()).toBeVisible({ timeout: 15_000 });
}

// Locate a `<Tile>` by its label and walk up to the rounded-2xl
// container that wraps the entire tile (Tile.tsx renders this consistently
// for every KPI tile). Throws if the tile isn't visible — tests are
// expected to know exactly which tiles their fixture renders.
function tileByLabel(page: Page, label: string) {
  return page
    .getByText(label, { exact: true })
    .first()
    .locator("xpath=ancestor::div[contains(@class,'rounded-2xl')][1]");
}

/**
 * Find the Performance Grid table (by locating any of the named column
 * headers), resolve each header's column index, then iterate every
 * `<tbody>` row and assert that the cell at that column index satisfies
 * `predicate`. Empty cells and the explicit no-data placeholder `—` are
 * skipped — they represent "no measurement", not a formatting violation.
 *
 * Fails loudly if the grid isn't rendered or any of the named headers
 * aren't found, so tests double as a smoke test for the grid mount.
 */
async function assertGridColumnsMatch(
  page: Page,
  headerNames: string[],
  predicate: (cell: string) => boolean,
  predicateLabel: string,
) {
  // Anchor on the first header name to find the table.
  const firstHeader = page.locator("th").filter({ hasText: new RegExp(`^${headerNames[0].replace(/\./g, "\\.")}$`) }).first();
  await expect(firstHeader, `Performance Grid header "${headerNames[0]}" must be visible`).toBeVisible({ timeout: 10_000 });
  const table   = firstHeader.locator("xpath=ancestor::table[1]");
  const headers = (await table.locator("thead th").allInnerTexts()).map((h) => h.trim());

  const dataRows = table.locator("tbody tr");
  const rowCount = await dataRows.count();
  expect(rowCount, "Performance Grid must render at least the seeded fixture row").toBeGreaterThan(0);

  const violations: Array<{ column: string; row: number; value: string }> = [];
  for (const name of headerNames) {
    const colIdx = headers.findIndex((h) => h === name);
    expect(colIdx, `Column "${name}" not found in Performance Grid headers: ${headers.join(" | ")}`).toBeGreaterThanOrEqual(0);
    for (let r = 0; r < rowCount; r++) {
      const cellText = (await dataRows.nth(r).locator("td").nth(colIdx).innerText()).trim();
      if (cellText === "—" || cellText === "") continue;
      if (!predicate(cellText)) violations.push({ column: name, row: r, value: cellText });
    }
  }
  expect(
    violations,
    `Every cell in [${headerNames.join(", ")}] ${predicateLabel}. Violations: ${JSON.stringify(violations)}`,
  ).toEqual([]);
}

// ─── Contract #1: Currency symbol honors the INR override ────────────────────

test.describe("Dashboard correctness — currency", () => {
  test("1.1 · with INR override, no `$`/`€` prefixed amounts appear anywhere", async ({ page }) => {
    await injectFixtureSession(page, { currency: "INR" });
    await mockDashboardApis(page, { currency: "INR" });
    await gotoDashboard(page);

    const body = (await page.locator("body").innerText()).replace(/[ \t]+/g, " ");
    expect(body).toContain("₹"); // proves FX pipeline reached the display layer

    expect(
      body.match(/\$\s?-?\d/g) ?? [],
      "Expected zero $-prefixed amounts under INR override",
    ).toEqual([]);
    expect(
      body.match(/€\s?-?\d/g) ?? [],
      "Expected zero €-prefixed amounts under INR override",
    ).toEqual([]);
  });

  test("1.2 · `Attributed Revenue` tile value starts with `₹`", async ({ page }) => {
    await injectFixtureSession(page, { currency: "INR" });
    await mockDashboardApis(page, { currency: "INR" });
    await gotoDashboard(page);

    const tile = tileByLabel(page, "Attributed Revenue");
    await expect(tile).toBeVisible({ timeout: 10_000 });
    const inner = (await tile.innerText()).trim().replace("Attributed Revenue", "").trim();
    expect(inner.startsWith("₹"), `Attributed Revenue value must start with ₹, saw: "${inner.slice(0, 60)}"`).toBe(true);
  });

  test("1.3 · `True Profit` tile value starts with `₹`", async ({ page }) => {
    await injectFixtureSession(page, { currency: "INR" });
    await mockDashboardApis(page, { currency: "INR" });
    await gotoDashboard(page);

    const tile = tileByLabel(page, "True Profit");
    await expect(tile).toBeVisible({ timeout: 10_000 });
    const inner = (await tile.innerText()).trim().replace("True Profit", "").trim();
    expect(inner.startsWith("₹"), `True Profit value must start with ₹, saw: "${inner.slice(0, 60)}"`).toBe(true);
  });

  test("1.3b · Performance Grid `Total Spend` summary value starts with `₹`", async ({ page }) => {
    await injectFixtureSession(page, { currency: "INR" });
    await mockDashboardApis(page, { currency: "INR" });
    await gotoDashboard(page);

    // The "Total Spend" summary cell is rendered at performance-grid.tsx:614
    // as `{sym}{fmt(totalSpend)}` directly under a "Total Spend" label.
    const label = page.getByText("Total Spend", { exact: true }).first();
    await expect(label).toBeVisible({ timeout: 10_000 });
    const card = label.locator("xpath=parent::*");
    const inner = (await card.innerText()).trim().replace("Total Spend", "").trim();
    // Strict: any rendered numeric value MUST start with ₹. The only
    // accepted non-currency-prefixed forms are the explicit no-data
    // placeholder (`—`) or an empty container (no value rendered yet).
    // A bare `0` without ₹ counts as a regression — it means the symbol
    // gate dropped on the zero-value path.
    expect(
      inner === "" || inner === "—" || inner.startsWith("₹"),
      `Total Spend summary must start with ₹ (or be empty/no-data), saw: "${inner.slice(0, 60)}"`,
    ).toBe(true);
  });

  test("1.4 · every monetary Performance Grid column (`Spend`, `CPA`, `Conv. Val.`) starts with `₹`", async ({ page }) => {
    await injectFixtureSession(page, { currency: "INR" });
    await mockDashboardApis(page, { currency: "INR" });
    await gotoDashboard(page);

    await assertGridColumnsMatch(page, ["Spend", "CPA", "Conv. Val."], (cell) =>
      cell.startsWith("₹"),
      "must start with ₹",
    );
  });

  test("1.5 · POAS explainer copy uses the workspace currency, not `$1`", async ({ page }) => {
    await injectFixtureSession(page, { currency: "INR" });
    await mockDashboardApis(page, { currency: "INR" });
    await gotoDashboard(page);

    const tile = tileByLabel(page, "Profit on Ad Spend (POAS)");
    await expect(tile).toBeVisible({ timeout: 10_000 });
    const inner = (await tile.innerText()).trim();

    // Negative: no hardcoded `$1`/`€1` foreign-currency reference.
    expect(inner, `POAS explainer must not contain hardcoded "$1" — saw: "${inner}"`).not.toMatch(/\$\s?1\b/);
    expect(inner).not.toMatch(/€\s?1\b/);

    // Positive: the explainer must reference the workspace currency. If
    // the helper sentence about "ad spend" is present, it must include
    // `₹1` (or `₹ 1`) — a bare `1 in ad spend` without the symbol is
    // also a bug (means the symbol substitution dropped instead of being
    // localised).
    if (/ad spend/i.test(inner)) {
      expect(
        inner,
        `POAS explainer mentions ad spend but lacks the workspace currency "₹1": "${inner}"`,
      ).toMatch(/₹\s?1\b/);
    }
  });
});

// ─── Contract #2: Count cells match the integer/compact regex ────────────────

const COUNT_VALUE_RE = /^[0-9,]+(?:\.[0-9])?[KMB]?$/;

test.describe("Dashboard correctness — count formatting", () => {
  // The task plan (.local/tasks/dashboard-correctness-playwright-tests.md
  // step 3) lists "Conversions, Clicks aggregate, Active SKUs" as the
  // canonical count surfaces. In the current OmniAnalytix UI the equivalent
  // visible columns are `Conv.` (Conversions), `Clicks` (Clicks aggregate)
  // and `Impr.` (Impressions). There is no "Active SKUs" column on the
  // Performance dashboard today — `Active SKUs` only appears in the
  // standalone `feed-enrichment` page (src/pages/feed-enrichment.tsx),
  // which is not in scope for this dashboard contract suite. If/when an
  // Active SKUs cell lands on the Performance dashboard, add its column
  // header to the array below.
  test("2.1 · every count column in the Performance Grid (`Conv.`, `Clicks`, `Impr.`) matches the count regex", async ({ page }) => {
    await injectFixtureSession(page);
    await mockDashboardApis(page);
    await gotoDashboard(page);

    await assertGridColumnsMatch(page, ["Conv.", "Clicks", "Impr."], (cell) =>
      COUNT_VALUE_RE.test(cell),
      `must match ${COUNT_VALUE_RE}`,
    );
  });

  // Active SKUs is one of the count surfaces the task plan asks us to
  // pin. It is not currently rendered on the Performance & AI Logs
  // dashboard (only on `feed-enrichment`), so this assertion is
  // INTENTIONALLY RED on `main` — it documents the missing surface as
  // one of the contract gaps task #142 will fix (either by adding the
  // surface here or by formally scoping it out in the task acceptance
  // criteria). Per the task plan's "spec intentionally fails on main"
  // directive, we enforce the contract rather than skip it.
  test("2.3 · `Active SKUs` count surface is present and matches the count regex", async ({ page }) => {
    await injectFixtureSession(page);
    await mockDashboardApis(page);
    await gotoDashboard(page);

    const label = page.getByText(/^Active SKUs$/i).first();
    await expect(
      label,
      "Expected an `Active SKUs` count surface on the Performance & AI Logs dashboard. " +
        "Either add the surface (task #142) or formally remove it from the contract list.",
    ).toBeVisible({ timeout: 10_000 });

    // Once the surface exists, its value must satisfy the count regex
    // (no raw floats, no currency symbol, optional K/M/B compact suffix).
    const card = label.locator("xpath=ancestor-or-self::*[self::div or self::section or self::p][1]");
    const text = (await card.innerText()).replace(/\s+/g, " ").trim();
    const value = text.replace(/Active SKUs/i, "").trim();
    expect(
      COUNT_VALUE_RE.test(value),
      `Active SKUs value must match ${COUNT_VALUE_RE}, saw: "${value}"`,
    ).toBe(true);
  });

  test("2.2 · the page contains no raw-float drift (>=4 trailing decimals)", async ({ page }) => {
    await injectFixtureSession(page);
    await mockDashboardApis(page);
    await gotoDashboard(page);

    const driftMatches = (await page.locator("body").innerText()).match(/\b\d{1,4}\.\d{4,}\b/g) ?? [];
    expect(
      driftMatches,
      `Found raw-float drift on the page (>=4 decimals): ${driftMatches.join(", ")}`,
    ).toEqual([]);
  });
});

// ─── Contract #3: Greeting shape ─────────────────────────────────────────────

test.describe("Dashboard correctness — greeting", () => {
  test("3.1 · greeting matches `^Welcome back, [^']+$` (no possessive `'s`)", async ({ page }) => {
    await injectFixtureSession(page, { userName: "Aria Banerjee" });
    await mockDashboardApis(page);
    await gotoDashboard(page);

    const greeting = page.getByText(/Welcome back,/).first();
    await expect(greeting).toBeVisible();
    const text = (await greeting.textContent())!.trim();
    expect(text, `Greeting must match "^Welcome back, [^']+$" — saw: "${text}"`).toMatch(/^Welcome back, [^']+$/);
  });
});

// ─── Contract #4: Stale banner uniqueness AND no contradictory all-clear ─────

test.describe("Dashboard correctness — stale data UX", () => {
  test("4.1 · at most one stale-banner element, and it never coexists with `All clear`", async ({ page }) => {
    await injectFixtureSession(page);
    await mockDashboardApis(page);
    await gotoDashboard(page);

    // Count actual banner ELEMENTS, not text-fragment occurrences. The
    // canonical stale headlines are "Data may be stale" (the global
    // EmptyStateForSyncState title at line 68) and "Data Stale:" (the
    // per-card warning row used by MarginLeaks_Triage and CRMSync_Triage
    // at line 38 of each).
    const staleBanners = page.getByText(/^(Data may be stale|Data Stale:)/);
    const bannerCount  = await staleBanners.count();
    expect(
      bannerCount,
      `Expected ≤ 1 stale-data banner ELEMENT on the page, found ${bannerCount}`,
    ).toBeLessThanOrEqual(1);

    // Mutual-exclusion: if a stale banner is present, the Margin-Leak
    // Triage card must NOT also render its "All clear / no margin leaks
    // detected" empty state — the two states contradict each other.
    if (bannerCount >= 1) {
      const allClear = page.getByText(/all clear|no margin leaks detected|every sku.*profitable/i);
      const allClearCount = await allClear.count();
      expect(
        allClearCount,
        `Stale banner is showing — "All clear" empty state must be suppressed (found ${allClearCount}).`,
      ).toBe(0);
    }
  });
});

// ─── Contract #5: Magnitude suffix casing is consistent ──────────────────────

test.describe("Dashboard correctness — magnitude casing", () => {
  test("5.1 · K/M/B suffixes are not mixed-case within the same view", async ({ page }) => {
    await injectFixtureSession(page);
    await mockDashboardApis(page);
    await gotoDashboard(page);

    const body = await page.locator("body").innerText();
    const upperK = (body.match(/\d[\d,.]*K\b/g) ?? []).length;
    const lowerK = (body.match(/\d[\d,.]*k\b/g) ?? []).length;
    const upperM = (body.match(/\d[\d,.]*M\b/g) ?? []).length;
    const lowerM = (body.match(/\d[\d,.]*m\b/g) ?? []).length;
    const upperB = (body.match(/\d[\d,.]*B\b/g) ?? []).length;
    const lowerB = (body.match(/\d[\d,.]*b\b/g) ?? []).length;

    expect(upperK > 0 && lowerK > 0, `Mixed K casing: ${upperK} upper / ${lowerK} lower`).toBe(false);
    expect(upperM > 0 && lowerM > 0, `Mixed M casing: ${upperM} upper / ${lowerM} lower`).toBe(false);
    expect(upperB > 0 && lowerB > 0, `Mixed B casing: ${upperB} upper / ${lowerB} lower`).toBe(false);

    const upperTotal = upperK + upperM + upperB;
    const lowerTotal = lowerK + lowerM + lowerB;
    expect(
      upperTotal > 0 && lowerTotal > 0,
      `Mixed magnitude casing across K/M/B: ${upperTotal} upper / ${lowerTotal} lower`,
    ).toBe(false);
  });
});

// ─── Contract #6: en-IN dates — no US `M/D/YYYY` anywhere ───────────────────

test.describe("Dashboard correctness — locale-aware dates", () => {
  test("6.1 · for an en-IN user, no date uses US `M/D/YYYY` ordering", async ({ page }) => {
    await injectFixtureSession(page);
    await mockDashboardApis(page);
    await gotoDashboard(page);

    const body = await page.locator("body").innerText();
    // Scope to UNAMBIGUOUS US-format dates: month 1–12, day 13–31. A day
    // >12 cannot be a month, so any match is definitively M/D/YYYY and
    // cannot collide with valid DD/MM rendering.
    const usOnlyDates = body.match(/\b(0?[1-9]|1[0-2])\/(1[3-9]|2\d|3[01])\/(20\d{2})\b/g) ?? [];
    expect(
      usOnlyDates,
      `Expected no unambiguous M/D/YYYY-style dates under en-IN, got: ${usOnlyDates.join(", ")}`,
    ).toEqual([]);
  });
});

// ─── Contract #7: Last sync surface uses `DD/MM/YYYY` for en-IN ──────────────

test.describe("Dashboard correctness — sync timestamp localization", () => {
  test(`7.1 · the Last sync surface contains "${LAST_SYNC_DDMMYYYY}" under en-IN`, async ({ page }) => {
    await injectFixtureSession(page);
    await mockDashboardApis(page); // lastSyncedAt = LAST_SYNC_AT_MS by default
    await gotoDashboard(page);

    // Locate every visible "Last sync" / "Synced" / "Warehouse synced"
    // anchor element, then walk one level up to its container so that
    // labels rendered across multiple lines (label on one line, date on
    // the next) are still captured by `innerText`. This is more robust
    // than splitting the body on `\n` and trying to keep adjacent lines
    // together.
    const anchors = page.getByText(/Last sync|Warehouse synced|^Synced /i);
    const anchorCount = await anchors.count();
    expect(anchorCount, "expected at least one Last sync anchor on the page").toBeGreaterThan(0);

    let foundExpected = false;
    const containerTexts: string[] = [];
    for (let i = 0; i < anchorCount; i++) {
      const container = anchors.nth(i).locator("xpath=ancestor-or-self::*[self::div or self::section or self::p][1]");
      // innerText collapses runs of whitespace including line breaks into
      // single spaces, so a label/date split across lines still reads as
      // one continuous string for substring matching.
      const text = (await container.innerText()).replace(/\s+/g, " ").trim();
      containerTexts.push(text);
      if (text.includes(LAST_SYNC_DDMMYYYY)) foundExpected = true;

      // Negative on the same surface: never US M/D/YYYY (day > 12 ⇒
      // unambiguous), never en-US "Mon DD" ordering.
      expect(text, `Last sync surface uses unambiguous US M/D/YYYY date: "${text}"`)
        .not.toMatch(/\b(0?[1-9]|1[0-2])\/(1[3-9]|2\d|3[01])\/(20\d{2})\b/);
      expect(text, `Last sync surface uses en-US "Mon DD" ordering: "${text}"`)
        .not.toMatch(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\b/);
    }

    // Positive: the literal DD/MM/YYYY for the fixture timestamp must
    // appear inside at least one Last sync container. The fix in task
    // #142 must surface the absolute date in en-IN's DD/MM/YYYY format.
    expect(
      foundExpected,
      `Expected at least one Last sync surface to include "${LAST_SYNC_DDMMYYYY}". Surfaces found: ${JSON.stringify(containerTexts)}`,
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Contracts #8–12: Task #154 — New dashboard surfaces smoke test
// ═══════════════════════════════════════════════════════════════════════════
//
// These contracts cover the five acceptance criteria from task #154:
//   8. PoP pills render with correct polarity (higher-is-better vs lower)
//   9. "Trigger Fresh Sync" only shows when sync is > 24 h stale
//  10. Profit trend chart renders without console errors
//  11. Margin-Leak triage modal opens and closes from the Active SKUs tile
//  12. Performance-grid hide-inactive toggle hides/shows correct rows
//
// The fixture API shape hits /api/warehouse/kpis (current + prior period),
// /api/warehouse/margin-leaks, and /api/warehouse/channels to match the
// actual authFetch calls in ecommerce-dashboard.tsx.

const NOW_MS = Date.UTC(2026, 3, 21, 12, 0, 0); // 21 Apr 2026 12:00 UTC

/** Mount warehouse endpoint mocks used by the actual dashboard authFetch calls. */
async function mockWarehouseApis(
  page: Page,
  overrides: {
    latestAdsSyncAt?: string | null;
    hasData?: boolean;
    prevHasData?: boolean;
    currentSpend?: number;
    prevSpend?: number;
    currentRevenue?: number;
    prevRevenue?: number;
    leaks?: Array<{ campaignId: string; campaignName: string; productId: string; productName: string; lostMarginUsd: number }>;
    channels?: Array<{ id: string; name: string; status: string; spend: number; roas?: number; conversions?: number; clicks?: number; impressions?: number; cpa?: number; revenue?: number; ctr?: number }>;
  } = {},
) {
  const {
    latestAdsSyncAt = new Date(NOW_MS - 2 * 60 * 60 * 1000).toISOString(), // 2h ago — fresh
    hasData       = true,
    prevHasData   = true,
    currentSpend  = 12_000,
    prevSpend     = 10_000,
    currentRevenue = 50_000,
    prevRevenue    = 40_000,
    leaks = [],
    channels = [
      { id: "camp_1", name: "Diwali Bundle (Active)", status: "ENABLED", spend: 5_000, roas: 4.2, conversions: 87, clicks: 3_100, impressions: 200_000, cpa: 57.47, revenue: 21_000, ctr: 0.0155 },
      { id: "camp_2", name: "Clearance (Paused, no spend)", status: "PAUSED", spend: 0, roas: 0, conversions: 0, clicks: 0, impressions: 0, cpa: 0, revenue: 0, ctr: 0 },
    ],
  } = overrides;

  const kpiBody = (spend: number, revenue: number, has: boolean) =>
    JSON.stringify({
      hasData: has,
      totalSpend: spend,
      estimatedRevenue: revenue,
      roas: has ? revenue / spend : 0,
      latestAdsSyncAt,
      lastSyncedAt: NOW_MS - 2 * 60 * 60 * 1000,
    });

  // Current-period KPIs
  await page.route(/\/api\/warehouse\/kpis.*(?<!from=)$/, (route, request) => {
    const url = request.url();
    // prior-period requests contain `from=` and `to=` query params
    if (url.includes("from=")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: kpiBody(prevSpend, prevRevenue, prevHasData),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: kpiBody(currentSpend, currentRevenue, hasData),
    });
  });

  // Margin-leak feed
  await page.route(/\/api\/warehouse\/margin-leaks/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: leaks }),
    }),
  );

  // Campaigns (mini-bento cards)
  await page.route(/\/api\/warehouse\/campaigns/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ campaigns: channels }),
    }),
  );

  // Performance-grid channels
  await page.route(/\/api\/warehouse\/channels/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: channels,
        total_count: channels.length,
        has_more: false,
        syncedAt: NOW_MS - 2 * 60 * 60 * 1000,
      }),
    }),
  );

  // Economics — return null defaults so the tenant COGS/ROAS fallback applies
  await page.route(/\/api\/settings\/economics/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ cogsPct: null, targetRoas: null, campaignOverrides: {} }),
    }),
  );
}

// ─── Contract #8: PoP pill polarity ──────────────────────────────────────────
//
// PoPBadge now emits `data-testid="pop-badge"` and `data-good="true|false"`.
// data-good="true"  → green, good outcome for this metric's polarity
// data-good="false" → red,   bad  outcome

test.describe("Dashboard correctness — PoP pill polarity (Task #154)", () => {
  test("8.1 · revenue increase renders data-good=true (higher-is-better polarity)", async ({ page }) => {
    await injectFixtureSession(page);
    await mockDashboardApis(page);
    await mockWarehouseApis(page, { currentRevenue: 50_000, prevRevenue: 40_000 }); // +25%
    await gotoDashboard(page);

    // At least one PoP badge must be marked good (revenue went up, ROAS up, etc.)
    const goodBadge = page.locator('[data-testid="pop-badge"][data-good="true"]').first();
    await expect(goodBadge).toBeVisible({ timeout: 10_000 });
    // The good badge aria-label should contain a positive percentage
    const label = (await goodBadge.getAttribute("aria-label")) ?? "";
    expect(label, `Expected a positive aria-label on good badge, got "${label}"`).toMatch(/\+\d/);
  });

  test("8.2 · spend increase renders data-good=false (lower-is-better polarity)", async ({ page }) => {
    await injectFixtureSession(page);
    await mockDashboardApis(page);
    // Spend rose +20%, revenue flat — only the spend tile should show data-good=false
    await mockWarehouseApis(page, {
      currentSpend: 12_000, prevSpend: 10_000,
      currentRevenue: 40_000, prevRevenue: 40_000, // flat revenue → no good badge there either
    });
    await gotoDashboard(page);

    // The spend badge specifically must be marked bad (spend increase = bad)
    // Find the total spend tile, then its PoP badge
    const spendTileLabel = page.getByText(/Total Spend|Ad Spend/i).first();
    await expect(spendTileLabel).toBeVisible({ timeout: 10_000 });
    const spendTile = spendTileLabel.locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
    const spendBadge = spendTile.locator('[data-testid="pop-badge"]').first();
    await expect(spendBadge).toBeVisible({ timeout: 5_000 });
    const goodAttr = await spendBadge.getAttribute("data-good");
    expect(goodAttr, `Spend increase must be marked bad (data-good=false), got "${goodAttr}"`).toBe("false");
  });

  test("8.3 · when no prior data is available, badge shows `No prior data` neutral state", async ({ page }) => {
    await injectFixtureSession(page);
    await mockDashboardApis(page);
    // Override: prior-period has no data
    await mockWarehouseApis(page, { prevHasData: false });
    await gotoDashboard(page);

    // At least one "No prior data" pill should be visible somewhere on the page
    const neutral = page.getByText("No prior data").first();
    await expect(neutral).toBeVisible({ timeout: 10_000 });
  });
});

// ─── Contract #9: Trigger Fresh Sync button gating ───────────────────────────

test.describe("Dashboard correctness — Fresh Sync button (Task #154)", () => {
  test("9.1 · Trigger Fresh Sync button is hidden when data is fresh (< 24h)", async ({ page }) => {
    await injectFixtureSession(page);
    await mockDashboardApis(page);
    // Fresh sync 2h ago
    await mockWarehouseApis(page, {
      latestAdsSyncAt: new Date(NOW_MS - 2 * 60 * 60 * 1_000).toISOString(),
    });
    await gotoDashboard(page);

    const btn = page.getByTestId("trigger-fresh-sync");
    // Button must NOT be visible — fresh data should not show the stale CTA.
    await expect(btn).not.toBeVisible();
  });

  test("9.2 · Trigger Fresh Sync button appears when sync is > 24h old", async ({ page }) => {
    await injectFixtureSession(page);
    await mockDashboardApis(page);
    // Stale: 25h ago
    await mockWarehouseApis(page, {
      latestAdsSyncAt: new Date(NOW_MS - 25 * 60 * 60 * 1_000).toISOString(),
    });
    await gotoDashboard(page);

    const btn = page.locator('[data-testid="trigger-fresh-sync"]');
    await expect(btn).toBeVisible({ timeout: 10_000 });
    await expect(btn).toContainText("Trigger Fresh Sync");
  });
});

// ─── Contract #10: Profit trend chart renders without console errors ──────────

test.describe("Dashboard correctness — Profit trend chart (Task #154)", () => {
  test("10.1 · profit trend chart renders without console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await injectFixtureSession(page);
    await mockDashboardApis(page);
    await mockWarehouseApis(page);
    await gotoDashboard(page);

    // Wait for chart container — ProfitTrendChart uses a Recharts wrapper that
    // renders inside a div the parent component identifies via the heading.
    await page.waitForTimeout(2_000); // Allow Recharts to render asynchronously

    // Filter out known-harmless network errors (BigQuery / external service
    // calls that legitimately fail in a mocked environment).
    const dashboardErrors = consoleErrors.filter(
      (e) =>
        !e.includes("BigQuery") &&
        !e.includes("ERR_FAILED") &&
        !e.includes("net::ERR") &&
        !e.includes("Failed to fetch") &&
        !e.includes("AbortError"),
    );

    expect(
      dashboardErrors,
      `Unexpected console errors during dashboard render: ${dashboardErrors.join("\n")}`,
    ).toEqual([]);
  });
});

// ─── Contract #11: Margin-Leak triage modal ──────────────────────────────────

test.describe("Dashboard correctness — Margin-Leak modal (Task #154)", () => {
  test("11.1 · triage modal opens from the Active SKUs tile when leaks are present", async ({ page }) => {
    await injectFixtureSession(page);
    await mockDashboardApis(page);
    await mockWarehouseApis(page, {
      leaks: [
        { campaignId: "camp_1", campaignName: "Diwali Bundle", productId: "sku_1", productName: "Widget A", lostMarginUsd: 320 },
      ],
    });
    await gotoDashboard(page);

    // The Active SKUs tile click handler calls setTriageOpen(true) — look for
    // the tile then click it.
    const activeSKUsTrigger = page.getByText(/Active SKUs|Margin.?Leak|SKU triage/i).first();
    await expect(activeSKUsTrigger).toBeVisible({ timeout: 10_000 });
    await activeSKUsTrigger.click();

    // The modal renders with a role="dialog" once open.
    const modal = page.getByRole("dialog").first();
    await expect(modal).toBeVisible({ timeout: 5_000 });
  });

  test("11.2 · triage modal closes when the close/dismiss control is clicked", async ({ page }) => {
    await injectFixtureSession(page);
    await mockDashboardApis(page);
    await mockWarehouseApis(page, {
      leaks: [
        { campaignId: "camp_1", campaignName: "Diwali Bundle", productId: "sku_1", productName: "Widget A", lostMarginUsd: 320 },
      ],
    });
    await gotoDashboard(page);

    const activeSKUsTrigger = page.getByText(/Active SKUs|Margin.?Leak|SKU triage/i).first();
    await expect(activeSKUsTrigger).toBeVisible({ timeout: 10_000 });
    await activeSKUsTrigger.click();

    const modal = page.getByRole("dialog").first();
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Close via the Escape key (universally supported by Radix Dialog)
    await page.keyboard.press("Escape");
    await expect(modal).not.toBeVisible({ timeout: 3_000 });
  });
});

// ─── Contract #12: Performance-grid hide-inactive toggle ─────────────────────

test.describe("Dashboard correctness — hide-inactive toggle (Task #154)", () => {
  test("12.1 · by default, PAUSED zero-spend campaigns are hidden from the grid", async ({ page }) => {
    await injectFixtureSession(page);
    await mockDashboardApis(page);
    await mockWarehouseApis(page, {
      channels: [
        { id: "camp_active", name: "Diwali Bundle (Active)", status: "ENABLED", spend: 5_000 },
        { id: "camp_paused", name: "Clearance (Paused)", status: "PAUSED", spend: 0 },
      ],
    });
    await gotoDashboard(page);

    // Active row must be visible
    await expect(page.getByText("Diwali Bundle (Active)")).toBeVisible({ timeout: 10_000 });

    // Paused row must be absent by default (hideInactive defaults to true)
    await expect(page.getByText("Clearance (Paused)")).not.toBeVisible();
  });

  test("12.2 · toggling off hide-inactive reveals the PAUSED zero-spend row", async ({ page }) => {
    await injectFixtureSession(page);
    await mockDashboardApis(page);
    await mockWarehouseApis(page, {
      channels: [
        { id: "camp_active", name: "Diwali Bundle (Active)", status: "ENABLED", spend: 5_000 },
        { id: "camp_paused", name: "Clearance (Paused)", status: "PAUSED", spend: 0 },
      ],
    });
    await gotoDashboard(page);

    // Toggle the hide-inactive button — deterministic selector via data-testid
    const toggle = page.locator('[data-testid="toggle-inactive-campaigns"]').first();
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await toggle.click();

    // After toggling, the paused row must become visible
    await expect(page.getByText("Clearance (Paused)")).toBeVisible({ timeout: 5_000 });
  });

  test("12.3 · PAUSED campaign with spend > 0 remains visible even when hide-inactive is on", async ({ page }) => {
    await injectFixtureSession(page);
    await mockDashboardApis(page);
    await mockWarehouseApis(page, {
      channels: [
        { id: "camp_spending_paused", name: "Spending Paused Campaign", status: "PAUSED", spend: 250 },
      ],
    });
    await gotoDashboard(page);

    // This campaign is paused but still has spend > 0, so it should NOT be
    // hidden by the hide-inactive filter (only zero-spend paused rows are hidden).
    await expect(page.getByText("Spending Paused Campaign")).toBeVisible({ timeout: 10_000 });
  });
});

// ─── Contract #13: Revenue and ROAS column header sorting (Task #216) ─────────
//
// Verifies that clicking the Revenue and ROAS column headers in the Performance
// Grid correctly sorts rows client-side. The fixture uses the `revenue` field
// (no legacy `convValue`) as established by Task #155.
//
// Fixture ROAS:    Alpha=4.2, Beta=1.5, Gamma=2.8
// Fixture revenue: Alpha=3 000, Beta=10 000, Gamma=7 500

const SORT_FIXTURE_CHANNELS = [
  {
    id: "sort_alpha",
    name: "Alpha Campaign",
    status: "ACTIVE",
    spend: 2_000,
    roas: 4.2,
    revenue: 3_000,
    conversions: 20,
    clicks: 800,
    impressions: 50_000,
    cpa: 100,
    ctr: 0.016,
  },
  {
    id: "sort_beta",
    name: "Beta Campaign",
    status: "ACTIVE",
    spend: 3_000,
    roas: 1.5,
    revenue: 10_000,
    conversions: 30,
    clicks: 1_200,
    impressions: 80_000,
    cpa: 100,
    ctr: 0.015,
  },
  {
    id: "sort_gamma",
    name: "Gamma Campaign",
    status: "ACTIVE",
    spend: 1_000,
    roas: 2.8,
    revenue: 7_500,
    conversions: 10,
    clicks: 500,
    impressions: 30_000,
    cpa: 100,
    ctr: 0.017,
  },
];

/**
 * Override the /api/warehouse/channels route with SORT_FIXTURE_CHANNELS.
 * Must be called AFTER mockDashboardApis so this handler takes precedence
 * (Playwright serves the most-recently-registered handler first).
 */
async function mockSortChannels(page: Page) {
  await page.route(/\/api\/warehouse\/channels/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: SORT_FIXTURE_CHANNELS,
        total_count: SORT_FIXTURE_CHANNELS.length,
        has_more: false,
        syncedAt: Date.now(),
      }),
    }),
  );
}

/**
 * Return the campaign names from the Performance Grid tbody in their current
 * DOM order. Anchors on the "Campaign" column header (same ancestry pattern
 * as `assertGridColumnsMatch`) to target the specific Performance Grid table
 * rather than the first table on the page.
 */
async function getGridRowNames(page: Page): Promise<string[]> {
  const campaignHeader = page
    .locator("th")
    .filter({ hasText: /^Campaign$/ })
    .first();
  await expect(
    campaignHeader,
    'Performance Grid "Campaign" header must be visible',
  ).toBeVisible({ timeout: 10_000 });
  const table = campaignHeader.locator("xpath=ancestor::table[1]");
  const rows = table.locator("tbody tr");
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  const count = await rows.count();
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const name = (await rows.nth(i).locator("td").first().innerText()).trim();
    names.push(name);
  }
  return names;
}

test.describe("Dashboard correctness — Revenue and ROAS column sort (Task #216)", () => {
  test("13.1 · clicking Revenue header sorts rows by revenue descending then ascending", async ({ page }) => {
    await injectFixtureSession(page);
    await mockDashboardApis(page);
    // Register after mockDashboardApis so this channels mock takes precedence.
    await mockSortChannels(page);
    await gotoDashboard(page);

    // Wait until fixture data is rendered.
    await expect(page.getByText("Alpha Campaign")).toBeVisible({ timeout: 15_000 });

    // First click → sort by revenue desc.
    // Beta=10 000, Gamma=7 500, Alpha=3 000
    const revenueHeader = page.locator("th").filter({ hasText: /^Revenue$/ }).first();
    await expect(revenueHeader).toBeVisible({ timeout: 5_000 });
    await revenueHeader.click();

    let order = await getGridRowNames(page);
    expect(
      order,
      `After first Revenue click (desc), expected [Beta, Gamma, Alpha], got ${JSON.stringify(order)}`,
    ).toEqual(["Beta Campaign", "Gamma Campaign", "Alpha Campaign"]);

    // Second click → sort by revenue asc.
    // Alpha=3 000, Gamma=7 500, Beta=10 000
    await revenueHeader.click();
    order = await getGridRowNames(page);
    expect(
      order,
      `After second Revenue click (asc), expected [Alpha, Gamma, Beta], got ${JSON.stringify(order)}`,
    ).toEqual(["Alpha Campaign", "Gamma Campaign", "Beta Campaign"]);
  });

  test("13.2 · clicking ROAS header sorts rows by roas descending then ascending", async ({ page }) => {
    await injectFixtureSession(page);
    await mockDashboardApis(page);
    await mockSortChannels(page);
    await gotoDashboard(page);

    await expect(page.getByText("Alpha Campaign")).toBeVisible({ timeout: 15_000 });

    // First click → sort by roas desc.
    // Alpha=4.2, Gamma=2.8, Beta=1.5
    const roasHeader = page.locator("th").filter({ hasText: /^ROAS$/ }).first();
    await expect(roasHeader).toBeVisible({ timeout: 5_000 });
    await roasHeader.click();

    let order = await getGridRowNames(page);
    expect(
      order,
      `After first ROAS click (desc), expected [Alpha, Gamma, Beta], got ${JSON.stringify(order)}`,
    ).toEqual(["Alpha Campaign", "Gamma Campaign", "Beta Campaign"]);

    // Second click → sort by roas asc.
    // Beta=1.5, Gamma=2.8, Alpha=4.2
    await roasHeader.click();
    order = await getGridRowNames(page);
    expect(
      order,
      `After second ROAS click (asc), expected [Beta, Gamma, Alpha], got ${JSON.stringify(order)}`,
    ).toEqual(["Beta Campaign", "Gamma Campaign", "Alpha Campaign"]);
  });

  test("13.3 · Revenue sort uses the `revenue` field — no legacy `convValue` regression", async ({ page }) => {
    // Confirms the fixture shape omits the old `convValue` field. If the
    // component regressed to `convValue` as the key, all revenue values would
    // resolve to null and rows would not be meaningfully reordered by this sort.
    await injectFixtureSession(page);
    await mockDashboardApis(page);
    await mockSortChannels(page);
    await gotoDashboard(page);

    await expect(page.getByText("Alpha Campaign")).toBeVisible({ timeout: 15_000 });

    const revenueHeader = page.locator("th").filter({ hasText: /^Revenue$/ }).first();
    await revenueHeader.click();

    const order = await getGridRowNames(page);

    // Beta has the highest revenue (10 000) — must be first under desc sort.
    expect(
      order[0],
      `Highest-revenue campaign "Beta Campaign" must be first after Revenue sort (desc). Got: ${JSON.stringify(order)}`,
    ).toBe("Beta Campaign");

    // Alpha has the lowest revenue (3 000) — must be last under desc sort.
    expect(
      order[order.length - 1],
      `Lowest-revenue campaign "Alpha Campaign" must be last after Revenue sort (desc). Got: ${JSON.stringify(order)}`,
    ).toBe("Alpha Campaign");
  });
});
