// Le Bonhomme Pharma — parent brand page
// Self-contained: no external component bundle needed.
// Requires: React 18 UMD, ReactDOM 18 UMD, assets/flexaid-logo.js
const { useState: useS, useEffect: useE, useRef: useR } = React;

/* ── Inlined design system components ── */

function BrandMark({ size = 48, poses = 6, fan = 58, period = 7, well = true }) {
  const ref = useR(null);
  const handle = useR(null);
  useE(() => {
    if (!ref.current) return;
    const mount = window.mountFlexLogo;
    if (!mount) return;
    handle.current = mount(ref.current, { size, poses, fan, period, well });
    return () => { if (handle.current && handle.current.destroy) handle.current.destroy(); };
  }, [size, poses, fan, period, well]);
  return <div ref={ref} style={{ display: 'inline-block', lineHeight: 0 }} />;
}

function Button({ children, variant = 'primary', href, onClick, style = {} }) {
  const [hov, setHov] = useS(false);
  const base = {
    fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 600,
    whiteSpace: 'nowrap', padding: '11px 22px', borderRadius: 'var(--r-md)',
    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px',
    border: '1px solid transparent',
    transition: 'all 0.18s cubic-bezier(0.16,1,0.3,1)',
    transform: hov ? 'translateY(-1px)' : 'none', ...style,
  };
  const v = {
    primary: { background: hov ? '#67E8F9' : '#22D3EE', color: '#0a0e14', boxShadow: hov ? '0 0 24px rgba(34,211,238,0.5)' : '0 0 18px rgba(34,211,238,0.3)' },
    outline: { background: 'transparent', color: hov ? '#22D3EE' : '#d4dced', borderColor: hov ? '#22D3EE' : 'rgba(34,211,238,0.2)' },
  };
  const props = { style: { ...base, ...(v[variant] || v.primary) }, onMouseEnter: () => setHov(true), onMouseLeave: () => setHov(false), onClick };
  if (href) return <a href={href} {...props}>{children}</a>;
  return <button type="button" {...props}>{children}</button>;
}

function Card({ children, tint = 'teal', style = {}, className = '' }) {
  const [hov, setHov] = useS(false);
  const borders = {
    teal:  { r: 'rgba(34,211,238,0.12)',  h: 'rgba(34,211,238,0.40)',  g: '0 0 24px rgba(34,211,238,0.10)' },
    terra: { r: 'rgba(167,139,250,0.12)', h: 'rgba(167,139,250,0.35)', g: '0 0 20px rgba(167,139,250,0.10)' },
    gold:  { r: 'rgba(251,191,36,0.12)',  h: 'rgba(251,191,36,0.35)',  g: '0 0 20px rgba(251,191,36,0.10)' },
  };
  const b = borders[tint] || borders.teal;
  return (
    <div className={className}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        background: 'rgba(16,20,28,0.80)', border: '1px solid ' + (hov ? b.h : b.r),
        borderRadius: '22px', padding: '1.5rem',
        boxShadow: hov ? '0 14px 40px rgba(0,0,0,.4), ' + b.g : 'none',
        transform: hov ? 'translateY(-4px)' : 'none',
        transition: 'transform 0.25s cubic-bezier(0.16,1,0.3,1), border-color 0.25s, box-shadow 0.25s',
        ...style,
      }}>
      {children}
    </div>
  );
}

function Tag({ children }) {
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', padding: '4px 10px', borderRadius: '14px', border: '1px solid rgba(34,211,238,0.12)', color: 'var(--fg-muted)', background: 'rgba(16,20,28,0.6)', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

/* ── Page components ── */

function ParticleCanvas() {
  const ref = useR(null);
  useE(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d');
    const palette = ['#22D3EE', '#A78BFA', '#FBBF24'];
    let particles = [], raf = 0;
    const resize = () => {
      c.width = c.offsetWidth; c.height = c.offsetHeight;
      const n = Math.min(64, Math.floor(c.width * c.height / 20000));
      particles = Array.from({ length: n }, () => ({
        x: Math.random() * c.width, y: Math.random() * c.height,
        vx: (Math.random() - 0.5) * 0.22, vy: (Math.random() - 0.5) * 0.22,
        r: 0.7 + Math.random() * 1.5, col: palette[(Math.random() * 3) | 0],
        phase: Math.random() * Math.PI * 2,
      }));
    };
    const step = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      const t = performance.now() / 1000;
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = c.width; if (p.x > c.width) p.x = 0;
        if (p.y < 0) p.y = c.height; if (p.y > c.height) p.y = 0;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.col;
        ctx.globalAlpha = 0.16 + 0.1 * Math.sin(t * 0.8 + p.phase);
        ctx.fill();
      }
      ctx.globalAlpha = 1; raf = requestAnimationFrame(step);
    };
    resize(); window.addEventListener('resize', resize); raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={ref} className="particle-canvas" aria-hidden="true" />;
}

