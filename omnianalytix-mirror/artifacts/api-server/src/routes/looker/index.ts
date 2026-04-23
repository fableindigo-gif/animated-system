import { Router } from "express";
import { logger } from "../../lib/logger";
import { db } from "@workspace/db";
import { lookerTemplates, insertLookerTemplateSchema } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  getLookerConfig,
  getLookerSDK,
  isLookerApiConfigured,
} from "../../lib/looker-client";
import { getOrgId } from "../../middleware/rbac";
import { assertWorkspaceOwnedByOrg } from "../../middleware/tenant-isolation";

const router = Router();

// ─── GET /api/looker/auth ─────────────────────────────────────────────────────
// Generates a signed embed URL (one-time SSO URL) for a given dashboard, scoped
// to the active workspace (client_id). The client_id user attribute is the
// primary hook for Looker row-level security — Looker filters all explores
// using it.
router.get("/auth", async (req, res) => {
  const cfg = getLookerConfig();

  if (!isLookerApiConfigured(cfg)) {
    res.status(503).json({
      error:
        "Looker embed is not configured. Set LOOKER_HOST, LOOKER_API_CLIENT_ID, and LOOKER_API_CLIENT_SECRET to enable.",
    });
    return;
  }

  try {
    const rbacUser    = (req as any).rbacUser;
    // SEC-03 follow-up: workspace_id drives Looker user_attributes which power
    // row-level security. Trust the authenticated session first; only honour a
    // ?workspace_id= query value if the workspace belongs to the caller's org.
    let workspaceId: string | number = rbacUser?.workspaceId ?? "default";
    const queryWsRaw = req.query.workspace_id != null ? Number(req.query.workspace_id) : null;
    if (!rbacUser?.workspaceId && queryWsRaw != null && Number.isFinite(queryWsRaw)) {
      const orgId = getOrgId(req);
      if (await assertWorkspaceOwnedByOrg(queryWsRaw, orgId)) {
        workspaceId = queryWsRaw;
      } else {
        logger.warn(
          { orgId, queryWsRaw, route: "/api/looker/auth" },
          "[Looker] Rejecting cross-tenant workspace_id query param (SEC-03 follow-up)",
        );
        res.status(403).json({ error: "workspace_id does not belong to your organization", code: "WORKSPACE_NOT_OWNED" });
        return;
      }
    }
    const clientId    = (req.query.client_id as string) || String(workspaceId);
    const userId      = rbacUser?.id   ? String(rbacUser.id)   : "omni-embed-user";
    const userName    = rbacUser?.name || "OmniAnalytix User";
    const [firstName, ...rest] = (userName).split(" ");
    const lastName    = rest.join(" ") || "User";

    const dashboardId = (req.query.dashboard_id as string) || "1";
    const isPresentation = (req.query.report_type as string) === "presentation";

    // UX-02: the global date picker passes its window via query params. We
    // accept them here and bake them into the target_url *before* signing so
    // the filter is part of the SSO payload — Looker ignores unsigned
    // query-string filters on embed URLs in many configurations.
    const dateRangeStart = typeof req.query.date_range_start === "string" ? req.query.date_range_start : "";
    const dateRangeEnd   = typeof req.query.date_range_end   === "string" ? req.query.date_range_end   : "";
    const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    const hasDateRange = isIsoDate(dateRangeStart) && isIsoDate(dateRangeEnd);

    // Build the destination URL inside Looker. create_sso_embed_url accepts a
    // fully-qualified target_url; the SDK wraps this in a one-time SSO login
    // URL that the iframe can load.
    const baseTarget = `${cfg.host}/embed/dashboards/${encodeURIComponent(dashboardId)}`;
    const targetParams = new URLSearchParams({
      embed_domain: cfg.host,
    });
    if (isPresentation) {
      targetParams.set("hide_title", "true");
      targetParams.set("_theme", JSON.stringify({ background_color: "#ffffff" }));
    }
    if (hasDateRange) {
      // Looker dashboard date filters: the canonical filter name on the
      // built-in dashboards is "Date" (matches a `filter_date` filter in the
      // LookML); we also pass the explicit start/end as a fallback for
      // dashboards that bind to those names.
      targetParams.set("filter_date",       `${dateRangeStart} to ${dateRangeEnd}`);
      targetParams.set("date_range_start",  dateRangeStart);
      targetParams.set("date_range_end",    dateRangeEnd);
    }
    const targetUrl = `${baseTarget}?${targetParams.toString()}`;

    const userAttributes: Record<string, string> = {
      workspace_id: String(workspaceId),
      client_id:    clientId,
      user_id:      userId,
      user_name:    userName,
    };

    const sdk = getLookerSDK(cfg)!;
    const ssoResponse = await sdk.ok(
      sdk.create_sso_embed_url({
        target_url:        targetUrl,
        session_length:    3600,
        external_user_id:  userId,
        first_name:        firstName,
        last_name:         lastName,
        permissions:       ["access_data", "see_looks", "see_user_dashboards", "explore"],
        models:            ["omnianalytix"],
        group_ids:         [],
        external_group_id: "",
        user_attributes:   userAttributes,
      }),
    );

    const embedUrl = ssoResponse.url;
    if (!embedUrl) {
      res.status(502).json({ error: "Looker did not return an embed URL" });
      return;
    }

    res.json({
      embedUrl,
      dashboardId,
      host: cfg.host,
      features: { sharing: true, downloading: true, filtering: true },
    });
  } catch (err) {
    logger.error({ err }, "looker: failed to generate embed URL");
    res.status(500).json({ error: "Failed to generate Looker embed session" });
  }
});

