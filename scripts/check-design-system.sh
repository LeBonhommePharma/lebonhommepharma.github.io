#!/usr/bin/env bash
#
# Guard that every page actually CONSUMES the FlexAID∆S design system,
# rather than hand-copying it.
#
# WHY THIS EXISTS ALONGSIDE check-palette-v2.sh
# ---------------------------------------------
# check-palette-v2.sh forbids the retired v1 hexes. That is necessary and
# not sufficient: it only knows the colours v1 used. It cannot see a page
# that restates the system in its own :root and then drifts to a colour v1
# never had. Both of these passed the palette guard for months:
#
#     --terra: #A84B2F;    (/flexaid/)              rust, in the TΔS slot
#     --gold:  #E8D5B7;    (10 drug-of-the-day pages) sand, in the ΔG slot
#
# Neither hex is retired, so neither was forbidden — but a key colour in the
# wrong quantity IS the drift the palette work was meant to end. The binding
# of colour to thermodynamic quantity is the system; a page that rebinds one
# has left the system while passing every colour check.
#
# The root cause was duplication: 90 of 92 pages defined the tokens locally
# instead of linking them, so there were 90 places for a value to rot. So
# check 1 forbids the duplication itself, and check 2 catches a rebind in
# whatever local block survives.
#
# Usage:  scripts/check-design-system.sh             # scan the tree
#         scripts/check-design-system.sh --self-test # only prove the checks work

set -euo pipefail
cd "$(dirname "$0")/.."

# ── pages exempt from check 1, each for a stated reason ──────────────────
# design/palette-v2/     the exploration board — it renders the palette from
#                        its own frozen CSS because its early rounds are the
#                        rejected candidates; binding it to the live system
#                        would rewrite the history it exists to show
# benchmark/             a bespoke steel/slate scheme, never on the system;
#                        converting it is a redesign, not a token swap
# entropy-driven/        hashed Vite build artifact, source not in this repo —
#                        rebuild from source to move it onto the system
EXEMPT_RE='^(design/palette-v2/|benchmark/|entropy-driven/)'

# The token layer, or the element layer that @imports it.
LINKS_DS_RE='(tokens\.css|colors_and_type\.css)'

# ── check 2: a key colour must carry its own quantity ────────────────────
# Each pattern matches a DEFINITION of the token bound to anything other
# than its system value (the hex, or a var() alias of the right token).
# Written with negative lookahead, so a new wrong value fails by default
# rather than needing to be enumerated first.
declare -a BIND_RES=(
  '(?i)--teal\s*+:\s*+(?!var\(--mint\)|#45E0A8)'
  '(?i)--mint\s*+:\s*+(?!#45E0A8)'
  '(?i)--terra\s*+:\s*+(?!var\(--violet\)|#8B5CF6)'
  '(?i)--violet\s*+:\s*+(?!#8B5CF6)'
  '(?i)--gold\s*+:\s*+(?!var\(--tangerine\)|#FF9300)'
  '(?i)--tangerine\s*+:\s*+(?!#FF9300)'
  '(?i)--firetruck\s*+:\s*+(?!#F5232B)'
  '(?i)--aqua\s*+:\s*+(?!#00A2FF)'
  '(?i)--strawberry\s*+:\s*+(?!#FF2F92)'
  '(?i)--magnesium\s*+:\s*+(?!#DCDCE4)'
)

# ── check 3: the body face is the system's, not a per-page pick ──────────
# JetBrains Mono carries headings and every number; the sans is prose only.
# Inter and bare system-ui both shipped as --font-body before this guard.
#
# Only the FIRST family in the stack is checked. An earlier version scanned
# the whole declaration and flagged the canonical stack itself, because that
# stack legitimately ends '-apple-system, BlinkMacSystemFont, "Helvetica
# Neue", sans-serif' — the fallbacks are not the choice, the head of the
# list is.
FONT_RE='(?i)--font-(body|sans)\s*+:\s*+["'"'"']?(Inter|system-ui|Roboto|Segoe|Geist|Arial|Verdana|Tahoma)\b'

