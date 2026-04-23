import { Router } from "express";
import { eq, and, desc, sql, count, isNull } from "drizzle-orm";
import { db, stateSnapshots, auditLogs, platformConnections, executionLogs, promoTriggers } from "@workspace/db";
import { dispatchToolCall } from "../../lib/gemini-tools";
import { logger } from "../../lib/logger";
import { getFreshGoogleCredentials } from "../../lib/google-token-refresh";
import { decryptCredentials } from "../../lib/credential-helpers";
import { requireRole, getOrgId } from "../../middleware/rbac";
import { parsePagination, paginatedResponse } from "../../lib/pagination";
import { emitTriageClear } from "../../lib/triage-emitter";

function computeRevertPayload(
  toolName: string,
  forwardArgs: Record<string, unknown>,
  snapshotData: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!snapshotData) return null;
  switch (toolName) {
    case "googleAds_updateCampaignBudget":
      if (snapshotData.previousBudgetMicros != null)
        return { campaignBudgetId: forwardArgs.campaignBudgetId, newDailyBudgetUsd: Number(snapshotData.previousBudgetMicros) / 1_000_000 };
      break;
    case "googleAds_updateCampaignStatus":
      if (snapshotData.previousStatus)
        return { campaignId: forwardArgs.campaignId, status: snapshotData.previousStatus };
      break;
    case "googleAds_updateCampaignBidding":
      if (snapshotData.previousBiddingStrategy != null)
        return { campaignId: forwardArgs.campaignId, biddingStrategy: snapshotData.previousBiddingStrategy, targetValue: snapshotData.previousTargetValue };
      break;
    case "shopify_updateVariantPrice":
      if (snapshotData.previousPrice != null)
        return { variantId: forwardArgs.variantId, price: Number(snapshotData.previousPrice) };
      break;
    case "shopify_updateProductStatus":
      if (snapshotData.previousStatus != null)
        return { productId: forwardArgs.productId, status: snapshotData.previousStatus };
      break;
    case "meta_updateObjectStatus":
      if (snapshotData.previousStatus != null)
        return { objectId: forwardArgs.objectId, status: snapshotData.previousStatus };
      break;
    case "meta_updateAdSetBudget":
      if (snapshotData.previousBudget != null)
        return { adSetId: forwardArgs.adSetId, dailyBudget: Number(snapshotData.previousBudget) };
      break;
  }
  return null;
}

const router = Router();

router.get("/pending", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    // sql-ambiguous-skip: bare `organization_id` is unambiguous inside the
    // single-table subquery `SELECT id FROM conversations WHERE …`.
    const pendingFilter = orgId
      ? and(
          eq(stateSnapshots.status, "pending"),
          sql`${stateSnapshots.conversationId} IN (SELECT id FROM conversations WHERE organization_id = ${orgId})`,
        )
      : eq(stateSnapshots.status, "pending");
    const { page, pageSize, offset } = parsePagination(req.query as Record<string, unknown>);
    const [totalRow] = await db
      .select({ c: sql<number>`COUNT(*)::int` })
      .from(stateSnapshots)
      .where(pendingFilter);
    const totalCount = totalRow?.c ?? 0;
    const rows = await db
      .select()
      .from(stateSnapshots)
      .where(pendingFilter)
      .orderBy(desc(stateSnapshots.createdAt))
      .limit(pageSize)
      .offset(offset);

    // ── Merge pending promo triggers into the queue ──────────────────────────
    let promoItems: unknown[] = [];
    try {
      const { formatTriggerAsApprovalCard } = await import("../promo-engine/index");
      const promoFilter = orgId != null
        ? and(eq(promoTriggers.status, "pending"), eq(promoTriggers.organizationId, orgId))
        : eq(promoTriggers.status, "pending");
      const pendingPromo = await db.select().from(promoTriggers).where(promoFilter).orderBy(desc(promoTriggers.triggeredAt)).limit(20);
      promoItems = pendingPromo.map(formatTriggerAsApprovalCard);
    } catch (_promoErr) { /* promo engine unavailable — non-fatal */ }

    res.json({ ...paginatedResponse(rows, totalCount, page, pageSize), promoItems });
  } catch (err) {
    logger.error({ err }, "Failed to list pending actions");
    res.status(500).json({ error: "Failed to list pending actions" });
  }
});

