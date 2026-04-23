-- Migration: create app_settings key-value store
--
-- Stores platform-wide configuration values that can be updated at runtime
-- without requiring a server restart or environment variable change.
-- Currently used by the Shopping Insider Cost Alerter (Task #187) to let
-- on-call admins adjust alert thresholds from the UI.

CREATE TABLE IF NOT EXISTS app_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
