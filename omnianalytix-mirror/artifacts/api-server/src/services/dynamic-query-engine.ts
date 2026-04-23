import pg from "pg";
import { db, workspaceDbCredentials } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { decrypt } from "../lib/credential-vault";
import { logger } from "../lib/logger";

const QUERY_TIMEOUT_MS = 30_000;
const MAX_ROWS = 500;

const poolCache = new Map<number, { pool: pg.Pool; expiresAt: number }>();
const POOL_TTL_MS = 5 * 60 * 1000;

function cleanupPools() {
  const now = Date.now();
  for (const [id, entry] of poolCache) {
    if (entry.expiresAt < now) {
      entry.pool.end().catch(() => {});
      poolCache.delete(id);
    }
  }
}

setInterval(cleanupPools, 60_000).unref();

async function getCredential(credentialId: number, orgId: number) {
  const [cred] = await db
    .select()
    .from(workspaceDbCredentials)
    .where(and(eq(workspaceDbCredentials.id, credentialId), eq(workspaceDbCredentials.organizationId, orgId)));
  return cred ?? null;
}

function createPool(cred: {
  id: number;
  dbType: string;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  encryptedPassword: string;
}): pg.Pool {
  const cached = poolCache.get(cred.id);
  if (cached && cached.expiresAt > Date.now()) return cached.pool;

  const password = decrypt(cred.encryptedPassword);
  const pool = new pg.Pool({
    host: cred.host,
    port: cred.port,
    database: cred.databaseName,
    user: cred.username,
    password,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: cred.host !== "localhost" && cred.host !== "127.0.0.1" ? { rejectUnauthorized: false } : undefined,
  });

  poolCache.set(cred.id, { pool, expiresAt: Date.now() + POOL_TTL_MS });
  return pool;
}

const DESTRUCTIVE = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|COPY|EXECUTE|DO\s+\$\$)\b/i;
const SIDE_EFFECTS = /\b(setval|nextval|pg_sleep|dblink|lo_import|lo_export|copy_to|copy_from)\s*\(/i;

function validateSql(sql: string): string | null {
  if (!/^(SELECT|WITH)\s/i.test(sql)) return "Only SELECT queries are permitted.";
  if (DESTRUCTIVE.test(sql)) return "Query rejected: destructive SQL keyword detected.";
  if (SIDE_EFFECTS.test(sql)) return "Query rejected: side-effect function call detected.";
  return null;
}

export async function testConnection(credentialId: number, orgId: number): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
  const cred = await getCredential(credentialId, orgId);
  if (!cred) return { ok: false, message: "Credential not found" };

  if (cred.dbType === "bigquery") {
    return { ok: false, message: "BigQuery test connection not yet supported" };
  }

  const start = Date.now();
  const pool = createPool(cred);
  const client = await pool.connect();
  try {
    // 10s connect/query cap is enforced by pool.connectionTimeoutMillis;
    // pg's QueryConfig type does not include "timeout".
    await client.query("SELECT 1 AS ping");
    const latencyMs = Date.now() - start;

    await db
      .update(workspaceDbCredentials)
      .set({ status: "connected", lastTestedAt: new Date(), updatedAt: new Date() })
      .where(eq(workspaceDbCredentials.id, credentialId));

    return { ok: true, message: "Connection successful", latencyMs };
  } catch (err: any) {
    await db
      .update(workspaceDbCredentials)
      .set({ status: "error", updatedAt: new Date() })
      .where(eq(workspaceDbCredentials.id, credentialId));

    poolCache.delete(cred.id);
    return { ok: false, message: err.message || "Connection failed" };
  } finally {
    client.release();
  }
}

export async function executeUserQuery(
  credentialId: number,
  orgId: number,
  sqlQuery: string,
): Promise<{ success: boolean; message: string; data?: any }> {
  const validationError = validateSql(sqlQuery);
  if (validationError) return { success: false, message: validationError };

  const cred = await getCredential(credentialId, orgId);
  if (!cred) return { success: false, message: "Database credential not found" };
  if (cred.status !== "connected") return { success: false, message: "Database connection has not been verified. Please test the connection first." };

  if (cred.dbType !== "postgres" && cred.dbType !== "mysql") {
    return { success: false, message: `Dynamic querying for ${cred.dbType} is not yet implemented` };
  }

  const safeSql = sqlQuery.replace(/;\s*$/, "");
  const existingLimit = safeSql.match(/\bLIMIT\s+(\d+)/i);
  let limited: string;
  if (existingLimit) {
    const requested = parseInt(existingLimit[1], 10);
    limited = requested > MAX_ROWS
      ? safeSql.replace(/\bLIMIT\s+\d+/i, `LIMIT ${MAX_ROWS}`)
      : safeSql;
  } else {
    limited = `${safeSql} LIMIT ${MAX_ROWS}`;
  }

  const pool = createPool(cred);
  const client = await pool.connect();
  try {
    await client.query("SET statement_timeout = $1", [QUERY_TIMEOUT_MS]);
    await client.query("SET default_transaction_read_only = ON");

    // statement_timeout (set above) is the authoritative cap; the
    // QueryConfig "timeout" field doesn't exist in pg's TS types.
    const result = await client.query<Record<string, unknown>>(limited);
    const rows = result.rows;

    if (rows.length === 0) {
      return { success: true, message: "Query returned 0 rows.", data: { row_count: 0, rows: [] } };
    }

    const columns = Object.keys(rows[0]);
    return {
      success: true,
      message: `Query returned ${rows.length} row(s). Columns: ${columns.join(", ")}.`,
      data: {
        row_count: rows.length,
        columns,
        rows,
        note: rows.length >= MAX_ROWS ? `Result capped at ${MAX_ROWS} rows — add a more specific WHERE clause.` : undefined,
      },
    };
  } catch (err: any) {
    logger.error({ err, credentialId }, "executeUserQuery failed");
    return { success: false, message: `Query error: ${err.message || String(err)}` };
  } finally {
    client.release();
  }
}

export async function getWorkspaceCredentials(orgId: number, workspaceId?: number) {
  const creds = await db
    .select({
      id: workspaceDbCredentials.id,
      workspaceId: workspaceDbCredentials.workspaceId,
      dbType: workspaceDbCredentials.dbType,
      label: workspaceDbCredentials.label,
      host: workspaceDbCredentials.host,
      port: workspaceDbCredentials.port,
      databaseName: workspaceDbCredentials.databaseName,
      username: workspaceDbCredentials.username,
      status: workspaceDbCredentials.status,
      lastTestedAt: workspaceDbCredentials.lastTestedAt,
      createdAt: workspaceDbCredentials.createdAt,
    })
    .from(workspaceDbCredentials)
    .where(eq(workspaceDbCredentials.organizationId, orgId));

  return creds;
}
