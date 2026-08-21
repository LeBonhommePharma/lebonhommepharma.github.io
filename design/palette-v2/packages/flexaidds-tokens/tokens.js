/**
 * @flexaidds/tokens — FlexAID∆S palette v2
 * Le Bonhomme Pharma · Montréal
 *
 * The same values as `tokens.css`, for consumers that need them in
 * JavaScript — chart libraries, canvas/WebGL renderers, PyMOL colour
 * export, anything that can't read a CSS custom property.
 *
 * The seven key colors are bound to thermodynamic quantities. That
 * binding is the system: never reassign a key color to a different
 * quantity, and never introduce an eighth "brand" hue — it would
 * muddy the reading of ΔG = ΔH − TΔS − TΔS_vib.
 */

/** Page and panel surfaces. Indigo ink, never navy. */
export const surfaces = {
  bg: '#08091A',
  bgPanel: 'rgba(17, 18, 38, 0.92)',
  bgCard: 'rgba(17, 18, 38, 0.82)',
  bgAlt: 'rgba(12, 13, 30, 0.55)',
  fg: '#E4E3F5',
  fgMuted: '#8D8CB0',
};

/**
 * The seven key colors. `contrast` is the WCAG 2.1 ratio against the
 * ink (#08091A); `minSize` is the smallest type size the color is
 * cleared for, in px, where the ratio leaves no headroom.
 */
export const keyColors = {
  mint: {
    hex: '#45E0A8',
    quantity: 'ΔH',
    role: 'enthalpy · brand primary',
    contrast: 11.73,
    minSize: 10,
  },
  violet: {
    hex: '#8B5CF6',
    quantity: 'ΔS',
    role: 'configurational entropy',
    contrast: 4.66,
    minSize: 10,
  },
  tangerine: {
    hex: '#FF9300',
    quantity: 'ΔG',
    role: 'free energy · stats',
    contrast: 8.86,
    minSize: 10,
  },
  firetruck: {
    hex: '#F5232B',
    quantity: 'T',
    role: 'temperature · hot anchor',
    contrast: 4.85,
    minSize: 12,
  },
  aqua: {
    hex: '#00A2FF',
    quantity: 'ΔS_vib',
    role: 'vibrational entropy · tENCoM',
    contrast: 7.15,
    minSize: 10,
  },
  strawberry: {
    hex: '#FF2F92',
    quantity: null,
    role: 'receptor · pocket · section eyebrows',
    contrast: 5.71,
    minSize: 10,
  },
  magnesium: {
    hex: '#DCDCE4',
    quantity: null,
    role: 'baseline · apo · reference line',
    contrast: 14.47,
    minSize: 10,
  },
};

/** Flat name → hex, for the common case. */
export const palette = Object.fromEntries(
  Object.entries(keyColors).map(([name, c]) => [name, c.hex]),
);

/** v1 names, so older code keeps resolving. */
export const legacyAliases = {
  teal: palette.mint,        // was #22D3EE · ΔH
  terra: palette.violet,     // was #8B1A4A · TΔS
  gold: palette.tangerine,   // was #FBBF24 · ΔG
};

/**
 * State. Severity reads by brightness, never by yellow: magenta
 * means caution, pure red means stop. `failText` is a lifted red for
 * small labels, where firetruck itself is too tight on contrast.
 */
export const state = {
  pass: palette.mint,
  warn: palette.strawberry,
  fail: palette.firetruck,
  failText: '#FF6B6B',
};

/**
 * Series ramp, ordered by ENERGY along the binding coordinate — not
 * by hue and not by wavelength. Position in a legend therefore means
 * something thermodynamic, and a series reads as a reaction path.
 * Firetruck is deliberately absent: it is a scalar and a failure
 * signal, never a data class. Six steps is the ceiling.
 */
export const series = [
  { hex: palette.magnesium, step: 'apo', label: 'apo baseline' },
  { hex: palette.violet, step: 'unbound', label: 'unbound · ΔS dominates' },
  { hex: palette.strawberry, step: 'pocket', label: 'first pocket contact' },
  { hex: palette.aqua, step: 'dSvib', label: 'rigidification · ΔS_vib' },
  { hex: palette.mint, step: 'dH', label: 'contacts formed · ΔH' },
  { hex: palette.tangerine, step: 'dG', label: 'converged · ΔG' },
];

