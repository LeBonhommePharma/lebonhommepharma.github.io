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
 * Then it reads the package's elements.css, the stylesheet that turns those
 * tokens into painted text. Every `color:` there is resolved in both themes and
 * held to the body target. A token that clears AA is no use if the stylesheet
 * that ships beside it paints text in the bare identity hue instead: that is how
 * elements.css shipped mint links at 1.56:1 on the light ground while every
 * check here was green.
 *
 * WCAG 2.1 AA: 4.5:1 body · 3:1 at >=24px or >=18.66px bold · 3:1 non-text.
 *
 * Usage: check-contrast.mjs [--verbose] [--self-test]
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTokens, resolve, ROOT, SOURCE } from './extract.mjs';
import { contrast, fmtRatio, rgbOf } from './oklch.mjs';

const VERBOSE = process.argv.includes('--verbose');
const SELF_TEST_ONLY = process.argv.includes('--self-test');
const css = readFileSync(SOURCE, 'utf8');
const blocks = parseTokens(css);
const LIGHT = '[data-theme="light"]';
const THEMES = [['dark', ':root'], ['light', LIGHT]];
export const ELEMENTS = join(ROOT, 'design', 'palette-v2', 'packages', 'flexaidds-tokens', 'elements.css');

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

// ── elements.css: the stylesheet that paints the tokens ─────────────────────
// Sections 1–3 prove the TOKENS are right. They say nothing about whether the
// stylesheet shipped beside them uses the right ones. elements.css painted
// links, eyebrows, stats, the equation terms, the state labels and the brand
// mark in the bare identity hues, so the light theme rendered them at 1.27 to
// 3.92:1 while every token check above stayed green. Section 4 closes that gap
// by measuring what the stylesheet actually paints.
//
// WHAT IS MEASURED
//   Every `color` and `-webkit-text-fill-color` declaration: the properties
//   that paint glyphs. Each is resolved through tokens.css in both themes and
//   held to the body target against --bg, the ground elements.css paints on
//   `body`. That holds AT ANY SIZE. WCAG allows 3:1 for large text, but leaning
//   on that would make .stat-value compliant because of a font-size declared a
//   few lines away, true only until someone edits it. Same doctrine as
//   check-exergy-contrast.mjs: no size in the stylesheet is load-bearing.
//
//   Fills, borders, washes and the grid are not read, so they are not
//   measured here. The bare key colours are FOR those.
//
// THEME SCOPING, AND WHY IT IS ASYMMETRIC
//   A rule under `[data-theme="light"]` applies in light only, and it out-
//   specifies the unscoped rule for the same element, so the unscoped one is
//   not measured in light. That is how `a:hover` keeps --kw-ga on the ink and
//   reads --fg on the light ground.
//   A `[data-theme="dark"]` rule is measured in dark but supersedes nothing.
//   Dark is the :root default: a page whose theme.js never ran has no
//   data-theme at all, so the dark-scoped rule does not match there and the
//   unscoped rule is what paints.
//   An unscoped `!important` beats a scoped rule that is not important, and
//   is measured in both themes for that reason.
//
// FAIL CLOSED
//   An at-rule (@media, @supports, @layer, @import), nesting, an unbalanced
//   brace, an unterminated comment, a custom-property declaration, theme
//   scoping in any other shape, or a colour value this cannot resolve to an
//   opaque hex (inherit, currentColor, color-mix(), a named colour, a
//   translucent colour, an undefined token) is a FAILURE, never a skip. A
//   check that silently passes what it could not read reports a measurement
//   it never made.
const READ_PROPS = new Set(['color', '-webkit-text-fill-color']);
const THEME_SCOPE = /^(?:html|:root)?\[data-theme=(["']?)(light|dark)\1\](?:\s+(\S[\s\S]*))?$/;

/**
 * The state classes are bound to a hue that has no light twin of its own, so
 * their text reads the twin of that hue. This asserts the binding still holds:
 * if --state-pass is ever rebound to a different hue, .state-pass would keep
 * painting the old one, and this fails instead of letting the two drift apart.
 */
const STATE_BINDINGS = [
  ['.state-pass', '--state-pass'],
  ['.state-warn', '--state-warn'],
];

/** Blank comments, keeping newlines so line numbers survive. */
function blankComments(text) {
  const out = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  if (out.includes('/*')) throw new Error('unterminated comment');
  return out;
}

/** Split on `sep` at bracket depth 0, so `url(a;b)` or `:is(a, b)` stay whole. */
function splitTop(s, sep) {
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === sep && depth === 0) { parts.push([s.slice(from, i), from]); from = i + 1; }
  }
  parts.push([s.slice(from), from]);
  return parts;
}

/**
 * Every declaration in a flat stylesheet, one entry per selector in each
 * selector list, with the 1-based line it sits on. Throws on anything it
 * cannot read flatly.
 */
export function readDeclarations(text) {
  const src = blankComments(text);
  const lineAt = (offset) => src.slice(0, offset).split('\n').length;
  const out = [];
  let depth = 0;
  let selStart = 0;
  let bodyStart = -1;
  let selector = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '{') {
      if (depth > 0) throw new Error(`nested block at line ${lineAt(i)}; this reads flat rules only`);
      selector = src.slice(selStart, i).trim();
      if (selector.startsWith('@') || /(^|[;\s])@[A-Za-z-]/.test(selector)) {
        throw new Error(`at-rule "${selector.split('\n')[0].trim()}" at line ${lineAt(selStart + src.slice(selStart, i).search(/\S/))}; its conditions cannot be evaluated here`);
      }
      if (!selector) throw new Error(`block with no selector at line ${lineAt(i)}`);
      depth = 1;
      bodyStart = i + 1;
    } else if (c === '}') {
      if (depth === 0) throw new Error(`unbalanced "}" at line ${lineAt(i)}`);
      const body = src.slice(bodyStart, i);
      for (const [decl, off] of splitTop(body, ';')) {
        if (!decl.trim()) continue;
        const colon = decl.indexOf(':');
        if (colon < 0) throw new Error(`malformed declaration "${decl.trim()}" at line ${lineAt(bodyStart + off)}`);
        const prop = decl.slice(0, colon).trim().toLowerCase();
        const value = decl.slice(colon + 1).replace(/\s+/g, ' ').trim();
        const line = lineAt(bodyStart + off + decl.search(/\S/));
        for (const [s] of splitTop(selector, ',')) {
          const sel = s.replace(/\s+/g, ' ').trim();
          if (!sel) throw new Error(`empty selector in list at line ${line}`);
          out.push({ selector: sel, prop, value, line });
        }
      }
      depth = 0;
      selStart = i + 1;
    }
  }
  if (depth !== 0) throw new Error('unterminated block at end of file');
  if (src.slice(selStart).trim()) {
    throw new Error(`trailing text after the last rule: "${src.slice(selStart).trim().split('\n')[0]}"`);
  }
  return out;
}

