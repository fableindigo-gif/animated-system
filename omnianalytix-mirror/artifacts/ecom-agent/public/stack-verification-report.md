# OmniAnalytix — Master Tech Stack & API Integration Audit

**Report Date:** April 10, 2026  
**Auditor Role:** Principal Systems Integrator & Lead QA Architect  
**Scope:** Full-stack integration verification across backend routes, frontend components, SDK dependencies, and database schema.

---

## CHECK 1: The Foundational Stack (Core Infrastructure)

### 1.1 Google Workspace OAuth — `[VERIFIED]`

| Layer | Status | File Path |
|-------|--------|-----------|
| SSO / Identity Login | Implemented | `artifacts/api-server/src/routes/auth/gate.ts` |
| Platform OAuth (Ads, GMC, GSC, YouTube, GA4) | Implemented | `artifacts/api-server/src/routes/auth/google-oauth.ts` |
| Token Refresh | Implemented | `artifacts/api-server/src/lib/google-token-refresh.ts` |
| Frontend SSO UI | Implemented | `artifacts/ecom-agent/src/components/password-gate.tsx` |
| Frontend OAuth Dialog | Implemented | `artifacts/ecom-agent/src/components/connections/google-oauth-dialog.tsx` |
| Unified Workspace Setup | Implemented | `artifacts/ecom-agent/src/components/connections/google-workspace-setup-dialog.tsx` |
| SDK | `google-auth-library ^10.6.2` | `artifacts/api-server/package.json` |

**Details:**  
Two distinct flows exist: (1) Google SSO via `gate.ts` (`openid`, `email`, `profile` scopes) for user identity/login with lazy org provisioning, and (2) Platform OAuth via `google-oauth.ts` with broad scopes (`adwords`, `content`, `webmasters.readonly`, `analytics.readonly`, `youtube.readonly`). Tokens stored in `platform_connections` table with automatic refresh via `getFreshGoogleCredentials()`.

---

### 1.2 Core Ad APIs — `[VERIFIED]`

#### Google Ads API

| Layer | Status | File Path |
|-------|--------|-----------|
| Campaign Fetching (GAQL) | Implemented | `artifacts/api-server/src/lib/platform-fetchers.ts` |
| Campaign Mutation (Budget, Bidding, Status, Keywords) | Implemented | `artifacts/api-server/src/lib/platform-executors.ts` |
| Search Stream | Implemented | `artifacts/api-server/src/lib/platform-executors.ts` |
| REST Routes | Implemented | `artifacts/api-server/src/routes/google-ads/index.ts` |
| ETL Sync | Implemented | `artifacts/api-server/src/routes/etl/index.ts` |
| OAuth Scopes | `adwords` | `artifacts/api-server/src/routes/auth/google-oauth.ts` |

**API Version:** `v19` and `v20` (`googleads.googleapis.com`)  
**Env:** `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`

#### Meta Graph API (Facebook/Instagram Ads)

| Layer | Status | File Path |
|-------|--------|-----------|
| Account & Campaign Insights Fetching | Implemented | `artifacts/api-server/src/lib/platform-fetchers.ts` |
| Ad Set Budget / Status / Creative Mutation | Implemented | `artifacts/api-server/src/lib/platform-executors.ts` |
| OAuth Flow | Implemented | `artifacts/api-server/src/routes/auth/meta-oauth.ts` |
| Frontend OAuth Dialog | Implemented | `artifacts/ecom-agent/src/components/connections/meta-oauth-dialog.tsx` |

**API Version:** `v19.0` and `v22.0` (`graph.facebook.com`)  
**Permissions:** `ads_management`, `ads_read`, `read_insights`

---

### 1.3 Data Visualization (Looker) — `[PARTIAL]`

