import { Router } from "express";
import { eq, and, sql, isNull } from "drizzle-orm";
import { db, platformConnections } from "@workspace/db";
import { CreateConnectionBody, DeleteConnectionParams, TestConnectionParams } from "@workspace/api-zod";
import { fetchPlatformData, formatPlatformDataForAgent } from "../../lib/platform-fetchers";
import { parsePagination, paginatedResponse } from "../../lib/pagination";
import { getOrgId, requireRole } from "../../middleware/rbac";
import { decryptCredentials, encryptCredentials } from "../../lib/credential-helpers";
import {
  WORKSPACE_PLATFORMS,
  probeGoogleConnectionHealth,
} from "../../lib/google-workspace-oauth";
import { getLastWorkspaceHealthForOrg } from "../../services/workspace-health-scheduler";

const router = Router();

// SEC-01/SEC-02: Mutating routes on platform connections (create / delete /
// credential rotation) must require admin role. The router-level readGuard
// only enforces "manager" for writes; this stacks an admin requirement on
// top for the most sensitive operations.
const ADMIN_ONLY = requireRole("admin");

const ALLOWED_PLATFORMS = ["google_ads", "meta", "shopify", "gmc", "woocommerce", "bing_ads", "zoho", "salesforce", "hubspot", "gsc", "google_sheets"] as const;
type Platform = (typeof ALLOWED_PLATFORMS)[number];

// Strict tenant scope: a caller may ONLY see rows belonging to their own
// organization. The previous "OR organizationId IS NULL" branch leaked any
// legacy/null-scoped rows to every tenant — a cross-tenant exposure path.
// Callers without an orgId see nothing at all.
function orgScope(orgId: number | null) {
  if (orgId != null) {
    return eq(platformConnections.organizationId, orgId);
  }
  // No org context → no rows. We deliberately return a contradiction rather
  // than `isNull(...)` so unauthenticated/unscoped callers never see legacy
  // null-org connections.
  return sql`FALSE`;
}

router.get("/", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const filter = orgScope(orgId);
    const wantsPagination = req.query.page !== undefined;
    const { page, pageSize, offset } = parsePagination(req.query as Record<string, unknown>);

    let query = db
      .select()
      .from(platformConnections)
      .where(filter)
      .orderBy(platformConnections.createdAt);

    if (wantsPagination) {
      query = query.limit(pageSize).offset(offset) as typeof query;
    }

    const connections = await query;

    const sanitized = connections.map((c) => {
      const creds = c.credentials as Record<string, string> | null ?? {};
      return {
        id: c.id,
        platform: c.platform,
        displayName: c.displayName,
        isActive: c.isActive,
        createdAt: c.createdAt,
        updatedAt: (c as any).updatedAt ?? c.createdAt,
        currency: creds.currency ?? undefined,
        ...(c.platform === "shopify" ? {
          shopDomain: creds.shopDomain ?? c.displayName,
        } : {}),
        ...(c.platform === "google_ads" ? {
          hasCustomerId: !!creds.customerId,
          hasGa4PropertyId: !!creds.ga4PropertyId,
        } : {}),
      };
    });

    if (wantsPagination) {
      // tenant-ownership-skip: `filter = orgScope(orgId)` declared at top of
      // handler — already org-scoped (lint detects orgScope helper but not
      // through-variable rebinding).
      const [totalRow] = await db.select({ c: sql<number>`COUNT(*)::int` }).from(platformConnections).where(filter);
      res.json(paginatedResponse(sanitized, totalRow?.c ?? 0, page, pageSize));
    } else {
      res.json(sanitized);
    }
  } catch (err) {
    req.log.error({ err }, "Failed to list connections");
    res.status(500).json({ error: "Failed to list connections" });
  }
});

