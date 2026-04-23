# Overview

The Omnipotent E-Commerce Growth Agent is an AI chat application powered by Google Gemini, designed as a comprehensive AI solution for e-commerce. It functions as a Digital Marketing Strategist, Forensic Auditor, and Competitive Intelligence Researcher. The project aims to provide real-time insights, automate actions, and deliver enterprise-grade features to optimize digital marketing, audit performance, and enhance competitive intelligence for various operational goals, supporting business vision and market potential.

# User Preferences

I prefer iterative development, with a focus on delivering incremental value. Please prioritize clear, concise communication and provide detailed explanations for complex changes or architectural decisions. I value a collaborative approach, so please ask for clarification or approval before implementing major changes or making significant architectural shifts.

# System Architecture

The project is a pnpm workspace monorepo built with TypeScript, Node.js 24, and pnpm. The backend uses Express 5, PostgreSQL, Drizzle ORM, and Zod for validation. API codegen is handled by Orval from an OpenAPI spec, and esbuild handles bundling.

**UI/UX Decisions:**
- The frontend is a React, Vite, and Tailwind CSS application, adhering to a Material Design 3 / iPadOS HIG hybrid design system with customized shadcn/ui components, featuring heavy rounding, ghost borders, glassmorphism, ambient shadows, and the Inter font.
- Key UI elements include a distinct chat bubble styling, a glassmorphism input area, a collapsible left sidebar with Framer Motion animation, a mobile glass-nav bottom tab bar, a tri-tone alert system, and a Command Palette.
- The landing page is optimized for lead generation, featuring a split-grid hero, floating glass KPI chips, and an animated trust marquee.
- Authentication via AuthGate is required for most routes, with deep link preservation for SSO. Modals adapt to bottom sheets on mobile.
- Progressive Disclosure UX is employed, including a "Prompt Library" and a "Getting Started" stepper. An Enablement & Support Layer integrates `MetricTooltip`, `FaqDrawer`, and a `SupportFab`.
- A modern fintech color palette (`slate-*`, `indigo-*`, `emerald-*`, `amber-*`, and `rose-*`) is used throughout the application.

**Technical Implementations:**
- **Google ADK-JS Multi-Agent Orchestration:** Three `LlmAgent`s (`gapFinderAgent`, `growthEngineAgent`) are structured under an `orgCeoAgent` orchestrator using `@google/adk@0.6.1`. These agents utilize `FunctionTool`s for various platform interactions. Session state carries `{ orgId, workspaceId, userId }`.
- **Frontend Pages:** Core pages include `/profit-loss` (P&L Statement), `/google-ads-hub` (Google Ads Reports), and `/insights` (Cross-Platform Insights), all accessible from the left sidebar.
- **Google Ads API Report Fetcher (GAARF) Integration:** `google-ads-api-report-fetcher@^4.0.0` is integrated for generating Google Ads reports using predefined and ad-hoc GAQL queries.
- **ADK Web Developer UI:** A cloned Angular 21 agent debugging UI from Google (`https://github.com/google/adk-web.git`) runs as a workflow on port 4200, accessible at `/dev-ui/`. It communicates with the backend via the ADK REST Protocol.
- **Agentic Workforce:** A workforce manifest (`AGENTS.md`) defines agents like Gap Finder, Growth Engine, and Organization CEO, each with specific tools. A OneMCP server implements JSON-RPC 2.0 for tool invocation, with multi-tenant isolation. An ApprovalQueue widget handles pending tasks and budget shift proposals.
- **Cryptographic Invite Links:** A 3-phase security upgrade introduced JWT-signed invite tokens with differentiated onboarding UX and improved invite management features.
- **Production Observability & CI/CD:** Sentry is integrated for error tracking on both frontend and backend. A CI/CD pipeline runs TypeScript checks, production builds, and Playwright E2E tests on every push/PR to `main`. Production hardening includes `helmet` for security and tightened CORS policies.
- **Repo-wide Lint Gates (CI `check-all` job):** Five static-analysis guards run on every push/PR via the `check-all` job in `.github/workflows/ci.yml` (depends on `secret-scan`, runs before `typecheck`). All five are enforced — zero pre-existing offenders remain. Guards: (1) `check:silent-catches` — catch blocks that return 500 with no log trail (`// silent-catch-ok: <reason>` to opt out); (2) `check:tenant-ownership` — unguarded reads/writes to org/workspace-scoped tables (`// tenant-ownership-skip: <reason>` within 15 lines above to opt out); (3) `check:sql-ambiguous-columns` — bare column references in SQL templates that would break on JOIN (`// sql-ambiguous-skip: <reason>` within 5 lines above to opt out); (4) `check:currency-leaks` — raw `` `$${...}` `` USD template literals in `ecom-agent` UI (`// usd-leak-allow: <reason>` to opt out); (5) `check:workspace-id-source` — workspaceId sourced from request params instead of DB. Run locally: `pnpm run check:all`. The `check-all` job also runs `scripts/test-check-currency-leaks.mjs` to verify the leak checker against fixture files.
- **TypeScript Strict Gate (CI):** The `typecheck` job in `.github/workflows/ci.yml` runs `pnpm run typecheck` from the repo root, which has two stages: (1) `tsc --build` compiles every shared lib that is wired into the root TS project references graph (`lib/*`, `lib/integrations/*`), and (2) `pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck` runs `tsc --noEmit` on every workspace package that exposes a `typecheck` script — currently `api-server`, `ecom-agent`, `mockup-sandbox`, and `scripts`. Any type error in either stage fails the pipeline and blocks the merge. Production esbuild bundling is lenient and will not catch these regressions, so this gate is the source of truth. When adding a new package under `artifacts/*` or `lib/*`, also (a) add a `typecheck` script and/or (b) wire its `tsconfig.json` into the root project references so it is covered. Run `pnpm run typecheck` locally before pushing.
- **OmniCopilot (Contextual AI Assistant):** A persistent floating widget provides a contextual AI assistant. It harvests context from the UI, uses Vertex AI Gemini 2.5 Pro with tool-calling capabilities, and enforces RBAC per-tool. It also supports an "Agent" mode that routes through `POST /api/ai-agents/run`.
- **Platform Admin Dashboard:** New `leads` DB persistence for form submissions. A `super_admin` role with dedicated middleware and API routes for platform-level administration (leads, tenants, global metrics). A "BigQuery Spend Alerter" panel lets platform admins configure `bytesThreshold`, `hitRateFloor`, and `cooldownMs` from the UI; values are persisted in the `app_settings` table and take effect on the next alerter tick without a server restart.
- **Reliability Program:** A multi-phase initiative to enhance reliability through route error handling, static analysis for silent catches, and comprehensive tenant isolation mechanisms with static linting to prevent cross-tenant data leaks.
- **Agency Logic Engine (Python FastAPI Microservice):** A standalone Python FastAPI service provides four real-time analytical layers: TrustLayer (reconciles ad data), ActionLayer (CEL-like playbook engine), ProfitLayer (real-time POAS calculator), and Multi-Tenant Aggregator (health dashboard). It incorporates recent enhancements like CTR trend enrichment, comprehensive unit tests, concurrent diagnostic sweeps, and CRM data strength monitoring.

