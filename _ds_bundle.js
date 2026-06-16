/* @ds-bundle: {"format":3,"namespace":"FlexAIDSDesignSystem_d4748b","components":[{"name":"BrandMark","sourcePath":"components/brand/BrandMark.jsx"},{"name":"Wordmark","sourcePath":"components/brand/Wordmark.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"Tag","sourcePath":"components/core/Tag.jsx"},{"name":"FeatureCard","sourcePath":"components/data/FeatureCard.jsx"},{"name":"SectionHeader","sourcePath":"components/data/SectionHeader.jsx"},{"name":"Stat","sourcePath":"components/data/Stat.jsx"},{"name":"ThermoLedger","sourcePath":"components/data/ThermoLedger.jsx"}],"sourceHashes":{"assets/flexaid-logo.js":"105b441565a7","components/brand/BrandMark.jsx":"77eafbe237fe","components/brand/Wordmark.jsx":"c868573a415c","components/core/Badge.jsx":"99ff04d392b5","components/core/Button.jsx":"130c4dda620d","components/core/Card.jsx":"9fa65d0ed901","components/core/Tag.jsx":"65b824f47ecb","components/data/FeatureCard.jsx":"6f773eec4e21","components/data/SectionHeader.jsx":"4b6cdc92c094","components/data/Stat.jsx":"f169328d95de","components/data/ThermoLedger.jsx":"14ffd5662ca2","ui_kits/flexaidds_site/app.jsx":"25baed551dd3","ui_kits/flexaidds_site/parts.jsx":"3c4c0fdfbc5d","ui_kits/flexaidds_site/sections.jsx":"c43ff3f3fd4c","ui_kits/lebonhomme_site/app.jsx":"46eeeafcc443"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.FlexAIDSDesignSystem_d4748b = window.FlexAIDSDesignSystem_d4748b || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// assets/flexaid-logo.js
try { (() => {
/* ============================================================
   FlexAID∆S — Dynamic Brand Mark
   Le Bonhomme Pharma · Montréal

   The mark is a living conformational ensemble. A 3-atom ligand
   samples its torsional space as a fan of terra "ghost" poses
   (the −TΔS entropy term). On a slow loop the fan COLLAPSES into
   a single teal bound pose — the minimum on the binding
   free-energy surface (ΔH) — and the bound atoms flare gold at
   the instant of binding (ΔG). Then entropy is released and the
   fan breathes open again.

   ΔG = ΔH − TΔS, rendered as motion.

   Usage:
     mountFlexLogo(elementOrSelector, { size, poses, fan, period, well });
   Returns a handle: { destroy(), el }.
   ============================================================ */
(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var TEAL = "#22D3EE";
  var TERRA = "#A78BFA";
  var GOLD = "#FBBF24";

  // pivot + ligand geometry inside a 100×100 viewBox
  var PX = 50,
    PY = 52; // shared rotation pivot
  var APEX = [50, 24]; // ligand apex (top atom)
  var L = [28, 64],
    R = [72, 64]; // two arm atoms

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }
  function el(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function buildPose(strokeW, atomR) {
    var g = el("g", {
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "fill": "none",
      "stroke-width": strokeW,
      "vector-effect": "non-scaling-stroke"
    });
    var bonds = el("path", {
      d: "M " + L[0] + " " + L[1] + " L " + APEX[0] + " " + APEX[1] + " L " + R[0] + " " + R[1]
    });
    g.appendChild(bonds);
    [APEX, L, R].forEach(function (p) {
      g.appendChild(el("circle", {
        cx: p[0],
        cy: p[1],
        r: atomR
      }));
    });
    return g;
  }
  function mountFlexLogo(target, opts) {
    opts = opts || {};
    var size = opts.size || 132;
    var nGhost = opts.poses || 6; // ghost poses per side excluded center
    var fan = opts.fan != null ? opts.fan : 58; // max half-spread in degrees
    var period = (opts.period || 7.2) * 1000; // full breathe loop (ms)
    var showWell = opts.well !== false;
    var node = typeof target === "string" ? document.querySelector(target) : target;
    if (!node) return null;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var svg = el("svg", {
      viewBox: "0 0 100 100",
      width: size,
      height: size,
      role: "img",
      "aria-label": "FlexAID∆S"
    });
    svg.style.display = "block";
    svg.style.overflow = "visible";
    var defs = el("defs", {});
    // free-energy well — radial gradient behind the pivot
    var rg = el("radialGradient", {
      id: "fxWell" + Math.random().toString(36).slice(2, 7)
    });
    rg.appendChild(el("stop", {
      offset: "0%",
      "stop-color": TEAL,
      "stop-opacity": "0.22"
    }));
    rg.appendChild(el("stop", {
      offset: "55%",
      "stop-color": TEAL,
      "stop-opacity": "0.05"
    }));
    rg.appendChild(el("stop", {
      offset: "100%",
      "stop-color": TEAL,
      "stop-opacity": "0"
    }));
    defs.appendChild(rg);
    svg.appendChild(defs);

    // ---- layers ----
    var well = el("circle", {
      cx: PX,
      cy: PY,
      r: 34,
      fill: "url(#" + rg.id + ")"
    });
    if (showWell) svg.appendChild(well);

    // faint entropy arc the fan sweeps through
    var arc = el("path", {
      fill: "none",
      stroke: TERRA,
      "stroke-width": "0.6",
      "stroke-linecap": "round",
      "stroke-dasharray": "0.5 3",
      opacity: "0.30"
    });
    svg.appendChild(arc);

    // ghost poses (terra) — symmetric pairs around the bound pose
    var ghosts = [];
    var total = nGhost; // count of ghost layers each carrying a spread fraction
    for (var i = 0; i < total; i++) {
      var g = buildPose(2.0, 2.0);
      g.setAttribute("stroke", TERRA);
      var bonds = g.querySelector("path");
      bonds.setAttribute("stroke", TERRA);
      g.querySelectorAll("circle").forEach(function (c) {
        c.setAttribute("fill", TERRA);
        c.setAttribute("stroke", "none");
      });
      svg.appendChild(g);
      // spread fraction in (0,1], alternating sides
      var rank = Math.floor(i / 2) + 1;
      var side = i % 2 === 0 ? 1 : -1;
      ghosts.push({
        g: g,
        frac: rank / Math.ceil(total / 2) * side
      });
    }

    // bound pose (teal, on top) — the minimum
    var bound = buildPose(2.6, 2.6);
    bound.setAttribute("stroke", TEAL);
    bound.querySelector("path").setAttribute("stroke", TEAL);
    var boundAtoms = bound.querySelectorAll("circle");
    boundAtoms.forEach(function (c) {
      c.setAttribute("fill", TEAL);
      c.setAttribute("stroke", "none");
    });
    bound.style.transformBox = "fill-box";
    svg.appendChild(bound);
    node.appendChild(svg);
    function setArc(spreadDeg, entropy) {
      // draw an arc at radius ~ from pivot spanning ±spreadDeg through the apex radius
      var rad = Math.hypot(APEX[0] - PX, APEX[1] - PY);
      var steps = 22,
        d = "";
      for (var s = 0; s <= steps; s++) {
        var a = lerp(-spreadDeg, spreadDeg, s / steps) * Math.PI / 180;
        // apex direction is straight up from pivot
        var base = Math.atan2(APEX[1] - PY, APEX[0] - PX);
        var ang = base + a;
        var x = PX + rad * Math.cos(ang);
        var y = PY + rad * Math.sin(ang);
        d += (s === 0 ? "M " : "L ") + x.toFixed(2) + " " + y.toFixed(2) + " ";
      }
      arc.setAttribute("d", d);
      arc.setAttribute("opacity", (0.10 + entropy * 0.30).toFixed(3));
    }
    var raf = 0,
      t0 = null,
      destroyed = false;
    function frame(now) {
      if (destroyed) return;
      if (t0 == null) t0 = now;
      var t = now - t0;

      // breathe: entropy 0 (collapsed) → 1 (max fan). Asymmetric so the
      // collapse is a quick "snap" and the opening is a slow exhale.
      var phase = t % period / period; // 0..1
      var raw = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
      // bias toward staying open, with a sharp dip at the bottom
      var entropy = Math.pow(raw, 0.72);
      var collapse = 1 - entropy; // 1 at fully bound

      var curFan = fan * entropy;
      setArc(curFan, entropy);

      // wobble well + glow with collapse (binding event)
      if (showWell) {
        well.setAttribute("r", (28 + collapse * 10).toFixed(2));
        well.setAttribute("opacity", (0.5 + collapse * 0.5).toFixed(3));
      }

      // ghost poses sample the fan, jittering more when entropy is high
      for (var i = 0; i < ghosts.length; i++) {
        var gh = ghosts[i];
        var jitter = Math.sin(t / 1000 * 1.6 + i * 1.7) * 5 * entropy;
        var ang = gh.frac * curFan + jitter;
        gh.g.setAttribute("transform", "rotate(" + ang.toFixed(2) + " " + PX + " " + PY + ")");
        var fade = lerp(0.06, 0.6, entropy) * (1 - 0.28 * Math.abs(gh.frac));
        gh.g.setAttribute("opacity", fade.toFixed(3));
      }

      // bound pose: subtle breathing scale, flares gold at the collapse
      var sc = 1 + collapse * 0.06;
      bound.setAttribute("transform", "translate(" + (PX * (1 - sc)).toFixed(3) + " " + (PY * (1 - sc)).toFixed(3) + ") scale(" + sc.toFixed(3) + ")");
      var glow = 2 + collapse * 9;
      svg.style.filter = "drop-shadow(0 0 " + glow.toFixed(1) + "px rgba(34,211,238," + (0.25 + collapse * 0.45).toFixed(3) + "))";
      // atoms shift teal→gold at the binding instant
      var goldMix = clamp((collapse - 0.55) / 0.45, 0, 1);
      var atomCol = mixHex(TEAL, GOLD, goldMix);
      boundAtoms.forEach(function (c) {
        c.setAttribute("fill", atomCol);
      });
      bound.querySelector("path").setAttribute("stroke", mixHex(TEAL, GOLD, goldMix * 0.6));
      raf = requestAnimationFrame(frame);
    }
    if (reduce || opts.static) {
      // static, fully-sampled ensemble
      setArc(fan, 1);
      for (var j = 0; j < ghosts.length; j++) {
        var gj = ghosts[j];
        gj.g.setAttribute("transform", "rotate(" + gj.frac * fan + " " + PX + " " + PY + ")");
        gj.g.setAttribute("opacity", (0.34 * (1 - 0.35 * Math.abs(gj.frac))).toFixed(3));
      }
      if (showWell) {
        well.setAttribute("r", "30");
        well.setAttribute("opacity", "0.7");
      }
    } else {
      raf = requestAnimationFrame(frame);
    }
    return {
      el: svg,
      destroy: function () {
        destroyed = true;
        cancelAnimationFrame(raf);
        if (svg.parentNode) svg.parentNode.removeChild(svg);
      }
    };
  }
  function hex(n) {
    n = Math.round(clamp(n, 0, 255));
    var s = n.toString(16);
    return s.length === 1 ? "0" + s : s;
  }
  function mixHex(a, b, t) {
    var ar = parseInt(a.slice(1, 3), 16),
      ag = parseInt(a.slice(3, 5), 16),
      ab = parseInt(a.slice(5, 7), 16);
    var br = parseInt(b.slice(1, 3), 16),
      bg = parseInt(b.slice(3, 5), 16),
      bb = parseInt(b.slice(5, 7), 16);
    return "#" + hex(lerp(ar, br, t)) + hex(lerp(ag, bg, t)) + hex(lerp(ab, bb, t));
  }
  window.mountFlexLogo = mountFlexLogo;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "assets/flexaid-logo.js", error: String((e && e.message) || e) }); }

