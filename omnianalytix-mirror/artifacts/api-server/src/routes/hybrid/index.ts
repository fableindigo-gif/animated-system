import { Router } from "express";
import { db, hyAdPerformance, hyEcomSales, hyCrmLeads, hyTargets, hySystemLogs } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { handleRouteError } from "../../lib/route-error-handler";

const router = Router();

function wsId(req: Express.Request): number | null {
  return (req as unknown as { rbacUser?: { workspaceId?: number } }).rbacUser?.workspaceId ?? null;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ─── GET /hybrid/dashboard ────────────────────────────────────────────────────

router.get("/dashboard", async (req, res) => {
  try {
    const wid = wsId(req);
    const scope = <T>(tbl: T) => wid ? (tbl as unknown as { where: (c: unknown) => unknown }) : tbl;

    const [adRows, salesRows, leadsRows, targetsRow, logs] = await Promise.all([
      wid ? db.select().from(hyAdPerformance).where(eq(hyAdPerformance.workspaceId, wid))
          : db.select().from(hyAdPerformance),
      wid ? db.select().from(hyEcomSales).where(eq(hyEcomSales.workspaceId, wid))
          : db.select().from(hyEcomSales),
      wid ? db.select().from(hyCrmLeads).where(eq(hyCrmLeads.workspaceId, wid))
          : db.select().from(hyCrmLeads),
      wid ? db.select().from(hyTargets).where(eq(hyTargets.workspaceId, wid)).limit(1)
          : db.select().from(hyTargets).limit(1),
      wid ? db.select().from(hySystemLogs).where(eq(hySystemLogs.workspaceId, wid)).orderBy(desc(hySystemLogs.createdAt)).limit(50)
          : db.select().from(hySystemLogs).orderBy(desc(hySystemLogs.createdAt)).limit(50),
    ]);

    const targets = targetsRow[0] ?? { roasGoal: 4.0, marginTarget: 35, cplCap: 45 };

    // Split ad rows by campaign type
    const ecomAds   = adRows.filter(r => r.campaignType === "ecom");
    const leadAds   = adRows.filter(r => r.campaignType === "leadgen");

    const totalSpend     = adRows.reduce((s, r) => s + (r.spend ?? 0), 0);
    const ecomAdSpend    = ecomAds.reduce((s, r) => s + (r.spend ?? 0), 0);
    const leadAdSpend    = leadAds.reduce((s, r) => s + (r.spend ?? 0), 0);

    // Ecom KPIs
    const totalRevenue   = salesRows.reduce((s, r) => s + (r.revenue ?? 0), 0);
    const totalCogs      = salesRows.reduce((s, r) => s + (r.cogs ?? 0), 0);
    const totalShipping  = salesRows.reduce((s, r) => s + (r.shippingCosts ?? 0), 0);
    const grossProfit    = totalRevenue - totalCogs - totalShipping;
    const blendedPoas    = ecomAdSpend > 0 ? grossProfit / ecomAdSpend : 0;
    const marginPct      = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    // Lead Gen KPIs
    const totalLeads  = leadsRows.length;
    const blendedCpl  = totalLeads > 0 ? leadAdSpend / totalLeads : 0;
    const totalDeals  = leadsRows.reduce((s, r) => s + (r.estimatedDealValue ?? 0), 0);

    // Holistic pipeline
    const totalPipelineRevenue = totalRevenue + totalDeals;

    // Channel breakdowns for Performance Grid
    const channelMap: Record<string, {
      type: string; spend: number; clicks: number; conversions: number;
      revenue: number; leads: number; deals: number; cogs: number; shipping: number;
    }> = {};

    for (const r of adRows) {
      if (!channelMap[r.channel]) channelMap[r.channel] = { type: r.campaignType, spend: 0, clicks: 0, conversions: 0, revenue: 0, leads: 0, deals: 0, cogs: 0, shipping: 0 };
      channelMap[r.channel].spend       += r.spend ?? 0;
      channelMap[r.channel].clicks      += r.clicks ?? 0;
      channelMap[r.channel].conversions += r.totalConversions ?? 0;
    }
    for (const l of leadsRows) {
      const ch = l.channel ?? "Direct";
      if (!channelMap[ch]) channelMap[ch] = { type: "leadgen", spend: 0, clicks: 0, conversions: 0, revenue: 0, leads: 0, deals: 0, cogs: 0, shipping: 0 };
      channelMap[ch].leads += 1;
      channelMap[ch].deals += l.estimatedDealValue ?? 0;
    }

    const channels = Object.entries(channelMap).map(([ch, v]) => {
      const netRevenue = v.revenue - v.cogs - v.shipping;
      return {
        channel:     ch,
        type:        v.type,
        spend:       v.spend,
        clicks:      v.clicks,
        conversions: v.conversions,
        revenue:     v.revenue,
        leads:       v.leads,
        deals:       v.deals,
        poas:        v.spend > 0 && v.type === "ecom" ? netRevenue / v.spend : null,
        cpl:         v.leads > 0 ? v.spend / v.leads : null,
        roas:        v.spend > 0 ? v.revenue / v.spend : null,
      };
    });

    // Anomalies
    const anomalies: string[] = [];
    if (blendedPoas < targets.roasGoal)
      anomalies.push(`Blended POAS ${blendedPoas.toFixed(2)}x below ${targets.roasGoal}x ROAS goal`);
    if (marginPct < targets.marginTarget)
      anomalies.push(`Gross margin ${marginPct.toFixed(1)}% below ${targets.marginTarget}% target`);
    if (blendedCpl > targets.cplCap && totalLeads > 0)
      anomalies.push(`Blended CPL $${blendedCpl.toFixed(2)} exceeds $${targets.cplCap} cap`);
    channels.filter(c => c.type === "ecom" && (c.roas ?? 0) < targets.roasGoal && c.spend > 0)
      .forEach(c => anomalies.push(`${c.channel}: ROAS ${(c.roas ?? 0).toFixed(2)}x below goal — out-of-stock products may have active ad spend`));
    channels.filter(c => c.type === "leadgen" && (c.cpl ?? 0) > targets.cplCap && c.spend > 0)
      .forEach(c => anomalies.push(`${c.channel}: CPL $${(c.cpl ?? 0).toFixed(2)} cap exceeded`));

    res.json({
      kpis: { totalSpend, ecomAdSpend, leadAdSpend, totalRevenue, grossProfit, blendedPoas, marginPct, totalLeads, blendedCpl, totalDeals, totalPipelineRevenue },
      targets: {
        roasGoal:       targets.roasGoal,
        marginTarget:   targets.marginTarget,
        cplCap:         targets.cplCap,
        actualPoas:     blendedPoas,
        actualMargin:   marginPct,
        actualCpl:      blendedCpl,
      },
      channels,
      anomalies,
      logs,
    });
  } catch (err) {
    handleRouteError(err, req, res, "GET /api/hybrid/dashboard", { error: "Hybrid dashboard fetch failed" });
  }
});

// ─── POST /hybrid/seed ────────────────────────────────────────────────────────

router.post("/seed", async (req, res) => {
  try {
    const wid = wsId(req);

    const ecomChannels  = ["Google Shopping", "Meta", "Google Search"] as const;
    const leadChannels  = ["LinkedIn", "Google Search B2B", "Meta B2B"] as const;
    const leadStatuses  = ["Raw", "MQL", "SQL", "Closed Won"] as const;

    const adRows: object[]  = [];
    const salesRows: object[] = [];
    const leadRows: object[]  = [];
    let orderNum = 1, leadNum = 1;

    for (let i = 29; i >= 0; i--) {
      const date = daysAgo(i);
      const isWeekend = [0, 6].includes(new Date(date).getDay());
      const dayMult = isWeekend ? 1.3 : 1.0;

      // ── Ecom ad rows ──
      for (const ch of ecomChannels) {
        const base = ch === "Google Shopping" ? 220 : ch === "Meta" ? 150 : 90;
        const spend = +(base * dayMult * (0.8 + Math.random() * 0.4)).toFixed(2);
        const clicks = Math.round((spend / (ch === "Google Shopping" ? 0.85 : 1.1)) * (8 + Math.random() * 4));
        const cvr = ch === "Google Shopping" ? 0.032 : 0.021;
        const conversions = Math.round(clicks * cvr * (0.7 + Math.random() * 0.6));
        adRows.push({ workspaceId: wid, date, channel: ch, campaignType: "ecom", spend, clicks, totalConversions: conversions });

        // Generate orders for each conversion
        for (let c = 0; c < conversions; c++) {
          const aov = 1200 + Math.random() * 3800;
          const cogsPct = 0.42 + Math.random() * 0.08;
          const revenue = +aov.toFixed(2);
          const cogs = +(revenue * cogsPct).toFixed(2);
          const shipping = +(35 + Math.random() * 65).toFixed(2);
          salesRows.push({ workspaceId: wid, date, orderId: `ORD-${String(orderNum++).padStart(5, "0")}`, revenue, cogs, shippingCosts: shipping });
        }
      }

      // ── Lead Gen ad rows ──
      for (const ch of leadChannels) {
        const base = ch === "LinkedIn" ? 180 : ch === "Google Search B2B" ? 130 : 90;
        const spend = +(base * (0.8 + Math.random() * 0.4)).toFixed(2);
        const clicks = Math.round((spend / 3.5) * (2 + Math.random() * 3));
        const conversions = Math.round(clicks * 0.04 * (0.7 + Math.random() * 0.6));
        adRows.push({ workspaceId: wid, date, channel: ch, campaignType: "leadgen", spend, clicks, totalConversions: conversions });

        for (let c = 0; c < conversions; c++) {
          const roll = Math.random();
          const leadStatus = roll < 0.40 ? "Raw" : roll < 0.65 ? "MQL" : roll < 0.85 ? "SQL" : "Closed Won";
          const dealValue = leadStatus === "Closed Won" ? 28000 + Math.random() * 42000
            : leadStatus === "SQL" ? 15000 + Math.random() * 20000
            : leadStatus === "MQL" ? 8000  + Math.random() * 12000
            : 0;
          leadRows.push({
            workspaceId: wid, date,
            leadId:      `B2B-${String(leadNum++).padStart(4, "0")}`,
            leadStatus,
            estimatedDealValue: +dealValue.toFixed(2),
            channel: ch,
          });
        }
      }
    }

    // SECURITY: never wipe across all workspaces. If wid is missing, match
    // nothing rather than deleting every workspace's seed data.
    await db.delete(hyAdPerformance).where(wid ? eq(hyAdPerformance.workspaceId, wid) : sql`1=0`);
    await db.delete(hyEcomSales).where(wid ? eq(hyEcomSales.workspaceId, wid) : sql`1=0`);
    await db.delete(hyCrmLeads).where(wid ? eq(hyCrmLeads.workspaceId, wid) : sql`1=0`);
    await db.delete(hySystemLogs).where(wid ? eq(hySystemLogs.workspaceId, wid) : sql`1=0`);
    await db.delete(hyTargets).where(wid ? eq(hyTargets.workspaceId, wid) : sql`1=0`);

    const CHUNK = 500;
    for (let i = 0; i < adRows.length; i += CHUNK)   await db.insert(hyAdPerformance).values(adRows.slice(i, i + CHUNK) as (typeof hyAdPerformance.$inferInsert)[]);
    for (let i = 0; i < salesRows.length; i += CHUNK) await db.insert(hyEcomSales).values(salesRows.slice(i, i + CHUNK) as (typeof hyEcomSales.$inferInsert)[]);
    for (let i = 0; i < leadRows.length; i += CHUNK)  await db.insert(hyCrmLeads).values(leadRows.slice(i, i + CHUNK) as (typeof hyCrmLeads.$inferInsert)[]);

    await db.insert(hyTargets).values([{ workspaceId: wid, roasGoal: 4.0, marginTarget: 35, cplCap: 45 }]);

    const seededLogs = [
      { type: "Query",          message: "Master Diagnostic Sweep complete — 6 channels audited" },
      { type: "System Request", message: "Google Shopping: 3 SKUs with active spend but zero inventory flagged" },
      { type: "Query",          message: "POAS Analysis: Blended POAS recalculated over 30-day window" },
      { type: "System Request", message: "LinkedIn lead form submissions synced to HubSpot pipeline" },
      { type: "Query",          message: "Gross margin check: furniture category average 47.2%" },
      { type: "System Request", message: "Meta B2B audience retargeting campaign budget adjusted" },
      { type: "Query",          message: "B2B SQL-to-Closed conversion rate: 31.4% — above benchmark" },
      { type: "System Request", message: "Shopify order revenue synced — 30-day window reconciled" },
      { type: "System Request", message: "Remediation Agent: Google Shopping ROAS alert triggered" },
      { type: "Query",          message: "CPL cap check: LinkedIn $62.40 ⚠, Meta B2B $38.10 ✓" },
      { type: "System Request", message: "SRA heartbeat: Shopify + HubSpot + Google APIs healthy" },
      { type: "Query",          message: "Total pipeline/revenue aggregated: ecom + B2B deal pipeline" },
    ].map((l, idx) => ({
      workspaceId: wid,
      type:        l.type,
      message:     l.message,
      createdAt:   new Date(Date.now() - idx * 2_700_000),
    }));

    await db.insert(hySystemLogs).values(seededLogs);

    res.json({ ok: true, adRows: adRows.length, salesRows: salesRows.length, leadRows: leadRows.length, logs: seededLogs.length });
  } catch (err) {
    handleRouteError(err, req, res, "POST /api/hybrid/seed", { error: "Seed failed", detail: String(err) });
  }
});

export default router;
