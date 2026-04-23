# OmniAnalytix — Playwright E2E suite

End-to-end tests live in this directory. Every spec runs in Chromium under the
config at `../playwright.config.ts` and points at `APP_URL` (defaults to the
local Replit dev preview at `http://localhost:25974/ecom-agent`).

## Running

```bash
# All specs (CI uses this exact alias)
pnpm --filter @workspace/ecom-agent run e2e

# A single file
pnpm --filter @workspace/ecom-agent run e2e -- dashboard-correctness

# Headed, for visual debugging
pnpm --filter @workspace/ecom-agent run test:e2e:headed
```

CI runs the same `e2e` script after building both `api-server` and
`ecom-agent` (see `.github/workflows/ci.yml`). The CI job runs inside the
official `mcr.microsoft.com/playwright:v1.59.1-jammy` Docker image so we
don't have to install browsers on bare ubuntu-latest. Any failing spec
blocks the deployment.

## Auth shortcut

Production auth uses Google SSO, which cannot be automated in a real browser
test. Every spec mocks the post-auth state by writing the same localStorage
keys the gate writes after a successful sign-in:

| Key                              | Purpose                                     |
| -------------------------------- | ------------------------------------------- |
| `omnianalytix_gate_token`        | Bearer token attached by `authFetch`        |
| `omni_user_name`                 | Display name; first token drives greeting   |
| `omni_user_email`, `omni_user_role` | Profile + RBAC                            |
| `omni_preauth_complete`          | Skip the email/whitelist gate               |
| `omni_onboarding_complete`       | Skip the goal/tech-stack/API wizard         |
| `omni_agency_setup_complete`     | Skip the agency setup wizard                |
| `omni_currency_override`         | Force the display currency (`INR`, etc.)    |

See `dashboard-correctness.spec.ts → injectFixtureSession` for the canonical
helper.

## Accessibility regression guard

`a11y.spec.ts` sweeps five WCAG 2.1 AA surfaces with axe-core on every CI run
(and locally via `pnpm --filter @workspace/ecom-agent run test:a11y`). The five
surfaces are: **home**, **executive-brief**, **feed-enrichment**, **connections**,
and **workspace-settings**.

### Running locally

```bash
# Install the Chromium browser once (skip if already installed)
npx playwright install chromium

pnpm --filter @workspace/ecom-agent run test:a11y
```

The dedicated config (`playwright.a11y.config.ts`) auto-starts the Vite dev
server on port 25974 when none is already running, so no extra setup is needed.

### What to do when the guard fires in CI

The job name is **"Accessibility (axe-core, WCAG 2.1 AA)"** in the GitHub
Actions summary. A failure means axe-core found at least one NEW violation —
either a rule that was previously clean, or an existing rule whose affected-node
count grew past the value in `e2e/a11y-baseline.json`.

**Option A — Fix the source (preferred)**

Resolve the contrast/label/ARIA issue that the failing rule describes. The
failure output lists the exact CSS selector(s) so you can find the element
quickly. Once fixed, the check will pass automatically.

**Option B — Bump the baseline (last resort)**

If the violation is intentional, is tracked in a follow-up task, and cannot be
addressed before the PR merges, add (or update) the rule's node count in
`e2e/a11y-baseline.json` under the affected route path:

```json
{
  "/ecom-agent/": {
    "color-contrast": 2
  }
}
```

`a11y-baseline.json` is strict JSON — no inline comments. Record the tracking
task number in the PR description so the entry has a clear owner and can be
trimmed once the task lands.

**Do not raise the baseline without a tracking task.** Untracked baseline bumps
hide regressions and defeat the purpose of the guard.

## Specs

| File                              | What it pins                                           |
| --------------------------------- | ------------------------------------------------------ |
| `a11y.spec.ts`                    | WCAG 2.1 AA axe-core sweep of the five audited surfaces |
| `agency-onboarding.spec.ts`       | Landing page + post-auth onboarding wizard journey    |
| `admin-provisioning.spec.ts`      | Admin-only flows for provisioning new agencies        |
| `dashboard-correctness.spec.ts`   | Seven rendering contracts on the Performance dashboard |

### Dashboard correctness contracts

`dashboard-correctness.spec.ts` is the contract suite for the Performance &
AI Logs dashboard. Each test seeds a deterministic fixture session (mocked
auth + workspace + `/api/dashboard/unified-state` payload + FX rate) and then
asserts a single formatting invariant. The seven contracts are:

1. **Currency symbol** — when the user has selected INR:
   - The `Attributed Revenue` and `True Profit` KPI tiles must each render
     a value that starts with `₹` (or the no-data placeholder `—`).
   - Every cell in the Performance Grid's `Spend`, `CPA`, and `Conv. Val.`
     columns must start with `₹`.
   - The `Profit on Ad Spend (POAS)` tile must contain no hardcoded `$1`.
   - No `$`/`€` prefixed amount appears anywhere on the page.
2. **Count formatting** — every cell in the Performance Grid's `Conv.`,
   `Clicks`, and `Impr.` columns matches `^[0-9,]+(\.[0-9])?[KMB]?$`, and
   no raw-float drift (>=4 trailing decimals) appears anywhere.
3. **Greeting shape** — `Welcome back, <FirstName>` with no trailing `'s`.
4. **Stale banner uniqueness** — at most ONE "data stale" banner per page,
   and when it is visible the Margin-Leak Triage card must NOT also show
   its "All clear / no margin leaks detected" empty state.
5. **Magnitude casing** — compact suffixes are consistent (all `K`/`M`/`B`
   or all `k`/`m`/`b`), never mixed.
6. **Locale-aware dates** — for an en-IN user, no rendered date uses an
   unambiguous US `M/D/YYYY` ordering (i.e. month 1–12 with day 13–31).
7. **Locale-aware sync timestamp** — the Last sync surface must contain the
   literal `DD/MM/YYYY` string for the fixture clock (which is pinned to
   23 Mar 2026 → `23/03/2026`), and may not contain US `M/D/YYYY` or
   en-US `Mon DD` orderings.

The fixture clock is deliberately pinned to a date whose day-of-month is
greater than 12 so that the en-IN string `23/03/2026` cannot be confused
with a valid M/D/YYYY parse — that's what lets the negative US-format
check stay strict without false-positiving on the expected positive date.

Several contracts intentionally fail on `main` today — they document the
bugs that task #142 will fix. Once that task lands, every assertion here
must hold green.

## Conventions

- One `test.describe` block per contract.
- Mock every API the dashboard depends on so a flaky network can't make a
  formatting bug look like a passing test.
- Always wait for `networkidle` and the AppShell greeting before asserting
  on text — Suspense boundaries unmount the placeholder right before the
  real content appears.
- Prefer locator-based assertions (per-tile, per-column) for any invariant
  tied to a specific element. Reserve full-page `body.innerText()` sweeps
  for true page-wide invariants (e.g. "no `$` appears anywhere").
- Never swallow errors in assertion paths — use unconditional
  `expect(locator).toBeVisible()` so contract failures are immediate.
