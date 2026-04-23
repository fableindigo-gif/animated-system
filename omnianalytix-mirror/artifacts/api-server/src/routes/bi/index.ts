import { Router } from "express";
import { db, biAdPerformance, biStoreMetrics, biTargets, biSystemLogs } from "@workspace/db";
import { eq, sql, desc, and } from "drizzle-orm";
import { getOrgId } from "../../middleware/rbac";
import { handleRouteError } from "../../lib/route-error-handler";

const router = Router();

function getWsId(req: Express.Request & { rbacUser?: { workspaceId?: number } }): number | null {
  return (req as unknown as { rbacUser?: { workspaceId?: number } }).rbacUser?.workspaceId ?? null;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ─── GET /bi/dashboard ───────────────────────────────────────────────────────
// Aggregate KPIs + channel breakdown + targets + recent logs

router.get("/dashboard", async (req, res) => {
  try {
    const wsId = getWsId(req as unknown as Express.Request & { rbacUser?: { workspaceId?: number } });

    const [adRows, storeRows, targetsRow, logs] = await Promise.all([
      wsId
        ? db.select().from(biAdPerformance).where(eq(biAdPerformance.workspaceId, wsId))
        : db.select().from(biAdPerformance),
      wsId
        ? db.select().from(biStoreMetrics).where(eq(biStoreMetrics.workspaceId, wsId))
        : db.select().from(biStoreMetrics),
      wsId
        ? db.select().from(biTargets).where(eq(biTargets.workspaceId, wsId)).limit(1)
        : db.select().from(biTargets).limit(1),
      wsId
        ? db.select().from(biSystemLogs).where(eq(biSystemLogs.workspaceId, wsId)).orderBy(desc(biSystemLogs.createdAt)).limit(50)
        : db.select().from(biSystemLogs).orderBy(desc(biSystemLogs.createdAt)).limit(50),
    ]);

    const totalSpend   = adRows.reduce((s, r) => s + (r.spend   ?? 0), 0);
    const totalRevenue = adRows.reduce((s, r) => s + (r.revenue ?? 0), 0);
    const totalCogs    = storeRows.reduce((s, r) => s + (r.cogs ?? 0), 0);
    const totalShip    = storeRows.reduce((s, r) => s + (r.shippingCosts ?? 0), 0);

    const blendedROAS = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    const blendedPOAS = totalSpend > 0 ? (totalRevenue - totalCogs - totalShip) / totalSpend : 0;

    const byChannel: Record<string, { spend: number; revenue: number; clicks: number; conversions: number }> = {};
    for (const r of adRows) {
      if (!byChannel[r.channel]) byChannel[r.channel] = { spend: 0, revenue: 0, clicks: 0, conversions: 0 };
      byChannel[r.channel].spend       += r.spend       ?? 0;
      byChannel[r.channel].revenue     += r.revenue     ?? 0;
      byChannel[r.channel].clicks      += r.clicks      ?? 0;
      byChannel[r.channel].conversions += r.conversions ?? 0;
    }

    const channels = Object.entries(byChannel).map(([channel, vals]) => ({
      channel,
      ...vals,
      roas: vals.spend > 0 ? vals.revenue / vals.spend : 0,
      cpl:  vals.conversions > 0 ? vals.spend / vals.conversions : 0,
    }));

    const targets = targetsRow[0] ?? { roasTarget: 4.0, marginTarget: 35, cplCap: 45 };

    const margin = totalRevenue > 0 ? ((totalRevenue - totalCogs - totalShip) / totalRevenue) * 100 : 0;
    const blendedCpl = channels.reduce((s, c) => s + c.conversions, 0) > 0
      ? totalSpend / channels.reduce((s, c) => s + c.conversions, 0)
      : 0;

    res.json({
      kpis: {
        totalSpend,
        totalRevenue,
        blendedROAS,
        blendedPOAS,
        margin,
        blendedCpl,
      },
      channels,
      targets: {
        roasTarget:   targets.roasTarget,
        marginTarget: targets.marginTarget,
        cplCap:       targets.cplCap,
        actualROAS:   blendedROAS,
        actualMargin: margin,
        actualCpl:    blendedCpl,
      },
      logs,
    });
  } catch (err) {
    handleRouteError(err, req, res, "GET /api/bi/dashboard", { error: "BI dashboard fetch failed" });
  }
});

// ─── POST /bi/seed ────────────────────────────────────────────────────────────
// Seed 30 days of realistic mock data for Abley's e-commerce brand

router.post("/seed", async (req, res) => {
  try {
    const wsId: number | null = getWsId(req as unknown as Express.Request & { rbacUser?: { workspaceId?: number } });

    const channels = ["Google", "Meta"] as const;

    const adRows = [];
    const storeRows = [];

    for (let i = 29; i >= 0; i--) {
      const date = daysAgo(i);

      for (const ch of channels) {
        const base     = ch === "Google" ? 200 : 140;
        const rand     = () => 0.8 + Math.random() * 0.4;
        const spend    = +(base * rand()).toFixed(2);
        const roas     = ch === "Google" ? 3.8 + Math.random() * 1.4 : 2.8 + Math.random() * 1.2;
        const revenue  = +(spend * roas).toFixed(2);
        const clicks   = Math.round(spend * (ch === "Google" ? 4.2 : 6.5) * rand());
        const convRate = ch === "Google" ? 0.04 : 0.025;
        const conversions = Math.round(clicks * convRate * rand());

        adRows.push({
          workspaceId: wsId,
          date,
          channel:    ch,
          spend,
          clicks,
          conversions,
          revenue,
        });
      }

      const dayAdRevenue = adRows.filter(r => r.date === date).reduce((s, r) => s + r.revenue, 0);
      const totalRevenue = +(dayAdRevenue * 1.18).toFixed(2);
      const cogs         = +(totalRevenue * 0.41).toFixed(2);
      const shippingCosts = +(totalRevenue * 0.07).toFixed(2);

      storeRows.push({ workspaceId: wsId, date, totalRevenue, cogs, shippingCosts });
    }

    // SECURITY: never wipe across all workspaces. If wsId is missing, match
    // nothing rather than deleting every workspace's seed data.
    await db.delete(biAdPerformance).where(
      wsId ? eq(biAdPerformance.workspaceId, wsId) : sql`1=0`
    );
    await db.delete(biStoreMetrics).where(
      wsId ? eq(biStoreMetrics.workspaceId, wsId) : sql`1=0`
    );
    await db.delete(biSystemLogs).where(
      wsId ? eq(biSystemLogs.workspaceId, wsId) : sql`1=0`
    );
    await db.delete(biTargets).where(
      wsId ? eq(biTargets.workspaceId, wsId) : sql`1=0`
    );

    await db.insert(biAdPerformance).values(adRows);
    await db.insert(biStoreMetrics).values(storeRows);
    await db.insert(biTargets).values([{
      workspaceId:  wsId,
      roasTarget:   4.0,
      marginTarget: 35,
      cplCap:       45,
    }]);

    const logMessages = [
      { type: "System Request", message: "ETL sync: Shopify orders ingested (847 records)" },
      { type: "Query",          message: "POAS recalculated across 30-day window" },
      { type: "System Request", message: "Google Ads performance sync completed" },
      { type: "Query",          message: "Margin-leak scan: 2 SKUs flagged (ad spend with 0 stock)" },
      { type: "System Request", message: "Meta Ads campaign data refreshed" },
      { type: "Query",          message: "Blended ROAS threshold check passed (4.2x > 4.0x target)" },
      { type: "System Request", message: "Daily revenue reconciliation — Abley's workspace" },
      { type: "Query",          message: "CPL analysis: Google $38.20, Meta $52.10" },
      { type: "System Request", message: "Remediation Agent: proposed task for out-of-stock SKU AB-2231" },
      { type: "Query",          message: "SRA heartbeat: all ETL endpoints healthy" },
    ];

    const seededLogs = logMessages.map((l, idx) => ({
      workspaceId: wsId,
      type:        l.type,
      message:     l.message,
      createdAt:   new Date(Date.now() - idx * 3_600_000),
    }));
    await db.insert(biSystemLogs).values(seededLogs);

    res.json({ ok: true, adRows: adRows.length, storeRows: storeRows.length, logs: seededLogs.length });
  } catch (err) {
    handleRouteError(err, req, res, "POST /api/bi/seed", { error: "Seed failed", detail: String(err) });
  }
});

export default router;
