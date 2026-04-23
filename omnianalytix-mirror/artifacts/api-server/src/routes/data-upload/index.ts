import { Router } from "express";
import multer from "multer";
import Papa from "papaparse";
import { db, uploadedDatasets } from "@workspace/db";
import { pool } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { getOrgId } from "../../middleware/rbac";
import { assertWorkspaceOwnedByOrg } from "../../middleware/tenant-isolation";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const router = Router();

function sanitizeTableName(name: string, orgId: number): string {
  const base = name
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .toLowerCase()
    .slice(0, 40);
  return `upl_${orgId}_${base}_${Date.now().toString(36)}`;
}

function inferPgType(values: string[]): string {
  const sample = values.filter(Boolean).slice(0, 50);
  if (sample.length === 0) return "text";

  const allNumeric = sample.every((v) => !isNaN(Number(v)) && v.trim() !== "");
  if (allNumeric) {
    const hasDecimal = sample.some((v) => v.includes("."));
    return hasDecimal ? "numeric" : "integer";
  }

  return "text";
}

router.get("/datasets", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return void res.status(401).json({ error: "Unauthorized" });

    const rows = await db
      .select()
      .from(uploadedDatasets)
      .where(eq(uploadedDatasets.organizationId, orgId))
      .orderBy(desc(uploadedDatasets.createdAt));

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /data-upload/datasets failed");
    res.status(500).json({ error: "Failed to fetch datasets" });
  }
});

router.get("/datasets/:id/rows", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return void res.status(401).json({ error: "Unauthorized" });

    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return void res.status(400).json({ error: "Invalid dataset id" });
    const [dataset] = await db
      .select()
      .from(uploadedDatasets)
      .where(and(eq(uploadedDatasets.id, id), eq(uploadedDatasets.organizationId, orgId)));

    if (!dataset) return void res.status(404).json({ error: "Dataset not found" });

    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "1000"), 10) || 1000, 1), 5000);
    const offset = Math.max(parseInt(String(req.query.offset || "0"), 10) || 0, 0);

    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM "${dataset.tableName}" ORDER BY id LIMIT $1 OFFSET $2`,
        [limit, offset],
      );
      res.json(result.rows);
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ err }, "GET /data-upload/datasets/:id/rows failed");
    res.status(500).json({ error: "Failed to fetch rows" });
  }
});

router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return void res.status(401).json({ error: "Unauthorized" });

    const file = req.file;
    if (!file) return void res.status(400).json({ error: "No file uploaded" });

    const csvText = file.buffer.toString("utf-8");
    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true, dynamicTyping: false });

    if (parsed.errors.length > 0 && parsed.data.length === 0) {
      return void res.status(400).json({ error: "Failed to parse CSV", details: parsed.errors.slice(0, 3) });
    }

    const rows = parsed.data as Record<string, string>[];
    if (rows.length === 0) return void res.status(400).json({ error: "CSV contains no data rows" });

    const columns = Object.keys(rows[0]).map((col) =>
      col.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase().slice(0, 63)
    );

    const columnTypes = columns.map((col, i) => {
      const originalKey = Object.keys(rows[0])[i];
      const vals = rows.map((r) => r[originalKey] ?? "");
      return inferPgType(vals);
    });

    const tableName = sanitizeTableName(file.originalname, orgId);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const colDefs = columns.map((c, i) => `"${c}" ${columnTypes[i]}`).join(", ");
      await client.query(`CREATE TABLE "${tableName}" (id serial PRIMARY KEY, ${colDefs})`);

      for (const row of rows) {
        const vals = Object.values(row);
        const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
        const colNames = columns.map((c) => `"${c}"`).join(", ");
        await client.query(`INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders})`, vals);
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      await client.query(`DROP TABLE IF EXISTS "${tableName}"`);
      throw err;
    } finally {
      client.release();
    }

    // SEC-03 follow-up: a body-supplied workspaceId can ONLY be persisted on
    // the dataset row if it belongs to the caller's organisation, otherwise
    // an attacker could mis-tag uploads as belonging to another tenant's
    // workspace.
    const rawBodyWsId = req.body?.workspaceId != null ? parseInt(String(req.body.workspaceId), 10) : null;
    let resolvedWorkspaceId: number | null = null;
    if (rawBodyWsId != null && Number.isFinite(rawBodyWsId)) {
      const owns = await assertWorkspaceOwnedByOrg(rawBodyWsId, orgId);
      if (!owns) {
        return void res
          .status(403)
          .json({ error: "workspaceId does not belong to your organization", code: "WORKSPACE_NOT_OWNED" });
      }
      resolvedWorkspaceId = rawBodyWsId;
    }

    const [dataset] = await db
      .insert(uploadedDatasets)
      .values({
        organizationId: orgId,
        workspaceId: resolvedWorkspaceId,
        name: file.originalname.replace(/\.[^.]+$/, ""),
        tableName,
        columns,
        rowCount: rows.length,
        fileSize: file.size,
        uploadedBy: (req as any).rbacUser?.id ?? null,
      })
      .returning();

    logger.info({ id: dataset.id, tableName, rowCount: rows.length }, "Dataset uploaded");
    res.status(201).json(dataset);
  } catch (err) {
    logger.error({ err }, "POST /data-upload/upload failed");
    res.status(500).json({ error: "Failed to upload dataset" });
  }
});

router.delete("/datasets/:id", async (req, res) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return void res.status(401).json({ error: "Unauthorized" });

    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return void res.status(400).json({ error: "Invalid dataset id" });
    const [dataset] = await db
      .select()
      .from(uploadedDatasets)
      .where(and(eq(uploadedDatasets.id, id), eq(uploadedDatasets.organizationId, orgId)));

    if (!dataset) return void res.status(404).json({ error: "Dataset not found" });

    const client = await pool.connect();
    try {
      await client.query(`DROP TABLE IF EXISTS "${dataset.tableName}"`);
    } finally {
      client.release();
    }

    await db.delete(uploadedDatasets).where(eq(uploadedDatasets.id, id));

    logger.info({ id, tableName: dataset.tableName }, "Dataset deleted");
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "DELETE /data-upload/datasets failed");
    res.status(500).json({ error: "Failed to delete dataset" });
  }
});

export default router;
