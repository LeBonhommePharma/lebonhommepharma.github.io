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

// ── the two targets, and why they are different numbers ─────────────────────
//
// These are NOT the same rule with a fudge on one side. They are two different
// requirements that happen to be adjacent, and conflating them is how one of
// them gets quietly deleted.

/**
 * Target for colorsets whose job is to be READ: BrandFg, BrandFgMuted,
 * BrandStateFailText.
 *
 * WCAG AA body is 4.5. The extra 0.05 is not a safety fudge against
 * measurement error — these are exact sRGB values and the ratio is
 * deterministic. It is there because 4.5 exactly is not a decision.
 *
 * Solving for `>= 4.5` lands on the least extreme 8-bit value that clears the
 * bar, and one 8-bit step is worth between 0.0052 and 0.0571 of ratio
 * depending on the hue. BrandFg landed at 4.500601 — it cleared by less than
 * the distance to the nearest representable colour, so its margin was an
 * artifact of where the quantisation grid happened to fall, not a choice.
 *
 * 0.05 is the smallest margin that exceeds one full step for all three body
 * colorsets (their steps are 0.0212, 0.0459 and 0.0469). That makes the
 * headroom a decision rather than a coincidence, and it costs exactly one
 * step of lightness each. It also gives anti-aliased small text somewhere to
 * go: edge pixels blend toward the ground, so a glyph at 4.5000 renders some
 * of itself below the bar.
 *
 * If you raise this, raise it by whole steps and re-run; if you lower it below
 * 4.55 you are back to margins that mean nothing.
 */
const AA_BODY_WITH_MARGIN = 4.55;

/**
 * Floor for the seven identity hues: BrandMint, BrandViolet, BrandTangerine,
 * BrandFiretruck, BrandAqua, BrandStrawberry, BrandMagnesium.
 *
 * READ THIS BEFORE LOWERING IT TO 3.0.
 *
 * These are fills, washes and chart series — non-text — and the WCAG non-text
 * floor is 3:1, so 4.5 looks like an obvious over-requirement waiting to be
 * relaxed. It is not, and the reason has nothing to do with contrast.
 *
 * Solved against ivory at 3.0, three of the seven return their own dark value
 * unchanged, because they already clear 3:1 at canonical:
 *
 *     BrandViolet      #8B5CF6 → #8B5CF6
 *     BrandFiretruck   #F5232B → #F5232B
 *     BrandStrawberry  #FF2F92 → #FF2F92
 *
 * Light half equals dark half, `lightnessMoved` is false, and
 * check-colorsets.mjs fails them: "lightness did not move — the twin is the
 * same colour". The colorset stops being a light/dark pair at all.
 *
 * So 4.5 here is the level below which the light half COLLAPSES ONTO the dark
 * half. It is a twin-distinctness floor that coincides with the AA body
 * number. Two independent reasons, one value. Lowering it to the nominal
 * non-text threshold breaks the catalog's own twin rule.
 *
 * These do not get AA_BODY_WITH_MARGIN because headroom they cannot use is
 * paid for in colour fidelity — every step of margin drags the light twin
 * further from the hue it is supposed to be the light version of.
 */
const AA_TWIN_FLOOR = 4.5;

/** Which rule each colorset is solved under. Emitted, and enforced by
 *  check-colorsets.mjs — see roles.json below. */
const TARGET_FOR_ROLE = { body: AA_BODY_WITH_MARGIN, identity: AA_TWIN_FLOOR };

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
// The role travels WITH the entry, at the point the list is already
// partitioned, so there is no second list to drift out of sync with this one.
const CATALOG_SOURCES = [
  ...KEY_COLORS.map((n) => ['Brand' + n[0].toUpperCase() + n.slice(1), keyColors[n].hex, 'identity']),
  ['BrandFg', val('--fg'), 'body'],
  ['BrandFgMuted', val('--fg-muted'), 'body'],
  ['BrandStateFailText', val('--state-fail-text'), 'body'],
];

const colorsets = [];
const twinReport = [];

// The ground: declared, not solved.
colorsets.push(['BrandBg', colorset({ light: IVORY, dark: val('--bg') })]);
twinReport.push({ name: 'BrandBg', light: IVORY, dark: val('--bg'), ground: true });

