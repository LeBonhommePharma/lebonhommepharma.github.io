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
   The default queue is GENERATED and says so in three places —
   screen-reader summary, a notice line under the banner, and the
   titlebar where one exists. It reports no success rate, no RMSD,
   no rank and no accuracy figure of any kind; what it does report
   is a thermodynamics that closes on itself:

       ΔG = ΔH − TΔS    K_D = exp(ΔG/RT)    θ = [L]/([L] + K_D)

   Two quantities are rolled and everything else is computed, so
   the identity holds on every frame rather than by an author
   keeping four hardcoded numbers in agreement.

   A page may instead point a mount at a registered PROFILE:

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

  // ── what this queue prints, and what it refuses to ────────────────────
  // This queue used to end on a benchmark result: a top-1 success rate, a
  // median RMSD and a pose rank, hardcoded, with a comment claiming they were
  // "kept consistent with the published ones". The campaign those figures
  // summarised is still running, so the panel was asserting an outcome nobody
  // had measured — on every page that loads this file, at once.
  //
  // The fix is NOT to make the rate wobble. A performance number that changes
  // on reload reads as live telemetry, which makes a fabricated figure MORE
  // convincing, not less. The whole class of claim is gone instead: no success
  // rate, no RMSD, no rank, no top-N, no percentage anywhere in this file.
  //
  // What replaces it is the one thing a panel with no measurements behind it
  // can still be right about — its own thermodynamics. Two numbers are rolled,
  // ΔH and the scatter off the compensation line; every other energy on screen
  // is COMPUTED from them, so
  //
  //     ΔG = ΔH − TΔS        K_D = exp(ΔG/RT)        θ = [L]/([L] + K_D)
  //
  // closes on every frame by construction rather than by an author remembering
  // to update four numbers together. That demonstrates what the engine
  // computes. It says nothing about how well it does it, and those are
  // different kinds of statement.
  //
  // Everything else printed here describes PROCESS, not performance:
  // generation counters, population entropy, CF in arbitrary units, atom
  // counts, wall clock, paths, status.

  // ── the label, in three places ────────────────────────────────────────
  // Valid-looking physics presented as a live run is still a claim about a run
  // that did not happen, and this panel is convincing precisely because the
  // numbers now hang together. So the label is not one line that a bare mount
  // or a screen reader can miss:
  //
  //   1. the screen-reader summary, first child of the mount    (TUI)
  //   2. the notice line under the banner, on every session     (run)
  //   3. the titlebar, where there is one                       (fallback)
  //
  // A bare mount has no titlebar, so 1 and 2 carry it alone on the homepage —
  // which is exactly why the notice prints in the body rather than the chrome.
  var NOTE_TEXT =
    '  note — illustrative session. The structures are real; every energy below is ' +
    'generated to satisfy ΔG = ΔH − TΔS. Not a measured run, and not a benchmark result.';
  var SR_TEXT =
    'Illustrative terminal panel. It animates a docking session using generated ' +
    'thermodynamic values that satisfy the identity delta G equals delta H minus T delta S, ' +
    'with the dissociation constant and fractional occupancy derived from delta G. ' +
    'The protein structures named are real; the energies are not measured. ' +
    'No benchmark result, success rate or accuracy figure is reported here.';

  // ── constants ─────────────────────────────────────────────────────────
  // R in kcal·mol⁻¹·K⁻¹ so every energy on the panel is kcal/mol. RT is
  // DERIVED from R and T rather than pasted in as 0.6163, so an edit to T
  // cannot leave a stale RT behind — the classic way this identity rots.
  var R_KCAL = 1.987e-3;              // kcal·mol⁻¹·K⁻¹
  var T_K = 310.15;                   // K — body temperature, not the 298 K bench default
  var RT = R_KCAL * T_K;              // ≈ 0.6163 kcal/mol

  // THE UNIT TRAP, NAMED SO IT CANNOT COME BACK.
  // ΔH and ΔG are kcal/mol. ΔS is cal·mol⁻¹·K⁻¹ — the convention entropies are
  // tabulated in — so T·ΔS lands in CAL/mol and must be divided by 1000 before
  // it can be subtracted from an enthalpy. Miss that and every ΔG is off by
  // three orders of magnitude while still looking plausible. Nothing in this
  // file multiplies T by ΔS inline; every conversion goes through tds().
  function tds(dS_cal) { return T_K * dS_cal / 1000; }        // → kcal/mol

  // ── enthalpy–entropy compensation ─────────────────────────────────────
  // ΔH and ΔS are not independent in real binding data. A tighter enthalpic
  // network — more hydrogen bonds, a better-packed pocket — is paid for in
  // conformational freedom, so the two drift together along a compensation
  // line and ΔG varies far less than ΔH does. Rolling them independently
  // would scatter ΔG across a range no calorimeter has ever reported.
  //
  //     ΔS = S_B0 + S_B1·ΔH        (ΔS cal·mol⁻¹·K⁻¹, ΔH kcal/mol)
  //
  // S_B1 is set so T·dΔS/dΔH ≈ 0.56: a little over half of any enthalpic gain
  // is handed straight back as entropy, which is where measured compensation
  // slopes for drug-like binding sit. The scatter is what keeps this a
  // correlation instead of a rule — a perfectly straight line would be its own
  // kind of lie.
  var DH_MIN = -15, DH_MAX = -5;      // kcal/mol — drug-like binding enthalpies
  var S_B0 = 14.832, S_B1 = 1.8056;   // compensation intercept / slope
  var S_SCATTER = 1.6;                // ± cal·mol⁻¹·K⁻¹ off the line

  // ΔS_vib is a COMPONENT of ΔS, not a third term bolted onto the identity:
  // the complex rigidifies on binding, so it is negative, and it deepens as
  // the enthalpic network tightens. The configurational remainder is whatever
  // is left once it is taken out, which keeps ΔS = ΔS_conf + ΔS_vib exact and
  // spends no extra roll on it.
  var V_B0 = 0.75, V_B1 = 0.45;

  var L_M = 1e-6;                     // 1 µM — a screening concentration
  var POP = 128;                      // search population
  var S0_NATS = Math.log(POP);        // ln N, the population entropy ceiling

  // mulberry32. Seeded, and the seed is PRINTED in the command line, so the
  // numbers on screen can be re-derived by anyone who cares to — a generated
  // figure that hides its generator is halfway back to being a claim.
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // K_D spans four decades across the ΔH band, so the unit has to travel with
  // it or the panel prints "0.01 nM" at one end and "36000 nM" at the other.
  function fmtKd(kd_M) {
    var U = [['pM', 1e-12], ['nM', 1e-9], ['µM', 1e-6], ['mM', 1e-3], ['M', 1]];
    for (var i = 0; i < U.length; i++) {
      var v = kd_M / U[i][1];
      if (v < 1000 || i === U.length - 1) {
        return (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + ' ' + U[i][0];
      }
    }
  }

  function sgn(v, d) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d); }

  // One internally-consistent draw. Two rolls in, everything else computed.
  function draw(rand) {
    var dH = DH_MIN + rand() * (DH_MAX - DH_MIN);
    var dS = S_B0 + S_B1 * dH + (rand() * 2 - 1) * S_SCATTER;
    var dG = dH - tds(dS);                       // the identity, once, here
    var kd = Math.exp(dG / RT);                  // molar
    var dSvib = V_B0 + V_B1 * dH;                // negative across the band
    // u ∈ [0,1]: 0 at the weakest enthalpy, 1 at the tightest. The process
    // counters below are shaped by it so a tighter complex also reads as a
    // deeper search — they are descriptive, not scored.
    var u = (dH - DH_MAX) / (DH_MIN - DH_MAX);
    return {
      dH: dH, dS: dS, dG: dG, kd: kd,
      dSvib: dSvib, dSconf: dS - dSvib,
      theta: L_M / (L_M + kd),
      sEnd: S0_NATS * (0.22 - 0.12 * u),
      gen: Math.round(POP * (0.55 + 0.35 * u)),
      contacts: Math.round(9 + 9 * u),
      sasa: Math.round(280 + 260 * u),
      cf: -(28 + 22 * u),
      secs: 0.019 * Math.round(POP * (0.55 + 0.35 * u))
    };
  }

  // A dock session holds one draw and re-rolls it at the top of every pass, so
  // the queue shows a different point on the compensation line each time round
  // instead of replaying one frozen tuple. Details are functions because the
  // panel already supports live values — the same mechanism a real profile uses.
  function dockSession(t) {
    var v = draw(rng(1));
    var seed = 1;
    return {
      key: 'dock ' + t.pdb,
      illustrative: true,
      refresh: function () {
        seed = (Math.random() * 0xFFFFFFFF) >>> 0;
        v = draw(rng(seed));
      },
      cmd: function () {
        return '$ flexaidds dock --receptor ' + t.pdb + '.pdb --ligand ' + t.lig +
               '.mol2 --entropy shannon --illustrative --seed ' + seed;
      },
      // No version string. This file cannot check which build is installed, and
      // the one it used to name (2.0.3) already disagreed with the release the
      // site states elsewhere. A number that looks checkable and isn't is worse
      // than no number.
      banner: 'FlexAID∆S · entropy-driven docking · generated session',
      equation: 'decomp',
      temperature: function () { return T_K.toFixed(2) + ' K'; },
      steps: [
        { label: 'apo baseline',            detail: function () {
            return 'S₀ = ln ' + POP + ' = ' + S0_NATS.toFixed(3) + ' nats · ' +
                   t.atoms + ' receptor atoms';
          } },
        { label: 'unbound · ΔS',            detail: function () {
            return 'ΔS ' + sgn(v.dS, 2) + ' cal·mol⁻¹·K⁻¹ · −TΔS ' + sgn(-tds(v.dS), 2) + ' kcal/mol';
          } },
        { label: 'pocket contact',          detail: function () {
            return v.contacts + ' contacts · ' + v.sasa + ' Å² buried · CF ' +
                   sgn(v.cf, 1) + ' a.u.';
          } },
        { label: 'rigidification · ΔS_vib', detail: function () {
            return 'ΔS_vib ' + sgn(v.dSvib, 2) + ' · ΔS_conf ' + sgn(v.dSconf, 2) +
                   ' cal·mol⁻¹·K⁻¹';
          } },
        { label: 'contacts formed · ΔH',    detail: function () {
            return 'ΔH ' + sgn(v.dH, 2) + ' kcal/mol · S ' + S0_NATS.toFixed(3) + ' → ' +
                   v.sEnd.toFixed(3) + ' nats';
          } },
        { label: 'converged · ΔG',          detail: function () {
            return 'ΔG ' + sgn(v.dG, 2) + ' kcal/mol · K_D ' + fmtKd(v.kd);
          } }
      ],
      done: function () {
        return 'ΔG ' + sgn(v.dG, 2) + ' kcal/mol   K_D ' + fmtKd(v.kd) +
               '   θ ' + v.theta.toFixed(3) + ' at [L] 1 µM   gen ' + v.gen + '/' + POP +
               '   ' + v.secs.toFixed(2) + ' s   status=ok';
      }
    };
  }

  // Real PDB entries, so the walk reads as a walk rather than as three blanks.
  // The STRUCTURES are real; every energy attached to them below is generated.
  // The notice line and the screen-reader text both say exactly that, because
  // a real accession next to an invented ΔG is the most checkable-looking claim
  // on the panel and has to be the most clearly disowned.
  var DOCK_TARGETS = [
    { pdb: '1S3V', lig: 'TQD', atoms: 2438 },
    { pdb: '1UNL', lig: 'LGS', atoms: 2291 },
    { pdb: '1YGC', lig: '905', atoms: 1976 }
  ];

  var SESSIONS = [
    dockSession(DOCK_TARGETS[0]),
    {
      // The campaign is in flight. This session reports that it is running and
      // what it is doing — it does not report how it is going, because nobody
      // knows yet. "No aggregate" is the honest terminal state for a benchmark
      // that has not finished, and it is not a placeholder for a number to be
      // dropped in later without re-reading this comment.
      key: 'DatasetRunner',
      illustrative: true,
      cmd: '$ flexaidds-benchmark --set astex --resume --out bench/astex',
      banner: 'DatasetRunner · campaign in flight',
      steps: [
        { label: 'manifest resolved',       detail: 'targets staged from set definition' },
        { label: 'receptors typed',         detail: 'apo strip · hydrogens added' },
        { label: 'pockets detected',        detail: 'GetCleft · clefts ranked by volume' },
        { label: 'docking · ΔS_vib',        detail: 'tENCoM normal modes' },
        { label: 'rescoring · ΔH',          detail: 'Voronoi CF · OpenMP batch' },
        { label: 'writing · ΔG',            detail: 'per-target records appended' }
      ],
      done: 'campaign running   no aggregate reported   status=ok'
    },
    (function () {
      var v = draw(rng(2));
      return {
        key: 'flexaidds (python)',
        illustrative: true,
        refresh: function () { v = draw(rng((Math.random() * 0xFFFFFFFF) >>> 0)); },
        cmd: '$ python -m flexaidds results/1s3v --modes',
        banner: 'flexaidds · binding-mode summary',
        equation: 'decomp',
        temperature: function () { return T_K.toFixed(2) + ' K'; },
        steps: [
          { label: 'results directory',     detail: 'results/1s3v' },
          { label: 'binding modes · ΔS',    detail: function () {
              return '12 parsed · 20 poses each · ΔS ' + sgn(v.dS, 2) + ' cal·mol⁻¹·K⁻¹';
            } },
          { label: 'temperature · T',       detail: function () {
              return T_K.toFixed(2) + ' K · RT ' + RT.toFixed(4) + ' kcal/mol';
            } },
          { label: 'enthalpy · ΔH',         detail: function () { return 'ΔH ' + sgn(v.dH, 2) + ' kcal/mol'; } },
          { label: 'free energy · ΔG',      detail: function () {
              return 'ΔG ' + sgn(v.dG, 2) + ' kcal/mol · K_D ' + fmtKd(v.kd) +
                     ' · θ ' + v.theta.toFixed(3) + ' at [L] 1 µM';
            } }
        ],
        // mode_id identifies a record. It is not a rank, and nothing here
        // orders the modes against one another — ordering them would be
        // scoring, and scoring is the thing this file no longer does.
        done: function () {
          return 'mode_id 3   CF ' + sgn(v.cf, 1) + ' a.u.   claims illustrative_only';
        }
      };
    })(),
    {
      // Process only. A folding free energy runs on the opposite sign
      // convention to the K_D above, and putting the two next to each other in
      // one panel is how a reader ends up reading one of them backwards. The
      // identity in this file is the binding one; RNA co-folding gets counters.
      key: 'NATURaL cofolding',
      illustrative: true,
      cmd: '$ natural_hammerhead --organism ecoli --rnap --cofold',
      banner: 'NATURaL · co-transcriptional DualAssembly (RNAP)',
      steps: [
        { label: 'nascent chain',           detail: '43 nt transcribed' },
        { label: 'RNAP tunnel',             detail: '8 nt occluded · Nudler 2012' },
        { label: 'pause sites',             detail: '3 detected · elongation-rate dip' },
        { label: 'nucleation seeds',        detail: '2 RNA hairpin · 1 G-quad' },
        { label: 'co-folding · stem II',    detail: 'seed reached before tunnel exit' }
      ],
      done: 'hammerhead folded   trajectory written   status=ok'
    },
    dockSession(DOCK_TARGETS[1]),
    dockSession(DOCK_TARGETS[2])
  ];

  // The default queue is the one thing this file KNOWS is generated, so it is
  // the one thing this file labels. A registered profile is a page shipping its
  // own provenance — the three that exist read real poses and real page data —
  // and stamping "illustrative" over a page's measured run would be a false
  // statement in the other direction. A profile that IS synthetic opts in with
  // `illustrative: true` on the queue or on a session.
  function fallback() {
    return { list: SESSIONS, illustrative: true, title: 'flexaidds — illustrative run · generated numbers' };
  }

  // Resolve a mount's session queue. Unknown or absent profile → the default.
  function queueFor(mount) {
    var name = mount.getAttribute('data-tui-profile');
    if (!name) return fallback();
    var reg = window.FLEXAIDDS_TUI_PROFILES;
    var make = reg && reg[name];
    if (typeof make !== 'function') return fallback();
    try {
      var p = make();
      if (!p || !p.list || !p.list.length) throw new Error('empty profile');
      return p;
    } catch (err) {
      // A broken profile must never take the panel down with it. The pages
      // share this file; a page-specific mistake stays page-specific — and it
      // falls back to the labelled queue, never to an unlabelled one.
      return fallback();
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
    // The illustrative notice is deliberately NOT coloured. Every hue in this
    // panel is bound to a quantity — mint ΔH, violet ΔS, tangerine ΔG,
    // firetruck T, aqua ΔS_vib, strawberry receptor, magnesium baseline — and
    // a caveat is not a quantity. Borrowing one of those to shout with would
    // put a colour on screen that means something it does not mean. So it gets
    // visibility from typography instead: full-strength --fg against the dim
    // banner around it, a rule down the left, and its own line.
    '.tui-note{display:block;margin:2px 0 4px;padding:4px 0 4px 10px;',
    'border-left:2px solid var(--fg-muted,#8D8CB0);color:var(--fg,#E4E3F5);overflow-wrap:anywhere}',
    // Screen-reader copy. The body types character by character, which a
    // screen reader either ignores or reads as noise, so the honest summary is
    // given once as text and placed BEFORE the window in the DOM — the first
    // thing reached on entering the mount.
    // inset(1px) rather than the usual inset(50%): on a 1×1px box it collapses
    // just the same, and it keeps the only per-cent signs left in this file the
    // two that are CSS lengths on the progress meter.
    '.tui-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;',
    'clip:rect(0 0 0 0);clip-path:inset(1px);white-space:nowrap;border:0}',
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
    // Place 1 of 3 for the illustrative label: the screen-reader summary, and
    // the only one a bare mount cannot lose, since a bare mount has no
    // titlebar to carry place 2. It goes in FIRST so it is read before the
    // terminal it describes.
    if (q.illustrative) mount.appendChild(el('span', 'tui-sr', SR_TEXT));
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

    // Two forms. `true` is the legacy three-term string the registered page
    // profiles were written against and still renders exactly as it did.
    // 'decomp' is what the generated sessions use: it states the identity they
    // actually satisfy — ΔG from two terms — and shows ΔS_vib as a COMPONENT
    // of ΔS rather than as a third subtraction. Printing an equation the
    // numbers underneath it do not obey is its own quiet fabrication.
    function equation(T, form) {
      var l = line('tui-eq tui-dim');
      var lhs = '  <span class="eq-dg">ΔG</span> = <span class="eq-dh">ΔH</span> − ' +
                '<span class="eq-t">T</span><span class="eq-ds">ΔS</span>';
      var rhs = (form === 'decomp')
        ? '<span style="margin-left:2.5em"><span class="eq-ds">ΔS</span> = ΔS_conf + ' +
          '<span class="eq-dsv">ΔS_vib</span></span>'
        : ' − <span class="eq-t">T</span><span class="eq-dsv">ΔS_vib</span>';
      l.innerHTML = lhs + rhs +
                    '<span class="tui-t" style="margin-left:2.5em">T = ' + (T || '298 K') + '</span>';
    }

    async function run(sess) {
      try {
        clear();
        state.removeAttribute('data-done');
        state.textContent = '● RUNNING';
        cover.style.left = '0%';

        // Re-roll before anything is printed, so the command line, the steps
        // and the done line all describe ONE draw. Rolling mid-run is how a
        // panel ends up printing a ΔH from one tuple and a ΔG from the next,
        // and the identity silently stops closing on screen.
        if (typeof sess.refresh === 'function') sess.refresh();

        // Place 2 of 3: the lede — FIRST, before the command is even typed.
        // It sat under the banner at first, which meant that for the ~300 ms a
        // command line takes to type, a bare mount carried no visible label at
        // all: no titlebar to fall back on, notice not yet printed. Nothing
        // numeric is on screen during that window, but "the caveat arrives
        // after the run starts" is the wrong order to put a caveat in.
        if (q.illustrative || sess.illustrative) line('tui-note').textContent = NOTE_TEXT;

        await type(typeof sess.cmd === 'function' ? sess.cmd() : sess.cmd, 'tui-cmd');
        if (!alive) return;
        await wait(320);
        line('tui-dim').textContent = '  ' + sess.banner;
        if (sess.equation) equation(sess.temperature && sess.temperature(), sess.equation);
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
