# FlexAID∆S design system — MASTER

Le Bonhomme Pharma · Montréal

One source of truth. The website, NATURaL, ClusterFuck and Exergy all consume
this; none of them defines a colour of its own.

---

## The one rule

**A colour may only be born in `tokens.css`.**

Everything else — the JSON, the JS, the TypeScript types, the Swift for the
Apple apps, the packaged copy under `design/palette-v2/packages/` — is
generated from it by `design-system/emit.mjs`. If you find yourself typing a
hex anywhere else, that is the bug.

```
tokens.css                                    ← authored, by a human
   │
   └── design-system/emit.mjs
         ├── design/palette-v2/packages/flexaidds-tokens/tokens.css   site package
         ├── design-system/dist/tokens.json                           JSON consumers
         ├── design-system/dist/tokens.js · tokens.d.ts               JS / TS
         ├── design-system/dist/BrandColor.swift                      NATURaL
         └── design-system/dist/ExergyTheme.swift                     Exergy
```

### Why CSS is the source and not a neutral JSON file

The obvious design is a JSON source that generates CSS. It was rejected because
`tokens.css` already carries the *reasoning* — which quantity each key colour is
bound to, the measured contrast ratio, why firetruck is held to 12px, why
failure text goes darker on a light ground. That prose **is** the design system.
A JSON source would either drop it or re-encode every comment as a `doc` string,
which is transcription — and transcription is precisely how the two copies of
`tokens.css` in this repo drifted apart before any of this existed.

---

## Palette v2 — canonical

Seven key colours. Each is bound to a thermodynamic quantity, and that binding
**is** the system. Never reassign a key colour to a different quantity, and
never introduce an eighth brand hue — it muddies the reading of

    ΔG = ΔH − TΔS − TΔS_vib

| token | hex | quantity | on ink `#08091A` |
|---|---|---|---|
| `--mint` | `#45E0A8` | ΔH · enthalpy · brand primary | 11.73:1 |
| `--violet` | `#8B5CF6` | ΔS · configurational entropy | 4.66:1 |
| `--tangerine` | `#FF9300` | ΔG · free energy · stats | 8.86:1 |
| `--firetruck` | `#F5232B` | T · temperature · hot anchor | 4.85:1 |
| `--aqua` | `#00A2FF` | ΔS_vib · vibrational · tENCoM | 7.15:1 |
| `--strawberry` | `#FF2F92` | receptor · pocket · eyebrows | 5.71:1 |
| `--magnesium` | `#DCDCE4` | baseline · apo · reference line | 14.47:1 |

Ink `#08091A`, text `#E4E3F5`.

Every ratio above is **recomputed** by `check-contrast.mjs` from the WCAG 2.1
relative-luminance formula, not copied from a board. All seven were verified
correct against the values annotated in `tokens.css`.

### v1 names are back-compat only

`--teal`, `--terra` and `--gold` still resolve, as aliases. **New code never
uses them.** They exist so v1 rules keep working, not as a choice.

---

## Contrast is a pair

> A contrast ratio is a property of a **(foreground, background) pair**, never
> of a colour on its own. A ratio quoted without naming its background is not a
> measurement.

**Hue and chroma carry identity. Lightness is free.**

Targets — WCAG 2.1 AA:

| use | ratio |
|---|---|
| body text | 4.5:1 |
| ≥24px, or ≥18.66px bold | 3:1 |
| non-text (borders, icons, focus rings, chart strokes) | 3:1 |

### The light-theme correction

`tokens.css` froze the seven key colours across both themes, so "a chart or an
equation reads the same in either mode". That is right about identity and wrong
about contrast — it froze only one half of the pair. Measured against the
shipped light ground `#f4f6fb`:

    magnesium 1.26 · mint 1.56 · tangerine 2.06 · aqua 2.55

Four of seven below 3:1, the floor for a *border*. In light mode the brand
primary was effectively invisible.

The fix follows the system's own rule — hold hue and chroma, move lightness —
and is **additive**, so nothing that ships today changes:

- `--mint` &c. stay exactly as they are. They are **identity hues**: fills,
  washes, chart bodies, anything on the dark ground.
