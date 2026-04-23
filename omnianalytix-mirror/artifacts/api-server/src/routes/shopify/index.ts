import { Router } from "express";
import { eq, and, isNull } from "drizzle-orm";
import { db, platformConnections } from "@workspace/db";
import { shopify_createLiquidationDiscount } from "../../lib/platform-executors";
import { logger } from "../../lib/logger";
import { getOrgId } from "../../middleware/rbac";
import { decryptCredentials } from "../../lib/credential-helpers";

const router = Router();

// POST /api/shopify/discount
// Body: { product_id, discount_percentage, title? }
router.post("/discount", async (req, res) => {
  try {
    const { product_id, discount_percentage } = req.body as {
      product_id?: string;
      discount_percentage?: number;
    };

    if (!product_id || discount_percentage == null) {
      return res.status(400).json({
        error: "Missing required fields: product_id, discount_percentage",
      });
    }

    if (discount_percentage <= 0 || discount_percentage >= 100) {
      return res.status(400).json({ error: "discount_percentage must be between 1 and 99" });
    }

    const shopifyOrgId = getOrgId(req);
    const shopifyConditions = and(
      eq(platformConnections.platform, "shopify"),
      shopifyOrgId != null ? eq(platformConnections.organizationId, shopifyOrgId) : isNull(platformConnections.organizationId),
    );
    const [conn] = await db
      .select()
      .from(platformConnections)
      .where(shopifyConditions)
      .limit(1);

    if (!conn) {
      return res.status(409).json({ error: "Shopify not connected." });
    }

    const result = await shopify_createLiquidationDiscount(
      decryptCredentials(conn.credentials as Record<string, string>),
      product_id,
      discount_percentage,
    );

    logger.info({ product_id, discount_percentage, success: result.success }, "POST /shopify/discount");
    return res.status(result.success ? 201 : 500).json(result);
  } catch (err) {
    logger.error({ err }, "POST /shopify/discount failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
