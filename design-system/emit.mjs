#!/usr/bin/env node
/**
 * design-system/emit.mjs — derive every per-target artifact from tokens.css.
 *
 * `tokens.css` is authored. Everything here is generated from it, so a colour
 * can only enter the system in one place. The two copies of `tokens.css` in
 * this repo had already drifted before this existed — the root one grew the
 * light theme and the packaged one did not — which is exactly the failure a
 * "one source of truth" is supposed to make impossible.
 *
 * Targets:
 *   design/palette-v2/packages/flexaidds-tokens/tokens.css   the site package
 *   design-system/dist/tokens.json                           JSON consumers
 *   design-system/dist/tokens.js / .d.ts                     JS/TS consumers
 *   design-system/dist/BrandColor.swift                      NATURaL (Apple)
 *   design-system/dist/ExergyTheme.swift                     Exergy (Apple)
 *   design-system/dist/BrandColors.xcassets/                 Xcode asset catalog
 *
 * Usage:
 *   emit.mjs            write the artifacts
 *   emit.mjs --check    verify on-disk artifacts match the source; exit 1 if not
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseTokens, resolve, ROOT, SOURCE } from './extract.mjs';

const CHECK = process.argv.includes('--check');
const DIST = join(ROOT, 'design-system', 'dist');
const PACKAGE_CSS = join(ROOT, 'design', 'palette-v2', 'packages', 'flexaidds-tokens', 'tokens.css');

const css = readFileSync(SOURCE, 'utf8');
const blocks = parseTokens(css);
const LIGHT = '[data-theme="light"]';

const val = (name, sel = ':root') => resolve(blocks, sel, name);
const camel = (n) => n.replace(/^--/, '').replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

// ── contrast, computed rather than transcribed ──────────────────────────────
// The ratios annotated in tokens.css are the design system's load-bearing
// claim. They are recomputed here from the WCAG 2.1 relative-luminance formula
// so the emitted artifacts carry a measured number, and so a hue edited without
// re-measuring is caught by --check rather than shipping a stale figure.
function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance(hex) {
  const m = /^#([0-9A-Fa-f]{6})$/.exec(hex.trim());
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}
/** Contrast ratio of a (foreground, background) PAIR. Never of a colour alone. */
export function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  if (a === null || b === null) return null;
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

// ── the model ───────────────────────────────────────────────────────────────
const KEY_COLORS = ['mint', 'violet', 'tangerine', 'firetruck', 'aqua', 'strawberry', 'magnesium'];

const inkDark = val('--bg');
const inkLight = val('--bg', LIGHT);

const keyColors = {};
for (const name of KEY_COLORS) {
  const hex = val(`--${name}`);
  if (!hex) throw new Error(`key colour --${name} is not defined in tokens.css`);
  keyColors[name] = {
    hex,
    contrastOnDark: contrast(hex, inkDark),
    contrastOnLight: contrast(hex, inkLight),
  };
}

/** Tokens whose value differs between themes — the only ones a Swift target
 *  needs to express as a dynamic colour. Everything else is one value. */
const themed = {};
for (const name of Object.keys(blocks[LIGHT] ?? {})) {
  const d = val(name, ':root');
  const l = val(name, LIGHT);
  if (d !== l) themed[name] = { dark: d, light: l };
}

const group = (prefix) =>
  Object.fromEntries(
    Object.keys(blocks[':root'])
      .filter((n) => n.startsWith(prefix))
      .map((n) => [camel(n), val(n)])
  );

