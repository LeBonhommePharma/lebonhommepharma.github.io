/**
 * design-system/oklch.mjs — one definition of colour maths for the whole system.
 *
 * WHY THIS IS A MODULE AND NOT COPIED INTO EACH TOOL
 * --------------------------------------------------
 * It was copied into each tool, and the copy in check-colorsets.mjs dropped the
 * /255 normalisation from the sRGB transfer function. OKLab then reported
 * L ≈ 72 and C ≈ 0.92 — values outside the space's range entirely — so every
 * hue angle was noise, magnesium stopped taking its achromatic path, and
 * white-on-black measured 10,498,937:1 instead of 21:1.
 *
 * The self-test caught it. It should not have had the chance: four copies of a
 * transfer function is four places to get it wrong. One definition, imported.
 *
 * The relight allowance below is deliberately identical to the one
 * `scripts/check-design-system.sh` defines and self-tests. Two definitions of
 * "same colour" in one repo is how a system stops being one.
 */

// ── sRGB ↔ OKLab ↔ OKLCH ────────────────────────────────────────────────────
const M = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
];
const N = [
  [0.2104542553, 0.793617785, -0.0040720468],
  [1.9779984951, -2.428592205, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.808675766],
];
const LMS_INV = [
  [1.0, 0.3963377774, 0.2158037573],
  [1.0, -0.1055613458, -0.0638541728],
  [1.0, -0.0894841775, -1.291485548],
];
const RGB_FROM_LMS = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.707614701],
];

