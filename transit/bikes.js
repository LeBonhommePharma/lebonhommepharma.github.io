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

export function feedUrl(discovery, name) {
  const data = discovery && discovery.data;
  if (!data) return null;
  if (Array.isArray(data.feeds)) return (data.feeds.find((f) => f.name === name) || {}).url || null;
  return null;
}

export function mergeStations(info, status, system) {
  const live = new Map();
  for (const row of (status && status.data && status.data.stations) || []) live.set(String(row.station_id), row);
  const out = [];
  for (const row of (info && info.data && info.data.stations) || []) {
    const id = String(row.station_id || "");
    if (!id) continue;
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    const pos = live.get(id) || {};
    const bikes = Number(pos.num_bikes_available ?? 0);
    const docks = Number(pos.num_docks_available ?? 0);
    if (!Number.isFinite(bikes) || !Number.isFinite(docks) || (bikes < 1 && docks < 1)) continue;
    out.push({
      id,
      name: typeof row.name === "string" ? row.name : id,
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
  if (!point || !Number.isFinite(point.lon) || !Number.isFinite(point.lat)) return [];
  const hits = [];
  for (const station of stations || []) {
    if ((station.bikes || 0) < 1 && (station.docks || 0) < 1) continue;
    const meters = haversineMeters(point, station);
    if (meters <= radiusM) hits.push({ ...station, meters });
  }
  hits.sort((a, b) => a.meters - b.meters);
  return hits.slice(0, limit);
}
