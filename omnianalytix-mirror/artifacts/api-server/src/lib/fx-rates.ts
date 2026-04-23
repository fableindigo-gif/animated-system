import { db, fxRates, fxOverrides } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { logger } from "./logger";

// ─── FX rates service ─────────────────────────────────────────────────────────
//
// All warehouse values in OmniAnalytix are denominated in USD. To honestly
// display them in the user's preferred currency we maintain a per-day cache
// of (USD → quote) rates.
//
// Resolution chain at lookup time:
//   1. workspace override (if `workspaceId` provided + override row exists)
//   2. exact (USD, quote, rateDate) cached row
//   3. nearest preceding cached row (so weekend/holiday windows still work)
//   4. live fetch + upsert
//   5. last-resort: 1.0 (with a logged warning) — never throws.
//
// Provider: exchangerate.host is free, no API key, daily granularity. Override
// `FX_PROVIDER_URL` env var to switch sources without code changes.

// open.er-api.com offers a keyless `/latest/USD` endpoint with no rate limit
// suitable for our once-daily refresh. Historical lookups (any date older
// than today) require a paid provider; we accept that and fall back to the
// most-recent cached row for past dates (see `getRates`).
const PROVIDER_URL = process.env.FX_PROVIDER_URL ?? "https://open.er-api.com/v6";
const PROVIDER_NAME = process.env.FX_PROVIDER_NAME ?? "open.er-api.com";

export type FxRateLookup = {
  base: "USD";
  quote: string;
  rate: number;
  rateDate: string; // ISO YYYY-MM-DD
  source: "override" | "cache" | "fallback" | "fetched";
};

