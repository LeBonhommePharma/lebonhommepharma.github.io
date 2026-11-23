#!/usr/bin/env node
/**
 * design-system/check-contrast.mjs — the annotated ratios must be true.
 *
 * tokens.css writes a contrast ratio beside each colour. Those numbers are the
 * system's load-bearing accessibility claim, and a number in a comment rots the
 * moment someone nudges a hue. This recomputes every one of them from the WCAG
 * 2.1 relative-luminance formula and fails if a comment disagrees with the
 * colour it sits next to.
 *
 * It also asserts the pairs that no comment covers: every foreground token
 * against the ground it is actually used on, in BOTH themes. Contrast is a
 * (foreground, background) pair — a ratio quoted without naming its background
 * is not a measurement, so nothing here is checked against an assumed ground.
 *
 * And it reads elements.css, the half of the package that puts text on a page.
 * Proving the tokens readable proves nothing about a rule that reaches past a
 * twin for the bare identity hue, so every `color:` there is measured too, in
 * both themes.
 *
 * WCAG 2.1 AA: 4.5:1 body · 3:1 at >=24px or >=18.66px bold · 3:1 non-text.
 *
 * Usage: check-contrast.mjs [--verbose]
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTokens, resolve, ROOT, SOURCE } from './extract.mjs';
import { contrast, fmtRatio } from './oklch.mjs';

const VERBOSE = process.argv.includes('--verbose');
const css = readFileSync(SOURCE, 'utf8');
const blocks = parseTokens(css);
const LIGHT = '[data-theme="light"]';

/**
 * Colour maths comes from oklch.mjs. It used to be a private copy in this
 * file, and that copy carried its own `Math.round(... * 100) / 100` feeding
 * the `r < 4.5` test below — the same defect that let two colorsets ship
 * below AA reported as passing. Four copies of one formula is four places for
 * it to rot; the last time it rotted, a copy dropped the /255 and white on
 * black measured 10,498,937:1. One definition, imported.
 *
 * Proven equivalent to the copy it replaces before it replaced it: bit-
 * identical contrast on 30,047 inputs across three grounds, zero verdict
 * changes at the 4.5 bar.
 *
 * `ratio` wraps `contrast` only to preserve this file's null-on-bad-input
 * behaviour — oklch.mjs throws, and the callers here report a malformed token
 * as a named failure rather than dying on it.
 */
const HEX_RE = /^#([0-9A-Fa-f]{6})$/;

/** Contrast ratio, UNROUNDED, or null if either side is not a plain hex. */
function ratio(fg, bg) {
  if (!HEX_RE.test(String(fg).trim()) || !HEX_RE.test(String(bg).trim())) return null;
  return contrast(fg, bg);
}

/** 2-dp form for human reading. Never compare against this. */
const show = (r) => (r === null ? null : fmtRatio(r));

let fail = 0;
const bad = (msg) => { console.log(`  FAIL  ${msg}`); fail++; };
const ok = (msg) => { if (VERBOSE) console.log(`  ok    ${msg}`); };

