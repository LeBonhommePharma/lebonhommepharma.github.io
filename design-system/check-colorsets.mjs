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
import { contrast, fmtRatio, isRelighting, HUE_TOL_DEG, CHROMA_GAIN_TOL } from './oklch.mjs';
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

// ── the two targets ─────────────────────────────────────────────────────────
// Colorsets are solved under one of two rules and this guard holds each to its
// own. The rules, and why they are two numbers rather than one, live on
// AA_BODY_WITH_MARGIN and AA_TWIN_FLOOR in emit.mjs — read those before
// changing either. In particular: the identity floor of 4.5 is NOT the AA
// body requirement wearing a different hat, and lowering it to the nominal
// 3:1 non-text threshold collapses three light twins onto their dark halves.
//
// Which colorset gets which rule is READ FROM roles.json, emitted beside the
// catalog. It is not restated here, because a second hand-written list is a
// second thing to drift.
const ROLES_FILE = 'roles.json';

// Contrast is compared AS MEASURED and rounded only to print. `contrast()`
// returns the unrounded ratio for exactly this reason — see oklch.mjs. Both
// BrandFgMuted (4.497589) and BrandStateFailText (4.497018) passed this guard
// while strictly failing AA, because the ratio was rounded to 4.5 before it
// reached the `< AA_BODY` below. Every comparison here reads the real number;
// `fmtRatio` appears only inside template strings and table cells.
//
// No epsilon. WCAG AA says >= 4.5, so the bar is >= 4.5.

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

// ── role targets ────────────────────────────────────────────────────────────
// For OUR generated catalog roles.json must be present: it is emitted by the
// same run that writes the colorsets, so its absence means a mis-generate, and
// a mis-generate must not fall back to a looser rule silently.
//
// For a FOREIGN catalog (--catalog, e.g. NATURaL's own) there is no roles.json
// and there should not be. That case falls back to a single 4.5 bar for every
// colorset and says so out loud, because a guard applying a different rule
// than the one it printed is the whole failure mode this file exists to avoid.
const IS_OWN_CATALOG = CATALOG === join(HERE, 'dist', 'BrandColors.xcassets');
let roles = null;
{
  const rp = join(CATALOG, ROLES_FILE);
  if (existsSync(rp)) {
    roles = JSON.parse(readFileSync(rp, 'utf8'));
  } else if (IS_OWN_CATALOG) {
    console.error(`FATAL: no ${ROLES_FILE} beside the generated catalog at ${CATALOG}.`);
    console.error('       Refusing to run — without it this guard cannot tell which colorset is');
    console.error('       held to which target, and defaulting to the looser one would let a body');
    console.error('       token ship under the rule written for a non-text hue.');
    console.error('       Regenerate: node design-system/emit.mjs');
    process.exit(2);
  }
}

