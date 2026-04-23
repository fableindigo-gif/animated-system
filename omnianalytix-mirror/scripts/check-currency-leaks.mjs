#!/usr/bin/env node
/**
 * Lint guard: prevents raw "$" USD currency leaks in the ecom-agent UI.
 *
 * Background: The currency-coverage migration (see CURRENCY_COVERAGE.md) was
 * marked complete while several files still rendered raw `${...}` USD
 * template literals from warehouse values. Without a guardrail, the next
 * patch can silently re-introduce the same leak. This script scans every
 * .ts/.tsx file under artifacts/ecom-agent/src for the pattern `${ ... }`
 * (a backtick template literal whose first character is a literal "$"
 * followed by a `${...}` interpolation) and fails on any unallowed match.
 *
 * Why this pattern: it is the smoking gun for "raw USD label hard-coded in
 * front of a number". Every leak we have seen in the wild looks like:
 *     `${spend.toFixed(0)}`
 *     `${(n/1_000).toFixed(1)}K`
 *     `${data.targets.cplCap}`
 * The FX-aware helpers never use this shape — they delegate to
 * Intl.NumberFormat or interpolate `${symbol}` (a runtime variable) instead
 * of a hard-coded "$".
 *
 * Allow-list:
 *   1. ALLOWED_FILES (below): the FX/currency helpers themselves are
 *      allowed to render `$` because they are the source of truth for the
 *      currency string. Edits there get human review by definition.
 *   2. Inline opt-out: add `// usd-leak-allow: <reason>` on the same line
 *      as the offending template literal (or the line immediately above)
 *      to whitelist a single occurrence. Use sparingly and explain why.
 *
 * Run via:  pnpm run check:currency-leaks
 * Self-tests: node scripts/test-check-currency-leaks.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const ROOT = process.cwd();

// CLI args: optional list of files/dirs to scan. Default = the canonical
// scan root. Tests pass fixture files explicitly.
const argv = process.argv.slice(2);
const TARGETS = argv.length > 0 ? argv : ["artifacts/ecom-agent/src"];

// File-level allow-list. Paths are POSIX-relative to the repo root. Any
// file whose path equals one of these strings is skipped entirely. These
// files are the FX/currency formatters — the only legitimate place to
// emit a literal "$" prefix.
const ALLOWED_FILES = new Set([
  "artifacts/ecom-agent/src/lib/fx-format.ts",
  "artifacts/ecom-agent/src/contexts/fx-context.tsx",
  "artifacts/ecom-agent/src/contexts/currency-context.tsx",
  "artifacts/ecom-agent/src/contexts/fx-runtime.ts",
]);

const ALLOW_TAG = "usd-leak-allow";

// Match the leak shape inside a template literal:
//   `$${...}`     →  $ literal followed by ${ interpolation
// The two `$$` produce a single literal "$" plus the start of `${...}`.
// We require the leading backtick (possibly many characters back, possibly
// across lines) to constrain to template literals. The whole-file regex
// with the `m` + `s` flags (via `[\s\S]`) catches multiline templates that
// a per-line scan would miss, e.g.:
//   const s = `
//     value: $${x}
//   `;
const LEAK_RE = /`[^`]*?\$\$\{/g;
// Per-line variant used for the simple scan path. The whole-file pass
// catches multiline cases the per-line pass would miss.
const LEAK_RE_LINE = /`[^`]*?\$\$\{/;

const offenders = [];
let scannedFiles = 0;

function toPosix(p) {
  return p.split(sep).join("/");
}

function walk(target) {
  const abs = resolve(ROOT, target);
  let st;
  try { st = statSync(abs); } catch { return; }
  if (st.isDirectory()) {
    for (const name of readdirSync(abs)) {
      // skip nothing special — node_modules etc. won't be under src/
      walk(join(target, name));
    }
  } else if (st.isFile() && (abs.endsWith(".ts") || abs.endsWith(".tsx"))) {
    check(abs);
  }
}

function check(absPath) {
  const rel = toPosix(relative(ROOT, absPath));
  if (ALLOWED_FILES.has(rel)) return;
  scannedFiles++;
  const src = readFileSync(absPath, "utf8");
  const lines = src.split("\n");
  const reported = new Set();

  // Pass 1 — per-line (covers single-line templates, the common case)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip pure line-comments — pattern in commented-out code is intentional.
    if (/^\s*\/\//.test(line)) continue;
    if (!LEAK_RE_LINE.test(line)) continue;
    const prev = i > 0 ? lines[i - 1] : "";
    if (line.includes(ALLOW_TAG) || prev.includes(ALLOW_TAG)) continue;
    offenders.push({ file: rel, line: i + 1, snippet: line.trim() });
    reported.add(i + 1);
  }

  // Pass 2 — whole-file (catches multiline templates that pass 1 missed).
  // For each match, report the line that contains the actual `$${` chars
  // (more useful for the developer than the line of the opening backtick,
  // which may be far away in a multiline literal).
  let m;
  LEAK_RE.lastIndex = 0;
  while ((m = LEAK_RE.exec(src)) !== null) {
    const matchText = m[0];
    // The `$${` substring is the last 3 characters of the match.
    const dollarOffset = m.index + matchText.length - 3;
    let lineNo = 1;
    for (let k = 0; k < dollarOffset; k++) if (src[k] === "\n") lineNo++;
    if (reported.has(lineNo)) continue;
    const here = lines[lineNo - 1] ?? "";
    const prev = lineNo > 1 ? lines[lineNo - 2] : "";
    if (/^\s*\/\//.test(here)) continue;
    if (here.includes(ALLOW_TAG) || prev.includes(ALLOW_TAG)) continue;
    offenders.push({ file: rel, line: lineNo, snippet: here.trim() || "<multiline template literal>" });
    reported.add(lineNo);
  }
}

for (const t of TARGETS) walk(t);

if (offenders.length > 0) {
  console.error(`\n[check-currency-leaks] Found ${offenders.length} raw "$" USD template literal(s):\n`);
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}`);
    console.error(`    ${o.snippet}`);
  }
  console.error(
    `\nFix: route the value through useFx().formatFromUsd() (in components) or` +
    `\n     formatUsdInDisplay() (in module-scope helpers). If this occurrence is` +
    `\n     legitimately USD-only (e.g. a debug log), add this comment on the same` +
    `\n     or previous line:` +
    `\n       // ${ALLOW_TAG}: <one-line reason>` +
    `\n`
  );
  process.exit(1);
}

console.log(`[check-currency-leaks] OK — scanned ${scannedFiles} file(s), 0 raw "$" USD template literals.`);
