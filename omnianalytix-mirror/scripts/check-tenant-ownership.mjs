#!/usr/bin/env node
/**
 * Tenant ownership lint — Phase 2C of the reliability program (v2).
 *
 * v1 protected 2 hand-curated tables (kbChunks, kbDocuments) and caught 5
 * CVE-grade leaks in routes/ai-agents/index.ts. v2 expands coverage to **every
 * tenant-scoped table in the schema** by parsing lib/db/src/schema/*.ts and
 * auto-deriving the protected set. As of Apr 2026: 32 direct-tenancy tables
 * (12 with `organizationId`, 20 with `workspaceId`) + 2 parent-FK tables.
 *
 * Two enforcement modes
 * ─────────────────────
 *
 * 1) DIRECT_TENANT (auto-derived) — table has its own `organizationId` or
 *    `workspaceId` column. Any handler doing `db.<delete|update>(table)` or
 *    `.from(table)` must demonstrably scope by that column. We accept ALL of
 *    the following inside the enclosing handler body (anywhere before the
 *    call site):
 *      • `<table>.organizationId` / `<table>.workspaceId` field reference
 *        (i.e. an explicit Drizzle `.where(eq(t.organizationId, ...))`)
 *      • `assertOwns*` / `requireSameOrg` / `requireWorkspaceOwnership` call
 *      • Known org-scope helper variable derived upstream:
 *        `orgScope`, `orgResolutionFilter`, `orgWorkspaceFilter`, or any
 *        local `const filter = ...orgScope...` style binding
 *      • Route-level middleware (`requireSameOrg|requireWorkspaceOwnership`)
 *        on the registration line
 *      • Explicit escape hatch: a `// tenant-ownership-skip: <reason>` comment
 *        on the line above the call site (reason MUST be non-empty).
 *
 * 2) PARENT_FK (manually registered) — table has no own org/ws column and
 *    is scoped via a parent (e.g. `kbDocuments.agentId → aiAgents.organizationId`).
 *    Requires an explicit `assertOwns<Parent>` call. This is the v1 behavior.
 *
 * Algorithm
 * ─────────
 *   1. Parse every lib/db/src/schema/*.ts file. For each `pgTable(...)` block,
 *      detect whether it has an `organizationId` or `workspaceId` column and
 *      register it under the appropriate enforcement mode.
 *   2. Walk every .ts file under artifacts/api-server/src/routes/.
 *   3. For each protected-table call site, ascend to the enclosing handler
 *      and apply the matching enforcement mode. Accept the listed escape
 *      mechanisms; otherwise emit a violation.
 *   4. Print a summary, exit 0 if clean else 1 with file:line traces.
 *
 * To debug: set DEBUG_LINT=1 and the script prints per-violation diagnostics.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT       = join(__dirname, "..");
const SCHEMA_DIR = join(ROOT, "lib/db/src/schema");
const ROUTES_DIR = join(ROOT, "artifacts/api-server/src/routes");
const DEBUG      = process.env.DEBUG_LINT === "1";

// ─── Parent-FK tables (manually registered) ──────────────────────────────────
//
// Tables whose tenancy comes via a parent FK, NOT a direct organizationId/
// workspaceId column. These require an explicit `assertOwns<Parent>` call.
// Map shape: <Drizzle export name> → <snake_case DB table name>.
const PARENT_FK_TABLES = {
  kbChunks:    "kb_chunks",
  kbDocuments: "kb_documents",
};

// ─── Schema parser — auto-derive direct-tenancy tables ───────────────────────
function parseSchema() {
  const orgScoped = new Map();   // drizzleName → snakeName
  const wsScoped  = new Map();
  for (const f of readdirSync(SCHEMA_DIR)) {
    if (f === "index.ts" || !f.endsWith(".ts")) continue;
    const src = readFileSync(join(SCHEMA_DIR, f), "utf8");
    const tables = [...src.matchAll(/export const (\w+) = pgTable\(\s*"([\w_]+)"/g)];
    for (const m of tables) {
      const drizzleName = m[1];
      const snakeName   = m[2];
      // Slice the table block to inspect its columns. End of block is the
      // first `});` line after the pgTable declaration. (pgTable bodies that
      // include WithRowsRLS, indexes etc. close with `}, (table) => {...});`,
      // but the column block we care about is bounded by the FIRST `})`. )
      const startIdx = src.indexOf(`export const ${drizzleName} = pgTable`);
      const endIdx   = src.indexOf("});", startIdx);
      const block    = src.slice(startIdx, endIdx);
      // Detect direct tenancy column. Accept either Drizzle camelCase or the
      // snake_case literal (covers both styles in the codebase).
      if (/\borganizationId\s*:/.test(block) || /"organization_id"/.test(block)) {
        orgScoped.set(drizzleName, snakeName);
      } else if (/\bworkspaceId\s*:/.test(block) || /"workspace_id"/.test(block)) {
        wsScoped.set(drizzleName, snakeName);
      }
    }
  }
  return { orgScoped, wsScoped };
}

const { orgScoped, wsScoped }      = parseSchema();
const DIRECT_TENANT_DRIZZLE        = new Set([...orgScoped.keys(), ...wsScoped.keys()]);
const PARENT_FK_DRIZZLE            = new Set(Object.keys(PARENT_FK_TABLES));
const ALL_PROTECTED_DRIZZLE        = new Set([...DIRECT_TENANT_DRIZZLE, ...PARENT_FK_DRIZZLE]);
// snake_case names for raw-SQL bypass detection
const ALL_PROTECTED_SQL = new Set([
  ...orgScoped.values(),
  ...wsScoped.values(),
  ...Object.values(PARENT_FK_TABLES),
]);

// ─── Acceptance patterns ─────────────────────────────────────────────────────
const ASSERT_OWNS_PATTERN  = /\bassertOwns[A-Z]\w*\s*\(/;
const REQUIRE_MW_PATTERN   = /\b(requireSameOrg|requireWorkspaceOwnership|requireSuperAdmin)\s*\(/;
// Known org-scope helper functions/variables — recognized at the SITE OF USE,
// not at the helper's definition. Adding to this list does not weaken the
// guard: the helper itself must implement org/workspace filtering correctly,
// and that's enforced by code review (a one-time audit per helper).
const ORG_SCOPE_HELPERS = [
  "orgScope",
  "orgResolutionFilter",
  "orgWorkspaceFilter",
  "tenantScope",
];
const ORG_SCOPE_PATTERN = new RegExp(`\\b(?:${ORG_SCOPE_HELPERS.join("|")})\\b`);
const SKIP_COMMENT_PATTERN      = /\/\/\s*tenant-ownership-skip\s*:\s*\S/;
// File-level skip — must appear in the FIRST 30 LINES of the file with a
// non-empty reason. Use sparingly: only for whole-file patterns that the
// per-site escape hatch can't express (super_admin routers mounted with the
// guard at the parent, public OAuth callbacks, public token-as-key endpoints).
const SKIP_FILE_PATTERN         = /\/\/\s*tenant-ownership-skip-file\s*:\s*\S/;

// ─── Tree walk ───────────────────────────────────────────────────────────────
function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e), s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (s.isFile() && (p.endsWith(".ts") || p.endsWith(".tsx"))) yield p;
  }
}

// ─── Find enclosing handler body ────────────────────────────────────────────
function findEnclosingHandler(lines, lineIdx) {
  for (let i = lineIdx; i >= 0; i--) {
    const line = lines[i];
    const m = line.match(/router\.(get|post|put|patch|delete|all|use)\s*\(\s*(["'`])([^"'`]+)\2/);
    if (!m) continue;
    // Find the FIRST `=> {` or `) {` after the router.X() call. (Pre-fix this
    // used the LAST one, which incorrectly locked onto the innermost `if (...)
    // {` block as the "handler body" — yielding a body that didn't contain
    // upstream guard declarations like orgFilter, producing false positives.)
    let openLine = -1, openCol = -1, foundOpen = false;
    for (let j = i; j <= lineIdx && !foundOpen; j++) {
      const candidate = lines[j];
      const arrowIdx = candidate.lastIndexOf("=> {");
      const fnIdx    = candidate.search(/\)\s*{\s*$/);
      const idx = Math.max(arrowIdx, fnIdx);
      if (idx >= 0) { openLine = j; openCol = idx; foundOpen = true; }
    }
    if (!foundOpen) continue;
    let depth = 0, endLine = -1;
    for (let j = openLine; j < lines.length; j++) {
      const text = lines[j];
      let inStr = null, escape = false;
      for (let k = (j === openLine ? openCol : 0); k < text.length; k++) {
        const c = text[k];
        if (escape) { escape = false; continue; }
        if (c === "\\") { escape = true; continue; }
        if (inStr) { if (c === inStr) inStr = null; continue; }
        if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
        if (c === "{") depth++;
        else if (c === "}") { depth--; if (depth === 0) { endLine = j; break; } }
      }
      if (endLine >= 0) break;
    }
    if (endLine < 0) return null;
    if (endLine < lineIdx) continue;
    return {
      route: m[3],
      method: m[1],
      bodyStart: openLine,
      bodyEnd: endLine,
      registrationLine: i,
    };
  }
  return null;
}

// ─── Per-table-mode acceptance check ─────────────────────────────────────────
function isGuardedDirectTenant(linesBefore, registration, table) {
  // Direct field reference like `aiAgents.organizationId` or `t.workspaceId`
  // anywhere in the handler body before the call.
  const directFieldRe = new RegExp(`\\b${table}\\s*\\.\\s*(organizationId|workspaceId)\\b`);
  if (directFieldRe.test(linesBefore)) return "direct field";
  if (ASSERT_OWNS_PATTERN.test(linesBefore))   return "assertOwns";
  if (REQUIRE_MW_PATTERN.test(linesBefore))    return "require middleware";
  if (REQUIRE_MW_PATTERN.test(registration))   return "registration mw";
  if (ORG_SCOPE_PATTERN.test(linesBefore))     return "org-scope helper";
  return null;
}

function isGuardedParentFK(linesBefore, registration) {
  if (ASSERT_OWNS_PATTERN.test(linesBefore))   return "assertOwns";
  if (REQUIRE_MW_PATTERN.test(linesBefore))    return "require middleware";
  if (REQUIRE_MW_PATTERN.test(registration))   return "registration mw";
  return null;
}

// ─── Per-file scanner ────────────────────────────────────────────────────────
function scanFile(file) {
  const src   = readFileSync(file, "utf8");
  const lines = src.split("\n");
  const violations = [];

  // File-level escape hatch — first 30 lines only, must have non-empty reason.
  for (let i = 0; i < Math.min(30, lines.length); i++) {
    if (SKIP_FILE_PATTERN.test(lines[i])) return [];
  }

  const drizzleAlt = [...ALL_PROTECTED_DRIZZLE].join("|");
  const sqlAlt     = [...ALL_PROTECTED_SQL].join("|");
  const drizzleRegex = new RegExp(
    `db\\s*\\.\\s*(?:delete|update)\\s*\\(\\s*(${drizzleAlt})\\b|\\.from\\s*\\(\\s*(${drizzleAlt})\\b`,
    "",
  );
  const rawSqlTableRegex = new RegExp(`\\b(${sqlAlt})\\b`);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let table = null;

    const m = line.match(drizzleRegex);
    if (m) {
      table = m[1] ?? m[2];
    } else if (/db\s*\.\s*execute\s*\(/.test(line)) {
      const window = lines.slice(i, Math.min(i + 30, lines.length)).join("\n");
      const sm = window.match(rawSqlTableRegex);
      if (sm) {
        const sqlName = sm[1];
        // Find the Drizzle name for the matched snake_case table. Try parent-FK
        // first, then direct-tenant maps.
        table =
          Object.entries(PARENT_FK_TABLES).find(([, v]) => v === sqlName)?.[0] ??
          [...orgScoped.entries()].find(([, v]) => v === sqlName)?.[0] ??
          [...wsScoped.entries()].find(([, v]) => v === sqlName)?.[0] ??
          sqlName;
      }
    }
    if (!table) continue;

    // Escape hatch: `// tenant-ownership-skip: <reason>` within the previous
    // 15 lines. 15-line window is wide enough to cover a Drizzle method chain
    // with many select fields (`const x = await db.select({a, b, c, ...})
    // .from(table)` is often split across 8–12 lines), but tight enough that
    // the marker stays semantically attached to a specific call site rather
    // than the whole handler.
    let skipped = false;
    for (let k = Math.max(0, i - 15); k < i; k++) {
      if (SKIP_COMMENT_PATTERN.test(lines[k])) { skipped = true; break; }
    }
    if (skipped) continue;

    const handler = findEnclosingHandler(lines, i);
    if (!handler) continue; // helper / library / migration — out of scope

    // Scan the WHOLE handler body, not just lines before the call site.
    // Rationale: Drizzle method chains often split `.from(t)` and
    // `.where(eq(t.organizationId, ...))` across multiple lines. Matching
    // only "before" misses the guard that appears 1–3 lines later in the
    // SAME statement. The risk of a developer accidentally guarding the
    // wrong call by adding a later guard is real but small — and is what
    // code review and tests cover, not lint. The lint's job is to catch
    // ENTIRE handlers that never mention tenant scoping at all, which is
    // the actual CVE class we've shipped (5 in ai-agents/index.ts).
    const handlerBody  = lines.slice(handler.bodyStart, handler.bodyEnd + 1).join("\n");
    const registration = lines.slice(handler.registrationLine, handler.bodyStart + 1).join("\n");

    let guard = null;
    if (PARENT_FK_DRIZZLE.has(table)) {
      guard = isGuardedParentFK(handlerBody, registration);
    } else if (DIRECT_TENANT_DRIZZLE.has(table)) {
      guard = isGuardedDirectTenant(handlerBody, registration, table);
    } else {
      // Unknown protected table — should not happen given the regex, but be safe
      continue;
    }

    if (DEBUG) {
      console.error(`  [trace] ${relative(ROOT, file)}:${i + 1} table=${table} guard=${guard ?? "NONE"}`);
    }

    if (!guard) {
      violations.push({
        file:   relative(ROOT, file),
        line:   i + 1,
        table,
        mode:   PARENT_FK_DRIZZLE.has(table) ? "PARENT_FK" : "DIRECT_TENANT",
        route:  `${handler.method.toUpperCase()} ${handler.route}`,
        snippet: line.trim(),
      });
    }
  }

  return violations;
}

// ─── Main ────────────────────────────────────────────────────────────────────
const allViolations = [];
let filesScanned     = 0;
let callSitesScanned = 0;

for (const file of walk(ROUTES_DIR)) {
  filesScanned++;
  allViolations.push(...scanFile(file));
  // Count call sites for visibility
  const src        = readFileSync(file, "utf8");
  const drizzleAlt = [...ALL_PROTECTED_DRIZZLE].join("|");
  const sqlAlt     = [...ALL_PROTECTED_SQL].join("|");
  const drizzleCnt = (src.match(new RegExp(`db\\s*\\.\\s*(?:delete|update)\\s*\\(\\s*(?:${drizzleAlt})\\b|\\.from\\s*\\(\\s*(?:${drizzleAlt})\\b`, "g")) ?? []).length;
  const lines = src.split("\n");
  let rawCnt = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/db\s*\.\s*execute\s*\(/.test(lines[i])) continue;
    const window = lines.slice(i, Math.min(i + 30, lines.length)).join("\n");
    if (new RegExp(`\\b(?:${sqlAlt})\\b`).test(window)) rawCnt++;
  }
  callSitesScanned += drizzleCnt + rawCnt;
}

const summary =
  `${filesScanned} files, ${callSitesScanned} protected-table call sites scanned, ` +
  `${ALL_PROTECTED_DRIZZLE.size} tables under enforcement ` +
  `(${orgScoped.size} org + ${wsScoped.size} ws + ${PARENT_FK_DRIZZLE.size} parent-FK)`;

if (allViolations.length === 0) {
  console.log(`check:tenant-ownership  OK  (${summary}, 0 unguarded)`);
  process.exit(0);
}

console.error(`check:tenant-ownership  FAIL  (${allViolations.length} unguarded mutations of protected tables)\n`);
console.error(summary + "\n");
console.error("Each handler below reads or mutates a tenant-scoped table WITHOUT");
console.error("a visible tenancy filter. Either:");
console.error("  • add `eq(<table>.organizationId, requireOrgId(req))` to the .where()");
console.error("  • call assertOwns<Parent>(...) before the DB call");
console.error("  • or, for legitimate cases (public token-as-key, super_admin,");
console.error("    self-scoped read), add a `// tenant-ownership-skip: <reason>`");
console.error("    comment on the line directly above.\n");

for (const v of allViolations) {
  console.error(`  ${v.file}:${v.line}  [${v.mode}]`);
  console.error(`    route: ${v.route}`);
  console.error(`    table: ${v.table}`);
  console.error(`    code:  ${v.snippet}`);
  console.error("");
}
process.exit(1);
