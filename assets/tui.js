/* ============================================================
   FlexAID∆S — TUI
   Le Bonhomme Pharma · Montréal

   A terminal panel that runs a docking session and keeps
   running: when a run converges it dequeues the next target
   rather than freezing on the last frame.

   WHY THE OUTPUT IS COLOURED THE WAY IT IS
   ----------------------------------------
   The stages are the design system's SERIES RAMP, in the order
   the ramp defines — energy along the binding coordinate, not
   hue or wavelength:

     --series-1  magnesium   apo baseline
     --series-2  violet      unbound · ΔS dominates
     --series-3  strawberry  first pocket contact
     --series-4  aqua        rigidification · ΔS_vib
     --series-5  mint        contacts formed · ΔH
     --series-6  tangerine   converged · ΔG

   So the run reads as a reaction path and the progress meter is
   literally the ramp. Firetruck stays out of the stage colours —
   it is a scalar and a failure signal, never a data class — and
   appears only on the T term, a failed run, and the close button
   (a stop control, which is the same "failure" semantic).

   Every colour here is a token. No hex literals beyond the
   fallbacks that were already here, so the panel cannot drift
   from the system (scripts/check-palette-v2.sh).

   TWO KINDS OF SESSION
   --------------------
   Default sessions are synthetic and the titlebar says so. A page
   may instead point a mount at a registered PROFILE:

       <div data-flexaidds-tui data-tui-profile="entropy-docking">

   A profile is looked up in window.FLEXAIDDS_TUI_PROFILES and may
   supply real numbers and a live reaction coordinate. This is a
   per-mount opt-in, NOT a branch on location.pathname: the panel
   ships to four pages and must not know which one it is on. With
   no attribute, or an attribute naming a profile that is not
   registered, the default synthetic queue runs exactly as before.

   Usage:  <div data-flexaidds-tui></div>            default
           <div data-flexaidds-tui="bare"></div>     no titlebar
           <div data-flexaidds-tui data-tui-profile="x"></div>
           <script src="/assets/tui.js" defer></script>
   ============================================================ */