router.get("/audit", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    // SECURITY: audit log lookups must be tenant-scoped; missing orgId returns nothing.
    const orgFilter = orgId ? eq(auditLogs.organizationId, orgId) : sql`1=0`;
    const { page, pageSize, offset } = parsePagination(req.query as Record<string, unknown>);
    const [totalRow] = await db.select({ c: sql<number>`COUNT(*)::int` }).from(auditLogs).where(orgFilter);
    const totalCount = totalRow?.c ?? 0;
    const rows = await db.select().from(auditLogs).where(orgFilter).orderBy(desc(auditLogs.createdAt)).limit(pageSize).offset(offset);
    res.json(paginatedResponse(rows, totalCount, page, pageSize));
  } catch (err) {
    logger.error({ err }, "Failed to list audit log");
    res.status(500).json({ error: "Failed to list audit log" });
  }
});

// GET /api/actions/audit/:id — fetch a single audit log entry by id (tenant-scoped)
router.get("/audit/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const orgId = getOrgId(req);
    const orgFilter = orgId ? eq(auditLogs.organizationId, orgId) : sql`1=0`;
    const [row] = await db.select().from(auditLogs).where(
      and(orgFilter, eq(auditLogs.id, id)),
    );
    if (!row) { res.status(404).json({ error: "Audit entry not found" }); return; }
    res.json(row);
  } catch (err) {
    logger.error({ err }, "Failed to fetch audit log entry");
    res.status(500).json({ error: "Failed to fetch audit log entry" });
  }
});

// POST /api/actions/:id/approve — execute the tool and log it
router.post("/:id/approve", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const { organizations } = await import("@workspace/db");
    const [org] = await db.select().from(organizations).where(eq(organizations.slug, "default"));
    const tier = org?.subscriptionTier ?? "free";
    if (tier === "free") {
      res.status(403).json({ error: "Pro subscription required to execute actions.", code: "UPGRADE_REQUIRED" });
      return;
    }

    const orgId = getOrgId(req);
    // sql-ambiguous-skip: single-table subquery on `conversations`, unambiguous.
    const snapshotFilter = orgId
      ? and(eq(stateSnapshots.id, id), sql`${stateSnapshots.conversationId} IN (SELECT id FROM conversations WHERE organization_id = ${orgId})`)
      : eq(stateSnapshots.id, id);
    const [snapshot] = await db.select().from(stateSnapshots).where(snapshotFilter);
    if (!snapshot) { res.status(404).json({ error: "Snapshot not found" }); return; }
    if (snapshot.status !== "pending") { res.status(409).json({ error: `Cannot approve — status is '${snapshot.status}'` }); return; }

    // Load credentials for this platform, refreshing Google access tokens if needed
    const connConditions = [eq(platformConnections.platform, snapshot.platform)];
    connConditions.push(orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId));
    const [conn] = await db.select().from(platformConnections).where(and(...connConditions));
    if (!conn) {
      res.status(400).json({ error: `Platform '${snapshot.platform}' not connected.` });
      return;
    }
    const googlePlatforms = ["google_ads", "gmc", "gsc", "youtube", "google_sheets"];
    const freshCreds = googlePlatforms.includes(snapshot.platform)
      ? (await getFreshGoogleCredentials(snapshot.platform, orgId)) ?? decryptCredentials(conn.credentials as Record<string, string>)
      : decryptCredentials(conn.credentials as Record<string, string>);
    const credentialsByPlatform: Record<string, Record<string, string>> = {
      [snapshot.platform]: freshCreds,
    };

    const forwardArgs = snapshot.toolArgs as Record<string, unknown>;
    const snapshotData = snapshot.snapshotData as Record<string, unknown> | null;
    const revertPayload = computeRevertPayload(snapshot.toolName, forwardArgs, snapshotData);

    const result = await dispatchToolCall(snapshot.toolName, forwardArgs, credentialsByPlatform, { bypassQueue: true });

    await db.update(stateSnapshots)
      .set({ status: result.success ? "executed" : "failed", executionResult: result, resolvedAt: new Date() })
      .where(eq(stateSnapshots.id, id));

    const rbacUser = req.rbacUser;
    await db.insert(auditLogs).values({
      organizationId: orgId ?? undefined,
      conversationId: snapshot.conversationId,
      snapshotId: snapshot.id,
      platform: snapshot.platform,
      platformLabel: snapshot.platformLabel,
      toolName: snapshot.toolName,
      toolDisplayName: snapshot.toolDisplayName,
      toolArgs: {
        ...forwardArgs,
        _approvedBy: rbacUser ? { id: rbacUser.id, name: rbacUser.name, role: rbacUser.role } : null,
      },
      displayDiff: snapshot.displayDiff as Array<{ label: string; from: string; to: string }>,
      result,
      status: result.success ? "executed" : "failed",
      // ── Insight traceability ────────────────────────────────────────────────
      // Carry the diagnostic alert ID forward from the snapshot so the audit
      // trail records WHY this action was taken, not just WHAT was done.
      // Null when action was manually proposed (not triggered from an alert).
      insightId: snapshot.sourceAlertId ?? undefined,
    });

    if (result.success) {
      try {
        await db.insert(executionLogs).values({
          workspaceId: null,
          userId: rbacUser ? String(rbacUser.id) : null,
          actionType: snapshot.toolName,
          snapshotId: snapshot.id,
          apiEndpoint: `/api/actions/${id}/approve`,
          forwardPayload: {
            ...forwardArgs,
            _approvedBy: rbacUser ? { id: rbacUser.id, name: rbacUser.name, role: rbacUser.role } : null,
          },
          revertPayload: revertPayload ?? undefined,
          status: "executed",
        });
      } catch (logErr) {
        logger.warn({ err: logErr }, "Failed to write execution log (non-fatal)");
      }
    }

    if (result.success) {
      try {
        emitTriageClear(`action-${id}`);
        emitTriageClear(snapshot.toolName);
      } catch (clearErr) {
        logger.warn({ err: clearErr }, "Failed to emit triage clear (non-fatal)");
      }
    }

    logger.info({ id, toolName: snapshot.toolName, success: result.success }, "Action approved and executed");
    res.json({ success: result.success, message: result.message, data: result.data, snapshotId: id });
  } catch (err) {
    logger.error({ err }, "Failed to approve action");
    res.status(500).json({ error: "Execution failed" });
  }
});

