#!/usr/bin/env node
/**
 * OpenWolf dashboard "taste score".
 *
 * A deterministic, reproducible quality score over src/dashboard/app/ that a
 * multi-agent loop can compete on: run it, see which dimension lost points,
 * fix that, run again to get a higher number. Every check is a static
 * grep/DOM-independent signal — no human "does this look good" judgement, so
 * two agents running it on identical code get identical scores.
 *
 * Score is 0-100 across six dimensions (weights sum to 100):
 *   accessibility 25 · color-line 20 · consistency 20 · component-DRY 15 ·
 *   state-coverage 10 · craft 10
 *
 * Usage:
 *   node scripts/taste-score.mjs            # human-readable report
 *   node scripts/taste-score.mjs --json     # machine-readable {score,dims}
 *   node scripts/taste-score.mjs --dir <p>  # scan a different dashboard dir
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.resolve(__dirname, "..", "src", "dashboard", "app");

const args = process.argv.slice(2);
const json = args.includes("--json");
const dirArg = args.indexOf("--dir");
const DIR = dirArg !== -1 ? path.resolve(args[dirArg + 1]) : DEFAULT_DIR;

// ─── helpers ────────────────────────────────────────────────────────────
function readAll(dir) {
  const out = {};
  function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "dist") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx|ts|css)$/.test(e.name)) out[p] = fs.readFileSync(p, "utf-8");
    }
  }
  walk(dir);
  return out;
}

const files = readAll(DIR);
const allCode = Object.values(files).join("\n");
const globals = files[path.join(DIR, "styles", "globals.css")] || "";
const components = Object.values(files).filter((p) => {
  const k = Object.keys(files).find((k) => files[k] === p);
  return /components\//.test(k);
});

function count(re) {
  const m = allCode.match(new RegExp(re, "g"));
  return m ? m.length : 0;
}
function has(re) {
  return new RegExp(re).test(allCode);
}
function hasGlobal(re) {
  return new RegExp(re).test(globals);
}
function countIn(name, re) {
  const f = Object.keys(files).find((k) => k.endsWith(name));
  if (!f) return 0;
  const m = files[f].match(new RegExp(re, "g"));
  return m ? m.length : 0;
}
function countEmoji() {
  // covers most emoji ranges incl. zodiac, pictographs, misc symbols
  const re = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;
  let n = 0;
  for (const c of components) {
    const k = Object.keys(files).find((kk) => files[kk] === c);
    n += (c.match(re) || []).length;
  }
  return n;
}

let detail = [];

// ─── dimension 1: accessibility (25) ────────────────────────────────────
function accessibility() {
  let s = 0;
  const add = (full, ok, note) => { if (ok) s += full; else detail.push(`   accessibility: ${note}`); };

  add(8, hasGlobal(":focus-visible"), "no global :focus-visible ring");
  const bareOutline = count("focus:outline-none");
  add(5, bareOutline === 0, `focus:outline-none ×${bareOutline} without a focus-visible replacement`);
  add(4, has("aria-label") && count("aria-label") > 0, "no aria-label anywhere");
  add(4, has("aria-expanded"), "no aria-expanded (collapse cards)");
  add(4, hasGlobal("prefers-reduced-motion"), "no prefers-reduced-motion");
  return s;
}

// ─── dimension 2: color-line (20) ───────────────────────────────────────
function colorLine() {
  let s = 0;
  const compCode = components.join("\n");
  const add = (full, ok, note) => { if (ok) s += full; else detail.push(`   color-line: ${note}`); };

  // hardcoded hex inside components (tokens live in globals.css --vars)
  const hex = (compCode.match(/#[0-9a-fA-F]{6}\b/g) || []).length;
  add(8, hex === 0, `hardcoded hex ×${hex} in components`);
  const rawRed = (compCode.match(/rgba\(\s*220,\s*38,\s*38/g) || []).length;
  add(6, rawRed === 0, `raw rgba(220,38,38) ×${rawRed}`);
  const strayRed = (compCode.match(/#e5484d/g) || []).length;
  add(3, strayRed === 0, `stray #e5484d ×${strayRed}`);
  add(3, count("color-mix") > 0, "no color-mix for subtle tones");
  return s;
}

// ─── dimension 3: consistency (20) ──────────────────────────────────────
function consistency() {
  let s = 0;
  const add = (full, ok, note) => { if (ok) s += full; else detail.push(`   consistency: ${note}`); };

  add(6, countEmoji() === 0, `emoji icons ×${countEmoji()} (use glyphs or SVG)`);
  // inline rounded-xl cards outside .wd-card (radius drift)
  const inlineCards = (components.join("\n").match(/rounded-xl[^"]*style=\{\{[^}]*border/g) || []).length;
  add(6, inlineCards === 0, `inline rounded-xl cards ×${inlineCards} (use .wd-card)`);
  add(4, count("var\\(--danger-subtle\\)") > 0, "danger-subtle token not used");
  add(4, true); // mono discipline is soft; grant
  return s;
}

// ─── dimension 4: component DRY (15) ────────────────────────────────────
function componentDry() {
  let s = 0;
  const add = (full, ok, note) => { if (ok) s += full; else detail.push(`   component-dry: ${note}`); };

  const rawSearch = count("<input type=\"text\" placeholder=\"Search");
  add(5, rawSearch === 0, `hand-rolled search input ×${rawSearch} (use <SearchInput/>)`);
  // accordions not via CollapseCard (heuristic: bare ▶/▼ toggle blocks)
  const rawAccordion = count("rounded-xl overflow-hidden");
  const collapseCards = count("<CollapseCard");
  add(5, collapseCards >= rawAccordion, `accordions not via <CollapseCard> (raw ${rawAccordion}, component ${collapseCards})`);
  const rawTables = count("<thead");
  add(5, rawTables <= 1, `raw <table> ×${rawTables} (extract WdTable, leave ≤1)`);
  return s;
}

// ─── dimension 5: state coverage (10) ───────────────────────────────────
function stateCoverage() {
  let s = 0;
  const add = (full, ok, note) => { if (ok) s += full; else detail.push(`   state: ${note}`); };

  const emptyStates = count("<EmptyState");
  const manualEmpty = count("text-center py-12") + count("text-center py-16");
  add(4, count("<EmptyState") > 0, "no EmptyState usage");
  add(3, has("animate-pulse") || has("Skeleton"), "no skeleton/loading indicator");
  add(3, has("ErrorBoundary") || has("componentDidCatch"), "no error boundary");
  return s;
}

// ─── dimension 6: craft (10) ────────────────────────────────────────────
function craft() {
  let s = 0;
  const add = (full, ok, note) => { if (ok) s += full; else detail.push(`   craft: ${note}`); };

  // only per-frame style writes (onMouseEnter ... currentTarget.style), not
  // React setState or a mention in a comment
  const hoverJS = count("onMouseEnter[\\s\\S]*?currentTarget\\.style");
  add(4, hoverJS === 0, `per-frame onMouseEnter hover ×${hoverJS} (use CSS .wd-row:hover)`);
  add(3, count("variant=\"outline\"") === 0, "dead variant='outline' in StatTile");
  add(3, has("<h1") || has("<h2"), "no semantic h1/h2 headings");
  return s;
}

const dims = [
  { id: "accessibility", name: "Accessibility", max: 25, score: accessibility() },
  { id: "color-line", name: "Color Line", max: 20, score: colorLine() },
  { id: "consistency", name: "Consistency", max: 20, score: consistency() },
  { id: "component-dry", name: "Component DRY", max: 15, score: componentDry() },
  { id: "state", name: "State Coverage", max: 10, score: stateCoverage() },
  { id: "craft", name: "Craft", max: 10, score: craft() },
];

const total = dims.reduce((a, d) => a + d.score, 0);

if (json) {
  console.log(JSON.stringify({ score: total, dims }, null, 2));
} else {
  console.log(`\n  dashboard taste score: ${total} / 100\n`);
  for (const d of dims) {
    console.log(`  ${d.name.padEnd(18)} ${String(d.score).padStart(2)} / ${d.max}`);
  }
  if (detail.length) {
    console.log(`\n  ${detail.length} deduction(s):`);
    for (const d of detail) console.log(`  ${d}`);
  }
  console.log("");
}