BINARY_RE='(\.(png|jpe?g|gif|ico|pdf|woff2?|ttf|otf|zip)$|(^|/)\.DS_Store$)'

# ── files exempt from checks 2 and 3 ─────────────────────────────────────
# Same set check-palette-v2.sh excludes, for the same stated reasons, plus
# scripts/ — a checker has to be able to name what it forbids, and both
# guards carry the bad values as self-test fixtures.
SCAN_EXCLUDE_RE='^(design/palette-v2/|transit/|style\.css$|assets/index-[A-Za-z0-9_-]+\.css$|scripts/)'

# Prose that documents drift rather than committing it, wrapped in the same
# markers check-palette-v2.sh uses.
IGNORE_START='palette-check-ignore-start'
IGNORE_END='palette-check-ignore-end'

# A light/day theme legitimately DARKENS the triad so it holds contrast on a
# light ground — #0E90AE is still ΔH, just rendered for a white page. The
# binding to the quantity is what this guard protects, not the exact hex, so
# a rebind on a line that also carries a light-theme selector is allowed.
# (Matched on the same line because the pages that do this are minified.)
LIGHT_CTX_RE='data-theme\s*=\s*["'"'"']?(day|light)'

fail=0
note() { printf '  %s\n' "$*"; }

# ── 0. the regex engine must actually support lookahead ──────────────────
# Same reason as check-palette-v2.sh: every pattern above is a negative
# lookahead. Under POSIX ERE they would match the literal "(?!" and find
# nothing, reporting a clean tree that was never checked.
if ! printf -- '--terra: #A84B2F\n--terra: #8B5CF6\n' | grep -qP -e '--terra\s*+:\s*+(?!#8B5CF6)'; then
  echo "FATAL: grep -P (PCRE) unavailable or lookahead unsupported."
  echo "       Refusing to run — a degraded pattern would report a false pass."
  exit 2
fi

# ── 1. self-test ─────────────────────────────────────────────────────────
self_test() {
  local ok=1
  # Must FLAG these — the real drift this guard was written for.
  local -a bad=(
    'BIND_RES[2]|      --terra: #A84B2F;|rust in the TΔS slot (/flexaid/)'
    'BIND_RES[4]|  --gold:        #E8D5B7;|sand in the ΔG slot (drug pages)'
    'BIND_RES[0]|--teal: #22D3EE;|v1 cyan in the ΔH slot'
    'BIND_RES[6]|--firetruck: #FF2600;|maraschino in the T slot'
    'FONT_RE|  --font-body:   "Inter", system-ui, sans-serif;|Inter as the body face'
    'FONT_RE|:root { --font-sans: system-ui, -apple-system, sans-serif; }|bare system-ui as the body face'
  )
  for c in "${bad[@]}"; do
    IFS='|' read -r pat input label <<<"$c"
    if printf '%s\n' "$input" | grep -qP -e "$(eval printf '%s' "\"\${$pat}\"")"; then
      note "ok    flags $label"
    else
      note "BROKEN $label — $pat no longer matches '$input'"; ok=0
    fi
  done
  # Must NOT flag these — correct system usage.
  local -a good=(
    'BIND_RES[2]|  --terra: var(--violet);|--terra aliased to violet'
    'BIND_RES[2]|  --terra-10: rgba(139, 92, 246, 0.10);|an alpha wash, not the token'
    'BIND_RES[4]|  --gold:  var(--tangerine);|--gold aliased to tangerine'
    'BIND_RES[0]|  --teal:  var(--mint);|--teal aliased to mint'
    'BIND_RES[1]|  --mint:       #45E0A8;|mint at its own value'
    'FONT_RE|  --font-sans: var(--font-body);|the system body face'
    'FONT_RE|  --font-mono: "JetBrains Mono", "Fira Code", monospace;|the mono face'
    "FONT_RE|  --font-body: 'SF Pro Display', 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;|the canonical stack and its fallbacks"
  )
  for c in "${good[@]}"; do
    IFS='|' read -r pat input label <<<"$c"
    if printf '%s\n' "$input" | grep -qP -e "$(eval printf '%s' "\"\${$pat}\"")"; then
      note "BROKEN $label — $pat false-positives on '$input'"; ok=0
    else
      note "ok    allows $label"
    fi
  done
  [ "$ok" = 1 ] || { echo "self-test FAILED — the checks below cannot be trusted."; exit 2; }
}

