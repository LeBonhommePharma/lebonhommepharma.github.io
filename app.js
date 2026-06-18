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
  const drugs = [
    'Lithium Carbonate', 'Cisplatin', 'Bortezomib', 'Fluoxetine',
    'Morphine', 'Ketamine', 'MDMA', 'Psilocybin', 'LSD',
    'Ibogaine', 'Cannabidiol', 'Cocaine HCl', 'Amphetamine',
    'Haloperidol', 'Clozapine', 'Oxaliplatin', 'Naloxone',
    'Naltrexone', 'Buprenorphine', 'Fentanyl', 'Methadone',
    'Lorazepam', 'Propofol', 'Midazolam', 'Ketamine', 'Dexamethasone',
    'Auranofin', '¹⁷⁷Lu-DOTATATE', 'Arsenic Trioxide', 'Sildenafil',
  ];
  const dayIdx = Math.floor(Date.now() / 86400000) % drugs.length;
  const label = document.getElementById('drug-of-day-label');
  if (label) label.textContent = drugs[dayIdx];

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
  // Only init if the molstar global is available
  if (window.molstar && document.getElementById('molstar-viewer')) {
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
        pdbProvider: 'pdbe',
        emdbProvider: 'pdbe',
      }).then(viewer => {
        viewer.loadPdb('1hvr'); // Thrombin + PPACK — a classic dock
      });
    } catch(e) {
      // Molstar failed silently — no problem, just hides the viewer
    }
  }

})();
