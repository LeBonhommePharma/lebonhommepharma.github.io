#!/usr/bin/env node
// Drug of the Day gate. One picker (/assets/dotd.js), one answer per Montréal calendar day,
// for every visitor, on every page. Fails loudly; fails on zero checks.
//
//   node scripts/check-dotd.mjs            run every check
//   node scripts/check-dotd.mjs --emit     (internal) print picks for a fixed instant set
//
// What it proves:
//   1. Timezone invariance: the same instants give the same compound in child processes
//      run under TZ=UTC, America/Toronto, Asia/Tokyo, Pacific/Kiritimati, Pacific/Pago_Pago.
//   2. The boundary is midnight Montréal, in winter (EST) and summer (EDT), across both DST
//      switches and across New Year (no reset on 1 January).
//   3. Zero visible change on deploy: from the epoch to 2026-12-31 the pick equals the old
//      home page's (day-of-year % 63) for a Montréal visitor.
//   4. Every 63-day window shows each compound exactly once.
//   5. Rotation rows agree with drug-of-the-day/queue.json (series, PDB) and every page exists.
//   6. Every consumer — including the /DotD and /rx short links — loads /assets/dotd.js (before
//      app.js where there is one), and none of them carries its own list or day arithmetic.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const D = require(join(ROOT, 'assets/dotd.js'));
const DAY = 86400000;

// Instants that matter: boundaries either side of Montréal midnight in EST and EDT,
// both DST switches, New Year, plus a sweep of every 7 hours over two years.
function instants() {
  const out = [
    '2026-09-09T16:00:00Z', '2026-11-18T04:59:59Z', '2026-11-18T05:00:00Z',
    '2026-12-31T12:00:00Z', '2027-01-01T04:59:59Z', '2027-01-01T05:00:00Z',
    '2027-03-14T04:59:59Z', '2027-03-14T05:00:00Z', '2027-03-14T07:30:00Z', '2027-03-15T03:59:59Z', '2027-03-15T04:00:00Z',
    '2027-07-01T03:59:59Z', '2027-07-01T04:00:00Z',
    '2027-11-07T03:59:59Z', '2027-11-07T04:00:00Z', '2027-11-07T06:30:00Z', '2027-11-08T04:59:59Z', '2027-11-08T05:00:00Z',
  ].map((s) => Date.parse(s));
  for (let t = Date.parse('2026-09-01T00:00:00Z'); t < Date.parse('2028-09-01T00:00:00Z'); t += 7 * 3600000) out.push(t);
  return out;
}

if (process.argv.includes('--emit')) {
  process.stdout.write(instants().map((t) => D.dateKey(new Date(t)) + ' ' + D.forDate(new Date(t)).slug).join('\n'));
  process.exit(0);
}

let passed = 0, failed = 0;
const ok = (name, detail = '') => { passed++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); };
const fail = (name, detail = '') => { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); };
const check = (cond, name, detail) => (cond ? ok(name, detail) : fail(name, detail));
const at = (iso) => D.forDate(new Date(Date.parse(iso)));

const N = D.rotation.length;
console.log(`Drug of the Day gate — ${N} compounds, zone ${D.zone}, epoch ${D.epoch}`);

