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

// ── sRGB ↔ OKLab ↔ OKLCH ────────────────────────────────────────────────────
const f = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const g = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function hexToRgb(hex) {
  const m = /^#?([0-9A-Fa-f]{6})$/.exec(hex.trim());
  if (!m) throw new Error(`not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
}
const rgbToHex = (rgb) =>
  '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();

function rgbToOklab([r, gg, b]) {
  const R = f(r), G = f(gg), B = f(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    g(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    g(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
const toOklch = (hex) => {
  const [L, a, b] = rgbToOklab(hexToRgb(hex));
  return { L, C: Math.hypot(a, b), h: Math.atan2(b, a) };
};
const fromOklch = ({ L, C, h }) => oklabToRgb([L, C * Math.cos(h), C * Math.sin(h)]);
const inGamut = (rgb) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);

// ── contrast ────────────────────────────────────────────────────────────────
const lum = (hex) => {
  const [r, gg, b] = hexToRgb(hex);
  return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
  return (hi + 0.05) / (lo + 0.05);
};
const round2 = (n) => Math.round(n * 100) / 100;

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
