/* Rive standalone atlas. Copyright 2026 Rive contributors. Apache-2.0 */
import { acquireGpuDevice, computeWallShades, metalShadeAvailable, probeGpuLabel } from "./webgpu.js";
import { observerLight } from "./celestial.js";
import { SHADE_AMBIENT, lightVectorForMap, mixHex, shadeFactor, shadeMany, wallOutwardNormal } from "./shade.js";
import {
  acceptRiderFix,
  forgetInAppLocationGrant,
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
  mixLabel,
  navStepLabel,
  parseClock24,
  rankByDoorToDoor,
  bikeMinutes,
  roadMinutes,
  walkMinutes,
  snapToShape,
  cityForPoint,
  escapeHtml,
  tripStrokeStyle,
  setServedCenters,
} from "./rive-kit.js";
import {
  BUILDING_ENDPOINTS,
  BUILDING_ZOOM,
  MOTION_BUILDING_CAP,
  METRO_DEPTH_M,
  applyPitch,
  invertPitch,
  overpassAccessQuery,
  overpassMotionQuery,
  overpassPostBody,
  parseOverpassBuildings,
  parseOverpassWays,
} from "./buildings.js";
import {
  motionBuildingQueryAllowed,
  motionViewBbox,
  weatherFromOpenMeteo,
} from "./visibility.js";
import { formatShownLine, shouldDrawPrecip, shownConditions, precipIntensity } from "./conditions.js";
import { BIKE_FEEDS, feedUrl, mergeStations, nearbyStations } from "./bikes.js";

const TZ = "America/Montreal";

const state = {
  city: "quebec",
  cityCenters: {
    quebec: { lon: -71.2082, lat: 46.8131 },
    montreal: { lon: -73.5673, lat: 45.5017 },
    sherbrooke: { lon: -71.8908, lat: 45.4042 },
    "trois-rivieres": { lon: -72.5415, lat: 46.3432 },
  },
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
  searchPois: [],
  buildings: [],
  ways: [],
  weather: null,
  bikes: [],
  vehicles: [],
  tripUpdates: [],
  shapePatches: {},
  detours: [],
  theme: "day",
  sheetOpen: true,
  pin: null,
  camera: { lon: -71.2082, lat: 46.8131, zoom: 12.4, pitch: 0 },
};

async function readJsonResponseLimited(response, maxBytes) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const advertised = response.headers.get("content-length");
  if (advertised && Number(advertised) > maxBytes) throw new Error("Response too large");
  if (!response.body) throw new Error("Response has no body");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Response too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function fetchJsonLimited(url, init = {}, maxBytes = 4 * 1024 * 1024) {
  return readJsonResponseLimited(
    await fetch(url, { ...init, redirect: "error" }),
    maxBytes,
  );
}

function fold(value) {
  if (typeof value !== "string") return "";
  return value
    .slice(0, 4000)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const SEARCH_INTENT_WORDS = new Set([
  "a",
  "at",
  "de",
  "des",
  "du",
  "from",
  "horaire",
  "itineraire",
  "near",
  "nearby",
  "ou",
  "pour",
  "prochain",
  "prochains",
  "schedule",
  "to",
  "trajet",
  "vers",
  "where",
]);

function searchTokens(value) {
  return fold(value)
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .map((token) => token.slice(0, 64))
    .slice(0, 8);
}

function searchSimilarity(query, candidate) {
  if (!query || !candidate) return 0;
  if (query === candidate) return 1;
  if (query.length >= 4 && candidate.startsWith(query)) return 0.86;
  if (query.startsWith(candidate) && candidate.length >= 3 && query.length - candidate.length <= 2) return 0.86;
  if (query.length >= 4 && candidate.includes(query) && candidate.length <= query.length * 2) return 0.74;
  if (candidate.length >= 3 && query.length >= 4 && query.includes(candidate) && query.length <= candidate.length * 2) return 0.74;
  if (query.length < 4 || candidate.length < 3) return 0;
  const maxDistance = query.length >= 5 ? 2 : 1;
  if (Math.abs(query.length - candidate.length) > Math.max(2, Math.floor(query.length / 3))) return 0;
  let beforePrevious = null;
  let previous = Array.from({ length: candidate.length + 1 }, (_, i) => i);
  for (let i = 1; i <= query.length; i++) {
    const current = [i];
    for (let j = 1; j <= candidate.length; j++) {
      const cost = query[i - 1] === candidate[j - 1] ? 0 : 1;
      const transposition = beforePrevious && i > 1 && j > 1 && query[i - 1] === candidate[j - 2] && query[i - 2] === candidate[j - 1] ? beforePrevious[j - 2] + 1 : Infinity;
      const value = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost, transposition);
      current[j] = value;
    }
    beforePrevious = previous;
    previous = current;
  }
  const distance = previous[candidate.length];
  return distance <= maxDistance ? Math.max(0.52, 1 - distance / Math.max(query.length, candidate.length)) : 0;
}

function searchImportance(value) {
  return Math.max(0, Math.min(100, Number.isFinite(Number(value)) ? Number(value) : 0));
}

function searchMatchScore(query, queryTokens, fields) {
  const normalized = fields.map(fold).filter(Boolean);
  if (!normalized.length || !queryTokens.length) return 0;
  const exact = normalized.some((field) => field === query);
  const starts = normalized.some((field) => field.startsWith(query));
  const candidates = [...new Set(normalized.flatMap(searchTokens))];
  let matched = 0;
  let similarity = 0;
  for (const token of queryTokens) {
    const best = Math.max(0, ...candidates.map((candidate) => searchSimilarity(token, candidate)));
    if (best > 0) {
      matched += 1;
      similarity += best;
    }
  }
  if (!matched) return 0;
  const coverage = matched / queryTokens.length;
  if (coverage < (queryTokens.length <= 2 ? 1 : 0.5)) return 0;
  const base = exact ? 100 : starts ? 84 : coverage === 1 ? 72 : 42 + coverage * 24;
  return base + (similarity / matched) * 26 - (queryTokens.length - matched) * 6;
}

function searchStopImportance(stop) {
  return Math.max(
    searchImportance(stop.importance),
    searchImportance(stop.popularity),
    (stop.kind === 1 ? 58 : 0) +
      Math.min(24, Math.log2(1 + (stop.routes || []).length) * 8) +
      Math.min(18, (stop.children || []).length * 4) +
      (stop.temporary ? 0 : 8),
  );
}

function searchRouteImportance(route) {
  const stopCount = (route.dirs || []).reduce((n, dir) => n + (dir.stops || []).length, 0);
  return Math.max(searchImportance(route.importance), (route.type === 1 ? 58 : 0) + Math.min(32, Math.log2(1 + stopCount) * 4));
}

function searchPointProximity(point) {
  if (!state.here || !point || !Number.isFinite(point.lon) || !Number.isFinite(point.lat)) return 0;
  const meters = haversineMeters(state.here, point);
  return Number.isFinite(meters) && meters < 3000 ? (1 - meters / 3000) * 24 : 0;
}

function searchPlaces(atlas, query, limit = 7) {
  const q = fold(query);
  if (q.length > 512) return [];
  const allTokens = searchTokens(q);
  const contextWords = new Set([
    ...searchTokens(atlas.meta?.city),
    ...searchTokens(atlas.meta?.name),
    ...searchTokens(atlas.meta?.agencyId),
  ]);
  const queryTokens = allTokens.filter((token) => !SEARCH_INTENT_WORDS.has(token) && !contextWords.has(token));
  const withoutIntent = allTokens.filter((token) => !SEARCH_INTENT_WORDS.has(token));
  const tokens = (queryTokens.length ? queryTokens : withoutIntent.length ? withoutIntent : allTokens).slice(0, 8);
  if (!q || !tokens.length) return [];
  const hits = [];
  const pool = atlas === state.atlas ? liveStops() : atlas.stops;
  for (const stop of pool) {
    if (stop.kind === 2) continue;
    if (!stop.temporary && state.timetable && !stopHasService(stop, state.timetable)) continue;
    const relevance = searchMatchScore(q, tokens, [stop.name, stop.code, stop.agencyId, ...(stop.aliases || [])]);
    if (!relevance) continue;
    const importance = searchStopImportance(stop);
    const codeBoost = fold(stop.code) === q ? 48 : 0;
    hits.push({ kind: "stop", stop, importance, score: relevance + importance * 1.15 + codeBoost + searchPointProximity(stop) });
  }
  for (const route of atlas.routes || []) {
    const relevance = searchMatchScore(q, tokens, [route.shortName, route.longName, route.agencyId, route.agencyName, ...(route.aliases || [])]);
    if (!relevance) continue;
    const importance = searchRouteImportance(route);
    const codeBoost = fold(route.shortName) === q ? 48 : 0;
    hits.push({ kind: "route", route, importance, score: relevance + importance * 1.15 + codeBoost });
  }
  for (const poi of state.searchPois || []) {
    const relevance = searchMatchScore(q, tokens, [poi.name, poi.category, ...(poi.aliases || [])]);
    if (!relevance) continue;
    const importance = Math.max(searchImportance(poi.popularity), searchImportance(poi.importance));
    hits.push({ kind: "poi", poi, importance, score: relevance + importance * 1.15 + searchPointProximity(poi) });
  }
  hits.sort((a, b) => b.score - a.score || b.importance - a.importance);
  return hits.slice(0, Math.min(20, Math.max(1, Math.floor(limit))));
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
    if (!stop.temporary && state.timetable && !stopHasService(stop, state.timetable)) continue;
    if (!Number.isFinite(stop.lon) || !Number.isFinite(stop.lat)) continue;
    const meters = haversineMeters(point, { lon: stop.lon, lat: stop.lat });
    if (!Number.isFinite(meters) || meters > radiusM) continue;
    out.push({ ...stop, meters: Math.round(meters * 10) / 10 });
  }
  out.sort((a, b) => {
    if (a.temporary !== b.temporary) return a.temporary ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === 1 ? -1 : b.kind === 1 ? 1 : 0;
    return a.meters - b.meters;
  });
  return out.slice(0, limit);
}

function epochMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return n < 1e12 ? n * 1000 : n;
}

function parseTempStops(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const row of raw.slice(0, 500)) {
    if (!row || typeof row !== "object") continue;
    const lon = Number(row.lon ?? row.longitude ?? row.stop_lon);
    const lat = Number(row.lat ?? row.latitude ?? row.stop_lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90 || (lon === 0 && lat === 0)) continue;
    const id = typeof row.id === "string" ? row.id : row.stopId || row.stop_id;
    if (!id) continue;
    out.push({
      id: String(id).slice(0, 128),
      name: (typeof row.name === "string" && row.name ? row.name : String(row.stop_name || id)).slice(0, 160),
      lon,
      lat,
      routeId: typeof row.routeId === "string" ? row.routeId : typeof row.route_id === "string" ? row.route_id : undefined,
    });
  }
  return out;
}

function mergeStopsWithDetours(stops, detours) {
  const banned = new Map();
  for (const d of detours || []) {
    for (const id of d.skipStopIds || []) {
      const set = banned.get(id) || new Set();
      set.add(d.routeId || "*");
      banned.set(id, set);
    }
  }
  const out = [];
  for (const stop of stops || []) {
    const drop = banned.get(stop.id);
    if (!drop) {
      out.push({ ...stop, routes: [...(stop.routes || [])] });
      continue;
    }
    if (drop.has("*")) continue;
    const routes = (stop.routes || []).filter((id) => !drop.has(id));
    if (!routes.length && (stop.routes || []).length) continue;
    out.push({ ...stop, routes });
  }
  for (const d of detours || []) {
    for (const temp of d.tempStops || []) {
      const hit = out.find((s) => s.id === temp.id);
      const rid = temp.routeId || d.routeId;
      if (hit) {
        if (rid && !hit.routes.includes(rid)) hit.routes.push(rid);
        hit.temporary = true;
        continue;
      }
      out.push({
        id: temp.id,
        name: temp.name,
        lon: temp.lon,
        lat: temp.lat,
        routes: rid ? [rid] : [],
        kind: 0,
        temporary: true,
      });
    }
  }
  return out;
}

function detourIsActive(detour, now) {
  const clock = typeof now === "number" && Number.isFinite(now) ? now : Date.now();
  if (typeof detour.from === "number" && Number.isFinite(detour.from) && clock < detour.from) return false;
  if (typeof detour.until === "number" && Number.isFinite(detour.until) && clock >= detour.until) return false;
  return true;
}

function liveDetours(now) {
  return (state.detours || []).filter((d) => detourIsActive(d, now));
}

function liveStops() {
  if (!state.atlas) return [];
  return mergeStopsWithDetours(state.atlas.stops, liveDetours());
}

