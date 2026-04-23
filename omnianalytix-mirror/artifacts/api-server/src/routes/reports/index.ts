import { Router } from "express";
import { db, auditLogs, stateSnapshots, sharedReports, savedReports, savedReportDefinitionSchema, warehouseGoogleAds, warehouseShopifyProducts, type SavedReportDefinition, type TrustedReportKind } from "@workspace/db";
import { gte, desc, eq, and, sql } from "drizzle-orm";
import { z } from "zod/v4";
import PDFDocument from "pdfkit";
import pptxgen from "pptxgenjs";
import { getGoogleGenAI, VERTEX_MODEL } from "../../lib/vertex-client";
import { logger } from "../../lib/logger";
import crypto from "crypto";
import { getOrgId, requireOrgId, UnauthorizedTenantError } from "../../middleware/rbac";

// SEC-04: hard caps on /export-csv output to prevent abuse of the formatter as
// an unbounded compute / response-size sink. Even though server-side fetchers
// limit their own row counts, defend against a misbehaving fetcher.
const EXPORT_CSV_MAX_ROWS = 50_000;
const EXPORT_CSV_MAX_FIELD_LEN = 32_768;
const EXPORT_CSV_MAX_COLS = 256;

// SEC-05: caps on shared-report payload size — stored in JSONB and returned
// to anyone with the share link, so unbounded payloads are both a storage
// risk and a download-amplification risk.
const SHARE_REPORT_MAX_BYTES = 512 * 1024; // 512 KB serialized JSON

// ── SEC-04 / SEC-05: trusted server-side report fetcher ──────────────────────
// Both /export-csv and /share take a `reportId` referring to a saved_reports
// row. The row's `definition.kind` selects a fetcher below; the fetcher
// queries the warehouse scoped to the caller's org. The browser never supplies
// the row data, so a customer cannot cause an arbitrary CSV to be downloaded
// branded as an OmniAnalytix export. Add new dashboards by extending
// `TRUSTED_REPORT_KINDS` in `@workspace/db` and adding a branch here.
// Parse filter input into a clamped {from, to} window. Accepts ISO dates or a
// `daysBack` integer; falls back to a 90-day default. Bounds prevent a caller
// from triggering an unbounded scan.
function resolveDateWindow(filters: Record<string, unknown> | undefined): { from: Date; to: Date } {
  const now = new Date();
  let from: Date | null = null;
  let to: Date | null = null;
  if (filters) {
    if (typeof filters.from === "string") { const d = new Date(filters.from); if (!isNaN(d.getTime())) from = d; }
    if (typeof filters.to   === "string") { const d = new Date(filters.to);   if (!isNaN(d.getTime())) to   = d; }
    if (!from && typeof filters.daysBack === "number" && filters.daysBack > 0) {
      from = new Date(now.getTime() - Math.min(filters.daysBack, 365) * 86400_000);
    }
  }
  if (!to)   to   = now;
  if (!from) from = new Date(now.getTime() - 90 * 86400_000);
  // Clamp window to 365 days max.
  const minFrom = new Date(to.getTime() - 365 * 86400_000);
  if (from < minFrom) from = minFrom;
  return { from, to };
}

async function fetchTrustedReportRows(
  req: import("express").Request,
  kind: TrustedReportKind,
  filters: Record<string, unknown> | undefined,
): Promise<Record<string, unknown>[]> {
  // SEC-04 / SEC-05: Tenant context is REQUIRED for the trusted server-side
  // report path. Throws UnauthorizedTenantError (handled at the route layer)
  // if the caller is unauthenticated or has no resolvable org. We must NOT
  // fall back to "1=1" — that would let a request without org context read
  // aggregated data across every tenant in the warehouse.
  const orgId = requireOrgId(req);
  const tenantId = String(orgId);
  const window = resolveDateWindow(filters);
  const tenantFilter = and(
    eq(warehouseShopifyProducts.tenantId, tenantId),
    gte(warehouseShopifyProducts.syncedAt, window.from),
  );
  const adsTenantFilter = and(
    eq(warehouseGoogleAds.tenantId, tenantId),
    gte(warehouseGoogleAds.syncedAt, window.from),
  );

  if (kind === "warehouse_kpis") {
    const [shopify] = await db
      .select({
        productCount:   sql<number>`COUNT(*)::int`,
        activeCount:    sql<number>`COUNT(*) FILTER (WHERE status = 'active' AND inventory_qty > 0)::int`,
        inventoryValue: sql<number>`COALESCE(SUM(price * inventory_qty), 0)`,
        avgPrice:       sql<number>`COALESCE(AVG(price), 0)`,
      })
      .from(warehouseShopifyProducts)
      .where(tenantFilter);
    const [ads] = await db
      .select({
        totalSpend:           sql<number>`COALESCE(SUM(cost_usd), 0)`,
        totalConversions:     sql<number>`COALESCE(SUM(conversions), 0)`,
        totalConversionValue: sql<number>`COALESCE(SUM(conversion_value), 0)`,
        totalClicks:          sql<number>`COALESCE(SUM(clicks)::int, 0)`,
        campaignCount:        sql<number>`COUNT(DISTINCT campaign_id)::int`,
      })
      .from(warehouseGoogleAds)
      .where(adsTenantFilter);
    return [{
      metric: "warehouse_kpis",
      productCount:         shopify?.productCount ?? 0,
      activeProducts:       shopify?.activeCount ?? 0,
      inventoryValue:       Number(shopify?.inventoryValue ?? 0),
      avgPrice:             Number(shopify?.avgPrice ?? 0),
      totalSpend:           Number(ads?.totalSpend ?? 0),
      totalConversions:     Number(ads?.totalConversions ?? 0),
      totalConversionValue: Number(ads?.totalConversionValue ?? 0),
      totalClicks:          ads?.totalClicks ?? 0,
      campaignCount:        ads?.campaignCount ?? 0,
      generatedAt:          new Date().toISOString(),
    }];
  }

  if (kind === "warehouse_channels") {
    const rows = await db
      .select({
        campaignId:   warehouseGoogleAds.campaignId,
        campaignName: warehouseGoogleAds.campaignName,
        spend:        sql<number>`COALESCE(SUM(cost_usd), 0)`,
        conversions:  sql<number>`COALESCE(SUM(conversions), 0)`,
        clicks:       sql<number>`COALESCE(SUM(clicks)::int, 0)`,
        impressions:  sql<number>`COALESCE(SUM(impressions)::int, 0)`,
      })
      .from(warehouseGoogleAds)
      .where(adsTenantFilter)
      .groupBy(warehouseGoogleAds.campaignId, warehouseGoogleAds.campaignName)
      .limit(1000);
    return rows as unknown as Record<string, unknown>[];
  }

  return [];
}

