# Currency Coverage

This document tracks how the OmniAnalytix UI honors the user's preferred
display currency for warehouse-derived KPIs.

Every monetary value returned by `/api/dashboard`, `/api/financials`,
`/api/warehouse`, `/api/insights/*`, `/api/google-ads`, and the Shopify
adapters is denominated in **USD** at the API boundary (Shopify's mixed
shop currencies are normalised to USD by the connector). The UI is
responsible for converting USD → user-preferred currency before display.

## Architecture (Task #61)

1. **`fx_rates` table** — `(base, quote, rateDate, rate, source)`,
   one row per currency pair per day. Daily cron refreshes 21 quotes
   against `open.er-api.com/v6/latest/USD` (free, keyless, dual-shape
   parser; overridable via `FX_PROVIDER_URL` / `FX_PROVIDER_NAME`).
2. **`fx_overrides` table** — per-(workspaceId, base, quote, rate, note)
   admin overrides. These win over live rates so finance teams can pin
   month-end rates for reconciliation.
3. **Service** — `artifacts/api-server/src/lib/fx-rates.ts` exposes
   `getRates()` (override → exact-date cache → live fetch →
   nearest-prior cached row → 1.0 fallback), `convertUsd()`, and
   `startFxRatesCron()`.
4. **Routes** — `GET /api/fx/rates` (viewer-readable, with workspaceId
   org-ownership check that silently strips foreign workspace IDs),
   `GET/PUT/DELETE /api/fx/overrides` (admin-only + tenant-isolated).
5. **React provider** — `FxProvider` (`contexts/fx-context.tsx`) caches
   per-(quote, date) lookups in-memory, prefetches the active currency
   on mount/change, dedupes inflight fetches, and exposes `convert`,
   `convertTo`, `formatFromUsd`, `formatFromUsdAt`, `ensureRate`, and
   `rateFor`. It also pushes the active rate into `fx-runtime.ts` for
   hook-free helpers.
6. **`<MoneyTile usd={…}/>`** — drop-in replacement for raw `$${n}`
   templates; tooltip discloses underlying USD, FX rate, rate date, and
   rate source so any conversion is auditable.
7. **`formatUsdInDisplay(usd, opts)`** — hook-free helper in
   `lib/fx-format.ts` for module-scope formatters that cannot use
   React hooks. Reads the active rate from `fx-runtime` and renders in
   the user's currency.
8. **`useCurrency().formatMoney`** — as of #61 this ALWAYS treats its
   input as USD and converts to the active display currency, so any
   call site that previously used it with already-converted values must
   be audited (most call sites pass warehouse USD already).

## Migration status — ALL DASHBOARDS FX-AWARE

Every dashboard listed below now renders monetary KPIs in the user's
preferred display currency, sourced from `formatUsd` / `formatFromUsd` /
`formatUsdInDisplay` (all of which honor the active FX rate):

- ✅ `components/dashboard/profit-loss-dashboard.tsx`
- ✅ `components/dashboard/bento-dashboard.tsx`
- ✅ `components/dashboard/ecommerce-dashboard.tsx`
- ✅ `components/dashboard/performance-grid.tsx`
- ✅ `components/dashboard/sales-leaderboard.tsx`
- ✅ `components/dashboard/cross-platform-insights.tsx`
- ✅ `components/dashboard/shopping-insights.tsx`
- ✅ `components/dashboard/pipeline-funnel.tsx`
- ✅ `components/dashboard/hybrid-dashboard.tsx`
- ✅ `components/dashboard/leadgen-dashboard.tsx`
- ✅ `components/dashboard/unified-billing-hub.tsx`
- ✅ `components/dashboard/budget-pacing-bar.tsx`
- ✅ `components/enterprise/command-panel.tsx` (via FX-safe `formatMoney`)
- ✅ `components/command-center/approval-card.tsx` (PromoApprovalCard
  projected recovery now uses `useFx().formatFromUsd`)
