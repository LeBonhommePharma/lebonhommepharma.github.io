// Le Bonhomme Pharma — FlexAID∆S Homepage JS
// Tabs · Copy · Theme · Counter · Drug of day · Mol* hero · Mobile menu

(function () {
  'use strict';

  var MOLSTAR_BUILD = '20260620-theme';

  function installMolstarNetworkGuards() {
    if (window.__FLEXAID_MOLSTAR_GUARDS__) return;
    window.__FLEXAID_MOLSTAR_GUARDS__ = true;
    var origFetch = window.fetch;
    if (!origFetch) return;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('molstarvolseg.ncbr.muni.cz') !== -1) {
        return Promise.resolve(new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      return origFetch.apply(this, arguments);
    };
  }

  function bindMolstarRejectionGuard() {
    if (window.__FLEXAID_MOLSTAR_REJECTION_GUARD__) return;
    window.__FLEXAID_MOLSTAR_REJECTION_GUARD__ = true;
    window.addEventListener('unhandledrejection', function (e) {
      var reason = e.reason;
      var msg = reason && (reason.message || String(reason)) || '';
      if (/molstarvolseg|multiScale|is not iterable|Load failed/i.test(msg)) {
        e.preventDefault();
        molstarLog('warn', 'suppressed non-fatal Mol* rejection', reason);
      }
    });
  }

  installMolstarNetworkGuards();

  // ── Tab switching (Usage section) ──────────────────────────
  document.querySelectorAll('.usage-tabs .tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.getAttribute('aria-controls');
      document.querySelectorAll('.usage-tabs .tab-btn').forEach(function (b) {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.add('hidden'); });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      var panel = document.getElementById(target);
      if (panel) panel.classList.remove('hidden');
    });
  });

  // ── Copy buttons ───────────────────────────────────────────
  document.querySelectorAll('.copy-btn[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      navigator.clipboard.writeText(btn.dataset.copy).then(function () {
        var orig = btn.innerHTML;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22D3EE" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(function () { btn.innerHTML = orig; }, 1500);
      }).catch(function () {});
    });
  });

  // ── Repo stats — seed counters from shared markers ─────────
  function readStat(id, fallback) {
    var el = document.getElementById(id);
    if (!el || !el.textContent) return fallback;
    var n = parseInt(el.textContent.trim(), 10);
    return isNaN(n) ? fallback : n;
  }

  var commitTotal = readStat('stat-commits', 0);
  var langTotal = readStat('stat-langs', 0);

  function syncRepoStatsDisplay() {
    document.querySelectorAll('[data-count]').forEach(function (el) {
      if (commitTotal > 0) el.dataset.count = String(commitTotal);
    });
    var langDisplay = document.getElementById('stat-langs-display');
    if (langDisplay && langTotal > 0) langDisplay.textContent = String(langTotal);
    var langMarker = document.getElementById('stat-langs');
    if (langMarker && langTotal > 0) langMarker.textContent = String(langTotal);
  }

  syncRepoStatsDisplay();

  fetch('./assets/repo-stats.json', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data) return;
      if (data.commits > 0) commitTotal = data.commits;
      if (data.languageCount > 0) langTotal = data.languageCount;
      syncRepoStatsDisplay();
    })
    .catch(function () {});

  function animateCount(el) {
    var target = parseInt(el.dataset.count, 10);
    if (isNaN(target)) return;
    var dur = 1400;
    var start = performance.now();
    function tick(now) {
      var p = Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(eased * target);
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = target;
    }
    requestAnimationFrame(tick);
  }

  if ('IntersectionObserver' in window) {
    var countObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { animateCount(e.target); countObs.unobserve(e.target); }
      });
    }, { threshold: 0.3 });
    document.querySelectorAll('[data-count]').forEach(function (el) { countObs.observe(el); });
  } else {
    document.querySelectorAll('[data-count]').forEach(animateCount);
  }

  // ── Drug of the Day (published #001–#003; queue #004–#008 in drug-of-the-day/queue.json) ──
  var drugComplexes = [
    { pdb: '4xp4', drug: 'Cocaine HCl', target: 'dopamine transporter (DAT)', series: '001', href: '/drug-of-the-day/cocaine/' },
    { pdb: '6dzv', drug: 'MDMA',        target: 'serotonin transporter (SERT)', series: '002', href: '/drug-of-the-day/mdma/' },
    { pdb: '6wha', drug: 'DMT',         target: '5-HT\u2082A receptor', series: '003', href: '/drug-of-the-day/dmt/' },
    { pdb: '7wc7', drug: 'Psilocin',    target: '5-HT\u2082A receptor', series: '004', href: '/drug-of-the-day/psilocin/' },
    { pdb: '6wgt', drug: 'LSD',         target: '5-HT\u2082B receptor', series: '005', href: '/drug-of-the-day/lsd/' },
    { pdb: '7xna', drug: 'Amphetamine', target: 'dopamine transporter (DAT)', series: '006', href: '/drug-of-the-day/amphetamine/' },
    { pdb: '8ef5', drug: 'Fentanyl',    target: '\u03bc-opioid receptor', series: '007', href: '/drug-of-the-day/fentanyl/' },
    { pdb: '4djh', drug: 'Salvinorin A', target: '\u03ba-opioid receptor', series: '008', href: '/drug-of-the-day/salvinorin-a/' },
    { pdb: '5c1m', drug: 'Morphine',    target: '\u03bc-opioid receptor', series: '009', href: '/drug-of-the-day/morphine/' },
    { pdb: '4xp6', drug: 'Methamphetamine', target: 'dopamine transporter (DAT)', series: '010', href: '/drug-of-the-day/methamphetamine/' },
    { pdb: '7eu7', drug: 'Ketamine',    target: 'NMDA receptor', series: '011', href: '/drug-of-the-day/ketamine/' },
    { pdb: '5xra', drug: '\u03949-THC',  target: 'CB\u2081 receptor', series: '012', href: '/drug-of-the-day/thc/' },
    { pdb: '5kxi', drug: 'Nicotine',    target: '\u03b1\u2084\u03b2\u2082 nicotinic receptor', series: '013', href: '/drug-of-the-day/nicotine/' },
    { pdb: '5mzp', drug: 'Caffeine',    target: 'adenosine A\u2082A receptor', series: '014', href: '/drug-of-the-day/caffeine/' },
    { pdb: '6hup', drug: 'Diazepam',    target: 'GABA\u2090 receptor (BZD site)', series: '015', href: '/drug-of-the-day/diazepam/' },
    { pdb: '7ran', drug: 'Mescaline',   target: '5-HT\u2082A receptor', series: '016', href: '/drug-of-the-day/mescaline/' },
    { pdb: '5c1m', drug: 'Heroin',      target: '\u03bc-opioid receptor', series: '017', href: '/drug-of-the-day/heroin/' },
    { pdb: '5c1m', drug: 'Oxycodone',   target: '\u03bc-opioid receptor', series: '018', href: '/drug-of-the-day/oxycodone/' },
    { pdb: '5c1m', drug: 'Methadone',   target: '\u03bc-opioid receptor', series: '019', href: '/drug-of-the-day/methadone/' },
    { pdb: '5c1m', drug: 'Buprenorphine', target: '\u03bc-opioid receptor', series: '020', href: '/drug-of-the-day/buprenorphine/' },
    { pdb: '5c1m', drug: 'Tramadol',    target: '\u03bc-opioid receptor', series: '021', href: '/drug-of-the-day/tramadol/' },
    { pdb: '7t2g', drug: 'Mitragynine', target: '\u03bc-opioid receptor', series: '022', href: '/drug-of-the-day/mitragynine/' },
    { pdb: '4xp4', drug: 'Methylphenidate', target: 'dopamine transporter (DAT)', series: '023', href: '/drug-of-the-day/methylphenidate/' },
    { pdb: '4xp1', drug: 'MDPV',        target: 'dopamine transporter (DAT)', series: '024', href: '/drug-of-the-day/mdpv/' },
    { pdb: '4xp6', drug: 'Mephedrone',  target: 'DAT / SERT', series: '025', href: '/drug-of-the-day/mephedrone/' },
    { pdb: '7ran', drug: '2C-B',        target: '5-HT\u2082A receptor', series: '026', href: '/drug-of-the-day/2c-b/' },
    { pdb: '6wha', drug: '25I-NBOMe',   target: '5-HT\u2082A receptor', series: '027', href: '/drug-of-the-day/25i-nbome/' },
    { pdb: '6wha', drug: 'DOM',         target: '5-HT\u2082A receptor', series: '028', href: '/drug-of-the-day/dom/' },
    { pdb: '7wc5', drug: 'Psilocybin',  target: '5-HT\u2082A receptor', series: '029', href: '/drug-of-the-day/psilocybin/' },
    { pdb: '7e2y', drug: '5-MeO-DMT',   target: '5-HT\u2081A receptor', series: '030', href: '/drug-of-the-day/5-meo-dmt/' },
    { pdb: '6dzv', drug: 'Ibogaine',    target: 'serotonin transporter (SERT)', series: '031', href: '/drug-of-the-day/ibogaine/' },
    { pdb: '7sab', drug: 'PCP',         target: 'NMDA receptor', series: '032', href: '/drug-of-the-day/pcp/' },
    { pdb: '6huo', drug: 'Alprazolam', target: 'GABAₐ receptor (BZD site)', series: '033', href: '/drug-of-the-day/alprazolam/' },
    { pdb: '6hup', drug: 'Clonazepam', target: 'GABAₐ receptor (BZD site)', series: '034', href: '/drug-of-the-day/clonazepam/' },
    { pdb: '8dd2', drug: 'Zolpidem', target: 'GABAₐ receptor (α₁)', series: '035', href: '/drug-of-the-day/zolpidem/' },
    { pdb: '7eu7', drug: 'Ethanol', target: 'GABAₐ / NMDA (multi)', series: '036', href: '/drug-of-the-day/ethanol/' },
    { pdb: '7c7q', drug: 'GHB', target: 'GABA-B receptor', series: '037', href: '/drug-of-the-day/ghb/' },
    { pdb: '7c7q', drug: 'Phenibut', target: 'GABA-B receptor', series: '038', href: '/drug-of-the-day/phenibut/' },
    { pdb: '6x3w', drug: 'Phenobarbital', target: 'GABAₐ receptor (barbiturate site)', series: '039', href: '/drug-of-the-day/phenobarbital/' },
    { pdb: '7vfs', drug: 'Pregabalin', target: 'Caᵥ α₂δ-1 subunit', series: '040', href: '/drug-of-the-day/pregabalin/' },
    { pdb: '7eu7', drug: 'Dextromethorphan', target: 'NMDA receptor', series: '041', href: '/drug-of-the-day/dxm/' },
    { pdb: '4pe5', drug: 'Nitrous oxide', target: 'NMDA receptor', series: '042', href: '/drug-of-the-day/nitrous-oxide/' },
    { pdb: '7sad', drug: 'Memantine', target: 'NMDA receptor', series: '043', href: '/drug-of-the-day/memantine/' },
    { pdb: '4mm8', drug: 'Fluoxetine', target: 'serotonin transporter (SERT)', series: '044', href: '/drug-of-the-day/fluoxetine/' },
    { pdb: '6awo', drug: 'Sertraline', target: 'serotonin transporter (SERT)', series: '045', href: '/drug-of-the-day/sertraline/' },
    { pdb: '5i73', drug: 'Escitalopram', target: 'serotonin transporter (SERT)', series: '046', href: '/drug-of-the-day/escitalopram/' },
    { pdb: '5i6x', drug: 'Paroxetine', target: 'serotonin transporter (SERT)', series: '047', href: '/drug-of-the-day/paroxetine/' },
    { pdb: '5i6x', drug: 'Venlafaxine', target: 'serotonin transporter (SERT)', series: '048', href: '/drug-of-the-day/venlafaxine/' },
    { pdb: '4m48', drug: 'Bupropion', target: 'dopamine transporter (DAT)', series: '049', href: '/drug-of-the-day/bupropion/' },
    { pdb: '4m48', drug: 'Amitriptyline', target: 'serotonin transporter (SERT)', series: '050', href: '/drug-of-the-day/amitriptyline/' },
    { pdb: '2byb', drug: 'Phenelzine', target: 'monoamine oxidase (MAO)', series: '051', href: '/drug-of-the-day/phenelzine/' },
    { pdb: '6luq', drug: 'Haloperidol', target: 'dopamine D₂ receptor', series: '052', href: '/drug-of-the-day/haloperidol/' },
    { pdb: '6cm4', drug: 'Risperidone', target: 'dopamine D₂ / 5-HT₂A', series: '053', href: '/drug-of-the-day/risperidone/' },
    { pdb: '6cm4', drug: 'Olanzapine', target: 'dopamine D₂ / 5-HT₂A', series: '054', href: '/drug-of-the-day/olanzapine/' },
    { pdb: '6cm4', drug: 'Quetiapine', target: 'dopamine D₂ / 5-HT₂A', series: '055', href: '/drug-of-the-day/quetiapine/' },
    { pdb: '7e2z', drug: 'Aripiprazole', target: 'dopamine D₂ receptor', series: '056', href: '/drug-of-the-day/aripiprazole/' },
    { pdb: '8jxv', drug: 'Clozapine', target: 'dopamine D₄ receptor', series: '057', href: '/drug-of-the-day/clozapine/' },
    { pdb: '1pyx', drug: 'Lithium', target: 'GSK-3β / IMPase', series: '058', href: '/drug-of-the-day/lithium/' },
    { pdb: '8thh', drug: 'Lamotrigine', target: 'voltage-gated Na⁺ channel', series: '059', href: '/drug-of-the-day/lamotrigine/' },
    { pdb: '5u09', drug: 'Cannabidiol', target: 'CB₁ receptor', series: '060', href: '/drug-of-the-day/cbd/' },
    { pdb: '5xr8', drug: 'JWH-018', target: 'CB₁ receptor', series: '061', href: '/drug-of-the-day/jwh-018/' },
    { pdb: '6n4b', drug: 'Anandamide', target: 'CB₁ receptor', series: '062', href: '/drug-of-the-day/anandamide/' },
    { pdb: '9g5q', drug: 'Muscimol', target: 'GABAₐ receptor', series: '063', href: '/drug-of-the-day/muscimol/' },
    { pdb: '2z5x', drug: 'Harmine', target: 'monoamine oxidase A', series: '064', href: '/drug-of-the-day/harmine/' },
    { pdb: '6kuw', drug: 'Yohimbine', target: 'α₂-adrenergic receptor', series: '065', href: '/drug-of-the-day/yohimbine/' },
    { pdb: '5cxv', drug: 'Scopolamine', target: 'muscarinic ACh receptor', series: '066', href: '/drug-of-the-day/scopolamine/' },
    { pdb: '3rze', drug: 'Diphenhydramine', target: 'histamine H₁ receptor', series: '067', href: '/drug-of-the-day/diphenhydramine/' },
    { pdb: '6ur8', drug: 'Varenicline', target: 'α₄β₂ nicotinic receptor', series: '068', href: '/drug-of-the-day/varenicline/' },
    { pdb: '7e2y', drug: 'Buspirone', target: '5-HT₁A receptor', series: '069', href: '/drug-of-the-day/buspirone/' },
    { pdb: '4dkl', drug: 'Naltrexone', target: 'μ-opioid receptor', series: '070', href: '/drug-of-the-day/naltrexone/' },
  ];
  var dayIdx = Math.floor(Date.now() / 86400000) % drugComplexes.length;
  var todaysComplex = drugComplexes[dayIdx];

  var label = document.getElementById('drug-of-day-label');
  if (label) {
    label.innerHTML =
      '<span class="drug-series">#' + todaysComplex.series + '</span> ' +
      '<strong>' + todaysComplex.drug + '</strong> · ' +
      '<span class="drug-target">' + todaysComplex.target + '</span> ' +
      '<span class="drug-pdb">PDB ' + todaysComplex.pdb.toUpperCase() + '</span>';
  }
  var drugLink = document.querySelector('.drug-of-day');
  if (drugLink && todaysComplex.href) drugLink.setAttribute('href', todaysComplex.href);

  // ── Mobile menu toggle ─────────────────────────────────────
  var mobileToggle = document.querySelector('.mobile-menu-toggle');
  var mainNav = document.querySelector('.main-nav');
  if (mobileToggle && mainNav) {
    mobileToggle.addEventListener('click', function () {
      var isOpen = mobileToggle.getAttribute('aria-expanded') === 'true';
      mobileToggle.setAttribute('aria-expanded', String(!isOpen));
      if (!isOpen) {
        mainNav.style.cssText =
          'display:flex;flex-direction:column;gap:4px;position:absolute;top:56px;left:0;right:0;' +
          'background:rgba(10,14,20,0.98);padding:1rem 1.5rem;border-bottom:1px solid rgba(34,211,238,0.12);z-index:99;';
      } else {
        mainNav.removeAttribute('style');
      }
    });
    mainNav.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        mobileToggle.setAttribute('aria-expanded', 'false');
        mainNav.removeAttribute('style');
      });
    });
  }

  // ── Sticky header elevation on scroll ─────────────────────
  var header = document.getElementById('site-header');
  if (header) {
    window.addEventListener('scroll', function () {
      header.style.boxShadow = window.scrollY > 10 ? '0 4px 24px rgba(0,0,0,0.4)' : 'none';
    }, { passive: true });
  }

  // ── Mol* viewer — Drug-of-the-Day complex as hero background ─
  var molstarViewer = null;
  var molstarResizeObserver = null;

  function isIOSLike() {
    var ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/i.test(ua)) return true;
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  }

  function molstarLog(level, message, detail) {
    var fn = console[level] || console.log;
    if (detail !== undefined) fn.call(console, '[molstar] ' + message, detail);
    else fn.call(console, '[molstar] ' + message);
  }

  bindMolstarRejectionGuard();

  function isLightTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light';
  }

  function markViewerReady() {
    var el = document.getElementById('molstar-viewer');
    if (!el) return;
    el.classList.remove('molstar-unavailable');
    if (el.querySelector('canvas')) el.classList.add('molstar-ready');
  }

  function markViewerUnavailable(reason, detail) {
    molstarLog('warn', reason, detail);
    var el = document.getElementById('molstar-viewer');
    if (el) el.classList.add('molstar-unavailable');
  }

  function hasRenderableCanvas() {
    var el = document.getElementById('molstar-viewer');
    var canvas = el && el.querySelector('canvas');
    return !!(canvas && canvas.width > 0 && canvas.height > 0);
  }

  function recoverViewerIfCanvasReady(reason, detail) {
    if (hasRenderableCanvas()) {
      molstarLog('warn', reason + ' — canvas rendered, keeping viewer visible', detail);
      markViewerReady();
      if (molstarViewer && molstarViewer.plugin && molstarViewer.plugin.canvas3d) {
        molstarViewer.plugin.canvas3d.requestDraw();
      }
      return true;
    }
    markViewerUnavailable(reason, detail);
    return false;
  }

  function waitForStructures(plugin, maxMs) {
    maxMs = maxMs || 15000;
    var started = Date.now();
    return new Promise(function (resolve) {
      function poll() {
        var structures = plugin.managers.structure.hierarchy.current.structures;
        if (structures && structures.length) {
          resolve(structures);
          return;
        }
        if (Date.now() - started >= maxMs) {
          resolve(null);
          return;
        }
        setTimeout(poll, 250);
      }
      poll();
    });
  }

  function viewerThemePalette() {
    var light = isLightTheme();
    return {
      backgroundColor: light ? 0xffffff : 0x0a0e14,
      outlineColor: light ? 0x000000 : 0xffffff,
      backgroundAlpha: 1,
    };
  }

  function safePostprocessing(outlineOn) {
    var palette = viewerThemePalette();
    var ios = isIOSLike();
    var outline = {
      name: outlineOn ? 'on' : 'off',
      params: outlineOn ? {
        scale: ios ? 1.05 : 1.15,
        threshold: ios ? 0.26 : 0.22,
        color: palette.outlineColor,
      } : {},
    };
    return { outline: outline, occlusion: { name: 'off', params: {} } };
  }

  function publicationViewProps(light, tier) {
    var palette = viewerThemePalette();
    var ios = isIOSLike();
    var props = {
      renderer: {
        backgroundColor: palette.backgroundColor,
        backgroundAlpha: palette.backgroundAlpha,
        ambientIntensity: ios ? 0.85 : 0.78,
        lightIntensity: ios ? 0.68 : 0.62,
        highlightStrength: ios ? 0.28 : 0.35,
      },
      camera: {
        fog: 0,
        clipFar: false,
        clipNear: 0,
      },
      trackball: {
        animate: { name: 'spin', params: { speed: ios ? 0.24 : 0.32 } },
      },
    };

    if (tier === 'outline') {
      props.postprocessing = safePostprocessing(true);
    } else if (tier === 'basic') {
      props.postprocessing = safePostprocessing(false);
    }

    return props;
  }

  function setPublicationView(viewer) {
    if (!viewer || !viewer.plugin || !viewer.plugin.canvas3d) return;
    var light = isLightTheme();
    var canvas3d = viewer.plugin.canvas3d;
    var tiers = ['outline', 'basic'];

    function applyTier(index) {
      if (index >= tiers.length) return;
      try {
        canvas3d.setProps(publicationViewProps(light, tiers[index]));
        canvas3d.requestDraw();
      } catch (e) {
        molstarLog('warn', 'publication view tier failed: ' + tiers[index], e);
        applyTier(index + 1);
      }
    }

    applyTier(0);
  }

  function ensureViewerLayout(container) {
    var hero = container.closest('.hero');
    var height = 480;
    if (hero) {
      var rect = hero.getBoundingClientRect();
      if (rect.height > 0) height = Math.round(rect.height);
    }
    container.style.minHeight = height + 'px';
    container.style.width = '100%';
  }

  function bindViewerResize(viewer, container) {
    function refresh() {
      ensureViewerLayout(container);
      try {
        if (viewer.plugin && viewer.plugin.layout && viewer.plugin.layout.events) {
          viewer.plugin.layout.events.updated.next();
        }
        if (viewer.plugin && viewer.plugin.canvas3d) {
          viewer.plugin.canvas3d.requestResize();
          viewer.plugin.canvas3d.requestDraw();
        }
      } catch (e) { /* Safari layout refresh is best-effort */ }
    }

    if (molstarResizeObserver) molstarResizeObserver.disconnect();
    if ('ResizeObserver' in window) {
      molstarResizeObserver = new ResizeObserver(function () { refresh(); });
      molstarResizeObserver.observe(container);
      if (container.parentElement) molstarResizeObserver.observe(container.parentElement);
    }
    window.addEventListener('resize', refresh, { passive: true });
    window.addEventListener('orientationchange', function () { setTimeout(refresh, 250); }, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', refresh, { passive: true });
    }
    refresh();
  }

  function whenLayoutReady(container, cb) {
    ensureViewerLayout(container);
    requestAnimationFrame(function () {
      requestAnimationFrame(cb);
    });
  }

  function bindRenderErrorRecovery(viewer) {
    try {
      var canvas3d = viewer.plugin.canvas3d;
      if (!canvas3d || canvas3d.__flexaidRenderGuard) return;
      canvas3d.__flexaidRenderGuard = true;
      var origUpdate = canvas3d.update.bind(canvas3d);
      var recovered = false;
      canvas3d.update = function () {
        try {
          return origUpdate();
        } catch (e) {
          var msg = e && (e.message || String(e)) || '';
          if (!recovered && /multiScale/i.test(msg)) {
            recovered = true;
            molstarLog('warn', 'render loop error — disabling postprocessing', e);
            canvas3d.setProps({ postprocessing: safePostprocessing(false) });
            try { return origUpdate(); } catch (e2) { /* swallow repeat */ }
          }
        }
      };
    } catch (e) { /* optional guard */ }
  }

  function bindWebGLContextGuards(viewer) {
    try {
      var canvas = viewer.plugin.canvas3d.canvas;
      if (!canvas) return;
      canvas.addEventListener('webglcontextlost', function (e) {
        e.preventDefault();
        molstarLog('warn', 'WebGL context lost — attempting restore');
      }, false);
      canvas.addEventListener('webglcontextrestored', function () {
        molstarLog('warn', 'WebGL context restored — redrawing');
        setPublicationView(viewer);
        if (viewer.plugin.canvas3d) viewer.plugin.canvas3d.requestDraw();
      }, false);
    } catch (e) { /* optional guard */ }
  }

  function ballAndStickParams() {
    return {
      sizeFactor: 0.48,
      sizeAspectRatio: 0.32,
      adjustCylinderLength: true,
      bondScale: 0.55,
      bondSpacing: 0.52,
      linked: true,
      aromaticBonds: true,
      multipleBonds: 'offset',
      includeHydrogens: true,
    };
  }

  function addRepresentation(plugin, component, spec) {
    if (!component) return Promise.resolve(false);
    return plugin.managers.structure.representation.addRepresentation(component, spec)
      .then(function () { return true; })
      .catch(function (err) {
        molstarLog('warn', 'representation add failed', err);
        return false;
      });
  }

  function applyDrugOfDayRepresentations(viewer) {
    var plugin = viewer.plugin;
    return waitForStructures(plugin).then(function (structures) {
      if (!structures || !structures.length) {
        molstarLog('warn', 'no structures loaded — keeping default representation');
        return false;
      }

      var struct = structures[0];

      function addCustomRepresentations() {
        var polymerOk = false;
        var ligandOk = false;

        return plugin.managers.structure.component.add(
          { structure: struct },
          { type: { name: 'static', params: 'polymer' } }
        ).then(function (polymerComp) {
          return addRepresentation(plugin, polymerComp, {
            type: 'cartoon',
            typeParams: { alpha: isIOSLike() ? 0.5 : 0.42 },
            color: 'chain-id',
          }).then(function (ok) { polymerOk = ok; return ok; });
        }).then(function () {
          return plugin.managers.structure.component.add(
            { structure: struct },
            { type: { name: 'static', params: 'ligand' } }
          );
        }).then(function (ligandComp) {
          return addRepresentation(plugin, ligandComp, {
            type: 'ball-and-stick',
            typeParams: ballAndStickParams(),
            color: 'element-symbol',
            colorParams: {
              carbonColor: { name: 'uniform', params: { value: 0xE8E8E8 } },
            },
          }).then(function (ok) { ligandOk = ok; return ok; });
        }).then(function () {
          return plugin.managers.structure.component.add(
            { structure: struct },
            { type: { name: 'static', params: 'branched' } }
          );
        }).then(function (branchedComp) {
          return addRepresentation(plugin, branchedComp, {
            type: 'ball-and-stick',
            typeParams: ballAndStickParams(),
            color: 'element-symbol',
          });
        }).then(function () {
          plugin.managers.camera.reset();
          return polymerOk || ligandOk;
        });
      }

      return plugin.managers.structure.component.clear(struct).then(function () {
        return addCustomRepresentations();
      }).catch(function (err) {
        molstarLog('warn', 'clear/default customize failed — adding on top of defaults', err);
        return addCustomRepresentations();
      }).catch(function (err) {
        molstarLog('warn', 'custom representations failed — keeping defaults', err);
        plugin.managers.camera.reset();
        return false;
      });
    });
  }

  function loadStructure(viewer, pdbId) {
    var plugin = viewer.plugin;
    var id = pdbId.toLowerCase();

    return viewer.loadPdb(id).catch(function (err) {
      molstarLog('warn', 'loadPdb failed for ' + id + ', trying RCSB PDB', err);
      return plugin.loadStructureFromUrl(
        'https://files.rcsb.org/download/' + id + '.pdb',
        'pdb',
        { label: id.toUpperCase() }
      );
    }).catch(function (err) {
      molstarLog('warn', 'RCSB PDB failed for ' + id + ', trying PDBe bcif', err);
      return plugin.loadStructureFromUrl(
        'https://www.ebi.ac.uk/pdbe/entry-files/download/' + id + '.bcif',
        'bcif',
        { label: id.toUpperCase() }
      );
    }).then(function () { return true; })
      .catch(function (err) {
        molstarLog('error', 'all structure loaders failed for ' + id, err);
        return false;
      });
  }

  function loadMolstarScript(done) {
    if (window.molstar) {
      done();
      return;
    }
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/molstar@4.5.0/build/viewer/molstar.js';
    script.onload = done;
    script.onerror = function () {
      var fallback = document.createElement('script');
      fallback.src = 'https://unpkg.com/molstar@4.5.0/build/viewer/molstar.js';
      fallback.onload = done;
      fallback.onerror = function () {
        markViewerUnavailable('Mol* script failed to load from CDN');
      };
      document.head.appendChild(fallback);
    };
    document.head.appendChild(script);
  }

  function initMolstar() {
    var container = document.getElementById('molstar-viewer');
    if (!container) return;
    if (!window.molstar) {
      markViewerUnavailable('Mol* library not available');
      return;
    }

    whenLayoutReady(container, function () {
      var ios = isIOSLike();
      molstar.Viewer.create('molstar-viewer', {
        layoutIsExpanded: false,
        layoutShowControls: false,
        layoutShowRemoteState: false,
        layoutShowSequence: false,
        layoutShowLog: false,
        layoutShowLeftPanel: false,
        viewportShowExpand: false,
        viewportShowSelectionMode: false,
        viewportShowAnimation: false,
        viewportShowControls: false,
        pdbProvider: 'rcsb',
        emdbProvider: 'pdbe',
        volumesAndSegmentationsDefaultServer: '',
        volumeStreamingDisabled: true,
        canvas3d: {
          transparentBackground: false,
          renderer: {
            backgroundColor: viewerThemePalette().backgroundColor,
            backgroundAlpha: 1,
            pixelRatio: ios ? Math.min(window.devicePixelRatio || 1, 2) : (window.devicePixelRatio || 1),
          },
          camera: { fog: 0, clipFar: false },
          postprocessing: safePostprocessing(true),
          trackball: {
            noScroll: true,
            noRotate: false,
            noPan: true,
            noZoom: true,
          },
        },
      }).then(function (viewer) {
        molstarViewer = viewer;
        bindViewerResize(viewer, container);
        bindRenderErrorRecovery(viewer);
        bindWebGLContextGuards(viewer);
        return loadStructure(viewer, todaysComplex.pdb);
      }).then(function (loaded) {
        if (!loaded || !molstarViewer) {
          markViewerUnavailable('structure failed to load for PDB ' + todaysComplex.pdb);
          return;
        }
        setPublicationView(molstarViewer);
        return applyDrugOfDayRepresentations(molstarViewer).catch(function (repErr) {
          molstarLog('warn', 'representation customize failed — keeping default render', repErr);
        });
      }).then(function () {
        if (!molstarViewer) return;
        markViewerReady();
        if (molstarViewer.plugin && molstarViewer.plugin.canvas3d) {
          molstarViewer.plugin.canvas3d.requestDraw();
        }
      }).catch(function (err) {
        recoverViewerIfCanvasReady('viewer initialization failed', err);
      });
    });
  }

  function onThemeChange() {
    if (!molstarViewer) return;
    setPublicationView(molstarViewer);
    if (molstarViewer.plugin && molstarViewer.plugin.canvas3d) {
      molstarViewer.plugin.canvas3d.requestDraw();
    }
  }

  if (window.LBPTheme) {
    var origApply = window.LBPTheme.apply;
    window.LBPTheme.apply = function (next) {
      origApply(next);
      onThemeChange();
    };
  } else {
    new MutationObserver(function () { onThemeChange(); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  function bootMolstar() {
    var attempts = 0;
    function tryBoot() {
      if (window.molstar) {
        initMolstar();
        return;
      }
      if (attempts++ < 40) {
        setTimeout(tryBoot, 100);
        return;
      }
      loadMolstarScript(initMolstar);
    }
    tryBoot();
  }

  if (document.readyState === 'complete') {
    bootMolstar();
  } else {
    window.addEventListener('load', bootMolstar);
  }

  window.__FLEXAID_MOLSTAR_BUILD__ = MOLSTAR_BUILD;
})();