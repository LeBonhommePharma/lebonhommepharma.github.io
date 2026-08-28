# design-sync notes — LeBonhommePharma/lebonhommepharma.github.io

## Do NOT run the converter's reconciliation against project 316ea2bb…

The bound project **FlexAID∆S Design System** (`316ea2bb-4ea9-4cc2-890d-a68af60403a5`)
is **hand-authored**, not a /design-sync product. It has no `components/<group>/<Name>/`
tree, no `_ds_sync.json`, no `_vendor/`. It holds ~400 files: 30 `preview/*.html` cards,
two UI kits, logo assets, a reference copy of thebonhomme.com, deploy handoffs — and
close to **300 fonts** under `fonts/` (SF Pro, 32 JetBrains Mono variants, Myriad Pro,
Source Code Pro, plus a large personal collection).

The atomic path's mandatory reconciliation deletes every remote path under
`components/`, `_preview/`, `tokens/`, `fonts/`, `_vendor/`, `guidelines/` that the new
bundle does not contain. This repo has no `fonts/` directory, so that pass would delete
**all ~300 fonts** — and in exchange upload a bundle with **zero components**, because
this repo has no component library (see below). Strictly worse than what is there.

Decision (2026-08-28, with the user): surgical v1→v2 token repair only. Writes limited
to the files that actually carry v1. **No deletes, ever, against this project.**

## This repo has no component library

The only package is `@flexaidds/tokens` (`design/palette-v2/packages/flexaidds-tokens`):
tokens-only — `tokens.css`, `elements.css`, `tokens.js`, `tokens.json`, `tokens.d.ts`.
No `dist/`, no build, no Storybook, so `shape = package` and `_ds_bundle.js` would expose
nothing. The `FlexAIDdS/*.jsx` files are `@babel/standalone` browser scripts for one
marketing page — bare `function` declarations, no exports, no build — not a library.

## Preserve when rewriting the project's colors_and_type.css

- The `@font-face` block for SF Pro is **live in the project** (unlike the website, which
  has no `fonts/` dir and keeps it commented out). Keep it.
- The `/* @kind font */` and `/* @kind other */` annotations are read by the Design System
  tab. Keep them on the tokens that carry them.

## Progress — 2026-08-28

### Done
- `colors_and_type.css` (project root) rewritten v1 → v2 and uploaded. Verified by
  read-back: all **146 canonical tokens** present, **zero value mismatches** against
  `tokens.css` after resolving `var()` aliases. Kept the SF Pro `@font-face` block (those
  fonts exist in the project) and all 16 `@kind` annotations. No deletes were in the plan.

### Still on v1 — not yet touched
- `_ds_bundle.js` — ~138 hardcoded v1 hexes (54× `#22D3EE`, 50× `#FBBF24`, 34× `#A78BFA`).
  A CSS token swap cannot reach JS literals. NOTE: round-tripping a large generated bundle
  through a model context risks silent corruption; `get_file` also caps at 256 KiB and can
  truncate. Check `truncated` before ever writing one back.
- `preview/*.html` (30 cards). These are NOT a hex sweep. `colors-triad.html` names the
  triad "Cyan · Magenta · Amber", tells a "CFP / YFP / RFP fluorescence lineage" story,
  and hard-codes WCAG ratios against v1 backgrounds — a find/replace yields a card titled
  "Cyan" rendering mint. They need re-authoring for the seven key colors.
  (It also carries a pre-existing bug: the Magenta swatch lists `rgb 236 · 72 · 153`,
  which is not `#A78BFA` = 167 · 139 · 250.)
- `README.md`, `SKILL.md` — the guide text still describes the v1 palette.
- Copies under `FlexAIDdS/`, `LeBonhommePharma/`, `design_handoff_flexaid_branding/`,
  `ui_kits/website/` — website snapshots, not the token source. Optional.

### Done — second pass (from the Downloads export zip)

The Claude Design export `Color & Type Pairings.zip` supplied a **local** copy of
`_ds_bundle.js`, which is what made it safe to fix: the file is **294,472 bytes**, over
`get_file`'s 256 KiB cap, so a fetch-and-write round trip WOULD have truncated it and
corrupted the project. Always patch that file from a local export, never from `get_file`.

- `_ds_bundle.js` — 200 replacements, verified: 54 `#22D3EE`→mint, 50 `#FBBF24`→tangerine,
  34 `#A78BFA`→violet, 12 `#EC4899`→violet (the Diffusion/ΔS phase accent — same quantity),
  16 `#8a93a8`→`#8D8CB0`, 1 `#D4569E`→mint (`--color-accent` fallback), 1 `#B5AEC8`→
  `#8D8CB0`, plus 32 rgb triples. `node --check` passes; all 360 changed diff lines
  contain a colour (zero collateral edits); byte delta −12 matches the arithmetic exactly.
- `README.md` — palette sections rewritten for v2: the triad table became the seven
  key colors with contrast ratios, background/grid/layering facts corrected, and a note
  added explaining that the legacy `teal-*` / `terra-*` / `gold-*` spellings still
  resolve (to mint / violet / tangerine) so the design agent is not confused by them.

