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
 * twin for the bare identity hue, so every colour that paints glyphs there is
 * measured too, in both themes.
 *
 * WCAG 2.1 AA: 4.5:1 body · 3:1 at >=24px or >=18.66px bold · 3:1 non-text.
 *
 * Usage: check-contrast.mjs [--verbose] [--self-test]
 *   --self-test  prove the elements.css audit can still fail, then stop.
 *                A full run always does this first.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTokens, resolve, ROOT, SOURCE } from './extract.mjs';
import { contrast, fmtRatio } from './oklch.mjs';

const VERBOSE = process.argv.includes('--verbose');
const SELF_TEST_ONLY = process.argv.includes('--self-test');
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

// ── the elements.css audit (section 4), defined up front so it can be self-tested ──
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
// Both properties that paint glyphs are read: `color`, and
// `-webkit-text-fill-color`, which overrides it for the glyph fill in every
// engine. Measuring only `color` would pass a rule that paints its text in a
// bare hue through the other one.
//
// Fail-closed, the way extract.mjs is: flat rules only. An at-rule block, a
// theme qualifier this does not recognise, a second painted ground, a colour
// it cannot resolve, or a custom property declared in this file is a FAIL,
// never a skip. That last one matters because every measurement here resolves
// through tokens.css: a `--mint-fg` redefined in elements.css would change what
// the browser paints while this check went on measuring the token it was
// shadowing. The same goes for opacity and filters, which composite text with
// what lies under it; for a background on any rule but body; for a string that
// holds CSS syntax or a backslash escape, either of which can hide a rule from
// the parser below; and for a theme-scoped rule that can never match. A check
// that half-reads a file and reports the half reports a pass it never made.
//
// THE GRID — measured as excluded, and stated rather than hidden
// body paints the violet graph paper (--grid-line) over --bg, 1px every
// --grid-step. Text crossing a line sits on a slightly darker ground: on the
// light theme the --*-fg twins measure 4.26 to 4.30:1 against a line pixel
// (#EEEDFB) and 3.97 to 4.00:1 where two lines cross (#E8E4FA), against 4.56
// to 4.60:1 on --bg. The twins are solved against --bg with 0.05 of headroom;
// a line takes about 0.3 and a crossing about 0.6. This audit holds text to
// --bg, the ground under all but a few percent of any glyph, and does not
// claim the line pixels clear. Closing that is a palette decision, either
// solving the twins against the composited line or lightening the light
// grid, not something a guard should settle by moving its own ground.
const ELEMENTS = 'design/palette-v2/packages/flexaidds-tokens/elements.css';
const THEMED = /^\[data-theme="(light|dark)"\]\s+/;
const VAR_ONLY = /^var\(\s*(--[A-Za-z0-9-]+)\s*\)$/;
const READ_PROPS = ['color', '-webkit-text-fill-color'];

// Anything that composites text with what is under it changes the pair this
// measures, so a rule carrying one cannot be measured as a plain foreground
// on --bg. Fail rather than pass a 0.8-opacity label at 3.6:1.
const COMPOSITING = ['opacity', 'filter', 'backdrop-filter', 'mix-blend-mode'];
const GROUND_PROPS = ['background', 'background-color', 'background-image'];

/**
 * Blank comments the way a CSS tokenizer does, honouring strings, and report
 * what the regex parser below cannot read safely: a string that holds CSS
 * syntax (`content: "/*"` would otherwise swallow every rule up to the next
 * close-comment), a backslash escape (`c\olor` is `color` to a browser and
 * nothing to a regex), or an unterminated comment or string.
 */
function lexElements(css) {
  let text = '';
  const problems = [];
  for (let i = 0; i < css.length;) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      if (end < 0) { problems.push('an unterminated comment'); break; }
      text += ' ';
      i = end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c && css[j] !== '\n') j += css[j] === '\\' ? 2 : 1;
      if (css[j] !== c) { problems.push(`an unterminated string at ${JSON.stringify(css.slice(i, i + 24))}`); break; }
      const lit = css.slice(i, j + 1);
      if (/[{};\\]|\/\*|\*\//.test(lit.slice(1, -1))) problems.push(`a string holding CSS syntax, ${lit}`);
      text += lit;
      i = j + 1;
      continue;
    }
    if (c === '\\') problems.push(`a CSS escape at ${JSON.stringify(css.slice(i, i + 12))}`);
    text += c;
    i++;
  }
  return { text, problems };
}

