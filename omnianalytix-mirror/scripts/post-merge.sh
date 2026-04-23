#!/bin/bash
# Runs after each merged task. Must be idempotent and tolerant of partial state.
set -e

pnpm install --frozen-lockfile
pnpm --filter db push

# ── Apply raw SQL migration files (expression indexes, extensions, etc.) ───────
# drizzle-kit push syncs Drizzle-managed schema but cannot express custom
# operator-class indexes (e.g. GIN trigram, composite partial B-tree).
# These live in lib/db/migrations/ and are idempotent (IF NOT EXISTS guards).
if [ -n "$DATABASE_URL" ]; then
  echo "[post-merge] Applying raw SQL migrations from lib/db/migrations/…"
  for sql_file in lib/db/migrations/*.sql; do
    [ -f "$sql_file" ] || continue
    echo "[post-merge]   → $sql_file"
    psql "$DATABASE_URL" -f "$sql_file" && echo "[post-merge]     OK" || echo "[post-merge]     WARN: $sql_file failed (non-fatal)" >&2
  done
else
  echo "[post-merge] DATABASE_URL not set — skipping raw SQL migrations"
fi

# ── Rebuild @workspace/db type declarations ───────────────────────────────────
# The db package uses composite project references (emitDeclarationOnly). Any
# task that adds schema files must rebuild the declarations so downstream
# packages (api-server etc.) can typecheck against the new exports.
echo "[post-merge] Rebuilding @workspace/db declarations…"
(cd lib/db && npx tsc --build) && echo "[post-merge] db build OK" || echo "[post-merge] WARN: db build failed" >&2

# ── dbt: rebuild analytical marts so the new warehouse modeling stays in sync ──
# Skipped if the dbt venv hasn't been created (e.g. CI without DB).
# Failures here are NON-FATAL: dbt only powers reporting marts, not the API
# runtime, and we don't want a transient warehouse blip to block a merge.
if [ -x ".venv-dbt/bin/dbt" ] && [ -f "dbt/dbt_project.yml" ]; then
  echo "[post-merge] Running dbt build…"
  if .venv-dbt/bin/dbt build --project-dir dbt --profiles-dir dbt 2>&1 | tail -20; then
    echo "[post-merge] dbt build OK"
  else
    echo "[post-merge] WARN: dbt build failed (non-fatal — marts may be stale)" >&2
  fi
else
  echo "[post-merge] dbt venv or project not present — skipping mart refresh"
fi
