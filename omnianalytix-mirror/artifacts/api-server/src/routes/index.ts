import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { handleRouteError } from "../lib/route-error-handler";
import healthRouter from "./health";
import geminiRouter from "./gemini";
import connectionsRouter from "./connections";
import authRouter from "./auth";
import actionsRouter from "./actions";
import reportsRouter from "./reports";
import complianceRouter from "./compliance";
import inventoryRouter from "./inventory";
import customersRouter from "./customers";
import shopifyRouter from "./shopify";
import systemRouter from "./system";
import googleAdsRouter from "./google-ads";
import liveTriageRouter from "./live-triage";
import { mcpRouter } from "./mcp/index";
import analyticsRouter from "./analytics";
import crmRouter from "./crm";
import insightsRouter from "./insights";
import fxRouter from "./fx";
import etlRouter from "./etl";
import dashboardRouter from "./dashboard";
import warehouseRouter from "./warehouse";
import teamRouter from "./team";
import tasksRouter from "./tasks";
import webhooksRouter from "./webhooks";
import masterBusRouter from "./webhooks/master-bus";
import workspacesRouter from "./workspaces";
import organizationsRouter from "./organizations";
import infrastructureRouter from "./infrastructure";
import billingRouter from "./billing";
import billingHubRouter from "./billing-hub";
import lookerRouter from "./looker";
import aiCreativeRouter from "./ai-creative";
import feedEnrichmentRouter from "./feed-enrichment";
import aiAgentsRouter from "./ai-agents";
import promoEngineRouter from "./promo-engine";
import resolutionLibraryRouter from "./resolution-library";
import dataModelingRouter from "./data-modeling";
import dataUploadRouter from "./data-upload";
import byodbRouter from "./byodb";
import leadsRouter from "./leads";
import adminRouter from "./admin";
import financialsRouter from "./financials";
import savedViewsRouter from "./saved-views";
import usersRouter from "./users";
import copilotRouter from "./copilot";
import biRouter from "./bi";
import meRouter from "./me";
import leadgenRouter from "./leadgen";
import hybridRouter from "./hybrid";
import inviteRouter from "./invite";
import platformRouter from "./platform";
import integrationsRouter from "./integrations";
import adkRouter from "./adk";
import adkProtoRouter from "./adk-proto";
import gaarfRouter from "./gaarf";
import settingsRouter from "./settings";
import { getLastHealthResults } from "../services/system-health-monitor";
import {
  getQualityFixesScannerStatus,
  getPendingQualityFixesCount,
} from "../workers/quality-fixes-scanner";
import {
  getFeedgenRecoveryStatus,
  getStuckFeedgenCount,
} from "../workers/feedgen-runner";
import { db, sharedReports } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireRole, readGuard, attachUser, requireAuth, type Role } from "../middleware/rbac";
import { requireSuperAdmin } from "../middleware/super-admin";
import { mutationLogger } from "../middleware/mutation-logger";
import { requireActiveConnection } from "../middleware/connection-guard";
import { authRateLimit, warehouseRateLimit, sharedReportRateLimit, geminiRateLimit, connectionsRateLimit, actionsRateLimit } from "../middleware/rate-limiter";

const router: IRouter = Router();

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function mutationGuard(minRole: Role) {
  const check = requireRole(minRole);
  return (req: Request, res: Response, next: NextFunction) => {
    if (READ_METHODS.has(req.method)) return next();
    return check(req, res, next);
  };
}

function fullGuard(minRole: Role) {
  return requireRole(minRole);
}

router.use(healthRouter);