/** Which theme a selector is scoped to, and the element it targets. */
export function scopeOf(selector) {
  const m = THEME_SCOPE.exec(selector);
  if (m) return { theme: m[2], target: m[3] ? m[3].trim() : ':root' };
  if (/data-theme/.test(selector)) {
    throw new Error(`theme scoping in "${selector}" is not a leading [data-theme="light|dark"]; cannot tell which theme it paints in`);
  }
  return { theme: null, target: selector };
}

/** A read colour, resolved to an opaque hex in one theme, or a reason it can't be. */
export function resolveColour(value, tokens, sel) {
  const v = value.replace(/\s*!important\s*$/i, '').trim();
  const ref = /^var\(\s*(--[A-Za-z0-9-]+)\s*(?:,[\s\S]*)?\)$/.exec(v);
  let raw;
  let token = null;
  if (ref) {
    token = ref[1];
    try {
      raw = resolve(tokens, sel, token);
    } catch (e) {
      return { token, error: e.message };
    }
    if (raw === undefined) return { token, error: `${token} is not defined in tokens.css` };
  } else if (HEX_RE.test(v)) {
    raw = v;
  } else {
    return { token, error: `cannot measure "${v}": only var(--token) and #RRGGBB resolve here` };
  }
  raw = String(raw).trim();
  if (!HEX_RE.test(raw)) {
    return { token, error: `${token ?? v} resolves to "${raw}", not an opaque #RRGGBB; a translucent or computed colour has no fixed contrast` };
  }
  return { token, hex: raw.toUpperCase() };
}

/**
 * Measure every read colour in an elements stylesheet, in both themes.
 * Returns { reads, rows, errors }: `rows` holds one measurement per
 * (declaration, theme) actually painted, `errors` everything that could not
 * be measured or broke a binding. Either non-empty-errors or a failing row is
 * a failure; zero reads is a failure the caller asserts.
 */