// .state-pass and .state-warn read the twin of the hue their state token is
// bound to (tokens.css: --state-pass is mint, --state-warn is strawberry),
// because neither state has a light read value of its own. That routing is
// only right while the binding holds. Rebind --state-pass in tokens.css and
// .state-pass would keep painting mint, readable and wrong, with every ratio
// still green. So the hue each one paints on the ink must BE its state's hue.
const STATE_BINDINGS = [['.state-pass', '--state-pass'], ['.state-warn', '--state-warn']];

/**
 * Audit an elements stylesheet against a token model, at a given body target.
 * Pure: returns { fails, oks, measured, selectors } and prints nothing, so the
 * self-test can drive it on fixtures and the scan reports what it returns.
 */
function auditElements(cssText, tokens, target) {
  const fails = [];
  const oks = [];
  const { text: elCss, problems } = lexElements(cssText);
  for (const p of problems) fails.push(`elements.css has ${p} — the rule parser below cannot read that safely; it fails rather than guess`);
  if (/@[A-Za-z-]+[^;{}]*\{/.test(elCss)) {
    fails.push('elements.css has an at-rule block — this reads flat rules only; teach it the block before trusting it');
  }

  const runs = new Map(); // `${selector}\n${prop}` -> { sel, prop, base, dark, light } colour expressions
  let paintsGround = false;
  for (const [, selText, body] of elCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = {};
    for (const d of body.split(';')) {
      const h = /^\s*([A-Za-z-]+)\s*:\s*([\s\S]+?)\s*$/.exec(d);
      if (h) decls[h[1].toLowerCase()] = h[2].replace(/\s+/g, ' ');
    }
    const rule = selText.replace(/\s+/g, ' ').trim();
    for (const name of Object.keys(decls).filter((n) => n.startsWith('--'))) {
      fails.push(`${rule} declares ${name} — tokens belong in tokens.css; one redefined here changes what the page paints while this check measures the tokens.css value it shadows`);
    }
    for (const prop of COMPOSITING.filter((n) => decls[n] !== undefined)) {
      fails.push(`${rule} sets ${prop}: ${decls[prop]} — text under it is composited with what lies beneath, so its contrast is not the pair this measures`);
    }
    const ground = decls['background-color'] ?? decls.background;
    for (const raw of selText.split(',')) {
      const sel = raw.replace(/\s+/g, ' ').trim();
      if (!sel) continue;
      if (ground !== undefined) {
        if (sel === 'body' && ground === 'var(--bg)') paintsGround = true;
        else fails.push(`${sel} paints its own ground (${ground}) — measure text against it before trusting this check`);
      }
      // body's background-image is the violet graph paper, and it is the one
      // paint this deliberately does not measure under text. See "THE GRID" in
      // the section header: it is reported there, not hidden here.
      for (const prop of GROUND_PROPS.filter((n) => n !== 'background' && n !== 'background-color' && decls[n] !== undefined)) {
        if (sel !== 'body') fails.push(`${sel} paints its own ground (${prop}: ${decls[prop]}) — measure text against it before trusting this check`);
      }
      // A light- or dark-scoped rule overrides its base selector in that theme
      // only; it outranks the base on specificity, so source order is moot.
      const t = THEMED.exec(sel);
      const key = t ? sel.slice(t[0].length) : sel;
      if (/data-theme/.test(key)) {
        fails.push(`${sel}: a theme qualifier this check cannot attribute — write it as [data-theme="light"] <selector>`);
        continue;
      }
      // data-theme sits ON <html>, so `[data-theme="light"] html` asks for an
      // <html> inside <html> and never matches. Treating it as an override
      // would credit the light theme with a rule the browser never applies.
      if (t && /^(html|:root)(?![\w-])/.test(key)) {
        fails.push(`${sel} never matches — data-theme is set on <html> itself, so nothing is its own descendant; write [data-theme="light"] for the root`);
        continue;
      }
      for (const prop of READ_PROPS) {
        if (decls[prop] === undefined) continue;
        const id = `${key}\n${prop}`;
        const run = runs.get(id) ?? { sel: key, prop };
        run[t ? t[1] : 'base'] = decls[prop]; // later wins, as in the cascade
        runs.set(id, run);
      }
    }
  }
  if (!paintsGround) fails.push('body no longer paints var(--bg) — measuring against --bg would be an assumed ground');

  /** The read twin of a bare colour, following var() aliases: --state-pass -> --mint-fg. */
  function twinOf(expr) {
    let m = VAR_ONLY.exec(expr);
    for (let guard = 0; m && guard < 32; guard++) {
      if (tokens[':root'][`${m[1]}-fg`] !== undefined) return `var(${m[1]}-fg)`;
      m = VAR_ONLY.exec(tokens[':root'][m[1]] ?? '');
    }
    return null;
  }

  let measured = 0;
  const selectors = new Set();
  for (const { sel, prop, ...run } of runs.values()) {
    selectors.add(sel);
    for (const [theme, block] of [['dark', ':root'], ['light', LIGHT]]) {
      const expr = run[theme] ?? run.base;
      if (expr === undefined) continue;
      measured++;
      const bg = resolve(tokens, block, '--bg');
      const v = VAR_ONLY.exec(expr);
      let fg;
      try {
        fg = v ? resolve(tokens, block, v[1]) : expr;
      } catch (e) {
        fails.push(`${theme}: ${sel} { ${prop}: ${expr} } — ${e.message}`);
        continue;
      }
      if (fg === undefined) { fails.push(`${theme}: ${sel} { ${prop}: ${expr} } — tokens.css does not define ${v[1]}`); continue; }
      const r = ratio(fg, bg);
      if (r === null) { fails.push(`${theme}: ${sel} { ${prop}: ${expr} } = ${fg} is not a plain hex; cannot measure`); continue; }
      if (r < target) {
        // No hint when the rule already reads the twin: then the TOKEN is what
        // regressed, and sections 1–2 name it.
        let twin = twinOf(expr);
        if (twin === expr) twin = null;
        fails.push(`${theme}: ${sel} { ${prop}: ${expr} } = ${fg} on ${bg} = ${show(r)}:1 (${r.toFixed(6)}) — below the body target (${target}:1)${twin ? `; read it through ${twin}` : ''}`);
      } else oks.push(`${theme}: ${sel} { ${prop}: ${expr} } = ${fg} on ${bg} = ${show(r)}:1`);
    }
  }

  for (const [sel, stateToken] of STATE_BINDINGS) {
    const run = runs.get(`${sel}\ncolor`);
    if (!run || (run.base ?? run.dark ?? run.light) === undefined) {
      fails.push(`${sel} no longer sets a colour — restore it, or drop it from STATE_BINDINGS in the same change`);
      continue;
    }
    // The text must be the read twin of the hue the state is bound to, in
    // EACH theme, so a light-scoped override is held to it as well.
    const twin = twinOf(`var(${stateToken})`);
    const twinName = twin && VAR_ONLY.exec(twin)[1];
    if (!twinName) {
      fails.push(`${stateToken} resolves to no key colour with a --*-fg twin — ${sel} has no read value to be held to`);
      continue;
    }
    for (const [theme, block] of [['dark', ':root'], ['light', LIGHT]]) {
      const expr = run[theme] ?? run.base;
      if (expr === undefined) continue;
      const v = VAR_ONLY.exec(expr);
      const painted = v ? resolve(tokens, block, v[1]) : undefined;
      const expected = resolve(tokens, block, twinName);
      if (!painted || !expected || painted.toUpperCase() !== expected.toUpperCase()) {
        fails.push(`${theme}: ${sel} { color: ${expr} } paints ${painted ?? 'an unresolvable colour'}, but ${stateToken} reads as ${twin} = ${expected} here — the state and its text have drifted apart; read it through ${twin}`);
      }
    }
  }

  return { fails, oks, measured, selectors: selectors.size };
}

// ── self-test: the audit must still be able to fail ─────────────────────────
// Every other guard in this directory proves its patterns against fixtures
// before it scans, and CI runs that proof as its own step. This is that proof
// for the audit above.
//
// The fixtures run against a FROZEN token model, not tokens.css. If they ran
// against the live tokens, a token regression (say a light --mint-fg nudged
// below the bar) would break the self-test and be reported as "this guard
// cannot be trusted" rather than as the contrast failure it is, and the
// sections that name the real cause would never run. The values below are
// the shipped ones, copied so the proof does not move when the system does.
const FIXTURE_TARGET = 4.55;
const FIXTURE_TOKENS = parseTokens(`
:root {
  --bg: #08091A; --fg: #E4E3F5;
  --mint: #45E0A8; --mint-fg: var(--mint);
  --violet: #8B5CF6; --violet-fg: var(--violet);
  --tangerine: #FF9300; --tangerine-fg: var(--tangerine);
  --strawberry: #FF2F92; --strawberry-fg: var(--strawberry);
  --kw-ga: #8EEFC9;
  --state-pass: var(--mint); --state-warn: var(--strawberry);
}
[data-theme="light"] {
  --bg: #f4f6fb; --fg: #1e293b;
  --mint-fg: #00805B; --violet-fg: #8150E9; --tangerine-fg: #A75E00; --strawberry-fg: #DA0078;
}`);

function selfTest() {
  let good = true;
  const say = (pass, label) => {
    console.log(`  ${pass ? 'ok    ' : 'BROKEN'} ${label}`);
    if (!pass) good = false;
  };
  const run = (text, tokens = FIXTURE_TOKENS) => auditElements(text, tokens, FIXTURE_TARGET);
  const has = (res, re) => res.fails.some((f) => re.test(f));

  // A routed stylesheet in the shape elements.css ships. Every case below is
  // this plus one change, so each failure is attributable to that change.
  const ROUTED = `
    body { color: var(--fg); background: var(--bg); }
    a { color: var(--mint-fg); }
    a:hover { color: var(--kw-ga); }
    [data-theme="light"] a:hover { color: var(--fg); }
    .eyebrow, .section-label { color: var(--strawberry-fg); }
    .stat-value { color: var(--tangerine-fg); }
    .eq-ds { color: var(--violet-fg); }
    .state-pass { color: var(--mint-fg); }
    .state-warn { color: var(--strawberry-fg); }`;
  const routed = run(ROUTED);
  say(routed.fails.length === 0 && routed.measured === 18, `the routed shape is clean in both themes (${routed.measured} runs, ${routed.fails.length} failures)`);

  // The shape elements.css shipped with before #48: bare hues everywhere.
  const BARE = ROUTED
    .replace(/var\(--(mint|strawberry|tangerine|violet)-fg\)/g, 'var(--$1)')
    .replace('.state-pass { color: var(--mint); }', '.state-pass { color: var(--state-pass); }')
    .replace('.state-warn { color: var(--strawberry); }', '.state-warn { color: var(--state-warn); }')
    .replace('[data-theme="light"] a:hover { color: var(--fg); }', '');
  const bare = run(BARE);
  const contrastFails = bare.fails.filter((f) => /below the body target/.test(f));
  const bindingFails = bare.fails.filter((f) => /have drifted apart/.test(f));
  say(contrastFails.length === 8 && contrastFails.every((f) => f.startsWith('light:')),
    `the bare-hue shape fails all 8 of its read runs in light, none in dark (${contrastFails.length})`);
  say(bindingFails.length === 2 && bindingFails.every((f) => f.startsWith('light:')) && bare.fails.length === 10,
    `and its two bare state aliases fail the binding in light only, where they are not the twin (${bindingFails.length}; ${bare.fails.length} in all)`);
  say(has(bare, /light: \.state-pass \{ color: var\(--state-pass\) \}.*read it through var\(--mint-fg\)/), 'a failing state alias is told the twin of its bound hue');

  const noOverride = run(ROUTED.replace('[data-theme="light"] a:hover { color: var(--fg); }', ''));
  say(noOverride.fails.length === 1 && has(noOverride, /^light: a:hover \{ color: var\(--kw-ga\) \}/), 'dropping the light hover override fails exactly the light a:hover');

  const fill = run(`${ROUTED}\n.x { -webkit-text-fill-color: var(--tangerine); }`);
  say(fill.fails.length === 1 && has(fill, /^light: \.x \{ -webkit-text-fill-color: var\(--tangerine\) \}/), '-webkit-text-fill-color is measured, not only color');

  const shadow = run(`${ROUTED}\n:root { --mint-fg: var(--mint); }`);
  say(has(shadow, /:root declares --mint-fg — tokens belong in tokens\.css/), 'a token redefined in the stylesheet fails');

  const rebound = { ...FIXTURE_TOKENS, ':root': { ...FIXTURE_TOKENS[':root'], '--state-pass': 'var(--violet)' } };
  say(has(run(ROUTED, rebound), /^dark: \.state-pass \{ color: var\(--mint-fg\) \} paints #45E0A8, but --state-pass reads as var\(--violet-fg\) = #8B5CF6/), 'rebinding --state-pass in the tokens fails the routed .state-pass');
  const lightState = run(`${ROUTED}\n[data-theme="light"] .state-pass { color: var(--violet-fg); }`);
  say(lightState.fails.length === 1 && has(lightState, /^light: \.state-pass \{ color: var\(--violet-fg\) \} paints #8150E9, but --state-pass reads as var\(--mint-fg\)/),
    'a light-scoped state override in the wrong hue fails, though it is readable');
  say(has(run(ROUTED.replace('.state-warn { color: var(--strawberry-fg); }', '')), /^\.state-warn no longer sets a colour/), 'a state class that disappears fails');

  say(has(run(`${ROUTED}\n@media (prefers-color-scheme: light) { a { color: var(--mint); } }`), /at-rule block/), 'an at-rule block fails closed');
  say(has(run(`${ROUTED}\n.card { color: var(--fg); background: var(--mint); }`), /^\.card paints its own ground/), 'a second painted ground fails closed');
  say(has(run(ROUTED.replace('background: var(--bg);', '')), /^body no longer paints var\(--bg\)/), 'body no longer painting --bg fails closed');
  say(has(run(`${ROUTED}\nhtml[data-theme="light"] a { color: var(--fg); }`), /theme qualifier this check cannot attribute/), 'an unrecognised theme qualifier fails closed');
  say(has(run(`${ROUTED}\n.x { color: var(--fg); opacity: 0.8; }`), /^\.x sets opacity: 0\.8/), 'opacity on a rule fails closed');
  say(has(run(`${ROUTED}\n.x { filter: brightness(1.4); }`), /^\.x sets filter/), 'a filter fails closed');
  say(has(run(`${ROUTED}\n.chip { color: var(--fg); background-image: linear-gradient(var(--mint), var(--mint)); }`), /^\.chip paints its own ground \(background-image/), 'a background-image under text fails closed');
  const hidden = run(`${ROUTED}\n.q::before { content: "/*"; }\n.leak { color: var(--mint); }\n.r::after { content: "*/"; }`);
  say(has(hidden, /a string holding CSS syntax, "\/\*"/), 'a string holding /* cannot hide the rules after it');
  say(has(run(`${ROUTED}\na[title="}"] { color: var(--fg); }`), /a string holding CSS syntax, "\}"/), 'a brace inside an attribute string fails closed');
  say(has(run(`${ROUTED}\n.e { c\\olor: var(--mint); }`), /a CSS escape/), 'a CSS escape fails closed');
  say(has(run(`${ROUTED}\n[data-theme="light"] html { color: var(--fg); }`), /never matches — data-theme is set on <html> itself/), 'a light rule scoped to a descendant <html> fails as never-matching');
  say(run(ROUTED.replace('a:hover {', 'a[href^="http"]:hover {')).fails.length === 1, 'a plain quoted attribute selector is read, not refused (only the moved override fails)');
  say(has(run(`${ROUTED}\n.x { color: inherit; }`), /\.x \{ color: inherit \} = inherit is not a plain hex/), '`color: inherit` fails closed');
  say(has(run(`${ROUTED}\n.x { color: var(--nope); }`), /tokens\.css does not define --nope/), 'an undefined token fails closed');
  const sunk = { ...FIXTURE_TOKENS, [LIGHT]: { ...FIXTURE_TOKENS[LIGHT], '--mint-fg': '#00A070' } };
  const sunkRes = run(ROUTED, sunk);
  say(has(sunkRes, /^light: a \{ color: var\(--mint-fg\) \} = #00A070/) && !has(sunkRes, /read it through var\(--mint-fg\)/),
    'a rule already on its twin is not told to read that twin when the twin itself regresses');
  say(run('body { background: var(--bg); }').measured === 0, 'a stylesheet with no read colour measures nothing (the scan fails on that)');

  if (!good) {
    console.log('\nself-test FAILED — the elements.css audit in section 4 cannot be trusted.');
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
// The audit and its reasoning are defined above, next to the self-test that
// proves it can still fail.
console.log(`\n── ${ELEMENTS} · every text colour vs --bg · body target ${BODY_TARGET}:1`);
{
  const { fails, oks, measured, selectors } = auditElements(readFileSync(join(ROOT, ELEMENTS), 'utf8'), blocks, BODY_TARGET);
  for (const f of fails) bad(f);
  for (const o of oks) ok(o);
  console.log(`  ${measured} text run(s) measured across ${selectors} selector(s)`);
  if (measured === 0) {
    console.log('  FAIL  parsed no read colour from elements.css — the pattern has stopped matching.');
    console.log('        A check that silently matches nothing reports a clean pass it never made.');
    fail++;
  }
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