function isoDate(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

// ─── Provider client ──────────────────────────────────────────────────────────
//
// Both exchangerate.host and openexchangerates expose a similar shape:
//   GET {base}/historical/{date}?base=USD&symbols=INR,GBP
// We tolerate both response shapes.
async function fetchFromProvider(date: string, quotes: string[]): Promise<Record<string, number>> {
  const symbols = quotes.join(",");
  const base = PROVIDER_URL.replace(/\/$/, "");
  const today = new Date().toISOString().slice(0, 10);
  // Two URL shapes are supported transparently:
  //   • open.er-api.com/v6/latest/USD                   → today's rates only
  //   • exchangerate.host (and clones)/YYYY-MM-DD?base=USD&symbols=…
  // We pick based on whether the requested date is today and whether the
  // provider URL hints at the open.er-api shape.
  const isToday = date === today;
  const isOpenEr = /open\.er-api\.com/.test(base);
  const url = (isToday && isOpenEr)
    ? `${base}/latest/USD`
    : `${base}/${date}?base=USD&symbols=${symbols}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!resp.ok) throw new Error(`FX provider HTTP ${resp.status}`);
  const json = await resp.json() as {
    rates?: Record<string, number>;
    conversion_rates?: Record<string, number>;
    result?: string;
    success?: boolean;
  };
  if (json.success === false || (json.result && json.result !== "success")) {
    throw new Error("FX provider returned no rates");
  }
  const all = json.rates ?? json.conversion_rates;
  if (!all) throw new Error("FX provider returned no rates");
  // Filter to requested quotes so writeCache doesn't store the full ~160-row payload.
  const filtered: Record<string, number> = {};
  for (const q of quotes) {
    const v = all[q.toUpperCase()];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) filtered[q.toUpperCase()] = v;
  }
  if (!Object.keys(filtered).length) throw new Error("FX provider returned no matching quotes");
  return filtered;
}

// ─── Cache I/O ────────────────────────────────────────────────────────────────

async function readCache(quotes: string[], date: string): Promise<Map<string, number>> {
  const rows = await db
    .select()
    .from(fxRates)
    .where(and(
      eq(fxRates.base, "USD"),
      inArray(fxRates.quote, quotes),
      eq(fxRates.rateDate, date),
    ))
    .execute();
  return new Map(rows.map((r) => [r.quote, Number(r.rate)]));
}

async function writeCache(date: string, rates: Record<string, number>): Promise<void> {
  if (!Object.keys(rates).length) return;
  for (const [quote, rate] of Object.entries(rates)) {
    if (!Number.isFinite(rate) || rate <= 0) continue;
    try {
      await db
        .insert(fxRates)
        .values({ base: "USD", quote, rateDate: date, rate, source: PROVIDER_NAME })
        .onConflictDoUpdate({
          target: [fxRates.base, fxRates.quote, fxRates.rateDate],
          set: { rate, source: PROVIDER_NAME, fetchedAt: new Date() },
        })
        .execute();
    } catch (err) {
      logger.warn({ err, quote, date }, "fxRates: failed to upsert");
    }
  }
}

async function readOverrides(workspaceId: number, quotes: string[]): Promise<Map<string, number>> {
  const rows = await db
    .select()
    .from(fxOverrides)
    .where(and(
      eq(fxOverrides.workspaceId, workspaceId),
      eq(fxOverrides.base, "USD"),
      inArray(fxOverrides.quote, quotes),
    ))
    .execute();
  return new Map(rows.map((r) => [r.quote, Number(r.rate)]));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Look up USD→quote rates for a single date. Always returns one entry per
 * requested quote — falls back to 1.0 with `source: "fallback"` if a quote
 * cannot be resolved (so callers never have to deal with missing keys).
 *
 * USD→USD is short-circuited to 1.0.
 */
export async function getRates(
  quotes: string[],
  date: Date | string = new Date(),
  workspaceId?: number | null,
): Promise<FxRateLookup[]> {
  const dateStr = isoDate(date);
  const wanted  = Array.from(new Set(quotes.map((q) => q.toUpperCase()))).filter((q) => q && q !== "USD");

  const out: FxRateLookup[] = [];
  // USD passthrough
  if (quotes.some((q) => q.toUpperCase() === "USD")) {
    out.push({ base: "USD", quote: "USD", rate: 1, rateDate: dateStr, source: "cache" });
  }
  if (!wanted.length) return out;

  // 1. Per-workspace overrides
  const overrides = workspaceId != null ? await readOverrides(workspaceId, wanted) : new Map<string, number>();
  const remaining = wanted.filter((q) => !overrides.has(q));

  // 2. Exact-date cache
  const cached = remaining.length ? await readCache(remaining, dateStr) : new Map<string, number>();
  const stillMissing = remaining.filter((q) => !cached.has(q));

  // 3. Live fetch + upsert (only meaningful for "today" with our keyless provider).
  let fetched: Record<string, number> = {};
  if (stillMissing.length) {
    try {
      fetched = await fetchFromProvider(dateStr, stillMissing);
      await writeCache(dateStr, fetched);
    } catch (err) {
      logger.warn({ err, quotes: stillMissing, dateStr }, "fxRates: provider fetch failed; will try nearest-prior cache");
    }
  }

  // 4. Nearest-prior-cached fallback (historical-rate accuracy).
  // For any quote we still couldn't resolve, look up the most recent cached
  // row strictly before `dateStr`. This means a P&L for last March uses the
  // closest-known rate to last March instead of degrading to 1.0.
  const yetMissing = stillMissing.filter((q) => fetched[q] == null);
  const nearest    = new Map<string, { rate: number; rateDate: string }>();
  if (yetMissing.length) {
    try {
      for (const q of yetMissing) {
        const rows = await db
          .select({ rate: fxRates.rate, rateDate: fxRates.rateDate })
          .from(fxRates)
          .where(and(
            eq(fxRates.base, "USD"),
            eq(fxRates.quote, q),
          ))
          .execute();
        // pick the latest rateDate <= dateStr
        let best: { rate: number; rateDate: string } | null = null;
        for (const r of rows) {
          if (r.rateDate > dateStr) continue;
          if (!best || r.rateDate > best.rateDate) {
            best = { rate: Number(r.rate), rateDate: r.rateDate };
          }
        }
        if (best) nearest.set(q, best);
      }
    } catch (err) {
      logger.warn({ err, quotes: yetMissing }, "fxRates: nearest-prior cache lookup failed");
    }
  }

  for (const q of wanted) {
    if (overrides.has(q)) {
      out.push({ base: "USD", quote: q, rate: overrides.get(q)!, rateDate: dateStr, source: "override" });
    } else if (cached.has(q)) {
      out.push({ base: "USD", quote: q, rate: cached.get(q)!, rateDate: dateStr, source: "cache" });
    } else if (fetched[q] != null && Number.isFinite(fetched[q]) && fetched[q] > 0) {
      out.push({ base: "USD", quote: q, rate: fetched[q], rateDate: dateStr, source: "fetched" });
    } else if (nearest.has(q)) {
      const n = nearest.get(q)!;
      out.push({ base: "USD", quote: q, rate: n.rate, rateDate: n.rateDate, source: "cache" });
    } else {
      // Last resort — never throw, always return *something* so the UI stays functional.
      out.push({ base: "USD", quote: q, rate: 1, rateDate: dateStr, source: "fallback" });
    }
  }
  return out;
}

/** Convenience: convert one USD amount to a target currency on a given date. */
export async function convertUsd(
  amountUsd: number,
  toQuote: string,
  date: Date | string = new Date(),
  workspaceId?: number | null,
): Promise<{ amount: number; rate: number; source: FxRateLookup["source"]; rateDate: string }> {
  const [r] = await getRates([toQuote], date, workspaceId);
  return { amount: amountUsd * r.rate, rate: r.rate, source: r.source, rateDate: r.rateDate };
}

// ─── Daily cron ───────────────────────────────────────────────────────────────
//
// Refreshes a fixed list of "popular" currencies once per day so the
// dashboard never has to wait on the provider for a first-time render.
// The full set of supported currencies is still fetched on-demand the
// first time a user with an unusual currency loads the app.

const DEFAULT_DAILY_QUOTES = [
  "INR", "GBP", "EUR", "AUD", "CAD", "JPY", "CNY", "SGD",
  "AED", "BRL", "MXN", "ZAR", "SEK", "NOK", "DKK", "CHF",
  "HKD", "NZD", "ILS", "TRY", "KRW",
];

let cronStarted = false;
export function startFxRatesCron(): void {
  if (cronStarted) return;
  cronStarted = true;

  const refresh = async () => {
    try {
      await getRates(DEFAULT_DAILY_QUOTES);
      logger.info({ quotes: DEFAULT_DAILY_QUOTES.length }, "[FX] daily rates refreshed");
    } catch (err) {
      logger.warn({ err }, "[FX] daily refresh failed");
    }
  };

  // Initial fire after a short delay so we don't compete with server boot.
  setTimeout(refresh, 30_000);
  // Then every 24h.
  setInterval(refresh, 24 * 60 * 60 * 1000);
  logger.info("[FX] daily rates cron scheduled");
}
