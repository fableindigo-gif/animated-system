/**
 * /api/platform — Platform-owner-only routes.
 * All routes are protected by requireSuperAdmin middleware (applied in routes/index.ts).
 */
// tenant-ownership-skip-file: Mounted with `requireSuperAdmin` middleware in
// routes/index.ts:125. By design these handlers return cross-organization
// platform-wide aggregates (lead counts, total org count, executionLogs
// 24h window). Tenant scoping would defeat the purpose. Per-handler skips
// would be 5+ lines of comment noise; the file-level guard is precise.

import { Router } from "express";
import { desc, eq, sql, gte, and } from "drizzle-orm";
import {
  db, leads, organizations, teamMembers, workspaces, executionLogs, feedgenRuns,
} from "@workspace/db";
import { logger } from "../../lib/logger";

/**
 * Mirror of the pricing helpers in routes/feed-enrichment/feedgen.ts.
 * Reading env vars on every request (not cached) so a rate update is
 * reflected without a redeploy — same behaviour as the per-tenant panel.
 */
function feedgenPricingUsdPer1M(): { prompt: number; candidates: number } {
  const parse = (raw: string | undefined, fallback: number): number => {
    if (raw === undefined || raw === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    prompt:     parse(process.env.FEEDGEN_USD_PER_1M_PROMPT_TOKENS,     0.30),
    candidates: parse(process.env.FEEDGEN_USD_PER_1M_CANDIDATES_TOKENS, 2.50),
  };
}

function feedgenEstimateUsd(
  promptTokens: number,
  candidatesTokens: number,
  pricing: { prompt: number; candidates: number },
): number {
  return (promptTokens * pricing.prompt + candidatesTokens * pricing.candidates) / 1_000_000;
}

const router = Router();

// ─── GET /api/platform/leads ──────────────────────────────────────────────────
// All demo request / enterprise contact submissions, newest first.
// Supports ?status= filter.

router.get("/leads", async (req, res) => {
  try {
    const statusFilter = req.query.status as string | undefined;
    const rows = await db
      .select()
      .from(leads)
      .where(
        statusFilter && statusFilter !== "all"
          ? eq(leads.status, statusFilter)
          : undefined,
      )
      .orderBy(desc(leads.createdAt));
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /platform/leads failed");
    res.status(500).json({ error: "Failed to fetch leads" });
  }
});

// ─── PATCH /api/platform/leads/:id ───────────────────────────────────────────
// Update lead status ("new" | "contacted" | "archived") and optional notes.

router.patch("/leads/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const { status, notes } = req.body as { status?: string; notes?: string };
    const patch: Record<string, unknown> = {};
    if (status !== undefined) patch.status = status;
    if (notes !== undefined) patch.notes = notes;
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "No fields to update" }); return;
    }

    const [updated] = await db.update(leads).set(patch).where(eq(leads.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Lead not found" }); return; }
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "PATCH /platform/leads/:id failed");
    res.status(500).json({ error: "Failed to update lead" });
  }
});

// ─── GET /api/platform/tenants ────────────────────────────────────────────────
// All registered agencies with their subscription status and member/workspace counts.

router.get("/tenants", async (req, res) => {
  try {
    const orgs = await db
      .select()
      .from(organizations)
      .orderBy(desc(organizations.createdAt));

    const enriched = await Promise.all(
      orgs.map(async (org) => {
        const [memberRow] = await db
          .select({ c: sql<number>`COUNT(*)::int` })
          .from(teamMembers)
          .where(and(eq(teamMembers.organizationId, org.id), eq(teamMembers.isActive, true)));
        const [wsRow] = await db
          .select({ c: sql<number>`COUNT(*)::int` })
          .from(workspaces)
          .where(eq(workspaces.organizationId, org.id));
        const [pendingRow] = await db
          .select({ c: sql<number>`COUNT(*)::int` })
          .from(teamMembers)
          .where(and(eq(teamMembers.organizationId, org.id), eq(teamMembers.invitePending, true)));

        return {
          ...org,
          activeMembers: memberRow?.c ?? 0,
          workspaceCount: wsRow?.c ?? 0,
          pendingInvites: pendingRow?.c ?? 0,
          health:
            (wsRow?.c ?? 0) > 0 ? "onboarded"
            : (memberRow?.c ?? 0) > 1 ? "active"
            : "new",
        };
      }),
    );

    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "GET /platform/tenants failed");
    res.status(500).json({ error: "Failed to fetch tenants" });
  }
});

// ─── GET /api/platform/metrics ────────────────────────────────────────────────
// Aggregated platform KPIs.

