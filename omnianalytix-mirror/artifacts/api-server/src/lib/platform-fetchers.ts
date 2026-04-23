import { logger } from "./logger";
import { platformDataCache } from "./cache";
import { fetchWithBackoff } from "./fetch-utils";
import { customerFromCreds, formatGoogleAdsError } from "./google-ads/client";

export type PlatformData = {
  platform: string;
  connectionId: number;
  displayName: string;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
};

// ─── Google Ads ───────────────────────────────────────────────────────────────

async function fetchGoogleAdsData(
  credentials: Record<string, string>,
  connectionId: number,
  displayName: string,
): Promise<PlatformData> {
  const { customerId } = credentials;
  if (!credentials.refreshToken || !customerId) {
    return { platform: "google_ads", connectionId, displayName, success: false, error: "Missing required credentials: refreshToken, customerId" };
  }

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.ctr,
      metrics.average_cpc
    FROM campaign
    WHERE segments.date DURING LAST_30_DAYS
      AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 25
  `;

  try {
    const customer = customerFromCreds(credentials);
    const results = await customer.query<Array<{
      campaign?: { id?: string | number; name?: string; status?: string | number; advertising_channel_type?: string | number };
      metrics?: {
        impressions?: string | number;
        clicks?: string | number;
        cost_micros?: string | number;
        conversions?: number;
        conversions_value?: number;
        ctr?: number;
        average_cpc?: string | number;
      };
    }>>(query.trim());

    // Aggregate totals
    let totalCost = 0;
    let totalImpressions = 0;
    let totalClicks = 0;
    let totalConversions = 0;
    let totalConvValue = 0;

    const campaigns = (results ?? []).map((row) => {
      const costMicros = Number(row.metrics?.cost_micros ?? 0);
      const impressions = Number(row.metrics?.impressions ?? 0);
      const clicks = Number(row.metrics?.clicks ?? 0);
      const conversions = Number(row.metrics?.conversions ?? 0);
      const convValue = Number(row.metrics?.conversions_value ?? 0);

      totalCost += costMicros;
      totalImpressions += impressions;
      totalClicks += clicks;
      totalConversions += conversions;
      totalConvValue += convValue;

      const cost = costMicros / 1_000_000;
      const roas = cost > 0 ? convValue / cost : 0;

      return {
        id: row.campaign?.id != null ? String(row.campaign.id) : undefined,
        name: row.campaign?.name,
        status: row.campaign?.status,
        channelType: row.campaign?.advertising_channel_type,
        impressions,
        clicks,
        cost: parseFloat(cost.toFixed(2)),
        conversions: parseFloat(conversions.toFixed(2)),
        conversionValue: parseFloat(convValue.toFixed(2)),
        roas: parseFloat(roas.toFixed(2)),
        ctr: parseFloat((Number(row.metrics?.ctr ?? 0) * 100).toFixed(2)),
        avgCpc: parseFloat((Number(row.metrics?.average_cpc ?? 0) / 1_000_000).toFixed(2)),
      };
    });

    const totalCostUsd = totalCost / 1_000_000;
    const accountRoas = totalCostUsd > 0 ? totalConvValue / totalCostUsd : 0;

    return {
      platform: "google_ads",
      connectionId,
      displayName,
      success: true,
      data: {
        period: "Last 30 days",
        customerId,
        summary: {
          totalSpend: parseFloat(totalCostUsd.toFixed(2)),
          totalImpressions,
          totalClicks,
          totalConversions: parseFloat(totalConversions.toFixed(2)),
          totalConversionValue: parseFloat(totalConvValue.toFixed(2)),
          accountRoas: parseFloat(accountRoas.toFixed(2)),
          ctr: totalImpressions > 0 ? parseFloat(((totalClicks / totalImpressions) * 100).toFixed(2)) : 0,
        },
        campaigns,
      },
    };
  } catch (err) {
    logger.error({ err }, "Google Ads fetch error");
    return { platform: "google_ads", connectionId, displayName, success: false, error: `Google Ads API error: ${formatGoogleAdsError(err)}` };
  }
}

// ─── Meta Ads ─────────────────────────────────────────────────────────────────

async function fetchMetaData(
  credentials: Record<string, string>,
  connectionId: number,
  displayName: string,
): Promise<PlatformData> {
  const { accessToken, adAccountId } = credentials;
  if (!accessToken || !adAccountId) {
    return { platform: "meta", connectionId, displayName, success: false, error: "Missing required credentials: accessToken, adAccountId" };
  }

  const cleanAccountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;

  const fields = [
    "spend", "impressions", "clicks", "cpm", "cpc", "ctr",
    "actions", "action_values", "purchase_roas",
  ].join(",");

  const params = new URLSearchParams({
    access_token: accessToken,
    fields,
    date_preset: "last_30d",
    level: "account",
  });

  try {
    const resp = await fetchWithBackoff(
      `https://graph.facebook.com/v22.0/${cleanAccountId}/insights?${params}`,
      { tag: "meta-account-insights" },
    );

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      const msg = (err as { error?: { message?: string } })?.error?.message ?? resp.statusText;
      return { platform: "meta", connectionId, displayName, success: false, error: `Meta API error: ${msg}` };
    }

    const json = (await resp.json()) as {
      data?: {
        spend?: string;
        impressions?: string;
        clicks?: string;
        cpm?: string;
        cpc?: string;
        ctr?: string;
        purchase_roas?: { value?: string }[];
        actions?: { action_type?: string; value?: string }[];
      }[];
    };

    const d = json.data?.[0];
    if (!d) {
      return { platform: "meta", connectionId, displayName, success: true, data: { period: "Last 30 days", summary: { message: "No data returned for this period" } } };
    }

    const roas = d.purchase_roas?.[0]?.value ? parseFloat(d.purchase_roas[0].value) : 0;
    const purchases = d.actions?.find((a) => a.action_type === "purchase");

    // Campaign level breakdown
    const campParams = new URLSearchParams({
      access_token: accessToken,
      fields: "campaign_name,spend,impressions,clicks,ctr,cpm,cpc,purchase_roas",
      date_preset: "last_30d",
      level: "campaign",
      limit: "25",
    });

    const campResp = await fetchWithBackoff(
      `https://graph.facebook.com/v22.0/${cleanAccountId}/insights?${campParams}`,
      { tag: "meta-campaign-insights" },
    );

    let campaigns: unknown[] = [];
    if (campResp.ok) {
      const campJson = (await campResp.json()) as { data?: unknown[] };
      campaigns = campJson.data ?? [];
    }

    return {
      platform: "meta",
      connectionId,
      displayName,
      success: true,
      data: {
        period: "Last 30 days",
        adAccountId: cleanAccountId,
        summary: {
          spend: parseFloat(d.spend ?? "0"),
          impressions: parseInt(d.impressions ?? "0"),
          clicks: parseInt(d.clicks ?? "0"),
          cpm: parseFloat(d.cpm ?? "0"),
          cpc: parseFloat(d.cpc ?? "0"),
          ctr: parseFloat(d.ctr ?? "0"),
          purchaseRoas: roas,
          purchases: parseInt(purchases?.value ?? "0"),
        },
        campaigns,
      },
    };
  } catch (err) {
    logger.error({ err }, "Meta Ads fetch error");
    return { platform: "meta", connectionId, displayName, success: false, error: String(err) };
  }
}

