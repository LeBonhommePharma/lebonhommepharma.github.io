# Artifact sub-resource crawler

Makes one specific failure impossible to ship: **a page that returns 200 while
its scripts 404.**

## The failure

A `<script src>` that 404s fires an `error` event *on the element*. Resource
errors do not bubble. Nothing throws, `document.readyState` still reaches
`complete`, and any code gated on that script's `onload` never runs. The page is
HTTP 200 and looks healthy by every naive measure while rendering nothing.

The instance that motivated this, recovered from `06bc70d`:

```js
inject('deck_assets/flex-data.js', 'flex-data-js', () => {
  inject('deck_assets/flex-render.js', 'flex-render-js');   // gated on onload
});
```

`flex-data.js` was never bundled into the artifact → 404 → `onload` never fired
→ `flex-render.js` was never even *requested* → every canvas in the benchmark
deck stayed at its default 300×150.

**Both files existed in the source tree.** A source-side check would have
passed. That is the whole reason this crawler runs against the built/deployed
artifact over HTTP and never against the repo tree.

## Design

```
node tools/linkcheck/crawl.mjs --artifact .                    # serve + crawl a build artifact
node tools/linkcheck/crawl.mjs --base https://thebonhomme.com/ --seed-from .
```

**Route discovery is never a hardcoded list.** Artifact mode enumerates every
`*.html` under the artifact and serves it; live mode seeds from a checkout via
`--seed-from` and then link-crawls outward. Both then BFS over `<a href>`.

**`serve.mjs` mimics GitHub Pages**, including case-sensitive path resolution —
macOS would otherwise resolve `Assets/x.png` for `assets/x.png` and hide a bug
that is a hard 404 on the Linux Pages host.

**Extraction** covers `src`, `href`, `srcset`/`imagesrcset`, `poster`, `data`,
`action`, `xlink:href`, CSS `url()` and `@import` (in `<style>`, inline `style=`,
and bundled stylesheets), ES `import` / `export … from` / `import()`,
`importScripts()`, `new Worker()` / `new SharedWorker()`, and
`audioWorklet.addModule()`. Each is resolved against **its own page URL**,
honouring `<base href>`.

### The five bundle pages

`index.html`, `benchmark/index.html`, `cv.html`, `entropy-driven.html`, and
`resume.html` are self-extracting bundles. Their real document lives in
`<script type="__bundler/template">` as a JSON string; assets live in
`<script type="__bundler/manifest">` as `{uuid: {mime, compressed, data}}` with
base64/gzip payloads; CDN deps live in `__bundler/ext_resources`.

A naive HTML parse of one of these finds ~2 script tags in the bootstrap and
reports a **false pass** — which is exactly where the original deck failure
lived. The crawler decodes the template, treats it as the page's real HTML, and
resolves every UUID reference against `manifest ∪ ext_resources`. An unresolved
UUID is an `UNBUNDLED` finding: the browser would resolve it as a relative path
and 404.

### Two tiers of reference

| tier | what | on non-200 |
|---|---|---|
| **declarative** | HTML attributes, CSS `url()`/`@import`, ES imports, `importScripts`, `Worker`, `addModule` — the browser is *guaranteed* to fetch these | hard fail, always |
| **dynamic** | asset-shaped string literals inside inline scripts, e.g. `inject('deck_assets/flex-data.js')` | hard fail, allowlistable |

The dynamic tier is where the deck failure lived, so it must be checked. But
static analysis cannot distinguish a live reference from dead guarded fallback
code — and this repo has both. Hence the allowlist.

### The allowlist is guarded, not a mute button

`linkcheck-allow.txt` entries take an optional `[requires=<regex>]` clause. The
entry only suppresses a finding **while that signature is still present in the
referencing page's executable corpus** (decoded template + every text asset in
the manifest).

`/benchmark/deck_assets/*.js` is allowlisted with `[requires=window\.FLEX_RAW\s*=]`.
Those paths 404 today and that is fine, because the bundled deck runtime sets
`window.FLEX_RAW` and short-circuits the inject guard. `window.FLEX_RAW =`
appears **once** in the fixed deck's bundled corpus and **zero** times in the
broken one. Re-export the deck without bundling the runtime and the guard stops
matching, the suppression evaporates, and the finding goes fatal again.

An allowlist entry with no reason is a hard error. An entry that stops matching
anything is reported as stale. Every allowlisted 404 is reprinted under
`[WARN] ALLOWLISTED` on every run. Nothing goes quiet.

### Timeouts are not 404s

Default per-request timeout is **120 s** with one retry. `resume.html` is 11.1 MB
and measured 19.1 s from a live fetch; a `--max-time 25` cap truncates it
mid-download and produces a phantom finding. Timeouts are reported as their own
`TIMEOUT` class, never folded into "missing".

### Portability

Root-absolute local paths (`/interaction.css`, `/assets/…`) are reported as
`PORTABILITY` warnings — non-fatal, but they break if any part of this artifact
is ever served from a subpath. 978 such references across 122 distinct paths at
time of writing.

## Known gaps — stated, not hidden

- **Dynamic refs are only harvested from inline scripts in HTML documents**, not
  from minified vendor bundles carried in the manifest. Scanning those produces
  module ids and error strings, not fetches. A dynamic 404 originating inside a
  bundled vendor blob would be missed.
- **Static analysis cannot prove a dynamic reference actually fires.** The
  `[requires=…]` guard converts that judgement into a checked assertion for the
  one case in this repo that needs it, but it is a per-case mechanism, not a
  general solution. The general solution is a headless-browser probe that
  records real network responses and resource `error` events — see below.
- **Conditional / templated URLs** are skipped when they contain `{{ }}`, `${}`,
  `<% %>`. `index.html` genuinely ships `href="{{ dodHref }}"`; fetching that
  literally is a phantom 404.
- **Only the apex host is crawled.** Cross-origin sub-resources (unpkg, jsdelivr,
  Google Fonts) are counted and skipped, not verified.

## Future scope

A Playwright probe over the five bundle pages, asserting zero failed requests
and zero resource `error` events, would close the dynamic-reference gap with
ground truth instead of heuristics. The repo already has `test-full-site.mjs`
built on Playwright. It is deliberately not wired here: it needs a browser
download in CI, and a flaky browser gate is worse than a fast honest one.

`SymphonyInstrumentAnalysis` is untouched and out of scope.
