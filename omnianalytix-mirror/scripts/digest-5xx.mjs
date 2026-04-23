#!/usr/bin/env node
/**
 * scripts/digest-5xx.mjs
 *
 * Phase 5 — Production observability. Walks the most recent N hours of
 * Sentry issues for the API project and prints a digest grouped by route.
 * Designed to be called daily (cron / scheduled deployment) and piped to a
 * Slack webhook or saved as an artifact.
 *
 * Required env:
 *   SENTRY_AUTH_TOKEN   personal/internal-integration token with
 *                        `event:read` + `project:read` scopes
 *   SENTRY_ORG_SLUG     e.g. `omnianalytix`
 *   SENTRY_PROJECT_SLUG e.g. `api-server`
 *
 * Optional env:
 *   SENTRY_DIGEST_HOURS   default 24
 *   DIGEST_WEBHOOK        if set, POSTs the digest to this URL
 *   DIGEST_API_HOST       defaults to https://sentry.io
 */
const TOKEN  = process.env.SENTRY_AUTH_TOKEN;
const ORG    = process.env.SENTRY_ORG_SLUG;
const PROJ   = process.env.SENTRY_PROJECT_SLUG;
const HOURS  = Number(process.env.SENTRY_DIGEST_HOURS || 24);
const HOST   = process.env.DIGEST_API_HOST || "https://sentry.io";

if (!TOKEN || !ORG || !PROJ) {
  console.error("digest-5xx: missing SENTRY_AUTH_TOKEN / SENTRY_ORG_SLUG / SENTRY_PROJECT_SLUG");
  process.exit(2);
}

// Sentry's issues API — `level:error` covers captured exceptions; we narrow
// to the digest window via statsPeriod. See:
//   https://docs.sentry.io/api/events/list-a-projects-issues/
const url = new URL(`${HOST}/api/0/projects/${ORG}/${PROJ}/issues/`);
url.searchParams.set("query",       `is:unresolved level:error`);
url.searchParams.set("statsPeriod", `${HOURS}h`);
url.searchParams.set("sort",        "freq");
url.searchParams.set("limit",       "50");

const res = await fetch(url, {
  headers: { authorization: `Bearer ${TOKEN}`, accept: "application/json" },
});
if (!res.ok) {
  console.error(`digest-5xx: Sentry API ${res.status} ${await res.text().catch(() => "")}`);
  process.exit(3);
}

const issues = await res.json();
if (!Array.isArray(issues) || issues.length === 0) {
  const empty = `*omnianalytix-api 5xx digest (last ${HOURS}h)* — clean, 0 unresolved errors :white_check_mark:`;
  console.log(empty);
  if (process.env.DIGEST_WEBHOOK) {
    await fetch(process.env.DIGEST_WEBHOOK, {
      method: "POST", headers: { "content-type": "application/json" },
      body:   JSON.stringify({ text: empty }),
    });
  }
  process.exit(0);
}

// Group by `culprit` (Sentry's route/function fingerprint).
const byRoute = new Map();
for (const issue of issues) {
  const key = issue.culprit || issue.metadata?.value || issue.title || "(unknown)";
  const cur = byRoute.get(key) || { count: 0, sample: null, level: issue.level, link: issue.permalink };
  cur.count += Number(issue.count || 0);
  if (!cur.sample) cur.sample = issue.title;
  byRoute.set(key, cur);
}

const ranked = [...byRoute.entries()]
  .sort((a, b) => b[1].count - a[1].count)
  .slice(0, 15);

const lines = [
  `*omnianalytix-api 5xx digest (last ${HOURS}h)* — ${issues.length} unresolved issues`,
  ...ranked.map(([route, info]) =>
    `• \`${route}\` — ${info.count} events — ${info.sample}\n   ${info.link}`),
];
const digest = lines.join("\n");
console.log(digest);

if (process.env.DIGEST_WEBHOOK) {
  await fetch(process.env.DIGEST_WEBHOOK, {
    method: "POST", headers: { "content-type": "application/json" },
    body:   JSON.stringify({ text: digest }),
  });
}
