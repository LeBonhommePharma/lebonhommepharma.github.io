#!/usr/bin/env node
/**
 * design-system/derive-edge.mjs — the outline tier's contours, solved not typed.
 *
 * Companion to derive-light.mjs. That one solves the --*-fg tier: same hue,
 * lightness pushed until the pair clears the body target, so a readable colour
 * exists for the light ground. This one solves the --*-edge tier, which buys
 * legibility a different way — it keeps the identity hue at FULL chroma in the
 * glyph and puts a dark contour around it, so the edge the eye integrates is
 * glyph→contour instead of glyph→page.
 *
 * WHY THE CONTOUR IS NOT "THE SAME HUE, DARKER"
 * That is the obvious construction and it was tried first. It fails
 * asymmetrically. Solved to 10:1 against the light ground, the fill-to-contour
 * step comes out:
 *
 *     mint 6.50 · tangerine 4.88 · aqua 3.92 · strawberry 3.14
 *     firetruck 2.66 · violet 2.56
 *
 * Violet and firetruck are already low-lightness hues, so there is no room
 * beneath them for a same-hue contour that is also meaningfully darker — the
 * contour converges on the fill and the outline stops being an outline. A tier
 * that works for the bright half of the palette and not the dark half is not a
 * tier.
 *
 * So the contour is near-black carrying the key colour's HUE ANGLE: one shared
 * lightness for every stop, chroma capped by the marker and never above the
 * hue's own. Two consequences, both wanted:
 *   - every outlined mark gets the same contour weight, so a figure holding
 *     mint and violet reads as one treatment rather than seven;
 *   - a hue whose own chroma is below the cap (magnesium, C ≈ 0.006) gets a
 *     neutral contour, which is correct — it carries no hue to preserve.
 *
 * WHAT IS AND IS NOT CLAIMED
 * WCAG 2.x measures a single (foreground, background) pair and says nothing
 * about stroked text. The ratio this tier claims is contour-vs-page, which is
 * the boundary that makes the letterform discriminable. The fill ratio is NOT
 * claimed and the --*-fg tier remains the conformant token for body text. The
 * second annotated number, the fill-to-contour step, is reported so the tier
 * can be judged on whether the bright interior still reads as an interior; it
 * is held to 3:1, the non-text / large-text floor, not to a body target.
 *
 * MODES
 *   (no args)      report the solved contours and the two ratios each
 *   --write        rewrite the --*-edge declarations in the light block
 *   --check        exit non-zero if any declared value is not the solved one
 *   --self-test    prove --check catches a one-step edit
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { parseTokens, resolve, SOURCE } from './extract.mjs';
import { lch, fromLch, hexOf, inGamut, contrast, fmtRatio, ACHROMATIC_C } from './oklch.mjs';

const LIGHT = '[data-theme="light"]';
const HEX = /^#[0-9A-Fa-f]{6}$/;
const MINUS = '−';

// The fill-to-contour step is held to this. 3:1 is WCAG's floor for
// non-text content and large text, which is the right comparison: the
// question is whether two adjacent coloured regions are distinguishable,
// not whether small body text is readable.
const FILL_STEP_FLOOR = 3.0;

const die = (msg) => { console.log(`FATAL: ${msg}`); process.exit(1); };

// ── the marker ──────────────────────────────────────────────────────────────
// L and C live next to the values they produced, for the same reason
// derive-light.mjs keeps `fg-solve-target` there: a solved number whose
// parameters are only in the script is a number nobody can check against the
// file.
const MARKER_RE = /\/\*\s*edge-solve:\s*L\s*=\s*([0-9]*\.?[0-9]+)\s+C\s*=\s*([0-9]*\.?[0-9]+)\s*\*\//;
function readMarker(css) {
  const m = MARKER_RE.exec(css);
  if (!m) {
    die(
      'tokens.css has no `/* edge-solve: L=.. C=.. */` marker.\n' +
      '       The --*-edge values are solved at a lightness and a chroma cap;\n' +
      '       without those declared beside them nothing records what they are.'
    );
  }
  const L = Number(m[1]);
  const C = Number(m[2]);
  if (!(L > 0 && L < 1)) die(`edge-solve L must be in (0,1); got ${L}.`);
  if (!(C >= 0)) die(`edge-solve C must be >= 0; got ${C}.`);
  return { L, C };
}

// ── the contour ─────────────────────────────────────────────────────────────
// Hue is taken from the key colour and never moved. Chroma is the lesser of the
// marker cap and the hue's own, then clamped into sRGB at this lightness — a
// dark colour has less gamut to work with, so the clamp does real work.
function contour(hex, L, Ccap) {
  const base = lch(hex);
  let C = Math.min(Ccap, base.C);
  let rgb = fromLch({ L, C, h: base.h });
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(fromLch({ L, C: mid, h: base.h }))) lo = mid;
      else hi = mid;
    }
    C = lo;
    rgb = fromLch({ L, C, h: base.h });
  }
  return { hex: hexOf(rgb), L, C, h: base.h, baseC: base.C };
}

// ── the model ───────────────────────────────────────────────────────────────
function readModel() {
  const css = readFileSync(SOURCE, 'utf8');
  const blocks = parseTokens(css);
  const lightBg = resolve(blocks, LIGHT, '--bg');
  if (!HEX.test(String(lightBg))) {
    die(`light --bg did not resolve to a plain hex (got ${JSON.stringify(lightBg)}).`);
  }

  // DISCOVERED from :root, exactly as derive-light.mjs discovers its set, and
  // for the same reason: reading the set from the light block means deleting a
  // declaration there removes the token from the check instead of failing it.
  // Sharing the discovery rule also guarantees the two tiers cover the same
  // colours — an eighth key colour comes under both solvers or neither.
  const keys = Object.keys(blocks[':root'] || {})
    .filter((n) => n.endsWith('-fg') && n.length > 5)
    .map((n) => n.slice(0, -3))
    .filter((base) => HEX.test(String(resolve(blocks, ':root', base) ?? '')))
    .map((base) => [base.slice(2), resolve(blocks, ':root', base)]);
  if (!keys.length) die('no --x/--x-fg pairs found at :root in tokens.css — refusing to run.');

  const missing = keys.map(([n]) => `--${n}-edge`).filter((n) => !(blocks[LIGHT] || {})[n]);
  if (missing.length) {
    die(
      `the ${LIGHT} block is missing a declaration for: ${missing.join(', ')}\n` +
      '       Every key colour discovered at :root must declare its own contour\n' +
      '       here. A token that inherits the :root alias is transparent, which\n' +
      '       means no outline at all — silently, on the one ground that needs it.'
    );
  }

  return { css, blocks, lightBg, keys };
}

function solved() {
  const { css, blocks, lightBg, keys } = readModel();
  const { L, C } = readMarker(css);
  const rows = keys.map(([name, baseHex]) => {
    const c = contour(baseHex, L, C);
    const vsPage = contrast(c.hex, lightBg);
    const fillStep = contrast(baseHex, c.hex);
    return {
      name,
      base: baseHex,
      hex: c.hex,
      chroma: c.C,
      baseC: c.baseC,
      hueDeg: (((c.h * 180) / Math.PI) % 360 + 360) % 360,
      vsPage,
      fillStep,
      declared: String(blocks[LIGHT][`--${name}-edge`] ?? '').trim(),
    };
  });
  return { css, rows, lightBg, L, C };
}

function annotate(r) {
  const neutral = r.baseC < ACHROMATIC_C;
  const hue = neutral ? 'neutral' : `hue ${r.hueDeg.toFixed(1)}°`;
  return `${fmtRatio(r.vsPage).toFixed(2)}:1 on --bg · fill step ${fmtRatio(r.fillStep).toFixed(2)} · ${hue}`;
}

function render(css, rows) {
  const li = css.indexOf(LIGHT);
  if (li < 0) die(`tokens.css has no ${LIGHT} block.`);
  const head = css.slice(0, li);
  let body = css.slice(li);
  for (const r of rows) {
    const re = new RegExp(`^(\\s*--${r.name}-edge:\\s*)(#[0-9A-Fa-f]{6});[^\\n]*$`, 'm');
    if (!re.test(body)) die(`could not locate the --${r.name}-edge declaration in the ${LIGHT} block.`);
    body = body.replace(re, (_, lead) => `${lead}${r.hex};   /* ${annotate(r)} */`);
  }
  return head + body;
}

