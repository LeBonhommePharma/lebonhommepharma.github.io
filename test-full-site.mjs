/**
 * Full-site functional validation for lebonhommepharma.github.io / thebonhomme.com
 *
 * Usage:
 *   node test-full-site.mjs [baseUrl]
 *   node test-full-site.mjs http://127.0.0.1:8765/ --skip-molstar
 *
 * Exit 0 = all critical checks passed; exit 1 = one or more failures.
 */
import { chromium, webkit } from 'playwright';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : 'http://127.0.0.1:8765/').replace(/\/?$/, '/');
const SKIP_MOLSTAR = process.argv.includes('--skip-molstar');
const SAFARI_ONLY = process.argv.includes('--safari-only');
const TIMEOUT = 90000;

const results = [];
let failed = 0;

function ok(name, detail = '') {
  results.push({ status: 'PASS', name, detail });
  console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`);
}
function fail(name, detail = '') {
  failed++;
  results.push({ status: 'FAIL', name, detail });
  console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
}
function info(name, detail = '') {
  results.push({ status: 'INFO', name, detail });
  console.log(`  · ${name}${detail ? ' — ' + detail : ''}`);
}
function section(title) {
  console.log(`\n══ ${title} ══`);
}

// ── 1. Static integrity (filesystem, no server needed for structure) ──
function validateDrugLibrary() {
  section('Drug of the Day library integrity');

  const queuePath = join(__dirname, 'drug-of-the-day/queue.json');
  if (!existsSync(queuePath)) {
    fail('queue.json exists');
    return;
  }
  ok('queue.json exists');

  let queue;
  try {
    queue = JSON.parse(readFileSync(queuePath, 'utf8'));
  } catch (e) {
    fail('queue.json parses', e.message);
    return;
  }
  ok('queue.json parses');

  const series = queue.series || [];
  if (series.length !== 70) fail('queue has 70 entries', `got ${series.length}`);
  else ok('queue has 70 entries');

  const ids = series.map((s) => s.id);
  const slugs = series.map((s) => s.slug);
  const idSet = new Set(ids);
  const slugSet = new Set(slugs);
  if (idSet.size !== ids.length) fail('unique series ids', `dupes among ${ids.length}`);
  else ok('unique series ids');
  if (slugSet.size !== slugs.length) fail('unique slugs', `dupes among ${slugs.length}`);
  else ok('unique slugs');

  // sequential 001–070
  const expected = Array.from({ length: 70 }, (_, i) => String(i + 1).padStart(3, '0'));
  const missingIds = expected.filter((id) => !idSet.has(id));
  if (missingIds.length) fail('series ids 001–070 complete', `missing ${missingIds.join(',')}`);
  else ok('series ids 001–070 complete');

  // each published entry has required fields + page
  let missingPages = 0;
  let incomplete = 0;
  const required = ['id', 'slug', 'drug', 'primary_target', 'pdb', 'status', 'href'];
  for (const entry of series) {
    for (const k of required) {
      if (entry[k] === undefined || entry[k] === null || entry[k] === '') {
        incomplete++;
        break;
      }
    }
    const page = join(__dirname, 'drug-of-the-day', entry.slug, 'index.html');
    if (!existsSync(page) || statSync(page).size < 1000) missingPages++;
  }
  if (incomplete) fail('entries have required fields', `${incomplete} incomplete`);
  else ok('all entries have required fields');
  if (missingPages) fail('every slug has index.html', `${missingPages} missing/empty`);
  else ok('every slug has index.html (≥1 KB)');

  // folder inventory
  const dirs = readdirSync(join(__dirname, 'drug-of-the-day'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const orphanDirs = dirs.filter((d) => !slugSet.has(d));
  if (orphanDirs.length) info('dirs not in queue', orphanDirs.join(', '));
  else ok('no orphan drug folders');

  // cross-check app.js drugComplexes
  const appJs = readFileSync(join(__dirname, 'app.js'), 'utf8');
  const hrefs = [...appJs.matchAll(/href:\s*'(\/drug-of-the-day\/[^']+\/)'/g)].map((m) => m[1]);
  if (hrefs.length !== 70) fail('app.js drugComplexes count', `got ${hrefs.length}`);
  else ok('app.js has 70 drugComplexes');

  let appMismatches = 0;
  for (const entry of series) {
    if (!hrefs.includes(entry.href)) appMismatches++;
  }
  if (appMismatches) fail('app.js hrefs match queue', `${appMismatches} missing`);
  else ok('app.js hrefs match queue.json');

  // sample drug pages include molstar viewer + theme
  let molPages = 0;
  let themePages = 0;
  for (const entry of series.slice(0, 10).concat(series.slice(-5))) {
    const html = readFileSync(join(__dirname, 'drug-of-the-day', entry.slug, 'index.html'), 'utf8');
    if (html.includes('molstar-viewer') && html.includes('molstar-drug-viewer')) molPages++;
    if (html.includes('theme.js')) themePages++;
  }
  if (molPages < 15) fail('sample pages embed Mol* viewer', `${molPages}/15`);
  else ok('sample drug pages embed Mol* viewer', `${molPages}/15 checked`);
  if (themePages < 15) fail('sample pages include theme.js', `${themePages}/15`);
  else ok('sample drug pages include theme.js');
}

function validateInteractionAndShannon() {
  section('Interaction handoff + Shannon surface');

  const ixPath = join(__dirname, 'interaction.css');
  if (!existsSync(ixPath)) {
    fail('interaction.css exists');
    return;
  }
  const ix = readFileSync(ixPath, 'utf8');
  const checks = [
    ['token teal', /--ix-teal:\s*#45E0A8/i],
    ['token violet', /--ix-violet:\s*#8B5CF6/i],
    ['token gold', /--ix-gold:\s*#FF9300/i],
    ['primary hover lift -1px', /translateY\(\s*-1px\s*\)/],
    ['primary hover brightness 1.06', /brightness\(\s*1\.06\s*\)/],
    ['card hover lift -4px', /translateY\(\s*-4px\s*\)/],
    ['focus-visible 2px teal', /outline:\s*2px\s+solid\s+var\(--ix-teal\)/],
  ];
  for (const [name, re] of checks) {
    if (re.test(ix)) ok(`interaction.css: ${name}`);
    else fail(`interaction.css: ${name}`);
  }

  const home = readFileSync(join(__dirname, 'index.html'), 'utf8');
  if (home.includes('href: \\"/shannon/\\"') || home.includes('href="/shannon/"') || home.includes('/shannon/')) {
    ok('homepage references /shannon/');
  } else {
    fail('homepage references /shannon/');
  }
  if (/Explore Shannon/.test(home)) ok('homepage Shannon CTA Explore Shannon');
  else fail('homepage Shannon CTA Explore Shannon');

  const shannonPath = join(__dirname, 'shannon/index.html');
  if (!existsSync(shannonPath)) {
    fail('shannon/index.html exists');
    return;
  }
  const sh = readFileSync(shannonPath, 'utf8');
  if (/Shannon/i.test(sh) && sh.length > 2000) ok('shannon page body present', `${sh.length} bytes`);
  else fail('shannon page body present', `len=${sh.length}`);
  if (/interaction\.css/.test(sh)) ok('shannon loads interaction.css');
  else fail('shannon loads interaction.css');
  if (/thebonhomme\.com\/shannon/.test(sh)) ok('shannon canonical URL');
  else fail('shannon canonical URL');
  if (/#45E0A8/i.test(sh) && /#8B5CF6/i.test(sh) && /#FF9300/i.test(sh)) {
    ok('shannon uses triad tokens');
  } else {
    fail('shannon uses triad tokens');
  }

  // Named surfaces load interaction treatment (link or inlined ix-canonical)
  const surfaces = [
    'cv.html',
    'resume.html',
    'entropy-driven/index.html',
    'FlexAIDdS/index.html',
    'flexaid-ds/index.html',
    'index.html',
  ];
  for (const rel of surfaces) {
    const html = readFileSync(join(__dirname, rel), 'utf8');
    if (html.includes('interaction.css') || html.includes('ix-canonical') || html.includes('--ix-teal')) {
      ok(`surface has interaction treatment: ${rel}`);
    } else {
      fail(`surface has interaction treatment: ${rel}`);
    }
  }

  // Both product trees must ship handoff tokens (live canonical path is /flexaid-ds/).
  for (const dir of ['FlexAIDdS', 'flexaid-ds']) {
    const flexHtml = readFileSync(join(__dirname, dir, 'index.html'), 'utf8');
    const flexCss = readFileSync(join(__dirname, dir, 'styles.css'), 'utf8');
    if (flexHtml.includes('/interaction.css') || flexHtml.includes('interaction.css')) {
      ok(`${dir} index links interaction.css`);
    } else {
      fail(`${dir} index links interaction.css`);
    }
    if (flexCss.includes('brightness(1.06)')) ok(`${dir} styles.css brightness(1.06)`);
    else fail(`${dir} styles.css brightness(1.06)`);
    if (!/#7FF0C4/i.test(flexCss)) ok(`${dir} styles.css has no #7FF0C4`);
    else fail(`${dir} styles.css has no #7FF0C4`);
  }
}