// components/brand/BrandMark.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Animated conformational-ensemble brand mark. Mounts the vanilla
 * `window.mountFlexLogo` engine (load assets/flexaid-logo.js on the page).
 * A ligand fans into terra ghost poses, collapses to a teal bound pose, and
 * flares gold at binding. Falls back to a static SVG if the engine is absent.
 */
function BrandMark({
  size = 132,
  poses = 6,
  fan = 58,
  period = 7.2,
  well = true,
  style = {},
  ...rest
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!ref.current || !window.mountFlexLogo) return;
    const h = window.mountFlexLogo(ref.current, {
      size,
      poses,
      fan,
      period,
      well
    });
    return () => {
      if (h && h.destroy) h.destroy();
    };
  }, [size, poses, fan, period, well]);
  return /*#__PURE__*/React.createElement("span", _extends({
    ref: ref,
    "aria-hidden": "true",
    style: {
      display: 'inline-flex',
      lineHeight: 0,
      ...style
    }
  }, rest));
}
Object.assign(__ds_scope, { BrandMark });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/BrandMark.jsx", error: String((e && e.message) || e) }); }

// components/brand/Wordmark.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * FlexAID∆S wordmark. Mono, teal, with the ∆S always rendered in gold.
 * Size is the font-size in px.
 */
function Wordmark({
  size = 14,
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      fontFamily: 'var(--font-mono)',
      fontWeight: 700,
      color: 'var(--teal)',
      fontSize: size + 'px',
      letterSpacing: '0.02em',
      ...style
    }
  }, rest), "FlexAID", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--gold)'
    }
  }, "\u2206S"));
}
Object.assign(__ds_scope, { Wordmark });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/Wordmark.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * FlexAID∆S badge / pill. Mono, tiny, uppercase-friendly. Tints map to the
 * brand triad plus a "ga" lighter-teal accent. Used for version chips,
 * platform tags, status markers.
 */
function Badge({
  children,
  tint = 'teal',
  style = {},
  ...rest
}) {
  const tints = {
    teal: {
      borderColor: 'var(--teal-20)',
      background: 'var(--teal-06)',
      color: 'var(--teal)'
    },
    terra: {
      borderColor: 'rgba(167,139,250,0.46)',
      background: 'var(--terra-10)',
      color: 'var(--terra)'
    },
    gold: {
      borderColor: 'rgba(251,191,36,0.46)',
      background: 'var(--gold-10)',
      color: 'var(--gold)'
    },
    ga: {
      borderColor: 'rgba(58,166,179,0.46)',
      background: 'rgba(58,166,179,0.10)',
      color: '#67E8F9'
    }
  };
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '10px',
      padding: '4px 12px',
      borderRadius: 'var(--r-xs)',
      border: '1px solid',
      whiteSpace: 'nowrap',
      letterSpacing: '0.02em',
      ...tints[tint],
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * FlexAID∆S button. Mono label, conservative radius, colored glow on the
 * primary variant. Variants: primary (teal fill), outline (teal hairline),
 * ghost (text only). Sizes: sm, md.
 */
function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon = null,
  disabled = false,
  href,
  onClick,
  style = {},
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const pad = size === 'sm' ? '8px 16px' : '11px 22px';
  const fs = size === 'sm' ? '12px' : '13px';
  const base = {
    fontFamily: 'var(--font-mono)',
    fontSize: fs,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    padding: pad,
    borderRadius: 'var(--r-md)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    border: '1px solid transparent',
    transition: 'all var(--dur-fast) var(--ease-out)',
    opacity: disabled ? 0.45 : 1,
    transform: hover && !disabled ? 'translateY(-1px)' : 'none',
    ...style
  };
  const variants = {
    primary: {
      background: hover && !disabled ? 'var(--teal-bright)' : 'var(--teal)',
      color: '#0a0e14',
      boxShadow: hover && !disabled ? 'var(--glow-teal-strong)' : 'var(--glow-teal)'
    },
    outline: {
      background: 'transparent',
      color: hover && !disabled ? 'var(--teal)' : 'var(--fg)',
      borderColor: hover && !disabled ? 'var(--teal)' : 'var(--teal-20)'
    },
    ghost: {
      background: hover && !disabled ? 'var(--teal-06)' : 'transparent',
      color: hover && !disabled ? 'var(--teal)' : 'var(--fg-muted)'
    }
  };
  const props = {
    style: {
      ...base,
      ...variants[variant]
    },
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    onClick: disabled ? undefined : onClick,
    ...rest
  };
  const inner = /*#__PURE__*/React.createElement(React.Fragment, null, icon, children);
  if (href && !disabled) {
    return /*#__PURE__*/React.createElement("a", _extends({
      href: href
    }, props), inner);
  }
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    disabled: disabled
  }, props), inner);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * FlexAID∆S surface card. Dark translucent fill, triad-tinted hairline border,
 * lifts and glows on hover. The workhorse container for features, work items,
 * and panels. Set `tint` to color the border/hover glow; `interactive` toggles
 * the hover lift.
 */
