// Le Bonhomme Pharma — shared Mol* publication viewer for Drug of the Day pages.
// Cartoon receptor · valence ball-and-stick ligand · outline postprocessing · no lines.

(function (global) {
  'use strict';

  var BUILD = '20260929-token-path';
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

  function palette(tokens) {
    var light = isLightTheme();
    return tokenPalette(tokens, {
      backgroundColor: light ? 0xffffff : 0x08091A,
      outlineColor: light ? 0x000000 : 0xffffff,
      backgroundAlpha: 1,
    });
  }

  function safePostprocessing(outlineOn, tokens) {
    var pal = palette(tokens);
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
    var pal = palette(tokenState.get(viewer));
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
    if (tier === 'outline') props.postprocessing = safePostprocessing(true, tokenState.get(viewer));
    else if (tier === 'basic') props.postprocessing = safePostprocessing(false, tokenState.get(viewer));
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
  function armBootWatchdog(opts, onTimeout) {
    var containerId = opts.containerId || 'molstar-viewer';
    var timer = global.setTimeout(function () {
      var c = document.getElementById(containerId);
      if (c && c.classList.contains('molstar-ready')) return;
      log('error', 'viewer boot timed out after ' + BOOT_TIMEOUT_MS + 'ms');
      showLoadError(opts.loadingId || 'molstar-loading', resolvePdb(opts));
      if (onTimeout) onTimeout(c); else if (c) disposeViewer(c);
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

    var interactive = opts.interactive !== false, tokens = tokenOptions(opts);
    var pal = palette(tokens);
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
        postprocessing: safePostprocessing(!ios, tokens),
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
      // Opted-in viewers bind once per element and look the live viewer up when
      // an event fires; the legacy set closes over this viewer (see the token path).
      if (tokens) bindTokenViewer(viewer, container, opts, pdb, tokens);
      else bindLegacyViewer(viewer, container, opts, pdb, interactive);
      return loadStructure(viewer, pdb).then(function (ok) {
        if (!ok) {
          showLoadError(opts.loadingId || 'molstar-loading', pdb);
          throw new Error('load failed');
        }
        setPublicationView(viewer, interactive);
        return applyRepresentations(viewer);
      }).then(function () {
        container.classList.add('molstar-ready');
        hideLoading(opts.loadingId || 'molstar-loading');
        if (viewer.plugin && viewer.plugin.canvas3d) viewer.plugin.canvas3d.requestDraw();
        return viewer;
      });
    });
  }
  // Resolves to the viewer, or to null on any failure; never rejects (see the token path).
  function boot(opts) {
    opts = opts || {}; var settle, settled = new Promise(function (resolve) { settle = resolve; });
    function start() {
      var cancelWatchdog = armBootWatchdog(opts, function (c) { if (c) disposeViewer(c); settle(null); });
      function fail(e) {
        cancelWatchdog(); settle(null);
        log('error', 'viewer boot failed', e);
        showLoadError(opts.loadingId || 'molstar-loading', resolvePdb(opts));
      }
      function launch() {
        // Any rejection in the create/load chain now clears the overlay.
        createViewer(opts).then(function (v) { cancelWatchdog(); settle(v); }, fail);
      }
      if (!global.molstar) {
        loadMolstarScript(function (err) {
          if (err) {
            cancelWatchdog();
            var c = document.getElementById(opts.containerId || 'molstar-viewer');
            if (c) c.outerHTML = '<div class="molstar-error">Mol* viewer unavailable</div>';
            return settle(null);
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
    return settled;
  }

  // ---- Token path (opt-in) ----------------------------------------------------
  // boot() with receptorToken, inkToken or bgToken (any one) opts a viewer in.
  // Its colours then come from tokens.css through getComputedStyle at the moment
  // they are used: this file names custom properties, never colour values, and
  // caches none. They are read again whenever <html data-theme> flips.
  //
  // The legacy path above is left alone on purpose. It hands Mol* 4.5's
  // component manager the wrong argument shapes (clear() wants an array, add()
  // wants (params, structures[])), logs "is not iterable", and the viewer keeps
  // Mol*'s default preset. The Drug-of-the-Day and flexaid-ds pages must render
  // exactly as they do today, console included, and their stack traces quote
  // this file's line numbers, so every line above boot() keeps the number it
  // had in build 20260721-onload-fix. That is why the hooks into it are
  // same-line edits, a few of them two statements long. Opted-in viewers build
  // through the plugin's state builders instead, which Mol* 4.5 accepts.

  var tokenState = new WeakMap();      // viewer -> { receptor, ink, bg, interactive }
  var tokenComps = new WeakMap();      // viewer -> refs of the components the builder made
  var queues = new WeakMap();          // viewer -> tail of its show() / surface chain
  var wiredContainers = new WeakSet();
  var wiredButtons = new WeakSet();

  function tokenOptions(opts) {
    if (!opts.receptorToken && !opts.inkToken && !opts.bgToken) return null;
    return {
      receptor: opts.receptorToken || null,
      ink: opts.inkToken || null,
      bg: opts.bgToken || null,
      interactive: opts.interactive !== false,
    };
  }

  // Resolve a custom property to a Mol* colour int. Accepts #rgb, #rrggbb and
  // rgb()/rgba() in comma or space syntax (alpha ignored). Anything else, or an
  // unset property, is null, and the caller falls back to Mol*'s own default
  // for that role rather than to a literal in this file.
  function tokenColor(name) {
    if (!name) return null;
    var v;
    try {
      v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    } catch (e) { return null; }
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
    if (m) {
      var h = m[1];
      if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
      return parseInt(h, 16);
    }
    m = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/i.exec(v);
    if (!m) return null;
    function channel(x) { return Math.max(0, Math.min(255, Math.round(+x))); }
    return (channel(m[1]) << 16) | (channel(m[2]) << 8) | channel(m[3]);
  }

  // palette() hook: background from bgToken, outline pass from inkToken. With
  // no tokens (every legacy caller) the module's own values pass straight through.
  function tokenPalette(tokens, pal) {
    if (!tokens) return pal;
    var bg = tokenColor(tokens.bg);
    var ink = tokenColor(tokens.ink);
    if (bg !== null) pal.backgroundColor = bg;
    if (ink !== null) pal.outlineColor = ink;
    return pal;
  }

  // Complete uniform params. Mol* merges colorParams one level deep only, so an
  // element-symbol carbonColor of { value } alone reaches the uniform theme
  // without saturation and lightness, and Color.saturate/lighten then return NaN.
  function uniformTheme(rgb) {
    return { name: 'uniform', params: { value: rgb, saturation: 0, lightness: 0 } };
  }

  // Receptor role (cartoon, surface): uniform token colour, else Mol*'s chain-id.
  function receptorColorSpec(rgb) {
    return rgb === null ? { color: 'chain-id' } : { color: 'uniform', colorParams: uniformTheme(rgb).params };
  }

  // Ink role (every ball-and-stick carbon): element-symbol with the carbon held
  // at the ink, so N, O and halogens keep their CPK meaning; else Mol*'s default.
  function inkColorSpec(rgb) {
    return rgb === null ? { color: 'element-symbol' }
      : { color: 'element-symbol', colorParams: { carbonColor: uniformTheme(rgb) } };
  }

  function repSpec(type, typeParams, colorSpec) {
    var spec = { type: type, typeParams: typeParams, color: colorSpec.color };
    if (colorSpec.colorParams) spec.colorParams = colorSpec.colorParams;
    return spec;
  }

  function builderComponent(plugin, struct, type, key, label) {
    return Promise.resolve().then(function () {
      return plugin.builders.structure.tryCreateComponent(struct.cell,
        { type: type, nullIfEmpty: true, label: label }, key);
    }).then(function (c) { return c || null; })
      .catch(function (err) { log('warn', 'component failed: ' + key, err); return null; });
  }

  function builderRep(plugin, comp, spec) {
    if (!comp) return Promise.resolve(false);
    return Promise.resolve().then(function () {
      return plugin.builders.structure.representation.addRepresentation(comp, spec);
    }).then(function () { return true; })
      .catch(function (err) { log('warn', 'representation failed', err); return false; });
  }

  // show() and the surface toggle both rewrite the state tree; run them one at
  // a time per viewer so a fast second click cannot interleave with the first.
  function serial(viewer, task) {
    var run = (queues.get(viewer) || Promise.resolve()).then(task);
    queues.set(viewer, run.then(function () {}, function () {}));
    return run;
  }

  // Mol*'s camera.reset() re-centres and re-fits but keeps the current rotation
  // (its own button says "Reset Zoom"), so after a drag or a spin the page's
  // "Reset view" appeared to do nothing. Opted-in viewers go back to Mol*'s home
  // orientation (looking down -z, y up) fitted to what is visible, and every
  // structure starts there, including one swapped in by show() after the
  // reader has rotated the last. Direction vectors, not colours.
  var HOME_UP = [0, 1, 0];
  var HOME_DIR = [0, 0, -1];

  function resetTokenView(viewer, animate) {
    try {
      var still = !animate || (global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
      viewer.plugin.managers.camera.reset(function (scene, camera) {
        var s = scene.boundingSphereVisible;
        return camera.getInvariantFocus(s.center, s.radius, HOME_UP, HOME_DIR);
      }, still ? 0 : undefined);
    } catch (e) { log('warn', 'view reset failed', e); }
  }

  function applyRepresentations(viewer) {
    return tokenState.has(viewer) ? applyBuilderRepresentations(viewer) : applyPublicationRepresentations(viewer);
  }

  // Depth fog off. `camera: { fog: 0 }` above is not a Mol* 4.5 prop (camera
  // takes mode, helper, stereo, fov and manualReset), so it is dropped and
  // canvas3d keeps its default cameraFog, on at intensity 15. Opted-in
  // viewers switch it off through the prop that exists; the legacy path keeps
  // the fog it has always drawn. setProps merges, so nothing else resets it;
  // it is reapplied on every build and theme flip anyway, because it is cheap.
  function fogOff(viewer) {
    var canvas3d = viewer && viewer.plugin && viewer.plugin.canvas3d;
    if (!canvas3d) return;
    try { canvas3d.setProps({ cameraFog: { name: 'off', params: {} } }); }
    catch (e) { log('warn', 'fog off failed', e); }
  }

  function applyBuilderRepresentations(viewer) {
    var plugin = viewer.plugin;
    var tokens = tokenState.get(viewer);
    // Mol* can resolve a load that produced nothing (unknown id, blocked host).
    // The legacy path then marks an empty canvas ready after a 15 s poll; here
    // it is a failure, so boot() resolves null and show() false, promptly.
    return waitForStructures(plugin, 2000).then(function (structures) {
      if (!structures || !structures.length) throw new Error('no structures loaded');
      fogOff(viewer);
      var struct = structures[0];
      var receptor = receptorColorSpec(tokenColor(tokens.receptor));
      var ink = inkColorSpec(tokenColor(tokens.ink));
      var refs = {};
      function step(key, role, type, label, spec) {
        return function () {
          return builderComponent(plugin, struct, type, key, label).then(function (c) {
            if (c) refs[role] = c.ref;
            return builderRep(plugin, c, spec);
          });
        };
      }
      return Promise.resolve().then(function () {
        return plugin.managers.structure.component.clear([struct]);
      }).catch(function (err) {
        log('warn', 'component.clear failed, continuing', err);
      }).then(step('lbp-receptor', 'receptor', { name: 'static', params: 'polymer' }, 'Receptor',
        repSpec('cartoon', cartoonParams(), receptor)))
        // pymol syntax: Mol* 4.5's VMD 'within' form selects nothing, and pymol
        // `hetatm` misses entries whose ligand atoms are not flagged HETATM
        // (6DZV, 8EF5). `organic` selects the same atoms as `hetatm and not
        // solvent and not inorganic` on 4XP4, 5MZP and 1PYX, and works on those.
        .then(step('lbp-contacts', 'contacts', { name: 'script', params: { language: 'pymol',
          expression: 'byres (polymer.protein within 4 of organic)' } },
          'Contacts (4 Å)', repSpec('ball-and-stick', contactBallStickParams(), ink)))
        .then(step('lbp-ligand', 'ligand', { name: 'static', params: 'ligand' }, 'Ligand',
          repSpec('ball-and-stick', ligandBallStickParams(), ink)))
        .then(step('lbp-branched', 'branched', { name: 'static', params: 'branched' }, 'Branched',
          repSpec('ball-and-stick', ligandBallStickParams(), ink)))
        .then(function () {
          tokenComps.set(viewer, refs);
          resetTokenView(viewer, false);
          // A theme flip that landed mid-build was read with the old tokens.
          return recolourTokenReps(viewer);
        }).then(function () { return true; });
    });
  }

  // Re-read the tokens and restyle the existing representations in place: no
  // rebuild, no camera move. Only stale colours are touched, so a flip that
  // changes nothing (--strawberry is the same in both themes) commits nothing.
  function recolourTokenReps(viewer) {
    var tokens = tokenState.get(viewer);
    var plugin = viewer && viewer.plugin;
    if (!tokens || !plugin || !plugin.managers) return Promise.resolve(false);
    var structures = plugin.managers.structure.hierarchy.current.structures;
    if (!structures || !structures.length) return Promise.resolve(false);
    var refs = tokenComps.get(viewer) || {};
    var surface = surfaceReprs.get(viewer);
    var role = {};
    if (refs.receptor) role[refs.receptor] = 'receptor';
    if (surface) role[surface.ref] = 'receptor';
    ['contacts', 'ligand', 'branched'].forEach(function (k) { if (refs[k]) role[refs[k]] = 'ink'; });
    var receptor = tokenColor(tokens.receptor);
    var ink = tokenColor(tokens.ink);
    var update = plugin.build();
    var changed = 0;
    structures[0].components.forEach(function (c) {
      var r = role[c.cell.transform.ref];
      var rgb = r === 'receptor' ? receptor : r === 'ink' ? ink : null;
      if (rgb === null) return;
      c.representations.forEach(function (repr) {
        var theme = repr.cell.transform.params.colorTheme;
        if (r === 'receptor') {
          if (theme.name === 'uniform' && theme.params.value === rgb) return;
          update.to(repr.cell).update(function (p) { p.colorTheme = uniformTheme(rgb); });
        } else {
          var carbon = theme.params && theme.params.carbonColor;
          if (theme.name !== 'element-symbol') return;
          if (carbon && carbon.name === 'uniform' && carbon.params.value === rgb) return;
          update.to(repr.cell).update(function (p) { p.colorTheme.params.carbonColor = uniformTheme(rgb); });
        }
        changed++;
      });
    });
    if (!changed) return Promise.resolve(true);
    return update.commit().then(function () { return true; }, function (err) {
      log('warn', 'token recolour failed', err);
      return false;
    });
  }

  function syncTokenTheme(viewer) {
    var tokens = tokenState.get(viewer);
    if (!tokens) return;
    setPublicationView(viewer, tokens.interactive);   // background + outline
    fogOff(viewer);
    if (viewer.plugin && viewer.plugin.canvas3d) viewer.plugin.canvas3d.requestDraw();
    recolourTokenReps(viewer);                        // cartoon, surface, carbons
  }

  // Surface in the receptor role at the legacy 14%, coloured when switched on;
  // a later flip restyles it through recolourTokenReps.
  function toggleBuilderSurface(viewer) {
    return serial(viewer, function () {
      var plugin = viewer.plugin;
      var structures = plugin.managers.structure.hierarchy.current.structures;
      if (!structures || !structures.length) return;
      var existing = surfaceReprs.get(viewer);
      if (existing) {
        surfaceReprs.delete(viewer);
        return plugin.build().delete(existing.ref).commit();
      }
      var colour = receptorColorSpec(tokenColor(tokenState.get(viewer).receptor));
      return builderComponent(plugin, structures[0], { name: 'static', params: 'polymer' }, 'lbp-surface', 'Pocket surface')
        .then(function (c) {
          if (!c) return;
          surfaceReprs.set(viewer, c);
          return builderRep(plugin, c, repSpec('molecular-surface',
            { alpha: 0.14, includeHydrogens: false, doubleSided: true }, colour));
        });
    }).catch(function (e) { log('warn', 'surface toggle failed', e); });
  }

  function bindLegacyViewer(viewer, container, opts, pdb, interactive) {
    bindContextLoss(viewer, container, opts, pdb);
    bindResize(viewer, container);
    bindThemeSync(viewer, interactive);
    bindControls(viewer, opts);
  }

  // An opted-in page may boot again on the same container (a retry after a
  // failed first load), so listeners are bound once per element and find the
  // live viewer when they fire; the legacy set would stack a copy per boot,
  // each holding a disposed viewer.
  function bindTokenViewer(viewer, container, opts, pdb, tokens) {
    tokenState.set(viewer, tokens);
    var loadingId = opts.loadingId || 'molstar-loading';
    var ctx = viewer.plugin && viewer.plugin.canvas3dContext;
    var canvas = (ctx && ctx.canvas) || container.querySelector('canvas');
    if (canvas) {
      canvas.addEventListener('webglcontextlost', function (e) {
        e.preventDefault();
        // The browser fires this a task after the loss. By then a dispose this
        // module asked for (re-boot, watchdog, pagehide) has already dropped
        // the viewer from `viewers`: expected, so say nothing and never touch
        // the viewer that replaced it. Only a live viewer's loss is a failure.
        if (viewers.get(container) !== viewer) return;
        var id = container.getAttribute('data-pdb') || pdb;
        log('error', 'WebGL context lost', id);
        container.classList.remove('molstar-ready');
        showLoadError(loadingId, id);
        disposeViewer(container);
      });
    }
    if (!wiredContainers.has(container)) {
      wiredContainers.add(container);
      global.addEventListener('pagehide', function () { disposeViewer(container); });
      // bindResize() reads viewer.plugin on every refresh; hand it the live one.
      bindResize({ get plugin() { var v = viewers.get(container); return v && v.plugin; } }, container);
      // Observe data-theme whoever flips it. The legacy path wraps
      // window.LBPTheme.apply when theme.js is present, and theme.js's own
      // toggle button calls its internal apply, so that canvas never follows it.
      new MutationObserver(function () {
        var v = viewers.get(container);
        if (v && tokenState.has(v)) syncTokenTheme(v);
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
    bindTokenControls(opts);
  }

  function bindTokenControls(opts) {
    var c = opts.controls || {};
    var containerId = opts.containerId || 'molstar-viewer';
    function wire(id, act) {
      var el = id && document.getElementById(id);
      if (!el || wiredButtons.has(el)) return;
      wiredButtons.add(el);
      el.addEventListener('click', function () {
        var v = viewers.get(document.getElementById(containerId));
        if (v && tokenState.has(v)) act(v, el);
      });
    }
    wire(c.reset, function (v) { resetTokenView(v, true); });
    wire(c.spin, function (v, el) { toggleSpin(v, tokenState.get(v).interactive, el); });
    wire(c.ligand, function (v) { focusLigand(v); });
    wire(c.surface, function (v) { toggleBuilderSurface(v); });
  }

  // Swap the structure in a booted viewer and keep its WebGL context. (A second
  // boot() disposes the viewer and creates another; on the legacy path the
  // forced context loss flashes the error overlay.) Resolves true once the new
  // structure is drawn, false otherwise (no viewer on that container, unknown
  // id, network); never rejects. Calls on one viewer run in order.
  function show(opts) {
    opts = opts || {};
    var loadingId = opts.loadingId || 'molstar-loading';
    var container = document.getElementById(opts.containerId || 'molstar-viewer');
    var viewer = container && viewers.get(container);
    var pdb = String(opts.pdb || '').toLowerCase();
    if (!viewer || !pdb) return Promise.resolve(false);
    var tokens = tokenState.get(viewer);
    if (tokens && opts.interactive !== undefined) tokens.interactive = opts.interactive !== false;
    var interactive = tokens ? tokens.interactive : opts.interactive !== false;
    return serial(viewer, function () {
      // Disposed (pagehide, context loss, re-boot) while this call waited.
      if (viewers.get(container) !== viewer) throw new Error('viewer disposed');
      var plugin = viewer.plugin;
      container.classList.remove('molstar-ready');
      container.setAttribute('data-pdb', pdb.toUpperCase());
      surfaceReprs.delete(viewer);   // plugin.clear() takes the surface with it
      tokenComps.delete(viewer);
      return Promise.resolve().then(function () { return plugin.clear(); })
        .catch(function (err) { log('warn', 'plugin.clear failed, continuing', err); })
        .then(function () { return loadStructure(viewer, pdb); })
        .then(function (ok) {
          var s = plugin.managers.structure.hierarchy.current.structures;
          if (!ok || !s || !s.length) throw new Error('load failed');
          setPublicationView(viewer, interactive);
          return applyRepresentations(viewer);
        }).then(function () {
          container.classList.add('molstar-ready');
          hideLoading(loadingId);
          if (plugin.canvas3d) plugin.canvas3d.requestDraw();
          return true;
        });
    }).catch(function (err) {
      log('error', 'structure swap failed for ' + pdb, err);
      showLoadError(loadingId, pdb);
      return false;
    });
  }

  global.MolstarDrugViewer = {
    BUILD: BUILD,
    boot: boot,
    show: show,
    applyPublicationRepresentations: applyRepresentations,
    setPublicationView: setPublicationView,
    cartoonParams: cartoonParams,
    ligandBallStickParams: ligandBallStickParams,
  };

  global.__FLEXAID_MOLSTAR_BUILD__ = BUILD;
})(typeof window !== 'undefined' ? window : globalThis);