import { BigQuery, type Query } from "@google-cloud/bigquery";
import type { Readable } from "node:stream";
import { logger } from "./logger";

export interface BigQueryConfig {
  projectId: string;
  location: string;
  credentials?: { client_email: string; private_key: string };
  keyFilename?: string;
}

export class BigQueryConfigError extends Error {
  readonly code = "BIGQUERY_NOT_CONFIGURED" as const;
  constructor(message: string) {
    super(message);
    this.name = "BigQueryConfigError";
  }
}

let cachedClient: BigQuery | null = null;
let cachedConfig: BigQueryConfig | null = null;

function loadConfigFromEnv(): BigQueryConfig {
  const projectId = process.env.SHOPPING_INSIDER_BQ_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    throw new BigQueryConfigError(
      "SHOPPING_INSIDER_BQ_PROJECT_ID is not set. Configure the GCP project that hosts the Shopping Insider BigQuery datasets.",
    );
  }
  const location = process.env.SHOPPING_INSIDER_BQ_LOCATION || "US";

  const inlineKey = process.env.SHOPPING_INSIDER_GCP_SA_KEY;
  const keyFilename = process.env.SHOPPING_INSIDER_GCP_SA_KEY_FILE || process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (inlineKey) {
    let parsed: { client_email?: string; private_key?: string };
    try {
      parsed = JSON.parse(inlineKey);
    } catch (err) {
      throw new BigQueryConfigError(
        `SHOPPING_INSIDER_GCP_SA_KEY is not valid JSON: ${(err as Error).message}`,
      );
    }
    if (!parsed.client_email || !parsed.private_key) {
      throw new BigQueryConfigError(
        "SHOPPING_INSIDER_GCP_SA_KEY is missing client_email or private_key.",
      );
    }
    return {
      projectId,
      location,
      credentials: { client_email: parsed.client_email, private_key: parsed.private_key },
    };
  }

  if (keyFilename) {
    return { projectId, location, keyFilename };
  }

  throw new BigQueryConfigError(
    "No GCP service-account credentials found. Set SHOPPING_INSIDER_GCP_SA_KEY (inline JSON) or SHOPPING_INSIDER_GCP_SA_KEY_FILE (path) or GOOGLE_APPLICATION_CREDENTIALS.",
  );
}

export function getBigQueryClient(): BigQuery {
  if (cachedClient) return cachedClient;
  const cfg = loadConfigFromEnv();
  cachedConfig = cfg;
  cachedClient = new BigQuery({
    projectId: cfg.projectId,
    location: cfg.location,
    credentials: cfg.credentials,
    keyFilename: cfg.keyFilename,
  });
  return cachedClient;
}

export function getBigQueryConfig(): BigQueryConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfigFromEnv();
  }
  return cachedConfig;
}

export interface RunQueryOptions {
  params?: Record<string, unknown>;
  types?: Record<string, string>;
  maximumBytesBilled?: string;
  timeoutMs?: number;
}

export interface QueryStats<T> {
  rows: T[];
  /** BigQuery-reported total bytes processed for this query (0 if unknown). */
  totalBytesProcessed: number;
}

export async function runQueryWithStats<T = Record<string, unknown>>(
  sql: string,
  opts: RunQueryOptions = {},
): Promise<QueryStats<T>> {
  const client = getBigQueryClient();
  const cfg = getBigQueryConfig();
  const query: Query = {
    query: sql,
    location: cfg.location,
    params: opts.params,
    types: opts.types,
    useLegacySql: false,
    maximumBytesBilled: opts.maximumBytesBilled ?? process.env.SHOPPING_INSIDER_BQ_MAX_BYTES ?? "1000000000",
    jobTimeoutMs: opts.timeoutMs ?? 30_000,
  };
  try {
    // Use createQueryJob so we can read job statistics (totalBytesProcessed)
    // — we need that to estimate cache savings.
    const [job] = await client.createQueryJob(query);
    const [rows] = await job.getQueryResults();
    let totalBytesProcessed = 0;
    const meta = job.metadata as { statistics?: { query?: { totalBytesProcessed?: string | number } } } | undefined;
    const raw = meta?.statistics?.query?.totalBytesProcessed;
    if (raw != null) {
      const n = typeof raw === "string" ? Number(raw) : raw;
      if (Number.isFinite(n)) totalBytesProcessed = n;
    }
    return { rows: rows as T[], totalBytesProcessed };
  } catch (err) {
    logger.error({ err, sql: sql.slice(0, 200) }, "BigQuery query failed");
    // Re-map dataset/table-not-found into BigQueryConfigError so callers can
    // surface the same loud-fail UX as missing credentials.
    const msg = err instanceof Error ? err.message : String(err);
    if (/Not found: (Dataset|Table)/i.test(msg)) {
      throw new BigQueryConfigError(
        `BigQuery resource not found — check SHOPPING_INSIDER_BQ_DATASET and SHOPPING_INSIDER_TABLE_* env vars. Underlying error: ${msg}`,
      );
    }
    throw err;
  }
}

export async function runQuery<T = Record<string, unknown>>(
  sql: string,
  opts: RunQueryOptions = {},
): Promise<T[]> {
  const { rows } = await runQueryWithStats<T>(sql, opts);
  return rows;
}

/**
 * Stream BigQuery query results row-by-row instead of buffering them in memory.
 * Returns a Node Readable in object mode where each chunk is a row object.
 *
 * Use this for large exports where loading the full result set would balloon
 * memory. Backpressure is honored via the underlying BigQuery client stream.
 */
export function createQueryRowStream(sql: string, opts: RunQueryOptions = {}): Readable {
  const client = getBigQueryClient();
  const cfg = getBigQueryConfig();
  const query: Query = {
    query: sql,
    location: cfg.location,
    params: opts.params,
    types: opts.types,
    useLegacySql: false,
    maximumBytesBilled: opts.maximumBytesBilled ?? process.env.SHOPPING_INSIDER_BQ_MAX_BYTES ?? "1000000000",
    jobTimeoutMs: opts.timeoutMs ?? 120_000,
  };
  // createQueryStream returns a Readable that emits row objects.
  return client.createQueryStream(query) as unknown as Readable;
}

/**
 * Validate a BigQuery identifier (dataset or table name) so we can safely
 * interpolate it into SQL. BigQuery identifiers are letters/digits/underscores;
 * we reject anything else loudly.
 */
export function safeIdent(name: string, kind: "dataset" | "table" = "table"): string {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new BigQueryConfigError(`Invalid BigQuery ${kind} name: ${name}`);
  }
  return name;
}

/** Boot-time validation. Resolves true if config + auth + a trivial query succeed. */
export async function validateBigQueryOnBoot(): Promise<{ ok: boolean; message: string }> {
  try {
    const cfg = getBigQueryConfig();
    await runQuery<{ one: number }>("SELECT 1 AS one", { timeoutMs: 10_000 });
    return { ok: true, message: `BigQuery reachable (project=${cfg.projectId}, location=${cfg.location}).` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message };
  }
}
