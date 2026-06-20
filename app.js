// Le Bonhomme Pharma — FlexAID∆S Homepage JS
// Tabs · Copy · Theme · Counter · Drug of day · Mobile menu

(function() {
  'use strict';

  // ── Tab switching (Usage section) ──────────────────────────
  document.querySelectorAll('.usage-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('aria-controls');
      document.querySelectorAll('.usage-tabs .tab-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      const panel = document.getElementById(target);
      if (panel) panel.classList.remove('hidden');
    });
  });

  // ── Copy buttons ───────────────────────────────────────────
  document.querySelectorAll('.copy-btn[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.copy).then(() => {
        const orig = btn.innerHTML;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22D3EE" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(() => { btn.innerHTML = orig; }, 1500);
      }).catch(() => {});
    });
  });

  // ── Theme toggle ───────────────────────────────────────────
  // Handled by the canonical controller in theme.js (anti-flash,
  // localStorage persistence, aria sync). Nothing to do here.

  // ── Animated stat counters ─────────────────────────────────
  function animateCount(el) {
    const target = parseInt(el.dataset.count, 10);
    if (isNaN(target)) return;
    const dur = 1400;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(eased * target);
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = target;
    };
    requestAnimationFrame(tick);
  }
  // Trigger on intersection
  if ('IntersectionObserver' in window) {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) { animateCount(e.target); obs.unobserve(e.target); }
      });
    }, { threshold: 0.3 });
    document.querySelectorAll('[data-count]').forEach(el => obs.observe(el));
  } else {
    document.querySelectorAll('[data-count]').forEach(animateCount);
  }

  // ── Drug of the day (rotation by UTC date) ─────────────────
  // One object drives both the label and the Mol* structure, so the displayed
  // drug is always the complex loaded in the background.
  const drugComplexes = [
    { pdb: '1hsg', drug: 'Indinavir',      target: 'HIV-1 protease' },
    { pdb: '3ert', drug: 'Tamoxifen',      target: 'estrogen receptor alpha' },
    { pdb: '1iep', drug: 'Imatinib',       target: 'Abl kinase' },
    { pdb: '1m17', drug: 'Erlotinib',      target: 'EGFR kinase' },
    { pdb: '3nss', drug: 'Oseltamivir',    target: 'influenza neuraminidase' },
    { pdb: '6lu7', drug: 'N3 inhibitor',   target: 'SARS-CoV-2 main protease' },
    { pdb: '4cox', drug: 'Celecoxib',      target: 'cyclooxygenase-2' },
    { pdb: '1hwi', drug: 'Donepezil',      target: 'acetylcholinesterase' },
    { pdb: '2rh1', drug: 'Carazolol',      target: 'beta-2 adrenergic receptor' },
    { pdb: '3htb', drug: 'Dabigatran',     target: 'thrombin' },
    { pdb: '2src', drug: 'Dasatinib',      target: 'Src/Abl kinase' },
    { pdb: '3eml', drug: 'Crizotinib',     target: 'ALK kinase' },
    { pdb: '4dkl', drug: 'Sorafenib',      target: 'RAF kinase' },
    { pdb: '2pgh', drug: 'Flurbiprofen',   target: 'cyclooxygenase' },
    { pdb: '1cbs', drug: 'Retinoic acid',  target: 'cellular retinoic acid-binding protein' },
  ];
  const dayIdx = Math.floor(Date.now() / 86400000) % drugComplexes.length;
  const todaysComplex = drugComplexes[dayIdx];
  const label = document.getElementById('drug-of-day-label');
  if (label) {
    label.innerHTML = '<strong>' + todaysComplex.drug + '</strong> · ' +
      '<span class="drug-target">' + todaysComplex.target + '</span> ' +
      '<span class="drug-pdb">PDB ' + todaysComplex.pdb.toUpperCase() + '</span>';
  }

  // ── Mobile menu toggle ─────────────────────────────────────
  const mobileToggle = document.querySelector('.mobile-menu-toggle');
  const mainNav = document.querySelector('.main-nav');
  if (mobileToggle && mainNav) {
    mobileToggle.addEventListener('click', () => {
      const isOpen = mobileToggle.getAttribute('aria-expanded') === 'true';
      mobileToggle.setAttribute('aria-expanded', String(!isOpen));
      if (!isOpen) {
        mainNav.style.cssText = 'display:flex;flex-direction:column;gap:4px;position:absolute;top:56px;left:0;right:0;background:rgba(10,14,20,0.98);padding:1rem 1.5rem;border-bottom:1px solid rgba(34,211,238,0.12);z-index:99;';
      } else {
        mainNav.removeAttribute('style');
      }
    });
    // Close on nav click
    mainNav.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        mobileToggle.setAttribute('aria-expanded', 'false');
        mainNav.removeAttribute('style');
      });
    });
  }

  // ── Sticky header elevation on scroll ─────────────────────
  const header = document.getElementById('site-header');
  if (header) {
    window.addEventListener('scroll', () => {
      header.style.boxShadow = window.scrollY > 10
        ? '0 4px 24px rgba(0,0,0,0.4)'
        : 'none';
    }, { passive: true });
  }

  // ── Mol* viewer (optional 3D background) ──────────────────
  function loadMolstarFallback(done) {
    if (window.molstar) {
      done();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/molstar@4.5.0/build/viewer/molstar.js';
    script.onload = done;
    script.onerror = () => {
      const viewerEl = document.getElementById('molstar-viewer');
      if (viewerEl) viewerEl.classList.add('molstar-unavailable');
    };
    document.head.appendChild(script);
  }

  function setPublicationView(viewer) {
    try {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      if (viewer.plugin && viewer.plugin.canvas3d) {
        viewer.plugin.canvas3d.setProps({
          renderer: {
            backgroundColor: isLight ? 0xf8fafc : 0x0a0e14,
            backgroundAlpha: 0,
            ambientIntensity: 0.72,
            lightIntensity: 0.58,
          },
          camera: {
            fog: 0,
            clipFar: true,
          },
          postprocessing: {
            outline: {
              name: 'on',
              params: { scale: 1, threshold: 0.28, color: isLight ? 0x111827 : 0x000000 },
            },
            occlusion: {
              name: 'on',
              params: { samples: 32, radius: 5, bias: 0.85, blurKernelSize: 15, resolutionScale: 1 },
            },
          },
          trackball: {
            animate: { name: 'spin', params: { speed: 0.35 } },
          },
        });
      }
    } catch(e) {
      // Mol* prop schemas differ slightly across builds; keep the structure visible.
    }
  }

  function initMolstar() {
    if (!window.molstar || !document.getElementById('molstar-viewer')) return;
    try {
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
        canvas3d: {
          transparentBackground: true,
          renderer: { backgroundAlpha: 0 },
          camera: { fog: 0 },
        },
      }).then(viewer => {
        Promise.resolve(viewer.loadPdb(todaysComplex.pdb)).then(() => {
          setPublicationView(viewer);
        });
      });
    } catch(e) {
      // Molstar failed silently — no problem, just hides the viewer
    }
  }

  loadMolstarFallback(initMolstar);

})();
