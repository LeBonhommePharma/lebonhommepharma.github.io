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
 * And it reads assets/tui.js, which injects a stylesheet of its own as an
 * array of string literals that no .css file holds. Every colour that panel
 * asks a person to read is measured against the ground it actually sits on
 * (the window, the titlebar's translucent card composited over it, the
 * restore chip), in both themes.
 *
 * WCAG 2.1 AA: 4.5:1 body · 3:1 at >=24px or >=18.66px bold · 3:1 non-text.
 *
 * Usage: check-contrast.mjs [--verbose] [--self-test]
 *   --self-test  prove the elements.css and tui.js audits can still fail,
 *                then stop. A full run always does this first.
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
 * The read twin of a token, following var() aliases through the ink block:
 * --mint -> --mint-fg, --state-pass -> --mint-fg, --series-6 -> --tangerine-fg.
 * A twin names itself (--mint-fg -> --mint-fg), so a caller that gets back the
 * name it asked about knows the rule is already on its twin. Shared by the
 * elements.css and tui.js audits, so "the twin" has one definition.
 */
function readTwin(tokens, name) {
  for (let n = name, guard = 0; n && guard < 32; guard++) {
    if (tokens[':root'][`${n}-fg`] !== undefined) return `${n}-fg`;
    n = VAR_ONLY.exec(tokens[':root'][n] ?? '')?.[1];
  }
  return null;
}

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
    const m = VAR_ONLY.exec(expr);
    const twin = m && readTwin(tokens, m[1]);
    return twin ? `var(${twin})` : null;
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

// ── the tui.js audit (section 5), defined up front so it can be self-tested ──
// assets/tui.js injects its own stylesheet: `var CSS = [ ... ].join('')`, an
// array of single-quoted string literals with `//` comments between them. No
// .css file holds it, so section 4 never saw it, and the panel's read colours
// sat at 1.26 to 3.92:1 on the light ground (bare key colours where the --*-fg
// twins belong) while every check here was green. This reads that array and
// measures every colour in it that paints a glyph, per theme, against the
// ground that glyph actually sits on, at the body target whatever its size.
//
// THE GROUNDS, read from the CSS and composited, never assumed
//   window    .tui-win's background, over the page.
//   titlebar  .tui-bar's background, over the WINDOW. On the ink --bg-card is
//             rgba(17,18,38,.82), so it is composited over the window before
//             anything is measured on it. That is not a formality: dark violet
//             clears on the window (4.66:1) and does not on the bar (4.43:1).
//   restore   .tui-restore's background, over the page. The chip is a sibling
//             of the window inside the mount, not a child of it.
//   page      --bg, which every page in the system paints (elements.css body;
//             section 4 fails if it stops). The mount itself paints nothing.
// WHICH ground a rule's text sits on is decided by the DOM TUI() builds, not
// by the CSS, so it is a table (TUI_PLACES, TUI_TEXT) read against the
// selector: the innermost place a selector names wins (`.tui-bar .x` sits on
// the bar), and otherwise the subject's class says where tui.js puts it. A
// class in neither table is a FAIL, not a guess. Neither default would be
// safe: the light card is the lighter ground and the ink's card is the
// lighter one too, so a wrong guess flatters a colour in one theme or the other.
//
// FILLS are left alone, and held to being fills. The lights (.tui-dot), the
// meter (.tui-meter, .tui-ramp, .tui-cover) and the caret (.tui-caret) paint
// key colours on purpose and carry no glyph, so their backgrounds are not
// measured; a fill rule that also sets a read colour fails. Only `color` and
// `-webkit-text-fill-color` are read, so `currentColor` in the pressed light's
// box-shadow (a ring, not text) is never mistaken for text. `color: transparent`
// paints no glyph and is not measured, unless the rule clips its background to
// its text, which would paint glyphs this check cannot see: that fails.
//
// AT-RULES are decided, not skipped.
//   @media on width, height, hover, pointer, orientation or
//          prefers-reduced-motion: the condition can hold in either theme, so
//          every colour inside is measured as if it always applied, and every
//          rule outside is measured too, since the condition may not hold.
//          The two blocks tui.js ships (max-width:520px, and
//          prefers-reduced-motion:reduce) set no colour.
//   @keyframes may animate opacity and transform only, and a rule that runs
//          an opacity animation must paint no glyph (`color: transparent`):
//          a fading glyph is composited with its ground, and that is not the
//          pair this measures. The caret blinks that way, and has no glyph.
//   Anything else fails: another at-rule, a @media on prefers-color-scheme or
//   any feature this does not list, a rule nested in a rule, a theme-scoped
//   selector. For each, this check cannot say in which theme it applies.
//
// FAIL-CLOSED, like section 4. Any of these is a FAIL, never a skip: no CSS
// array, or more than one; an element of it that is not a single-quoted
// literal; zero rules parsed; a second stylesheet; a colour or ground set from
// script outside the array (the stage names were inline styles until #50, and
// an inline colour is one this would never see); a token tokens.css does not
// define, since the browser would then paint the fallback in both themes; a
// fallback that is not its token's ink value, since the fallback is what paints
// without tokens.css; a token the array redefines; opacity or a filter.
//
// NOT MEASURED, and stated rather than hidden. Pages that rebind tokens around
// the mount (index.html's light --series-* ramp, shannon's --bg-card) are
// page-side; this measures the panel as tokens.css defines it. A bare mount
// (data-flexaidds-tui="bare") paints no window, so its host frame is the
// ground; its text is held to the window's ground, which the homepage's frame
// matches on the ink (--bg) and exceeds in light (the white --bg-card).
// Focus outlines are non-text (SC 1.4.11, 3:1) and are not held here.
const TUI = 'assets/tui.js';