router.patch("/google-ads/customer-id", ADMIN_ONLY, async (req, res) => {
  const { customerId, developerToken } = req.body as Record<string, string>;
  if (!customerId) {
    res.status(400).json({ error: "customerId is required" });
    return;
  }

  try {
    const orgId = getOrgId(req);
    const conditions = [eq(platformConnections.platform, "google_ads")];
    conditions.push(orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId));

    const rows = await db.select().from(platformConnections).where(and(...conditions));
    if (rows.length === 0) {
      res.status(404).json({ error: "Google Ads not connected. Authorize via OAuth on the Connections page first." });
      return;
    }
    const conn = rows[0];
    const existingCreds = conn.credentials as Record<string, string> ?? {};
    const decrypted = decryptCredentials(existingCreds);
    const updatedCreds: Record<string, string> = {
      ...decrypted,
      customerId: customerId.replace(/-/g, ""),
    };
    if (developerToken) updatedCreds.developerToken = developerToken;

    await db.update(platformConnections)
      .set({ credentials: encryptCredentials(updatedCreds) })
      .where(eq(platformConnections.id, conn.id));

    req.log.info({ customerId: updatedCreds.customerId }, "Google Ads customer ID updated");
    res.json({ success: true, customerId: updatedCreds.customerId });
  } catch (err) {
    req.log.error({ err }, "Failed to update Google Ads customer ID");
    res.status(500).json({ error: "Failed to save customer ID" });
  }
});

router.patch("/google-ads/ga4-property-id", ADMIN_ONLY, async (req, res) => {
  const { ga4PropertyId } = req.body as Record<string, string>;
  if (!ga4PropertyId?.trim()) {
    res.status(400).json({ error: "ga4PropertyId is required" });
    return;
  }

  try {
    const orgId = getOrgId(req);
    const conditions = [eq(platformConnections.platform, "google_ads")];
    conditions.push(orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId));

    const rows = await db.select().from(platformConnections).where(and(...conditions));
    if (rows.length === 0) {
      res.status(404).json({ error: "Google Ads not connected. Authorize via OAuth on the Connections page first." });
      return;
    }
    const conn = rows[0];
    const existingCreds = conn.credentials as Record<string, string> ?? {};
    const decrypted = decryptCredentials(existingCreds);
    const updatedCreds: Record<string, string> = {
      ...decrypted,
      ga4PropertyId: ga4PropertyId.trim(),
    };

    await db.update(platformConnections)
      .set({ credentials: encryptCredentials(updatedCreds) })
      .where(eq(platformConnections.id, conn.id));

    req.log.info({ ga4PropertyId: ga4PropertyId.trim() }, "GA4 property ID updated");
    res.json({ success: true, ga4PropertyId: ga4PropertyId.trim() });
  } catch (err) {
    req.log.error({ err }, "Failed to update GA4 property ID");
    res.status(500).json({ error: "Failed to save GA4 property ID" });
  }
});

router.post("/", ADMIN_ONLY, async (req, res) => {
  const result = CreateConnectionBody.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  if (!ALLOWED_PLATFORMS.includes(result.data.platform as Platform)) {
    res.status(400).json({ error: `Platform must be one of: ${ALLOWED_PLATFORMS.join(", ")}` });
    return;
  }

  try {
    const orgId = getOrgId(req);
    const [connection] = await db
      .insert(platformConnections)
      .values({
        organizationId: orgId,
        platform: result.data.platform,
        displayName: result.data.displayName,
        credentials: encryptCredentials(result.data.credentials),
        isActive: true,
      })
      .returning({
        id: platformConnections.id,
        platform: platformConnections.platform,
        displayName: platformConnections.displayName,
        isActive: platformConnections.isActive,
        createdAt: platformConnections.createdAt,
      });
    res.status(201).json(connection);
  } catch (err) {
    req.log.error({ err }, "Failed to create connection");
    res.status(500).json({ error: "Failed to create connection" });
  }
});

