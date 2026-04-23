# Currency Coverage Audit

Status as of Task #185. Tracks which dashboards render money via the
auditable `<MoneyTile>` component (which exposes the underlying USD value,
the FX rate applied, the rate date, and the rate source — `live`,
`cached`, `override`, or `fallback` — through a hover tooltip) versus the
older `formatUsdInDisplay` / `formatFromUsd` helpers (no audit trail).

## Audit trail surface

`<MoneyTile>` (see `src/components/ui/money-tile.tsx`):

- Converts a USD warehouse value to the user's display currency.
- On hover, the tooltip shows:
  - The raw USD amount (`formatUsd`).
  - The FX rate used: `1 USD = <rate> <CCY> · <rateDate>`.
  - The rate source: `live`, `cached`, `override`, or `fallback`
    (whichever the FX context resolved).
- When `periodEnd` is supplied, the historical rate cached for that date
  (or nearest prior) is used and a small "rate as of YYYY-MM-DD" caption
  is rendered alongside the figure.

## Dashboards covered (✅ MoneyTile integrated)

| Surface | File | Notes |
| --- | --- | --- |
| Promo Engine | `src/pages/promo-engine.tsx` | "Est. Recovery" StatCard, per-trigger projected recovery line, and the "Liquidate Stock" recommendation banner. |
| Platform Admin | `src/pages/platform-admin.tsx` | "Est. MRR" KpiCard. |
| Hybrid Dashboard | `src/pages/hybrid-dashboard.tsx` | KPI header (Total Ad Spend, Ecom Revenue, Blended CPL), KPI sub-lines (Ecom/Lead split, gross profit, deal pipeline, CPL cap), pipeline banner, lead-gen target panel (CPL Cap actual + target), holistic pipeline panel. Channel performance table: per-row `FxRowAudit` info icon in the FX column discloses spend USD, revenue/deals USD (+ CPL USD for lead-gen rows), FX rate, rate date, and rate source on hover. |
| Performance Grid | `src/components/dashboard/performance-grid.tsx` | Mobile `CampaignCard` (spend, CPA, revenue) and the desktop table rows + summary header (Total Spend, Revenue). |
| PMax X-Ray | `src/components/command-center/pmax-xray.tsx` | "Est. Spend" header chip, per-network estimated spend, asset-group spend tiles. |
| Approval Card | `src/components/command-center/approval-card.tsx` | Projected Profit Recovery zone of `PromoApprovalCard`. |

## Chart tooltip surfaces (✅ FX audit trail in Recharts tooltips)

| Surface | File | Notes |
| --- | --- | --- |
| PMax X-Ray pie chart | `src/components/command-center/pmax-xray.tsx` | Replaced primitive `formatter` with a custom `<PieAuditTooltip>` React component that uses `useFx()` — shows USD amount, 1 USD = rate CCY · date, and source. |

## Export / clipboard surfaces (✅ FX audit metadata in CSV and text exports)

All money-bearing CSV and clipboard exports now append a standardised **FX Audit** footer (using `src/lib/fx-audit-csv.ts`) so users can reconstruct or verify the FX conversion applied at export time.

| Surface | File | Notes |
| --- | --- | --- |
| Google Ads Reports CSV | `src/components/dashboard/google-ads-hub.tsx` `downloadCsv()` | Appends FX audit section via `appendFxAuditToCsv()` before triggering download. |
| Shopping Insights CSV | `src/components/dashboard/shopping-insights.tsx` `exportCsv()` | Server-side streaming CSV is read as text, FX audit section appended client-side, then re-downloaded as annotated blob. |
| Chat message "Export to Sheets" (CSV) | `src/components/chat/message.tsx` | `messageToCSV(body)` result passed through `appendFxAuditToCsv()`. |
| Chat message "Copy to Clipboard" | `src/components/chat/message.tsx` | `buildFxAuditTextSection()` appended to clipboard text when display currency ≠ USD. |
| Chat message "Export to Docs" | `src/components/chat/message.tsx` | `buildFxAuditTextSection()` appended to plain-text export. |
| Hybrid Dashboard channel table CSV | `src/pages/hybrid-dashboard.tsx` `downloadChannelCsv()` | "CSV" button in the Performance Grid header builds channel rows (USD warehouse values) then calls `appendFxAuditToCsv()` before triggering download. Respects active tab filter (All / Direct Sales / Lead Gen). Button is disabled when no rows are visible. |

The exported audit section includes three fields: **Rate (1 USD →)**, **Rate Date**, and **Rate Source**. When display currency is USD the section is omitted (no conversion was applied).

## Known remaining `formatUsdInDisplay` / `formatFromUsd` callers

Kept on the helpers intentionally for the reasons noted below.

| File | Caller | Why kept on helper |
| --- | --- | --- |
| `src/pages/hybrid-dashboard.tsx` | Sync banner messages | Plain prose, no display surface for hover affordance. |
| Other helpers across the codebase (`fx-format.ts` consumers in chart axes, sub-1-px sparkline labels) | — | Static formatting paths where a hover tooltip is visually inappropriate (axis tick labels). |

## Adding new money displays

1. Import: `import { MoneyTile } from "@/components/ui/money-tile";`
2. Pass the **USD** value (warehouse value, not pre-converted):
   `<MoneyTile usd={row.spendUsd} compact decimals={0} />`.
3. For historical reporting windows, pass `periodEnd="YYYY-MM-DD"` so the
   conversion uses the FX rate cached for that date and the "rate as of"
   caption is shown.
4. If a parent container types `value` / `sub` props as `string`, widen
   them to `ReactNode` so the tile can be embedded.
5. Only fall back to `formatUsdInDisplay` / `formatFromUsd` when the
   render target literally cannot accept a React node (Recharts
   formatters, CSV/clipboard strings, axis ticks).

## Pattern for dense data tables: `FxRowAudit`

When a table has multiple money columns per row, placing a `<MoneyTile>`
tooltip on every cell creates a hover-trap that degrades scan-ability.
Instead, use the **one-tooltip-per-row** pattern first introduced in the
Hybrid Dashboard channel performance table (Task #185):

1. Keep cell values formatted with `fmtUSD` / `fmtMoney2` so the row
   stays scannable.
2. Add a narrow **FX column** (header: `currency_exchange` icon + "FX")
   at the far right of the table.
3. In each data row, render a `FxRowAudit` component (or equivalent) that
   shows a small `info` icon. On hover the tooltip discloses:
   - All money values for that row in raw USD.
   - The FX rate: `1 USD = <rate> <CCY>`.
   - The rate date and source (`live`, `cached`, `override`, `fallback`).
4. `FxRowAudit` uses `useFx()` and `useCurrency()` from the FX context.
   It returns `null` automatically when the display currency is already USD.
5. The column header tooltip explains the column purpose to new users.

This approach satisfies the audit requirement without any hover-trap
because only one element per row is interactive.
