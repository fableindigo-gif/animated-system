#!/usr/bin/env node
// Static WCAG 2.1 AA contrast audit for the ecom-agent design tokens.
//
// Why static, not axe/Lighthouse?
//   The five audited routes (home, executive-brief, feed-enrichment,
//   connections, workspace-settings) are all gated behind auth and
//   there is no dev-mode bypass available — the Phase 0.5 audit
//   itself flags this in PHASE_0_FINDINGS.md. A token-pair scan over
//   the same `index.css` semantic colors that those pages render with
//   gives the same coverage without a live browser session.
//
// What it does:
//   1. Parses every `--color-*` and `--*-foreground` token in
//      `artifacts/ecom-agent/src/index.css` (both the @theme inline
//      block and the :root block).
//   2. Cross-products every plausible "text" token against every
//      plausible "background" token.
//   3. Computes WCAG 2.1 relative-luminance contrast for each pair.
//   4. Emits a Markdown report to artifacts/ecom-agent/audit/contrast-scan.md
//      with pass/fail counts at the AA (4.5:1) and AAA (7:1) thresholds.
//
// Run: `pnpm --filter @workspace/ecom-agent run audit:contrast`
//   (or directly: `node artifacts/ecom-agent/audit/scripts/contrast-audit.mjs`)

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(__dirname, "../../src/index.css");
const OUT_PATH = resolve(__dirname, "../contrast-scan.md");

const css = readFileSync(CSS_PATH, "utf8");

// ── Color parsing ─────────────────────────────────────────────────────────────
function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const v = h.length === 3
    ? h.split("").map((c) => parseInt(c + c, 16))
    : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  return v;
}
function relLum([r, g, b]) {
  const ch = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}
