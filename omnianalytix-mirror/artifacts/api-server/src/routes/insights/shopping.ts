import { Router, type Request, type Response } from "express";
import type { Readable } from "node:stream";
import { logger } from "../../lib/logger";
import { handleRouteError } from "../../lib/route-error-handler";
import { BigQueryConfigError } from "../../lib/bigquery-client";
import {
  getCampaignPerformance,
  getProductPerformance,
  getProductIssues,
  getAccountHealth,
  streamCampaignPerformance,
  streamProductPerformance,
  streamProductIssues,
  type ProductSortBy,
} from "../../services/shopping-insider";

const router = Router();

function readRange(req: Request) {
  const startDate = typeof req.query.start_date === "string" ? req.query.start_date : undefined;
  const endDate = typeof req.query.end_date === "string" ? req.query.end_date : undefined;
  return { startDate, endDate };
}

function readBypassCache(req: Request): boolean {
  const v = req.query.no_cache ?? req.query.nocache ?? req.query.bypass_cache;
  if (v === undefined) return false;
  if (typeof v !== "string") return false;
  return v === "1" || v.toLowerCase() === "true";
}

class BadRequestError extends Error {}

function parseLimit(raw: unknown, fieldName = "limit"): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new BadRequestError(`Invalid ${fieldName}: must be a positive integer.`);
  }
  return n;
}

function parseEnum<T extends string>(raw: unknown, allowed: readonly T[], fieldName: string): T | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (typeof raw !== "string" || !(allowed as readonly string[]).includes(raw)) {
    throw new BadRequestError(`Invalid ${fieldName}: must be one of ${allowed.join(", ")}.`);
  }
  return raw as T;
}

const COUNTRY_RE = /^[A-Za-z]{2}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function parseId(raw: unknown, fieldName: string): string | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (typeof raw !== "string" || !ID_RE.test(raw)) {
    throw new BadRequestError(`Invalid ${fieldName}: must match ${ID_RE}.`);
  }
  return raw;
}

function parseCountry(raw: unknown): string | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (typeof raw !== "string" || !COUNTRY_RE.test(raw)) {
    throw new BadRequestError("Invalid country: must be a 2-letter ISO code.");
  }
  return raw.toUpperCase();
}

function sendConfigError(res: Response, err: BigQueryConfigError) {
  return res.status(503).json({
    ok: false,
    code: err.code,
    error: "Shopping Insider is not configured on this server.",
    message: err.message,
  });
}

