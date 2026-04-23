import { Router } from "express";
import { db, workspaceDbCredentials } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { encrypt } from "../../lib/credential-vault";
import { testConnection, executeUserQuery, getWorkspaceCredentials } from "../../services/dynamic-query-engine";
import { logger } from "../../lib/logger";
import { getOrgId } from "../../middleware/rbac";
import { assertWorkspaceOwnedByOrg } from "../../middleware/tenant-isolation";

const router = Router();

const VALID_DB_TYPES = ["postgres", "mysql", "snowflake", "bigquery"];

router.get("/credentials", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return void res.status(401).json({ error: "Unauthorized" });

    const creds = await getWorkspaceCredentials(orgId);
    res.json(creds);
  } catch (err) {
    logger.error({ err }, "GET /byodb/credentials failed");
    res.status(500).json({ error: "Failed to fetch credentials" });
  }
});

router.post("/credentials", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return void res.status(401).json({ error: "Unauthorized" });

    const { dbType, label, host, port, databaseName, username, password, serviceAccountKey, workspaceId } = req.body as {
      dbType: string;
      label?: string;
      host: string;
      port: number;
      databaseName: string;
      username: string;
      password: string;
      serviceAccountKey?: string;
      workspaceId?: number;
    };

    if (!VALID_DB_TYPES.includes(dbType)) return void res.status(400).json({ error: "Invalid dbType" });
    if (!host?.trim()) return void res.status(400).json({ error: "host is required" });
    if (!port || port < 1 || port > 65535) return void res.status(400).json({ error: "Valid port is required" });
    if (!databaseName?.trim()) return void res.status(400).json({ error: "databaseName is required" });
    if (!username?.trim()) return void res.status(400).json({ error: "username is required" });
    if (!password?.trim() && dbType !== "bigquery") return void res.status(400).json({ error: "password is required" });

    // SEC-03 follow-up: a body-supplied workspaceId can ONLY be accepted if it
    // belongs to the caller's organisation. Otherwise an attacker would be
    // able to register a credential row pointing at another tenant's
    // workspace id (decoupling workspaceId from organizationId in the row).
    let resolvedWorkspaceId = 0;
    if (workspaceId != null) {
      const owns = await assertWorkspaceOwnedByOrg(workspaceId, orgId);
      if (!owns) {
        return void res
          .status(403)
          .json({ error: "workspaceId does not belong to your organization", code: "WORKSPACE_NOT_OWNED" });
      }
      resolvedWorkspaceId = workspaceId;
    }

    const encryptedPassword = encrypt(password || "");
    const encryptedSaKey = serviceAccountKey ? encrypt(serviceAccountKey) : null;

    const [cred] = await db
      .insert(workspaceDbCredentials)
      .values({
        workspaceId: resolvedWorkspaceId,
        organizationId: orgId,
        dbType,
        label: label?.trim() || `${dbType} - ${host}`,
        host: host.trim(),
        port,
        databaseName: databaseName.trim(),
        username: username.trim(),
        encryptedPassword,
        serviceAccountKey: encryptedSaKey,
        status: "pending",
      })
      .returning({
        id: workspaceDbCredentials.id,
        dbType: workspaceDbCredentials.dbType,
        label: workspaceDbCredentials.label,
        host: workspaceDbCredentials.host,
        port: workspaceDbCredentials.port,
        databaseName: workspaceDbCredentials.databaseName,
        username: workspaceDbCredentials.username,
        status: workspaceDbCredentials.status,
        createdAt: workspaceDbCredentials.createdAt,
      });

    logger.info({ id: cred.id, dbType }, "DB credential created");
    res.status(201).json(cred);
  } catch (err) {
    logger.error({ err }, "POST /byodb/credentials failed");
    res.status(500).json({ error: "Failed to save credentials" });
  }
});

router.post("/credentials/:id/test", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return void res.status(401).json({ error: "Unauthorized" });

    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return void res.status(400).json({ error: "Invalid credential id" });

    const result = await testConnection(id, orgId);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "POST /byodb/credentials/:id/test failed");
    res.status(500).json({ error: "Failed to test connection" });
  }
});

router.post("/query", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return void res.status(401).json({ error: "Unauthorized" });

    const { credentialId, sqlQuery } = req.body as { credentialId: number; sqlQuery: string };
    if (!credentialId || !sqlQuery?.trim()) {
      return void res.status(400).json({ error: "credentialId and sqlQuery are required" });
    }

    const result = await executeUserQuery(credentialId, orgId, sqlQuery.trim());
    res.json(result);
  } catch (err) {
    logger.error({ err }, "POST /byodb/query failed");
    res.status(500).json({ error: "Failed to execute query" });
  }
});

router.delete("/credentials/:id", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return void res.status(401).json({ error: "Unauthorized" });

    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return void res.status(400).json({ error: "Invalid credential id" });

    const [deleted] = await db
      .delete(workspaceDbCredentials)
      .where(and(eq(workspaceDbCredentials.id, id), eq(workspaceDbCredentials.organizationId, orgId)))
      .returning();

    if (!deleted) return void res.status(404).json({ error: "Credential not found" });

    logger.info({ id }, "DB credential deleted");
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "DELETE /byodb/credentials/:id failed");
    res.status(500).json({ error: "Failed to delete credential" });
  }
});

export default router;