# External Dependencies

- **AI:** Google Vertex AI Gemini 2.5 Pro (via `@google/genai` SDK — see migration note below), DALL-E 3, GPT-4o-mini

> **Vertex AI client (Phase 6 migration, 2026-04-18).** The legacy
> `@google-cloud/vertexai` SDK was removed from `artifacts/api-server` after
> Google deprecated it on 2025-06-24 (scheduled removal 2026-06-24). The new
> client lives at `artifacts/api-server/src/lib/vertex-client.ts` and wraps
> `@google/genai`'s `GoogleGenAI({ vertexai: true, project, location })`
> client. The exported surface (`getVertexAI()`,
> `vertexAI.getGenerativeModel({...})`, `model.generateContent({contents})`,
> `model.generateContentStream({contents})` with `.response.candidates` /
> `.stream`) intentionally mirrors the old SDK so the rest of the codebase
> kept its call shape — only the client module changed. New Gemini work
> should import from `lib/vertex-client` (not directly from `@google/genai`)
> so credentials, project, and location stay consistent.
- **Database:** PostgreSQL, pgvector
- **ORM:** Drizzle ORM
- **API Frameworks:** Express 5, FastAPI
- **Validation:** Zod
- **API Codegen:** Orval
- **Build Tool:** esbuild
- **Cloud Platform:** Google Cloud Platform
- **Authentication:** google-auth-library
- **Payment Processing:** Stripe
- **CRM SDKs:** @hubspot/api-client, jsforce (Salesforce)
- **Platform APIs:** Google Ads API, Meta Ads API, Shopify API, Google Merchant Center (GMC) API, Google Search Console (GSC) API, Google Sheets API v4, Google Drive API v3, Looker API
- **Queue/Broker:** Celery, Redis
- **Error Tracking:** Sentry (@sentry/react, @sentry/node)
- **PDF Parsing:** pdf-parse
- **CSV Parsing:** csv-parse/sync
- **Analytics Modeling:** dbt-core 1.10 + dbt-postgres
> **Greeting first-name (Task #142, Apr 2026).** The header greeting reads `omni_user_name` from localStorage and slices to the first token. Names written by the brand-onboarding flow can include possessives (e.g. `John's Store`), so the split delimiter is `/[\s'']/u` — both whitespace AND apostrophe (straight + curly) — so users never see `Welcome back, John's`. Long-term fix: introduce a dedicated `omni_user_first_name` field at signup; the split is a defensive read-side safeguard.

> **Active SKUs tile (Task #142, Apr 2026).** A new `ActiveSKUs_Tile` widget was added to the E-COMMERCE and HYBRID dashboards (registered in `WidgetRegistry.ts`). It surfaces `ecommerce.marginLeaks.length` as a count using a custom (non-`Tile`) layout so the label and value share an immediate `<div>` ancestor — required by the `dashboard-correctness.spec.ts` value-extraction predicate.
