/**
 * Structural + content tests for Shannon page, homepage link, and design handoff.
 * Drives real shipped files — no mocks of the page content.
 *
 *   node test-shannon-and-design.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
let failed = 0;

function ok(name, detail = '') {
  console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`);
}
function fail(name, detail = '') {
  failed++;
  console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
}

function mustExist(rel) {
  const p = join(__dirname, rel);
  if (existsSync(p)) ok(`exists ${rel}`);
  else fail(`exists ${rel}`);
  return p;
}

console.log('Shannon + design handoff structural suite\n');

// interaction.css contract
const ixPath = mustExist('interaction.css');
const ix = readFileSync(ixPath, 'utf8');
const tokenChecks = {
  'teal #45E0A8': /--ix-teal:\s*#45E0A8/i,
  'violet #8B5CF6': /--ix-violet:\s*#8B5CF6/i,
  'gold #FF9300': /--ix-gold:\s*#FF9300/i,
  'primary translateY(-1px)': /\.btn-primary:hover[\s\S]*?translateY\(\s*-1px\s*\)/,
  'brightness 1.06': /brightness\(\s*1\.06\s*\)/,
  'card translateY(-4px)': /translateY\(\s*-4px\s*\)/,
  'focus-visible 2px': /:focus-visible[\s\S]*?outline:\s*2px\s+solid\s+var\(--ix-teal\)/,
  'chrome no lift': /\.nav-gh:hover[\s\S]*?transform:\s*none/,
};
for (const [name, re] of Object.entries(tokenChecks)) {
  if (re.test(ix)) ok(`interaction.css ${name}`);
  else fail(`interaction.css ${name}`);
}

// Shannon page is real shipped HTML
const shPath = mustExist('shannon/index.html');
const sh = readFileSync(shPath, 'utf8');
if (sh.includes('<!doctype html>') || sh.includes('<!DOCTYPE html>')) ok('shannon doctype');
else fail('shannon doctype');
if (/Shannon — Entropy Collapse/.test(sh) || /<title>[^<]*Shannon/i.test(sh)) ok('shannon title');
else fail('shannon title');
if (sh.includes('interaction.css')) ok('shannon links interaction.css');
else fail('shannon links interaction.css');
if (sh.includes('https://thebonhomme.com/shannon/')) ok('shannon canonical');
else fail('shannon canonical');
if (sh.includes('id="hero"') && sh.includes('id="install"') && sh.includes('id="features"')) {
  ok('shannon sections hero/install/features');
} else {
  fail('shannon sections hero/install/features');
}
if (sh.includes('LeBonhommePharma/Shannon')) ok('shannon github reference');
else fail('shannon github reference');
if ((sh.includes('/FlexAIDdS/') || sh.includes('/flexaid-ds/')) && sh.includes('/')) ok('shannon ecosystem links');
else fail('shannon ecosystem links');

// Homepage product + footer point on-site
const home = readFileSync(join(__dirname, 'index.html'), 'utf8');
const productOnSite =
  home.includes('href: \\"/shannon/\\"') ||
  home.includes('href: "/shannon/"') ||
  /name: \\"Shannon\\"[^}]*href: \\"\/shannon\//.test(home);
if (productOnSite) ok('homepage product href /shannon/');
else fail('homepage product href /shannon/');
if (home.includes('Explore Shannon')) ok('homepage CTA Explore Shannon');
else fail('homepage CTA Explore Shannon');
if (/href=\\"\/shannon\/\\"[^>]*>Shannon — LLM entropy/.test(home) || home.includes('href=\\"/shannon/\\" style=\\"color:var(--muted);\\">Shannon — LLM entropy')) {
  ok('homepage footer Shannon → /shannon/');
} else if (home.includes('Shannon — LLM entropy') && home.includes('/shannon/')) {
  ok('homepage footer Shannon → /shannon/ (loose)');
} else {
  fail('homepage footer Shannon → /shannon/');
}

// Key surfaces still carry interaction treatment
for (const rel of ['cv.html', 'resume.html', 'entropy-driven/index.html', 'FlexAIDdS/index.html']) {
  const html = readFileSync(join(__dirname, rel), 'utf8');
  if (html.includes('interaction.css') || html.includes('ix-canonical') || html.includes('--ix-teal')) {
    ok(`interaction on ${rel}`);
  } else {
    fail(`interaction on ${rel}`);
  }
}

// FlexAID∆S product surfaces must ship handoff hover tokens (not legacy #7FF0C4)
// Canonical live path is /flexaid-ds/ (GitHub Pages keeps a poisoned /FlexAIDdS/ object).
for (const dir of ['FlexAIDdS', 'flexaid-ds']) {
  const flexCss = readFileSync(join(__dirname, dir, 'styles.css'), 'utf8');
  const flexHtml = readFileSync(join(__dirname, dir, 'index.html'), 'utf8');
  if (flexHtml.includes('interaction.css') || flexHtml.includes('href="/interaction.css"')) {
    ok(`${dir} index links interaction.css`);
  } else {
    fail(`${dir} index links interaction.css`);
  }
  if (flexCss.includes('brightness(1.06)')) ok(`${dir} styles brightness(1.06)`);
  else fail(`${dir} styles brightness(1.06)`);
  if (flexCss.includes('translateY(-1px)')) ok(`${dir} styles translateY(-1px)`);
  else fail(`${dir} styles translateY(-1px)`);
  if (flexCss.includes('translateY(-4px)')) ok(`${dir} styles translateY(-4px)`);
  else fail(`${dir} styles translateY(-4px)`);
  if (!/#7FF0C4/i.test(flexCss) && !/#7FF0C4/i.test(flexHtml)) ok(`${dir} has no legacy #7FF0C4`);
  else fail(`${dir} has no legacy #7FF0C4`);
}

// Homepage must deep-link to the live-publishable product path
const homeForFlex = readFileSync(join(__dirname, 'index.html'), 'utf8');
if (homeForFlex.includes('/flexaid-ds/')) ok('homepage links /flexaid-ds/');
else fail('homepage links /flexaid-ds/');
if (!homeForFlex.includes('/FlexAIDdS/')) ok('homepage avoids poisoned /FlexAIDdS/ path');
else fail('homepage avoids poisoned /FlexAIDdS/ path');

// CNAME
const cname = readFileSync(join(__dirname, 'CNAME'), 'utf8').trim();
if (cname === 'thebonhomme.com') ok('CNAME thebonhomme.com');
else fail('CNAME', cname);

console.log(`\n${failed ? 'FAIL' : 'PASS'}: ${failed} failure(s)`);
process.exit(failed ? 1 : 0);
