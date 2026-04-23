import { Router } from "express";
import { eq, and, isNull, sql } from "drizzle-orm";
import { db, platformConnections, warehouseShopifyProducts } from "@workspace/db";
import { shopify_calculateSalesVelocity } from "../../lib/platform-executors";
import { logger } from "../../lib/logger";
import { getOrgId } from "../../middleware/rbac";
import { decryptCredentials } from "../../lib/credential-helpers";

const router = Router();

router.get("/velocity", async (req, res) => {
  try {
    const { product_id } = req.query as { product_id?: string };
    if (!product_id) {
      return res.status(400).json({ error: "Missing required query param: product_id" });
    }

    // SEC-09: Validate product_id format before forwarding to Shopify. Accept
    // either a bare numeric id or a Shopify Global ID (gid://shopify/Product/N).
    const PRODUCT_ID_RE = /^(\d{1,32}|gid:\/\/shopify\/Product\/\d{1,32})$/;
    if (!PRODUCT_ID_RE.test(product_id)) {
      return res.status(400).json({ error: "Invalid product_id format" });
    }
    // Normalize to bare numeric id (the warehouse stores product_id as the
    // bare number; Shopify SDK accepts both forms).
    const numericProductId = product_id.startsWith("gid://")
      ? product_id.split("/").pop()!
      : product_id;

    const orgId = getOrgId(req);

    // SEC-09: Ownership verification. Confirm this product_id exists in the
    // caller's tenant warehouse before forwarding to Shopify. The warehouse
    // sync stores tenant_id as the org id (string). If the warehouse is
    // populated and the product is not found in the caller's tenant, return
    // 404 — this prevents an authenticated tenant from probing other tenants'
    // product ids by guessing. (The Shopify SDK call below is also org-scoped
    // by credentials, so this is defense in depth.)
    if (orgId != null) {
      const tenantId = String(orgId);
      const [ownerRow] = await db
        .select({ exists: sql<number>`1` })
        .from(warehouseShopifyProducts)
        .where(and(
          eq(warehouseShopifyProducts.tenantId, tenantId),
          eq(warehouseShopifyProducts.productId, numericProductId),
        ))
        .limit(1);
      // If ANY products are synced for this tenant, enforce ownership. If the
      // warehouse is empty (first-run, sync never ran), fall through — the
      // Shopify call will still be org-scoped by credentials below.
      if (!ownerRow) {
        const [tenantHasAny] = await db
          .select({ exists: sql<number>`1` })
          .from(warehouseShopifyProducts)
          .where(eq(warehouseShopifyProducts.tenantId, tenantId))
          .limit(1);
        if (tenantHasAny) {
          return res.status(404).json({ error: "Product not found" });
        }
      }
    }

    const conditions = [eq(platformConnections.platform, "shopify"), eq(platformConnections.isActive, true)];
    conditions.push(orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId));

    const [conn] = await db
      .select()
      .from(platformConnections)
      .where(and(...conditions))
      .limit(1);

    if (!conn) {
      return res.status(409).json({ error: "Shopify not connected." });
    }

    const result = await shopify_calculateSalesVelocity(
      decryptCredentials(conn.credentials as Record<string, string>),
      product_id,
    );

    logger.info({ product_id, success: result.success }, "GET /inventory/velocity");
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    logger.error({ err }, "GET /inventory/velocity failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
