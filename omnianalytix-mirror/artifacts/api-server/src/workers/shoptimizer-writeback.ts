/**
 * Shoptimizer → Merchant Center Write-Back Worker
 * ───────────────────────────────────────────────
 * Takes diffs that have already been approved (via the Approval Queue —
 * `proposed_tasks` rows with toolName `gmc_applyShoptimizerDiff` and
 * status `approved`) and pushes the optimized payload back into Google
 * Merchant Center via the Content API `products.update` endpoint.
 *
 * Design constraints (from task #19):
 *   • Worker fetches fresh GMC creds via the existing token-refresh helper.
 *   • Every PATCH writes a per-product entry to `audit_logs` (mutation log)
 *     so the activity trail records WHAT was sent, by WHOM, and the result.
 *   • Per-product 4xx / 429 / 5xx failures are surfaced with a `retry`
 *     descriptor explaining whether the caller should retry, and after how
 *     long. We deliberately do NOT silently swallow upstream errors.
 *   • The proposed_tasks row is moved from `approved` → `applied` (success)
 *     or `failed` (terminal write error) so the queue reflects reality.
 *
 * This worker is invoked by `POST /api/feed-enrichment/writeback/run`
 * (fire-and-forget, like feed-enrichment) but is also exported so other
 * server code can drive it directly.
 */
import {
  db,
  proposedTasks,
  auditLogs,
  workspaces,
  type ProposedTask,
} from "@workspace/db";
import { eq, and, inArray, lte, isNotNull, sql } from "drizzle-orm";
import { fetchWithBackoff } from "../lib/fetch-utils";
import { getFreshGoogleCredentials } from "../lib/google-token-refresh";
import { logger } from "../lib/logger";
import type { MerchantProduct } from "../lib/shoptimizer-client";

export const SHOPTIMIZER_WRITEBACK_TOOL = "gmc_applyShoptimizerDiff";
export const SHOPTIMIZER_WRITEBACK_PLATFORM = "gmc";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApprovedDiffPayload {
  /** GMC offer id — also used as the products.update path id. */
  offerId: string;
  /** Full optimized product payload returned by Shoptimizer. */
  optimized: MerchantProduct;
  /** Original product (pre-optimization) for audit/diff display. */
  original?: MerchantProduct;
  /** Plugins that fired during optimization (audit context). */
  pluginsFired?: string[];
  /** List of changed field names (display diff). */
  changedFields?: string[];
  /** Optional override — defaults to credentials.merchantId. */
  merchantId?: string;
}

export type RetryClass =
  | "none"           // succeeded
  | "non_retryable"  // 4xx product validation error — fix payload first
  | "auth"           // 401 — token rejected, ask user to re-auth
  | "quota"          // 403 dailyLimitExceeded / 429 — back off and retry
  | "transient";     // 5xx — retry with exponential backoff

export interface RetryGuidance {
  retryClass: RetryClass;
  retryable: boolean;
  retryAfterSec: number | null;
  hint: string;
}

export interface WritebackItemResult {
  taskId: number;
  offerId: string;
  ok: boolean;
  httpStatus: number | null;
  message: string;
  retry: RetryGuidance;
}

export interface WritebackRunResult {
  totalRequested: number;
  totalApplied: number;
  totalFailed: number;
  results: WritebackItemResult[];
}

export interface WritebackRunOptions {
  organizationId: number;
  /** Restrict to specific approved task ids; omit to drain everything approved. */
  taskIds?: number[];
  /** Fallback merchant id when individual diffs don't carry one. */
  merchantId?: string;
  /** Approving user (for audit attribution). */
  approvedBy?: { id: number | string; name: string; role: string } | null;
  /** Concurrency cap for parallel PATCHes. Default: 4. */
  concurrency?: number;
  /** Test seam — defaults to global fetch via fetchWithBackoff. */
  patchProduct?: PatchProductFn;
}

// ─── HTTP wrapper (test-seamed) ───────────────────────────────────────────────

