#!/usr/bin/env node
/**
 * Artifact sub-resource crawler.
 *
 * THE FAILURE THIS EXISTS TO CATCH
 * --------------------------------
 * A <script src> that 404s fires an `error` event ON THE ELEMENT. Resource
 * errors do not bubble. Nothing throws, document.readyState still reaches
 * "complete", and any code gated on that script's onload simply never runs.
 * The page is HTTP 200 and looks healthy by every naive measure while
 * rendering nothing.
 *
 * Real instance in this repo, recovered from git history at 06bc70d:
 *
 *     inject('deck_assets/flex-data.js', 'flex-data-js', () => {
 *       inject('deck_assets/flex-render.js', 'flex-render-js');
 *     });
 *
 * flex-data.js was never bundled into the artifact -> 404 -> onload never
 * fired -> flex-render.js was never even requested -> the deck's canvases
 * stayed at their default 300x150. Both files existed in the source tree, so
 * any source-side check would have passed. THAT is why this crawler runs
 * against the built/deployed artifact over HTTP and never against the tree.
 *
 * Usage:
 *   node tools/linkcheck/crawl.mjs --artifact .            # serve + crawl a build artifact
 *   node tools/linkcheck/crawl.mjs --base https://thebonhomme.com/
 *
 * Exit 0 = no hard failures. Exit 1 = at least one hard failure.
 */
