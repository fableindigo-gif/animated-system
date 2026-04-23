import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { HealthCheckResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── Liveness: cheap, always-200 if process is up ─────────────────────────────
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// ── Readiness/deep health: probes critical dependencies ──────────────────────
// Returns 200 only if every "required" dependency is healthy. Optional
// dependencies (e.g. dbt marts, Vertex SDK) report status but don't fail the
// endpoint — they're observability signals, not gates.
//
// Designed for uptime monitors (StatusCake, BetterStack, etc.) and the
// /api/system/status dashboard. Each probe has its own timeout so a single
// hung dependency cannot wedge the whole check.
type ProbeStatus = "ok" | "degraded" | "fail" | "skipped";
interface Probe {
  name:     string;
  required: boolean;
  status:   ProbeStatus;
  latencyMs: number;
  detail?:  string;
}

const PROBE_TIMEOUT_MS = 2_000;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  // Race the work against a timeout, but ALWAYS clear the timer when the work
  // settles so we don't leak setTimeout handles on every successful health
  // check (would delay graceful shutdown and add tiny but real GC pressure
  // on a frequently-polled endpoint).
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`probe timeout >${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function probe(name: string, required: boolean, fn: () => Promise<string | void>): Promise<Probe> {
  const start = Date.now();
  try {
    const detail = await withTimeout(Promise.resolve(fn()), PROBE_TIMEOUT_MS);
    return { name, required, status: "ok", latencyMs: Date.now() - start, ...(detail ? { detail } : {}) };
  } catch (err) {
    return {
      name, required,
      status: required ? "fail" : "degraded",
      latencyMs: Date.now() - start,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

router.get("/healthz/deep", async (req, res) => {
  const probes: Probe[] = await Promise.all([
    // Postgres: cheapest possible round-trip
    probe("postgres", true, async () => {
      const r = await db.execute(sql`SELECT 1 AS one`);
      if (!r) throw new Error("empty result");
    }),
    // ADK sessions table is writable (proxy for agent flow health)
    probe("adk_sessions", true, async () => {
      await db.execute(sql`SELECT 1 FROM adk_sessions LIMIT 1`);
    }),
    // dbt marts present (optional — no failure if dbt hasn't run)
    probe("dbt_marts", false, async () => {
      const r = await db.execute(sql`
        SELECT to_regclass('public_analytics.poas_by_sku') IS NOT NULL AS present
      `);
      const row = (r as unknown as { rows?: Array<{ present: boolean }> }).rows?.[0];
      if (!row?.present) throw new Error("public_analytics.poas_by_sku not present (run dbt build)");
    }),
    // Vertex/Gemini reachable (optional — agent endpoints would surface their own errors)
    probe("vertex_credentials", false, async () => {
      if (!process.env.VERTEX_AI_SERVICE_ACCOUNT_JSON && !process.env.GEMINI_API_KEY) {
        throw new Error("no Vertex/Gemini credentials in env");
      }
    }),
  ]);

  const overallOk = probes.every((p) => !p.required || p.status === "ok");
  const status = overallOk ? "ok" : "fail";
  if (!overallOk) {
    logger.warn({ probes }, "[health] /healthz/deep failed");
  }

  // Default response is intentionally minimal: probe NAMES + status + latency
  // are fine for uptime monitors but error MESSAGES (table names, missing
  // creds, etc.) get redacted unless the caller proves it's an internal
  // operator. This avoids leaking internals to anyone who curls the public
  // proxy. Set INTERNAL_HEALTH_TOKEN in env and pass `?token=…` to see
  // detailed `detail` fields. Detailed errors are always logged server-side.
  const internalToken = process.env.INTERNAL_HEALTH_TOKEN;
  const verbose = !!internalToken && req.query.token === internalToken;
  const safeProbes = verbose
    ? probes
    : probes.map(({ name, required, status, latencyMs }) => ({ name, required, status, latencyMs }));

  res.status(overallOk ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    probes: safeProbes,
  });
});

export default router;
