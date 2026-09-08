/* Current rider weather. Junk does not invent UV or AQI. Apache-2.0. */

const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function num(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asRecord(value) {
  return value && typeof value === "object" ? value : null;
}

function hourlySum(hourly, key, n) {
  if (!hourly) return null;
  const list = hourly[key];
  if (!Array.isArray(list)) return null;
  let sum = 0;
  let saw = false;
  for (const item of list.slice(0, n == null ? 3 : n)) {
    const v = num(item);
    if (v == null) continue;
    sum += v;
    saw = true;
  }
  return saw ? sum : null;
}

function flatten(raw) {
  const root = asRecord(raw);
  if (!root) return {};
  const current = asRecord(root.current) || {};
  return { ...current, ...root };
}

function windCardinal(deg) {
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return CARDINALS[i];
}

function roadFrom(precipMm, tempC, rain, snow) {
  const wet = (precipMm != null && precipMm > 0.1) || (rain != null && rain > 0) || (snow != null && snow > 0);
  if (tempC != null && tempC <= 0.5 && wet) return "icy";
  if (wet) return "wet";
  if (tempC != null || precipMm != null || rain != null || snow != null) return "dry";
  return null;
}

export function decodeConditions(raw) {
  const src = flatten(raw);
  const hourly = asRecord(src.hourly);
  const precipMm = num(src.precipitation ?? src.precipMm ?? src.precip);
  const rain = num(src.rain);
  const snow = num(src.snowfall);
  const precipAccumMm = hourlySum(hourly, "precipitation", 3);
  const uv = num(src.uv_index ?? src.uvIndex ?? src.uv);
  const aqi = num(src.european_aqi ?? src.us_aqi ?? src.aqi);
  const windKmh = num(src.wind_speed_10m ?? src.windKmh ?? src.wind);
  const windDeg = num(src.wind_direction_10m ?? src.windDeg);
  const tempC = num(src.temperature_2m ?? src.tempC ?? src.temperature);
  return {
    precipMm,
    precipAccumMm,
    uv,
    aqi,
    windKmh,
    windDeg,
    tempC,
    road: roadFrom(precipMm, tempC, rain, snow),
  };
}

export function shownConditions(raw) {
  const c = decodeConditions(raw);
  const out = {};
  const falling = c.precipMm != null && c.precipMm > 0.05;
  const accumulating = c.precipAccumMm != null && c.precipAccumMm > 0.2;
  if (falling || accumulating) {
    const mm = falling ? c.precipMm : c.precipAccumMm;
    out.precip = `${mm.toFixed(1)} mm`;
  }
  if (c.uv != null && c.uv >= 3) out.uv = String(Math.round(c.uv));
  if (c.aqi != null && c.aqi >= 50) out.aqi = String(Math.round(c.aqi));
  if (c.windKmh != null && c.windKmh >= 15) {
    const dir = c.windDeg != null ? ` ${windCardinal(c.windDeg)}` : "";
    out.wind = `${Math.round(c.windKmh)} km/h${dir}`;
  }
  if (c.road === "wet") out.road = "mouillée";
  if (c.road === "icy") out.road = "glissante";
  return out;
}

export function shouldDrawPrecip(raw) {
  return Boolean(shownConditions(raw).precip);
}

export function precipIntensity(raw) {
  const c = decodeConditions(raw);
  const mm = Math.max(c.precipMm ?? 0, (c.precipAccumMm ?? 0) / 3);
  if (!(mm > 0.05)) return 0;
  return Math.min(1, mm / 4);
}

export function formatShownLine(shown) {
  const bits = [];
  if (shown.precip) bits.push(`pluie ${shown.precip}`);
  if (shown.road) bits.push(`chaussée ${shown.road}`);
  if (shown.wind) bits.push(`vent ${shown.wind}`);
  if (shown.uv) bits.push(`UV ${shown.uv}`);
  if (shown.aqi) bits.push(`AQI ${shown.aqi}`);
  return bits.join("  ·  ");
}
