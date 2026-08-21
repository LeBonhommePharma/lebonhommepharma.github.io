# @flexaidds/tokens

FlexAID∆S palette v2 — the approved output of the *Color and type pairings*
exploration (option `6a`). Seven key colors, each carrying a thermodynamic
quantity, plus type, spacing, radii, glow, and the energy-ordered series ramp.

> Le Bonhomme Pharma · Montréal · Open Science

## Install

Copy the directory in, or add it as a workspace package. There is no build
step — the CSS and the ES module are both source.

```html
<link rel="stylesheet" href="tokens.css">
<link rel="stylesheet" href="elements.css">   <!-- optional -->
```

```js
import tokens, { palette, seriesRamp } from '@flexaidds/tokens';
```

`tokens.css` defines custom properties and nothing else, so it can't fight a
consuming stylesheet. `elements.css` is the opinionated half — the body grid,
mono headings, `.eyebrow`, `.stat-value`, `.brand`. Take `tokens.css` alone if
your design system already styles elements.

## The key colors

Each is bound to a quantity in `ΔG = ΔH − TΔS − TΔS_vib`. **The binding is the
system.** Never reassign a key color to a different quantity, and don't add an
eighth "brand" hue — the triad is semantics, and a decorative addition would
muddy the reading.

| Token | Hex | Quantity | Role | Contrast on ink |
|---|---|---|---|---|
| `--mint` | `#45E0A8` | ΔH | enthalpy · brand primary | 11.7:1 |
| `--violet` | `#8B5CF6` | ΔS | configurational entropy | 4.7:1 |
| `--tangerine` | `#FF9300` | ΔG | free energy · stats | 8.9:1 |
| `--firetruck` | `#F5232B` | T | temperature · hot anchor | 4.9:1 · **12px and up** |
| `--aqua` | `#00A2FF` | ΔS_vib | vibrational entropy · tENCoM | 7.2:1 |
| `--strawberry` | `#FF2F92` | — | receptor · pocket · eyebrows | 5.7:1 |
| `--magnesium` | `#DCDCE4` | — | baseline · apo · reference line | 14.5:1 |

Ratios are WCAG 2.1 against the ink `#08091A`. Violet and firetruck clear AA
for normal text with no headroom to spare — hold firetruck to 12px and up, and
use `--state-fail-text` (`#FF6B6B`, 7.1:1) for small failure labels.

`--teal`, `--terra` and `--gold` remain as aliases of mint, violet and
tangerine so v1 rules keep resolving.

## The series ramp

Ordered by **energy along the binding coordinate** — not by hue and not by
wavelength. Position in a legend therefore means something thermodynamic, and
a series reads as a reaction path.

```
--series-1  #DCDCE4  apo baseline
--series-2  #8B5CF6  unbound · ΔS dominates
--series-3  #FF2F92  first pocket contact
--series-4  #00A2FF  rigidification · ΔS_vib
--series-5  #45E0A8  contacts formed · ΔH
--series-6  #FF9300  converged · ΔG
```

Firetruck is deliberately **not** in the ramp: it is a scalar and a failure
signal, never a data class. Six steps is the ceiling, and the first is a
neutral baseline, so only five ever compete for attention.

## Temperature

A diverging cool→hot ramp anchored on aqua → magnesium → firetruck, matching
the B-factor convention PyMOL and Chimera use for the crystallographic
temperature factor — so it needs no legend for a crystallographer. Equally
important, it keeps violet, mint and tangerine meaning ΔS, ΔH and ΔG and
nothing else.

`--t-ramp` is a ready CSS gradient; `temperatureGradient` is the same string
in JS, and `temperature` is the stop list with Kelvin values attached.

## State

Severity reads by brightness, never by yellow. Magenta means caution, pure red
means stop.

```
--state-pass       #45E0A8   mint
--state-warn       #FF2F92   strawberry
--state-fail       #F5232B   firetruck
--state-fail-text  #FF6B6B   lifted, for small labels
```

## Retired

Do not reintroduce. Exported as `retired` from `tokens.js` so a lint rule or
migration script can flag them.

`#FBBF24` gold · `#FDE68A` pale gold · any yellow · `#22D3EE` cyan ·
`#C2456F` salmon · `#DA2F63` wine · `#6E7C99` steel · `#FF2600` maraschino ·
`#FFFFFF` snow

Also rejected as directions: serif prose, burgundy as a lead color, all-mono
terminal, amber as primary.

## Type

Two families. JetBrains Mono carries headings, stats, badges, eyebrows, code
and every number; the sans carries prose only. That mono-headings rule is the
move that defines the brand — don't quietly relax it.

```
--font-body   'SF Pro Display', 'IBM Plex Sans', -apple-system, …
--font-mono   'JetBrains Mono', 'Fira Code', 'Consolas', monospace
```

Numbers use `font-variant-numeric: tabular-nums` in stats and tables.

## Files

| File | What |
|---|---|
| `tokens.css` | Custom properties. The authority. |
| `elements.css` | Optional semantic element styles. |
| `tokens.js` | ES module — same values, for JS consumers. |
| `tokens.d.ts` | TypeScript types. |
| `tokens.json` | Generated from `tokens.js`; regenerate rather than hand-edit. |
