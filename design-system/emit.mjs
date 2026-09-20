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
import { solveRelight, isRelighting, contrast, fmtRatio } from './oklch.mjs';

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
// claim. They are recomputed from the WCAG 2.1 relative-luminance formula so
// the emitted artifacts carry a measured number, and so a hue edited without
// re-measuring is caught by --check rather than shipping a stale figure.
//
// The maths itself lives in oklch.mjs. It used to be copied into each tool,
// and one copy dropped the /255 normalisation — see that file's header.
export { contrast };

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
    // fmtRatio, not contrast, because these figures are EMITTED — into Swift
    // doc comments, tokens.json and tokens.d.ts — and are read by people, not
    // compared against a threshold. contrast() returns the unrounded ratio now
    // (see oklch.mjs); rounding belongs here, at the print/emit site, and
    // nowhere upstream of a comparison.
    contrastOnDark: fmtRatio(contrast(hex, inkDark)),
    contrastOnLight: fmtRatio(contrast(hex, inkLight)),
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
// natural/MASTER.md says light appearance twins live in BrandColors.xcassets.
// They never existed — all ten colorsets carried a single `universal` entry.
// LP's call: the doc is right and the assets were simply never made. So the
// twins get built, and the doc stands.
//
// HOW THE PAIRS ARE DERIVED, NOT PICKED
// -------------------------------------
// The canonical hex is the DARK half: every key colour was measured against
// the ink and clears AA there already (mint 11.73, magnesium 14.47, and the
// tightest, violet, at 4.66).
//
// The LIGHT half is solved from it — hue held, lightness moved, chroma shed
// only where the sRGB gamut narrows — until the pair clears 4.5:1 against
// NATURaL's approved warm ivory. The constraint is the one
// scripts/check-design-system.sh already defines and self-tests: hue within
// 3°, lightness must differ, chroma may fall freely but rise no more than
// 0.05. So every twin is provably a relighting of its counterpart rather than
// a second colour that happens to look similar.
//
// BrandBg is the exception and is declared as one: it IS the ground, so it has
// no foreground to be measured against, and warm ivory is legitimately a
// different hue from midnight indigo rather than a relighting of it.
const IVORY = '#F3EFE7';   // NATURaL approved light appearance (natural/MASTER.md)
const AA_BODY = 4.5;       // an asset does not know its call site; assume the strictest

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
  const colors = [{ color: component(entries.light), idiom: 'universal' }];
  colors.push({
    appearances: [{ appearance: 'luminosity', value: 'dark' }],
    color: component(entries.dark),
    idiom: 'universal',
  });
  return JSON.stringify({ colors, info: { author: 'xcode', version: 1 } }, null, 2) + '\n';
}

const XCASSETS = join(DIST, 'BrandColors.xcassets');

// The ten names NATURaL already uses, so this is a drop-in rather than a
// rename, plus StateFailText which its catalog was missing.
const CATALOG_SOURCES = [
  ...KEY_COLORS.map((n) => ['Brand' + n[0].toUpperCase() + n.slice(1), keyColors[n].hex]),
  ['BrandFg', val('--fg')],
  ['BrandFgMuted', val('--fg-muted')],
  ['BrandStateFailText', val('--state-fail-text')],
];

const colorsets = [];
const twinReport = [];

// The ground: declared, not solved.
colorsets.push(['BrandBg', colorset({ light: IVORY, dark: val('--bg') })]);
twinReport.push({ name: 'BrandBg', light: IVORY, dark: val('--bg'), ground: true });

for (const [name, dark] of CATALOG_SOURCES) {
  const solved = solveRelight(dark, IVORY, AA_BODY);
  if (!solved) {
    throw new Error(
      `${name}: no relighting of ${dark} reaches ${AA_BODY}:1 on ${IVORY} while holding hue. ` +
        'Refusing to emit a twin that fails contrast — a twin that looks right and fails ' +
        'is worse than none, because it ships silently.'
    );
  }
  const rel = isRelighting(dark, solved.hex);
  if (!rel.ok) {
    throw new Error(
      `${name}: solved light value ${solved.hex} is not a relighting of ${dark} ` +
        `(hue ${rel.dh}°, chroma ${rel.dc}). Refusing to emit.`
    );
  }
  colorsets.push([name, colorset({ light: solved.hex, dark })]);
  twinReport.push({
    name,
    light: solved.hex,
    dark,
    // Emitted into the generated README table — display values. The
    // acceptance test that actually gates this twin is solveRelight's own
    // `contrast(...) >= AA_BODY`, which reads the unrounded ratio.
    onIvory: fmtRatio(contrast(solved.hex, IVORY)),
    onInk: fmtRatio(contrast(dark, inkDark)),
    dh: rel.dh,
    chromaKept: solved.chromaKept,
  });
}

const XC_README = [
  '# BrandColors.xcassets — GENERATED',
  '',
  'Generated by `design-system/emit.mjs` from `tokens.css`. Do not hand-edit:',
  '`emit.mjs --check` fails on drift, and `check-colorsets.mjs` fails on a',
  'missing twin.',
  '',
  '## How each pair was derived',
  '',
  'The canonical hex is the **dark** half — every key colour was measured',
  'against the ink and clears AA there already.',
  '',
  'The **light** half is solved from it: hue held, lightness moved, chroma shed',
  'only where the sRGB gamut narrows, until the pair clears 4.5:1 against warm',
  'ivory `' + IVORY + '`. The constraint is the one',
  '`scripts/check-design-system.sh` already defines and self-tests — hue within',
  '3°, lightness must differ, chroma may fall freely but rise no more than',
  '0.05 — so every twin is provably a relighting rather than a second colour',
  'that happens to look similar.',
  '',
  '`BrandBg` is the declared exception: it IS the ground, so there is no',
  'foreground to measure it against, and warm ivory is legitimately a different',
  'hue from midnight indigo rather than a relighting of it.',
  '',
  '## Measured',
  '',
  '| colorset | light | on ivory | dark | on ink | Δhue |',
  '|---|---|---|---|---|---|',
  ...twinReport.map((t) =>
    t.ground
      ? `| ${t.name} | \`${t.light}\` | ground | \`${t.dark}\` | ground | — |`
      : `| ${t.name} | \`${t.light}\` | ${t.onIvory}:1 | \`${t.dark}\` | ${t.onInk}:1 | ${t.dh === null ? 'achromatic' : t.dh + '°'} |`
  ),
  '',
  'Both halves clear 4.5:1, which also satisfies the 3:1 floors for large text',
  'and non-text. An asset does not know whether its call site renders 12px body',
  'or a 28px numeral, so the strictest bar is the only safe assumption.',
  '',
  '`BrandFg` sits at 2.88° of hue drift, inside the 3° tolerance but close to',
  'it. That is measurement noise, not a visible shift: `#E4E3F5` has chroma',
  '0.024, barely above the 0.02 achromatic threshold, and the hue angle of a',
  'near-neutral is unstable by construction.',
  '',
].join('\n');

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
    emitSwift('BrandColor', 'FlexAIDΔS palette v2 for NATURaL.\nLe Bonhomme Pharma · Montréal'),
  ],
  [
    join(DIST, 'ExergyTheme.swift'),
    emitSwift('ExergyTheme', 'FlexAIDΔS palette v2 for Exergy.\nLe Bonhomme Pharma · Montréal'),
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