export type PatchProductFn = (args: {
  merchantId: string;
  offerId: string;
  body: MerchantProduct;
  accessToken: string;
}) => Promise<{ status: number; body: string; headers: Headers }>;

const defaultPatchProduct: PatchProductFn = async ({
  merchantId,
  offerId,
  body,
  accessToken,
}) => {
  // Content API for Shopping v2.1: products.update accepts PATCH on the
  // canonical product resource. We pass the full optimized payload — the
  // upstream service merges it onto the existing record.
  const url = `https://shoppingcontent.googleapis.com/content/v2.1/${encodeURIComponent(
    merchantId,
  )}/products/${encodeURIComponent(offerId)}`;
  const resp = await fetchWithBackoff(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    tag: "gmc-writeback-products-update",
    // We classify retryability ourselves; let upstream backoff handle 5xx
    // network blips.
    maxRetries: 2,
  });
  return { status: resp.status, body: await resp.text(), headers: resp.headers };
};

// ─── Failure classification ───────────────────────────────────────────────────

export function classifyWritebackFailure(
  status: number,
  rawBody: string,
  headers?: Headers,
): RetryGuidance {
  // Try to extract a structured reason from the Content API error envelope:
  //   { "error": { "code": 403, "message": "...", "errors": [{ "reason": "dailyLimitExceeded" }] } }
  let reason = "";
  try {
    const parsed = JSON.parse(rawBody) as {
      error?: { errors?: Array<{ reason?: string }>; message?: string };
    };
    reason =
      parsed?.error?.errors?.find((e) => e?.reason)?.reason ??
      parsed?.error?.message ??
      "";
  } catch {
    // body wasn't JSON — fall back to raw text in the hint
  }
  const reasonLc = reason.toLowerCase();

  if (status === 401) {
    return {
      retryClass: "auth",
      retryable: false,
      retryAfterSec: null,
      hint: "Merchant Center rejected the access token. Reconnect Google Merchant Center under Integrations to mint a fresh refresh token, then retry.",
    };
  }

  // Quota / rate-limit: usually 429, but Content API sometimes returns 403
  // with reason `dailyLimitExceeded` / `userRateLimitExceeded`.
  const looksLikeQuota =
    status === 429 ||
    reasonLc.includes("ratelimit") ||
    reasonLc.includes("dailylimitexceeded") ||
    reasonLc.includes("quotaexceeded") ||
    reasonLc.includes("userratelimitexceeded");
  if (looksLikeQuota) {
    const retryAfterHeader = headers?.get("retry-after");
    const retryAfterSec =
      retryAfterHeader && /^\d+$/.test(retryAfterHeader)
        ? Number(retryAfterHeader)
        : 60;
    return {
      retryClass: "quota",
      retryable: true,
      retryAfterSec,
      hint: `Merchant Center quota hit (${reason || "rate limit"}). Retry after ${retryAfterSec}s, or spread the batch over a longer window.`,
    };
  }

  if (status >= 500) {
    return {
      retryClass: "transient",
      retryable: true,
      retryAfterSec: 30,
      hint: `Merchant Center returned ${status}. This is usually a transient upstream error — retry in ~30s.`,
    };
  }

  if (status >= 400) {
    return {
      retryClass: "non_retryable",
      retryable: false,
      retryAfterSec: null,
      hint: `Merchant Center rejected the payload (${status}${reason ? ` ${reason}` : ""}). Fix the diff before re-approving — retrying as-is will fail again.`,
    };
  }

  return {
    retryClass: "none",
    retryable: false,
    retryAfterSec: null,
    hint: "OK",
  };
}

// ─── Worker entry point ───────────────────────────────────────────────────────

