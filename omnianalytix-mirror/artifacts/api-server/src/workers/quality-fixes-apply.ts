/**
 * Quality Fixes — Apply to Shopify
 * ────────────────────────────────
 * Pushes a single cached Shoptimizer diff back to the underlying Shopify
 * product so the suggested fix actually lands in the merchant's feed.
 *
 * Mapping rules:
 *   • `title`        → Shopify product.title (PUT /products/{id}.json)
 *   • `description`  → Shopify product.body_html (same PUT)
 *   • everything else (color, gtin, googleProductCategory, customAttributes…)
 *     → metafield in the `omnianalytix_feed` namespace, key = field name.
 *
 * After a successful write we:
 *   • mirror the new title/description/imageUrl onto the warehouse row and
 *     bump `synced_at` so the cached diff is treated as stale,
 *   • write an `audit_logs` row that records who applied which fix and when,
 *   • re-scan the product so the UI immediately reflects the new state.
 */
import {
  db,
  warehouseShopifyProducts,
  productQualityFixes,
  platformConnections,
  workspaces,
  auditLogs,
  type WarehouseShopifyProduct,
  type ProductQualityFix,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { rescanProductsByIds } from "./quality-fixes-scanner";
import { ShopifyRateLimiter } from "../lib/shopify-rate-limiter";

const SHOPIFY_API_VERSION = "2024-01";
const METAFIELD_NAMESPACE = "omnianalytix_feed";
const APPLY_TOOL_NAME     = "shopify_apply_quality_fix";
const UNDO_TOOL_NAME      = "shopify_undo_quality_fix";
const APPLY_PLATFORM      = "shopify";

// Re-exported so route handlers and the GET /quality-fixes endpoint can match
// audit_logs rows by tool name without re-declaring the constants.
export { APPLY_TOOL_NAME, UNDO_TOOL_NAME, APPLY_PLATFORM };

/** Per-field write outcome — surfaced in the audit log + API response. */
export interface AppliedFieldResult {
  field:   string;
  target:  "product" | "metafield";
  ok:      boolean;
  error?:  string;
}

/**
 * Authoritative per-field record persisted into `audit_logs.toolArgs.appliedFields`
 * at apply time. Stored *un-truncated* so an Undo replay can write the original
 * `before` values back to Shopify even after the cached diff in
 * `productQualityFixes` has been refreshed/cleared by a later rescan.
 */
export interface PersistedAppliedField {
  field:  string;
  target: "product" | "metafield";
  before: unknown;
  after:  unknown;
  ok:     boolean;
}

export interface ApplyQualityFixResult {
  ok:        boolean;
  productId: string;
  applied:   AppliedFieldResult[];
  errors:    string[];
  /** Audit log row id created for this attempt. */
  auditId:   number | null;
  /** Whether the post-apply rescan completed (best-effort). */
  rescanned: boolean;
}

export interface ApplyQualityFixOptions {
  /** warehouse_shopify_products.id — same as productQualityFixes.id. */
  fixId:          string;
  organizationId: number;
  workspaceId?:   number | null;
  /** rbac user info, included in the audit row. */
  user?: { id: number | null; name: string | null; role: string | null } | null;
}

/** Native Shopify product fields written via PUT /products/{id}.json. */
const NATIVE_FIELD_MAP: Record<string, string> = {
  title:       "title",
  description: "body_html",
};

interface ShopifyConnection { shop: string; accessToken: string }

// Shopify Admin API throttle: 2 req/sec sustained, 40-call leaky bucket.
// The module-level instance is shared across single-row applies, bulk applies,
// and undo replays so any burst of concurrent writes stays within limits.
const SHOPIFY_RL_REFILL_PER_SEC = 2;
const SHOPIFY_RL_CAPACITY       = 35;

const shopifyRateLimiter = new ShopifyRateLimiter(
  SHOPIFY_RL_CAPACITY,
  SHOPIFY_RL_REFILL_PER_SEC,
);

async function resolveShopifyConnection(
  organizationId: number,
  workspaceId?:   number | null,
): Promise<ShopifyConnection | null> {
  const lookup = async (orgId: number): Promise<ShopifyConnection | null> => {
    const [conn] = await db
      .select()
      .from(platformConnections)
      .where(and(
        eq(platformConnections.organizationId, orgId),
        eq(platformConnections.platform, "shopify"),
      ))
      .limit(1);
    if (!conn?.credentials) return null;
    const creds = conn.credentials as Record<string, string>;
    if (creds.accessToken && creds.shop) {
      return { shop: creds.shop, accessToken: creds.accessToken };
    }
    return null;
  };

  if (workspaceId) {
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    if (ws) {
      const c = await lookup(ws.organizationId);
      if (c) return c;
    }
  }
  return lookup(organizationId);
}

async function loadFixWithProduct(
  fixId:    string,
  tenantId: string,
): Promise<{ fix: ProductQualityFix; product: WarehouseShopifyProduct } | null> {
  const rows = await db
    .select()
    .from(productQualityFixes)
    .innerJoin(
      warehouseShopifyProducts,
      eq(warehouseShopifyProducts.id, productQualityFixes.id),
    )
    .where(and(
      eq(productQualityFixes.id, fixId),
      eq(productQualityFixes.tenantId, tenantId),
      eq(warehouseShopifyProducts.tenantId, tenantId),
    ))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0] as unknown as {
    product_quality_fixes:        ProductQualityFix;
    warehouse_shopify_products:   WarehouseShopifyProduct;
  };
  return { fix: r.product_quality_fixes, product: r.warehouse_shopify_products };
}

function previewValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v.length > 120 ? v.slice(0, 117) + "…" : v;
  try {
    const s = JSON.stringify(v);
    return s.length > 120 ? s.slice(0, 117) + "…" : s;
  } catch { return String(v); }
}

function asString(v: unknown): string {
  if (v == null) return "";
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** PUT to Shopify /products/{id}.json — used for title / body_html. */
async function writeProductFields(
  shop:        string,
  accessToken: string,
  productId:   string,
  fields:      Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  if (Object.keys(fields).length === 0) return { ok: true };
  try {
    await shopifyRateLimiter.acquire();
    const resp = await fetch(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}.json`,
      {
        method:  "PUT",
        headers: {
          "Content-Type":           "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          product: { id: productId, ...fields },
        }),
      },
    );
    if (!resp.ok) {
      const body = await resp.text();
      return { ok: false, error: `${resp.status} — ${body.substring(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `network error — ${String(err)}` };
  }
}

async function writeMetafield(
  shop:        string,
  accessToken: string,
  productId:   string,
  key:         string,
  value:       string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await shopifyRateLimiter.acquire();
    const resp = await fetch(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}/metafields.json`,
      {
        method:  "POST",
        headers: {
          "Content-Type":           "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          metafield: {
            namespace: METAFIELD_NAMESPACE,
            key,
            value,
            type:      "single_line_text_field",
          },
        }),
      },
    );
    if (!resp.ok) {
      const body = await resp.text();
      return { ok: false, error: `${resp.status} — ${body.substring(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `network error — ${String(err)}` };
  }
}

/**
 * Apply a single cached quality fix back to Shopify. The caller is
 * responsible for tenant/RBAC checks before invoking this — we only verify
 * the fix row belongs to the supplied tenant.
 */
export async function applyQualityFixToShopify(
  opts: ApplyQualityFixOptions,
): Promise<ApplyQualityFixResult> {
  const tenantId = String(opts.organizationId);
  const log = logger.child({ fixId: opts.fixId, organizationId: opts.organizationId });

  const loaded = await loadFixWithProduct(opts.fixId, tenantId);
  if (!loaded) {
    return {
      ok:        false,
      productId: opts.fixId,
      applied:   [],
      errors:    ["Quality fix not found for this tenant."],
      auditId:   null,
      rescanned: false,
    };
  }
  const { fix, product } = loaded;

  if (fix.status !== "ok") {
    return {
      ok: false,
      productId: product.productId,
      applied: [],
      errors: [`Fix status is "${fix.status}" — nothing to apply.`],
      auditId: null,
      rescanned: false,
    };
  }
  if (!Array.isArray(fix.changedFields) || fix.changedFields.length === 0) {
    return {
      ok: false,
      productId: product.productId,
      applied: [],
      errors: ["Fix has no changed fields."],
      auditId: null,
      rescanned: false,
    };
  }

  const conn = await resolveShopifyConnection(opts.organizationId, opts.workspaceId ?? null);
  if (!conn) {
    return {
      ok: false,
      productId: product.productId,
      applied: [],
      errors: ["No Shopify connection configured for this organization."],
      auditId: null,
      rescanned: false,
    };
  }

  // ── Partition changes into native Shopify product fields vs metafields ──
  const nativeFields:   Record<string, string> = {};
  const metafieldChanges: Array<{ field: string; value: string }> = [];
  // Track per-field intent for audit + caller.
  const intent: Array<{ field: string; target: "product" | "metafield"; after: unknown }> = [];

  for (const change of fix.changedFields) {
    const field = change.field;
    const after = change.after;
    if (NATIVE_FIELD_MAP[field]) {
      nativeFields[NATIVE_FIELD_MAP[field]] = asString(after);
      intent.push({ field, target: "product", after });
    } else {
      metafieldChanges.push({ field, value: asString(after) });
      intent.push({ field, target: "metafield", after });
    }
  }

  // ── 1) Native fields PUT ───────────────────────────────────────────────
  const nativeResult = await writeProductFields(
    conn.shop, conn.accessToken, product.productId, nativeFields,
  );
  // ── 2) Metafield POSTs (sequential — small N, easy to debug) ───────────
  const metafieldResults: Array<{ key: string; ok: boolean; error?: string }> = [];
  for (const { field, value } of metafieldChanges) {
    const r = await writeMetafield(conn.shop, conn.accessToken, product.productId, field, value);
    metafieldResults.push({ key: field, ...r });
  }

  // Build per-field outcome.
  const applied: AppliedFieldResult[] = intent.map((i) => {
    if (i.target === "product") {
      return {
        field: i.field,
        target: "product",
        ok: nativeResult.ok,
        error: nativeResult.ok ? undefined : nativeResult.error,
      };
    }
    const r = metafieldResults.find((m) => m.key === i.field);
    return {
      field: i.field,
      target: "metafield",
      ok: r?.ok ?? false,
      error: r?.ok ? undefined : r?.error,
    };
  });

  const errors = applied.filter((a) => !a.ok).map((a) => `${a.field}: ${a.error ?? "unknown"}`);
  const ok = errors.length === 0;

  // ── 3) Mirror native field writes onto the warehouse row + bump syncedAt ──
  // We do this even on partial success so the cache reflects what Shopify
  // now actually has. The bumped `synced_at` makes the cached fix stale, so
  // the cron would re-scan it next tick anyway.
  if (ok || nativeResult.ok) {
    const updates: Partial<WarehouseShopifyProduct> = { syncedAt: new Date() };
    if (nativeFields.title       !== undefined) updates.title       = nativeFields.title;
    if (nativeFields.body_html   !== undefined) updates.description = nativeFields.body_html;
    try {
      await db.update(warehouseShopifyProducts)
        .set(updates)
        .where(eq(warehouseShopifyProducts.id, product.id));
    } catch (err) {
      log.warn({ err }, "Failed to mirror applied fix onto warehouse row (non-fatal)");
    }
  }

  // ── 4) Audit log row ─────────────────────────────────────────────────────
  let auditId: number | null = null;
  try {
    const displayDiff = fix.changedFields.map((c) => ({
      label: c.field,
      from:  previewValue(c.before),
      to:    previewValue(c.after),
    }));
    const [row] = await db.insert(auditLogs).values({
      organizationId:  opts.organizationId,
      platform:        APPLY_PLATFORM,
      platformLabel:   "Shopify",
      toolName:        APPLY_TOOL_NAME,
      toolDisplayName: `Apply quality fix to Shopify product ${product.productId}`,
      toolArgs: {
        fixId:        fix.id,
        productId:    product.productId,
        sku:          product.sku,
        pluginsFired: fix.pluginsFired,
        applied,
        // Authoritative copy of every field that was attempted, with full
        // un-truncated before/after values. Powers the Undo flow even after
        // the cached diff has been overwritten by a later rescan.
        appliedFields: intent.map<PersistedAppliedField>((i) => {
          const r = applied.find((a) => a.field === i.field);
          return {
            field:  i.field,
            target: i.target,
            before: fix.changedFields.find((c) => c.field === i.field)?.before ?? null,
            after:  i.after,
            ok:     r?.ok ?? false,
          };
        }),
        appliedBy: opts.user
          ? { id: opts.user.id, name: opts.user.name, role: opts.user.role }
          : null,
      },
      displayDiff,
      result: {
        success: ok,
        message: ok
          ? `Wrote ${applied.length} field(s) to Shopify`
          : `Wrote ${applied.length - errors.length}/${applied.length} field(s); ${errors.length} failed`,
      },
      status: ok ? "applied" : "failed",
    }).returning({ id: auditLogs.id });
    auditId = row?.id ?? null;
  } catch (err) {
    log.warn({ err }, "Failed to write audit_logs row for quality-fix apply (non-fatal)");
  }

  // ── 5) Re-scan the product so the UI reflects the new state ─────────────
  let rescanned = false;
  try {
    const res = await rescanProductsByIds([product.id]);
    rescanned = !res.skipped;
  } catch (err) {
    log.warn({ err }, "Post-apply rescan failed (non-fatal — cron will retry)");
  }

  return { ok, productId: product.productId, applied, errors, auditId, rescanned };
}

// ─── Undo ────────────────────────────────────────────────────────────────────
// Replays the inverse of a previous Apply: writes the per-field `before` values
// back to Shopify using the authoritative copy stored in
// `audit_logs.toolArgs.appliedFields`. Records a *new* audit row so the
// activity trail captures both the original apply and the undo.
//
// Caller is responsible for tenant/RBAC checks before invoking; this routine
// only verifies the audit row's `organizationId` matches the supplied org.

export interface UndoQualityFixOptions {
  /** audit_logs.id of the apply row to undo. */
  auditId:        number;
  organizationId: number;
  workspaceId?:   number | null;
  user?: { id: number | null; name: string | null; role: string | null } | null;
}

export type UndoOutcomeCode =
  | "OK"
  | "NOT_FOUND"
  | "NOT_AN_APPLY"
  | "ALREADY_UNDONE"
  | "NO_FIELDS"
  | "SHOPIFY_PARTIAL"
  | "SHOPIFY_FAILED";

export interface UndoQualityFixResult {
  ok:        boolean;
  /** Structured outcome code — use this to map HTTP statuses, not error text. */
  code:      UndoOutcomeCode;
  productId: string | null;
  applied:   AppliedFieldResult[];
  errors:    string[];
  /** audit_logs.id of the *new* undo row. */
  auditId:   number | null;
  rescanned: boolean;
}

interface ApplyToolArgs {
  fixId:         string;
  productId:     string;
  sku:           string | null;
  appliedFields: PersistedAppliedField[];
  [k: string]:   unknown;
}

export async function undoQualityFixOnShopify(
  opts: UndoQualityFixOptions,
): Promise<UndoQualityFixResult> {
  const log = logger.child({ undoAuditId: opts.auditId, organizationId: opts.organizationId });

  // ── 1) Load the original apply row, scoped to the caller's org ──────────
  const [original] = await db
    .select()
    .from(auditLogs)
    .where(and(
      eq(auditLogs.id, opts.auditId),
      eq(auditLogs.organizationId, opts.organizationId),
    ))
    .limit(1);

  if (!original) {
    return {
      ok: false, code: "NOT_FOUND", productId: null, applied: [],
      errors: ["Audit entry not found for this tenant."],
      auditId: null, rescanned: false,
    };
  }
  if (original.toolName !== APPLY_TOOL_NAME) {
    return {
      ok: false, code: "NOT_AN_APPLY", productId: null, applied: [],
      errors: [`Audit entry is not an apply action (toolName=${original.toolName}).`],
      auditId: null, rescanned: false,
    };
  }

  const args = original.toolArgs as unknown as ApplyToolArgs | null;
  const appliedFields = Array.isArray(args?.appliedFields) ? args!.appliedFields : [];
  if (appliedFields.length === 0) {
    return {
      ok: false, code: "NO_FIELDS", productId: args?.productId ?? null, applied: [],
      errors: ["Original apply row is missing field-level history; cannot replay an undo."],
      auditId: null, rescanned: false,
    };
  }

  // ── 2) Reject if this apply has already been undone ─────────────────────
  // Detected by looking for any later audit row with toolName=undo and
  // matching originalAuditId in toolArgs.
  const laterUndo = await db.execute(sql`
    SELECT id FROM audit_logs
    WHERE organization_id = ${opts.organizationId}
      AND tool_name        = ${UNDO_TOOL_NAME}
      AND status           = 'applied'
      AND (tool_args->>'originalAuditId')::int = ${opts.auditId}
    LIMIT 1
  `);
  const undoRows = (laterUndo as unknown as { rows?: Array<{ id: number }> }).rows ?? [];
  if (undoRows.length > 0) {
    return {
      ok: false, code: "ALREADY_UNDONE", productId: args?.productId ?? null, applied: [],
      errors: ["This apply has already been undone."],
      auditId: null, rescanned: false,
    };
  }

  // ── 3) Resolve Shopify connection for the original org/workspace ────────
  const conn = await resolveShopifyConnection(opts.organizationId, opts.workspaceId ?? null);
  if (!conn) {
    return {
      ok: false, code: "SHOPIFY_FAILED", productId: args!.productId, applied: [],
      errors: ["No Shopify connection configured for this organization."],
      auditId: null, rescanned: false,
    };
  }

  // ── 4) Partition the inverse writes — only replay fields that landed ────
  const nativeFields:     Record<string, string> = {};
  const metafieldChanges: Array<{ field: string; value: string }> = [];
  const intent: Array<{ field: string; target: "product" | "metafield" }> = [];
  for (const f of appliedFields) {
    if (!f.ok) continue; // never wrote, nothing to undo
    if (f.target === "product") {
      const native = NATIVE_FIELD_MAP[f.field];
      if (!native) continue;
      nativeFields[native] = asString(f.before);
    } else {
      metafieldChanges.push({ field: f.field, value: asString(f.before) });
    }
    intent.push({ field: f.field, target: f.target });
  }

  if (intent.length === 0) {
    return {
      ok: false, code: "NO_FIELDS", productId: args!.productId, applied: [],
      errors: ["Original apply wrote no fields successfully — nothing to undo."],
      auditId: null, rescanned: false,
    };
  }

  const productId = args!.productId;
  const nativeResult = await writeProductFields(conn.shop, conn.accessToken, productId, nativeFields);
  const metafieldResults: Array<{ key: string; ok: boolean; error?: string }> = [];
  for (const { field, value } of metafieldChanges) {
    const r = await writeMetafield(conn.shop, conn.accessToken, productId, field, value);
    metafieldResults.push({ key: field, ...r });
  }

  const applied: AppliedFieldResult[] = intent.map((i) => {
    if (i.target === "product") {
      return {
        field: i.field, target: "product",
        ok: nativeResult.ok, error: nativeResult.ok ? undefined : nativeResult.error,
      };
    }
    const r = metafieldResults.find((m) => m.key === i.field);
    return {
      field: i.field, target: "metafield",
      ok: r?.ok ?? false, error: r?.ok ? undefined : r?.error,
    };
  });

  const errors = applied.filter((a) => !a.ok).map((a) => `${a.field}: ${a.error ?? "unknown"}`);
  const ok = errors.length === 0;

  // ── 5) Mirror reverted native field values onto the warehouse row ───────
  if (ok || nativeResult.ok) {
    const updates: Partial<WarehouseShopifyProduct> = { syncedAt: new Date() };
    if (nativeFields.title     !== undefined) updates.title       = nativeFields.title;
    if (nativeFields.body_html !== undefined) updates.description = nativeFields.body_html;
    try {
      // tenant-ownership-skip: we re-resolve the warehouse row id from the
      // original apply's fixId, which was tenant-scoped at apply time.
      await db.update(warehouseShopifyProducts)
        .set(updates)
        .where(eq(warehouseShopifyProducts.id, args!.fixId));
    } catch (err) {
      log.warn({ err }, "Failed to mirror undone fix onto warehouse row (non-fatal)");
    }
  }

  // ── 6) Audit log row for the undo ────────────────────────────────────────
  let auditId: number | null = null;
  try {
    const displayDiff = appliedFields.filter((f) => f.ok).map((f) => ({
      label: f.field,
      from:  previewValue(f.after),   // we are reverting the "after" → "before"
      to:    previewValue(f.before),
    }));
    const [row] = await db.insert(auditLogs).values({
      organizationId:  opts.organizationId,
      platform:        APPLY_PLATFORM,
      platformLabel:   "Shopify",
      toolName:        UNDO_TOOL_NAME,
      toolDisplayName: `Undo quality fix on Shopify product ${productId}`,
      toolArgs: {
        originalAuditId: opts.auditId,
        fixId:           args!.fixId,
        productId,
        sku:             args!.sku,
        applied,
        undoneBy: opts.user
          ? { id: opts.user.id, name: opts.user.name, role: opts.user.role }
          : null,
      },
      displayDiff,
      result: {
        success: ok,
        message: ok
          ? `Reverted ${applied.length} field(s) on Shopify`
          : `Reverted ${applied.length - errors.length}/${applied.length} field(s); ${errors.length} failed`,
      },
      status: ok ? "applied" : "failed",
    }).returning({ id: auditLogs.id });
    auditId = row?.id ?? null;
  } catch (err) {
    log.warn({ err }, "Failed to write audit_logs row for quality-fix undo (non-fatal)");
  }

  // ── 7) Re-scan the product ───────────────────────────────────────────────
  let rescanned = false;
  try {
    const res = await rescanProductsByIds([args!.fixId]);
    rescanned = !res.skipped;
  } catch (err) {
    log.warn({ err }, "Post-undo rescan failed (non-fatal — cron will retry)");
  }

  let code: UndoOutcomeCode;
  if (ok) {
    code = "OK";
  } else if (applied.some((a) => a.ok)) {
    code = "SHOPIFY_PARTIAL";
  } else {
    code = "SHOPIFY_FAILED";
  }
  return { ok, code, productId, applied, errors, auditId, rescanned };
}

// ─── Bulk apply ──────────────────────────────────────────────────────────────
// Applies a list of cached quality fixes back to Shopify in a single user
// action. Rows are processed sequentially so the shared `shopifyRateLimiter`
// (token bucket above) keeps us safely under Shopify's Admin API throttle
// even on a 50-row "Apply selected" click.
//
// `onProgress` (if supplied) is invoked for every row as soon as its result
// is known — the route handler streams these out as NDJSON so the UI can
// show per-row progress without polling.

export interface ApplyQualityFixesBulkOptions {
  fixIds:         string[];
  organizationId: number;
  workspaceId?:   number | null;
  user?: { id: number | null; name: string | null; role: string | null } | null;
}

export interface BulkRowProgress {
  fixId:  string;
  index:  number;     // 0-based position in the input list
  total:  number;     // total rows being processed
  result: ApplyQualityFixResult;
}

export interface ApplyQualityFixesBulkSummary {
  total:     number;
  succeeded: number;  // result.ok === true
  partial:   number;  // some fields wrote, others didn't
  failed:    number;  // every field failed
  results:   ApplyQualityFixResult[];
}

export async function applyQualityFixesToShopifyBulk(
  opts: ApplyQualityFixesBulkOptions,
  onProgress?: (p: BulkRowProgress) => void | Promise<void>,
): Promise<ApplyQualityFixesBulkSummary> {
  // De-dup so a noisy UI selection doesn't double-apply (and double-charge
  // the throttle for) the same row.
  const ids = Array.from(new Set(opts.fixIds));
  const total = ids.length;

  const results: ApplyQualityFixResult[] = [];
  let succeeded = 0;
  let partial   = 0;
  let failed    = 0;

  for (let i = 0; i < ids.length; i++) {
    const fixId = ids[i];
    let result: ApplyQualityFixResult;
    try {
      result = await applyQualityFixToShopify({
        fixId,
        organizationId: opts.organizationId,
        workspaceId:    opts.workspaceId ?? null,
        user:           opts.user ?? null,
      });
    } catch (err) {
      result = {
        ok:        false,
        productId: fixId,
        applied:   [],
        errors:    [`Worker error — ${String(err)}`],
        auditId:   null,
        rescanned: false,
      };
    }
    results.push(result);
    if (result.ok)                              succeeded += 1;
    else if (result.applied.some((a) => a.ok))  partial   += 1;
    else                                        failed    += 1;

    if (onProgress) {
      try {
        await onProgress({ fixId, index: i, total, result });
      } catch {
        // Progress consumer errors must not abort the bulk run.
      }
    }
  }

  return { total, succeeded, partial, failed, results };
}