| Layer | Status | File Path |
|-------|--------|-----------|
| Backend Signed Embed URL Generation | Implemented | `artifacts/api-server/src/routes/looker/index.ts` |
| Backend Dashboard Registry | Implemented | `artifacts/api-server/src/routes/looker/index.ts` |
| Frontend Embed Component | Implemented | `artifacts/ecom-agent/src/components/dashboard/looker-visualization-hub.tsx` |
| Route Registration (readGuard) | Implemented | `artifacts/api-server/src/routes/index.ts` |
| `@looker/embed-sdk` NPM package | **NOT INSTALLED** | — |

**Details:**  
The backend route generates a proper signed embed URL using HMAC-SHA1 with `LOOKER_EMBED_SECRET`, passing workspace-scoped `user_attributes` for RLS. The frontend renders embedded dashboards via `<iframe>` with share/download controls. However, the official `@looker/embed-sdk` npm package is **not installed** — the embed is implemented via raw iframe + signed URL pattern (which is a valid alternative to the SDK, but the SDK is not present as a dependency).

---

### 1.4 Data Warehousing (PostgreSQL) — `[VERIFIED]`

| Layer | Status | File Path |
|-------|--------|-----------|
| Connection Pool (`pg`) | Implemented | `lib/db/src/index.ts` |
| ORM (Drizzle) | Implemented | `lib/db/src/index.ts` |
| Warehouse Tables (Shopify, Google Ads, Cross-Platform, CRM) | Implemented | `lib/db/src/schema/warehouse.ts` |
| Schema Push / Migration | Implemented | `lib/db/package.json` (`push`, `push-force`) |

**Database:** Replit-managed PostgreSQL via `DATABASE_URL`.  
**ORM:** Drizzle ORM with `drizzle-zod` for validation.  
**Tables:** `warehouse_shopify_products`, `warehouse_google_ads`, `warehouse_cross_platform_mapping`, `warehouse_crm_leads`, `platform_connections`, `live_triage_alerts`, `audit_logs`, `conversations`, `messages`, `execution_logs`, `state_snapshots`, `workspaces`, `organizations`, `team_members`.

---

### 1.5 Billing & Monetization (Stripe) — `[VERIFIED]`

| Layer | Status | File Path |
|-------|--------|-----------|
| Backend Checkout Session | Implemented | `artifacts/api-server/src/routes/billing/index.ts` |
| Backend Billing Portal | Implemented | `artifacts/api-server/src/routes/billing/index.ts` |
| Frontend Upgrade Modal | Implemented | `artifacts/ecom-agent/src/components/enterprise/stripe-upgrade-modal.tsx` |
| Subscription Context | Implemented | `artifacts/ecom-agent/src/contexts/subscription-context.tsx` |
| Backend SDK | `stripe ^22.0.1` | `artifacts/api-server/package.json` |
| Frontend SDK | `@stripe/stripe-js ^9.1.0` | `artifacts/ecom-agent/package.json` |
| Stripe Webhook Handler | **NOT FOUND** | — |

**Details:**  
`POST /api/billing/create-checkout-session` creates a subscription checkout for "OmniAnalytix Pro" (recurring monthly). `GET /api/billing/portal` creates a Stripe Customer Portal session. The frontend manages Pro vs. Free tier via `SubscriptionContext`. **Note:** A dedicated Stripe webhook handler for subscription lifecycle events (`checkout.session.completed`, `invoice.payment_failed`, etc.) was not found — subscription status appears to be managed via redirect URLs.

---

### 1.6 Alerting & Exports — `[VERIFIED]`

| Layer | Status | File Path |
|-------|--------|-----------|
| Webhook Notifications (Slack/Google Chat) | Implemented | `artifacts/api-server/src/lib/advanced-diagnostic-engine.ts` (`sendWebhookNotifications`) |
| SSRF Protection | Implemented | `artifacts/api-server/src/lib/advanced-diagnostic-engine.ts` (`isValidWebhookUrl`) |
| CSV Export | Implemented | `artifacts/api-server/src/routes/reports/index.ts` (`POST /export-csv`) |
| Google Sheets Export | Implemented | `artifacts/api-server/src/routes/reports/index.ts` (`POST /export-sheets`) |
| CSV Injection Protection | Implemented | `artifacts/api-server/src/routes/reports/index.ts` |
| Frontend Export UI | Implemented | `artifacts/ecom-agent/src/components/dashboard/shareable-reports.tsx` |
| Webhook URL Storage | Implemented | `lib/db/src/schema/workspaces.ts` (`webhook_url` column) |