// ── POAS constants (mirrors warehouse/index.ts and profit_layer.py) ───────────
const STRIPE_FEE_RATE = 0.029;   // Stripe standard 2.9% — Shopify Payments identical

const router = Router();

function weekAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d;
}

// ─── GET /api/reports/weekly-pdf ──────────────────────────────────────────────
router.get("/weekly-pdf", async (req, res) => {
  try {
    const since = weekAgo();
    const orgId = getOrgId(req);
    const whereClause = orgId
      ? and(gte(auditLogs.createdAt, since), eq(auditLogs.organizationId, orgId))
      : gte(auditLogs.createdAt, since);

    // ── Warehouse financial data for POAS section ─────────────────────────────
    // Run warehouse queries in parallel with the audit log fetch.
    // These provide the POAS/ROAS performance metrics that belong in every
    // client-facing performance report but were previously missing.
    const [logs, adsRow, shopifyRow] = await Promise.all([
      db.select().from(auditLogs).where(whereClause).orderBy(auditLogs.createdAt),

      // Google Ads: aggregate spend + conversions for the past 7 days
      // (warehouseGoogleAds.syncedAt is the ETL sync timestamp — proxy for date)
      db
        .select({
          totalSpend:       sql<number>`COALESCE(SUM(${warehouseGoogleAds.costUsd}), 0)`,
          totalConversions: sql<number>`COALESCE(SUM(${warehouseGoogleAds.conversions}), 0)`,
          totalClicks:      sql<number>`COALESCE(SUM(${warehouseGoogleAds.clicks})::int, 0)`,
          totalImpressions: sql<number>`COALESCE(SUM(${warehouseGoogleAds.impressions})::int, 0)`,
          campaignCount:    sql<number>`COUNT(DISTINCT ${warehouseGoogleAds.campaignId})::int`,
        })
        .from(warehouseGoogleAds)
        .where(gte(warehouseGoogleAds.syncedAt, since)),

      // Shopify: COGS and average price for profit calculation
      db
        .select({
          avgPrice:      sql<number>`COALESCE(AVG(${warehouseShopifyProducts.price}), 0)`,
          avgCogs:       sql<number>`COALESCE(AVG(${warehouseShopifyProducts.cogs}),  0)`,
          activeCount:   sql<number>`COUNT(*) FILTER (WHERE ${warehouseShopifyProducts.status} = 'active')::int`,
          inventoryValue: sql<number>`COALESCE(SUM(${warehouseShopifyProducts.price} * ${warehouseShopifyProducts.inventoryQty}), 0)`,
        })
        .from(warehouseShopifyProducts),
    ]);

    // ── POAS computation ──────────────────────────────────────────────────────
    // Mirrors the corrected formula in GET /api/warehouse/kpis.
    // TrueProfit = Revenue − (AdSpend + COGS + ProcessingFees)
    // POAS       = TrueProfit / AdSpend
    const totalSpend       = Number(adsRow[0]?.totalSpend)       || 0;
    const totalConversions = Number(adsRow[0]?.totalConversions) || 0;
    const avgPrice         = Number(shopifyRow[0]?.avgPrice)     || 0;
    const avgCogs          = Number(shopifyRow[0]?.avgCogs)      || 0;
    const campaignCount    = Number(adsRow[0]?.campaignCount)    || 0;
    const totalClicks      = Number(adsRow[0]?.totalClicks)      || 0;
    const totalImpressions = Number(adsRow[0]?.totalImpressions) || 0;
    const inventoryValue   = Number(shopifyRow[0]?.inventoryValue) || 0;
    const activeProducts   = Number(shopifyRow[0]?.activeCount)  || 0;

    const estimatedRevenue  = totalConversions * avgPrice;
    const estimatedCogs     = totalConversions * avgCogs;
    const processingFees    = estimatedRevenue * STRIPE_FEE_RATE;
    const trueProfit        = estimatedRevenue - totalSpend - estimatedCogs - processingFees;
    const poas              = totalSpend > 0 ? trueProfit / totalSpend : 0;
    const roas              = totalSpend > 0 ? estimatedRevenue / totalSpend : 0;
    const ctr               = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    const hasFinancialData  = totalSpend > 0 || totalConversions > 0;

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="omnianalytix-weekly-${new Date().toISOString().slice(0, 10)}.pdf"`);
    doc.pipe(res);

    // ── Cover ──
    const BRAND_TEAL = "#00D4AA";
    const DARK = "#0A0F1E";
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(DARK);
    doc.fillColor(BRAND_TEAL).fontSize(36).font("Helvetica-Bold")
      .text("OMNIANALYTIX", 50, 120, { align: "left" });
    doc.fillColor("#FFFFFF").fontSize(18).font("Helvetica")
      .text("Weekly Performance Report", 50, 170);
    doc.fillColor("#8B9AB7").fontSize(12)
      .text(`Period: ${since.toLocaleDateString()} — ${new Date().toLocaleDateString()}`, 50, 200)
      .text(`Generated: ${new Date().toLocaleString()}`, 50, 220);

    // ── Page 2: Financial Performance (POAS / ROAS / Spend / Revenue) ─────────
    // Previously this page did not exist — the report only showed action counts.
    // Now queries warehouseGoogleAds (spend/conversions) + warehouseShopifyProducts
    // (COGS / avg price) to compute True POAS and surface it as the headline KPI.
    doc.addPage();
    doc.fillColor(DARK).rect(0, 0, doc.page.width, doc.page.height).fill();
    doc.fillColor(BRAND_TEAL).fontSize(20).font("Helvetica-Bold")
      .text("Financial Performance", 50, 50);
    doc.fillColor("#8B9AB7").fontSize(10).font("Helvetica")
      .text(`7-day snapshot from Google Ads + Shopify warehouse data`, 50, 76);

    if (hasFinancialData) {
      const kpiCards = [
        { label: "True POAS",         value: poas !== 0 ? `${poas.toFixed(2)}×` : "N/A",                     note: "TrueProfit / AdSpend",                         color: poas >= 1 ? BRAND_TEAL : "#FF6B6B" },
        { label: "Gross ROAS",        value: roas !== 0 ? `${roas.toFixed(2)}×` : "N/A",                     note: "EstimatedRevenue / AdSpend",                   color: BRAND_TEAL },
        { label: "Ad Spend",          value: `$${totalSpend.toLocaleString("en-US", { maximumFractionDigits: 0 })}`, note: "7-day Google Ads spend",          color: "#FFFFFF" },
        { label: "Est. Revenue",      value: `$${estimatedRevenue.toLocaleString("en-US", { maximumFractionDigits: 0 })}`, note: "Conversions × avg product price", color: "#FFFFFF" },
        { label: "True Profit",       value: `$${trueProfit.toLocaleString("en-US", { maximumFractionDigits: 0 })}`, note: "Revenue − Spend − COGS − Fees",   color: trueProfit >= 0 ? BRAND_TEAL : "#FF6B6B" },
        { label: "Processing Fees",   value: `$${processingFees.toFixed(0)}`,                                 note: `Stripe 2.9% of revenue`,                       color: "#FFB347" },
      ];

      // Render 3 cards per row × 2 rows
      const cardW = (doc.page.width - 100) / 3;
      const cardH = 60;
      const startX = 50;
      let row = 0;
      for (let i = 0; i < kpiCards.length; i++) {
        const col = i % 3;
        if (i > 0 && col === 0) row++;
        const x = startX + col * cardW;
        const y = 100 + row * (cardH + 12);
        const card = kpiCards[i];
        doc.rect(x, y, cardW - 8, cardH).fillAndStroke("#12192D", "#2A3550");
        doc.fillColor(card.color).fontSize(20).font("Helvetica-Bold").text(card.value, x + 8, y + 8, { width: cardW - 24 });
        doc.fillColor("#8B9AB7").fontSize(8).font("Helvetica").text(card.label, x + 8, y + 34);
        doc.fillColor("#5A6882").fontSize(7).text(card.note, x + 8, y + 46, { width: cardW - 16 });
      }

      // POAS formula explanation box
      const formulaY = 240;
      doc.rect(50, formulaY, doc.page.width - 100, 55).fillAndStroke("#0D1627", "#1E2D4A");
      doc.fillColor(BRAND_TEAL).fontSize(9).font("Helvetica-Bold")
        .text("POAS Formula (corrected):", 60, formulaY + 8);
      doc.fillColor("#FFFFFF").fontSize(8).font("Helvetica")
        .text("True Profit  =  Revenue  −  (AdSpend + COGS + ProcessingFees)", 60, formulaY + 22);
      doc.fillColor("#8B9AB7").fontSize(7)
        .text(`                  = $${estimatedRevenue.toFixed(0)} − ($${totalSpend.toFixed(0)} + $${estimatedCogs.toFixed(0)} + $${processingFees.toFixed(0)}) = $${trueProfit.toFixed(0)}`, 60, formulaY + 34);
      doc.fillColor("#FFFFFF").fontSize(8)
        .text(`POAS  =  TrueProfit / AdSpend  =  $${trueProfit.toFixed(0)} / $${totalSpend.toFixed(0)}  =  ${poas.toFixed(2)}×`, 60, formulaY + 47);

      // Campaign performance stats row
      const statsY = 315;
      doc.fillColor(BRAND_TEAL).fontSize(12).font("Helvetica-Bold").text("Campaign Stats", 50, statsY);
      const statsItems = [
        { l: "Campaigns", v: campaignCount },
        { l: "Conversions", v: totalConversions.toLocaleString() },
        { l: "Clicks", v: totalClicks.toLocaleString() },
        { l: "CTR", v: `${ctr.toFixed(2)}%` },
        { l: "Active Products", v: activeProducts },
        { l: "Inventory Value", v: `$${inventoryValue.toFixed(0)}` },
      ];
      let sx = 50;
      for (const s of statsItems) {
        doc.fillColor("#FFFFFF").fontSize(13).font("Helvetica-Bold").text(String(s.v), sx, statsY + 22);
        doc.fillColor("#8B9AB7").fontSize(8).font("Helvetica").text(s.l, sx, statsY + 40);
        sx += (doc.page.width - 100) / statsItems.length;
      }
    } else {
      doc.fillColor("#8B9AB7").fontSize(12).font("Helvetica")
        .text("No warehouse data available for this period.\nConnect Google Ads and Shopify via the integrations panel to enable financial reporting.", 50, 120, { width: doc.page.width - 100, align: "center" });
    }

    // Stats summary (for action-count page below)
    const executed = logs.filter((l) => l.status === "executed");
    const rejected = logs.filter((l) => l.status === "rejected");
    const reverted = logs.filter((l) => l.status === "reverted");

    doc.addPage();
    doc.fillColor(DARK).rect(0, 0, doc.page.width, doc.page.height).fill();

    doc.fillColor(BRAND_TEAL).fontSize(20).font("Helvetica-Bold")
      .text("Executive Summary", 50, 50);
    doc.fillColor("#FFFFFF").fontSize(12).font("Helvetica").moveDown(0.5);

    const summaryItems = [
      { label: "Actions Executed", value: String(executed.length), color: BRAND_TEAL },
      { label: "Actions Rejected", value: String(rejected.length), color: "#FF6B6B" },
      { label: "Actions Reverted", value: String(reverted.length), color: "#FFB347" },
      { label: "Total Actions This Week", value: String(logs.length), color: "#FFFFFF" },
    ];

    let yPos = 100;
    for (const item of summaryItems) {
      doc.rect(50, yPos, 200, 50).fillAndStroke(DARK, "#2A3550");
      doc.fillColor(item.color).fontSize(22).font("Helvetica-Bold").text(item.value, 60, yPos + 8);
      doc.fillColor("#8B9AB7").fontSize(9).font("Helvetica").text(item.label, 60, yPos + 35);
      yPos += 65;
    }

    // Platform breakdown
    const platformCounts: Record<string, number> = {};
    for (const log of executed) { platformCounts[log.platformLabel] = (platformCounts[log.platformLabel] ?? 0) + 1; }

    if (Object.keys(platformCounts).length > 0) {
      doc.fillColor(BRAND_TEAL).fontSize(16).font("Helvetica-Bold").text("Actions by Platform", 280, 100);
      let py = 130;
      for (const [platform, count] of Object.entries(platformCounts)) {
        doc.fillColor("#FFFFFF").fontSize(11).font("Helvetica").text(`${platform}: ${count} action(s)`, 280, py);
        py += 20;
      }
    }

    // ── Detailed Action Log ──
    if (logs.length > 0) {
      doc.addPage();
      doc.fillColor(DARK).rect(0, 0, doc.page.width, doc.page.height).fill();
      doc.fillColor(BRAND_TEAL).fontSize(20).font("Helvetica-Bold").text("Action Chronicle", 50, 50);

      let ay = 90;
      for (const log of logs.slice(0, 30)) {
        if (ay > 700) { doc.addPage(); doc.fillColor(DARK).rect(0, 0, doc.page.width, doc.page.height).fill(); ay = 50; }
        const statusColor = log.status === "executed" ? BRAND_TEAL : log.status === "rejected" ? "#FF6B6B" : "#FFB347";
        doc.rect(50, ay, doc.page.width - 100, 45).fillAndStroke("#12192D", "#2A3550");
        doc.fillColor(statusColor).fontSize(7).font("Helvetica-Bold").text(log.status.toUpperCase(), 60, ay + 6);
        doc.fillColor("#FFFFFF").fontSize(10).font("Helvetica-Bold").text(log.toolDisplayName, 60, ay + 17);
        doc.fillColor("#8B9AB7").fontSize(8).font("Helvetica")
          .text(`${log.platformLabel} · ${new Date(log.createdAt).toLocaleDateString()}`, 60, ay + 32);
        const result = log.result as { message?: string } | null;
        if (result?.message) {
          doc.fillColor("#8B9AB7").fontSize(7).text(result.message.slice(0, 80), 200, ay + 20);
        }
        ay += 55;
      }
    }

    // ── AI Narrative ──
    if (executed.length > 0) {
      try {
        const ai = await getGoogleGenAI();
        const actionSummary = executed.slice(0, 10).map((l) => `- ${l.toolDisplayName} on ${l.platformLabel}: ${(l.result as { message?: string } | null)?.message?.slice(0, 80) ?? "completed"}`).join("\n");
        const narrative = await ai.models.generateContent({
          model: VERTEX_MODEL,
          contents: [{ role: "user", parts: [{ text: `Write a 3-paragraph executive summary (max 200 words) for a client report based on these OmniAnalytix actions taken this week:\n${actionSummary}\n\nFocus on business impact, optimization rationale, and outlook. Professional but accessible tone.` }] }],
        });
        const narrativeText = narrative.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        if (narrativeText) {
          doc.addPage();
          doc.fillColor(DARK).rect(0, 0, doc.page.width, doc.page.height).fill();
          doc.fillColor(BRAND_TEAL).fontSize(20).font("Helvetica-Bold").text("AI Executive Narrative", 50, 50);
          doc.fillColor("#FFFFFF").fontSize(11).font("Helvetica").text(narrativeText, 50, 90, { width: doc.page.width - 100, lineGap: 4 });
        }
      } catch (err) { logger.warn({ err }, "PDF narrative generation failed"); }
    }

    // ── Footer ──
    doc.fillColor("#2A3550").fontSize(8).font("Helvetica")
      .text("Generated by OmniAnalytix — Powered by Gemini 2.5 Pro on Vertex AI", 50, doc.page.height - 40, { align: "center" });

    doc.end();
  } catch (err) {
    logger.error({ err }, "weekly-pdf error");
    if (!res.headersSent) res.status(500).json({ error: "PDF generation failed" });
  }
});

// ─── POST /api/reports/qbr ────────────────────────────────────────────────────
router.post("/qbr", async (req, res) => {
  try {
    const { clientName = "Client", quarter = "Q2 2025", metrics = {} } = req.body as {
      clientName?: string;
      quarter?: string;
      metrics?: {
        roas?: number;
        poas?: number;
        adSpend?: number;
        revenue?: number;
        cpa?: number;
        conversionRate?: number;
        impressions?: number;
        clicks?: number;
      };
    };

    const since = weekAgo();
    const orgId = getOrgId(req);
    const qbrWhere = orgId
      ? and(gte(auditLogs.createdAt, since), eq(auditLogs.organizationId, orgId))
      : gte(auditLogs.createdAt, since);
    const logs = await db.select().from(auditLogs).where(qbrWhere).orderBy(desc(auditLogs.createdAt));
    const executed = logs.filter((l) => l.status === "executed");

    const pptx = new pptxgen();
    pptx.layout = "LAYOUT_WIDE";
    pptx.theme = { headFontFace: "Arial", bodyFontFace: "Arial" };

    const TEAL = "00D4AA";
    const DARK = "0A0F1E";
    const LIGHT = "FFFFFF";
    const ACCENT = "4A9EFF";

    // ── Slide 1: Cover ──
    const s1 = pptx.addSlide();
    s1.background = { color: DARK };
    s1.addText("OMNIANALYTIX", { x: 0.5, y: 1.2, fontSize: 44, bold: true, color: TEAL, fontFace: "Arial" });
    s1.addText(`Quarterly Business Review`, { x: 0.5, y: 2.2, fontSize: 24, color: LIGHT, fontFace: "Arial" });
    s1.addText(`${clientName} · ${quarter}`, { x: 0.5, y: 3.0, fontSize: 18, color: "8B9AB7", fontFace: "Arial" });
    s1.addText(`Prepared: ${new Date().toLocaleDateString()}`, { x: 0.5, y: 3.6, fontSize: 12, color: "5A6882" });
    s1.addShape(pptx.ShapeType.rect, { x: 0, y: 6.8, w: "100%", h: 0.5, fill: { color: TEAL } });

    // ── Slide 2: KPI Dashboard ──
    const s2 = pptx.addSlide();
    s2.background = { color: DARK };
    s2.addText("Performance Dashboard", { x: 0.5, y: 0.3, fontSize: 28, bold: true, color: TEAL });
    s2.addText(quarter, { x: 0.5, y: 0.9, fontSize: 14, color: "8B9AB7" });

    const kpis = [
      { label: "Gross ROAS", value: metrics.roas ? `${metrics.roas}x` : "—", x: 0.3 },
      { label: "POAS", value: metrics.poas ? `${metrics.poas}x` : "—", x: 2.9 },
      { label: "Ad Spend", value: metrics.adSpend ? `$${metrics.adSpend.toLocaleString()}` : "—", x: 5.5 },
      { label: "Revenue", value: metrics.revenue ? `$${metrics.revenue.toLocaleString()}` : "—", x: 8.1 },
    ];

    for (const kpi of kpis) {
      s2.addShape(pptx.ShapeType.rect, { x: kpi.x, y: 1.4, w: 2.4, h: 1.4, fill: { color: "12192D" }, line: { color: "2A3550" } });
      s2.addText(kpi.value, { x: kpi.x, y: 1.5, w: 2.4, fontSize: 28, bold: true, color: TEAL, align: "center" });
      s2.addText(kpi.label, { x: kpi.x, y: 2.4, w: 2.4, fontSize: 11, color: "8B9AB7", align: "center" });
    }

    if (metrics.cpa || metrics.conversionRate) {
      s2.addShape(pptx.ShapeType.rect, { x: 0.3, y: 3.1, w: 2.4, h: 1.2, fill: { color: "12192D" }, line: { color: "2A3550" } });
      s2.addText(metrics.cpa ? `$${metrics.cpa}` : "—", { x: 0.3, y: 3.2, w: 2.4, fontSize: 24, bold: true, color: ACCENT, align: "center" });
      s2.addText("Avg CPA", { x: 0.3, y: 3.9, w: 2.4, fontSize: 11, color: "8B9AB7", align: "center" });

      s2.addShape(pptx.ShapeType.rect, { x: 2.9, y: 3.1, w: 2.4, h: 1.2, fill: { color: "12192D" }, line: { color: "2A3550" } });
      s2.addText(metrics.conversionRate ? `${metrics.conversionRate}%` : "—", { x: 2.9, y: 3.2, w: 2.4, fontSize: 24, bold: true, color: ACCENT, align: "center" });
      s2.addText("Conv. Rate", { x: 2.9, y: 3.9, w: 2.4, fontSize: 11, color: "8B9AB7", align: "center" });
    }

    // ── Slide 3: Actions Taken ──
    const s3 = pptx.addSlide();
    s3.background = { color: DARK };
    s3.addText("AI-Driven Optimizations", { x: 0.5, y: 0.3, fontSize: 28, bold: true, color: TEAL });
    s3.addText(`${executed.length} actions executed via OmniAnalytix approval workflow`, { x: 0.5, y: 0.9, fontSize: 14, color: "8B9AB7" });

    const rows: pptxgen.TableRow[] = [
      [
        { text: "Action", options: { bold: true, color: TEAL, fill: { color: "12192D" } } },
        { text: "Platform", options: { bold: true, color: TEAL, fill: { color: "12192D" } } },
        { text: "Date", options: { bold: true, color: TEAL, fill: { color: "12192D" } } },
        { text: "Result", options: { bold: true, color: TEAL, fill: { color: "12192D" } } },
      ],
      ...executed.slice(0, 8).map((l) => [
        { text: l.toolDisplayName, options: { color: LIGHT } },
        { text: l.platformLabel, options: { color: "8B9AB7" } },
        { text: new Date(l.createdAt).toLocaleDateString(), options: { color: "8B9AB7" } },
        { text: ((l.result as { message?: string } | null)?.message ?? "").slice(0, 50), options: { color: "5A6882" } },
      ] as pptxgen.TableRow),
    ];

    s3.addTable(rows, { x: 0.3, y: 1.3, w: 10, colW: [3.2, 1.8, 1.5, 3.5], border: { color: "2A3550" }, fill: { color: DARK } });

    // ── Slide 4: Strategic Recommendations ──
    const s4 = pptx.addSlide();
    s4.background = { color: DARK };
    s4.addText("Strategic Recommendations", { x: 0.5, y: 0.3, fontSize: 28, bold: true, color: TEAL });

    // Generate AI recommendations
    let aiRecs = ["Scale top-performing campaigns with highest POAS.", "Add negative keywords to reduce wasted spend.", "Test new creative formats to improve CTR.", "Review PMax budget distribution for cannibalization."];
    try {
      const ai = await getGoogleGenAI();
      const recsResult = await ai.models.generateContent({
        model: VERTEX_MODEL,
        contents: [{ role: "user", parts: [{ text: `Generate 4 specific, actionable strategic recommendations for a ${quarter} QBR based on these executed actions: ${executed.slice(0, 5).map((l) => l.toolDisplayName).join(", ") || "budget optimizations, bidding adjustments"}. Each recommendation should be 1-2 sentences. Return as a numbered list only.` }] }],
      });
      const recsText = recsResult.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const parsed = recsText.split("\n").filter((l) => l.match(/^\d+\./)).map((l) => l.replace(/^\d+\.\s*/, "").trim());
      if (parsed.length >= 3) aiRecs = parsed.slice(0, 4);
    } catch { /* use defaults */ }

    let ry = 1.1;
    for (let i = 0; i < aiRecs.length; i++) {
      s4.addShape(pptx.ShapeType.rect, { x: 0.3, y: ry, w: 10, h: 0.9, fill: { color: "12192D" }, line: { color: i === 0 ? TEAL : "2A3550" } });
      s4.addText(`${i + 1}`, { x: 0.4, y: ry + 0.15, w: 0.5, fontSize: 18, bold: true, color: TEAL });
      s4.addText(aiRecs[i], { x: 1.0, y: ry + 0.18, w: 9.0, fontSize: 12, color: LIGHT });
      ry += 1.1;
    }

    // ── Slide 5: Next Quarter Priorities ──
    const s5 = pptx.addSlide();
    s5.background = { color: DARK };
    s5.addText("Next Quarter Priorities", { x: 0.5, y: 0.3, fontSize: 28, bold: true, color: TEAL });
    const priorities = [
      { icon: "🎯", title: "POAS Optimization", desc: "Scale spend on proven POAS-positive campaigns, sunset unprofitable ad sets" },
      { icon: "🔍", title: "PMax Intelligence", desc: "Deploy X-Ray monitoring to rebalance Shopping vs Search vs Display allocation" },
      { icon: "✍️", title: "Creative Refresh", desc: "Generate new ad copy matrix variants based on Creative Autopsy insights" },
      { icon: "📊", title: "Content Velocity", desc: "Target Page 2 GSC keywords with AI-generated SEO blog posts" },
    ];
    let py = 1.1;
    for (const p of priorities) {
      s5.addShape(pptx.ShapeType.rect, { x: 0.3, y: py, w: 10, h: 1.0, fill: { color: "12192D" }, line: { color: "2A3550" } });
      s5.addText(p.icon, { x: 0.5, y: py + 0.25, fontSize: 20 });
      s5.addText(p.title, { x: 1.2, y: py + 0.1, fontSize: 14, bold: true, color: TEAL });
      s5.addText(p.desc, { x: 1.2, y: py + 0.5, fontSize: 11, color: "8B9AB7" });
      py += 1.15;
    }

    // ── Slide 6: Thank You ──
    const s6 = pptx.addSlide();
    s6.background = { color: DARK };
    s6.addShape(pptx.ShapeType.rect, { x: 0, y: 2.5, w: "100%", h: 2.5, fill: { color: "12192D" } });
    s6.addText("Thank You", { x: 0, y: 2.8, w: "100%", fontSize: 40, bold: true, color: TEAL, align: "center" });
    s6.addText(`${clientName} · Powered by OmniAnalytix`, { x: 0, y: 3.8, w: "100%", fontSize: 16, color: "8B9AB7", align: "center" });
    s6.addShape(pptx.ShapeType.rect, { x: 0, y: 6.8, w: "100%", h: 0.5, fill: { color: TEAL } });

    const pptxBuffer = await pptx.write({ outputType: "nodebuffer" }) as Buffer;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    res.setHeader("Content-Disposition", `attachment; filename="qbr-${clientName.replace(/\s+/g, "-").toLowerCase()}-${quarter.replace(/\s+/g, "-")}.pptx"`);
    res.send(pptxBuffer);
  } catch (err) {
    logger.error({ err }, "qbr generation error");
    if (!res.headersSent) res.status(500).json({ error: "QBR generation failed" });
  }
});

// ─── Saved-reports registry ───────────────────────────────────────────────────
// SEC-04 / SEC-05: Dashboards register their current view as a saved report
// before exporting/sharing. The server stores `{ kind, filters, title }` keyed
// by an opaque uuid; export and share endpoints look up the saved report,
// verify the caller's workspace owns it, and produce the output from the
// trusted server-side fetcher. Browsers never supply row data.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SavedReportLookup =
  | { ok: true; row: typeof savedReports.$inferSelect; definition: SavedReportDefinition }
  | { ok: false; status: number; body: { error: string } };

async function loadSavedReport(req: import("express").Request, reportId: string): Promise<SavedReportLookup> {
  if (!UUID_RE.test(reportId)) return { ok: false, status: 400, body: { error: "Invalid reportId" } };
  const wsId = requireOrgId(req);
  const [row] = await db
    .select()
    .from(savedReports)
    .where(and(eq(savedReports.id, reportId), eq(savedReports.workspaceId, wsId)))
    .limit(1);
  if (!row) {
    // 404 (not 403) — don't disclose existence of another tenant's report id.
    return { ok: false, status: 404, body: { error: "Saved report not found" } };
  }
  const parsed = savedReportDefinitionSchema.safeParse(row.definition);
  if (!parsed.success) {
    return { ok: false, status: 500, body: { error: "Saved report definition is invalid" } };
  }
  return { ok: true, row, definition: parsed.data };
}

// POST /api/reports/saved — register a saved report; returns its id.
router.post("/saved", async (req, res): Promise<void> => {
  try {
    const wsId = requireOrgId(req);
    const parsed = savedReportDefinitionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid report definition", details: z.treeifyError(parsed.error) });
      return;
    }
    const definition: SavedReportDefinition = parsed.data;
    const [row] = await db
      .insert(savedReports)
      .values({
        workspaceId: wsId,
        createdBy: req.rbacUser?.id ?? null,
        definition,
      })
      .returning();
    res.status(201).json({ reportId: row.id, createdAt: row.createdAt });
  } catch (err) {
    if (err instanceof UnauthorizedTenantError) { res.status(401).json({ error: "Unauthorized" }); return; }
    logger.error({ err }, "create saved report failed");
    res.status(500).json({ error: "Failed to create saved report" });
  }
});

// GET /api/reports/saved/:id — fetch a saved report (org-scoped).
router.get("/saved/:id", async (req, res): Promise<void> => {
  try {
    const result = await loadSavedReport(req, req.params.id);
    if (!result.ok) { res.status(result.status).json(result.body); return; }
    res.json({ reportId: result.row.id, definition: result.definition, createdAt: result.row.createdAt });
  } catch (err) {
    if (err instanceof UnauthorizedTenantError) { res.status(401).json({ error: "Unauthorized" }); return; }
    logger.error({ err }, "get saved report failed");
    res.status(500).json({ error: "Failed to load saved report" });
  }
});

// ─── POST /api/reports/export-csv ─────────────────────────────────────────────
// Requires a `reportId` referring to a saved_reports row owned by the caller's
// workspace. The server fetches the data itself from the warehouse — the
// browser cannot inject arbitrary rows branded as an OmniAnalytix export.
router.post("/export-csv", async (req, res): Promise<void> => {
  try {
    const { reportId, filters: overrideFilters, filename: rawFilename, columns } = req.body as {
      reportId?: string;
      filters?: Record<string, unknown>;
      filename?: string;
      columns?: string[];
    };

    if (!reportId || typeof reportId !== "string") {
      res.status(400).json({ error: "reportId is required" }); return;
    }

    const lookup = await loadSavedReport(req, reportId);
    if (!lookup.ok) { res.status(lookup.status).json(lookup.body); return; }

    // Per-call filter overrides (e.g. dashboard date range changed since the
    // report was registered). Saved-report filters are the baseline and are
    // shallowly overridden — kind is fixed by the saved report.
    const effectiveFilters = { ...(lookup.definition.filters ?? {}), ...(overrideFilters ?? {}) };
    const data = await fetchTrustedReportRows(req, lookup.definition.kind, effectiveFilters);
    if (!data || data.length === 0) {
      res.status(404).json({ error: `No data available for report kind "${lookup.definition.kind}"` }); return;
    }

    // SEC-04: Defense-in-depth caps even though server-side fetchers limit
    // their own row counts.
    if (data.length > EXPORT_CSV_MAX_ROWS) {
      res.status(413).json({
        error: `Too many rows: ${data.length} exceeds limit of ${EXPORT_CSV_MAX_ROWS}`,
      }); return;
    }
    if (Array.isArray(columns) && columns.length > EXPORT_CSV_MAX_COLS) {
      res.status(413).json({
        error: `Too many columns: ${columns.length} exceeds limit of ${EXPORT_CSV_MAX_COLS}`,
      }); return;
    }

    const headers = columns || Object.keys(data[0]);
    if (headers.length > EXPORT_CSV_MAX_COLS) {
      res.status(413).json({
        error: `Too many columns: ${headers.length} exceeds limit of ${EXPORT_CSV_MAX_COLS}`,
      }); return;
    }
    const filename = (rawFilename || "omnianalytix-export").replace(/[^a-zA-Z0-9_-]/g, "_");

    const escapeCell = (val: unknown): string => {
      if (val === null || val === undefined) return "";
      let str = String(val);
      // SEC-04: cap individual cell length so a caller can't ship a 100MB
      // string field through the formatter.
      if (str.length > EXPORT_CSV_MAX_FIELD_LEN) {
        str = str.slice(0, EXPORT_CSV_MAX_FIELD_LEN);
      }
      if (/^[=+\-@\t\r]/.test(str)) {
        str = `'${str}`;
      }
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvRows = [
      headers.map(escapeCell).join(","),
      ...data.map((row) => headers.map((h) => escapeCell(row[h])).join(",")),
    ];

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csvRows.join("\n"));
  } catch (err) {
    if (err instanceof UnauthorizedTenantError) { res.status(401).json({ error: "Unauthorized" }); return; }
    logger.error({ err }, "CSV export failed");
    res.status(500).json({ error: "Export failed" });
  }
});