export function auditElements(text, tokens, target, { bindings = [] } = {}) {
  const errors = [];
  let decls;
  try {
    decls = readDeclarations(text);
  } catch (e) {
    return { reads: [], rows: [], errors: [`cannot parse: ${e.message}`] };
  }

  for (const d of decls) {
    if (d.prop.startsWith('--')) {
      errors.push(`line ${d.line}: ${d.selector} declares ${d.prop}; tokens belong in tokens.css, and one redefined here would change what every measurement below resolves to`);
    }
  }

  const reads = [];
  for (const d of decls.filter((x) => READ_PROPS.has(x.prop))) {
    try {
      reads.push({ ...d, ...scopeOf(d.selector), important: /!important\s*$/i.test(d.value) });
    } catch (e) {
      errors.push(`line ${d.line}: ${e.message}`);
    }
  }

  const rows = [];
  for (const [theme, sel] of THEMES) {
    const ground = resolve(tokens, sel, '--bg');
    for (const d of reads) {
      if (d.theme && d.theme !== theme) continue;
      if (!d.theme && theme === 'light') {
        const over = reads.find((o) => o.theme === 'light' && o.target === d.target
          && o.prop === d.prop && !(d.important && !o.important));
        if (over) continue;
      }
      const c = resolveColour(d.value, tokens, sel);
      if (c.error) { errors.push(`line ${d.line}: ${theme}: ${d.selector} { ${d.prop}: ${d.value} } — ${c.error}`); continue; }
      const r = ratio(c.hex, ground);
      if (r === null) { errors.push(`line ${d.line}: ${theme}: cannot measure ${c.hex} on ${ground}`); continue; }
      rows.push({ theme, selector: d.selector, prop: d.prop, value: d.value, line: d.line,
        token: c.token, hex: c.hex, ground, r, pass: r >= target });
    }
  }

  for (const [selector, stateToken] of bindings) {
    const own = reads.filter((d) => d.theme === null && d.target === selector && d.prop === 'color');
    if (own.length === 0) {
      errors.push(`${selector} no longer sets a colour; the state binding check has nothing to hold. Restore it, or remove it from STATE_BINDINGS in the same change`);
      continue;
    }
    const used = resolveColour(own[own.length - 1].value, tokens, ':root');
    const bound = resolve(tokens, ':root', stateToken);
    if (used.error || !bound || used.hex !== String(bound).trim().toUpperCase()) {
      errors.push(`line ${own[own.length - 1].line}: ${selector} paints ${used.token ?? own[own.length - 1].value} (${used.hex ?? used.error}) but ${stateToken} is ${bound}; the state was rebound and its text did not follow. Route it through the new hue's --*-fg twin`);
    }
  }

  return { reads, rows, errors };
}

