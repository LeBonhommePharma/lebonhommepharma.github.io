/* OSM 2.5D footprints. Apache-2.0. Fail-safe: junk → no buildings. */

export const BUILDING_ZOOM = 12.6;
export const BUILDING_CAP = 280;
export const MOTION_BUILDING_CAP = 800;
export const MOTION_CORE_CAP = 320;
export const MOTION_MID_CAP = 240;
export const MOTION_FAR_CAP = 240;
export const METRO_DEPTH_M = -24;
const MAX_BUILDING_RING_POINTS = 2000;
export const BUILDING_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

export function altitudeLiftPx(altM, zoom, pitch, scale) {
  if (!Number.isFinite(altM) || altM === 0 || !Number.isFinite(zoom)) return 0;
  const p = Number.isFinite(pitch) ? Math.min(1, Math.max(0, pitch)) : 0;
  const pxPerMeter = 0.95 + Math.min(0.7, Math.max(0, 2 ** (zoom - 15) * 0.25));
  const rise = 0.72 + p * 1.35;
  const s = Number.isFinite(scale) && scale > 0 ? Math.min(scale, 1.12) : 1;
  const raw = -altM * pxPerMeter * rise * s;
  const cap = 68 + p * 42;
  if (raw < -cap) return -cap;
  if (raw > cap) return cap;
  return raw;
}

export function applyPitch(px, py, w, h, pitch, altM, zoom) {
  let x = px;
  let y = py;
  let scale = 1;
  const p = Number.isFinite(pitch) ? Math.min(1, Math.max(0, pitch)) : 0;
  if (p > 0) {
    const horizon = h * (0.16 + (1 - p) * 0.1);
    const ground = h * 0.94;
    const t = (py - horizon) / Math.max(1, ground - horizon);
    scale = 0.52 + Math.max(0, Math.min(1.4, t)) * (0.48 + p * 0.4);
    x = w / 2 + (px - w / 2) * scale;
    y = horizon + (py - horizon) * (1 - p * 0.44);
  }
  return { x, y: y + altitudeLiftPx(altM || 0, zoom == null ? 15 : zoom, p, scale), scale };
}

export function invertPitch(sx, sy, w, h, pitch) {
  if (!Number.isFinite(pitch) || pitch <= 0) return { x: sx, y: sy };
  const p = Math.min(1, Math.max(0, pitch));
  const horizon = h * (0.16 + (1 - p) * 0.1);
  const ground = h * 0.94;
  const py = horizon + (sy - horizon) / Math.max(0.2, 1 - p * 0.44);
  const t = (py - horizon) / Math.max(1, ground - horizon);
  const persp = 0.52 + Math.max(0, Math.min(1.4, t)) * (0.48 + p * 0.4);
  return { x: w / 2 + (sx - w / 2) / Math.max(0.2, persp), y: py };
}

export function buildingHeightMeters(tags) {
  if (!tags || typeof tags !== "object") return 10;
  const height = Number(tags.height);
  if (Number.isFinite(height) && height > 2 && height < 400) return height;
  const levels = Number(tags["building:levels"]);
  if (Number.isFinite(levels) && levels > 0 && levels < 80) return Math.max(6, levels * 3.2);
  return 10;
}

function closedRing(pts) {
  if (pts.length < 3) return [];
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return pts;
  return pts.concat([first]);
}

export function parseOverpassBuildings(raw, cap) {
  const limit = Number.isFinite(cap) ? Math.min(MOTION_BUILDING_CAP, Math.max(0, Math.floor(cap))) : BUILDING_CAP;
  if (!raw || typeof raw !== "object") return [];
  const out = [];
  const elements = Array.isArray(raw.elements) ? raw.elements : [];
  for (const el of elements.slice(0, limit * 2)) {
    if (!el || typeof el !== "object") continue;
    const ring = [];
    for (const pt of (Array.isArray(el.geometry) ? el.geometry : []).slice(0, MAX_BUILDING_RING_POINTS)) {
      const lon = Number(pt && pt.lon);
      const lat = Number(pt && pt.lat);
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) continue;
      ring.push([lon, lat]);
    }
    const closed = closedRing(ring);
    if (closed.length < 4) continue;
    out.push({ ring: closed, heightM: buildingHeightMeters(el.tags) });
    if (out.length >= limit) break;
  }
  return out;
}

export function extrudeOffsetPx(heightM, zoom, pitch) {
  if (!Number.isFinite(heightM) || heightM <= 0 || !Number.isFinite(zoom)) return { dx: 0, dy: 0 };
  const p = Number.isFinite(pitch) ? Math.min(1, Math.max(0, pitch)) : 0;
  const pxPerMeter = Math.max(0.15, 2 ** (zoom - 15) * 0.85);
  return {
    dx: heightM * pxPerMeter * (0.32 - p * 0.22),
    dy: -heightM * pxPerMeter * (0.58 + p * 1.7),
  };
}

export function wallQuads(ring, dx, dy) {
  const quads = [];
  if (!ring || ring.length < 2) return quads;
  for (let i = 0; i < Math.min(ring.length - 1, MAX_BUILDING_RING_POINTS); i++) {
    const a = ring[i];
    const b = ring[i + 1];
    quads.push([a, b, [b[0] + dx, b[1] + dy], [a[0] + dx, a[1] + dy]]);
  }
  return quads;
}