function report(rows, lightBg, L, C) {
  console.log(`── outline-tier contours · L=${L} C=${C} · ground ${lightBg}`);
  console.log('  name            contour   vs --bg   fill step   chroma');
  let worstPage = Infinity;
  let worstFill = Infinity;
  for (const r of rows) {
    worstPage = Math.min(worstPage, r.vsPage);
    worstFill = Math.min(worstFill, r.fillStep);
    const kept = r.baseC ? `${((r.chroma / r.baseC) * 100).toFixed(0)}%` : 'n/a';
    console.log(
      `  ${r.name.padEnd(14)} ${r.hex}   ` +
      `${String(fmtRatio(r.vsPage).toFixed(2)).padStart(6)}   ` +
      `${String(fmtRatio(r.fillStep).toFixed(2)).padStart(9)}   ${kept.padStart(6)}`
    );
  }
  console.log(`  worst contour-vs-page ${fmtRatio(worstPage).toFixed(2)}:1`);
  console.log(`  worst fill step       ${fmtRatio(worstFill).toFixed(2)}:1  (floor ${FILL_STEP_FLOOR})`);
  return { worstPage, worstFill };
}

// ── modes ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

if (has('--self-test')) {
  // A guard only ever observed passing is a guard that agrees with itself.
  // Move one channel of one contour by a single 8-bit step — the smallest edit
  // a bad paste can be — and --check must notice.
  const { css, rows } = solved();
  const clean = render(css, rows);
  let ok = true;
  const t = (name, got, want) => {
    const good = got === want;
    if (!good) ok = false;
    console.log(`  ${good ? 'ok  ' : 'FAIL'}  ${name}${good ? '' : ` (got ${got}, want ${want})`}`);
  };

  t('the marker is required', MARKER_RE.test(clean), true);

  // rendering is idempotent
  t('render is stable', render(clean, solved().rows) === clean, true);

  // one 8-bit step on the first contour must be detected
  const first = rows[0];
  const stepped = '#' + first.hex.slice(1).replace(/^(..)/, (p) => {
    const v = parseInt(p, 16);
    return (v === 255 ? v - 1 : v + 1).toString(16).padStart(2, '0').toUpperCase();
  });
  t('the stepped value differs', stepped.toUpperCase() !== first.hex.toUpperCase(), true);
  const mutated = clean.replace(
    new RegExp(`^(\\s*--${first.name}-edge:\\s*)#[0-9A-Fa-f]{6};`, 'm'),
    `$1${stepped};`
  );
  t('the mutation landed', mutated !== clean, true);
  const reRendered = render(mutated, rows);
  t('--check would reject the stepped value', reRendered !== mutated, true);

  // a contour whose cap exceeds its own chroma must not gain chroma
  const neutral = rows.find((r) => r.baseC < ACHROMATIC_C);
  if (neutral) t('a near-achromatic hue keeps a neutral contour', neutral.chroma <= neutral.baseC + 1e-9, true);

  console.log(ok ? 'derive-edge: self-test passed.' : 'derive-edge: SELF-TEST FAILED.');
  process.exit(ok ? 0 : 1);
}

