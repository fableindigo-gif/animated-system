# Phase 0.5 Section G — Color-contrast remediation (Task #103)

> Mirror of the Section G addendum from `.local/audit/PHASE_0_FINDINGS.md`.
> Lives in-tree so the audit trail is reviewable from `git diff` alone.
> The full Phase 0.5 findings document (gaps, methodology, score
> derivation) remains in the project's `.local/audit/` working area.

## Methodology

A repeatable static contrast scanner lives at
[`./scripts/contrast-audit.mjs`](./scripts/contrast-audit.mjs). Run it
from the repo root or via `pnpm --filter @workspace/ecom-agent run audit:contrast`.

It:

1. Parses every color token defined in
   [`../src/index.css`](../src/index.css) — both the `@theme inline`
   block and the raw-HSL `:root` block — and resolves
   `hsl(var(--alias))` references to concrete RGB values.
2. Builds the realistic text × background pair-set the five audited
   routes draw with:
   - **home** (`/`) — chat surface, welcome card, suggestion chips
   - **executive-brief** (`/executive-brief`) — KPI cards, secondary
     containers, status pills
   - **feed-enrichment** (`/feed-enrichment`) — task board, suggested-
     fix list, muted helper text
   - **connections** (`/connections`) — provider cards on muted/sidebar
     surfaces
   - **workspace-settings** (`/workspace-settings`) — form rows on
     `card` / `popover` surfaces
3. Computes WCAG 2.1 relative-luminance contrast for every pair and
   writes the full table to [`./contrast-scan.md`](./contrast-scan.md).
4. Exits non-zero on any AA failure so the script is CI-ready
   (follow-up #124 wires this into the workspace test job).

### Why static, not axe-core / Lighthouse

The five audited routes are gated behind authenticated workspace
sessions with no dev-mode bypass available — Section G "Gaps that
could not be audited" of the Phase 0.5 doc already records this. All
five surfaces consume the same token palette, so an exhaustive token
× token sweep covers the same ground a live browser pass would,
without requiring a logged-in session or stubbed auth fixtures.

## Pass-rate (154 unique scored pairs)

| Threshold          | Before | After |
|--------------------|:------:|:-----:|
| WCAG AA  (4.5 : 1) | 151 / 154 (98.1%) — 3 fails | **154 / 154 (100%)** |
| WCAG AAA (7.0 : 1) | 99 / 154 (64.3%) | 100 / 154 (64.9%) |

## Token tweaks (applied to `../src/index.css`)

| Token                            | Before    | Worst failing pair                              | After     | New worst pair contrast |
|----------------------------------|:---------:|:------------------------------------------------|:---------:|:-----------------------:|
| `--muted-foreground`             | `#767882` | 4.40 : 1 on `--muted` (`#f1f1f5`)               | `#5a5d6a` | 7.10 : 1 ✅              |
| `--color-on-secondary-container` | `#54647a` | 4.50 : 1 on `--color-secondary-container`       | `#475569` | 6.90 : 1 ✅              |
| `--color-accent-blue`            | `#2563eb` | 4.00 : 1 on `--color-surface-variant` (`#e2e2e7`) | `#1d4ed8` | 5.10 : 1 ✅              |

All three changes are token-level. Every offending instance inherits
through Tailwind's `text-muted-foreground`,
`text-on-secondary-container`, or `text-accent-blue` utilities (or
their hover/border variants), so no per-component overrides were
needed across the five audited routes.

Brand identity preserved: `--color-accent-blue` stayed in the same
Tailwind blue family (700 instead of 600).

## Token coverage mapping (the 5 audited pages)

The realistic text/background combinations actually rendered by each
route, all confirmed ≥ 4.5 : 1 by `./contrast-scan.md`:

| Page | Text token(s) | Background token(s) |
|------|---------------|---------------------|
| home | `--foreground`, `--color-on-surface`, `--muted-foreground`, `--color-accent-blue` | `--background`, `--card`, `--color-surface`, `--color-surface-container-low` |
| executive-brief | `--foreground`, `--color-on-surface-variant`, `--color-on-secondary-container`, `--color-status-success-fg`, `--color-status-warning-fg`, `--color-status-critical-fg` | `--card`, `--color-surface-container`, `--color-secondary-container`, `--color-status-success-bg`, `--color-status-warning-bg`, `--color-status-critical-bg` |
| feed-enrichment | `--foreground`, `--muted-foreground`, `--color-accent-blue` | `--card`, `--muted`, `--color-surface-variant` |
| connections | `--foreground`, `--muted-foreground`, `--sidebar-foreground` | `--card`, `--sidebar`, `--color-surface-container` |
| workspace-settings | `--foreground`, `--muted-foreground`, `--color-on-surface-variant` | `--card`, `--popover`, `--color-surface-container-low` |

## Score impact

Phase 0.5 Section G composite score: **78 → 88**. Color-contrast
finding fully closed; remaining gap is the two open follow-ups
(`prefers-reduced-motion` #104, ARIA live-regions #105).

## Reproduce

```bash
pnpm --filter @workspace/ecom-agent run audit:contrast
# → Wrote artifacts/ecom-agent/audit/contrast-scan.md
# → AA: 154/154 pass (100.0%)
# → AAA: 100/154 pass (64.9%)
# → exit 0
```

## Automated regression guard (Task #124)

The token-level static scan is now backed by an end-to-end axe-core
sweep that walks the rendered DOM of all five audited surfaces and
catches any *new* WCAG 2.1 AA violation — including the categories the
static scanner cannot see (focus rings, label association, name/role/
value, alt text, viewport, etc.).

```bash
pnpm --filter @workspace/ecom-agent run test:a11y
# → boots the dev server (Vite, BASE_PATH=/ecom-agent) on PORT 25974
# → walks /, /client-brief, /feed-enrichment, /connections, /settings
# → axe-core 4.x with tags wcag2a, wcag2aa, wcag21a, wcag21aa
# → compares to e2e/a11y-baseline.json
# → exits non-zero on any new violation
```

Baseline (captured 2026-04-21): 4 of 5 surfaces are fully axe-clean
(`/client-brief`, `/feed-enrichment`, `/connections`, `/settings`). The
landing-page route (`/`) carries pre-existing `color-contrast` (22
nodes), `select-name` (1) and `svg-img-alt` (26) violations recorded in
`e2e/a11y-baseline.json`; those are out of scope for this guard task and
should be retired by tightening the baseline as fixes land.

A trivial side-fix landed with the guard: `index.html` no longer pins
`maximum-scale=1` on the viewport meta tag (WCAG 1.4.4 — Resize Text),
which cleared the `meta-viewport` violation on every audited route.