// Where tui.js's text sits, from the DOM TUI() builds: the bar holds the
// lights, .tui-title and .tui-state; the body holds every line; the restore
// chip is the mount's other child. A place is a container, and text inside it
// may sit on any ground it holds: the window holds the titlebar, and the mount
// holds all three.
const TUI_PLACES = {
  __mount: ['window', 'titlebar', 'restore'],
  'tui-win': ['window', 'titlebar'],
  'tui-bare': ['window'],
  'tui-body': ['window'],
  'tui-bar': ['titlebar'],
  'tui-restore': ['restore'],
};
const TUI_TEXT = [
  [/^tui-(title|state)$/, ['titlebar']],
  [/^(tui-(line|row|idx|name|val|dim|cmd|t|note|eq|s[1-6])|eq-(dg|dh|t|ds|dsv))$/, ['window']],
];
const TUI_FILLS = /^tui-(dot|meter|ramp|cover|caret)$/;
// The rule that paints each ground, and the ground it is painted over.
const TUI_GROUNDS = {
  window: { sel: '.tui-win', over: 'page' },
  titlebar: { sel: '.tui-bar', over: 'window' },
  restore: { sel: '.tui-restore', over: 'page' },
};
const TUI_SURFACES = ['window', 'titlebar', 'restore']; // in compositing order
const KEYFRAME_PROPS = new Set(['opacity', 'transform']);
const MEDIA_FEATURE = new RegExp('^\\(\\s*(?:' + [
  '(?:min-|max-)?(?:width|height)\\s*:\\s*[\\d.]+(?:px|em|rem)',
  'prefers-reduced-motion\\s*:\\s*(?:reduce|no-preference)',
  '(?:any-)?hover\\s*:\\s*(?:hover|none)',
  '(?:any-)?pointer\\s*:\\s*(?:fine|coarse|none)',
  'orientation\\s*:\\s*(?:portrait|landscape)',
].join('|') + ')\\s*\\)$', 'i');
const VAR_FALLBACK = /^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([\s\S]*?))?\s*\)$/;

const lineAt = (text, offset) => text.slice(0, offset).split('\n').length;

