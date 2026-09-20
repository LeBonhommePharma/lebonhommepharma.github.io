#!/usr/bin/env node
/**
 * design-system/derive-light.mjs — light-theme key colours, solved not guessed.
 *
 * THE PROBLEM
 * -----------
 * tokens.css states that the seven key colours "do not change with the theme,
 * so a chart or an equation reads the same in either mode". That is a good
 * instinct about identity and a WCAG failure about contrast, because contrast
 * is a (foreground, background) PAIR and only one half of the pair was moving.
 *
 * Measured on the shipped light ground (#f4f6fb):
 *
 *     magnesium  1.26:1     mint  1.56:1     tangerine  2.06:1     aqua  2.55:1
 *
 * Four of seven below 3:1 — below the floor for non-text, let alone body text.
 * In light mode the brand primary is very nearly invisible.
 *
 * THE FIX, FROM THE SYSTEM'S OWN RULE
 * -----------------------------------
 * "Hue and chroma carry identity; lightness is free."
 *
 * So hold hue and chroma, and move lightness only, until the pair clears the
 * target. Done in OKLCH because that is the space where holding H and C
 * actually preserves what a person recognises as "the mint one" — doing it in
 * HSL would swing the perceived hue as lightness drops.
 *
 * Chroma is reduced ONLY when a colour at the required lightness falls outside
 * the sRGB gamut, and the amount given up is reported rather than hidden.
 *
 * This file computes. It does not write tokens.css — the values it prints are
 * pasted in by a human with the measured ratio beside them, and
 * check-contrast.mjs then holds them to it forever.
 */

// ── colour maths ────────────────────────────────────────────────────────────
// Imported, not restated. This file used to carry its own copy of the sRGB
// transfer function, the OKLab matrices and the contrast formula — one of
// four copies in the repo. oklch.mjs's header records what the last duplicate
// cost (a dropped /255; white on black measured 10,498,937:1), and a second
// copy in check-contrast.mjs was found carrying the rounded comparison that
// let two colorsets ship below AA. One definition, imported.
//
// Equivalence was measured before the copy was removed, not assumed: on
// 30,047 inputs this file's maths and oklch.mjs agreed bit-for-bit on
// contrast across three grounds, and to within 1.3e-12° on hue for every
// chromatic input. Zero verdict changes. (The old copy used Math.cbrt where
// oklch.mjs uses sign·|x|^(1/3); that is the whole of the difference, and it
// lives ~14 orders of magnitude below the 3° tolerance.)
//
// The aliases below keep solve() and the report block reading as they did.
import { contrast, lch, fromLch, inGamut, hexOf, fmtRatio, ACHROMATIC_C } from './oklch.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseTokens, resolve, SOURCE } from './extract.mjs';

const toOklch = lch;
const fromOklch = fromLch;
const rgbToHex = hexOf;
const ratio = contrast;   // UNROUNDED — see oklch.mjs. round2 is for printing.
const round2 = fmtRatio;

/**
 * Darken `hex` in OKLCH — hue fixed, chroma held as high as the gamut allows —
 * until it clears `target` against `bg`. Binary search on L.
 */
function solve(hex, bg, target) {
  const base = toOklch(hex);
  if (ratio(hex, bg) >= target) return { hex, ...base, chromaKept: 1, moved: false };

  let lo = 0, hi = base.L, best = null;
  for (let i = 0; i < 40; i++) {
    const L = (lo + hi) / 2;
    // Hold chroma; if that L/C/h is outside sRGB, give up the least chroma
    // that brings it back. Chroma loss is reported, never silent.
    let C = base.C, rgb = fromOklch({ L, C, h: base.h });
    let lo2 = 0, hi2 = base.C;
    if (!inGamut(rgb)) {
      for (let j = 0; j < 30; j++) {
        C = (lo2 + hi2) / 2;
        if (inGamut(fromOklch({ L, C, h: base.h }))) lo2 = C;
        else hi2 = C;
      }
      C = lo2;
      rgb = fromOklch({ L, C, h: base.h });
    }
    const candidate = rgbToHex(rgb);
    if (ratio(candidate, bg) >= target) {
      best = { hex: candidate, L, C, h: base.h, chromaKept: C / base.C, moved: true };
      lo = L; // keep as light as possible while still passing
    } else {
      hi = L;
    }
    if (ratio(candidate, bg) >= target) lo = L; else hi = L;
  }
  return best;
}

