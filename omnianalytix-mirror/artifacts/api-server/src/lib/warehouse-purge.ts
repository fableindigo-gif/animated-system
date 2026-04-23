import {
  db,
  warehouseShopifyProducts,
  warehouseGoogleAds,
  warehouseCrossPlatformMapping,
  warehouseCrmLeads,
  liveTriageAlerts,
  workspaces,
} from "@workspace/db";
import { eq, or, inArray } from "drizzle-orm";
import { DEFAULT_TENANT_ID } from "@workspace/db/schema";
import { logger } from "./logger";

type GoalType = "ecom" | "leadgen" | "hybrid";

export async function getWorkspaceGoal(): Promise<GoalType> {
  try {
    const [ws] = await db
      .select({ primaryGoal: workspaces.primaryGoal })
      .from(workspaces)
      .orderBy(workspaces.id)
      .limit(1);
    const goal = ws?.primaryGoal;
    if (goal === "ecom" || goal === "leadgen" || goal === "hybrid") return goal;
  } catch (err) {
    console.error("[WarehousePurge] Failed to resolve workspace goal:", err);
  }
  return "ecom";
}

export async function purgeWarehouseForGoal(
  goal: GoalType,
  workspaceId = "default",
): Promise<{ purged: string[] }> {
  const purged: string[] = [];
  const tenantFilter = [DEFAULT_TENANT_ID, "demo"];

  if (goal === "ecom" || goal === "hybrid") {
    await db.delete(warehouseShopifyProducts).where(
      inArray(warehouseShopifyProducts.tenantId, tenantFilter),
    );
    purged.push("warehouse_shopify_products");

    await db.delete(warehouseCrossPlatformMapping).where(
      inArray(warehouseCrossPlatformMapping.tenantId, tenantFilter),
    );
    purged.push("warehouse_cross_platform_mapping");
  }

  if (goal === "ecom" || goal === "leadgen" || goal === "hybrid") {
    await db.delete(warehouseGoogleAds).where(
      inArray(warehouseGoogleAds.tenantId, tenantFilter),
    );
    purged.push("warehouse_google_ads");
  }

  if (goal === "leadgen" || goal === "hybrid") {
    await db.delete(warehouseCrmLeads).where(
      inArray(warehouseCrmLeads.tenantId, tenantFilter),
    );
    purged.push("warehouse_crm_leads");
  }

  await db.delete(liveTriageAlerts).where(
    eq(liveTriageAlerts.workspaceId, workspaceId),
  );
  purged.push("live_triage_alerts");

  logger.info(
    { goal, workspaceId, purged },
    "Warehouse purge complete — demo/stale data cleared before live sync",
  );

  return { purged };
}
