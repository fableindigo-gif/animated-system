#!/usr/bin/env node
/**
 * scripts/check-sql-ambiguous-columns.mjs
 *
 * Phase 3 SQL safety lint. Scans Drizzle/raw SQL for bare ambiguous column
 * references inside `sql\`...\``, `sql<T>\`...\`` and `sql.raw(\`...\`)`
 * templates — the class of bug that produced runtime
 * `column reference "synced_at" is ambiguous` (incident: commit a8804b0,
 * patched in /api/warehouse/kpis on 2026-04-17).
 *
 * Rule: inside a tagged-template literal that is part of a SQL builder chain,
 * any reference to a known-ambiguous column name (`synced_at`, `tenant_id`,
 * `created_at`, `updated_at`, `organization_id`, `workspace_id`) MUST appear
 * as a `${schema.column}` interpolation, never as a bare identifier.
 *
 * Contextual exemptions (applied automatically by stripping these substrings
 * from the SQL body BEFORE the bare-column scan, so they cannot mask reads
 * elsewhere in the same template):
 *   • `UPDATE <tbl> SET <col> = <expr>, <col> = <expr> ...`
 *     (only the SET column list — the WHERE / FROM / RETURNING clauses are
 *     still scanned, so a `WITH u AS (UPDATE …) SELECT … JOIN … WHERE
 *     bare_col = …` cannot slip past the lint).
 *   • `INSERT INTO <tbl> (<col>, <col>) VALUES (…)`
 *     (only the column list and the VALUES tuple).
 *   • SQL comments (`-- …`, slash-star) and JS line comments (`// …`).
 *
 * Per-line opt-out: `// sql-ambiguous-skip: <reason>` or
 * `-- sql-ambiguous-skip: <reason>` — within 5 lines above the violation OR
 * on the same line. Use only when the surrounding query is provably
 * single-table.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT          = resolve(process.cwd());
const SCAN_ROOTS    = ["artifacts/api-server/src/routes", "artifacts/api-server/src/lib"];
const AMBIGUOUS_COLS = [
  "synced_at",
  "tenant_id",
  "created_at",
  "updated_at",
  "organization_id",
  "workspace_id",
];
const SKIP_PATTERN = /(?:\/\/|--)\s*sql-ambiguous-skip:\s*\S/;

function walk(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory())                       out.push(...walk(p));
    else if (st.isFile() && p.endsWith(".ts"))  out.push(p);
  }
  return out;
}

// Locate the start of every SQL tagged-template literal. Matches:
//   sql`...`         sql.raw(`...`)         sql<T>`...`          sql<T,U>`...`
// Returns an array of { tickIndex } where tickIndex points at the opening
// backtick of the template body.
function findSqlTemplateOpeners(text) {
  const openers = [];
  // `sql` (not preceded by an identifier char) optionally followed by `<...>`
  // generic args or `.raw(`, then a backtick.
  const re = /\bsql(?:<[^>`;]*>|\.raw)?\s*([(`])/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const ch = m[1];
    if (ch === "`") {
      openers.push(m.index + m[0].length - 1);
    } else {
      // sql.raw( — find the opening backtick of its first string argument.
      const tickIdx = text.indexOf("`", m.index + m[0].length);
      if (tickIdx !== -1) openers.push(tickIdx);
    }
  }
  return openers;
}

// Given the index of the opening backtick of a tagged template, return the
// index of the matching closing backtick, accounting for nested ${...}
// expressions (which may themselves contain backticks of nested templates).
function findClosingTick(text, tickStart) {
  let depth = 0;
  for (let i = tickStart + 1; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") { i++; continue; }
    if (c === "$" && text[i + 1] === "{") { depth++; i++; continue; }
    if (c === "}" && depth > 0)           { depth--; continue; }
    if (c === "`" && depth === 0)         return i;
  }
  return -1;
}

// Strip syntactic noise that should not contribute to ambiguous-column scans:
//   • SQL `-- line comments`, `/* block comments */`
//   • JS `// line comments` (rare inside SQL templates but possible in `${...}`)
//   • The column-list / SET-list of `UPDATE ... SET` — only up to the next
//     clause keyword (WHERE | FROM | RETURNING | ; | end-of-string).
//   • The column list and VALUES tuple of `INSERT INTO ... (...) VALUES (...)`.
// `${...}` interpolations are also collapsed to a space so that we only
// inspect raw SQL text.
function sanitizeSqlBody(body) {
  let s = body;
  // Drop ${...} interpolations. Use a simple loop because the interpolation
  // body can contain nested braces / strings; a naive regex would be wrong.
  {
    let out = "", depth = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "$" && s[i + 1] === "{") { depth++; i++; continue; }
      if (depth > 0) {
        if (c === "{") depth++;
        else if (c === "}") depth--;
        continue;
      }
      out += c;
    }
    s = out;
  }
  // Strip block comments (SQL and JS share the syntax).
  s = s.replace(/\/\*[\s\S]*?\*\//g, " ");
  // Strip line comments (SQL `--` and JS `//`).
  s = s.replace(/(?:--|\/\/)[^\n]*/g, " ");
  // Strip `INSERT INTO <tbl> (<cols>) VALUES (<vals>)` — both parenthesised
  // groups, where the column list is the most common bare-column source.
  s = s.replace(
    /\bINSERT\s+INTO\s+\w+\s*\([^)]*\)\s*VALUES\s*\([^)]*\)/gi,
    " INSERT INTO _ ",
  );
  // Strip `INSERT INTO <tbl> (<cols>)` without VALUES (e.g. INSERT … SELECT).
  s = s.replace(/\bINSERT\s+INTO\s+\w+\s*\([^)]*\)/gi, " INSERT INTO _ ");
  // Strip `SET col = …, col = …` clauses up to the next clause keyword.
  // Greedy across newlines, but bounded by WHERE / FROM / RETURNING / `;`.
  s = s.replace(
    /\bSET\b[\s\S]*?(?=\b(?:WHERE|FROM|RETURNING|ON\s+CONFLICT)\b|;|$)/gi,
    " SET _ ",
  );
  return s;
}