**Details:**  
When a Critical/Warning billing or diagnostic alert is persisted, `sendWebhookNotifications()` fires an HTTPS POST to the workspace's configured webhook URL. Webhook targets are validated (HTTPS-only, private IP blocking, metadata endpoint blocking). CSV export sanitizes formula-injection characters (`=`, `+`, `-`, `@`). Google Sheets export currently provides a Sheets-compatible JSON structure with CSV fallback (no direct Sheets API write — requires Google Sheets API credentials).

---

## CHECK 2: E-Commerce & Sales Stack

### 2.1 Shopify — `[VERIFIED]`

| Layer | Status | File Path |
|-------|--------|-----------|
| OAuth Flow | Implemented | `artifacts/api-server/src/routes/auth/shopify-oauth.ts` |
| Admin REST API (Products, Inventory, Orders, Discounts) | Implemented | `artifacts/api-server/src/lib/platform-executors.ts` |
| GraphQL API (Metafields) | Implemented | `artifacts/api-server/src/lib/platform-executors.ts` |
| Webhook Handling (Product/Inventory Updates) | Implemented | `artifacts/api-server/src/routes/webhooks/index.ts` |
| ETL Sync (Products, COGS, Inventory) | Implemented | `artifacts/api-server/src/routes/etl/index.ts` |
| Warehouse Table | Implemented | `lib/db/src/schema/warehouse.ts` |
| Fetch with Backoff & Pagination | Implemented | `artifacts/api-server/src/lib/fetch-utils.ts` |
| Frontend Connection UI | Implemented | `artifacts/ecom-agent/src/pages/connections.tsx` |

**API Version:** `2024-01`  
**Scopes:** `read_products`, `write_products`, `read_orders`, `read_inventory`, `read_price_rules`  
**SDK:** No `@shopify/shopify-api` — custom `fetch`-based implementation with retry/pagination.  
**Env:** `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`

---

### 2.2 Google Merchant Center (Content API) — `[VERIFIED]`

| Layer | Status | File Path |
|-------|--------|-----------|
| Product Status Fetching | Implemented | `artifacts/api-server/src/lib/platform-fetchers.ts` |
| Datafeed Monitoring | Implemented | `artifacts/api-server/src/lib/platform-fetchers.ts` |
| Disapproval & Issue Detection | Implemented | `artifacts/api-server/src/lib/platform-fetchers.ts` |
| Frontend Connection UI | Implemented | `artifacts/ecom-agent/src/components/connections/google-workspace-card.tsx` |
| OAuth Scope | `content` | `artifacts/api-server/src/routes/auth/google-oauth.ts` |

**API:** `shoppingcontent.googleapis.com/content/v2.1`  
**Metrics:** Total products, Approved, Disapproved, Pending, Limited, Top Issues.

---

### 2.3 GA4 (Google Analytics Data API) — `[VERIFIED]`

| Layer | Status | File Path |
|-------|--------|-----------|
| Revenue Deduplication (DDA) | Implemented | `artifacts/api-server/src/routes/analytics/index.ts` |
| Traffic Quality Diagnostics | Implemented | `artifacts/api-server/src/routes/analytics/index.ts` |
| AI Tool Integration | Implemented | `artifacts/api-server/src/lib/gemini-tools.ts` (`deduplicate_revenue_ga4`) |
| OAuth Scope | `analytics.readonly` | `artifacts/api-server/src/routes/auth/google-oauth.ts` |

**API:** `analyticsdata.googleapis.com/v1beta`  
**Usage:** Cross-references GA4 Data-Driven Attribution (DDA) revenue against ad platform self-reported conversions. Integrated into the AI agent's "God Mode" diagnostic and forensic audit tools.