/** 8-bit channel → linear light. The /255 is not optional; see the header. */
export const toLinear = (c8) => {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function rgbOf(hex) {
  const m = /^#?([0-9A-Fa-f]{6})$/.exec(String(hex).trim());
  if (!m) throw new Error(`not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
}

export const hexOf = (rgb01) =>
  '#' + rgb01.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();

/** hex → {L, C, h} in OKLCH. h is radians. */
export function lch(hex) {
  const lin = rgbOf(hex).map(toLinear);
  let lms = M.map((r) => r.reduce((a, v, i) => a + v * lin[i], 0));
  lms = lms.map((c) => Math.sign(c) * Math.abs(c) ** (1 / 3));
  const [L, a, b] = N.map((r) => r.reduce((acc, v, i) => acc + v * lms[i], 0));
  return { L, C: Math.hypot(a, b), h: Math.atan2(b, a) };
}

/** {L, C, h} → linear-clamped sRGB in 0..1 (may be out of gamut; check first). */
export function fromLch({ L, C, h }) {
  const lab = [L, C * Math.cos(h), C * Math.sin(h)];
  const lms = LMS_INV.map((r) => r.reduce((a, v, i) => a + v * lab[i], 0) ** 3);
  return RGB_FROM_LMS.map((r) => fromLinear(r.reduce((a, v, i) => a + v * lms[i], 0)));
}

export const inGamut = (rgb01) => rgb01.every((v) => v >= -0.0005 && v <= 1.0005);

// ── contrast ────────────────────────────────────────────────────────────────
export function luminance(hex) {
  const [r, g, b] = rgbOf(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Contrast ratio of a (foreground, background) PAIR. Never of a colour alone.
 *
 * Returns the RATIO AS MEASURED — unrounded. This is load-bearing, not a
 * style choice.
 *
 * This function used to `Math.round(r * 100) / 100` before returning, and
 * every threshold comparison in the system consumes its result. A ratio
 * rounded to 2 dp and then compared against 4.5 admits everything from
 * 4.495 upward, so a near-miss could never be caught: the guard rounded its
 * own measurement into agreement with its own threshold. Two colorsets
 * shipped through that hole, both reported as "4.5 / ok":
 *
 *     BrandFgMuted        #6B6A8D on #F3EFE7 = 4.497589   (AA body needs 4.5)
 *     BrandStateFailText  #C8373E on #F3EFE7 = 4.497018
 *
 * BrandFgMuted is the muted SMALL-TEXT token, which is exactly where the
 * threshold is doing work.
 *
 * The same rounded value was also read by solveRelight() below, so the solver
 * stopped searching as soon as a candidate rounded to the target — it was
 * solving for `round(r) >= 4.5`, not for `r >= 4.5`.
 *
 * Rule: compare at full precision, round only to print. Use `fmtRatio` at the
 * print site. Do not reintroduce rounding here, and do not add an epsilon to
 * the comparison — `>= 4.5` on the real number is the WCAG bar.
 */
export function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 2-dp form, for human reading only.
 *
 * Never feed this back into a threshold comparison — that is precisely the
 * bug the comment above describes.
 */
export const fmtRatio = (r) => (r === null || r === undefined ? r : Math.round(r * 100) / 100);

// ── the relight allowance ───────────────────────────────────────────────────
// Identical to scripts/check-design-system.sh. Hue is the identity of a
// quantity; lightness is the free parameter. Chroma may FALL freely — the sRGB
// gamut narrows as a colour darkens, so a real relighting sheds chroma — and
// may only RISE a little, because a more saturated value is the direction a
// different colour comes from.
export const HUE_TOL_DEG = 3.0;
export const CHROMA_GAIN_TOL = 0.05;
// Below this chroma a colour carries no hue: the angle is numerical noise, so
// reporting a hue SHIFT for it is reporting a difference between two noise
// values. Exported because derive-light.mjs needs exactly this rule when it
// annotates --magnesium-fg, and a second copy of the number is a second place
// for it to drift.
export const ACHROMATIC_C = 0.02; // magnesium carries no hue; its angle is noise

export function isRelighting(a, b) {
  const x = lch(a);
  const y = lch(b);
  const dh = Math.abs(((((y.h - x.h) * 180) / Math.PI + 180) % 360) - 180);
  const achromatic = x.C < ACHROMATIC_C && y.C < ACHROMATIC_C;
  const hueOk = achromatic || dh <= HUE_TOL_DEG;
  const chromaOk = y.C - x.C <= CHROMA_GAIN_TOL;
  const lightnessMoved = Math.abs(y.L - x.L) > 1e-6;
  return {
    ok: hueOk && chromaOk && lightnessMoved,
    dh: achromatic ? null : Math.round(dh * 100) / 100,
    dc: Math.round((y.C - x.C) * 1000) / 1000,
    dl: Math.round((y.L - x.L) * 1000) / 1000,
    hueOk,
    chromaOk,
    lightnessMoved,
    achromatic,
  };
}

/**
 * Relight `hex` against `ground` until the pair clears `target`, holding hue
 * and keeping as much chroma as the sRGB gamut allows at that lightness.
 *
 * Searches in the direction that actually gains contrast — darker against a
 * light ground, lighter against a dark one — rather than assuming either.
 * Returns null if the target is unreachable, which is reported, never rounded
 * away into a value that "looks close enough".
 */
export function solveRelight(hex, ground, target) {
  const base = lch(hex);
  if (contrast(hex, ground) >= target) return { hex, moved: false, chromaKept: 1 };

  const darken = luminance(ground) > luminance(hex) || contrast('#000000', ground) > contrast('#FFFFFF', ground);
  let lo = darken ? 0 : base.L;
  let hi = darken ? base.L : 1;
  let best = null;

  for (let i = 0; i < 48; i++) {
    const L = (lo + hi) / 2;
    let C = base.C;
    let rgb = fromLch({ L, C, h: base.h });
    if (!inGamut(rgb)) {
      let c0 = 0;
      let c1 = base.C;
      for (let j = 0; j < 30; j++) {
        const mid = (c0 + c1) / 2;
        if (inGamut(fromLch({ L, C: mid, h: base.h }))) c0 = mid;
        else c1 = mid;
      }
      C = c0;
      rgb = fromLch({ L, C, h: base.h });
    }
    const candidate = hexOf(rgb);
    if (contrast(candidate, ground) >= target) {
      // Keep the least extreme value that still passes, so the twin stays as
      // close to its counterpart as the target permits.
      best = { hex: candidate, L, C, moved: true, chromaKept: base.C ? C / base.C : 1 };
      if (darken) lo = L;
      else hi = L;
    } else if (darken) {
      hi = L;
    } else {
      lo = L;
    }
  }
  return best;
}
