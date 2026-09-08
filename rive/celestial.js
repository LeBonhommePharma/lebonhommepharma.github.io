/* Local sun/moon azimuth and altitude. NOAA/Meeus-style. Apache-2.0. */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function asDate(time) {
  if (time instanceof Date) return Number.isFinite(time.getTime()) ? time : null;
  if (typeof time === "number" && Number.isFinite(time)) {
    const d = new Date(time);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  if (typeof time === "string" && time.trim() !== "") {
    const d = new Date(time);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}

function asLatLon(lat, lon) {
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

function normDeg(deg) {
  return ((deg % 360) + 360) % 360;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function julianDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

function centuries(jd) {
  return (jd - 2451545) / 36525;
}

function gmstDegrees(jd) {
  const T = centuries(jd);
  const theta = 280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T - (T * T * T) / 38710000;
  return normDeg(theta);
}

function obliquityRad(T) {
  return (23.439291 - 0.0130042 * T) * DEG;
}

function eclipticToRaDec(lonDeg, latDeg, T) {
  const eps = obliquityRad(T);
  const lam = lonDeg * DEG;
  const bet = latDeg * DEG;
  const sinEps = Math.sin(eps);
  const cosEps = Math.cos(eps);
  const sinLam = Math.sin(lam);
  const cosLam = Math.cos(lam);
  const sinBet = Math.sin(bet);
  const cosBet = Math.cos(bet);
  const ra = Math.atan2(sinLam * cosEps - Math.tan(bet) * sinEps, cosLam);
  const dec = Math.asin(clamp(sinBet * cosEps + cosBet * sinEps * sinLam, -1, 1));
  return { ra: normDeg(ra * RAD), dec: dec * RAD };
}

function horizontalFromRaDec(lat, lon, raDeg, decDeg, jd) {
  const lst = normDeg(gmstDegrees(jd) + lon);
  const H = (lst - raDeg) * DEG;
  const phi = lat * DEG;
  const dec = decDeg * DEG;
  const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
  const altitude = Math.asin(clamp(sinAlt, -1, 1)) * RAD;
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { azimuth: normDeg(az * RAD + 180), altitude };
}

function sunEcliptic(T) {
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * DEG;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * M) +
    0.000289 * Math.sin(3 * M);
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * DEG);
  return { lon: normDeg(lambda), lat: 0 };
}

function moonEcliptic(T) {
  const Lp = 218.3164477 + 481267.88123421 * T;
  const D = (297.8501921 + 445267.1114034 * T) * DEG;
  const Ms = (357.5291092 + 35999.0502909 * T) * DEG;
  const Mp = (134.9633964 + 477198.8675055 * T) * DEG;
  const F = (93.272095 + 483202.0175233 * T) * DEG;
  const lon =
    Lp +
    6.288774 * Math.sin(Mp) +
    1.274027 * Math.sin(2 * D - Mp) +
    0.658314 * Math.sin(2 * D) +
    0.213618 * Math.sin(2 * Mp) -
    0.185116 * Math.sin(Ms) -
    0.114332 * Math.sin(2 * F) +
    0.058793 * Math.sin(2 * D - 2 * Mp) +
    0.057102 * Math.sin(2 * D - Ms - Mp) +
    0.053322 * Math.sin(2 * D + Mp) +
    0.045758 * Math.sin(2 * D - Ms) -
    0.040923 * Math.sin(Ms - Mp) -
    0.03472 * Math.sin(D) -
    0.030383 * Math.sin(Ms + Mp) +
    0.015327 * Math.sin(2 * D - 2 * F) -
    0.012528 * Math.sin(Mp + 2 * F) +
    0.01098 * Math.sin(Mp - 2 * F);
  const lat =
    5.128122 * Math.sin(F) +
    0.280606 * Math.sin(Mp + F) +
    0.277693 * Math.sin(Mp - F) +
    0.173238 * Math.sin(2 * D - F) +
    0.055413 * Math.sin(2 * D - Mp + F) +
    0.046272 * Math.sin(2 * D - Mp - F) +
    0.032573 * Math.sin(2 * D + F) +
    0.017198 * Math.sin(2 * Mp + F) +
    0.009267 * Math.sin(2 * D + Mp - F) +
    0.008823 * Math.sin(2 * Mp - F);
  return { lon: normDeg(lon), lat };
}

function bodyHorizontal(lat, lon, date, ecliptic) {
  const jd = julianDate(date);
  const T = centuries(jd);
  const ecl = ecliptic(T);
  const eq = eclipticToRaDec(ecl.lon, ecl.lat, T);
  return horizontalFromRaDec(lat, lon, eq.ra, eq.dec, jd);
}

export function sunAzAlt(lat, lon, time) {
  const ll = asLatLon(lat, lon);
  const date = asDate(time);
  if (!ll || !date) return null;
  return bodyHorizontal(ll.lat, ll.lon, date, sunEcliptic);
}

export function moonAzAlt(lat, lon, time) {
  const ll = asLatLon(lat, lon);
  const date = asDate(time);
  if (!ll || !date) return null;
  return bodyHorizontal(ll.lat, ll.lon, date, moonEcliptic);
}

export function moonRiseSet(lat, lon, around) {
  const ll = asLatLon(lat, lon);
  const date = asDate(around);
  if (!ll || !date) return null;
  const start = date.getTime() - 6 * 3600 * 1000;
  const end = start + 36 * 3600 * 1000;
  const step = 2 * 60 * 1000;
  const first = moonAzAlt(ll.lat, ll.lon, start);
  if (!first) return null;
  let prevT = start;
  let prevAlt = first.altitude;
  let rise = null;
  let set = null;
  for (let t = start + step; t <= end; t += step) {
    const row = moonAzAlt(ll.lat, ll.lon, t);
    if (!row) continue;
    const alt = row.altitude;
    if (prevAlt < 0 && alt >= 0 && !rise) {
      rise = interpolateZero(prevT, prevAlt, t, alt);
    } else if (prevAlt >= 0 && alt < 0 && rise && !set) {
      const crossed = interpolateZero(prevT, prevAlt, t, alt);
      if (crossed && crossed.getTime() > rise.getTime()) {
        set = crossed;
        break;
      }
    }
    prevT = t;
    prevAlt = alt;
  }
  return { rise, set };
}

function interpolateZero(t0, a0, t1, a1) {
  const span = a1 - a0;
  const f = Math.abs(span) < 1e-9 ? 0 : (0 - a0) / span;
  return new Date(t0 + clamp(f, 0, 1) * (t1 - t0));
}

export function observerLight(lat, lon, time) {
  const sun = sunAzAlt(lat, lon, time);
  if (!sun) return null;
  if (sun.altitude > 0) return { source: "sun", azimuth: sun.azimuth, altitude: sun.altitude };
  const moon = moonAzAlt(lat, lon, time);
  if (!moon) return null;
  if (moon.altitude > 0) return { source: "moon", azimuth: moon.azimuth, altitude: moon.altitude };
  return null;
}
