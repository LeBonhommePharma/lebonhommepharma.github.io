# Handoff → NATURaL session

From the canonical design-system session (`lebonhommepharma.github.io`, branch
`design-system/canonical-source`, commit `6724f5a`).

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
| BrandFg | `#6C6C7B` | 4.50:1 | `#E4E3F5` | 15.60:1 |
| BrandFgMuted | `#6B6A8D` | 4.50:1 | `#8D8CB0` | 6.12:1 |
| BrandStateFailText | `#C8373E` | 4.50:1 | `#FF6B6B` | 7.11:1 |

Both halves clear 4.5:1, which also covers the 3:1 floors for large text and
non-text. Hue moves under 0.5° for every key colour.

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
