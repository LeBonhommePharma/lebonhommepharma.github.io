#!/usr/bin/env bash
#
# Guard the entropy-docking thermodynamic panel against display drift.
#
# WHAT WENT WRONG, AND WHY A GREP WOULD NOT HAVE CAUGHT IT
# --------------------------------------------------------
# The panel carried the same five quantities in two places: hand-typed in the
# static markup, and computed in the animation loop. Nothing tied them together,
# so they drifted — the markup described 300 K / ΔG −8.2 / K_D 1.12 µM while the
# first animation frame produced 325 K / ΔG −7.67 / K_D 6.96 µM. Clicking to
# begin moved K_D by a factor of six with no user input.
#
# Worse, neither pair was self-consistent to the precision it printed. ΔG was
# rounded to one decimal and K_D to three significant figures, each derived
# independently from a hidden full-precision value. One decimal on ΔG is
# ±0.05 kcal/mol, which at RT ≈ 0.6 is ±8% on exp(ΔG/RT). Measured across the
# page's own BPM slider, 16 of 19 positions printed a K_D that could not be
# reproduced from the ΔG printed beside it.
#
# A reader only ever has the digits on screen. So this checks the identities
# AS PRINTED, from the static markup:
#
#   1. ΔG = ΔH + (−TΔS)          exact, in the printed 2-dp digits
#   2. K_D = exp(ΔG / RT)        exact, through the page's OWN fmtKd ladder
#   3. ΔG is U+2212 and 2 dp     the site's thermodynamic convention
#   4. no U+2206                 not in JetBrains Mono; falls back to another face
#
# Check 2 does not reimplement the unit ladder. It lifts fmtKd() out of the page
# and runs it, so the checker cannot pass because its private copy of the ladder
# drifted the same way the numbers did. R_KCAL is read from the page too.
#
# Usage:  scripts/check-entropy-thermo.sh             # check the page
#         scripts/check-entropy-thermo.sh --self-test # prove the checks can fail
#
# A check that cannot fail is not a check.

set -euo pipefail
cd "$(dirname "$0")/.."

PAGE="entropy-docking/index.html"
PROBE="$(mktemp -t entropy-thermo-probe.XXXXXX)"
trap 'rm -f "$PROBE"' EXIT

cat > "$PROBE" <<'NODE'
const { readFileSync } = require('node:fs');
const file = process.argv[2];
const src = readFileSync(file, 'utf8');

let failed = 0;
const fail = (m) => { console.log('  ✗ ' + m); failed++; };
const pass = (m) => console.log('  ✓ ' + m);

// --- lift a function's source out of the page, by brace matching ---
function lift(name, header) {
  const i = src.indexOf(header);
  if (i < 0) throw new Error('cannot find ' + name + ' in ' + file);
  let d = 0, j = src.indexOf('{', i);
  const start = j;
  for (; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (d === 0) break; }
  }
  return src.slice(i, j + 1);
}

// The page's own ladder and gas constant. Not a copy — the real thing.
const fmtKdSrc = lift('fmtKd', 'function fmtKd(');
const rm = src.match(/const\s+R_KCAL\s*=\s*([0-9.eE+-]+)\s*;/);
if (!rm) { console.log('  ✗ R_KCAL not found in ' + file); process.exit(1); }
const R_KCAL = Number(rm[1]);
const fmtKd = new Function(fmtKdSrc + '; return fmtKd;')();

// --- the static HUD values, as a no-JS visitor sees them ---
const pick = (id) => {
  const m = src.match(new RegExp('id="' + id + '"[^>]*>([^<]*)<'));
  return m ? m[1].trim() : null;
};
const raw = { T: pick('tempK'), G: pick('deltaG'), H: pick('deltaH'),
              S: pick('minusTdS'), K: pick('kdVal') };
for (const [k, v] of Object.entries(raw)) {
  if (v === null) { console.log('  ✗ static markup: #' + k + ' not found'); process.exit(1); }
}
const n = (s) => Number(String(s).replace(/−/g, '-').replace(/[^0-9.eE+-]/g, ''));
const T = n(raw.T), G = n(raw.G), H = n(raw.H), S = n(raw.S);
const q2 = (x) => Math.round(x * 100) / 100;