**Deliberately NOT touched in `_ds_bundle.js`:** the GitHub language legend
(`const langs = [["C++", 57.1, "#f34b7d"], ["Python", 21.8, "#3572A5"], …]` — 8 colours),
the GitHub icon fill `#7d8590`, and `#7A7294` (the `--color-text-faint` fallback: indigo
family, no v2 equivalent, not v1 drift). A blind hex sweep would have wrecked the legend.

**`_ds_manifest.json` left alone on purpose** — it is generated by the app's self-check
from `colors_and_type.css` (each entry carries `"definedIn": "colors_and_type.css"`).
Its 86 token records are stale v1, but the v2 CSS is uploaded, so the app regenerates
them. Hand-writing 146 entries would risk schema errors for no gain.

### Done — third pass: site snapshots refreshed ("all webpages")

The project's `FlexAIDdS/` and `LeBonhommePharma/` trees are **curated UI-kit pages**,
not verbatim site copies: no site chrome, React *development* builds with SRI hashes,
and a `__bundler_thumbnail` template. `LeBonhommePharma/index.html` is itself a
`@dsCard` (group "Brand"). So they cannot simply be overwritten with the site's files —
the relative paths differ (`../assets/`, `../theme.css`, `/interaction.css` on the site).

What the JSX **is**, though, is a verbatim-but-stale copy of the site's UI kit (same
header comment; the site had since gained `ExploreSection`). Refreshed:

- `FlexAIDdS/{app,components,sections}.jsx` + `styles.css` ← the merged site. Verified
  safe first: the site sources' three external deps all degrade gracefully in the kit —
  `molstar` is only a `<div id="molstar-viewer" />` placeholder, the repo-stats spans use
  `?.textContent || "0"` with `.catch(() => {})`, and `mountFlexLogo` is guarded by
  `if (!window.mountFlexLogo) return`.
- `FlexAIDdS/index.html`, `LeBonhommePharma/index.html` — only the hardcoded v1
  `__bundler_thumbnail` SVGs swapped to v2 (ink, mint, violet, tangerine, fg, muted).
  Everything else left byte-identical, `@dsCard` marker preserved.
- Five nested `colors_and_type.css` copies replaced with the 146-token v2 set, font
  paths adjusted per depth (`../fonts/` at depth 1, `../../fonts/` at depth 2).

**Why the kits already rendered v2 tokens before this:** their `styles.css` does
`@import url('../colors_and_type.css')`, which resolves to the project ROOT file — fixed
in the first pass. The nested copies were stale leftovers, replaced for correctness.

### Still outstanding
- `preview/*.html` (30 cards) — need re-authoring, not sweeping (see above).
- `*.vercel.css` variants (`FlexAIDdS/`, `LeBonhommePharma/`) — deliberately untouched:
  unread, unknown deploy purpose, and their font paths may differ. Check before editing.
- `ui_kits/website/`, `reference/thebonhomme.com/`, `deploy_github/` — further snapshot
  trees, not refreshed this pass.
- `LeBonhommePharma/{app,components,sections}.jsx` — no current site source to refresh
  from; the site's root `index.html` is now a bundler shell, not JSX.

### Done — fourth pass: the export zip's guidelines card

`~/Downloads/Color & Type Pairings.zip` is the whole design-project export, not just
`_ds/`. Took exactly one file from it:

- `guidelines/palette-v2.card.html` — a v2-clean seven-swatch card carrying a real
  `@dsCard group="Colors" name="FlexAID∆S palette v2"` marker. New `guidelines/` dir in
  the project, so pure addition. Its stylesheet link was repointed from `../styles.css`
  to `../colors_and_type.css`: all 11 tokens it uses (`--mint`, `--violet`, `--tangerine`,
  `--firetruck`, `--aqua`, `--strawberry`, `--magnesium`, `--bg`, `--fg`, `--fg-muted`,
  `--font-mono`) were verified present there.

**Deliberately NOT taken from the zip:**
- `styles.css` — the zip's is two `@import` lines. The project has its OWN live root
  `styles.css`, listed in `_ds_manifest.json` `globalCssPaths` alongside
  `colors_and_type.css`. Uploading the zip's would have destroyed it.
- `tokens/colors.css`, `tokens/typography.css` — those 146 values are already canonical
  in the project's `colors_and_type.css`. Adding a second copy would recreate exactly the
  two-sources-of-truth duplication that caused the site's drift in the first place.
- `flexaidds-palette-v2.css`, `Color & Type Pairings.dc.html`, `CLAUDE.md`, `readme.md`,
  `SKILL.md` — the design project's own files, not DS assets. The project already has a
  different `SKILL.md` (its agent manifest); do not overwrite it with the zip's.

This card supersedes the v1 story in `preview/colors-triad.html` ("Cyan · Magenta ·
Amber"), which is still outstanding.