// ─── POST /api/reports/export-sheets ──────────────────────────────────────────
router.post("/export-sheets", async (req, res): Promise<void> => {
  try {
    // SEC-04 / SEC-05: same trust model as /export-csv and /share — the
    // browser supplies a saved-report id (workspace-scoped) and the server
    // pulls the rows itself via the trusted warehouse fetcher. The legacy
    // `{ data, title, columns }` body shape (where the client supplied the
    // rows directly) has been removed so a customer can't write arbitrary
    // content to a Google Sheet branded as an OmniAnalytix export.
    const { reportId, filters: overrideFilters, title, columns } = req.body as {
      reportId?: string;
      filters?: Record<string, unknown>;
      title?: string;
      columns?: string[];
    };

    if (!reportId || typeof reportId !== "string") {
      res.status(400).json({ error: "reportId is required" }); return;
    }

    const lookup = await loadSavedReport(req, reportId);
    if (!lookup.ok) { res.status(lookup.status).json(lookup.body); return; }

    const effectiveFilters = { ...(lookup.definition.filters ?? {}), ...(overrideFilters ?? {}) };
    const data = await fetchTrustedReportRows(req, lookup.definition.kind, effectiveFilters);
    if (!data || data.length === 0) {
      res.status(404).json({ error: `No data available for report kind "${lookup.definition.kind}"` }); return;
    }

    const headers = columns || Object.keys(data[0]);
    const sheetTitle = title || lookup.definition.title || `OmniAnalytix Export ${new Date().toISOString().slice(0, 10)}`;

    const values: (string | number)[][] = [
      headers,
      ...data.map((row) => headers.map((h) => {
        const v = row[h];
        if (v === null || v === undefined) return "";
        if (typeof v === "number") return v;
        return String(v);
      })),
    ];

    const { getFreshGoogleCredentials } = await import("../../lib/google-token-refresh");
    const { getOrgId } = await import("../../middleware/rbac");
    const orgId = getOrgId(req);
    const creds = await getFreshGoogleCredentials("google_sheets", orgId) ?? await getFreshGoogleCredentials("google_ads", orgId);

    if (creds?.accessToken) {
      try {
        const { google } = await import("googleapis");
        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({ access_token: creds.accessToken });

        const sheets = google.sheets({ version: "v4", auth: oauth2Client });

        const createRes = await sheets.spreadsheets.create({
          requestBody: {
            properties: { title: sheetTitle },
            sheets: [{ properties: { title: "Sheet1" } }],
          },
        });

        const spreadsheetId = createRes.data.spreadsheetId;
        const spreadsheetUrl = createRes.data.spreadsheetUrl;

        if (!spreadsheetId) {
          throw new Error("Spreadsheet creation returned no ID");
        }

        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: "Sheet1!A1",
          valueInputOption: "USER_ENTERED",
          requestBody: { values },
        });

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                repeatCell: {
                  range: {
                    sheetId: 0,
                    startRowIndex: 0,
                    endRowIndex: 1,
                  },
                  cell: {
                    userEnteredFormat: {
                      textFormat: { bold: true },
                      backgroundColor: { red: 0.9, green: 0.94, blue: 0.98 },
                    },
                  },
                  fields: "userEnteredFormat(textFormat,backgroundColor)",
                },
              },
              {
                autoResizeDimensions: {
                  dimensions: {
                    sheetId: 0,
                    dimension: "COLUMNS",
                    startIndex: 0,
                    endIndex: headers.length,
                  },
                },
              },
            ],
          },
        });

        logger.info({ spreadsheetId, rows: values.length }, "Google Sheet created via Sheets API");

        res.json({
          mode: "sheets",
          spreadsheetId,
          spreadsheetUrl,
          title: sheetTitle,
          rowsWritten: values.length,
        });
        return;
      } catch (sheetsErr) {
        logger.warn({ err: sheetsErr }, "Google Sheets API write failed — falling back to download mode");
      }
    }

    res.json({
      mode: "download",
      spreadsheet: {
        properties: { title: sheetTitle },
        sheets: [{
          properties: { title: "Sheet1" },
          data: [{
            startRow: 0,
            startColumn: 0,
            rowData: values.map((row) => ({
              values: (row as (string | number)[]).map((cell) => ({
                userEnteredValue: typeof cell === "number"
                  ? { numberValue: cell }
                  : { stringValue: String(cell) },
              })),
            })),
          }],
        }],
      },
      csvFallbackUrl: "/api/reports/export-csv",
    });
  } catch (err) {
    logger.error({ err }, "Sheets export failed");
    res.status(500).json({ error: "Export failed" });
  }
});