const model = {
  $generated: 'design-system/emit.mjs — DO NOT EDIT. Source: tokens.css',
  surfaces: {
    bg: val('--bg'),
    bgPanel: val('--bg-panel'),
    bgCard: val('--bg-card'),
    bgAlt: val('--bg-alt'),
    fg: val('--fg'),
    fgMuted: val('--fg-muted'),
  },
  keyColors,
  state: {
    pass: val('--state-pass'),
    warn: val('--state-warn'),
    fail: val('--state-fail'),
    failText: val('--state-fail-text'),
    failTextLight: val('--state-fail-text', LIGHT),
  },
  series: [1, 2, 3, 4, 5, 6].map((i) => val(`--series-${i}`)),
  temperature: ['cryo', 'cold', 'ambient', 'physio', 'denature'].map((k) => ({
    step: k,
    hex: val(`--t-${k}`),
  })),
  keywordAccents: group('--kw-'),
  type: {
    fontBody: val('--font-body'),
    fontMono: val('--font-mono'),
    size: group('--fs-'),
    weight: group('--fw-'),
    tracking: group('--tracking-'),
    lineHeight: group('--lh-'),
  },
  spacing: group('--sp-'),
  radius: group('--r-'),
  motion: { ...group('--ease-'), ...group('--dur-') },
  themed,
};

// ── emitters ────────────────────────────────────────────────────────────────
const banner = (comment) =>
  [
    `${comment} Generated by design-system/emit.mjs — DO NOT EDIT.`,
    `${comment} Source of truth: tokens.css. Run \`node design-system/emit.mjs\` after editing it.`,
    '',
  ].join('\n');

function swiftColor(hex) {
  const m = /^#([0-9A-Fa-f]{6})$/.exec(hex);
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  return `Color(red: ${(r / 255).toFixed(4)}, green: ${(g / 255).toFixed(4)}, blue: ${(b / 255).toFixed(4)})`;
}

function emitSwift(enumName, moduleDoc) {
  const L = [];
  L.push(banner('//').trimEnd());
  L.push('');
  L.push('import SwiftUI');
  L.push('');
  L.push('/// ' + moduleDoc.split('\n').join('\n/// '));
  L.push(`public enum ${enumName} {`);
  L.push('');
  L.push('    // MARK: - Key colors');
  L.push('    //');
  L.push('    // Each key color is bound to a thermodynamic quantity. That binding IS the');
  L.push('    // system: never reassign one, and never add an eighth brand hue.');
  L.push('    // Contrast ratios are measured against the ink and recomputed at generation');
  L.push('    // time from the WCAG 2.1 relative-luminance formula.');
  for (const [name, c] of Object.entries(keyColors)) {
    L.push('');
    L.push(`    /// ${c.hex} — ${c.contrastOnDark}:1 on ink, ${c.contrastOnLight}:1 on light ground.`);
    L.push(`    public static let ${name} = ${swiftColor(c.hex)}`);
  }
  L.push('');
  L.push('    // MARK: - Surfaces and text');
  L.push('    //');
  L.push('    // Only these move between themes. The key colors above do not, so a chart');
  L.push('    // or an equation reads identically in either mode.');
  for (const [name, pair] of Object.entries(themed)) {
    const d = swiftColor(pair.dark);
    const l = swiftColor(pair.light);
    if (!d || !l) continue; // rgba()/gradient tokens have no single Color form
    L.push('');
    L.push(`    /// dark ${pair.dark} · light ${pair.light}`);
    L.push(`    public static func ${camel(name)}(_ scheme: ColorScheme) -> Color {`);
    L.push(`        scheme == .dark ? ${d} : ${l}`);
    L.push('    }');
  }
  L.push('');
  L.push('    // MARK: - Series ramp');
  L.push('    //');
  L.push('    // Ordered by ENERGY along the binding coordinate, not by hue — position in');
  L.push('    // a legend carries thermodynamic meaning. Six is the ceiling.');
  L.push('    public static let series: [Color] = [');
  for (const hex of model.series) L.push(`        ${swiftColor(hex)},  // ${hex}`);
  L.push('    ]');
  L.push('');
  L.push('    // MARK: - Spacing · 8-pt soft grid');
  for (const [k, v] of Object.entries(model.spacing)) {
    const rem = parseFloat(v);
    if (Number.isNaN(rem)) continue;
    L.push(`    public static let sp${k.replace(/^sp/, '')}: CGFloat = ${(rem * 16).toFixed(0)}`);
  }
  L.push('');
  L.push('    // MARK: - Corner radius');
  for (const [k, v] of Object.entries(model.radius)) {
    const px = parseFloat(v);
    if (Number.isNaN(px)) continue;
    L.push(`    public static let radius${k.replace(/^r/, '').toUpperCase()}: CGFloat = ${px}`);
  }
  L.push('}');
  return L.join('\n') + '\n';
}

