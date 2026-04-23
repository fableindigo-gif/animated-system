import type { Request, Response, NextFunction } from "express";
import { db, organizations, workspaces, feedEnrichmentJobs } from "@workspace/db";
import { eq, and, gte, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

// ─── Tier Limits ──────────────────────────────────────────────────────────────
// Tier 1 (base / pro): Up to 5,000 SKUs enriched per calendar month.
// Tier 2 (enterprise):  Unlimited.
// Any org on "enterprise" tier gets unlimited; everything else is Tier 1.
export const TIER_LIMITS = {
  enterprise:  Infinity,
  default:     5_000,
} as const;

export type EnrichmentTier = "enterprise" | "base";

// ─── Helper: resolve org + tier from request ──────────────────────────────────
export async function resolveEnrichmentContext(req: Request): Promise<{
  orgId:       number;
  tier:        EnrichmentTier;
  limit:       number;
  monthlyUsed: number;
  remaining:   number;
} | null> {
  const rbacUser = (req as any).rbacUser;

  let org: { id: number; subscriptionTier: string | null } | null = null;

  if (rbacUser?.organizationId) {
    const [o] = await db
      .select({ id: organizations.id, subscriptionTier: organizations.subscriptionTier })
      .from(organizations)
      .where(eq(organizations.id, rbacUser.organizationId))
      .limit(1);
    org = o ?? null;
  }

  if (!org && rbacUser?.workspaceId) {
    const [ws] = await db
      .select({ organizationId: workspaces.organizationId })
      .from(workspaces)
      .where(eq(workspaces.id, rbacUser.workspaceId))
      .limit(1);
    if (ws) {
      const [o] = await db
        .select({ id: organizations.id, subscriptionTier: organizations.subscriptionTier })
        .from(organizations)
        .where(eq(organizations.id, ws.organizationId))
        .limit(1);
      org = o ?? null;
    }
  }

  if (!org) {
    // Fallback: first organisation in the DB (single-tenant default)
    const [o] = await db
      .select({ id: organizations.id, subscriptionTier: organizations.subscriptionTier })
      .from(organizations)
      .limit(1);
    org = o ?? null;
  }

  if (!org) return null;

  const tier: EnrichmentTier =
    org.subscriptionTier === "enterprise" ? "enterprise" : "base";
  const limit = tier === "enterprise" ? TIER_LIMITS.enterprise : TIER_LIMITS.default;

  // Count SKUs processed this calendar month
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [{ total }] = await db
    .select({ total: sql<number>`coalesce(sum(${feedEnrichmentJobs.processedSkus}),0)` })
    .from(feedEnrichmentJobs)
    .where(
      and(
        eq(feedEnrichmentJobs.organizationId, org.id),
        gte(feedEnrichmentJobs.createdAt, monthStart),
      ),
    );

  const monthlyUsed = Number(total) || 0;
  const remaining   = limit === Infinity ? Infinity : Math.max(0, limit - monthlyUsed);

  return { orgId: org.id, tier, limit, monthlyUsed, remaining };
}

// ─── checkEnrichmentTier middleware ───────────────────────────────────────────
// Attaches `req.enrichmentCtx` with tier info.
// Returns 403 if the org has exhausted their monthly SKU quota.
// Pass `soft: true` to skip the quota check (for read-only endpoints).
export function checkEnrichmentTier(opts: { soft?: boolean } = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = await resolveEnrichmentContext(req);
      if (!ctx) {
        res.status(401).json({ error: "Could not resolve organisation for tier check." });
        return;
      }
      (req as any).enrichmentCtx = ctx;

      if (!opts.soft && ctx.remaining === 0) {
        res.status(403).json({
          error:        "Monthly SKU enrichment limit reached",
          tier:          ctx.tier,
          limit:         ctx.limit,
          monthlyUsed:  ctx.monthlyUsed,
          remaining:    0,
          code:         "ENRICHMENT_QUOTA_EXCEEDED",
          upgradeUrl:   "/billing-hub",
        });
        return;
      }
      next();
    } catch (err) {
      logger.error({ err }, "checkEnrichmentTier: failed");
      next(err);
    }
  };
}