---

## CHECK 3: Lead Gen & Pipeline Stack

### 3.1 CRM Connectors (HubSpot & Salesforce) — `[PARTIAL]`

| Layer | Status | File Path |
|-------|--------|-----------|
| Ingestion Route (`/api/etl/crm-sync`) | Implemented | `artifacts/api-server/src/routes/etl/index.ts` |
| CRM Leads Query (`/api/etl/crm-leads`) | Implemented | `artifacts/api-server/src/routes/etl/index.ts` |
| Warehouse Table (`warehouse_crm_leads`) | Implemented | `lib/db/src/schema/warehouse.ts` |
| CRM Diagnostics (Attribution, ROAS, CAC) | Implemented | `artifacts/api-server/src/lib/advanced-diagnostic-engine.ts` |
| HubSpot SDK / OAuth | **NOT IMPLEMENTED** | — |
| Salesforce SDK / OAuth | **NOT IMPLEMENTED** | — |
| Frontend CRM OAuth Buttons | Static (non-functional) | `artifacts/ecom-agent/src/pages/connections.tsx` |

**Details:**  
The architecture is production-ready: `POST /api/etl/crm-sync` accepts `provider: "salesforce" | "hubspot"` with a typed lead payload, upserts into `warehouse_crm_leads`, and triggers diagnostic cross-references against ad data. However, the route currently uses **mock data generation** (`generateMockCrmLeads()`) when no real leads payload is provided. There are no HubSpot or Salesforce OAuth flows, API SDKs, or real API calls. The frontend shows static "HubSpot" and "Mailchimp" buttons that are not wired to any auth flow.

---

### 3.2 Google Search Console API — `[PARTIAL]`

| Layer | Status | File Path |
|-------|--------|-----------|
| OAuth Scope | Implemented | `artifacts/api-server/src/routes/auth/google-oauth.ts` (`webmasters.readonly`) |
| Connection Storage (platform type `gsc`) | Implemented | `artifacts/api-server/src/routes/auth/google-oauth.ts` |
| API Calls (Site Listing, Search Analytics) | Implemented | `artifacts/api-server/src/lib/platform-executors.ts` |
| Data Fetching in Platform Fetchers | **NOT IMPLEMENTED** | `artifacts/api-server/src/lib/platform-fetchers.ts` (no `gsc` case) |
| Frontend Connection UI | Implemented | `artifacts/ecom-agent/src/pages/connections.tsx` |

**API:** `googleapis.com/webmasters/v3`  
**Details:**  
OAuth scopes and connection persistence are in place. The `platform-executors.ts` file contains methods to list sites and query search analytics. However, `platform-fetchers.ts` does not have a `fetchGscData` dispatcher case, meaning search data is not yet pulled into the standard dashboard data pipeline. The Search Console integration is functional at the API call level but not yet surfaced in the UI dashboards.

---

## CHECK 4: The Conditional Integration Hub (UI)

### 4.1 Goal-Based Rendering — `[MISSING]`

| Layer | Status | File Path |
|-------|--------|-----------|
| Connections Page | Implemented | `artifacts/ecom-agent/src/pages/connections.tsx` |
| Workspace Context Available | Implemented | `artifacts/ecom-agent/src/contexts/workspace-context.tsx` |
| `primaryGoal` Read | **NOT USED** | `connections.tsx` — `activeWorkspace` imported but `primaryGoal` not referenced |
| Conditional Button Rendering | **NOT IMPLEMENTED** | — |

**Details:**  
The Connections page (`connections.tsx`) renders **all** OAuth buttons unconditionally — Google Workspace, Meta Ads, Shopify, WooCommerce, and CRM (Klaviyo, HubSpot, Mailchimp) — regardless of the workspace's `primaryGoal` setting (ecom / leadgen / hybrid). The `activeWorkspace` object is available via `useWorkspace()` hook, and `primaryGoal` is present in the workspace schema, but it is not used to filter the visible connection options.

