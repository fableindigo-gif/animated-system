DROP INDEX "ai_gads_usage_org_date_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "ai_gads_usage_org_date_uq" ON "ai_gads_daily_usage" USING btree ("organization_id","usage_date");