import { Router } from "express";
import { eq, and, asc } from "drizzle-orm";
import { db, workspaceFinancials } from "@workspace/db";
import { getOrgId } from "../../middleware/rbac";
import { assertWorkspaceOwnedByOrg } from "../../middleware/tenant-isolation";
import { logger } from "../../lib/logger";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getWorkspaceId(req: Parameters<typeof getOrgId>[0]): number | null {
  const header = req.headers["x-workspace-id"];
  const query  = (req.query as Record<string, string>).workspaceId;
  const raw    = (typeof header === "string" ? header : null) ?? query ?? null;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return isNaN(parsed) ? null : parsed;
}

/** Compute all derived P&L figures from the four raw inputs */
function derive(row: {
  revenue: number;
  cogs: number;
  operatingExpenses: number;
  interestExpense: number;
  taxExpense: number;
}) {
  const grossProfit       = row.revenue - row.cogs;
  const operatingIncome   = grossProfit - row.operatingExpenses;
  const earningsBeforeTax = operatingIncome - row.interestExpense;
  const netIncome         = earningsBeforeTax - row.taxExpense;
  return { grossProfit, operatingIncome, earningsBeforeTax, netIncome };
}

/** Build 12 months of illustrative seed data for a new workspace */
function buildSeedData(workspaceId: number) {
  const now    = new Date();
  const months: Array<{
    workspaceId: number; month: string; revenue: number; cogs: number;
    operatingExpenses: number; interestExpense: number; taxExpense: number;
  }> = [];

  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    // Realistic e-commerce growth curve — starts modest and climbs
    const base   = 80_000 + i * 6_500 + Math.sin(i) * 4_000;
    const revenue = parseFloat((base + Math.random() * 5_000).toFixed(2));
    months.push({
      workspaceId,
      month,
      revenue,
      cogs:              parseFloat((revenue * (0.38 + Math.random() * 0.05)).toFixed(2)),
      operatingExpenses: parseFloat((revenue * (0.22 + Math.random() * 0.04)).toFixed(2)),
      interestExpense:   parseFloat((1_200 + Math.random() * 400).toFixed(2)),
      taxExpense:        parseFloat((revenue * 0.03).toFixed(2)),
    });
  }
  return months;
}

// ─── GET /api/financials ──────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const wsId = getWorkspaceId(req);
    if (!wsId) {
      return void res.status(400).json({ error: "Missing workspaceId" });
    }

    const orgId = getOrgId(req);
    if (!(await assertWorkspaceOwnedByOrg(wsId, orgId))) {
      return void res.status(403).json({ error: "workspaceId does not belong to your organization", code: "WORKSPACE_NOT_OWNED" });
    }

    let rows = await db
      .select()
      .from(workspaceFinancials)
      .where(eq(workspaceFinancials.workspaceId, wsId))
      .orderBy(asc(workspaceFinancials.month));

    // Seed illustrative data when the workspace has no records yet
    if (rows.length === 0) {
      const seed = buildSeedData(wsId);
      try {
        await db.insert(workspaceFinancials).values(seed).onConflictDoNothing();
        rows = await db
          .select()
          .from(workspaceFinancials)
          .where(eq(workspaceFinancials.workspaceId, wsId))
          .orderBy(asc(workspaceFinancials.month));
      } catch (seedErr) {
        logger.warn({ seedErr, wsId }, "[Financials] Seed insert failed — returning empty");
      }
    }

    const records = rows.map((r) => {
      const revenue           = Number(r.revenue)           || 0;
      const cogs              = Number(r.cogs)              || 0;
      const operatingExpenses = Number(r.operatingExpenses) || 0;
      const interestExpense   = Number(r.interestExpense)   || 0;
      const taxExpense        = Number(r.taxExpense)        || 0;
      const { grossProfit, operatingIncome, earningsBeforeTax, netIncome } = derive({
        revenue, cogs, operatingExpenses, interestExpense, taxExpense,
      });
      return {
        id:                 r.id,
        month:              r.month,
        revenue,
        cogs,
        grossProfit,
        operatingExpenses,
        operatingIncome,
        interestExpense,
        earningsBeforeTax,
        taxExpense,
        netIncome,
        notes:              r.notes ?? null,
      };
    });

    // Summary totals across all months
    const totals = records.reduce(
      (acc, r) => {
        acc.revenue           += r.revenue;
        acc.cogs              += r.cogs;
        acc.grossProfit       += r.grossProfit;
        acc.operatingExpenses += r.operatingExpenses;
        acc.operatingIncome   += r.operatingIncome;
        acc.interestExpense   += r.interestExpense;
        acc.earningsBeforeTax += r.earningsBeforeTax;
        acc.taxExpense        += r.taxExpense;
        acc.netIncome         += r.netIncome;
        return acc;
      },
      {
        revenue: 0, cogs: 0, grossProfit: 0, operatingExpenses: 0,
        operatingIncome: 0, interestExpense: 0, earningsBeforeTax: 0,
        taxExpense: 0, netIncome: 0,
      },
    );

    // Round totals to 2dp
    for (const k of Object.keys(totals) as Array<keyof typeof totals>) {
      totals[k] = parseFloat(totals[k].toFixed(2));
    }

    res.json({ records, totals, workspaceId: wsId, syncedAt: Date.now() });
  } catch (err) {
    logger.error({ err }, "[Financials] GET / failed");
    res.status(500).json({ error: "Failed to load financial data" });
  }
});

export default router;