function emitTs() {
  const L = [banner('//')];
  L.push('export declare const tokens: {');
  L.push('  readonly surfaces: Readonly<Record<string, string>>;');
  L.push('  readonly keyColors: Readonly<Record<string, { hex: string; contrastOnDark: number; contrastOnLight: number }>>;');
  L.push('  readonly state: Readonly<Record<string, string>>;');
  L.push('  readonly series: readonly string[];');
  L.push('  readonly temperature: readonly { step: string; hex: string }[];');
  L.push('  readonly keywordAccents: Readonly<Record<string, string>>;');
  L.push('  readonly type: Readonly<Record<string, unknown>>;');
  L.push('  readonly spacing: Readonly<Record<string, string>>;');
  L.push('  readonly radius: Readonly<Record<string, string>>;');
  L.push('  readonly motion: Readonly<Record<string, string>>;');
  L.push('};');
  L.push('export default tokens;');
  return L.join('\n') + '\n';
}

// ── Xcode asset catalog ─────────────────────────────────────────────────────
//
// THE QUESTION THIS ANSWERS
// -------------------------
// NATURaL's MASTER.md says "Light appearance twins live in BrandColors.xcassets"
// and its BrandColor.swift repeats the claim under a heading that literally
// reads "Asset catalog twins". Neither is true: all ten colorsets there carry a
// single `universal` entry and no appearance variants at all.
//
// The blanket framing — "ten colorsets are missing their twin" — is the wrong
// shape, because the ten are two different kinds of thing:
//
//   The seven KEY COLOURS must NOT have a twin. They are identity hues, frozen
//   across themes on purpose, and NATURaL's own doc demands exactly that in the
//   same sentence that claims twins exist: "Session HUD always reads the sRGB
//   values above so SCI / ΔH / ΔG stay identical across themes." Giving mint a
//   dark twin would break the thing the sentence is protecting.
//
//   BrandBg / BrandFg / BrandFgMuted must HAVE one. They are surfaces and text,
//   the only half of the (foreground, background) pair that is allowed to move.
//
// So the doc is wrong about seven and the assets are incomplete about three,
// and generating the catalog is what stops anyone having to remember which.
//
// The `universal` entry is the LIGHT value and the dark appearance carries the
// dark one, which is the direction Apple resolves: a system in light appearance
// falls back to `universal`. NATURaL currently pins `.preferredColorScheme(.dark)`
// app-wide, so it never reads the light entry today — but that is precisely the
// trap. Its universal entries hold DARK values, so the day someone removes that
// modifier the app renders dark-on-dark in light appearance, silently, with no
// missing-asset error to catch it.
function colorset(entries) {
  const component = (hex) => {
    const m = /^#([0-9A-Fa-f]{6})$/.exec(hex);
    if (!m) throw new Error(`colorset: not a plain hex: ${hex}`);
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    return {
      'color-space': 'srgb',
      components: {
        alpha: '1.000',
        blue: (b / 255).toFixed(3),
        green: (g / 255).toFixed(3),
        red: (r / 255).toFixed(3),
      },
    };
  };
  const colors = [{ color: component(entries.any), idiom: 'universal' }];
  if (entries.dark) {
    colors.push({
      appearances: [{ appearance: 'luminosity', value: 'dark' }],
      color: component(entries.dark),
      idiom: 'universal',
    });
  }
  return JSON.stringify({ colors, info: { author: 'xcode', version: 1 } }, null, 2) + '\n';
}

const XCASSETS = join(DIST, 'BrandColors.xcassets');
const capitalise = (s) => s[0].toUpperCase() + s.slice(1);

const colorsets = [];

