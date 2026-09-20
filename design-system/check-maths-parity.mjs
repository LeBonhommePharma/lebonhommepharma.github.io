#!/usr/bin/env node
/**
 * design-system/check-maths-parity.mjs — the shell guard's Python maths must
 * agree with oklch.mjs.
 *
 * WHY THIS EXISTS
 * ---------------
 * The colour maths lived in four copies. Three of them are JavaScript and now
 * import oklch.mjs — one definition, no drift possible. The fourth is the
 * Python block embedded in `scripts/check-design-system.sh`, and it cannot
 * import a JS module: it is a genuine cross-language port, not a copy that can
 * be deleted.
 *
 * Rewriting the shell guard to call node instead would collapse the port, but
 * it would also change that guard's documented failure mode — it currently
 * fails CLOSED when python3 is missing, reporting every candidate line rather
 * than excusing one it cannot evaluate. Trading a proven failure mode for
 * tidiness is a bad trade. So the port stays and this pins it.
 *
 * What the duplication has already cost, twice:
 *   · a copy dropped the /255 normalisation — white on black measured
 *     10,498,937:1 and every hue angle was noise
 *   · a copy carried `Math.round(r * 100) / 100` into a threshold comparison —
 *     two colorsets shipped below WCAG AA reported as passing
 *
 * Nobody gets a third.
 *
 * WHAT IT ASSERTS
 * ---------------
 * 1. The Python block is still extractable. A mis-parse must not look like a
 *    pass, so failing to find it is a hard exit 2, not a skip.
 * 2. L and C agree to 1e-12 on every input.
 * 3. Hue agrees to 1e-9° on every CHROMATIC input. Hue is deliberately not
 *    asserted on near-achromatic colours: at C→0 the angle is atan2 of two
 *    near-zero numbers and is numerically meaningless, which is exactly why
 *    both implementations carry an achromatic branch. Asserting there would
 *    be asserting noise.
 * 4. Zero divergence in the RELIGHT VERDICT — hue within tolerance, chroma
 *    gain within tolerance, lightness moved — over every canonical × input
 *    pair. This is the decision the guard actually makes, and it is the one
 *    that has to match.
 *
 * Skips, loudly, if python3 is absent: in that state check-design-system.sh
 * does not run the Python maths at all, so there is nothing to be in parity
 * with.
 *
 * Usage: check-maths-parity.mjs [--verbose]
 */

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { lch, isRelighting, HUE_TOL_DEG, CHROMA_GAIN_TOL } from './oklch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHELL_GUARD = join(HERE, '..', 'scripts', 'check-design-system.sh');
const VERBOSE = process.argv.includes('--verbose');

const L_C_TOL = 1e-12;      // measured worst case 7.8e-16
const HUE_TOL_DEG_PARITY = 1e-9;  // measured worst case 1.3e-12° on chromatic input
const ACHROMATIC_C = 0.02;  // the threshold both implementations already use

const py3 = spawnSync('python3', ['-c', 'pass']);
if (py3.status !== 0) {
  console.log('── maths parity');
  console.log('  SKIP  python3 is not available.');
  console.log('        scripts/check-design-system.sh falls back to reporting every');
  console.log('        candidate line unfiltered when python3 is missing, so its Python');
  console.log('        maths is not in use and there is nothing to compare against.');
  process.exit(0);
}

// ── 1. extract the Python block, verbatim ───────────────────────────────────
const sh = readFileSync(SHELL_GUARD, 'utf8');
const begin = sh.indexOf('import sys,re,math');
const stop = sh.indexOf('PAIR=re.compile', begin);
if (begin < 0 || stop < 0) {
  console.error('FATAL: could not locate the Python maths block in scripts/check-design-system.sh.');
  console.error('       Refusing to run — a mis-parse must not report a clean parity check.');
  process.exit(2);
}
let core = sh.slice(begin, stop);
core = core.split('\n').filter((l) => !l.startsWith('HUE_TOL=')).join('\n');
for (const need of ['def s2l(', 'def lch(', 'M=[[', 'N=[[']) {
  if (!core.includes(need)) {
    console.error(`FATAL: extracted Python block is missing ${need} — extraction is stale.`);
    process.exit(2);
  }
}

// ── the shared input set ────────────────────────────────────────────────────
// Loaded with near-threshold cases on purpose. Agreement on #FFFFFF proves
// nothing about agreement at 4.4999987.
const NAMED = [
  '#0071B5','#6C6C7B','#6B6A8C','#DC001B','#6D6C74','#007C58','#C7373E','#D40074','#A25C00','#7E4CE6','#F3EFE7',
  '#00A2FF','#E4E3F5','#8D8CB0','#F5232B','#DCDCE4','#45E0A8','#FF6B6B','#FF2F92','#FF9300','#8B5CF6','#08091A',
  '#6B6A8D','#C8373E','#796879','#C53B3E','#12092C','#8B8A96','#6F14EA','#772FFA','#8B5CF7',
  // palette-check-ignore-start — fixtures. The retired v1 hexes are in the
  // input set on purpose: they are the values scripts/check-design-system.sh
  // has to keep rejecting, so they are exactly the inputs whose hue the two
  // implementations must agree on. Same marker check-colorsets.mjs uses for
  // its own negative fixtures.
  '#22D3EE','#A84B2F','#E8D5B7','#FBBF24','#C4A359','#8B1A4A',
  '#000000','#FFFFFF','#FF0000','#00FF00','#0000FF','#010101','#FEFEFE','#808080','#0A0E14','#F4F6FB',
  // palette-check-ignore-end
];
let seed = 20260920 >>> 0;
const sweep = [];
for (let i = 0; i < 4000; i++) {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  sweep.push('#' + (seed & 0xffffff).toString(16).padStart(6, '0').toUpperCase());
}
const ALL = [...NAMED, ...sweep];