function isCsvFormat(req: Request): boolean {
  const v = req.query.format;
  return typeof v === "string" && v.toLowerCase() === "csv";
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Pipe a BigQuery row stream to the response as a CSV download. Handles
 * backpressure, mid-stream errors, and client disconnects so memory stays flat
 * regardless of result size.
 */
function streamCsvFromBigQuery<T>(
  res: Response,
  filename: string,
  columns: string[],
  source: Readable,
  mapper: (row: T) => unknown[],
  routeLabel: string,
): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-store");
  // Flush headers immediately so the browser can start the download — improves
  // time-to-first-byte for large exports.
  res.flushHeaders?.();
  res.write(columns.map(csvCell).join(",") + "\n");

  const onData = (row: T) => {
    const line = mapper(row).map(csvCell).join(",") + "\n";
    if (!res.write(line)) {
      source.pause();
    }
  };
  const onDrain = () => source.resume();
  const onEnd = () => {
    cleanup();
    res.end();
  };
  const onError = (err: unknown) => {
    cleanup();
    logger.error({ err }, `${routeLabel} CSV stream failed mid-response`);
    // Headers already sent — the only thing we can do is destroy the response
    // so the client sees a truncated download instead of a "complete" file.
    if (!res.writableEnded) {
      res.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  };
  const onClientClose = () => {
    cleanup();
    source.destroy();
  };

  function cleanup() {
    source.off("data", onData);
    source.off("end", onEnd);
    source.off("error", onError);
    res.off("drain", onDrain);
    res.off("close", onClientClose);
  }

  source.on("data", onData);
  source.on("end", onEnd);
  source.on("error", onError);
  res.on("drain", onDrain);
  res.on("close", onClientClose);
}

// ─── GET /insights/shopping/campaigns ─────────────────────────────────────────
router.get("/campaigns", async (req, res) => {
  try {
    const range = readRange(req);
    const customerId = parseId(req.query.customer_id, "customer_id");
    const country = parseCountry(req.query.country);
    const csv = isCsvFormat(req);
    const limit = parseLimit(req.query.limit);

    const bypassCache = readBypassCache(req);
    if (csv) {
      const filename = `shopping-insights-campaigns_${range.startDate ?? "start"}_${range.endDate ?? "end"}.csv`;
      const source = streamCampaignPerformance({ range, customerId, country, limit });
      return streamCsvFromBigQuery(
        res,
        filename,
        [
          "campaign_id",
          "campaign_name",
          "customer_id",
          "impressions",
          "clicks",
          "ctr",
          "cost",
          "conversions",
          "conversion_value",
          "cpc",
          "roas",
        ],
        source,
        (c: Record<string, unknown>) => [
          c.campaign_id,
          c.campaign_name,
          c.customer_id,
          c.impressions,
          c.clicks,
          c.ctr,
          c.cost,
          c.conversions,
          c.conversion_value,
          c.cpc,
          c.roas,
        ],
        "GET /insights/shopping/campaigns",
      );
    }
    const rows = await getCampaignPerformance({ range, customerId, country, limit, bypassCache });
    return res.json({ ok: true, count: rows.length, range, cacheBypassed: bypassCache, rows });
  } catch (err) {
    if (err instanceof BigQueryConfigError) return sendConfigError(res, err);
    if (err instanceof BadRequestError) return res.status(400).json({ ok: false, error: err.message });
    if (err instanceof Error && /must be ISO|exceed 365|on or before/.test(err.message)) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    logger.error({ err }, "GET /insights/shopping/campaigns failed");
    return handleRouteError(err, req, res, "GET /insights/shopping/campaigns", { error: "Failed to query Shopping Insider campaigns" });
  }
});

// ─── GET /insights/shopping/products ──────────────────────────────────────────
const SORT_BY_VALUES = ["conversions", "conversion_value", "roas", "cost", "clicks"] as const;
const DIRECTION_VALUES = ["top", "bottom"] as const;
const SERVABILITY_VALUES = ["disapproved", "demoted", "all"] as const;

router.get("/products", async (req, res) => {
  try {
    const range = readRange(req);
    const sortBy = (parseEnum(req.query.sort_by, SORT_BY_VALUES, "sort_by") ?? "conversion_value") as ProductSortBy;
    const direction = parseEnum(req.query.direction, DIRECTION_VALUES, "direction") ?? "top";
    const merchantId = parseId(req.query.merchant_id, "merchant_id");
    const country = parseCountry(req.query.country);
    const csv = isCsvFormat(req);
    const limit = parseLimit(req.query.limit);

    const bypassCache = readBypassCache(req);
    if (csv) {
      const filename = `shopping-insights-products-${direction}_${range.startDate ?? "start"}_${range.endDate ?? "end"}.csv`;
      const source = streamProductPerformance({ range, sortBy, direction, merchantId, country, limit });
      return streamCsvFromBigQuery(
        res,
        filename,
        [
          "offer_id",
          "title",
          "brand",
          "product_type",
          "merchant_id",
          "country",
          "impressions",
          "clicks",
          "cost",
          "conversions",
          "conversion_value",
          "roas",
        ],
        source,
        (p: Record<string, unknown>) => [
          p.offer_id,
          p.title,
          p.brand,
          p.product_type,
          p.merchant_id,
          p.country,
          p.impressions,
          p.clicks,
          p.cost,
          p.conversions,
          p.conversion_value,
          p.roas,
        ],
        "GET /insights/shopping/products",
      );
    }
    const rows = await getProductPerformance({ range, sortBy, direction, merchantId, country, limit, bypassCache });
    return res.json({ ok: true, count: rows.length, range, sortBy, direction, cacheBypassed: bypassCache, rows });
  } catch (err) {
    if (err instanceof BigQueryConfigError) return sendConfigError(res, err);
    if (err instanceof BadRequestError) return res.status(400).json({ ok: false, error: err.message });
    if (err instanceof Error && /must be ISO|exceed 365|on or before|Invalid sortBy/.test(err.message)) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    logger.error({ err }, "GET /insights/shopping/products failed");
    return handleRouteError(err, req, res, "GET /insights/shopping/products", { error: "Failed to query Shopping Insider products" });
  }
});

// ─── GET /insights/shopping/issues ────────────────────────────────────────────
router.get("/issues", async (req, res) => {
  try {
    const merchantId = parseId(req.query.merchant_id, "merchant_id");
    const country = parseCountry(req.query.country);
    const servability = parseEnum(req.query.servability, SERVABILITY_VALUES, "servability");
    const csv = isCsvFormat(req);
    const limit = parseLimit(req.query.limit);

    const bypassCache = readBypassCache(req);
    if (csv) {
      const today = new Date().toISOString().slice(0, 10);
      const filename = `shopping-insights-disapprovals_${today}.csv`;
      const source = streamProductIssues({ merchantId, country, servability, limit });
      return streamCsvFromBigQuery(
        res,
        filename,
        [
          "offer_id",
          "title",
          "merchant_id",
          "country",
          "destination",
          "servability",
          "issue_code",
          "issue_description",
          "detail",
          "num_items",
        ],
        source,
        (row: Record<string, unknown>) => [
          row.offer_id,
          row.title,
          row.merchant_id,
          row.country,
          row.destination,
          row.servability,
          row.issue_code,
          row.issue_description,
          row.detail,
          row.num_items,
        ],
        "GET /insights/shopping/issues",
      );
    }
    const rows = await getProductIssues({ merchantId, country, servability, limit, bypassCache });
    return res.json({ ok: true, count: rows.length, cacheBypassed: bypassCache, rows });
  } catch (err) {
    if (err instanceof BigQueryConfigError) return sendConfigError(res, err);
    if (err instanceof BadRequestError) return res.status(400).json({ ok: false, error: err.message });
    logger.error({ err }, "GET /insights/shopping/issues failed");
    return handleRouteError(err, req, res, "GET /insights/shopping/issues", { error: "Failed to query Shopping Insider product issues" });
  }
});

// ─── GET /insights/shopping/account-health ────────────────────────────────────
router.get("/account-health", async (req, res) => {
  try {
    const merchantId = parseId(req.query.merchant_id, "merchant_id");
    const country = parseCountry(req.query.country);
    const bypassCache = readBypassCache(req);
    const rows = await getAccountHealth({ merchantId, country, bypassCache });
    return res.json({ ok: true, count: rows.length, cacheBypassed: bypassCache, rows });
  } catch (err) {
    if (err instanceof BigQueryConfigError) return sendConfigError(res, err);
    if (err instanceof BadRequestError) return res.status(400).json({ ok: false, error: err.message });
    logger.error({ err }, "GET /insights/shopping/account-health failed");
    return handleRouteError(err, req, res, "GET /insights/shopping/account-health", { error: "Failed to query Shopping Insider account health" });
  }
});

export default router;