router.get("/system-health", async (_req, res) => {
  const { results, lastRunAt } = getLastHealthResults();
  const scanner = getQualityFixesScannerStatus();
  const pendingScanCount = await getPendingQualityFixesCount();
  const scannerAborted =
    scanner.lastErrorCode === "SHOPTIMIZER_NOT_CONFIGURED" ||
    scanner.lastErrorCode === "SHOPTIMIZER_UNREACHABLE";

  // FeedGen crash-recovery sweeper status. The cached `currentStuckCount` is
  // a snapshot from the last sweep; refresh it here so the dashboard never
  // shows a stale count between sweeps.
  const feedgenRecovery = getFeedgenRecoveryStatus();
  const liveStuckCount = await getStuckFeedgenCount();
  const feedgenRecoveryStuck = liveStuckCount > 0;

  const failures = results.filter((r) => !r.ok && !r.detail?.includes("skipped"));
  const status =
    results.length === 0
      ? "pending"
      : failures.length > 0 || scannerAborted || feedgenRecoveryStuck
        ? "degraded"
        : "operational";

  res.json({
    status,
    lastRunAt,
    checks: results,
    qualityFixesScanner: { ...scanner, pendingScanCount },
    feedgenRecovery: { ...feedgenRecovery, currentStuckCount: liveStuckCount },
  });
});

router.get("/shared-reports/:shareId", sharedReportRateLimit, async (req, res) => {
  try {
    // tenant-ownership-skip: shareId is a high-entropy unguessable token
    // (sharedReportRateLimit applies anti-enumeration); it IS the tenancy
    // proof for the unauthenticated link recipient.
    const rows = await db
      .select()
      .from(sharedReports)
      .where(and(eq(sharedReports.shareId, String(req.params.shareId)), eq(sharedReports.isActive, true)))
      .limit(1);

    if (!rows.length) return res.status(404).json({ error: "Report not found or expired" });

    const report = rows[0];
    if (report.expiresAt && new Date(report.expiresAt) < new Date()) {
      return res.status(410).json({ error: "This report link has expired" });
    }

    return res.json({
      shareId: report.shareId,
      agencyName: report.agencyName,
      reportTitle: report.reportTitle,
      reportData: report.reportData,
      createdAt: report.createdAt,
      expiresAt: report.expiresAt,
    });
  } catch (err) {
    handleRouteError(err, req, res, "GET /api/reports/share/:shareId", { error: "Failed to load report" });
    return;
  }
});

router.use("/leads", leadsRouter);
router.use("/auth/gate/login", authRateLimit);
router.use("/auth", authRouter);
router.use("/webhooks", webhooksRouter);
router.use("/webhooks/bus", masterBusRouter);

// ── Public invite endpoints — must be before requireAuth() ────────────────────
router.use("/invite", inviteRouter);

// ── Platform-owner routes — auth handled by requireSuperAdmin (bypasses RBAC) ─
router.use("/platform", requireSuperAdmin, platformRouter);

router.use(attachUser());
router.use(mutationLogger());

router.use("/live-triage", liveTriageRouter);
router.use("/mcp", mcpRouter);

// ── /ai-agents — MIXED auth posture, MUST stay above requireAuth() ────────────
//
// This router exposes THREE PUBLIC endpoints used by the embedded chat widget
// installed on customer e-commerce sites:
//   • GET  /api/ai-agents/widget.js          — static widget bundle
//   • GET  /api/ai-agents/config/:scriptId   — per-agent config (script id is
//                                              a high-entropy hex token)
//   • POST /api/ai-agents/chat/:scriptId     — RAG chat (Vertex AI + Gemini)
// and EIGHT private CRUD endpoints (GET/POST/PUT/DELETE /:id, /:id/documents,
// etc.) that gate auth at the HANDLER level by calling `requireOrgId(req)`
// (Phase 2A chokepoint — throws 401 AUTH_REQUIRED) or `resolveOrgId(req)`
// (returns null → handler 400/401).
//
// DO NOT MOVE THIS BELOW `router.use(requireAuth())` — doing so makes every
// public widget endpoint return 401, which silently breaks every customer
// site that has embedded the chat widget. Express middleware ordering means
// `router.use(requireAuth())` acts as a path-agnostic gate for any request
// that hasn't yet been handled, so anything mounted AFTER it is auth-required
// regardless of in-file route ordering. (This bug existed Apr 2026 and was
// caught by Phase 2B reliability work — see replit.md "Reliability Program".)
router.use("/ai-agents", aiAgentsRouter);