function Reveal({ children, className = '', style = {} }) {
  const ref = useR(null);
  const [shown, setShown] = useS(false);
  useE(() => {
    const el = ref.current; if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setShown(true); obs.disconnect(); }
    }, { threshold: 0.12 });
    obs.observe(el); return () => obs.disconnect();
  }, []);
  return (
    <div ref={ref} className={className}
      style={{ opacity: shown ? 1 : 0, transform: shown ? 'translateY(0)' : 'translateY(24px)', transition: 'opacity 0.7s cubic-bezier(0.16,1,0.3,1), transform 0.7s cubic-bezier(0.16,1,0.3,1)', ...style }}>
      {children}
    </div>
  );
}

const Eq = () => (
  <><span style={{ color: '#FBBF24' }}>ΔG</span><span style={{ color: '#8a93a8' }}> = </span><span style={{ color: '#22D3EE' }}>ΔH</span><span style={{ color: '#8a93a8' }}> − </span><span style={{ color: '#A78BFA' }}>TΔS</span></>
);

function Nav() {
  const jump = (id) => { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  return (
    <nav className="nav">
      <div className="nav-inner">
        <a className="nav-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} style={{ cursor: 'pointer' }}>
          <BrandMark size={28} poses={4} fan={54} period={6} well={false} />
          <span className="brandword">Le Bonhomme <span className="accent">Pharma</span></span>
        </a>
        <div className="nav-links">
          <button className="hide-sm" onClick={() => jump('manifesto')}>Mission</button>
          <button className="hide-sm" onClick={() => jump('work')}>Work</button>
          <button className="hide-sm" onClick={() => jump('principles')}>Approach</button>
          <button className="hide-sm" onClick={() => jump('connect')}>Connect</button>
          <a className="pill" href="FlexAIDdS/index.html">FlexAID∆S →</a>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <header className="lbp-hero">
      <ParticleCanvas />
      <p className="hero-eyebrow">Montréal · Petite-Bourgogne · Open Science</p>
      <div className="hero-mark"><BrandMark size={172} poses={8} fan={60} period={7.2} /></div>
      <h1><span className="le">Le Bonhomme</span><span className="pharma">Pharma</span></h1>
      <p className="hero-lede">An independent lab building <span className="kw">open-source</span> computational chemistry — where drug binding is treated as what it physically is: a <span className="kw">free-energy</span> problem.</p>
      <p className="hero-sub">We ship the tools, the benchmarks, and the math in the open. No black boxes, no fabricated scores — every number traces back to a file you can read.</p>
      <div className="hero-ctas">
        <Button variant="primary" href="FlexAIDdS/index.html">Explore FlexAID∆S</Button>
        <Button variant="outline" href="https://x.com/BonhommePharma">Follow @BonhommePharma</Button>
      </div>
      <div className="hero-equation"><Eq /></div>
    </header>
  );
}

function Manifesto() {
  return (
    <section id="manifesto" className="section manifesto">
      <div className="container narrow">
        <Reveal>
          <p className="eyebrow">// the thesis</p>
          <h2>Make <span className="grad">Entropy</span> Great Again.</h2>
          <p className="manifesto-lede">Most docking engines score <strong>enthalpy</strong> and quietly ignore <strong>entropy</strong> — then wonder why the predicted pose is wrong. Binding isn't a contact-counting contest. It's thermodynamics: a ligand trades a vast, disordered <span className="kw">conformational ensemble</span> for one ordered bound state, and the cost of that order is <span className="kw">−TΔS</span>.</p>
          <p className="manifesto-lede" style={{ marginTop: '1rem' }}>Le Bonhomme Pharma exists to put that term back where it belongs — at the center of the free-energy equation, computed from a full statistical-mechanics framework, validated against real calorimetry.</p>
          <div className="manifesto-eq"><Eq /></div>
        </Reveal>
      </div>
    </section>
  );
}

function Work() {
  return (
    <section id="work" className="section alt">
      <div className="container">
        <Reveal>
          <p className="eyebrow">// what we build</p>
          <h2>From the bench to the <span className="grad">repository</span>.</h2>
          <p style={{ color: 'var(--fg-muted)', maxWidth: '640px' }}>One shipping engine, and the open research that feeds it. Everything Apache-2.0, reproducible bit-for-bit.</p>
        </Reveal>
        <div className="work-grid">
          <Card tint="teal" className="work-card flagship" style={{ display: 'flex', flexDirection: 'column', gridRow: 'span 2' }}>
            <span className="work-status ship">Shipping · v2.0</span>
            <div style={{ marginBottom: '1.25rem' }}><BrandMark size={84} poses={7} fan={58} period={7} /></div>
            <h3>FlexAID<span className="delta">∆S</span></h3>
            <p>An entropy-driven molecular docking engine. Genetic-algorithm conformational search meets a full statistical-mechanics scoring stack — partition function, free energy, configurational entropy, Van't Hoff decomposition. Modernized FlexAID, rewritten in C++26 with Python bindings and GPU dispatch.</p>
            <div className="flagship-metrics">
              <div><div className="mv" style={{ color: '#22D3EE' }}>95.3%</div><div className="ml">Astex-85 binding mode rescue</div></div>
              <div><div className="mv" style={{ color: '#A78BFA' }}>–TΔS</div><div className="ml">Entropy term included</div></div>
              <div><div className="mv" style={{ color: '#FBBF24' }}>Open</div><div className="ml">Apache 2.0</div></div>
            </div>
            <a className="work-link" href="FlexAIDdS/index.html">Open the product page →</a>
          </Card>
          <Card tint="terra" className="work-card" style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="work-status research">Research</span>
            <h3>tENCoM Flexibility</h3>
            <p>Torsional ENCoM — a normal-mode model that lets backbone and side-chain flexibility enter scoring without exploding the search space.</p>
            <div className="work-meta"><Tag>normal modes</Tag><Tag>backbone</Tag></div>
          </Card>
          <Card tint="gold" className="work-card" style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="work-status research">Open data</span>
            <h3>Astex-85 Benchmarks</h3>
            <p>An open, reproducible benchmark suite. Same commit, same seed, same container → identical results. 95.3% binding-mode rescue on Astex Diverse 85-target cross-docking set.</p>
            <div className="work-meta"><Tag>Astex-85</Tag><Tag>cross-docking</Tag><Tag>reproducible</Tag></div>
          </Card>
        </div>
      </div>
    </section>
  );
}

function Principles() {
  const items = [
    ['01', 'teal', 'Physics first', "Free energy, not heuristics. If a score can't be traced to ΔH and −TΔS, it doesn't ship."],
    ['02', 'terra', 'Open by default', "Apache-2.0 source, public benchmarks, readable math. Science you can't inspect isn't science."],
    ['03', 'gold', 'Reproducible', 'Same commit, same seed → bit-for-bit identical results. No run is real until a file on disk proves it.'],
    ['04', 'teal', 'Honest output', 'We report what was computed and read — never an estimated number dressed up as a measurement.'],
  ];
  return (
    <section id="principles" className="section">
      <div className="container">
        <Reveal>
          <p className="eyebrow">// how we work</p>
          <h2>Four <span className="grad">non-negotiables</span>.</h2>
        </Reveal>
        <div className="principles-grid">
          {items.map(([n, tint, h, p]) => (
            <Card key={n} tint={tint} className={'principle ' + tint}>
              <div className="pn">{n}</div>
              <h4>{h}</h4>
              <p>{p}</p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

function Place() {
  return (
    <section className="section alt">
      <div className="container">
        <div className="place-wrap">
          <Reveal className="place-copy">
            <p className="eyebrow">// where</p>
            <h2 style={{ marginBottom: '1.25rem' }}>Built in <span className="grad">Little Burgundy</span>.</h2>
            <p><strong>Le Bonhomme Pharma</strong> is an independent computational-chemistry lab in Montréal's Petite-Bourgogne — the neighbourhood the name nods to. Small, open, and unaffiliated, by design.</p>
            <p>We'd rather publish a reproducible benchmark than a press release. The work lives on GitHub; the thinking lives on X. If it's good, it's open.</p>
          </Reveal>
          <Reveal className="place-card">
            <div className="pc-row"><span className="pc-k">Location</span><span className="pc-v">Montréal · QC</span></div>
            <div className="pc-row"><span className="pc-k">Focus</span><span className="pc-v teal">Entropy-aware docking</span></div>
            <div className="pc-row"><span className="pc-k">License</span><span className="pc-v">Apache 2.0</span></div>
            <div className="pc-row"><span className="pc-k">Flagship</span><span className="pc-v gold">FlexAID∆S</span></div>
            <div className="pc-row"><span className="pc-k">Stance</span><span className="pc-v">Open science</span></div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Connect() {
  return (
    <section id="connect" className="section connect">
      <div className="container">
        <Reveal>
          <p className="eyebrow">// connect</p>
          <h2>Read the <span className="grad">source</span>.</h2>
          <p className="connect-sub">The engine, the posts, the papers — all in the open. Pick a door.</p>
        </Reveal>
        <div className="connect-grid">
          <a className="connect-card" href="https://github.com/NRGlab/FlexAIDdS" target="_blank" rel="noreferrer noopener">
            <svg className="cc-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z"/></svg>
            <span className="cc-t">GitHub</span><span className="cc-d">NRGlab/FlexAIDdS</span>
          </a>
          <a className="connect-card" href="https://x.com/BonhommePharma" target="_blank" rel="noreferrer noopener">
            <svg className="cc-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 1.6h3.6l-7.9 9 9.2 12.2h-7.2l-5.6-7.4-6.4 7.4H1.4l8.4-9.6L1 1.6h7.4l5.1 6.7 5.4-6.7zm-1.3 19.4h2L7.1 3.6H5l12.6 17.4z"/></svg>
            <span className="cc-t">X / Twitter</span><span className="cc-d">@BonhommePharma</span>
          </a>
          <a className="connect-card" href="FlexAIDdS/index.html">
            <svg className="cc-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M10.5 10 6.7 16.8M13.5 10l3.8 6.8M9 12H7M17 12h-2"/></svg>
            <span className="cc-t">FlexAID∆S</span><span className="cc-d">The docking engine</span>
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-top">
          <div className="footer-brand">
            <BrandMark size={26} poses={4} fan={54} period={6.4} well={false} />
            <span className="brandword">Le Bonhomme <span className="accent">Pharma</span></span>
          </div>
          <div className="footer-links">
            <a href="FlexAIDdS/index.html">FlexAID∆S</a>
            <a href="https://github.com/NRGlab/FlexAIDdS" target="_blank" rel="noreferrer noopener">GitHub</a>
            <a href="https://x.com/BonhommePharma" target="_blank" rel="noreferrer noopener">@BonhommePharma</a>
            <a href="https://opensource.org/licenses/Apache-2.0" target="_blank" rel="noreferrer noopener">Apache 2.0</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="footer-cite">Gaudreault &amp; Najmanovich (2015). J. Chem. Inf. Model. 55(7):1323-36</div>
          <div className="footer-cite">© 2024–2026 · Le Bonhomme Pharma · Montréal (Petite-Bourgogne) · Québec · Open Source</div>
          <div className="footer-eq"><span className="gold">ΔG = ΔH − TΔS</span> · Make Entropy Great Again</div>
        </div>
      </div>
    </footer>
  );
}

function App() {
  return (<><Nav /><Hero /><Manifesto /><Work /><Principles /><Place /><Connect /><Footer /></>);
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