router.post("/share", async (req, res): Promise<void> => {
  try {
    // SEC-05: Previous code did `req.jwtPayload?.organizationId ?? req.rbacUser?.id`,
    // which falls back to the *user id* (a memberId) and stores rows under it.
    // Reads of the same row use the *workspace/org id*, so the fallback path
    // either silently lost rows or co-mingled tenants whose org id collided
    // with another tenant's user id. Use requireOrgId to derive a single
    // authoritative tenant key.
    const wsId = requireOrgId(req);

    const { reportId, filters: overrideFilters, reportTitle, agencyName, expiresInDays } = req.body as {
      reportId?: string;
      filters?: Record<string, unknown>;
      reportTitle?: unknown;
      agencyName?: unknown;
      expiresInDays?: unknown;
    };

    if (!reportId || typeof reportId !== "string") {
      res.status(400).json({ error: "reportId is required" }); return;
    }

    const lookup = await loadSavedReport(req, reportId);
    if (!lookup.ok) { res.status(lookup.status).json(lookup.body); return; }

    // SEC-05: Server fetches org-scoped warehouse data itself; the browser
    // cannot inject arbitrary content into a shareable link. Per-call filter
    // overrides are merged on top of the saved report's baseline filters.
    const effectiveFilters = { ...(lookup.definition.filters ?? {}), ...(overrideFilters ?? {}) };
    const rows = await fetchTrustedReportRows(req, lookup.definition.kind, effectiveFilters);
    const reportData: Record<string, unknown> = {
      reportId,
      kind: lookup.definition.kind,
      filters: effectiveFilters,
      generatedAt: new Date().toISOString(),
      rows,
    };

    // SEC-05: Cap serialized payload size — JSONB column is unbounded but the
    // share link is downloadable by anyone with the URL.
    const serialized = JSON.stringify(reportData);
    if (serialized.length > SHARE_REPORT_MAX_BYTES) {
      res.status(413).json({
        error: `Report payload too large: ${serialized.length} bytes exceeds limit of ${SHARE_REPORT_MAX_BYTES}`,
      }); return;
    }

    const shareId = crypto.randomUUID();
    const rawDays = typeof expiresInDays === "number" ? expiresInDays : 30;
    const days = Math.max(1, Math.min(rawDays, 90));
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const [row] = await db.insert(sharedReports).values({
      shareId,
      workspaceId: wsId,
      agencyName: typeof agencyName === "string" ? agencyName.slice(0, 200) : null,
      reportTitle: typeof reportTitle === "string" ? reportTitle.slice(0, 200) : "Performance Report",
      reportData,
      expiresAt,
      isActive: true,
    }).returning();

    res.json({ shareId: row.shareId, url: `/shared/${row.shareId}`, expiresAt: row.expiresAt });
  } catch (err) {
    if (err instanceof UnauthorizedTenantError) {
      res.status(401).json({ error: "Unauthorized" }); return;
    }
    logger.error({ err }, "Share report failed");
    res.status(500).json({ error: "Failed to create shared report" });
  }
});