// POST /api/actions/:id/preview — dry-run a pending action without committing
//
// Runs the same dispatch path as /approve but with `dryRun: true`. Platform
// support:
//   • Google Ads — SDK translates dryRun into validate_only=true on the mutate
//     call. Real per-operation policy errors are returned.
//   • Meta Ads — Marketing API POST is sent with `?validate_only=true`. Field
//     validation, permission, and policy errors come back in the response.
//   • Shopify — no native validate_only, so dispatch routes to
//     shopify_dryRunValidate, which performs local schema checks plus a GET on
//     the target resource (or /shop.json for create-only tools) to prove the
//     credentials and target exist before approval.
// The snapshot stays in "pending" status so the user can still approve or
// reject it afterwards.
router.post("/:id/preview", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const orgId = getOrgId(req);
    const snapshotFilter = orgId
      // sql-ambiguous-skip: single-table subquery on `conversations`, unambiguous.
      ? and(eq(stateSnapshots.id, id), sql`${stateSnapshots.conversationId} IN (SELECT id FROM conversations WHERE organization_id = ${orgId})`)
      : eq(stateSnapshots.id, id);
    const [snapshot] = await db.select().from(stateSnapshots).where(snapshotFilter);
    if (!snapshot) { res.status(404).json({ error: "Snapshot not found" }); return; }
    if (snapshot.status !== "pending") { res.status(409).json({ error: `Cannot preview — status is '${snapshot.status}'` }); return; }

    const connConditions = [eq(platformConnections.platform, snapshot.platform)];
    connConditions.push(orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId));
    const [conn] = await db.select().from(platformConnections).where(and(...connConditions));
    if (!conn) { res.status(400).json({ error: `Platform '${snapshot.platform}' not connected.` }); return; }

    const googlePlatforms = ["google_ads", "gmc", "gsc", "youtube", "google_sheets"];
    const freshCreds = googlePlatforms.includes(snapshot.platform)
      ? (await getFreshGoogleCredentials(snapshot.platform, orgId)) ?? decryptCredentials(conn.credentials as Record<string, string>)
      : decryptCredentials(conn.credentials as Record<string, string>);

    const result = await dispatchToolCall(
      snapshot.toolName,
      snapshot.toolArgs as Record<string, unknown>,
      { [snapshot.platform]: freshCreds },
      { bypassQueue: true, dryRun: true },
    );

    logger.info({ id, toolName: snapshot.toolName, success: result.success }, "Action preview (dry-run)");
    res.json({ success: result.success, message: result.message, data: result.data, snapshotId: id, dryRun: true });
  } catch (err) {
    logger.error({ err }, "Failed to preview action");
    res.status(500).json({ error: "Preview failed" });
  }
});