import { readFile } from 'node:fs/promises';
import { readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { listen } from './serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- args ----
function parseArgs(argv) {
  const a = {
    base: null,
    artifact: null,
    seedFrom: null,
    timeout: 120000,      // generous ON PURPOSE: cv.html is multi-MB. A truncated
    concurrency: 6,       // download is a TIMEOUT, not a 404, and must never be
    retries: 1,           // reported as one.
    allow: path.join(HERE, 'linkcheck-allow.txt'),
    json: null,
    maxPages: 2000,
    failOnDynamic: true,
    quiet: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--base') a.base = next();
    else if (k === '--artifact') a.artifact = next();
    else if (k === '--seed-from') a.seedFrom = next();
    else if (k === '--timeout') a.timeout = Number(next());
    else if (k === '--concurrency') a.concurrency = Number(next());
    else if (k === '--retries') a.retries = Number(next());
    else if (k === '--allow') a.allow = next();
    else if (k === '--json') a.json = next();
    else if (k === '--max-pages') a.maxPages = Number(next());
    else if (k === '--no-fail-on-dynamic') a.failOnDynamic = false;
    else if (k === '--quiet') a.quiet = true;
    else if (k === '--help' || k === '-h') { console.log(HELP); process.exit(0); }
    else { console.error(`unknown flag: ${k}`); process.exit(2); }
  }
  if (!a.base && !a.artifact) a.artifact = process.cwd();
  return a;
}

const HELP = `
artifact sub-resource crawler

  --artifact <dir>   serve <dir> locally and crawl it (default: cwd)
  --base <url>       crawl a live base URL instead
  --seed-from <dir>  seed the route list from every *.html in <dir>.
                     REQUIRED for meaningful --base runs on this site: the
                     homepage is a bundle whose nav hrefs are runtime-computed
                     ({{ dodHref }}), so a pure link-crawl from / reaches only
                     4 of 89 routes. Measured, not assumed.
  --timeout <ms>     per-request timeout (default 120000)
  --concurrency <n>  parallel requests (default 6)
  --retries <n>      retries on timeout/5xx/network error (default 1)
  --allow <file>     allowlist path (default tools/linkcheck/linkcheck-allow.txt)
  --json <file>      write full machine-readable report
  --no-fail-on-dynamic   downgrade DYNAMIC findings to warnings
  --quiet            suppress the per-route table
`;

// ------------------------------------------------------------ constants ----
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ASSET_EXT_RE =
  /\.(js|mjs|cjs|css|json|wasm|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|avif|ico|mp4|webm|ogg|mp3|wav|pdf|csv|txt|xml)$/i;

/** Schemes and pseudo-refs that are never a local sub-resource fetch. */
const SKIP_PREFIX = [
  'data:', 'blob:', 'javascript:', 'mailto:', 'tel:', 'sms:', 'about:',
  'chrome:', 'file:', 'ws:', 'wss:', 'intent:', 'geo:',
];

/**
 * Template-engine placeholders. index.html's decoded template contains
 * href="{{ dodHref }}" -- fetching that literally yields a 404 and a phantom
 * finding. Measured, not hypothetical.
 */
const PLACEHOLDER_RE = /\{\{|\}\}|\$\{|<%|%>|__[A-Z_]+__/;

// ------------------------------------------------------ bundle decoding ----
/**
 * Five pages on this site are self-extracting bundles: index.html,
 * benchmark/index.html, cv.html, entropy-driven.html, resume.html.
 *
 * Their real document lives in <script type="__bundler/template"> as a JSON
 * STRING; their assets live in <script type="__bundler/manifest"> as
 * {uuid: {mime, compressed, data}} with base64 (optionally gzipped) payloads;
 * external CDN deps live in <script type="__bundler/ext_resources">.
 *
 * A naive HTML parse of one of these pages finds ~2 script tags in the
 * bootstrap and reports a FALSE PASS. The original deck failure lived exactly
 * here. So: decode the template, treat it as the page's real HTML, and resolve
 * every UUID reference against manifest + ext_resources.
 */
function readBundlerBlock(html, type) {
  const re = new RegExp(`<script[^>]*type="__bundler/${type}"[^>]*>([\\s\\S]*?)</script>`, 'i');
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

function decodeBundle(html) {
  const tplRaw = readBundlerBlock(html, 'template');
  if (tplRaw === null) return null;
  const manRaw = readBundlerBlock(html, 'manifest');
  const extRaw = readBundlerBlock(html, 'ext_resources');

  let template, manifest = {}, ext = [];
  try {
    template = JSON.parse(tplRaw);
  } catch (e) {
    return { error: `template block is not valid JSON: ${e.message}` };
  }
  if (typeof template !== 'string') {
    return { error: 'template block decoded to a non-string' };
  }
  if (manRaw) {
    try { manifest = JSON.parse(manRaw); }
    catch (e) { return { error: `manifest block is not valid JSON: ${e.message}` }; }
  }
  if (extRaw) {
    try { ext = JSON.parse(extRaw); }
    catch (e) { return { error: `ext_resources block is not valid JSON: ${e.message}` }; }
  }
  const known = new Set(Object.keys(manifest));
  for (const e of ext) if (e && e.uuid) known.add(e.uuid);
  return { template, manifest, ext, known };
}

/** Decode one manifest asset to bytes (base64, optionally gzip/deflate). */
function decodeAsset(entry) {
  let raw = Buffer.from(entry.data || '', 'base64');
  if (entry.compressed) {
    for (const fn of [zlib.gunzipSync, zlib.inflateSync, zlib.inflateRawSync]) {
      try { return fn(raw); } catch { /* try next */ }
    }
  }
  return raw;
}

// ------------------------------------------------- reference extraction ----
/**
 * Two tiers, and the distinction carries all the nuance in this tool.
 *
 * DECLARATIVE - the browser is guaranteed to fetch it: HTML src/href/srcset/
 *   poster/data, CSS url() and @import, ES import/export-from, importScripts(),
 *   new Worker(), audioWorklet.addModule(). A non-200 here is unambiguously
 *   broken. Hard fail.
 *
 * DYNAMIC - an asset-shaped string literal inside an inline script, e.g.
 *   inject('deck_assets/flex-data.js', ...). This is where the deck failure
 *   lived, so it must be checked -- but static analysis CANNOT tell a live
 *   reference from dead guarded fallback code. Hard fail by default, with an
 *   auditable allowlist. See linkcheck-allow.txt.
 */
function pushRef(out, value, kind, tier) {
  if (typeof value !== 'string') return;
  const v = value.trim();
  if (!v || v.startsWith('#')) return;
  if (PLACEHOLDER_RE.test(v)) return;
  const lower = v.toLowerCase();
  for (const p of SKIP_PREFIX) if (lower.startsWith(p)) return;
  out.push({ value: v, kind, tier });
}

function stripComments(js) {
  // Kills block comments and WHOLE-LINE // comments, so commented-out code and
  // sourceMappingURL trailers do not become findings.
  //
  // Deliberately does NOT strip trailing `// ...` after code: in minified JS a
  // single protocol-relative URL ("//cdn.example/x.js") would otherwise eat the
  // rest of the line and silently drop every reference after it. Missing a real
  // reference is the worse error here.
  return js
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[\n\r])[ \t]*\/\/[^\n\r]*/g, '$1');
}

function extractCssRefs(css, out) {
  for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) pushRef(out, m[2], 'css-url', 'declarative');
  for (const m of css.matchAll(/@import\s+(?:url\(\s*)?(['"])([^'"]+)\1/gi)) pushRef(out, m[2], 'css-import', 'declarative');
}

function extractJsDeclarativeRefs(js, out) {
  const s = stripComments(js);
  for (const m of s.matchAll(/\bimport\s+[^;'"]*?from\s*(['"])([^'"]+)\1/g)) pushRef(out, m[2], 'es-import', 'declarative');
  for (const m of s.matchAll(/\bexport\s+[^;'"]*?from\s*(['"])([^'"]+)\1/g)) pushRef(out, m[2], 'es-export-from', 'declarative');
  for (const m of s.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g)) pushRef(out, m[2], 'es-dynamic-import', 'declarative');
  for (const m of s.matchAll(/^\s*import\s+(['"])([^'"]+)\1/gm)) pushRef(out, m[2], 'es-import-bare', 'declarative');
  for (const m of s.matchAll(/\bimportScripts\s*\(\s*(['"])([^'"]+)\1/g)) pushRef(out, m[2], 'importScripts', 'declarative');
  for (const m of s.matchAll(/new\s+(?:Shared)?Worker\s*\(\s*(['"])([^'"]+)\1/g)) pushRef(out, m[2], 'worker', 'declarative');
  for (const m of s.matchAll(/audioWorklet\s*\.\s*addModule\s*\(\s*(['"])([^'"]+)\1/g)) pushRef(out, m[2], 'audioworklet', 'declarative');
  for (const m of s.matchAll(/\.\s*addModule\s*\(\s*(['"])([^'"]+)\1/g)) pushRef(out, m[2], 'addModule', 'declarative');
}

function extractJsDynamicRefs(js, out) {
  const s = stripComments(js);
  for (const m of s.matchAll(/(['"])([^'"\n]{3,200})\1/g)) {
    const v = m[2];
    // Require a directory component. A bare "index.js" inside a minified vendor
    // bundle is overwhelmingly a module id or an error string, not a fetch.
    if (!v.includes('/')) continue;
    if (v.includes('://') || v.startsWith('//')) continue;
    if (/[<>{}*?\s]/.test(v)) continue;
    if (!ASSET_EXT_RE.test(v)) continue;
    pushRef(out, v, 'js-string', 'dynamic');
  }
}

const URL_ATTRS = {
  src: 'html-src',
  href: 'html-href',
  poster: 'html-poster',
  data: 'html-data',
  action: 'html-action',
  formaction: 'html-formaction',
  'xlink:href': 'html-xlink-href',
};

const NAV_KINDS = new Set(['html-href-a', 'html-href-area', 'html-action', 'html-formaction']);

function parseAttrs(attrText) {
  const attrs = {};
  for (const m of attrText.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

/**
 * Extract every local sub-resource reference from an HTML document.
 * `scanDynamic` controls whether inline-script string literals are harvested.
 */
function extractHtmlRefs(html, { scanDynamic = true } = {}) {
  const refs = [];
  let baseHref = null;

  // 1. <script> and <style> bodies, then blank them so the tag sweep below
  //    cannot re-match their contents as attributes.
  let rest = html;

  rest = rest.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (full, attrText, body) => {
    const attrs = parseAttrs(attrText);
    const type = (attrs.type || '').toLowerCase();
    if (attrs.src) pushRef(refs, attrs.src, 'html-src', 'declarative');
    // __bundler/* payload blocks are handled by decodeBundle, not here.
    if (!attrs.src && body.trim() && !type.startsWith('__bundler/')) {
      if (type === 'application/json' || type === 'importmap' || type === 'speculationrules') {
        // not executable script; skip
      } else {
        extractJsDeclarativeRefs(body, refs);
        if (scanDynamic) extractJsDynamicRefs(body, refs);
      }
    }
    return ' '.repeat(Math.min(full.length, 8));
  });

  rest = rest.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (full, body) => {
    extractCssRefs(body, refs);
    return ' ';
  });

  // 2. Attribute sweep over remaining tags.
  for (const m of rest.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*?)\/?>/g)) {
    const tag = m[1].toLowerCase();
    const attrs = parseAttrs(m[2]);

    if (tag === 'base' && attrs.href) { baseHref = attrs.href; continue; }

    for (const [attr, kind] of Object.entries(URL_ATTRS)) {
      if (!(attr in attrs)) continue;
      if (attr === 'data' && tag !== 'object') continue;
      if (attr === 'href' && tag === 'link') {
        const rel = (attrs.rel || '').toLowerCase();
        // rel=canonical / alternate / dns-prefetch / preconnect are hints, not fetches
        if (/\b(dns-prefetch|preconnect|canonical|alternate|me|profile|pingback|webmention)\b/.test(rel)) continue;
      }
      let kindOut = kind;
      if (attr === 'href' && (tag === 'a' || tag === 'area')) kindOut = `html-href-${tag}`;
      pushRef(refs, attrs[attr], kindOut, 'declarative');
    }

    if (attrs.srcset || attrs.imagesrcset) {
      for (const part of (attrs.srcset || attrs.imagesrcset).split(',')) {
        const url = part.trim().split(/\s+/)[0];
        pushRef(refs, url, 'html-srcset', 'declarative');
      }
    }
    if (attrs.style) extractCssRefs(attrs.style, refs);
  }

  return { refs, baseHref };
}

// ---------------------------------------------------------------- fetch ----
async function request(url, { method = 'GET', timeout, retries }) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeout);
    const started = Date.now();
    try {
      const res = await fetch(url, { method, redirect: 'follow', signal: ac.signal,
        headers: { 'user-agent': 'lebonhomme-linkcheck/1 (+ci artifact sub-resource gate)' } });
      let body = null;
      const ct = res.headers.get('content-type') || '';
      if (method === 'GET') body = await res.text();   // must fully drain before clearTimeout
      clearTimeout(t);
      return { status: res.status, ok: res.ok, contentType: ct, body,
               ms: Date.now() - started, bytes: body ? Buffer.byteLength(body) : null,
               finalUrl: res.url || url, timedOut: false, error: null };
    } catch (err) {
      clearTimeout(t);
      const timedOut = err?.name === 'AbortError';
      lastErr = { status: null, ok: false, timedOut, error: timedOut ? `timeout after ${timeout}ms` : String(err?.message || err),
                  ms: Date.now() - started, contentType: '', body: null, bytes: null, finalUrl: url };
      if (attempt < retries) await new Promise((r) => setTimeout(r, 750 * (attempt + 1)));
    }
  }
  return lastErr;
}

// ------------------------------------------------------------ allowlist ----
function globToRe(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, ' ').replace(/\*/g, '[^/]*').replace(/ /g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`);
}

async function loadAllowlist(file) {
  if (!file || !existsSync(file)) return [];
  const txt = await readFile(file, 'utf8');
  const out = [];
  for (const [n, line] of txt.split('\n').entries()) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const sp = s.search(/\s/);
    if (sp < 0) {
      console.error(`allowlist ${file}:${n + 1}: entry has no reason -- refusing. Format: <path-glob><whitespace>[requires=<regex>]<whitespace><reason>`);
      process.exit(2);
    }
    const pattern = s.slice(0, sp);
    let tail = s.slice(sp).trim();

    // Optional content guard. An allowlist entry may only suppress a finding
    // WHILE some signature is still present in the referencing page. This is
    // what stops an allowlist from masking the very regression it describes:
    // the deck's dead-fallback paths are only dead because the bundled runtime
    // sets window.FLEX_RAW. Strip that runtime out and the guard stops
    // matching, the entry stops applying, and the finding goes fatal again.
    let requires = null;
    const rm = tail.match(/^\[requires=(.+?)\]\s*/);
    if (rm) {
      try { requires = new RegExp(rm[1]); }
      catch (e) { console.error(`allowlist ${file}:${n + 1}: bad requires regex: ${e.message}`); process.exit(2); }
      tail = tail.slice(rm[0].length).trim();
    }
    if (!tail) {
      console.error(`allowlist ${file}:${n + 1}: entry has no reason -- refusing.`);
      process.exit(2);
    }
    out.push({ pattern, reason: tail, requires, requiresSrc: rm ? rm[1] : null,
               re: globToRe(pattern), hits: 0, guardFailed: 0 });
  }
  return out;
}

// ---------------------------------------------------------- page walking ----
function listArtifactHtml(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === '.git' || name === 'node_modules' || name === '.github') continue;
      const p = path.join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.html?$/i.test(name)) out.push(p);
    }
  };
  walk(root);
  return out.map((p) => {
    const rel = path.relative(root, p).split(path.sep).join('/');
    return rel.endsWith('/index.html') ? '/' + rel.slice(0, -'index.html'.length)
         : rel === 'index.html' ? '/' : '/' + rel;
  });
}

function resolveRef(value, pageUrl, baseHref, origin) {
  let abs;
  try {
    const b = baseHref ? new URL(baseHref, pageUrl) : new URL(pageUrl);
    abs = new URL(value, b);
  } catch { return { skip: 'unparseable' }; }
  if (abs.origin !== origin) return { skip: 'external', url: abs.href };
  abs.hash = '';
  return { url: abs.href, pathname: abs.pathname, rootAbsolute: value.startsWith('/') && !value.startsWith('//') };
}

async function pool(items, limit, fn) {
  const it = items[Symbol.iterator]();
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let n = it.next(); !n.done; n = it.next()) await fn(n.value);
  });
  await Promise.all(workers);
}

// ------------------------------------------------------------------ main ----
const args = parseArgs(process.argv);
const allowlist = await loadAllowlist(args.allow);

let server = null;
let BASE = args.base;
let mode = 'live';
let seedRoutes = [];

if (args.artifact) {
  const root = path.resolve(args.artifact);
  const started = await listen(root, 0);
  server = started.server;
  BASE = started.base;
  mode = 'artifact';
  seedRoutes = listArtifactHtml(root);
}
if (args.seedFrom) {
  seedRoutes = [...new Set([...seedRoutes, ...listArtifactHtml(path.resolve(args.seedFrom))])];
}
if (!BASE.endsWith('/')) BASE += '/';
const ORIGIN = new URL(BASE).origin;

const t0 = Date.now();
const pages = new Map();        // pathname -> page record
const resources = new Map();    // absolute url -> {status, ms, bytes, timedOut, error, referrers:Set, kinds:Set, tiers:Set}
const findings = [];
const queue = [];
const queued = new Set();
const linkedPages = new Set();  // reached via an actual <a href> on a crawled page

function enqueue(u) {
  let abs;
  try { abs = new URL(u, BASE); } catch { return; }
  if (abs.origin !== ORIGIN) return;
  abs.hash = ''; abs.search = '';
  if (queued.has(abs.href)) return;
  queued.add(abs.href);
  queue.push(abs.href);
}

enqueue(BASE);
for (const r of seedRoutes) enqueue(new URL(r, BASE).href);

function addFinding(f) { findings.push(f); }

function noteResource(url, ref, page) {
  let r = resources.get(url);
  if (!r) { r = { url, referrers: new Map(), tiers: new Set(), checked: false }; resources.set(url, r); }
  if (!r.referrers.has(page)) r.referrers.set(page, new Set());
  r.referrers.get(page).add(`${ref.kind}:${ref.value}`);
  r.tiers.add(ref.tier);
  return r;
}

/** Analyse one HTML document (raw page, or a decoded bundle template). */
function analyseDocument(html, pageUrl, rec, { scanDynamic }) {
  const { refs, baseHref } = extractHtmlRefs(html, { scanDynamic });
  for (const ref of refs) {
    if (rec.bundle && UUID_RE.test(ref.value)) {
      rec.uuidRefs++;
      if (!rec.bundle.known.has(ref.value.toLowerCase()) && !rec.bundle.known.has(ref.value)) {
        rec.unbundled++;
        addFinding({ type: 'UNBUNDLED', page: pageUrl, ref: ref.value, kind: ref.kind, fatal: true,
          detail: 'bundle template references a UUID that is in neither __bundler/manifest nor __bundler/ext_resources; the browser will resolve it as a relative path and 404' });
      }
      continue;
    }
    const r = resolveRef(ref.value, pageUrl, baseHref, ORIGIN);
    if (r.skip) { if (r.skip === 'external') rec.external++; continue; }
    if (r.rootAbsolute) {
      rec.rootAbsolute++;
      addFinding({ type: 'PORTABILITY', page: pageUrl, ref: ref.value, kind: ref.kind, fatal: false,
        detail: 'root-absolute path: breaks if this artifact is ever served from a subpath' });
    }
    if (NAV_KINDS.has(ref.kind)) { rec.navRefs++; linkedPages.add(r.url); enqueue(r.url); }
    noteResource(r.url, ref, pageUrl);
  }
}

while (queue.length && pages.size < args.maxPages) {
  const url = queue.shift();
  const res = await request(url, { method: 'GET', timeout: args.timeout, retries: args.retries });
  const rec = { url, status: res.status, ms: res.ms, bytes: res.bytes, timedOut: res.timedOut,
                error: res.error, bundle: null, refs: 0, navRefs: 0, uuidRefs: 0, unbundled: 0,
                rootAbsolute: 0, external: 0, manifestEntries: 0, templateBytes: 0 };
  pages.set(url, rec);

  // Page-level failures are classified AFTER the crawl, because whether a route
  // is link-reachable is not known until every page has been parsed.
  if (res.timedOut || !res.ok) continue;
  if (!/text\/html/i.test(res.contentType || '')) continue;

  const html = res.body || '';
  const bundle = decodeBundle(html);
  if (bundle?.error) {
    addFinding({ type: 'BUNDLE_ERROR', page: url, ref: url, kind: 'bundle', fatal: true, detail: bundle.error });
  } else if (bundle) {
    rec.bundle = bundle;
    rec.manifestEntries = Object.keys(bundle.manifest).length;
    rec.templateBytes = Buffer.byteLength(bundle.template);
    // The bootstrap shell itself may reference real files; check it too, but do
    // not harvest dynamic literals from it (it is generated boilerplate).
    analyseDocument(html.replace(/<script[^>]*type="__bundler\/[a-z_]+"[^>]*>[\s\S]*?<\/script>/gi, ''),
      url, { ...rec, bundle: null }, { scanDynamic: false });
    analyseDocument(bundle.template, url, rec, { scanDynamic: true });
    const corpus = [bundle.template];
    for (const [uuid, entry] of Object.entries(bundle.manifest)) {
      const mime = entry.mime || '';
      if (!/(css|javascript|json|html|xml|svg|text)/i.test(mime)) continue;
      let text;
      try { text = decodeAsset(entry).toString('utf8'); } catch { continue; }
      corpus.push(text);
      const sub = [];
      if (/css/i.test(mime)) extractCssRefs(text, sub);
      else extractJsDeclarativeRefs(text, sub);
      for (const ref of sub) {
        if (UUID_RE.test(ref.value)) {
          if (!bundle.known.has(ref.value)) {
            addFinding({ type: 'UNBUNDLED', page: url, ref: ref.value, kind: `manifest[${uuid.slice(0, 8)}]:${ref.kind}`,
              fatal: true, detail: 'bundled asset references a UUID absent from the manifest' });
          }
          continue;
        }
        const r = resolveRef(ref.value, url, null, ORIGIN);
        if (r.skip) continue;
        noteResource(r.url, { ...ref, kind: `manifest[${uuid.slice(0, 8)}]:${ref.kind}` }, url);
      }
    }
    // Corpus = everything the browser can actually execute on this page:
    // the decoded template plus every text asset carried in the manifest.
    // Allowlist [requires=...] guards are evaluated against this.
    rec.corpus = corpus.join('\n');
  } else {
    analyseDocument(html, url, rec, { scanDynamic: true });
    rec.corpus = html;
  }
  rec.refs = [...resources.values()].filter((r) => r.referrers.has(url)).length;
}

// -------------------------------------------------- phase 2: sub-resources ----
const toCheck = [...resources.values()].filter((r) => !pages.has(r.url));
await pool(toCheck, args.concurrency, async (r) => {
  // HEAD first: several assets here are multi-MB and we only need the status.
  let res = await request(r.url, { method: 'HEAD', timeout: args.timeout, retries: args.retries });
  if (res.status === 405 || res.status === 501 || res.status === null) {
    res = await request(r.url, { method: 'GET', timeout: args.timeout, retries: args.retries });
  }
  Object.assign(r, { status: res.status, ms: res.ms, timedOut: res.timedOut, error: res.error, checked: true });
});
for (const r of resources.values()) {
  if (pages.has(r.url)) {
    const p = pages.get(r.url);
    Object.assign(r, { status: p.status, ms: p.ms, timedOut: p.timedOut, error: p.error, checked: true });
  }
}

const pathOf = (u) => { try { return new URL(u).pathname; } catch { return u; } };

// -------------------------------------------- classify page-level failures ----
for (const [url, p] of pages) {
  if (!p.timedOut && p.status === 200) continue;
  const linked = linkedPages.has(url);
  const refs = resources.get(url);
  const referrers = refs ? [...refs.referrers.entries()].map(([pg, k]) => ({ page: pathOf(pg), refs: [...k] })) : [];

  if (p.timedOut) {
    addFinding({ type: 'TIMEOUT', page: pathOf(url), ref: pathOf(url), referrers, fatal: true,
      detail: `no response within ${args.timeout}ms (NOT a 404 -- distinct class)` });
    continue;
  }
  // A seed-only route that 404s in LIVE mode is ambiguous: the checkout we
  // seeded from can legitimately be ahead of what is deployed (mid-deploy, or
  // a working tree with new files). Nothing on the live site links to it, so it
  // is not the "200 page, dead scripts" class. Warn, do not fail.
  // In ARTIFACT mode there is no such excuse -- the seed and the server are the
  // same tree, so a 404 there is a real resolution bug.
  const fatal = linked || mode === 'artifact';
  addFinding({
    type: fatal ? 'PAGE_ERROR' : 'SEED_NOT_DEPLOYED',
    page: pathOf(url), ref: pathOf(url), referrers, fatal,
    detail: `page returned HTTP ${p.status ?? p.error}` +
      (fatal ? '' : ' — seeded from the checkout but nothing on the live site links to it; ' +
                    'likely deploy lag or an uncommitted file, not a broken reference'),
  });
}

for (const r of resources.values()) {
  if (r.status === 200) continue;
  if (pages.has(r.url)) continue;   // already classified above as PAGE_ERROR / SEED_NOT_DEPLOYED
  const dynamicOnly = r.tiers.has('dynamic') && !r.tiers.has('declarative');
  const hit = allowlist.find((a) => a.re.test(pathOf(r.url)));
  const referrers = [...r.referrers.entries()].map(([p, k]) => ({ page: pathOf(p), refs: [...k] }));

  if (r.timedOut) {
    addFinding({ type: 'TIMEOUT', page: referrers[0]?.page, ref: pathOf(r.url), url: r.url, referrers,
      fatal: true, detail: `no response within ${args.timeout}ms (NOT a 404 -- distinct class)` });
    continue;
  }
  if (dynamicOnly && hit) {
    // Evaluate the content guard against EVERY referring page. If any referrer
    // has lost the signature the entry depends on, the entry does not apply
    // there and the finding stays fatal.
    let guardOk = true, guardMiss = [];
    if (hit.requires) {
      for (const p of r.referrers.keys()) {
        const corpus = pages.get(p)?.corpus || '';
        if (!hit.requires.test(corpus)) { guardOk = false; guardMiss.push(pathOf(p)); }
      }
    }
    if (guardOk) {
      hit.hits++;
      addFinding({ type: 'ALLOWLISTED', page: referrers[0]?.page, ref: pathOf(r.url), url: r.url, referrers,
        fatal: false, detail: `HTTP ${r.status ?? r.error} — allowlisted: ${hit.reason}` +
          (hit.requiresSrc ? ` [guard /${hit.requiresSrc}/ still present]` : '') });
      continue;
    }
    hit.guardFailed++;
    addFinding({ type: 'MISSING_DYNAMIC', page: referrers[0]?.page, ref: pathOf(r.url), url: r.url, referrers,
      fatal: args.failOnDynamic,
      detail: `HTTP ${r.status ?? r.error} — ALLOWLIST GUARD FAILED: /${hit.requiresSrc}/ is no longer present in ${guardMiss.join(', ')}. ` +
        `The entry "${hit.reason}" no longer holds, so this reference is live again.` });
    continue;
  }
  addFinding({
    type: dynamicOnly ? 'MISSING_DYNAMIC' : 'MISSING',
    page: referrers[0]?.page, ref: pathOf(r.url), url: r.url, referrers,
    fatal: dynamicOnly ? args.failOnDynamic : true,
    detail: `HTTP ${r.status ?? r.error}`,
  });
}

// ---------------------------------------------------------------- report ----
const runtimeMs = Date.now() - t0;
const by = (t) => findings.filter((f) => f.type === t);
const fatal = findings.filter((f) => f.fatal);
const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

console.log(`\n${'='.repeat(78)}`);
console.log(`artifact sub-resource crawl  ·  mode=${mode}  ·  base=${args.artifact ? path.resolve(args.artifact) : BASE}`);
console.log(`${'='.repeat(78)}\n`);

if (!args.quiet) {
  console.log(pad('ROUTE', 46) + num('HTTP', 5) + num('ms', 7) + num('bytes', 11) + '  KIND');
  console.log('-'.repeat(96));
  for (const [url, p] of [...pages.entries()].sort()) {
    const kind = p.bundle ? `bundle(tpl ${p.templateBytes}B, manifest ${p.manifestEntries})` : '';
    console.log(pad(pathOf(url), 46) + num(p.timedOut ? 'TMO' : p.status ?? 'ERR', 5) +
      num(p.ms, 7) + num(p.bytes ?? '-', 11) + '  ' + kind);
  }
  console.log('-'.repeat(96));

  const byStatus = new Map();
  for (const r of resources.values()) {
    const k = r.timedOut ? 'TIMEOUT' : String(r.status ?? r.error);
    byStatus.set(k, (byStatus.get(k) || 0) + 1);
  }
  console.log(`\nSUB-RESOURCES  (unique local URLs referenced across all routes)`);
  for (const [k, v] of [...byStatus.entries()].sort()) console.log(`  ${pad(k, 12)} ${num(v, 5)}`);
}

const order = ['PAGE_ERROR', 'MISSING', 'MISSING_DYNAMIC', 'UNBUNDLED', 'BUNDLE_ERROR', 'TIMEOUT',
               'SEED_NOT_DEPLOYED', 'ALLOWLISTED', 'PORTABILITY'];
for (const type of order) {
  const list = by(type);
  if (!list.length) continue;
  if (type === 'PORTABILITY') {
    const byPath = new Map();
    for (const f of list) byPath.set(f.ref, (byPath.get(f.ref) || 0) + 1);
    console.log(`\n[WARN] PORTABILITY  ${list.length} root-absolute references across ${byPath.size} distinct paths (non-fatal)`);
    for (const [p, n] of [...byPath.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`   ${num(n, 5)}x  ${p}`);
    if (byPath.size > 8) console.log(`   ... and ${byPath.size - 8} more`);
    continue;
  }
  const tag = list.some((f) => f.fatal) ? 'FAIL' : 'WARN';
  console.log(`\n[${tag}] ${type}  (${list.length})`);
  for (const f of list) {
    console.log(`   ${f.ref}`);
    console.log(`       ${f.detail}`);
    for (const ref of (f.referrers || [{ page: pathOf(f.page), refs: [f.kind] }]).slice(0, 4)) {
      console.log(`       referenced by ${ref.page}  via  ${ref.refs.join(', ')}`);
    }
  }
}

for (const a of allowlist) {
  if (a.hits === 0 && a.guardFailed === 0) {
    console.log(`\n[WARN] allowlist entry never matched (stale — delete it?): ${a.pattern}  — ${a.reason}`);
  }
}

// Coverage guard. A live run with no seed list reaches only what the homepage
// links to, which on this site is 4 routes out of 89. Silently "passing" on 4%
// of the site is worse than not running at all, so say so loudly.
if (mode === 'live' && !args.seedFrom) {
  console.log(`\n[WARN] live run with no --seed-from: route discovery is link-crawl only.`);
  console.log(`       This site's homepage builds its nav at runtime, so a bare link-crawl`);
  console.log(`       sees a small fraction of the routes. Pass --seed-from <checkout> in CI.`);
}

console.log(`\n${'-'.repeat(78)}`);
console.log(`routes=${pages.size}  (seeded=${seedRoutes.length}, link-discovered=${Math.max(0, pages.size - seedRoutes.length)})  sub-resources=${resources.size}  findings=${findings.length}  fatal=${fatal.length}`);
console.log(`runtime=${(runtimeMs / 1000).toFixed(1)}s  timeout=${args.timeout}ms  concurrency=${args.concurrency}`);
console.log(fatal.length ? `RESULT: FAIL — ${fatal.length} fatal finding(s)` : 'RESULT: PASS');
console.log('-'.repeat(78));

if (args.json) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(args.json, JSON.stringify({
    mode, base: BASE, runtimeMs, args: { timeout: args.timeout, concurrency: args.concurrency },
    routes: [...pages.entries()].map(([url, p]) => ({
      path: pathOf(url), status: p.status, ms: p.ms, bytes: p.bytes, timedOut: p.timedOut, error: p.error,
      refs: p.refs, navRefs: p.navRefs, rootAbsolute: p.rootAbsolute, external: p.external,
      bundle: p.bundle ? { manifestEntries: p.manifestEntries, templateBytes: p.templateBytes, uuidRefs: p.uuidRefs, unbundled: p.unbundled } : null })),
    resources: [...resources.values()].map((r) => ({ path: pathOf(r.url), status: r.status, timedOut: r.timedOut, tiers: [...r.tiers], referrers: [...r.referrers.keys()].map(pathOf) })),
    findings,
  }, null, 2));
  console.log(`json report -> ${args.json}`);
}

if (server) server.close();
process.exit(fatal.length ? 1 : 0);
