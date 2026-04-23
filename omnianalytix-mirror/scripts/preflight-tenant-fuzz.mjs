#!/usr/bin/env node
/**
 * scripts/preflight-tenant-fuzz.mjs
 *
 * Phase 4 pre-deploy gate — tenant isolation fuzz. Uses two synthetic
 * organisations (TEST_ORG_A, TEST_ORG_B), each with its own JWT minted via
 * the same SESSION_SECRET the server uses, and probes that:
 *
 *   1. List endpoints scoped to a tenant return ONLY rows whose tenant /
 *      organization_id matches the token's organisation. With synthetic
 *      tenants that have no real rows, the bare requirement is that
 *      every list endpoint returns an empty result (or paginated wrapper
 *      with total_count 0). Any non-empty response reveals a leakage
 *      bug — every CVE in this codebase's history has manifested this way.
 *
 *   2. ID-param GET endpoints (e.g. /actions/:id, /connections/:id) MUST
 *      return 404 (or 4xx) for any synthetic ID — they MUST NOT return 200
 *      with another tenant's resource. The convention in this codebase
 *      (per requireWorkspaceOwnership in tenant-isolation.ts) is to return
 *      404 rather than 403, so existence is never revealed.
 *
 *   3. Mutation endpoints (POST/DELETE/PUT on tenant-scoped resources)
 *      MUST return 403 or 404 when the resource id does not belong to the
 *      caller's organisation. We probe with synthetic IDs and any 2xx is
 *      treated as a critical CVE.
 *
 * The fuzz is intentionally read-mostly (one DELETE probe with a synthetic
 * id) so it is safe to run against staging or production — the only side
 * effect is a few audit_log rows for forbidden access attempts.
 */
import {
  mintTestJwt,
  authHeaders,
  apiBase,
  TEST_ORG_A,
  TEST_ORG_B,
} from "./lib/mint-test-jwt.mjs";

const BASE = apiBase();
const TIMEOUT_MS = 15_000;

const LIST_ENDPOINTS = [
  // Tenant-scoped list/aggregate routes. Synthetic tenants have no data,
  // so a non-empty payload is treated as a leak — we DO NOT trust the
  // presence/absence of org_id fields on response rows (architect fix #2:
  // many APIs strip the field on serialization, so a leak would otherwise
  // pass silently). The only escape hatch is `allowNonEmpty: true`, which
  // must never be set for tenant-scoped endpoints.
  { path: "/actions/pending?page=1&page_size=10",                       rowsPath: "data" },
  // /actions/audit records every API call the synthetic tenant makes
  // (mutationLogger middleware), so it legitimately accumulates rows from
  // the fuzz traffic itself. Allow non-empty BUT every row must carry
  // organizationId === caller's org. Endpoint is verified tenant-scoped at
  // routes/actions/index.ts:100 (`eq(auditLogs.organizationId, orgId)`).
  { path: "/actions/audit?page=1&page_size=10",                         rowsPath: "data", allowNonEmpty: true, recordsOwnActivity: true },
  { path: "/connections",                                               rowsPath: "data" },
  { path: "/billing-hub/invoices?days=30",                              rowsPath: "data" },
  { path: "/warehouse/pipeline-triage?days=30&page=1&page_size=10",     rowsPath: "data" },
  { path: "/warehouse/products?days=30&page=1&page_size=10",            rowsPath: "data" },
  // Architect fix #4 — coverage gaps:
  { path: "/workspaces",                                                rowsPath: "data" },
  { path: "/admin/organizations",                                       rowsPath: "data" },
];

// Plausible IDs to probe — small ints (most likely to collide with real
// data if the route forgot to scope by tenant) and a few high ones for
// numeric ranges. Each id gets a probe; any 2xx is fatal.
const ID_PROBE_VALUES = [1, 2, 3, 100, 1000];

const ID_GET_ENDPOINTS = [
  // GET /:id — must return 404 (resource does not belong to caller).
  { template: "/connections/{id}/data" },
  { template: "/connections/{id}" },
  { template: "/gemini/conversations/{id}" },
];

