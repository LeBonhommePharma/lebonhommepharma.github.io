#!/usr/bin/env node
/**
 * design-system/check-raw-hex.mjs — no colour may be born outside the tokens.
 *
 * WHY THIS EXISTS ALONGSIDE scripts/check-palette-v2.sh
 * -----------------------------------------------------
 * That guard is a DENYLIST: it names the retired v1 hues and rejects them in
 * every spelling it knows. It is good at what it does and it stays.
 *
 * It cannot catch a colour nobody has thought of yet. A Cursor agent shipped
 *
 *     --hp-gold: #C4A359;
 *
 * straight into `index.html`. The denylist matched nothing, because #C4A359 is
 * not a retired v1 colour — it is a brand-new invented one, wearing a `--hp-*`
 * custom property so it reads like a token. The guard was asked "is this one of
 * the eight banned colours?", answered "no", and was right. It was the wrong
 * question.
 *
 * So this is the ALLOWLIST half: a colour literal is legal only where the
 * design system defines it. Everywhere else, a literal is a violation whether
 * or not anyone has previously decided they dislike it. Denylists let the next
 * unknown hue through by construction; this one cannot.
 *
 * SCOPE AND THE BASELINE
 * ----------------------
 * 178 tracked files already carry raw hex — transit line colours in the atlas
 * data, the palette exploration board whose whole subject is showing retired
 * hues, third-party build artifacts. Failing all of them on day one would mean
 * the guard gets switched off in a week, which is worse than not shipping it.
 *
 * So known literals are grandfathered per file in `raw-hex-baseline.json` and
 * the ratchet only tightens: a file may lose literals, never gain one. Nothing
 * is grandfathered silently — `openViolations` lists what was deliberately NOT
 * forgiven, and those fail the build.
 *
 * Usage:
 *   check-raw-hex.mjs                  scan the tree
 *   check-raw-hex.mjs --self-test      only prove the checks can fail
 *   check-raw-hex.mjs --reseal         rewrite the baseline from the tree
 *   check-raw-hex.mjs --root DIR --tokens FILE
 *                                      run against a consuming repo
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { paletteHexes, paletteRgb } from './extract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── arguments ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const ROOT = opt('--root', join(HERE, '..'));
const TOKENS = opt('--tokens', join(ROOT, 'tokens.css'));
const BASELINE = opt('--baseline', join(HERE, 'raw-hex-baseline.json'));

// ── what a colour literal looks like, in every spelling that ships ──────────
// Each matcher returns a normalised key so `#45e0a8`, `#45E0A8` and 0x45E0A8
// compare equal to the token source's `#45E0A8`. A guard that is case- or
// notation-sensitive is a guard with holes in it.
const toHex = (r, g, b) =>
  '#' + [r, g, b].map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('').toUpperCase();

const MATCHERS = [
  {
    name: 'hex',
    // #RRGGBB and #RRGGBBAA, never a longer hex run (so a git sha or a
    // 10-digit id is not mistaken for a colour).
    re: /#([0-9A-Fa-f]{6})(?:[0-9A-Fa-f]{2})?(?![0-9A-Fa-f])/g,
    key: (m) => '#' + m[1].toUpperCase(),
  },
  {
    name: 'hex-short',
    // #RGB shorthand, expanded. `#f0a` is `#FF00AA` and must be judged as one.
    //
    // Only in CSS-value position — after `:` or inside a function's argument
    // list. Three characters is not enough signal on its own: the first draft
    // of this matcher flagged "Drug of the Day #038" and "Cocaine #001" across
    // eighty-odd pages, expanding an issue number into #003388. A guard that
    // cries wolf on prose gets muted, and a muted guard is the thing this file
    // exists to prevent.
    re: /(?<=[:(,]\s{0,4})#([0-9A-Fa-f]{3})(?![0-9A-Fa-f])/g,
    key: (m) => '#' + [...m[1]].map((c) => c + c).join('').toUpperCase(),
  },
  {
    name: 'hex-0x',
    // Three.js / Mol* colour ints.
    re: /0x([0-9A-Fa-f]{6})(?![0-9A-Fa-f])/g,
    key: (m) => '#' + m[1].toUpperCase(),
  },
  {
    name: 'rgb',
    // Normalised to hex like every other matcher. `rgb(141, 140, 176)` and
    // `#8D8CB0` are the same colour; judging them in separate keyspaces made
    // --fg-muted written as rgb() a violation while the hex form passed.
    re: /rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/g,
    key: (m) => toHex(+m[1], +m[2], +m[3]),
  },
  {
    name: 'components',
    // Named colour components: SwiftUI `Color(red:green:blue:)`, `UIColor(...)`,
    // `#colorLiteral(...)`, `Color(.sRGB, red:...)`, and the `"red": "0.271"`
    // form an Xcode .colorset uses. One matcher, because they differ only in
    // what surrounds the same three numbers.
    //
    // This was the guard's worst hole, and it was self-inflicted: emit.mjs
    // generates Swift as `Color(red: 0.7686, green: 0.6392, blue: 0.3490)`,
    // so the canonical generator was emitting colours in a notation its own
    // guard could not see. Of seven ways Swift writes a colour, only the two
    // hex-shaped ones were caught.
    //
    // Accepts 0–1 floats, 0–255 integers, and the `196/255` idiom. If any
    // channel exceeds 1 the triple is read as 0–255; otherwise as 0–1, which
    // is the same heuristic every colour library uses and the only one
    // available without knowing the call site.
    re: /\bred"?\s*:\s*"?(-?[\d.]+(?:\s*\/\s*255)?)"?[\s,]*(?:[^)}\n]*?)\bgreen"?\s*:\s*"?(-?[\d.]+(?:\s*\/\s*255)?)"?[\s,]*(?:[^)}\n]*?)\bblue"?\s*:\s*"?(-?[\d.]+(?:\s*\/\s*255)?)"?/g,
    key: (m) => {
      const num = (s) => {
        const d = s.split('/');
        const v = parseFloat(d[0]);
        return d.length > 1 ? v / parseFloat(d[1]) : v;
      };
      const raw = [m[1], m[2], m[3]].map(num);
      if (raw.some((v) => Number.isNaN(v))) return null;
      const scaled = raw.some((v) => v > 1) ? raw : raw.map((v) => v * 255);
      return toHex(...scaled.map((v) => Math.round(v)));
    },
  },
  {
    name: 'hex-string',
    // A bare 6-hex string in an explicitly colour-shaped position:
    // `Color(hex: "C4A359")`, `hexString: "c4a359"`. Requires the `hex` key,
    // because six hex characters in a quoted string is otherwise a git sha, an
    // id, or a checksum — the same prose trap that made #RGB shorthand flag
    // "Drug of the Day #038" across eighty pages.
    re: /\bhex[A-Za-z]*"?\s*[:=]\s*"#?([0-9A-Fa-f]{6})"/g,
    key: (m) => '#' + m[1].toUpperCase(),
  },
  {
    name: 'hsl',
    // Zero hsl() in the tree today. Enforced at zero tolerance precisely
    // because it is free to close now and would otherwise be the obvious
    // way around every other matcher here.
    re: /hsla?\(\s*[\d.]+/g,
    key: () => 'hsl()',
    noBaseline: true,
  },
];

const IGNORE_START = 'palette-check-ignore-start';
const IGNORE_END = 'palette-check-ignore-end';

// Excluded from scanning, with the reason. Same spirit as the v1 guard's list:
// an exclusion that cannot say why it exists is a hole nobody can audit.
const EXCLUDE = [
  [/^tokens\.css$/, 'the token source itself — where colour is allowed to exist'],
  [/^design-system\//, 'the design system: source, emitters, baseline and this guard'],
  [/^design\/palette-v2\//, 'exploration board — its subject IS the retired hues'],
  [/^scripts\//, 'guards must name what they forbid; they are their own fixtures'],
  [/^assets\/index-[A-Za-z0-9_-]+\.css$/, 'hashed build artifact, source not in this repo'],
  [/^(rive|transitA)\//, 'generated by publish-transit; fix drift at the Transit source'],
  [/_next\//, 'Next.js build output'],
  [/\.(png|jpe?g|gif|ico|svg|pdf|woff2?|ttf|otf|zip|mp4|webm|wasm|bcif|cif|pdb)$/, 'binary or structural data'],
];

function excluded(path) {
  for (const [re, why] of EXCLUDE) if (re.test(path)) return why;
  return null;
}

// ── the allowlist ───────────────────────────────────────────────────────────
function loadPalette() {
  if (!existsSync(TOKENS)) {
    console.error(`FATAL: token source not found: ${TOKENS}`);
    console.error('       Refusing to run — with no allowlist every colour would pass.');
    process.exit(2);
  }
  const css = readFileSync(TOKENS, 'utf8');
  const hexes = paletteHexes(css);
  const rgbs = paletteRgb(css);
  if (hexes.size === 0) {
    console.error(`FATAL: parsed 0 colours from ${TOKENS}.`);
    console.error('       Refusing to run — an empty allowlist fails every file and');
    console.error('       a mis-parse must never look like a tree full of violations.');
    process.exit(2);
  }
  const allowed = new Set(hexes);
  for (const t of rgbs) {
    const [r, g, b] = t.split(',').map(Number);
    allowed.add(toHex(r, g, b));
  }
  return allowed;
}

/** Colour literals in `text` that the palette does not authorise. */
function findViolations(text, allowed) {
  const out = [];
  let skipping = false;
  text.split('\n').forEach((line, i) => {
    if (line.includes(IGNORE_START)) skipping = true;
    if (!skipping) {
      for (const m of MATCHERS) {
        m.re.lastIndex = 0;
        let hit;
        while ((hit = m.re.exec(line)) !== null) {
          const key = m.key(hit);
          if (!allowed.has(key)) {
            out.push({ line: i + 1, key, form: m.name, noBaseline: !!m.noBaseline, text: line.trim().slice(0, 140) });
          }
        }
      }
    }
    if (line.includes(IGNORE_END)) skipping = false;
  });
  return out;
}

