#!/usr/bin/env node
/**
 * design-system/check-exergy-contrast.mjs — the Exergy pages must be readable
 * in BOTH themes, not just the one they were designed in.
 *
 * WHY
 * ---
 * Exergy's pages load /theme.css and /theme.js, so they render in light
 * appearance whenever the visitor has chosen it. Every accent on those pages
 * was written as `var(--tangerine)` — the bare identity hue. On the dark ink
 * that is 8.86:1 and fine. On the light ground it is 2.06:1, which is below
 * WCAG AA body (4.5), below the large-text bar (3), and below the 1.4.11
 * non-text floor (3). Links, the kicker, card headings, inline code, the ring
 * numeral and the progress rings themselves were all affected.
 *
 * tokens.css already says this in words:
 *
 *     "bare key colours … by design they are identity hues for fills, washes
 *      and charts on the dark ground, and --*-fg is the token for reading"
 *
 * `--*-fg` resolves to the identity hue in dark and to a solved, contrast-
 * clearing value in light, so routing through it fixes light appearance and
 * leaves dark byte-identical. This guard is what stops the routing being
 * undone.
 *
 * WHAT IT ASSERTS
 * ---------------
 * 1. No bare identity hue appears in a `color:`, `outline:` or `background:`
 *    declaration in Exergy/exergy.css. Washes and decorative borders may use
 *    them — that is what they are for — so `color-mix()` and the `--*-NN`
 *    alpha ramps are out of scope.
 * 2. The resolved Exergy accent clears its target against every ground it is
 *    actually drawn on, in BOTH themes, at full precision.
 *
 * Targets come from the design system, not from here: body 4.55 for anything
 * read, 3.0 for graphics that carry meaning (WCAG 2.1 SC 1.4.11).
 *
 * Usage: check-exergy-contrast.mjs [--self-test]
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { contrast, rgbOf } from './oklch.mjs';
import { parseTokens, resolve, SOURCE } from './extract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CSS_PATH = join(ROOT, 'Exergy', 'exergy.css');
const LIGHT = '[data-theme="light"]';

// Body text needs the margin target; graphics that carry meaning need 3:1.
// 4.55 is the same body target the catalog uses — see AA_BODY_WITH_MARGIN in
// emit.mjs for why it is 4.5 plus one 8-bit quantisation step.
const BODY_TARGET = 4.55;
const GRAPHIC_TARGET = 3.0;

const IDENTITY = ['mint', 'violet', 'tangerine', 'firetruck', 'aqua', 'strawberry', 'magnesium'];

/** Bare identity hues used in a foreground/outline/fill declaration. */
export function bareIdentityUses(css) {
  const out = [];
  const lines = css.split('\n');
  lines.forEach((line, i) => {
    const m = /^\s*(color|outline|background)\s*:\s*(.+?);?\s*$/.exec(line);
    if (!m) return;
    const [, prop, value] = m;
    // color-mix() and the --NAME-NN alpha ramps are washes. Identity hues are
    // exactly what those are for; this guard is about foreground use.
    if (/color-mix\(/.test(value)) return;
    for (const name of IDENTITY) {
      const re = new RegExp(`var\\(\\s*--${name}\\s*[),]`);
      if (re.test(value)) out.push({ line: i + 1, prop, value: value.trim(), token: `--${name}` });
    }
  });
  return out;
}

function selfTest() {
  let ok = true;
  const say = (good, label) => {
    console.log(`  ${good ? 'ok    ' : 'BROKEN'} ${label}`);
    if (!good) ok = false;
  };

  // It must flag the shape the Exergy pages actually shipped with.
  say(bareIdentityUses('  color: var(--tangerine);').length === 1, 'flags `color: var(--tangerine)`');
  say(bareIdentityUses('  background: var(--tangerine);').length === 1, 'flags `background: var(--tangerine)`');
  say(bareIdentityUses('  outline: 2px solid var(--tangerine);').length === 1, 'flags an outline in a bare identity hue');
  say(bareIdentityUses('  color: var(--mint);').length === 1, 'flags a different identity hue too, not just tangerine');

  // It must NOT flag the routed form, or the washes that are meant to use them.
  say(bareIdentityUses('  color: var(--tangerine-fg);').length === 0, 'allows `color: var(--tangerine-fg)`');
  say(bareIdentityUses('  border: 1px solid color-mix(in srgb, var(--tangerine) 28%, transparent);').length === 0, 'allows a color-mix wash');
  say(bareIdentityUses('  background: var(--tangerine-12);').length === 0, 'allows the alpha ramp');
  say(bareIdentityUses('  color: var(--fg);').length === 0, 'allows a neutral token');

  // The maths must still separate a pass from a fail at the targets in use.
  say(contrast('#FF9300', '#f4f6fb') < GRAPHIC_TARGET, 'bare tangerine on the light ground is below even 3:1');
  say(contrast('#A75E00', '#f4f6fb') >= BODY_TARGET, 'the solved light tangerine clears the body target');
  say(contrast('#FF9300', '#08091A') >= BODY_TARGET, 'bare tangerine on the ink clears it (dark is unaffected)');

  if (!ok) {
    console.error('\nself-test FAILED — the check below cannot be trusted.');
    process.exit(2);
  }
}

console.log('── self-test');
selfTest();
if (process.argv.includes('--self-test')) {
  console.log('\nself-test passed.');
  process.exit(0);
}

const css = readFileSync(CSS_PATH, 'utf8');
const tokens = parseTokens(readFileSync(SOURCE, 'utf8'));
let fail = 0;

// ── the accent token, read from exergy.css rather than assumed ──────────────
// An earlier draft hardcoded --tangerine-fg here. That meant flipping
// `--exergy-chrome: var(--tangerine-fg)` back to `var(--tangerine)` — the
// single most likely regression, and the exact bug this guard exists for —
// left it passing, because it was measuring the token it wished the page used
// instead of the one the page actually uses. Caught by mutating my own guard.
const chromeDecl = /--exergy-chrome\s*:\s*var\(\s*(--[A-Za-z0-9-]+)\s*\)/.exec(css);
if (!chromeDecl) {
  console.error('FATAL: could not find `--exergy-chrome: var(--…)` in Exergy/exergy.css.');
  console.error('       Refusing to run — without it this guard would measure an accent the');
  console.error('       page may not be using.');
  process.exit(2);
}
const ACCENT = chromeDecl[1];
console.log(`\n── accent: exergy.css binds --exergy-chrome to ${ACCENT}`);

console.log('\n── 1. no bare identity hue in a foreground declaration');
const bare = bareIdentityUses(css);
if (bare.length) {
  console.log(`  FAIL  ${bare.length} declaration(s) use an identity hue where a readable one is needed:`);
  for (const b of bare) console.log(`        exergy.css:${b.line}  ${b.prop}: ${b.value}`);
  console.log('        Identity hues are for fills, washes and charts. Route foreground use');
  console.log('        through --NAME-fg, which is the same colour in dark appearance and a');
  console.log('        solved, contrast-clearing one in light.');
  fail++;
} else {
  console.log('  PASS  every foreground accent routes through a readable token');
}

// ── 2. nothing is compliant because of a font-size ──────────────────────────
// WCAG allows 3:1 for large text. Leaning on that would make these pages
// compliant because of a font-size declared somewhere else — true until
// someone changes it, with nothing to catch the change. So every text pair
// here is held to the BODY target whatever its size, and the ring numeral at
// --fs-h3 is measured on the same bar as the --fs-xs kicker. No size in this
// stylesheet is load-bearing, and this is what keeps it that way.
console.log('\n── 2. every text pair clears the body target, at any size');

const TEXT_PAIRS = [
  ['.exergy-page (body)', '--fg', '--bg'],
  ['.exergy-skip', '--fg', '--bg-panel'],
  ['.exergy-family-label', '--fg-muted', '--bg'],
  ['.exergy-page a', ACCENT, '--bg'],
  ['.exergy-page a:hover', '--fg', '--bg'],
  ['.exergy-kicker', ACCENT, '--bg'],
  ['.exergy-page h1', '--fg', '--bg'],
  ['.exergy-page h2', '--fg', '--bg'],
  ['.exergy-lead', '--fg', '--bg'],
  ['.exergy-mute', '--fg-muted', '--bg'],
  // The rings are masked to an 8px annulus, so the centre is transparent and
  // the numeral sits on the PAGE, not on the track. Measured against --bg for
  // that reason, and it clears the body bar there anyway.
  ['.exergy-rings span', ACCENT, '--bg'],
  ['.exergy-card h2', ACCENT, '--bg-card'],
  ['.exergy-card p', '--fg-muted', '--bg-card'],
  ['.exergy-cta label', '--bg', ACCENT],
  ['.exergy-page footer', '--fg-muted', '--bg'],
  ['.exergy-page code', ACCENT, '--bg'],
];

/** rgba(...) composited over an opaque base. Alpha grounds are not skipped —
 *  a check that cannot measure something must not pass it. */
function flatten(value, baseHex) {
  const v = String(value).trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(v)) return v;
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/.exec(v);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : parseFloat(m[4]);
  const base = rgbOf(baseHex);
  const out = [+m[1], +m[2], +m[3]].map((c, i) => a * c + (1 - a) * base[i]);
  return '#' + out.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

for (const [theme, sel] of [['dark', ':root'], ['light', LIGHT]]) {
  const page = resolve(tokens, sel, '--bg');
  for (const [what, fgTok, bgTok] of TEXT_PAIRS) {
    const fg = flatten(resolve(tokens, sel, fgTok), page);
    const bg = flatten(resolve(tokens, sel, bgTok), page);
    if (!fg || !bg) {
      console.log(`  FAIL  ${theme} ${what}: could not resolve ${fgTok} / ${bgTok} to a colour`);
      fail++;
      continue;
    }
    const r = contrast(fg, bg);
    const good = r >= BODY_TARGET;
    if (!good) fail++;
    console.log(`  ${good ? 'PASS' : 'FAIL'}  ${theme.padEnd(5)} ${what.padEnd(22)} ${fg} on ${bg} = ${r.toFixed(6).padStart(10)}  needs ${BODY_TARGET}`);
  }
}

// The table above is hand-written, so it can fall behind the stylesheet. This
// is the assertion that stops it: every rule in exergy.css that sets a `color`
// must be represented. Adding a coloured element without adding it here fails
// rather than going unmeasured.
console.log('\n── 3. the text table still covers every coloured rule');
const selectors = [];
{
  let current = null;
  for (const line of css.split('\n')) {
    const sel = /^([.@:][^{]*|\.[^{]*)\{\s*$/.exec(line);
    if (sel) current = sel[1].trim();
    if (/^\s*color\s*:/.test(line) && current) selectors.push(current);
  }
}
const covered = new Set(TEXT_PAIRS.map(([w]) => w.split(' ')[0].replace(/:.*/, '')));
const uncovered = [...new Set(selectors)].filter((sel) => {
  const first = sel.split(/[,\s]/)[0].replace(/:.*/, '');
  return !covered.has(first) && !covered.has(sel);
});
if (uncovered.length) {
  console.log(`  FAIL  ${uncovered.length} rule(s) set a colour but are not in TEXT_PAIRS:`);
  for (const u of uncovered) console.log(`        ${u}`);
  console.log('        Add them with their ground, or this guard is measuring a subset and');
  console.log('        reporting it as the whole.');
  fail++;
} else {
  console.log(`  PASS  all ${new Set(selectors).size} colour-setting rules are covered`);
}

// ── 4. the ring arc, and the proof that 3:1 is the right bar for it ─────────
// The arc is a graphical object that carries meaning, so SC 1.4.11 applies and
// 3:1 is its bar. That is only true while no TEXT is drawn on the track — if
// something were, the track would need the body target instead. Asserted
// rather than assumed.
console.log('\n── 4. the ring track carries no text, so 3:1 is its bar');
const trackRules = [];
{
  let current = null;
  for (const [i, line] of css.split('\n').entries()) {
    const sel = /^([.@:][^{]*)\{\s*$/.exec(line);
    if (sel) current = sel[1].trim();
    if (/var\(\s*--(exergy-track|bg-alt)\s*\)/.test(line)) trackRules.push({ line: i + 1, sel: current, text: line.trim() });
  }
}
// This tested the WHOLE stylesheet for a gradient rather than the line, and
// exergy.css always contains one — so the filter was always empty and section 4
// could never fail. A check that cannot fail is not a check; caught by mutating
// my own guard. The test is now per-line.
const trackAsTextGround = trackRules.filter(
  (r) => /^(background|background-color)\s*:/.test(r.text) && !/-gradient\(/.test(r.text)
);
if (trackAsTextGround.length) {
  console.log('  FAIL  the track is used as a plain background, so text may sit on it:');
  for (const r of trackAsTextGround) console.log(`        exergy.css:${r.line}  ${r.sel}  ${r.text}`);
  fail++;
} else {
  console.log(`  PASS  --exergy-track / --bg-alt appears only as gradient stop and border (${trackRules.length} use(s))`);
  for (const r of trackRules) console.log(`        exergy.css:${r.line}  ${r.text}`);
}

console.log('\n── 5. the arc against its track');
for (const [theme, sel] of [['dark', ':root'], ['light', LIGHT]]) {
  const page = resolve(tokens, sel, '--bg');
  const arc = flatten(resolve(tokens, sel, ACCENT), page);
  const track = flatten(resolve(tokens, sel, '--bg-alt'), page);
  const r = contrast(arc, track);
  const good = r >= GRAPHIC_TARGET;
  if (!good) fail++;
  console.log(`  ${good ? 'PASS' : 'FAIL'}  ${theme.padEnd(5)} arc ${arc} on track ${track} = ${r.toFixed(6).padStart(10)}  needs ${GRAPHIC_TARGET} (SC 1.4.11)`);
}

console.log('');
if (fail) {
  console.log(`exergy contrast: ${fail} failure(s).`);
  process.exit(1);
}
console.log('exergy contrast: every accent is readable in both appearances, at every size.');