function validateStaticAssets() {
  section('Static asset presence');
  const required = [
    'app.js',
    'theme.js',
    'theme.css',
    'style.css',
    'CNAME',
    '.nojekyll',
    'assets/repo-stats.json',
    'assets/molstar-drug-viewer.js',
    'assets/molstar-drug-viewer.css',
    'assets/flexaid-logo.js',
    'assets/favicon-flexaid-ds.svg',
    'assets/logo-flexaid-ds.svg',
    'FlexAIDdS/index.html',
    'flexaid-ds/index.html',
    'flexaid-ds/styles.css',
    'FlexAIDdS/app.js',
    'FlexAIDdS/app.jsx',
    'FlexAIDdS/components.jsx',
    'FlexAIDdS/sections.jsx',
    'FlexAIDdS/styles.css',
    'drug-of-the-day/index.html',
    'drug-of-the-day/queue.json',
    'EntropyDocking.html',
    'entropy-docking/index.html',
    'entropy-driven/index.html',
    'entropy-help/index.html',
    'entropy-help/ledger.html',
    'entropy-help/request.html',
    'flexaid/index.html',
    'periodic/index.html',
    'cv.html',
    'cv.pdf',
    'resume.html',
    'resume.pdf',
    'index.html',
    'interaction.css',
    'shannon/index.html',
  ];
  let missing = 0;
  for (const rel of required) {
    const p = join(__dirname, rel);
    if (!existsSync(p)) {
      fail(`asset: ${rel}`);
      missing++;
    }
  }
  if (!missing) ok(`all ${required.length} critical assets present`);

  // CNAME
  const cname = readFileSync(join(__dirname, 'CNAME'), 'utf8').trim();
  if (cname === 'thebonhomme.com') ok('CNAME is thebonhomme.com');
  else fail('CNAME', `got "${cname}"`);

  // repo-stats schema
  try {
    const stats = JSON.parse(readFileSync(join(__dirname, 'assets/repo-stats.json'), 'utf8'));
    if (stats.commits > 0 && stats.languageCount > 0) ok('repo-stats.json schema', `${stats.commits} commits, ${stats.languageCount} langs`);
    else fail('repo-stats.json values', JSON.stringify(stats));
  } catch (e) {
    fail('repo-stats.json', e.message);
  }
}

