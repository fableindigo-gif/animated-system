import { Router } from "express";
import { eq, and, isNull, sql } from "drizzle-orm";
import {
  db,
  platformConnections,
  workspaces,
  warehouseShopifyProducts,
  warehouseGoogleAds,
  warehouseCrossPlatformMapping,
  warehouseCrmLeads,
} from "@workspace/db";
import { DEFAULT_TENANT_ID } from "@workspace/db/schema";
import { getFreshGoogleCredentials } from "../../lib/google-token-refresh";
import { decryptCredentials } from "../../lib/credential-helpers";
import { logger } from "../../lib/logger";
import { etlState } from "../../lib/etl-state";
import { etlRateLimit } from "../../middleware/rate-limiter";
import { getOrgId } from "../../middleware/rbac";
import { assertWorkspaceOwnedByOrg } from "../../middleware/tenant-isolation";
import { runAdvancedDiagnostics } from "../../lib/advanced-diagnostic-engine";
import { emitTriageAlert } from "../../lib/triage-emitter";
import { purgeWarehouseForGoal } from "../../lib/warehouse-purge";
import { fetchWithBackoff } from "../../lib/fetch-utils";
import { handleRouteError } from "../../lib/route-error-handler";
import { customerFromCreds } from "../../lib/google-ads/client";

const router = Router();

