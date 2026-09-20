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
import { contrast, lch, fromLch, inGamut, hexOf, fmtRatio } from './oklch.mjs';

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

// ── run ─────────────────────────────────────────────────────────────────────
const LIGHT_BG = '#f4f6fb';
const DARK_BG = '#08091A';
const TARGET = Number(process.argv[2] ?? 4.5);

const KEYS = {
  mint: '#45E0A8',
  violet: '#8B5CF6',
  tangerine: '#FF9300',
  firetruck: '#F5232B',
  aqua: '#00A2FF',
  strawberry: '#FF2F92',
  magnesium: '#DCDCE4',
};

console.log(`Light-theme key colours — hue held, lightness solved for ${TARGET}:1 on ${LIGHT_BG}\n`);
console.log('name        dark       on ink   →  light      on light   Δhue    chroma kept');
console.log('─'.repeat(78));
for (const [name, hex] of Object.entries(KEYS)) {
  const s = solve(hex, LIGHT_BG, TARGET);
  if (!s) {
    console.log(`${name.padEnd(11)} ${hex}  ${String(round2(ratio(hex, DARK_BG))).padStart(6)}   →  unreachable at ${TARGET}:1`);
    continue;
  }
  const dh = (((toOklch(s.hex).h - toOklch(hex).h) * 180) / Math.PI + 540) % 360 - 180;
  console.log(
    `${name.padEnd(11)} ${hex}  ${String(round2(ratio(hex, DARK_BG))).padStart(6)}   →  ${s.hex}  ${String(round2(ratio(s.hex, LIGHT_BG))).padStart(6)}    ${dh.toFixed(2).padStart(6)}°   ${(s.chromaKept * 100).toFixed(0)}%`
  );
}
console.log(
  '\nΔhue is the perceived hue shift in OKLCH — it must stay ~0, which is the\n' +
    'whole reason this is not done in HSL. Chroma below 100% means sRGB had no\n' +
    'room for the original chroma at that lightness.'
);