// ── self-test ───────────────────────────────────────────────────────────────
// The v1 guard learned this the hard way: a pattern that has quietly stopped
// matching reports a clean tree it never inspected. Every matcher is asserted
// against known-bad input, and the regression that motivated this whole file
// is the first case in the list.
function selfTest(allowed) {
  let ok = true;
  const say = (good, label) => {
    console.log(`  ${good ? 'ok    ' : 'BROKEN'} ${label}`);
    if (!good) ok = false;
  };

  const positives = [
    ['  --hp-gold: #C4A359;', 'THE REGRESSION — invented gold behind a --hp-* property'],
    ['  --hp-gold: #8A6E2F;', 'its light-mode partner'],
    ['color: #c4a359;', 'same colour, lower case'],
    ['color: #c4c4cc', 'invented grey'],
    ['  --x: #f0a;', '#RGB shorthand expanding to an unauthorised colour'],
    ['background: linear-gradient(90deg, #f0a, #0af);', '#RGB inside a gradient'],
    ['scene.background = new THREE.Color(0xC4A359)', '0x colour int'],
    ['background: rgba(196, 163, 89, 0.4)', 'unauthorised rgba triple'],
    ['background: rgb(196 163 89 / 0.4)', 'space-separated rgb'],
    ['color: hsl(43 47% 56%)', 'hsl, the way around every hex matcher'],
    // Swift, in every spelling it writes a colour. Only the first two were
    // caught before; the rest are why "a hex check that only knows one
    // language isn't a guard".
    ['    static let g = Color(hex: "C4A359")', 'Swift hex string with no #'],
    ['    static let d = Color(red: 0.7686, green: 0.6392, blue: 0.3490)', 'SwiftUI float components — the form emit.mjs itself generates'],
    ['UIColor(red: 196/255, green: 163/255, blue: 89/255, alpha: 1)', 'UIColor with the /255 idiom'],
    ['#colorLiteral(red: 0.7686, green: 0.6392, blue: 0.3490, alpha: 1)', 'Xcode #colorLiteral'],
    ['Color(.sRGB, red: 0.7686, green: 0.6392, blue: 0.3490)', 'Color(.sRGB, ...)'],
    ['"red" : "0.769", "green" : "0.639", "blue" : "0.349"', 'an .colorset Contents.json component block'],
  ];
  for (const [input, label] of positives) {
    say(findViolations(input, allowed).length > 0, label);
  }

  // And must NOT fire on what the system actually authorises.
  const negatives = [
    ['  --mint: #45E0A8;', 'palette mint'],
    ['color: #45e0a8;', 'palette mint, lower case'],
    ['border: 1px solid rgba(69, 224, 168, 0.15)', 'palette mint as rgba'],
    ['background: #08091A', 'the ink'],
    ['fog = new THREE.FogExp2(0x08091A)', 'the ink as a colour int'],
    ['const sha = "abc123def456789a";', 'a hex-looking id that is not a colour'],
    ['<title>Phenibut — Drug of the Day #038</title>', 'an issue number in prose, not #003388'],
    ['<a href="/drug-of-the-day/cocaine/">Cocaine #001</a>', 'another issue number in prose'],
    ['  --fg: #E4E3F5;', 'body text'],
    ['    static let ok = Color(red: 0.2706, green: 0.8784, blue: 0.6588)', 'palette mint as float components'],
    ['"red" : "0.271", "green" : "0.878", "blue" : "0.659"', 'palette mint as colorset components'],
    // `hex: "abc123"` is deliberately NOT here as a negative: a key literally
    // named `hex` holding six hex characters IS colour-shaped, and flagging it
    // is right. The boundary being tested is a hex-looking string with no
    // colour context at all.
    ['const id = "abc123";', 'a 6-char hex string with no colour context'],
    ['let reduced = { red: 3, green: 9 };', 'a red/green pair with no blue is not a colour'],
  ];
  for (const [input, label] of negatives) {
    say(findViolations(input, allowed).length === 0, `${label} (correctly allowed)`);
  }

  // The allowlist must not have absorbed the retired v1 palette from the
  // "do not reintroduce" comment in tokens.css.
  // palette-check-ignore-start — fixtures: these must NOT be in the allowlist
  for (const retired of ['#22D3EE', '#FBBF24', '#FDE68A', '#8B1A4A', '#C2456F', '#DA2F63', '#6E7C99', '#FF2600']) {
  // palette-check-ignore-end
    say(!allowed.has(retired), `retired ${retired} is not in the allowlist`);
  }

  if (!ok) {
    console.error('\nself-test FAILED — the scan below cannot be trusted.');
    process.exit(2);
  }
}

