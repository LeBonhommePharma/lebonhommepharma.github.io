# Color &amp; Type Pairings — implementation

Implementation of the Claude Design handoff in `../project/`. Two deliverables:

1. **`index.html`** — a runtime-free recreation of `Color & Type Pairings.dc.html`:
   all six exploration rounds, all seventeen option cards, no `support.js`,
   no `<x-dc>` template layer, no build step.
2. **`packages/flexaidds-tokens/`** — palette v2 (option `6a`) as a real
   consumable token package: CSS custom properties, semantic element styles,
   an ES module, TypeScript types, and JSON.

## Viewing it

Open `index.html` in a browser. That's the whole procedure — no server, no
install, no network. Every webfont is self-hosted under `fonts/`.

The three switches in the toolbar are the prototype's three `<x-dc>` props
(`showGrid`, `showApplied`, `showTokenSpecs`) made real. They default on, and
the page renders correctly with JavaScript disabled — the script only ever
turns things *off*.

## What's in here

```
index.html                          the board — 6 sections, 17 option cards
css/
  board.css                         structure + one palette block per option
  fonts.css                         @font-face for all 10 families (generated)
js/
  board.js                          the three toolbar switches, ~25 lines
fonts/                              62 woff2 subsets + 4 SF Pro Display .otf
packages/flexaidds-tokens/
  tokens.css                        palette v2 as custom properties
  elements.css                      optional semantic element styles
  tokens.js / .d.ts / .json         the same values for JS/TS consumers
  package.json
  README.md
```

## How the board is built

The prototype carried every value as an inline `style` attribute, because
that's what the design tool emits. Here the structure that all fifteen
specimen cards share — the panel, wordmark row, equation, headline, prose,
stat row, applied block, token strip — lives in real rules, and each option
contributes only what actually differs:

```css
[id="2c"] {
  --ink: #08091A;
  --brand-font: 'Space Mono', monospace;
  --c-dh: #22D3EE;
  --kw-grad: linear-gradient(90deg, #22D3EE, #8B5CF6, #FDE68A, #22D3EE);
  /* …the rest of what makes 2c *2c* */
}
```

That keeps each pairing legible as a set of decisions rather than a wall of
repeated declarations, and it means the differences between, say, `3b` and
`5a` are visible by diffing two blocks.

Values are transcribed from the prototype unchanged, except where noted under
**Corrections**. Both signature animations — the 4s equation `breathe` and the
8.5s keyword `spectrum` flow — are carried over verbatim, including the
`prefers-reduced-motion` opt-out.

### Verification

The recreation was checked against the prototype's own numbers: 102 computed
style assertions (panel padding and radii, body gaps, inks, equation and
headline sizes and weights, tracking, stat sizes, button padding, callout
shapes, ramp heights, section rhythm) plus 17 font-stack assertions covering
every pairing decision. All pass, with no console or network errors and no
horizontal overflow.

## The token package

Import the CSS and style against the properties:

```html
<link rel="stylesheet" href="packages/flexaidds-tokens/tokens.css">
<link rel="stylesheet" href="packages/flexaidds-tokens/elements.css">
```

```css
.pose-score { color: var(--tangerine); font-family: var(--font-mono); }
.pocket-label { color: var(--strawberry); }
```

Or take the values in JavaScript, for charts and 3D renderers that can't read
a custom property:

```js
import { palette, seriesRamp, temperature, keyColors } from '@flexaidds/tokens';

chart.colors = seriesRamp;                  // apo → ΔS → pocket → ΔS_vib → ΔH → ΔG
keyColors.firetruck.minSize;                // 12 — don't set T smaller than this
temperature.find((t) => t.kelvin === 298);  // the ambient reference stop
```

`tokens.json` is generated from `tokens.js`, so the two cannot drift. The CSS
and the JS were cross-checked to agree on every key color and surface.

`elements.css` is optional and separable: it's the half that has opinions
about bare HTML. Take `tokens.css` alone when dropping the palette into a
design system that already styles elements.

### The rules the palette encodes

- **Seven key colors, each carrying a quantity.** Mint ΔH, violet ΔS,
  tangerine ΔG, firetruck T, aqua ΔS_vib, strawberry receptor/pocket,
  magnesium baseline. A key color is never reassigned, and there is no
  eighth "brand" hue — the triad is semantics, not decoration.
- **The series ramp is ordered by energy, not hue or wavelength.** It walks
  the binding coordinate, so position in a legend means something. Firetruck
  is excluded on purpose: it's a scalar and a failure signal, never a data
  class.
- **Temperature is the B-factor ramp** (aqua → magnesium → firetruck) that
  PyMOL and Chimera already use, which keeps the equation's hues from doubling
  as temperature stops.
- **State severity reads by brightness**, never by yellow: mint pass →
  strawberry warn → firetruck fail.
- **No yellow anywhere.** Retired hexes are listed in `tokens.css` and exported
  as `retired` from `tokens.js` so a linter can flag them.

## Corrections

Three things in the prototype are factually wrong rather than stylistically
chosen, so they are fixed here. Everything else is transcribed as-is.

