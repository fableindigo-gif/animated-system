# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Copy guidelines (user-facing strings)

Apply these everywhere users read text — UI labels, button copy, descriptions, toasts, empty states, and error messages.

- **Plain English first.** Replace internal nicknames and marketing flourishes with what the feature actually does. Examples: "God Mode" → "Run full diagnostic", "Client Whisperer PDF" → "Weekly client report (PDF)", "CPL arbitrage tracking" → "Cost-per-lead trend tracking", "Dual-authorization workflows" → "Two-person approval".
- **No jargon for novices.** Avoid acronyms (CPL, SGE, PMax, ETL) and dense phrases ("entity-dense semantic HTML", "trifurcated router") unless the reader is guaranteed to know them. If a term is industry-standard for the audience (ROAS, POAS, CRM), keep it but pair it with a one-line explainer the first time it appears.
- **Telemetry IDs stay stable.** Only relabel what users see. Never rename event names, command `id`s, analytics keys, role enums, or API field names — downstream tracking and tests depend on them.
- **Errors should tell users what to do next.** Every destructive or failure toast must:
  - Name the problem in human terms ("Couldn't reach the server", not "Network Error 500").
  - Suggest a concrete next step ("Check your connection and try again").
  - Offer an inline action when the user can recover in one click. Use `toast({ action: { label: "Retry", onClick: ... } })` — the Toaster renders it as a button automatically.
- **Tone:** calm, direct, second-person ("you"). Avoid exclamation marks, ALL CAPS, and "Oops!"-style apologies.