router.get("/shared-links", async (req, res): Promise<void> => {
  try {
    // SEC-05: see /share comment — never fall back to user.id.
    const wsId = getOrgId(req);
    if (wsId == null) { res.status(401).json({ error: "Unauthorized" }); return; }

    const links = await db
      .select({
        id: sharedReports.id,
        shareId: sharedReports.shareId,
        reportTitle: sharedReports.reportTitle,
        isActive: sharedReports.isActive,
        expiresAt: sharedReports.expiresAt,
        createdAt: sharedReports.createdAt,
      })
      .from(sharedReports)
      .where(eq(sharedReports.workspaceId, wsId))
      .orderBy(desc(sharedReports.createdAt))
      .limit(20);

    res.json(links);
  } catch (err) {
    logger.error({ err }, "List shared links failed");
    res.status(500).json({ error: "Failed to list shared links" });
  }
});

router.patch("/shared-links/:shareId/deactivate", async (req, res): Promise<void> => {
  try {
    // SEC-05: see /share comment — never fall back to user.id.
    const wsId = getOrgId(req);
    if (wsId == null) { res.status(401).json({ error: "Unauthorized" }); return; }

    await db
      .update(sharedReports)
      .set({ isActive: false })
      .where(and(eq(sharedReports.shareId, req.params.shareId), eq(sharedReports.workspaceId, wsId)));

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Deactivate shared link failed");
    res.status(500).json({ error: "Failed to deactivate" });
  }
});

export default router;
