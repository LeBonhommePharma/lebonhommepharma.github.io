/* Rive standalone atlas. Copyright 2026 Rive contributors. Apache-2.0 */
import { probeGpuLabel } from "./webgpu.js";

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
  routeId: null,
  stop: null,
  here: null,
  pois: [],
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
    out.push({ ...stop, meters: Math.round(meters) });
  }
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 1 ? -1 : b.kind === 1 ? 1 : 0;
    return a.meters - b.meters;
  });
  return out.slice(0, limit);
}

function clockMinutes() {
  const input = document.getElementById("at");
  if (input && input.value) {
    const [h, m] = String(input.value).split(":").map(Number);
    if (Number.isFinite(h) && Number.isFinite(m)) return h * 60 + m;
  }
  return minutesOfDay(new Date());
}

function fillClockInput() {
  const input = document.getElementById("at");
  if (!input || input.value) return;
  const mins = minutesOfDay(new Date());
  const h = Math.floor((((mins % 1440) + 1440) % 1440) / 60);
  const m = ((mins % 1440) + 1440) % 1440 % 60;
  input.value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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
      const depart = upcoming.length ? upcoming[0] : null;
      if (depart == null) continue;
      if (!best || depart < best.depart) best = { depart, headsign: row.h };
    }
  }
  return best;
}

function planFromHere(from, destStop, now, active) {
  if (!state.atlas || !from || !destStop) return [];
  const routes = new Map(state.atlas.routes.map((r) => [r.id, r]));
  const origins = nearbyStops(state.atlas.stops, from, 700, 10);
  if (from.stopId) {
    const seed = state.atlas.stops.find((s) => s.id === from.stopId);
    if (seed) origins.unshift({ ...seed, meters: 0 });
  }
  const dests = nearbyStops(state.atlas.stops, destStop, 220, 6);
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
              label: `Marche ${Math.round(walk1)} m`,
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
            depart: board,
            arrive: board + ride,
          });
          if (w2 > 0) {
            legs.push({
              kind: "walk",
              minutes: w2,
              meters: Math.round(walk2),
              label: `Marche ${Math.round(walk2)} m`,
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
      legs: [{ kind: "walk", minutes: walkMin, meters: Math.round(walkM), label: `Marche ${Math.round(walkM)} m` }],
    });
    found.push({
      minutes: bikeMin,
      walkMeters: 0,
      depart: now,
      arrive: now + bikeMin,
      mix: "vélo",
      legs: [{ kind: "bike", minutes: bikeMin, meters: Math.round(walkM), label: `Vélo ${Math.round(walkM)} m` }],
    });
  }
  found.sort((a, b) => {
    const metro = (item) => (item.legs || []).some((leg) => leg.type === 1) ? 0 : 1;
    return metro(a) - metro(b) || a.arrive - b.arrive || a.walkMeters - b.walkMeters;
  });
  return found.slice(0, 8);
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
    fold.textContent = state.sheetOpen ? "Carte" : "Fiche";
    fold.setAttribute("aria-expanded", state.sheetOpen ? "true" : "false");
  }
  draw();
}

function applyTheme(mode) {
  const hour = new Date().getHours();
  const auto = hour >= 7 && hour < 19 ? "day" : "night";
  state.theme = mode || auto;
  document.documentElement.classList.toggle("day", state.theme === "day");
  document.documentElement.classList.toggle("night", state.theme === "night");
  const btn = document.getElementById("theme");
  if (btn) btn.textContent = state.theme === "night" ? "Jour" : "Nuit";
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
  if (btn) btn.textContent = "…";
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
    if (btn) btn.textContent = "À jour";
  } catch {
    if (btn) btn.textContent = "Actualiser";
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
  try {
    const opts = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions();
    if (opts.hourCycle === "h11" || opts.hourCycle === "h12") return true;
    if (opts.hourCycle === "h23" || opts.hourCycle === "h24") return false;
    return Boolean(opts.hour12);
  } catch {
    return false;
  }
}