// POST /api/actions/:id/reject — mark as rejected
router.post("/:id/reject", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const rejectOrgId = getOrgId(req);
    // sql-ambiguous-skip: single-table subquery on `conversations`, unambiguous.
    const rejectFilter = rejectOrgId
      ? and(eq(stateSnapshots.id, id), sql`${stateSnapshots.conversationId} IN (SELECT id FROM conversations WHERE organization_id = ${rejectOrgId})`)
      : eq(stateSnapshots.id, id);
    const [snapshot] = await db.select().from(stateSnapshots).where(rejectFilter);
    if (!snapshot) { res.status(404).json({ error: "Snapshot not found" }); return; }
    if (snapshot.status !== "pending") { res.status(409).json({ error: `Cannot reject — status is '${snapshot.status}'` }); return; }

    await db.update(stateSnapshots)
      .set({ status: "rejected", resolvedAt: new Date() })
      .where(eq(stateSnapshots.id, id));

    await db.insert(auditLogs).values({
      organizationId: rejectOrgId ?? undefined,
      conversationId: snapshot.conversationId,
      snapshotId: snapshot.id,
      platform: snapshot.platform,
      platformLabel: snapshot.platformLabel,
      toolName: snapshot.toolName,
      toolDisplayName: snapshot.toolDisplayName,
      toolArgs: snapshot.toolArgs as Record<string, unknown>,
      displayDiff: snapshot.displayDiff as Array<{ label: string; from: string; to: string }>,
      result: { success: false, message: "Rejected by user" },
      status: "rejected",
      insightId: snapshot.sourceAlertId ?? undefined,
    });

    logger.info({ id, toolName: snapshot.toolName }, "Action rejected");
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Failed to reject action");
    res.status(500).json({ error: "Failed to reject" });
  }
});

// POST /api/actions/:id/revert — restore previous state
router.post("/:id/revert", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const revertOrgId = getOrgId(req);
    // sql-ambiguous-skip: single-table subquery on `conversations`, unambiguous.
    const revertSnapshotFilter = revertOrgId
      ? and(eq(stateSnapshots.id, id), sql`${stateSnapshots.conversationId} IN (SELECT id FROM conversations WHERE organization_id = ${revertOrgId})`)
      : eq(stateSnapshots.id, id);
    const [snapshot] = await db.select().from(stateSnapshots).where(revertSnapshotFilter);
    if (!snapshot) { res.status(404).json({ error: "Snapshot not found" }); return; }
    if (snapshot.status !== "executed") { res.status(409).json({ error: `Cannot revert — status is '${snapshot.status}'` }); return; }

    // Build revert tool args from snapshot data
    const snapshotData = snapshot.snapshotData as Record<string, unknown> | null;
    const originalArgs = snapshot.toolArgs as Record<string, unknown>;
    let revertResult: { success: boolean; message: string } | null = null;

    const orgId = revertOrgId;
    const revertConnConditions = [eq(platformConnections.platform, snapshot.platform)];
    revertConnConditions.push(orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId));
    const [conn] = await db.select().from(platformConnections).where(and(...revertConnConditions));
    if (!conn) {
      res.status(400).json({ error: `Platform '${snapshot.platform}' not connected.` });
      return;
    }
    const googlePlatformsRevert = ["google_ads", "gmc", "gsc", "youtube", "google_sheets"];
    const freshCredsRevert = googlePlatformsRevert.includes(snapshot.platform)
      ? (await getFreshGoogleCredentials(snapshot.platform, orgId)) ?? decryptCredentials(conn.credentials as Record<string, string>)
      : decryptCredentials(conn.credentials as Record<string, string>);
    const credentialsByPlatform: Record<string, Record<string, string>> = {
      [snapshot.platform]: freshCredsRevert,
    };

    // Revert logic — reuse computeRevertPayload for consistency
    if (snapshotData) {
      const revertArgs = computeRevertPayload(snapshot.toolName, originalArgs, snapshotData);

      if (revertArgs) {
        revertResult = await dispatchToolCall(snapshot.toolName, revertArgs, credentialsByPlatform, { bypassQueue: true });
      }
    }

    if (!revertResult) {
      revertResult = { success: false, message: "Revert not supported for this action type — no pre-execution snapshot data was captured." };
    }

    // Update snapshot and log
    await db.update(stateSnapshots)
      .set({ status: revertResult.success ? "reverted" : "revert_failed", resolvedAt: new Date() })
      .where(eq(stateSnapshots.id, id));

    await db.insert(auditLogs).values({
      organizationId: getOrgId(req) ?? undefined,
      conversationId: snapshot.conversationId,
      snapshotId: snapshot.id,
      platform: snapshot.platform,
      platformLabel: snapshot.platformLabel,
      toolName: snapshot.toolName,
      toolDisplayName: snapshot.toolDisplayName,
      toolArgs: snapshot.toolArgs as Record<string, unknown>,
      displayDiff: snapshot.displayDiff as Array<{ label: string; from: string; to: string }>,
      result: revertResult,
      status: revertResult.success ? "reverted" : "revert_failed",
    });

    logger.info({ id, success: revertResult.success }, "Action revert attempted");
    res.json(revertResult);
  } catch (err) {
    logger.error({ err }, "Failed to revert action");
    res.status(500).json({ error: "Revert failed" });
  }
});