const targetFor = (name) => {
  if (!roles) return AA_BODY;
  const e = roles.colorsets?.[name];
  if (!e) {
    console.error(`FATAL: ${name} is in the catalog but absent from ${ROLES_FILE}.`);
    console.error('       Refusing to run — an unlisted colorset would silently take whatever');
    console.error('       default this guard happened to have. Add it to CATALOG_SOURCES in');
    console.error('       emit.mjs with an explicit role and regenerate.');
    process.exit(2);
  }
  return e.target;
};


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

  // ── boundary cases ────────────────────────────────────────────────────────
  // WHY THESE EXIST
  //
  // Every assertion above this point uses values that sit far from their
  // threshold: white-on-black is 21 against a bar of 4.5, retired v1 cyan
  // misses the hue tolerance by 47° against a bar of 3°. Not one of them can
  // detect a guard that ROUNDS its measurement before comparing it, because
  // rounding 21 or 47 changes nothing. That is how the rounding defect lived
  // here through a green self-test: the suite only ever asked obvious
  // questions.
  //
  // Each pair below straddles one threshold by the smallest margin 8-bit sRGB
  // allows, and — this is the load-bearing part — BOTH MEMBERS OF EACH PAIR
  // ARE IDENTICAL ONCE ROUNDED FOR DISPLAY. A guard that compares the rounded
  // value must return the same verdict for both, so `sayDiffer` fails. A
  // guard that compares the real number separates them.
  //
  // Do not "simplify" these to round numbers. Their whole value is that they
  // are not round.
  const sayDiffer = (a, b, label) => {
    const good = a !== b;
    console.log(`  ${good ? 'ok    ' : 'BROKEN'} ${label}`);
    if (!good) {
      console.log(`         both verdicts came back ${JSON.stringify(a)} — the comparison is`);
      console.log('         not reading the real number. Something upstream is rounding.');
      ok = false;
    }
  };

  // 1. the contrast threshold, AA_BODY = 4.5, measured on the ivory ground.
  //    #796879 = 4.4999986968 · #C53B3E = 4.5000001310 · both print as 4.5.
  const cUnder = contrast('#796879', IVORY);
  const cOver = contrast('#C53B3E', IVORY);
  say(fmtRatio(cUnder) === fmtRatio(cOver), 'the contrast pair is indistinguishable at 2 dp (both 4.5)');
  sayDiffer(cUnder >= AA_BODY, cOver >= AA_BODY, 'contrast 4.4999987 vs 4.5000001 get different verdicts');
  say(cUnder < AA_BODY, '  …and the one below 4.5 is the one that fails');
  say(cOver >= AA_BODY, '  …and the one at/above 4.5 is the one that passes');

  // 1b. the SECOND target, AA_BODY_WITH_MARGIN = 4.55, measured on the same
  //     ground. A boundary pair per target, not per guard: the body rule and
  //     the identity rule are different numbers and each needs its own proof
  //     that the comparison reads the real value. Without this, someone could
  //     make the body comparison round and only the 4.5 pair above would
  //     notice.
  //     #B519D1 = 4.5499991630 · #9247CF = 4.5500003399 · both print as 4.55.
  //     The target is READ FROM roles.json, never restated here. An earlier
  //     draft of this block hardcoded 4.55 and compared it against a hardcoded
  //     4.5 — which meant changing the real constant in emit.mjs left the
  //     assertion passing against two literals that had nothing to do with it.
  //     That is the same "the instrument agrees with itself" failure this file
  //     exists to catch, rebuilt inside the test for it.
  const BODY_TARGET = roles?.targets?.body ?? null;
  const IDENTITY_TARGET = roles?.targets?.identity ?? null;
  if (BODY_TARGET === null) {
    console.log('  skip   no roles.json — the per-role boundary cases need the real targets');
  } else {
    const mUnder = contrast('#B519D1', IVORY);
    const mOver = contrast('#9247CF', IVORY);
    // The fixtures straddle 4.55 specifically. If the target moves, they stop
    // testing anything — so that is a hard failure demanding new fixtures, not
    // a quiet pass.
    say(
      mUnder < BODY_TARGET && mOver >= BODY_TARGET,
      `the boundary fixtures still straddle the configured body target (${BODY_TARGET})`
    );
    if (!(mUnder < BODY_TARGET && mOver >= BODY_TARGET)) {
      console.log(`         #B519D1 = ${mUnder.toFixed(7)} and #9247CF = ${mOver.toFixed(7)} no longer`);
      console.log(`         bracket ${BODY_TARGET}. Regenerate the pair for the new target — do not`);
      console.log('         delete this case.');
    }
    say(fmtRatio(mUnder) === fmtRatio(mOver), '  …and are indistinguishable at 2 dp');
    sayDiffer(mUnder >= BODY_TARGET, mOver >= BODY_TARGET, `contrast 4.5499992 vs 4.5500003 get different verdicts at ${BODY_TARGET}`);
  }

  // 1c. the two targets must stay two numbers. If someone "simplifies" the
  //     rule back to a single bar, the whole per-role structure is gone and
  //     the identity floor's separate reason — twin collapse at 3:1 — goes
  //     with it. This is the assertion that notices.
  if (BODY_TARGET !== null && IDENTITY_TARGET !== null) {
    say(BODY_TARGET !== IDENTITY_TARGET, `the body target (${BODY_TARGET}) and the identity floor (${IDENTITY_TARGET}) are still two different numbers`);
    if (BODY_TARGET === IDENTITY_TARGET) {
      console.log('         Collapsing them to one bar removes the per-role structure, and with');
      console.log('         it the identity floor\'s separate reason: below 4.5 three light twins');
      console.log('         solve to their own dark value. See AA_TWIN_FLOOR in emit.mjs.');
    }
    say(contrast('#6C6C7B', IVORY) >= IDENTITY_TARGET && contrast('#6C6C7B', IVORY) < BODY_TARGET,
        'BrandFg at the old single bar (4.500601) clears the identity floor but NOT the body target');
  }

  // 2. the hue tolerance, HUE_TOL_DEG = 3°, against canonical violet.
  //    #12092C = 2.999996° · #8B8A96 = 3.000010° · both print as 3°.
  //    Chroma is inside tolerance in both, so hue alone decides.
  const hUnder = isRelighting('#8B5CF6', '#12092C');
  const hOver = isRelighting('#8B5CF6', '#8B8A96');
  say(hUnder.dh === hOver.dh, 'the hue pair is indistinguishable at 2 dp (both 3°)');
  sayDiffer(hUnder.hueOk, hOver.hueOk, 'hue 2.999996° vs 3.000010° get different verdicts');

  // 3. the chroma-gain tolerance, CHROMA_GAIN_TOL = 0.05, against violet.
  //    #6F14EA = +0.049999 · #772FFA = +0.050002 · both print as 0.05.
  //    Hue is inside tolerance in both, so chroma alone decides.
  const kUnder = isRelighting('#8B5CF6', '#6F14EA');
  const kOver = isRelighting('#8B5CF6', '#772FFA');
  say(kUnder.dc === kOver.dc, 'the chroma pair is indistinguishable at 3 dp (both 0.05)');
  sayDiffer(kUnder.chromaOk, kOver.chromaOk, 'chroma +0.049999 vs +0.050002 get different verdicts');

  // 4. lightness-must-differ. The threshold is 1e-6, far below what 8-bit
  //    sRGB can express, so the real boundary is "same hex" vs "one LSB
  //    apart". Both sides are asserted so neither can rot unnoticed.
  const lSame = isRelighting('#8B5CF6', '#8B5CF6');
  const lNext = isRelighting('#8B5CF6', '#8B5CF7');
  sayDiffer(lSame.lightnessMoved, lNext.lightnessMoved, 'identical hex vs one LSB apart get different verdicts');
  say(!lSame.lightnessMoved, '  …identical hex has not moved');
  say(lNext.lightnessMoved, '  …one LSB apart has');

  // 5. the regression itself, kept as a fixture. These are the two values that
  //    shipped green: both printed 4.5, both strictly failed.
  say(contrast('#6B6A8D', IVORY) < AA_BODY, 'BrandFgMuted-as-shipped (4.497589) is correctly BELOW 4.5');
  say(contrast('#C8373E', IVORY) < AA_BODY, 'BrandStateFailText-as-shipped (4.497018) is correctly BELOW 4.5');
  say(contrast('#6B6A8C', IVORY) >= AA_BODY, 'BrandFgMuted re-solved (4.504146) clears 4.5');
  say(contrast('#C7373E', IVORY) >= AA_BODY, 'BrandStateFailText re-solved (4.527539) clears 4.5');

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
if (!roles) {
  console.log(`\n  NOTE  no ${ROLES_FILE} in this catalog — holding every colorset to a single`);
  console.log(`        ${AA_BODY}:1 bar. That is the right rule for a catalog this repo did not`);
  console.log('        generate; it is not the two-target rule the generated one uses.');
}
let fail = 0;
const missing = [];
const problems = [];