function contrast(rgbA, rgbB) {
  const [a, b] = [relLum(rgbA), relLum(rgbB)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

// ── Token extraction ──────────────────────────────────────────────────────────
// Catches both `--name: hsl(var(--foo));` and `--name: #hex;` and
// `--name: 240 6% 95%;` (raw HSL channel form used inside :root).
const tokens = new Map(); // name → rgb tuple
const lines = css.split("\n");
const hslChannelRe = /^\s*--([a-z0-9-]+):\s*(\d+)\s+(\d+)%\s+(\d+)%(?:\s*\/\s*[\d.]+)?\s*;/i;
const hexRe = /^\s*--([a-z0-9-]+):\s*(#[0-9a-f]{3,8})\s*;/i;

// raw HSL channel tokens (these are the `:root` ones referenced via hsl(var(--x)))
const rawHsl = new Map();
for (const line of lines) {
  const m = line.match(hslChannelRe);
  if (m) {
    const [, name, h, s, l] = m;
    rawHsl.set(name, [Number(h), Number(s), Number(l)]);
  }
  const hm = line.match(hexRe);
  if (hm) {
    tokens.set(hm[1], hexToRgb(hm[2]));
  }
}
for (const [name, [h, s, l]] of rawHsl) {
  tokens.set(name, hslToRgb(h, s, l));
}

// Resolve `--color-foo: hsl(var(--foo))` aliases — when the @theme block
// references a raw-hsl token by name, copy the resolved rgb onto the
// alias name as well.
const aliasRe = /^\s*--(color-[a-z0-9-]+):\s*hsl\(var\(--([a-z0-9-]+)\)\)\s*;/i;
for (const line of lines) {
  const m = line.match(aliasRe);
  if (m && tokens.has(m[2])) tokens.set(m[1], tokens.get(m[2]));
}

// ── Surface vs text classification ────────────────────────────────────────────
// Surfaces = anything we draw text on. Text tokens = anything we render text in.
const SURFACE_HINTS = [
  "background", "card", "popover", "muted", "accent", "secondary", "primary",
  "destructive", "sidebar", "surface", "surface-container", "surface-bright",
  "surface-dim", "surface-variant", "surface-tint",
  "primary-container", "secondary-container", "tertiary-container",
  "primary-fixed", "secondary-fixed", "tertiary-fixed",
  "primary-fixed-dim", "secondary-fixed-dim", "tertiary-fixed-dim",
  "error-container", "inverse-surface",
  "status-success-bg", "status-warning-bg", "status-critical-bg",
];
const TEXT_HINTS = [
  "foreground", "on-surface", "on-surface-variant", "on-background",
  "on-primary", "on-secondary", "on-tertiary", "on-error",
  "on-primary-container", "on-secondary-container", "on-tertiary-container",
  "on-error-container", "inverse-on-surface", "inverse-primary",
  "on-secondary-fixed", "on-secondary-fixed-variant",
  "on-primary-fixed", "on-primary-fixed-variant",
  "on-tertiary-fixed", "on-tertiary-fixed-variant",
  "primary", "accent-blue", "brand-blue", "outline",
  "status-success-fg", "status-warning-fg", "status-critical-fg",
];
function classify(name) {
  const surface = SURFACE_HINTS.some((h) => name === `color-${h}` || name === h || name === `color-${h}` || name.endsWith(`-${h}`));
  const text = TEXT_HINTS.some((h) => name === `color-${h}` || name === h || name.endsWith(`-${h}`));
  return { surface, text };
}

const surfaces = [];
const texts = [];
for (const [name, rgb] of tokens) {
  const c = classify(name);
  if (c.surface) surfaces.push({ name, rgb });
  if (c.text)    texts.push({ name, rgb });
}

// ── Pair scoring ──────────────────────────────────────────────────────────────
// We do NOT cross-product every pair (that would surface meaningless combos
// like "destructive text on destructive bg"). Instead we evaluate each text
// token against the realistic backgrounds it actually renders on:
//   - Every neutral surface (background/card/muted/surface-*)
//   - Plus its semantic counterpart (e.g. on-primary against primary)
const NEUTRAL_BG_NAMES = new Set([
  "background", "card", "popover", "muted", "secondary", "sidebar",
  "color-surface", "color-surface-bright", "color-surface-container",
  "color-surface-container-low", "color-surface-container-lowest",
  "color-surface-container-high", "color-surface-container-highest",
  "color-surface-variant", "color-omni-neutral",
]);
const SEMANTIC_PAIRS = [
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["accent-foreground", "accent"],
  ["destructive-foreground", "destructive"],
  ["muted-foreground", "muted"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["sidebar-foreground", "sidebar"],
  ["sidebar-primary-foreground", "sidebar-primary"],
  ["sidebar-accent-foreground", "sidebar-accent"],
  ["color-on-surface", "color-surface"],
  ["color-on-surface-variant", "color-surface-variant"],
  ["color-on-background", "background"],
  ["color-on-primary", "color-primary-m3"],
  ["color-on-primary-container", "color-primary-container"],
  ["color-on-secondary-container", "color-secondary-container"],
  ["color-on-tertiary-container", "color-tertiary-container"],
  ["color-on-error", "color-error-m3"],
  ["color-on-error-container", "color-error-container"],
  ["color-status-success-fg", "color-status-success-bg"],
  ["color-status-warning-fg", "color-status-warning-bg"],
  ["color-status-critical-fg", "color-status-critical-bg"],
  ["inverse-on-surface", "inverse-surface"],
];

const results = [];
const seenPairs = new Set();
function evalPair(textName, bgName) {
  if (!tokens.has(textName) || !tokens.has(bgName)) return;
  const key = `${textName}|${bgName}`;
  if (seenPairs.has(key)) return; // dedupe so pass-rate counts are exact
  seenPairs.add(key);
  const ratio = contrast(tokens.get(textName), tokens.get(bgName));
  results.push({
    text: textName,
    bg: bgName,
    ratio: Number(ratio.toFixed(2)),
    aa:  ratio >= 4.5,
    aaa: ratio >= 7.0,
    aaLarge: ratio >= 3.0,
  });
}

// neutral surface text (every text token tried against every neutral bg)
const neutralBgs = surfaces.filter((s) => NEUTRAL_BG_NAMES.has(s.name));
const neutralTextCandidates = [
  "foreground", "card-foreground", "popover-foreground", "muted-foreground",
  "secondary-foreground", "sidebar-foreground",
  "color-on-surface", "color-on-surface-variant", "color-on-background",
  "color-on-secondary-container",
  "primary", "color-primary-m3", "color-accent-blue", "color-brand-blue",
];
for (const t of neutralTextCandidates) {
  for (const bg of neutralBgs) evalPair(t, bg.name);
}
// semantic pairs
for (const [t, bg] of SEMANTIC_PAIRS) evalPair(t, bg);

// ── Report ────────────────────────────────────────────────────────────────────
const total = results.length;
const aaPass = results.filter((r) => r.aa).length;
const aaaPass = results.filter((r) => r.aaa).length;
const fails = results.filter((r) => !r.aa);

const lines2 = [];
lines2.push(`# OmniAnalytix design-token contrast scan`);
lines2.push("");
lines2.push(`Generated by \`artifacts/ecom-agent/audit/scripts/contrast-audit.mjs\``);
lines2.push(`from the live \`artifacts/ecom-agent/src/index.css\` token definitions.`);
lines2.push(`Run: \`pnpm --filter @workspace/ecom-agent run audit:contrast\`.`);
lines2.push("");
lines2.push(`## Summary`);
lines2.push("");
lines2.push(`| Threshold | Pass | Fail | Pass-rate |`);
lines2.push(`|-----------|-----:|-----:|----------:|`);
lines2.push(`| WCAG AA  (4.5 : 1) | ${aaPass}  | ${total - aaPass}  | ${(aaPass / total * 100).toFixed(1)}% |`);
lines2.push(`| WCAG AAA (7.0 : 1) | ${aaaPass} | ${total - aaaPass} | ${(aaaPass / total * 100).toFixed(1)}% |`);
lines2.push("");
if (fails.length === 0) {
  lines2.push(`✅ **No AA failures.** Every realistic text/background pair drawn from the`);
  lines2.push(`design tokens meets the 4.5 : 1 small-text threshold.`);
} else {
  lines2.push(`### AA failures (${fails.length})`);
  lines2.push("");
  lines2.push(`| Text token | Background token | Ratio | AA Large (3:1) |`);
  lines2.push(`|------------|------------------|------:|:--------------:|`);
  for (const f of fails) {
    lines2.push(`| \`--${f.text}\` | \`--${f.bg}\` | ${f.ratio.toFixed(2)} : 1 | ${f.aaLarge ? "✅" : "❌"} |`);
  }
}
lines2.push("");
lines2.push(`## All scored pairs (${total})`);
lines2.push("");
lines2.push(`| Text token | Background token | Ratio | AA | AAA |`);
lines2.push(`|------------|------------------|------:|:--:|:---:|`);
for (const r of results.sort((a, b) => a.ratio - b.ratio)) {
  lines2.push(`| \`--${r.text}\` | \`--${r.bg}\` | ${r.ratio.toFixed(2)} : 1 | ${r.aa ? "✅" : "❌"} | ${r.aaa ? "✅" : "❌"} |`);
}

writeFileSync(OUT_PATH, lines2.join("\n") + "\n", "utf8");
console.log(`Wrote ${OUT_PATH}`);
console.log(`AA: ${aaPass}/${total} pass (${(aaPass / total * 100).toFixed(1)}%)`);
console.log(`AAA: ${aaaPass}/${total} pass (${(aaaPass / total * 100).toFixed(1)}%)`);
if (fails.length) {
  console.log(`\nAA failures:`);
  for (const f of fails) console.log(`  ${f.text} on ${f.bg}: ${f.ratio.toFixed(2)}:1`);
  process.exit(1);
}