- `--mint-fg` &c. are new. Use these for anything a person has to **read**:
  text, icons, rules, chart strokes over the page. In dark mode they *are* the
  key colours; only the light theme overrides them.

Solved in OKLCH — the space where holding H and C actually preserves what a
person recognises as "the mint one". In HSL the perceived hue would swing as
lightness drops. Hue moves less than 0.3° in every case.

| token | light value | on `#f4f6fb` | Δhue | chroma kept |
|---|---|---|---|---|
| `--mint-fg` | `#00815C` | 4.52:1 | +0.21° | 75% |
| `--violet-fg` | `#8251EA` | 4.50:1 | +0.21° | 100% |
| `--tangerine-fg` | `#A85F00` | 4.51:1 | +0.05° | 73% |
| `--firetruck-fg` | `#E4001C` | 4.50:1 | +0.06° | 99% |
| `--aqua-fg` | `#0076BB` | 4.51:1 | −0.27° | 79% |
| `--strawberry-fg` | `#DC0078` | 4.50:1 | +0.28° | 96% |
| `--magnesium-fg` | `#717078` | 4.53:1 | — | 100% |

Magnesium is near-achromatic (C ≈ 0.006), so its OKLCH hue angle carries no
perceptual meaning; the solver's 5.56° figure is numerical noise, not a visible
change of colour.

Re-solve at any target with `node design-system/derive-light.mjs 4.5`.

The low-alpha washes (`--mint-10` &c.) deliberately stay built from the bright
hue. As a translucent **background** tint that is correct, and they are never a
foreground.

---

## Unknown means unknown

An em dash — never a fabricated reading, never a zero standing in for missing
data, never a plausible-looking placeholder. A zero is a measurement. If the
measurement does not exist, say so.

This applies to the tooling too: `check-raw-hex.mjs` exits 2 rather than 0 if it
parses no colours from the token source, and `check-contrast.mjs` fails if it
matches no annotated ratios. A check that silently inspected nothing must never
be able to report a pass.

---

## Scales

| scale | tokens | notes |
|---|---|---|
| spacing | `--sp-1 … --sp-24` | 8-pt soft grid; `--sp-4` = 1rem |
| type size | `--fs-hero … --fs-meta` | 9 steps, 7rem down to 8px |
| weight | `--fw-300 … --fw-700` | |
| tracking | `--tracking-tight … --tracking-meta` | wider as the type gets smaller |
| line height | `--lh-tight … --lh-code` | |
| radius | `--r-xs … --r-pill` | 3 / 6 / 8 / 12 / 9999 |
| motion | `--ease-out`, `--dur-fast … --dur-spectrum` | |

Two families. JetBrains Mono carries headings, stats, badges, eyebrows, code and
**every number**; the sans is for prose only. Serif prose was explicitly
rejected.

### Series ramp

Ordered by **energy along the binding coordinate**, not by hue or wavelength —
position in a legend means something thermodynamic, so a series reads as a
reaction path. Six is the ceiling. Firetruck stays out: it is a scalar and a
failure signal, never a data class.

### Temperature ramp

Diverging cool→hot, matching the B-factor convention PyMOL and Chimera use, so
it needs no legend for a crystallographer. The equation's hues stay out of it,
which keeps violet, mint and tangerine meaning ΔS, ΔH and ΔG and nothing else.

### State

Severity reads by brightness, never by yellow. Magenta means caution, pure red
means stop. `--state-fail-text` is lifted to `#FF6B6B` on the ink (7.11:1) and
*darkened* to `#BE123C` on the light ground (5.81:1) — a lift for dark mode
collapses to 2.57:1 on light, which is the same one-half-of-the-pair mistake in
miniature.

### Motion and reduced motion

