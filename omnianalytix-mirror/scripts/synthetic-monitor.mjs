#!/usr/bin/env node
/**
 * scripts/synthetic-monitor.mjs
 *
 * Phase 5 — Production observability. Runs the same checks as the
 * pre-deploy smoke gate but against a remote (production) base URL on a
 * schedule. Emits a one-line JSON status object and exits 0 / 1.
 *
 * Wire to any cron-style runner (cron-job.org, UptimeRobot custom check,
 * Replit scheduled deployment, GitHub Actions schedule). Non-zero exit =
 * outage; the runner should page on that.
 *
 * Required env:
 *   PREFLIGHT_API_BASE   e.g. https://api.omnianalytix.in
 *   SESSION_SECRET       same value the prod server is signing JWTs with
 *
 * Optional env:
 *   SYNTHETIC_ALERT_WEBHOOK   if set, POSTs the failure JSON to this URL
 *                             (Slack, PagerDuty, Sentry webhook, etc.)
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SMOKE = resolve(__dirname, "preflight-smoke.mjs");

const startedAt = new Date().toISOString();
const base      = process.env.PREFLIGHT_API_BASE || "(not set)";

const child = spawnSync(process.execPath, [SMOKE], {
  env: process.env,
  encoding: "utf8",
});

const ok = child.status === 0;
const status = {
  service:   "omnianalytix-api",
  startedAt,
  finishedAt: new Date().toISOString(),
  base,
  ok,
  exitCode:  child.status,
  // Trim noisy lines; keep only fail markers + final summary.
  summary:   String(child.stdout || "")
                .split("\n")
                .filter(l => /FAIL|preflight:smoke/.test(l))
                .slice(-10)
                .join("\n"),
};

console.log(JSON.stringify(status));

if (!ok && process.env.SYNTHETIC_ALERT_WEBHOOK) {
  try {
    await fetch(process.env.SYNTHETIC_ALERT_WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body:    JSON.stringify({
        text: `:rotating_light: synthetic-monitor FAIL (${base})\n\`\`\`${status.summary}\`\`\``,
        ...status,
      }),
    });
  } catch (err) {
    console.error("synthetic-monitor: webhook delivery failed:", err.message);
  }
}

process.exit(ok ? 0 : 1);
