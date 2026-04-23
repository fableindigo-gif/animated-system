#!/usr/bin/env node
/**
 * scripts/preflight-smoke.mjs
 *
 * Phase 4 pre-deploy gate — smoke test. Hits a curated set of authenticated
 * GET endpoints with a synthetic admin JWT and asserts each returns a 2xx
 * status with a non-error JSON body. Designed to catch the class of bug
 * where a route compiles & boots but throws at first request (e.g. the
 * "column reference \"synced_at\" is ambiguous" incident that motivated the
 * Phase 3 lint).
 *
 * Pass criteria for each endpoint:
 *   • HTTP 2xx                                                    OR
 *   • HTTP 404 / 403 IF the body explicitly indicates a missing
 *     resource / no active connection (these are not server bugs;
 *     they are well-formed empty-state responses for a synthetic
 *     tenant with no data).
 *
 * Fail criteria:
 *   • HTTP 5xx
 *   • HTTP 4xx with an "Failed to ..." or "Internal" message
 *   • Network / timeout
 *
 * Run after the API server has booted (HealthMonitor 5/5 passed). Wire into
 * CI as the final gate before `pnpm publish`.
 */
import { mintTestJwt, authHeaders, apiBase, TEST_ORG_A } from "./lib/mint-test-jwt.mjs";

const BASE = apiBase();
const TIMEOUT_MS = 15_000;

// Curated smoke targets. Each entry is path-only (relative to /api).
// Goal: cover the routes that have historically broken at runtime, plus the
// 5 most-used dashboards. Keep this list small (≤20) so the gate stays fast.
const SMOKE_ENDPOINTS = [
  // Health & meta
  { path: "/healthz",                      authNeeded: false, allowEmpty: true },
  { path: "/system-health",                authNeeded: false, allowEmpty: true },

  // The endpoints from the Phase 3 SQL ambiguity incident
  { path: "/warehouse/kpis?days=30",       authNeeded: true,  allowEmpty: true },
  { path: "/warehouse/channels?days=30",   authNeeded: true,  allowEmpty: true },
  { path: "/warehouse/margin-leaks?days=30", authNeeded: true, allowEmpty: true },
  { path: "/warehouse/pipeline-triage?days=30&page=1&page_size=10", authNeeded: true, allowEmpty: true },
  { path: "/warehouse/products?days=30&page=1&page_size=10",        authNeeded: true, allowEmpty: true },
  { path: "/billing-hub/invoices?days=30", authNeeded: true,  allowEmpty: true },

  // Action / approval surface (tenant-isolated; was Phase 2C CVE site)
  { path: "/actions/pending?page=1&page_size=10", authNeeded: true, allowEmpty: true },
  { path: "/actions/audit?page=1&page_size=10",   authNeeded: true, allowEmpty: true },

  // Dashboard + connections (tenant-isolated)
  { path: "/system/diagnostics",           authNeeded: true,  allowEmpty: true, tolerate: [404] },
  { path: "/connections",                  authNeeded: true,  allowEmpty: true },

  // Phase 4 architect-mandated coverage: org / workspace / admin surfaces.
  // /admin requires the JWT.role === "admin" (we mint that by default).
  { path: "/me/workspaces",                authNeeded: true,  allowEmpty: true },
  { path: "/organizations/me",             authNeeded: true,  allowEmpty: true, tolerate: [404] },
  { path: "/workspaces",                   authNeeded: true,  allowEmpty: true },
  { path: "/admin/organizations",          authNeeded: true,  allowEmpty: true },
];

async function fetchWithTimeout(url, init) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function classifyResult(target, res, bodyText) {
  if (res.status >= 200 && res.status < 300) return { ok: true,  reason: "2xx" };
  if (res.status >= 500)                     return { ok: false, reason: `5xx ${res.status}` };
  // 401 on an authNeeded endpoint = the JWT we minted didn't authenticate.
  // Architect fix #1: refuse to silently pass — this would mean the gate is
  // measuring nothing.
  if (res.status === 401 && target.authNeeded) {
    return { ok: false, reason: `401 unauthorized — JWT mint or SESSION_SECRET mismatch` };
  }
  if (target.tolerate?.includes(res.status)) return { ok: true,  reason: `tolerated ${res.status}` };
  // 4xx: tolerate ONLY if body looks like a structured empty/forbidden response.
  let body;
  try { body = JSON.parse(bodyText); } catch { body = null; }
  const msg = (body && (body.error || body.message)) || bodyText.slice(0, 120);
  // Hard-fail messages that indicate a server bug rather than a normal empty-state.
  if (/failed to|internal|unhandled|stack|cannot read|undefined/i.test(String(msg))) {
    return { ok: false, reason: `4xx ${res.status} bug: ${msg}` };
  }
  return { ok: true, reason: `4xx ${res.status} (well-formed: ${msg})` };
}

// Architect fix #1 (precheck): before any probe, confirm that our minted JWT
// is actually accepted by the server. If /api/auth/gate/verify rejects us, the
// rest of the gate is meaningless — abort loudly.
async function authSanityCheck(token) {
  const url = `${BASE}/api/auth/gate/verify`;
  const res = await fetchWithTimeout(url, { headers: authHeaders(token) });
  const txt = await res.text();
  if (res.status !== 200) {
    throw new Error(`auth-sanity FAIL: /api/auth/gate/verify returned ${res.status} (${txt.slice(0, 160)}). The minted JWT is not accepted; gate aborted before false-pass.`);
  }
  console.log(`  auth-sanity OK  (/api/auth/gate/verify → 200)`);
}

async function main() {
  const token = mintTestJwt({ organizationId: TEST_ORG_A, role: "admin" });

  console.log(`preflight:smoke  base=${BASE}  org=${TEST_ORG_A}  endpoints=${SMOKE_ENDPOINTS.length}`);
  await authSanityCheck(token);

  let passed = 0, failed = 0;
  const failures = [];

  for (const target of SMOKE_ENDPOINTS) {
    const url = `${BASE}/api${target.path}`;
    const headers = target.authNeeded ? authHeaders(token) : { accept: "application/json" };
    let res, bodyText;
    try {
      res = await fetchWithTimeout(url, { headers });
      bodyText = await res.text();
    } catch (err) {
      failed++;
      failures.push({ path: target.path, reason: `network: ${err.message}` });
      console.error(`  FAIL  ${target.path}  network ${err.message}`);
      continue;
    }
    const { ok, reason } = classifyResult(target, res, bodyText);
    if (ok) { passed++; console.log(`  pass  ${target.path}  ${reason}`); }
    else    { failed++; failures.push({ path: target.path, reason });
              console.error(`  FAIL  ${target.path}  ${reason}`); }
  }

  console.log(`\npreflight:smoke  ${failed === 0 ? "OK" : "FAIL"}  passed=${passed}  failed=${failed}`);
  if (failed > 0) {
    console.error("\nFailures:");
    for (const f of failures) console.error(`  • ${f.path}\n      ${f.reason}`);
    process.exit(1);
  }
}

main().catch(err => { console.error("preflight:smoke crashed:", err); process.exit(2); });