function validBbox(bbox) {
  return !!(
    bbox &&
    Number.isFinite(bbox.south) &&
    Number.isFinite(bbox.west) &&
    Number.isFinite(bbox.north) &&
    Number.isFinite(bbox.east) &&
    bbox.south >= -90 &&
    bbox.north <= 90 &&
    bbox.west >= -180 &&
    bbox.east <= 180 &&
    bbox.south < bbox.north &&
    bbox.west < bbox.east &&
    bbox.north - bbox.south <= 1 &&
    bbox.east - bbox.west <= 1
  );
}

export function overpassQuery(bbox, cap) {
  if (!validBbox(bbox)) return "";
  const limit = Number.isFinite(cap) ? Math.min(MOTION_BUILDING_CAP, Math.max(1, Math.floor(cap))) : BUILDING_CAP;
  const s = [bbox.south, bbox.west, bbox.north, bbox.east]
    .map((n) => (Number.isFinite(n) ? n.toFixed(5) : ""))
    .join(",");
  return `[out:json][timeout:12];way["building"](${s});out tags geom ${limit};`;
}

function coarseCoord(n, step) {
  const s = Number.isFinite(step) && step > 0 ? step : 0.002;
  return Math.round(n / s) * s;
}

function finiteRadiusM(n) {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  if (n < 50) return 50;
  if (n > 25000) return 25000;
  return n;
}

function lodUnion(around) {
  return `(way["building"]["building:levels"](${around});way["building"]["height"](${around});way["building"~"apartments|commercial|office|retail|industrial|hotel|cathedral|university|hospital"](${around});)`;
}

export function overpassMotionQuery(center, loadM, continueM, caps) {
  const lat = Number(center && center.lat);
  const lon = Number(center && center.lon);
  const load = finiteRadiusM(loadM);
  const cont = finiteRadiusM(continueM);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return "";
  if (load == null || cont == null || cont < load) return "";
  const coreCap = Math.min(MOTION_BUILDING_CAP, Math.max(1, Math.floor((caps && caps.core) || MOTION_CORE_CAP)));
  const midCap = Math.min(MOTION_BUILDING_CAP, Math.max(1, Math.floor((caps && caps.mid) || MOTION_MID_CAP)));
  const farCap = Math.min(MOTION_BUILDING_CAP, Math.max(1, Math.floor((caps && caps.far) || MOTION_FAR_CAP)));
  const qlat = coarseCoord(lat).toFixed(4);
  const qlon = coarseCoord(lon).toFixed(4);
  const coreM = Math.min(load, 900);
  const around = (r) => `around:${Math.round(r)},${qlat},${qlon}`;
  const coreA = around(coreM);
  const loadA = around(load);
  const farA = around(cont);
  return (
    `[out:json][timeout:22];` +
    `way["building"](${coreA})->.core;.core out tags geom ${coreCap};` +
    `${lodUnion(loadA)}->.load;(.load; - .core;)->.mid;.mid out tags geom ${midCap};` +
    `${lodUnion(farA)}->.farset;(.farset; - .load;);out tags geom ${farCap};`
  );
}

export function overpassAccessQuery(center, radiusM, cap) {
  const lat = Number(center && center.lat);
  const lon = Number(center && center.lon);
  const r = finiteRadiusM(radiusM == null ? 700 : radiusM);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return "";
  if (r == null) return "";
  const limit = Number.isFinite(cap) ? Math.min(120, Math.max(1, Math.floor(cap))) : 64;
  const qlat = coarseCoord(lat).toFixed(4);
  const qlon = coarseCoord(lon).toFixed(4);
  const around = `around:${Math.round(Math.min(r, 900))},${qlat},${qlon}`;
  return `[out:json][timeout:10];(way["highway"~"cycleway|path|footway|pedestrian"](${around});way["highway"~"motorway|trunk|primary|secondary|tertiary|residential"](${around}););out geom ${limit};`;
}

export function parseOverpassWays(raw, cap) {
  if (!raw || typeof raw !== "object") return [];
  const elements = Array.isArray(raw.elements) ? raw.elements : [];
  const limit = Number.isFinite(cap) ? Math.min(120, Math.max(0, Math.floor(cap))) : 64;
  const out = [];
  for (const el of elements) {
    if (!el || typeof el !== "object") continue;
    const hwy = el.tags && typeof el.tags.highway === "string" ? el.tags.highway : "";
    const geom = Array.isArray(el.geometry) ? el.geometry : [];
    const line = [];
    for (const pt of geom.slice(0, 400)) {
      const lon = Number(pt && pt.lon);
      const lat = Number(pt && pt.lat);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      line.push([lon, lat]);
    }
    if (line.length < 2) continue;
    const kind = /cycleway/.test(hwy) ? "cycle" : /footway|path|pedestrian/.test(hwy) ? "foot" : "road";
    out.push({ kind, line });
    if (out.length >= limit) break;
  }
  return out;
}

export function overpassPostBody(query) {
  return `data=${encodeURIComponent(query || "")}`;
}