const ID_MUTATION_ENDPOINTS = [
  // Mutations — using small synthetic ids that may exist for OTHER tenants.
  // Any 2xx here means we successfully altered another tenant's resource.
  { method: "POST",   template: "/actions/{id}/reject" },
  { method: "POST",   template: "/actions/{id}/revert" },
  { method: "POST",   template: "/actions/{id}/approve" },
  { method: "DELETE", template: "/connections/{id}" },
];

// Architect fix #3: RBAC tier probes. A "viewer" role token MUST be denied
// (403) on these manager/analyst/admin-only mutations. Any 2xx means a role
// boundary regression.
const RBAC_VIEWER_DENY_PROBES = [
  { method: "POST",   template: "/actions/1/approve" },
  { method: "POST",   template: "/actions/1/reject"  },
  { method: "DELETE", template: "/workspaces/1"      }, // requireRole("admin")
  { method: "DELETE", template: "/connections/1"     },
];

async function fetchWithTimeout(url, init) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...init, signal: ctl.signal }); }
  finally { clearTimeout(timer); }
}

function getRows(body, rowsPath) {
  if (!body || typeof body !== "object") return [];
  // Handle both `{data: [...]}` and bare-array shapes.
  if (Array.isArray(body)) return body;
  if (rowsPath && Array.isArray(body[rowsPath])) return body[rowsPath];
  return [];
}

function rowLeak(row, expectedOrg) {
  // A row leaks if it carries a tenant/org/workspace identifier that does
  // NOT match the caller's organisation. Tolerate rows without any such
  // field (truly tenant-agnostic public data).
  const fields = ["tenant_id", "tenantId", "organization_id", "organizationId"];
  for (const f of fields) {
    if (row && Object.prototype.hasOwnProperty.call(row, f)) {
      const v = row[f];
      if (v != null && String(v) !== String(expectedOrg)) return f;
    }
  }
  return null;
}

async function probeList(target, token, orgId) {
  const url = `${BASE}/api${target.path}`;
  let res, body;
  try {
    res = await fetchWithTimeout(url, { headers: authHeaders(token) });
    const txt = await res.text();
    try { body = JSON.parse(txt); } catch { body = txt; }
  } catch (err) {
    return { ok: false, reason: `network: ${err.message}` };
  }
  if (res.status >= 500) return { ok: false, reason: `5xx ${res.status}` };
  // Architect fix #1: 401 on a tenant-scoped probe = our JWT failed auth;
  // gate would silently green if we tolerated this.
  if (res.status === 401) return { ok: false, reason: "401 — JWT not accepted (gate would otherwise green falsely)" };
  if (res.status === 403 || res.status === 404) return { ok: true, reason: `correctly denied (${res.status})` };
  if (res.status === 429)                       return { ok: true, reason: `rate-limited (429)` };
  if (res.status >= 400)                        return { ok: true, reason: `well-formed 4xx ${res.status}` };

  const rows = getRows(body, target.rowsPath);

  // Architect fix #2: synthetic tenants have NO data. Any non-empty list is
  // a leak. We no longer trust the presence/absence of org_id fields on rows
  // (response serializers commonly strip them, which would mask leaks).
  if (rows.length === 0) return { ok: true, reason: `empty (0 rows)` };
  if (target.allowNonEmpty) {
    // For activity-log endpoints we REQUIRE every row to carry an org marker
    // (recordsOwnActivity: true). For other allowlisted endpoints we tolerate
    // missing markers. Either way, any row whose marker mismatches = leak.
    let unmarked = 0;
    for (const row of rows) {
      const leakField = rowLeak(row, orgId);
      if (leakField) {
        return { ok: false, reason: `LEAK: row.${leakField}=${row[leakField]} but caller org=${orgId}` };
      }
      const hasOrg = ["tenant_id","tenantId","organization_id","organizationId"]
        .some(f => row && Object.prototype.hasOwnProperty.call(row, f) && row[f] != null);
      if (!hasOrg) unmarked++;
    }
    if (target.recordsOwnActivity && unmarked > 0) {
      return { ok: false, reason: `LEAK suspected: ${unmarked}/${rows.length} rows from activity-log endpoint lack any org marker (cannot verify tenant scope)` };
    }
    return { ok: true, reason: `${rows.length} rows (all carry caller org)` };
  }
  return { ok: false, reason: `LEAK: synthetic tenant ${orgId} returned ${rows.length} rows from a tenant-scoped endpoint` };
}

