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
  if (raw == null) return null;
  const degrees = ((raw % 360) + 360) % 360;
  return { degrees, cardinal: CARDINALS[Math.round(degrees / 45) % 8] };
}

export function emptyRiderStore() {
  return { here: null };
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

export function acceptRiderFix(store, sample, now) {
  const lon = finiteCoord(sample.lon, 180);
  const lat = finiteCoord(sample.lat, 90);
  const at = typeof sample.at === "number" && Number.isFinite(sample.at) ? sample.at : Number(sample.at);
  if (lon == null || lat == null || !Number.isFinite(at)) return store;
  const clock = typeof now === "number" && Number.isFinite(now) ? now : at;
  if (clock - at > RIDER_STALE_MS) return store;
  if (store.here && at < store.here.at) return store;
  const accuracy =
    typeof sample.accuracy === "number" && Number.isFinite(sample.accuracy) ? sample.accuracy : undefined;
  const source = typeof sample.source === "string" && sample.source ? sample.source : "gps";
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

export function rankByDoorToDoor(options) {
  return options.slice().sort((a, b) => a.minutes - b.minutes);
}