// ─── POST /api/etl/sync-master ─────────────────────────────────────────────
//
// Orchestrates a full cross-platform ETL sync:
//   1. Fetches all Shopify products + inventory + COGS
//   2. Fetches Google Ads (campaign / ad_group / ad) with final_urls + metrics
//   3. Upserts both into the warehouse tables
//   4. Rebuilds the cross_platform_mapping by extracting SKU / handle
//      from each ad's final_url
//
async function executeEtlSync(orgId?: number | null) {
  if (etlState.status === "running") {
    throw new Error("ETL sync already in progress");
  }

  // ── Pre-flight: refuse to run if no platforms are connected for this org.
  // Previously this would silently complete with empty `report.shopify.errors`
  // entries, leaving the warehouse empty and confusing downstream agents into
  // an infinite "run Master Sync" loop. Fail loudly instead.
  const orgFilter = orgId != null
    ? eq(platformConnections.organizationId, orgId)
    : isNull(platformConnections.organizationId);
  const connectedRows = await db
    .select({ platform: platformConnections.platform })
    .from(platformConnections)
    .where(orgFilter);
  if (connectedRows.length === 0) {
    const msg = "No platforms connected — Master Sync has nothing to ingest. Connect Shopify, Google Ads, or Google Merchant Center on the Connections page first.";
    etlState.status = "error";
    etlState.lastError = msg;
    etlState.completedAt = Date.now();
    const err = new Error(msg) as Error & { code?: string };
    err.code = "NO_PLATFORMS_CONNECTED";
    throw err;
  }

  etlState.status = "running";
  etlState.startedAt = Date.now();
  etlState.completedAt = null;
  const syncTenantId = orgId != null ? String(orgId) : DEFAULT_TENANT_ID;
  etlState.phase = "Initialising warehouse sync…";
  etlState.pct = 3;
  etlState.rowsExtracted = 0;
  etlState.lastError = null;

  const startedAt = Date.now();
  const report: {
    shopify: { synced: number; errors: string[] };
    googleAds: { synced: number; errors: string[] };
    mapping: { synced: number };
    durationMs: number;
  } = {
    shopify:   { synced: 0, errors: [] },
    googleAds: { synced: 0, errors: [] },
    mapping:   { synced: 0 },
    durationMs: 0,
  };

  // ── 1. Shopify Sync ────────────────────────────────────────────────────────
  try {
    const shopifyConditions = [eq(platformConnections.platform, "shopify")];
    shopifyConditions.push(orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId));
    const shopifyRows = await db
      .select()
      .from(platformConnections)
      .where(and(...shopifyConditions));

    if (shopifyRows.length === 0) {
      report.shopify.errors.push("Shopify not connected");
    } else {
      const creds = decryptCredentials(shopifyRows[0].credentials as Record<string, string>);
      const { shopDomain, accessToken } = creds;

      if (!shopDomain || !accessToken) {
        report.shopify.errors.push("Shopify credentials incomplete (missing shopDomain or accessToken)");
      } else {
        const baseUrl = `https://${shopDomain}`;
        const headers = {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        };

        // Paginate through all products (up to 1 000 in first pass — covers most stores)
        let pageUrl: string | null =
          `${baseUrl}/admin/api/2024-01/products.json?limit=250&status=active&fields=id,title,handle,status,variants`;

        const allProducts: Array<{
          id: number;
          title: string;
          handle: string;
          status: string;
          variants: Array<{
            id: number;
            sku: string;
            title: string;
            price: string;
            inventory_quantity: number;
            inventory_item_id: number;
          }>;
        }> = [];

        while (pageUrl && allProducts.length < 1000) {
          try {
            const resp = await fetchWithBackoff(pageUrl, { headers, tag: "etl-shopify-products", timeoutMs: 30_000 });
            if (!resp.ok) {
              const text = await resp.text().catch(() => resp.statusText);
              report.shopify.errors.push(`Shopify products API: ${resp.status} ${text.slice(0, 120)}`);
              break;
            }
            const json = await resp.json() as { products?: typeof allProducts };
            const batch = json.products ?? [];
            allProducts.push(...batch);

            // Follow Shopify's Link header pagination
            const linkHeader = resp.headers.get("Link") ?? "";
            const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
            pageUrl = nextMatch ? nextMatch[1] : null;
          } catch (err) {
            report.shopify.errors.push(`Shopify pagination error: ${String(err)}`);
            break;
          }
        }

        // Fetch COGS from inventory_items for all variants in one batch
        const inventoryItemIds = allProducts
          .flatMap((p) => p.variants.map((v) => v.inventory_item_id))
          .filter(Boolean)
          .slice(0, 250); // API limit per request

        const cogsMap: Record<string, number> = {};

        if (inventoryItemIds.length > 0) {
          try {
            const cogsResp = await fetchWithBackoff(
              `${baseUrl}/admin/api/2024-01/inventory_items.json?ids=${inventoryItemIds.join(",")}&fields=id,cost,sku`,
              { headers, tag: "etl-shopify-cogs", timeoutMs: 30_000 },
            );
            if (cogsResp.ok) {
              const cogsJson = await cogsResp.json() as {
                inventory_items?: Array<{ id: number; cost?: string; sku?: string }>;
              };
              for (const item of cogsJson.inventory_items ?? []) {
                cogsMap[String(item.id)] = parseFloat(item.cost ?? "0");
              }
            }
          } catch (err) {
            report.shopify.errors.push(`COGS fetch warning: ${String(err)}`);
          }
        }

        // Upsert each product variant into the warehouse
        for (const product of allProducts) {
          for (const variant of product.variants) {
            const rowId = `${product.id}_${variant.sku || variant.id}`;
            try {
              await db
                .insert(warehouseShopifyProducts)
                .values({
                  id:           rowId,
                  tenantId:     syncTenantId,
                  productId:    String(product.id),
                  sku:          variant.sku ?? "",
                  handle:       product.handle ?? "",
                  title:        product.title ?? "",
                  variantTitle: variant.title ?? "",
                  status:       product.status ?? "active",
                  inventoryQty: variant.inventory_quantity ?? 0,
                  price:        parseFloat(variant.price ?? "0"),
                  cogs:         cogsMap[String(variant.inventory_item_id)] ?? 0,
                  syncedAt:     new Date(),
                })
                .onConflictDoUpdate({
                  target: warehouseShopifyProducts.id,
                  set: {
                    sku:          variant.sku ?? "",
                    handle:       product.handle ?? "",
                    title:        product.title ?? "",
                    variantTitle: variant.title ?? "",
                    status:       product.status ?? "active",
                    inventoryQty: variant.inventory_quantity ?? 0,
                    price:        parseFloat(variant.price ?? "0"),
                    cogs:         cogsMap[String(variant.inventory_item_id)] ?? 0,
                    syncedAt:     new Date(),
                  },
                });
              report.shopify.synced++;
              etlState.rowsExtracted++;
            } catch (err) {
              report.shopify.errors.push(`Upsert error for ${rowId}: ${String(err)}`);
            }
          }
        }
        logger.info({ synced: report.shopify.synced }, "Shopify ETL complete");
      }
    }
  } catch (err) {
    logger.error({ err }, "Shopify ETL sync failed");
    report.shopify.errors.push(`Shopify sync critical failure: ${String(err)}`);
  }

  etlState.phase = "Syncing Google Ads campaigns…";
  etlState.pct = 50;

  // ── 2. Google Ads Sync ────────────────────────────────────────────────────
  const googleAdRows: Array<typeof warehouseGoogleAds.$inferSelect> = [];
  try {
    const creds = await getFreshGoogleCredentials("google_ads", orgId);
    const refreshToken = creds?.refreshToken ?? (creds as Record<string, string> | null)?.refresh_token;
    if (!creds?.customerId) {
      report.googleAds.errors.push("Google Ads not connected or customerId missing");
    } else if (!refreshToken) {
      report.googleAds.errors.push("Google Ads connection needs re-authorization — refresh token missing");
    } else {
      const customerId = creds.customerId.replace(/-/g, "");
      const normalizedCreds: Record<string, string> = {
        ...(creds as Record<string, string>),
        refreshToken,
        customerId: creds.customerId,
      };
      const gadsCustomer = customerFromCreds(normalizedCreds);

      try {
        const currencyQuery = `SELECT customer.id, customer.currency_code FROM customer LIMIT 1`;
        const currRows = await gadsCustomer.query(currencyQuery) as Array<Record<string, unknown>>;
        const currencyCode = (currRows[0]?.customer as Record<string, unknown>)?.currencyCode as string | undefined;
        if (currencyCode) {
            const connFilter = orgId != null
              ? sql`${platformConnections.platform} = 'google_ads' AND ${platformConnections.organizationId} = ${orgId}`
              : sql`${platformConnections.platform} = 'google_ads' AND ${platformConnections.organizationId} IS NULL`;
            const [conn] = await db.select({ id: platformConnections.id, credentials: platformConnections.credentials }).from(platformConnections).where(connFilter);
            if (conn) {
              const existingCreds = conn.credentials as Record<string, string>;
              if (existingCreds.currency !== currencyCode) {
                existingCreds.currency = currencyCode;
                await db.update(platformConnections).set({ credentials: existingCreds }).where(eq(platformConnections.id, conn.id));
                logger.info({ currencyCode, connId: conn.id }, "Stored Google Ads account currency");
              }
            }
          }
      } catch (currErr) {
        logger.warn({ err: currErr }, "Failed to fetch Google Ads currency (non-fatal)");
      }

      // ── Campaign-level GAQL ──────────────────────────────────────────────────
      //
      // Previously queried FROM ad_group_ad — which silently returned ZERO rows
      // for Performance Max campaigns (PMax uses asset groups, not standard ad
      // groups, so ad_group_ad metrics are empty for PMax). The old query also
      // didn't fetch metrics.conversions_value, so attributed revenue was always
      // $0 on the dashboard regardless of actual conversion tracking.
      //
      // Fixed: query FROM campaign with ENABLED+PAUSED status (we want spend
      // data even for paused campaigns in the period), fetch conversions_value
      // so revenue is real, and store one row per campaign. The account currency
      // is stored alongside so downstream callers can apply FX if needed.
      //
      // Cross-platform URL matching (SKU→ad) runs as a secondary pass below
      // against non-PMax campaigns that DO have ad-level final_urls. PMax
      // products are matched via the GMC/Shopify product catalogue instead.

      // Resolve account currency from earlier fetch (stored on the connection)
      let resolvedAccountCurrency = "USD";
      try {
        const connFilter = orgId != null
          ? sql`${platformConnections.platform} = 'google_ads' AND ${platformConnections.organizationId} = ${orgId}`
          : sql`${platformConnections.platform} = 'google_ads' AND ${platformConnections.organizationId} IS NULL`;
        const [conn] = await db.select({ credentials: platformConnections.credentials }).from(platformConnections).where(connFilter);
        if (conn) {
          const c = conn.credentials as Record<string, string>;
          if (c.currency) resolvedAccountCurrency = c.currency;
        }
      } catch { /* non-fatal */ }

      // Clear stale campaign rows for this tenant before inserting fresh data.
      // Without this, old/renamed campaigns persist in the warehouse forever.
      try {
        await db.execute(sql`DELETE FROM ${warehouseGoogleAds} WHERE ${warehouseGoogleAds.tenantId} = ${syncTenantId}`);
      } catch (delErr) {
        logger.warn({ err: delErr }, "Could not truncate stale Google Ads rows (continuing)");
      }

      // Fetch all statuses (ENABLED, PAUSED, REMOVED) so the warehouse can serve
      // every status-filter tab without falling back to a live API call.
      // The date segment is still required by the API for metrics queries, but
      // we intentionally omit the status filter so REMOVED campaigns with
      // recent activity are included here. No LIMIT is specified so the
      // google-ads-api SDK returns all matching rows via automatic pagination.
      const campaignGaql = `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type,
          metrics.cost_micros,
          metrics.conversions,
          metrics.conversions_value,
          metrics.impressions,
          metrics.clicks
        FROM campaign
        WHERE segments.date DURING LAST_30_DAYS
        ORDER BY metrics.cost_micros DESC
      `;

      try {
        const campaignRows = await gadsCustomer.query(campaignGaql) as Array<Record<string, unknown>>;

        {
          for (const r of campaignRows) {
            const campaign = r.campaign as Record<string, unknown>;
            const metrics  = r.metrics  as Record<string, unknown>;
            const campaignId = String(campaign?.id ?? "");
            if (!campaignId) continue;

            // Use campaignId as the primary key so each campaign = one row.
            // adGroupId/adId are sentinel values for campaign-level rows.
            const row: typeof warehouseGoogleAds.$inferSelect = {
              id:              campaignId,
              tenantId:        syncTenantId,
              campaignId,
              campaignName:    String(campaign?.name ?? ""),
              adGroupId:       "campaign_level",
              adGroupName:     String(campaign?.advertisingChannelType ?? ""),
              adId:            "campaign_level",
              advertisingChannelType: (campaign?.advertisingChannelType as string) ?? null,
              finalUrl:        "",
              costUsd:         Number(metrics?.costMicros ?? 0) / 1_000_000,
              conversionValue: parseFloat(String(metrics?.conversionsValue ?? "0")),
              conversions:     parseFloat(String(metrics?.conversions ?? "0")),
              impressions:     parseInt(String(metrics?.impressions ?? "0"), 10),
              clicks:          parseInt(String(metrics?.clicks ?? "0"), 10),
              status:          String(campaign?.status ?? "ENABLED"),
              accountCurrency: resolvedAccountCurrency,
              syncedAt:        new Date(),
            };

            try {
              await db
                .insert(warehouseGoogleAds)
                .values(row)
                .onConflictDoUpdate({
                  target: warehouseGoogleAds.id,
                  set: {
                    campaignName:    row.campaignName,
                    adGroupName:     row.adGroupName,
                    finalUrl:        row.finalUrl,
                    costUsd:         row.costUsd,
                    conversionValue: row.conversionValue,
                    conversions:     row.conversions,
                    impressions:     row.impressions,
                    clicks:          row.clicks,
                    status:          row.status,
                    accountCurrency: row.accountCurrency,
                    syncedAt:        new Date(),
                  },
                });
              googleAdRows.push(row);
              report.googleAds.synced++;
              etlState.rowsExtracted++;
            } catch (err) {
              report.googleAds.errors.push(`Upsert error for campaign ${campaignId}: ${String(err)}`);
            }
          }
          logger.info({ synced: report.googleAds.synced, currency: resolvedAccountCurrency }, "Google Ads campaign ETL complete");
        }
      } catch (err) {
        logger.error({ err }, "Google Ads GAQL fetch failed");
        report.googleAds.errors.push(`Google Ads API timeout/error: ${String(err)}`);
      }

      // ── Metadata-only pass: capture PAUSED/REMOVED campaigns inactive >30 days ─
      // The metrics query above requires segments.date so it only returns campaigns
      // that had at least one impression/click/spend event in the last 30 days.
      // PAUSED and REMOVED campaigns that have been inactive longer than that
      // window will not appear in the metrics query result. We run a separate
      // attribute-only GAQL (no date segment) to collect all campaigns and
      // insert stub rows with zero metrics for any campaign not already captured
      // above. This ensures the warehouse serves ALL status-filter tabs
      // (/channels?filter.status=PAUSED|REMOVED) without a live API round-trip.
      try {
        // No LIMIT — the google-ads-api SDK auto-paginates so all campaigns
        // are returned regardless of account size.
        const campaignMetaGaql = `
          SELECT
            campaign.id,
            campaign.name,
            campaign.status,
            campaign.advertising_channel_type
          FROM campaign
          ORDER BY campaign.id
        `;
        const metaRows = await gadsCustomer.query(campaignMetaGaql) as Array<Record<string, unknown>>;
        const alreadySynced = new Set(googleAdRows.map((r) => r.id));
        let metaInserted = 0;
        for (const r of metaRows) {
          const campaign = r.campaign as Record<string, unknown>;
          const campaignId = String(campaign?.id ?? "");
          if (!campaignId || alreadySynced.has(campaignId)) continue;
          // Only persist PAUSED/REMOVED stubs — ENABLED campaigns absent from the
          // metrics query are anomalous (would show 0 spend for an active campaign).
          const status = String(campaign?.status ?? "");
          if (status !== "PAUSED" && status !== "REMOVED") continue;
          const stubRow: typeof warehouseGoogleAds.$inferSelect = {
            id:              campaignId,
            tenantId:        syncTenantId,
            campaignId,
            campaignName:    String(campaign?.name ?? ""),
            adGroupId:       "campaign_level",
            adGroupName:     String(campaign?.advertisingChannelType ?? ""),
            adId:            "campaign_level",
            advertisingChannelType: (campaign?.advertisingChannelType as string) ?? null,
            finalUrl:        "",
            costUsd:         0,
            conversionValue: 0,
            conversions:     0,
            impressions:     0,
            clicks:          0,
            status,
            accountCurrency: resolvedAccountCurrency,
            syncedAt:        new Date(),
          };
          try {
            await db
              .insert(warehouseGoogleAds)
              .values(stubRow)
              .onConflictDoUpdate({
                target: warehouseGoogleAds.id,
                set: {
                  campaignName:    stubRow.campaignName,
                  status:          stubRow.status,
                  accountCurrency: stubRow.accountCurrency,
                  syncedAt:        new Date(),
                },
              });
            metaInserted++;
          } catch { /* non-fatal — metrics rows still present */ }
        }
        logger.info({ metaInserted }, "Google Ads metadata pass complete (PAUSED/REMOVED stubs)");
      } catch (metaErr) {
        logger.warn({ err: metaErr }, "Google Ads metadata pass failed (non-fatal — status filter may require live fallback)");
      }

      // ── Secondary pass: ad-level final_url extraction for non-PMax campaigns ─
      // PMax doesn't expose final_urls at ad level — skip it. For Search/Display/
      // Shopping campaigns we still extract URLs to build the cross-platform SKU
      // mapping used by margin-leak triage.
      try {
        const adUrlGaql = `
          SELECT
            campaign.id,
            ad_group.id,
            ad_group_ad.ad.id,
            ad_group_ad.ad.final_urls,
            ad_group_ad.status
          FROM ad_group_ad
          WHERE campaign.status IN ('ENABLED', 'PAUSED')
            AND campaign.advertising_channel_type != 'PERFORMANCE_MAX'
            AND ad_group_ad.ad.final_urls IS NOT NULL
            AND segments.date DURING LAST_30_DAYS
          ORDER BY campaign.id
          LIMIT 2000
        `;
        const adRows = await gadsCustomer.query(adUrlGaql) as Array<Record<string, unknown>>;
        {
          // Enrich the campaign-level rows with a representative final_url so
          // the cross-platform mapping can resolve them to Shopify handles.
          const campaignUrls: Record<string, string> = {};
          for (const r of adRows) {
            const cid = String((r.campaign as Record<string, unknown>)?.id ?? "");
            const adGroupAd = r.adGroupAd as Record<string, unknown>;
            const ad = adGroupAd?.ad as Record<string, unknown>;
            const url = ((ad?.finalUrls as string[]) ?? [])[0] ?? "";
            if (cid && url && !campaignUrls[cid]) campaignUrls[cid] = url;
          }
          for (const [cid, url] of Object.entries(campaignUrls)) {
            try {
              await db.update(warehouseGoogleAds)
                .set({ finalUrl: url })
                .where(sql`${warehouseGoogleAds.id} = ${cid} AND ${warehouseGoogleAds.tenantId} = ${syncTenantId}`);
              // Also update the in-memory googleAdRows for cross-platform mapping below
              const row = googleAdRows.find(r => r.id === cid);
              if (row) row.finalUrl = url;
            } catch { /* non-fatal */ }
          }
          logger.info({ enriched: Object.keys(campaignUrls).length }, "Ad-level final_url enrichment complete");
        }
      } catch (urlErr) {
        logger.warn({ err: urlErr }, "Ad-level final_url pass failed (non-fatal — cross-platform mapping will be empty)");
      }
    }
  } catch (err) {
    logger.error({ err }, "Google Ads ETL sync failed");
    report.googleAds.errors.push(`Google Ads sync critical failure: ${String(err)}`);
  }

  etlState.phase = "Building SKU-to-ad mapping…";
  etlState.pct = 80;

  // ── 3. Cross-Platform Mapping ─────────────────────────────────────────────
  // Read current shopify product index (handle → productId)
  try {
    const shopifyIndex = await db.select({
      id:       warehouseShopifyProducts.id,
      productId: warehouseShopifyProducts.productId,
      sku:      warehouseShopifyProducts.sku,
      handle:   warehouseShopifyProducts.handle,
    }).from(warehouseShopifyProducts);

    const handleMap: Record<string, { productId: string; sku: string }> = {};
    const skuMap:    Record<string, { productId: string; sku: string }> = {};

    for (const p of shopifyIndex) {
      if (p.handle) handleMap[p.handle.toLowerCase()] = { productId: p.productId, sku: p.sku ?? "" };
      if (p.sku)    skuMap[p.sku.toLowerCase()]        = { productId: p.productId, sku: p.sku ?? "" };
    }

    for (const ad of googleAdRows) {
      if (!ad.finalUrl) continue;

      let matchedProduct: { productId: string; sku: string } | null = null;
      let matchType = "handle";

      try {
        const url = new URL(ad.finalUrl);
        const pathParts = url.pathname.split("/").filter(Boolean);

        // Shopify URL pattern: /products/{handle}
        const productIdx = pathParts.indexOf("products");
        if (productIdx >= 0 && pathParts[productIdx + 1]) {
          const handle = pathParts[productIdx + 1].toLowerCase().split("?")[0];
          if (handleMap[handle]) {
            matchedProduct = handleMap[handle];
            matchType = "handle";
          }
        }

        // Fallback: check for ?sku= or ?variant_sku= query params
        if (!matchedProduct) {
          const skuParam = url.searchParams.get("sku") ||
            url.searchParams.get("variant_sku") ||
            url.searchParams.get("product_sku");
          if (skuParam && skuMap[skuParam.toLowerCase()]) {
            matchedProduct = skuMap[skuParam.toLowerCase()];
            matchType = "query_param";
          }
        }

        // Fallback: last path segment as handle
        if (!matchedProduct && pathParts.length > 0) {
          const lastSeg = pathParts[pathParts.length - 1].toLowerCase().split("?")[0];
          if (handleMap[lastSeg]) {
            matchedProduct = handleMap[lastSeg];
            matchType = "path_segment";
          } else if (skuMap[lastSeg]) {
            matchedProduct = skuMap[lastSeg];
            matchType = "sku";
          }
        }
      } catch {
        // Invalid URL — skip
      }

      if (matchedProduct) {
        const mapId = `${ad.adId}_${matchedProduct.productId}`;
        try {
          await db
            .insert(warehouseCrossPlatformMapping)
            .values({
              id:               mapId,
              tenantId:         syncTenantId,
              googleAdId:       ad.adId,
              shopifyProductId: matchedProduct.productId,
              sku:              matchedProduct.sku,
              finalUrl:         ad.finalUrl,
              matchType,
              confidence:       matchType === "handle" || matchType === "query_param" ? "HIGH" : "MEDIUM",
              syncedAt:         new Date(),
            })
            .onConflictDoUpdate({
              target: [
                warehouseCrossPlatformMapping.googleAdId,
                warehouseCrossPlatformMapping.shopifyProductId,
              ],
              set: {
                sku:        matchedProduct.sku,
                finalUrl:   ad.finalUrl,
                matchType,
                confidence: matchType === "handle" || matchType === "query_param" ? "HIGH" : "MEDIUM",
                syncedAt:   new Date(),
              },
            });
          report.mapping.synced++;
        } catch (err) {
          logger.warn({ err, mapId }, "Mapping upsert warning");
        }
      }
    }
    logger.info({ synced: report.mapping.synced }, "Cross-platform mapping ETL complete");
  } catch (err) {
    logger.error({ err }, "Cross-platform mapping failed");
  }

  report.durationMs = Date.now() - startedAt;
  logger.info(report, "ETL sync-master complete — starting post-ETL diagnostics");

  etlState.phase = "Running post-ETL diagnostics…";
  etlState.pct = 95;

  try {
    // PHASE-3 FIX (Apr 2026): pre-fix this fetched a single workspace via
    // `limit(1)` and ran ONE diagnostic sweep with that workspace's goal +
    // a hardcoded `"default"` workspaceId — which then drove triage alerts,
    // billing-health checks, and webhook notifications for *every* tenant.
    // Now we iterate every workspace and run diagnostics scoped to its own
    // ID and primary goal. SSE alerts are still broadcast (the live-triage
    // SSE channel is org-scoped at delivery), but billing checks and
    // webhooks now resolve against the correct workspace.
    const allWorkspaces = await db
      .select({ id: workspaces.id, primaryGoal: workspaces.primaryGoal })
      .from(workspaces)
      .orderBy(workspaces.id);

    let totalAlerts = 0;
    let workspacesProcessed = 0;
    let workspacesFailed    = 0;

    for (const ws of allWorkspaces) {
      const goal = (["ecom", "leadgen", "hybrid"] as const).includes(ws.primaryGoal as any)
        ? (ws.primaryGoal as "ecom" | "leadgen" | "hybrid")
        : "ecom";

      try {
        const diagnosticAlerts = await runAdvancedDiagnostics(goal, String(ws.id));
        for (const alert of diagnosticAlerts) {
          emitTriageAlert({
            id: alert.id,
            severity: alert.severity,
            title: alert.title,
            detail: alert.detail,
            platform: alert.platform,
            action: alert.action,
            ts: alert.ts,
          });
        }
        totalAlerts += diagnosticAlerts.length;
        workspacesProcessed++;
      } catch (wsErr) {
        logger.error({ err: wsErr, workspaceId: ws.id, goal }, "Post-ETL diagnostics failed for workspace (continuing)");
        workspacesFailed++;
      }
    }

    logger.info(
      { workspacesProcessed, workspacesFailed, totalAlerts },
      "Post-ETL diagnostic sweep complete (per-workspace)",
    );

    etlState.phase = workspacesFailed === 0
      ? "All data synced — diagnostics complete"
      : `All data synced — diagnostics partial (${workspacesFailed} workspaces failed)`;
  } catch (err) {
    logger.error({ err }, "Post-ETL diagnostic trigger failed (non-fatal)");
    etlState.phase = "All data synced — diagnostic sweep failed";
  }

  etlState.status = "complete";
  etlState.completedAt = Date.now();
  etlState.pct = 100;
  etlState.lastResult = {
    shopify: report.shopify.synced,
    googleAds: report.googleAds.synced,
    mapping: report.mapping.synced,
    durationMs: report.durationMs,
  };

  return report;
}