const { css, rows, lightBg, L, C } = solved();

if (has('--write')) {
  const out = render(css, rows);
  writeFileSync(SOURCE, out);
  const w = report(rows, lightBg, L, C);
  if (w.worstFill < FILL_STEP_FLOOR) {
    console.log(`\nWARNING: worst fill step ${fmtRatio(w.worstFill)} is under the ${FILL_STEP_FLOOR}:1 floor.`);
    console.log('         Lower L in the marker and re-run, or the bright interior will not read.');
  }
  console.log('\nderive-edge: tokens.css written.');
  process.exit(0);
}

if (has('--check')) {
  const w = report(rows, lightBg, L, C);
  let fail = 0;
  for (const r of rows) {
    if (r.declared.toUpperCase() !== r.hex.toUpperCase()) {
      console.log(`  FAIL  --${r.name}-edge declares ${r.declared}, solves to ${r.hex}`);
      fail++;
    }
  }
  if (w.worstFill < FILL_STEP_FLOOR) {
    console.log(`  FAIL  worst fill step ${fmtRatio(w.worstFill)} is under the ${FILL_STEP_FLOOR}:1 floor`);
    fail++;
  }
  if (fail) {
    console.log(`\nderive-edge: ${fail} problem(s). Regenerate with --write, or move the marker.`);
    process.exit(1);
  }
  console.log(`\nderive-edge: all ${rows.length} contours in sync with the marker.`);
  process.exit(0);
}

report(rows, lightBg, L, C);
console.log('\n--write to apply, --check for CI, --self-test to prove the check can fail.');
