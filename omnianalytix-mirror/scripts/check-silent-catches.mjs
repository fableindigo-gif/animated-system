#!/usr/bin/env node
/**
 * Lint guard: prevents the "silent 500" bug class from re-emerging.
 *
 * Walks every .ts file under api-server's routes/ and middleware/, finds every
 * catch block with brace-balanced parsing, and flags any that returns a 5xx
 * response without going through one of the approved logging paths:
 *   - handleRouteError(...)        ← preferred (structured + Sentry)
 *   - logger.error / .warn / .fatal
 *   - req.log.error / .warn / .fatal
 *   - console.error / .warn        ← last-resort, but at least visible
 *   - next(err)                    ← delegated to global Express handler
 *
 * Detects:
 *   } catch (err) { res.status(500)... }    BAD
 *   } catch        { res.status(500)... }   BAD (no param to log)
 *   res.status(somevar) where somevar = 5xx  not detected — known limitation
 *
 * Opt-out:
 *   Add the comment   silent-catch-ok   anywhere inside the catch block.
 *
 * Run via:  pnpm check:silent-catches
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = [
  "artifacts/api-server/src/routes",
  "artifacts/api-server/src/middleware",
];
const ALLOW_TAG = "silent-catch-ok";

const APPROVED_LOG_PATTERNS = [
  /\bhandleRouteError\s*\(/,
  /\blogger\s*\.\s*(error|warn|fatal)\s*\(/,
  /\breq\s*\.\s*log\s*\.\s*(error|warn|fatal)\s*\(/,
  /\bconsole\s*\.\s*(error|warn)\s*\(/,
  /\bnext\s*\(\s*\w/,             // next(err) — delegate to Express handler
];

const BAD_5XX = /\bres\s*\.\s*status\s*\(\s*5\d\d\s*\)/;

const offenders = [];
let scannedFiles = 0;
let scannedCatches = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) check(p);
  }
}

/**
 * Walk forward from index `i` (which points at an opening `{`) and return the
 * index just past the matching closing `}`. Tolerates strings, template
 * literals, regex, and comments. Returns -1 if no balanced match.
 */
function findMatchingBrace(src, i) {
  if (src[i] !== "{") return -1;
  let depth = 0;
  let inStr = null;       // '"' | "'" | "`" | null
  let inLineCmt = false;
  let inBlockCmt = false;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    const n = src[k + 1];
    if (inLineCmt) { if (c === "\n") inLineCmt = false; continue; }
    if (inBlockCmt) { if (c === "*" && n === "/") { inBlockCmt = false; k++; } continue; }
    if (inStr) {
      if (c === "\\") { k++; continue; }
      if (c === inStr) inStr = null;
      // template literal ${...}: not perfectly handled — rare in catch bodies
      continue;
    }
    if (c === "/" && n === "/") { inLineCmt = true; k++; continue; }
    if (c === "/" && n === "*") { inBlockCmt = true; k++; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return k + 1;
    }
  }
  return -1;
}

// Match the start of a catch clause: `catch (...)` or `catch ` (no parens).
// We will then locate the next `{` and brace-balance from there.
const CATCH_START_RE = /\bcatch\s*(\([^)]*\))?\s*\{/g;

function check(file) {
  scannedFiles++;
  const src = readFileSync(file, "utf8");
  let m;
  CATCH_START_RE.lastIndex = 0;
  while ((m = CATCH_START_RE.exec(src))) {
    scannedCatches++;
    const openBrace = src.indexOf("{", m.index + "catch".length);
    if (openBrace === -1) continue;
    const end = findMatchingBrace(src, openBrace);
    if (end === -1) continue;
    const body = src.slice(openBrace + 1, end - 1);

    if (!BAD_5XX.test(body)) continue;
    if (APPROVED_LOG_PATTERNS.some((re) => re.test(body))) continue;
    if (body.includes(ALLOW_TAG)) continue;

    const line = src.slice(0, m.index).split("\n").length;
    const param = (m[1] ?? "(no param)").trim();
    offenders.push({
      file: relative(ROOT, file),
      line,
      param,
      preview: src.slice(m.index, Math.min(end, m.index + 200)).split("\n").slice(0, 5).join("\n"),
    });
  }
}

for (const d of SCAN_DIRS) {
  try { walk(join(ROOT, d)); } catch { /* dir may not exist yet */ }
}

if (offenders.length === 0) {
  console.log(`check:silent-catches  OK  (${scannedFiles} files, ${scannedCatches} catches scanned, 0 silent 5xx)`);
  process.exit(0);
}

console.error(`\ncheck:silent-catches  FAIL  ${offenders.length} silent 5xx catch block(s) in ${scannedFiles} files (${scannedCatches} catches scanned)\n`);
console.error("Each of these will return 500 to users with no log trail. Fix by:");
console.error("  1. import { handleRouteError } from \"<relative>/lib/route-error-handler\";");
console.error("  2. Replace the catch body with:");
console.error("       handleRouteError(err, req, res, \"<METHOD> /api/...\", { error: \"...\" });");
console.error("  3. Or add a   silent-catch-ok   comment inside the catch if intentional.\n");
for (const o of offenders) {
  console.error(`  ${o.file}:${o.line}    catch ${o.param}`);
  for (const ln of o.preview.split("\n")) console.error(`      ${ln}`);
  console.error("");
}
process.exit(1);
