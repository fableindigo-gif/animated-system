#!/usr/bin/env node
/**
 * Workspace-id source lint — guards against SEC-03 regressions.
 *
 * Background
 * ──────────
 * SEC-03 (PHASE_0_FINDINGS.md, Section A) was a critical multi-tenant leak
 * where /api/billing/create-checkout-session trusted `req.body.workspaceId`
 * without verifying ownership. Phase 1 (#92) and follow-up #99 hand-audited
 * every route that read `req.body.workspaceId` or `req.query.workspace_id`
 * and locked them down with `assertWorkspaceOwnedByOrg` (or, for fx, the
 * local `workspaceBelongsToCallerOrg`). Nothing prevents a future PR from
 * adding a new route that reads workspaceId from the body/query without an
 * ownership check — that's exactly the regression that caused SEC-03.
 *
 * What this checks
 * ────────────────
 * For every .ts file under the target directory, flag any read of:
 *   • req.body.workspaceId / req.body?.workspaceId  (all access forms)
 *   • req.body.workspace_id  (and optional-chain, bracket forms)
 *   • req.query equivalents
 *   • req.headers["x-workspace-id"] / req.headers['x_workspace_id']
 *     (and optional-chain forms; dot-access camelCase variant too)
 *   • const { workspaceId } = req.body  (destructure forms)
 * UNLESS the same file also CALLS/DEFINES one of the recognised ownership
 * helpers (checked as `helperName(` to exclude comment-only mentions):
 *   • assertWorkspaceOwnedByOrg   (canonical, middleware/tenant-isolation.ts)
 *   • workspaceBelongsToCallerOrg (local helper in routes/fx/index.ts)
 *   • assertWorkspaceOwnership    (local helper in routes/saved-views/*)
 *
 * Escape hatch: a `// workspace-id-source-skip: <reason>` comment on the line
 * directly above the offending read (reason MUST be non-empty). Use only for
 * legitimate cases like reading the body workspaceId solely to compare it
 * against the authenticated session for a mismatch warning.
 *
 * On failure, prints a link to the SEC-03 finding and exits 1.
 *
 * Usage:
 *   node scripts/check-workspace-id-source.mjs               # scan default routes dir
 *   node scripts/check-workspace-id-source.mjs path/to/dir   # scan a single dir or file (for tests)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname  = dirname(fileURLToPath(import.meta.url));
const ROOT       = join(__dirname, "..");

const argv = process.argv.slice(2);
const ROUTES_DIR = argv.length > 0
  ? (argv[0].startsWith("/") ? argv[0] : join(ROOT, argv[0]))
  : join(ROOT, "artifacts/api-server/src/routes");

const FINDING_LINK =
  ".local/audit/PHASE_0_FINDINGS.md  (Section A — SEC-03: Billing checkout " +
  "trusted workspaceId from request body)";

// Recognised ownership-verification helpers. A file that CALLS or DEFINES any
// of these functions (detected as `helperName(` — not just a comment mention)
// is considered to be doing the ownership work; the lint won't flag its body/
// query reads. New routes SHOULD prefer `assertWorkspaceOwnedByOrg`.
const OWNERSHIP_HELPERS = [
  "assertWorkspaceOwnedByOrg",
  "workspaceBelongsToCallerOrg",
  "assertWorkspaceOwnership",
];
// Require the helper name to be followed by `(` (call or definition site),
// not just mentioned in a comment or string. We strip single-line comments
// before testing so `// old assertWorkspaceOwnedByOrg(...)` is ignored.
const HELPER_PATTERN = new RegExp(`\\b(?:${OWNERSHIP_HELPERS.join("|")})\\s*\\(`);

// Match reads of workspaceId / workspace_id from req.body or req.query in
// any of these forms:
//   req.body.workspaceId         dot access
//   req.body?.workspaceId        optional-chaining dot
//   req.body["workspaceId"]      bracket + double-quote
//   req.body['workspace_id']     bracket + single-quote
//   req.query.workspace_id
//   req.query?.workspace_id
//   (destructure forms caught by DESTRUCTURE_PATTERN below)
//
// Separator group after req.body|req.query:
//   \s*\??\.\s*["']?   →  . or ?.
//   \s*\[\s*["']?      →  ["  or ['  (bracket access)
const DIRECT_PATTERN =
  /\breq\s*\.\s*(?:body|query)\s*(?:\??\.\s*["']?|\[\s*["']?)workspace[_]?[Ii]d\b/;

// Destructure: `{ ...workspaceId... } = req.body|req.query` on the same line.
const DESTRUCTURE_PATTERN =
  /\{\s*[^}]*\bworkspace[_]?[Ii]d\b[^}]*\}\s*=\s*req\s*\.\s*(?:body|query)\b/;

// Header reads: bracket access forms (most common for hyphenated header names):
//   req.headers["x-workspace-id"]     double-quote, hyphen
//   req.headers['x_workspace_id']     single-quote, underscore
//   req.headers?.["x-workspace-id"]   optional-chain
// Also matches dot-access with the literal hyphen/underscore spelling:
//   req.headers.x-workspace-id  /  req.headers.x_workspace_id
// Note: camelCase dot-access (req.headers.xWorkspaceId) is intentionally not
// matched — Express normalises header names to lowercase-hyphen form, so that
// spelling does not occur in practice.
const HEADER_PATTERN =
  /\breq\s*\.\s*headers\s*(?:\?\.)?\s*(?:\[\s*["']x[-_]workspace[-_]id["']\s*\]|\.\s*x[-_]workspace[-_]id\b)/i;

const SKIP_COMMENT_PATTERN = /\/\/\s*workspace-id-source-skip\s*:\s*\S/;

function* walk(dir) {
  const s = statSync(dir);
  if (s.isFile()) { yield dir; return; }
  for (const e of readdirSync(dir)) {
    const p = join(dir, e), es = statSync(p);
    if (es.isDirectory()) yield* walk(p);
    else if (es.isFile() && (p.endsWith(".ts") || p.endsWith(".tsx"))) yield p;
  }
}

// Strip single-line comments from source before testing the helper pattern.
// This prevents `// assertWorkspaceOwnedByOrg(...)` from being counted as a
// real helper usage.
function stripLineComments(src) {
  return src.split("\n").map(l => l.replace(/\/\/.*$/, "")).join("\n");
}

function scanFile(file) {
  const src   = readFileSync(file, "utf8");
  const lines = src.split("\n");
  const fileHasHelper = HELPER_PATTERN.test(stripLineComments(src));
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    const line    = lines[i];
    const stripped = line.replace(/\/\/.*$/, ""); // strip inline comments
    if (!DIRECT_PATTERN.test(stripped) && !DESTRUCTURE_PATTERN.test(stripped) && !HEADER_PATTERN.test(stripped)) continue;
    // Per-site escape hatch: `// workspace-id-source-skip: <reason>` on line above.
    if (i > 0 && SKIP_COMMENT_PATTERN.test(lines[i - 1])) continue;
    if (fileHasHelper) continue;
    violations.push({
      file: relative(ROOT, file),
      line: i + 1,
      snippet: line.trim(),
    });
  }
  return violations;
}

const allViolations = [];
let filesScanned = 0;
for (const file of walk(ROUTES_DIR)) {
  filesScanned++;
  allViolations.push(...scanFile(file));
}

const summary =
  `${filesScanned} route files scanned, ${OWNERSHIP_HELPERS.length} ` +
  `ownership-helper names recognised`;

if (allViolations.length === 0) {
  console.log(`check:workspace-id-source  OK  (${summary}, 0 unguarded reads)`);
  process.exit(0);
}

console.error(
  `check:workspace-id-source  FAIL  (${allViolations.length} unguarded ` +
  `workspaceId reads from request body/query/headers)\n`,
);
console.error(summary + "\n");
console.error("Each line below reads workspaceId / workspace_id from req.body,");
console.error("req.query, or req.headers in a route file that does NOT also call/define any of:");
for (const h of OWNERSHIP_HELPERS) console.error(`  • ${h}`);
console.error("");
console.error("This is the SEC-03 regression class. Either:");
console.error("  • Derive workspaceId from the authenticated session (req.rbacUser");
console.error("    / req.jwtPayload), NOT from the request body/query/headers, or");
console.error("  • Verify ownership with assertWorkspaceOwnedByOrg before using it, or");
console.error("  • For a legitimate case (e.g. header value read inside a helper that");
console.error("    verifies ownership immediately), add a");
console.error("    `// workspace-id-source-skip: <reason>` comment on the line above.\n");
console.error(`See: ${FINDING_LINK}\n`);

for (const v of allViolations) {
  console.error(`  ${v.file}:${v.line}`);
  console.error(`    code: ${v.snippet}`);
  console.error("");
}
process.exit(1);