Honour `prefers-reduced-motion: reduce`. Animation in this system is
communicative — the spectrum flow, the entropy meter, the breathing glow — so
under reduced motion it should settle to its **final** state rather than being
removed, and never simply freeze mid-cycle.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
  }
}
```

### Focus

Focus is non-text: 3:1 against what it sits on, in both themes. Never remove the
indicator without replacing it.

```css
:focus-visible {
  outline: 2px solid var(--mint-fg);
  outline-offset: 2px;
}
```

---

## The guards

Two, and they are complements, not duplicates. Both must pass.

### `scripts/check-palette-v2.sh` — the denylist

Names the retired v1 hues and rejects them in every spelling it knows: `#hex`,
`0xhex`, `rgb()`, and 24-bit ANSI triplets. Owned by the wider repo; not
modified here.

> **It does not run on macOS.** It requires `grep -P`, and BSD grep has no PCRE.
> It correctly refuses to run rather than false-passing — but that means it is a
> CI-only check, and you cannot reproduce a failure locally.

### `design-system/check-raw-hex.mjs` — the allowlist

A denylist cannot catch a colour nobody has thought of yet. This is the other
half: **a colour literal is legal only where the design system defines it.**

The concrete escape it exists for: a Cursor agent shipped

```css
--hp-gold: #C4A359;
```

into `index.html`. The denylist matched nothing and was *right* — `#C4A359` is
not a retired v1 colour, it is a brand-new invented one wearing a `--hp-*`
custom property so it reads like a token. It was the wrong question.

Covers `#RRGGBB`, `#RRGGBBAA`, `#RGB`, `0xRRGGBB`, `rgb()`/`rgba()` and
`hsl()`/`hsla()`, all normalised to one canonical key so `rgb(141, 140, 176)`
and `#8D8CB0` are judged as the same colour. Runs anywhere Node runs, including
macOS.

**Baseline.** 125 tracked files already carry raw hex — transit atlas data, the
palette exploration board whose subject *is* the retired hues, third-party build
output. Failing all of them on day one means the guard gets switched off in a
week, which is worse than not shipping it. So known literals are grandfathered
per file in `raw-hex-baseline.json` and the ratchet only tightens: **a file may
lose literals, never gain one.** Nothing is forgiven silently —
`openViolations` records what was deliberately *not* grandfathered, with a note
saying why, and those fail the build.

```bash
node design-system/check-raw-hex.mjs              # scan
node design-system/check-raw-hex.mjs --self-test  # prove the checks can fail
node design-system/check-raw-hex.mjs --reseal     # tighten the baseline
```

### Using it in a consuming repo

It needs only Node, a git worktree, and a token source:

```bash
node design-system/check-raw-hex.mjs \
  --root   /path/to/NATURaL \
  --tokens /path/to/tokens.css \
  --baseline /path/to/NATURaL/.raw-hex-baseline.json
```

### `design-system/check-contrast.mjs`

Recomputes every ratio annotated in `tokens.css` and fails if a comment
disagrees with the colour beside it, then asserts every foreground token against
the ground it is actually used on, in both themes.

### `design-system/emit.mjs --check`

Fails if any generated artifact has drifted from `tokens.css`. This is what
makes "one source of truth" a fact rather than an intention.

---

## Changing a colour

1. Edit `tokens.css`. Nothing else.
2. `node design-system/derive-light.mjs 4.5` — re-solve the light foreground.
3. `node design-system/emit.mjs` — regenerate every target.
4. `node design-system/check-contrast.mjs` — the annotated ratios must be true.
5. `node design-system/check-raw-hex.mjs` — no colour born outside the source.
6. Commit the source **and** the generated artifacts together.

---

## Known gaps

Stated rather than papered over.

- **No Swift consumer in this repo.** `BrandColor.swift` and `ExergyTheme.swift`
  are generated and typecheck clean against the macOS SDK with SwiftUI, but
  `NATURaL/` and `Exergy/` here are marketing sites, not the Apple apps. Nothing
  in this repo proves the apps consume them. Wiring that up is a change in
  those repos.
- **ClusterFuck is not present here**, so it consumes nothing yet.
- **`index.html` carries a parallel `--hp-*` token set.** It is a shadow design
  system living beside this one. `--hp-gold` is the part that is provably
  invented; the rest is grandfathered pending a reconciliation that was out of
  scope for this pass.
- **The denylist guard cannot run on macOS** (see above).
- **P3 / wide-gamut is not addressed.** Everything here is sRGB.