// ─── GET /api/looker/dashboards ───────────────────────────────────────────────
// Returns the static list of built-in Looker dashboards (pre-integration).
router.get("/dashboards", (_req, res) => {
  res.json({
    dashboards: [
      { id: "1", title: "E-Commerce Overview",   description: "Revenue, orders, and conversion trends",          category: "ecom"    },
      { id: "2", title: "Ad Performance Matrix", description: "Cross-platform ROAS and spend analysis",          category: "ads"     },
      { id: "3", title: "Lead Pipeline Funnel",  description: "Lead-to-customer journey with CRM data",          category: "leadgen" },
      { id: "4", title: "Attribution & CAC",     description: "Multi-touch attribution and customer acquisition", category: "hybrid"  },
    ],
  });
});

// ─── GET /api/looker/templates ────────────────────────────────────────────────
router.get("/templates", async (_req, res) => {
  try {
    const rows = await db.select().from(lookerTemplates).orderBy(lookerTemplates.createdAt);
    res.json({ templates: rows });
  } catch (err) {
    logger.error({ err }, "looker/templates: list failed");
    res.status(500).json({ error: "Failed to fetch templates" });
  }
});

// ─── GET /api/looker/templates/:id ───────────────────────────────────────────
router.get("/templates/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [row] = await db.select().from(lookerTemplates).where(eq(lookerTemplates.id, id));
    if (!row) { res.status(404).json({ error: "Template not found" }); return; }
    res.json(row);
  } catch (err) {
    logger.error({ err }, "looker/templates/:id: get failed");
    res.status(500).json({ error: "Failed to fetch template" });
  }
});

// ─── POST /api/looker/templates ───────────────────────────────────────────────
// Admin-only: register a new Looker dashboard template.
router.post("/templates", async (req, res) => {
  const parsed = insertLookerTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  try {
    const [row] = await db.insert(lookerTemplates).values(parsed.data).returning();
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "looker/templates: insert failed");
    res.status(500).json({ error: "Failed to create template" });
  }
});

// ─── PUT /api/looker/templates/:id ───────────────────────────────────────────
router.put("/templates/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = insertLookerTemplateSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  try {
    const [row] = await db
      .update(lookerTemplates)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(lookerTemplates.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Template not found" }); return; }
    res.json(row);
  } catch (err) {
    logger.error({ err }, "looker/templates/:id: update failed");
    res.status(500).json({ error: "Failed to update template" });
  }
});

// ─── DELETE /api/looker/templates/:id ────────────────────────────────────────
router.delete("/templates/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [row] = await db
      .delete(lookerTemplates)
      .where(eq(lookerTemplates.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Template not found" }); return; }
    res.json({ success: true, id });
  } catch (err) {
    logger.error({ err }, "looker/templates/:id: delete failed");
    res.status(500).json({ error: "Failed to delete template" });
  }
});