// ── the inputs, read from tokens.css ────────────────────────────────────────
// This file used to hardcode both grounds and all seven key hexes -- nine
// values that already lived in tokens.css, restated here where nothing
// compared them. That is the same duplication the colour maths had, with a
// worse failure mode: the maths was at least executed, so a divergence would
// eventually surface as behaviour. A stale hex here would surface as nothing
// at all. It would simply solve the wrong colour and print a confident answer.
//
// They agreed when this was written -- all nine checked, zero divergences --
// which is exactly when duplication is cheapest to remove and hardest to
// argue about.
const LIGHT = '[data-theme="light"]';

function readModel() {
  const css = readFileSync(SOURCE, 'utf8');
  const blocks = parseTokens(css);
  const lightBg = resolve(blocks, LIGHT, '--bg');
  const darkBg = resolve(blocks, ':root', '--bg');
  for (const [name, v] of [['light --bg', lightBg], ['dark --bg', darkBg]]) {
    if (!HEX.test(String(v))) {
      die(`${name} did not resolve to a plain hex in tokens.css (got ${JSON.stringify(v)}).`);
    }
  }

  // The seven are DISCOVERED, not listed: a --x-fg declared in the light block
  // whose --x resolves to a plain hex at :root. --fg is in that block too and
  // is correctly excluded -- it has no base hue, it is the body text colour.
  // Adding an eighth key colour to tokens.css brings it under this solver
  // automatically; there is no list here to forget to update.
  // THE SET IS READ FROM :root, NOT FROM THE LIGHT BLOCK, and that is the whole
  // difference between a check and a check that agrees with the file.
  //
  // The first version of this discovered the set from the light block. Deleting
  // a --x-fg declaration there therefore removed it from the set, so the token
  // stopped being CHECKED instead of failing the check. Six of the seven were
  // dropped during a merge and this reported "all 1 in sync", exit 0, while
  // --mint-fg fell back to its :root alias var(--mint) = #45E0A8 = 1.56:1 on
  // the light ground. A live contrast regression, reported green.
  //
  // :root declares --x-fg: var(--x) for every key colour. That set does not
  // shrink when the light block does.
  const keys = Object.keys(blocks[':root'] || {})
    .filter((n) => n.endsWith('-fg') && n.length > 5)
    .map((n) => n.slice(0, -3))
    .filter((base) => HEX.test(String(resolve(blocks, ':root', base) ?? '')))
    .map((base) => [base.slice(2), resolve(blocks, ':root', base)]);
  if (!keys.length) die('no --x/--x-fg pairs found at :root in tokens.css — refusing to run.');

  // Every discovered key MUST have its own declaration in the light block. A
  // token that merely inherits the :root alias is not in sync, it is unsolved.
  const missing = keys.map(([n]) => `--${n}-fg`).filter((n) => !(blocks[LIGHT] || {})[n]);
  if (missing.length) {
    die(
      `the ${LIGHT} block has no declaration for: ${missing.join(', ')}.\n` +
        '       They inherit the :root alias var(--x), which is the DARK identity hue and\n' +
        '       is nowhere near readable on the light ground. A missing override is a\n' +
        '       failure, not an exemption.'
    );
  }

  return { css, blocks, lightBg, darkBg, keys };
}

const HEX = /^#[0-9A-Fa-f]{6}$/;
const die = (msg) => {
  console.error(`FATAL: ${msg}`);
  console.error('       Refusing to run — a guess here would be published as a measurement.');
  process.exit(2);
};

// The target is declared in tokens.css beside the values it produced, so the
// file carries its own provenance and this script cannot be run against a
// number nobody wrote down. Fail closed when it is missing: defaulting would
// let a check pass against a target that is not the one in force.
const TARGET_RE = /\/\*\s*fg-solve-target:\s*([0-9]+(?:\.[0-9]+)?)\s*\*\//;
function readTarget(css) {
  const m = TARGET_RE.exec(css);
  if (!m) {
    die(
      'tokens.css has no `/* fg-solve-target: N */` marker.\n' +
        '       The seven --*-fg light values are solved against a target; without it\n' +
        '       declared next to them, nothing records which target they are solved at.'
    );
  }
  return Number(m[1]);
}