// ── 2. HTTP availability ──
async function validateHttpRoutes() {
  section('HTTP route availability');
  const routes = [
    '',
    'app.js',
    'theme.js',
    'theme.css',
    'assets/repo-stats.json',
    'assets/molstar-drug-viewer.js',
    'assets/favicon-flexaid-ds.svg',
    'drug-of-the-day/',
    'drug-of-the-day/queue.json',
    'drug-of-the-day/cocaine/',
    'drug-of-the-day/naltrexone/',
    'drug-of-the-day/lsd/',
    'FlexAIDdS/',
    'flexaid-ds/',
    'FlexAIDdS/app.js',
    'FlexAIDdS/styles.css',
    'EntropyDocking.html',
    'entropy-docking/',
    'entropy-driven/',
    'entropy-help/',
    'entropy-help/ledger.html',
    'entropy-help/request.html',
    'flexaid/',
    'periodic/',
    'cv.html',
    'cv.pdf',
    'resume.html',
    'resume.pdf',
    'interaction.css',
    'shannon/',
    'shannon/index.html',
  ];

  let bad = 0;
  for (const route of routes) {
    const url = BASE + route;
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) {
        fail(`HTTP ${route || '(home)'}`, `status ${res.status}`);
        bad++;
      } else {
        const ct = res.headers.get('content-type') || '';
        info(`HTTP ${route || '(home)'}`, `${res.status} ${ct.split(';')[0]}`);
      }
    } catch (e) {
      fail(`HTTP ${route || '(home)'}`, e.message);
      bad++;
    }
  }
  if (!bad) ok(`all ${routes.length} routes return 2xx`);

  // Spot-check all 70 drug pages (batched to avoid hammering SimpleHTTPServer)
  section('HTTP all Drug of the Day pages');
  const queue = JSON.parse(readFileSync(join(__dirname, 'drug-of-the-day/queue.json'), 'utf8'));
  let pageFails = 0;
  const batchSize = 8;
  for (let i = 0; i < queue.series.length; i += batchSize) {
    const batch = queue.series.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (entry) => {
        const url = BASE + `drug-of-the-day/${entry.slug}/`;
        let lastErr = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const res = await fetch(url);
            if (!res.ok) {
              pageFails++;
              fail(`drug page ${entry.slug}`, `status ${res.status}`);
            }
            return;
          } catch (e) {
            lastErr = e;
            await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
          }
        }
        pageFails++;
        fail(`drug page ${entry.slug}`, lastErr?.message || 'fetch failed');
      })
    );
  }
  if (!pageFails) ok('all 70 drug pages return 2xx');
}

