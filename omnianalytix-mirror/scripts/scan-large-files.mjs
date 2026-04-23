#!/usr/bin/env node
/**
 * Large-file & risky-path scanner.
 *
 * Modes:
 *   scan-large-files.mjs --staged       Scan files staged for commit (used by pre-commit hook)
 *   scan-large-files.mjs --all          Scan every tracked file in the repo
 *   scan-large-files.mjs <file> [...]   Scan an explicit list of files
 *
 * Exits 0 on clean, 1 on any finding.
 *
 * Blocks three classes of accidental commit that have caused churn:
 *   1. Files larger than MAX_FILE_BYTES (default 5 MB).
 *   2. Build outputs: anything under dist/, build/, coverage/, out-tsc/, .expo/,
 *      or matching *.tsbuildinfo.
 *   3. Binary media (screenshots, recordings) outside attached_assets/.
 *
 * Suppress with .largefilesignore (one path per line, # for comments). A
 * trailing slash matches a directory and everything under it.
 *
 * See docs/runbooks/secret-scanning.md for the full policy.
 */
import { execSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const IGNORE_FILE = ".largefilesignore";
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

// Path prefixes that should never be committed (build outputs, coverage)
const BLOCKED_PATH_PREFIXES = [
  "dist/",
  "build/",
  "coverage/",
  "out-tsc/",
  ".expo/",
  ".expo-shared/",
  ".next/",
  ".turbo/",
  ".nx/cache/",
];

// Match the same prefixes when nested under a workspace package
// (e.g. artifacts/ecom-agent/dist/foo.js)
const BLOCKED_PATH_SUBSTRINGS = BLOCKED_PATH_PREFIXES.map((p) => "/" + p);

// Build artifacts by extension
const BLOCKED_EXTENSIONS = [
  /\.tsbuildinfo$/i,
];

// Binary media — pasted screenshots/recordings should live in attached_assets/,
// which is .gitignored. If one slips out of that dir it's almost always an
// accidental paste from chat.
const MEDIA_EXT = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|mp4|mov|webm|mkv|avi|mp3|wav|m4a|ogg)$/i;
const MEDIA_ALLOWED_PREFIXES = [
  "attached_assets/",
  "artifacts/", // app assets like artifacts/<name>/public/logo.png are legitimate
  "docs/",      // runbook screenshots
];

function loadIgnore() {
  const p = join(ROOT, IGNORE_FILE);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

function isIgnored(file, ignoreList) {
  return ignoreList.some(
    (pat) => file === pat || file.startsWith(pat.endsWith("/") ? pat : pat + "/"),
  );
}

function getStagedFiles() {
  const out = execSync("git diff --cached --name-only --diff-filter=ACMR", {
    encoding: "utf8",
  });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

function getAllTrackedFiles() {
  const out = execSync("git ls-files", { encoding: "utf8" });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

function readStagedBlobSize(file) {
  const r = spawnSync("git", ["cat-file", "-s", `:${file}`], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return parseInt(r.stdout.trim(), 10);
}

function getFileSize(file, source) {
  if (source === "staged") {
    return readStagedBlobSize(file);
  }
  try {
    return statSync(join(ROOT, file)).size;
  } catch {
    return null;
  }
}

function checkPath(file) {
  for (const prefix of BLOCKED_PATH_PREFIXES) {
    if (file.startsWith(prefix)) {
      return { id: "build-output-path", detail: `path starts with ${prefix}` };
    }
  }
  for (const sub of BLOCKED_PATH_SUBSTRINGS) {
    if (file.includes(sub)) {
      return { id: "build-output-path", detail: `path contains ${sub}` };
    }
  }
  for (const re of BLOCKED_EXTENSIONS) {
    if (re.test(file)) {
      return { id: "build-output-extension", detail: `extension matches ${re}` };
    }
  }
  if (MEDIA_EXT.test(file)) {
    const allowed = MEDIA_ALLOWED_PREFIXES.some((p) => file.startsWith(p));
    if (!allowed) {
      return {
        id: "binary-media-outside-allowed-dirs",
        detail: `media files belong under ${MEDIA_ALLOWED_PREFIXES.join(", ")}`,
      };
    }
  }
  return null;
}

function fmtBytes(n) {
  if (n == null) return "?";
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + " MB";
  if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
  return n + " B";
}

function main() {
  const args = process.argv.slice(2);
  let files;
  let applyIgnore = true;
  let source = "worktree";
  if (args.includes("--staged")) {
    files = getStagedFiles();
    source = "staged";
  } else if (args.includes("--all")) {
    files = getAllTrackedFiles();
  } else if (args.length > 0) {
    files = args;
    applyIgnore = false;
  } else {
    console.error(
      "Usage: scan-large-files.mjs --staged | --all | <file> [<file> ...]",
    );
    process.exit(2);
  }

  const ignoreList = applyIgnore ? loadIgnore() : [];
  const findings = [];

  for (const file of files) {
    if (!file) continue;
    if (applyIgnore && isIgnored(file, ignoreList)) continue;
    if (source !== "staged" && !existsSync(join(ROOT, file))) continue;

    const pathHit = checkPath(file);
    if (pathHit) {
      findings.push({ file, ...pathHit });
    }

    const size = getFileSize(file, source);
    if (size != null && size > MAX_FILE_BYTES) {
      findings.push({
        id: "file-too-large",
        file,
        detail: `${fmtBytes(size)} exceeds ${fmtBytes(MAX_FILE_BYTES)} limit`,
      });
    }
  }

  if (findings.length === 0) {
    process.exit(0);
  }

  console.error("");
  console.error("\u001b[31m\u2717 Large-file / risky-path scan blocked the commit.\u001b[0m");
  console.error("");
  for (const f of findings) {
    console.error(`  ${f.file}  [${f.id}]`);
    if (f.detail) console.error(`      ${f.detail}`);
  }
  console.error("");
  console.error("How to proceed:");
  console.error("  1. Build outputs (dist/, build/, coverage/, *.tsbuildinfo): unstage them.");
  console.error("     They should be regenerated by the build, not checked in.");
  console.error("  2. Pasted screenshots/recordings: move them under attached_assets/");
  console.error("     (which is .gitignored), or delete them.");
  console.error("  3. Genuinely large file that MUST live in the repo: add the path");
  console.error(`     to ${IGNORE_FILE} after review, or use Git LFS.`);
  console.error("");
  console.error("Full policy: docs/runbooks/secret-scanning.md");
  process.exit(1);
}

main();
