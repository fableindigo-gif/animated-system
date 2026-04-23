# Contributing to OmniAnalytix

## CI gates on every pull request

All jobs listed below must be green before a PR can merge.

| Job | Command | What it enforces |
| --- | ------- | ---------------- |
| Secret scan | `gitleaks` + `node scripts/scan-secrets.mjs` | No credentials or tokens committed |
| Repo-wide lint | `pnpm run check:all` | Five static-analysis guards (silent catches, tenant ownership, SQL columns, currency leaks, workspace-id source) |
| TypeScript | `pnpm run typecheck` | Zero type errors across all workspace packages |
| Production build | `pnpm run build` (api-server + ecom-agent) | Both bundles compile cleanly |
| E2E tests | `pnpm --filter @workspace/ecom-agent run e2e` | Playwright journey specs pass |
| **Accessibility guard** | `pnpm --filter @workspace/ecom-agent run test:a11y` | Zero new WCAG 2.1 AA violations on the five audited surfaces |

---

## Accessibility guard

The **"Accessibility (axe-core, WCAG 2.1 AA)"** CI job sweeps five surfaces
with axe-core via Playwright:

- home (`/`)
- executive-brief (`/client-brief`)
- feed-enrichment (`/feed-enrichment`)
- connections (`/connections`)
- workspace-settings (`/settings`)

A failure means axe-core found at least one NEW violation — either a rule on a
previously clean surface, or an existing rule whose affected-node count grew
past the per-route allowance in `artifacts/ecom-agent/e2e/a11y-baseline.json`.

### Running the guard locally

```bash
# Install Chromium once (only needed the first time)
npx playwright install chromium

# Run from the repo root
pnpm --filter @workspace/ecom-agent run test:a11y
```

The Playwright config auto-starts the Vite dev server when none is already
running, so no extra setup is required.

### When the guard fires

**Option A — Fix the source (preferred)**

Read the failure output: it lists the axe rule ID, its help URL, and the exact
CSS selector(s) of the offending element(s). Resolve the contrast, label, or
ARIA issue in the source, then re-run the guard to confirm it is green.

**Option B — Bump the baseline (last resort)**

Use this only when the violation is intentional *and* a follow-up task already
tracks the proper fix. Edit
`artifacts/ecom-agent/e2e/a11y-baseline.json` and raise the node count for
the affected rule under the affected route:

```json
{
  "/ecom-agent/": {
    "color-contrast": 2
  }
}
```

`a11y-baseline.json` is strict JSON — no inline comments. Record the tracking
task number in the PR description so the entry has a clear owner and can be
trimmed once the fix lands.

**Never raise the baseline without a tracking task.** Untracked bumps hide
regressions and defeat the purpose of the guard.

---

For a detailed walkthrough of the five audited surfaces and spec conventions,
see `artifacts/ecom-agent/e2e/README.md`.