// ─── Shopify ──────────────────────────────────────────────────────────────────

async function fetchShopifyData(
  credentials: Record<string, string>,
  connectionId: number,
  displayName: string,
): Promise<PlatformData> {
  const { shopDomain, accessToken } = credentials;
  if (!shopDomain || !accessToken) {
    return { platform: "shopify", connectionId, displayName, success: false, error: "Missing required credentials: shopDomain, accessToken" };
  }

  const baseUrl = shopDomain.startsWith("https://") ? shopDomain : `https://${shopDomain}`;
  const headers = {
    "X-Shopify-Access-Token": accessToken,
    "Content-Type": "application/json",
  };

  try {
    // Last 30 days date
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [ordersResp, shopResp, productsCountResp] = await Promise.all([
      fetch(
        `${baseUrl}/admin/api/2024-01/orders.json?status=any&created_at_min=${since}&limit=250&fields=id,financial_status,total_price,subtotal_price,line_items,created_at,source_name`,
        { headers },
      ),
      fetch(`${baseUrl}/admin/api/2024-01/shop.json`, { headers }),
      fetch(`${baseUrl}/admin/api/2024-01/products/count.json`, { headers }),
    ]);

    if (!ordersResp.ok) {
      const msg = ordersResp.statusText;
      return { platform: "shopify", connectionId, displayName, success: false, error: `Shopify API error: ${msg}` };
    }

    const ordersJson = (await ordersResp.json()) as {
      orders?: {
        id: number;
        financial_status: string;
        total_price: string;
        subtotal_price: string;
        source_name?: string;
        created_at: string;
        line_items?: { title: string; quantity: number; price: string }[];
      }[];
    };

    const shopJson = shopResp.ok ? (await shopResp.json()) as { shop?: { name?: string; currency?: string; myshopify_domain?: string } } : {};
    const countJson = productsCountResp.ok ? (await productsCountResp.json()) as { count?: number } : {};

    const orders = ordersJson.orders ?? [];
    const paidOrders = orders.filter((o) => o.financial_status === "paid");

    const totalRevenue = paidOrders.reduce((sum, o) => sum + parseFloat(o.total_price), 0);
    const aov = paidOrders.length > 0 ? totalRevenue / paidOrders.length : 0;

    // Top products by revenue
    const productRevenue: Record<string, { title: string; revenue: number; units: number }> = {};
    for (const order of paidOrders) {
      for (const item of order.line_items ?? []) {
        const key = item.title;
        if (!productRevenue[key]) productRevenue[key] = { title: item.title, revenue: 0, units: 0 };
        productRevenue[key].revenue += parseFloat(item.price) * item.quantity;
        productRevenue[key].units += item.quantity;
      }
    }

    const topProducts = Object.values(productRevenue)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
      .map((p) => ({ ...p, revenue: parseFloat(p.revenue.toFixed(2)) }));

    // Channel breakdown
    const bySource: Record<string, { orders: number; revenue: number }> = {};
    for (const order of paidOrders) {
      const src = order.source_name ?? "unknown";
      if (!bySource[src]) bySource[src] = { orders: 0, revenue: 0 };
      bySource[src].orders += 1;
      bySource[src].revenue += parseFloat(order.total_price);
    }

    return {
      platform: "shopify",
      connectionId,
      displayName,
      success: true,
      data: {
        period: "Last 30 days",
        shop: shopJson.shop ?? {},
        summary: {
          totalOrders: orders.length,
          paidOrders: paidOrders.length,
          totalRevenue: parseFloat(totalRevenue.toFixed(2)),
          aov: parseFloat(aov.toFixed(2)),
          currency: shopJson.shop?.currency ?? "USD",
          totalProducts: countJson.count ?? 0,
        },
        topProducts,
        channelBreakdown: bySource,
      },
    };
  } catch (err) {
    logger.error({ err }, "Shopify fetch error");
    return { platform: "shopify", connectionId, displayName, success: false, error: String(err) };
  }
}

