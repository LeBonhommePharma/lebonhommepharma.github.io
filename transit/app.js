/* Rive standalone atlas. Copyright 2026 Rive contributors. Apache-2.0 */
import { probeGpuLabel } from "./webgpu.js";
import {
  acceptRiderFix,
  applyFusedEtaToDue,
  emptyProbeStore,
  emptyRiderStore,
  fuseRouteProbes,
  headingFromSample,
  ingestProbe,
  annotateTimeGaps,
  applyLivePulse,
  boardingStopName,
  isCrowdProbeSource,
  lineSlice,
  livePulseEnd,
  lineStrokeColor,
  livePulseFromTransit,
  rankByDoorToDoor,
  snapToShape,
} from "./rive-kit.js";
import {
  BUILDING_ZOOM,
  extrudeOffsetPx,
  overpassQuery,
  parseOverpassBuildings,
  wallQuads,
} from "./buildings.js";

const TZ = "America/Montreal";
const CITIES = {
  quebec: { id: "quebec", center: [-71.2082, 46.8131], zoom: 12.4 },
  montreal: { id: "montreal", center: [-73.5673, 45.5017], zoom: 12.1 },
};

const state = {
  city: "quebec",
  atlas: null,
  timetable: null,
  query: "",
  destQuery: "",
  dest: null,
  trips: [],
  tripIndex: 0,
  navigating: false,
  routeId: null,
  stop: null,
  here: null,
  heading: null,
  rider: emptyRiderStore(),
  probes: emptyProbeStore(),
  watchId: null,
  pois: [],
  buildings: [],
  vehicles: [],
  tripUpdates: [],
  shapePatches: {},
  detours: [],
  theme: "day",
  sheetOpen: true,
  clockMode: "os",
  camera: { lon: -71.2082, lat: 46.8131, zoom: 12.4 },
};

