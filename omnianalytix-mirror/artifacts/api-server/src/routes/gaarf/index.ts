/**
 * GAARF API routes
 *
 * Exposes the Google Ads API Report Fetcher (GAARF) query engine
 * via authenticated REST endpoints so the OmniAnalytix frontend and
 * ADK agents can run structured GAQL queries against a workspace's
 * connected Google Ads account.
 *
 * Endpoints:
 *   GET  /api/gaarf/queries          — list all named query templates
 *   GET  /api/gaarf/queries/:name    — fetch a single named query template
 *   POST /api/gaarf/run              — run an ad-hoc GAQL query (returns rows)
 *   POST /api/gaarf/queries/:name/run — run a named template (returns rows)
 */

import { Router } from "express";
import { z } from "zod";
import { AdsQueryExecutor } from "google-ads-api-report-fetcher";
import { buildGaarfClient } from "../../lib/gaarf/client";
import { ArrayWriter } from "../../lib/gaarf/writer";
import { GAARF_QUERIES } from "../../lib/gaarf/queries";
import { handleRouteError } from "../../lib/route-error-handler";
import { logger } from "../../lib/logger";

const router = Router();

// ── List named query templates ─────────────────────────────────────────────

router.get("/queries", (_req, res) => {
  const templates = Object.values(GAARF_QUERIES).map(({ name, description, requiredMacros, defaultMacros }) => ({
    name,
    description,
    requiredMacros,
    defaultMacros,
  }));
  res.json(templates);
});

router.get("/queries/:name", (req, res) => {
  const tpl = GAARF_QUERIES[req.params.name];
  if (!tpl) {
    res.status(404).json({ error: `No query template named "${req.params.name}"` });
    return;
  }
  res.json(tpl);
});

// ── Shared execution helper ────────────────────────────────────────────────

async function runGaarfQuery(
  orgId: number | null | undefined,
  queryText: string,
  scriptName: string,
  macros: Record<string, string> = {},
  customerIdOverride?: string,
): Promise<{ columns: string[]; rows: unknown[][]; rowCount: number; customerId: string; scriptName: string }> {
  const { client, customerId: defaultCustomerId } = await buildGaarfClient(orgId);
  const targetCustomerId = customerIdOverride
    ? customerIdOverride.replace(/-/g, "")
    : defaultCustomerId;

  const executor = new AdsQueryExecutor(client);
  const query = await executor.parseQuery(queryText, scriptName, { macros });

  const writer = new ArrayWriter();
  await writer.beginScript(scriptName, query);
  await executor.executeOne(query, targetCustomerId, writer, scriptName);
  await writer.endScript();

  return writer.getResult();
}

// ── Run ad-hoc GAQL query ─────────────────────────────────────────────────

const RunAdHocBody = z.object({
  query: z.string().min(10, "query must be at least 10 characters"),
  macros: z.record(z.string()).optional().default({}),
  customer_id: z.string().optional(),
  script_name: z.string().optional().default("ad_hoc"),
});

router.post("/run", async (req, res) => {
  try {
    const parsed = RunAdHocBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", issues: parsed.error.issues });
      return;
    }

    const { query, macros, customer_id, script_name } = parsed.data;
    const orgId = (req as unknown as { orgId?: number }).orgId;

    logger.info({ orgId, script_name }, "[GAARF] Running ad-hoc query");

    const result = await runGaarfQuery(orgId, query, script_name, macros, customer_id);

    res.json({
      scriptName: result.scriptName,
      customerId: result.customerId,
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
    });
  } catch (err) {
    handleRouteError(err, req, res, "POST /gaarf/run");
  }
});

// ── Run a named query template ─────────────────────────────────────────────

const RunNamedBody = z.object({
  macros: z.record(z.string()).optional().default({}),
  customer_id: z.string().optional(),
});

router.post("/queries/:name/run", async (req, res) => {
  try {
    const tpl = GAARF_QUERIES[req.params.name];
    if (!tpl) {
      res.status(404).json({ error: `No query template named "${req.params.name}"` });
      return;
    }

    const parsed = RunNamedBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", issues: parsed.error.issues });
      return;
    }

    const { macros: userMacros, customer_id } = parsed.data;
    const macros = { ...tpl.defaultMacros, ...userMacros };

    const orgId = (req as unknown as { orgId?: number }).orgId;

    logger.info({ orgId, queryName: tpl.name, macros }, "[GAARF] Running named query");

    const result = await runGaarfQuery(orgId, tpl.gaql, tpl.name, macros, customer_id);

    res.json({
      queryName: tpl.name,
      description: tpl.description,
      customerId: result.customerId,
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      objects: result.rows.map((row) =>
        Object.fromEntries(result.columns.map((col, i) => [col, row[i]])),
      ),
    });
  } catch (err) {
    handleRouteError(err, req, res, `POST /gaarf/queries/${req.params.name}/run`);
  }
});

export default router;
