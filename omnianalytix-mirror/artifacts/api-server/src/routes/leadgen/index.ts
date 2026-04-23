import { Router } from "express";
import { db, ldAdPerformance, ldCrmLeads, ldTargets, ldSystemLogs } from "@workspace/db";
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

// ─── GET /leadgen/dashboard ───────────────────────────────────────────────────

router.get("/dashboard", async (req, res) => {
  try {
    const wid = wsId(req);

    const [adRows, leadsRows, targetsRow, logs] = await Promise.all([
      wid ? db.select().from(ldAdPerformance).where(eq(ldAdPerformance.workspaceId, wid))
          : db.select().from(ldAdPerformance),
      wid ? db.select().from(ldCrmLeads).where(eq(ldCrmLeads.workspaceId, wid))
          : db.select().from(ldCrmLeads),
      wid ? db.select().from(ldTargets).where(eq(ldTargets.workspaceId, wid)).limit(1)
          : db.select().from(ldTargets).limit(1),
      wid ? db.select().from(ldSystemLogs).where(eq(ldSystemLogs.workspaceId, wid)).orderBy(desc(ldSystemLogs.createdAt)).limit(50)
          : db.select().from(ldSystemLogs).orderBy(desc(ldSystemLogs.createdAt)).limit(50),
    ]);

    const totalSpend      = adRows.reduce((s, r) => s + (r.spend ?? 0), 0);
    const totalLeads      = leadsRows.length;
    const totalPipeline   = leadsRows.reduce((s, r) => s + (r.pipelineValue ?? 0), 0);
    const blendedCpl      = totalLeads > 0 ? totalSpend / totalLeads : 0;
    const pipelineRoi     = totalSpend > 0 ? totalPipeline / totalSpend : 0;
    const totalImpressions = adRows.reduce((s, r) => s + (r.impressions ?? 0), 0);
    const totalClicks      = adRows.reduce((s, r) => s + (r.clicks ?? 0), 0);
    const totalForms       = adRows.reduce((s, r) => s + (r.formSubmissions ?? 0), 0);

    // Lead funnel counts
    const rawCount        = leadsRows.filter(l => l.leadStatus === "Raw").length;
    const mqlCount        = leadsRows.filter(l => l.leadStatus === "MQL").length;
    const sqlCount        = leadsRows.filter(l => l.leadStatus === "SQL").length;
    const closedWonCount  = leadsRows.filter(l => l.leadStatus === "Closed Won").length;

    // Channel breakdown for Lead Quality Grid
    const channelMap: Record<string, { spend: number; leads: number; mqls: number; sqls: number; pipeline: number }> = {};
    for (const r of adRows) {
      if (!channelMap[r.channel]) channelMap[r.channel] = { spend: 0, leads: 0, mqls: 0, sqls: 0, pipeline: 0 };
      channelMap[r.channel].spend += r.spend ?? 0;
    }
    for (const l of leadsRows) {
      const ch = l.channel ?? "Direct";
      if (!channelMap[ch]) channelMap[ch] = { spend: 0, leads: 0, mqls: 0, sqls: 0, pipeline: 0 };
      channelMap[ch].leads    += 1;
      channelMap[ch].pipeline += l.pipelineValue ?? 0;
      if (l.leadStatus === "MQL" || l.leadStatus === "SQL" || l.leadStatus === "Closed Won") channelMap[ch].mqls += 1;
      if (l.leadStatus === "SQL" || l.leadStatus === "Closed Won") channelMap[ch].sqls += 1;
    }

    const channels = Object.entries(channelMap).map(([ch, vals]) => ({
      channel:    ch,
      ...vals,
      cpl:        vals.leads > 0 ? vals.spend / vals.leads : 0,
      mqlRate:    vals.leads > 0 ? (vals.mqls / vals.leads) * 100 : 0,
      sqlRate:    vals.mqls > 0  ? (vals.sqls / vals.mqls) * 100 : 0,
    }));

    const targets = targetsRow[0] ?? { cplCap: 45, monthlyLeadTarget: 200, pipelineRoiTarget: 5 };

    // Anomalies
    const anomalies: string[] = [];
    if (blendedCpl > targets.cplCap) anomalies.push(`Blended CPL $${blendedCpl.toFixed(2)} exceeds $${targets.cplCap} cap`);
    channels.forEach((c) => {
      if (c.cpl > targets.cplCap && c.spend > 0)
        anomalies.push(`${c.channel}: CPL $${c.cpl.toFixed(2)} exceeds cap — budget inefficiency flagged`);
    });
    if (mqlCount > 0 && sqlCount / mqlCount < 0.25) anomalies.push("MQL→SQL conversion rate below 25% — review qualification criteria");
    if (logs.length > 0 && new Date(logs[0].createdAt).getTime() < Date.now() - 3_600_000 * 6)
      anomalies.push("CRM sync delay — last activity >6h ago");

    res.json({
      kpis: { totalSpend, totalLeads, blendedCpl, totalPipeline, pipelineRoi, totalImpressions, totalClicks, totalForms },
      funnel: { raw: rawCount, mql: mqlCount, sql: sqlCount, closedWon: closedWonCount },
      channels,
      targets: {
        cplCap:             targets.cplCap,
        monthlyLeadTarget:  targets.monthlyLeadTarget,
        pipelineRoiTarget:  targets.pipelineRoiTarget,
        actualCpl:          blendedCpl,
        actualLeads:        totalLeads,
        actualPipelineRoi:  pipelineRoi,
      },
      anomalies,
      logs,
    });
  } catch (err) {
    handleRouteError(err, req, res, "GET /api/leadgen/dashboard", { error: "LeadGen dashboard fetch failed" });
  }
});

