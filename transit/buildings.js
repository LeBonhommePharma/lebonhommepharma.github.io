/* OSM 2.5D footprints. Apache-2.0. Fail-safe: junk → no buildings. */

export const BUILDING_ZOOM = 14.2;
export const BUILDING_CAP = 180;

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

export function extrudeOffsetPx(heightM, zoom) {
  if (!Number.isFinite(heightM) || heightM <= 0 || !Number.isFinite(zoom)) return { dx: 0, dy: 0 };
  const pxPerMeter = Math.max(0.15, 2 ** (zoom - 15) * 0.85);
  return { dx: heightM * pxPerMeter * 0.32, dy: -heightM * pxPerMeter * 0.58 };
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