// Key colours — one value, no appearance variant, by design.
for (const [name, c] of Object.entries(keyColors)) {
  colorsets.push([`Brand${capitalise(name)}`, colorset({ any: c.hex })]);
}
// Everything that legitimately differs between themes gets a real twin.
for (const [token, pair] of Object.entries(themed)) {
  if (!/^#[0-9A-Fa-f]{6}$/.test(pair.dark) || !/^#[0-9A-Fa-f]{6}$/.test(pair.light)) continue;
  const name = 'Brand' + capitalise(camel(token));
  colorsets.push([name, colorset({ any: pair.light, dark: pair.dark })]);
}

const XC_README = `# BrandColors.xcassets — GENERATED

Generated by \`design-system/emit.mjs\` from \`tokens.css\`. Do not hand-edit:
\`emit.mjs --check\` fails on drift.

## Which colorsets have an appearance twin, and why

**The seven key colours have NO dark twin, deliberately.** mint, violet,
tangerine, firetruck, aqua, strawberry, magnesium are identity hues bound to
thermodynamic quantities. They are frozen across themes so SCI / ΔH / ΔG read
identically in either appearance. Adding a twin to one of these is a
regression, not a fix — if a future audit reports them as "missing" twins, that
audit is measuring the wrong thing.

**Surfaces and text DO have one.** Bg, Fg, FgMuted, StateFailText and the
\`*Fg\` foreground variants are the half of the (foreground, background) pair
that is allowed to move.

## The trap this closes

The \`universal\` entry holds the LIGHT value; the dark appearance holds the
dark one. That is the direction Apple resolves — a system in light appearance
falls back to \`universal\`.

The previous hand-written catalog put the DARK value in \`universal\` with no
appearance variant. That is invisible today because the app pins
\`.preferredColorScheme(.dark)\`, and it stays invisible right up until someone
removes that modifier, at which point light appearance renders dark-on-dark
with no missing-asset error.

## Foreground variants

On the light ground the bare key colours measure magnesium 1.26:1, mint 1.56:1,
tangerine 2.06:1, aqua 2.55:1 — four of seven below the 3:1 non-text floor. Use
\`Brand*Fg\` for anything a person reads. See \`design-system/MASTER.md\`.
`;

const artifacts = [
  [PACKAGE_CSS, css],
  [join(XCASSETS, 'README.md'), XC_README],
  [
    join(XCASSETS, 'Contents.json'),
    JSON.stringify({ info: { author: 'xcode', version: 1 } }, null, 2) + '\n',
  ],
  ...colorsets.map(([name, json]) => [join(XCASSETS, `${name}.colorset`, 'Contents.json'), json]),
  [join(DIST, 'tokens.json'), JSON.stringify(model, null, 2) + '\n'],
  [join(DIST, 'tokens.js'), banner('//') + 'export const tokens = ' + JSON.stringify(model, null, 2) + ';\n\nexport default tokens;\n'],
  [join(DIST, 'tokens.d.ts'), emitTs()],
  [
    join(DIST, 'BrandColor.swift'),
    emitSwift('BrandColor', 'FlexAID∆S palette v2 for NATURaL.\nLe Bonhomme Pharma · Montréal'),
  ],
  [
    join(DIST, 'ExergyTheme.swift'),
    emitSwift('ExergyTheme', 'FlexAID∆S palette v2 for Exergy.\nLe Bonhomme Pharma · Montréal'),
  ],
];

mkdirSync(DIST, { recursive: true });
for (const [path] of artifacts) mkdirSync(join(path, '..'), { recursive: true });

let drift = 0;
for (const [path, content] of artifacts) {
  const rel = path.replace(ROOT + '/', '');
  if (CHECK) {
    const on = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (on === content) {
      console.log(`  ok    ${rel}`);
    } else {
      console.log(`  DRIFT ${rel}${on === null ? ' (missing)' : ''}`);
      drift++;
    }
  } else {
    writeFileSync(path, content);
    console.log(`  wrote ${rel}`);
  }
}

if (CHECK && drift) {
  console.log(`\n${drift} artifact(s) do not match tokens.css. Run: node design-system/emit.mjs`);
  process.exit(1);
}
console.log(CHECK ? '\nall artifacts match tokens.css.' : `\n${artifacts.length} artifacts generated from tokens.css.`);
