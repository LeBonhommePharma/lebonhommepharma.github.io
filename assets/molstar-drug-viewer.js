// Le Bonhomme Pharma — shared Mol* publication viewer for Drug of the Day pages.
// Cartoon receptor · valence ball-and-stick ligand · outline postprocessing · no lines.

(function (global) {
  'use strict';

  var BUILD = '20260721-onload-fix';
  var IOS_MAX_DPR = 2;      // effective device-pixel-ratio ceiling on iOS
  var BOOT_TIMEOUT_MS = 20000;  // hang -> visible error instead of an endless spinner
  var viewers = new WeakMap();
  var surfaceReprs = new WeakMap();
  var spinOn = new WeakMap();

  function installGuards() {
    if (global.__FLEXAID_MOLSTAR_GUARDS__) return;
    global.__FLEXAID_MOLSTAR_GUARDS__ = true;
    var origFetch = global.fetch;
    if (!origFetch) return;
    global.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      // Mol* volume/segmentation probes (and a broken empty default server that
      // resolves to same-origin /list_entries/…) are not needed for Drug-of-the-Day
      // structure pages. Stub them so a 404 HTML body never gets JSON-parsed.
      if (
        url.indexOf('molstarvolseg.ncbr.muni.cz') !== -1 ||
        /\/list_entries\//i.test(url) ||
        /volumes?[_-]?and[_-]?seg/i.test(url)
      ) {
        return Promise.resolve(new Response('{"entries":[]}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      return origFetch.apply(this, arguments);
    };
    global.addEventListener('unhandledrejection', function (e) {
      var msg = e.reason && (e.reason.message || String(e.reason)) || '';
      if (/molstarvolseg|multiScale|is not iterable|list_entries/i.test(msg)) {
        e.preventDefault();
        log('warn', 'suppressed non-fatal Mol* rejection', e.reason);
      }
    });
  }

  installGuards();

  function log(level, message, detail) {
    var fn = console[level] || console.log;
    if (detail !== undefined) fn.call(console, '[molstar-drug] ' + message, detail);
    else fn.call(console, '[molstar-drug] ' + message);
  }

  function isIOSLike() {
    var ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/i.test(ua)) return true;
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  }

  function isLightTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light';
  }

  function palette() {
    var light = isLightTheme();
    return {
      backgroundColor: light ? 0xffffff : 0x08091A,
      outlineColor: light ? 0x000000 : 0xffffff,
      backgroundAlpha: 1,
    };
  }

  function safePostprocessing(outlineOn) {
    var pal = palette();
    var ios = isIOSLike();
    return {
      outline: {
        name: outlineOn ? 'on' : 'off',
        params: outlineOn ? {
          scale: ios ? 1.08 : 1.18,
          threshold: ios ? 0.24 : 0.20,
          color: pal.outlineColor,
        } : {},
      },
      occlusion: { name: 'off', params: {} },
    };
  }

  function publicationViewProps(light, tier, interactive, viewer) {
    var ios = isIOSLike();
    var pal = palette();
    var spinning = viewer ? !!spinOn.get(viewer) : false;
    var props = {
      renderer: {
        backgroundColor: pal.backgroundColor,
        backgroundAlpha: pal.backgroundAlpha,
        ambientIntensity: ios ? 0.88 : 0.82,
        lightIntensity: ios ? 0.72 : 0.68,
        highlightStrength: ios ? 0.32 : 0.40,
        light: [{ inclination: 160, azimuth: 25, color: 0xffffff, intensity: 0.55 }],
      },
      camera: { fog: 0, clipFar: false, clipNear: 0 },
      trackball: {
        animate: spinning ? { name: 'spin', params: { speed: ios ? 0.22 : 0.30 } } : { name: 'off', params: {} },
        noScroll: !interactive,
        noRotate: false,
        noPan: !interactive,
        noZoom: !interactive,
      },
    };
    if (tier === 'outline') props.postprocessing = safePostprocessing(true);
    else if (tier === 'basic') props.postprocessing = safePostprocessing(false);
    return props;
  }

  function setPublicationView(viewer, interactive) {
    if (!viewer || !viewer.plugin || !viewer.plugin.canvas3d) return;
    var canvas3d = viewer.plugin.canvas3d;
    // iOS: skip the 'outline' tier — the screen-space outline pass is a full extra
    // pass and one of the most expensive effects on the iOS GPU.
    var tiers = isIOSLike() ? ['basic'] : ['outline', 'basic'];
    function applyTier(i) {
      if (i >= tiers.length) return;
      try {
        canvas3d.setProps(publicationViewProps(isLightTheme(), tiers[i], interactive, viewer));
        canvas3d.requestDraw();
      } catch (e) {
        log('warn', 'publication tier failed: ' + tiers[i], e);
        applyTier(i + 1);
      }
    }
    applyTier(0);
  }

  function cartoonParams() {
    return {
      alpha: isIOSLike() ? 0.46 : 0.38,
      tubularHelices: true,
      arrowTip: true,
    };
  }

  function ligandBallStickParams() {
    return {
      sizeFactor: 0.52,
      sizeAspectRatio: 0.28,
      adjustCylinderLength: true,
      bondScale: 0.58,
      bondSpacing: 0.48,
      linked: true,
      aromaticBonds: true,
      multipleBonds: 'offset',
      includeHydrogens: true,
    };
  }

  function contactBallStickParams() {
    return {
      sizeFactor: 0.30,
      sizeAspectRatio: 0.22,
      adjustCylinderLength: true,
      bondScale: 0.42,
      bondSpacing: 0.44,
      linked: true,
      aromaticBonds: true,
      multipleBonds: 'offset',
      includeHydrogens: false,
    };
  }

  function addRep(plugin, component, spec) {
    if (!component) return Promise.resolve(false);
    return plugin.managers.structure.representation.addRepresentation(component, spec)
      .then(function () { return true; })
      .catch(function (err) {
        log('warn', 'representation add failed', err);
        return false;
      });
  }

  function waitForStructures(plugin, maxMs) {
    maxMs = maxMs || 15000;
    var started = Date.now();
    return new Promise(function (resolve) {
      function poll() {
        var structures = plugin.managers.structure.hierarchy.current.structures;
        if (structures && structures.length) return resolve(structures);
        if (Date.now() - started >= maxMs) return resolve(null);
        setTimeout(poll, 250);
      }
      poll();
    });
  }

  function applyPublicationRepresentations(viewer) {
    var plugin = viewer.plugin;
    return waitForStructures(plugin).then(function (structures) {
      if (!structures || !structures.length) {
        log('warn', 'no structures loaded');
        return false;
      }
      var struct = structures[0];

      function build() {
        var ligandComp = null;
        // clear() can throw "is not iterable" on some Mol* 4.x hierarchy states
        // (esp. after volume-stream probes fail). Soft-fail and still add reps.
        var clearP = Promise.resolve();
        try {
          clearP = plugin.managers.structure.component.clear(struct).catch(function (err) {
            log('warn', 'component.clear failed, continuing', err);
          });
        } catch (err) {
          log('warn', 'component.clear threw, continuing', err);
        }
        return clearP.then(function () {
          return plugin.managers.structure.component.add(
            { structure: struct },
            { type: { name: 'static', params: 'polymer' } }
          );
        }).then(function (polymerComp) {
          return addRep(plugin, polymerComp, {
            type: 'cartoon',
            typeParams: cartoonParams(),
            color: 'chain-id',
          });
        }).then(function () {
          return plugin.managers.structure.component.add(
            { structure: struct },
            { type: { name: 'expression', params: 'protein and within 4 of (hetero and not water and not ion)' } }
          );
        }).then(function (contactComp) {
          return addRep(plugin, contactComp, {
            type: 'ball-and-stick',
            typeParams: contactBallStickParams(),
            color: 'element-symbol',
          });
        }).then(function () {
          return plugin.managers.structure.component.add(
            { structure: struct },
            { type: { name: 'static', params: 'ligand' } }
          );
        }).then(function (comp) {
          ligandComp = comp;
          return addRep(plugin, comp, {
            type: 'ball-and-stick',
            typeParams: ligandBallStickParams(),
            color: 'element-symbol',
            colorParams: {
              carbonColor: { name: 'uniform', params: { value: 0xE8E8E8 } },
            },
          });
        }).then(function () {
          return plugin.managers.structure.component.add(
            { structure: struct },
            { type: { name: 'static', params: 'branched' } }
          );
        }).then(function (branchedComp) {
          return addRep(plugin, branchedComp, {
            type: 'ball-and-stick',
            typeParams: ligandBallStickParams(),
            color: 'element-symbol',
          });
        }).then(function () {
          focusLigand(viewer);
          return true;
        }).catch(function (err) {
          log('warn', 'custom reps failed, retrying minimal set', err);
          return plugin.managers.structure.component.add(
            { structure: struct },
            { type: { name: 'static', params: 'ligand' } }
          ).then(function (ligandComp) {
            return addRep(plugin, ligandComp, {
              type: 'ball-and-stick',
              typeParams: ligandBallStickParams(),
              color: 'element-symbol',
            });
          }).then(function () {
            focusLigand(viewer);
            return true;
          });
        });
      }

      return build();
    });
  }

  function focusLigand(viewer) {
    try {
      var plugin = viewer.plugin;
      var structures = plugin.managers.structure.hierarchy.current.structures;
      if (!structures || !structures.length) {
        plugin.managers.camera.reset();
        return;
      }
      plugin.managers.structure.focus.setFromExpression(structures[0], 'ligand');
      plugin.managers.camera.reset();
    } catch (e) {
      try { viewer.plugin.managers.camera.reset(); } catch (e2) { /* best effort */ }
    }
  }

  function loadStructure(viewer, pdbId) {
    var plugin = viewer.plugin;
    var id = pdbId.toLowerCase();
    return viewer.loadPdb(id).catch(function () {
      return plugin.loadStructureFromUrl(
        'https://files.rcsb.org/download/' + id + '.pdb',
        'pdb',
        { label: id.toUpperCase() }
      );
    }).catch(function () {
      return plugin.loadStructureFromUrl(
        'https://www.ebi.ac.uk/pdbe/entry-files/download/' + id + '.bcif',
        'bcif',
        { label: id.toUpperCase() }
      );
    }).then(function () { return true; })
      .catch(function (err) {
        log('error', 'structure load failed for ' + id, err);
        return false;
      });
  }

  function loadMolstarScript(done) {
    if (global.molstar) return done();
    // Important: never pass the load Event into `done` — Event is truthy and
    // would be treated as an error by callers (`if (err) …`).
    function ok() { done(); }
    function fail(err) { done(err instanceof Error ? err : new Error('Mol* script failed')); }
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/molstar@4.5.0/build/viewer/molstar.js';
    script.onload = ok;
    script.onerror = function () {
      var fb = document.createElement('script');
      fb.src = 'https://unpkg.com/molstar@4.5.0/build/viewer/molstar.js';
      fb.onload = ok;
      fb.onerror = function () { fail(new Error('Mol* script failed')); };
      document.head.appendChild(fb);
    };
    document.head.appendChild(script);
  }

  function hideLoading(loadingId) {
    var el = document.getElementById(loadingId);
    if (el) el.classList.add('hidden');
  }

  function showLoadError(loadingId, pdbId) {
    var el = document.getElementById(loadingId);
    if (!el) return;
    el.classList.remove('hidden');
    el.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>' +
      '<div class="molstar-loading-text">Structure load failed — check network</div>' +
      '<a href="https://www.rcsb.org/structure/' + pdbId.toUpperCase() + '" target="_blank" rel="noopener noreferrer" style="font-family:JetBrains Mono,monospace;font-size:10px;color:#45E0A8;">View on RCSB →</a>';
  }

  function resolvePdb(opts) {
    if (opts && opts.pdb) return opts.pdb;
    var c = document.getElementById((opts && opts.containerId) || 'molstar-viewer');
    return (c && c.getAttribute('data-pdb')) || '';
  }

  function disposeViewer(container) {
    var viewer = container && viewers.get(container);
    if (!viewer) return;
    try {
      if (viewer.plugin && viewer.plugin.dispose) viewer.plugin.dispose();
      else if (viewer.dispose) viewer.dispose();
    } catch (e) {
      log('warn', 'viewer dispose failed', e);
    }
    viewers.delete(container);
  }

  // iOS Safari caps concurrent WebGL contexts and reclaims them under memory
  // pressure. Surface the loss instead of leaving a dead canvas, and release the
  // context so a later Viewer.create isn't starved.
  function bindContextLoss(viewer, container, opts, pdb) {
    var canvas = container.querySelector('canvas');
    if (!canvas) return;
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      log('error', 'WebGL context lost', pdb);
      container.classList.remove('molstar-ready');
      showLoadError(opts.loadingId || 'molstar-loading', pdb);
      disposeViewer(container);
    });
    global.addEventListener('pagehide', function () { disposeViewer(container); });
  }

  // Guarantees the loading overlay always resolves: if the viewer never reaches
  // .molstar-ready, flip the overlay to the error state.
  function armBootWatchdog(opts) {
    var containerId = opts.containerId || 'molstar-viewer';
    var timer = global.setTimeout(function () {
      var c = document.getElementById(containerId);
      if (c && c.classList.contains('molstar-ready')) return;
      log('error', 'viewer boot timed out after ' + BOOT_TIMEOUT_MS + 'ms');
      showLoadError(opts.loadingId || 'molstar-loading', resolvePdb(opts));
      if (c) disposeViewer(c);
    }, BOOT_TIMEOUT_MS);
    return function cancel() { global.clearTimeout(timer); };
  }

  function bindResize(viewer, container) {
    function refresh() {
      try {
        if (viewer.plugin && viewer.plugin.layout && viewer.plugin.layout.events) {
          viewer.plugin.layout.events.updated.next();
        }
        if (viewer.plugin && viewer.plugin.canvas3d) {
          viewer.plugin.canvas3d.requestResize();
          viewer.plugin.canvas3d.requestDraw();
        }
      } catch (e) { /* best effort */ }
    }
    if ('ResizeObserver' in global) {
      var ro = new ResizeObserver(refresh);
      ro.observe(container);
    }
    global.addEventListener('resize', refresh, { passive: true });
    global.addEventListener('orientationchange', function () { setTimeout(refresh, 250); }, { passive: true });
    refresh();
  }

  function bindThemeSync(viewer, interactive) {
    function sync() {
      setPublicationView(viewer, interactive);
      if (viewer.plugin && viewer.plugin.canvas3d) viewer.plugin.canvas3d.requestDraw();
    }
    if (global.LBPTheme) {
      var orig = global.LBPTheme.apply;
      global.LBPTheme.apply = function (next) {
        orig(next);
        sync();
      };
    } else {
      new MutationObserver(sync).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });
    }
  }

  function toggleSurface(viewer) {
    var plugin = viewer.plugin;
    var structures = plugin.managers.structure.hierarchy.current.structures;
    if (!structures || !structures.length) return Promise.resolve();
    var struct = structures[0];
    var existing = surfaceReprs.get(viewer);
    if (existing) {
      return plugin.managers.structure.representation.removeRepresentation(existing)
        .then(function () {
          surfaceReprs.delete(viewer);
          plugin.managers.camera.reset();
        });
    }
    return plugin.managers.structure.component.add(
      { structure: struct },
      { type: { name: 'static', params: 'polymer' } }
    ).then(function (polymerComp) {
      return plugin.managers.structure.representation.addRepresentation(polymerComp, {
        type: 'molecular-surface',
        typeParams: { alpha: 0.14, includeHydrogens: false, doubleSided: true },
        color: 'uniform',
        colorParams: { value: 0xFF2F92 },
      });
    }).then(function (repr) {
      surfaceReprs.set(viewer, repr);
    }).catch(function (e) { log('warn', 'surface toggle failed', e); });
  }

  function toggleSpin(viewer, interactive, btn) {
    var on = !spinOn.get(viewer);
    spinOn.set(viewer, on);
    setPublicationView(viewer, interactive);
    if (viewer.plugin && viewer.plugin.canvas3d) viewer.plugin.canvas3d.requestDraw();
    if (btn) btn.textContent = on ? 'Stop spin' : 'Toggle spin';
  }

  function bindControls(viewer, opts) {
    var c = opts.controls || {};
    if (c.reset) {
      var rb = document.getElementById(c.reset);
      if (rb) rb.addEventListener('click', function () { focusLigand(viewer); });
    }
    if (c.spin) {
      var sb = document.getElementById(c.spin);
      if (sb) sb.addEventListener('click', function () { toggleSpin(viewer, true, sb); });
    }
    if (c.ligand) {
      var lb = document.getElementById(c.ligand);
      if (lb) lb.addEventListener('click', function () { focusLigand(viewer); });
    }
    if (c.surface) {
      var fb = document.getElementById(c.surface);
      if (fb) fb.addEventListener('click', function () { toggleSurface(viewer); });
    }
  }

  function createViewer(opts) {
    var containerId = opts.containerId || 'molstar-viewer';
    var container = document.getElementById(containerId);
    if (!container) return Promise.reject(new Error('container not found: ' + containerId));

    var pdb = (opts.pdb || container.getAttribute('data-pdb') || '').toLowerCase();
    if (!pdb) return Promise.reject(new Error('PDB id required'));

    var interactive = opts.interactive !== false;
    var pal = palette();
    var ios = isIOSLike();

    // Mol* renders at devicePixelRatio * pixelScale, so capping the effective DPR
    // means scaling *down* by cap/dpr. On a 3x iPhone this cuts fragment work ~2.2x.
    // Desktop keeps Mol*'s default (pixelScale 1) so its output is unchanged.
    var dpr = global.devicePixelRatio || 1;
    var pixelScale = ios ? Math.min(dpr, IOS_MAX_DPR) / dpr : 1;

    // Release any previous context for this container rather than leaking it.
    disposeViewer(container);

    return global.molstar.Viewer.create(containerId, {
      pixelScale: pixelScale,
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
      // Never leave this as '' — Mol* resolves relative /list_entries/ against the
      // page origin and then JSON-parses the 404 HTML. Disabled streaming + a
      // dummy absolute server keeps the probe path off the site origin.
      volumesAndSegmentationsDefaultServer: 'https://molstarvolseg.ncbr.muni.cz/v2',
      volumeStreamingDisabled: true,
      canvas3d: {
        transparentBackground: false,
        renderer: {
          backgroundColor: pal.backgroundColor,
          backgroundAlpha: 1,
        },
        camera: { fog: 0, clipFar: false },
        postprocessing: safePostprocessing(!ios),
        trackball: {
          noScroll: false,
          noRotate: false,
          noPan: false,
          noZoom: false,
        },
      },
    }).then(function (viewer) {
      viewers.set(container, viewer);
      spinOn.set(viewer, false);
      bindContextLoss(viewer, container, opts, pdb);
      bindResize(viewer, container);
      bindThemeSync(viewer, interactive);
      bindControls(viewer, opts);
      return loadStructure(viewer, pdb).then(function (ok) {
        if (!ok) {
          showLoadError(opts.loadingId || 'molstar-loading', pdb);
          throw new Error('load failed');
        }
        setPublicationView(viewer, interactive);
        return applyPublicationRepresentations(viewer);
      }).then(function () {
        container.classList.add('molstar-ready');
        hideLoading(opts.loadingId || 'molstar-loading');
        if (viewer.plugin && viewer.plugin.canvas3d) viewer.plugin.canvas3d.requestDraw();
        return viewer;
      });
    });
  }

  function boot(opts) {
    opts = opts || {};
    function start() {
      var cancelWatchdog = armBootWatchdog(opts);
      function fail(e) {
        cancelWatchdog();
        log('error', 'viewer boot failed', e);
        showLoadError(opts.loadingId || 'molstar-loading', resolvePdb(opts));
      }
      function launch() {
        // Any rejection in the create/load chain now clears the overlay.
        createViewer(opts).then(function () { cancelWatchdog(); }, fail);
      }
      if (!global.molstar) {
        loadMolstarScript(function (err) {
          if (err) {
            cancelWatchdog();
            var c = document.getElementById(opts.containerId || 'molstar-viewer');
            if (c) c.outerHTML = '<div class="molstar-error">Mol* viewer unavailable</div>';
            return;
          }
          launch();
        });
        return;
      }
      launch();
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }

  global.MolstarDrugViewer = {
    BUILD: BUILD,
    boot: boot,
    applyPublicationRepresentations: applyPublicationRepresentations,
    setPublicationView: setPublicationView,
    cartoonParams: cartoonParams,
    ligandBallStickParams: ligandBallStickParams,
  };

  global.__FLEXAID_MOLSTAR_BUILD__ = BUILD;
})(typeof window !== 'undefined' ? window : globalThis);