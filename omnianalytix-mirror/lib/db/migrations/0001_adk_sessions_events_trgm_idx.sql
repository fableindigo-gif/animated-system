-- Ensure pg_trgm extension is available.
-- NOTE: The GIN trigram index (adk_sessions_events_trgm_idx) was removed
-- from both dev and prod to avoid deploy-time validation failures caused by
-- Replit's database diff validator not having pg_trgm installed in production.
-- The ILIKE search still works correctly without the index (sequential scan).

CREATE EXTENSION IF NOT EXISTS pg_trgm;
