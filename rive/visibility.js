/* Meteorological visibility → motion-view load / continue extents. Apache-2.0. */

export const DEFAULT_VISIBILITY_M = 8000;
export const MIN_VISIBILITY_M = 120;
export const MAX_VISIBILITY_M = 20000;
export const LOAD_BUFFER = 1.12;
export const CONTINUE_PAST = 1.35;
export const BBOX_QUANTIZE_DEG = 0.008;

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function asFinitePositive(value) {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function readVisibilityM(row) {
  if (!row || typeof row !== "object") return null;
  const meters = asFinitePositive(row.visibilityM) ?? asFinitePositive(row.visibility_m);
  if (meters != null && meters <= 50000) return clamp(meters, MIN_VISIBILITY_M, MAX_VISIBILITY_M);
  const vis = asFinitePositive(row.visibility);
  if (vis != null && vis <= 50000) {
    return clamp(vis > 80 ? vis : vis * 1000, MIN_VISIBILITY_M, MAX_VISIBILITY_M);
  }
  const km = asFinitePositive(row.visibilityKm) ?? asFinitePositive(row.visibility_km);
  if (km != null && km <= 50) return clamp(km * 1000, MIN_VISIBILITY_M, MAX_VISIBILITY_M);
  return null;
}

function conditionVisibilityM(row) {
  if (!row || typeof row !== "object") return null;
  const code = asFinitePositive(row.weatherCode ?? row.weather_code);
  if (code != null) {
    const c = Math.round(code);
    if (c === 45 || c === 48) return 400;
    if (c >= 71 && c <= 77) return 1500;
    if (c >= 85 && c <= 86) return 1500;
    if (c >= 51 && c <= 67) return 5000;
    if (c >= 80 && c <= 82) return 5000;
    if (c >= 95) return 3000;
    if (c <= 1) return 16000;
    if (c <= 3) return 10000;
  }
  const raw = row.condition ?? row.weather ?? row.text;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const c = raw.toLowerCase();
  if (/fog|brouillard|brume épaisse/.test(c)) return 400;
  if (/mist|brume|haze|fumée|smoke/.test(c)) return 2500;
  if (/blizzard|snow|neige/.test(c)) return 1500;
  if (/thunder|orage/.test(c)) return 3000;
  if (/rain|drizzle|averse|pluie/.test(c)) return 5000;
  if (/clear|sunny|fair|ciel dégagé|clear sky/.test(c)) return 16000;
  if (/cloud|overcast|couvert|nuage/.test(c)) return 10000;
  return null;
}

export function visibilityMetersFromWeather(weather) {
  const vis = readVisibilityM(weather);
  if (vis != null) return vis;
  const forecast = weather && typeof weather === "object" ? weather.forecast : null;
  const fvis = readVisibilityM(forecast);
  if (fvis != null) return fvis;
  const fromCond = conditionVisibilityM(weather) ?? conditionVisibilityM(forecast);
  if (fromCond != null) return fromCond;
  return DEFAULT_VISIBILITY_M;
}

export function loadExtentMeters(visibilityM) {
  const vis =
    typeof visibilityM === "number" && Number.isFinite(visibilityM) && visibilityM > 0
      ? clamp(visibilityM, MIN_VISIBILITY_M, MAX_VISIBILITY_M)
      : DEFAULT_VISIBILITY_M;
  return vis * LOAD_BUFFER;
}

export function continueExtentMeters(visibilityM) {
  return loadExtentMeters(visibilityM) * CONTINUE_PAST;
}

export function motionViewExtents(weather) {
  const visibilityM = visibilityMetersFromWeather(weather);
  const loadM = loadExtentMeters(visibilityM);
  const continueM = continueExtentMeters(visibilityM);
  return { visibilityM, loadM, continueM };
}

export function bboxFromRadiusM(center, radiusM) {
  const lat = Number(center && center.lat);
  const lon = Number(center && center.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (!Number.isFinite(radiusM) || radiusM <= 0) return null;
  const dLat = radiusM / 111320;
  const cos = Math.cos((lat * Math.PI) / 180);
  const dLon = radiusM / (111320 * Math.max(0.12, Math.abs(cos)));
  return {
    south: clamp(lat - dLat, -90, 90),
    north: clamp(lat + dLat, -90, 90),
    west: clamp(lon - dLon, -180, 180),
    east: clamp(lon + dLon, -180, 180),
  };
}

export function quantizeBbox(bbox, stepDeg) {
  if (!bbox) return null;
  const step = Number.isFinite(stepDeg) && stepDeg > 0 ? stepDeg : BBOX_QUANTIZE_DEG;
  const qDown = (n) => Math.floor(n / step) * step;
  const qUp = (n) => Math.ceil(n / step) * step;
  const south = qDown(bbox.south);
  const west = qDown(bbox.west);
  const north = qUp(bbox.north);
  const east = qUp(bbox.east);
  if (!(south < north) || !(west < east)) return null;
  return {
    south: clamp(south, -90, 90),
    north: clamp(north, -90, 90),
    west: clamp(west, -180, 180),
    east: clamp(east, -180, 180),
  };
}

export function motionViewBbox(center, weather) {
  const extents = motionViewExtents(weather);
  const inner = quantizeBbox(bboxFromRadiusM(center, extents.loadM));
  const outer = quantizeBbox(bboxFromRadiusM(center, extents.continueM));
  if (!inner || !outer) return null;
  return { inner, outer, extents };
}

export function motionBuildingQueryAllowed(here, camera) {
  void here;
  void camera;
  return true;
}

export function bboxSpanMeters(bbox, lat) {
  const northSouth = Math.abs(bbox.north - bbox.south) * 111320;
  const cos = Math.cos((lat * Math.PI) / 180);
  const westEast = Math.abs(bbox.east - bbox.west) * 111320 * Math.max(0.12, Math.abs(cos));
  return { northSouth, westEast };
}

export function weatherFromOpenMeteo(raw) {
  if (!raw || typeof raw !== "object") return null;
  const current = raw.current && typeof raw.current === "object" ? raw.current : null;
  const hourly = raw.hourly && typeof raw.hourly === "object" ? raw.hourly : null;
  const visList = hourly && Array.isArray(hourly.visibility) ? hourly.visibility : [];
  const codeList = hourly && Array.isArray(hourly.weather_code) ? hourly.weather_code : [];
  const forecastVis = visList.length ? visList[Math.min(1, visList.length - 1)] : undefined;
  const forecastCode = codeList.length ? codeList[Math.min(1, codeList.length - 1)] : undefined;
  const visibilityM = current ? current.visibility : undefined;
  const weatherCode = current ? current.weather_code : undefined;
  if (visibilityM == null && weatherCode == null && forecastVis == null && forecastCode == null && !current) return null;
  return {
    visibilityM,
    weatherCode,
    precipitation: current ? current.precipitation : undefined,
    rain: current ? current.rain : undefined,
    snowfall: current ? current.snowfall : undefined,
    uv_index: current ? current.uv_index : undefined,
    european_aqi: current ? current.european_aqi : undefined,
    us_aqi: current ? current.us_aqi : undefined,
    wind_speed_10m: current ? current.wind_speed_10m : undefined,
    wind_direction_10m: current ? current.wind_direction_10m : undefined,
    temperature_2m: current ? current.temperature_2m : undefined,
    hourly: hourly || undefined,
    forecast: { visibilityM: forecastVis, weatherCode: forecastCode },
  };
}