// ─── POST /leadgen/seed ───────────────────────────────────────────────────────

router.post("/seed", async (req, res) => {
  try {
    const wid = wsId(req);

    const channels = ["Google", "Meta", "HubSpot", "Salesforce"] as const;
    const crmChannels = ["Google", "Meta", "HubSpot", "Salesforce", "Direct"] as const;
    const statuses = ["Raw", "MQL", "SQL", "Closed Won"] as const;

    const adRows = [];
    const leadRows = [];
    let leadCounter = 1;

    for (let i = 29; i >= 0; i--) {
      const date = daysAgo(i);

      for (const ch of channels) {
        const isSearch = ch === "Google";
        const isSocial = ch === "Meta";
        const baseSpend = isSearch ? 180 : isSocial ? 120 : 60;
        const rand = () => 0.75 + Math.random() * 0.5;

        const spend       = +(baseSpend * rand()).toFixed(2);
        const cpm         = isSearch ? 18 : 12;
        const impressions = Math.round((spend / cpm) * 1000);
        const ctr         = isSearch ? 0.045 : 0.025;
        const clicks      = Math.round(impressions * ctr);
        const convRate    = isSearch ? 0.038 : 0.022;
        const formSubmissions = Math.round(clicks * convRate * rand());

        adRows.push({ workspaceId: wid, date, channel: ch, spend, clicks, impressions, formSubmissions });

        // Generate CRM leads for each form submission
        for (let f = 0; f < formSubmissions; f++) {
          const roll = Math.random();
          const leadStatus = roll < 0.45 ? "Raw"
            : roll < 0.70 ? "MQL"
            : roll < 0.87 ? "SQL"
            : "Closed Won";

          const baseValue = leadStatus === "Closed Won" ? 12000 + Math.random() * 8000
            : leadStatus === "SQL"       ? 8000  + Math.random() * 6000
            : leadStatus === "MQL"       ? 4000  + Math.random() * 3000
            : 0;

          leadRows.push({
            workspaceId:   wid,
            date,
            leadId:        `LEAD-${String(leadCounter++).padStart(5, "0")}`,
            leadStatus,
            pipelineValue: +baseValue.toFixed(2),
            channel:       ch,
          });
        }
      }
    }

    // SECURITY: never wipe across all workspaces. If wid is missing, match
    // nothing rather than deleting every workspace's seed data.
    await db.delete(ldAdPerformance).where(wid ? eq(ldAdPerformance.workspaceId, wid) : sql`1=0`);
    await db.delete(ldCrmLeads).where(wid ? eq(ldCrmLeads.workspaceId, wid) : sql`1=0`);
    await db.delete(ldSystemLogs).where(wid ? eq(ldSystemLogs.workspaceId, wid) : sql`1=0`);
    await db.delete(ldTargets).where(wid ? eq(ldTargets.workspaceId, wid) : sql`1=0`);

    // Insert in chunks
    const CHUNK = 500;
    for (let i = 0; i < adRows.length; i += CHUNK) await db.insert(ldAdPerformance).values(adRows.slice(i, i + CHUNK));
    for (let i = 0; i < leadRows.length; i += CHUNK) await db.insert(ldCrmLeads).values(leadRows.slice(i, i + CHUNK));

    await db.insert(ldTargets).values([{ workspaceId: wid, cplCap: 45, monthlyLeadTarget: 200, pipelineRoiTarget: 5 }]);

    const seededLogs = [
      { type: "System Request", message: "HubSpot CRM sync: 412 new contacts ingested" },
      { type: "Query",          message: "Blended CPL recalculated — 30-day window" },
      { type: "System Request", message: "Google Ads lead import complete (form_submissions synced)" },
      { type: "Query",          message: "MQL→SQL funnel conversion rate: 38.4%" },
      { type: "System Request", message: "Salesforce opportunity stage sync completed" },
      { type: "Query",          message: "Pipeline ROI: $6.2 per $1 of ad spend" },
      { type: "System Request", message: "Meta Ads lead form submissions ingested" },
      { type: "Query",          message: "CPL anomaly check: Google $41.20 ✓, Meta $52.80 ⚠" },
      { type: "System Request", message: "Remediation Agent: flagged Meta CPL > $45 cap" },
      { type: "Query",          message: "SRA heartbeat: all CRM sync endpoints healthy" },
      { type: "System Request", message: "Monthly lead target progress: 167/200 (83.5%)" },
    ].map((l, idx) => ({
      workspaceId: wid,
      type:        l.type,
      message:     l.message,
      createdAt:   new Date(Date.now() - idx * 3_600_000),
    }));

    await db.insert(ldSystemLogs).values(seededLogs);

    res.json({ ok: true, adRows: adRows.length, leadRows: leadRows.length, logs: seededLogs.length });
  } catch (err) {
    handleRouteError(err, req, res, "POST /api/leadgen/seed", { error: "Seed failed", detail: String(err) });
  }
});

export default router;