// ── 2. run the Python port on the same inputs ───────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'ds-parity-'));
const runner = join(dir, 'run.py');
writeFileSync(join(dir, 'inputs.json'), JSON.stringify(ALL));
writeFileSync(
  runner,
  core +
    `
import json
inp = json.load(open(${JSON.stringify(join(dir, 'inputs.json'))}))
json.dump([list(lch(h)) for h in inp], open(${JSON.stringify(join(dir, 'out.json'))}, 'w'))
`
);
execFileSync('python3', [runner], { stdio: 'pipe' });
const pyOut = JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8'));
if (pyOut.length !== ALL.length) {
  console.error(`FATAL: python returned ${pyOut.length} rows for ${ALL.length} inputs.`);
  process.exit(2);
}

// ── 3. compare ──────────────────────────────────────────────────────────────
console.log('── maths parity: scripts/check-design-system.sh (python) vs oklch.mjs');
let worstL = 0, worstC = 0, worstH = 0, atL = null, atC = null, atH = null;
let chromatic = 0;
const fails = [];
const toDeg = (r) => (r * 180) / Math.PI;

for (let i = 0; i < ALL.length; i++) {
  const hex = ALL[i];
  const a = lch(hex);
  const [pL, pC, pH] = pyOut[i];
  const dL = Math.abs(a.L - pL);
  const dC = Math.abs(a.C - pC);
  if (dL > worstL) { worstL = dL; atL = hex; }
  if (dC > worstC) { worstC = dC; atC = hex; }
  if (dL > L_C_TOL) fails.push(`${hex}: L differs by ${dL.toExponential(3)} (tolerance ${L_C_TOL})`);
  if (dC > L_C_TOL) fails.push(`${hex}: C differs by ${dC.toExponential(3)} (tolerance ${L_C_TOL})`);
  if (a.C >= ACHROMATIC_C && pC >= ACHROMATIC_C) {
    chromatic++;
    const dH = Math.abs(toDeg(a.h - pH));
    if (dH > worstH) { worstH = dH; atH = hex; }
    if (dH > HUE_TOL_DEG_PARITY) fails.push(`${hex}: hue differs by ${dH.toExponential(3)}° (tolerance ${HUE_TOL_DEG_PARITY}°)`);
  }
}

// ── 4. the decision that actually matters: relight verdicts ─────────────────
const CANON = ['#45E0A8','#8B5CF6','#FF9300','#F5232B','#00A2FF','#FF2F92','#DCDCE4','#E4E3F5','#8D8CB0','#FF6B6B'];
const pyByHex = new Map(ALL.map((h, i) => [h, pyOut[i]]));
let verdictPairs = 0;
const verdictFails = [];
for (const c of CANON) {
  const [cL, cC, cH] = pyByHex.get(c) ?? (() => { const x = lch(c); return [x.L, x.C, x.h]; })();
  for (const t of ALL) {
    const [tL, tC, tH] = pyByHex.get(t);
    const dh = Math.abs((((tH - cH) * 180) / Math.PI + 180) % 360 - 180);
    const achromatic = cC < ACHROMATIC_C && tC < ACHROMATIC_C;
    const pyOk = (achromatic || dh <= HUE_TOL_DEG) && tC - cC <= CHROMA_GAIN_TOL && Math.abs(tL - cL) > 1e-6;
    const jsOk = isRelighting(c, t).ok;
    verdictPairs++;
    if (pyOk !== jsOk) verdictFails.push(`${c} → ${t}: python says ${pyOk}, oklch.mjs says ${jsOk}`);
  }
}

console.log(`  ${ALL.length} inputs · ${chromatic} chromatic · ${verdictPairs} relight verdicts compared`);
if (VERBOSE || fails.length) {
  console.log(`  worst |ΔL| ${worstL.toExponential(3)} at ${atL}`);
  console.log(`  worst |ΔC| ${worstC.toExponential(3)} at ${atC}`);
  console.log(`  worst |Δhue| ${worstH.toExponential(3)}° at ${atH} (chromatic only)`);
}

if (fails.length || verdictFails.length) {
  console.log(`\n  FAIL  the two implementations have drifted apart.`);
  for (const f of fails.slice(0, 20)) console.log(`        ${f}`);
  if (fails.length > 20) console.log(`        … and ${fails.length - 20} more`);
  for (const f of verdictFails.slice(0, 20)) console.log(`        VERDICT ${f}`);
  console.log('');
  console.log('        oklch.mjs is the source of truth. Bring the Python block in');
  console.log('        scripts/check-design-system.sh back into line with it — do not');
  console.log('        widen the tolerances here to make this quiet.');
  process.exit(1);
}

console.log(`  PASS  L and C within ${L_C_TOL}, hue within ${HUE_TOL_DEG_PARITY}° on chromatic input,`);
console.log(`        and all ${verdictPairs} relight verdicts identical.`);