router.get("/metrics", async (req, res) => {
  try {
    const [[orgRow], [userRow], [wsRow], [leadRow], [newLeadRow], [syncRow]] =
      await Promise.all([
        db.select({ c: sql<number>`COUNT(*)::int` }).from(organizations),
        db.select({ c: sql<number>`COUNT(*)::int` }).from(teamMembers).where(eq(teamMembers.isActive, true)),
        db.select({ c: sql<number>`COUNT(*)::int` }).from(workspaces).where(eq(workspaces.status, "active")),
        db.select({ c: sql<number>`COUNT(*)::int` }).from(leads),
        db.select({ c: sql<number>`COUNT(*)::int` }).from(leads).where(eq(leads.status, "new")),
        db
          .select({ c: sql<number>`COUNT(*)::int` })
          .from(executionLogs)
          .where(gte(executionLogs.createdAt, sql`NOW() - INTERVAL '24 hours'`)),
      ]);

    const totalOrgs    = orgRow?.c ?? 0;
    const totalUsers   = userRow?.c ?? 0;
    const totalWs      = wsRow?.c ?? 0;
    const totalLeads   = leadRow?.c ?? 0;
    const newLeads     = newLeadRow?.c ?? 0;
    const syncsToday   = syncRow?.c ?? 0;

    // MRR estimate: count active paid subscriptions from org tiers.
    // Real Stripe MRR requires STRIPE_SECRET_KEY — if absent, fall back to estimate.
    const tierMap: Record<string, number> = { free: 0, starter: 99, pro: 299, enterprise: 999 };
    const tierRows = await db
      .select({ tier: organizations.subscriptionTier, c: sql<number>`COUNT(*)::int` })
      .from(organizations)
      .groupBy(organizations.subscriptionTier);
    const estimatedMrr = tierRows.reduce((sum, r) => {
      return sum + (tierMap[r.tier] ?? 0) * (r.c ?? 0);
    }, 0);

    res.json({
      totalOrgs,
      totalActiveUsers: totalUsers,
      totalActiveWorkspaces: totalWs,
      totalLeads,
      newLeads,
      syncsToday,
      estimatedMrrUsd: estimatedMrr,
      tierBreakdown: tierRows.map((r) => ({ tier: r.tier, count: r.c })),
    });
  } catch (err) {
    logger.error({ err }, "GET /platform/metrics failed");
    res.status(500).json({ error: "Failed to fetch platform metrics" });
  }
});

// ─── GET /api/platform/feedgen-spend ─────────────────────────────────────────
// Month-to-date (and historical) FeedGen USD spend across ALL tenants,
// grouped by calendar month and tenant_id.  Finance uses this to cross-check
// the estimated Vertex AI bill against what we report per-tenant.
//
// Response shape:
//   {
//     months: [
//       {
//         month:    "2026-04",
//         label:    "April 2026",
//         totalUsd: 12.34,
//         tenants: [{ tenantId, promptTokens, candidatesTokens, usd }, …]
//       }, …
//     ],
//     pricing: { promptUsdPer1M, candidatesUsdPer1M, currency }
//   }
//
// Returns up to 12 calendar months (most recent first).

router.get("/feedgen-spend", async (_req, res) => {
  try {
    const pricing = feedgenPricingUsdPer1M();

    const rows = await db.execute(sql`
      SELECT
        to_char(date_trunc('month', started_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
        tenant_id,
        COALESCE(SUM(prompt_tokens),     0)::bigint AS prompt_tokens,
        COALESCE(SUM(candidates_tokens), 0)::bigint AS candidates_tokens
      FROM feedgen_runs
      WHERE status = 'completed'
        AND started_at >= date_trunc('month', now() AT TIME ZONE 'UTC') - INTERVAL '11 months'
      GROUP BY 1, 2
      ORDER BY 1 DESC, 2
    `);

    type RawRow = {
      month: string;
      tenant_id: string;
      prompt_tokens: string | number;
      candidates_tokens: string | number;
    };

    const byMonth = new Map<string, {
      label: string;
      totalUsd: number;
      tenants: Array<{ tenantId: string; promptTokens: number; candidatesTokens: number; usd: number }>;
    }>();

    for (const r of (rows as unknown as { rows: RawRow[] }).rows ?? []) {
      const promptTokens     = Number(r.prompt_tokens)     || 0;
      const candidatesTokens = Number(r.candidates_tokens) || 0;
      const usd = feedgenEstimateUsd(promptTokens, candidatesTokens, pricing);

      if (!byMonth.has(r.month)) {
        const [year, mon] = r.month.split("-");
        const label = new Date(Number(year), Number(mon) - 1, 1)
          .toLocaleDateString("en-US", { month: "long", year: "numeric" });
        byMonth.set(r.month, { label, totalUsd: 0, tenants: [] });
      }
      const bucket = byMonth.get(r.month)!;
      bucket.totalUsd += usd;
      bucket.tenants.push({ tenantId: r.tenant_id, promptTokens, candidatesTokens, usd });
    }

    res.json({
      months: Array.from(byMonth.entries()).map(([month, v]) => ({ month, ...v })),
      pricing: {
        promptUsdPer1M:     pricing.prompt,
        candidatesUsdPer1M: pricing.candidates,
        currency:           "USD",
      },
    });
  } catch (err) {
    logger.error({ err }, "GET /platform/feedgen-spend failed");
    res.status(500).json({ error: "Failed to fetch FeedGen spend" });
  }
});

export default router;
