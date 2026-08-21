/**
 * @flexaidds/tokens — FlexAID∆S palette v2
 * Le Bonhomme Pharma · Montréal
 */

/** The seven key color names. Each is bound to a fixed role. */
export type KeyColorName =
  | 'mint'
  | 'violet'
  | 'tangerine'
  | 'firetruck'
  | 'aqua'
  | 'strawberry'
  | 'magnesium';

/** The thermodynamic quantities a key color may carry. */
export type Quantity = 'ΔH' | 'ΔS' | 'ΔG' | 'T' | 'ΔS_vib';

export interface KeyColor {
  /** Uppercase 6-digit hex, e.g. `#45E0A8`. */
  hex: string;
  /** The quantity this color means, or `null` for structural roles. */
  quantity: Quantity | null;
  /** Human-readable role, as written in the palette table. */
  role: string;
  /** WCAG 2.1 contrast ratio against the ink `#08091A`. */
  contrast: number;
  /** Smallest type size in px this color is cleared for. */
  minSize: number;
}

export interface Surfaces {
  bg: string;
  bgPanel: string;
  bgCard: string;
  bgAlt: string;
  fg: string;
  fgMuted: string;
}

export interface SeriesStep {
  hex: string;
  /** Short key for the point on the binding coordinate. */
  step: 'apo' | 'unbound' | 'pocket' | 'dSvib' | 'dH' | 'dG';
  label: string;
}

export interface TemperatureStop {
  hex: string;
  kelvin: number;
  /** Gradient position, 0–1. */
  stop: number;
  label: 'cryo' | 'cold' | 'ambient' | 'physiological' | 'denaturing';
}

export interface State {
  pass: string;
  warn: string;
  fail: string;
  /** Lifted red for small failure labels. */
  failText: string;
}

export interface Type {
  fontBody: string;
  fontMono: string;
  size: Record<
    'hero' | 'h1' | 'h2' | 'h3' | 'body' | 'sm' | 'xs' | 'tag' | 'meta',
    string
  >;
  tracking: Record<'tight' | 'flat' | 'wide' | 'label' | 'tag' | 'meta', string>;
  lineHeight: Record<'tight' | 'snug' | 'body' | 'code', number>;
}

export declare const surfaces: Surfaces;
export declare const keyColors: Record<KeyColorName, KeyColor>;
export declare const palette: Record<KeyColorName, string>;
export declare const legacyAliases: Record<'teal' | 'terra' | 'gold', string>;
export declare const state: State;

/** Ordered by energy along the binding coordinate, not by hue. */
export declare const series: SeriesStep[];
export declare const seriesRamp: string[];

export declare const temperature: TemperatureStop[];
export declare const temperatureGradient: string;

export declare const glow: Record<
  | 'mint'
  | 'mintSoft'
  | 'mintHard'
  | 'violet'
  | 'tangerine'
  | 'firetruck'
  | 'equation'
  | 'insetSheen',
  string
>;

export declare const type: Type;
export declare const radius: Record<'xs' | 'sm' | 'md' | 'lg' | 'pill', string>;
export declare const motion: Record<
  'easeOut' | 'easeInOut' | 'durFast' | 'durBase' | 'durSlow' | 'durBreathe' | 'durSpectrum',
  string
>;
export declare const grid: { line: string; step: string };

/** Hex → why it was retired. Never reintroduce one of these. */
export declare const retired: Record<string, string>;

declare const tokens: {
  surfaces: Surfaces;
  keyColors: Record<KeyColorName, KeyColor>;
  palette: Record<KeyColorName, string>;
  legacyAliases: Record<'teal' | 'terra' | 'gold', string>;
  state: State;
  series: SeriesStep[];
  seriesRamp: string[];
  temperature: TemperatureStop[];
  temperatureGradient: string;
  glow: Record<string, string>;
  type: Type;
  radius: Record<string, string>;
  motion: Record<string, string>;
  grid: { line: string; step: string };
  retired: Record<string, string>;
};

export default tokens;
