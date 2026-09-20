# Handoff → NATURaL session

From the canonical design-system session (`lebonhommepharma.github.io`, branch
`design-system/contrast-exact-compare`, base `a37a9ce`).

**REVISION — supersedes the values previously handed over.** Two light halves
changed. If you have already taken the earlier catalog, re-take these two;
everything else is byte-identical. Details under *Revision* below.

Written as a file because cross-session messaging is unavailable from an
unattended session. **Apply this rather than duplicating it.**

---

## The ruling

The twins **should** exist. `natural/MASTER.md` was right and the assets were
never made, so they are built here and the doc stands as written.

I first argued the seven key colours should have no twin. That was wrong.
NATURaL reads `BrandColor.mint` — a Swift literal with no appearance behaviour
— at **182 call sites**, and uses the `*Asset` accessors **0 times**. The
catalog and the HUD are separate channels, so a catalog twin cannot move a HUD
value. *"SCI / ΔH / ΔG stay identical across themes"* and *"the catalog has
twins"* were never in conflict.

## What to take

`design-system/dist/BrandColors.xcassets/` — eleven colorsets: the exact ten
names already in use, plus `BrandStateFailText` which the catalog was missing.
Drop-in, no renames. Each has a `universal` (light) entry and a
`luminosity: dark` entry.

## How they were derived — not eyeballed

The canonical hex is the **dark** half and already clears AA on the ink. The
**light** half is solved from it: hue held, lightness moved, chroma shed only
where the sRGB gamut narrows, until the pair clears 4.5:1 on the approved warm
ivory `#F3EFE7`.

The constraint is the allowance `scripts/check-design-system.sh` already
defines and self-tests: **hue within 3°, lightness must differ, chroma may fall
freely but rise no more than 0.05.**

| colorset | light | on ivory | dark | on ink |
|---|---|---|---|---|
| BrandBg | `#F3EFE7` | ground | `#08091A` | ground |
| BrandMint | `#007C58` | 4.55:1 | `#45E0A8` | 11.73:1 |
| BrandViolet | `#7E4CE6` | 4.51:1 | `#8B5CF6` | 4.66:1 |
| BrandTangerine | `#A25C00` | 4.50:1 | `#FF9300` | 8.86:1 |
| BrandFiretruck | `#DC001B` | 4.51:1 | `#F5232B` | 4.85:1 |
| BrandAqua | `#0071B5` | 4.54:1 | `#00A2FF` | 7.15:1 |
| BrandStrawberry | `#D40074` | 4.52:1 | `#FF2F92` | 5.71:1 |
| BrandMagnesium | `#6D6C74` | 4.52:1 | `#DCDCE4` | 14.47:1 |
| BrandFg | `#6C6B7A` | 4.55:1 | `#E4E3F5` | 15.60:1 |
| BrandFgMuted | `#6B698C` | 4.55:1 | `#8D8CB0` | 6.12:1 |
| BrandStateFailText | `#C7363D` | 4.55:1 | `#FF6B6B` | 7.11:1 |

Both halves clear 4.5:1, which also covers the 3:1 floors for large text and
non-text. Hue moves under 0.5° for every key colour.

The "on ivory" column is rounded for reading. The guard compares the unrounded
ratio — see *Revision*.

---

## Revision — two light halves changed

**Take these two values verbatim. Do not re-derive them.**

| colorset | was | now | exact contrast on `#F3EFE7` |
|---|---|---|---|
| BrandFgMuted | `#6B6A8D` | **`#6B6A8C`** | 4.497589 → **4.504146** |
| BrandStateFailText | `#C8373E` | **`#C7373E`** | 4.497018 → **4.527539** |

Both previous values were **below** WCAG AA's 4.5:1 on the ivory ground and
were reported as passing. The cause was in the guard, not the colours:
`contrast()` rounded the ratio to 2 dp before comparing it against 4.5, so
4.497589 became "4.5" and cleared its own bar. The same rounded value was read
by the solver, so it stopped searching as soon as a candidate *rounded* to the
target. One rounding site, two wrong colours.

`BrandFgMuted` is the muted small-text token — the one place the 4.5 bar is
actually doing work.

**Fixed at source**, so the class of bug is gone rather than the two instances:
comparisons read the unrounded ratio, and rounding happens only at print sites
via `fmtRatio`. `check-colorsets.mjs --self-test` now carries pairs that
straddle each threshold by the smallest margin 8-bit sRGB permits — 4.4999987
vs 4.5000001, hue 2.999996° vs 3.000010°, chroma +0.049999 vs +0.050002 — and
asserts the verdicts **differ**. Each pair is identical once rounded for
display, so reintroducing a rounded comparison anywhere turns the self-test red
(verified by mutation).