/** Just the hexes, in energy order — what a chart library wants. */
export const seriesRamp = series.map((s) => s.hex);

/**
 * Temperature: a diverging cool→hot ramp matching the B-factor
 * convention PyMOL and Chimera use for the crystallographic
 * temperature factor, so it needs no legend for a crystallographer.
 * The equation's hues stay out of it — violet, mint and tangerine
 * mean ΔS, ΔH and ΔG, and cannot also mean a temperature.
 */
export const temperature = [
  { hex: palette.aqua, kelvin: 77, stop: 0.0, label: 'cryo' },
  { hex: '#7FD0FF', kelvin: 200, stop: 0.24, label: 'cold' },
  { hex: palette.magnesium, kelvin: 298, stop: 0.5, label: 'ambient' },
  { hex: '#FF7A5C', kelvin: 310, stop: 0.76, label: 'physiological' },
  { hex: palette.firetruck, kelvin: 350, stop: 1.0, label: 'denaturing' },
];

/** The temperature ramp as a ready CSS gradient. */
export const temperatureGradient = `linear-gradient(90deg, ${temperature
  .map((t) => `${t.hex} ${(t.stop * 100).toFixed(0)}%`)
  .join(', ')})`;

/** Colored glow. The brand never uses a neutral drop shadow. */
export const glow = {
  mint: '0 0 20px rgba(69, 224, 168, 0.25)',
  mintSoft: '0 0 18px rgba(69, 224, 168, 0.30)',
  mintHard: '0 0 24px rgba(69, 224, 168, 0.50)',
  violet: '0 0 20px rgba(139, 92, 246, 0.40)',
  tangerine: '0 0 20px rgba(255, 147, 0, 0.25)',
  firetruck: '0 0 22px rgba(245, 35, 43, 0.16)',
  equation: '0 0 40px rgba(69, 224, 168, 0.35), 0 0 60px rgba(255, 147, 0, 0.18)',
  insetSheen: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
};

/** Type. Mono carries headings and every number; the sans is prose only. */
export const type = {
  fontBody:
    "'SF Pro Display', 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
  fontMono: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  size: {
    hero: '7rem',
    h1: '3.5rem',
    h2: '1.75rem',
    h3: '1.125rem',
    body: '1rem',
    sm: '0.875rem',
    xs: '0.75rem',
    tag: '0.625rem',
    meta: '0.5rem',
  },
  tracking: {
    tight: '-0.02em',
    flat: '0',
    wide: '0.08em',
    label: '0.15em',
    tag: '0.20em',
    meta: '0.30em',
  },
  lineHeight: { tight: 1.05, snug: 1.15, body: 1.6, code: 1.8 },
};

export const radius = {
  xs: '3px',
  sm: '6px',
  md: '8px',
  lg: '12px',
  pill: '9999px',
};

export const motion = {
  easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
  easeInOut: 'ease-in-out',
  durFast: '0.18s',
  durBase: '0.25s',
  durSlow: '0.7s',
  durBreathe: '4s',
  durSpectrum: '8.5s',
};

export const grid = { line: 'rgba(139, 92, 246, 0.05)', step: '40px' };

/**
 * Colors retired in v2. Kept so a linter or a migration script can
 * flag them; never reintroduce one.
 */
export const retired = {
  '#FBBF24': 'gold — replaced by tangerine for ΔG',
  '#FDE68A': 'pale gold — any yellow is out',
  '#22D3EE': 'cyan — replaced by mint for ΔH',
  '#C2456F': 'salmon — too little chroma, read as pink',
  '#DA2F63': 'wine — superseded by strawberry',
  '#6E7C99': 'steel — superseded by magnesium',
  '#FF2600': 'maraschino — orange cast, replaced by firetruck',
  '#FFFFFF': 'snow — too aggressive as a baseline, replaced by magnesium',
};

export default {
  surfaces,
  keyColors,
  palette,
  legacyAliases,
  state,
  series,
  seriesRamp,
  temperature,
  temperatureGradient,
  glow,
  type,
  radius,
  motion,
  grid,
  retired,
};