// ── the seven solved values ─────────────────────────────────────────────────
function solved(target) {
  const { css, lightBg, darkBg, keys } = readModel();
  const out = [];
  for (const [name, hex] of keys) {
    const s = solve(hex, lightBg, target);
    if (!s) {
      die(`--${name}-fg is unreachable at ${target}:1 on ${lightBg} — the solver found no in-gamut lightness.`);
    }
    const dh = (((toOklch(s.hex).h - toOklch(hex).h) * 180) / Math.PI + 540) % 360 - 180;
    out.push({ name, base: hex, hex: s.hex, ratio: contrast(s.hex, lightBg),
               darkRatio: contrast(hex, darkBg), dh, chromaKept: s.chromaKept });
  }
  return { css, lightBg, darkBg, rows: out };
}

// The annotation is regenerated with the value, not carried over. It states
// the measured ratio, so a hand-edited hex with a stale comment cannot slip
// through looking annotated. check-contrast.mjs reads these back.
const MINUS = '−';
function annotate(r) {
  const ratio = fmtRatio(r.ratio).toFixed(2);
  const chroma = `chroma ${String(Math.round(r.chromaKept * 100)).padStart(3)}%`;
  // A hue SHIFT is only a quantity if the colour has a hue. --magnesium is a
  // near-grey (C = 0.011, under oklch.mjs's ACHROMATIC_C), so its angle is
  // noise and the difference between two noise values is not a measurement.
  // An earlier draft of this function keyed off a small |dh| instead and duly
  // annotated magnesium with a 5.56° hue shift -- a confident number about
  // nothing. Key off chroma, which is the property that decides whether a hue
  // exists at all.
  if (lch(r.base).C < ACHROMATIC_C) return `${ratio}:1 · ${chroma}`;
  const sign = r.dh < 0 ? MINUS : '+';
  return `${ratio}:1 · hue ${sign}${Math.abs(r.dh).toFixed(2)}° · ${chroma}`;
}

// Rewrite in place, matching the existing declaration exactly and preserving
// its column alignment. Only the light block is touched: the :root copies are
// `var(--x)` aliases and must stay aliases.
function render(css, rows) {
  const li = css.indexOf(LIGHT);
  if (li < 0) die(`tokens.css has no ${LIGHT} block.`);
  let head = css.slice(0, li);
  let body = css.slice(li);
  for (const r of rows) {
    const re = new RegExp(`^(\\s*--${r.name}-fg:\\s*)(#[0-9A-Fa-f]{6});[^\\n]*$`, 'm');
    if (!re.test(body)) die(`could not locate the --${r.name}-fg declaration in the ${LIGHT} block.`);
    body = body.replace(re, (_, lead) => `${lead}${r.hex};   /* ${annotate(r)} */`);
  }
  return head + body;
}

// ── modes ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

