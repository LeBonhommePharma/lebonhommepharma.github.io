#!/usr/bin/env node
/**
 * design-system/check-colorsets.mjs — every brand colorset needs a dark twin,
 * and both halves have to earn their keep.
 *
 * WHY
 * ---
 * `natural/MASTER.md` says light appearance twins live in `BrandColors.xcassets`.
 * They never existed: all ten colorsets carried a single `universal` entry. The
 * doc was right and the assets were simply never made, so this guard holds the
 * assets to the doc rather than the other way round.
 *
 * WHAT IT ENFORCES
 * ----------------
 * 1. Every colorset has a `luminosity: dark` appearance. A single `universal`
 *    entry is a missing twin, not a "universal colour" — an asset with no
 *    variant is silently reused in dark appearance, which is exactly how a
 *    light-ground colour ends up on the ink.
 *
 * 2. The two halves are a RELIGHTING of one another, not two different colours.
 *    Reuses the OKLCH allowance `scripts/check-design-system.sh` already
 *    defines and self-tests: hue within 3°, lightness must differ, chroma may
 *    fall freely but rise no more than 0.05. Hue is the identity of a quantity;
 *    lightness is the free parameter. Writing a second, looser rule here would
 *    mean two definitions of "same colour" in one repo.
 *
 * 3. Each half clears contrast against the ground it is actually shown on —
 *    light against NATURaL's approved warm ivory, dark against midnight indigo.
 *    A twin that looks right but fails contrast is worse than no twin, because
 *    it ships silently.
 *
 * Usage:
 *   check-colorsets.mjs                 check the generated catalog
 *   check-colorsets.mjs --catalog DIR   check someone else's
 *   check-colorsets.mjs --self-test     prove the checks can fail
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { contrast, isRelighting, HUE_TOL_DEG, CHROMA_GAIN_TOL } from './oklch.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const CATALOG = opt('--catalog', join(HERE, 'dist', 'BrandColors.xcassets'));

// ── the grounds ─────────────────────────────────────────────────────────────
// Named, because a ratio quoted without its background is not a measurement.
const IVORY = '#F3EFE7';   // NATURaL approved light appearance (natural/MASTER.md)
const INK = '#08091A';     // midnight indigo

// WCAG 2.1 AA. 4.5 is the bar a colorset is held to by default: an asset does
// not know whether the view using it renders 12px body or a 28px numeral, and
// the safe assumption for an unknown call site is the strictest one. 3:1 is
// recorded for reference, not accepted.
const AA_BODY = 4.5;
const AA_LARGE = 3.0;

// Grounds are not measured against themselves.
const GROUND_SETS = new Set(['BrandBg']);

// Colour maths and the relight allowance both come from oklch.mjs — one
// definition, imported. See that file's header for why.

// ── reading a catalog ───────────────────────────────────────────────────────
const toHex = (comp) => {
  const n = (v) => {
    const s = String(v).trim();
    const f = s.startsWith('0x') ? parseInt(s, 16) : parseFloat(s);
    return Math.round(f <= 1 && !s.startsWith('0x') ? f * 255 : f);
  };
  return '#' + [n(comp.red), n(comp.green), n(comp.blue)].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
};

export function readCatalog(dir) {
  if (!existsSync(dir)) {
    console.error(`FATAL: no catalog at ${dir}`);
    console.error('       Refusing to run — an absent catalog must not look like a clean one.');
    process.exit(2);
  }
  const sets = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.colorset')) continue;
    const p = join(dir, entry, 'Contents.json');
    if (!existsSync(p)) continue;
    const d = JSON.parse(readFileSync(p, 'utf8'));
    const any = (d.colors || []).find((c) => !c.appearances && c.color);
    const dark = (d.colors || []).find(
      (c) => (c.appearances || []).some((a) => a.appearance === 'luminosity' && a.value === 'dark') && c.color
    );
    sets.push({
      name: basename(entry, '.colorset'),
      light: any ? toHex(any.color.components) : null,
      dark: dark ? toHex(dark.color.components) : null,
    });
  }
  if (sets.length === 0) {
    console.error(`FATAL: parsed 0 colorsets from ${dir}.`);
    console.error('       Refusing to run — a mis-parse must never report a clean catalog.');
    process.exit(2);
  }
  return sets.sort((a, b) => a.name.localeCompare(b.name));
}

// ── self-test ───────────────────────────────────────────────────────────────
function selfTest() {
  let ok = true;
  const say = (good, label) => {
    console.log(`  ${good ? 'ok    ' : 'BROKEN'} ${label}`);
    if (!good) ok = false;
  };

  // A relighting of mint: same hue, darker, chroma shed.
  say(isRelighting('#45E0A8', '#00815C').ok, 'mint → darker mint is a relighting');
  say(isRelighting('#45E0A8', '#8EEFC9').ok, 'mint → lighter mint is a relighting');
  // Not relightings.
  // palette-check-ignore-start — fixtures: a guard must name what it rejects
  say(!isRelighting('#45E0A8', '#22D3EE').ok, 'mint → retired v1 cyan is NOT (hue 47°)');
  say(!isRelighting('#FF9300', '#C4A359').ok, 'tangerine → the invented gold is NOT');
  say(!isRelighting('#8B5CF6', '#8B1A4A').ok, 'violet → retired terra is NOT (hue 68°)');
  // palette-check-ignore-end
  say(!isRelighting('#45E0A8', '#45E0A8').ok, 'a colour is not its own twin (lightness must move)');
  // Magnesium is achromatic — hue angle is noise, so it is judged on lightness.
  say(isRelighting('#DCDCE4', '#717078').ok, 'magnesium → darker grey (achromatic path)');

  // Direction matters, and getting it backwards silently reverses a verdict.
  // #A25C00 is the generated light twin of tangerine: reading from the
  // canonical dark value it SHED 0.051 chroma (allowed); reading the other way
  // the same pair looks like a 0.051 GAIN (rejected). This pair is the
  // regression test for that.
  say(isRelighting('#FF9300', '#A25C00').ok, 'tangerine → its light twin, read from canonical (chroma shed)');
  say(!isRelighting('#A25C00', '#FF9300').ok, 'the same pair read backwards is correctly rejected');

  // Contrast maths against a known pair.
  say(contrast('#FFFFFF', '#000000') === 21, 'white on black is 21:1');
  say(contrast('#08091A', '#08091A') === 1, 'a colour on itself is 1:1');

  // The parser must see a missing twin as missing.
  const noTwin = { colors: [{ idiom: 'universal', color: { components: { red: '0.271', green: '0.878', blue: '0.659' } } }] };
  const anyE = noTwin.colors.find((c) => !c.appearances);
  const darkE = noTwin.colors.find((c) => (c.appearances || []).length);
  say(!!anyE && !darkE, 'a single universal entry reads as MISSING a dark twin');

  if (!ok) {
    console.error('\nself-test FAILED — the check below cannot be trusted.');
    process.exit(2);
  }
}

// ── run ─────────────────────────────────────────────────────────────────────
console.log(`── catalog: ${CATALOG}`);
console.log('── self-test');
selfTest();
if (flag('--self-test')) {
  console.log('\nself-test passed.');
  process.exit(0);
}

const sets = readCatalog(CATALOG);
let fail = 0;
const missing = [];
const problems = [];

console.log(`\n── ${sets.length} colorsets\n`);
console.log(`${'colorset'.padEnd(22)}${'light'.padEnd(10)}${'on ivory'.padEnd(10)}${'dark'.padEnd(10)}${'on ink'.padEnd(9)}relight`);
console.log('─'.repeat(78));

for (const s of sets) {
  const isGround = GROUND_SETS.has(s.name);
  if (!s.dark) {
    missing.push(s.name);
    console.log(`${s.name.padEnd(22)}${(s.light ?? '—').padEnd(10)}${''.padEnd(10)}${'MISSING'.padEnd(10)}${''.padEnd(9)}—`);
    fail++;
    continue;
  }
  const cl = isGround ? null : contrast(s.light, IVORY);
  const cd = isGround ? null : contrast(s.dark, INK);
  // Measured DARK → LIGHT, because the rule is directional and the dark half
  // is the canonical colour.
  //
  // "Chroma may fall freely but rise no more than 0.05" only means anything
  // relative to a reference. Read light → dark instead and a derived light
  // value that legitimately SHED chroma looks like one that GAINED it:
  // BrandTangerine reported "chroma rose 0.051" and failed, when what actually
  // happened was tangerine shedding 0.051 on the way down to a gamut-limited
  // light value. Same two colours, opposite verdict, purely from which one the
  // comparison started at. scripts/check-design-system.sh starts at the
  // canonical value; so does this.
  const rel = isGround ? { ok: true, dh: null, dc: 0 } : isRelighting(s.dark, s.light);
  console.log(
    `${s.name.padEnd(22)}${s.light.padEnd(10)}${String(cl ?? 'ground').padEnd(10)}${s.dark.padEnd(10)}${String(cd ?? 'ground').padEnd(9)}${isGround ? 'ground' : rel.ok ? 'ok' : 'NO'}`
  );
  if (!rel.ok) {
    const why = [
      !rel.hueOk ? `hue moved ${rel.dh}° (max ${HUE_TOL_DEG}°)` : null,
      !rel.chromaOk ? `chroma rose ${rel.dc} (max ${CHROMA_GAIN_TOL})` : null,
      !rel.lightnessMoved ? 'lightness did not move — the twin is the same colour' : null,
    ].filter(Boolean).join('; ');
    problems.push(`${s.name}: light and dark are not a relighting of one another — ${why}`);
    fail++;
  }
  if (!isGround) {
    if (cl < AA_BODY) {
      problems.push(`${s.name}: light ${s.light} on ivory ${IVORY} = ${cl}:1 — below AA body (${AA_BODY}:1)${cl >= AA_LARGE ? ', large text only' : ', below the 3:1 non-text floor'}`);
      fail++;
    }
    if (cd < AA_BODY) {
      problems.push(`${s.name}: dark ${s.dark} on ink ${INK} = ${cd}:1 — below AA body (${AA_BODY}:1)${cd >= AA_LARGE ? ', large text only' : ', below the 3:1 non-text floor'}`);
      fail++;
    }
  }
}

if (missing.length) {
  console.log(`\n  FAIL  ${missing.length} colorset(s) have no dark-appearance twin:`);
  for (const n of missing) console.log(`        ${n}`);
  console.log('        A single universal entry is reused in dark appearance, so a');
  console.log('        light-ground colour lands on the ink with nothing to catch it.');
}
if (problems.length) {
  console.log(`\n  FAIL  ${problems.length} problem(s):`);
  for (const p of problems) console.log(`        ${p}`);
}

console.log('');
if (fail) {
  console.log(`colorsets: ${fail} failure(s).`);
  console.log('Generate the catalog instead of hand-picking: node design-system/emit.mjs');
  process.exit(1);
}
console.log(`colorsets: all ${sets.length} have a dark twin, every pair is a relighting, every half clears AA.`);
