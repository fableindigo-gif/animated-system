#!/usr/bin/env node
/**
 * Tests for scripts/check-currency-leaks.mjs.
 *
 * Runs the checker against two fixture files:
 *   - should-fail.tsx: every non-comment, non-blank line is a known leak;
 *     the checker must report at least one finding per line.
 *   - should-pass.tsx: real-world non-leak shapes plus allow-comment
 *     opt-outs. The checker must report zero findings.
 *
 * Run via:  node scripts/test-check-currency-leaks.mjs
 * Exits 0 on success, 1 on failure.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const CHECKER = "scripts/check-currency-leaks.mjs";
const FIXTURE_FAIL = "scripts/__fixtures__/check-currency-leaks/should-fail.tsx";
const FIXTURE_PASS = "scripts/__fixtures__/check-currency-leaks/should-pass.tsx";

function run(file) {
  const r = spawnSync("node", [CHECKER, file], { encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

let failed = 0;

// --- should-fail: must exit non-zero, and EVERY non-comment, non-blank line
//     in the fixture should produce a finding ---
{
  const r = run(FIXTURE_FAIL);
  if (r.code === 0) {
    console.error(`FAIL: checker did not flag ${FIXTURE_FAIL}`);
    failed++;
  } else {
    const fixtureLines = readFileSync(join(ROOT, FIXTURE_FAIL), "utf8").split("\n");
    const expected = fixtureLines
      .map((l, i) => ({ n: i + 1, l }))
      .filter(({ l }) => l.trim() && !l.trim().startsWith("//"));
    const reported = new Set(
      [...r.stderr.matchAll(/should-fail\.tsx:(\d+)/g)].map((m) => Number(m[1])),
    );
    const missing = expected.filter(({ n }) => !reported.has(n));
    if (missing.length > 0) {
      console.error(`FAIL: ${FIXTURE_FAIL} — lines not flagged: ${missing.map((m) => m.n).join(", ")}`);
      failed++;
    } else {
      console.log(`OK: ${FIXTURE_FAIL} — all ${expected.length} leak lines flagged`);
    }
  }
}

// --- should-pass: must exit zero ---
{
  const r = run(FIXTURE_PASS);
  if (r.code !== 0) {
    console.error(`FAIL: checker produced false positives on ${FIXTURE_PASS}:`);
    console.error(r.stderr);
    failed++;
  } else {
    console.log(`OK: ${FIXTURE_PASS} — 0 false positives`);
  }
}

// --- multiline template literal: the leak character lives on a different
//     line than the opening backtick. The line-by-line scan would miss it;
//     the whole-file pass should catch it. ---
{
  const tmpDir = mkdtempSync(join(tmpdir(), "check-currency-leaks-"));
  const tmpFile = join(tmpDir, "multiline.tsx");
  writeFileSync(
    tmpFile,
    [
      "const ok = `no leak here`;",
      "const bad = `",
      "  spent $${huge}",
      "  yesterday",
      "`;",
      "",
    ].join("\n"),
  );
  const r = run(tmpFile);
  rmSync(tmpDir, { recursive: true, force: true });
  if (r.code === 0) {
    console.error("FAIL: checker missed a multiline template literal leak");
    failed++;
  } else if (!/multiline\.tsx:3/.test(r.stderr)) {
    console.error("FAIL: checker flagged a multiline leak but reported the wrong line:");
    console.error(r.stderr);
    failed++;
  } else {
    console.log("OK: multiline template literal leak correctly flagged at the `$${...}` line");
  }
}

// --- commented-out leak in pass fixture is implicitly tested above (zero
//     false positives), but assert it explicitly via a temp file too so the
//     contract is visible. ---
{
  const tmpDir = mkdtempSync(join(tmpdir(), "check-currency-leaks-"));
  const tmpFile = join(tmpDir, "commented.tsx");
  writeFileSync(
    tmpFile,
    [
      "// const old = `$${legacy}`;",
      "//   const old2 = `$${legacy2}`;",
      "const ok = `${symbol}${value}`;",
      "",
    ].join("\n"),
  );
  const r = run(tmpFile);
  rmSync(tmpDir, { recursive: true, force: true });
  if (r.code !== 0) {
    console.error("FAIL: checker flagged a commented-out leak (false positive):");
    console.error(r.stderr);
    failed++;
  } else {
    console.log("OK: commented-out leak correctly ignored");
  }
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll check-currency-leaks tests passed.");
