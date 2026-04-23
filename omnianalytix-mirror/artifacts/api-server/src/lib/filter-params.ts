// ─── Shared filter-param parser ───────────────────────────────────────────────
// Parses & validates dimension filters that the dashboard FilterBar sends as
// `filter.<dim>=v1,v2`, plus the advanced-filter add-ons:
//   • `filter.q`         — free-text fuzzy search (campaign / SKU / title)
//   • `filter.minSpend`  — numeric metric thresholds (min/max for
//     spend, roas, poas, conversions)
//   • `filter.status`    — campaign status enum (ENABLED, PAUSED, …)
//
// Validation is strict — every value passes a parser or is dropped. Nothing
// here is interpolated into raw SQL; downstream callers must use parameterised
// queries (drizzle's `sql` template, BigQuery named params, etc.).

import type { Request } from "express";

export type DimensionId =
  | "account"
  | "platform"
  | "campaign"
  | "adGroup"
  | "country"
  | "region"
  | "brand"
  | "collection"
  | "sku"
  | "segment"
  | "device"
  | "network"
  | "lifecycle"
  | "status";

export type FilterValues = Partial<Record<DimensionId, string[]>>;

export type ThresholdKey =
  | "minSpend"
  | "maxSpend"
  | "minRoas"
  | "maxRoas"
  | "minPoas"
  | "maxPoas"
  | "minConv"
  | "maxConv";

export type Thresholds = Partial<Record<ThresholdKey, number>>;

export interface AdvancedFilters {
  dimensions: FilterValues;
  q: string | null;
  thresholds: Thresholds;
}

const SAFE_TOKEN  = /^[A-Za-z0-9_\-.: ]{1,64}$/;
const COUNTRY_RE  = /^[A-Za-z]{2}$/;
const PLATFORMS   = new Set(["google_ads", "meta_ads", "tiktok_ads", "shopify", "gmc"]);
const DEVICES     = new Set(["mobile", "desktop", "tablet"]);
const NETWORKS    = new Set(["search", "display", "shopping", "pmax", "youtube"]);
const LIFECYCLES  = new Set(["awareness", "consideration", "conversion", "retention"]);
const SEGMENTS    = new Set(["new", "returning", "ltv_high", "ltv_low"]);
const STATUSES    = new Set(["ENABLED", "PAUSED", "REMOVED", "LEARNING"]);

function splitCsv(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);
}

function validateBy(values: string[], pred: (v: string) => boolean): string[] {
  return values.filter(pred);
}

function normaliseCountry(arr: string[]): string[] {
  return arr.filter((c) => COUNTRY_RE.test(c)).map((c) => c.toUpperCase());
}

function inSet(set: Set<string>) {
  return (v: string) => set.has(v);
}

const PARSERS: Record<DimensionId, (raw: unknown) => string[]> = {
  account:    (r) => validateBy(splitCsv(r), (v) => SAFE_TOKEN.test(v)),
  platform:   (r) => validateBy(splitCsv(r), inSet(PLATFORMS)),
  campaign:   (r) => validateBy(splitCsv(r), (v) => SAFE_TOKEN.test(v)),
  adGroup:    (r) => validateBy(splitCsv(r), (v) => SAFE_TOKEN.test(v)),
  country:    (r) => normaliseCountry(splitCsv(r)),
  region:     (r) => validateBy(splitCsv(r), (v) => SAFE_TOKEN.test(v)),
  brand:      (r) => validateBy(splitCsv(r), (v) => SAFE_TOKEN.test(v)),
  collection: (r) => validateBy(splitCsv(r), (v) => SAFE_TOKEN.test(v)),
  sku:        (r) => validateBy(splitCsv(r), (v) => SAFE_TOKEN.test(v)),
  segment:    (r) => validateBy(splitCsv(r), inSet(SEGMENTS)),
  device:     (r) => validateBy(splitCsv(r), inSet(DEVICES)),
  network:    (r) => validateBy(splitCsv(r), inSet(NETWORKS)),
  lifecycle:  (r) => validateBy(splitCsv(r), inSet(LIFECYCLES)),
  status:     (r) => validateBy(splitCsv(r).map((v) => v.toUpperCase()), inSet(STATUSES)),
};

const DIMENSIONS: DimensionId[] = Object.keys(PARSERS) as DimensionId[];

const THRESHOLD_KEYS: ThresholdKey[] = [
  "minSpend", "maxSpend",
  "minRoas",  "maxRoas",
  "minPoas",  "maxPoas",
  "minConv",  "maxConv",
];

// Loose search regex: alphanumerics, spaces, basic punctuation. Length
// capped to keep ILIKE patterns cheap. The result is parameterised, never
// interpolated raw, but we still scrub characters that would only ever
// indicate an injection attempt.
const SEARCH_SAFE_RE = /^[A-Za-z0-9 _\-.:'/&+]{1,80}$/;

function parseSearch(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!SEARCH_SAFE_RE.test(trimmed)) return null;
  return trimmed;
}

function parseThreshold(raw: unknown): number | null {
  if (typeof raw !== "string" || !raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1e12) return null;
  return n;
}

/**
 * Parse the `filter.*` query params off a request, validating each dimension
 * against its allow-list / regex. Empty arrays are dropped from the result.
 */
export function parseFilterParams(req: Pick<Request, "query">): FilterValues {
  const out: FilterValues = {};
  for (const dim of DIMENSIONS) {
    const raw = (req.query as Record<string, unknown>)[`filter.${dim}`];
    if (raw === undefined) continue;
    const arr = PARSERS[dim](raw);
    if (arr.length > 0) out[dim] = arr;
  }
  return out;
}

/**
 * Parse the full advanced-filter set: dimensions + free-text search +
 * numeric metric thresholds. All three components are independently optional.
 */
export function parseAdvancedFilters(req: Pick<Request, "query">): AdvancedFilters {
  const dimensions = parseFilterParams(req);
  const q = parseSearch((req.query as Record<string, unknown>)["filter.q"]);
  const thresholds: Thresholds = {};
  for (const key of THRESHOLD_KEYS) {
    const v = parseThreshold((req.query as Record<string, unknown>)[`filter.${key}`]);
    if (v != null) thresholds[key] = v;
  }
  return { dimensions, q, thresholds };
}

/** True iff a dimension has at least one selected value. */
export function hasFilter(filters: FilterValues, dim: DimensionId): boolean {
  return (filters[dim]?.length ?? 0) > 0;
}

/** True iff any advanced filter (dim, q, threshold) is set. */
export function hasAnyFilter(adv: AdvancedFilters): boolean {
  if (adv.q) return true;
  if (Object.keys(adv.thresholds).length > 0) return true;
  for (const arr of Object.values(adv.dimensions)) {
    if (arr && arr.length > 0) return true;
  }
  return false;
}
