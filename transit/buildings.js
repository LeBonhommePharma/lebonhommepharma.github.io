/* OSM 2.5D footprints. Apache-2.0. Fail-safe: junk → no buildings. */

export const BUILDING_ZOOM = 12.6;
export const BUILDING_CAP = 280;
export const METRO_DEPTH_M = -24;
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
  const limit = cap || BUILDING_CAP;
  if (!raw || typeof raw !== "object") return [];
  const out = [];
  const elements = Array.isArray(raw.elements) ? raw.elements : [];
  for (const el of elements) {
    if (!el || typeof el !== "object") continue;
    const ring = [];
    for (const pt of el.geometry || []) {
      const lon = Number(pt && pt.lon);
      const lat = Number(pt && pt.lat);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
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
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    quads.push([a, b, [b[0] + dx, b[1] + dy], [a[0] + dx, a[1] + dy]]);
  }
  return quads;
}

export function overpassQuery(bbox) {
  const s = [bbox.south, bbox.west, bbox.north, bbox.east]
    .map((n) => (Number.isFinite(n) ? n.toFixed(5) : ""))
    .join(",");
  return `[out:json][timeout:12];way["building"](${s});out tags geom ${BUILDING_CAP};`;
}

export function overpassPostBody(query) {
  return `data=${encodeURIComponent(query || "")}`;
}