Nothing else in the catalog moved: the other nine colorsets regenerate
byte-identical.

### What this changes on your side

Only the two `universal` (light) entries:

```
BrandFgMuted.colorset        red 0.420  green 0.416  blue 0.553 → 0.549
BrandStateFailText.colorset  red 0.784 → 0.780  green 0.216  blue 0.243
```

Dark halves are unchanged (`#8D8CB0`, `#FF6B6B`), so nothing pinned to
`.preferredColorScheme(.dark)` moves at all.

You author no colorset values — that discipline is right and this revision
does not change it. These came out of the generator.

---

## Second revision — three body-role values, and a rule split

Three more light halves changed, for a different reason than the two above.
**Take these verbatim too.**

| colorset | was | now | exact contrast on `#F3EFE7` |
|---|---|---|---|
| BrandFg | `#6C6C7B` | **`#6C6B7A`** | 4.500601 → **4.553120** |
| BrandFgMuted | `#6B6A8C` | **`#6B698C`** | 4.504146 → **4.550015** |
| BrandStateFailText | `#C7373E` | **`#C7363D`** | 4.527539 → **4.551152** |

These were not failing. They cleared WCAG AA. The problem was that `BrandFg`
cleared it by 0.000601, which is **less than one 8-bit step** — one step is
worth 0.0469 of ratio for that colour — so the margin was an artifact of where
the quantisation grid fell rather than a decision. Anti-aliased small text
blends its edge pixels toward the ground, so a glyph sitting at 4.5000 renders
part of itself under the bar.

The catalog now solves under **two targets**, emitted to `roles.json` beside the
colorsets and enforced by `check-colorsets.mjs`:

- **body 4.55** — `BrandFg`, `BrandFgMuted`, `BrandStateFailText`. 4.5 plus one
  quantisation step.
- **identity 4.5** — the seven key hues. Unchanged, and **do not lower this to
  the 3:1 non-text floor**: at 3:1, `BrandViolet`, `BrandFiretruck` and
  `BrandStrawberry` solve to their own dark values, lightness never moves, and
  the pair stops being a relighting. 4.5 there is a twin-distinctness floor
  that happens to coincide with the AA number.

Dark halves are unchanged throughout. Component deltas:

```
BrandFg.colorset             red 0.424  green 0.424 → 0.420  blue 0.482 → 0.478
BrandFgMuted.colorset        red 0.420  green 0.416 → 0.412  blue 0.549
BrandStateFailText.colorset  red 0.780  green 0.216 → 0.212  blue 0.243 → 0.239
```

`roles.json` is new in the catalog directory. It is metadata for the guard, not
an Xcode asset — `actool` ignores unknown JSON at that level, but if your build
is strict about the directory's contents, drop it and run the guard from this
repo instead.

## Your universal entries are currently inverted

They hold the **dark** value with no variant. That is invisible today because
`.preferredColorScheme(.dark)` is pinned at every entry point, and it stays
invisible until someone removes that modifier — at which point light appearance
renders dark-on-dark, silently, with no missing-asset error.

The generated catalog puts **light in `universal`** and dark in the appearance
entry, which is the direction Apple resolves.

## The guard

```bash
node design-system/check-colorsets.mjs \
  --catalog BonhommeCore/Sources/BonhommeCore/Resources/BrandColors.xcassets
```

Today: all ten reported missing, exit 1. After applying the generated catalog
it should go green. Worth adding to CI.

## Not compile-verified

`actool` is not on this machine (Command Line Tools, no full Xcode). Every
`Contents.json` parses and carries exactly the two expected entries, and the
single-entry form matched Xcode's own output byte-for-byte before twins were
added. **If you have full Xcode, run it through `actool` and report back.**

## Still open — your call, nothing touched in your repo

1. **`natural/MASTER.md` line 41**, *"Gold is allowed as thermodynamic chrome"*,
   and **`BrandColor.swift:17`**, `public static let gold: UInt32 = 0xC4A359`.
<!-- palette-check-ignore-start -->
   That is where the website's `--hp-gold: #C4A359` came from. Gold `#FBBF24`
<!-- palette-check-ignore-end -->
   is retired in palette v2; ΔG chrome should read tangerine `#FF9300`
   (8.86:1). Pointing the raw-hex guard at the repo flags it at
   `BrandColor.swift:17` in `0x` form.
2. **The `BrandColor.swift` docstring and its `MARK: Asset catalog twins`**
   both claim twins exist. True once this is applied; false until then.
