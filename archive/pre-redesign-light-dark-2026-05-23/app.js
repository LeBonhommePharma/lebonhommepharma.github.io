/* ==========================================================================
   FlexAID∆S — App Logic
   ========================================================================== */

(function() {
  'use strict';

  /* --- Theme Toggle --- */
  const toggle = document.querySelector('[data-theme-toggle]');
  const root = document.documentElement;

  let theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  root.setAttribute('data-theme', theme);

  if (toggle) {
    toggle.addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', theme);
      toggle.setAttribute('aria-label', 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' mode');
    });
  }

  /* --- Mobile Menu --- */
  const menuToggle = document.querySelector('.mobile-menu-toggle');
  const mainNav = document.querySelector('.main-nav');

  if (menuToggle && mainNav) {
    menuToggle.addEventListener('click', () => {
      const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
      menuToggle.setAttribute('aria-expanded', !isOpen);
      mainNav.classList.toggle('open');
    });
    mainNav.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        menuToggle.setAttribute('aria-expanded', 'false');
        mainNav.classList.remove('open');
      });
    });
  }

  /* --- Header Scroll --- */
  const header = document.getElementById('site-header');
  window.addEventListener('scroll', () => {
    header.classList.toggle('scrolled', window.scrollY > 60);
  }, { passive: true });

  /* --- Tabs --- */
  const tabs = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      panels.forEach(p => p.classList.add('hidden'));
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      const panel = document.getElementById(tab.getAttribute('aria-controls'));
      if (panel) panel.classList.remove('hidden');
    });
  });

  /* --- Copy Buttons --- */
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.getAttribute('data-copy');
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        btn.classList.add('copied');
        const original = btn.innerHTML;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = original; }, 2000);
      }).catch(() => {});
    });
  });

  /* --- Number Count Up --- */
  const countEls = document.querySelectorAll('[data-count]');
  const countObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        const target = parseInt(el.getAttribute('data-count'), 10);
        if (isNaN(target)) return;
        animateCount(el, 0, target, 800);
        countObserver.unobserve(el);
      }
    });
  }, { threshold: 0.3 });
  countEls.forEach(el => countObserver.observe(el));

  function animateCount(el, start, end, duration) {
    const startTime = performance.now();
    function step(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.floor(start + (end - start) * eased);
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* --- Hero Background: Mol* "Drug of the Day" --- */

  // Curated set of iconic drug–target complexes
  // Each rotates daily as the hero background, showcasing a famous drug
  const drugOfTheDay = [
    { pdb: '1hsg', drug: 'Indinavir',      indication: 'HIV protease inhibitor' },
    { pdb: '3ert', drug: 'Tamoxifen',       indication: 'Estrogen receptor antagonist' },
    { pdb: '1iep', drug: 'Imatinib',        indication: 'BCR-Abl kinase inhibitor (CML)' },
    { pdb: '1m17', drug: 'Erlotinib',       indication: 'EGFR inhibitor (lung cancer)' },
    { pdb: '3nss', drug: 'Oseltamivir',     indication: 'Neuraminidase inhibitor (influenza)' },
    { pdb: '6lu7', drug: 'N3 Inhibitor',    indication: 'SARS-CoV-2 main protease' },
    { pdb: '4cox', drug: 'Celecoxib',       indication: 'COX-2 selective NSAID' },
    { pdb: '1hwi', drug: 'Donepezil',       indication: 'Acetylcholinesterase inhibitor (Alzheimer\'s)' },
    { pdb: '2rh1', drug: 'Carazolol',       indication: 'Beta-2 adrenergic antagonist' },
    { pdb: '3htb', drug: 'Dabigatran',      indication: 'Thrombin inhibitor (anticoagulant)' },
    { pdb: '2src', drug: 'Dasatinib',       indication: 'Src/Abl kinase inhibitor (CML)' },
    { pdb: '3eml', drug: 'Crizotinib',      indication: 'ALK inhibitor (lung cancer)' },
    { pdb: '4dkl', drug: 'Sorafenib',       indication: 'RAF kinase inhibitor (liver/kidney cancer)' },
    { pdb: '1fin', drug: 'ATP analog',      indication: 'CDK2-Cyclin A complex' },
    { pdb: '2f4j', drug: 'SB-203580',       indication: 'p38 MAP kinase inhibitor' },
    { pdb: '1n8z', drug: 'Insulin mimic',   indication: 'Insulin receptor kinase activator' },
    { pdb: '3kf4', drug: 'Ceftaroline',     indication: 'Penicillin-binding protein (MRSA)' },
    { pdb: '4lde', drug: 'Oxamate',         indication: 'Lactate dehydrogenase inhibitor' },
    { pdb: '1g9v', drug: 'Glutathione',     indication: 'GST conjugation substrate' },
    { pdb: '2pgh', drug: 'Flurbiprofen',    indication: 'COX-1/2 NSAID (inflammation)' },
    { pdb: '1cbs', drug: 'Retinoic acid',   indication: 'Cellular retinoic acid binding' },
    { pdb: '1tup', drug: 'DNA fragment',    indication: 'p53 tumor suppressor–DNA complex' },
    { pdb: '4hhb', drug: 'Oxygen (O₂)',     indication: 'Hemoglobin oxygen transport' },
    { pdb: '1mbn', drug: 'Oxygen (O₂)',     indication: 'Myoglobin oxygen storage' },
    { pdb: '1lyz', drug: 'NAG trimer',      indication: 'Lysozyme substrate binding' },
    { pdb: '1brs', drug: 'Barstar',         indication: 'Barnase–Barstar protein interaction' },
    { pdb: '3pth', drug: 'Phosphoramidon',  indication: 'Thermolysin metalloprotease inhibitor' },
    { pdb: '1crn', drug: 'Crambin',         indication: 'Plant seed protein (docking benchmark)' },
    { pdb: '1bna', drug: 'B-DNA',           indication: 'Canonical DNA dodecamer' },
    { pdb: '1gpn', drug: 'GPN tripeptide',  indication: 'Loop conformation benchmark' },
    { pdb: '1a2b', drug: 'Deoxy-Hb',        indication: 'T-state hemoglobin (allosteric)' },
  ];

  function getTodaysDrug() {
    const now = new Date();
    const dayOfYear = Math.floor((now - new Date(now.getFullYear(),0,0)) / 86400000);
    return drugOfTheDay[dayOfYear % drugOfTheDay.length];
  }

  function initMolstar() {
    if (typeof molstar === 'undefined') return;

    const viewerEl = document.getElementById('molstar-viewer');
    if (!viewerEl) return;

    const drug = getTodaysDrug();

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
    }).then(viewer => {
      // Set transparent background so hero bg color shows through
      try {
        if (viewer.plugin.canvas3d) {
          viewer.plugin.canvas3d.setProps({
            renderer: { backgroundColor: 0x000000 },
            transparentBackground: true
          });
        }
      } catch(e) { /* ignore */ }

      viewer.loadPdb(drug.pdb);

      // Enable auto-rotate once loaded
      setTimeout(() => {
        try {
          if (viewer.plugin.canvas3d) {
            viewer.plugin.canvas3d.setProps({
              trackball: { animate: { name: 'spin', params: { speed: 0.5 } } }
            });
          }
        } catch(e) { /* WebGL may not be available in headless environments */ }
      }, 2500);
    }).catch(() => { /* Mol* init failed silently — hero stays clean */ });

    // Show drug of the day label
    const drugLabel = document.getElementById('drug-of-day-label');
    if (drugLabel) {
      drugLabel.innerHTML = '<strong>' + drug.drug + '</strong> <span class="drug-indication">' + drug.indication + '</span>';
    }
  }

  if (document.readyState === 'complete') {
    setTimeout(initMolstar, 300);
  } else {
    window.addEventListener('load', () => setTimeout(initMolstar, 300));
  }

  /* --- Smooth Scroll for Nav Links --- */
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (href === '#') return;
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  /* --- Interactive Demo Canvas --- */
  var demoCanvas = document.getElementById('demo-canvas');
  if (demoCanvas) {
    var dctx = demoCanvas.getContext('2d');
    var demoState = {
      isBound: false,
      isFlexaidsMode: false,
      atoms: [],
      history: [],
      animId: null,
      visible: false
    };

    var entropyValueEl = document.getElementById('entropy-value');
    var tdsValueEl = document.getElementById('tds-value');
    var demoStatusEl = document.getElementById('demo-status');
    var modeTraditionalBtn = document.getElementById('mode-traditional');
    var modeFlexaidsBtn = document.getElementById('mode-flexaids');

    function resizeDemoCanvas() {
      var w = demoCanvas.parentElement.offsetWidth;
      demoCanvas.width = Math.min(w * 0.95, 650);
      demoCanvas.height = demoCanvas.width * 0.75;
      initDemoAtoms();
    }

    function initDemoAtoms() {
      demoState.atoms = [];
      var cw = demoCanvas.width;
      var ch = demoCanvas.height;
      demoState.atoms.push({ x: cw/2, y: ch/2, r: cw/5.5, color: 'receptor', entropy: 0.25 });
      var n = 15;
      for (var i = 0; i < n; i++) {
        var angle = (i / n) * Math.PI * 2;
        var dist = cw/4 + Math.random() * cw/9;
        demoState.atoms.push({
          x: cw/2 + Math.cos(angle) * dist,
          y: ch/2 + Math.sin(angle) * dist,
          r: 10 + Math.random() * 12,
          color: 'ligand',
          entropy: 1.8 + Math.random() * 1.6
        });
      }
    }

    function computeDemoEntropy() {
      var h = demoState.history;
      if (h.length < 10) return 0;
      var bins = [0,0,0,0,0];
      for (var i = 0; i < h.length; i++) {
        var bin = Math.min(Math.floor(h[i] / 18), 4);
        bins[bin]++;
      }
      var total = h.length;
      var ent = 0;
      for (var j = 0; j < 5; j++) {
        if (bins[j] > 0) {
          var p = bins[j] / total;
          ent -= p * Math.log2(p);
        }
      }
      return ent;
    }

    function animateDemo() {
      if (!demoState.visible) return;
      var cw = demoCanvas.width;
      var ch = demoCanvas.height;
      dctx.clearRect(0, 0, cw, ch);

      var cs = getComputedStyle(root);
      var accentColor = cs.getPropertyValue('--color-accent').trim() || '#D4569E';
      var receptorColor = cs.getPropertyValue('--color-text-faint').trim() || '#7A7294';
      var textColor = cs.getPropertyValue('--color-text-muted').trim() || '#B5AEC8';

      var entropyFactor = demoState.isFlexaidsMode ? 1.0 : 0.25;
      var vibrationScale = demoState.isBound ? 0.08 : 1.0;

      var totalAmp = 0;
      var time = Date.now() * 0.001;

      for (var i = 0; i < demoState.atoms.length; i++) {
        var atom = demoState.atoms[i];
        var eff = atom.entropy * entropyFactor * vibrationScale;
        var ox = Math.sin(time * eff * 2.5) * 14 * eff;
        var oy = Math.cos(time * eff * 2.5 + 1.05) * 14 * eff;
        var amp = Math.sqrt(ox*ox + oy*oy);
        totalAmp += amp;

        dctx.fillStyle = atom.color === 'ligand' ? accentColor : receptorColor;
        dctx.globalAlpha = atom.color === 'receptor' ? 0.5 : 0.85;
        dctx.beginPath();
        dctx.arc(atom.x + ox, atom.y + oy, atom.r, 0, Math.PI * 2);
        dctx.fill();

        if (atom.color === 'ligand') {
          dctx.globalAlpha = demoState.isBound ? 0.06 : 0.2;
          dctx.strokeStyle = accentColor;
          dctx.lineWidth = 3;
          dctx.beginPath();
          dctx.moveTo(cw/2, ch/2);
          dctx.lineTo(atom.x + ox, atom.y + oy);
          dctx.stroke();
        }
      }
      dctx.globalAlpha = 1;

      var avgAmp = totalAmp / (demoState.atoms.length - 1);
      demoState.history.push(avgAmp);
      if (demoState.history.length > 50) demoState.history.shift();

      var shannon = computeDemoEntropy();
      if (entropyValueEl) entropyValueEl.textContent = shannon.toFixed(2);
      if (tdsValueEl) tdsValueEl.textContent = (shannon * 0.6 * (demoState.isBound ? -1 : 1)).toFixed(2);

      dctx.fillStyle = textColor;
      dctx.font = '14px "JetBrains Mono", monospace';
      dctx.textAlign = 'center';
      dctx.fillText('Rigid pocket \u2014 low \u0394S', cw/2, 50);
      dctx.fillText('Flexible ligand \u2014 high \u0394S chaos', cw/2, ch - 30);

      demoState.animId = requestAnimationFrame(animateDemo);
    }

    function updateDemoStatus() {
      if (!demoStatusEl) return;
      var state = demoState.isBound ? 'Bound' : 'Unbound';
      var mode = demoState.isFlexaidsMode ? 'FlexAID\u0394S' : 'Traditional (\u0394G \u2248 \u0394H)';
      demoStatusEl.textContent = 'State: ' + state + ' \u2022 ' + mode;
    }

    resizeDemoCanvas();
    updateDemoStatus();

    var demoObserver = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        demoState.visible = entry.isIntersecting;
        if (entry.isIntersecting && !demoState.animId) {
          animateDemo();
        }
      });
    }, { threshold: 0.1 });
    demoObserver.observe(demoCanvas);

    demoCanvas.addEventListener('click', function() {
      demoState.isBound = !demoState.isBound;
      updateDemoStatus();
    });

    if (modeTraditionalBtn) {
      modeTraditionalBtn.addEventListener('click', function() {
        demoState.isFlexaidsMode = false;
        modeTraditionalBtn.classList.add('active');
        if (modeFlexaidsBtn) modeFlexaidsBtn.classList.remove('active');
        updateDemoStatus();
      });
    }

    if (modeFlexaidsBtn) {
      modeFlexaidsBtn.addEventListener('click', function() {
        demoState.isFlexaidsMode = true;
        modeFlexaidsBtn.classList.add('active');
        if (modeTraditionalBtn) modeTraditionalBtn.classList.remove('active');
        updateDemoStatus();
      });
    }

    window.addEventListener('resize', function() {
      resizeDemoCanvas();
    });
  }

})();
