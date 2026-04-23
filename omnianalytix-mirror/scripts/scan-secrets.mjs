#!/usr/bin/env node
/**
 * High-confidence secret scanner.
 *
 * Modes:
 *   scan-secrets.mjs --staged       Scan files staged for commit (used by pre-commit hook)
 *   scan-secrets.mjs --all          Scan every tracked file in the repo
 *   scan-secrets.mjs <file> [...]   Scan an explicit list of files
 *
 * Exits 0 on clean, 1 on any finding.
 *
 * Patterns are intentionally narrow to keep false-positive rate low. To suppress
 * a verified false positive, add the inline marker  secret-scan-ok  on the same
 * line, OR add the file path to .secretsignore (one path per line, # for comments).
 *
 * See docs/runbooks/secret-scanning.md for the full policy.
 */
import { execSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const ALLOW_TAG = "secret-scan-ok";
const IGNORE_FILE = ".secretsignore";

// ── Always-block file extensions / names (the leak we already cleaned up) ───
const BLOCKED_FILENAMES = [
  /(^|\/)\.env(\.|$)/i,                            // .env, .env.local, .env.production
  /(^|\/)service[-_]?account.*\.json$/i,           // GCP service account keys
  /(^|\/)gcp[-_]?key.*\.json$/i,
  /(^|\/)credentials\.json$/i,
  /(^|\/)id_rsa(\.pub)?$/,
  /(^|\/)id_ed25519(\.pub)?$/,
  /\.pem$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.keystore$/i,
];

// Files that ARE allowed even if matched above
const FILENAME_ALLOWLIST = [
  /\.env\.example$/i,
  /\.env\.sample$/i,
  /\.env\.template$/i,
];

// ── High-confidence content patterns ───────────────────────────────────────
// Every pattern here should virtually never appear in legitimate code.
const CONTENT_PATTERNS = [
  { id: "private-key-block",   re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { id: "google-oauth-client-secret", re: /GOCSPX-[A-Za-z0-9_-]{20,}/ },
  { id: "google-api-key",      re: /AIza[0-9A-Za-z_-]{35}/ },
  { id: "shopify-access-token-private", re: /shpss_[a-fA-F0-9]{32}/ },
  { id: "shopify-access-token", re: /shpat_[a-fA-F0-9]{32}/ },
  { id: "shopify-shared-secret", re: /shpca_[a-fA-F0-9]{32}/ },
  { id: "shopify-custom-token", re: /shpck_[a-fA-F0-9]{32}/ },
  { id: "aws-access-key-id",   re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: "aws-secret-access-key", re: /aws(.{0,20})?(secret|key).{0,5}['"=:\s]+([A-Za-z0-9/+=]{40})\b/i },
  { id: "github-pat-classic",  re: /\bghp_[A-Za-z0-9]{36}\b/ },
  { id: "github-pat-fine",     re: /\bgithub_pat_[A-Za-z0-9_]{82}\b/ },
  { id: "github-app-token",    re: /\b(?:ghs|gho|ghu|ghr)_[A-Za-z0-9]{36}\b/ },
  { id: "slack-bot-token",     re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { id: "slack-webhook",       re: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/ },
  { id: "stripe-secret-key",   re: /\bsk_live_[A-Za-z0-9]{24,}\b/ },
  { id: "stripe-restricted-key", re: /\brk_live_[A-Za-z0-9]{24,}\b/ },
  { id: "openai-api-key",      re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/ },
  { id: "anthropic-api-key",   re: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/ },
  { id: "sendgrid-api-key",    re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/ },
  { id: "twilio-api-key",      re: /\bSK[a-f0-9]{32}\b/ },
  { id: "jwt-token",           re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
];

// ── Bounded high-entropy detector ──────────────────────────────────────────
// Catches generic credentials that don't match a known prefix (e.g. random
// 40-char API keys assigned to env vars). Tuned aggressively for precision:
//   - candidate must be a QUOTED STRING (single/double/backtick) — random
//     tokens almost never appear bare in source
//   - candidate must contain BOTH a letter and a digit
//   - candidate must NOT contain '/', '.', ' ', or ':' (rules out URLs,
//     mime types, import paths, dotted identifiers)
//   - length >= 32
//   - Shannon entropy >= 4.5 bits/char (well above natural-language ~4.0
//     and above kebab-case identifiers)
//   - line must look like an assignment (`=`, `:`, `=>`) OR carry a
//     "secret-ish" key word (token/secret/key/password/auth/credential)
//   - skip lockfile integrity hashes (sha\d+-) and pure hex up to 64 chars
const ENTROPY_KEY_HINT = /\b(?:secret|token|password|passwd|pwd|api[_-]?key|apikey|auth|credential|bearer|access[_-]?key|private[_-]?key)\b/i;
const ENTROPY_QUOTED_RE = /['"`]([A-Za-z0-9+=_\-]{32,})['"`]/g;
const ENTROPY_THRESHOLD = 4.5;

function shannonEntropy(s) {
  const counts = new Map();
  for (const c of s) counts.set(c, (counts.get(c) || 0) + 1);
  const len = s.length;
  let h = 0;
  for (const n of counts.values()) {
    const p = n / len;
    h -= p * Math.log2(p);
  }
  return h;
}

function looksLikeSafeNoise(token) {
  // Lockfile-style integrity hashes
  if (/^sha\d+-/.test(token)) return true;
  // Pure hex up to 64 chars (git SHAs, sha1/sha256 hashes)
  if (/^[a-f0-9]+$/i.test(token) && token.length <= 64) return true;
  // Pure decimal (timestamps, ids)
  if (/^\d+$/.test(token)) return true;
  return false;
}

function checkEntropy(line) {
  const hasKeyHint = ENTROPY_KEY_HINT.test(line);
  const looksLikeAssignment = /[:=]\s*['"`]/.test(line) || /=>\s*['"`]/.test(line);
  if (!hasKeyHint && !looksLikeAssignment) return null;

  ENTROPY_QUOTED_RE.lastIndex = 0;
  let m;
  while ((m = ENTROPY_QUOTED_RE.exec(line)) !== null) {
    const tok = m[1];
    // Require at least one letter AND one digit (filters out kebab/snake identifiers)
    if (!/[A-Za-z]/.test(tok) || !/\d/.test(tok)) continue;
    if (looksLikeSafeNoise(tok)) continue;
    const h = shannonEntropy(tok);
    if (h >= ENTROPY_THRESHOLD) {
      return { id: "high-entropy-string", entropy: h.toFixed(2), token: tok.slice(0, 6) + "…" };
    }
  }
  return null;
}

// Skip these paths even when --all is used
const PATH_SKIP_DIRS = [
  "node_modules/", ".git/", "dist/", "build/", ".cache/", ".local/",
  "attached_assets/", "pnpm-lock.yaml", "package-lock.json", "yarn.lock",
  ".pythonlibs/", ".pytest_cache/", "screenshots/",
];

// Binary extensions — never scan
const BINARY_EXT = /\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|gz|tgz|tar|woff2?|ttf|otf|eot|mp4|mov|webm|mp3|wav)$/i;

function loadIgnore() {
  const p = join(ROOT, IGNORE_FILE);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

function isIgnored(file, ignoreList) {
  return ignoreList.some((pat) => file === pat || file.startsWith(pat.endsWith("/") ? pat : pat + "/"));
}

function shouldSkipPath(file) {
  return PATH_SKIP_DIRS.some((d) => file.startsWith(d) || file.includes("/" + d)) || BINARY_EXT.test(file);
}

function getStagedFiles() {
  const out = execSync("git diff --cached --name-only --diff-filter=ACMR", { encoding: "utf8" });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

// Read the STAGED (index) version of a file as a Buffer. Returns null if the
// file is not in the index. Critical: never fall back to the working tree —
// that would let a developer stage a secret and then edit the working copy
// to hide it from the scanner.
function readStagedBlob(file) {
  const r = spawnSync("git", ["show", `:${file}`], { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) return null;
  return r.stdout;
}

function readStagedBlobSize(file) {
  const r = spawnSync("git", ["cat-file", "-s", `:${file}`], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return parseInt(r.stdout.trim(), 10);
}

function getAllTrackedFiles() {
  const out = execSync("git ls-files", { encoding: "utf8" });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

function checkFilename(file) {
  if (FILENAME_ALLOWLIST.some((re) => re.test(file))) return null;
  for (const re of BLOCKED_FILENAMES) {
    if (re.test(file)) return { id: "blocked-filename", pattern: String(re) };
  }
  return null;
}

function checkContent(file, source = "worktree") {
  const findings = [];
  let content;
  try {
    if (source === "staged") {
      const size = readStagedBlobSize(file);
      if (size === null) return findings;
      if (size > 2 * 1024 * 1024) return findings; // skip blobs > 2 MB
      const buf = readStagedBlob(file);
      if (buf === null) return findings;
      // Heuristic: skip binaries (NUL byte in first 8 KB)
      if (buf.subarray(0, 8192).includes(0)) return findings;
      content = buf.toString("utf8");
    } else {
      const st = statSync(join(ROOT, file));
      if (st.size > 2 * 1024 * 1024) return findings;
      content = readFileSync(join(ROOT, file), "utf8");
    }
  } catch {
    return findings;
  }
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(ALLOW_TAG)) continue;
    for (const { id, re } of CONTENT_PATTERNS) {
      if (re.test(line)) findings.push({ id, line: i + 1, snippet: line.trim().slice(0, 120) });
    }
    const ent = checkEntropy(line);
    if (ent) {
      findings.push({
        id: ent.id,
        line: i + 1,
        snippet: `${line.trim().slice(0, 100)}  (entropy=${ent.entropy}, token=${ent.token})`,
      });
    }
  }
  return findings;
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
    // Explicit file arguments are scanned unconditionally — ignore lists only
    // apply to --staged and --all. This makes the scanner directly testable.
    applyIgnore = false;
  } else {
    console.error("Usage: scan-secrets.mjs --staged | --all | <file> [<file> ...]");
    process.exit(2);
  }

  const ignoreList = applyIgnore ? loadIgnore() : [];
  const findings = [];

  for (const file of files) {
    if (!file) continue;
    if (applyIgnore && (isIgnored(file, ignoreList) || shouldSkipPath(file))) continue;
    // For --staged, the file may not exist in the working tree (deleted post-stage)
    // but still exist in the index — we only care that the index entry exists.
    if (source !== "staged" && !existsSync(join(ROOT, file))) continue;

    const fnHit = checkFilename(file);
    if (fnHit) findings.push({ file, ...fnHit, line: 0, snippet: "(blocked filename)" });

    const hits = checkContent(file, source);
    for (const h of hits) findings.push({ file, ...h });
  }

  if (findings.length === 0) {
    process.exit(0);
  }

  console.error("");
  console.error("\u001b[31m\u2717 Secret scan blocked the commit.\u001b[0m");
  console.error("");
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.id}]`);
    if (f.snippet) console.error(`      ${f.snippet}`);
  }
  console.error("");
  console.error("How to proceed:");
  console.error("  1. If real:  rotate the credential immediately, remove from staged files,");
  console.error("               and follow docs/runbooks/secret-rotation-and-history-rewrite.md");
  console.error("  2. If false positive on one line: append the comment  " + ALLOW_TAG);
  console.error("  3. If false positive on a whole file: add the path to .secretsignore");
  console.error("");
  console.error("Full policy: docs/runbooks/secret-scanning.md");
  process.exit(1);
}

main();