// ── self-test: the audit must still be able to fail ─────────────────────────
// Same doctrine as every other guard here: a scan is only meaningful if the
// patterns are known to still match. Run first; --self-test stops after it.
function selfTest() {
  let good = true;
  const say = (pass, label) => {
    console.log(`  ${pass ? 'ok    ' : 'BROKEN'} ${label}`);
    if (!pass) good = false;
  };
  const audit = (text, opts) => auditElements(text, blocks, BODY_TARGET, opts);
  const withBindings = { bindings: STATE_BINDINGS };
  const failing = (res, theme) => res.rows.filter((r) => !r.pass && r.theme === theme).map((r) => r.selector);
  const clean = (res) => res.errors.length === 0 && res.rows.every((r) => r.pass);

  // The exact colour rules elements.css shipped with on main. Fourteen
  // selectors on thirteen lines must fail in light, none in dark.
  const MAIN_SHAPE = `
    body { color: var(--fg); background: var(--bg); }
    h1, .h1 { color: var(--fg); }
    p { color: var(--fg-muted); }
    a { color: var(--mint); }
    a:hover { color: var(--kw-ga); }
    .eyebrow, .section-label { color: var(--strawberry); }
    .stat-value { color: var(--tangerine); }
    .stat-label { color: var(--fg-muted); }
    .eq-dg  { color: var(--tangerine); }
    .eq-dh  { color: var(--mint); }
    .eq-t   { color: var(--firetruck); }
    .eq-ds  { color: var(--violet); }
    .eq-dsv { color: var(--aqua); }
    .state-pass { color: var(--state-pass); }
    .state-warn { color: var(--state-warn); }
    .state-fail { color: var(--state-fail-text); }
    .brand { color: var(--mint); }
    .brand .delta { color: var(--tangerine); }
    th { color: var(--fg-muted); }`;
  const EXPECT_LIGHT = ['a', 'a:hover', '.eyebrow', '.section-label', '.stat-value',
    '.eq-dg', '.eq-dh', '.eq-t', '.eq-ds', '.eq-dsv', '.state-pass', '.state-warn',
    '.brand', '.brand .delta'];
  const main = audit(MAIN_SHAPE, withBindings);
  const mainLight = failing(main, 'light');
  say(main.errors.length === 0, "main's shape parses with no unmeasurable declaration");
  say(mainLight.length === EXPECT_LIGHT.length && EXPECT_LIGHT.every((s) => mainLight.includes(s)),
    `main's shape fails exactly its ${EXPECT_LIGHT.length} bare-hue selectors in light (got ${mainLight.length})`);
  say(failing(main, 'dark').length === 0, "main's shape is clean in dark (dark was never the bug)");

  const ROUTED = MAIN_SHAPE
    .replace(/var\(--(mint|strawberry|tangerine|firetruck|violet|aqua)\)/g, 'var(--$1-fg)')
    .replace('var(--state-pass)', 'var(--mint-fg)')
    .replace('var(--state-warn)', 'var(--strawberry-fg)')
    + '\n[data-theme="light"] a:hover { color: var(--fg); }';
  say(clean(audit(ROUTED, withBindings)), 'the routed shape, with the light hover override, is clean in both themes');

  // The realistic way the state routing breaks: tokens.css rebinds the state
  // and elements.css is never touched.
  const rebound = { ...blocks, ':root': { ...blocks[':root'], '--state-pass': 'var(--violet)' } };
  say(auditElements(ROUTED, rebound, BODY_TARGET, withBindings).errors.some((e) => /was rebound/.test(e)),
    'rebinding --state-pass in tokens.css fails the routed .state-pass');

  say(failing(audit('a:hover { color: var(--kw-ga); }'), 'light').length === 1,
    'an unscoped --kw-ga hover fails in light');
  const lit = audit('a:hover { color: var(--kw-ga); }\n[data-theme="light"] a:hover { color: var(--fg); }');
  say(clean(lit) && lit.rows.length === 2, 'a light-scoped override supersedes it in light and the original is still measured in dark');
  say(failing(audit('a:hover { color: var(--fg); }\n[data-theme="light"] a:hover { color: var(--mint); }'), 'light').length === 1,
    'an unreadable light-scoped override is itself measured and fails');
  say(failing(audit('a { color: var(--mint); }\n[data-theme="dark"] a { color: var(--mint); }'), 'light').length === 1,
    'a dark-scoped rule supersedes nothing in light');
  say(failing(audit('a { color: var(--bg); }\n[data-theme="dark"] a { color: var(--fg); }'), 'dark').length === 1,
    'a dark-scoped rule supersedes nothing in dark either (no data-theme means the unscoped rule paints)');
  say(failing(audit('a { color: var(--mint) !important; }\n[data-theme="light"] a { color: var(--fg); }'), 'light').length === 1,
    'an unscoped !important is not superseded by a scoped rule that is not important');
  say(failing(audit(':root[data-theme="light"] a { color: var(--mint); }'), 'light').length === 1,
    'the :root[data-theme] spelling is recognised as light scoping');
  say(failing(audit('.x { -webkit-text-fill-color: var(--tangerine); }'), 'light').length === 1,
    '-webkit-text-fill-color is measured, not only color');
  say(failing(audit('.x { COLOR:var(--aqua) }'), 'light').length === 1,
    'property case and missing whitespace do not hide a declaration');
  const commented = audit('/* a { color: var(--mint); } */ a { color: var(--fg); }');
  say(commented.rows.length === 2 && commented.rows.every((r) => r.pass),
    'a commented-out declaration is not measured, and the live one still is');

  // Each must fail for its OWN reason. Asserting only "some error" would let
  // one unrelated error make every case below look like it works.
  const closed = (text, why, label, opts) => {
    const res = audit(text, opts);
    say(res.errors.some((e) => why.test(e)), `fails closed on ${label}`);
  };
  closed('@media (prefers-color-scheme: light) { a { color: var(--mint); } }', /at-rule/, 'an @media block');
  closed('@import url("x.css");\na { color: var(--fg); }', /at-rule/, 'an @import');
  closed('a { color: var(--fg); }\n@layer base;', /trailing text/, 'a statement at-rule after the last rule');
  closed('a { & b { color: var(--mint); } }', /nested/, 'nesting');
  closed('a { color: var(--fg); ', /unterminated block/, 'an unterminated block');
  closed('a { color: var(--fg); } }', /unbalanced/, 'an unbalanced brace');
  closed('a { color: var(--fg); } /* open', /unterminated comment/, 'an unterminated comment');
  closed('a { color: inherit; }', /cannot measure "inherit"/, '`inherit`');
  closed('a { color: currentColor; }', /cannot measure "currentColor"/, '`currentColor`');
  closed('a { color: color-mix(in oklch, var(--mint) 50%, black); }', /cannot measure "color-mix/, 'color-mix()');
  closed('a { color: rebeccapurple; }', /cannot measure "rebeccapurple"/, 'a named colour');
  closed('a { color: var(--mint-10); }', /not an opaque/, 'a translucent token');
  closed('a { color: var(--no-such-token); }', /not defined in tokens\.css/, 'an undefined token');
  closed('.x[data-theme="light"] a { color: var(--fg); }', /not a leading/, 'theme scoping that is not leading');
  closed(':root { --mint-fg: var(--mint); }', /tokens belong in tokens\.css/, 'a custom property redefined in the stylesheet');
  closed('.state-pass { color: var(--violet-fg); }\n.state-warn { color: var(--strawberry-fg); }', /was rebound/,
    'a state class painting a hue other than its binding', withBindings);
  closed('.state-warn { color: var(--strawberry-fg); }', /no longer sets a colour/, 'a state class that disappeared', withBindings);
  say(audit('').rows.length === 0, 'an empty stylesheet measures nothing (the scan asserts a non-zero count)');

  // And the measurement still separates a pass from a fail at the bar in use.
  say(ratio('#45E0A8', resolve(blocks, LIGHT, '--bg')) < BODY_TARGET, 'bare mint on the light ground is below the body target');
  say(ratio(resolve(blocks, LIGHT, '--mint-fg'), resolve(blocks, LIGHT, '--bg')) >= BODY_TARGET, '--mint-fg on the light ground clears it');

  if (!good) {
    console.log('\nself-test FAILED — the elements.css audit below cannot be trusted.');
    process.exit(2);
  }
}

console.log('── self-test · the elements.css audit can still fail');
selfTest();
if (SELF_TEST_ONLY) {
  console.log('\nself-test passed.');
  process.exit(0);
}
console.log('');

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

// ── 4. elements.css: every read colour, both themes ─────────────────────────
console.log(`\n── elements.css · every read colour vs --bg, both themes, any size · body target ${BODY_TARGET}:1`);
{
  const rel = ELEMENTS.slice(ROOT.length + 1);
  let text;
  try {
    text = readFileSync(ELEMENTS, 'utf8');
  } catch (e) {
    text = null;
    bad(`cannot read ${rel} (${e.code ?? e.message}); a stylesheet that is not read is not measured`);
  }
  if (text !== null) {
    const { reads, rows, errors } = auditElements(text, blocks, BODY_TARGET, { bindings: STATE_BINDINGS });
    for (const e of errors) bad(`${rel}: ${e}`);
    for (const r of rows) {
      const what = `${r.theme}: ${rel}:${r.line}  ${r.selector} { ${r.prop}: ${r.value} } → ${r.hex} on ${r.ground} = ${show(r.r)}:1`;
      if (r.pass) ok(what);
      else bad(`${what} (${r.r.toFixed(6)}) — below the body target (${BODY_TARGET}:1). A key colour is read through its --NAME-fg twin; a colour with no twin needs a light-scoped override that clears the bar`);
    }
    console.log(`  ${reads.length} read-colour declaration(s), ${rows.length} measurement(s) across both themes`);
    if (reads.length === 0) {
      console.log(`  FAIL  parsed no colour declarations from ${rel} — the parser has stopped matching.`);
      console.log('        A check that silently matches nothing reports a clean pass it never made.');
      fail++;
    }
  }
}

console.log('');
if (fail) {
  console.log(`contrast: ${fail} failure(s).`);
  console.log('A ratio is a (foreground, background) pair. Fix the colour, or fix the number —');
  console.log('never the comment alone. Re-solve with: node design-system/derive-light.mjs 4.5');
  process.exit(1);
}
console.log('contrast: every annotated ratio is true, every foreground token clears AA, and every');
console.log('          colour elements.css paints as text clears the body target in both themes.');