if (has('--self-test')) {
  // Prove the check catches a desynchronised value rather than agreeing with
  // whatever is in the file. One channel of one token is moved by a single
  // 8-bit step -- the smallest edit a bad paste can be -- and the check must
  // notice. A guard only ever observed passing is a guard that agrees with
  // itself.
  const { css, rows } = solved(readTarget(readFileSync(SOURCE, 'utf8')));
  const clean = render(css, rows);
  let ok = true;
  const t = (name, got, want) => {
    const good = got === want;
    ok = ok && good;
    console.log(`  ${good ? 'ok  ' : 'FAIL'}   ${name}`);
    if (!good) console.log(`         got ${got}, want ${want}`);
  };
  t('a freshly rendered file is in sync with itself', diff(clean, rows).length, 0);
  const victim = rows[0];
  const bumped = victim.hex.slice(0, 5) + (victim.hex[5] === '0' ? '1' : '0') + victim.hex.slice(6);
  const dirty = clean.replace(victim.hex, bumped);
  t('one channel moved by one step is detected', diff(dirty, rows).length, 1);
  t('  …and the detected token is the one that moved', diff(dirty, rows)[0]?.name, victim.name);
  t('the target marker is required', TARGET_RE.test(clean), true);

  // Deleting a light-block declaration must FAIL, not shrink the set. This case
  // exists because the first version of readModel() discovered the set from the
  // light block and so reported exit 0 with six of seven tokens missing.
  const gutted = clean.replace(/\n  --mint-fg:\s*#[0-9A-Fa-f]{6};[^\n]*/, '');
  t('a deleted light declaration is a failure, not an exemption',
    (() => { try { readModelFrom(gutted); return 'no error'; } catch (e) { return e.message; } })(),
    'MISSING --mint-fg');
  if (!ok) { console.log('\nself-test FAILED'); process.exit(1); }
  console.log('\nself-test passed: the check fails on a one-step desync and names the token.');
  process.exit(0);
}

// The missing-declaration rule, as a throwing function so the self-test can
// exercise it without the process exiting.
function readModelFrom(css) {
  const blocks = parseTokens(css);
  const keys = Object.keys(blocks[':root'] || {})
    .filter((n) => n.endsWith('-fg') && n.length > 5)
    .filter((n) => HEX.test(String(resolve(blocks, ':root', n.slice(0, -3)) ?? '')));
  const missing = keys.filter((n) => !(blocks[LIGHT] || {})[n]);
  if (missing.length) throw new Error(`MISSING ${missing.join(', ')}`);
  return keys;
}

function diff(css, rows) {
  const blocks = parseTokens(css);
  const out = [];
  for (const r of rows) {
    const cur = resolve(blocks, LIGHT, `--${r.name}-fg`);
    if (String(cur).toLowerCase() !== r.hex.toLowerCase()) {
      out.push({ name: r.name, found: cur, want: r.hex });
    }
  }
  return out;
}

const target = readTarget(readFileSync(SOURCE, 'utf8'));
const { css, lightBg, darkBg, rows } = solved(target);

if (has('--write')) {
  const next = render(css, rows);
  if (next === css) {
    console.log(`tokens.css already matches the solver at ${target}:1 — nothing to write.`);
    process.exit(0);
  }
  writeFileSync(SOURCE, next, 'utf8');
  console.log(`tokens.css: wrote ${rows.length} --*-fg light values solved at ${target}:1 on ${lightBg}.`);
  console.log('Regenerate the downstream artifacts:  node design-system/emit.mjs');
  process.exit(0);
}

if (has('--check')) {
  const stale = diff(css, rows);
  if (stale.length) {
    console.error(`tokens.css is out of sync with the solver at ${target}:1 on ${lightBg}:\n`);
    for (const s of stale) {
      console.error(`    --${s.name}-fg is ${s.found}, solver produces ${s.want}`);
    }
    console.error(
      '\nThese seven values are SOLVED, not chosen. They used to be transcribed by\n' +
        'hand from this script’s stdout, so a typo, a partial paste, or a paste that\n' +
        'never happened would have shipped silently.\n' +
        '\nFix: do not edit them by hand. Run\n' +
        '    node design-system/derive-light.mjs --write && node design-system/emit.mjs\n' +
        'and commit the result.\n' +
        '\nIf the values are deliberate and the TARGET changed, update the\n' +
        '`/* fg-solve-target: N */` marker in tokens.css in the same commit.'
    );
    process.exit(1);
  }
  console.log(`tokens.css matches the solver at ${target}:1 on ${lightBg} — all ${rows.length} in sync.`);
  process.exit(0);
}

// ── report (default) ────────────────────────────────────────────────────────
console.log(`Light-theme key colours — hue held, lightness solved for ${target}:1 on ${lightBg}\n`);
console.log('name        dark       on ink   →  light      on light   Δhue    chroma kept');
console.log('─'.repeat(78));
for (const r of rows) {
  console.log(
    `${r.name.padEnd(11)} ${r.base}  ${String(fmtRatio(r.darkRatio)).padStart(6)}   →  ${r.hex}  ${String(fmtRatio(r.ratio)).padStart(6)}    ${r.dh.toFixed(2).padStart(6)}°   ${(r.chromaKept * 100).toFixed(0)}%`
  );
}
console.log(
  '\nΔhue is the perceived hue shift in OKLCH — it must stay ~0, which is the\n' +
    'whole reason this is not done in HSL. Chroma below 100% means sRGB had no\n' +
    'room for the original chroma at that lightness.\n' +
    '\nThis prints. It does not publish. `--write` puts these into tokens.css;\n' +
    '`--check` fails if tokens.css has drifted from them.'
);