function Card({
  children,
  tint = 'teal',
  interactive = true,
  style = {},
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const borders = {
    teal: {
      rest: 'var(--teal-12)',
      hov: 'rgba(34,211,238,0.40)',
      glow: '0 0 24px rgba(34,211,238,0.10)'
    },
    terra: {
      rest: 'var(--terra-12)',
      hov: 'var(--terra-35)',
      glow: '0 0 20px rgba(167,139,250,0.10)'
    },
    gold: {
      rest: 'var(--gold-12)',
      hov: 'rgba(251,191,36,0.35)',
      glow: '0 0 20px rgba(251,191,36,0.10)'
    },
    none: {
      rest: 'var(--teal-08)',
      hov: 'var(--teal-20)',
      glow: 'none'
    }
  };
  const b = borders[tint] || borders.teal;
  const lifted = interactive && hover;
  return /*#__PURE__*/React.createElement("div", _extends({
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      background: 'var(--bg-card)',
      border: '1px solid ' + (lifted ? b.hov : b.rest),
      borderRadius: 'var(--rc-card)',
      padding: 'var(--sp-6)',
      boxShadow: lifted ? 'var(--shadow-card), ' + b.glow : 'none',
      transform: lifted ? 'translateY(-4px)' : 'none',
      transition: 'transform var(--dur-base) var(--ease-out), border-color var(--dur-base), box-shadow var(--dur-base)',
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/Tag.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * FlexAID∆S tag chip — a neutral mono chip with a soft border, used for
 * metadata keywords on cards (e.g. "normal modes", "reproducible"). Larger
 * radius than Badge, muted by default.
 */
function Tag({
  children,
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '10px',
      padding: '4px 10px',
      borderRadius: 'var(--rc-chip)',
      border: '1px solid var(--teal-12)',
      color: 'var(--fg-muted)',
      background: 'rgba(16,20,28,0.6)',
      whiteSpace: 'nowrap',
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tag.jsx", error: String((e && e.message) || e) }); }

// components/data/FeatureCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * FlexAID∆S capability card — a tinted titled card with a ›-bulleted feature
 * list. Title color + hover glow follow the tint. Composes the Card look but
 * with the contact-function arrow bullets.
 */
function FeatureCard({
  title,
  items = [],
  tint = 'teal',
  style = {},
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const tints = {
    teal: {
      border: 'var(--teal-15)',
      hov: 'rgba(34,211,238,0.40)',
      glow: '0 0 20px rgba(34,211,238,0.10)',
      title: 'var(--teal)'
    },
    terra: {
      border: 'var(--terra-12)',
      hov: 'var(--terra-35)',
      glow: '0 0 20px rgba(167,139,250,0.10)',
      title: 'var(--terra)'
    },
    gold: {
      border: 'var(--gold-12)',
      hov: 'rgba(251,191,36,0.35)',
      glow: '0 0 20px rgba(251,191,36,0.10)',
      title: 'var(--gold)'
    }
  };
  const t = tints[tint] || tints.teal;
  return /*#__PURE__*/React.createElement("div", _extends({
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      padding: 'var(--sp-5)',
      borderRadius: 'var(--r-md)',
      background: 'var(--bg-card)',
      border: '1px solid ' + (hover ? t.hov : t.border),
      boxShadow: hover ? t.glow : 'none',
      transform: hover ? 'translateY(-4px)' : 'none',
      transition: 'all var(--dur-base) var(--ease-out)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '14px',
      fontWeight: 600,
      color: t.title,
      marginBottom: '12px'
    }
  }, title), /*#__PURE__*/React.createElement("ul", {
    style: {
      listStyle: 'none',
      margin: 0,
      padding: 0
    }
  }, items.map((it, i) => /*#__PURE__*/React.createElement("li", {
    key: i,
    style: {
      fontSize: '12px',
      color: 'var(--fg-muted)',
      lineHeight: 1.6,
      padding: '4px 0',
      display: 'flex',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'rgba(34,211,238,0.45)',
      flexShrink: 0
    }
  }, "\u203A"), it))));
}
Object.assign(__ds_scope, { FeatureCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/FeatureCard.jsx", error: String((e && e.message) || e) }); }

// components/data/SectionHeader.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * FlexAID∆S section header — a terra "// eyebrow" mono label over a mono h2.
 * Standard heading lockup for marketing + docs sections.
 */
function SectionHeader({
  eyebrow,
  children,
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: style
  }, rest), eyebrow && /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '10px',
      letterSpacing: '0.20em',
      textTransform: 'uppercase',
      color: 'var(--terra)',
      marginBottom: '12px'
    }
  }, "// ", eyebrow), /*#__PURE__*/React.createElement("h2", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '1.75rem',
      fontWeight: 700,
      color: 'var(--fg)',
      margin: 0,
      lineHeight: 1.15
    }
  }, children));
}
Object.assign(__ds_scope, { SectionHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/SectionHeader.jsx", error: String((e && e.message) || e) }); }

// components/data/Stat.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * FlexAID∆S stat — a big tabular mono number over a tiny tracked label.
 * Color is usually a triad token. Used in hero stat rows and repo stats.
 */
function Stat({
  value,
  label,
  color = 'var(--teal)',
  size = 'md',
  style = {},
  ...rest
}) {
  const fs = size === 'lg' ? '2.5rem' : size === 'sm' ? '1.4rem' : '1.75rem';
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      textAlign: 'left',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: fs,
      fontWeight: 700,
      lineHeight: 1,
      color,
      fontVariantNumeric: 'tabular-nums'
    }
  }, value), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '10px',
      color: 'var(--fg-muted)',
      letterSpacing: '0.15em',
      textTransform: 'uppercase',
      marginTop: '5px'
    }
  }, label));
}
Object.assign(__ds_scope, { Stat });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Stat.jsx", error: String((e && e.message) || e) }); }

// components/data/ThermoLedger.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * FlexAID∆S thermodynamic ledger — the signature ΔG = ΔH − TΔS readout.
 * Three tabular terms in their triad colors (ΔH teal, −TΔS terra, ΔG gold),
 * with ΔG emphasized. Pass kcal/mol values. Optional `label` eyebrow.
 */
function ThermoLedger({
  dH,
  dS,
  dG,
  label = 'Binding ledger',
  units = 'kcal/mol',
  style = {},
  ...rest
}) {
  const Term = ({
    sym,
    val,
    color,
    strong
  }) => /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '4px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '11px',
      color: 'var(--fg-muted)',
      letterSpacing: '0.08em'
    }
  }, sym), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: strong ? '1.9rem' : '1.5rem',
      fontWeight: 700,
      color,
      lineHeight: 1,
      fontVariantNumeric: 'tabular-nums',
      textShadow: strong ? '0 0 18px rgba(251,191,36,0.30)' : 'none'
    }
  }, val));
  const op = s => /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '1.4rem',
      color: 'var(--fg-muted)',
      alignSelf: 'flex-end',
      paddingBottom: '2px'
    }
  }, s);
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      background: 'var(--bg-card)',
      border: '1px solid var(--teal-12)',
      borderRadius: 'var(--r-md)',
      padding: 'var(--sp-5) var(--sp-6)',
      display: 'inline-flex',
      flexDirection: 'column',
      gap: 'var(--sp-4)',
      ...style
    }
  }, rest), label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '10px',
      letterSpacing: '0.2em',
      textTransform: 'uppercase',
      color: 'var(--terra)'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: 'var(--sp-4)'
    }
  }, /*#__PURE__*/React.createElement(Term, {
    sym: "\u0394G",
    val: dG,
    color: "var(--gold)",
    strong: true
  }), op('='), /*#__PURE__*/React.createElement(Term, {
    sym: "\u0394H",
    val: dH,
    color: "var(--teal)"
  }), op('−'), /*#__PURE__*/React.createElement(Term, {
    sym: "T\u0394S",
    val: dS,
    color: "var(--terra)"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '10px',
      color: 'var(--fg-muted)',
      letterSpacing: '0.1em'
    }
  }, units));
}
Object.assign(__ds_scope, { ThermoLedger });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/ThermoLedger.jsx", error: String((e && e.message) || e) }); }

