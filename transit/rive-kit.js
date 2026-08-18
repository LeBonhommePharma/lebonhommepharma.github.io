/* Shared heading, rider here, crowd-probe, and watch remain. Apache-2.0 */

const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const RIDER_STALE_MS = 5 * 60 * 1000;
export const PROBE_MAX_AGE_MS = 3 * 60 * 1000;
export const PROBE_MIN_AGREE = 3;
export const PROBE_SNAP_M = 90;
export const PROBE_AGREE_M = 130;
export const PROBE_CITY_RADIUS_M = 45_000;
const QC = { lon: -71.2082, lat: 46.8131 };
const MTL = { lon: -73.5673, lat: 45.5017 };
const BUS_M_PER_MIN = 360;

function asFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function finiteCoord(value, maxAbs) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > maxAbs) return null;
  return n;
}

function haversineMeters(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function headingFromSample(sample) {
  let raw = null;
  if (typeof sample === "number" || typeof sample === "string") raw = asFiniteNumber(sample);
  else if (sample && typeof sample === "object") {
    raw =
      asFiniteNumber(sample.heading) ??
      asFiniteNumber(sample.webkitCompassHeading) ??
      asFiniteNumber(sample.alpha);
  }
  if (raw == null || raw < 0) return null;
  const degrees = ((raw % 360) + 360) % 360;
  return { degrees, cardinal: CARDINALS[Math.round(degrees / 45) % 8] };
}

export function emptyRiderStore() {
  return { here: null };
}

export function forgetInAppLocationGrant(store) {
  if (!store || !store.here) return { here: null };
  if (store.here.source === "gps") return { here: null };
  return { here: { ...store.here } };
}

export function isCrowdProbeSource(source) {
  return source === "gps";
}

export function formatClock(minutes, hour12) {
  const wrap = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrap / 60);
  const m = wrap % 60;
  const mm = String(m).padStart(2, "0");
  if (!hour12) return `${String(h).padStart(2, "0")}:${mm}`;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${suffix}`;
}

export function parseClock24(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  const ampm = raw.match(/^(\d{1,2})(?:[:hH.\s](\d{2}))?\s*([ap]m)$/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const min = Number(ampm[2] || 0);
    if (!Number.isFinite(h) || !Number.isFinite(min) || h < 1 || h > 12 || min > 59) return null;
    if (h === 12) h = 0;
    if (ampm[3].toLowerCase() === "pm") h += 12;
    return h * 60 + min;
  }
  const m = raw.match(/^(\d{1,2})(?:[:hH.\s]?(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function acceptRiderFix(store, sample, now) {
  const lon = finiteCoord(sample.lon, 180);
  const lat = finiteCoord(sample.lat, 90);
  const at = typeof sample.at === "number" && Number.isFinite(sample.at) ? sample.at : Number(sample.at);
  if (lon == null || lat == null || !Number.isFinite(at)) return store;
  const clock = typeof now === "number" && Number.isFinite(now) ? now : at;
  const source = typeof sample.source === "string" && sample.source ? sample.source : "gps";
  if (clock - at > RIDER_STALE_MS) return store;
  if (store.here && at < store.here.at && !(source === "gps" && store.here.source === "map")) return store;
  const accuracy =
    typeof sample.accuracy === "number" && Number.isFinite(sample.accuracy) ? sample.accuracy : undefined;
  return { here: { lon, lat, at, source, accuracy } };
}

export function remainMinutes(departs, now) {
  if (!Number.isFinite(now)) return null;
  const list = Array.isArray(departs) ? departs : [];
  let best = null;
  for (const raw of list) {
    let t = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(t)) continue;
    if (t < now - 90) t += 1440;
    const wait = t - now;
    if (wait < 0) continue;
    if (best == null || wait < best) best = wait;
  }
  return best;
}

export function boardingStopName(trip) {
  const transit = (trip && trip.legs ? trip.legs : []).find((leg) => leg.kind === "transit");
  const from = transit && transit.from;
  if (!from || typeof from !== "object") return "";
  return from.name || from.label || "";
}

export function livePulseFromTransit(input, now) {
  if (!input || typeof input !== "object") return { action: "end" };
  const route = typeof input.route === "string" ? input.route.trim() : "";
  const stop = typeof input.stop === "string" ? input.stop.trim() : "";
  const departs = (Array.isArray(input.departs) ? input.departs : [])
    .map((raw) => (typeof raw === "number" ? raw : Number(raw)))
    .filter((n) => Number.isFinite(n));
  if (!route || !departs.length) return { action: "end" };
  const remain = remainMinutes(departs, now);
  if (remain == null) return { action: "end" };
  return {
    action: "start",
    city: typeof input.city === "string" && input.city ? input.city : "quebec",
    stop,
    route,
    color: typeof input.color === "string" && input.color ? input.color : "#0071e3",
    headsign: typeof input.headsign === "string" ? input.headsign : "",
    clocks: Array.isArray(input.clocks) ? input.clocks.filter((item) => typeof item === "string" && item) : [],
    departs,
    remain,
  };
}

export function livePulseEnd() {
  return { action: "end" };
}

export function applyLivePulse(command, store, key) {
  const name = key || "rive.live";
  if (!command || command.action === "end") {
    try {
      store && store.removeItem(name);
    } catch {
      /* private */
    }
    return { href: "./watch.html", live: null };
  }
  const live = {
    city: command.city,
    stop: command.stop,
    route: command.route,
    color: command.color,
    headsign: command.headsign,
    clocks: command.clocks,
    departs: command.departs,
    remain: command.remain,
  };
  try {
    store && store.setItem(name, JSON.stringify(live));
  } catch {
    /* private */
  }
  const q = new URLSearchParams({
    c: command.city,
    s: command.stop,
    r: command.route,
    k: command.color,
    t: (command.clocks || []).slice(0, 4).join(","),
    m: (command.departs || []).slice(0, 4).join(","),
  });
  return { href: `./watch.html?${q.toString()}`, live };
}

export function watchPulseFromPayload(payload) {
  if (payload == null) return null;
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    try {
      return watchPulseFromPayload(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  if (typeof payload !== "object") return null;
  const stop = typeof payload.stop === "string" ? payload.stop : typeof payload.s === "string" ? payload.s : "";
  const route = typeof payload.route === "string" ? payload.route : typeof payload.r === "string" ? payload.r : "";
  const color = typeof payload.color === "string" ? payload.color : typeof payload.k === "string" ? payload.k : "";
  const clocksRaw = payload.clocks ?? payload.t;
  const departsRaw = payload.departs ?? payload.m;
  const clocks = Array.isArray(clocksRaw)
    ? clocksRaw.filter((item) => typeof item === "string")
    : typeof clocksRaw === "string"
      ? clocksRaw.split(",").filter(Boolean)
      : [];
  const departs = Array.isArray(departsRaw)
    ? departsRaw
    : typeof departsRaw === "string"
      ? departsRaw.split(",").filter(Boolean)
      : [];
  if (!stop && !route && clocks.length === 0 && departs.length === 0) return null;
  return { stop, route, color, clocks, departs };
}

export function emptyProbeStore() {
  return { samples: [] };
}

export function inServedRegion(lon, lat) {
  const here = { lon, lat };
  return haversineMeters(here, QC) <= PROBE_CITY_RADIUS_M || haversineMeters(here, MTL) <= PROBE_CITY_RADIUS_M;
}

export function validateProbe(raw, now) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.name != null || raw.email != null || raw.userId != null || raw.deviceId != null) return null;
  const lon = finiteCoord(raw.lon, 180);
  const lat = finiteCoord(raw.lat, 90);
  const at = typeof raw.at === "number" && Number.isFinite(raw.at) ? raw.at : Number(raw.at);
  if (lon == null || lat == null || !Number.isFinite(at)) return null;
  if (!inServedRegion(lon, lat)) return null;
  const clock = typeof now === "number" && Number.isFinite(now) ? now : at;
  if (clock - at > PROBE_MAX_AGE_MS) return null;
  const routeId = typeof raw.routeId === "string" && raw.routeId ? raw.routeId : undefined;
  const heading = finiteCoord(raw.heading, 10_000);
  return {
    lon,
    lat,
    at,
    routeId,
    heading: heading == null ? undefined : ((heading % 360) + 360) % 360,
  };
}

export function expireProbes(store, now) {
  if (!Number.isFinite(now)) return { samples: [] };
  return { samples: store.samples.filter((s) => now - s.at <= PROBE_MAX_AGE_MS && now - s.at >= 0) };
}

export function ingestProbe(store, raw, now) {
  const sample = validateProbe(raw, now);
  if (!sample) return store;
  const clock = typeof now === "number" && Number.isFinite(now) ? now : sample.at;
  const next = expireProbes({ samples: store.samples.concat(sample) }, clock);
  if (next.samples.length > 400) next.samples = next.samples.slice(-400);
  return next;
}

export function snapToShape(point, shape) {
  if (!shape || shape.length < 2) return null;
  if (!Number.isFinite(point.lon) || !Number.isFinite(point.lat)) return null;
  let bestI = 0;
  let bestD = Infinity;
  let best = shape[0];
  const prefix = [0];
  for (let i = 1; i < shape.length; i++) {
    prefix[i] =
      prefix[i - 1] +
      haversineMeters({ lon: shape[i - 1][0], lat: shape[i - 1][1] }, { lon: shape[i][0], lat: shape[i][1] });
  }
  for (let i = 0; i < shape.length; i++) {
    const d = haversineMeters(point, { lon: shape[i][0], lat: shape[i][1] });
    if (d < bestD) {
      bestD = d;
      bestI = i;
      best = shape[i];
    }
  }
  if (!Number.isFinite(bestD) || bestD > PROBE_SNAP_M) return null;
  return { lon: best[0], lat: best[1], index: bestI, meters: bestD, alongMeters: prefix[bestI] || 0 };
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function agreeingCluster(snaps) {
  if (snaps.length < PROBE_MIN_AGREE) return [];
  let best = [];
  for (const seed of snaps) {
    const group = snaps.filter((item) => haversineMeters(seed, item) <= PROBE_AGREE_M);
    if (group.length > best.length) best = group;
  }
  return best.length >= PROBE_MIN_AGREE ? best : [];
}

export function fuseRouteProbes(input) {
  const { store, routeId, shape, now, officialDepart } = input;
  if (!routeId || !shape || shape.length < 2 || !Number.isFinite(now) || !Number.isFinite(officialDepart)) {
    return null;
  }
  const live = expireProbes(store, now).samples.filter((s) => !s.routeId || s.routeId === routeId);
  const snaps = [];
  for (const sample of live) {
    const snap = snapToShape(sample, shape);
    if (snap) snaps.push(snap);
  }
  const cluster = agreeingCluster(snaps);
  if (cluster.length < PROBE_MIN_AGREE) return null;
  const alongMeters = median(cluster.map((c) => c.alongMeters));
  const expected =
    typeof input.expectedAlongMeters === "number" && Number.isFinite(input.expectedAlongMeters)
      ? input.expectedAlongMeters
      : alongMeters;
  return {
    routeId,
    lon: median(cluster.map((c) => c.lon)),
    lat: median(cluster.map((c) => c.lat)),
    alongMeters,
    etaShiftMinutes: Math.round((expected - alongMeters) / BUS_M_PER_MIN),
    count: cluster.length,
  };
}

export function applyFusedEtaToDue(due, fused, now) {
  if (!fused || !due || !due.length) return due || [];
  if (!Number.isFinite(fused.etaShiftMinutes) || fused.etaShiftMinutes === 0) return due;
  return due.map((row) => {
    if (row.routeId !== fused.routeId) return row;
    const depart = row.depart + fused.etaShiftMinutes;
    const clocks = Array.isArray(row.clocks) ? row.clocks : [];
    return {
      ...row,
      depart,
      wait: depart - now,
      clocks: [formatClock(depart), ...clocks.slice(1)],
    };
  });
}

export function parseHexColor(hex) {
  if (typeof hex !== "string") return null;
  let raw = hex.trim().replace(/^#/, "");
  if (raw.length === 3) raw = raw.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  return { r: parseInt(raw.slice(0, 2), 16), g: parseInt(raw.slice(2, 4), 16), b: parseInt(raw.slice(4, 6), 16) };
}

function rgbToHsl(r, g, b) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return { h: h * 60, s, l };
}

function hslToHex(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const C = (1 - Math.abs(2 * l - 1)) * s;
  const X = C * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - C / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) [r, g, b] = [C, X, 0];
  else if (hue < 120) [r, g, b] = [X, C, 0];
  else if (hue < 180) [r, g, b] = [0, C, X];
  else if (hue < 240) [r, g, b] = [0, X, C];
  else if (hue < 300) [r, g, b] = [X, 0, C];
  else [r, g, b] = [C, 0, X];
  const hex = (n) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export function isBlueFamily(hex) {
  const rgb = parseHexColor(hex);
  if (!rgb) return true;
  const { h, s } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  if (s < 0.12) return true;
  return h >= 170 && h <= 265;
}

export function lineStrokeColor(route) {
  const official = typeof route.color === "string" && parseHexColor(route.color) ? route.color : "#0e7490";
  const base = official.startsWith("#") ? official : `#${official}`;
  if (!isBlueFamily(base)) return base;
  const rgb = parseHexColor(base);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const num = parseInt(String(route.shortName || "").replace(/\D/g, ""), 10) || 0;
  const hueShift = ((num * 17) % 36) - 18;
  const popular = route.type === 1 || /^80/.test(String(route.shortName || "")) || (num > 0 && num < 20);
  const s = Math.min(0.72, Math.max(0.28, hsl.s + (popular ? 0.08 : -0.04)));
  const l = Math.min(0.58, Math.max(0.28, hsl.l + (popular ? -0.08 : 0.04) + ((num % 7) - 3) * 0.012));
  return hslToHex(hsl.h + hueShift, s, l);
}

export function rankByDoorToDoor(options) {
  return options.slice().sort((a, b) => a.minutes - b.minutes);
}

export function annotateTimeGaps(options) {
  if (!options.length) return [];
  const fastest = Math.min(...options.map((row) => row.minutes));
  return options.map((row) => ({ ...row, gap: row.minutes - fastest }));
}

export function lineSlice(coords, from, to) {
  if (!coords || coords.length < 2) return coords || [];
  let i0 = 0;
  let i1 = coords.length - 1;
  let d0 = Infinity;
  let d1 = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const [lon, lat] = coords[i];
    const a = (lon - from.lon) ** 2 + (lat - from.lat) ** 2;
    const b = (lon - to.lon) ** 2 + (lat - to.lat) ** 2;
    if (a < d0) {
      d0 = a;
      i0 = i;
    }
    if (b < d1) {
      d1 = b;
      i1 = i;
    }
  }
  if (i0 === i1) return [coords[i0], [to.lon, to.lat]];
  if (i0 < i1) return coords.slice(i0, i1 + 1);
  return coords.slice(i1, i0 + 1).reverse();
}
