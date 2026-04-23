#!/usr/bin/env node
/**
 * Tests for scripts/scan-secrets.mjs.
 *
 * Runs the scanner against two fixture files:
 *   - should-fail.txt: every line is a known credential pattern; the scanner
 *     must report at least one finding per line.
 *   - should-pass.txt: real-world false positives we have personally seen.
 *     The scanner must report zero findings.
 *
 * Run via:  node scripts/test-scan-secrets.mjs
 * Exits 0 on success, 1 on failure.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const SCANNER = "scripts/scan-secrets.mjs";
const FIXTURE_FAIL = "scripts/__fixtures__/scan-secrets/should-fail.txt";
const FIXTURE_PASS = "scripts/__fixtures__/scan-secrets/should-pass.txt";

function run(file) {
  const r = spawnSync("node", [SCANNER, file], { encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

let failed = 0;

// --- should-fail: must exit non-zero, and EVERY non-comment, non-blank line
//     in the fixture should produce at least one finding ---
{
  const r = run(FIXTURE_FAIL);
  if (r.code === 0) {
    console.error(`FAIL: scanner did not flag ${FIXTURE_FAIL}`);
    failed++;
  } else {
    const fixtureLines = readFileSync(join(ROOT, FIXTURE_FAIL), "utf8").split("\n");
    const expected = fixtureLines
      .map((l, i) => ({ n: i + 1, l }))
      .filter(({ l }) => l.trim() && !l.trim().startsWith("//"));
    const reported = new Set(
      [...r.stderr.matchAll(/should-fail\.txt:(\d+)/g)].map((m) => Number(m[1])),
    );
    const missing = expected.filter(({ n }) => !reported.has(n));
    if (missing.length > 0) {
      console.error(`FAIL: ${FIXTURE_FAIL} — lines not flagged: ${missing.map((m) => m.n).join(", ")}`);
      failed++;
    } else {
      console.log(`OK: ${FIXTURE_FAIL} — all ${expected.length} secret lines flagged`);
    }
  }
}

// --- should-pass: must exit zero ---
{
  const r = run(FIXTURE_PASS);
  if (r.code !== 0) {
    console.error(`FAIL: scanner produced false positives on ${FIXTURE_PASS}:`);
    console.error(r.stderr);
    failed++;
  } else {
    console.log(`OK: ${FIXTURE_PASS} — zero false positives`);
  }
}

// --- Regression test: partial-staging bypass ---
// Previously, --staged mode read files from the working tree. A developer
// could stage a secret, then `echo > file` to wipe the working copy, and the
// scanner would happily pass while the commit still contained the secret.
// This test stages a file containing a secret, then overwrites the working
// copy with a benign string, and asserts the scanner STILL flags the secret.
{
  const tmp = mkdtempSync(join(tmpdir(), "scan-secrets-staged-"));
  const repo = join(tmp, "repo");
  mkdirSync(repo);
  const sh = (cmd, opts = {}) =>
    spawnSync("sh", ["-c", cmd], { cwd: repo, encoding: "utf8", ...opts });

  try {
    sh("git init -q && git config user.email t@t && git config user.name t && git config commit.gpgsign false");
    // Copy the scanner script into the temp repo so it can be executed there.
    sh(`mkdir -p scripts && cp ${join(ROOT, "scripts/scan-secrets.mjs")} scripts/scan-secrets.mjs`);
    // Stage a file containing a known-bad secret
    // Build the fake token at runtime so this line itself doesn't match the scanner.
    const fakeToken = "ghp_" + "a".repeat(36); // secret-scan-ok — synthetic test fixture
    writeFileSync(join(repo, "leak.txt"), `TOKEN = "${fakeToken}"\n`);
    sh("git add leak.txt");
    // Overwrite the working tree to hide the secret WITHOUT re-staging
    writeFileSync(join(repo, "leak.txt"), "TOKEN = \"benign\"\n");

    const r = spawnSync("node", ["scripts/scan-secrets.mjs", "--staged"], {
      cwd: repo, encoding: "utf8",
    });

    if (r.status === 0) {
      console.error("FAIL: --staged mode missed a secret hidden behind a working-tree edit (partial-staging bypass).");
      console.error(`stdout: ${r.stdout}`);
      console.error(`stderr: ${r.stderr}`);
      failed++;
    } else if (!/github-pat-classic/.test(r.stderr)) {
      console.error("FAIL: --staged scan exited non-zero but did not report the expected finding.");
      console.error(r.stderr);
      failed++;
    } else {
      console.log("OK: --staged mode reads the index, not the working tree (partial-staging bypass blocked)");
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll secret-scanner tests passed.");