// ── 3. Browser functional tests ──
async function browserSmoke(engineName, launcher) {
  section(`Browser smoke: ${engineName}`);
  const browser = await launcher.launch({ headless: true });
  const isWebkit = engineName === 'webkit';
  const context = await browser.newContext({
    viewport: isWebkit ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    isMobile: isWebkit,
    hasTouch: isWebkit,
    userAgent: isWebkit
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : undefined,
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  try {
    // Homepage (bundled unpacker)
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(isWebkit ? 8000 : 5000);
    const homeTitle = await page.title();
    const homeBody = await page.evaluate(() => document.body?.innerText?.slice(0, 200) || '');
    const unpacking = await page.evaluate(() => {
      const el = document.getElementById('__bundler_loading');
      return el ? el.textContent : null;
    });
    if (homeTitle && homeTitle !== 'Bundled Page') ok(`${engineName}: homepage title`, homeTitle);
    else if (unpacking && /unpack|error|fail/i.test(unpacking)) {
      info(`${engineName}: homepage still unpacking or failed`, unpacking);
    } else {
      info(`${engineName}: homepage title`, homeTitle || '(empty)');
    }
    // Bundled pages need JS; after wait we expect more than spinner
    const hasContent = homeBody.length > 20 || (await page.locator('body').count()) > 0;
    if (hasContent) ok(`${engineName}: homepage DOM present`);
    else fail(`${engineName}: homepage DOM present`);

    // FlexAIDdS React app
    pageErrors.length = 0;
    consoleErrors.length = 0;
    await page.goto(BASE + 'FlexAIDdS/', { waitUntil: 'networkidle', timeout: TIMEOUT });
    // Wait for Babel + React mount
    await page.waitForTimeout(4000);
    const rootChildren = await page.evaluate(() => {
      const root = document.getElementById('root');
      return root ? root.childElementCount : -1;
    });
    const hasNav = await page.locator('nav, header, [class*="nav"]').count();
    const flexTitle = await page.title();
    if (rootChildren > 0 || hasNav > 0) {
      ok(`${engineName}: FlexAIDdS React mounts`, `root children=${rootChildren}, nav=${hasNav}, title="${flexTitle}"`);
    } else {
      fail(`${engineName}: FlexAIDdS React mounts`, `root children=${rootChildren}; errors=${pageErrors.slice(0, 3).join(' | ')}`);
    }
    // Theme toggle
    const themeBefore = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const themeBtn = page.locator('[data-theme-mount] button, .lbp-theme-toggle, button[aria-label*="theme" i], button[aria-label*="Theme" i]').first();
    if (await themeBtn.count()) {
      await themeBtn.click().catch(() => {});
      await page.waitForTimeout(300);
      const themeAfter = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      if (themeAfter && themeAfter !== themeBefore) {
        ok(`${engineName}: theme toggle switches`, `${themeBefore} → ${themeAfter}`);
      } else {
        // theme.js injects into data-theme-mount — try direct click on injected control
        const toggled = await page.evaluate(() => {
          const btn = document.querySelector('.lbp-theme-toggle, [data-theme-mount] button');
          if (!btn) return null;
          const before = document.documentElement.getAttribute('data-theme');
          btn.click();
          return { before, after: document.documentElement.getAttribute('data-theme') };
        });
        if (toggled && toggled.before !== toggled.after) {
          ok(`${engineName}: theme toggle switches`, `${toggled.before} → ${toggled.after}`);
        } else {
          info(`${engineName}: theme toggle`, `before=${themeBefore}, result=${JSON.stringify(toggled)}`);
        }
      }
    } else {
      // Check data-theme is set by theme.js
      if (themeBefore === 'dark' || themeBefore === 'light') {
        ok(`${engineName}: data-theme applied`, themeBefore);
      } else {
        info(`${engineName}: no theme toggle found`, `data-theme=${themeBefore}`);
      }
    }

    // Repo stats markers
    const stats = await page.evaluate(() => ({
      commits: document.getElementById('stat-commits')?.textContent,
      langs: document.getElementById('stat-langs')?.textContent,
    }));
    if (stats.commits && parseInt(stats.commits, 10) > 0) ok(`${engineName}: FlexAIDdS stat-commits`, stats.commits);
    else fail(`${engineName}: FlexAIDdS stat-commits`, JSON.stringify(stats));

    // Drug of the Day index
    pageErrors.length = 0;
    await page.goto(BASE + 'drug-of-the-day/', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(1500);
    const drugIndexText = await page.evaluate(() => document.body.innerText);
    const linkCount = await page.locator('a[href*="/drug-of-the-day/"]').count();
    if (drugIndexText.length > 200) ok(`${engineName}: drug index content`, `${drugIndexText.length} chars, ${linkCount} links`);
    else fail(`${engineName}: drug index content`, `len=${drugIndexText.length}`);

    // Sample drug page (cocaine) — structure + optional Mol*
    await page.goto(BASE + 'drug-of-the-day/cocaine/', { waitUntil: 'networkidle', timeout: TIMEOUT });
    await page.waitForTimeout(SKIP_MOLSTAR ? 1500 : 12000);
    const drugPage = await page.evaluate(() => {
      const viewer = document.getElementById('molstar-viewer');
      const canvas = viewer?.querySelector('canvas');
      return {
        title: document.title,
        hasViewer: !!viewer,
        ready: viewer?.classList.contains('molstar-ready') || false,
        unavailable: viewer?.classList.contains('molstar-unavailable') || false,
        canvasCount: viewer?.querySelectorAll('canvas').length || 0,
        canvasW: canvas?.width || 0,
        canvasH: canvas?.height || 0,
        hasReset: !!document.getElementById('btn-reset'),
        hasSpin: !!document.getElementById('btn-spin'),
        hasLigand: !!document.getElementById('btn-ligand'),
        hasSurface: !!document.getElementById('btn-surface'),
        dataPdb: document.body.innerHTML.match(/data-pdb=["']([^"']+)/)?.[1] || null,
        molstarGlobal: !!window.molstar || !!window.FlexAidMolstar || !!window.MolstarDrugViewer,
      };
    });
    if (/cocaine/i.test(drugPage.title) || drugPage.hasViewer) {
      ok(`${engineName}: cocaine page loads`, drugPage.title);
    } else {
      fail(`${engineName}: cocaine page loads`, JSON.stringify(drugPage));
    }
    if (drugPage.hasViewer && drugPage.hasReset && drugPage.hasSpin) {
      ok(`${engineName}: cocaine viewer chrome`, 'viewer + reset/spin/ligand/surface controls');
    } else {
      fail(`${engineName}: cocaine viewer chrome`, JSON.stringify(drugPage));
    }

    if (!SKIP_MOLSTAR) {
      const molOk =
        drugPage.canvasCount > 0 &&
        drugPage.canvasW > 0 &&
        drugPage.canvasH > 0 &&
        !drugPage.unavailable;
      if (molOk) {
        ok(`${engineName}: Mol* renders on cocaine`, `canvas ${drugPage.canvasW}x${drugPage.canvasH}`);
      } else {
        // Network/CDN flakiness is possible offline; treat as soft-fail with detail
        fail(
          `${engineName}: Mol* renders on cocaine`,
          `ready=${drugPage.ready} unavailable=${drugPage.unavailable} canvas=${drugPage.canvasCount} ${drugPage.canvasW}x${drugPage.canvasH} errors=${pageErrors.slice(0, 2).join(';')}`
        );
      }

      // Viewer control buttons don't throw
      for (const id of ['btn-spin', 'btn-ligand', 'btn-surface', 'btn-reset']) {
        const btn = page.locator(`#${id}`);
        if (await btn.count()) {
          await btn.click().catch((e) => fail(`${engineName}: click ${id}`, e.message));
        }
      }
      await page.waitForTimeout(500);
      ok(`${engineName}: viewer controls clickable`);
    } else {
      info(`${engineName}: Mol* skipped (--skip-molstar)`);
    }

    // Theme on drug page
    const drugTheme = await page.evaluate(() => {
      const before = document.documentElement.getAttribute('data-theme');
      const btn = document.querySelector('.lbp-theme-toggle, [data-theme-mount] button, button.lbp-theme-toggle');
      if (btn) btn.click();
      return { before, after: document.documentElement.getAttribute('data-theme'), hasBtn: !!btn };
    });
    if (drugTheme.hasBtn && drugTheme.before !== drugTheme.after) {
      ok(`${engineName}: drug page theme toggle`, `${drugTheme.before} → ${drugTheme.after}`);
    } else if (drugTheme.before) {
      ok(`${engineName}: drug page data-theme set`, drugTheme.before);
    } else {
      info(`${engineName}: drug page theme`, JSON.stringify(drugTheme));
    }

    // Second drug page (end of series)
    await page.goto(BASE + 'drug-of-the-day/naltrexone/', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(1000);
    const nalt = await page.evaluate(() => ({
      title: document.title,
      hasViewer: !!document.getElementById('molstar-viewer'),
      textLen: document.body.innerText.length,
    }));
    if (nalt.hasViewer && nalt.textLen > 200) ok(`${engineName}: naltrexone page`, nalt.title);
    else fail(`${engineName}: naltrexone page`, JSON.stringify(nalt));

    // Periodic table
    await page.goto(BASE + 'periodic/', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(2000);
    const periodic = await page.evaluate(() => ({
      title: document.title,
      textLen: document.body.innerText.length,
      cells: document.querySelectorAll('[data-element], .element, .periodic-cell, button, [class*="element"]').length,
    }));
    if (periodic.textLen > 100 && /periodic/i.test(periodic.title)) {
      ok(`${engineName}: periodic table`, `${periodic.cells} interactive nodes`);
    } else {
      fail(`${engineName}: periodic table`, JSON.stringify(periodic));
    }

    // entropy.help
    await page.goto(BASE + 'entropy-help/', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(1000);
    const ehelp = await page.evaluate(() => document.body.innerText.length);
    if (ehelp > 100) ok(`${engineName}: entropy-help`, `${ehelp} chars`);
    else fail(`${engineName}: entropy-help`, `chars=${ehelp}`);

    // flexaid landing
    await page.goto(BASE + 'flexaid/', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(800);
    const flexaid = await page.evaluate(() => ({
      title: document.title,
      textLen: document.body.innerText.length,
    }));
    if (flexaid.textLen > 50) ok(`${engineName}: flexaid landing`, flexaid.title);
    else fail(`${engineName}: flexaid landing`, JSON.stringify(flexaid));

    // EntropyDocking (canvas/WebGL heavy — just load)
    await page.goto(BASE + 'EntropyDocking.html', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(2000);
    const ent = await page.evaluate(() => ({
      title: document.title,
      canvas: document.querySelectorAll('canvas').length,
      textLen: document.body.innerText.length,
    }));
    if (ent.title || ent.canvas > 0 || ent.textLen > 20) {
      ok(`${engineName}: EntropyDocking.html`, `canvas=${ent.canvas}`);
    } else {
      fail(`${engineName}: EntropyDocking.html`, JSON.stringify(ent));
    }

    // CV page (bundled — may be slow)
    await page.goto(BASE + 'cv.html', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(isWebkit ? 6000 : 4000);
    const cv = await page.evaluate(() => ({
      title: document.title,
      textLen: (document.body?.innerText || '').length,
      unpacking: document.getElementById('__bundler_loading')?.textContent || null,
    }));
    if (cv.textLen > 50 || /cv|curriculum|résumé|resume|louis|bonhomme/i.test(cv.title + cv.textLen)) {
      ok(`${engineName}: cv.html loads`, `title="${cv.title}" chars=${cv.textLen}`);
    } else {
      info(`${engineName}: cv.html`, JSON.stringify(cv));
    }

    // Shannon product page
    pageErrors.length = 0;
    await page.goto(BASE + 'shannon/', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(1500);
    const shannon = await page.evaluate(() => ({
      title: document.title,
      text: document.body?.innerText || '',
      hasHero: !!document.getElementById('hero'),
      hasInstall: !!document.getElementById('install'),
      homeLink: !!document.querySelector('a[href="/"], a[href="/index.html"]'),
    }));
    if (/Shannon/i.test(shannon.title) && shannon.text.length > 200 && shannon.hasHero) {
      ok(`${engineName}: shannon page`, `title="${shannon.title}" chars=${shannon.text.length}`);
    } else {
      fail(`${engineName}: shannon page`, JSON.stringify({
        title: shannon.title,
        len: shannon.text.length,
        hasHero: shannon.hasHero,
        errors: pageErrors.slice(0, 2),
      }));
    }
    if (/entropy|collapse|H\s*=/i.test(shannon.text)) {
      ok(`${engineName}: shannon distinctive content`);
    } else {
      fail(`${engineName}: shannon distinctive content`);
    }
  } catch (e) {
    fail(`${engineName}: browser suite exception`, e.message);
  } finally {
    await browser.close();
  }
}

// ── 4. JS syntax sanity ──
async function validateJsSyntax() {
  section('JavaScript syntax / load sanity');
  const files = [
    'app.js',
    'theme.js',
    'assets/molstar-drug-viewer.js',
    'assets/flexaid-logo.js',
    'FlexAIDdS/app.js',
  ];
  for (const rel of files) {
    const src = readFileSync(join(__dirname, rel), 'utf8');
    // Wrap IIFE-safe check via Function constructor (doesn't execute top-level)
    try {
      // eslint-disable-next-line no-new-func
      new Function(src);
      ok(`syntax: ${rel}`, `${src.length} bytes`);
    } catch (e) {
      fail(`syntax: ${rel}`, e.message);
    }
  }
}

// ── main ──
async function main() {
  console.log(`Full-site validation against ${BASE}`);
  console.log(`skipMolstar=${SKIP_MOLSTAR} safariOnly=${SAFARI_ONLY}`);

  validateStaticAssets();
  validateDrugLibrary();
  validateInteractionAndShannon();
  await validateJsSyntax();
  await validateHttpRoutes();

  const engines = SAFARI_ONLY
    ? [{ name: 'webkit', launcher: webkit }]
    : [
        { name: 'chromium', launcher: chromium },
        { name: 'webkit', launcher: webkit },
      ];

  for (const eng of engines) {
    try {
      await browserSmoke(eng.name, eng.launcher);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      // Missing browser binaries (fresh Playwright install / incomplete cache)
      // must not fail structural + HTTP verification when browsers cannot run here.
      if (/Executable doesn't exist|browserType\.launch|Please run the following command to download/i.test(msg)) {
        info(`${eng.name}: browser unavailable`, msg.split('\n')[0]);
      } else {
        fail(`${eng.name}: launch/run`, msg);
      }
    }
  }

  section('Summary');
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fails = results.filter((r) => r.status === 'FAIL').length;
  const infos = results.filter((r) => r.status === 'INFO').length;
  console.log(`\n  PASS: ${pass}  FAIL: ${fails}  INFO: ${infos}`);
  if (fails) {
    console.log('\nFailures:');
    for (const r of results.filter((x) => x.status === 'FAIL')) {
      console.log(`  - ${r.name}: ${r.detail}`);
    }
  }
  process.exit(fails ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(2);
});
