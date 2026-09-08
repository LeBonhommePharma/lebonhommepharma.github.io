/* Official àVélo / BIXI. Empty if the live feed is blocked. */

export const BIKE_FEEDS = {
  quebec: { system: "avelo", label: "àVélo", gbfs: "https://quebec.publicbikesystem.net/customer/gbfs/v3.0/gbfs.json" },
  montreal: { system: "bixi", label: "BIXI", gbfs: "https://gbfs.velobixi.com/gbfs/gbfs.json" },
};

function haversineMeters(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function safeFeedUrl(value, allowedOrigin) {
  if (typeof value !== "string" || !value || value.length > 512 || !allowedOrigin) return null;
  try {
    const base = new URL(allowedOrigin);
    const url = new URL(value, base);
    if (url.protocol !== "https:" || url.origin !== base.origin || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function feedUrl(discovery, name, allowedOrigin) {
  const data = discovery && discovery.data;
  if (!data) return null;
  if (Array.isArray(data.feeds)) {
    const match = data.feeds.find((f) => f && f.name === name);
    return safeFeedUrl(match && match.url, allowedOrigin);
  }
  for (const key of ["fr", "en"]) {
    const block = data[key];
    const feeds = block && Array.isArray(block.feeds) ? block.feeds : [];
    const match = feeds.find((f) => f && f.name === name);
    const url = safeFeedUrl(match && match.url, allowedOrigin);
    if (url) return url;
  }
  return null;
}

export function mergeStations(info, status, system) {
  const live = new Map();
  const statusRows = status && status.data && Array.isArray(status.data.stations) ? status.data.stations : [];
  const infoRows = info && info.data && Array.isArray(info.data.stations) ? info.data.stations : [];
  for (const row of statusRows.slice(0, 20000)) {
    const id = String(row.station_id ?? "").slice(0, 160);
    if (id) live.set(id, row);
  }
  const out = [];
  for (const row of infoRows.slice(0, 20000)) {
    const id = String(row.station_id || "").slice(0, 160);
    if (!id) continue;
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180 || (lat === 0 && lon === 0)) continue;
    const pos = live.get(id) || {};
    const bikes = Number(pos.num_bikes_available ?? 0);
    const docks = Number(pos.num_docks_available ?? 0);
    if (!Number.isFinite(bikes) || !Number.isFinite(docks) || bikes < 0 || docks < 0 || bikes > 100000 || docks > 100000 || (bikes < 1 && docks < 1)) continue;
    out.push({
      id,
      name: (typeof row.name === "string" ? row.name : id).slice(0, 160),
      lat,
      lon,
      bikes,
      docks,
      system,
    });
  }
  return out;
}

export function nearbyStations(stations, point, radiusM = 500, limit = 6) {
  if (!point || !Number.isFinite(point.lon) || !Number.isFinite(point.lat) || point.lon < -180 || point.lon > 180 || point.lat < -90 || point.lat > 90) return [];
  const radius = Math.min(5000, Math.max(0, Number.isFinite(radiusM) ? radiusM : 500));
  const max = Math.min(20, Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 6));
  const hits = [];
  for (const station of stations || []) {
    if ((station.bikes || 0) < 1 && (station.docks || 0) < 1) continue;
    const meters = haversineMeters(point, station);
    if (meters <= radius) hits.push({ ...station, meters });
  }
  hits.sort((a, b) => a.meters - b.meters);
  return hits.slice(0, max);
}