for (const [name, dark, role] of CATALOG_SOURCES) {
  const target = TARGET_FOR_ROLE[role];
  if (target === undefined) throw new Error(`${name}: unknown role ${role}`);
  const solved = solveRelight(dark, IVORY, target);
  if (!solved) {
    throw new Error(
      `${name}: no relighting of ${dark} reaches ${target}:1 on ${IVORY} while holding hue. ` +
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
    role,
    target,
    light: solved.hex,
    dark,
    // Emitted into the generated README table — display values. The
    // acceptance test that actually gates this twin is solveRelight's own
    // `contrast(...) >= target`, which reads the unrounded ratio.
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
  '| colorset | role | target | light | on ivory | dark | on ink | Δhue |',
  '|---|---|---|---|---|---|---|---|',
  ...twinReport.map((t) =>
    t.ground
      ? `| ${t.name} | ground | — | \`${t.light}\` | ground | \`${t.dark}\` | ground | — |`
      : `| ${t.name} | ${t.role} | ${t.target}:1 | \`${t.light}\` | ${t.onIvory}:1 | \`${t.dark}\` | ${t.onInk}:1 | ${t.dh === null ? 'achromatic' : t.dh + '°'} |`
  ),
  '',
  '## Two targets, on purpose',
  '',
  'The `target` column is not decoration. Colorsets are solved under one of two',
  'rules and which one applies is emitted to `roles.json`, read back by',
  '`check-colorsets.mjs`, and enforced — a colorset solved under the wrong rule',
  'fails CI rather than merely looking odd in this table.',
  '',
  '- **body** (' + AA_BODY_WITH_MARGIN + ':1) — BrandFg, BrandFgMuted, BrandStateFailText.',
  '  WCAG AA body is 4.5; the extra 0.05 is one 8-bit quantisation step, because',
  '  a value clearing by less than the distance to the nearest representable',
  '  colour has not cleared on purpose. BrandFg previously landed at 4.500601.',
  '- **identity** (' + AA_TWIN_FLOOR + ':1) — the seven key hues. These are fills,',
  '  washes and chart series, so the WCAG *non-text* floor of 3:1 would seem to',
  '  apply. It does not: solved at 3:1, BrandViolet, BrandFiretruck and',
  '  BrandStrawberry return their own dark value unchanged, lightness never',
  '  moves, and the pair stops being a relighting at all. 4.5 here is a',
  '  twin-distinctness floor that coincides with the AA number — see the comment',
  '  on `AA_TWIN_FLOOR` in emit.mjs before changing it.',
  '',
  'Every half clears 4.5:1 either way, which also satisfies the 3:1 floors for',
  'large text and non-text.',
  '',
  '`BrandFg` is the one to watch on hue. Its dark half `#E4E3F5` has chroma',
  '0.024, barely above the 0.02 achromatic threshold, so its hue angle is',
  'unstable by construction and the reported Δ moves a lot for a small change',
  'in lightness — it read 2.88° when the light half was solved at the bare 4.5',
  'bar and reads ' + (twinReport.find((t) => t.name === 'BrandFg')?.dh ?? '?') + '° now. Neither figure is a visible shift; both are the',
  'hue of a near-neutral being reported to more precision than it has. The 3°',
  'tolerance is doing real work on the chromatic hues, not on this one.',
  '',
].join('\n');

// The machine-readable half of the two-target rule. check-colorsets.mjs reads
// this and refuses to run if a colorset in the catalog is absent from it, so a
// new colorset cannot quietly default to the looser rule. Emitted rather than
// hand-maintained for the same reason the role travels with CATALOG_SOURCES:
// a second hand-written list is a second thing to drift.
const ROLES_JSON =
  JSON.stringify(
    {
      $comment:
        'GENERATED by design-system/emit.mjs. Which contrast rule each colorset ' +
        'is solved under. See the AA_BODY_WITH_MARGIN and AA_TWIN_FLOOR comments ' +
        'in emit.mjs for why these are two different numbers and not one number ' +
        'with a fudge.',
      targets: TARGET_FOR_ROLE,
      ground: IVORY,
      colorsets: Object.fromEntries(
        twinReport.map((t) => [t.name, t.ground ? { role: 'ground', target: null } : { role: t.role, target: t.target }])
      ),
    },
    null,
    2
  ) + '\n';

const artifacts = [
  [PACKAGE_CSS, css],
  [join(XCASSETS, 'README.md'), XC_README],
  [join(XCASSETS, 'roles.json'), ROLES_JSON],
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