// ── 1. every annotated ratio must match its colour ──────────────────────────
// Matches `--name: #HEX;` followed on the same line by `N.NN:1` or a bare
// `N.NN` in the trailing comment. The background is whichever --bg is in scope
// for the block the declaration sits in.
console.log('── annotated ratios in tokens.css');
let annotated = 0;
let block = ':root';
for (const raw of css.split('\n')) {
  if (/^\s*\[data-theme="light"\]\s*\{/.test(raw)) block = LIGHT;
  else if (/^\s*:root\s*\{/.test(raw)) block = ':root';
  const m = /^\s*(--[A-Za-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{6})\s*;[^\n]*?(\d+\.\d{2})\s*(?::1)?/.exec(raw);
  if (!m) continue;
  const [, name, hex, claimed] = m;
  const bg = resolve(blocks, block, '--bg');
  const actual = ratio(hex, bg);
  annotated++;
  if (actual === null) continue;
  // This one is an ANNOTATION-AGREEMENT check, not an accessibility threshold:
  // the claim in the comment is itself written to 2 dp, so the comparison is
  // display-against-display and the 0.02 tolerance is about transcription
  // drift, not about contrast. Deliberately NOT changed to full precision —
  // that would red-flag every correctly-annotated token in the file.
  if (Math.abs(show(actual) - Number(claimed)) > 0.02) {
    bad(`${name} ${hex} on ${bg}: annotated ${claimed}:1, measured ${show(actual)}:1`);
  } else {
    ok(`${name} ${hex} on ${bg} = ${show(actual)}:1 (annotated ${claimed})`);
  }
}
console.log(`  ${annotated} annotated ratio(s) checked`);
if (annotated === 0) {
  console.log('  FAIL  parsed no annotated ratios — the pattern has stopped matching.');
  console.log('        A check that silently matches nothing reports a clean pass it never made.');
  fail++;
}

// ── 2. foreground tokens against the ground they are used on ────────────────
// AA body text. These are the tokens whose entire job is to be read.
// ── the body target ─────────────────────────────────────────────────────────
// Read from the generated roles.json so there is ONE definition of "the body
// target" in the repo and this file is not a second place for it to drift.
// emit.mjs owns the number and the reason; see AA_BODY_WITH_MARGIN there.
//
// WCAG AA body is 4.5. The extra 0.05 buys distance from the quantisation
// grid: a value clearing by less than the distance to the nearest
// representable colour has not cleared on purpose.
//
// The size of "one 8-bit step" is NOT a single number -- it depends which
// channel moves, because the three carry different luminance weights.
// Measured for --firetruck-fg #E4001C on the light ground #f4f6fb:
//
//     1 step in red    0.03427374
//     1 step in green  0.00452309
//     1 step in blue   0.00101509
//
// So 0.05 is more than one step in ANY channel for this colour -- the margin
// is generous rather than exact, which is the intent.
//
// --firetruck-fg used to sit at 4.5004389770, clearing 4.5 by 0.0004389770.
// That is less than one 8-bit step in any channel (1/78 of a red step, 1/10
// of a green one, 1/2 of a blue one). State it that way rather than as a
// fraction of "a step": a single step-size figure for a three-channel value
// is not meaningful, and an earlier version of this comment claimed 1/150th
// by picking one.
const ROLES = JSON.parse(
  readFileSync(new URL('./dist/BrandColors.xcassets/roles.json', import.meta.url), 'utf8')
);
const BODY_TARGET = ROLES.targets.body;
if (typeof BODY_TARGET !== 'number') {
  console.log('FATAL: roles.json has no numeric targets.body — refusing to run.');
  console.log('       Regenerate: node design-system/emit.mjs');
  process.exit(2);
}

const BODY = ['--fg', '--fg-muted', '--state-fail-text',
  '--mint-fg', '--violet-fg', '--tangerine-fg', '--firetruck-fg',
  '--aqua-fg', '--strawberry-fg', '--magnesium-fg',
  '--t-cryo-fg', '--t-cold-fg', '--t-ambient-fg', '--t-physio-fg', '--t-denature-fg',
  '--fig-ink'];

for (const [theme, sel] of [['dark', ':root'], ['light', LIGHT]]) {
  console.log(`\n── ${theme} theme · foreground tokens vs --bg · body target ${BODY_TARGET}:1`);
  const bg = resolve(blocks, sel, '--bg');
  for (const name of BODY) {
    const hex = resolve(blocks, sel, name);
    if (!hex) { bad(`${name} is not defined in the ${theme} theme`); continue; }
    const r = ratio(hex, bg);
    if (r === null) { bad(`${name} = ${hex} is not a plain hex; cannot measure`); continue; }
    // Exact comparison; 6 dp alongside the 2 dp form so a near-miss reads as
    // a real failure rather than as a broken guard printing "4.5 < 4.5".
    if (r < BODY_TARGET) bad(`${theme}: ${name} ${hex} on ${bg} = ${show(r)}:1 (${r.toFixed(6)}) — below the body target (${BODY_TARGET}:1)`);
    else ok(`${theme}: ${name} ${hex} on ${bg} = ${show(r)}:1`);
  }
}

// ── 3. the bare key colours, reported honestly per theme ────────────────────
// These are NOT failed on the light ground: by design they are identity hues
// for fills, washes and charts on the dark ground, and --*-fg is the token for
// reading. Reported so the limitation stays visible instead of being forgotten
// back into a page as text.
console.log('\n── bare key colours (identity hues — use --*-fg for anything read)');
for (const name of ['mint', 'violet', 'tangerine', 'firetruck', 'aqua', 'strawberry', 'magnesium']) {
  const hex = resolve(blocks, ':root', `--${name}`);
  const onDark = ratio(hex, resolve(blocks, ':root', '--bg'));
  const onLight = ratio(hex, resolve(blocks, LIGHT, '--bg'));
  const note = onLight < 3 ? 'light: NON-TEXT USE ONLY BELOW 3:1 — must use --' + name + '-fg' : '';
  console.log(`  ${name.padEnd(11)} ${hex}  dark ${String(show(onDark)).padStart(6)}:1   light ${String(show(onLight)).padStart(5)}:1  ${note}`);
}

// ── 4. every colour elements.css asks a person to read ──────────────────────
// Sections 1–3 prove the TOKENS readable, and none of that reached the rules
// that use them: every accent rule in elements.css read a bare key colour
// while this check stayed green, because the colours it measured were not the
// colours on the page. So the rules are measured too, per selector, in both
// themes, against the one ground the file paints (body: var(--bg)).
//
// Every run is held to the body target whatever its size. .eq-dg, .brand and
// `a` inherit their size from markup this file never sees, so a large-text
// allowance would be a guess about that markup.
//
// Fail-closed, the way extract.mjs is: flat rules only. An at-rule block, a
// theme qualifier this does not recognise, a second painted ground or a colour
// it cannot resolve is a FAIL, never a skip. A check that half-reads a file and
// reports the half reports a pass it never made.
const ELEMENTS = 'design/palette-v2/packages/flexaidds-tokens/elements.css';
console.log(`\n── ${ELEMENTS} · every text colour vs --bg · body target ${BODY_TARGET}:1`);
const elCss = readFileSync(join(ROOT, ELEMENTS), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
if (/@[A-Za-z-]+[^;{}]*\{/.test(elCss)) {
  bad('elements.css has an at-rule block — this reads flat rules only; teach it the block before trusting it');
}

const THEMED = /^\[data-theme="(light|dark)"\]\s+/;
const VAR_ONLY = /^var\(\s*(--[A-Za-z0-9-]+)\s*\)$/;
const runs = new Map(); // selector -> { base, dark, light } colour expressions
let paintsGround = false;
for (const [, selText, body] of elCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const decls = {};
  for (const d of body.split(';')) {
    const h = /^\s*([A-Za-z-]+)\s*:\s*([\s\S]+?)\s*$/.exec(d);
    if (h) decls[h[1].toLowerCase()] = h[2].replace(/\s+/g, ' ');
  }
  const ground = decls['background-color'] ?? decls.background;
  for (const raw of selText.split(',')) {
    const sel = raw.replace(/\s+/g, ' ').trim();
    if (!sel) continue;
    if (ground !== undefined) {
      if (sel === 'body' && ground === 'var(--bg)') paintsGround = true;
      else bad(`${sel} paints its own ground (${ground}) — measure text against it before trusting this check`);
    }
    // A light- or dark-scoped rule overrides its base selector in that theme
    // only; it outranks the base on specificity, so source order is moot.
    const t = THEMED.exec(sel);
    const key = t ? sel.slice(t[0].length) : sel;
    if (/data-theme/.test(key)) {
      bad(`${sel}: a theme qualifier this check cannot attribute — write it as [data-theme="light"] <selector>`);
      continue;
    }
    if (decls.color === undefined) continue;
    const run = runs.get(key) ?? {};
    run[t ? t[1] : 'base'] = decls.color; // later wins, as in the cascade
    runs.set(key, run);
  }
}
if (!paintsGround) bad('body no longer paints var(--bg) — measuring against --bg would be an assumed ground');

/** The read twin of a bare colour, following var() aliases: --state-pass -> --mint-fg. */
function twinOf(expr) {
  let m = VAR_ONLY.exec(expr);
  for (let guard = 0; m && guard < 32; guard++) {
    if (blocks[':root'][`${m[1]}-fg`] !== undefined) return `var(${m[1]}-fg)`;
    m = VAR_ONLY.exec(blocks[':root'][m[1]] ?? '');
  }
  return null;
}

let measured = 0;
for (const [sel, run] of runs) {
  for (const [theme, block] of [['dark', ':root'], ['light', LIGHT]]) {
    const expr = run[theme] ?? run.base;
    if (expr === undefined) continue;
    measured++;
    const bg = resolve(blocks, block, '--bg');
    const v = VAR_ONLY.exec(expr);
    let fg;
    try {
      fg = v ? resolve(blocks, block, v[1]) : expr;
    } catch (e) {
      bad(`${theme}: ${sel} { color: ${expr} } — ${e.message}`);
      continue;
    }
    if (fg === undefined) { bad(`${theme}: ${sel} { color: ${expr} } — tokens.css does not define ${v[1]}`); continue; }
    const r = ratio(fg, bg);
    if (r === null) { bad(`${theme}: ${sel} { color: ${expr} } = ${fg} is not a plain hex; cannot measure`); continue; }
    if (r < BODY_TARGET) {
      const twin = twinOf(expr);
      bad(`${theme}: ${sel} { color: ${expr} } = ${fg} on ${bg} = ${show(r)}:1 (${r.toFixed(6)}) — below the body target (${BODY_TARGET}:1)${twin ? `; read it through ${twin}` : ''}`);
    } else ok(`${theme}: ${sel} { color: ${expr} } = ${fg} on ${bg} = ${show(r)}:1`);
  }
}
console.log(`  ${measured} text run(s) measured across ${runs.size} selector(s)`);
if (measured === 0) {
  console.log('  FAIL  parsed no `color:` from elements.css — the pattern has stopped matching.');
  console.log('        A check that silently matches nothing reports a clean pass it never made.');
  fail++;
}

console.log('');
if (fail) {
  console.log(`contrast: ${fail} failure(s).`);
  console.log('A ratio is a (foreground, background) pair. Fix the colour, or fix the number —');
  console.log('never the comment alone. Re-solve with: node design-system/derive-light.mjs 4.5');
  console.log('A rule in elements.css is fixed in the rule: read the --*-fg twin, not the bare hue.');
  process.exit(1);
}
console.log('contrast: every annotated ratio is true, every foreground token clears AA, and');
console.log('every colour elements.css asks a person to read clears the body target in both themes.');
