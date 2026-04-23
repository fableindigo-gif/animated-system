import { Router, Request, Response } from "express";
import { db, platformConnections } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { getFreshGoogleCredentials } from "../../lib/google-token-refresh";
import { getOrgId } from "../../middleware/rbac";
import {
  crossPlatform_marginBleedXRay,
  crossPlatform_ghostAudienceDeduplicator,
  crossPlatform_crmArbitrage,
} from "../../lib/platform-executors";
import { logger } from "../../lib/logger";
import { decryptCredentials } from "../../lib/credential-helpers";
import shoppingRouter from "./shopping";

const router = Router();

// ─── Shopping Insider (BigQuery-backed Google Ads + Merchant Center) ─────────
router.use("/shopping", shoppingRouter);

// ─── Helper: parse a date window (`from`/`to` ISO or `days_back`/`days`) ──────
// Supports any of:
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD   (preferred — exact range)
//   ?days_back=N                      (rolling window ending now)
//   ?days=N                           (alias of days_back)
//
// Returns BOTH the explicit {from, to} bounds AND the equivalent integer
// `daysBack`. Executors may use whichever fits the upstream API best
// (e.g. Google Ads GAQL prefers explicit `BETWEEN`; Shopify uses created_at).
//
// Bounds: 1 .. MAX_DAYS (defaults to 365 — call sites override with a tighter
// cap when the upstream API can't go further back, e.g. Shopify orders @ 90).
//
// Throws { status: 400, message } on invalid input (caller should catch and
// surface as a 400). Specifically: from > to, range too large.
export type DateWindow = { from: Date; to: Date; daysBack: number; explicit: boolean };

export function parseDateWindow(req: Request, defaultDays: number, maxDays = 365): DateWindow {
  const fromRaw = String(req.query.from ?? "").trim();
  const toRaw   = String(req.query.to ?? "").trim();
  // Catch partial inputs early — silently falling back to days-mode hides
  // client bugs where one half of the range is missing or misnamed.
  if ((fromRaw && !toRaw) || (!fromRaw && toRaw)) {
    throw Object.assign(new Error("Both `from` and `to` must be supplied together"), { status: 400 });
  }
  if (fromRaw && toRaw) {
    const from = new Date(fromRaw);
    const to   = new Date(toRaw);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      throw Object.assign(new Error("Invalid `from`/`to` date — expected YYYY-MM-DD"), { status: 400 });
    }
    if (from > to) {
      throw Object.assign(new Error("`from` must be on or before `to`"), { status: 400 });
    }
    // Inclusive day count.
    const diff = Math.ceil((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (diff > maxDays) {
      throw Object.assign(new Error(`Date range too large — max ${maxDays} days for this endpoint`), { status: 400 });
    }
    return { from, to, daysBack: Math.max(1, diff), explicit: true };
  }

  const raw = req.query.days_back ?? req.query.days ?? defaultDays;
  const parsed = parseInt(String(raw), 10);
  const daysBack = !Number.isFinite(parsed) || parsed <= 0
    ? defaultDays
    : Math.max(1, Math.min(maxDays, parsed));

  const to = new Date();
  const from = new Date(to.getTime() - daysBack * 86_400_000);
  return { from, to, daysBack, explicit: false };
}

// ─── Helper: load credentials for a given platform ────────────────────────────

async function loadCredentials(platform: string, organizationId?: number | null): Promise<Record<string, string> | null> {
  try {
    if (platform === "google_ads") {
      const fresh = await getFreshGoogleCredentials("google_ads", organizationId);
      if (fresh) return fresh;
    }
    const conditions = [eq(platformConnections.platform, platform)];
    conditions.push(organizationId != null ? eq(platformConnections.organizationId, organizationId) : isNull(platformConnections.organizationId));
    const rows = await db.select().from(platformConnections).where(and(...conditions)).execute();
    const row = rows[0];
    if (!row) return null;
    return decryptCredentials((row.credentials as Record<string, string>) ?? {});
  } catch {
    return null;
  }
}

// ─── GET /insights/cross-platform/margin-bleed ────────────────────────────────
// Returns "bleeding SKUs": ROAS > 2.0 but POAS < 1.0, after cross-referencing
// Google Ads / Meta ad spend against Shopify COGS + shipping + platform fees.
router.get("/cross-platform/margin-bleed", async (req: Request, res: Response) => {
  try {
    // Shopify orders endpoint can only look back ~90d efficiently.
    const win = parseDateWindow(req, 30, 90);
    const orgId = getOrgId(req);
    const [gads, shopify] = await Promise.all([
      loadCredentials("google_ads", orgId),
      loadCredentials("shopify", orgId),
    ]);

    const result = await crossPlatform_marginBleedXRay(gads, shopify, win.daysBack, { from: win.from, to: win.to });

    return res.json({
      ok: result.success,
      message: result.message,
      ...result.data,
    });
  } catch (err) {
    const status = (err as { status?: number })?.status === 400 ? 400 : 500;
    if (status === 500) logger.error({ err }, "GET /insights/cross-platform/margin-bleed error");
    return res.status(status).json({ ok: false, message: status === 400 ? (err as Error).message : "Internal server error" });
  }
});

// ─── GET /insights/cross-platform/audience-overlap ───────────────────────────
// Compares Shopify ground-truth revenue against Meta + Google self-reported
// conversion value to surface double-counting and calculate the true Blended ROAS/CAC.
// Query param: days_back (default 30, max 90)
router.get("/cross-platform/audience-overlap", async (req: Request, res: Response) => {
  try {
    // Honor `from`/`to` (preferred) or `days_back`/`days`. Cap at 90 days
    // because the Shopify orders API window beyond that is unreliable.
    const win = parseDateWindow(req, 30, 90);

    const orgId = getOrgId(req);
    const [gads, shopify] = await Promise.all([
      loadCredentials("google_ads", orgId),
      loadCredentials("shopify", orgId),
    ]);

    const result = await crossPlatform_ghostAudienceDeduplicator(gads, shopify, win.daysBack, { from: win.from, to: win.to });

    return res.json({
      ok: result.success,
      message: result.message,
      ...result.data,
    });
  } catch (err) {
    const status = (err as { status?: number })?.status === 400 ? 400 : 500;
    if (status === 500) logger.error({ err }, "GET /insights/cross-platform/audience-overlap error");
    return res.status(status).json({ ok: false, message: status === 400 ? (err as Error).message : "Internal server error" });
  }
});

// ─── GET /insights/cross-platform/crm-arbitrage ──────────────────────────────
// Finds Shopify customers in their natural repurchase window (default 30-40 days).
// Returns a CRM email list + an ad exclusion list for Google Ads / Meta.
// Query params: window_start (default 30), window_end (default 40)
router.get("/cross-platform/crm-arbitrage", async (req: Request, res: Response) => {
  try {
    const windowStart = Math.max(1, parseInt(String(req.query.window_start ?? "30"), 10) || 30);
    const windowEnd   = Math.max(windowStart + 1, parseInt(String(req.query.window_end ?? "40"), 10) || 40);

    const orgId = getOrgId(req);
    const shopify = await loadCredentials("shopify", orgId);

    const result = await crossPlatform_crmArbitrage(shopify, windowStart, windowEnd);

    return res.json({
      ok: result.success,
      message: result.message,
      ...result.data,
    });
  } catch (err) {
    logger.error({ err }, "GET /insights/cross-platform/crm-arbitrage error");
    return res.status(500).json({ ok: false, message: "Internal server error" });
  }
});

export default router;
