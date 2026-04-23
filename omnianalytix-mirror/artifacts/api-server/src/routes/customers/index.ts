import { Router } from "express";
import { eq, and, isNull } from "drizzle-orm";
import { db, platformConnections } from "@workspace/db";
import { shopify_calculateCustomerCLV } from "../../lib/platform-executors";
import { logger } from "../../lib/logger";
import { getOrgId } from "../../middleware/rbac";
import { decryptCredentials } from "../../lib/credential-helpers";

const router = Router();

// GET /api/customers/clv?customer_id=...
router.get("/clv", async (req, res) => {
  try {
    const { customer_id } = req.query as { customer_id?: string };
    if (!customer_id) {
      return res.status(400).json({ error: "Missing required query param: customer_id" });
    }

    const orgId = getOrgId(req);
    const conditions = [eq(platformConnections.platform, "shopify")];
    conditions.push(orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId));
    const [conn] = await db
      .select()
      .from(platformConnections)
      .where(and(...conditions))
      .limit(1);

    if (!conn) {
      return res.status(409).json({ error: "Shopify not connected." });
    }

    const result = await shopify_calculateCustomerCLV(
      decryptCredentials(conn.credentials as Record<string, string>),
      customer_id,
    );

    logger.info({ customer_id, success: result.success }, "GET /customers/clv");
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    logger.error({ err }, "GET /customers/clv failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
