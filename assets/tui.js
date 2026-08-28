/* ============================================================
   FlexAID∆S — TUI
   Le Bonhomme Pharma · Montréal

   A terminal panel that runs a synthetic docking session and
   keeps running: when a run converges it dequeues the next
   target rather than freezing on the last frame.

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
   appears only on the T term and a failed run.

   Every colour here is a token. No hex literals, so the panel
   cannot drift from the system (scripts/check-design-system.sh).

   HONESTY
   -------
   The numbers are synthetic and the titlebar says so, matching
   the "live synthetic run" label the /entropy-driven/ demo
   already uses. This is chrome, not a benchmark result.

   Usage:  <div data-flexaidds-tui></div>
           <script src="/assets/tui.js" defer></script>
   ============================================================ */
(function () {
  'use strict';

  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Astex Diverse Set entries. Ligand codes and figures are synthetic.
  var QUEUE = [
    { pdb: '1S3V', lig: 'NAD', s0: '4.812', ds: '-0.341', contacts: 14, buried: 62, dsv: '-0.089', dh: '-11.204', dg: '-8.42', rmsd: '0.94', pose: 3 },
    { pdb: '1UNL', lig: 'LGS', s0: '5.117', ds: '-0.298', contacts: 11, buried: 57, dsv: '-0.112', dh: '-10.061', dg: '-7.68', rmsd: '1.21', pose: 1 },
    { pdb: '1YGC', lig: '905', s0: '4.463', ds: '-0.402', contacts: 17, buried: 71, dsv: '-0.074', dh: '-12.930', dg: '-9.15', rmsd: '0.62', pose: 2 },
    { pdb: '2BM2', lig: 'PM2', s0: '5.004', ds: '-0.355', contacts: 13, buried: 60, dsv: '-0.097', dh: '-10.788', dg: '-8.03', rmsd: '1.07', pose: 5 },
    { pdb: '1R55', lig: '827', s0: '4.688', ds: '-0.319', contacts: 12, buried: 58, dsv: '-0.101', dh: '-9.994', dg: '-7.41', rmsd: '1.44', pose: 4 }
  ];

  function stages(t) {
    return [
      { n: 1, tok: 'series-1', label: 'apo baseline',          detail: 'S = ' + t.s0 + ' nats' },
      { n: 2, tok: 'series-2', label: 'unbound · ΔS',          detail: 'ΔS = ' + t.ds + ' kcal/mol·K' },
      { n: 3, tok: 'series-3', label: 'pocket contact',        detail: t.contacts + ' contacts · ' + t.buried + '% buried' },
      { n: 4, tok: 'series-4', label: 'rigidification · ΔS_vib', detail: 'ΔS_vib = ' + t.dsv },
      { n: 5, tok: 'series-5', label: 'contacts formed · ΔH',  detail: 'ΔH = ' + t.dh + ' kcal/mol' },
      { n: 6, tok: 'series-6', label: 'converged · ΔG',        detail: 'ΔG = ' + t.dg + ' kcal/mol' }
    ];
  }

  var CSS = [
    '[data-flexaidds-tui]{--tui-pad:clamp(16px,3vw,24px);font-family:var(--font-mono,monospace)}',
    '.tui-win{border:1px solid var(--violet-20,rgba(139,92,246,.2));border-radius:var(--r-lg,12px);',
    'background:var(--bg,#08091A);overflow:hidden;box-shadow:var(--glow-violet,none),var(--inset-sheen,none)}',
    '.tui-bar{display:flex;align-items:center;gap:8px;padding:11px 14px;background:var(--bg-card,rgba(17,18,38,.82));',
    'border-bottom:1px solid var(--violet-20,rgba(139,92,246,.2))}',
    // Dots are mint/tangerine/firetruck — the system's own hues. No yellow anywhere.
    '.tui-dot{width:11px;height:11px;border-radius:var(--r-pill,9999px);flex:none}',
    '.tui-dot.a{background:var(--mint,#45E0A8)}.tui-dot.b{background:var(--tangerine,#FF9300)}.tui-dot.c{background:var(--firetruck,#F5232B)}',
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

  function TUI(mount) {
    // "bare" mounts inside a frame the host page already draws, so the panel
    // does not grow a second titlebar inside the first.
    var bare = mount.getAttribute('data-flexaidds-tui') === 'bare';
    var win = el('div', bare ? 'tui-bare' : 'tui-win');
    var state = el('span', 'tui-state', '● RUNNING');
    if (!bare) {
      var bar = el('div', 'tui-bar');
      ['a', 'b', 'c'].forEach(function (k) { bar.appendChild(el('span', 'tui-dot ' + k)); });
      bar.appendChild(el('span', 'tui-title', 'flexaidds — live synthetic run'));
      bar.appendChild(state);
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

    // Type a line character by character. Reduced motion prints it whole.
    async function type(text, cls) {
      var l = line(cls);
      if (REDUCED) { l.textContent = text; return; }
      var caret = el('span', 'tui-caret', ' ');
      l.appendChild(caret);
      for (var i = 0; i < text.length && alive; i++) {
        caret.insertAdjacentText('beforebegin', text[i]);
        if (text[i] !== ' ') await wait(11);
      }
      if (caret.parentNode) caret.parentNode.removeChild(caret);
    }

    function equation() {
      var l = line('tui-eq tui-dim');
      l.innerHTML = '  <span class="eq-dg">ΔG</span> = <span class="eq-dh">ΔH</span> − ' +
                    '<span class="eq-t">T</span><span class="eq-ds">ΔS</span> − ' +
                    '<span class="eq-t">T</span><span class="eq-dsv">ΔS_vib</span>' +
                    '<span class="tui-t" style="margin-left:2.5em">T = 298 K</span>';
    }

    async function run(t) {
      clear();
      state.removeAttribute('data-done');
      state.textContent = '● RUNNING';
      cover.style.left = '0%';

      await type('$ flexaidds dock --receptor ' + t.pdb + '.pdb --ligand ' + t.lig + '.mol2 --entropy shannon', 'tui-cmd');
      if (!alive) return;
      await wait(320);
      line('tui-dim').textContent = '  FlexAID∆S 2.0.0 · entropy-driven docking';
      equation();
      line().textContent = '';

      var st = stages(t);
      for (var i = 0; i < st.length && alive; i++) {
        await wait(REDUCED ? 0 : 460);
        if (!alive) return;
        var s = st[i];
        var l = line('tui-row');
        l.appendChild(el('span', 'tui-idx', '[' + s.n + '/6]'));
        var tag = el('span', 'tui-name', s.label);
        // The stage colour is its series token — the ramp, in energy order.
        tag.style.color = 'var(--' + s.tok + ')';
        l.appendChild(tag);
        l.appendChild(el('span', 'tui-val', s.detail));
        cover.style.left = ((s.n / 6) * 100).toFixed(1) + '%';
      }
      if (!alive) return;

      await wait(REDUCED ? 0 : 520);
      line().textContent = '';
      var done = line();
      var okTag = el('span', null, '  ● CONVERGED');
      okTag.style.color = 'var(--series-6)';
      done.appendChild(okTag);
      done.appendChild(el('span', 'tui-dim', '   RMSD ' + t.rmsd + ' Å   pose ' + t.pose + '/20   ΔG ' + t.dg + ' kcal/mol'));
      state.textContent = '● CONVERGED';
      state.setAttribute('data-done', '1');

      if (REDUCED) return;               // one frame, no loop
      await wait(2600);
      if (!alive) return;
      // Dequeue the next target rather than replaying this one: a queue that
      // has more work does the work. Watching it twice shows something new.
      var nxt = line('tui-dim');
      nxt.textContent = '  next in queue → ' + QUEUE[(idx + 1) % QUEUE.length].pdb + ' …';
      await wait(1100);
      if (!alive) return;
      idx = (idx + 1) % QUEUE.length;
      run(QUEUE[idx]);
    }

    var self = {
      win: win,
      // Idempotent: a second start() while a run is in flight is ignored, so
      // no caller can stack two loops onto the same panel.
      start: function () {
        if (running) return;
        running = true; alive = true;
        run(QUEUE[idx]);
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
