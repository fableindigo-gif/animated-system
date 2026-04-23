# OmniAnalytix dbt project

Versioned, tested, documented analytical models on top of our existing
Postgres warehouse. dbt only **reads** from `warehouse_*` (owned by the
API server) and **writes** to two new schemas it owns end-to-end:

| Schema              | Owned by | Materialisation | Purpose |
| ------------------- | -------- | --------------- | ------- |
| `public_analytics_stg` | dbt   | view            | Light alias layer over raw warehouse tables. |
| `public_analytics`     | dbt   | table           | Marts the agents and dashboards read from. |

The legacy `public.v_ads_on_empty_shelves` and `public.v_poas_by_sku`
views in `artifacts/api-server/database/schema.sql` are **left
untouched** so nothing breaks during the migration. Once the
`public_analytics.*` marts are wired into the agent's `query_warehouse`
tool, those legacy views can be dropped.

## Quick start

```bash
# One-time install (already done in this repo, see /.venv-dbt):
uv pip install --python .venv-dbt/bin/python dbt-core dbt-postgres

# Verify the connection (uses PGHOST/PGUSER/etc. from the env):
.venv-dbt/bin/dbt debug    --project-dir dbt --profiles-dir dbt

# Build everything (staging views + marts tables) into Postgres:
.venv-dbt/bin/dbt run      --project-dir dbt --profiles-dir dbt

# Run the schema tests (not_null, unique, relationships):
.venv-dbt/bin/dbt test     --project-dir dbt --profiles-dir dbt

# Generate + serve the lineage docs site (great for onboarding):
.venv-dbt/bin/dbt docs generate --project-dir dbt --profiles-dir dbt
.venv-dbt/bin/dbt docs serve    --project-dir dbt --profiles-dir dbt --port 8081
```

## Project layout

```
dbt/
├── dbt_project.yml          # project config (name, paths, materialisations per dir)
├── profiles.yml             # connection (reads PGHOST/PGUSER/... from env)
├── models/
│   ├── staging/             # views — alias layer over warehouse_*
│   │   ├── sources.yml      # source declarations + freshness + relationships
│   │   ├── stg_google_ads.sql
│   │   ├── stg_shopify_products.sql
│   │   └── stg_cross_platform_mapping.sql
│   └── marts/               # tables — read by agents + dashboards
│       ├── ads_on_empty_shelves.sql
│       ├── poas_by_sku.sql
│       └── schema.yml       # column docs + tests
├── macros/                  # (empty — add reusable Jinja here)
├── tests/                   # (empty — add singular tests here)
└── target/                  # build output (git-ignored)
```

## Why dbt was chosen (decision link)

See `docs/GENKIT_EVALUATION.md` companion: dbt won the framework eval
because it (1) sits on top of our existing Postgres without changing
runtime, (2) versions + tests our SQL transforms, (3) produces a
free lineage doc site, and (4) doesn't pull in any Node deps.

## Adding a new model

1. Drop a `.sql` file under `models/marts/` (or `models/staging/`).
2. Reference upstream tables via `{{ source('warehouse', '...') }}` for
   raw tables or `{{ ref('stg_...') }}` for staging models. Never use
   bare table names — that breaks lineage.
3. Add a `columns:` block to `models/marts/schema.yml` with at least
   one `data_tests:` entry per primary key (`unique`, `not_null`).
4. `dbt run --select <new_model>` to build it; `dbt test
   --select <new_model>` to verify.
5. The agent's `query_warehouse` tool can read it immediately — it's
   just another Postgres table.

## Cron / CI hookup (next step)

Not wired yet. The intended path:
- Add a `dbt run && dbt test` step to the same cron that already runs
  GAARF + Shopify sync, so marts refresh after each warehouse refresh.
- Run `dbt build --select state:modified+ --defer` on every PR to catch
  schema regressions before merge.