router.use(requireAuth());

router.use("/workspaces", mutationGuard("admin"), workspacesRouter);
router.use("/organizations", mutationGuard("admin"), organizationsRouter);
router.use("/admin", requireRole("admin"), adminRouter);

router.use("/gemini", geminiRateLimit, readGuard("viewer"), geminiRouter);
router.use("/connections", connectionsRateLimit, readGuard("viewer", "manager"), connectionsRouter);
router.use("/actions", actionsRateLimit, fullGuard("analyst"), actionsRouter);
router.use("/reports", fullGuard("analyst"), reportsRouter);
router.use("/compliance", fullGuard("analyst"), complianceRouter);
router.use("/inventory", readGuard("viewer", "analyst"), requireActiveConnection(), inventoryRouter);
router.use("/customers", readGuard("viewer", "analyst"), requireActiveConnection(), customersRouter);
router.use("/shopify", fullGuard("manager"), requireActiveConnection(), shopifyRouter);
router.use("/system", readGuard("viewer", "admin"), systemRouter);
router.use("/google-ads", readGuard("viewer", "analyst"), requireActiveConnection(), googleAdsRouter);
router.use("/analytics", readGuard("viewer"), requireActiveConnection(), analyticsRouter);
router.use("/crm", fullGuard("manager"), crmRouter);
router.use("/insights", readGuard("viewer"), requireActiveConnection(), insightsRouter);
// FX rates are read by every dashboard (viewer); FX overrides require admin
// auth, enforced inside the router (see PUT/DELETE handlers + GET /overrides).
router.use("/fx", readGuard("viewer"), fxRouter);
router.use("/etl", fullGuard("manager"), etlRouter);
router.use("/dashboard", readGuard("viewer", "analyst"), dashboardRouter);
router.use("/warehouse", readGuard("viewer", "analyst"), requireActiveConnection(), warehouseRateLimit, warehouseRouter);
router.use("/team", requireAuth(), teamRouter);
router.use("/tasks", readGuard("viewer", "analyst"), tasksRouter);
router.use("/infrastructure", fullGuard("admin"), infrastructureRouter);
router.use("/billing", mutationGuard("admin"), billingRouter);
router.use("/billing-hub", readGuard("viewer"), billingHubRouter);
router.use("/looker",       readGuard("viewer"),    lookerRouter);
router.use("/ai/creative",       readGuard("analyst"),  aiCreativeRouter);
router.use("/feed-enrichment",   readGuard("analyst"),  feedEnrichmentRouter);
// NB: /ai-agents is mounted ABOVE requireAuth() — see comment block there.
router.use("/promo-engine", readGuard("analyst"), promoEngineRouter);
router.use("/resolution-library", readGuard("viewer", "analyst"), resolutionLibraryRouter);
router.use("/data-modeling", readGuard("viewer", "analyst"), dataModelingRouter);
router.use("/data-upload", readGuard("viewer", "analyst"), dataUploadRouter);
router.use("/byodb", readGuard("viewer", "analyst"), byodbRouter);
router.use("/financials", readGuard("viewer", "analyst"), financialsRouter);
router.use("/saved-views", readGuard("viewer", "analyst"), savedViewsRouter);
router.use("/users", usersRouter);
router.use("/copilot", geminiRateLimit, readGuard("viewer"), copilotRouter);
router.use("/bi", readGuard("viewer"), biRouter);
router.use("/me", readGuard("viewer"), meRouter);
router.use("/leadgen", readGuard("viewer"), leadgenRouter);
router.use("/hybrid",  readGuard("viewer"), hybridRouter);
router.use("/integrations", readGuard("viewer", "manager"), integrationsRouter);
router.use("/adk", geminiRateLimit, readGuard("viewer"), adkRouter);
router.use("/gaarf", geminiRateLimit, readGuard("viewer"), gaarfRouter);
// Per-tenant economics (COGS %, target ROAS) — reads open to viewers; writes
// gated by `requireRole("manager")` inside the router itself.
router.use("/settings", readGuard("viewer"), settingsRouter);

export default router;