echo "── self-test"
self_test
if [ "${1:-}" = "--self-test" ]; then echo; echo "self-test passed."; exit 0; fi

# ── 2. every page links the design system ────────────────────────────────
echo
echo "── check 1: every page links the design system"
missing=""
while IFS= read -r f; do
  [ -n "$f" ] || continue
  grep -qE "$LINKS_DS_RE" "$f" || missing="${missing}${f}"$'\n'
done < <(git ls-files '*.html' | grep -vE "$EXEMPT_RE" || true)

total=$(git ls-files '*.html' | grep -vcE "$EXEMPT_RE" || true)
if [ -n "$missing" ]; then
  echo "  FAIL  $(printf '%s' "$missing" | grep -c .) of $total page(s) do not link tokens.css"
  printf '%s' "$missing" | sed 's/^/        /'
  echo "        Add: <link rel=\"stylesheet\" href=\"/tokens.css\">  before the page's own styles."
  fail=1
else
  echo "  PASS  all $total page(s) in scope link the design system"
fi

# ── 3. no key colour rebound to another quantity ─────────────────────────
echo
echo "── check 2: every key colour carries its own quantity"
files=$(git ls-files | grep -vE "$BINARY_RE" | grep -vE "$SCAN_EXCLUDE_RE" || true)

# Emit "file:line:text" for every line NOT inside an ignore block.
scannable() {
  printf '%s\n' "$files" | while IFS= read -r f; do
    [ -n "$f" ] || continue
    awk -v F="$f" -v S="$IGNORE_START" -v E="$IGNORE_END" '
      index($0,S) { skip=1 }
      !skip       { printf "%s:%d:%s\n", F, NR, $0 }
      index($0,E) { skip=0 }
    ' "$f" 2>/dev/null
  done
}
# tr strips NULs (tools/linkcheck/crawl.mjs carries one) so the capture below
# does not warn. The file stays in scope — dropping it would be a silent hole.
SCAN_CACHE=$(scannable | tr -d '\0')

bind_fail=0
for re in "${BIND_RES[@]}"; do
  hits=$(printf '%s\n' "$SCAN_CACHE" | grep -aP -e "$re" | grep -avP -e "$LIGHT_CTX_RE" || true)
  if [ -n "$hits" ]; then
    printf '%s\n' "$hits" | sed 's/^/        /' | cut -c1-160
    bind_fail=1
  fi
done
if [ "$bind_fail" = 1 ]; then
  echo "  FAIL  a key colour is bound to a value that is not its own"
  fail=1
else
  echo "  PASS  no key colour rebound"
fi

# ── 4. the body face is the system's ─────────────────────────────────────
echo
echo "── check 3: the body face is the system's"
hits=$(printf '%s\n' "$SCAN_CACHE" | grep -aP -e "$FONT_RE" || true)
if [ -n "$hits" ]; then
  echo "  FAIL  an off-system typeface is bound as the body face"
  printf '%s\n' "$hits" | sed 's/^/        /' | cut -c1-160
  fail=1
else
  echo "  PASS  no off-system body face"
fi

echo
if [ "$fail" = 0 ]; then
  echo "design system: clean."
else
  echo "design system: violations found (see above)."
  echo "The seven key colours and their quantities:"
  echo "  mint #45E0A8 ΔH · violet #8B5CF6 ΔS · tangerine #FF9300 ΔG · firetruck #F5232B T"
  echo "  aqua #00A2FF ΔS_vib · strawberry #FF2F92 receptor · magnesium #DCDCE4 baseline"
  echo "Never reassign a key colour to a different quantity — the binding is the system."
fi
exit "$fail"