// ─── Google Merchant Center ───────────────────────────────────────────────────

export async function fetchGmcData(
  credentials: Record<string, string>,
  connectionId: number,
  displayName: string,
): Promise<PlatformData> {
  const { accessToken, merchantId } = credentials;
  if (!accessToken || !merchantId) {
    return { platform: "gmc", connectionId, displayName, success: false, error: "Missing required credentials: accessToken, merchantId" };
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  try {
    const [statusesResp, datafeedsResp] = await Promise.all([
      fetchWithBackoff(
        `https://shoppingcontent.googleapis.com/content/v2.1/${merchantId}/statuses?maxResults=100`,
        { headers, tag: "gmc-statuses" },
      ),
      fetchWithBackoff(
        `https://shoppingcontent.googleapis.com/content/v2.1/${merchantId}/datafeeds`,
        { headers, tag: "gmc-datafeeds" },
      ),
    ]);

    if (!statusesResp.ok) {
      const err = await statusesResp.json().catch(() => ({}));
      const msg = (err as { error?: { message?: string } })?.error?.message ?? statusesResp.statusText;
      return { platform: "gmc", connectionId, displayName, success: false, error: `GMC API error: ${msg}` };
    }

    const statusesJson = (await statusesResp.json()) as {
      resources?: {
        productId?: string;
        title?: string;
        destinationStatuses?: { status?: string; destination?: string }[];
        itemLevelIssues?: { description?: string; servability?: string; code?: string }[];
      }[];
    };

    const datafeedsJson = datafeedsResp.ok
      ? (await datafeedsResp.json()) as { resources?: { id?: string; name?: string; fileType?: string }[] }
      : {};

    const products = statusesJson.resources ?? [];
    let approved = 0, disapproved = 0, pending = 0, limited = 0;
    const issueMap: Record<string, number> = {};

    for (const p of products) {
      const statuses = p.destinationStatuses ?? [];
      const hasDisapproved = statuses.some((s) => s.status === "disapproved");
      const hasLimited = statuses.some((s) => s.status === "limited");
      const hasPending = statuses.some((s) => s.status === "pending");
      const hasApproved = statuses.some((s) => s.status === "approved");

      if (hasDisapproved) disapproved++;
      else if (hasLimited) limited++;
      else if (hasPending) pending++;
      else if (hasApproved) approved++;

      for (const issue of p.itemLevelIssues ?? []) {
        const key = issue.description ?? issue.code ?? "Unknown issue";
        issueMap[key] = (issueMap[key] ?? 0) + 1;
      }
    }

    const topIssues = Object.entries(issueMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([issue, count]) => ({ issue, affectedProducts: count }));

    return {
      platform: "gmc",
      connectionId,
      displayName,
      success: true,
      data: {
        merchantId,
        summary: {
          totalProducts: products.length,
          approved,
          disapproved,
          pending,
          limited,
          healthScore: products.length > 0 ? parseFloat(((approved / products.length) * 100).toFixed(1)) : 0,
        },
        topIssues,
        datafeeds: (datafeedsJson.resources ?? []).map((d) => ({ id: d.id, name: d.name, fileType: d.fileType })),
      },
    };
  } catch (err) {
    logger.error({ err }, "GMC fetch error");
    return { platform: "gmc", connectionId, displayName, success: false, error: String(err) };
  }
}

// ─── Google Search Console ────────────────────────────────────────────────────

async function fetchGscData(
  credentials: Record<string, string>,
  connectionId: number,
  displayName: string,
): Promise<PlatformData> {
  const { accessToken, siteUrl } = credentials;
  if (!accessToken) {
    return { platform: "gsc", connectionId, displayName, success: false, error: "Missing required credentials: accessToken" };
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  try {
    const sitesResp = await fetchWithBackoff(
      "https://www.googleapis.com/webmasters/v3/sites",
      { headers, tag: "gsc-sites" },
    );

    let resolvedSiteUrl = siteUrl;
    let sites: Array<{ url: string; permission: string }> = [];

    if (sitesResp.ok) {
      const sitesJson = (await sitesResp.json()) as {
        siteEntry?: Array<{ siteUrl: string; permissionLevel: string }>;
      };
      sites = (sitesJson.siteEntry ?? []).map((s) => ({
        url: s.siteUrl,
        permission: s.permissionLevel,
      }));
      if (!resolvedSiteUrl && sites.length > 0) {
        resolvedSiteUrl = sites[0].url;
      }
    }

    if (!sitesResp.ok && !resolvedSiteUrl) {
      const errBody = await sitesResp.json().catch(() => ({})) as { error?: { message?: string } };
      const msg = (errBody as any)?.error?.message ?? sitesResp.statusText;
      return { platform: "gsc", connectionId, displayName, success: false, error: `GSC API error: ${msg}` };
    }

    if (!resolvedSiteUrl) {
      return {
        platform: "gsc",
        connectionId,
        displayName,
        success: true,
        data: {
          sites,
          summary: { message: "No site URL configured. Connect a site to see performance data." },
        },
      };
    }

    const now = new Date();
    const endDate = new Date(now.getTime() - 2 * 86400000).toISOString().slice(0, 10);
    const startDate = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);

    const [queriesResp, pagesResp] = await Promise.all([
      fetchWithBackoff(
        `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(resolvedSiteUrl)}/searchAnalytics/query`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            startDate,
            endDate,
            dimensions: ["query"],
            rowLimit: 25,
            dataState: "final",
          }),
          tag: "gsc-top-queries",
        },
      ),
      fetchWithBackoff(
        `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(resolvedSiteUrl)}/searchAnalytics/query`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            startDate,
            endDate,
            dimensions: ["page"],
            rowLimit: 25,
            dataState: "final",
          }),
          tag: "gsc-top-pages",
        },
      ),
    ]);

    type GscRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };

    let topQueries: GscRow[] = [];
    let topPages: GscRow[] = [];
    let totalClicks = 0;
    let totalImpressions = 0;

    if (queriesResp.ok) {
      const json = (await queriesResp.json()) as { rows?: GscRow[] };
      topQueries = json.rows ?? [];
    } else {
      const errBody = await queriesResp.json().catch(() => ({})) as { error?: { message?: string } };
      const msg = (errBody as any)?.error?.message ?? queriesResp.statusText;
      return { platform: "gsc", connectionId, displayName, success: false, error: `GSC search analytics error: ${msg}` };
    }

    if (pagesResp.ok) {
      const json = (await pagesResp.json()) as { rows?: GscRow[] };
      topPages = json.rows ?? [];
    }

    for (const r of topQueries) {
      totalClicks += r.clicks;
      totalImpressions += r.impressions;
    }

    const avgPosition =
      topQueries.length > 0
        ? topQueries.reduce((s, r) => s + r.position, 0) / topQueries.length
        : 0;

    return {
      platform: "gsc",
      connectionId,
      displayName,
      success: true,
      data: {
        period: `${startDate} → ${endDate}`,
        siteUrl: resolvedSiteUrl,
        sites,
        summary: {
          totalClicks,
          totalImpressions,
          avgCtr: totalImpressions > 0 ? parseFloat(((totalClicks / totalImpressions) * 100).toFixed(2)) : 0,
          avgPosition: parseFloat(avgPosition.toFixed(1)),
        },
        topQueries: topQueries.map((r) => ({
          query: r.keys[0],
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: parseFloat((r.ctr * 100).toFixed(2)),
          position: parseFloat(r.position.toFixed(1)),
        })),
        topPages: topPages.map((r) => ({
          page: r.keys[0],
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: parseFloat((r.ctr * 100).toFixed(2)),
          position: parseFloat(r.position.toFixed(1)),
        })),
      },
    };
  } catch (err) {
    logger.error({ err }, "GSC fetch error");
    return { platform: "gsc", connectionId, displayName, success: false, error: String(err) };
  }
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