/** A colour as [r, g, b, a], or null: #RRGGBB, rgb() and rgba() with commas. */
function rgbaOf(value) {
  const v = String(value).trim();
  if (HEX_RE.test(v)) return [...rgbOf(v), 1];
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
  if (!m) return null;
  const c = [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  return c.slice(0, 3).every((x) => x >= 0 && x <= 255) && c[3] >= 0 && c[3] <= 1 ? c : null;
}

/** `colour` composited over the opaque `baseHex`, as #RRGGBB; null if it is not a colour. */
function over(colour, baseHex) {
  const c = rgbaOf(colour);
  if (!c || !HEX_RE.test(String(baseHex).trim())) return null;
  const base = rgbOf(baseHex);
  return '#' + c.slice(0, 3)
    .map((ch, i) => Math.round(c[3] * ch + (1 - c[3]) * base[i]).toString(16).padStart(2, '0'))
    .join('').toUpperCase();
}

/**
 * Blank a JS source's comments, keeping its strings and its length (so offsets
 * and line numbers still point into the file), and list every string literal.
 * Comments go first, so `// don't` cannot open a string and a commented-out
 * rule is not CSS. tui.js has no regex literal and no template literal outside
 * a comment; a ' or " this cannot close on its own line is what an unhandled
 * one would look like, so it is reported rather than guessed past.
 */
function lexJs(js) {
  let code = '';
  const strings = [];
  const problems = [];
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  for (let i = 0; i < js.length;) {
    const c = js[i];
    if (c === '/' && js[i + 1] === '/') {
      const nl = js.indexOf('\n', i);
      const stop = nl < 0 ? js.length : nl;
      code += blank(js.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === '/' && js[i + 1] === '*') {
      const end = js.indexOf('*/', i + 2);
      if (end < 0) { problems.push(`an unterminated block comment at line ${lineAt(js, i)}`); code += blank(js.slice(i)); break; }
      code += blank(js.slice(i, end + 2));
      i = end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < js.length && js[j] !== c && (c === '`' || js[j] !== '\n')) j += js[j] === '\\' ? 2 : 1;
      if (js[j] !== c) { problems.push(`an unterminated ${c} string at line ${lineAt(js, i)}`); code += js.slice(i); break; }
      strings.push({ start: i, end: j + 1, quote: c, body: js.slice(i + 1, j) });
      code += js.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    code += c;
    i++;
  }
  return { code, strings, problems };
}

/**
 * The stylesheet tui.js injects: the single-quoted literals of its one
 * `var CSS = [ ... ].join('')` array, concatenated. Anything else in the array
 * (a concatenation, a variable, another quote style) is CSS this would never
 * see, so it fails rather than reading around it.
 */
function extractTuiCss(js) {
  const fails = [];
  const { code, strings, problems } = lexJs(js);
  for (const p of problems) fails.push(`tui.js has ${p} — its strings cannot be placed safely, so the CSS array is not read`);
  const decls = [...code.matchAll(/\bvar\s+CSS\s*=\s*\[/g)];
  if (decls.length !== 1) {
    fails.push(`tui.js declares \`var CSS = [\` ${decls.length} time(s) — this reads exactly one such array, the stylesheet the panel injects`);
    return { css: '', literals: 0, fails, code, strings, region: [0, 0] };
  }
  const byStart = new Map(strings.map((s) => [s.start, s]));
  const parts = [];
  let i = decls[0].index + decls[0][0].length;
  let close = -1;
  while (i < code.length) {
    const c = code[i];
    if (c === ']') { close = i; break; }
    if (c === ',' || /\s/.test(c)) { i++; continue; }
    const s = byStart.get(i);
    if (s && s.quote === "'") { parts.push(s); i = s.end; continue; }
    fails.push(`tui.js:${lineAt(js, i)} the CSS array holds ${JSON.stringify(code.slice(i, i + 32).trim())} — only single-quoted literals are read, so anything else in the array is CSS this check never sees`);
    return { css: '', literals: parts.length, fails, code, strings, region: [decls[0].index, i] };
  }
  if (close < 0) {
    fails.push("tui.js's CSS array is never closed");
    return { css: '', literals: parts.length, fails, code, strings, region: [decls[0].index, code.length] };
  }
  if (!/^\s*\.\s*join\(\s*''\s*\)/.test(code.slice(close + 1))) {
    fails.push("tui.js's CSS array is not joined with .join('') — the injected text would not be these literals end to end");
  }
  for (const p of parts) {
    // A JS escape can spell a property the CSS reader below would never see.
    if (p.body.includes('\\')) fails.push(`tui.js:${lineAt(js, p.start)} a CSS literal holds a backslash escape — the reader takes literals verbatim, so it fails rather than decode one`);
  }
  return { css: parts.map((p) => p.body).join(''), literals: parts.length, fails, code, strings, region: [decls[0].index, close + 1] };
}

/** Split CSS into `prelude { body }` items, one level deep. Strings are already vetted by lexElements. */
function cssItems(text) {
  const items = [];
  const problems = [];
  for (let i = 0; i < text.length;) {
    const open = text.indexOf('{', i);
    const stray = text.indexOf('}', i);
    if (open < 0) {
      if (text.slice(i).trim()) problems.push(`text outside any rule, ${JSON.stringify(text.slice(i).trim().slice(0, 40))}`);
      break;
    }
    if (stray >= 0 && stray < open) { problems.push(`an unmatched } before ${JSON.stringify(text.slice(i, open).trim().slice(0, 40))}`); break; }
    let depth = 1;
    let j = open + 1;
    for (; j < text.length && depth; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') depth--;
    }
    if (depth) { problems.push('an unclosed {'); break; }
    items.push({ prelude: text.slice(i, open).trim(), body: text.slice(open + 1, j - 1) });
    i = j;
  }
  return { items, problems };
}

/**
 * Audit tui.js's injected stylesheet against a token model, at a given body
 * target. Pure, like auditElements: returns
 * { fails, oks, measured, selectors, rules, grounds } and prints nothing.
 */
function auditTui(js, tokens, target) {
  const fails = [];
  const oks = [];
  const { css: tuiCss, literals, fails: extractFails, code, strings, region } = extractTuiCss(js);
  fails.push(...extractFails);

  // ── one stylesheet, and no colour from script ──
  const styleEls = [...code.matchAll(/createElement\s*\(\s*(['"])style\1\s*\)/g)].length;
  if (styleEls !== 1) fails.push(`tui.js creates ${styleEls} <style> element(s) — this reads the one fed by CSS; another would be a stylesheet it never sees`);
  if (!/\.textContent\s*=\s*CSS\s*;/.test(code)) fails.push('tui.js no longer sets a <style> element\'s textContent to CSS — the array this reads may not be what the page gets');
  for (const m of code.matchAll(/\b(insertRule|adoptedStyleSheets|CSSStyleSheet|replaceSync|insertAdjacentHTML|outerHTML|document\.write)\b/g)) {
    fails.push(`tui.js:${lineAt(js, m.index)} uses ${m[1]} — a way to add styles or markup this check does not read`);
  }
  const INLINE = /^(color|webkitTextFillColor|WebkitTextFillColor|background[A-Za-z]*|opacity|filter|mixBlendMode|backdropFilter|cssText)$/;
  for (const m of code.matchAll(/\.style\s*\.\s*([A-Za-z]+)\s*=(?!=)/g)) {
    if (INLINE.test(m[1])) fails.push(`tui.js:${lineAt(js, m.index)} sets .style.${m[1]} from script — a colour outside the CSS array is one this check never measures; give it a class in the array`);
  }
  for (const m of code.matchAll(/\.style\s*(\[|\.\s*setProperty\b)|setAttribute\s*\(\s*(['"])style\2|Object\.assign\s*\(\s*[\w$.]*\.style\b/g)) {
    fails.push(`tui.js:${lineAt(js, m.index)} writes ${JSON.stringify(m[0])} — a style this check cannot name from script; give it a class in the CSS array`);
  }
  const ATTR_PAINT = /(?:^|;)\s*(color|-webkit-text-fill-color|background(?:-[a-z]+)?|opacity|filter|mix-blend-mode|backdrop-filter)\s*:/i;
  for (const s of strings) {
    if (s.start >= region[0] && s.end <= region[1]) continue; // the CSS literals themselves
    if (/<\s*(style|link)\b/i.test(s.body)) fails.push(`tui.js:${lineAt(js, s.start)} a string writes a ${/<\s*(style|link)/i.exec(s.body)[0]}> element — a stylesheet this check never reads`);
    for (const m of s.body.matchAll(/\bstyle\s*=\s*/gi)) {
      const q = s.body[m.index + m[0].length];
      const end = q === '"' || q === "'" ? s.body.indexOf(q, m.index + m[0].length + 1) : -1;
      if (end < 0) { fails.push(`tui.js:${lineAt(js, s.start)} a style attribute this cannot read whole (${JSON.stringify(s.body.slice(m.index, m.index + 32))}) — it may carry a colour`); continue; }
      const value = s.body.slice(m.index + m[0].length + 1, end);
      const hit = ATTR_PAINT.exec(value);
      if (hit) fails.push(`tui.js:${lineAt(js, s.start)} an inline style="${value}" sets ${hit[1]} — a colour outside the CSS array is one this check never measures; give it a class in the array`);
    }
  }

  // ── the stylesheet, one level of at-rule deep ──
  const { text, problems } = lexElements(tuiCss); // the same CSS comment, string and escape rules section 4 reads by
  for (const p of problems) fails.push(`tui.js's CSS has ${p} — the rule parser below cannot read that safely; it fails rather than guess`);
  const top = cssItems(text);
  for (const p of top.problems) fails.push(`tui.js's CSS has ${p}`);

  const rules = []; // { sel, ctx, decls: [[prop, value]] }
  const keyframes = new Map(); // name -> Set of properties it animates
  const declsOf = (body, where) => {
    const out = [];
    for (const d of body.split(';')) {
      if (!d.trim()) continue;
      const h = /^\s*(--[A-Za-z0-9_-]+|-?[A-Za-z][A-Za-z-]*)\s*:\s*([\s\S]+?)\s*$/.exec(d);
      if (!h) { fails.push(`${where} has a declaration this cannot read, ${JSON.stringify(d.trim().slice(0, 40))}`); continue; }
      out.push([h[1].toLowerCase(), h[2].replace(/\s+/g, ' ').replace(/\s*!important$/i, '')]);
    }
    return out;
  };
  for (const { prelude, body } of top.items) {
    if (/[;}]/.test(prelude)) { fails.push(`tui.js's CSS has a statement before ${JSON.stringify(prelude.slice(-40))} — this reads rules and two kinds of block, nothing else`); continue; }
    const at = /^@([A-Za-z-]+)\s*([\s\S]*)$/.exec(prelude);
    if (!at) {
      if (body.includes('{')) { fails.push(`${prelude} nests a rule inside a rule — this reads flat rules and one level of @media`); continue; }
      rules.push({ sel: prelude, ctx: null, decls: declsOf(body, prelude) });
      continue;
    }
    const [, kind, cond] = at;
    if (kind.toLowerCase() === 'media') {
      const ctx = `@media ${cond.trim()}`;
      const okCond = cond.split(',').every((q) => {
        const parts = q.trim().split(/\s+and\s+/i);
        return parts.length > 0 && parts.every((p) => /^(only\s+)?(screen|all)$/i.test(p.trim()) || MEDIA_FEATURE.test(p.trim()));
      });
      if (!okCond) { fails.push(`${ctx} — a condition this cannot hold true or false in either theme; teach it the condition before trusting it`); continue; }
      const inner = cssItems(body);
      for (const p of inner.problems) fails.push(`${ctx} has ${p}`);
      for (const it of inner.items) {
        if (it.prelude.startsWith('@') || it.body.includes('{') || /[;}]/.test(it.prelude)) { fails.push(`${ctx} nests ${JSON.stringify(it.prelude.slice(0, 40))} — this reads one level of @media, holding flat rules`); continue; }
        rules.push({ sel: it.prelude, ctx, decls: declsOf(it.body, `${ctx} ${it.prelude}`) });
      }
    } else if (/^(-webkit-)?keyframes$/i.test(kind)) {
      const name = cond.trim();
      const props = new Set();
      const frames = cssItems(body);
      for (const p of frames.problems) fails.push(`@keyframes ${name} has ${p}`);
      for (const f of frames.items) {
        if (!/^(from|to|[\d.]+%)(\s*,\s*(from|to|[\d.]+%))*$/i.test(f.prelude) || f.body.includes('{')) { fails.push(`@keyframes ${name} has a frame this cannot read, ${JSON.stringify(f.prelude.slice(0, 40))}`); continue; }
        for (const [p, v] of declsOf(f.body, `@keyframes ${name} ${f.prelude}`)) {
          if (!KEYFRAME_PROPS.has(p)) fails.push(`@keyframes ${name} animates ${p}: ${v} — a keyframe may move opacity and transform only; anything else changes a colour this measures as fixed`);
          props.add(p);
        }
      }
      keyframes.set(name, props);
    } else {
      fails.push(`@${kind} ${cond.trim()} — an at-rule this check cannot attribute; teach it the block before trusting it`);
    }
  }
  if (rules.length === 0) fails.push('parsed no rules from tui.js\'s CSS array — a check that reads nothing reports a clean pass it never made');

  // ── which ground a selector's text sits on ──
  const flatSel = (sel) => sel
    .replace(/\[\s*data-flexaidds-tui\b[^\]]*\]/g, '.__mount')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/::?[A-Za-z-]+(\([^)]*\))?/g, '');
  const compoundsOf = (sel) => flatSel(sel).split(/\s*[>+~]\s*|\s+/).filter(Boolean);
  const classesOf = (compound) => [...compound.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
  function surfacesOf(sel) {
    const compounds = compoundsOf(sel);
    for (let k = compounds.length - 1; k >= 0; k--) {
      const places = classesOf(compounds[k]).filter((c) => TUI_PLACES[c]);
      if (places.length) return [...new Set(places.flatMap((c) => TUI_PLACES[c]))];
    }
    const subject = classesOf(compounds[compounds.length - 1] ?? '');
    const hits = subject.flatMap((c) => TUI_TEXT.filter(([re]) => re.test(c)).flatMap(([, s]) => s));
    return hits.length ? [...new Set(hits)] : null;
  }
  const isFill = (sel) => classesOf(compoundsOf(sel).at(-1) ?? '').some((c) => TUI_FILLS.test(c));

  // ── every rule: grounds, fills, compositing, and the runs to measure ──
  const tokenNames = new Set([...Object.keys(tokens[':root']), ...Object.keys(tokens[LIGHT] ?? {})]);
  const groundExpr = {}; // surface -> { expr, label }
  const runs = []; // { label, prop, expr, surfaces }
  for (const { sel: selText, ctx, decls } of rules) {
    const rule = selText.replace(/\s+/g, ' ').trim();
    const where = (s) => (ctx ? `${ctx} ${s}` : s);
    // A selector list inside a pseudo-class would be cut at its comma below,
    // and :has() places a rule by what it contains; either could put text on
    // the wrong ground. tui.js uses neither, so neither is taught.
    if (/:(is|where|not|has|matches|-webkit-any|-moz-any)\(/i.test(rule)) {
      fails.push(`${where(rule)} uses a selector-list pseudo-class — this places text by the classes a selector names, and cannot place that; teach it before trusting it`);
      continue;
    }
    for (const [n] of decls.filter(([p]) => p.startsWith('--') && tokenNames.has(p))) {
      fails.push(`${where(rule)} redeclares ${n} — tokens belong in tokens.css; one redefined here changes what the panel paints while this check measures the tokens.css value it shadows`);
    }
    for (const [n, v] of decls.filter(([p]) => COMPOSITING.includes(p))) {
      fails.push(`${where(rule)} sets ${n}: ${v} — text under it is composited with what lies beneath, so its contrast is not the pair this measures`);
    }
    const reads = decls.filter(([p]) => READ_PROPS.includes(p));
    const glyphs = reads.filter(([, v]) => v.toLowerCase() !== 'transparent');
    const grounds = decls.filter(([p]) => GROUND_PROPS.includes(p));
    const clipsToText = decls.some(([p, v]) => /^(-webkit-)?background-clip$/.test(p) && /\btext\b/.test(v));
    const animation = decls.filter(([p]) => p === 'animation' || p === 'animation-name').map(([, v]) => v).join(' ');
    const fades = [...keyframes].some(([name, props]) => props.has('opacity') && new RegExp(`(^|[\\s,])${name.replace(/[^\w-]/g, '\\$&')}($|[\\s,])`).test(animation));
    for (const raw of selText.split(',')) {
      const sel = raw.replace(/\s+/g, ' ').trim();
      if (!sel) continue;
      const label = where(sel);
      if (/data-theme/.test(sel)) { fails.push(`${label}: a theme-scoped selector — tui.js themes through tokens, and this check cannot attribute a rule that names a theme; teach it before trusting it`); continue; }
      const fill = isFill(sel);
      if (grounds.length) {
        const known = Object.entries(TUI_GROUNDS).find(([, g]) => g.sel === sel);
        if (known && !ctx && !groundExpr[known[0]] && grounds.length === 1 && grounds[0][0] !== 'background-image') {
          groundExpr[known[0]] = { expr: grounds[0][1], label };
        } else if (known) {
          fails.push(`${label} paints the ${known[0]} ground a second way (${grounds.map(([p, v]) => `${p}: ${v}`).join('; ')}) — this measures one ground per surface; more is a ground it would be assuming`);
        } else if (!fill) {
          fails.push(`${label} paints a ground (${grounds.map(([p, v]) => `${p}: ${v}`).join('; ')}) that no text here is measured on — measure text against it before trusting this check`);
        }
      }
      if (fill && glyphs.length) fails.push(`${label} is a fill (a light, the meter or the caret) and also sets ${glyphs.map(([p, v]) => `${p}: ${v}`).join('; ')} — a fill is not measured as a ground, so text on it is unmeasured`);
      if (clipsToText && reads.length) fails.push(`${label} clips its background to its text — the glyphs are painted by the background, which this check does not measure`);
      if (fades && glyphs.length) fails.push(`${label} runs an opacity animation and paints a glyph — a fading glyph is composited with its ground, which is not the pair this measures`);
      if (fill) continue;
      for (const [prop] of reads.filter(([, v]) => v.toLowerCase() === 'transparent')) oks.push(`${label} { ${prop}: transparent } paints no glyph`);
      if (!glyphs.length) continue;
      const surfaces = surfacesOf(sel);
      if (!surfaces) {
        fails.push(`${label} { ${glyphs.map(([p, v]) => `${p}: ${v}`).join('; ')} } — tui.js puts this class somewhere this check has not placed; add it to TUI_PLACES or TUI_TEXT with the ground the DOM puts it on`);
        continue;
      }
      for (const [prop, expr] of glyphs) runs.push({ label, prop, expr, surfaces });
    }
  }

  // ── resolve a value through the tokens; the fallback must be the ink value ──
  function colourOf(expr, block) {
    const v = VAR_FALLBACK.exec(expr);
    if (!v) return rgbaOf(expr) ? { value: expr } : { error: `${expr} is not a token or a colour this can measure` };
    let value;
    try { value = resolve(tokens, block, v[1]); } catch (e) { return { error: e.message }; }
    if (value === undefined) return { error: `tokens.css does not define ${v[1]}, so the browser paints the fallback${v[2] ? ` ${v[2]}` : ''} in both themes` };
    return { value, token: v[1] };
  }
  function checkFallback(label, prop, expr) {
    const v = VAR_FALLBACK.exec(expr);
    if (!v || v[2] === undefined) return;
    let ink;
    try { ink = resolve(tokens, ':root', v[1]); } catch { return; } // the unresolvable token is reported where it is measured
    if (ink === undefined) return;
    const a = rgbaOf(v[2]);
    const b = rgbaOf(ink);
    if (!a || !b || a.some((x, i) => Math.abs(x - b[i]) > 1e-9)) {
      fails.push(`${label} { ${prop}: ${expr} } — the fallback ${v[2]} is not ${v[1]}'s ink value ${ink}; without tokens.css the panel paints the fallback, and that is no longer the dark theme measured here`);
    }
  }

  // ── the grounds, per theme ──
  const ground = {};
  for (const [theme, block] of [['dark', ':root'], ['light', LIGHT]]) {
    const g = { page: resolve(tokens, block, '--bg') };
    if (!g.page || !HEX_RE.test(g.page)) { fails.push(`${theme}: --bg = ${g.page} is not an opaque hex — the page under the panel cannot be measured against`); g.page = undefined; }
    for (const surface of TUI_SURFACES) {
      const { sel, over: under } = TUI_GROUNDS[surface];
      const decl = groundExpr[surface];
      if (!decl) continue; // reported once, below
      const c = colourOf(decl.expr, block);
      if (c.error) { fails.push(`${theme}: ${decl.label} { background: ${decl.expr} } — ${c.error}`); continue; }
      const base = g[under];
      if (!base) continue;
      g[surface] = over(c.value, base);
      if (!g[surface]) fails.push(`${theme}: ${sel} { background: ${decl.expr} } = ${c.value} is not a colour this can composite`);
    }
    ground[theme] = g;
  }
  for (const surface of TUI_SURFACES) {
    const decl = groundExpr[surface];
    if (!decl) fails.push(`${TUI_GROUNDS[surface].sel} no longer paints its own background — text on the ${surface} would be measured against an assumed ground`);
    else checkFallback(decl.label, 'background', decl.expr);
  }

  // ── every glyph colour, per theme, on every ground it can sit on ──
  let measured = 0;
  const selectors = new Set();
  for (const { label, prop, expr, surfaces } of runs) {
    selectors.add(label);
    checkFallback(label, prop, expr);
    for (const [theme, block] of [['dark', ':root'], ['light', LIGHT]]) {
      const c = colourOf(expr, block);
      if (c.error) { fails.push(`${theme}: ${label} { ${prop}: ${expr} } — ${c.error}`); continue; }
      for (const surface of surfaces) {
        const bg = ground[theme][surface];
        if (!bg) continue; // the missing ground is its own failure
        measured++;
        const fg = over(c.value, bg);
        const r = fg && ratio(fg, bg);
        if (!r) { fails.push(`${theme}: ${label} { ${prop}: ${expr} } = ${c.value} is not a colour this can measure`); continue; }
        const at = `${fg} on the ${surface} ${bg} = ${show(r)}:1`;
        if (r < target) {
          // No hint when the rule already reads the twin: then the TOKEN is
          // what regressed, and sections 1–2 name it.
          const twin = c.token && readTwin(tokens, c.token);
          const hint = twin && twin !== c.token ? `; read its twin, ${c.token} -> ${twin}` : '';
          fails.push(`${theme}: ${label} { ${prop}: ${expr} } = ${at} (${r.toFixed(6)}) — below the body target (${target}:1)${hint}`);
        } else oks.push(`${theme}: ${label} { ${prop}: ${expr} } = ${at}`);
      }
    }
  }

  return { fails, oks, measured, selectors: selectors.size, rules: rules.length, literals, grounds: ground };
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

// ── self-test: the tui.js audit must still be able to fail ──────────────────
// Same doctrine as above: a frozen token model, so a token that moves is
// reported by the scan as the contrast failure it is, never here as a broken
// guard. These are the shipped values, ink and light, copied.
const TUI_FIXTURE_TOKENS = parseTokens(`
:root {
  --bg: #08091A; --bg-card: rgba(17, 18, 38, 0.82); --fg: #E4E3F5; --fg-muted: #8D8CB0;
  --mint: #45E0A8; --mint-fg: var(--mint);
  --violet: #8B5CF6; --violet-fg: var(--violet);
  --tangerine: #FF9300; --tangerine-fg: var(--tangerine);
  --firetruck: #F5232B; --firetruck-fg: var(--firetruck);
  --aqua: #00A2FF; --aqua-fg: var(--aqua);
  --state-pass: var(--mint); --series-6: var(--tangerine);
}
[data-theme="light"] {
  --bg: #f4f6fb; --bg-card: #ffffff; --fg: #1e293b; --fg-muted: #5a6478;
  --mint-fg: #00805B; --violet-fg: #8150E9; --tangerine-fg: #A75E00;
  --firetruck-fg: #E2001C; --aqua-fg: #0075BB;
}`);

// The routed shape tui.js ships, cut down to one rule of each kind: both
// grounds that are cards, the lights, the bar's text, the body's text, a
// @media block, the meter, the blinking caret and its @keyframes, the restore
// chip. The comments are part of the fixture: one holds an apostrophe, one a
// commented-out bare rule, and neither may be read as CSS.
const TUI_ROUTED = String.raw`(function () {
  'use strict';
  var CSS = [
    '[data-flexaidds-tui]{--tui-pad:clamp(16px,3vw,24px);font-family:var(--font-mono,monospace)}',
    '.tui-win{border:1px solid var(--violet-20,rgba(139,92,246,.2));',
    'background:var(--bg,#08091A);overflow:hidden}',
    '.tui-bar{display:flex;background:var(--bg-card,rgba(17,18,38,.82))}',
    // The lights don't carry text: they are fills, like the meter below.
    '.tui-dot.a{background:var(--mint,#45E0A8)}.tui-dot.c{background:var(--firetruck,#F5232B)}',
    '.tui-dot[aria-pressed="true"]{box-shadow:0 0 0 2px var(--bg,#08091A),0 0 0 3px currentColor}',
    '.tui-title{color:var(--fg-muted,#8D8CB0)}',
    '.tui-state{color:var(--mint-fg,#45E0A8)}',
    '.tui-state[data-done="1"]{color:var(--tangerine-fg,#FF9300)}',
    '.tui-body{color:var(--fg,#E4E3F5)}',
    '@media (max-width:520px){.tui-val{flex-basis:100%}.tui-title{display:none}}',
    // '.tui-cmd{color:var(--mint,#45E0A8)}',  <- commented out, so not CSS
    '.tui-cmd{color:var(--mint-fg,#45E0A8);overflow-wrap:anywhere}',
    '.tui-t{color:var(--firetruck-fg,#F5232B)}',
    '.tui-s2{color:var(--violet-fg,#8B5CF6)}',
    '.tui-s6{color:var(--tangerine-fg,#FF9300)}',
    /* a block comment between literals is not CSS either */
    '.tui-eq .eq-dh{color:var(--mint-fg,#45E0A8)}',
    '.tui-eq .eq-dsv{color:var(--aqua-fg,#00A2FF)}',
    '.tui-meter{background:var(--bg-alt,rgba(12,13,30,.55))}',
    '.tui-ramp{background:linear-gradient(90deg,var(--series-1,#DCDCE4) 0%,var(--series-6,#FF9300) 100%)}',
    '.tui-caret{background:var(--mint,#45E0A8);color:transparent;animation:tuiblink 1.05s steps(1) infinite}',
    '@keyframes tuiblink{0%,50%{opacity:1}50.01%,100%{opacity:0}}',
    '.tui-restore{background:var(--bg-card,rgba(17,18,38,.82));color:var(--fg-muted,#8D8CB0)}',
    '.tui-restore:hover{color:var(--fg,#E4E3F5)}',
    '@media (prefers-reduced-motion:reduce){.tui-caret{animation:none}}'
  ].join('');
  function injectCSS() {
    var s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  function stage(tok, label) {
    var tag = el('span', 'tui-name tui-s' + tok, label);
    return tag;
  }
  function equation(l) {
    l.innerHTML = '<span style="margin-left:2.5em"><span class="eq-dh">ΔH</span></span>';
  }
  function move(win, x) { win.style.transform = 'translate(' + x + 'px,0)'; }
})();`;

function selfTestTui() {
  let good = true;
  const say = (pass, label) => {
    console.log(`  ${pass ? 'ok    ' : 'BROKEN'} ${label}`);
    if (!pass) good = false;
  };
  const run = (js, tokens = TUI_FIXTURE_TOKENS) => auditTui(js, tokens, FIXTURE_TARGET);
  const has = (res, re) => res.fails.some((f) => re.test(f));
  // One more literal in the array, just before its close. Every case below is
  // the routed shape plus one change, so each failure is attributable to it.
  const plus = (literal) => TUI_ROUTED.replace("\n  ].join('');", `,\n    '${literal}'\n  ].join('');`);
  const swap = (a, b) => {
    if (!TUI_ROUTED.includes(a)) throw new Error(`self-test fixture has no ${JSON.stringify(a)}`);
    return TUI_ROUTED.replace(a, b);
  };

  const routed = run(TUI_ROUTED);
  say(routed.fails.length === 0 && routed.measured === 24 && routed.rules === 24,
    `the routed shape is clean in both themes (${routed.rules} rules, ${routed.measured} runs, ${routed.fails.length} failures: ${routed.fails.join(' | ') || 'none'})`);
  say(routed.grounds.dark.titlebar === '#0F1024' && routed.grounds.light.titlebar === '#FFFFFF' && routed.grounds.light.window === '#F4F6FB',
    `the titlebar's ink card is composited over the window (${routed.grounds.dark.titlebar}), the light card is white`);

  // The example the guard exists for.
  const cmd = run(swap("'.tui-cmd{color:var(--mint-fg,#45E0A8)", "'.tui-cmd{color:var(--mint,#45E0A8)"));
  say(cmd.fails.length === 1 && has(cmd, /^light: \.tui-cmd \{ color: var\(--mint,#45E0A8\) \} = #45E0A8 on the window #F4F6FB = 1\.56:1 .*read its twin, --mint -> --mint-fg$/),
    'reverting .tui-cmd to var(--mint,#45E0A8) fails in light only, on the window, naming --mint -> --mint-fg');

  // Every read twin in the fixture, reverted one at a time to its bare key colour.
  const twins = [...TUI_ROUTED.matchAll(/'(\.[^'{]*?)\{color:var\(--([a-z]+)-fg,/g)];
  let reverted = 0;
  for (const m of twins) {
    const at = m.index + m[0].length - `-fg,`.length;
    const res = run(TUI_ROUTED.slice(0, at) + TUI_ROUTED.slice(at + 3));
    const sel = m[1].replace(/\s+/g, ' ').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (res.fails.length === 1 && has(res, new RegExp(`^light: ${sel} \\{ color: var\\(--${m[2]},.*read its twin, --${m[2]} -> --${m[2]}-fg$`))) reverted++;
  }
  say(twins.length === 8 && reverted === twins.length,
    `each of the ${twins.length} read twins, reverted alone to its bare hue, fails exactly once, in light, with its selector and twin named (${reverted})`);

  // The shape tui.js shipped before #50: bare hues and aliases, stage names as inline styles.
  const BARE = TUI_ROUTED
    .replace("'.tui-state{color:var(--mint-fg,#45E0A8)}'", "'.tui-state{color:var(--state-pass,#45E0A8)}'")
    .replace('[data-done="1"]{color:var(--tangerine-fg,#FF9300)}', '[data-done="1"]{color:var(--series-6,#FF9300)}')
    .replace(/var\(--(mint|firetruck|aqua)-fg,/g, 'var(--$1,')
    .replace("    '.tui-s2{color:var(--violet-fg,#8B5CF6)}',\n    '.tui-s6{color:var(--tangerine-fg,#FF9300)}',\n", '')
    .replace("var tag = el('span', 'tui-name tui-s' + tok, label);", "var tag = el('span', 'tui-name', label);\n    tag.style.color = 'var(--series-' + tok + ')';");
  const bare = run(BARE);
  const bareContrast = bare.fails.filter((f) => /below the body target/.test(f));
  say(bareContrast.length === 6 && bareContrast.every((f) => f.startsWith('light:')),
    `the pre-#50 shape fails all 6 of its bare read colours in light, none in dark (${bareContrast.length})`);
  say(has(bare, /^light: \.tui-state \{ color: var\(--state-pass,#45E0A8\) \} = #45E0A8 on the titlebar #FFFFFF .*--state-pass -> --mint-fg$/)
    && has(bare, /^light: \.tui-state\[data-done="1"\] .*--series-6 -> --tangerine-fg$/),
    'a bare alias is told the twin of the hue it is bound to (--state-pass -> --mint-fg, --series-6 -> --tangerine-fg)');
  say(bare.fails.length === 7 && has(bare, /^tui\.js:\d+ sets \.style\.color from script/),
    `and its inline stage colour fails as a colour set outside the array (${bare.fails.length} in all)`);

  // Grounds are attributed, and composited.
  const barViolet = run(swap("'.tui-title{color:var(--fg-muted,#8D8CB0)}'", "'.tui-title{color:var(--violet-fg,#8B5CF6)}'"));
  say(barViolet.fails.length === 1 && has(barViolet, /^dark: \.tui-title .* on the titlebar #0F1024 = 4\.43:1/),
    'violet clears on the window and fails on the composited titlebar (4.43:1): the card is measured, not assumed to be --bg');
  const placed = run(plus('.tui-bar .tui-cmd{color:var(--violet-fg,#8B5CF6)}'));
  say(placed.fails.length === 1 && has(placed, /^dark: \.tui-bar \.tui-cmd .* on the titlebar/), 'a place in the selector outranks the class default (.tui-bar .tui-cmd sits on the bar)');
  const inherited = run(plus('[data-flexaidds-tui]{color:var(--violet-fg,#8B5CF6)}'));
  say(inherited.fails.length === 2 && has(inherited, /^dark: \[data-flexaidds-tui\] .* on the titlebar/) && has(inherited, /^dark: \[data-flexaidds-tui\] .* on the restore/),
    'a colour on the mount is held on every ground it reaches, and fails on the two cards, not the window');
  say(has(run(plus('.tui-new{color:var(--fg,#E4E3F5)}')), /^\.tui-new \{ color: .* has not placed/), 'a class with no known ground fails closed');
  say(has(run(plus('.tui-body{background:var(--bg-card,rgba(17,18,38,.82))}')), /^\.tui-body paints a ground/), 'a ground nothing is measured on fails closed');
  say(has(run(swap(';background:var(--bg-card,rgba(17,18,38,.82))}', '}')), /^\.tui-bar no longer paints its own background/), 'the titlebar losing its ground fails closed');
  say(has(run(plus('.tui-win.is-max{background:var(--bg-card,rgba(17,18,38,.82))}')), /^\.tui-win\.is-max paints a ground/), 'a second, state-scoped window ground fails closed');
  say(has(run(plus('.tui-meter{color:var(--fg,#E4E3F5)}')), /^\.tui-meter is a fill .* and also sets color/), 'a fill that carries text fails');

  // The JS around the array.
  say(has(run(TUI_ROUTED.replace(/var CSS = \[[\s\S]*?\]\.join\(''\);/, "var CSS = [\n  ].join('');")), /parsed no rules/), 'an empty CSS array fails');
  say(has(run(TUI_ROUTED.replace('var CSS = [', 'var STYLES = [')), /declares `var CSS = \[` 0 time/), 'a missing CSS array fails');
  say(has(run(swap("'.tui-t{color:var(--firetruck-fg,#F5232B)}',", "'.tui-t{color:' + T + '}',")), /the CSS array holds "\+ T \+/), 'a concatenation in the array fails, rather than reading around it');
  say(has(run(swap("'.tui-t{color:var(--firetruck-fg,#F5232B)}',", '".tui-t{color:var(--firetruck,#F5232B)}",')), /the CSS array holds "\\".tui-t/), 'a double-quoted literal in the array fails');
  say(has(run(swap("'.tui-t{color:var(--firetruck-fg,#F5232B)}',", "'.tui-t{c\\olor:var(--firetruck,#F5232B)}',")), /backslash escape/), 'a backslash escape in a CSS literal fails');
  say(has(run(swap("].join('');", "].join(' ');")), /not joined with \.join\(''\)/), 'a join other than the empty string fails');
  say(has(run(swap("win.style.transform", "win.style.color")), /sets \.style\.color from script/) && run(TUI_ROUTED).fails.length === 0,
    'an inline .style.color fails; an inline transform does not');
  say(has(run(swap('style="margin-left:2.5em"', 'style="margin-left:2.5em;color:var(--mint)"')), /inline style=".*" sets color/), 'an inline style="color:…" in markup fails; style="margin-left:…" does not');
  say(has(run(swap("s.textContent = CSS;", "s.textContent = CSS;\n    document.head.appendChild(document.createElement('style'));")), /creates 2 <style> element/), 'a second <style> element fails');
  say(has(run(swap("s.textContent = CSS;", "s.textContent = CSS; s.sheet.insertRule('.x{}');")), /uses insertRule/), 'insertRule fails');

  // At-rules, themes, tokens, compositing.
  const inMedia = run(plus('@media (max-width:520px){.tui-cmd{color:var(--mint,#45E0A8)}}'));
  say(inMedia.fails.length === 1 && has(inMedia, /^light: @media \(max-width:520px\) \.tui-cmd \{ color: var\(--mint,#45E0A8\) \}/), 'a colour inside an allowed @media is measured, and named with its condition');
  say(has(run(plus('@media (prefers-color-scheme: light){.tui-cmd{color:var(--mint,#45E0A8)}}')), /^@media \(prefers-color-scheme: light\) — a condition/), '@media on prefers-color-scheme fails closed');
  say(has(run(plus('@supports (display:grid){.tui-cmd{color:var(--mint,#45E0A8)}}')), /^@supports .* an at-rule this check cannot attribute/), 'an unknown at-rule fails closed');
  say(has(run(plus('@media (max-width:520px){@media (min-width:1px){.tui-cmd{color:var(--mint)}}}')), /nests/), 'a @media nested in a @media fails closed');
  say(has(run(plus('.tui-row{.tui-cmd{color:var(--mint)}}')), /nests a rule inside a rule/), 'CSS nesting fails closed');
  say(has(run(plus('[data-theme="light"] .tui-cmd{color:var(--mint-fg,#45E0A8)}')), /a theme-scoped selector/), 'a theme-scoped selector fails closed');
  say(has(run(plus(':is(.tui-bar,.tui-body) .tui-cmd{color:var(--violet-fg,#8B5CF6)}')), /uses a selector-list pseudo-class/), 'a selector-list pseudo-class fails closed, rather than being cut at its comma');
  say(has(run(plus('@keyframes glow{from{color:var(--mint)}to{color:var(--fg)}}')), /@keyframes glow animates color/), 'a keyframe that animates a colour fails');
  say(has(run(swap(';overflow-wrap:anywhere}', ';overflow-wrap:anywhere;animation:tuiblink 1s steps(1) infinite}')), /^\.tui-cmd runs an opacity animation and paints a glyph/), 'running the opacity blink on a glyph fails; on the transparent caret it does not');
  say(has(run(plus('.tui-dim{opacity:.8;color:var(--fg,#E4E3F5)}')), /^\.tui-dim sets opacity: \.8/), 'opacity on a rule fails closed');
  say(has(run(plus('[data-flexaidds-tui]{--mint-fg:var(--mint)}')), /redeclares --mint-fg/), 'a token redeclared in the array fails');
  say(has(run(plus('.tui-dim{color:var(--nope,#45E0A8)}')), /tokens\.css does not define --nope, so the browser paints the fallback #45E0A8 in both themes/), 'an undefined token fails, naming the fallback the browser would paint');
  say(has(run(swap("'.tui-cmd{color:var(--mint-fg,#45E0A8)", "'.tui-cmd{color:var(--mint-fg,#00805B)")), /fallback #00805B is not --mint-fg's ink value #45E0A8/), 'a fallback that is not its token\'s ink value fails');
  say(has(run(plus('.tui-dim{color:currentColor}')), /currentColor is not a token or a colour this can measure/), '`color: currentColor` fails closed');
  say(has(run(plus('.tui-dim{color:transparent;-webkit-background-clip:text}')), /^\.tui-dim clips its background to its text/), 'transparent text with a background clipped to it fails');

  if (!good) {
    console.log('\nself-test FAILED — the tui.js audit in section 5 cannot be trusted.');
    process.exit(2);
  }
}

console.log('── self-test · the elements.css audit can still fail');
selfTest();
console.log('\n── self-test · the tui.js audit can still fail');
selfTestTui();
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

// ── 5. every colour tui.js asks a person to read ────────────────────────────
// The audit and its reasoning are defined above, next to the self-test that
// proves it can still fail. Each text run is measured on the ground the DOM
// puts it on, so the grounds are printed: a ratio without its ground is not a
// measurement.
console.log(`\n── ${TUI} · every text colour vs the ground it sits on · body target ${BODY_TARGET}:1`);
{
  const { fails, oks, measured, selectors, rules, literals, grounds } = auditTui(readFileSync(join(ROOT, TUI), 'utf8'), blocks, BODY_TARGET);
  for (const [theme, g] of Object.entries(grounds)) {
    console.log(`  ${theme.padEnd(5)} grounds: window ${g.window ?? '—'} · titlebar ${g.titlebar ?? '—'} · restore ${g.restore ?? '—'} (page ${g.page ?? '—'})`);
  }
  for (const f of fails) bad(f);
  for (const o of oks) ok(o);
  console.log(`  ${literals} literal(s), ${rules} rule(s) read; ${measured} text run(s) measured across ${selectors} selector(s)`);
  if (measured === 0) {
    console.log('  FAIL  measured no read colour in tui.js — the reader has stopped matching.');
    console.log('        A check that silently matches nothing reports a clean pass it never made.');
    fail++;
  }
}

console.log('');
if (fail) {
  console.log(`contrast: ${fail} failure(s).`);
  console.log('A ratio is a (foreground, background) pair. Fix the colour, or fix the number —');
  console.log('never the comment alone. Re-solve with: node design-system/derive-light.mjs 4.5');
  console.log('A rule in elements.css or tui.js is fixed in the rule: read the --*-fg twin, not the bare hue.');
  process.exit(1);
}
console.log('contrast: every annotated ratio is true, every foreground token clears AA, and');
console.log('every colour elements.css and tui.js ask a person to read clears the body target');
console.log('in both themes, on the ground it sits on.');