// ─── POST /api/etl/sync-master (HTTP handler) ─────────────────────────────────
router.post("/sync-master", etlRateLimit, async (req, res) => {
  if (etlState.status === "running") {
    return void res.status(409).json({ error: "ETL sync already in progress", ...etlState });
  }
  try {
    const orgId = getOrgId(req);
    const report = await executeEtlSync(orgId);
    res.json({ success: true, ...report });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    const msg = err instanceof Error ? err.message : String(err);
    if (code === "NO_PLATFORMS_CONNECTED") {
      // Honest 409 so the agent / UI can route the user to /connections
      return void res.status(409).json({
        error: msg,
        code,
        suggested_action: "open_connections_page",
      });
    }
    etlState.status = "error";
    etlState.lastError = msg;
    handleRouteError(err, req, res, "POST /api/etl/sync-master", { error: "Internal server error" });
  }
});

// ─── Background trigger — called from OAuth callbacks ─────────────────────────
export function triggerBackgroundEtl(
  options?: { purgeGoal?: "ecom" | "leadgen" | "hybrid"; orgId?: number | null },
): void {
  if (etlState.status === "running") {
    logger.info("Background ETL requested but already running — skip");
    return;
  }
  logger.info({ orgId: options?.orgId ?? null }, "Triggering background ETL sync after OAuth connection");

  const run = async () => {
    if (options?.purgeGoal) {
      try {
        await purgeWarehouseForGoal(options.purgeGoal);
      } catch (purgeErr) {
        logger.error({ err: purgeErr }, "Warehouse purge failed — aborting ETL to prevent demo bleed");
        etlState.status = "error";
        etlState.lastError = "Warehouse purge failed — ETL aborted to prevent stale data";
        return;
      }
    }
    await executeEtlSync(options?.orgId);
  };

  run().catch((err: unknown) => {
    const code = (err as { code?: string })?.code;
    const msg = err instanceof Error ? err.message : String(err);
    if (code === "NO_PLATFORMS_CONNECTED") {
      // Expected on first OAuth callback when only the just-connected platform
      // exists for a brief window — log as info, not error.
      logger.info({ code }, "Background ETL skipped: no platforms connected yet");
    } else {
      logger.error({ err }, "Background ETL sync failed");
    }
    etlState.status = "error";
    etlState.lastError = msg;
  });
}