console.log('  static frame: T=' + raw.T + '  ΔG=' + raw.G + '  ΔH=' + raw.H +
            '  −TΔS=' + raw.S + '  K_D=' + raw.K);

// 1. U+2206 anywhere in the page
if (src.includes('∆')) {
  const ctx = src.split('\n').map((l, i) => l.includes('∆') ? (i + 1) : 0).filter(Boolean);
  fail('U+2206 INCREMENT at line(s) ' + ctx.join(', ') + ' — use U+0394 GREEK CAPITAL DELTA');
} else pass('no U+2206; every Δ is U+0394');

// 2. ΔG glyph and precision
if (/-/.test(raw.G)) fail('ΔG uses U+002D HYPHEN-MINUS; the site uses U+2212 MINUS SIGN');
else if (!/^−?\d+\.\d{2}\s/.test(raw.G)) fail('ΔG is not 2 dp: ' + JSON.stringify(raw.G));
else pass('ΔG is U+2212 and 2 dp');

// 3. ΔG = ΔH + (−TΔS), in printed digits
if (q2(H + S) !== q2(G)) {
  fail('ΔH + (−TΔS) = ' + q2(H + S).toFixed(2) + ' but ΔG is printed as ' + G.toFixed(2));
} else pass('ΔG = ΔH + (−TΔS) holds in the printed digits');

// 4. K_D = exp(ΔG/RT), in printed digits, through the page's own ladder
const kdFromPrinted = fmtKd(Math.exp(G / (R_KCAL * T)));
if (kdFromPrinted !== raw.K) {
  fail('K_D printed as ' + raw.K + ' but exp(ΔG/RT) from the printed ΔG and T is ' +
       kdFromPrinted + '  (RT = ' + (R_KCAL * T).toFixed(4) + ' kcal/mol)');
} else pass('K_D = exp(ΔG/RT) holds in the printed digits (' + kdFromPrinted + ')');

process.exit(failed ? 1 : 0);
NODE

if [ "${1:-}" = "--self-test" ]; then
  echo "self-test: each mutation must make the checker FAIL"
  TMP="$(mktemp -d -t entropy-thermo-selftest.XXXXXX)"
  trap 'rm -f "$PROBE"; rm -rf "$TMP"' EXIT
  rc=0

  try_mutation() {
    local name="$1" sedexpr="$2"
    local f="$TMP/mutant.html"
    # perl, not sed: the patterns carry multibyte U+2212 / U+2206.
    perl -CSD -pe "$sedexpr" "$PAGE" > "$f"
    if cmp -s "$PAGE" "$f"; then
      echo "  ✗ $name — mutation changed nothing; the fixture is stale"
      rc=1
      return
    fi
    if node "$PROBE" "$f" > "$TMP/out.txt" 2>&1; then
      echo "  ✗ $name — checker PASSED a file it should have rejected"
      sed 's/^/      /' "$TMP/out.txt"
      rc=1
    else
      echo "  ✓ $name — rejected, as it must be"
    fi
  }

  try_mutation "K_D digits changed"        's{id="kdVal"([^>]*)>[^<]*<}{id="kdVal"$1>1.12 \x{00B5}M<}'
  try_mutation "ΔG dropped to 1 dp"        's{id="deltaG"([^>]*)>[^<]*<}{id="deltaG"$1>\x{2212}7.7 kcal/mol<}'
  try_mutation "ΔG uses ASCII hyphen"      's{id="deltaG"([^>]*)>[^<]*<}{id="deltaG"$1>-7.67 kcal/mol<}'
  try_mutation "ΔH broken, sum no longer ΔG" 's{id="deltaH"([^>]*)>[^<]*<}{id="deltaH"$1>\x{2212}12.40 kcal/mol<}'
  try_mutation "temperature changed, K_D not" 's{id="tempK"([^>]*)>[^<]*<}{id="tempK"$1>310.0 K<}'
  try_mutation "a Δ regressed to U+2206"   's{\x{0394}G_bind}{\x{2206}G_bind}'

  echo
  [ $rc -eq 0 ] && echo "self-test: OK — every check demonstrably fails when it should" \
                || echo "self-test: FAILED"
  exit $rc
fi

echo "entropy-docking thermodynamic panel — $PAGE"
node "$PROBE" "$PAGE"
echo "OK: the printed panel is a self-consistent thermodynamic state."