export async function runShoptimizerWriteback(
  opts: WritebackRunOptions,
): Promise<WritebackRunResult> {
  const {
    organizationId,
    taskIds,
    merchantId: fallbackMerchantId,
    approvedBy,
    concurrency = 4,
    patchProduct = defaultPatchProduct,
  } = opts;
  const log = logger.child({ worker: "shoptimizer-writeback", organizationId });

  // SECURITY: every read of proposed_tasks must be scoped to the caller's
  // organization. Without this, a caller could pass arbitrary taskIds that
  // belong to another tenant and force this worker to PATCH GMC and flip
  // the row's state on their behalf. Workspace-less rows (workspaceId IS
  // NULL) are deliberately excluded — the writeback enqueue endpoint
  // always sets a workspaceId from the authenticated user.
  const orgScope = sql`${proposedTasks.workspaceId} IN (SELECT id FROM workspaces WHERE organization_id = ${organizationId})`;
  const baseConditions = [
    eq(proposedTasks.toolName, SHOPTIMIZER_WRITEBACK_TOOL),
    eq(proposedTasks.status, "approved"),
    orgScope,
  ];
  const candidates: ProposedTask[] =
    taskIds && taskIds.length > 0
      ? await db
          .select()
          .from(proposedTasks)
          .where(and(inArray(proposedTasks.id, taskIds), ...baseConditions))
      : await db.select().from(proposedTasks).where(and(...baseConditions));

  if (candidates.length === 0) {
    return { totalRequested: 0, totalApplied: 0, totalFailed: 0, results: [] };
  }

  // Fetch fresh GMC credentials once for the whole batch.
  const creds = await getFreshGoogleCredentials("gmc", organizationId);
  if (!creds || !creds.accessToken) {
    // Mark every task as failed with an auth-class retry hint.
    const guidance: RetryGuidance = {
      retryClass: "auth",
      retryable: false,
      retryAfterSec: null,
      hint: "Google Merchant Center is not connected for this organization. Connect it under Integrations before retrying.",
    };
    const results: WritebackItemResult[] = [];
    for (const task of candidates) {
      const offerId = readOfferId(task);
      await markTaskFailed(task.id, "GMC not connected", guidance);
      await writeAuditLog({
        organizationId,
        task,
        offerId,
        status: "failed",
        result: { success: false, message: guidance.hint },
        approvedBy,
        retry: guidance,
        httpStatus: null,
      });
      results.push({
        taskId: task.id,
        offerId,
        ok: false,
        httpStatus: null,
        message: guidance.hint,
        retry: guidance,
      });
    }
    log.warn({ count: candidates.length }, "GMC not connected — wrote failure audit for every task");
    return {
      totalRequested: candidates.length,
      totalApplied: 0,
      totalFailed: candidates.length,
      results,
    };
  }

  const results: WritebackItemResult[] = new Array(candidates.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, 8)) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= candidates.length) return;
      const task = candidates[i]!;
      results[i] = await applyOne(task, {
        organizationId,
        creds,
        fallbackMerchantId,
        approvedBy,
        patchProduct,
        log,
      });
    }
  });
  await Promise.all(workers);

  const totalApplied = results.filter((r) => r.ok).length;
  return {
    totalRequested: results.length,
    totalApplied,
    totalFailed: results.length - totalApplied,
    results,
  };
}

// ─── Per-task application ─────────────────────────────────────────────────────

interface ApplyContext {
  organizationId: number;
  creds: Record<string, string>;
  fallbackMerchantId?: string;
  approvedBy?: WritebackRunOptions["approvedBy"];
  patchProduct: PatchProductFn;
  log: typeof logger;
}

