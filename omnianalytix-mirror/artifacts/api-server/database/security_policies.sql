-- ─────────────────────────────────────────────────────────────────────────────
-- OmniAnalytix — Sprint X: Enterprise Security Policies
-- Row-Level Security (RLS) + Least-Privilege Read-Only Role
--
-- EXECUTION: Run once against your PostgreSQL instance.
-- Safe to re-run (uses IF NOT EXISTS / DROP POLICY IF EXISTS).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1: Ensure tenant_id columns exist ────────────────────────────────────
-- (Drizzle db:push adds these via the schema, but we guard here for safety)

ALTER TABLE warehouse_shopify_products
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE warehouse_google_ads
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE warehouse_cross_platform_mapping
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';

-- Backfill any pre-existing rows that have no tenant_id
UPDATE warehouse_shopify_products      SET tenant_id = 'default' WHERE tenant_id IS NULL OR tenant_id = '';
UPDATE warehouse_google_ads            SET tenant_id = 'default' WHERE tenant_id IS NULL OR tenant_id = '';
UPDATE warehouse_cross_platform_mapping SET tenant_id = 'default' WHERE tenant_id IS NULL OR tenant_id = '';

-- ── Step 2: Enable RLS on warehouse tables ────────────────────────────────────

ALTER TABLE warehouse_shopify_products      ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_google_ads            ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_cross_platform_mapping ENABLE ROW LEVEL SECURITY;

-- FORCE RLS so that even the table owner (app DB user) is subject to policies.
-- This prevents accidental cross-tenant reads in the AI tool execution path.
ALTER TABLE warehouse_shopify_products      FORCE ROW LEVEL SECURITY;
ALTER TABLE warehouse_google_ads            FORCE ROW LEVEL SECURITY;
ALTER TABLE warehouse_cross_platform_mapping FORCE ROW LEVEL SECURITY;

-- ── Step 3: Drop existing policies (idempotent re-run safety) ─────────────────

DROP POLICY IF EXISTS tenant_isolation ON warehouse_shopify_products;
DROP POLICY IF EXISTS tenant_isolation ON warehouse_google_ads;
DROP POLICY IF EXISTS tenant_isolation ON warehouse_cross_platform_mapping;

DROP POLICY IF EXISTS etl_bypass ON warehouse_shopify_products;
DROP POLICY IF EXISTS etl_bypass ON warehouse_google_ads;
DROP POLICY IF EXISTS etl_bypass ON warehouse_cross_platform_mapping;

-- ── Step 4: Tenant isolation policies ────────────────────────────────────────
--
-- STRICT MULTI-TENANT MODE: app.current_tenant_id MUST be set in every session.
-- If the session variable is missing or empty, NO rows are visible.
-- This prevents accidental cross-tenant data leakage.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY tenant_isolation ON warehouse_shopify_products
  FOR ALL
  USING (
    tenant_id = current_setting('app.current_tenant_id', true)
    AND current_setting('app.current_tenant_id', true) IS NOT NULL
    AND current_setting('app.current_tenant_id', true) != ''
  );

CREATE POLICY tenant_isolation ON warehouse_google_ads
  FOR ALL
  USING (
    tenant_id = current_setting('app.current_tenant_id', true)
    AND current_setting('app.current_tenant_id', true) IS NOT NULL
    AND current_setting('app.current_tenant_id', true) != ''
  );

CREATE POLICY tenant_isolation ON warehouse_cross_platform_mapping
  FOR ALL
  USING (
    tenant_id = current_setting('app.current_tenant_id', true)
    AND current_setting('app.current_tenant_id', true) IS NOT NULL
    AND current_setting('app.current_tenant_id', true) != ''
  );

-- ── Step 5: Read-only role for the AI execution path ─────────────────────────
-- The AI's query_unified_warehouse tool uses SET LOCAL TRANSACTION READ ONLY
-- at the Drizzle layer (see gemini-tools.ts). This SQL role is the DB-level
-- enforcement layer — a defence-in-depth backstop.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omni_ai_readonly') THEN
    CREATE ROLE omni_ai_readonly NOLOGIN;
  END IF;
END
$$;

-- Grant SELECT only on warehouse tables to the read-only role
GRANT SELECT ON warehouse_shopify_products      TO omni_ai_readonly;
GRANT SELECT ON warehouse_google_ads            TO omni_ai_readonly;
GRANT SELECT ON warehouse_cross_platform_mapping TO omni_ai_readonly;

-- Explicitly revoke any write capabilities (defence-in-depth)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON warehouse_shopify_products, warehouse_google_ads, warehouse_cross_platform_mapping
  FROM omni_ai_readonly;

-- ── Step 6: Index tenant_id for RLS filter performance ───────────────────────

CREATE INDEX IF NOT EXISTS idx_warehouse_shopify_tenant
  ON warehouse_shopify_products (tenant_id);

CREATE INDEX IF NOT EXISTS idx_warehouse_google_ads_tenant
  ON warehouse_google_ads (tenant_id);

CREATE INDEX IF NOT EXISTS idx_warehouse_mapping_tenant
  ON warehouse_cross_platform_mapping (tenant_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Done. RLS is active. Verify with:
--   SELECT relname, relrowsecurity, relforcerowsecurity
--   FROM pg_class
--   WHERE relname IN ('warehouse_shopify_products','warehouse_google_ads','warehouse_cross_platform_mapping');
-- ─────────────────────────────────────────────────────────────────────────────
