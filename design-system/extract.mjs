/**
 * design-system/extract.mjs — read the canonical token source.
 *
 * WHY tokens.css IS THE SOURCE AND NOT A JSON FILE
 * ------------------------------------------------
 * The obvious architecture is a neutral JSON source that generates CSS. It was
 * rejected here for one reason: `tokens.css` already carries the *reasoning* —
 * which quantity each key colour is bound to, the measured contrast ratio, why
 * firetruck is held to 12px, why failure text goes darker on a light ground.
 * That prose is the design system; a JSON source would either drop it or
 * re-encode every comment as a `doc` string, which is transcription, and
 * transcription is how the two copies of tokens.css drifted in the first place.
 *
 * So: CSS is authored, everything else is derived. This module parses it into
 * a model that the emitters and the guard both consume, which means there is
 * exactly one place a hex can be introduced.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE = join(ROOT, 'tokens.css');

const NUL = String.fromCharCode(0);

/** Blank out CSS comments so declaration parsing never reads commented-out code. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, NUL);
}

/**
 * Parse every `--name: value;` declaration, grouped by selector block.
 * Only flat top-level blocks are recognised — a token file has no nesting, and
 * refusing to guess at anything else means a future `@media` block cannot be
 * half-read and then reported as fully parsed.
 */
export function parseTokens(css = readFileSync(SOURCE, 'utf8')) {
  const bare = stripComments(css);
  const blocks = {};
  const blockRe = /([^{}]*)\{([^{}]*)\}/g;
  let m;
  while ((m = blockRe.exec(bare)) !== null) {
    const selector = m[1].split(NUL).join('').trim().split('\n').pop().trim();
    if (!selector) continue;
    const decls = {};
    for (const d of m[2].split(';')) {
      const hit = /^\s*(--[A-Za-z0-9-]+)\s*:\s*([\s\S]+?)\s*$/.exec(d.split(NUL).join(' '));
      if (hit) decls[hit[1]] = hit[2].replace(/\s+/g, ' ').trim();
    }
    if (Object.keys(decls).length) blocks[selector] = { ...(blocks[selector] || {}), ...decls };
  }
  if (!blocks[':root']) {
    throw new Error(`${SOURCE}: no :root block parsed — refusing to emit from an empty model.`);
  }
  return blocks;
}

/** Resolve `var(--x)` chains to a literal, so derived targets get real values. */
export function resolve(blocks, selector, name, seen = new Set()) {
  const decls = { ...blocks[':root'], ...(blocks[selector] || {}) };
  let v = decls[name];
  if (v === undefined) return undefined;
  let guard = 0;
  while (/var\(\s*--/.test(v)) {
    if (guard++ > 32) throw new Error(`token ${name}: var() chain did not terminate`);
    v = v.replace(/var\(\s*(--[A-Za-z0-9-]+)\s*(?:,[^)]*)?\)/g, (_, ref) => {
      if (seen.has(ref)) throw new Error(`token ${name}: circular var() through ${ref}`);
      const r = resolve(blocks, selector, ref, new Set([...seen, ref]));
      if (r === undefined) throw new Error(`token ${name}: references undefined ${ref}`);
      return r;
    });
  }
  return v;
}

/**
 * The token source's declared values, with every `var()` resolved, as one
 * string per declaration across every block.
 *
 * WHY NOT JUST SCAN THE FILE TEXT
 * -------------------------------
 * `tokens.css` names the retired v1 palette in its "do not reintroduce"
 * palette-check-ignore-start
 * comment — #22D3EE, #FBBF24, #8B1A4A and the rest are written out so the
 * palette-check-ignore-end
 * migration record says what it forbids. A text scan therefore harvests the
 * retired colours into the allowlist and cheerfully authorises the exact hues
 * the other guard exists to reject. Declarations only.
 */
export function declaredValues(css = readFileSync(SOURCE, 'utf8')) {
  const blocks = parseTokens(css);
  const out = [];
  for (const selector of Object.keys(blocks)) {
    for (const name of Object.keys(blocks[selector])) {
      const v = resolve(blocks, selector, name);
      if (v !== undefined) out.push(v);
    }
  }
  return out;
}

/** Every literal hex the token source authorises, upper-case, 6-digit. */
export function paletteHexes(css = readFileSync(SOURCE, 'utf8')) {
  const set = new Set();
  for (const v of declaredValues(css)) {
    for (const m of v.matchAll(/#([0-9A-Fa-f]{6})(?![0-9A-Fa-f])/g)) {
      set.add('#' + m[1].toUpperCase());
    }
  }
  return set;
}

/** rgb()/rgba() triples the token source authorises, as "r,g,b". */
export function paletteRgb(css = readFileSync(SOURCE, 'utf8')) {
  const set = new Set();
  for (const v of declaredValues(css)) {
    for (const m of v.matchAll(/rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/g)) {
      set.add(`${+m[1]},${+m[2]},${+m[3]}`);
    }
  }
  return set;
}