// PUT /api/actions/theme-settings — direct theme color update via REST
router.put("/theme-settings", requireRole("manager"), async (req, res) => {
  try {
    const { primary_color, secondary_color } = req.body as { primary_color?: string; secondary_color?: string };
    if (!primary_color) {
      return res.status(400).json({ error: "Missing required field: primary_color" });
    }

    const { db, platformConnections } = await import("@workspace/db");
    const { eq, and: drizzleAnd, isNull: drizzleIsNull } = await import("drizzle-orm");
    const { shopify_updateThemeColors } = await import("../../lib/platform-executors");

    const themeOrgId = getOrgId(req);
    const themeConditions = drizzleAnd(
      eq(platformConnections.platform, "shopify"),
      themeOrgId != null ? eq(platformConnections.organizationId, themeOrgId) : drizzleIsNull(platformConnections.organizationId),
    );
    const [conn] = await db
      .select()
      .from(platformConnections)
      .where(themeConditions)
      .limit(1);

    if (!conn) {
      return res.status(409).json({ error: "Shopify not connected. Authorize via /api/auth/shopify." });
    }

    const result = await shopify_updateThemeColors(
      decryptCredentials(conn.credentials as Record<string, string>),
      primary_color,
      secondary_color,
    );

    logger.info({ primary_color, secondary_color, success: result.success }, "Theme settings update via REST");
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    logger.error({ err }, "PUT /theme-settings failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PATCH /api/actions/:id/link-insight ─────────────────────────────────────
// Retroactively links an existing stateSnapshot (and its corresponding auditLog)
// to a diagnostic insight/alert ID.  Useful for actions proposed manually before
// the insight traceability schema was introduced, or when an analyst wants to
// annotate an action with the alert that motivated it after the fact.
//
// Body:  { insightId: string }
// Roles: manager+
router.patch("/:id/link-insight", async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid action id" });
  }
  const { insightId } = req.body as { insightId?: string };

  if (!insightId || typeof insightId !== "string" || !insightId.trim()) {
    return res.status(400).json({ error: "insightId is required (non-empty string)" });
  }

  try {
    const orgId = getOrgId(req);
    // state_snapshots has no organization_id column; scope via the parent
    // conversation (matches the pattern used elsewhere in this file).
    const where = orgId
      ? and(
          eq(stateSnapshots.id, id),
          // sql-ambiguous-skip: subquery references conversations only — organization_id is unambiguous
          sql`${stateSnapshots.conversationId} IN (SELECT id FROM conversations WHERE organization_id = ${orgId})`,
        )
      : eq(stateSnapshots.id, id);

    const [snapshot] = await db.select().from(stateSnapshots).where(where).limit(1);
    if (!snapshot) {
      return res.status(404).json({ error: "Snapshot not found" });
    }

    await db
      .update(stateSnapshots)
      .set({ sourceAlertId: insightId.trim() })
      .where(eq(stateSnapshots.id, id));

    await db
      .update(auditLogs)
      .set({ insightId: insightId.trim() })
      .where(eq(auditLogs.snapshotId, id));

    logger.info({ id, insightId }, "Action linked to insight");
    return res.json({ success: true, id, insightId });
  } catch (err) {
    logger.error({ err }, "Failed to link action to insight");
    return res.status(500).json({ error: "Failed to link insight" });
  }
});

export default router;