| Where | Prototype | Here | Why |
|---|---|---|---|
| `6a` Magnesium swatch | swatch `#DCDCE4`, hex label reads `#FFFFFF` | `#DCDCE4` | Leftover from the "snow is too aggressive" change; the label was never updated to match the swatch. |
| `4a` baseline row | swatch and label `#FFFFFF` | `#DCDCE4` | Same change, not propagated. `4a`'s own series ramp two blocks below already used `#DCDCE4`, so the card contradicted itself. |
| `6a` contrast ratios | Aqua `5.6:1`, Magnesium `11.4:1` | `7.2:1`, `14.5:1` | Recomputed from the WCAG 2.1 relative-luminance formula against the ink `#08091A`. The other five were within rounding and are now stated to the same precision: mint 11.7, violet 4.7, tangerine 8.9, cherry 4.9, strawberry 5.7. |
| `1a` ink | panel and swatch `#08091A`, label reads `0A0E14` | `#0A0E14` throughout | The v2 repaint replaced the old page ink `#0a0e14` everywhere it appeared, and swept `1a` with it — `1a`'s ink *was* the page ink. `1b`/`1c`/`1d` kept their inks only because theirs weren't the string being replaced. Restoring the navy is what makes `1a` "Canon — navy instrument, the shipping system unchanged", and gives `5a` and `6a` something to be compared against. |

The contrast block is the one part of `6a` whose whole purpose is to say which
hues can carry a 10px mono label, so shipping numbers that are off by 3.1
would defeat it. Note that the corrected figures don't change any decision:
violet (4.66) and firetruck (4.85) are still the two tightest, and firetruck
still wants the 12px floor.

`1a` is consequently the only card on the board not inked in v2 indigo. That
is deliberate — it is the v1 reference the rest of the board moved away from.

## Decisions taken

**The brand mark is mint, and that is settled.** `logo-flexaid-ds.svg`,
`assets/logo-flexaid-ds.svg` and `assets/favicon-flexaid-ds.svg` carry the
bound pose in mint `#45E0A8` and the ghost fan in violet `#8B5CF6`.

This was raised as an open question and explicitly accepted rather than
allowed to happen by default. The reasoning: the bound pose was teal *because
teal meant ΔH*. In v2 ΔH is mint, so recolouring preserves what the mark
means — it is the minimum on the binding free-energy surface — instead of
preserving a hue that no longer carries that quantity. The ghost fan tracks
the entropy the ligand explores, and violet is TΔS in v2, so it lands
correctly too.

Do not revert this to teal `#22D3EE` without a fresh decision. That hex is on
the retired list, so `scripts/check-palette-v2.sh` will fail the build unless
an exemption is added — which is deliberate friction, not an obstacle to route
around.

## Left alone, but worth knowing

These are inconsistencies in the source that look deliberate or belong to a
superseded round, so they are reproduced rather than fixed:

- **`4a` fail state is `#FF2D2D`**, not firetruck `#F5232B`. That's correct
  for round 4 — firetruck arrives in round 6 — and `4a`'s own token strip says
  so explicitly ("fail FF2D2D is the only color outside the key set").
- **`3b`, `2c`, `1c`, `1a` still carry retired hues** (cyan `#22D3EE`, gold
  `#FBBF24`, pale gold `#FDE68A`). They're historical rounds; that's the point
  of keeping them on the board.

## Known limitation

`U+2206 INCREMENT` — the `∆` in the FlexAID∆S wordmark — is not in any Google
Fonts subset, for any of these families. It falls back to a system glyph, in
this recreation and in the original prototype alike. The Greek `Δ` used in the
equations (`U+0394`) is a different codepoint and is covered.

Fixing it means either shipping the full unsubsetted fonts or hosting a
one-glyph face per family; Google's `text=` subset endpoint refuses to serve
its own generated URLs from here. Say the word if the wordmark's ∆ matters
enough to carry the extra weight.

## Fonts

Ten families, self-hosted so the board works offline:

JetBrains Mono · Atkinson Hyperlegible · Space Grotesk · Manrope · Newsreader ·
Archivo · Space Mono · Public Sans · Instrument Serif — all SIL Open Font
License 1.1, latin + latin-ext + greek subsets as woff2 (1.7 MB total).

SF Pro Display is Apple's, carried over from the bound design system's
`_ds/…/fonts/` directory; only the four weights the board and the token
package use (400/500/600/700) are included.

## A separate defect in the logo, not introduced here

The mark is documented as *"five rotated copies of a 3-atom V-shaped ligand
[sharing] a single pivot point"* — four ghosts at decreasing opacity tracing
the entropy fan. In `logo-flexaid-ds.svg` all five groups carry the **same**
path, `M 13 26 L 20 18 L 27 26`, with no `transform` and no stylesheet
anywhere in the repo targeting `.ghost-a` / `.ghost-b`. They stack exactly on
the bound pose and never render: the logo draws as a single ligand, and the
entropy fan — the whole idea of the mark — is invisible.

The favicon does not have this problem; its ghosts carry their own offsets.

This predates the palette work. At `b3829e2`, before the migration, the paths
were already identical and transform-free; the v2 commit changed colour values
and nothing else. Fixing it means authoring rotations on the ghost groups,
which is a change to the mark's *shape* rather than its palette, so it is
left for an explicit decision.
