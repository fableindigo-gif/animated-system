import { pgTable, serial, text, timestamp, integer, jsonb, doublePrecision, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const organizations = pgTable("organizations", {
  id:                    serial("id").primaryKey(),
  name:                  text("name").notNull(),
  slug:                  text("slug").notNull().unique(),
  subscriptionTier:      text("subscription_tier").notNull().default("free"),
  stripeCustomerId:      text("stripe_customer_id"),
  stripeSubscriptionId:  text("stripe_subscription_id"),
  aiCreativeCredits:     integer("ai_creative_credits").notNull().default(0),
  // Captured during onboarding so the dashboard can pre-configure widgets,
  // routing, and recommended workflows without re-prompting the user.
  primaryGoal:           text("primary_goal"),                                    // 'ecom' | 'leadgen'
  selectedPlatforms:     jsonb("selected_platforms").$type<string[]>().default([]).notNull(),
  selectedWorkflows:     jsonb("selected_workflows").$type<string[]>().default([]).notNull(),
  // Per-tenant economics (Task #153). True Profit, POAS and the Health
  // badge use these instead of hard-coded portfolio constants. Nullable
  // so the dashboard can fall back to its own DEFAULT_COGS_PCT /
  // DEFAULT_TARGET_ROAS when a brand hasn't configured them yet.
  cogsPctDefault:        doublePrecision("cogs_pct_default"),                     // 0..1, e.g. 0.35
  targetRoasDefault:     doublePrecision("target_roas_default"),                  // e.g. 4.0
  // AI Google Ads guardrails (Task #159). Cap how far back AI queries look and
  // how many rows per day the AI assistant may read from Google Ads.
  // Nullable = use platform defaults (180 days / 50 000 rows).
  aiMaxLookbackDays:     integer("ai_max_lookback_days"),                         // max window in days (default 180)
  aiDailyRowCap:         integer("ai_daily_row_cap"),                             // daily row read cap (default 50 000)
  createdAt:             timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Per-campaign target ROAS overrides (Task #153). When a row is present,
// the campaign's Health badge math uses this value instead of the
// organization's `targetRoasDefault`. Stored as a small append-only
// table — admins/managers add/remove rows; dashboard reads them in bulk.
export const campaignTargets = pgTable("campaign_targets", {
  id:              serial("id").primaryKey(),
  organizationId:  integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  campaignId:      text("campaign_id").notNull(),
  targetRoas:      doublePrecision("target_roas").notNull(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  uniqOrgCampaign: uniqueIndex("campaign_targets_org_campaign_uq").on(t.organizationId, t.campaignId),
  byOrg:           index("campaign_targets_org_idx").on(t.organizationId),
}));

export const insertOrganizationSchema = createInsertSchema(organizations).omit({
  id: true,
  createdAt: true,
});

export type Organization       = typeof organizations.$inferSelect;
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