(function () {
  'use strict';

  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Below this width a floating, draggable window is a liability rather than a
  // feature: there is nowhere to drag TO, and a drag gesture on a touch screen
  // competes with the page scroll. Chrome stays, dragging does not.
  var DRAG_MIN_WIDTH = 720;

  function narrow() { return window.innerWidth < DRAG_MIN_WIDTH; }

  // ── default synthetic sessions ─────────────────────────────────────────
  // Numbers are illustrative and the titlebar says "synthetic" — the benchmark
  // figures are kept consistent with the published ones so nothing here
  // contradicts the rest of the site.
  //
  // Every session is a list of steps coloured by the SERIES ramp, in energy
  // order along the binding coordinate. Step count varies per session, so the
  // meter and the [n/N] index are both derived from steps.length — never a
  // hardcoded 6.
  var DOCK_TARGETS = [
    { pdb: '1S3V', lig: 'TQD', s0: '4.812', ds: '-0.341', contacts: 14, buried: 62, dsv: '-0.089', dh: '-11.204', dg: '-8.42', rmsd: '0.94', pose: 3 },
    { pdb: '1UNL', lig: 'LGS', s0: '5.117', ds: '-0.298', contacts: 11, buried: 57, dsv: '-0.112', dh: '-10.061', dg: '-7.68', rmsd: '1.21', pose: 1 },
    { pdb: '1YGC', lig: '905', s0: '4.463', ds: '-0.402', contacts: 17, buried: 71, dsv: '-0.074', dh: '-12.930', dg: '-9.15', rmsd: '0.62', pose: 2 }
  ];

  function dockSession(t) {
    return {
      key: 'dock ' + t.pdb,
      cmd: '$ flexaidds dock --receptor ' + t.pdb + '.pdb --ligand ' + t.lig + '.mol2 --entropy shannon',
      banner: 'FlexAID∆S 2.0.3 · entropy-driven docking',
      equation: true,
      steps: [
        { label: 'apo baseline',              detail: 'S = ' + t.s0 + ' nats' },
        { label: 'unbound · ΔS',              detail: 'ΔS = ' + t.ds + ' kcal/mol·K' },
        { label: 'pocket contact',            detail: t.contacts + ' contacts · ' + t.buried + '% buried' },
        { label: 'rigidification · ΔS_vib',   detail: 'ΔS_vib = ' + t.dsv },
        { label: 'contacts formed · ΔH',      detail: 'ΔH = ' + t.dh + ' kcal/mol' },
        { label: 'converged · ΔG',            detail: 'ΔG = ' + t.dg + ' kcal/mol' }
      ],
      done: 'RMSD ' + t.rmsd + ' Å   pose ' + t.pose + '/20   ΔG ' + t.dg + ' kcal/mol'
    };
  }

  var SESSIONS = [
    dockSession(DOCK_TARGETS[0]),
    {
      key: 'DatasetRunner',
      cmd: '$ flexaidds-benchmark --set astex --n 85 --seed 7 --out bench/astex85',
      banner: 'DatasetRunner · Astex Diverse 85 · deterministic seed',
      steps: [
        { label: 'dataset prepared',          detail: '85 / 85 targets fetched' },
        { label: 'receptors typed',           detail: 'apo strip · hydrogens added' },
        { label: 'pockets detected',          detail: 'GetCleft · top-3 per target' },
        { label: 'docking · ΔS_vib',          detail: 'tENCoM normal modes' },
        { label: 'rescoring · ΔH',            detail: 'Voronoi CF · OpenMP batch' },
        { label: 'scored · ΔG',               detail: 'top-1 ≤ 2 Å: 82 / 85' }
      ],
      done: 'top-1 96.4%   median RMSD 1.08 Å   85 targets'
    },
    {
      key: 'flexaidds (python)',
      cmd: '$ python -m flexaidds results/1s3v --best-mode',
      banner: 'flexaidds 2.0.3 · binding-mode summary',
      steps: [
        { label: 'results directory',         detail: 'results/1s3v' },
        { label: 'binding modes · ΔS',        detail: '12 parsed · 20 poses each' },
        { label: 'temperature · T',           detail: '298 K' },
        { label: 'enthalpy · ΔH',             detail: '-11.204 kcal/mol' },
        { label: 'free energy · ΔG',          detail: '-8.42 kcal/mol' }
      ],
      done: 'mode_id 3   rank 1   best_cf -42.7   claim_validity proxy_only'
    },
    {
      key: 'NATURaL cofolding',
      cmd: '$ natural_hammerhead --organism ecoli --rnap --cofold',
      banner: 'NATURaL · co-transcriptional DualAssembly (RNAP)',
      steps: [
        { label: 'nascent chain',             detail: '43 nt transcribed' },
        { label: 'RNAP tunnel',               detail: '8 nt occluded · Nudler 2012' },
        { label: 'pause sites',               detail: '3 detected · k_el < 20% hmean' },
        { label: 'nucleation seeds',          detail: '2 RNA hairpin · 1 G-quad' },
        { label: 'co-folding · P_fold',       detail: '0.71 at stem II' }
      ],
      done: 'hammerhead folded   ΔG_fold -18.6 kcal/mol'
    },
    dockSession(DOCK_TARGETS[1]),
    dockSession(DOCK_TARGETS[2])
  ];

  // Resolve a mount's session queue. Unknown or absent profile → the default.
  function queueFor(mount) {
    var name = mount.getAttribute('data-tui-profile');
    if (!name) return { list: SESSIONS, title: 'flexaidds — live synthetic run' };
    var reg = window.FLEXAIDDS_TUI_PROFILES;
    var make = reg && reg[name];
    if (typeof make !== 'function') return { list: SESSIONS, title: 'flexaidds — live synthetic run' };
    try {
      var p = make();
      if (!p || !p.list || !p.list.length) throw new Error('empty profile');
      return p;
    } catch (err) {
      // A broken profile must never take the panel down with it. The four
      // pages share this file; a page-specific mistake stays page-specific.
      return { list: SESSIONS, title: 'flexaidds — live synthetic run' };
    }
  }

  var CSS = [
    '[data-flexaidds-tui]{--tui-pad:clamp(16px,3vw,24px);font-family:var(--font-mono,monospace)}',
    '.tui-win{border:1px solid var(--violet-20,rgba(139,92,246,.2));border-radius:var(--r-lg,12px);',
    'background:var(--bg,#08091A);overflow:hidden;box-shadow:var(--glow-violet,none),var(--inset-sheen,none)}',
    '.tui-bar{display:flex;align-items:center;gap:8px;padding:11px 14px;background:var(--bg-card,rgba(17,18,38,.82));',
    'border-bottom:1px solid var(--violet-20,rgba(139,92,246,.2))}',
    // The three lights were decorative divs. They are buttons now: focusable,
    // labelled, and each one does the thing its colour has always implied.
    // Mint/tangerine/firetruck are the system's own hues — no yellow anywhere,
    // and firetruck lands on close, which is the stop/failure semantic it is
    // already reserved for.
    '.tui-dot{width:11px;height:11px;border-radius:var(--r-pill,9999px);flex:none;padding:0;border:0;',
    'cursor:pointer;display:block;position:relative;-webkit-appearance:none;appearance:none}',
    '.tui-dot.a{background:var(--mint,#45E0A8)}.tui-dot.b{background:var(--tangerine,#FF9300)}.tui-dot.c{background:var(--firetruck,#F5232B)}',
    // Hit target: 11px is a fine dot and a poor button. A transparent ::after
    // takes it to 24px without moving the dot or changing the bar's rhythm.
    '.tui-dot::after{content:"";position:absolute;top:50%;left:50%;width:24px;height:24px;',
    'transform:translate(-50%,-50%)}',
    '.tui-dot:focus-visible{outline:2px solid var(--fg,#E4E3F5);outline-offset:2px}',
    '.tui-dot[aria-pressed="true"]{box-shadow:0 0 0 2px var(--bg,#08091A),0 0 0 3px currentColor}',
    '.tui-title{font-size:11.5px;letter-spacing:.04em;color:var(--fg-muted,#8D8CB0);margin-left:6px}',
    '.tui-state{margin-left:auto;font-size:10px;font-weight:var(--fw-700,700);letter-spacing:var(--tracking-label,.15em);',
    'text-transform:uppercase;color:var(--state-pass,#45E0A8);white-space:nowrap}',
    '.tui-state[data-done="1"]{color:var(--series-6,#FF9300)}',
    '.tui-bare .tui-body{padding:0;min-height:300px}',
    '.tui-body{padding:var(--tui-pad);font-size:clamp(10.5px,1.02vw,12.5px);line-height:1.65;',
    'color:var(--fg,#E4E3F5);min-height:clamp(260px,44vh,360px)}',
    // Rows reflow rather than scroll: the old build padded labels with literal
    // spaces inside white-space:pre, which forced a horizontal scrollbar on any
    // narrow viewport. Flex + a ch-based min-width keeps the columns aligned on
    // wide screens and lets them stack on a phone.
    '.tui-line{display:block;overflow-wrap:anywhere}',
    '.tui-row{display:flex;flex-wrap:wrap;gap:0 10px;align-items:baseline}',
    '.tui-idx{flex:none;color:var(--fg-muted,#8D8CB0)}',
    '.tui-name{flex:none;min-width:min(24ch,58vw)}',
    '.tui-val{flex:1 1 auto;min-width:0;color:var(--fg-muted,#8D8CB0)}',
    // On a phone the index and label stay on one line and only the value wraps
    // beneath them, indented to the label. Stacking all three parts separately
    // cost three lines per stage and read as a list, not a run.
    '@media (max-width:520px){.tui-name{min-width:0}',
    '.tui-val{flex-basis:100%;padding-left:calc(5ch + 10px)}',
    '.tui-title{display:none}.tui-bar{padding:9px 11px}}',
    '.tui-dim{color:var(--fg-muted,#8D8CB0)}',
    '.tui-cmd{color:var(--mint,#45E0A8);overflow-wrap:anywhere}',
    '.tui-t{color:var(--firetruck,#F5232B)}',
    '.tui-eq .eq-dg{color:var(--tangerine,#FF9300)}.tui-eq .eq-dh{color:var(--mint,#45E0A8)}',
    '.tui-eq .eq-t{color:var(--firetruck,#F5232B)}.tui-eq .eq-ds{color:var(--violet,#8B5CF6)}',
    '.tui-eq .eq-dsv{color:var(--aqua,#00A2FF)}',
    // The meter IS the series ramp. The ramp is always drawn full width and a
    // cover recedes to the right, so each stage lands on its OWN colour —
    // scaling a gradient into a growing box would squash the whole ramp into
    // the filled part and every stage would read tangerine.
    '.tui-meter{position:relative;margin-top:14px;height:6px;border-radius:var(--r-pill,9999px);overflow:hidden;',
    'background:var(--bg-alt,rgba(12,13,30,.55))}',
    '.tui-ramp{position:absolute;inset:0;background:linear-gradient(90deg,var(--series-1,#DCDCE4) 0%,',
    'var(--series-2,#8B5CF6) 20%,var(--series-3,#FF2F92) 40%,var(--series-4,#00A2FF) 60%,',
    'var(--series-5,#45E0A8) 80%,var(--series-6,#FF9300) 100%)}',
    '.tui-cover{position:absolute;top:0;right:0;bottom:0;left:0;background:var(--bg-alt,rgba(12,13,30,.55));',
    'transition:left var(--dur-slow,.7s) var(--ease-out,ease)}',
    '.tui-caret{display:inline-block;width:7px;background:var(--mint,#45E0A8);color:transparent;',
    'animation:tuiblink 1.05s steps(1) infinite}',
    '@keyframes tuiblink{0%,50%{opacity:1}50.01%,100%{opacity:0}}',

    // ── window chrome ────────────────────────────────────────────────────
    // Minimised: the titlebar survives, so the controls that put it back are
    // still on screen. Collapsing to nothing would strand the window.
    '.tui-win.is-min .tui-body{display:none}',
    '.tui-win.is-min{box-shadow:none}',
    // Maximised is viewport-anchored, which is also why it can never be lost:
    // it does not inherit any drag offset and always lands fully on screen.
    '.tui-win.is-max{position:fixed;inset:12px;z-index:60;transform:none!important;',
    'display:flex;flex-direction:column;margin:0}',
    '.tui-win.is-max .tui-body{flex:1 1 auto;overflow:auto;min-height:0}',
    '.tui-drag{cursor:grab;-webkit-user-select:none;user-select:none;touch-action:auto}',
    '.tui-dragging,.tui-dragging .tui-drag{cursor:grabbing}',
    // The way back from close. In normal flow inside the mount, so it cannot
    // be scrolled or dragged out of reach the way a floating chip could.
    '.tui-restore{display:inline-flex;align-items:center;gap:8px;padding:9px 14px;',
    'background:var(--bg-card,rgba(17,18,38,.82));border:1px solid var(--violet-20,rgba(139,92,246,.2));',
    'border-radius:var(--r-pill,9999px);color:var(--fg-muted,#8D8CB0);font:inherit;font-size:11px;',
    'letter-spacing:.12em;text-transform:uppercase;cursor:pointer}',
    '.tui-restore:hover{color:var(--fg,#E4E3F5)}',
    '.tui-restore:focus-visible{outline:2px solid var(--fg,#E4E3F5);outline-offset:2px}',
    // The `hidden` ATTRIBUTE is only a UA rule (`[hidden]{display:none}`), and
    // any author `display` on the same element outranks it — so the chip above
    // sat visible next to the very panel it reopens. Anything this file gives
    // an explicit display to has to opt back out by hand.
    '.tui-restore[hidden]{display:none}',
    '.tui-win[hidden]{display:none}',
    '@media (prefers-reduced-motion:reduce){.tui-caret{animation:none}.tui-cover{transition:none}}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('flexaidds-tui-css')) return;
    var s = document.createElement('style');
    s.id = 'flexaidds-tui-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function btn(cls, label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.setAttribute('aria-label', label);
    b.title = label;
    return b;
  }

  // ── window chrome ────────────────────────────────────────────────────────
  // Drag / minimise / maximise / close, applied to a titlebar that exists.
  //
  // BARE MOUNTS GET NONE OF THIS, deliberately. A bare mount renders inside a
  // frame the host page already drew (the homepage does this) and has no
  // titlebar at all — there is nothing to grab, and a second set of window
  // controls inside someone else's window is not a window, it is a bug. So on
  // a bare mount the panel is exactly what it is today.
  //
  // State lives on the MOUNT, not in this closure, so that the 900 ms
  // supervisor rebuilding the panel does not silently discard a window the
  // reader minimised or moved.
  function chrome(mount, win, bar) {
    var st = mount.__tuiChrome || (mount.__tuiChrome = { min: false, max: false, closed: false, x: 0, y: 0 });

    var minBtn = btn('tui-dot a', 'Minimise the panel');
    var maxBtn = btn('tui-dot b', 'Maximise the panel');
    var closeBtn = btn('tui-dot c', 'Close the panel');
    bar.appendChild(minBtn); bar.appendChild(maxBtn); bar.appendChild(closeBtn);

    // The restore chip is a sibling of the window inside the mount, so closing
    // never removes the only route back.
    var restore = el('button', 'tui-restore');
    restore.type = 'button';
    restore.textContent = '▸ flexaidds — reopen panel';
    restore.hidden = true;
    mount.appendChild(restore);

    function apply() {
      win.classList.toggle('is-min', st.min);
      win.classList.toggle('is-max', st.max);
      win.hidden = st.closed;
      restore.hidden = !st.closed;
      minBtn.setAttribute('aria-pressed', st.min ? 'true' : 'false');
      maxBtn.setAttribute('aria-pressed', st.max ? 'true' : 'false');
      minBtn.setAttribute('aria-label', st.min ? 'Restore the panel' : 'Minimise the panel');
      maxBtn.setAttribute('aria-label', st.max ? 'Restore the panel size' : 'Maximise the panel');
      minBtn.title = minBtn.getAttribute('aria-label');
      maxBtn.title = maxBtn.getAttribute('aria-label');
      // A maximised window is viewport-anchored and must not also carry a drag
      // offset, or restoring would return it to a position that no longer
      // makes sense.
      win.style.transform = (st.max || (!st.x && !st.y)) ? '' : 'translate(' + st.x + 'px,' + st.y + 'px)';
      bar.classList.toggle('tui-drag', !st.max && !narrow());
    }

    minBtn.addEventListener('click', function () { st.min = !st.min; if (st.min) st.max = false; apply(); });
    maxBtn.addEventListener('click', function () { st.max = !st.max; if (st.max) st.min = false; apply(); });
    closeBtn.addEventListener('click', function () { st.closed = true; apply(); restore.focus(); });
    restore.addEventListener('click', function () { st.closed = false; apply(); minBtn.focus(); });

    // Escape leaves a maximised panel, which is the one state that covers the
    // page. Without it a keyboard user would have to find a 11px target.
    win.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && st.max) { st.max = false; apply(); maxBtn.focus(); }
    });

    // ── drag ──────────────────────────────────────────────────────────────
    // Mouse and pen only. A touch-drag on the titlebar of a full-width panel
    // fights the page scroll, and on a phone there is nowhere useful to drag
    // to anyway — so below DRAG_MIN_WIDTH this is not bound at all.
    var drag = null;

    bar.addEventListener('pointerdown', function (e) {
      if (st.max || narrow()) return;
      if (e.pointerType === 'touch') return;
      if (e.button !== 0) return;
      // Never start a drag from the controls themselves.
      if (e.target.closest && e.target.closest('button')) return;
      drag = { x: e.clientX - st.x, y: e.clientY - st.y };
      win.classList.add('tui-dragging');
      try { bar.setPointerCapture(e.pointerId); } catch (err) { /* non-fatal */ }
      e.preventDefault();
    });

    bar.addEventListener('pointermove', function (e) {
      if (!drag) return;
      st.x = e.clientX - drag.x;
      st.y = e.clientY - drag.y;
      win.style.transform = 'translate(' + st.x + 'px,' + st.y + 'px)';
    });

    function endDrag(e) {
      if (!drag) return;
      drag = null;
      win.classList.remove('tui-dragging');
      if (e && e.pointerId != null) {
        try { if (bar.hasPointerCapture(e.pointerId)) bar.releasePointerCapture(e.pointerId); }
        catch (err) { /* non-fatal */ }
      }
      clampIntoView();
    }
    bar.addEventListener('pointerup', endDrag);
    bar.addEventListener('pointercancel', endDrag);

    // Clamp so the window can never be parked where it cannot be grabbed
    // again: the titlebar stays fully on screen vertically, and a healthy
    // slice of the window stays on screen horizontally. Run on drag end and
    // on resize, which is the other way a valid position becomes invalid.
    function clampIntoView() {
      if (st.max || st.closed) return;
      if (!st.x && !st.y) return;
      var KEEP = 96, M = 8;
      var r = win.getBoundingClientRect();
      var barH = bar.getBoundingClientRect().height || 40;
      var baseL = r.left - st.x, baseT = r.top - st.y;
      var vw = window.innerWidth, vh = window.innerHeight;
      st.x = Math.min(vw - KEEP - baseL, Math.max(KEEP - baseL - r.width, st.x));
      st.y = Math.min(vh - barH - M - baseT, Math.max(M - baseT, st.y));
      win.style.transform = 'translate(' + st.x + 'px,' + st.y + 'px)';
    }

    // A resize that crosses DRAG_MIN_WIDTH also has to drop any offset the
    // window was carrying, or a panel dragged on a desktop would come back
    // shifted and undraggable on a phone.
    window.addEventListener('resize', function () {
      if (narrow()) { st.x = 0; st.y = 0; }
      apply();
      clampIntoView();
    });

    apply();
    return st;
  }

  function TUI(mount) {
    // "bare" mounts inside a frame the host page already draws, so the panel
    // does not grow a second titlebar inside the first.
    var bare = mount.getAttribute('data-flexaidds-tui') === 'bare';
    var q = queueFor(mount);
    var win = el('div', bare ? 'tui-bare' : 'tui-win');
    var state = el('span', 'tui-state', '● RUNNING');
    var bar = null;

    if (!bare) {
      bar = el('div', 'tui-bar');       // filled below, once chrome() has run
      win.appendChild(bar);
    }

    var body = el('div', 'tui-body');
    var meter = el('div', 'tui-meter');
    meter.appendChild(el('div', 'tui-ramp'));
    var cover = el('div', 'tui-cover');
    meter.appendChild(cover);

    win.appendChild(body);
    mount.innerHTML = '';
    mount.appendChild(win);
    body.appendChild(meter);

    // Chrome is wired after the window is mounted, so the restore chip lands
    // inside the mount rather than in a subtree about to be wiped. The bar is
    // still empty here, so the three lights fill it first and end up on the
    // left where a titlebar's lights belong; title and state follow.
    if (bar) {
      chrome(mount, win, bar);
      bar.appendChild(el('span', 'tui-title', q.title));
      bar.appendChild(state);
    }

    var timer = null, idx = 0, alive = true, running = false, resolveWait = null, watchdog = null;

    function line(cls) {
      var l = el('span', 'tui-line' + (cls ? ' ' + cls : ''));
      body.insertBefore(l, meter);
      return l;
    }
    function clear() { while (body.firstChild !== meter) body.removeChild(body.firstChild); }
    function wait(ms) {
      return new Promise(function (r) { resolveWait = r; timer = setTimeout(r, REDUCED ? 0 : ms); });
    }

    // Wait for a live reaction coordinate to reach `frac`, rather than for a
    // timer. This is what makes a profiled run a reaction PATH: the panel
    // prints a stage when the scene actually gets there, and the value it
    // prints is the value at the crossing. Bounded, so a scene that stalls or
    // reverses can never park the run forever on a promise.
    function waitCoord(coord, frac, capMs) {
      if (REDUCED) return Promise.resolve();
      var t0 = Date.now();
      return new Promise(function (resolve) {
        resolveWait = resolve;
        (function poll() {
          if (!alive) return resolve();
          var v = 0;
          try { v = coord(); } catch (err) { v = 1; }
          if (v >= frac || Date.now() - t0 > capMs) return resolve();
          timer = setTimeout(poll, 90);
        })();
      });
    }

    // Type a line character by character. Reduced motion prints it whole.
    async function type(text, cls) {
      var l = line(cls);
      if (REDUCED) { l.textContent = text; return; }
      var caret = el('span', 'tui-caret', ' ');
      l.appendChild(caret);
      for (var i = 0; i < text.length && alive; i++) {
        caret.insertAdjacentText('beforebegin', text[i]);
        if (text[i] !== ' ') await wait(11);
      }
      if (caret.parentNode) caret.parentNode.removeChild(caret);
    }

    function equation(T) {
      var l = line('tui-eq tui-dim');
      l.innerHTML = '  <span class="eq-dg">ΔG</span> = <span class="eq-dh">ΔH</span> − ' +
                    '<span class="eq-t">T</span><span class="eq-ds">ΔS</span> − ' +
                    '<span class="eq-t">T</span><span class="eq-dsv">ΔS_vib</span>' +
                    '<span class="tui-t" style="margin-left:2.5em">T = ' + (T || '298 K') + '</span>';
    }

    async function run(sess) {
      try {
        clear();
        state.removeAttribute('data-done');
        state.textContent = '● RUNNING';
        cover.style.left = '0%';

        await type(sess.cmd, 'tui-cmd');
        if (!alive) return;
        await wait(320);
        line('tui-dim').textContent = '  ' + sess.banner;
        if (sess.equation) equation(sess.temperature && sess.temperature());
        line().textContent = '';

        // Step count is per session, so the index and the meter both derive
        // from steps.length. An earlier build hardcoded 6 and would have
        // mislabelled every five-step session as [n/6] while the meter never
        // reached the end.
        var st = sess.steps, total = st.length;
        for (var i = 0; i < total && alive; i++) {
          if (sess.coord) await waitCoord(sess.coord, (i + 1) / (total + 1), 4200);
          else await wait(REDUCED ? 0 : 460);
          if (!alive) return;
          var s = st[i], n = i + 1;
          var l = line('tui-row');
          l.appendChild(el('span', 'tui-idx', '[' + n + '/' + total + ']'));
          var tag = el('span', 'tui-name', s.label);
          // Colour by position on the series ramp. With fewer than six steps
          // the ramp is sampled across its full range rather than truncated,
          // so a five-step run still ends on tangerine (converged · ΔG).
          var tok = total === 1 ? 6 : Math.round(1 + (n - 1) * (5 / (total - 1)));
          tag.style.color = 'var(--series-' + tok + ')';
          l.appendChild(tag);
          // A live step reads its value at the moment it is reached.
          l.appendChild(el('span', 'tui-val', typeof s.detail === 'function' ? s.detail() : s.detail));
          cover.style.left = ((n / total) * 100).toFixed(1) + '%';
        }
        if (!alive) return;

        await wait(REDUCED ? 0 : 520);
        line().textContent = '';
        var done = line();
        var okTag = el('span', null, '  ● CONVERGED');
        okTag.style.color = 'var(--series-6)';
        done.appendChild(okTag);
        done.appendChild(el('span', 'tui-dim', '   ' + (typeof sess.done === 'function' ? sess.done() : sess.done)));
        state.textContent = '● CONVERGED';
        state.setAttribute('data-done', '1');

        if (REDUCED) return;               // one frame, no loop
        await wait(2600);
        if (!alive) return;
        // Dequeue the next session rather than replaying this one: the
        // toolchain has more than one surface, so watching it twice shows a
        // different one. A single-entry queue re-runs itself, which for a live
        // profile means walking the coordinate again — the point of it.
        if (q.list.length > 1) {
          var nxt = line('tui-dim');
          nxt.textContent = '  next in queue → ' + q.list[(idx + 1) % q.list.length].key + ' …';
          await wait(1100);
          if (!alive) return;
        }
        idx = (idx + 1) % q.list.length;
        run(q.list[idx]);
      } catch (err) { /* a stopped run unwinds here; nothing to report */ }
    }

    var self = {
      win: win,
      // Idempotent: a second start() while a run is in flight is ignored, so
      // no caller can stack two loops onto the same panel.
      start: function () {
        if (running) return;
        running = true; alive = true;
        run(q.list[idx]);
      },
      stop: function () {
        running = false; alive = false;
        clearTimeout(timer); clearInterval(watchdog);
        // Release any in-flight wait so the async run unwinds instead of
        // parking forever on a promise nothing will ever resolve.
        if (resolveWait) { resolveWait(); resolveWait = null; }
      }
    };
    return self;
  }

  // The homepage renders this panel inside a template runtime that re-renders
  // its subtree. When it does, BOTH the panel and the mount this closure
  // captured are detached — writes land in an orphaned tree and the visible
  // panel freezes mid-word with no error to show for it. So nothing holds a
  // node reference across time: the supervisor re-queries the live document
  // and rebuilds on whatever node is currently mounted.
  function sweep() {
    var mounts = document.querySelectorAll('[data-flexaidds-tui]');
    Array.prototype.forEach.call(mounts, function (m) {
      var inst = m.__tui;
      if (inst && m.isConnected && inst.win.isConnected) return;   // healthy
      if (inst) inst.stop();
      m.__tui = TUI(m);
      m.__tui.start();
    });
  }

  function init() {
    if (!document.querySelector('[data-flexaidds-tui]')) return;
    injectCSS();
    sweep();
    setInterval(sweep, 900);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