function formatClock(minutes) {
  const wrap = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrap / 60);
  const m = wrap % 60;
  const mm = String(m).padStart(2, "0");
  const hour12 = state.clockMode === "os" ? prefersHour12() : false;
  if (!hour12) return `${String(h).padStart(2, "0")}:${mm}`;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${suffix}`;
}

function setClockMode(mode) {
  state.clockMode = mode === "24" ? "24" : "os";
  try {
    localStorage.setItem("rive.clock", state.clockMode);
  } catch {
    /* private */
  }
  const btn = document.getElementById("clockfmt");
  if (btn) btn.textContent = state.clockMode === "24" ? "24 h" : "Auto";
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
  const due = applyTripUpdatesToDue(scheduled, state.tripUpdates || [], now);
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
            <div class="times">${escapeHtml(row.stopName)} · ${row.meters} m · ${row.clocks.join("  ")}</div>
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
        `<li><button type="button" data-id="${stop.id}">${escapeHtml(stop.name)} <span class="meta">${stop.meters} m</span></button></li>`,
    )
    .join("");
  box.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => openStop(state.atlas.stops.find((s) => s.id === btn.dataset.id));
  });
}

function applyHere(lon, lat, source) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
  state.here = { lon, lat, source: source || "gps" };
  const city = cityForPoint(lon, lat);
  const go = () => {
    state.camera.lon = lon;
    state.camera.lat = lat;
    state.camera.zoom = Math.max(state.camera.zoom, 14.2);
    renderNearby();
    renderLines();
    if (state.routeId) renderDue();
    draw();
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
  navigator.geolocation.getCurrentPosition(
    (pos) => applyHere(pos.coords.longitude, pos.coords.latitude, "gps"),
    fallback,
    { enableHighAccuracy: true, maximumAge: 30000, timeout: 8000 },
  );
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function openPlan(destStop) {
  if (!destStop || !state.atlas) return;
  const from = riderPoint();
  const now = clockMinutes();
  const active = activeServiceIndexes(state.atlas, new Date());
  const itineraries = planFromHere(from, destStop, now, active);
  const board = document.getElementById("board");
  board.hidden = false;
  const destHits = document.getElementById("dest-hits");
  if (destHits) destHits.innerHTML = "";
  if (!itineraries.length) {
    board.innerHTML = `<h2>${escapeHtml(destStop.name)}</h2>
      <p class="lead">Pas de trajet à ${formatClock(now)} depuis ici. Choisis une ligne ou un horaire ailleurs.</p>`;
    return;
  }
  board.innerHTML =
    `<h2>Vers ${escapeHtml(destStop.name)}</h2>
    <p class="lead">Temps total selon marche, vélo, bus${state.city === "montreal" ? " et métro" : ""}.</p>` +
    itineraries
      .map((trip) => {
        const mix =
          trip.mix ||
          trip.legs
            .map((leg) =>
              leg.kind === "walk" ? "marche" : leg.kind === "bike" ? "vélo" : leg.type === 1 ? "métro" : "bus",
            )
            .filter((name, i, all) => all[i - 1] !== name)
            .join(" + ");
        const legs = trip.legs
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
        return `<div class="trip"><div class="wait">${trip.minutes} min · ${escapeHtml(mix)}</div>${legs}</div>`;
      })
      .join("");
  state.camera.lon = destStop.lon;
  state.camera.lat = destStop.lat;
  state.camera.zoom = Math.max(state.camera.zoom, 13.6);
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
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--stage").trim() || "#d4cfc6";
  ctx.fillRect(0, 0, w, h);
  if (!state.atlas) return;
  const selected = new Set(state.stop?.routes || []);
  if (state.sheetOpen) for (const route of state.atlas.routes) {
    const frequent = route.type === 1 || /^80/.test(route.shortName);
    if (!frequent && state.camera.zoom < 13 && !selected.has(route.id)) continue;
    ctx.strokeStyle = route.color;
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
    ctx.fillStyle = "#0071e3";
    ctx.beginPath();
    ctx.arc(hx, hy, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  const showBus = state.camera.zoom >= 13.1;
  const showMetro = state.camera.zoom >= 12.6;
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
      ctx.fillStyle = selected ? "#e3a21c" : metro ? "#1d1d1f" : "#fff8ee";
      ctx.fill();
      ctx.lineWidth = metro ? 2 : 1.5;
      ctx.strokeStyle = selected ? "#1d1d1f" : metro ? "#f0d060" : "#2b2723";
      ctx.stroke();
      if (state.camera.zoom >= 14.6 || (metro && state.camera.zoom >= 13.8)) {
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#2b2723";
        ctx.font = `${metro ? 11 : 10}px "Rive Text", sans-serif`;
        ctx.fillText(stop.name, x + r + 3, y + 3);
      }
    }
  }
}

async function tryWebGPU() {
  const el = document.getElementById("gpu");
  if (!el) return;
  el.textContent = await probeGpuLabel(globalThis.navigator && globalThis.navigator.gpu);
}

let drag = null;
canvas.addEventListener("pointerdown", (e) => {
  drag = { x: e.clientX, y: e.clientY, lon: state.camera.lon, lat: state.camera.lat };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointerup", () => {
  drag = null;
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
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
    if (hereBtn && t.myPosition) hereBtn.textContent = t.myPosition;
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
document.getElementById("clockfmt").onclick = () => setClockMode(state.clockMode === "24" ? "os" : "24");
document.getElementById("at").addEventListener("change", () => {
  if (state.routeId) renderDue();
  if (state.dest) openPlan(state.dest);
  else if (state.stop) openStop(state.stop);
});
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
  state.routeId = null;
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
loadCity(bootCity).then(() => {
  if (bootStop && state.atlas) {
    const hit = state.atlas.stops.find((s) => s.id === bootStop);
    if (hit) openStop(hit);
  }
  locate();
});