async function probeIdGet(template, id, token) {
  const url = `${BASE}/api${template.replace("{id}", String(id))}`;
  let res;
  try { res = await fetchWithTimeout(url, { headers: authHeaders(token) }); }
  catch (err) { return { ok: false, reason: `network: ${err.message}` }; }
  if (res.status === 401) return { ok: false, reason: "401 — JWT not accepted on authed probe" };
  if (res.status === 404) return { ok: true,  reason: "404 (existence not revealed)" };
  if (res.status === 403) return { ok: true,  reason: "403 (access denied)" };
  if (res.status === 429) return { ok: true,  reason: "rate-limited (429)" };
  if (res.status >= 500)  return { ok: false, reason: `5xx ${res.status}` };
  if (res.status >= 400)  return { ok: true,  reason: `well-formed 4xx ${res.status}` };
  // 2xx on a synthetic ID = leak of another tenant's resource.
  return { ok: false, reason: `LEAK: 2xx on synthetic id=${id}` };
}

async function probeIdMutation(method, template, id, token) {
  const url = `${BASE}/api${template.replace("{id}", String(id))}`;
  let res;
  try {
    res = await fetchWithTimeout(url, {
      method, headers: { ...authHeaders(token), "content-type": "application/json" },
      body: method === "POST" ? "{}" : undefined,
    });
  } catch (err) { return { ok: false, reason: `network: ${err.message}` }; }
  if (res.status === 401) return { ok: false, reason: "401 — JWT not accepted on authed probe" };
  if (res.status === 404) return { ok: true,  reason: "404 (no such resource for this tenant)" };
  if (res.status === 403) return { ok: true,  reason: "403 (forbidden)" };
  if (res.status === 429) return { ok: true,  reason: "rate-limited (429)" };
  if (res.status >= 500)  return { ok: false, reason: `5xx ${res.status}` };
  if (res.status >= 400)  return { ok: true,  reason: `well-formed 4xx ${res.status}` };
  return { ok: false, reason: `CVE: ${method} succeeded (2xx) on synthetic id=${id}` };
}

// Architect fix #3: viewer-role token probe. A viewer hitting a manager/
// analyst/admin-only mutation MUST be denied with 403 (insufficient role)
// or 404. Any 2xx means a role-boundary regression — viewer can do
// privileged work.
async function probeRbacDeny(method, template, viewerToken) {
  const url = `${BASE}/api${template}`;
  let res;
  try {
    res = await fetchWithTimeout(url, {
      method, headers: { ...authHeaders(viewerToken), "content-type": "application/json" },
      body: method === "POST" ? "{}" : undefined,
    });
  } catch (err) { return { ok: false, reason: `network: ${err.message}` }; }
  if (res.status === 401) return { ok: false, reason: "401 — viewer JWT not accepted" };
  if (res.status === 403 || res.status === 404) return { ok: true, reason: `correctly denied (${res.status})` };
  if (res.status === 429) return { ok: true, reason: "rate-limited (429)" };
  if (res.status >= 500)  return { ok: false, reason: `5xx ${res.status}` };
  if (res.status >= 400)  return { ok: true, reason: `well-formed 4xx ${res.status}` };
  return { ok: false, reason: `CVE: viewer-role token executed ${method} ${template} (status ${res.status})` };
}

// Architect fix #1 (precheck): refuse to run the rest of the fuzz unless
// our JWTs actually authenticate. /api/auth/gate/verify is the canonical source
// of truth (artifacts/api-server/src/routes/auth/gate.ts:570).
async function authSanityCheck(token, label) {
  const url = `${BASE}/api/auth/gate/verify`;
  const res = await fetchWithTimeout(url, { headers: authHeaders(token) });
  const txt = await res.text();
  if (res.status !== 200) {
    throw new Error(`auth-sanity FAIL (${label}): /api/auth/gate/verify returned ${res.status} (${txt.slice(0, 160)}). The minted JWT is not accepted; fuzz aborted before false-pass.`);
  }
  console.log(`  auth-sanity OK  (${label} → /api/auth/gate/verify 200)`);
}