---

## Verification Summary Matrix

| Integration | Status | Backend | Frontend | SDK/Package |
|------------|--------|---------|----------|-------------|
| Google SSO (Identity) | `[VERIFIED]` | Yes | Yes | `google-auth-library` |
| Google Ads API | `[VERIFIED]` | Yes | Yes | Custom `fetch` (v19/v20) |
| Meta Graph API | `[VERIFIED]` | Yes | Yes | Custom `fetch` (v22.0) |
| Looker Embedding | `[PARTIAL]` | Yes | Yes | `@looker/embed-sdk` **missing** |
| PostgreSQL (Drizzle) | `[VERIFIED]` | Yes | N/A | `pg`, `drizzle-orm` |
| Stripe Billing | `[VERIFIED]` | Yes | Yes | `stripe`, `@stripe/stripe-js` |
| Webhook Alerts | `[VERIFIED]` | Yes | N/A | Custom `fetch` |
| CSV / Sheets Export | `[VERIFIED]` | Yes | Yes | Custom |
| Shopify | `[VERIFIED]` | Yes | Yes | Custom `fetch` |
| Google Merchant Center | `[VERIFIED]` | Yes | Yes | Custom `fetch` |
| GA4 (Analytics Data API) | `[VERIFIED]` | Yes | Yes | Custom `fetch` |
| HubSpot CRM | `[PARTIAL]` | Mock only | Static UI | **No SDK** |
| Salesforce CRM | `[PARTIAL]` | Mock only | Static UI | **No SDK** |
| Google Search Console | `[PARTIAL]` | API calls exist | UI exists | Scope present |
| Goal-Based Connections UI | `[MISSING]` | N/A | Not implemented | N/A |

---

## Missing Integrations Summary

The following APIs, SDKs, or features are completely absent or only partially implemented and should be prioritized:

### Fully Missing

1. **Goal-Based Conditional Rendering on Connections Page**  
   The frontend Connections page does not read `primaryGoal` from the workspace. All OAuth buttons render unconditionally regardless of whether the workspace is configured for E-Commerce, Lead Gen, or Hybrid. This creates UX confusion by showing irrelevant integrations.

2. **Stripe Webhook Handler**  
   No dedicated Stripe webhook route exists for subscription lifecycle events (`checkout.session.completed`, `invoice.payment_failed`, `customer.subscription.deleted`). Subscription state changes rely solely on redirect URLs, which is unreliable for production billing.

### Partially Implemented (Architecture Ready, API Missing)

3. **`@looker/embed-sdk` Package**  
   The backend generates valid signed embed URLs and the frontend renders via iframe, but the official Looker Embed SDK is not installed. The current implementation works but lacks SDK-level features (dynamic dashboard filters, cross-filtering, programmatic dashboard events).

4. **HubSpot CRM Integration**  
   No HubSpot OAuth flow, no API SDK (`@hubspot/api-client`), no real API calls. The ETL route accepts HubSpot-shaped data and the database schema is ready, but live syncing is entirely mocked.

5. **Salesforce CRM Integration**  
   No Salesforce OAuth flow (PKCE/JWT Bearer), no SDK (`jsforce`), no real API calls. Same as HubSpot — the ingestion pipeline and warehouse are production-ready but disconnected from real data.

6. **Google Search Console — Data Pipeline Integration**  
   OAuth scopes are present and the API call methods exist in `platform-executors.ts`, but `platform-fetchers.ts` has no `gsc` case to pull data into the standard dashboard pipeline. Search performance data is not surfaced in the UI.

7. **Google Sheets API — Direct Write**  
   The export route produces a Sheets-compatible JSON structure but falls back to CSV download. No Google Sheets API (`googleapis.com/v4/spreadsheets`) credentials or direct write logic exists. Requires `sheets.spreadsheets` scope and service account or OAuth credentials.

---

*Report generated by OmniAnalytix Stack Verification Engine.*