// 1. Timezone invariance
const zones = ['UTC', 'America/Toronto', 'Asia/Tokyo', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'];
const runs = zones.map((tz) => execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--emit'], { env: { ...process.env, TZ: tz } }).toString());
const lines = runs[0].split('\n').length;
check(lines > 2000, 'instant set is non-trivial', `${lines} instants`);
zones.slice(1).forEach((tz, i) => check(runs[i + 1] === runs[0], `same picks under TZ=${tz} as TZ=UTC`));

// 2. Boundary = midnight Montréal; DST; New Year
check(at('2026-09-09T16:00:00Z').slug === 'cocaine', 'epoch 2026-09-09 → Cocaine HCl #001');
check(at('2026-11-18T04:59:59Z').slug === 'fentanyl' && at('2026-11-18T05:00:00Z').slug === 'salvinorin-a',
  '2026-11-17 23:59:59 EST = Fentanyl; 00:00:00 EST = Salvinorin A');
check(D.dateKey(new Date(Date.parse('2027-07-01T03:59:59Z'))) === '2027-06-30' && D.dateKey(new Date(Date.parse('2027-07-01T04:00:00Z'))) === '2027-07-01',
  'summer boundary is 00:00 EDT (04:00Z), not 01:00');
check(D.dateKey(new Date(Date.parse('2027-03-14T04:59:59Z'))) === '2027-03-13' && D.dateKey(new Date(Date.parse('2027-03-14T07:30:00Z'))) === '2027-03-14' &&
      D.dateKey(new Date(Date.parse('2027-03-15T03:59:59Z'))) === '2027-03-14',
  'spring-forward day 2027-03-14 is one day, midnight to midnight');
check(D.dateKey(new Date(Date.parse('2027-11-07T03:59:59Z'))) === '2027-11-06' && D.dateKey(new Date(Date.parse('2027-11-08T04:59:59Z'))) === '2027-11-07',
  'fall-back day 2027-11-07 is one day, midnight to midnight');
{
  const a = at('2026-12-31T12:00:00Z').index, b = at('2027-01-01T05:00:00Z').index;
  check(b === (a + 1) % N, 'no reset on 1 January', `31 Dec #${a} → 1 Jan #${b}`);
}
{
  let bad = 0, prev = null;
  for (let t = Date.parse('2026-09-09T05:00:00Z'); t < Date.parse('2029-01-01T05:00:00Z'); t += 3600000) {
    const k = D.indexFor(new Date(t));
    if (prev !== null && k !== prev && k !== (prev + 1) % N) bad++;
    prev = k;
  }
  check(bad === 0, 'hourly sweep 2026-09-09 → 2029: index only ever advances by one', bad ? `${bad} jumps` : '');
}

// 3. Zero visible change: old home rule for a Montréal visitor, epoch → 2026-12-31
{
  let diff = 0, days = 0;
  for (let t = Date.UTC(2026, 8, 9, 17); t <= Date.UTC(2026, 11, 31, 17); t += DAY) {
    const dt = new Date(t), y = dt.getUTCFullYear();
    const doy = Math.round((Date.UTC(y, dt.getUTCMonth(), dt.getUTCDate()) - Date.UTC(y, 0, 0)) / DAY);
    days++; if (D.indexFor(dt) !== doy % N) diff++;
  }
  check(days > 100 && diff === 0, 'matches the old home calendar from epoch to 2026-12-31', `${days} days, ${diff} differ`);
}

// 4. Coverage
{
  const seen = new Set();
  for (let k = 0; k < N; k++) seen.add(D.forDate(new Date(Date.parse('2027-02-01T17:00:00Z') + k * DAY)).slug);
  check(seen.size === N, `any ${N} consecutive days show all ${N} compounds once`, `${seen.size} distinct`);
}

// 5. Rotation ↔ queue.json ↔ pages
{
  const queue = JSON.parse(readFileSync(join(ROOT, 'drug-of-the-day/queue.json'), 'utf8')).series;
  const bySlug = new Map(queue.map((e) => [e.slug, e]));
  const slugs = new Set();
  let bad = [];
  for (const r of D.rotation) {
    slugs.add(r.slug);
    const q = bySlug.get(r.slug);
    const page = join(ROOT, 'drug-of-the-day', r.slug, 'index.html');
    if (!q) bad.push(`${r.slug}: not in queue.json`);
    else {
      if (q.id !== r.series) bad.push(`${r.slug}: series ${r.series} ≠ queue ${q.id}`);
      if (String(q.pdb).toLowerCase() !== r.pdb) bad.push(`${r.slug}: pdb ${r.pdb} ≠ queue ${q.pdb}`);
      if (q.href !== r.href) bad.push(`${r.slug}: href ${r.href} ≠ queue ${q.href}`);
    }
    if (!existsSync(page) || statSync(page).size < 1000) bad.push(`${r.slug}: page missing`);
    for (const k of ['name', 'target', 'type', 'cls', 'note']) if (!r[k]) bad.push(`${r.slug}: empty ${k}`);
  }
  check(N > 0 && slugs.size === N, 'rotation slugs unique', `${slugs.size}/${N}`);
  check(bad.length === 0, 'rotation agrees with queue.json and every page exists', bad.slice(0, 5).join('; '));
}

// 6. Consumers: load the picker, carry no picker of their own
{
  const consumers = [
    ['index.html', null],
    ['drug-of-the-day/index.html', null],
    ['flexaid-ds/index.html', 'src="app.js"'],
    ['FlexAIDdS/index.html', 'src="app.js"'],
    ['DotD/index.html', null],   // short link thebonhomme.com/DotD
    ['rx/index.html', null],     // shorter link thebonhomme.com/rx
  ];
  for (const [f, before] of consumers) {
    const s = readFileSync(join(ROOT, f), 'utf8');
    const i = s.indexOf('<script src="/assets/dotd.js"></script>');
    check(i >= 0 && (!before || i < s.indexOf(before)), `${f} loads /assets/dotd.js${before ? ' before app.js' : ''}`);
  }
  // The short links are two copies of one page (GitHub Pages has no server-side redirects).
  check(readFileSync(join(ROOT, 'DotD/index.html'), 'utf8') === readFileSync(join(ROOT, 'rx/index.html'), 'utf8'),
    'DotD/ and rx/ short-link pages are identical');
  const noPicker = ['index.html', 'drug-of-the-day/index.html', 'app.js', 'DotD/index.html', 'rx/index.html',
    'flexaid-ds/index.html', 'flexaid-ds/app.js', 'flexaid-ds/app.jsx', 'flexaid-ds/components.jsx', 'flexaid-ds/sections.jsx',
    'FlexAIDdS/index.html', 'FlexAIDdS/app.js', 'FlexAIDdS/app.jsx', 'FlexAIDdS/components.jsx', 'FlexAIDdS/sections.jsx'];
  const forbidden = [/86400000/, /getFullYear\(\)\s*,\s*0\s*,\s*0/, /drugComplexes\s*=\s*\[/, /var LIST\s*=\s*\[/, /\|cocaine\|/];
  for (const f of noPicker) {
    const s = readFileSync(join(ROOT, f), 'utf8');
    const hit = forbidden.find((re) => re.test(s));
    check(!hit, `${f} has no picker of its own`, hit ? `matches ${hit}` : '');
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (passed === 0 || failed > 0) process.exit(1);
