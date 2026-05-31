// Le Bonhomme Pharma — shared primitives.
// Loaded as text/babel; components export to window for cross-file use.

const { useState, useEffect, useRef } = React;

// ─── Animated conformational-ensemble brand mark (mounts the vanilla engine) ───
function LogoMark({ size = 132, poses = 6, fan = 58, period = 7.2, well = true, className }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !window.mountFlexLogo) return;
    const h = window.mountFlexLogo(ref.current, { size, poses, fan, period, well });
    return () => { h && h.destroy && h.destroy(); };
  }, [size, poses, fan, period, well]);
  return <span ref={ref} className={className} style={{ display: "inline-flex", lineHeight: 0 }} aria-hidden="true" />;
}

// ─── Sticky nav ───
function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const jump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <nav className="nav" style={scrolled ? { background: "rgba(10,14,20,0.92)" } : null}>
      <div className="nav-inner">
        <a className="nav-brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <LogoMark size={28} poses={4} fan={54} period={6} well={false} />
          <span className="brandword">Le Bonhomme <span className="accent">Pharma</span></span>
        </a>
        <div className="nav-links">
          <a className="hide-sm" onClick={() => jump("manifesto")}>Mission</a>
          <a className="hide-sm" onClick={() => jump("work")}>Work</a>
          <a className="hide-sm" onClick={() => jump("principles")}>Approach</a>
          <a className="hide-sm" onClick={() => jump("connect")}>Connect</a>
          <a className="pill" href="../FlexAIDdS/index.html">FlexAID∆S →</a>
        </div>
      </div>
    </nav>
  );
}

// ─── Particle drift canvas behind hero ───
function ParticleCanvas() {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    const palette = ["#22D3EE", "#A78BFA", "#FBBF24"];
    let particles = [];
    let raf = 0;
    const resize = () => {
      c.width = c.offsetWidth;
      c.height = c.offsetHeight;
      const n = Math.min(64, Math.floor(c.width * c.height / 20000));
      particles = Array.from({ length: n }, () => ({
        x: Math.random() * c.width, y: Math.random() * c.height,
        vx: (Math.random() - 0.5) * 0.22, vy: (Math.random() - 0.5) * 0.22,
        r: 0.7 + Math.random() * 1.5,
        col: palette[(Math.random() * 3) | 0],
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
        const a = 0.16 + 0.1 * Math.sin(t * 0.8 + p.phase);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.col;
        ctx.globalAlpha = a;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(step);
    };
    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={ref} className="particle-canvas" aria-hidden="true" />;
}

// ─── Reveal-on-scroll wrapper ───
function Reveal({ children, className = "" }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setShown(true); obs.disconnect(); }
    }, { threshold: 0.15 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div ref={ref} className={className}
         style={{ opacity: shown ? 1 : 0, transform: shown ? "translateY(0)" : "translateY(24px)", transition: "opacity 0.7s var(--ease-out), transform 0.7s var(--ease-out)" }}>
      {children}
    </div>
  );
}

Object.assign(window, { LogoMark, Nav, ParticleCanvas, Reveal });