async function applyOne(
  task: ProposedTask,
  ctx: ApplyContext,
): Promise<WritebackItemResult> {
  const args = (task.toolArgs ?? {}) as Record<string, unknown>;
  const offerId = readOfferId(task);
  const optimized = (args.optimized ?? args.optimizedProduct) as MerchantProduct | undefined;
  const merchantId =
    (args.merchantId as string | undefined) ??
    ctx.fallbackMerchantId ??
    ctx.creds.merchantId;

  if (!optimized || !optimized.offerId) {
    const guidance: RetryGuidance = {
      retryClass: "non_retryable",
      retryable: false,
      retryAfterSec: null,
      hint: "Approved task is missing its `optimized` payload — re-enqueue from a fresh Shoptimizer run.",
    };
    await markTaskFailed(task.id, guidance.hint, guidance);
    await writeAuditLog({
      organizationId: ctx.organizationId,
      task,
      offerId,
      status: "failed",
      result: { success: false, message: guidance.hint },
      approvedBy: ctx.approvedBy,
      retry: guidance,
      httpStatus: null,
    });
    return { taskId: task.id, offerId, ok: false, httpStatus: null, message: guidance.hint, retry: guidance };
  }

  if (!merchantId) {
    const guidance: RetryGuidance = {
      retryClass: "non_retryable",
      retryable: false,
      retryAfterSec: null,
      hint: "No GMC merchant id available. Set it on the connection or pass `merchantId` per diff.",
    };
    await markTaskFailed(task.id, guidance.hint, guidance);
    await writeAuditLog({
      organizationId: ctx.organizationId,
      task,
      offerId,
      status: "failed",
      result: { success: false, message: guidance.hint },
      approvedBy: ctx.approvedBy,
      retry: guidance,
      httpStatus: null,
    });
    return { taskId: task.id, offerId, ok: false, httpStatus: null, message: guidance.hint, retry: guidance };
  }

  let httpStatus: number | null = null;
  let body = "";
  let headers: Headers | undefined;
  try {
    const resp = await ctx.patchProduct({
      merchantId,
      offerId,
      body: optimized,
      accessToken: ctx.creds.accessToken,
    });
    httpStatus = resp.status;
    body = resp.body;
    headers = resp.headers;
  } catch (err) {
    const guidance: RetryGuidance = {
      retryClass: "transient",
      retryable: true,
      retryAfterSec: 30,
      hint: `Network error contacting Merchant Center: ${err instanceof Error ? err.message : String(err)}. Retry shortly.`,
    };
    await markTaskFailed(task.id, guidance.hint, guidance);
    await writeAuditLog({
      organizationId: ctx.organizationId,
      task,
      offerId,
      status: "failed",
      result: { success: false, message: guidance.hint },
      approvedBy: ctx.approvedBy,
      retry: guidance,
      httpStatus: null,
    });
    ctx.log.warn({ err, offerId, taskId: task.id }, "writeback: network failure");
    return { taskId: task.id, offerId, ok: false, httpStatus: null, message: guidance.hint, retry: guidance };
  }

  if (httpStatus >= 200 && httpStatus < 300) {
    const guidance: RetryGuidance = {
      retryClass: "none",
      retryable: false,
      retryAfterSec: null,
      hint: "OK",
    };
    await markTaskApplied(task.id, `Applied ${task.toolDisplayName}`);
    await writeAuditLog({
      organizationId: ctx.organizationId,
      task,
      offerId,
      status: "executed",
      result: { success: true, message: `Patched ${offerId} (${httpStatus})` },
      approvedBy: ctx.approvedBy,
      retry: guidance,
      httpStatus,
    });
    return {
      taskId: task.id,
      offerId,
      ok: true,
      httpStatus,
      message: `Patched ${offerId}`,
      retry: guidance,
    };
  }

  const guidance = classifyWritebackFailure(httpStatus, body, headers);
  const message = `GMC products.update failed (HTTP ${httpStatus}): ${truncate(body, 240)}`;
  await markTaskFailed(task.id, message, guidance);
  await writeAuditLog({
    organizationId: ctx.organizationId,
    task,
    offerId,
    status: "failed",
    result: { success: false, message },
    approvedBy: ctx.approvedBy,
    retry: guidance,
    httpStatus,
  });
  ctx.log.warn({ taskId: task.id, offerId, httpStatus, retryClass: guidance.retryClass }, "writeback: non-2xx");
  return { taskId: task.id, offerId, ok: false, httpStatus, message, retry: guidance };
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

function readOfferId(task: ProposedTask): string {
  const args = (task.toolArgs ?? {}) as Record<string, unknown>;
  const fromOptimized =
    ((args.optimized as MerchantProduct | undefined) ?? (args.optimizedProduct as MerchantProduct | undefined))?.offerId;
  return (
    (args.offerId as string | undefined) ??
    fromOptimized ??
    "<unknown>"
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

async function markTaskApplied(taskId: number, comment: string): Promise<void> {
  await db
    .update(proposedTasks)
    .set({ status: "applied", comments: comment, resolvedAt: new Date() })
    .where(eq(proposedTasks.id, taskId));
}

/** Bound on auto-retry attempts. Once a task hits this many failures we
 *  stop scheduling it and require a human to look at it. Exposed so callers
 *  (and the scheduler) can read the same number consistently. */
export const WRITEBACK_MAX_ATTEMPTS = 5;

async function markTaskFailed(
  taskId: number,
  comment: string,
  retry?: RetryGuidance,
): Promise<void> {
  // Compute retry scheduling. We only set `next_retry_at` for retryable
  // classes (transient/quota) AND while we're still under the attempt cap.
  // Auth / non_retryable failures clear `next_retry_at` so the scheduler
  // never picks them up.
  const updates: Record<string, unknown> = {
    status: "failed",
    comments: comment,
    resolvedAt: new Date(),
  };
  if (retry) {
    updates.lastRetryClass = retry.retryClass;
    // Increment attempt_count atomically (we're running this under one row).
    updates.attemptCount = sql`${proposedTasks.attemptCount} + 1`;
    if (retry.retryable) {
      // Schedule the next attempt only if we won't exceed the cap. Because
      // attempt_count is being incremented in this same statement, "current
      // attempts after this update" === attempt_count + 1 (pre-update value).
      updates.nextRetryAt = sql`CASE WHEN ${proposedTasks.attemptCount} + 1 < ${WRITEBACK_MAX_ATTEMPTS}
        THEN NOW() + (${retry.retryAfterSec ?? 30} || ' seconds')::interval
        ELSE NULL END`;
    } else {
      updates.nextRetryAt = null;
    }
  }
  await db
    .update(proposedTasks)
    .set(updates)
    .where(eq(proposedTasks.id, taskId));
}

interface AuditArgs {
  organizationId: number;
  task: ProposedTask;
  offerId: string;
  status: "executed" | "failed";
  result: { success: boolean; message: string };
  approvedBy: WritebackRunOptions["approvedBy"];
  retry: RetryGuidance;
  httpStatus: number | null;
}

async function writeAuditLog(a: AuditArgs): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      organizationId: a.organizationId,
      platform: SHOPTIMIZER_WRITEBACK_PLATFORM,
      platformLabel: "Google Merchant Center",
      toolName: SHOPTIMIZER_WRITEBACK_TOOL,
      toolDisplayName: a.task.toolDisplayName || "Apply Shoptimizer fix to GMC",
      toolArgs: {
        offerId: a.offerId,
        proposedTaskId: a.task.id,
        approvedBy: a.approvedBy ?? null,
        httpStatus: a.httpStatus,
        retry: a.retry,
        sourceArgs: a.task.toolArgs,
      },
      displayDiff: (a.task.displayDiff as Array<{ label: string; from: string; to: string }>) ?? undefined,
      result: a.result,
      status: a.status,
    });
  } catch (err) {
    logger.error({ err, taskId: a.task.id }, "shoptimizer-writeback: failed to write audit log");
  }
}