// ── scan ────────────────────────────────────────────────────────────────────
function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 1 << 28 })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

function scan(allowed) {
  const found = {};
  for (const f of trackedFiles()) {
    if (excluded(f)) continue;
    let text;
    try {
      text = readFileSync(join(ROOT, f), 'utf8');
    } catch {
      continue; // unreadable or vanished; git ls-files can outrun the worktree
    }
    if (text.includes('\0')) continue; // binary that slipped the extension list
    const v = findViolations(text, allowed);
    if (v.length) found[f] = v;
  }
  return found;
}

function loadBaseline() {
  if (!existsSync(BASELINE)) return { grandfathered: {}, openViolations: {} };
  return JSON.parse(readFileSync(BASELINE, 'utf8'));
}

function main() {
  const allowed = loadPalette();

  console.log(`── allowlist: ${allowed.size} colours from ${relative(ROOT, TOKENS) || TOKENS}`);
  console.log('── self-test');
  selfTest(allowed);
  if (flag('--self-test')) {
    console.log('\nself-test passed.');
    return 0;
  }

  const found = scan(allowed);

  if (flag('--reseal')) {
    const base = loadBaseline();
    const grandfathered = {};
    for (const [f, vs] of Object.entries(found)) {
      const open = new Set(Object.keys(base.openViolations?.[f]?.values ?? {}));
      const keys = [...new Set(vs.filter((v) => !v.noBaseline && !open.has(v.key)).map((v) => v.key))].sort();
      if (keys.length) grandfathered[f] = keys;
    }
    // Key order is load-bearing, so the object is built explicitly rather than
    // spread. This file RECORDS the colour literals in the tree — retired v1
    // hues included — so scripts/check-palette-v2.sh, which forbids exactly
    // those hues, would reject the ledger that names them. The guard offers
    // ignore markers for precisely this; they only work if the start marker
    // precedes every hex and the end marker follows all of them, which a
    // `{...base}` spread does not guarantee.
    writeFileSync(
      BASELINE,
      JSON.stringify(
        {
          _readme: base._readme,
          _paletteCheck: 'palette-check-ignore-start',
          generated: new Date().toISOString().slice(0, 10),
          openViolations: base.openViolations ?? {},
          grandfathered,
          _paletteCheckEnd: 'palette-check-ignore-end',
        },
        null,
        2
      ) + '\n'
    );
    console.log(`\nresealed ${BASELINE}: ${Object.keys(grandfathered).length} files grandfathered.`);
    return 0;
  }

  const base = loadBaseline();
  const newHits = [];
  const openHits = [];

  for (const [f, vs] of Object.entries(found)) {
    const allowedHere = new Set(base.grandfathered?.[f] ?? []);
    const openHere = base.openViolations?.[f]?.values ?? {};
    for (const v of vs) {
      if (v.key in openHere) openHits.push({ file: f, ...v, note: openHere[v.key] });
      else if (!v.noBaseline && allowedHere.has(v.key)) continue;
      else newHits.push({ file: f, ...v });
    }
  }

  console.log(`\n── scanned tree: ${Object.keys(found).length} files carry colour literals outside the token source`);

  const report = (hits, heading) => {
    if (!hits.length) return;
    console.log(`\n  FAIL  ${heading}`);
    for (const h of hits) {
      console.log(`        ${h.file}:${h.line}  ${h.key}  [${h.form}]${h.note ? '  — ' + h.note : ''}`);
      console.log(`            ${h.text}`);
    }
  };

  report(openHits, 'colour literals recorded as open violations — these were deliberately not grandfathered');
  report(newHits, 'colour literals not defined by the design system and not grandfathered');

  // The ratchet: report literals that are gone so the baseline can tighten.
  const stale = [];
  for (const [f, keys] of Object.entries(base.grandfathered ?? {})) {
    const live = new Set((found[f] ?? []).map((v) => v.key));
    const gone = keys.filter((k) => !live.has(k));
    if (gone.length) stale.push(`${f}: ${gone.join(' ')}`);
  }
  if (stale.length) {
    console.log('\n  NOTE  grandfathered literals no longer present — run --reseal to tighten:');
    for (const s of stale) console.log(`        ${s}`);
  }

  const fail = openHits.length + newHits.length;
  console.log('');
  if (!fail) {
    console.log('raw-hex: clean. Every colour literal is either a token value or grandfathered.');
    return 0;
  }
  console.log(`raw-hex: ${fail} violation(s).`);
  console.log('Fix by using a token: var(--mint) ΔH · var(--violet) ΔS · var(--tangerine) ΔG');
  console.log('  var(--aqua) ΔS_vib · var(--firetruck) T · var(--strawberry) receptor · var(--magnesium) baseline');
  console.log('A genuinely new colour belongs in tokens.css with a measured contrast ratio, not in a page.');
  return 1;
}

process.exit(main());
