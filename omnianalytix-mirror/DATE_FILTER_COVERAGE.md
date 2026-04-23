# Date Filter Coverage

This document tracks which dashboard pages and which API endpoints honor the
global date-range picker (`DateRangeProvider` → `useDateRange()` →
`useDateRangeParams()`). It is the source of truth for Task #60.

## Helper

All call sites should use the shared helper rather than re-deriving query
params:

```ts
import { useDateRangeParams } from "@/lib/use-date-range-params";
const { from, to, daysBack, refreshKey, qs } = useDateRangeParams();
// fetch(`/api/x${qs}`)
// useEffect(..., [qs, refreshKey])
```

The helper returns:
- `from`, `to` — `YYYY-MM-DD` ISO date strings
- `daysBack` — integer day count (>=1)
- `refreshKey` — opaque integer that increments on Refresh / preset change.
  Include in effect deps + React Query keys to force refetch.
- `qs` — preformatted `?from=…&to=…&days=…&days_back=…` suffix; both `days`
  and `days_back` are emitted so old endpoints continue working.

## Frontend coverage

Legend:
- WIRED — page reads the global picker and forwards it on every fetch.
- LOCAL — page has its own per-query date controls that **seed** from the
  global picker but can be overridden.
- ATEMPORAL — page intentionally has no time dimension (e.g. inventory
  catalog status, agent chat, connections).

| Component / Page                                 | Status     | Notes |
| ------------------------------------------------ | ---------- | ----- |
| `dashboard/hybrid-dashboard.tsx`                 | WIRED      | `kpis`, `margin-leaks`, `live-triage`, `pipeline-triage` all forward `from`/`to`/`days` |
| `dashboard/leadgen-dashboard.tsx`                | WIRED      | `kpis`, `pipeline-triage` |
| `dashboard/ecommerce-dashboard.tsx`              | WIRED      | warehouse + insights |
| `dashboard/profit-loss-dashboard.tsx`            | WIRED      | `/api/financials?from&to` |
| `dashboard/shopping-insights.tsx`                | WIRED      | reference implementation, also keys cache by `refreshKey` |
| `dashboard/cross-platform-insights.tsx`          | WIRED ★    | now consumes global picker, re-runs all completed analyses on change (was previously **broken** — fixed in this task) |
| `dashboard/google-ads-hub.tsx`                   | LOCAL ★    | per-query date pickers now seed from global picker + global picker shown in header (was previously **fully detached** — fixed in this task) |
| `dashboard/performance-grid.tsx`                 | WIRED      | `/api/warehouse/channels?from&to&days` |
| `dashboard/sales-leaderboard.tsx`                | WIRED      | warehouse |
| `dashboard/pipeline-funnel.tsx`                  | WIRED      | `/api/etl/crm-leads?from&to` |
| `enterprise/sku-grid.tsx`                        | ATEMPORAL  | inventory snapshot |
| `enterprise/channels-grid.tsx`                   | WIRED      | warehouse channels |
| `enterprise/global-status-bar.tsx`               | ATEMPORAL  | sync state only |
| `enterprise/pacing-bar.tsx`                      | WIRED      | budget pacing uses month-to-date by definition |
| `enterprise/command-panel.tsx`                   | ATEMPORAL  | command palette |
| `enterprise/connections-guard.tsx`               | ATEMPORAL  | OAuth / connection status |
| `enterprise/live-triage.tsx`                     | WIRED      | live alerts forward `days` |
| ADK chat UI                                      | ATEMPORAL  | conversational |
| Connections / Integrations pages                 | ATEMPORAL  | OAuth + credentials |
| Workspaces / Teams / Billing                     | ATEMPORAL  | account configuration |

★ = changed in Task #60.

## API endpoint coverage

| Endpoint                                                | Honors `from`/`to` | Honors `days` / `days_back` | Notes |
| ------------------------------------------------------- | ------------------ | --------------------------- | ----- |
| `GET  /api/warehouse/kpis`                              | ✅                  | ✅                           | via `parseDateRangeWindow()` |
| `GET  /api/warehouse/channels`                          | ✅                  | ✅                           | same helper |
| `GET  /api/warehouse/margin-leaks`                      | ✅                  | ✅                           | same helper |
| `GET  /api/warehouse/pipeline-triage`                   | ✅                  | ✅                           | same helper |
| `GET  /api/financials?workspaceId&from&to`              | ✅                  | n/a                         | already supports range |
| `GET  /api/etl/crm-leads?from&to`                       | ✅                  | n/a                         | already supports range |
| `GET  /api/insights/cross-platform/margin-bleed`        | ✅ ★                | ✅ ★                         | accepts both, capped at 90d (Shopify limit) |
| `GET  /api/insights/cross-platform/audience-overlap`    | ✅ ★                | ✅                           | now also accepts `from`/`to` |
| `GET  /api/insights/cross-platform/crm-arbitrage`       | n/a                | uses `window_start`/`window_end` | repurchase windows are independent of the global picker by design |
| `GET  /api/insights/shopping/*`                         | ✅                  | ✅                           | BigQuery-backed, range-scoped |
| `POST /api/gaarf/queries/:name/run`                     | ✅                  | n/a                         | accepts `start_date`/`end_date` macros (now seeded from global picker) |
| `POST /api/gaarf/run`                                   | ✅                  | n/a                         | ad-hoc GAQL — user supplies window |
| `POST /api/dashboard/unified-state`                     | ATEMPORAL          | ATEMPORAL                   | returns sync state + lifetime aggregates that bootstrap the dashboard shell. Per-window numbers come from `/api/warehouse/*`. |
| `GET  /api/live-triage`                                 | ✅                  | ✅                           | `days` |

★ = changed in Task #60.

## Cache-key invalidation

Every page that forwards date params also includes `refreshKey` (or the
expanded `qs`) in its effect dependencies. Pressing the global Refresh
button increments `refreshKey`, which causes every page-level effect to
re-fire and every cached query to be invalidated.

## Out of scope (intentionally)

- Shifting the default preset away from "Last 30 Days".
- Adding new presets (e.g. "Last quarter", "Last full month").
- Per-component overrides — only the ad-hoc GAQL composer and Google Ads
  Hub query pickers can deviate from the global window, and both still
  seed from the global picker when it changes.