export async function fetchPlatformData(
  platform: string,
  credentials: Record<string, string>,
  connectionId: number,
  displayName: string,
): Promise<PlatformData> {
  const cacheKey = `${connectionId}:${platform}`;
  const cached = await platformDataCache.get(cacheKey);
  if (cached) {
    logger.debug({ cacheKey }, "platformDataCache hit");
    return cached;
  }

  let result: PlatformData;
  switch (platform) {
    case "google_ads":
      result = await fetchGoogleAdsData(credentials, connectionId, displayName);
      break;
    case "meta":
      result = await fetchMetaData(credentials, connectionId, displayName);
      break;
    case "shopify":
      result = await fetchShopifyData(credentials, connectionId, displayName);
      break;
    case "gmc":
      result = await fetchGmcData(credentials, connectionId, displayName);
      break;
    case "gsc":
      result = await fetchGscData(credentials, connectionId, displayName);
      break;
    default:
      return { platform, connectionId, displayName, success: false, error: `Unknown platform: ${platform}` };
  }

  if (result.success) {
    await platformDataCache.set(cacheKey, result);
  }
  return result;
}

/** Evict a connection's cached data (call after successful write mutations). */
export async function invalidatePlatformCache(connectionId: number, platform: string): Promise<void> {
  await platformDataCache.invalidate(`${connectionId}:${platform}`);
}

export function formatPlatformDataForAgent(results: PlatformData[]): string {
  if (results.length === 0) return "";

  const lines: string[] = ["## LIVE PLATFORM DATA (Auto-fetched for this session)"];

  for (const r of results) {
    if (!r.success) {
      lines.push(`\n### ${r.displayName} (${r.platform}) — ERROR: ${r.error}`);
      continue;
    }

    lines.push(`\n### ${r.displayName} (${r.platform})`);
    lines.push("```json");
    lines.push(JSON.stringify(r.data, null, 2));
    lines.push("```");
  }

  lines.push("\n---\nUse this live data in your analysis. Do not fabricate numbers — reference the actual figures above.");
  return lines.join("\n");
}