- ✅ `components/command-center/pmax-xray.tsx` (Est. Spend header,
  network breakdown, asset-group spend, and chart tooltip all use
  `useFx().formatFromUsd`)
- ✅ `pages/bi-dashboard.tsx`
- ✅ `pages/leadgen-dashboard.tsx`
- ✅ `pages/hybrid-dashboard.tsx` (CPL cells, blended CPL, target row,
  Google Ads sync banner — module-scope `fmtUSD`/`fmtMoney2` now route
  through `formatUsdInDisplay`)
- ✅ `pages/promo-engine.tsx` (Est. Recovery StatCard, projected
  recovery line, approval reasoning — `useFx().formatFromUsd`)
- ✅ `pages/platform-admin.tsx` (Est. MRR KpiCard —
  `useFx().formatFromUsd`)

Date-aware historical conversion (`formatFromUsdAt`) is available for
period-end displays. Wiring it through every chart's per-period axis is
ongoing — see "Historical FX accuracy" below for the resolution chain
and the `<MoneyTile periodEnd="…">` opt-in caption.

## Historical FX accuracy (Task #72)

Our keyless provider (`open.er-api.com`) only exposes today's rates,
so the cache only accumulates one row per day going forward. To keep
historical reports honest without paying for a historical-rate
provider, we use a **period-end fallback**:

- `getRates(quotes, date, workspaceId)` resolves `date` against the
  exact-date cache first, then attempts a live fetch (only meaningful
  when `date` is today), and finally falls back to the **most recent
  cached row strictly ≤ `date`** for any quote still missing. Each
  returned `FxRateLookup` reports the actual `rateDate` used (which
  may differ from the requested `date`), so the UI can disclose it.
- `<MoneyTile usd={…} periodEnd="YYYY-MM-DD" />` opts a tile into
  historical conversion. It (a) calls `formatFromUsdAt` to convert at
  the period-end rate, (b) renders a visible `rate as of YYYY-MM-DD`
  caption next to the figure whenever the resolved rate date is not
  today, and (c) keeps the auditable tooltip (USD source / rate /
  source kind) in sync with the rate actually used. USD-preferring
  users never see the caption (passthrough).
- Because we honestly surface the resolved `rateDate` (not the
  requested one), period-end fallback rates show the **actual**
  closest-known date — e.g. a tile for 2024-03-31 in a window that
  pre-dates the cache will display "rate as of 2024-04-12" once the
  cache has accumulated that row, never silently mislabelling the
  conversion.
- Switching to a paid historical-rate provider only requires changing
  `FX_PROVIDER_URL` / `FX_PROVIDER_NAME`; the dual-shape parser
  already speaks the standard `/{date}?base=USD&symbols=…` shape.

## Override admin UI

Workspace admins can manage `fx_overrides` via direct API today:

```
GET    /api/fx/overrides?workspaceId=N    (admin only, tenant-checked)
PUT    /api/fx/overrides   { workspaceId, base, quote, rate, note }
DELETE /api/fx/overrides?workspaceId=N&quote=INR
```

A settings-page UI for managing overrides is tracked as follow-up #71.

## Honesty guarantees

- USD passthrough — a USD-preferring user always sees `$` and the raw
  warehouse number (rate is hard-coded to 1.0).
- Provider failure — if the live provider is unreachable AND no exact
  cached rate exists for the requested date, `getRates()` falls back
  first to the nearest prior cached rate, and only as a last resort to
  `{ rate: 1, source: "fallback" }` so the UI degrades to USD with a
  visible "fallback" badge in the `<MoneyTile>` tooltip rather than
  silently mislabelling figures.
- Historical windows — date-scoped lookups use the requested
  `rateDate`, so a 2024 P&L always uses 2024 rates (or the closest
  prior known rate), not today's rate.
- Tenant isolation — `/api/fx/rates` silently ignores `workspaceId`
  values that don't belong to the caller's org so a tenant can never
  read another tenant's overrides.