// ui_kits/flexaidds_site/app.jsx
try { (() => {
// FlexAID∆S product site — root assembly.
function App() {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Nav, null), /*#__PURE__*/React.createElement(Hero, null), /*#__PURE__*/React.createElement("div", {
    className: "section-divider"
  }), /*#__PURE__*/React.createElement(Capabilities, null), /*#__PURE__*/React.createElement(Binding, null), /*#__PURE__*/React.createElement(Install, null), /*#__PURE__*/React.createElement(Benchmarks, null), /*#__PURE__*/React.createElement(Footer, null));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/flexaidds_site/app.jsx", error: String((e && e.message) || e) }); }

// ui_kits/flexaidds_site/parts.jsx
try { (() => {
// FlexAID∆S product site — nav + hero.
// Primitives come from the design-system bundle (window.FlexAIDSDesignSystem_d4748b).
const {
  useState,
  useEffect,
  useRef
} = React;
const DS = window.FlexAIDSDesignSystem_d4748b;
function ParticleCanvas() {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    const palette = ['#22D3EE', '#A78BFA', '#FBBF24'];
    let particles = [],
      raf = 0;
    const resize = () => {
      c.width = c.offsetWidth;
      c.height = c.offsetHeight;
      const n = Math.min(70, Math.floor(c.width * c.height / 18000));
      particles = Array.from({
        length: n
      }, () => ({
        x: Math.random() * c.width,
        y: Math.random() * c.height,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        r: 0.7 + Math.random() * 1.6,
        col: palette[Math.random() * 3 | 0],
        phase: Math.random() * Math.PI * 2
      }));
    };
    const step = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      const t = performance.now() / 1000;
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = c.width;
        if (p.x > c.width) p.x = 0;
        if (p.y < 0) p.y = c.height;
        if (p.y > c.height) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.col;
        ctx.globalAlpha = 0.18 + 0.12 * Math.sin(t * 0.8 + p.phase);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(step);
    };
    resize();
    window.addEventListener('resize', resize);
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);
  return /*#__PURE__*/React.createElement("canvas", {
    ref: ref,
    className: "particle-canvas",
    "aria-hidden": "true"
  });
}
function Nav() {
  const items = ['Why', 'Features', 'Architecture', 'Install', 'Benchmarks'];
  const jump = id => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  };
  return /*#__PURE__*/React.createElement("nav", {
    className: "nav"
  }, /*#__PURE__*/React.createElement("div", {
    className: "nav-inner"
  }, /*#__PURE__*/React.createElement("a", {
    className: "nav-brand",
    onClick: () => window.scrollTo({
      top: 0,
      behavior: 'smooth'
    })
  }, /*#__PURE__*/React.createElement(DS.BrandMark, {
    size: 26,
    poses: 4,
    fan: 54,
    period: 6,
    well: false
  }), /*#__PURE__*/React.createElement(DS.Wordmark, {
    size: 14
  })), /*#__PURE__*/React.createElement("div", {
    className: "nav-links"
  }, items.map(l => /*#__PURE__*/React.createElement("button", {
    key: l,
    className: "hide-sm",
    onClick: () => jump(l.toLowerCase())
  }, l)), /*#__PURE__*/React.createElement("a", {
    className: "gh",
    href: "https://github.com/LeBonhommePharma/FlexAIDdS",
    target: "_blank",
    rel: "noreferrer noopener"
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/icon-github.svg",
    width: "16",
    height: "16",
    style: {
      filter: 'brightness(0) saturate(100%) invert(64%) sepia(8%) saturate(414%) hue-rotate(186deg)'
    },
    alt: "GitHub"
  })))));
}
const HeroDownload = /*#__PURE__*/React.createElement("svg", {
  width: "16",
  height: "16",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("path", {
  d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
}), /*#__PURE__*/React.createElement("polyline", {
  points: "7 10 12 15 17 10"
}), /*#__PURE__*/React.createElement("line", {
  x1: "12",
  y1: "15",
  x2: "12",
  y2: "3"
}));
function Hero() {
  const jump = id => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({
      behavior: 'smooth'
    });
  };
  return /*#__PURE__*/React.createElement("section", {
    id: "hero",
    className: "hero"
  }, /*#__PURE__*/React.createElement(ParticleCanvas, null), /*#__PURE__*/React.createElement("div", {
    className: "hero-content"
  }, /*#__PURE__*/React.createElement("p", {
    className: "hero-tagline-top"
  }, "Le Bonhomme Pharma \xB7 Montr\xE9al \xB7 ", /*#__PURE__*/React.createElement("span", {
    className: "kw"
  }, "Open Science")), /*#__PURE__*/React.createElement("div", {
    className: "hero-mark"
  }, /*#__PURE__*/React.createElement(DS.BrandMark, {
    size: 184,
    poses: 8,
    fan: 60,
    period: 7.2
  })), /*#__PURE__*/React.createElement("h1", {
    className: "hero-title"
  }, "FlexAID", /*#__PURE__*/React.createElement("span", {
    className: "gold"
  }, "\u2206S")), /*#__PURE__*/React.createElement("p", {
    className: "hero-subtitle"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kw"
  }, "Entropy-Driven"), " ", /*#__PURE__*/React.createElement("span", {
    className: "kw"
  }, "Molecular Docking"), " Engine"), /*#__PURE__*/React.createElement("p", {
    className: "hero-tagline"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kw"
  }, "Genetic algorithms"), " meet ", /*#__PURE__*/React.createElement("span", {
    className: "kw"
  }, "statistical mechanics"), " for real-world drug discovery"), /*#__PURE__*/React.createElement("div", {
    className: "equation"
  }, /*#__PURE__*/React.createElement("p", {
    className: "equation-text"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#FBBF24'
    }
  }, "\u0394G"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#8a93a8'
    }
  }, " = "), /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#22D3EE'
    }
  }, "\u0394H"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#8a93a8'
    }
  }, " \u2212 "), /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#A78BFA'
    }
  }, "T\u0394S"))), /*#__PURE__*/React.createElement("div", {
    className: "hero-stats"
  }, /*#__PURE__*/React.createElement(DS.Stat, {
    value: "0.93",
    label: "Pearson r \xB7 ITC-187 \xB7 prelim.",
    color: "#22D3EE",
    size: "lg",
    style: {
      textAlign: 'center'
    }
  }), /*#__PURE__*/React.createElement(DS.Stat, {
    value: "1.4",
    label: "RMSE kcal/mol \xB7 prelim.",
    color: "#A78BFA",
    size: "lg",
    style: {
      textAlign: 'center'
    }
  }), /*#__PURE__*/React.createElement(DS.Stat, {
    value: "92%",
    label: "Binding mode \xB7 prelim.",
    color: "#FBBF24",
    size: "lg",
    style: {
      textAlign: 'center'
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "hero-badges"
  }, /*#__PURE__*/React.createElement(DS.Badge, {
    tint: "teal"
  }, "Apache 2.0"), /*#__PURE__*/React.createElement(DS.Badge, {
    tint: "ga"
  }, "C++26"), /*#__PURE__*/React.createElement(DS.Badge, {
    tint: "terra"
  }, "Python \u2265 3.9"), /*#__PURE__*/React.createElement(DS.Badge, {
    tint: "gold"
  }, "Linux \xB7 macOS \xB7 Windows")), /*#__PURE__*/React.createElement("div", {
    className: "hero-ctas"
  }, /*#__PURE__*/React.createElement(DS.Button, {
    variant: "primary",
    icon: HeroDownload,
    onClick: () => jump('install')
  }, "Get Started"), /*#__PURE__*/React.createElement(DS.Button, {
    variant: "outline",
    href: "https://github.com/LeBonhommePharma/FlexAIDdS"
  }, "View on GitHub"))));
}
Object.assign(window, {
  ParticleCanvas,
  Nav,
  Hero
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/flexaidds_site/parts.jsx", error: String((e && e.message) || e) }); }

// ui_kits/flexaidds_site/sections.jsx
try { (() => {
// FlexAID∆S product site — content sections.
const {
  useState: useStateS
} = React;
const DSx = window.FlexAIDSDesignSystem_d4748b;
function Capabilities() {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("section", {
    id: "why",
    className: "section"
  }, /*#__PURE__*/React.createElement("div", {
    className: "container"
  }, /*#__PURE__*/React.createElement(DSx.SectionHeader, {
    eyebrow: "why flexaid\u2206s"
  }, "Why ", /*#__PURE__*/React.createElement("span", {
    className: "gradient-tg"
  }, "FlexAID\u2206S")), /*#__PURE__*/React.createElement("div", {
    className: "note-callout"
  }, "Most ", /*#__PURE__*/React.createElement("span", {
    className: "kw"
  }, "docking engines"), " optimize ", /*#__PURE__*/React.createElement("span", {
    className: "kw"
  }, "enthalpy"), " alone. ", /*#__PURE__*/React.createElement("strong", null, "FlexAID\u2206S"), " adds ", /*#__PURE__*/React.createElement("span", {
    className: "kw"
  }, "conformational entropy"), " via a full ", /*#__PURE__*/React.createElement("span", {
    className: "kw"
  }, "statistical mechanics framework"), " \u2014 recovering the correct binding mode ", /*#__PURE__*/React.createElement("strong", null, "92% of the time"), " when enthalpy-only scoring fails."))), /*#__PURE__*/React.createElement("section", {
    id: "features",
    className: "section alt"
  }, /*#__PURE__*/React.createElement("div", {
    className: "container"
  }, /*#__PURE__*/React.createElement(DSx.SectionHeader, {
    eyebrow: "capabilities"
  }, "Capabilities ", /*#__PURE__*/React.createElement("span", {
    className: "gradient-rg"
  }, "Grid")), /*#__PURE__*/React.createElement("div", {
    className: "features-grid"
  }, /*#__PURE__*/React.createElement(DSx.FeatureCard, {
    tint: "teal",
    title: "Docking Engine",
    items: ['Genetic algorithm with configurable population, crossover, mutation', 'Voronoi contact function (CF) for shape complementarity', 'Dead-end elimination (DEE) torsion pruning', 'Zero-copy batch scoring via VoronoiCFBatch + OpenMP']
  }), /*#__PURE__*/React.createElement(DSx.FeatureCard, {
    tint: "terra",
    title: "Thermodynamics",
    items: ['Partition function, free energy, entropy', 'Shannon entropy + torsional vibrational entropy', 'Torsional ENCoM (tENCoM) backbone flexibility', "Van't Hoff decomposition with ΔCp correction"]
  }), /*#__PURE__*/React.createElement(DSx.FeatureCard, {
    tint: "gold",
    title: "Hardware Acceleration",
    items: ['Unified dispatch: CUDA > Metal > AVX-512 > AVX2 > OpenMP', 'SIMD primitives for geometric computations', 'Ultra-fast HPC binaries with LTO + -march=native', 'Automatic cavity detection (SURFNET + Metal GPU)']
  })))), /*#__PURE__*/React.createElement("section", {
    id: "architecture",
    className: "section"
  }, /*#__PURE__*/React.createElement("div", {
    className: "container"
  }, /*#__PURE__*/React.createElement(DSx.SectionHeader, {
    eyebrow: "pipeline"
  }, "Architecture ", /*#__PURE__*/React.createElement("span", {
    className: "t-gold"
  }, "Pipeline")), /*#__PURE__*/React.createElement("div", {
    className: "arch-pipeline"
  }, /*#__PURE__*/React.createElement(ArchStep, {
    num: "1",
    title: "Input",
    color: "teal",
    desc: "PDB receptor + MOL2 ligand. Automatic cavity detection via SURFNET."
  }), /*#__PURE__*/React.createElement(ArchStep, {
    num: "2",
    title: "Sample",
    color: "terra",
    desc: "GA + DEE torsion pruning. Ring conformer + chirality sampling."
  }), /*#__PURE__*/React.createElement(ArchStep, {
    num: "3",
    title: "Score",
    color: "gold",
    desc: "Voronoi CF + \u0394S_config via partition function. Free energy F = \u2212kT ln Z."
  }), /*#__PURE__*/React.createElement(ArchStep, {
    num: "4",
    title: "Output",
    color: "teal",
    desc: "Ranked poses \xB7 \u0394G \xB7 Van't Hoff decomposition \xB7 ITC-validated."
  })), /*#__PURE__*/React.createElement("div", {
    className: "modules-grid"
  }, [['tENCoM', 'Torsional ENCoM backbone normal-mode flexibility'], ['ShannonThermoStack', 'Shannon-entropy thermodynamic scoring stack'], ['LigandRingFlex', 'Non-aromatic ring conformer + sugar pucker sampling'], ['ChiralCenter', 'Explicit R/S stereocenter discrimination'], ['CavityDetect', 'SURFNET-based automatic binding-site detection'], ['NATURaL', 'Co-translational & co-transcriptional assembly']].map(([n, d]) => /*#__PURE__*/React.createElement("div", {
    key: n,
    className: "module-chip"
  }, /*#__PURE__*/React.createElement("div", {
    className: "module-name"
  }, n), /*#__PURE__*/React.createElement("div", {
    className: "module-desc"
  }, d)))))));
}
function ArchStep({
  num,
  title,
  desc,
  color
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "arch-step"
  }, /*#__PURE__*/React.createElement("div", {
    className: "arch-step-num"
  }, "Step ", num), /*#__PURE__*/React.createElement("div", {
    className: "arch-step-title",
    style: {
      color: 'var(--' + color + ')'
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    className: "arch-step-desc"
  }, desc), /*#__PURE__*/React.createElement("span", {
    className: "arch-arrow"
  }, "\u2192"));
}
function Binding() {
  const [phase, setPhase] = useStateS(0);
  const phases = [{
    lbl: 'Diffusion',
    bg: 'rgba(167,139,250,0.05)',
    border: 'rgba(167,139,250,0.3)',
    dh: '0.0',
    ds: '−8.5',
    dg: '+8.5',
    desc: /*#__PURE__*/React.createElement(React.Fragment, null, "Drug molecules explore ", /*#__PURE__*/React.createElement("span", {
      className: "kw"
    }, "conformational space"), " freely. High ", /*#__PURE__*/React.createElement("span", {
      className: "kw"
    }, "Shannon entropy"), " reflects many accessible microstates.")
  }, {
    lbl: 'Encounter',
    bg: 'rgba(34,211,238,0.05)',
    border: 'rgba(34,211,238,0.3)',
    dh: '−3.1',
    ds: '−4.2',
    dg: '+1.1',
    desc: /*#__PURE__*/React.createElement(React.Fragment, null, "The ligand ", /*#__PURE__*/React.createElement("span", {
      className: "kw"
    }, "electrostatically encounters"), " the binding pocket. Translational entropy begins to drop as orientation locks.")
  }, {
    lbl: 'Binding',
    bg: 'rgba(251,191,36,0.05)',
    border: 'rgba(251,191,36,0.3)',
    dh: '−12.8',
    ds: '−5.4',
    dg: '−7.4',
    desc: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
      className: "kw"
    }, "Configurational entropy collapses"), " as the ligand locks into the bound pose. Enthalpic interactions dominate \u0394G.")
  }];
  const p = phases[phase];
  const positions = phase === 0 ? [{
    x: 160,
    y: 60,
    r: 14
  }, {
    x: 340,
    y: 90,
    r: 20
  }, {
    x: 540,
    y: 55,
    r: 11
  }, {
    x: 700,
    y: 120,
    r: 25
  }, {
    x: 480,
    y: 170,
    r: 8
  }] : phase === 1 ? [{
    x: 220,
    y: 130,
    r: 14
  }, {
    x: 330,
    y: 140,
    r: 18
  }, {
    x: 430,
    y: 130,
    r: 20
  }, {
    x: 520,
    y: 145,
    r: 14
  }] : [{
    x: 450,
    y: 140,
    r: 18
  }];
  return /*#__PURE__*/React.createElement("section", {
    id: "binding",
    className: "section alt"
  }, /*#__PURE__*/React.createElement("div", {
    className: "container",
    style: {
      maxWidth: '960px'
    }
  }, /*#__PURE__*/React.createElement(DSx.SectionHeader, {
    eyebrow: "the binding process"
  }, "Drug-Receptor ", /*#__PURE__*/React.createElement("span", {
    className: "gradient-rg"
  }, "Binding")), /*#__PURE__*/React.createElement("p", {
    className: "binding-blurb"
  }, "Watch ", /*#__PURE__*/React.createElement("span", {
    className: "kw"
  }, "entropy collapse"), " in real-time as a drug molecule navigates from ", /*#__PURE__*/React.createElement("span", {
    className: "kw"
  }, "chaotic diffusion"), " through ", /*#__PURE__*/React.createElement("span", {
    className: "kw"
  }, "electrostatic encounter"), " to the ", /*#__PURE__*/React.createElement("span", {
    className: "kw"
  }, "bound state"), "."), /*#__PURE__*/React.createElement("div", {
    style: {
      borderRadius: '8px',
      border: '1px solid var(--teal-20)',
      background: 'rgba(10,14,20,0.8)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 960 240",
    style: {
      display: 'block',
      width: '100%',
      height: '240px'
    }
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("radialGradient", {
    id: "pg",
    cx: "50%",
    cy: "50%"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0%",
    stopColor: "#22D3EE",
    stopOpacity: "0.18"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "100%",
    stopColor: "#22D3EE",
    stopOpacity: "0"
  }))), /*#__PURE__*/React.createElement("ellipse", {
    cx: "450",
    cy: "140",
    rx: "90",
    ry: "40",
    fill: "url(#pg)",
    stroke: "#22D3EE",
    strokeOpacity: "0.3",
    strokeWidth: "1",
    strokeDasharray: "3 3"
  }), positions.map((pos, i) => {
    const isLast = i === positions.length - 1;
    const c = phase === 0 ? '#A78BFA' : phase === 1 ? '#22D3EE' : '#FBBF24';
    return /*#__PURE__*/React.createElement("g", {
      key: i,
      opacity: isLast ? 1 : 0.5
    }, /*#__PURE__*/React.createElement("circle", {
      cx: pos.x,
      cy: pos.y,
      r: pos.r,
      fill: c,
      fillOpacity: isLast ? 0.18 : 0.10
    }), /*#__PURE__*/React.createElement("g", {
      transform: `translate(${pos.x}, ${pos.y}) rotate(${i * 23 % 60 - 30})`
    }, /*#__PURE__*/React.createElement("path", {
      d: "M -8 5 L 0 -5 L 8 5",
      stroke: c,
      strokeWidth: "1.6",
      fill: "none",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "-8",
      cy: "5",
      r: "2",
      fill: c
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "0",
      cy: "-5",
      r: "2",
      fill: c
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "8",
      cy: "5",
      r: "2",
      fill: c
    })));
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '8px',
      flexWrap: 'wrap',
      marginTop: '1rem'
    }
  }, phases.map((ph, i) => /*#__PURE__*/React.createElement(DSx.Button, {
    key: i,
    size: "sm",
    variant: phase === i ? 'primary' : 'outline',
    onClick: () => setPhase(i)
  }, i + 1, ". ", ph.lbl))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: '1rem',
      padding: '1rem 1.25rem',
      borderRadius: '8px',
      background: p.bg,
      border: '1px solid ' + p.border,
      transition: 'all 0.5s'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: '13px',
      color: 'var(--fg-muted)',
      lineHeight: 1.6,
      maxWidth: 'none'
    }
  }, p.desc), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: '0.85rem'
    }
  }, /*#__PURE__*/React.createElement(DSx.ThermoLedger, {
    label: null,
    dH: p.dh,
    dS: p.ds,
    dG: p.dg,
    style: {
      background: 'transparent',
      border: 'none',
      padding: 0
    }
  })))));
}
function Install() {
  const [tab, setTab] = useStateS('cli');
  return /*#__PURE__*/React.createElement("section", {
    id: "install",
    className: "section"
  }, /*#__PURE__*/React.createElement("div", {
    className: "container",
    style: {
      maxWidth: '896px'
    }
  }, /*#__PURE__*/React.createElement(DSx.SectionHeader, {
    eyebrow: "get started"
  }, "Installation"), /*#__PURE__*/React.createElement("div", {
    className: "install-tabs"
  }, [['cli', 'CLI Build'], ['python', 'Python']].map(([k, l]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    className: 'install-tab' + (tab === k ? ' active' : ''),
    onClick: () => setTab(k)
  }, l))), tab === 'cli' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("pre", {
    className: "code-box"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "plain"
  }, "$"), " ", /*#__PURE__*/React.createElement("span", {
    className: "cmd"
  }, "git clone"), " https://github.com/LeBonhommePharma/FlexAIDdS.git ", /*#__PURE__*/React.createElement("span", {
    className: "plain"
  }, "&& cd FlexAIDdS")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "plain"
  }, "$"), " ", /*#__PURE__*/React.createElement("span", {
    className: "cmd"
  }, "cmake"), " -S . -B build -DCMAKE_BUILD_TYPE=Release"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "plain"
  }, "$"), " ", /*#__PURE__*/React.createElement("span", {
    className: "cmd"
  }, "cmake"), " --build build --parallel")), /*#__PURE__*/React.createElement("table", {
    className: "cmake-table"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Option"), /*#__PURE__*/React.createElement("th", null, "Default"), /*#__PURE__*/React.createElement("th", null, "Description"))), /*#__PURE__*/React.createElement("tbody", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("code", null, "CMAKE_BUILD_TYPE")), /*#__PURE__*/React.createElement("td", null, "Release"), /*#__PURE__*/React.createElement("td", null, "Build type (Debug, Release, RelWithDebInfo)")), /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("code", null, "FLEXAIDS_USE_CUDA")), /*#__PURE__*/React.createElement("td", null, "OFF"), /*#__PURE__*/React.createElement("td", null, "Enable CUDA GPU acceleration")), /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("code", null, "FLEXAIDS_USE_METAL")), /*#__PURE__*/React.createElement("td", null, "OFF"), /*#__PURE__*/React.createElement("td", null, "Enable Metal GPU acceleration (macOS)")), /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("code", null, "FLEXAIDS_USE_AVX512")), /*#__PURE__*/React.createElement("td", null, "OFF"), /*#__PURE__*/React.createElement("td", null, "Enable AVX-512 SIMD")), /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("code", null, "BUILD_PYTHON_BINDINGS")), /*#__PURE__*/React.createElement("td", null, "OFF"), /*#__PURE__*/React.createElement("td", null, "Build Python bindings"))))), tab === 'python' && /*#__PURE__*/React.createElement("pre", {
    className: "code-box"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "plain"
  }, "$"), " ", /*#__PURE__*/React.createElement("span", {
    className: "cmd"
  }, "cd"), " python ", /*#__PURE__*/React.createElement("span", {
    className: "plain"
  }, "&& pip install -e .")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: '8px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "kw2"
  }, "import"), " flexaidds ", /*#__PURE__*/React.createElement("span", {
    className: "kw2"
  }, "as"), " fd"), /*#__PURE__*/React.createElement("div", null, "results = fd.", /*#__PURE__*/React.createElement("span", {
    className: "cmd"
  }, "dock"), "(receptor=", /*#__PURE__*/React.createElement("span", {
    className: "str"
  }, "'receptor.pdb'"), ", ligand=", /*#__PURE__*/React.createElement("span", {
    className: "str"
  }, "'ligand.mol2'"), ", compute_entropy=", /*#__PURE__*/React.createElement("span", {
    className: "kw2"
  }, "True"), ")"))));
}
function Benchmarks() {
  return /*#__PURE__*/React.createElement("section", {
    id: "benchmarks",
    className: "section alt"
  }, /*#__PURE__*/React.createElement("div", {
    className: "container"
  }, /*#__PURE__*/React.createElement(DSx.SectionHeader, {
    eyebrow: "reproducible benchmarks"
  }, "Benchmark ", /*#__PURE__*/React.createElement("span", {
    className: "t-gold"
  }, "Results")), /*#__PURE__*/React.createElement("p", {
    className: "binding-blurb"
  }, "Every number generated by ", /*#__PURE__*/React.createElement("span", {
    className: "kw"
  }, "automated benchmark"), " on each commit. Same commit, same container, same seed \u2192 ", /*#__PURE__*/React.createElement("span", {
    className: "kw"
  }, "bit-for-bit identical results"), "."), /*#__PURE__*/React.createElement("div", {
    className: "bench-table-wrap"
  }, /*#__PURE__*/React.createElement("table", {
    className: "bench-table"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Benchmark"), /*#__PURE__*/React.createElement("th", {
    className: "h"
  }, "FlexAID\u2206S"), /*#__PURE__*/React.createElement("th", null, "Vina"), /*#__PURE__*/React.createElement("th", null, "Glide"), /*#__PURE__*/React.createElement("th", null, "rDock"))), /*#__PURE__*/React.createElement("tbody", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", null, "ITC-187 \u0394G r"), /*#__PURE__*/React.createElement("td", {
    className: "h"
  }, "0.93"), /*#__PURE__*/React.createElement("td", null, "0.64"), /*#__PURE__*/React.createElement("td", null, "0.69"), /*#__PURE__*/React.createElement("td", null, "0.61")), /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", null, "ITC-187 RMSE"), /*#__PURE__*/React.createElement("td", {
    className: "h"
  }, "1.4"), /*#__PURE__*/React.createElement("td", null, "3.1"), /*#__PURE__*/React.createElement("td", null, "2.9"), /*#__PURE__*/React.createElement("td", null, "3.3")), /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", null, "CASF-2016 Scoring"), /*#__PURE__*/React.createElement("td", {
    className: "h"
  }, "0.88"), /*#__PURE__*/React.createElement("td", null, "0.73"), /*#__PURE__*/React.createElement("td", null, "0.78"), /*#__PURE__*/React.createElement("td", null, "0.71")), /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", null, "CNS binding mode rescue"), /*#__PURE__*/React.createElement("td", {
    className: "h"
  }, "92%"), /*#__PURE__*/React.createElement("td", null, "58%"), /*#__PURE__*/React.createElement("td", null, "64%"), /*#__PURE__*/React.createElement("td", null, "55%"))))), /*#__PURE__*/React.createElement("p", {
    className: "bench-note"
  }, "* Numbers are preliminary; final validation and bootstrap CIs in progress.")));
}
function Footer() {
  return /*#__PURE__*/React.createElement("footer", {
    className: "site-footer"
  }, /*#__PURE__*/React.createElement("div", {
    className: "footer-inner"
  }, /*#__PURE__*/React.createElement("div", {
    className: "footer-top"
  }, /*#__PURE__*/React.createElement("div", {
    className: "footer-brand"
  }, /*#__PURE__*/React.createElement(DSx.BrandMark, {
    size: 26,
    poses: 4,
    fan: 54,
    period: 6.4,
    well: false
  }), /*#__PURE__*/React.createElement(DSx.Wordmark, {
    size: 14
  })), /*#__PURE__*/React.createElement("div", {
    className: "footer-links"
  }, /*#__PURE__*/React.createElement("a", {
    href: "https://github.com/LeBonhommePharma/FlexAIDdS",
    target: "_blank",
    rel: "noreferrer noopener"
  }, "GitHub"), /*#__PURE__*/React.createElement("a", {
    href: "https://x.com/BonhommePharma",
    target: "_blank",
    rel: "noreferrer noopener"
  }, "@BonhommePharma"), /*#__PURE__*/React.createElement("a", {
    href: "https://opensource.org/licenses/Apache-2.0",
    target: "_blank",
    rel: "noreferrer noopener"
  }, "Apache 2.0"))), /*#__PURE__*/React.createElement("div", {
    className: "footer-bottom"
  }, /*#__PURE__*/React.createElement("div", {
    className: "footer-cite"
  }, "Gaudreault & Najmanovich (2015). J. Chem. Inf. Model. 55(7):1323-36"), /*#__PURE__*/React.createElement("div", {
    className: "footer-cite"
  }, "\xA9 2024\u20132026 \xB7 Le Bonhomme Pharma \xB7 Montr\xE9al (Little Burgundy) \xB7 Qu\xE9bec \xB7 Open Source"), /*#__PURE__*/React.createElement("div", {
    className: "footer-eq"
  }, /*#__PURE__*/React.createElement("span", {
    className: "gold"
  }, "H(X) = \u2212\u03A3 p(x) log p(x)"), " \xB7 Make Entropy Great Again"))));
}
Object.assign(window, {
  Capabilities,
  Binding,
  Install,
  Benchmarks,
  Footer
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/flexaidds_site/sections.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lebonhomme_site/app.jsx
try { (() => {
// Le Bonhomme Pharma — parent brand page sections.
const {
  useState: useS,
  useEffect: useE,
  useRef: useR
} = React;
const B = window.FlexAIDSDesignSystem_d4748b;
function ParticleCanvas() {
  const ref = useR(null);
  useE(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    const palette = ['#22D3EE', '#A78BFA', '#FBBF24'];
    let particles = [],
      raf = 0;
    const resize = () => {
      c.width = c.offsetWidth;
      c.height = c.offsetHeight;
      const n = Math.min(64, Math.floor(c.width * c.height / 20000));
      particles = Array.from({
        length: n
      }, () => ({
        x: Math.random() * c.width,
        y: Math.random() * c.height,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: 0.7 + Math.random() * 1.5,
        col: palette[Math.random() * 3 | 0],
        phase: Math.random() * Math.PI * 2
      }));
    };
    const step = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      const t = performance.now() / 1000;
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = c.width;
        if (p.x > c.width) p.x = 0;
        if (p.y < 0) p.y = c.height;
        if (p.y > c.height) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.col;
        ctx.globalAlpha = 0.16 + 0.1 * Math.sin(t * 0.8 + p.phase);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(step);
    };
    resize();
    window.addEventListener('resize', resize);
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);
  return /*#__PURE__*/React.createElement("canvas", {
    ref: ref,
    className: "particle-canvas",
    "aria-hidden": "true"
  });
}
function Reveal({
  children,
  className = '',
  style = {}
}) {
  const ref = useR(null);
  const [shown, setShown] = useS(false);
  useE(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setShown(true);
        obs.disconnect();
      }
    }, {
      threshold: 0.15
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    className: className,
    style: {
      opacity: shown ? 1 : 0,
      transform: shown ? 'translateY(0)' : 'translateY(24px)',
      transition: 'opacity 0.7s var(--ease-out), transform 0.7s var(--ease-out)',
      ...style
    }
  }, children);
}
const Eq = () => /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
  style: {
    color: '#FBBF24'
  }
}, "\u0394G"), /*#__PURE__*/React.createElement("span", {
  style: {
    color: '#8a93a8'
  }
}, " = "), /*#__PURE__*/React.createElement("span", {
  style: {
    color: '#22D3EE'
  }
}, "\u0394H"), /*#__PURE__*/React.createElement("span", {
  style: {
    color: '#8a93a8'
  }
}, " \u2212 "), /*#__PURE__*/React.createElement("span", {
  style: {
    color: '#A78BFA'
  }
}, "T\u0394S"));
function Nav() {
  const jump = id => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  };
  return /*#__PURE__*/React.createElement("nav", {
    className: "nav"
  }, /*#__PURE__*/React.createElement("div", {
    className: "nav-inner"
  }, /*#__PURE__*/React.createElement("a", {
    className: "nav-brand",
    onClick: () => window.scrollTo({
      top: 0,
      behavior: 'smooth'
    })
  }, /*#__PURE__*/React.createElement(B.BrandMark, {
    size: 28,
    poses: 4,
    fan: 54,
    period: 6,
    well: false
  }), /*#__PURE__*/React.createElement("span", {
    className: "brandword"
  }, "Le Bonhomme ", /*#__PURE__*/React.createElement("span", {
    className: "accent"
  }, "Pharma"))), /*#__PURE__*/React.createElement("div", {
    className: "nav-links"
  }, /*#__PURE__*/React.createElement("button", {
    className: "hide-sm",
    onClick: () => jump('manifesto')
  }, "Mission"), /*#__PURE__*/React.createElement("button", {
    className: "hide-sm",
    onClick: () => jump('work')
  }, "Work"), /*#__PURE__*/React.createElement("button", {
    className: "hide-sm",
    onClick: () => jump('principles')
  }, "Approach"), /*#__PURE__*/React.createElement("button", {
    className: "hide-sm",
    onClick: () => jump('connect')
  }, "Connect"), /*#__PURE__*/React.createElement("a", {
    className: "pill",
    href: "../flexaidds_site/index.html"
  }, "FlexAID\u2206S \u2192"))));
}
function Hero() {
  return /*#__PURE__*/React.createElement("header", {
    className: "lbp-hero"
  }, /*#__PURE__*/React.createElement(ParticleCanvas, null), /*#__PURE__*/React.createElement("p", {
    className: "hero-eyebrow"
  }, "Montr\xE9al \xB7 Petite-Bourgogne \xB7 Open Science"), /*#__PURE__*/React.createElement("div", {
    className: "hero-mark"
  }, /*#__PURE__*/React.createElement(B.BrandMark, {
    size: 172,
    poses: 8,
    fan: 60,
    period: 7.2
  })), /*#__PURE__*/React.createElement("h1", null, /*#__PURE__*/React.createElement("span", {
    className: "le"
  }, "Le Bonhomme"), /*#__PURE__*/React.createElement("span", {
    className: "pharma"
  }, "Pharma")), /*#__PURE__*/React.createElement("p", {
    className: "hero-lede"
  }, "An independent lab building ", /*#__PURE__*/React.createElement("span", {
    className: "kw"
  }, "open-source"), " computational chemistry \u2014 where drug binding is treated as what it physically is: a ", /*#__PURE__*/React.createElement("span", {
    className: "kw"
  }, "free-energy"), " problem."), /*#__PURE__*/React.createElement("p", {
    className: "hero-sub"
  }, "We ship the tools, the benchmarks, and the math in the open. No black boxes, no fabricated scores \u2014 every number traces back to a file you can read."), /*#__PURE__*/React.createElement("div", {
    className: "hero-ctas"
  }, /*#__PURE__*/React.createElement(B.Button, {
    variant: "primary",
    href: "../flexaidds_site/index.html"
  }, "Explore FlexAID\u2206S"), /*#__PURE__*/React.createElement(B.Button, {
    variant: "outline",
    href: "https://x.com/BonhommePharma"
  }, "Follow @BonhommePharma")), /*#__PURE__*/React.createElement("div", {
    className: "hero-equation"
  }, /*#__PURE__*/React.createElement(Eq, null)));
}
function Manifesto() {
  return /*#__PURE__*/React.createElement("section", {
    id: "manifesto",
    className: "section manifesto"
  }, /*#__PURE__*/React.createElement("div", {
    className: "container narrow"
  }, /*#__PURE__*/React.createElement(Reveal, null, /*#__PURE__*/React.createElement("p", {
    className: "eyebrow"
  }, "// the thesis"), /*#__PURE__*/React.createElement("h2", null, "Make ", /*#__PURE__*/React.createElement("span", {
    className: "grad"
  }, "Entropy"), " Great Again."), /*#__PURE__*/React.createElement("p", {
    className: "manifesto-lede"
  }, "Most docking engines score ", /*#__PURE__*/React.createElement("strong", null, "enthalpy"), " and quietly ignore ", /*#__PURE__*/React.createElement("strong", null, "entropy"), " \u2014 then wonder why the predicted pose is wrong. Binding isn't a contact-counting contest. It's thermodynamics: a ligand trades a vast, disordered ", /*#__PURE__*/React.createElement("span", {
    className: "kw"
  }, "conformational ensemble"), " for one ordered bound state, and the cost of that order is ", /*#__PURE__*/React.createElement("span", {
    className: "kw"
  }, "\u2212T\u0394S"), "."), /*#__PURE__*/React.createElement("p", {
    className: "manifesto-lede",
    style: {
      marginTop: '1rem'
    }
  }, "Le Bonhomme Pharma exists to put that term back where it belongs \u2014 at the center of the free-energy equation, computed from a full statistical-mechanics framework, validated against real calorimetry."), /*#__PURE__*/React.createElement("div", {
    className: "manifesto-eq"
  }, /*#__PURE__*/React.createElement(Eq, null)))));
}
function Work() {
  return /*#__PURE__*/React.createElement("section", {
    id: "work",
    className: "section alt"
  }, /*#__PURE__*/React.createElement("div", {
    className: "container"
  }, /*#__PURE__*/React.createElement(Reveal, null, /*#__PURE__*/React.createElement("p", {
    className: "eyebrow"
  }, "// what we build"), /*#__PURE__*/React.createElement("h2", null, "From the bench to the ", /*#__PURE__*/React.createElement("span", {
    className: "grad"
  }, "repository"), "."), /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--fg-muted)',
      maxWidth: '640px'
    }
  }, "One shipping engine, and the open research that feeds it. Everything Apache-2.0, reproducible bit-for-bit.")), /*#__PURE__*/React.createElement("div", {
    className: "work-grid"
  }, /*#__PURE__*/React.createElement(B.Card, {
    tint: "teal",
    className: "work-card flagship",
    style: {
      display: 'flex',
      flexDirection: 'column',
      gridRow: 'span 2'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "work-status ship"
  }, "Shipping \xB7 v2.0"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '1.25rem'
    }
  }, /*#__PURE__*/React.createElement(B.BrandMark, {
    size: 84,
    poses: 7,
    fan: 58,
    period: 7
  })), /*#__PURE__*/React.createElement("h3", null, "FlexAID", /*#__PURE__*/React.createElement("span", {
    className: "delta"
  }, "\u2206S")), /*#__PURE__*/React.createElement("p", null, "An entropy-driven molecular docking engine. Genetic-algorithm conformational search meets a full statistical-mechanics scoring stack \u2014 partition function, free energy, configurational entropy, Van't Hoff decomposition. Modernized FlexAID, rewritten in C++26 with Python bindings and GPU dispatch."), /*#__PURE__*/React.createElement("div", {
    className: "flagship-metrics"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "mv",
    style: {
      color: '#22D3EE'
    }
  }, "0.93"), /*#__PURE__*/React.createElement("div", {
    className: "ml"
  }, "Pearson r \xB7 ITC-187")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "mv",
    style: {
      color: '#A78BFA'
    }
  }, "1.4"), /*#__PURE__*/React.createElement("div", {
    className: "ml"
  }, "RMSE kcal/mol")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "mv",
    style: {
      color: '#FBBF24'
    }
  }, "92%"), /*#__PURE__*/React.createElement("div", {
    className: "ml"
  }, "Binding-mode rescue"))), /*#__PURE__*/React.createElement("a", {
    className: "work-link",
    href: "../flexaidds_site/index.html"
  }, "Open the product page \u2192")), /*#__PURE__*/React.createElement(B.Card, {
    tint: "terra",
    className: "work-card",
    style: {
      display: 'flex',
      flexDirection: 'column'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "work-status research"
  }, "Research"), /*#__PURE__*/React.createElement("h3", null, "tENCoM Flexibility"), /*#__PURE__*/React.createElement("p", null, "Torsional ENCoM \u2014 a normal-mode model that lets backbone and side-chain flexibility enter scoring without exploding the search space."), /*#__PURE__*/React.createElement("div", {
    className: "work-meta"
  }, /*#__PURE__*/React.createElement(B.Tag, null, "normal modes"), /*#__PURE__*/React.createElement(B.Tag, null, "backbone"))), /*#__PURE__*/React.createElement(B.Card, {
    tint: "gold",
    className: "work-card",
    style: {
      display: 'flex',
      flexDirection: 'column'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "work-status research"
  }, "Open data"), /*#__PURE__*/React.createElement("h3", null, "ITC-187 Benchmarks"), /*#__PURE__*/React.createElement("p", null, "An open, calorimetry-anchored benchmark suite. Same commit, same seed, same container \u2192 identical results. Receipts over claims."), /*#__PURE__*/React.createElement("div", {
    className: "work-meta"
  }, /*#__PURE__*/React.createElement(B.Tag, null, "ITC"), /*#__PURE__*/React.createElement(B.Tag, null, "CASF-2016"), /*#__PURE__*/React.createElement(B.Tag, null, "reproducible"))))));
}
function Principles() {
  const items = [['01', 'teal', 'Physics first', "Free energy, not heuristics. If a score can't be traced to ΔH and −TΔS, it doesn't ship."], ['02', 'terra', 'Open by default', "Apache-2.0 source, public benchmarks, readable math. Science you can't inspect isn't science."], ['03', 'gold', 'Reproducible', 'Same commit, same seed → bit-for-bit identical results. No run is real until a file on disk proves it.'], ['04', 'teal', 'Honest output', 'We report what was computed and read — never an estimated number dressed up as a measurement.']];
  return /*#__PURE__*/React.createElement("section", {
    id: "principles",
    className: "section"
  }, /*#__PURE__*/React.createElement("div", {
    className: "container"
  }, /*#__PURE__*/React.createElement(Reveal, null, /*#__PURE__*/React.createElement("p", {
    className: "eyebrow"
  }, "// how we work"), /*#__PURE__*/React.createElement("h2", null, "Four ", /*#__PURE__*/React.createElement("span", {
    className: "grad"
  }, "non-negotiables"), ".")), /*#__PURE__*/React.createElement("div", {
    className: "principles-grid"
  }, items.map(([n, tint, h, p]) => /*#__PURE__*/React.createElement(B.Card, {
    key: n,
    tint: tint,
    className: 'principle ' + tint
  }, /*#__PURE__*/React.createElement("div", {
    className: "pn"
  }, n), /*#__PURE__*/React.createElement("h4", null, h), /*#__PURE__*/React.createElement("p", null, p))))));
}
function Place() {
  return /*#__PURE__*/React.createElement("section", {
    className: "section alt"
  }, /*#__PURE__*/React.createElement("div", {
    className: "container"
  }, /*#__PURE__*/React.createElement("div", {
    className: "place-wrap"
  }, /*#__PURE__*/React.createElement(Reveal, {
    className: "place-copy"
  }, /*#__PURE__*/React.createElement("p", {
    className: "eyebrow"
  }, "// where"), /*#__PURE__*/React.createElement("h2", {
    style: {
      marginBottom: '1.25rem'
    }
  }, "Built in ", /*#__PURE__*/React.createElement("span", {
    className: "grad"
  }, "Little Burgundy"), "."), /*#__PURE__*/React.createElement("p", null, /*#__PURE__*/React.createElement("strong", null, "Le Bonhomme Pharma"), " is an independent computational-chemistry lab in Montr\xE9al's Petite-Bourgogne \u2014 the neighbourhood the name nods to. Small, open, and unaffiliated, by design."), /*#__PURE__*/React.createElement("p", null, "We'd rather publish a reproducible benchmark than a press release. The work lives on GitHub; the thinking lives on X. If it's good, it's open.")), /*#__PURE__*/React.createElement(Reveal, {
    className: "place-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pc-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pc-k"
  }, "Location"), /*#__PURE__*/React.createElement("span", {
    className: "pc-v"
  }, "Montr\xE9al \xB7 QC")), /*#__PURE__*/React.createElement("div", {
    className: "pc-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pc-k"
  }, "Focus"), /*#__PURE__*/React.createElement("span", {
    className: "pc-v teal"
  }, "Entropy-aware docking")), /*#__PURE__*/React.createElement("div", {
    className: "pc-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pc-k"
  }, "License"), /*#__PURE__*/React.createElement("span", {
    className: "pc-v"
  }, "Apache 2.0")), /*#__PURE__*/React.createElement("div", {
    className: "pc-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pc-k"
  }, "Flagship"), /*#__PURE__*/React.createElement("span", {
    className: "pc-v gold"
  }, "FlexAID\u2206S")), /*#__PURE__*/React.createElement("div", {
    className: "pc-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pc-k"
  }, "Stance"), /*#__PURE__*/React.createElement("span", {
    className: "pc-v"
  }, "Open science"))))));
}
function Connect() {
  return /*#__PURE__*/React.createElement("section", {
    id: "connect",
    className: "section connect"
  }, /*#__PURE__*/React.createElement("div", {
    className: "container"
  }, /*#__PURE__*/React.createElement(Reveal, null, /*#__PURE__*/React.createElement("p", {
    className: "eyebrow"
  }, "// connect"), /*#__PURE__*/React.createElement("h2", null, "Read the ", /*#__PURE__*/React.createElement("span", {
    className: "grad"
  }, "source"), "."), /*#__PURE__*/React.createElement("p", {
    className: "connect-sub"
  }, "The engine, the posts, the papers \u2014 all in the open. Pick a door.")), /*#__PURE__*/React.createElement("div", {
    className: "connect-grid"
  }, /*#__PURE__*/React.createElement("a", {
    className: "connect-card",
    href: "https://github.com/LeBonhommePharma/FlexAIDdS",
    target: "_blank",
    rel: "noreferrer noopener"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "cc-ico",
    viewBox: "0 0 24 24",
    fill: "currentColor"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z"
  })), /*#__PURE__*/React.createElement("span", {
    className: "cc-t"
  }, "GitHub"), /*#__PURE__*/React.createElement("span", {
    className: "cc-d"
  }, "LeBonhommePharma/FlexAIDdS")), /*#__PURE__*/React.createElement("a", {
    className: "connect-card",
    href: "https://x.com/BonhommePharma",
    target: "_blank",
    rel: "noreferrer noopener"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "cc-ico",
    viewBox: "0 0 24 24",
    fill: "currentColor"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18.9 1.6h3.6l-7.9 9 9.2 12.2h-7.2l-5.6-7.4-6.4 7.4H1.4l8.4-9.6L1 1.6h7.4l5.1 6.7 5.4-6.7zm-1.3 19.4h2L7.1 3.6H5l12.6 17.4z"
  })), /*#__PURE__*/React.createElement("span", {
    className: "cc-t"
  }, "X / Twitter"), /*#__PURE__*/React.createElement("span", {
    className: "cc-d"
  }, "@BonhommePharma")), /*#__PURE__*/React.createElement("a", {
    className: "connect-card",
    href: "../flexaidds_site/index.html"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "cc-ico",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "3"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "5",
    cy: "19",
    r: "2.5"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "19",
    cy: "19",
    r: "2.5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M10.5 10 6.7 16.8M13.5 10l3.8 6.8M9 12H7M17 12h-2"
  })), /*#__PURE__*/React.createElement("span", {
    className: "cc-t"
  }, "FlexAID\u2206S"), /*#__PURE__*/React.createElement("span", {
    className: "cc-d"
  }, "The docking engine")))));
}
function Footer() {
  return /*#__PURE__*/React.createElement("footer", {
    className: "site-footer"
  }, /*#__PURE__*/React.createElement("div", {
    className: "footer-inner"
  }, /*#__PURE__*/React.createElement("div", {
    className: "footer-top"
  }, /*#__PURE__*/React.createElement("div", {
    className: "footer-brand"
  }, /*#__PURE__*/React.createElement(B.BrandMark, {
    size: 26,
    poses: 4,
    fan: 54,
    period: 6.4,
    well: false
  }), /*#__PURE__*/React.createElement("span", {
    className: "brandword"
  }, "Le Bonhomme ", /*#__PURE__*/React.createElement("span", {
    className: "accent"
  }, "Pharma"))), /*#__PURE__*/React.createElement("div", {
    className: "footer-links"
  }, /*#__PURE__*/React.createElement("a", {
    href: "../flexaidds_site/index.html"
  }, "FlexAID\u2206S"), /*#__PURE__*/React.createElement("a", {
    href: "https://github.com/LeBonhommePharma/FlexAIDdS",
    target: "_blank",
    rel: "noreferrer noopener"
  }, "GitHub"), /*#__PURE__*/React.createElement("a", {
    href: "https://x.com/BonhommePharma",
    target: "_blank",
    rel: "noreferrer noopener"
  }, "@BonhommePharma"), /*#__PURE__*/React.createElement("a", {
    href: "https://opensource.org/licenses/Apache-2.0",
    target: "_blank",
    rel: "noreferrer noopener"
  }, "Apache 2.0"))), /*#__PURE__*/React.createElement("div", {
    className: "footer-bottom"
  }, /*#__PURE__*/React.createElement("div", {
    className: "footer-cite"
  }, "Gaudreault & Najmanovich (2015). J. Chem. Inf. Model. 55(7):1323-36"), /*#__PURE__*/React.createElement("div", {
    className: "footer-cite"
  }, "\xA9 2024\u20132026 \xB7 Le Bonhomme Pharma \xB7 Montr\xE9al (Petite-Bourgogne) \xB7 Qu\xE9bec \xB7 Open Source"), /*#__PURE__*/React.createElement("div", {
    className: "footer-eq"
  }, /*#__PURE__*/React.createElement("span", {
    className: "gold"
  }, "\u0394G = \u0394H \u2212 T\u0394S"), " \xB7 Make Entropy Great Again"))));
}
function App() {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Nav, null), /*#__PURE__*/React.createElement(Hero, null), /*#__PURE__*/React.createElement(Manifesto, null), /*#__PURE__*/React.createElement(Work, null), /*#__PURE__*/React.createElement(Principles, null), /*#__PURE__*/React.createElement(Place, null), /*#__PURE__*/React.createElement(Connect, null), /*#__PURE__*/React.createElement(Footer, null));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lebonhomme_site/app.jsx", error: String((e && e.message) || e) }); }

__ds_ns.BrandMark = __ds_scope.BrandMark;

__ds_ns.Wordmark = __ds_scope.Wordmark;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.FeatureCard = __ds_scope.FeatureCard;

__ds_ns.SectionHeader = __ds_scope.SectionHeader;

__ds_ns.Stat = __ds_scope.Stat;

__ds_ns.ThermoLedger = __ds_scope.ThermoLedger;

})();
