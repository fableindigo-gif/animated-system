import { pgTable, serial, integer, text, timestamp, numeric } from "drizzle-orm/pg-core";

export const promoTriggers = pgTable("promo_triggers", {
  id:                    serial("id").primaryKey(),
  organizationId:        integer("organization_id"),
  productId:             text("product_id"),
  productTitle:          text("product_title"),
  sku:                   text("sku"),
  inventoryQty:          integer("inventory_qty"),
  avgPoas7d:             numeric("avg_poas_7d", { precision: 10, scale: 4 }),
  discountPercent:       integer("discount_percent").default(15),
  promoCode:             text("promo_code"),
  shopifyPriceRuleId:    text("shopify_price_rule_id"),
  shopifyDiscountCodeId: text("shopify_discount_code_id"),
  googleAdsAssetId:      text("google_ads_asset_id"),
  projectedRecovery:     numeric("projected_recovery", { precision: 12, scale: 2 }),
  status:                text("status").default("pending"),
  approvedAt:            timestamp("approved_at"),
  rejectedAt:            timestamp("rejected_at"),
  executedAt:            timestamp("executed_at"),
  errorMessage:          text("error_message"),
  triggeredAt:           timestamp("triggered_at").defaultNow().notNull(),
  createdAt:             timestamp("created_at").defaultNow().notNull(),
});

export type PromoTrigger  = typeof promoTriggers.$inferSelect;
export type InsertPromoTrigger = typeof promoTriggers.$inferInsert;