// GET /api/connections/google/health
// Probes each Google Workspace connection (Calendar / Drive / Docs) by
// forcing a refresh round-trip via `getAuthorizedGoogleClient`. If the
// stored refresh_token has been revoked, the probe surfaces it as
// `needs_reconnect` so the UI can prompt the user to re-authorize before
// they hit a live 502 on a real Calendar / Drive / Docs API call.
router.get("/google/health", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const entries = await Promise.all(
      WORKSPACE_PLATFORMS.map(async (platform) => {
        const health = await probeGoogleConnectionHealth(platform, orgId);
        return [platform, health] as const;
      }),
    );
    const results = Object.fromEntries(entries);
    res.json({ checkedAt: new Date().toISOString(), platforms: results });
  } catch (err) {
    req.log.error({ err }, "Failed to probe Google connection health");
    res.status(500).json({ error: "Failed to probe Google connection health" });
  }
});

// GET /api/connections/google/health/cached
// Returns the most recent background-probe result for this organization without
// triggering a new live token-refresh round-trip. The background scheduler
// populates this cache roughly every 2 hours. A `null` result means the
// scheduler hasn't run yet — callers should fall back to the live `/google/health`
// endpoint or treat it as unknown.
router.get("/google/health/cached", (req, res) => {
  const orgId = getOrgId(req);
  const snapshot = getLastWorkspaceHealthForOrg(orgId);
  if (!snapshot) {
    res.json({ available: false, snapshot: null });
    return;
  }
  res.json({ available: true, snapshot });
});

router.get("/data", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const conditions = [eq(platformConnections.isActive, true)];
    conditions.push(orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId));

    const connections = await db
      .select()
      .from(platformConnections)
      .where(and(...conditions));

    const results = await Promise.all(
      connections.map((c) =>
        fetchPlatformData(c.platform, decryptCredentials(c.credentials as Record<string, string>), c.id, c.displayName),
      ),
    );

    const summary = formatPlatformDataForAgent(results.filter((r) => r.success));

    res.json({ results, summary });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch all platform data");
    res.status(500).json({ error: "Failed to fetch platform data" });
  }
});

router.delete("/:id", ADMIN_ONLY, async (req, res) => {
  const params = DeleteConnectionParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const orgId    = getOrgId(req);
    const orgWhere = orgId != null
      ? eq(platformConnections.organizationId, orgId)
      : isNull(platformConnections.organizationId);
    const [conn] = await db
      .select()
      .from(platformConnections)
      .where(and(eq(platformConnections.id, params.data.id), orgWhere));
    if (!conn) {
      res.status(404).json({ error: "Connection not found" });
      return;
    }
    await db
      .delete(platformConnections)
      .where(and(eq(platformConnections.id, params.data.id), orgWhere));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete connection");
    res.status(500).json({ error: "Failed to delete connection" });
  }
});

router.post("/:id/test", async (req, res) => {
  const params = TestConnectionParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const orgId    = getOrgId(req);
    const orgWhere = orgId != null
      ? eq(platformConnections.organizationId, orgId)
      : isNull(platformConnections.organizationId);
    const [conn] = await db
      .select()
      .from(platformConnections)
      .where(and(eq(platformConnections.id, params.data.id), orgWhere));
    if (!conn) {
      res.status(404).json({ error: "Connection not found" });
      return;
    }

    const result = await fetchPlatformData(
      conn.platform,
      decryptCredentials(conn.credentials as Record<string, string>),
      conn.id,
      conn.displayName,
    );

    if (result.success) {
      res.json({ success: true, message: `Successfully connected to ${conn.displayName}. Data fetched.` });
    } else {
      res.json({ success: false, message: result.error ?? "Connection test failed" });
    }
  } catch (err) {
    req.log.error({ err }, "Failed to test connection");
    res.status(500).json({ error: "Failed to test connection" });
  }
});

router.get("/:id/data", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const orgId    = getOrgId(req);
    const orgWhere = orgId != null
      ? eq(platformConnections.organizationId, orgId)
      : isNull(platformConnections.organizationId);
    const [conn] = await db
      .select()
      .from(platformConnections)
      .where(and(eq(platformConnections.id, id), orgWhere));
    if (!conn) {
      res.status(404).json({ error: "Connection not found" });
      return;
    }

    const result = await fetchPlatformData(
      conn.platform,
      decryptCredentials(conn.credentials as Record<string, string>),
      conn.id,
      conn.displayName,
    );

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch connection data");
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

export default router;