function findStop(id) {
  return liveStops().find((s) => s.id === id) || state.atlas?.stops.find((s) => s.id === id);
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

function detectCity(lon, lat) {
  return cityForPoint(lon, lat, state.cityCenters);
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
  const poles = liveStops();
  const rapid = poles.filter((stop) => {
    if (stop.kind === 1) return true;
    if (stop.temporary) return true;
    return (stop.routes || []).some((id) => {
      const route = routes.get(id);
      return route && (route.type === 1 || route.type === 2 || /^80/.test(route.shortName));
    });
  });
  const origins = nearbyStops(poles, from, 900, 14).concat(nearbyStops(rapid, from, 1400, 8));
  if (from.stopId) {
    const seed = poles.find((s) => s.id === from.stopId);
    if (seed) origins.unshift({ ...seed, meters: 0 });
  }
  const dests = nearbyStops(poles, destStop, 1200, 40).concat(nearbyStops(rapid, destStop, 1600, 16));
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
          const detour = liveDetours().find((d) => !d.routeId || d.routeId === route.id);
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
  if (Number.isFinite(walkM) && walkM <= 2800) {
    const walkMin = walkMinutes(walkM);
    const bikeMin = bikeMinutes(walkM);
    if (walkMin > 0) {
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
  }
  if (Number.isFinite(walkM) && walkM >= 500 && walkM < 200000) {
    const roadMin = roadMinutes(walkM);
    const walkMin = walkMinutes(walkM);
    if (roadMin > 0 && roadMin !== walkMin) {
      found.push({
        minutes: roadMin,
        walkMeters: 0,
        depart: now,
        arrive: now + roadMin,
        mix: "auto",
        legs: [
          {
            kind: "road",
            minutes: roadMin,
            meters: Math.round(walkM),
            label: `Auto ${formatMeters(walkM)}`,
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
  }
  return annotateTimeGaps(rankByDoorToDoor(found).slice(0, 8));
}

function nearbyLines(atlas, here, dest, radiusM = 1200) {
  if (!here || !Number.isFinite(here.lon) || !Number.isFinite(here.lat)) return [];
  const poles = atlas === state.atlas ? liveStops() : atlas.stops;
  const near = nearbyStops(poles, here, radiusM, 24);
  if (!near.length) return [];
  const destRouteIds = new Set();
  if (dest && Number.isFinite(dest.lon) && Number.isFinite(dest.lat)) {
    for (const stop of nearbyStops(poles, dest, 900, 16)) {
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
    const metroA = a.type === 1 ? 0 : a.type === 2 ? 1 : 2;
    const metroB = b.type === 1 ? 0 : b.type === 2 ? 1 : 2;
    if (metroA !== metroB) return metroA - metroB;
    if (a.towardDest !== b.towardDest) return a.towardDest ? -1 : 1;
    return a.meters - b.meters;
  });
}

function nextDueOnLine(atlas, timetable, here, routeId, now, active, limit = 12) {
  if (!here || !routeId) return [];
  const route = atlas.routes.find((r) => r.id === routeId);
  if (!route) return [];
  const poles = atlas === state.atlas ? liveStops() : atlas.stops;
  const near = nearbyStops(poles, here, 700, 16).filter((s) => (s.routes || []).includes(routeId));
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
  if (state.here && Number.isFinite(state.here.lon) && Number.isFinite(state.here.lat)) {
    return { lon: state.here.lon, lat: state.here.lat, source: state.here.source };
  }
  if (state.stop) return { lon: state.stop.lon, lat: state.stop.lat, stopId: state.stop.id };
  return { lon: state.camera.lon, lat: state.camera.lat };
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
    for (const row of raw.updates.slice(0, 5000)) {
      if (!row || typeof row !== "object") continue;
      updates.push({
        routeId: typeof row.routeId === "string" ? row.routeId.slice(0, 128) : undefined,
        stopId: typeof row.stopId === "string" ? row.stopId.slice(0, 128) : undefined,
        delaySec: Number.isFinite(Number(row.delaySec)) ? Number(row.delaySec) : undefined,
        canceled: Boolean(row.canceled),
        departure: Number.isFinite(Number(row.departure)) ? Number(row.departure) : undefined,
      });
    }
  }
  if (Array.isArray(raw.vehicles)) {
    for (const row of raw.vehicles.slice(0, 5000)) {
      if (!row || !Number.isFinite(Number(row.lon)) || !Number.isFinite(Number(row.lat))) continue;
      const lon = Number(row.lon);
      const lat = Number(row.lat);
      if (lon < -180 || lon > 180 || lat < -90 || lat > 90) continue;
      vehicles.push({
        routeId: typeof row.routeId === "string" ? row.routeId.slice(0, 128) : undefined,
        lon,
        lat,
      });
    }
  }
  if (Array.isArray(raw.detours)) {
    for (const row of raw.detours.slice(0, 500)) {
      if (!row || typeof row !== "object") continue;
      detours.push({
        routeId: typeof row.routeId === "string" ? row.routeId.slice(0, 128) : typeof row.route_id === "string" ? row.route_id.slice(0, 128) : undefined,
        shape: typeof row.shape === "string" && row.shape.length <= 200000 ? row.shape : undefined,
        skipStopIds: Array.isArray(row.skipStopIds) ? row.skipStopIds.filter((id) => typeof id === "string").slice(0, 5000).map((id) => id.slice(0, 128)) : [],
        extraMinutes: Number.isFinite(Number(row.extraMinutes)) ? Number(row.extraMinutes) : undefined,
        tempStops: parseTempStops(row.tempStops || row.temporaryStops || row.addedStops),
        from: epochMs(row.from ?? row.start ?? row.validFrom),
        until: epochMs(row.until ?? row.end ?? row.validUntil),
      });
    }
  }
  if (raw.shapes && typeof raw.shapes === "object") {
    for (const [id, line] of Object.entries(raw.shapes).slice(0, 500)) {
      if (id.length <= 128 && typeof line === "string" && line && line.length <= 200000) shapes[id] = line;
    }
  }
  const entities = raw.entity || raw.entities;
  if (Array.isArray(entities)) {
    for (const entity of entities.slice(0, 5000)) {
      if (!entity || typeof entity !== "object") continue;
      const tripUpdate = entity.trip_update || entity.tripUpdate;
      if (tripUpdate) {
        const trip = tripUpdate.trip || {};
        const routeId = trip.route_id || trip.routeId;
        const canceled = tripUpdate.schedule_relationship === 3 || trip.schedule_relationship === 3;
        const stus = tripUpdate.stop_time_update || tripUpdate.stopTimeUpdate || [];
        if (stus.length) {
          for (const stu of stus.slice(0, 5000)) {
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
      const alert = entity.alert;
      if (alert) {
        const effect = alert.effect;
        const skipEffect =
          effect === 2 || effect === 5 || effect === 9 || effect === "NO_SERVICE" || effect === "DETOUR" || effect === "STOP_MOVED";
          const informed = alert.informed_entity || alert.informedEntity || [];
          if (skipEffect && Array.isArray(informed)) {
          for (const ent of informed.slice(0, 5000)) {
            const routeId = ent && typeof (ent.route_id || ent.routeId) === "string" ? (ent.route_id || ent.routeId).slice(0, 128) : undefined;
            const stopId = ent && typeof (ent.stop_id || ent.stopId) === "string" ? (ent.stop_id || ent.stopId).slice(0, 128) : undefined;
            if (!stopId) continue;
            const existing = detours.find((d) => d.routeId === routeId);
            if (existing) existing.skipStopIds = (existing.skipStopIds || []).concat(stopId);
            else detours.push({ routeId, skipStopIds: [stopId] });
          }
        }
        const temps = parseTempStops(alert.tempStops || alert.temporaryStops || alert.addedStops || alert.replacement_stops);
        if (temps.length) detours.push({ tempStops: temps });
      }
      const vehicle = entity.vehicle;
        if (vehicle && vehicle.position && vehicles.length < 5000) {
          const lon = Number(vehicle.position.longitude ?? vehicle.position.lon);
          const lat = Number(vehicle.position.latitude ?? vehicle.position.lat);
        if (Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90) {
          vehicles.push({
            routeId: vehicle.trip && typeof (vehicle.trip.route_id || vehicle.trip.routeId) === "string" ? (vehicle.trip.route_id || vehicle.trip.routeId).slice(0, 128) : undefined,
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
      const payload = await fetchJsonLimited(url, { cache: "no-store" }, 5 * 1024 * 1024);
      const parsed = parseRealtimePayload(payload);
      updates = updates.concat(parsed.updates).slice(0, 5000);
      vehicles = vehicles.concat(parsed.vehicles).slice(0, 5000);
      detours = detours.concat(parsed.detours || []).slice(0, 500);
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

const lineCache = new Map();

function coordsFor(encoded) {
  if (!encoded) return [];
  let pts = lineCache.get(encoded);
  if (pts) return pts;
  pts = decodePolyline(encoded);
  if (lineCache.size > 500) lineCache.clear();
  lineCache.set(encoded, pts);
  return pts;
}

function overlayWithVehicles(staticEncoded, vehicles, routeId, shape) {
  const base = shape ? coordsFor(shape) : coordsFor(staticEncoded);
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

const SHEET_IDLE_MS = 12000;
let sheetIdle = 0;

function sheetHasFocus() {
  const sheet = document.getElementById("sheet");
  const el = document.activeElement;
  return !!(sheet && el && sheet.contains(el) && (el.tagName === "INPUT" || el.tagName === "TEXTAREA"));
}

function setSheetTall(on) {
  const sheet = document.getElementById("sheet");
  if (sheet) sheet.classList.toggle("tall", !!on);
}

function setSheetOpen(open) {
  state.sheetOpen = open !== false;
  const sheet = document.getElementById("sheet");
  const fold = document.getElementById("fold");
  if (sheet) sheet.classList.toggle("folded", !state.sheetOpen);
  if (!state.sheetOpen) {
    setSheetTall(false);
    clearTimeout(sheetIdle);
    sheetIdle = 0;
  }
  if (fold) {
    const label = state.sheetOpen ? "Carte" : "Fiche";
    fold.textContent = label;
    fold.title = label;
    fold.setAttribute("aria-expanded", state.sheetOpen ? "true" : "false");
  }
  paintMapHud();
  requestDraw();
}

function armSheetIdle() {
  clearTimeout(sheetIdle);
  sheetIdle = setTimeout(() => {
    if (sheetHasFocus()) {
      armSheetIdle();
      return;
    }
    minimizeSheet();
  }, SHEET_IDLE_MS);
}

function bumpSheet() {
  setSheetOpen(true);
  setSheetTall(true);
  armSheetIdle();
}

function minimizeSheet() {
  clearTimeout(sheetIdle);
  sheetIdle = 0;
  setSheetTall(false);
  setSheetOpen(false);
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
  const stop = state.stop || (state.atlas && riderPoint() ? nearbyStops(liveStops(), riderPoint(), 400, 1)[0] : null);
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
  const pitch = state.camera.pitch || 0;
  let best = null;
  let bestD = 28;
  for (const stop of liveStops()) {
    if (stop.kind === 2) continue;
    if (!stop.temporary && state.timetable && !stopHasService(stop, state.timetable)) continue;
    const [x, y] = worldToScreen(stop.lon, stop.lat, state.camera, w, h);
    let d = Math.hypot(x - cx, y - cy);
    if (stop.kind === 1 && pitch > 0.15) {
      const [ux, uy] = worldToScreen(stop.lon, stop.lat, state.camera, w, h, METRO_DEPTH_M);
      d = Math.min(d, Math.hypot(ux - cx, uy - cy));
    }
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
  requestDraw();
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
  refreshPaint();
  requestDraw();
}

async function loadPois() {
  try {
    let table = null;
    for (const url of [new URL(`./data/${state.city}/pois.json`, import.meta.url), new URL("./data/pois.json", import.meta.url)]) {
      try {
        table = await fetchJsonLimited(url, {}, 2 * 1024 * 1024);
        break;
      } catch {
        /* try the shared fallback */
      }
    }
    if (!table) throw new Error("POI data unavailable");
    const cityPlaces = (table.places || []).filter((poi) => !poi.city || poi.city === state.city);
    state.searchPois = cityPlaces.slice(0, 2000);
    state.pois = pickPois(cityPlaces, table.budget || 8);
  } catch {
    state.pois = [];
    state.searchPois = [];
  }
}

function bindCityButtons() {
  document.querySelectorAll("[data-city]").forEach((button) => {
    button.onclick = () => switchCity(button.dataset.city);
  });
}

async function loadCityIndex() {
  try {
    const table = await fetchJsonLimited(new URL("./data/index.json", import.meta.url), {}, 2 * 1024 * 1024);
    const cities = Array.isArray(table.cities)
      ? table.cities.filter((item) => item && typeof item.city === "string" && item.city.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.city))
      : [];
    if (!cities.length) return;
    state.cityCenters = Object.fromEntries(
      cities.map((item) => [item.city, { lon: Number(item.center?.[0]), lat: Number(item.center?.[1]) }]).filter(([, center]) => Number.isFinite(center.lon) && Number.isFinite(center.lat)),
    );
    setServedCenters(state.cityCenters);
    const citiesBox = document.querySelector(".cities");
    if (citiesBox) {
      citiesBox.innerHTML = cities
        .map((item) => `<button type="button" data-city="${escapeHtml(item.city)}">${escapeHtml(item.name || item.city)}</button>`)
        .join("");
      bindCityButtons();
      const requested = new URLSearchParams(location.search).get("city");
      if (requested && cities.some((item) => item.city === requested) && requested !== state.city) switchCity(requested);
    }
  } catch {
    bindCityButtons();
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
    const meta = await fetchJsonLimited(new URL(`./data/${state.city}/meta.json?t=${Date.now()}`, import.meta.url), {}, 512 * 1024);
    const local = fingerprintFromMeta(state.atlas?.meta || meta);
    const remote = fingerprintFromMeta(meta);
    if (shouldFetchZip(local, remote, { userDeclared: Boolean(userDeclared) })) {
      await loadCity(state.city);
    }
    await loadPois();
    await loadRealtime();
    if (state.dest) openPlan(state.dest, true);
    if (state.routeId) renderDue();
    renderNearby();
    requestDraw();
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
  try {
    const opts = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions();
    if (opts.hourCycle === "h23" || opts.hourCycle === "h24") return false;
    if (opts.hourCycle === "h11" || opts.hourCycle === "h12") return true;
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
  if (!prefersHour12()) return `${String(h).padStart(2, "0")}:${mm}`;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${suffix}`;
}

function formatMeters(meters) {
  if (!Number.isFinite(meters)) return "";
  return `${(Math.round(meters * 10) / 10).toFixed(1)} m`;
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
  if (typeof encoded !== "string" || !encoded || encoded.length > 200000) return [];
  const factor = 10 ** precision;
  const coords = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const nextDelta = () => {
    let result = 0;
    let shift = 0;
    for (let count = 0; count < 7; count += 1) {
      if (index >= encoded.length) return null;
      const b = encoded.charCodeAt(index++) - 63;
      if (b < 0 || b > 63) return null;
      result |= (b & 0x1f) << shift;
      shift += 5;
      if (b < 0x20) return result & 1 ? ~(result >> 1) : result >> 1;
    }
    return null;
  };
  while (index < encoded.length && coords.length < 10000) {
    const latDelta = nextDelta();
    const lngDelta = nextDelta();
    if (latDelta == null || lngDelta == null) break;
    lat += latDelta;
    lng += lngDelta;
    const point = [lng / factor, lat / factor];
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1]) || point[0] < -180 || point[0] > 180 || point[1] < -90 || point[1] > 90) return [];
    coords.push(point);
  }
  return coords;
}

function project(lon, lat) {
  const x = (lon + 180) / 360;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  return [x, y];
}

function worldToScreen(lon, lat, cam, w, h, altM = 0) {
  const [x, y] = project(lon, lat);
  const [cx, cy] = project(cam.lon, cam.lat);
  const scale = 2 ** cam.zoom;
  const px = (x - cx) * scale * 256 + w / 2;
  const py = (y - cy) * scale * 256 + h / 2;
  const pitched = applyPitch(px, py, w, h, cam.pitch || 0, altM || 0, cam.zoom || 15);
  return [pitched.x, pitched.y];
}

function horizonY(h, pitch) {
  const p = Number.isFinite(pitch) ? Math.min(1, Math.max(0, pitch)) : 0;
  return h * (0.16 + (1 - p) * 0.1);
}

function syncPitchButton() {
  const btn = document.getElementById("pitch");
  const on = (state.camera.pitch || 0) > 0.2;
  if (!btn) return;
  btn.classList.toggle("on", on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
}

function setPitch(value) {
  const next = Math.min(1, Math.max(0, Number(value) || 0));
  state.camera.pitch = next;
  syncPitchButton();
}

async function loadCity(city) {
  const base = new URL("./data/" + city + "/", import.meta.url);
  const [atlas, timetable] = await Promise.all([
    fetchJsonLimited(new URL("atlas.json", base), {}, 32 * 1024 * 1024),
    fetchJsonLimited(new URL("timetable.json", base), {}, 32 * 1024 * 1024),
  ]);
  state.city = city;
  state.atlas = atlas;
  state.timetable = timetable;
  state.buildings = [];
  buildingKey = "";
  lineCache.clear();
  state.camera = {
    lon: atlas.meta.center[0],
    lat: atlas.meta.center[1],
    zoom: atlas.meta.zoom,
    pitch: state.camera.pitch || 0,
  };
  state.here = pinHereForCity(state.here, {
    lon: atlas.meta.center[0],
    lat: atlas.meta.center[1],
  });
  document.getElementById("attr").textContent = atlas.meta.attribution;
  await loadPois();
  await loadRealtime();
  await loadBikes();
  scheduleWeather();
  renderNearby();
  renderLines();
  renderBikes();
  if (state.routeId) renderDue();
  requestDraw();
  scheduleBuildings();
}

function renderHits() {
  const box = document.getElementById("hits");
  if (!box) return;
  if (!state.atlas || state.query.trim().length < 1) {
    box.innerHTML = "";
    return;
  }
  const hits = searchPlaces(state.atlas, state.query);
  box.innerHTML = hits.map(searchHitHtml).join("");
  box.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => selectSearchHit(hits[Number(btn.dataset.index)] || null, false);
  });
}

function renderDestHits() {
  const box = document.getElementById("dest-hits");
  if (!box) return;
  if (!state.atlas || state.destQuery.trim().length < 1) {
    box.innerHTML = "";
    return;
  }
  const hits = searchPlaces(state.atlas, state.destQuery);
  box.innerHTML = hits.map(searchHitHtml).join("");
  box.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => selectSearchHit(hits[Number(btn.dataset.index)] || null, true);
  });
}

function searchHitHtml(hit, index) {
  if (hit.kind === "stop") {
    return `<li><button type="button" data-index="${index}" data-id="${escapeHtml(hit.stop.id)}"><span>${escapeHtml(hit.stop.name)}</span><span class="meta">${hit.stop.kind === 1 ? "métro · " : ""}${Math.round(hit.importance)} importance</span></button></li>`;
  }
  if (hit.kind === "poi") {
    return `<li><button type="button" data-index="${index}"><span>${escapeHtml(hit.poi.name)}</span><span class="meta">${escapeHtml(hit.poi.category || "Point important")} · popularité ${Math.round(hit.poi.popularity)}</span></button></li>`;
  }
  return `<li><button type="button" data-index="${index}"><span>${escapeHtml(hit.route.shortName)} · ${escapeHtml(hit.route.longName || hit.route.agencyName)}</span><span class="meta">ligne · ${Math.round(hit.importance)} importance</span></button></li>`;
}

function selectSearchHit(hit, destination) {
  if (!hit) return;
  if (hit.kind === "stop") {
    if (destination) pickDest(hit.stop);
    else openStop(hit.stop);
    return;
  }
  if (hit.kind === "route") {
    state.routeId = hit.route.id;
    renderLines();
    renderDue();
    return;
  }
  const point = { id: `poi:${hit.poi.id}`, name: hit.poi.name, lon: hit.poi.lon, lat: hit.poi.lat, routes: [], kind: 0 };
  if (destination) {
    pickDest(point);
    return;
  }
  const nearest = nearbyStops(liveStops(), point, 900, 1)[0];
  if (nearest) openStop(nearest);
  else applyHere(point.lon, point.lat, "map", Date.now(), true);
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
      return `<button type="button" class="${on}" role="option" data-id="${escapeHtml(line.routeId)}" style="background:${safeColor(line.color)};color:${safeColor(line.textColor, "#ffffff")}" title="${escapeHtml(line.shortName)}">${escapeHtml(line.shortName)}${kind ? ` <span class="meta">${kind}</span>` : ""}</button>`;
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
          <span class="badge" style="background:${safeColor(row.color)};color:${safeColor(row.textColor, "#ffffff")}">${escapeHtml(row.shortName)}</span>
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
  const origin = riderPoint();
  const stops = nearbyStops(liveStops(), origin, 700, 8);
  box.innerHTML = stops
    .map(
      (stop) =>
        `<li><button type="button" data-id="${escapeHtml(stop.id)}">${escapeHtml(stop.name)} <span class="meta">${formatMeters(stop.meters)}</span></button></li>`,
    )
    .join("");
  box.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => openStop(findStop(btn.dataset.id));
  });
}

async function loadBikes() {
  const spec = BIKE_FEEDS[state.city];
  const title = document.getElementById("bikes-title");
  if (title && spec) title.textContent = `${spec.label} près d'ici`;
  if (!spec) {
    state.bikes = [];
    renderBikes();
    return;
  }
  try {
    const discovery = await fetchJsonLimited(spec.gbfs, {}, 2 * 1024 * 1024);
    const origin = new URL(spec.gbfs).origin;
    const infoUrl = feedUrl(discovery, "station_information", origin);
    const statusUrl = feedUrl(discovery, "station_status", origin);
    if (!infoUrl || !statusUrl) {
      state.bikes = [];
      renderBikes();
      return;
    }
    const [info, status] = await Promise.all([
      fetchJsonLimited(infoUrl, {}, 4 * 1024 * 1024),
      fetchJsonLimited(statusUrl, {}, 4 * 1024 * 1024),
    ]);
    state.bikes = mergeStations(info, status, spec.system);
  } catch {
    state.bikes = [];
  }
  renderBikes();
}

function renderBikes() {
  const box = document.getElementById("bikes");
  if (!box) return;
  const racks = nearbyStations(state.bikes || [], riderPoint(), 500, 6);
  box.innerHTML = racks
    .map(
      (row) =>
        `<li>${escapeHtml(row.name)} <span class="meta">${formatMeters(row.meters)} · ${row.bikes} vélos · ${row.docks} places</span></li>`,
    )
    .join("");
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
  const live = state.here && state.here.source === "gps";
  if (!h || !live) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = `${h.cardinal} ${Math.round(h.degrees)}°`;
}

function applyHeading(sample) {
  if (!state.here || state.here.source !== "gps") return;
  const compass = headingFromSample(sample);
  if (!compass) return;
  state.heading = compass;
  paintHeading();
  requestDraw();
}

let headingListen = false;
function listenHeading() {
  if (headingListen) return;
  headingListen = true;
  const apply = (event) => {
    applyHeading({
      webkitCompassHeading: event.webkitCompassHeading,
      heading: event.webkitCompassHeading,
      alpha: event.absolute ? event.alpha : undefined,
    });
  };
  window.addEventListener("deviceorientationabsolute", apply, true);
  window.addEventListener("deviceorientation", apply, true);
}

function resetPermissions() {
  if (state.watchId != null && navigator.geolocation && typeof navigator.geolocation.clearWatch === "function") {
    navigator.geolocation.clearWatch(state.watchId);
  }
  state.watchId = null;
  headingListen = false;
  state.heading = null;
  state.rider = forgetInAppLocationGrant(state.rider);
  if (state.rider.here) {
    state.here = { lon: state.rider.here.lon, lat: state.rider.here.lat, source: state.rider.here.source, at: state.rider.here.at };
  } else {
    state.here = null;
  }
  paintHeading();
  paintGeoAsk(true);
  locate();
}

function askHeadingPermission() {
  const DOE = typeof DeviceOrientationEvent !== "undefined" ? DeviceOrientationEvent : null;
  if (DOE && typeof DOE.requestPermission === "function") {
    Promise.resolve(DOE.requestPermission())
      .then((status) => {
        if (status === "granted") listenHeading();
      })
      .catch(() => listenHeading());
    return;
  }
  listenHeading();
}

function applyHere(lon, lat, source, at, follow) {
  const stamp = source === "gps" ? Date.now() : at ?? Date.now();
  const prev = state.here;
  const next = acceptRiderFix(state.rider, { lon, lat, at: stamp, source: source || "gps" }, Date.now());
  if (!next.here) return;
  state.rider = next;
  state.here = { lon: next.here.lon, lat: next.here.lat, source: next.here.source, at: next.here.at };
  const moved = !prev || haversineMeters(prev, next.here) > 15;
  const snap = follow || !prev || moved || state.navigating;
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
  const city = detectCity(next.here.lon, next.here.lat);
  const go = () => {
    if (snap) {
      state.camera.lon = next.here.lon;
      state.camera.lat = next.here.lat;
      state.camera.zoom = Math.max(state.camera.zoom, 14.2);
    }
    renderNearby();
    renderLines();
    renderBikes();
    if (state.routeId) renderDue();
    if (state.dest) openPlan(state.dest, true);
    if (state.navigating) {
      state.camera.zoom = Math.max(state.camera.zoom, 15);
      paintNav();
      pulseFromTrip(currentTrip());
    }
    paintHeading();
    paintMapHud();
    requestDraw();
    if (snap) {
      scheduleBuildings();
      scheduleWeather();
    }
  };
  if (city && city !== state.city) {
     document.querySelectorAll("[data-city]").forEach((button) => button.classList.toggle("on", button.dataset.city === city));
    loadCity(city).then(go);
    return;
  }
  go();
}

function paintGeoAsk(needed) {
  const el = document.getElementById("geo-ask");
  if (!el) return;
  const gps = state.here && state.here.source === "gps";
  el.hidden = Boolean(gps) && needed !== true;
  if (!el.hidden) {
    el.textContent = navigator.geolocation
      ? "Autoriser la position — sinon le centre-ville est une fausse origine."
      : "Pas de géolocalisation sur cet appareil.";
  }
}

function locate() {
  const fallback = () => {
    paintGeoAsk(true);
    if (state.here && state.here.source === "gps") return;
    const center = state.atlas
      ? { lon: state.atlas.meta.center[0], lat: state.atlas.meta.center[1] }
      : state.camera;
    applyHere(center.lon, center.lat, "map");
  };
  if (!navigator.geolocation) {
    fallback();
    return;
  }
  askHeadingPermission();
  const onFix = (pos, follow) => {
    paintGeoAsk(false);
    applyHere(pos.coords.longitude, pos.coords.latitude, "gps", pos.timestamp || Date.now(), follow);
    applyHeading(pos.coords);
  };
  navigator.geolocation.getCurrentPosition((pos) => onFix(pos, true), fallback, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 20000,
  });
  if (state.watchId == null && typeof navigator.geolocation.watchPosition === "function") {
    state.watchId = navigator.geolocation.watchPosition((pos) => onFix(pos, false), () => paintGeoAsk(true), {
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 20000,
    });
  }
}

function safeColor(value, fallback = "#0071e3") {
  const color = typeof value === "string" ? value : "";
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : fallback;
}

function tripMix(trip) {
  if (trip.mix) return trip.mix;
  return mixLabel(trip.legs || []);
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
    <p class="lead">Le plus vite d'abord. Les autres disent combien de minutes de plus.</p>` +
    state.trips
      .map((trip, i) => {
        const on = i === state.tripIndex ? " on" : "";
        const mix = tripMix(trip);
        const gap = trip.gap > 0 ? `+${trip.gap} min de plus` : "Le plus vite";
        const legs = (trip.legs || [])
          .map((leg) => {
            if (leg.kind === "walk" || leg.kind === "bike" || leg.kind === "road") {
              const tag = leg.kind === "bike" ? "vélo" : leg.kind === "road" ? "auto" : "à pied";
              return `<div class="row"><span class="badge access">${tag}</span><div>${escapeHtml(leg.label || "")}</div></div>`;
            }
            return `<div class="row">
              <span class="badge" style="background:${safeColor(leg.color)};color:${safeColor(leg.textColor, "#ffffff")}">${escapeHtml(leg.shortName)}</span>
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
      requestDraw();
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
  const step = !leg ? tripMix(trip) : navStepLabel(leg);
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
  requestDraw();
}

function stopTrip() {
  state.navigating = false;
  paintNav();
  setSheetOpen(true);
  const trip = currentTrip();
  if (trip) fitTrip(trip);
  broadcastPulse(livePulseEnd());
  requestDraw();
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

function openPlan(destStop, quiet) {
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
  if (!quiet) bumpSheet();
  requestDraw();
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
                <span class="badge" style="background:${safeColor(row.color)};color:${safeColor(row.textColor, "#ffffff")}">${escapeHtml(row.shortName)}</span>
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
  bumpSheet();
  requestDraw();
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

let drawFrame = 0;
let mapBusy = false;
let mapBusyUntil = 0;
let paint = null;
let wheelIdle = 0;
let safariPinch = false;

function refreshPaint() {
  const css = getComputedStyle(document.documentElement);
  paint = {
    stage: css.getPropertyValue("--stage").trim() || "#d5dde4",
    ink: css.getPropertyValue("--ink").trim() || "#2b2723",
    gold: css.getPropertyValue("--gold").trim() || "#d97706",
    sodium: css.getPropertyValue("--sodium").trim() || "#0e7490",
    terra: css.getPropertyValue("--terra").trim() || "#6d5cae",
    night: document.documentElement.classList.contains("night"),
  };
  return paint;
}

function beginGesture() {
  mapBusy = true;
  mapBusyUntil = Date.now() + 120;
}

function endGesture() {
  mapBusyUntil = Date.now() + 80;
  setTimeout(() => {
    if (Date.now() < mapBusyUntil || pointers.size >= 2) return;
    mapBusy = false;
    requestDraw();
    scheduleBuildings();
  }, 90);
}

function requestDraw() {
  if (drawFrame) return;
  drawFrame = requestAnimationFrame(() => {
    drawFrame = 0;
    draw();
  });
}

function screenToWorld(sx, sy, cam, w, h) {
  const flat = invertPitch(sx, sy, w, h, cam.pitch || 0);
  const [cx, cy] = project(cam.lon, cam.lat);
  const scale = 2 ** cam.zoom * 256;
  const x = cx + (flat.x - w / 2) / scale;
  const y = cy + (flat.y - h / 2) / scale;
  const lon = x * 360 - 180;
  const n = Math.PI * (1 - 2 * y);
  const lat = (Math.atan(Math.sinh(n)) * 180) / Math.PI;
  return { lon, lat };
}

function zoomAt(sx, sy, nextZoom) {
  const zoom = Math.min(16.5, Math.max(10.2, nextZoom));
  const w = innerWidth;
  const h = innerHeight;
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(w) || !Number.isFinite(h)) {
    state.camera.zoom = zoom;
    return;
  }
  const hold = screenToWorld(sx, sy, state.camera, w, h);
  state.camera.zoom = zoom;
  const now = screenToWorld(sx, sy, state.camera, w, h);
  if (Number.isFinite(hold.lon) && Number.isFinite(now.lon)) {
    state.camera.lon += hold.lon - now.lon;
    state.camera.lat += hold.lat - now.lat;
  }
}

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  canvas.style.width = innerWidth + "px";
  canvas.style.height = innerHeight + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  requestDraw();
}

function drawPrecip(w, h) {
  if (!shouldDrawPrecip(state.weather)) return;
  const t = precipIntensity(state.weather);
  if (!(t > 0)) return;
  const night = document.documentElement.classList.contains("night");
  ctx.save();
  ctx.globalAlpha = 0.08 + t * 0.18;
  ctx.fillStyle = night ? "#6b8cac" : "#6a8eae";
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.22 + t * 0.35;
  ctx.strokeStyle = night ? "#9bb4c8" : "#4d6f88";
  ctx.lineWidth = 1;
  const step = Math.max(18, Math.round(36 - t * 14));
  const len = 7 + t * 10;
  for (let x = 8; x < w; x += step) {
    for (let y = (x % (step * 2)) - 12; y < h; y += step) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 2, y + len);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawHorizon(w, h) {
  const pitch = state.camera.pitch || 0;
  if (pitch <= 0) return;
  const y = horizonY(h, pitch);
  const night = document.documentElement.classList.contains("night");
  const sky = ctx.createLinearGradient(0, 0, 0, y);
  if (night) {
    sky.addColorStop(0, "#070b12");
    sky.addColorStop(1, "#141c28");
  } else {
    sky.addColorStop(0, "#8eb8d8");
    sky.addColorStop(1, getComputedStyle(document.documentElement).getPropertyValue("--stage").trim() || "#d5dde4");
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, Math.max(1, y + 1));
}

let showBusStops = false;
let showLocalRoutes = false;
let showMetroStops = true;
let heldLabels = new Set();
const labelQueue = [];
let labelBoxes = [];

function queueLabel(id, text, x, y, size, pri) {
  if (!id || !text) return;
  labelQueue.push({ id, text, x, y, size, pri });
}

function flushLabels(ink, zoom) {
  const held = heldLabels;
  labelQueue.sort((a, b) => {
    const ha = held.has(a.id) ? 1 : 0;
    const hb = held.has(b.id) ? 1 : 0;
    if (ha !== hb) return hb - ha;
    if (a.pri !== b.pri) return b.pri - a.pri;
    return String(a.id).localeCompare(String(b.id));
  });
  labelBoxes = [];
  const next = new Set();
  const cap = zoom < 12.6 ? 8 : zoom < 13.4 ? 18 : 56;
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.92;
  for (const c of labelQueue) {
    if (next.size >= cap && !held.has(c.id) && c.pri < 80) continue;
    const tw = String(c.text).length * c.size * 0.52;
    const th = c.size + 4;
    let hit = false;
    for (const box of labelBoxes) {
      if (c.x < box.x + box.w && c.x + tw > box.x && c.y - th < box.y + box.h && c.y > box.y) {
        hit = true;
        break;
      }
    }
    if (hit) continue;
    ctx.font = `${c.size}px "Rive Text", sans-serif`;
    ctx.fillText(c.text, c.x, c.y);
    labelBoxes.push({ x: c.x, y: c.y - th, w: tw, h: th });
    next.add(c.id);
  }
  heldLabels = next;
  labelQueue.length = 0;
  ctx.globalAlpha = 1;
}

function draw() {
  const w = innerWidth;
  const h = innerHeight;
  const cam = state.camera;
  const theme = paint || refreshPaint();
  const stage = theme.stage;
  const ink = theme.ink;
  const gold = theme.gold;
  const sodium = theme.sodium;
  const terra = theme.terra;
  ctx.fillStyle = stage;
  ctx.fillRect(0, 0, w, h);
  if (!mapBusy) drawHorizon(w, h);
  drawPrecip(w, h);
  labelQueue.length = 0;
  if (!state.atlas) return;
  const selected = new Set(state.stop?.routes || []);
  const pitch = cam.pitch || 0;
  const zoom = cam.zoom;
  if (zoom >= 13.05) showLocalRoutes = true;
  else if (zoom < 12.8) showLocalRoutes = false;
  if (zoom >= 13.15 || !state.sheetOpen) showBusStops = true;
  else if (zoom < 12.85 && state.sheetOpen) showBusStops = false;
  if (zoom >= 12.65 || !state.sheetOpen) showMetroStops = true;
  else if (zoom < 12.35 && state.sheetOpen) showMetroStops = false;
  const drawRouteSet = (onlyMetro, underground) => {
    for (const route of state.atlas.routes) {
      const metro = route.type === 1;
      const rail = route.type === 2;
      if (onlyMetro && !metro && !rail) continue;
      if (!onlyMetro && (metro || rail) && pitch > 0.15) continue;
      const frequent = metro || rail || /^80/.test(route.shortName);
      if (!frequent && (mapBusy || !showLocalRoutes) && !selected.has(route.id)) continue;
      ctx.strokeStyle = underground ? (document.documentElement.classList.contains("night") ? "#6b7280" : "#4b5563") : lineStrokeColor(route);
      ctx.globalAlpha = underground
        ? 0.55
        : selected.size && !selected.has(route.id)
          ? 0.12
          : frequent
            ? 0.9
            : 0.35;
      ctx.lineWidth = metro || rail ? (underground ? 3.4 : 4.4) : /^80/.test(route.shortName) ? 2.8 : 1.4;
      ctx.setLineDash(underground ? [5, 6] : []);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      const alt = underground ? METRO_DEPTH_M : 0;
      for (const dir of route.dirs) {
        const detour = (state.detours || []).find((d) => !d.routeId || d.routeId === route.id);
        const shape = (detour && detour.shape) || (state.shapePatches && state.shapePatches[route.id]);
        const line = overlayWithVehicles(dir.line, state.vehicles || [], route.id, shape);
        if (line.length < 2) continue;
        ctx.beginPath();
        line.forEach(([lon, lat], i) => {
          const [x, y] = worldToScreen(lon, lat, state.camera, w, h, alt);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  };
  if (!mapBusy && pitch > 0.15) drawRouteSet(true, true);
  drawAccessWays(w, h);
  drawBuildings(w, h);
  drawRouteSet(false, false);
  const trip = currentTrip();
  if (trip) {
    for (const leg of trip.legs || []) {
      const coords = Array.isArray(leg.line) && leg.line.length >= 2
        ? leg.line
        : leg.from && leg.to
          ? [[leg.from.lon, leg.from.lat], [leg.to.lon, leg.to.lat]]
          : [];
      if (coords.length < 2) continue;
      const tunnel = pitch > 0.15 && leg.kind === "transit" && leg.type === 1;
      ctx.beginPath();
      coords.forEach(([lon, lat], i) => {
        const [x, y] = worldToScreen(lon, lat, state.camera, w, h, tunnel ? METRO_DEPTH_M : 0);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      const stroke = tripStrokeStyle(leg);
      ctx.setLineDash(stroke.dash);
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.globalAlpha = 0.95;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const dest = state.dest;
    if (dest && Number.isFinite(dest.lon)) {
      const [dx, dy] = worldToScreen(dest.lon, dest.lat, cam, w, h);
      ctx.fillStyle = gold;
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
  for (const veh of mapBusy ? [] : state.vehicles || []) {
    const [vx, vy] = worldToScreen(veh.lon, veh.lat, cam, w, h);
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
  if (!mapBusy) {
    for (const poi of state.pois) {
      const [px, py] = worldToScreen(poi.lon, poi.lat, cam, w, h);
      if (px < -12 || py < -12 || px > w + 12 || py > h + 12) continue;
      ctx.fillStyle = state.theme === "night" ? "#c9b27a" : "#8a6a2f";
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(px, py, 3.2, 0, Math.PI * 2);
      ctx.fill();
      if (zoom >= 12.3 || heldLabels.has("poi:" + poi.name)) {
        queueLabel("poi:" + poi.name, poi.name, px + 6, py + 3, 11, 20);
      }
    }
  }
  ctx.globalAlpha = 1;
  if (state.here) {
    const [hx, hy] = worldToScreen(state.here.lon, state.here.lat, cam, w, h);
    ctx.fillStyle = sodium;
    ctx.beginPath();
    ctx.arc(hx, hy, 5, 0, Math.PI * 2);
    ctx.fill();
    if (state.here.source === "gps" && state.heading && Number.isFinite(state.heading.degrees)) {
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
    const [fx, fy] = worldToScreen(state.fusedVehicle.lon, state.fusedVehicle.lat, cam, w, h);
    ctx.fillStyle = terra;
    ctx.beginPath();
    ctx.arc(fx, fy, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  if (showMetroStops) {
    for (const stop of liveStops()) {
      if (stop.kind === 2) continue;
      if (!stop.temporary && state.timetable && !stopHasService(stop, state.timetable)) continue;
      if (stop.kind !== 1 && !showBusStops && !stop.temporary) continue;
      const picked = state.stop && state.stop.id === stop.id;
      const metro = stop.kind === 1;
      const temp = Boolean(stop.temporary);
      if (mapBusy && !picked && !metro && !temp) continue;
      const alt = temp ? 10 : 0;
      const [x, y] = worldToScreen(stop.lon, stop.lat, cam, w, h, alt);
      if (x < -10 || y < -10 || x > w + 10 || y > h + 10) continue;
      const r = temp ? 7 : picked ? 6.2 : metro ? 5.2 : 3.8;
      if (metro && pitch > 0.15 && !mapBusy) {
        const [ux, uy] = worldToScreen(stop.lon, stop.lat, cam, w, h, METRO_DEPTH_M);
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = document.documentElement.classList.contains("night") ? "#6b7280" : "#8b949e";
        ctx.lineWidth = 1.2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(ux, uy);
        ctx.stroke();
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(ux, uy, r * 0.85, 0, Math.PI * 2);
        ctx.fillStyle = "#1d1d1f";
        ctx.fill();
        ctx.strokeStyle = "#f0d060";
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = temp ? gold : picked ? gold : metro ? "#1d1d1f" : "#fff8ee";
      ctx.fill();
      ctx.lineWidth = temp ? 2.4 : metro ? 2 : 1.5;
      ctx.strokeStyle = temp ? "#1d1d1f" : picked ? "#1d1d1f" : metro ? "#f0d060" : "#2b2723";
      ctx.stroke();
      const wantLabel =
        picked ||
        temp ||
        (!mapBusy &&
          (metro || heldLabels.has(stop.id) || (!state.sheetOpen && zoom >= 13) || zoom >= 14.4));
      if (wantLabel) {
        const label = temp ? `${stop.name} · temporaire` : stop.name;
        queueLabel(stop.id, label, x + r + 3, y + 3, temp || metro ? 11 : 10, temp ? 110 : picked ? 100 : metro ? 70 : 40);
      }
    }
  }
  flushLabels(ink, zoom);
}

let buildingTimer = 0;
let buildingKey = "";
let buildingAbort = null;

function isMotionView() {
  return (state.here && state.here.source === "gps") || (state.camera.pitch || 0) > 0.2;
}

function motionCenter() {
  if (state.here && Number.isFinite(state.here.lat) && Number.isFinite(state.here.lon)) return state.here;
  return { lon: state.camera.lon, lat: state.camera.lat };
}

function viewBbox() {
  return motionViewBbox(motionCenter(), state.weather);
}

function buildingQueryAllowed() {
  return motionBuildingQueryAllowed(state.here, state.camera);
}

function scheduleBuildings() {
  clearTimeout(buildingTimer);
  buildingTimer = setTimeout(() => {
    loadBuildings();
    loadAccessWays();
  }, 280);
}

let weatherTimer = 0;
let weatherKey = "";
function scheduleWeather() {
  clearTimeout(weatherTimer);
  weatherTimer = setTimeout(loadWeather, 400);
}

async function loadWeather() {
  const c = motionCenter();
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return;
  const qlat = Math.round(c.lat * 50) / 50;
  const qlon = Math.round(c.lon * 50) / 50;
  const key = `${qlat},${qlon}`;
  if (key === weatherKey && state.weather) return;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${qlat}&longitude=${qlon}&current=temperature_2m,precipitation,rain,snowfall,weather_code,wind_speed_10m,wind_direction_10m,visibility,uv_index&hourly=visibility,weather_code,precipitation,uv_index&forecast_hours=6&timezone=America%2FMontreal`;
  const air = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${qlat}&longitude=${qlon}&current=european_aqi`;
  try {
    const [res, airRes] = await Promise.all([
      fetch(url, { redirect: "error" }),
      fetch(air, { redirect: "error" }).catch(() => null),
    ]);
    if (!res.ok) return;
    const parsed = weatherFromOpenMeteo(await readJsonResponseLimited(res, 256 * 1024));
    if (!parsed) return;
    if (airRes && airRes.ok) {
      try {
        const aq = await readJsonResponseLimited(airRes, 64 * 1024);
        const aqi = aq && aq.current && aq.current.european_aqi;
        if (aqi != null) parsed.european_aqi = aqi;
      } catch {
        /* AQI optional */
      }
    }
    state.weather = parsed;
    weatherKey = key;
    paintWx();
    scheduleBuildings();
    requestDraw();
  } catch {
    /* keep last weather or default vis */
  }
}

function paintWx() {
  const el = document.getElementById("wx");
  if (!el) return;
  const line = formatShownLine(shownConditions(state.weather));
  if (!line) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = line;
}

async function loadBuildings() {
  if (!buildingQueryAllowed()) return;
  if (!isMotionView() && state.camera.zoom < BUILDING_ZOOM - 0.85) {
    if (state.buildings.length) {
      state.buildings = [];
      buildingKey = "";
      requestDraw();
    }
    return;
  }
  if (!isMotionView() && state.camera.zoom < BUILDING_ZOOM) return;
  const pack = viewBbox();
  if (!pack) return;
  const center = motionCenter();
  const key = [
    center.lat,
    center.lon,
    Math.round(pack.extents.loadM),
    Math.round(pack.extents.continueM),
  ]
    .map((n) => Number(n).toFixed(3))
    .join(",");
  if (key === buildingKey) return;
  if (buildingAbort) buildingAbort.abort();
  buildingAbort = new AbortController();
  const query = overpassMotionQuery(center, pack.extents.loadM, pack.extents.continueM);
  if (!query) return;
  const body = overpassPostBody(query);
  for (const url of BUILDING_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body,
        signal: buildingAbort.signal,
        redirect: "error",
      });
      if (!res.ok) continue;
      const parsed = parseOverpassBuildings(await readJsonResponseLimited(res, 6 * 1024 * 1024), MOTION_BUILDING_CAP);
      if (!parsed.length) continue;
      parsed.sort((a, b) => b.ring[0][1] - a.ring[0][1]);
      state.buildings = parsed;
      buildingKey = key;
      requestDraw();
      return;
    } catch {
      /* try next mirror */
    }
  }
}

let accessKey = "";
let accessAbort = null;
async function loadAccessWays() {
  const c = motionCenter();
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return;
  const key = `${c.lat.toFixed(3)},${c.lon.toFixed(3)}`;
  if (key === accessKey) return;
  if (accessAbort) accessAbort.abort();
  accessAbort = new AbortController();
  const query = overpassAccessQuery(c, 700, 64);
  if (!query) return;
  const body = overpassPostBody(query);
  for (const url of BUILDING_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body,
        signal: accessAbort.signal,
        redirect: "error",
      });
      if (!res.ok) continue;
      const parsed = parseOverpassWays(await readJsonResponseLimited(res, 2 * 1024 * 1024), 64);
      state.ways = parsed;
      accessKey = key;
      requestDraw();
      return;
    } catch {
      /* try next mirror */
    }
  }
}

function drawAccessWays(w, h) {
  if (!state.ways || !state.ways.length || state.camera.zoom < 13.2) return;
  const night = document.documentElement.classList.contains("night");
  for (const way of state.ways) {
    if (!way.line || way.line.length < 2) continue;
    ctx.globalAlpha = night ? 0.28 : 0.22;
    ctx.strokeStyle = way.kind === "cycle" ? "#0e7490" : way.kind === "foot" ? "#6f675c" : "#8b949e";
    ctx.lineWidth = way.kind === "road" ? 1.5 : 1.1;
    ctx.beginPath();
    way.line.forEach(([lon, lat], i) => {
      const [x, y] = worldToScreen(lon, lat, state.camera, w, h, 0);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

const gpuLightState = { inflight: false, key: "", shades: null };

function observerForLight() {
  const here = state.here;
  if (here && Number.isFinite(here.lat) && Number.isFinite(here.lon)) return here;
  return { lon: state.camera.lon, lat: state.camera.lat };
}

function mapLightNow() {
  const here = observerForLight();
  const body = observerLight(here.lat, here.lon, new Date());
  if (!body) return { body: null, light: null };
  const heading = state.heading && Number.isFinite(state.heading.degrees) ? state.heading.degrees : null;
  return { body, light: lightVectorForMap(body.azimuth, body.altitude, heading) };
}

function drawBuildings(w, h) {
  if (!state.buildings.length) return;
  if (!isMotionView() && state.camera.zoom < BUILDING_ZOOM - 0.85) return;
  const night = document.documentElement.classList.contains("night");
  const wall = night ? "#2a3642" : "#b4a99a";
  const wallDark = night ? "#1c2530" : "#8f867a";
  const roof = night ? "#3a4754" : "#efe6d6";
  const edge = night ? "#121820" : "#6f675c";
  const { body, light } = mapLightNow();
  const jobs = [];
  const normals = [];
  for (const b of state.buildings) {
    const ground = b.ring.map(([lon, lat]) => worldToScreen(lon, lat, state.camera, w, h, 0));
    const top = b.ring.map(([lon, lat]) => worldToScreen(lon, lat, state.camera, w, h, b.heightM));
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const p of ground) {
      if (Number.isFinite(p[0]) && Number.isFinite(p[1])) {
        sx += p[0];
        sy += p[1];
        n += 1;
      }
    }
    const cx = n ? sx / n : 0;
    const cy = n ? sy / n : 0;
    const wallNormals = [];
    for (let i = 0; i < ground.length - 1; i++) {
      wallNormals.push(wallOutwardNormal(ground[i], ground[i + 1], cx, cy));
    }
    jobs.push({ ground, top, wallNormals });
    for (const normal of wallNormals) normals.push(normal || { x: 0, y: 0, z: 0 });
  }
  const shades = light ? shadeMany(light, normals) : normals.map(() => SHADE_AMBIENT);
  const cam = state.camera;
  const first = state.buildings[0] && state.buildings[0].ring && state.buildings[0].ring[0];
  const last = state.buildings[state.buildings.length - 1];
  const geom = `${state.buildings.length}:${first ? first[0] : 0}:${first ? first[1] : 0}:${last ? last.heightM : 0}:${normals.length}`;
  const lightPart = light && body
    ? `${body.source}:${light.x.toFixed(3)}:${light.y.toFixed(3)}:${light.z.toFixed(3)}`
    : "none";
  const key = `${lightPart}:${cam.lon}:${cam.lat}:${cam.zoom}:${cam.pitch || 0}:${w}x${h}:${geom}`;
  const gpu = globalThis.navigator && globalThis.navigator.gpu;
  const canGpu = metalShadeAvailable() || (gpu && typeof gpu.requestAdapter === "function");
  if (canGpu && light && normals.length && !gpuLightState.inflight && gpuLightState.key !== key) {
    gpuLightState.inflight = true;
    const want = key;
    computeWallShades(gpu, normals, light)
      .then((row) => {
        gpuLightState.inflight = false;
        if (!row || !row.shades || row.shades.length !== normals.length) return;
        gpuLightState.shades = row.shades;
        gpuLightState.key = want;
      })
      .catch(() => {
        gpuLightState.inflight = false;
      });
  }
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = edge;
  let si = 0;
  const roofShade = light ? shadeFactor(light, { x: 0, y: 0, z: 1 }) : SHADE_AMBIENT;
  for (const job of jobs) {
    for (let i = 0; i < job.ground.length - 1; i++) {
      ctx.fillStyle = mixHex(wallDark, wall, shades[si++] ?? 0.4);
      ctx.beginPath();
      ctx.moveTo(job.ground[i][0], job.ground[i][1]);
      ctx.lineTo(job.ground[i + 1][0], job.ground[i + 1][1]);
      ctx.lineTo(job.top[i + 1][0], job.top[i + 1][1]);
      ctx.lineTo(job.top[i][0], job.top[i][1]);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = mixHex(wallDark, roof, Math.max(roofShade, 0.32));
    ctx.beginPath();
    job.top.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

async function tryWebGPU() {
  const gpu = globalThis.navigator && globalThis.navigator.gpu;
  const el = document.getElementById("gpu");
  if (el) el.textContent = await probeGpuLabel(gpu);
  await acquireGpuDevice(gpu);
  try {
    await computeWallShades(gpu, [{ x: 1, y: 0, z: 0 }], { x: 1, y: 0, z: 0 });
  } catch {
    /* degrade */
  }
}

let drag = null;
const pointers = new Map();
let gestureZoom0 = 0;

function pointerSpan() {
  const pts = [...pointers.values()];
  if (pts.length < 2) return null;
  return {
    dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
    x: (pts[0].x + pts[1].x) / 2,
    y: (pts[0].y + pts[1].y) / 2,
  };
}

canvas.addEventListener("pointerdown", (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* iOS */
  }
  if (pointers.size >= 2) {
    beginGesture();
    const span = pointerSpan();
    drag = {
      mode: "pinch",
      dist: span ? span.dist : 1,
      x: span ? span.x : e.clientX,
      y: span ? span.y : e.clientY,
      zoom: state.camera.zoom,
      pitch: state.camera.pitch || 0,
      moved: 0,
    };
    return;
  }
  drag = {
    mode: e.shiftKey || e.altKey ? "tilt" : "pan",
    x: e.clientX,
    y: e.clientY,
    lon: state.camera.lon,
    lat: state.camera.lat,
    pitch: state.camera.pitch || 0,
    moved: 0,
  };
});
canvas.addEventListener("pointerup", (e) => {
  pointers.delete(e.pointerId);
  const tap = drag && drag.mode === "pan" && drag.moved < 8;
  const sx = e.clientX;
  const sy = e.clientY;
  if (pointers.size === 0) {
    endGesture();
    drag = null;
  } else if (pointers.size === 1) {
    const p = [...pointers.values()][0];
    drag = {
      mode: "pan",
      x: p.x,
      y: p.y,
      lon: state.camera.lon,
      lat: state.camera.lat,
      pitch: state.camera.pitch || 0,
      moved: 8,
    };
    endGesture();
  }
  if (tap) inspectMapPoint(sx, sy);
});
canvas.addEventListener("pointercancel", (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size === 0) {
    if (drag && drag.mode === "pinch") endGesture();
    drag = null;
  }
});
canvas.addEventListener("pointermove", (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!drag) return;
  if (drag.mode === "pinch") {
    beginGesture();
    const span = pointerSpan();
    if (!span) return;
    const ratio = span.dist / Math.max(1, drag.dist);
    zoomAt(span.x, span.y, drag.zoom + Math.log2(ratio));
    if (Math.abs(span.y - drag.y) > 10 && Math.abs(Math.log(ratio)) < 0.04) {
      setPitch(drag.pitch - (span.y - drag.y) / 260);
    }
    drag.moved = 16;
    requestDraw();
    return;
  }
  if (drag.mode === "tilt") {
    beginGesture();
    const dy = e.clientY - drag.y;
    drag.moved = Math.max(drag.moved || 0, Math.abs(dy));
    setPitch(drag.pitch - dy / 260);
    requestDraw();
    return;
  }
  beginGesture();
  drag.moved = Math.max(drag.moved || 0, Math.hypot(e.clientX - drag.x, e.clientY - drag.y));
  const scale = 256 * 2 ** state.camera.zoom;
  const dx = (e.clientX - drag.x) / scale;
  const dy = (e.clientY - drag.y) / scale;
  state.camera.lon = drag.lon - dx * 360;
  const cy = project(drag.lon, drag.lat)[1];
  const ny = cy - dy;
  const n = Math.PI * (1 - 2 * ny);
  state.camera.lat = (Math.atan(Math.sinh(n)) * 180) / Math.PI;
  requestDraw();
});
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (safariPinch) return;
    beginGesture();
    if (e.shiftKey) {
      setPitch((state.camera.pitch || 0) - e.deltaY * 0.002);
      requestDraw();
    } else {
      const step = e.ctrlKey ? 0.01 : 0.004;
      zoomAt(e.clientX, e.clientY, state.camera.zoom - e.deltaY * step);
      requestDraw();
    }
    clearTimeout(wheelIdle);
    wheelIdle = setTimeout(endGesture, 140);
  },
  { passive: false },
);
canvas.addEventListener(
  "touchmove",
  (e) => {
    e.preventDefault();
  },
  { passive: false },
);

function onSafariGesture(e) {
  e.preventDefault();
  if (e.type === "gesturestart") {
    safariPinch = true;
    beginGesture();
    gestureZoom0 = state.camera.zoom;
    return;
  }
  if (e.type === "gesturechange") {
    safariPinch = true;
    beginGesture();
    const x = Number.isFinite(e.clientX) ? e.clientX : innerWidth / 2;
    const y = Number.isFinite(e.clientY) ? e.clientY : innerHeight / 2;
    zoomAt(x, y, gestureZoom0 + Math.log2(e.scale || 1));
    requestDraw();
    return;
  }
  safariPinch = false;
  endGesture();
}
for (const ev of ["gesturestart", "gesturechange", "gestureend"]) {
  canvas.addEventListener(ev, onSafariGesture, { passive: false });
}

fetchJsonLimited(new URL("l10n/rive.json", import.meta.url), {}, 512 * 1024)
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
  })
  .catch(() => {});

bindCityButtons();
document.getElementById("here").onclick = () => locate();
document.getElementById("geo-ask").onclick = () => locate();
const perms = document.getElementById("perms");
if (perms) perms.onclick = () => resetPermissions();
document.getElementById("pitch").onclick = () => {
  const on = (state.camera.pitch || 0) > 0.2;
  setPitch(on ? 0 : 0.72);
  if (!on && state.camera.zoom < 13.2) state.camera.zoom = 13.4;
  scheduleBuildings();
  requestDraw();
};
document.getElementById("refresh").onclick = () => refreshFeeds(true);
document.getElementById("theme").onclick = () => applyTheme(state.theme === "night" ? "day" : "night");
document.getElementById("fold").onclick = () => {
  if (state.sheetOpen) minimizeSheet();
  else bumpSheet();
};
const sheetBody = document.getElementById("sheet-body");
if (sheetBody) {
  sheetBody.addEventListener("pointerdown", bumpSheet);
  sheetBody.addEventListener("focusin", bumpSheet);
  sheetBody.addEventListener("scroll", armSheetIdle, { passive: true });
}
document.getElementById("dest").addEventListener("focus", bumpSheet);
document.getElementById("q").addEventListener("focus", bumpSheet);
const atInput = document.getElementById("at");
if (atInput) atInput.addEventListener("change", () => {
  fillClockInput();
  if (state.routeId) renderDue();
  if (state.dest) openPlan(state.dest);
  else if (state.stop) openStop(state.stop);
});
document.getElementById("at").addEventListener("blur", () => fillClockInput());
document.getElementById("q").addEventListener("input", (e) => {
  state.query = e.target.value;
  renderHits();
  bumpSheet();
});
document.getElementById("q").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const first = searchPlaces(state.atlas, state.query, 1)[0];
  if (first) selectSearchHit(first, false);
});
document.getElementById("dest").addEventListener("input", (e) => {
  state.destQuery = e.target.value;
  renderDestHits();
  bumpSheet();
});
document.getElementById("dest").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const first = searchPlaces(state.atlas, state.destQuery, 1)[0];
  if (first) selectSearchHit(first, true);
});

function switchCity(city) {
  if (typeof city !== "string" || city.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(city)) return;
  document.querySelectorAll("[data-city]").forEach((button) => button.classList.toggle("on", button.dataset.city === city));
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
const requestedCity = boot.get("city") || "";
const bootCity = requestedCity.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedCity) ? requestedCity : "quebec";
const bootStop = boot.get("stop");
document.querySelectorAll("[data-city]").forEach((button) => button.classList.toggle("on", button.dataset.city === bootCity));
fillClockInput();
applyTheme();
listenHeading();
paintHeading();
paintGeoAsk(true);
loadCity(bootCity).then(() => {
  if (bootStop && state.atlas) {
    const hit = state.atlas.stops.find((s) => s.id === bootStop);
    if (hit) openStop(hit);
  }
  locate();
});
loadCityIndex();
