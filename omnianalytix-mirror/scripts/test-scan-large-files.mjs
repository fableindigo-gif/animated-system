#!/usr/bin/env node
/**
 * Tests for scripts/scan-large-files.mjs.
 *
 * Spins up a temp git repo, stages various combinations of files, and asserts
 * the scanner blocks (or allows) each one as expected.
 *
 * Run via:  node scripts/test-scan-large-files.mjs
 * Exits 0 on success, 1 on failure.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const SCANNER_SRC = join(ROOT, "scripts/scan-large-files.mjs");

let failed = 0;

function makeRepo() {
  const tmp = mkdtempSync(join(tmpdir(), "scan-large-files-"));
  const repo = join(tmp, "repo");
  mkdirSync(repo);
  const sh = (cmd) => spawnSync("sh", ["-c", cmd], { cwd: repo, encoding: "utf8" });
  sh("git init -q && git config user.email t@t && git config user.name t && git config commit.gpgsign false");
  sh(`mkdir -p scripts && cp ${SCANNER_SRC} scripts/scan-large-files.mjs`);
  return { tmp, repo, sh };
}

function runScanner(repo, args = ["--staged"]) {
  return spawnSync("node", ["scripts/scan-large-files.mjs", ...args], {
    cwd: repo,
    encoding: "utf8",
  });
}

function expect(name, cond, ctx = "") {
  if (cond) {
    console.log(`OK: ${name}`);
  } else {
    console.error(`FAIL: ${name}${ctx ? `\n${ctx}` : ""}`);
    failed++;
  }
}

function writeAndStage(repo, sh, path, content) {
  const full = join(repo, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
  sh(`git add ${path}`);
}

// --- 1. Clean repo with a normal source file: passes ---
{
  const { tmp, repo, sh } = makeRepo();
  try {
    writeAndStage(repo, sh, "src/index.ts", "export const x = 1;\n");
    const r = runScanner(repo);
    expect("clean source file passes", r.status === 0, r.stderr);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// --- 2. File >5 MB: blocked ---
{
  const { tmp, repo, sh } = makeRepo();
  try {
    writeAndStage(repo, sh, "big.bin", "x".repeat(5 * 1024 * 1024 + 1));
    const r = runScanner(repo);
    expect(
      "file >5MB is blocked",
      r.status !== 0 && /file-too-large/.test(r.stderr),
      r.stderr,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// --- 3. File >5 MB but allowlisted in .largefilesignore: passes ---
{
  const { tmp, repo, sh } = makeRepo();
  try {
    writeAndStage(repo, sh, "big.bin", "x".repeat(5 * 1024 * 1024 + 1));
    writeFileSync(join(repo, ".largefilesignore"), "big.bin\n");
    sh("git add .largefilesignore");
    const r = runScanner(repo);
    expect("allowlisted large file passes", r.status === 0, r.stderr);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// --- 4. Build output paths: blocked ---
{
  const cases = [
    "dist/index.js",
    "build/main.js",
    "coverage/lcov.info",
    "out-tsc/foo.js",
    "artifacts/api-server/dist/server.js",
    "packages/lib/build/bundle.js",
  ];
  for (const path of cases) {
    const { tmp, repo, sh } = makeRepo();
    try {
      writeAndStage(repo, sh, path, "compiled\n");
      const r = runScanner(repo);
      expect(
        `build output blocked: ${path}`,
        r.status !== 0 && /build-output-path/.test(r.stderr),
        r.stderr,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
}

// --- 5. *.tsbuildinfo: blocked ---
{
  const { tmp, repo, sh } = makeRepo();
  try {
    writeAndStage(repo, sh, "tsconfig.tsbuildinfo", "{}\n");
    const r = runScanner(repo);
    expect(
      "tsbuildinfo is blocked",
      r.status !== 0 && /build-output-extension/.test(r.stderr),
      r.stderr,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// --- 6. Image at repo root (likely chat paste): blocked ---
{
  const { tmp, repo, sh } = makeRepo();
  try {
    writeAndStage(repo, sh, "screenshot-2026-04-18.png", "fake-png-bytes");
    const r = runScanner(repo);
    expect(
      "stray screenshot is blocked",
      r.status !== 0 && /binary-media-outside-allowed-dirs/.test(r.stderr),
      r.stderr,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// --- 7. Image under artifacts/<app>/public/: allowed ---
{
  const { tmp, repo, sh } = makeRepo();
  try {
    writeAndStage(repo, sh, "artifacts/web/public/logo.png", "fake-png");
    const r = runScanner(repo);
    expect("legitimate app asset passes", r.status === 0, r.stderr);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// --- 8. Image under docs/: allowed (runbook screenshots) ---
{
  const { tmp, repo, sh } = makeRepo();
  try {
    writeAndStage(repo, sh, "docs/runbooks/img/diagram.png", "fake-png");
    const r = runScanner(repo);
    expect("docs screenshot passes", r.status === 0, r.stderr);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// --- 9. Video at repo root: blocked ---
{
  const { tmp, repo, sh } = makeRepo();
  try {
    writeAndStage(repo, sh, "demo.mp4", "fake-mp4");
    const r = runScanner(repo);
    expect(
      "stray video is blocked",
      r.status !== 0 && /binary-media-outside-allowed-dirs/.test(r.stderr),
      r.stderr,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// --- 10. Suppression via .largefilesignore for a path ---
{
  const { tmp, repo, sh } = makeRepo();
  try {
    writeAndStage(repo, sh, "dist/keep.js", "compiled\n");
    writeFileSync(join(repo, ".largefilesignore"), "dist/\n");
    sh("git add .largefilesignore");
    const r = runScanner(repo);
    expect("ignore directory entry suppresses build-output hit", r.status === 0, r.stderr);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll large-file scanner tests passed.");