const files = SCAN_ROOTS.flatMap(r => walk(join(ROOT, r)));
const violations = [];

for (const file of files) {
  const text  = readFileSync(file, "utf8");
  const lines = text.split("\n");

  for (const tickStart of findSqlTemplateOpeners(text)) {
    const tickEnd = findClosingTick(text, tickStart);
    if (tickEnd === -1) continue;
    const rawBody = text.slice(tickStart + 1, tickEnd);
    const body    = sanitizeSqlBody(rawBody);

    for (const col of AMBIGUOUS_COLS) {
      // Bare column: word-boundary match NOT preceded by `.` (qualified) or
      // a word char (substring of another identifier). Quoted ("col") flags too.
      const re = new RegExp(String.raw`(?<![\w.])"?${col}"?\b`);
      const idxInBody = body.search(re);
      if (idxInBody === -1) continue;

      // Map back to a line number in the ORIGINAL file. Because sanitize
      // preserves line breaks (replacements use spaces, not nothing), the
      // line number of the match in `body` matches the line number in
      // `rawBody` and therefore in the original file (offset by tickStart).
      const linesBeforeMatch = body.slice(0, idxInBody).split("\n").length - 1;
      const lineNumInBody    = linesBeforeMatch;
      const lineNum          = text.slice(0, tickStart).split("\n").length + lineNumInBody;

      // Skip-comment lookback: 5 lines above OR same line.
      const skipped = lines
        .slice(Math.max(0, lineNum - 6), lineNum)
        .some(l => SKIP_PATTERN.test(l));
      if (skipped) continue;

      violations.push({
        file:    relative(ROOT, file),
        line:    lineNum,
        col,
        snippet: lines[lineNum - 1]?.trim().slice(0, 120) ?? "",
      });
      break; // one violation per template is enough
    }
  }
}

if (violations.length === 0) {
  console.log(`check:sql-ambiguous-columns  OK  (${files.length} files scanned, 0 bare ambiguous-column references in SQL templates)`);
  process.exit(0);
}

console.error(`check:sql-ambiguous-columns  FAIL  (${violations.length} bare ambiguous-column references)\n`);
console.error("Each SQL template below references an ambiguous column name as");
console.error("a bare identifier. In a multi-table JOIN this triggers the");
console.error('Postgres error `column reference "<col>" is ambiguous`. Either:');
console.error("  • use a Drizzle interpolation: sql`${myTable.syncedAt} >= ...`");
console.error("  • or, for a provably single-table query, add a comment");
console.error("    `// sql-ambiguous-skip: <reason>` within 5 lines above.\n");
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  bare \`${v.col}\``);
  console.error(`    ${v.snippet}\n`);
}
process.exit(1);