// ─── Retry scheduler ──────────────────────────────────────────────────────────
//
// Finds failed-but-retryable tasks whose `next_retry_at` window has passed,
// re-flips them to `approved`, and hands them back to `runShoptimizerWriteback`
// for another attempt. Only `transient` and `quota` retry classes are eligible.
// Non-retryable classes (auth, non_retryable) never get a `next_retry_at` so
// they are naturally excluded from the query.
//
// Concurrency safety: the status flip (failed → approved) uses an atomic WHERE
// clause so two concurrent scheduler invocations can't double-pick the same task.

export interface RetrySchedulerResult {
  /** Number of distinct organizations that had eligible tasks. */
  organizationsProcessed: number;
  /** Total tasks re-queued for a retry attempt. */
  totalRequeued: number;
  /** Total tasks that succeeded on this retry pass. */
  totalApplied: number;
  /** Total tasks that failed again (may be re-queued for another attempt if still under cap). */
  totalFailed: number;
}

export async function runWritebackRetryScheduler(
  opts: {
    /** Caller-supplied test seam for the HTTP PATCH. */
    patchProduct?: PatchProductFn;
    /** Override the maximum attempt cap (useful in tests). Default: WRITEBACK_MAX_ATTEMPTS. */
    maxAttempts?: number;
  } = {},
): Promise<RetrySchedulerResult> {
  const { patchProduct, maxAttempts = WRITEBACK_MAX_ATTEMPTS } = opts;
  const log = logger.child({ worker: "shoptimizer-writeback-retry-scheduler" });

  // 1. Find every failed task whose retry window has elapsed and that has not
  //    yet hit the attempt cap.  We include only rows with a non-null
  //    `next_retry_at` — non-retryable failures never get one set.
  const now = new Date();
  const eligible = await db
    .select({
      taskId: proposedTasks.id,
      workspaceId: proposedTasks.workspaceId,
      organizationId: workspaces.organizationId,
      attemptCount: proposedTasks.attemptCount,
    })
    .from(proposedTasks)
    .innerJoin(workspaces, eq(workspaces.id, proposedTasks.workspaceId))
    .where(
      and(
        eq(proposedTasks.toolName, SHOPTIMIZER_WRITEBACK_TOOL),
        eq(proposedTasks.status, "failed"),
        isNotNull(proposedTasks.nextRetryAt),
        lte(proposedTasks.nextRetryAt, now),
        sql`${proposedTasks.attemptCount} < ${maxAttempts}`,
      ),
    );

  if (eligible.length === 0) {
    log.debug("retry-scheduler: no eligible tasks");
    return { organizationsProcessed: 0, totalRequeued: 0, totalApplied: 0, totalFailed: 0 };
  }

  // 2. Atomically flip eligible tasks back to `approved` so the main worker
  //    can pick them up.  Only tasks still in `failed` state get flipped;
  //    this prevents a race if two scheduler instances run concurrently.
  const eligibleIds = eligible.map((r) => r.taskId);
  await db
    .update(proposedTasks)
    .set({
      status: "approved",
      nextRetryAt: null,
      comments: sql`${proposedTasks.comments} || ' [auto-retry scheduled]'`,
    })
    .where(
      and(
        inArray(proposedTasks.id, eligibleIds),
        eq(proposedTasks.status, "failed"),
      ),
    );

  log.info({ count: eligible.length }, "retry-scheduler: re-queued tasks to approved");

  // 3. Group by organization so we can re-use credentials per-org.
  const byOrg = new Map<number, number[]>();
  for (const row of eligible) {
    if (row.organizationId == null) continue;
    const ids = byOrg.get(row.organizationId) ?? [];
    ids.push(row.taskId);
    byOrg.set(row.organizationId, ids);
  }

  let totalApplied = 0;
  let totalFailed = 0;
  let totalRequeued = 0;

  for (const [organizationId, taskIds] of byOrg) {
    totalRequeued += taskIds.length;
    const result = await runShoptimizerWriteback({
      organizationId,
      taskIds,
      patchProduct,
    });
    totalApplied += result.totalApplied;
    totalFailed += result.totalFailed;
    log.info(
      { organizationId, applied: result.totalApplied, failed: result.totalFailed },
      "retry-scheduler: writeback run complete for org",
    );
  }

  return {
    organizationsProcessed: byOrg.size,
    totalRequeued,
    totalApplied,
    totalFailed,
  };
}
