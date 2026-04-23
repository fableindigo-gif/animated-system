#!/usr/bin/env node
/**
 * Tests for scripts/check-workspace-id-source.mjs.
 *
 * Runs the checker against fixture files:
 *   - should-fail.ts              every non-comment, non-blank line is an
 *                                  unguarded workspace-id read; checker must
 *                                  flag each one.
 *   - should-pass.ts              helper is called, skip comments are present,
 *                                  commented-out reads and header reads are safe;
 *                                  checker must report 0 violations.
 *   - should-fail-helper-in-comment.ts
 *                                  helper appears only in a `//` comment; checker
 *                                  must still flag the body read.
 *
 * Additionally tests two in-memory cases (tmp files):
 *   - Optional-chaining form `req.body?.workspaceId` must be flagged.
 *   - Bracket form `req.body["workspace_id"]` must be flagged.
 *
 * Run via:  node scripts/test-check-workspace-id-source.mjs
 * Exits 0 on success, 1 on failure.
 */
import { spawnSync }                         from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir }                             from "node:os";
import { join, dirname }                      from "node:path";
import { fileURLToPath }                      from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT    = join(__dirname, "..");
const CHECKER = "scripts/check-workspace-id-source.mjs";
const FIX_DIR = "scripts/__fixtures__/check-workspace-id-source";

function run(target) {
  const r = spawnSync("node", [CHECKER, target], { encoding: "utf8", cwd: ROOT });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

let failed = 0;

// ── 1. should-fail: every non-comment non-blank line must be flagged ────────
{
  const fixture = join(ROOT, FIX_DIR, "should-fail.ts");
  const r = run(fixture);
  if (r.code === 0) {
    console.error(`FAIL: checker did not flag ${FIX_DIR}/should-fail.ts`);
    failed++;
  } else {
    // Build list of expected line numbers: non-blank, non-comment lines that
    // actually contain the trigger patterns.
    const { readFileSync } = await import("node:fs");
    const lines = readFileSync(fixture, "utf8").split("\n");
    const DIRECT =
      /\breq\s*\.\s*(?:body|query)\s*(?:\??\.\s*["']?|\[\s*["']?)workspace[_]?[Ii]d\b/;
    const DESTR  =
      /\{\s*[^}]*\bworkspace[_]?[Ii]d\b[^}]*\}\s*=\s*req\s*\.\s*(?:body|query)\b/;
    const expected = lines
      .map((l, i) => ({ n: i + 1, l }))
      .filter(({ l }) => {
        const stripped = l.replace(/\/\/.*$/, "");
        return DIRECT.test(stripped) || DESTR.test(stripped);
      });
    const reported = new Set(
      [...r.stderr.matchAll(/should-fail\.ts:(\d+)/g)].map(m => Number(m[1])),
    );
    const missing = expected.filter(({ n }) => !reported.has(n));
    if (missing.length > 0) {
      console.error(
        `FAIL: should-fail.ts — lines not flagged: ${missing.map(m => `${m.n} (${m.l.trim()})`).join(", ")}`,
      );
      failed++;
    } else {
      console.log(`OK: should-fail.ts — all ${expected.length} unguarded-read lines flagged`);
    }
  }
}

// ── 2. should-pass: zero violations ─────────────────────────────────────────
{
  const fixture = join(ROOT, FIX_DIR, "should-pass.ts");
  const r = run(fixture);
  if (r.code !== 0) {
    console.error(`FAIL: checker produced false positives on ${FIX_DIR}/should-pass.ts:`);
    console.error(r.stderr);
    failed++;
  } else {
    console.log("OK: should-pass.ts — 0 false positives");
  }
}

// ── 3. Helper in comment only must NOT satisfy the check ─────────────────────
{
  const fixture = join(ROOT, FIX_DIR, "should-fail-helper-in-comment.ts");
  const r = run(fixture);
  if (r.code === 0) {
    console.error(
      "FAIL: checker accepted helper name in comment as satisfying the ownership requirement",
    );
    failed++;
  } else {
    console.log("OK: should-fail-helper-in-comment.ts — correctly rejected (helper in comment not counted)");
  }
}

// ── 4. Optional-chaining form must be flagged (inline tmp file) ──────────────
{
  const tmpDir  = mkdtempSync(join(tmpdir(), "check-ws-id-"));
  const tmpFile = join(tmpDir, "opt-chain.ts");
  writeFileSync(tmpFile, [
    "import { Router } from 'express';",
    "const router = Router();",
    "router.get('/', async (req, res) => {",
    "  const id = req.body?.workspaceId;",
    "  res.json({ id });",
    "});",
    "",
  ].join("\n"));
  const r = run(tmpFile);
  rmSync(tmpDir, { recursive: true, force: true });
  if (r.code === 0) {
    console.error("FAIL: checker missed req.body?.workspaceId (optional-chaining form)");
    failed++;
  } else if (!/opt-chain\.ts:4/.test(r.stderr)) {
    console.error("FAIL: opt-chain flagged but wrong line number:", r.stderr);
    failed++;
  } else {
    console.log("OK: req.body?.workspaceId correctly flagged at line 4");
  }
}

// ── 5. Bracket form must be flagged (inline tmp file) ────────────────────────
{
  const tmpDir  = mkdtempSync(join(tmpdir(), "check-ws-id-"));
  const tmpFile = join(tmpDir, "bracket.ts");
  writeFileSync(tmpFile, [
    "import { Router } from 'express';",
    "const router = Router();",
    "router.post('/', async (req, res) => {",
    '  const id = req.body["workspace_id"];',
    "  res.json({ id });",
    "});",
    "",
  ].join("\n"));
  const r = run(tmpFile);
  rmSync(tmpDir, { recursive: true, force: true });
  if (r.code === 0) {
    console.error('FAIL: checker missed req.body["workspace_id"] (bracket form)');
    failed++;
  } else if (!/bracket\.ts:4/.test(r.stderr)) {
    console.error("FAIL: bracket form flagged but wrong line number:", r.stderr);
    failed++;
  } else {
    console.log('OK: req.body["workspace_id"] correctly flagged at line 4');
  }
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll check-workspace-id-source tests passed.");