// ─── POST /api/looker/templates/:id/export ───────────────────────────────────
// Triggers Looker's REST API (via the official SDK) to render the dashboard as
// a PDF or PPTX. Requires LOOKER_API_CLIENT_ID + LOOKER_API_CLIENT_SECRET
// (Looker API3 key pair).
router.post("/templates/:id/export", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const cfg = getLookerConfig();
  if (!isLookerApiConfigured(cfg)) {
    res.status(503).json({
      error: "Export requires Looker API3 credentials",
      detail: "Set LOOKER_API_CLIENT_ID and LOOKER_API_CLIENT_SECRET (Looker API 3.0 key pair) to enable PDF/PPTX export.",
      configured: false,
    });
    return;
  }

  try {
    const [template] = await db
      .select()
      .from(lookerTemplates)
      .where(eq(lookerTemplates.id, id));
    if (!template) { res.status(404).json({ error: "Template not found" }); return; }

    const format: "pdf" | "pptx" = (req.body?.format === "pptx") ? "pptx" : "pdf";
    // SEC-03 follow-up: workspaceId is interpolated into the Looker
    // dashboard_filters string (`client_id=…`), which controls per-tenant
    // row-level filtering on the rendered PDF/PPTX. Body-supplied workspace
    // ids must be ownership-verified, otherwise a tenant could render
    // another tenant's data.
    const sessionWsId = (req as any).rbacUser?.workspaceId;
    let workspaceId: string | number = sessionWsId ?? "default";
    const bodyWsRaw = req.body?.workspaceId != null ? Number(req.body.workspaceId) : null;
    if (bodyWsRaw != null && Number.isFinite(bodyWsRaw)) {
      if (sessionWsId != null && Number(bodyWsRaw) !== Number(sessionWsId)) {
        logger.warn(
          { sessionWsId, bodyWsRaw, route: "/api/looker/templates/:id/export" },
          "[Looker] Rejecting export: body workspaceId does not match authenticated session (SEC-03)",
        );
        res.status(403).json({ error: "workspaceId mismatch", code: "WORKSPACE_MISMATCH" });
        return;
      }
      const orgId = getOrgId(req);
      if (!(await assertWorkspaceOwnedByOrg(bodyWsRaw, orgId))) {
        logger.warn(
          { orgId, bodyWsRaw, route: "/api/looker/templates/:id/export" },
          "[Looker] Rejecting cross-tenant workspaceId export request (SEC-03 follow-up)",
        );
        res.status(403).json({ error: "workspaceId does not belong to your organization", code: "WORKSPACE_NOT_OWNED" });
        return;
      }
      workspaceId = bodyWsRaw;
    }

    const sdk = getLookerSDK(cfg)!;

    // Step 1: Create the dashboard render task via the SDK's typed API.
    const renderTask = await sdk.ok(
      sdk.create_dashboard_render_task({
        dashboard_id:  String(template.lookerDashboardId),
        result_format: format,
        width:  1280,
        height: 1024,
        body: {
          dashboard_style:   "tiled",
          dashboard_filters: `client_id=${workspaceId}`,
        },
      }),
    );

    const taskId = renderTask.id;
    if (!taskId) {
      res.status(502).json({ error: "Looker did not return a render task id" });
      return;
    }

    // Step 2: Poll the typed render-task endpoint until success/failure or
    // the 60-second cap is hit.
    let status = renderTask.status ?? "";
    let attempts = 0;
    while (status !== "success" && status !== "failure" && attempts < 30) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const polled = await sdk.ok(sdk.render_task(taskId));
        status = polled.status ?? status;
      } catch (pollErr) {
        logger.warn({ err: pollErr, taskId }, "looker: render task poll failed");
        break;
      }
      attempts++;
    }

    if (status !== "success") {
      res.status(502).json({ error: "Render task did not complete", status });
      return;
    }

    // Step 3: Return the results URL — the client fetches this directly.
    const downloadUrl = `${cfg.host}/api/4.0/render_tasks/${taskId}/results`;
    res.json({ downloadUrl, taskId, format, configured: true });
  } catch (err) {
    logger.error({ err }, "looker/templates/:id/export: unexpected error");
    res.status(500).json({ error: "Export failed unexpectedly" });
  }
});

export default router;