function fold(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function searchStops(atlas, query, limit = 7) {
  const q = fold(query);
  if (!q) return [];
  const hits = [];
  for (const stop of atlas.stops) {
    if (stop.kind === 2) continue;
    if (state.timetable && !stopHasService(stop, state.timetable)) continue;
    const name = fold(stop.name);
    const code = fold(stop.code || "");
    const nameTokens = name.split(/\s+/).filter(Boolean);
    const tokens = q.split(/\s+/).filter((t) => t.length > 2);
    const hay = ` ${name} ${code} `;
    const tokenHits = tokens.filter((t) => hay.includes(` ${t} `)).length;
    let score = -1;
    if (code && code === q) score = 190;
    else if (name === q) score = 180;
    else if (nameTokens.includes(q) && stop.kind === 1) score = 172;
    else if (nameTokens.includes(q)) score = 155;
    else if (name.startsWith(q)) score = 140;
    else if (code.startsWith(q)) score = 130;
    else if (name.includes(q)) score = 70;
    else if (tokenHits > 0) score = 40 + tokenHits * 25;
    if (score > 0 && stop.kind === 1) score += 8;
    if (score > 0) hits.push({ stop, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit).map((h) => h.stop);
}

function haversineMeters(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function pinHereForCity(here, center, maxMeters = 40000) {
  if (here && here.source === "gps" && Number.isFinite(here.lon) && Number.isFinite(here.lat)) {
    const meters = haversineMeters(here, center);
    if (Number.isFinite(meters) && meters <= maxMeters) {
      return { lon: here.lon, lat: here.lat, source: "gps" };
    }
  }
  return { lon: center.lon, lat: center.lat, source: "map" };
}

function stopHasService(stop, timetable) {
  if (!timetable) return true;
  const ids = [stop.id, ...(stop.children || []), stop.parent].filter(Boolean);
  return ids.some((id) => Array.isArray(timetable[id]) && timetable[id].length > 0);
}

function nearbyStops(stops, point, radiusM = 700, limit = 14) {
  if (!point || !Number.isFinite(point.lon) || !Number.isFinite(point.lat)) return [];
  const out = [];
  for (const stop of stops) {
    if (stop.kind === 2) continue;
    if (state.timetable && !stopHasService(stop, state.timetable)) continue;
    if (!Number.isFinite(stop.lon) || !Number.isFinite(stop.lat)) continue;
    const meters = haversineMeters(point, { lon: stop.lon, lat: stop.lat });
    if (!Number.isFinite(meters) || meters > radiusM) continue;
    out.push({ ...stop, meters: Math.round(meters * 10) / 10 });
  }
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 1 ? -1 : b.kind === 1 ? 1 : 0;
    return a.meters - b.meters;
  });
  return out.slice(0, limit);
}

function parseClock24(value) {
  const raw = String(value || "").trim();
  const m = raw.match(/^(\d{1,2})(?:[:hH.\s]?(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

function clockMinutes() {
  const input = document.getElementById("at");
  const parsed = input ? parseClock24(input.value) : null;
  return parsed == null ? minutesOfDay(new Date()) : parsed;
}

function fillClockInput(force) {
  const input = document.getElementById("at");
  if (!input) return;
  if (!force && input.value && parseClock24(input.value) != null) {
    input.value = formatClock(parseClock24(input.value));
    return;
  }
  input.value = formatClock(minutesOfDay(new Date()));
}

function cityForPoint(lon, lat) {
  const dQc = (lon + 71.2082) ** 2 + (lat - 46.8131) ** 2;
  const dMtl = (lon + 73.5673) ** 2 + (lat - 45.5017) ** 2;
  return dQc < dMtl ? "quebec" : "montreal";
}

function hopSum(hops, from, to) {
  let n = 0;
  for (let i = from; i < to && i < hops.length; i++) n += hops[i];
  return Math.max(1, n);
}

function indexOnDir(dirStops, stop) {
  const ids = new Set(lookupIds(stop));
  for (let i = 0; i < dirStops.length; i++) {
    if (ids.has(dirStops[i])) return i;
  }
  return -1;
}

function nextDeparture(timetable, stop, routeId, dir, now, active) {
  let best = null;
  for (const id of lookupIds(stop)) {
    for (const row of timetable[id] || []) {
      if (row.r !== routeId) continue;
      if (row.d !== dir && dir != null) continue;
      if (!row.s.some((s) => active.has(s))) continue;
      const upcoming = row.t.filter((t) => t >= now);
      const depart = upcoming.length ? upcoming[0] : row.t.length ? row.t[0] + 1440 : null;
      if (depart == null) continue;
      if (!best || depart < best.depart) best = { depart, headsign: row.h };
    }
  }
  return best;
}

function planFromHere(from, destStop, now, active) {
  if (!state.atlas || !from || !destStop) return [];
  const routes = new Map(state.atlas.routes.map((r) => [r.id, r]));
  const rapid = state.atlas.stops.filter((stop) => {
    if (stop.kind === 1) return true;
    return (stop.routes || []).some((id) => {
      const route = routes.get(id);
      return route && (route.type === 1 || /^80/.test(route.shortName));
    });
  });
  const origins = nearbyStops(state.atlas.stops, from, 900, 14).concat(nearbyStops(rapid, from, 1400, 8));
  if (from.stopId) {
    const seed = state.atlas.stops.find((s) => s.id === from.stopId);
    if (seed) origins.unshift({ ...seed, meters: 0 });
  }
  const dests = nearbyStops(state.atlas.stops, destStop, 900, 12).concat(nearbyStops(rapid, destStop, 1400, 8));
  dests.unshift({ ...destStop, meters: 0 });
  const found = [];
  const seen = new Set();
  for (const origin of origins) {
    for (const dest of dests) {
      if (origin.id === dest.id) continue;
      const shared = (origin.routes || []).filter((id) => (dest.routes || []).includes(id));
      for (const routeId of shared) {
        const route = routes.get(routeId);
        if (!route) continue;
        for (const dir of route.dirs) {
          const i = indexOnDir(dir.stops, origin);
          const j = indexOnDir(dir.stops, dest);
          if (i < 0 || j <= i) continue;
          let ride = hopSum(dir.hops, i, j);
          const detour = (state.detours || []).find((d) => !d.routeId || d.routeId === route.id);
          if (detour) {
            ride = applyDetour({
              staticEncoded: dir.line,
              hops: dir.hops,
              stopIds: dir.stops,
              fromIndex: i,
              toIndex: j,
              detour,
            }).minutes;
          }
          const next = nextDeparture(state.timetable, origin, route.id, dir.id, now, active);
          if (!next) continue;
          const walk1 = haversineMeters(from, origin);
          const walk2 = haversineMeters(dest, destStop);
          const w1 = walk1 > 40 ? Math.max(1, Math.round(walk1 / 75)) : 0;
          const w2 = walk2 > 40 ? Math.max(1, Math.round(walk2 / 75)) : 0;
          const board = Math.max(now + w1, next.depart);
          const key = `${route.id}|${origin.id}|${dest.id}|${board}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const legs = [];
          if (w1 > 0) {
            legs.push({
              kind: "walk",
              minutes: w1,
              meters: Math.round(walk1),
              label: `Marche ${formatMeters(walk1)}`,
              from: { lon: from.lon, lat: from.lat },
              to: { lon: origin.lon, lat: origin.lat, name: origin.name, label: origin.name },
              line: [
                [from.lon, from.lat],
                [origin.lon, origin.lat],
              ],
            });
          }
          legs.push({
            kind: "transit",
            minutes: ride,
            shortName: route.shortName,
            color: route.color,
            textColor: route.textColor,
            headsign: next.headsign || dir.headsign,
            type: route.type,
            routeId: route.id,
            depart: board,
            arrive: board + ride,
            from: { lon: origin.lon, lat: origin.lat, name: origin.name, label: origin.name },
            to: { lon: dest.lon, lat: dest.lat, name: dest.name, label: dest.name },
            line: lineSlice(decodePolyline(dir.line), origin, dest),
          });
          if (w2 > 0) {
            legs.push({
              kind: "walk",
              minutes: w2,
              meters: Math.round(walk2),
              label: `Marche ${formatMeters(walk2)}`,
              from: { lon: dest.lon, lat: dest.lat },
              to: { lon: destStop.lon, lat: destStop.lat },
              line: [
                [dest.lon, dest.lat],
                [destStop.lon, destStop.lat],
              ],
            });
          }
          found.push({
            minutes: board + ride + w2 - now,
            walkMeters: Math.round((w1 ? walk1 : 0) + (w2 ? walk2 : 0)),
            depart: w1 > 0 ? now : board,
            arrive: board + ride + w2,
            legs,
          });
        }
      }
    }
  }
  const walkM = haversineMeters(from, destStop);
  if (walkM <= 2800) {
    const walkMin = Math.max(1, Math.round(walkM / 75));
    const bikeMin = Math.max(1, Math.round(walkM / 250));
    found.push({
      minutes: walkMin,
      walkMeters: Math.round(walkM),
      depart: now,
      arrive: now + walkMin,
      mix: "marche",
      legs: [
        {
          kind: "walk",
          minutes: walkMin,
          meters: Math.round(walkM),
          label: `Marche ${formatMeters(walkM)}`,
          from: { lon: from.lon, lat: from.lat },
          to: { lon: destStop.lon, lat: destStop.lat },
          line: [
            [from.lon, from.lat],
            [destStop.lon, destStop.lat],
          ],
        },
      ],
    });
    found.push({
      minutes: bikeMin,
      walkMeters: 0,
      depart: now,
      arrive: now + bikeMin,
      mix: "vélo",
      legs: [
        {
          kind: "bike",
          minutes: bikeMin,
          meters: Math.round(walkM),
          label: `Vélo ${formatMeters(walkM)}`,
          from: { lon: from.lon, lat: from.lat },
          to: { lon: destStop.lon, lat: destStop.lat },
          line: [
            [from.lon, from.lat],
            [destStop.lon, destStop.lat],
          ],
        },
      ],
    });
  }
  return annotateTimeGaps(rankByDoorToDoor(found).slice(0, 8));
}

function nearbyLines(atlas, here, dest, radiusM = 700) {
  if (!here || !Number.isFinite(here.lon) || !Number.isFinite(here.lat)) return [];
  const near = nearbyStops(atlas.stops, here, radiusM, 16);
  if (!near.length) return [];
  const destRouteIds = new Set();
  if (dest && Number.isFinite(dest.lon) && Number.isFinite(dest.lat)) {
    for (const stop of nearbyStops(atlas.stops, dest, 900, 16)) {
      for (const id of stop.routes || []) destRouteIds.add(id);
    }
  }
  const routes = new Map(atlas.routes.map((r) => [r.id, r]));
  const best = new Map();
  for (const stop of near) {
    for (const routeId of stop.routes || []) {
      const route = routes.get(routeId);
      if (!route || !route.shortName) continue;
      const towardDest = destRouteIds.has(routeId);
      const prev = best.get(routeId);
      if (prev && prev.meters <= stop.meters) {
        if (towardDest) prev.towardDest = true;
        continue;
      }
      best.set(routeId, {
        routeId: route.id,
        shortName: route.shortName,
        color: route.color,
        textColor: route.textColor,
        type: route.type,
        meters: stop.meters,
        stopId: stop.id,
        towardDest,
      });
    }
  }
  return [...best.values()].sort((a, b) => {
    const metroA = a.type === 1 ? 0 : 1;
    const metroB = b.type === 1 ? 0 : 1;
    if (metroA !== metroB) return metroA - metroB;
    if (a.towardDest !== b.towardDest) return a.towardDest ? -1 : 1;
    return a.meters - b.meters;
  });
}

function nextDueOnLine(atlas, timetable, here, routeId, now, active, limit = 12) {
  if (!here || !routeId) return [];
  const route = atlas.routes.find((r) => r.id === routeId);
  if (!route) return [];
  const near = nearbyStops(atlas.stops, here, 700, 16).filter((s) => (s.routes || []).includes(routeId));
  const rows = [];
  for (const stop of near) {
    for (const row of scheduleAtStop(atlas, timetable, stop, now, active)) {
      if (row.routeId !== routeId) continue;
      rows.push({
        routeId: route.id,
        shortName: route.shortName,
        color: route.color,
        textColor: route.textColor,
        stopId: stop.id,
        stopName: stop.name,
        meters: stop.meters,
        headsign: row.headsign,
        depart: row.depart,
        wait: row.depart - now,
        clocks: (row.times || []).map(formatClock),
      });
    }
  }
  return collapseDueByDirection(rows, limit);
}

function collapseDueByDirection(rows, limit = 12) {
  const ranked = rows.slice().sort((a, b) => a.meters - b.meters || a.depart - b.depart);
  const seen = new Set();
  const unique = [];
  for (const row of ranked) {
    const key = `${row.routeId}|${fold(row.headsign)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
    if (unique.length >= limit) break;
  }
  unique.sort((a, b) => a.depart - b.depart || a.meters - b.meters);
  return unique;
}

function formatRelative(wait) {
  if (wait <= 0) return "maintenant";
  if (wait < 60) return `${wait} min`;
  const h = Math.floor(wait / 60);
  const m = wait % 60;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}

function riderPoint() {
  return (
    state.here ||
    (state.stop
      ? { lon: state.stop.lon, lat: state.stop.lat, stopId: state.stop.id }
      : { lon: state.camera.lon, lat: state.camera.lat })
  );
}

function pickPois(candidates, budget) {
  const n = Math.max(0, Math.floor(budget));
  if (n === 0 || !candidates.length) return [];
  return [...candidates]
    .filter((poi) => Number.isFinite(poi.popularity) && Number.isFinite(poi.lon) && Number.isFinite(poi.lat))
    .sort((a, b) => b.popularity - a.popularity || String(a.name).localeCompare(String(b.name), "fr"))
    .slice(0, n);
}

function fingerprintFromMeta(meta) {
  return {
    city: String(meta.city || ""),
    version: String(meta.version || ""),
    updated: String(meta.updated || ""),
    counts: meta.counts,
  };
}

function feedIsStale(local, remote, opts = {}) {
  if (opts.userDeclared) return true;
  if (remote.version && remote.version !== local.version) return true;
  if (remote.updated && remote.updated !== local.updated) return true;
  if (
    remote.counts &&
    local.counts &&
    (remote.counts.routes !== local.counts.routes || remote.counts.stops !== local.counts.stops)
  ) {
    return true;
  }
  return false;
}

function shouldFetchZip(local, remote, opts = {}) {
  return feedIsStale(local, remote, opts);
}

function parseRealtimePayload(raw) {
  const empty = { updates: [], vehicles: [], shapes: {}, detours: [] };
  if (!raw || typeof raw !== "object") return empty;
  const updates = [];
  const vehicles = [];
  const shapes = {};
  const detours = [];
  if (Array.isArray(raw.updates)) {
    for (const row of raw.updates) {
      if (!row || typeof row !== "object") continue;
      updates.push({
        routeId: typeof row.routeId === "string" ? row.routeId : undefined,
        stopId: typeof row.stopId === "string" ? row.stopId : undefined,
        delaySec: Number.isFinite(Number(row.delaySec)) ? Number(row.delaySec) : undefined,
        canceled: Boolean(row.canceled),
        departure: Number.isFinite(Number(row.departure)) ? Number(row.departure) : undefined,
      });
    }
  }
  if (Array.isArray(raw.vehicles)) {
    for (const row of raw.vehicles) {
      if (!row || !Number.isFinite(Number(row.lon)) || !Number.isFinite(Number(row.lat))) continue;
      vehicles.push({
        routeId: typeof row.routeId === "string" ? row.routeId : undefined,
        lon: Number(row.lon),
        lat: Number(row.lat),
      });
    }
  }
  if (Array.isArray(raw.detours)) {
    for (const row of raw.detours) {
      if (!row || typeof row !== "object") continue;
      detours.push({
        routeId: typeof row.routeId === "string" ? row.routeId : undefined,
        shape: typeof row.shape === "string" ? row.shape : undefined,
        skipStopIds: Array.isArray(row.skipStopIds) ? row.skipStopIds.filter((id) => typeof id === "string") : [],
        extraMinutes: Number.isFinite(Number(row.extraMinutes)) ? Number(row.extraMinutes) : undefined,
      });
    }
  }
  if (raw.shapes && typeof raw.shapes === "object") {
    for (const [id, line] of Object.entries(raw.shapes)) {
      if (typeof line === "string" && line) shapes[id] = line;
    }
  }
  const entities = raw.entity || raw.entities;
  if (Array.isArray(entities)) {
    for (const entity of entities) {
      if (!entity || typeof entity !== "object") continue;
      const tripUpdate = entity.trip_update || entity.tripUpdate;
      if (tripUpdate) {
        const trip = tripUpdate.trip || {};
        const routeId = trip.route_id || trip.routeId;
        const canceled = tripUpdate.schedule_relationship === 3 || trip.schedule_relationship === 3;
        const stus = tripUpdate.stop_time_update || tripUpdate.stopTimeUpdate || [];
        if (stus.length) {
          for (const stu of stus) {
            const dep = stu.departure || stu.arrival || {};
            const stopId = stu.stop_id || stu.stopId;
            const skipped = stu.schedule_relationship === 1 || stu.scheduleRelationship === "SKIPPED";
            updates.push({
              routeId,
              stopId,
              delaySec: Number.isFinite(Number(dep.delay)) ? Number(dep.delay) : undefined,
              canceled: canceled || skipped,
            });
            if (skipped && stopId) {
              const existing = detours.find((d) => d.routeId === routeId);
              if (existing) existing.skipStopIds = (existing.skipStopIds || []).concat(stopId);
              else detours.push({ routeId, skipStopIds: [stopId] });
            }
          }
        } else {
          updates.push({ routeId, canceled: Boolean(canceled) });
        }
      }
      const vehicle = entity.vehicle;
      if (vehicle && vehicle.position) {
        const lon = Number(vehicle.position.longitude ?? vehicle.position.lon);
        const lat = Number(vehicle.position.latitude ?? vehicle.position.lat);
        if (Number.isFinite(lon) && Number.isFinite(lat)) {
          vehicles.push({
            routeId: vehicle.trip && (vehicle.trip.route_id || vehicle.trip.routeId),
            lon,
            lat,
          });
        }
      }
    }
  }
  return { updates, vehicles, shapes, detours };
}

const RT_URLS = {
  quebec: [],
  montreal: [
    "https://api.stm.info/pub/od/gtfs-rt/ic/v2/tripUpdates",
    "https://api.stm.info/pub/od/gtfs-rt/ic/v2/vehiclePositions",
  ],
};

async function loadRealtime() {
  const localUrl = new URL(`./data/${state.city}/realtime.json`, import.meta.url).href;
  const urls = [localUrl, ...(RT_URLS[state.city] || [])];
  let updates = [];
  let vehicles = [];
  let shapes = {};
  let detours = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const type = res.headers.get("content-type") || "";
      let payload = null;
      if (type.includes("json") || url.endsWith(".json")) {
        payload = await res.json();
      } else {
        continue;
      }
      const parsed = parseRealtimePayload(payload);
      updates = updates.concat(parsed.updates);
      vehicles = vehicles.concat(parsed.vehicles);
      detours = detours.concat(parsed.detours || []);
      Object.assign(shapes, parsed.shapes);
    } catch {
      /* CORS or missing feed */
    }
  }
  state.tripUpdates = updates;
  state.vehicles = vehicles;
  state.shapePatches = shapes;
  state.detours = detours;
}

function applyTripUpdatesToDue(due, updates, now) {
  if (!updates.length) return due;
  const out = [];
  for (const row of due) {
    const update = updates.find(
      (item) =>
        (!item.routeId || item.routeId === row.routeId) &&
        (!item.stopId || item.stopId === row.stopId),
    );
    if (!update) {
      out.push(row);
      continue;
    }
    if (update.canceled) continue;
    let depart = row.depart;
    if (Number.isFinite(update.departure)) depart = update.departure;
    else if (Number.isFinite(update.delaySec)) depart = row.depart + Math.round(update.delaySec / 60);
    out.push({
      ...row,
      depart,
      wait: depart - now,
      clocks: [formatClock(depart), ...(row.clocks || []).slice(1)],
    });
  }
  return out;
}

function trajectoryAfterRealtime(staticEncoded, patch) {
  if (patch && patch.shape) return decodePolyline(patch.shape);
  const base = decodePolyline(staticEncoded);
  if (patch && patch.vehicle && Number.isFinite(patch.vehicle.lon)) {
    return [[patch.vehicle.lon, patch.vehicle.lat], ...base];
  }
  return base;
}

function overlayWithVehicles(staticEncoded, vehicles, routeId, shape) {
  const base = shape ? decodePolyline(shape) : decodePolyline(staticEncoded);
  const dots = (vehicles || []).filter((item) => !item.routeId || item.routeId === routeId);
  if (!dots.length) return base;
  return dots.map((v) => [v.lon, v.lat]).concat(base);
}

function applyDetour(input) {
  const hops = input.hops || [];
  let staticMinutes = 1;
  for (let i = input.fromIndex; i < input.toIndex && i < hops.length; i++) staticMinutes += hops[i];
  staticMinutes = Math.max(1, staticMinutes - 1 + (hops[input.fromIndex] ? 0 : 0));
  staticMinutes = 0;
  for (let i = input.fromIndex; i < input.toIndex && i < hops.length; i++) staticMinutes += hops[i];
  staticMinutes = Math.max(1, staticMinutes);
  const detour = input.detour || {};
  const skip = new Set(detour.skipStopIds || []);
  let minutes = staticMinutes;
  if (skip.size) {
    let n = 0;
    for (let i = input.fromIndex; i < input.toIndex && i < hops.length; i++) {
      n += hops[i];
      const dest = (input.stopIds || [])[i + 1];
      if (dest && skip.has(dest)) n += 4;
    }
    minutes = Math.max(staticMinutes + 1, n);
  }
  if (Number.isFinite(detour.extraMinutes)) minutes = Math.max(1, minutes + detour.extraMinutes);
  if (detour.shape) {
    const line = decodePolyline(detour.shape);
    let meters = 0;
    for (let i = 1; i < line.length; i++) meters += haversineMeters({ lon: line[i - 1][0], lat: line[i - 1][1] }, { lon: line[i][0], lat: line[i][1] });
    minutes = Math.max(1, Math.round(meters / 280)) + (detour.extraMinutes || 0) + skip.size * 2;
    if (minutes === staticMinutes) minutes = staticMinutes + 1;
    return { line, minutes, staticMinutes };
  }
  return { line: decodePolyline(input.staticEncoded), minutes, staticMinutes };
}

function setSheetOpen(open) {
  state.sheetOpen = open !== false;
  const sheet = document.getElementById("sheet");
  const fold = document.getElementById("fold");
  if (sheet) sheet.classList.toggle("folded", !state.sheetOpen);
  if (fold) {
    const label = state.sheetOpen ? "Carte" : "Fiche";
    fold.textContent = label;
    fold.title = label;
    fold.setAttribute("aria-expanded", state.sheetOpen ? "true" : "false");
  }
  paintMapHud();
  draw();
}

function paintMapHud() {
  const hud = document.getElementById("map-hud");
  if (!hud) return;
  if (state.sheetOpen) {
    hud.hidden = true;
    hud.innerHTML = "";
    return;
  }
  hud.hidden = false;
  const stop = state.stop || (state.atlas && riderPoint() ? nearbyStops(state.atlas.stops, riderPoint(), 400, 1)[0] : null);
  const now = clockMinutes();
  let dueLine = "Touche un arrêt sur la carte.";
  if (stop && state.atlas && state.timetable) {
    const active = activeServiceIndexes(state.atlas, new Date());
    const rows = scheduleAtStop(state.atlas, state.timetable, stop, now, active).slice(0, 3);
    dueLine = rows.length
      ? rows.map((row) => `${row.shortName} ${formatClock(row.depart)}`).join(" · ")
      : "Aucun passage maintenant.";
  }
  const title = stop
    ? `${stop.name}${Number.isFinite(stop.meters) ? " · " + formatMeters(stop.meters) : ""}`
    : state.dest
      ? `Vers ${state.dest.name}`
      : "Carte";
  const trip = currentTrip();
  const extra = trip ? `${trip.minutes} min · ${tripMix(trip)}` : "";
  hud.innerHTML = `<div class="hud-title">${escapeHtml(title)}</div>
    <div class="hud-due">${escapeHtml(dueLine)}</div>
    ${extra ? `<div class="hud-trip">${escapeHtml(extra)}</div>` : ""}`;
}

function inspectMapPoint(cx, cy) {
  if (!state.atlas) return;
  const w = innerWidth;
  const h = innerHeight;
  let best = null;
  let bestD = 28;
  for (const stop of state.atlas.stops) {
    if (stop.kind === 2) continue;
    if (state.timetable && !stopHasService(stop, state.timetable)) continue;
    const [x, y] = worldToScreen(stop.lon, stop.lat, state.camera, w, h);
    const d = Math.hypot(x - cx, y - cy);
    if (d < bestD) {
      bestD = d;
      best = stop;
    }
  }
  if (!best) return;
  if (state.sheetOpen) {
    openStop(best);
    return;
  }
  const origin = riderPoint();
  best.meters = origin ? Math.round(haversineMeters(origin, best) * 10) / 10 : undefined;
  state.stop = best;
  paintMapHud();
  draw();
}

function applyTheme(mode) {
  const hour = new Date().getHours();
  const auto = hour >= 7 && hour < 19 ? "day" : "night";
  state.theme = mode || auto;
  document.documentElement.classList.toggle("day", state.theme === "day");
  document.documentElement.classList.toggle("night", state.theme === "night");
  const btn = document.getElementById("theme");
  if (btn) {
    const label = state.theme === "night" ? "Jour" : "Nuit";
    btn.setAttribute("aria-label", label);
    btn.title = label;
  }
  const color = getComputedStyle(document.documentElement).getPropertyValue("--paper").trim();
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta && color) themeMeta.setAttribute("content", color);
  draw();
}

async function loadPois() {
  try {
    const table = await fetch(new URL("./data/pois.json", import.meta.url)).then((r) => r.json());
    const cityPlaces = (table.places || []).filter((poi) => !poi.city || poi.city === state.city);
    state.pois = pickPois(cityPlaces, table.budget || 8);
  } catch {
    state.pois = [];
  }
}

async function refreshFeeds(userDeclared) {
  const btn = document.getElementById("refresh");
  if (btn) {
    btn.classList.add("busy");
    btn.classList.remove("ok", "err");
    btn.title = "…";
    btn.setAttribute("aria-busy", "true");
  }
  try {
    const meta = await fetch(new URL(`./data/${state.city}/meta.json`, import.meta.url) + `?t=${Date.now()}`).then((r) =>
      r.json(),
    );
    const local = fingerprintFromMeta(state.atlas?.meta || meta);
    const remote = fingerprintFromMeta(meta);
    if (shouldFetchZip(local, remote, { userDeclared: Boolean(userDeclared) })) {
      await loadCity(state.city);
    }
    await loadPois();
    await loadRealtime();
    if (state.dest) openPlan(state.dest);
    if (state.routeId) renderDue();
    renderNearby();
    draw();
    if (btn) {
      btn.classList.remove("busy");
      btn.classList.add("ok");
      btn.title = "À jour";
      btn.setAttribute("aria-busy", "false");
      btn.setAttribute("aria-label", "À jour");
    }
  } catch {
    if (btn) {
      btn.classList.remove("busy");
      btn.classList.add("err");
      btn.title = "Actualiser";
      btn.setAttribute("aria-busy", "false");
      btn.setAttribute("aria-label", "Actualiser");
    }
  }
}

function yyyymmdd(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return (
    parts.find((p) => p.type === "year").value +
    parts.find((p) => p.type === "month").value +
    parts.find((p) => p.type === "day").value
  );
}

function weekdayMon0(date) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(date);
  return { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[name] ?? 0;
}

function minutesOfDay(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Number(parts.find((p) => p.type === "hour").value) * 60 +
    Number(parts.find((p) => p.type === "minute").value);
}

function prefersHour12() {
  return false;
}

function paintClockInput() {
  const input = document.getElementById("at");
  if (!input) return;
  input.lang = "fr-CA";
  input.setAttribute("data-hour12", "0");
}

function formatClock(minutes) {
  const wrap = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrap / 60);
  const m = wrap % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatMeters(meters) {
  if (!Number.isFinite(meters)) return "";
  return `${(Math.round(meters * 10) / 10).toFixed(1)} m`;
}

function setClockMode(mode) {
  state.clockMode = "24";
  try {
    localStorage.setItem("rive.clock", state.clockMode);
  } catch {
    /* private */
  }
  const os = document.getElementById("clock-os");
  const h24 = document.getElementById("clock-24");
  if (os) {
    os.classList.toggle("on", false);
    os.setAttribute("aria-pressed", "false");
  }
  if (h24) {
    h24.classList.toggle("on", true);
    h24.setAttribute("aria-pressed", "true");
  }
  paintClockInput();
  if (state.routeId) renderDue();
  if (state.dest) openPlan(state.dest);
  else if (state.stop) openStop(state.stop);
}

function activeServiceIndexes(atlas, date) {
  const stamp = yyyymmdd(date);
  const dow = weekdayMon0(date);
  const byName = new Map(atlas.services.map((id, i) => [id, i]));
  const active = new Set();
  for (const row of atlas.calendar) {
    if (stamp < row.start || stamp > row.end) continue;
    if (row.days[dow] !== 1) continue;
    const idx = byName.get(row.id);
    if (idx != null) active.add(idx);
  }
  for (const row of atlas.exceptions) {
    if (row.date !== stamp) continue;
    const idx = byName.get(row.id);
    if (idx == null) continue;
    if (row.type === 1) active.add(idx);
    if (row.type === 2) active.delete(idx);
  }
  const dailyIdx = byName.get(`${stamp}daily`);
  if (dailyIdx != null) active.add(dailyIdx);
  return active;
}

function lookupIds(stop) {
  const ids = [stop.id];
  if (stop.children) ids.push(...stop.children);
  if (stop.parent) ids.push(stop.parent);
  return ids;
}

function scheduleAtStop(atlas, timetable, stop, now, active) {
  const routes = new Map(atlas.routes.map((r) => [r.id, r]));
  const rows = [];
  for (const id of lookupIds(stop)) {
    for (const entry of timetable[id] || []) {
      if (!entry.s.some((s) => active.has(s))) continue;
      const route = routes.get(entry.r);
      if (!route) continue;
      const upcoming = entry.t.filter((t) => t >= now).slice(0, 6);
      const times = upcoming.length ? upcoming : entry.t.slice(0, 1).map((t) => t + 1440);
      if (!times.length) continue;
      rows.push({
        routeId: route.id,
        shortName: route.shortName,
        color: route.color,
        textColor: route.textColor,
        headsign: entry.h || route.longName,
        depart: times[0],
        times,
      });
    }
  }
  rows.sort((a, b) => a.depart - b.depart);
  const seen = new Set();
  const unique = [];
  for (const row of rows) {
    const key = `${row.routeId}|${row.headsign}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
    if (unique.length >= 12) break;
  }
  return unique;
}

function decodePolyline(encoded, precision = 5) {
  if (!encoded) return [];
  const factor = 10 ** precision;
  const coords = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lng / factor, lat / factor]);
  }
  return coords;
}

function project(lon, lat) {
  const x = (lon + 180) / 360;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  return [x, y];
}

function worldToScreen(lon, lat, cam, w, h) {
  const [x, y] = project(lon, lat);
  const [cx, cy] = project(cam.lon, cam.lat);
  const scale = (256 * 2 ** cam.zoom) / 256;
  const px = (x - cx) * scale * 256 + w / 2;
  const py = (y - cy) * scale * 256 + h / 2;
  return [px, py];
}

async function loadCity(city) {
  const base = new URL("./data/" + city + "/", import.meta.url);
  const [atlas, timetable] = await Promise.all([
    fetch(new URL("atlas.json", base)).then((r) => r.json()),
    fetch(new URL("timetable.json", base)).then((r) => r.json()),
  ]);
  state.city = city;
  state.atlas = atlas;
  state.timetable = timetable;
  state.camera = {
    lon: atlas.meta.center[0],
    lat: atlas.meta.center[1],
    zoom: atlas.meta.zoom,
  };
  state.here = pinHereForCity(state.here, {
    lon: atlas.meta.center[0],
    lat: atlas.meta.center[1],
  });
  document.getElementById("attr").textContent = atlas.meta.attribution;
  await loadPois();
  await loadRealtime();
  renderNearby();
  renderLines();
  if (state.routeId) renderDue();
  draw();
  scheduleBuildings();
}

function renderHits() {
  const box = document.getElementById("hits");
  if (!box) return;
  if (!state.atlas || state.query.trim().length < 1) {
    box.innerHTML = "";
    return;
  }
  const stops = searchStops(state.atlas, state.query);
  box.innerHTML = stops
    .map(
      (stop) =>
        `<li><button type="button" data-id="${stop.id}">${escapeHtml(stop.name)}</button></li>`,
    )
    .join("");
  box.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => openStop(state.atlas.stops.find((s) => s.id === btn.dataset.id));
  });
}

function renderDestHits() {
  const box = document.getElementById("dest-hits");
  if (!box) return;
  if (!state.atlas || state.destQuery.trim().length < 1) {
    box.innerHTML = "";
    return;
  }
  const stops = searchStops(state.atlas, state.destQuery);
  box.innerHTML = stops
    .map(
      (stop) =>
        `<li><button type="button" data-id="${stop.id}">${escapeHtml(stop.name)}</button></li>`,
    )
    .join("");
  box.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => pickDest(state.atlas.stops.find((s) => s.id === btn.dataset.id));
  });
}

function renderLines() {
  const box = document.getElementById("lines");
  if (!box || !state.atlas) return;
  const here = riderPoint();
  const dest = state.dest;
  const lines = nearbyLines(state.atlas, here, dest);
  box.innerHTML = lines
    .slice(0, 16)
    .map((line) => {
      const on = state.routeId === line.routeId ? " on" : "";
      const kind = line.type === 1 ? "métro" : line.towardDest ? "vers" : "";
      return `<button type="button" class="${on}" role="option" data-id="${escapeHtml(line.routeId)}" style="background:${line.color};color:${line.textColor}" title="${escapeHtml(line.shortName)}">${escapeHtml(line.shortName)}${kind ? ` <span class="meta">${kind}</span>` : ""}</button>`;
    })
    .join("");
  box.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      state.routeId = btn.dataset.id;
      renderLines();
      renderDue();
      pulseFromSelectedLine();
    };
  });
}

function renderDue() {
  const box = document.getElementById("due");
  if (!box || !state.atlas || !state.routeId) {
    if (box) box.hidden = true;
    return;
  }
  const now = clockMinutes();
  const active = activeServiceIndexes(state.atlas, new Date());
  const scheduled = nextDueOnLine(state.atlas, state.timetable, riderPoint(), state.routeId, now, active);
  const official = applyTripUpdatesToDue(scheduled, state.tripUpdates || [], now);
  const fused = fuseSelectedRoute(official[0]?.depart ?? now);
  const due = applyFusedEtaToDue(official, fused, now);
  state.fusedVehicle = fused;
  box.hidden = false;
  if (!due.length) {
    box.innerHTML = `<h2>Prochains</h2><p class="lead">Aucun passage de cette ligne à ${formatClock(now)} près d'ici.</p>`;
    return;
  }
  box.innerHTML =
    `<h2>Prochains</h2><p class="lead">À ${formatClock(now)}, près de toi. Horaires officiels.</p>` +
    due
      .map(
        (row) => `<div class="row">
          <span class="badge" style="background:${row.color};color:${row.textColor}">${escapeHtml(row.shortName)}</span>
          <div>
            <div class="wait">${escapeHtml(formatRelative(row.wait))}</div>
            <div>${escapeHtml(row.headsign)}</div>
            <div class="times">${escapeHtml(row.stopName)} · ${formatMeters(row.meters)} · ${row.clocks.join("  ")}</div>
          </div>
        </div>`,
      )
      .join("");
}

function pickDest(destStop) {
  if (!destStop) return;
  state.dest = destStop;
  state.destQuery = destStop.name;
  const destInput = document.getElementById("dest");
  if (destInput) destInput.value = destStop.name;
  const destHits = document.getElementById("dest-hits");
  if (destHits) destHits.innerHTML = "";
  renderLines();
  openPlan(destStop);
}

function renderNearby() {
  const box = document.getElementById("nearby");
  if (!box || !state.atlas) return;
  const origin = state.here || { lon: state.camera.lon, lat: state.camera.lat };
  const stops = nearbyStops(state.atlas.stops, origin, 700, 8);
  box.innerHTML = stops
    .map(
      (stop) =>
        `<li><button type="button" data-id="${stop.id}">${escapeHtml(stop.name)} <span class="meta">${formatMeters(stop.meters)}</span></button></li>`,
    )
    .join("");
  box.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => openStop(state.atlas.stops.find((s) => s.id === btn.dataset.id));
  });
}

function shapeForRoute(routeId) {
  const route = state.atlas?.routes.find((r) => r.id === routeId);
  const encoded = route?.dirs?.[0]?.line;
  return encoded ? decodePolyline(encoded) : [];
}

function fuseSelectedRoute(officialDepart) {
  if (!state.routeId) return null;
  const shape = shapeForRoute(state.routeId);
  const officialVeh = (state.vehicles || []).find((v) => v.routeId === state.routeId);
  const expected = officialVeh ? snapToShape(officialVeh, shape) : null;
  return fuseRouteProbes({
    store: state.probes,
    routeId: state.routeId,
    shape,
    now: Date.now(),
    officialDepart,
    expectedAlongMeters: expected ? expected.alongMeters : undefined,
  });
}

function paintHeading() {
  const el = document.getElementById("heading");
  if (!el) return;
  const h = state.heading;
  if (!h) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = `${h.cardinal} ${Math.round(h.degrees)}°`;
}

function applyHere(lon, lat, source, at) {
  const next = acceptRiderFix(state.rider, { lon, lat, at: at ?? Date.now(), source: source || "gps" }, Date.now());
  if (!next.here || (state.rider.here && next.here.at === state.rider.here.at && next.here.lon === state.rider.here.lon)) {
    if (!next.here) return;
  }
  state.rider = next;
  state.here = { lon: next.here.lon, lat: next.here.lat, source: next.here.source, at: next.here.at };
  if (state.routeId && isCrowdProbeSource(next.here.source)) {
    state.probes = ingestProbe(
      state.probes,
      {
        lon: next.here.lon,
        lat: next.here.lat,
        at: next.here.at,
        routeId: state.routeId,
        heading: state.heading?.degrees,
      },
      Date.now(),
    );
  }
  const city = cityForPoint(next.here.lon, next.here.lat);
  const go = () => {
    state.camera.lon = next.here.lon;
    state.camera.lat = next.here.lat;
    state.camera.zoom = Math.max(state.camera.zoom, 14.2);
    renderNearby();
    renderLines();
    if (state.routeId) renderDue();
    if (state.dest) openPlan(state.dest);
    if (state.navigating) {
      state.camera.zoom = Math.max(state.camera.zoom, 15);
      paintNav();
      pulseFromTrip(currentTrip());
    }
    paintHeading();
    paintMapHud();
    draw();
    scheduleBuildings();
  };
  if (city !== state.city) {
    document.getElementById("btn-quebec").classList.toggle("on", city === "quebec");
    document.getElementById("btn-montreal").classList.toggle("on", city === "montreal");
    loadCity(city).then(go);
    return;
  }
  go();
}

function locate() {
  const fallback = () => {
    const center = state.atlas
      ? { lon: state.atlas.meta.center[0], lat: state.atlas.meta.center[1] }
      : state.camera;
    applyHere(center.lon, center.lat, "map");
  };
  if (!navigator.geolocation) {
    fallback();
    return;
  }
  const onFix = (pos) => {
    applyHere(pos.coords.longitude, pos.coords.latitude, "gps", pos.timestamp || Date.now());
    const compass = headingFromSample(pos.coords);
    if (compass) {
      state.heading = compass;
      paintHeading();
      draw();
    }
  };
  navigator.geolocation.getCurrentPosition(onFix, fallback, {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 8000,
  });
  if (state.watchId == null && typeof navigator.geolocation.watchPosition === "function") {
    state.watchId = navigator.geolocation.watchPosition(onFix, () => {}, {
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 12000,
    });
  }
}

function listenHeading() {
  const apply = (event) => {
    const compass = headingFromSample({
      heading: event.webkitCompassHeading,
      alpha: event.alpha,
    });
    if (!compass) return;
    state.heading = compass;
    paintHeading();
    draw();
  };
  window.addEventListener("deviceorientationabsolute", apply, true);
  window.addEventListener("deviceorientation", apply, true);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function tripMix(trip) {
  return (
    trip.mix ||
    (trip.legs || [])
      .map((leg) =>
        leg.kind === "walk" ? "marche" : leg.kind === "bike" ? "vélo" : leg.type === 1 ? "métro" : "bus",
      )
      .filter((name, i, all) => all[i - 1] !== name)
      .join(" + ")
  );
}

function tripLine(trip) {
  const coords = [];
  for (const leg of trip.legs || []) {
    if (Array.isArray(leg.line) && leg.line.length) {
      for (const pt of leg.line) coords.push(pt);
    } else if (leg.from && leg.to) {
      coords.push([leg.from.lon, leg.from.lat], [leg.to.lon, leg.to.lat]);
    }
  }
  return coords;
}

function fitTrip(trip) {
  const coords = tripLine(trip);
  if (!coords.length) return;
  let minLon = coords[0][0];
  let maxLon = coords[0][0];
  let minLat = coords[0][1];
  let maxLat = coords[0][1];
  for (const [lon, lat] of coords) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  state.camera.lon = (minLon + maxLon) / 2;
  state.camera.lat = (minLat + maxLat) / 2;
  const span = Math.max(maxLon - minLon, maxLat - minLat);
  state.camera.zoom = span < 0.008 ? 14.6 : span < 0.02 ? 13.8 : span < 0.05 ? 12.8 : 12.2;
}

function renderTrips() {
  const box = document.getElementById("trips");
  if (!box) return;
  const destHits = document.getElementById("dest-hits");
  if (destHits) destHits.innerHTML = "";
  if (!state.trips.length) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  box.hidden = false;
  const destName = state.dest?.name || "";
  box.innerHTML =
    `<h2>Vers ${escapeHtml(destName)}</h2>
    <p class="lead">Le plus court d'abord. L'écart est contre cette option.</p>` +
    state.trips
      .map((trip, i) => {
        const on = i === state.tripIndex ? " on" : "";
        const mix = tripMix(trip);
        const gap = trip.gap > 0 ? `+${trip.gap} min` : "Plus rapide";
        const legs = (trip.legs || [])
          .map((leg) => {
            if (leg.kind === "walk" || leg.kind === "bike") {
              return `<div class="row"><span class="badge" style="background:#e8eaed;color:#1d1d1f">${leg.kind === "bike" ? "vélo" : "à pied"}</span><div>${escapeHtml(leg.label || "")}</div></div>`;
            }
            return `<div class="row">
              <span class="badge" style="background:${leg.color};color:${leg.textColor}">${escapeHtml(leg.shortName)}</span>
              <div>
                <div>${escapeHtml(leg.headsign)}</div>
                <div class="times">${formatClock(leg.depart)}  →  ${formatClock(leg.arrive)}</div>
              </div>
            </div>`;
          })
          .join("");
        return `<article class="trip${on}" data-i="${i}">
          <button type="button" class="trip-pick" data-i="${i}">
            <div class="wait">${trip.minutes} min · ${escapeHtml(mix)}</div>
            <div class="gap">${escapeHtml(gap)}</div>
            ${legs}
          </button>
          ${i === state.tripIndex ? `<button type="button" class="go" data-go="${i}">Démarrer</button>` : ""}
        </article>`;
      })
      .join("");
  box.querySelectorAll(".trip-pick").forEach((btn) => {
    btn.onclick = () => {
      state.tripIndex = Number(btn.dataset.i);
      state.navigating = false;
      paintNav();
      renderTrips();
      const trip = state.trips[state.tripIndex];
      if (trip) fitTrip(trip);
      draw();
    };
  });
  box.querySelectorAll(".go").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      startTrip(Number(btn.dataset.go));
    };
  });
}

function currentTrip() {
  return state.trips[state.tripIndex] || null;
}

function currentLeg() {
  const trip = currentTrip();
  if (!trip || !state.here) return (trip && trip.legs && trip.legs[0]) || null;
  let best = trip.legs[0];
  let bestD = Infinity;
  for (const leg of trip.legs || []) {
    const end = leg.to || (leg.line && leg.line[leg.line.length - 1]);
    if (!end) continue;
    const pt = Array.isArray(end) ? { lon: end[0], lat: end[1] } : end;
    const d = haversineMeters(state.here, pt);
    if (d < bestD) {
      bestD = d;
      best = leg;
    }
  }
  return best;
}

function paintNav() {
  const nav = document.getElementById("nav");
  if (!nav) return;
  if (!state.navigating || !currentTrip()) {
    nav.hidden = true;
    nav.innerHTML = "";
    return;
  }
  const trip = currentTrip();
  const leg = currentLeg();
  const step =
    !leg
      ? tripMix(trip)
      : leg.kind === "walk" || leg.kind === "bike"
        ? leg.label || (leg.kind === "bike" ? "Vélo" : "À pied")
        : `${leg.shortName} · ${leg.headsign || ""}`;
  nav.hidden = false;
  nav.innerHTML = `<div class="nav-step">${escapeHtml(step)}</div>
    <div class="nav-meta">${trip.minutes} min · ${escapeHtml(tripMix(trip))}</div>
    <button type="button" id="nav-stop">Fin</button>`;
  const stop = document.getElementById("nav-stop");
  if (stop) stop.onclick = () => stopTrip();
}

function startTrip(index) {
  if (Number.isFinite(index)) state.tripIndex = index;
  const trip = currentTrip();
  if (!trip) return;
  state.navigating = true;
  const transit = (trip.legs || []).find((leg) => leg.kind === "transit" && leg.routeId);
  if (transit) state.routeId = transit.routeId;
  setSheetOpen(false);
  locate();
  paintNav();
  pulseFromTrip(trip);
  draw();
}

function stopTrip() {
  state.navigating = false;
  paintNav();
  setSheetOpen(true);
  const trip = currentTrip();
  if (trip) fitTrip(trip);
  broadcastPulse(livePulseEnd());
  draw();
}

function pulseStorage() {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function broadcastPulse(command) {
  const applied = applyLivePulse(command, pulseStorage());
  const footerWatch = document.getElementById("watch-link");
  if (footerWatch) footerWatch.setAttribute("href", applied.href);
  try {
    const bridge = globalThis.webkit && globalThis.webkit.messageHandlers && globalThis.webkit.messageHandlers.riveLive;
    if (bridge && typeof bridge.postMessage === "function") bridge.postMessage(command);
  } catch {
    /* no native shell */
  }
  return applied;
}

function pulseFromTrip(trip) {
  const transit = (trip && trip.legs ? trip.legs : []).find((leg) => leg.kind === "transit");
  const command = livePulseFromTransit(
    {
      city: state.city,
      stop: boardingStopName(trip),
      route: transit && transit.shortName,
      color: transit && transit.color,
      headsign: transit && transit.headsign,
      clocks: transit && Number.isFinite(transit.depart) ? [formatClock(transit.depart), formatClock(transit.arrive)] : [],
      departs: transit && Number.isFinite(transit.depart) ? [transit.depart] : [],
    },
    clockMinutes(),
  );
  return broadcastPulse(command);
}

function pulseFromSelectedLine() {
  if (!state.atlas || !state.routeId) {
    broadcastPulse(livePulseEnd());
    return;
  }
  const now = clockMinutes();
  const active = activeServiceIndexes(state.atlas, new Date());
  const due = nextDueOnLine(state.atlas, state.timetable, riderPoint(), state.routeId, now, active);
  const first = due[0];
  const route = state.atlas.routes.find((r) => r.id === state.routeId);
  const command = livePulseFromTransit(
    {
      city: state.city,
      stop: first ? first.stopName : "",
      route: first ? first.shortName : route && route.shortName,
      color: first ? first.color : route && route.color,
      headsign: first ? first.headsign : "",
      clocks: first ? first.clocks : [],
      departs: first && Number.isFinite(first.depart) ? [first.depart] : [],
    },
    now,
  );
  broadcastPulse(command);
}

function openPlan(destStop) {
  if (!destStop || !state.atlas) return;
  const from = riderPoint();
  const now = clockMinutes();
  const active = activeServiceIndexes(state.atlas, new Date());
  const itineraries = planFromHere(from, destStop, now, active);
  const destHits = document.getElementById("dest-hits");
  if (destHits) destHits.innerHTML = "";
  const keep = state.tripIndex;
  state.trips = itineraries;
  state.tripIndex = itineraries.length ? Math.min(keep, itineraries.length - 1) : 0;
  if (!state.navigating) {
    if (itineraries[0]) fitTrip(itineraries[0]);
    else {
      state.camera.lon = destStop.lon;
      state.camera.lat = destStop.lat;
      state.camera.zoom = Math.max(state.camera.zoom, 13.6);
    }
  }
  renderTrips();
  if (!itineraries.length) {
    const box = document.getElementById("trips");
    if (box) {
      box.hidden = false;
      box.innerHTML = `<h2>Vers ${escapeHtml(destStop.name)}</h2>
        <p class="lead">Pas de trajet à ${formatClock(now)} depuis ici. Choisis une ligne ou un horaire ailleurs.</p>`;
    }
  }
  draw();
}

function openStop(stop) {
  if (!stop) return;
  state.stop = stop;
  state.camera.lon = stop.lon;
  state.camera.lat = stop.lat;
  state.camera.zoom = Math.max(state.camera.zoom, 14.2);
  const now = clockMinutes();
  const active = activeServiceIndexes(state.atlas, new Date());
  const rows = scheduleAtStop(state.atlas, state.timetable, stop, now, active);
  const board = document.getElementById("board");
  board.hidden = false;
  const watchHref = watchUrl(stop, rows);
  board.innerHTML = `<h2>${escapeHtml(stop.name)}</h2>
    <p class="lead">Passages à ${formatClock(now)}. Tu n'as pas besoin d'être sur le quai.</p>
    ${
      rows.length === 0
        ? `<p class="lead">Aucun passage restant aujourd'hui.</p>`
        : rows
            .map(
              (row) => `<div class="row">
                <span class="badge" style="background:${row.color};color:${row.textColor}">${escapeHtml(row.shortName)}</span>
                <div>
                  <div>${escapeHtml(row.headsign)}</div>
                  <div class="times">${row.times.map(formatClock).join("  ")}</div>
                </div>
              </div>`,
            )
            .join("")
    }
    <p class="lead"><a id="watch-open" href="${watchHref}">Cadran Watch</a></p>`;
  document.getElementById("hits").innerHTML = "";
  const footerWatch = document.getElementById("watch-link");
  if (footerWatch) footerWatch.setAttribute("href", watchHref);
  try {
    history.replaceState(null, "", `?city=${encodeURIComponent(state.city)}&stop=${encodeURIComponent(stop.id)}`);
  } catch {
    /* ignore */
  }
  const live = {
    city: state.city,
    stopId: stop.id,
    stop: stop.name,
    color: rows[0]?.color || "#0071e3",
    route: rows[0]?.shortName || "",
    headsign: rows[0]?.headsign || "",
    clocks: rows[0]?.times?.map(formatClock) || [],
    departs: rows[0]?.times || [],
    at: Date.now(),
  };
  try {
    localStorage.setItem("rive.live", JSON.stringify(live));
  } catch {
    /* private mode */
  }
  draw();
}

function watchUrl(stop, rows) {
  const first = rows[0];
  const q = new URLSearchParams({
    c: state.city,
    s: stop.name,
    r: first?.shortName || "",
    k: first?.color || "#0071e3",
    t: (first?.times || []).slice(0, 4).map(formatClock).join(","),
    m: (first?.times || []).slice(0, 4).join(","),
  });
  return `./watch.html?${q.toString()}`;
}

const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d", { alpha: false });

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  canvas.style.width = innerWidth + "px";
  canvas.style.height = innerHeight + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function draw() {
  const w = innerWidth;
  const h = innerHeight;
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--stage").trim() || "#d5dde4";
  ctx.fillRect(0, 0, w, h);
  if (!state.atlas) return;
  drawBuildings(w, h);
  const selected = new Set(state.stop?.routes || []);
  for (const route of state.atlas.routes) {
    const frequent = route.type === 1 || /^80/.test(route.shortName);
    if (!frequent && state.camera.zoom < 13 && !selected.has(route.id)) continue;
    ctx.strokeStyle = lineStrokeColor(route);
    ctx.globalAlpha = selected.size && !selected.has(route.id) ? 0.12 : frequent ? 0.9 : 0.35;
    ctx.lineWidth = route.type === 1 ? 4.4 : /^80/.test(route.shortName) ? 2.8 : 1.4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const dir of route.dirs) {
      const detour = (state.detours || []).find((d) => !d.routeId || d.routeId === route.id);
      const shape = (detour && detour.shape) || (state.shapePatches && state.shapePatches[route.id]);
      const line = overlayWithVehicles(dir.line, state.vehicles || [], route.id, shape);
      if (line.length < 2) continue;
      ctx.beginPath();
      line.forEach(([lon, lat], i) => {
        const [x, y] = worldToScreen(lon, lat, state.camera, w, h);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }
  const trip = currentTrip();
  if (trip) {
    for (const leg of trip.legs || []) {
      const coords = Array.isArray(leg.line) && leg.line.length >= 2
        ? leg.line
        : leg.from && leg.to
          ? [[leg.from.lon, leg.from.lat], [leg.to.lon, leg.to.lat]]
          : [];
      if (coords.length < 2) continue;
      ctx.beginPath();
      coords.forEach(([lon, lat], i) => {
        const [x, y] = worldToScreen(lon, lat, state.camera, w, h);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      if (leg.kind === "walk" || leg.kind === "bike") {
        ctx.setLineDash([6, 7]);
        ctx.strokeStyle = leg.kind === "bike" ? "#0b6bcb" : "#6a655e";
        ctx.lineWidth = 3.2;
        ctx.globalAlpha = 0.95;
      } else {
        ctx.setLineDash([]);
        ctx.strokeStyle = leg.color || "#0b6bcb";
        ctx.lineWidth = 6;
        ctx.globalAlpha = 0.96;
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const dest = state.dest;
    if (dest && Number.isFinite(dest.lon)) {
      const [dx, dy] = worldToScreen(dest.lon, dest.lat, state.camera, w, h);
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--gold").trim() || "#d97706";
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(dx, dy, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(dx, dy, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  for (const veh of state.vehicles || []) {
    const [vx, vy] = worldToScreen(veh.lon, veh.lat, state.camera, w, h);
    if (vx < -8 || vy < -8 || vx > w + 8 || vy > h + 8) continue;
    ctx.fillStyle = "#e24b4a";
    ctx.beginPath();
    ctx.arc(vx, vy, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(vx, vy, 2.1, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const poi of state.pois) {
    const [px, py] = worldToScreen(poi.lon, poi.lat, state.camera, w, h);
    if (px < -12 || py < -12 || px > w + 12 || py > h + 12) continue;
    ctx.fillStyle = state.theme === "night" ? "#c9b27a" : "#8a6a2f";
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(px, py, 3.2, 0, Math.PI * 2);
    ctx.fill();
    if (state.camera.zoom >= 13) {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#2b2723";
      ctx.font = "11px \"Rive Text\", sans-serif";
      ctx.fillText(poi.name, px + 6, py + 3);
    }
  }
  ctx.globalAlpha = 1;
  if (state.here) {
    const [hx, hy] = worldToScreen(state.here.lon, state.here.lat, state.camera, w, h);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--sodium").trim() || "#0e7490";
    ctx.beginPath();
    ctx.arc(hx, hy, 5, 0, Math.PI * 2);
    ctx.fill();
    if (state.heading && Number.isFinite(state.heading.degrees)) {
      const rad = ((state.heading.degrees - 90) * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(hx + Math.cos(rad) * 14, hy + Math.sin(rad) * 14);
      ctx.lineTo(hx + Math.cos(rad + 2.6) * 6, hy + Math.sin(rad + 2.6) * 6);
      ctx.lineTo(hx + Math.cos(rad - 2.6) * 6, hy + Math.sin(rad - 2.6) * 6);
      ctx.closePath();
      ctx.fill();
    }
  }
  if (state.fusedVehicle && Number.isFinite(state.fusedVehicle.lon)) {
    const [fx, fy] = worldToScreen(state.fusedVehicle.lon, state.fusedVehicle.lat, state.camera, w, h);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--terra").trim() || "#6d5cae";
    ctx.beginPath();
    ctx.arc(fx, fy, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  const showBus = state.camera.zoom >= 13.1 || !state.sheetOpen;
  const showMetro = state.camera.zoom >= 12.6 || !state.sheetOpen;
  if (showMetro) {
    for (const stop of state.atlas.stops) {
      if (stop.kind === 2) continue;
      if (state.timetable && !stopHasService(stop, state.timetable)) continue;
      if (stop.kind !== 1 && !showBus) continue;
      const [x, y] = worldToScreen(stop.lon, stop.lat, state.camera, w, h);
      if (x < -10 || y < -10 || x > w + 10 || y > h + 10) continue;
      const selected = state.stop && state.stop.id === stop.id;
      const metro = stop.kind === 1;
      const r = selected ? 6.2 : metro ? 5.2 : 3.8;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = selected
        ? getComputedStyle(document.documentElement).getPropertyValue("--gold").trim() || "#d97706"
        : metro
          ? "#1d1d1f"
          : "#fff8ee";
      ctx.fill();
      ctx.lineWidth = metro ? 2 : 1.5;
      ctx.strokeStyle = selected ? "#1d1d1f" : metro ? "#f0d060" : "#2b2723";
      ctx.stroke();
      if (state.camera.zoom >= 14.6 || (metro && state.camera.zoom >= 13.8) || !state.sheetOpen) {
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#2b2723";
        ctx.font = `${metro ? 11 : 10}px "Rive Text", sans-serif`;
        ctx.fillText(stop.name, x + r + 3, y + 3);
      }
    }
  }
}

let buildingTimer = 0;
let buildingKey = "";
let buildingAbort = null;

function viewBbox() {
  const deg = 360 / 2 ** state.camera.zoom;
  return {
    south: state.camera.lat - deg * 0.32,
    west: state.camera.lon - deg * 0.5,
    north: state.camera.lat + deg * 0.32,
    east: state.camera.lon + deg * 0.5,
  };
}

function scheduleBuildings() {
  clearTimeout(buildingTimer);
  buildingTimer = setTimeout(loadBuildings, 420);
}

async function loadBuildings() {
  if (state.camera.zoom < BUILDING_ZOOM) {
    if (state.buildings.length) {
      state.buildings = [];
      draw();
    }
    return;
  }
  const box = viewBbox();
  const key = [box.south, box.west, box.north, box.east].map((n) => n.toFixed(3)).join(",");
  if (key === buildingKey) return;
  if (buildingAbort) buildingAbort.abort();
  buildingAbort = new AbortController();
  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: overpassQuery(box),
      signal: buildingAbort.signal,
    });
    if (!res.ok) return;
    state.buildings = parseOverpassBuildings(await res.json());
    buildingKey = key;
    draw();
  } catch {
    /* official map still works without OSM */
  }
}

function drawBuildings(w, h) {
  if (state.camera.zoom < BUILDING_ZOOM || !state.buildings.length) return;
  const night = document.documentElement.classList.contains("night");
  const wall = night ? "#1c2630" : "#c5cdd4";
  const roof = night ? "#24303a" : "#dbe2e8";
  const edge = night ? "#141a20" : "#b0b8c0";
  const list = state.buildings.slice().sort((a, b) => a.ring[0][1] - b.ring[0][1]);
  for (const b of list) {
    const { dx, dy } = extrudeOffsetPx(b.heightM, state.camera.zoom);
    const screen = b.ring.map(([lon, lat]) => worldToScreen(lon, lat, state.camera, w, h));
    ctx.fillStyle = wall;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 0.6;
    for (const quad of wallQuads(screen, dx, dy)) {
      ctx.beginPath();
      quad.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = roof;
    ctx.beginPath();
    screen.forEach(([x, y], i) => {
      const px = x + dx;
      const py = y + dy;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

async function tryWebGPU() {
  const el = document.getElementById("gpu");
  if (!el) return;
  el.textContent = await probeGpuLabel(globalThis.navigator && globalThis.navigator.gpu);
}

let drag = null;
canvas.addEventListener("pointerdown", (e) => {
  drag = { x: e.clientX, y: e.clientY, lon: state.camera.lon, lat: state.camera.lat, moved: 0 };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointerup", (e) => {
  const tap = drag && drag.moved < 8;
  drag = null;
  scheduleBuildings();
  if (tap) inspectMapPoint(e.clientX, e.clientY);
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  drag.moved = Math.max(drag.moved || 0, Math.hypot(e.clientX - drag.x, e.clientY - drag.y));
  const scale = 256 * 2 ** state.camera.zoom;
  const dx = (e.clientX - drag.x) / scale;
  const dy = (e.clientY - drag.y) / scale;
  state.camera.lon = drag.lon - dx * 360;
  const [_, cy] = project(drag.lon, drag.lat);
  const ny = cy - dy;
  const n = Math.PI * (1 - 2 * ny);
  state.camera.lat = (Math.atan(Math.sinh(n)) * 180) / Math.PI;
  draw();
});
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    state.camera.zoom = Math.min(16.5, Math.max(10.2, state.camera.zoom - e.deltaY * 0.004));
    draw();
    scheduleBuildings();
  },
  { passive: false },
);

fetch(new URL("l10n/rive.json", import.meta.url))
  .then((r) => r.json())
  .then((tables) => {
    const wanted = [...(navigator.languages || []), navigator.language || "fr"];
    const keys = Object.keys(tables);
    let loc = "fr";
    for (const raw of wanted) {
      const tag = String(raw || "").toLowerCase();
      if (keys.includes(tag)) {
        loc = tag;
        break;
      }
      const base = tag.split("-")[0];
      const hit = keys.find((k) => k === base || k.startsWith(base + "-"));
      if (hit) {
        loc = hit;
        break;
      }
    }
    const t = tables[loc] || tables.fr || tables.en;
    const destTitle = document.getElementById("dest-title");
    const destLead = document.getElementById("dest-lead");
    const elseTitle = document.getElementById("else-title");
    const elseLead = document.getElementById("else-lead");
    const hereBtn = document.getElementById("here");
    if (destTitle && t.whereTo) destTitle.textContent = t.whereTo;
    if (destLead) destLead.textContent = t.destLead || destLead.textContent;
    if (elseTitle && t.elsewhere) elseTitle.textContent = t.elsewhere;
    if (elseLead && t.elsewhereLead) elseLead.textContent = t.elsewhereLead;
    if (hereBtn && t.myPosition) {
      hereBtn.setAttribute("aria-label", t.myPosition);
      hereBtn.title = t.myPosition;
    }
    document.getElementById("q").placeholder = t.placeholder;
    const dest = document.getElementById("dest");
    if (dest && t.to) dest.placeholder = t.to + " — Université Laval, McGill…";
    document.getElementById("btn-quebec").textContent = t.quebec;
    document.getElementById("btn-montreal").textContent = t.montreal;
  })
  .catch(() => {});

document.getElementById("btn-quebec").onclick = () => switchCity("quebec");
document.getElementById("btn-montreal").onclick = () => switchCity("montreal");
document.getElementById("here").onclick = () => locate();
document.getElementById("refresh").onclick = () => refreshFeeds(true);
document.getElementById("theme").onclick = () => applyTheme(state.theme === "night" ? "day" : "night");
document.getElementById("fold").onclick = () => setSheetOpen(!state.sheetOpen);
document.getElementById("clock-os").onclick = () => setClockMode("os");
document.getElementById("clock-24").onclick = () => setClockMode("24");
document.getElementById("at").addEventListener("change", () => {
  fillClockInput();
  if (state.routeId) renderDue();
  if (state.dest) openPlan(state.dest);
  else if (state.stop) openStop(state.stop);
});
document.getElementById("at").addEventListener("blur", () => fillClockInput());
document.getElementById("q").addEventListener("input", (e) => {
  state.query = e.target.value;
  renderHits();
});
document.getElementById("q").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const first = searchStops(state.atlas, state.query, 1)[0];
  if (first) openStop(first);
});
document.getElementById("dest").addEventListener("input", (e) => {
  state.destQuery = e.target.value;
  renderDestHits();
});
document.getElementById("dest").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const first = searchStops(state.atlas, state.destQuery, 1)[0];
  if (first) pickDest(first);
});

function switchCity(city) {
  document.getElementById("btn-quebec").classList.toggle("on", city === "quebec");
  document.getElementById("btn-montreal").classList.toggle("on", city === "montreal");
  state.stop = null;
  document.getElementById("board").hidden = true;
  document.getElementById("q").value = "";
  state.query = "";
  document.getElementById("hits").innerHTML = "";
  state.dest = null;
  state.trips = [];
  state.tripIndex = 0;
  state.navigating = false;
  state.routeId = null;
  broadcastPulse(livePulseEnd());
  const trips = document.getElementById("trips");
  if (trips) {
    trips.hidden = true;
    trips.innerHTML = "";
  }
  paintNav();
  const due = document.getElementById("due");
  if (due) {
    due.hidden = true;
    due.innerHTML = "";
  }
  const lines = document.getElementById("lines");
  if (lines) lines.innerHTML = "";
  loadCity(city);
}

window.addEventListener("resize", resize);
resize();
tryWebGPU();

const boot = new URLSearchParams(location.search);
const bootCity = boot.get("city") === "montreal" ? "montreal" : "quebec";
const bootStop = boot.get("stop");
document.getElementById("btn-quebec").classList.toggle("on", bootCity === "quebec");
document.getElementById("btn-montreal").classList.toggle("on", bootCity === "montreal");
fillClockInput();
try {
  const saved = localStorage.getItem("rive.clock");
  if (saved === "24" || saved === "os") state.clockMode = saved;
} catch {
  /* private */
}
setClockMode(state.clockMode);
applyTheme();
listenHeading();
paintHeading();
loadCity(bootCity).then(() => {
  if (bootStop && state.atlas) {
    const hit = state.atlas.stops.find((s) => s.id === bootStop);
    if (hit) openStop(hit);
  }
  locate();
});