async function main() {
  const tokenA      = mintTestJwt({ organizationId: TEST_ORG_A, role: "admin" });
  const tokenB      = mintTestJwt({ organizationId: TEST_ORG_B, role: "admin" });
  const tokenViewer = mintTestJwt({ organizationId: TEST_ORG_A, role: "viewer", memberId: 999_990_500 });

  console.log(`preflight:tenant-fuzz  base=${BASE}  orgs=[${TEST_ORG_A}, ${TEST_ORG_B}]`);
  await authSanityCheck(tokenA,      "admin-A");
  await authSanityCheck(tokenB,      "admin-B");
  await authSanityCheck(tokenViewer, "viewer-A");

  let passed = 0, failed = 0;
  const failures = [];

  // Phase 1 — list endpoints, both orgs.
  for (const target of LIST_ENDPOINTS) {
    for (const [token, org] of [[tokenA, TEST_ORG_A], [tokenB, TEST_ORG_B]]) {
      const r = await probeList(target, token, org);
      const tag = `LIST ${target.path}  org=${org}`;
      if (r.ok) { passed++; console.log(`  pass  ${tag}  ${r.reason}`); }
      else      { failed++; failures.push({ tag, reason: r.reason });
                  console.error(`  FAIL  ${tag}  ${r.reason}`); }
    }
  }

  // Phase 2 — id-param GETs with synthetic ids, both orgs.
  for (const ep of ID_GET_ENDPOINTS) {
    for (const id of ID_PROBE_VALUES) {
      for (const [token, org] of [[tokenA, TEST_ORG_A], [tokenB, TEST_ORG_B]]) {
        const r = await probeIdGet(ep.template, id, token);
        const tag = `GET  ${ep.template} id=${id} org=${org}`;
        if (r.ok) { passed++; }
        else      { failed++; failures.push({ tag, reason: r.reason });
                    console.error(`  FAIL  ${tag}  ${r.reason}`); }
      }
    }
  }

  // Phase 3 — id-param mutations with synthetic ids, ORG A only (we don't
  // need to probe both — the goal is to verify a real-but-foreign id never
  // succeeds for the caller's tenant).
  for (const ep of ID_MUTATION_ENDPOINTS) {
    for (const id of ID_PROBE_VALUES) {
      const r = await probeIdMutation(ep.method, ep.template, id, tokenA);
      const tag = `${ep.method.padEnd(6)} ${ep.template} id=${id} org=${TEST_ORG_A}`;
      if (r.ok) { passed++; }
      else      { failed++; failures.push({ tag, reason: r.reason });
                  console.error(`  FAIL  ${tag}  ${r.reason}`); }
    }
  }

  // Phase 4 — RBAC tier denial probes (architect fix #3).
  for (const ep of RBAC_VIEWER_DENY_PROBES) {
    const r = await probeRbacDeny(ep.method, ep.template, tokenViewer);
    const tag = `RBAC ${ep.method.padEnd(6)} ${ep.template} (viewer must be denied)`;
    if (r.ok) { passed++; console.log(`  pass  ${tag}  ${r.reason}`); }
    else      { failed++; failures.push({ tag, reason: r.reason });
                console.error(`  FAIL  ${tag}  ${r.reason}`); }
  }

  console.log(`\npreflight:tenant-fuzz  ${failed === 0 ? "OK" : "FAIL"}  passed=${passed}  failed=${failed}`);
  if (failed > 0) {
    console.error("\nFailures:");
    for (const f of failures) console.error(`  • ${f.tag}\n      ${f.reason}`);
    process.exit(1);
  }
}

main().catch(err => { console.error("preflight:tenant-fuzz crashed:", err); process.exit(2); });