// ─── GET /api/etl/status ──────────────────────────────────────────────────────
// Returns the row counts in each warehouse table and the most recent sync time.
router.get("/status", async (req, res) => {
  try {
    const [shopifyCount, adsCount, mapCount, latestShopify, latestAds] = await Promise.all([
      db.$count(warehouseShopifyProducts),
      db.$count(warehouseGoogleAds),
      db.$count(warehouseCrossPlatformMapping),
      db.select({ syncedAt: warehouseShopifyProducts.syncedAt })
        .from(warehouseShopifyProducts)
        .orderBy(warehouseShopifyProducts.syncedAt)
        .limit(1),
      db.select({ syncedAt: warehouseGoogleAds.syncedAt })
        .from(warehouseGoogleAds)
        .orderBy(warehouseGoogleAds.syncedAt)
        .limit(1),
    ]);

    res.json({
      etlStatus:        etlState.status,
      etlPhase:         etlState.phase,
      etlPct:           etlState.pct,
      etlRowsExtracted: etlState.rowsExtracted,
      etlStartedAt:     etlState.startedAt,
      etlCompletedAt:   etlState.completedAt,
      lastResult:       etlState.lastResult,
      lastError:        etlState.lastError,
      warehouse_shopify_products:        shopifyCount,
      warehouse_google_ads:              adsCount,
      warehouse_cross_platform_mapping:  mapCount,
      last_shopify_sync:    latestShopify[0]?.syncedAt ?? null,
      last_google_ads_sync: latestAds[0]?.syncedAt ?? null,
    });
  } catch (err) {
    logger.error({ err }, "ETL status check failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/etl/crm-sync ──────────────────────────────────────────────────
// Ingests lead data from Salesforce or HubSpot into warehouse_crm_leads.

interface CrmLeadPayload {
  provider: "salesforce" | "hubspot";
  leads: Array<{
    crm_lead_id: string;
    email: string;
    first_name: string;
    last_name: string;
    company: string;
    lead_status: string;
    lifecycle_stage: string;
    source: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    gclid?: string;
    fbclid?: string;
    conversion_value?: number;
    converted_at?: string;
    closed_at?: string;
    deal_amount?: number;
    pipeline_stage?: string;
  }>;
}

import { Client as HubSpotClient } from "@hubspot/api-client";
import jsforce from "jsforce";

async function fetchHubSpotLeads(orgId?: number | null): Promise<CrmLeadPayload["leads"]> {
  const rows = await db
    .select()
    .from(platformConnections)
    .where(and(eq(platformConnections.platform, "hubspot"), orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId)));

  if (rows.length === 0) throw new Error("HubSpot not connected");
  const creds = decryptCredentials(rows[0].credentials as Record<string, string>);
  if (!creds.accessToken) throw new Error("HubSpot accessToken missing");

  const hubspot = new HubSpotClient({ accessToken: creds.accessToken });

  const contactsResp = await hubspot.crm.contacts.searchApi.doSearch({
    filterGroups: [],
    properties: [
      "email",
      "firstname",
      "lastname",
      "company",
      "hs_lead_status",
      "lifecyclestage",
      "hs_analytics_source",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "gclid",
      "hs_facebook_click_id",
    ],
    sorts: ["createdate" as any],
    limit: 100,
    after: "0",
  });

  const contacts = contactsResp.results ?? [];

  const dealByContact: Record<
    string,
    { amount: number; stage: string; closedAt: string | null }
  > = {};

  try {
    const dealsResp = await hubspot.crm.deals.searchApi.doSearch({
      filterGroups: [],
      properties: [
        "dealname",
        "amount",
        "dealstage",
        "closedate",
        "hs_analytics_source",
      ],
      sorts: ["createdate" as any],
      limit: 100,
      after: "0",
    });
    const deals = dealsResp.results ?? [];

    for (const d of deals) {
      const dealId = d.id;
      const props = d.properties as Record<string, string | null>;
      const amt = parseFloat(props?.amount ?? "0");

      try {
        const assocResp = await (hubspot.crm.deals as unknown as {
          associationsApi: { getAll: (id: string, to: string) => Promise<{ results?: Array<{ toObjectId?: string; id?: string }> }> };
        }).associationsApi.getAll(
          dealId,
          "contacts",
        );
        const contactIds = (assocResp.results ?? []).map((a: any) => String(a.toObjectId ?? a.id));
        for (const cid of contactIds) {
          if (!dealByContact[cid] || amt > dealByContact[cid].amount) {
            dealByContact[cid] = {
              amount: amt,
              stage: props?.dealstage ?? "",
              closedAt: props?.closedate ?? null,
            };
          }
        }
      } catch {
        // skip deal if association lookup fails
      }
    }
  } catch (err) {
    logger.warn({ err }, "HubSpot deals fetch failed (non-fatal)");
  }

  return contacts.map((c) => {
    const p = c.properties as Record<string, string | null>;
    const deal = dealByContact[c.id];
    const stage = p.lifecyclestage ?? "lead";
    const isConverted = ["opportunity", "customer", "evangelist"].includes(
      stage,
    );

    return {
      crm_lead_id: c.id,
      email: p.email ?? "",
      first_name: p.firstname ?? "",
      last_name: p.lastname ?? "",
      company: p.company ?? "",
      lead_status: p.hs_lead_status ?? "new",
      lifecycle_stage: stage,
      source: p.hs_analytics_source ?? "",
      utm_source: p.utm_source ?? "",
      utm_medium: p.utm_medium ?? "",
      utm_campaign: p.utm_campaign ?? "",
      gclid: p.gclid ?? "",
      fbclid: p.hs_facebook_click_id ?? "",
      conversion_value: isConverted ? deal?.amount ?? 0 : 0,
      converted_at: isConverted ? new Date().toISOString() : undefined,
      closed_at: deal?.closedAt ?? undefined,
      deal_amount: deal?.amount ?? 0,
      pipeline_stage: deal?.stage ?? stage,
    };
  });
}

async function fetchSalesforceLeads(orgId?: number | null): Promise<CrmLeadPayload["leads"]> {
  const rows = await db
    .select()
    .from(platformConnections)
    .where(and(eq(platformConnections.platform, "salesforce"), orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId)));

  if (rows.length === 0) throw new Error("Salesforce not connected");
  const creds = decryptCredentials(rows[0].credentials as Record<string, string>);
  if (!creds.accessToken || !creds.instanceUrl)
    throw new Error("Salesforce credentials incomplete");

  const conn = new jsforce.Connection({
    instanceUrl: creds.instanceUrl,
    accessToken: creds.accessToken,
  });

  if (creds.refreshToken) {
    conn.oauth2 = new jsforce.OAuth2({
      clientId: process.env.SALESFORCE_CLIENT_ID ?? "",
      clientSecret: process.env.SALESFORCE_CLIENT_SECRET ?? "",
    });
  }

  const leadQuery = `
    SELECT Id, Email, FirstName, LastName, Company, Status,
           LeadSource, Utm_Source__c, Utm_Medium__c, Utm_Campaign__c,
           GCLID__c, ConvertedDate, ConvertedContactId
    FROM Lead
    ORDER BY CreatedDate DESC
    LIMIT 200
  `;

  const contactQuery = `
    SELECT Id, Email, FirstName, LastName, Account.Name,
           LeadSource
    FROM Contact
    ORDER BY CreatedDate DESC
    LIMIT 200
  `;

  const oppQuery = `
    SELECT Id, Amount, StageName, CloseDate, ContactId
    FROM Opportunity
    WHERE IsClosed = false OR IsWon = true
    ORDER BY CreatedDate DESC
    LIMIT 200
  `;

  const results: CrmLeadPayload["leads"] = [];

  try {
    const leadsResult = await conn.query<{
      Id: string;
      Email: string;
      FirstName: string;
      LastName: string;
      Company: string;
      Status: string;
      LeadSource: string;
      Utm_Source__c?: string;
      Utm_Medium__c?: string;
      Utm_Campaign__c?: string;
      GCLID__c?: string;
      ConvertedDate?: string;
      ConvertedContactId?: string;
    }>(leadQuery);

    for (const l of leadsResult.records) {
      const isConverted = !!l.ConvertedContactId;
      results.push({
        crm_lead_id: l.Id,
        email: l.Email ?? "",
        first_name: l.FirstName ?? "",
        last_name: l.LastName ?? "",
        company: l.Company ?? "",
        lead_status: l.Status ?? "Open",
        lifecycle_stage: isConverted ? "opportunity" : "lead",
        source: l.LeadSource ?? "",
        utm_source: l.Utm_Source__c ?? "",
        utm_medium: l.Utm_Medium__c ?? "",
        utm_campaign: l.Utm_Campaign__c ?? "",
        gclid: l.GCLID__c ?? "",
        fbclid: "",
        conversion_value: 0,
        converted_at: l.ConvertedDate ?? undefined,
        pipeline_stage: isConverted ? "converted" : "open",
      });
    }
  } catch (err) {
    logger.warn({ err }, "Salesforce Lead query failed — trying Contacts fallback");

    try {
      const contactResult = await conn.query<{
        Id: string;
        Email: string;
        FirstName: string;
        LastName: string;
        Account?: { Name?: string };
        LeadSource: string;
      }>(contactQuery);

      for (const c of contactResult.records) {
        results.push({
          crm_lead_id: c.Id,
          email: c.Email ?? "",
          first_name: c.FirstName ?? "",
          last_name: c.LastName ?? "",
          company: c.Account?.Name ?? "",
          lead_status: "active",
          lifecycle_stage: "customer",
          source: c.LeadSource ?? "",
          utm_source: "",
          utm_medium: "",
          utm_campaign: "",
          gclid: "",
          fbclid: "",
          conversion_value: 0,
          pipeline_stage: "customer",
        });
      }
    } catch (contactErr) {
      logger.warn({ contactErr }, "Salesforce Contact query also failed");
    }
  }

  const contactIdSet = new Set<string>();
  for (const r of results) {
    contactIdSet.add(r.crm_lead_id);
  }

  try {
    const oppResult = await conn.query<{
      Id: string;
      Amount: number;
      StageName: string;
      CloseDate: string;
      ContactId: string;
    }>(oppQuery);

    const oppByContact: Record<
      string,
      { amount: number; stage: string; closeDate: string }
    > = {};
    for (const o of oppResult.records) {
      if (o.ContactId) {
        const existing = oppByContact[o.ContactId];
        if (!existing || (o.Amount ?? 0) > existing.amount) {
          oppByContact[o.ContactId] = {
            amount: o.Amount ?? 0,
            stage: o.StageName ?? "",
            closeDate: o.CloseDate ?? "",
          };
        }
      }
    }

    for (const r of results) {
      const opp = oppByContact[r.crm_lead_id];
      if (opp) {
        r.deal_amount = opp.amount;
        r.pipeline_stage = opp.stage;
        r.closed_at = opp.closeDate || undefined;
        r.conversion_value = opp.amount;
      }
    }

    if (Object.keys(oppByContact).length > 0) {
      for (const r of results) {
        if (r.deal_amount) continue;
        for (const [contactId, opp] of Object.entries(oppByContact)) {
          if (contactIdSet.has(contactId)) continue;
          const matchByEmail = results.find(
            (x) => x.email && x.email === r.email && x.crm_lead_id === contactId,
          );
          if (matchByEmail) {
            r.deal_amount = opp.amount;
            r.pipeline_stage = opp.stage;
            r.closed_at = opp.closeDate || undefined;
            r.conversion_value = opp.amount;
            break;
          }
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, "Salesforce Opportunity query failed (non-fatal)");
  }

  return results;
}

async function fetchCrmLeadsFromApi(
  provider: "hubspot" | "salesforce",
  orgId?: number | null,
): Promise<CrmLeadPayload["leads"]> {
  if (provider === "hubspot") return fetchHubSpotLeads(orgId);
  return fetchSalesforceLeads(orgId);
}

router.post("/crm-sync", async (req, res) => {
  try {
    const { provider } = req.body as { provider?: string };
    const crmProvider = provider === "hubspot" ? "hubspot" : "salesforce";

    logger.info({ provider: crmProvider }, "CRM sync started");

    let leads: CrmLeadPayload["leads"];

    if ((req.body as CrmLeadPayload).leads?.length) {
      leads = (req.body as CrmLeadPayload).leads;
    } else {
      const orgId = getOrgId(req);
      leads = await fetchCrmLeadsFromApi(crmProvider, orgId);
    }

    let upserted = 0;
    const crmOrgIdForSync = getOrgId(req);
    const crmTenantId = crmOrgIdForSync != null ? String(crmOrgIdForSync) : DEFAULT_TENANT_ID;
    for (const lead of leads) {
      const id = `${crmProvider}_${lead.crm_lead_id}`;
      await db
        .insert(warehouseCrmLeads)
        .values({
          id,
          tenantId: crmTenantId,
          crmProvider,
          crmLeadId: lead.crm_lead_id,
          email: lead.email || "",
          firstName: lead.first_name || "",
          lastName: lead.last_name || "",
          company: lead.company || "",
          leadStatus: lead.lead_status || "new",
          lifecycleStage: lead.lifecycle_stage || "lead",
          source: lead.source || "",
          utmSource: lead.utm_source || "",
          utmMedium: lead.utm_medium || "",
          utmCampaign: lead.utm_campaign || "",
          gclid: lead.gclid || "",
          fbclid: lead.fbclid || "",
          conversionValue: lead.conversion_value ?? 0,
          convertedAt: lead.converted_at ? new Date(lead.converted_at) : null,
          closedAt: lead.closed_at ? new Date(lead.closed_at) : null,
          dealAmount: lead.deal_amount ?? 0,
          pipelineStage: lead.pipeline_stage || "",
        })
        .onConflictDoUpdate({
          target: [warehouseCrmLeads.crmProvider, warehouseCrmLeads.crmLeadId],
          set: {
            email: lead.email || "",
            firstName: lead.first_name || "",
            lastName: lead.last_name || "",
            company: lead.company || "",
            leadStatus: lead.lead_status || "new",
            lifecycleStage: lead.lifecycle_stage || "lead",
            source: lead.source || "",
            utmSource: lead.utm_source || "",
            utmMedium: lead.utm_medium || "",
            utmCampaign: lead.utm_campaign || "",
            gclid: lead.gclid || "",
            fbclid: lead.fbclid || "",
            conversionValue: lead.conversion_value ?? 0,
            convertedAt: lead.converted_at ? new Date(lead.converted_at) : null,
            closedAt: lead.closed_at ? new Date(lead.closed_at) : null,
            dealAmount: lead.deal_amount ?? 0,
            pipelineStage: lead.pipeline_stage || "",
            syncedAt: new Date(),
          },
        });
      upserted++;
    }

    logger.info({ provider: crmProvider, upserted }, "CRM sync complete");

    res.json({
      success: true,
      provider: crmProvider,
      leadsUpserted: upserted,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "CRM sync failed");
    res.status(500).json({ error: "CRM sync failed", detail: "An unexpected error occurred" });
  }
});

// ─── GET /api/etl/crm-leads ──────────────────────────────────────────────────
// Returns per-deal pipeline records in the shape required by PipelineFunnel.
// Scoped to the authenticated org; seeds illustrative data when empty.

const STAGES = ["discovery", "proposal", "negotiation", "closed_won", "closed_lost"] as const;
type Stage   = (typeof STAGES)[number];

function deriveStatus(stage: string): "Open" | "Won" | "Lost" {
  if (stage === "closed_won")  return "Won";
  if (stage === "closed_lost") return "Lost";
  return "Open";
}

function buildCrmSeed(tenantId: string) {
  const DEMO_DEALS = [
    { dealName: "Acme Corp — Q3 Retainer",     company: "Acme Corp",     stage: "negotiation",  prob: 75, amount: 48000  },
    { dealName: "BlueWave Media Bundle",        company: "BlueWave Media", stage: "proposal",    prob: 55, amount: 32000  },
    { dealName: "Nexus SaaS Growth Package",    company: "Nexus SaaS",    stage: "discovery",   prob: 30, amount: 72000  },
    { dealName: "Pinnacle Retail Expansion",    company: "Pinnacle Retail", stage: "closed_won", prob: 100, amount: 95000 },
    { dealName: "GreenField E-Commerce Setup",  company: "GreenField",    stage: "proposal",    prob: 60, amount: 24000  },
    { dealName: "OrbitTech Lead Nurture",       company: "OrbitTech",     stage: "discovery",   prob: 20, amount: 18000  },
    { dealName: "ClearPath Agency Audit",       company: "ClearPath",     stage: "closed_lost", prob: 0,  amount: 36000  },
    { dealName: "Apex Brands Annual Plan",      company: "Apex Brands",   stage: "negotiation", prob: 85, amount: 120000 },
    { dealName: "Sunrise Health Content Plan",  company: "Sunrise Health", stage: "closed_won", prob: 100, amount: 56000 },
    { dealName: "Momentum Digital Overhaul",    company: "Momentum Digital", stage: "proposal", prob: 45, amount: 41000  },
  ];

  const names = ["James Harrington", "Priya Mehta", "Carlos Rivera", "Aisha Okonkwo",
                  "Tom Whitfield", "Lena Fischer", "David Ng", "Sarah Kowalski", "Omar Hassan", "Chloe Dupont"];

  return DEMO_DEALS.map((d, i) => {
    const [first, ...rest] = names[i]!.split(" ");
    const date = new Date();
    date.setDate(date.getDate() - i * 9);
    return {
      id:              `demo-${tenantId}-${i}`,
      tenantId,
      crmProvider:     "demo",
      crmLeadId:       `lead-${i}`,
      email:           `${first!.toLowerCase()}@${d.company.toLowerCase().replace(/\s+/g, "")}.com`,
      firstName:       first!,
      lastName:        rest.join(" "),
      company:         d.company,
      leadStatus:      d.stage === "closed_won" ? "closed_won" : d.stage === "closed_lost" ? "closed_lost" : "open",
      lifecycleStage:  d.stage === "closed_won" ? "customer" : "lead",
      source:          "organic",
      utmSource:       "",
      utmMedium:       "",
      utmCampaign:     "",
      gclid:           "",
      fbclid:          "",
      conversionValue: d.stage === "closed_won" ? d.amount : 0,
      convertedAt:     d.stage === "closed_won" ? date : null,
      closedAt:        d.stage.startsWith("closed") ? date : null,
      dealAmount:      d.amount,
      dealName:        d.dealName,
      probability:     d.prob,
      pipelineStage:   d.stage,
      syncedAt:        new Date(),
    };
  });
}

router.get("/crm-leads", async (req, res) => {
  try {
    const crmOrgId   = getOrgId(req);
    const tenantId   = crmOrgId != null ? String(crmOrgId) : DEFAULT_TENANT_ID;
    const conditions = eq(warehouseCrmLeads.tenantId, tenantId);

    let rows = await db
      .select()
      .from(warehouseCrmLeads)
      .where(conditions)
      .limit(500);

    // Seed demo data when the workspace has no CRM records yet
    if (rows.length === 0) {
      const seed = buildCrmSeed(tenantId);
      try {
        await db.insert(warehouseCrmLeads).values(seed).onConflictDoNothing();
        rows = await db.select().from(warehouseCrmLeads).where(conditions).limit(500);
      } catch (seedErr) {
        logger.warn({ seedErr, tenantId }, "[CRM Leads] Seed insert failed — returning empty");
      }
    }

    // Map each row to the PipelineFunnel deal shape
    const deals = rows.map((l) => {
      const stage      = (l.pipelineStage || "discovery") as string;
      const status     = deriveStatus(stage);
      const amount     = Number(l.dealAmount) || 0;
      const prob       = Math.min(100, Math.max(0, Number(l.probability) || 0));
      const dateRaw    = l.closedAt ?? l.convertedAt ?? l.syncedAt;
      return {
        id:            l.id,
        date:          dateRaw instanceof Date ? dateRaw.toISOString().slice(0, 10) : String(dateRaw).slice(0, 10),
        dealName:      l.dealName || l.company || "Unnamed Deal",
        contactPerson: [l.firstName, l.lastName].filter(Boolean).join(" ") || "—",
        company:       l.company || "",
        dealSize:      amount,
        probability:   prob,
        closedWon:     status === "Won"  ? amount : 0,
        closedLost:    status === "Lost" ? amount : 0,
        status,
        dealStage:     stage,
        source:        l.source || "",
        crmProvider:   l.crmProvider,
      };
    });

    // KPI totals
    const totalDeal   = deals.reduce((s, d) => s + d.dealSize, 0);
    const closedWon   = deals.reduce((s, d) => s + d.closedWon, 0);
    const closedLost  = deals.reduce((s, d) => s + d.closedLost, 0);
    const avgProb     = deals.length
      ? deals.reduce((s, d) => s + d.probability, 0) / deals.length
      : 0;

    // Legacy summary retained for backward compat
    const byProvider: Record<string, number> = {};
    const byStage: Record<string, number>    = {};
    for (const d of deals) {
      byProvider[d.crmProvider] = (byProvider[d.crmProvider] || 0) + 1;
      byStage[d.dealStage]      = (byStage[d.dealStage] || 0) + 1;
    }

    res.json({
      deals,
      totals: {
        totalDeal:   parseFloat(totalDeal.toFixed(2)),
        closedWon:   parseFloat(closedWon.toFixed(2)),
        closedLost:  parseFloat(closedLost.toFixed(2)),
        avgProb:     parseFloat(avgProb.toFixed(1)),
        count:       deals.length,
      },
      // Legacy fields
      total: rows.length,
      byProvider,
      byStage,
      totalDealValue: Math.round(totalDeal * 100) / 100,
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch CRM leads");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/etl/crm-sales ──────────────────────────────────────────────────
// Returns per-rep sales performance for the SalesLeaderboard component.
// Scoped by workspaceId; seeds illustrative data when the workspace is empty.

router.get("/crm-sales", async (req, res) => {
  try {
    const { db: dbInstance, workspaceSalesTargets } = await import("@workspace/db");
    const { eq, desc } = await import("drizzle-orm");

    const wsHeader = req.headers["x-workspace-id"];
    const wsQuery  = (req.query as Record<string, string>).workspaceId;
    const rawWs    = (typeof wsHeader === "string" ? wsHeader : null) ?? wsQuery ?? null;
    const wsId     = rawWs ? parseInt(rawWs, 10) : NaN;

    if (!wsId || isNaN(wsId)) {
      return void res.status(400).json({ error: "Missing or invalid workspaceId" });
    }

    const orgId = getOrgId(req);
    if (!(await assertWorkspaceOwnedByOrg(wsId, orgId))) {
      return void res.status(403).json({ error: "workspaceId does not belong to your organization", code: "WORKSPACE_NOT_OWNED" });
    }

    let rows = await dbInstance
      .select()
      .from(workspaceSalesTargets)
      .where(eq(workspaceSalesTargets.workspaceId, wsId))
      .orderBy(desc(workspaceSalesTargets.closedAmount));

    // Seed demo data when workspace has no records
    if (rows.length === 0) {
      const now = new Date();
      const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const SEED = [
        { salespersonName: "James Harrington", salesTarget: 150000, closedAmount: 127500, expenses: 8400,  status: "in_progress" },
        { salespersonName: "Priya Mehta",       salesTarget: 120000, closedAmount: 120000, expenses: 6200,  status: "completed"   },
        { salespersonName: "Carlos Rivera",      salesTarget: 100000, closedAmount: 74000,  expenses: 5100,  status: "in_progress" },
        { salespersonName: "Aisha Okonkwo",      salesTarget: 90000,  closedAmount: 90000,  expenses: 4800,  status: "completed"   },
        { salespersonName: "Tom Whitfield",      salesTarget: 80000,  closedAmount: 18000,  expenses: 3600,  status: "in_progress" },
        { salespersonName: "Lena Fischer",       salesTarget: 75000,  closedAmount: 0,      expenses: 1200,  status: "not_started" },
        { salespersonName: "David Ng",           salesTarget: 110000, closedAmount: 95000,  expenses: 7300,  status: "in_progress" },
        { salespersonName: "Sarah Kowalski",     salesTarget: 95000,  closedAmount: 95000,  expenses: 5500,  status: "completed"   },
      ].map((r) => ({ workspaceId: wsId, period, salespersonEmail: "", teamMemberId: null, ...r }));

      try {
        await dbInstance.insert(workspaceSalesTargets).values(SEED).onConflictDoNothing();
        rows = await dbInstance
          .select()
          .from(workspaceSalesTargets)
          .where(eq(workspaceSalesTargets.workspaceId, wsId))
          .orderBy(desc(workspaceSalesTargets.closedAmount));
      } catch (seedErr) {
        logger.warn({ seedErr, wsId }, "[CRM Sales] Seed insert failed");
      }
    }

    const reps = rows.map((r) => {
      const target   = Number(r.salesTarget)   || 0;
      const closed   = Number(r.closedAmount)  || 0;
      const expenses = Number(r.expenses)      || 0;
      const progress = target > 0 ? Math.min(100, parseFloat(((closed / target) * 100).toFixed(1))) : 0;
      const leftover = target - expenses;
      return {
        id:              r.id,
        salespersonName: r.salespersonName,
        salesTarget:     target,
        closedAmount:    closed,
        salesProgress:   progress,
        expenses,
        leftover,
        status:          r.status as "not_started" | "in_progress" | "completed",
        period:          r.period,
      };
    });

    // Sort leaderboard by closedAmount descending (same as DB order but explicit)
    reps.sort((a, b) => b.closedAmount - a.closedAmount);

    const totals = {
      totalExpenses:  parseFloat(reps.reduce((s, r) => s + r.expenses, 0).toFixed(2)),
      totalLeftover:  parseFloat(reps.reduce((s, r) => s + r.leftover, 0).toFixed(2)),
      totalTarget:    parseFloat(reps.reduce((s, r) => s + r.salesTarget, 0).toFixed(2)),
      totalClosed:    parseFloat(reps.reduce((s, r) => s + r.closedAmount, 0).toFixed(2)),
      avgProgress:    reps.length
        ? parseFloat((reps.reduce((s, r) => s + r.salesProgress, 0) / reps.length).toFixed(1))
        : 0,
      completedCount: reps.filter((r) => r.status === "completed").length,
      count:          reps.length,
    };

    res.json({ reps, totals, workspaceId: wsId, syncedAt: Date.now() });
  } catch (err) {
    logger.error({ err }, "[CRM Sales] GET / failed");
    res.status(500).json({ error: "Failed to load sales data" });
  }
});

export default router;
