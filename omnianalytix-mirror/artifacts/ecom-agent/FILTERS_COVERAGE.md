# Granular Filters — Coverage Audit (Task #62, v1)

This doc tracks where the global FilterBar (`<FilterBar pageKey=… dimensions=… />`)
is mounted and which dimensions are actually applied **server-side**. Anything
not marked ✅ in the "Backend applied" column is **UI-only** in v1 — the page
shows the chips, persists them in the URL/localStorage and saved-views, but the
server still returns the unfiltered result. Those are explicitly tracked as
follow-up work, not silently shipped as "done".

## How filters flow

1. `FiltersProvider` (App.tsx, inside `DateRangeProvider`) holds a per-page map
   of `{ dimension → string[] }`, hydrated from URL `f.<dim>=` query params and
   `localStorage["omni_filters_<pageKey>"]`.
2. `FilterBar` lets users add/remove values and save the current state (date
   preset + filters) as a named **Saved View** scoped to `(workspaceId, pageKey)`.
3. Pages that have wired backend application call `useFilterQs(pageKey)` and
   append the resulting `&filter.<dim>=v1,v2` fragment to their fetch URLs.
4. `parseFilterParams(req)` on the API side validates every value against an
   allow-list (platform/device/network/lifecycle/segment/country) or a strict
   `^[A-Za-z0-9_\-.: ]{1,64}$` regex (account/campaign/brand/sku/etc.). Values
   that fail validation are **dropped silently**, never interpolated into SQL.

## Page coverage

| Page / dashboard            | FilterBar mounted | Dimensions exposed                                  | Backend applied            |
| --------------------------- | :---------------: | --------------------------------------------------- | -------------------------- |
| Profit & Loss               | ✅                | account, brand, country, lifecycle                  | ⏳ pending                 |
| Shopping Insights           | ❌ (intentional)   | —                                                   | ✅ — page keeps its existing dedicated `country` + `merchant_id` inputs, which the BigQuery endpoints honour. The global FilterBar is **not** mounted here to avoid a split-brain filter UX (two sets of controls disagreeing about state). v2 will fold both into one. |
| Cross-Platform Insights     | ✅                | platform, country, brand, lifecycle                 | ⏳ pending                 |
| Google Ads Hub              | ✅                | account, campaign, network, device, country         | ⏳ pending (GAARF queries are user-authored GAQL — filters cannot be applied generically) |
| Performance Grid            | ✅                | platform, campaign, network, device, country        | ✅ campaign (id + name ILIKE) on `/api/warehouse/channels` — wired end-to-end via `useFilterQs("performance-grid")` in `load()` |
| Lead-Gen Dashboard          | ✅                | platform, campaign, country, lifecycle              | ⏳ pending                 |
| Hybrid Dashboard            | ✅                | platform, country, lifecycle, segment               | ⏳ pending                 |
| Sales Leaderboard           | ✅                | account, country, brand, segment                    | ⏳ pending                 |
| BI / Channels Grid / SKU Grid | ❌ not yet      | —                                                   | ⏳ pending — no standalone page file in this repo |

## Saved Views

- Table: `saved_views (id, workspace_id, user_id, page_key, name, filters jsonb, date_preset, custom_from, custom_to, created_at, updated_at)` with a unique index on `(workspace_id, user_id, page_key, name)` — saved views are **per-user** so two analysts in the same workspace can each have a "My view" without collision.
- Endpoints: `GET /api/saved-views?workspaceId=&pageKey=`, `POST /api/saved-views` (upsert via `ON CONFLICT`), `DELETE /api/saved-views/:id`. Every endpoint verifies the caller's org owns the workspace (returns 404 — not 403 — to avoid leaking workspace existence) **and** scopes the query/delete by the authenticated `user_id` (`req.rbacUser.id`).
- The POST handler defensively whitelists the `filters` payload: anything that isn't a `string[]` per dimension is dropped before it hits the DB.

## Why "UI-only" was acceptable for v1

Wiring backend SQL filters needs per-table column knowledge (the warehouse
`google_ads` table has `campaign_id`, `campaign_name`, `cost_usd`, etc., but no
`network`/`device`/`country` columns). Pages that read from BigQuery views or
synthesised JSON payloads need those columns plumbed through ETL first. Rather
than silently swallow unknown filter keys (which would mislead users into
thinking a filter "did" something), v1:

1. Validates everything client-side and server-side so no malformed payload
   reaches the DB.
2. Persists filters in URL + localStorage + Saved Views so workflows survive
   reload, share, and reopen.
3. Marks each unwired page in this doc with ⏳ and an explicit reason. v2 will
   wire each row of this table to a real WHERE clause as the underlying
   warehouse columns become available.