console.log(`\n── ${sets.length} colorsets\n`);
console.log(`${'colorset'.padEnd(22)}${'target'.padEnd(8)}${'light'.padEnd(10)}${'on ivory'.padEnd(10)}${'dark'.padEnd(10)}${'on ink'.padEnd(9)}relight`);
console.log('─'.repeat(86));

for (const s of sets) {
  const isGround = GROUND_SETS.has(s.name);
  if (!s.dark) {
    missing.push(s.name);
    console.log(`${s.name.padEnd(22)}${''.padEnd(8)}${(s.light ?? '—').padEnd(10)}${''.padEnd(10)}${'MISSING'.padEnd(10)}${''.padEnd(9)}—`);
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
  const bar = isGround ? null : targetFor(s.name);
  console.log(
    `${s.name.padEnd(22)}${String(bar ?? 'ground').padEnd(8)}${s.light.padEnd(10)}${String(fmtRatio(cl) ?? 'ground').padEnd(10)}${s.dark.padEnd(10)}${String(fmtRatio(cd) ?? 'ground').padEnd(9)}${isGround ? 'ground' : rel.ok ? 'ok' : 'NO'}`
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
    // Reported to 6 dp as well as 2. A near-miss like 4.497589 prints as
    // "4.5" at 2 dp, which reads as a broken guard rather than a real failure;
    // the precise figure is the evidence that it is not.
    const role = roles?.colorsets?.[s.name]?.role ?? 'single-bar';
    if (cl < bar) {
      problems.push(`${s.name}: light ${s.light} on ivory ${IVORY} = ${fmtRatio(cl)}:1 (${cl.toFixed(6)}) — below its ${role} target (${bar}:1)${cl >= AA_LARGE ? ', large text only' : ', below the 3:1 non-text floor'}`);
      fail++;
    }
    if (cd < bar) {
      problems.push(`${s.name}: dark ${s.dark} on ink ${INK} = ${fmtRatio(cd)}:1 (${cd.toFixed(6)}) — below its ${role} target (${bar}:1)${cd >= AA_LARGE ? ', large text only' : ', below the 3:1 non-text floor'}`);
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
