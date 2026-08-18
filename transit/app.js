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
  stop: null,
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
    const name = fold(stop.name);
    const code = fold(stop.code || "");
    const tokens = q.split(/\s+/).filter((t) => t.length > 2);
    const hay = ` ${name} ${code} `;
    const tokenHits = tokens.filter((t) => hay.includes(` ${t} `)).length;
    let score = -1;
    if (code && code === q) score = 190;
    else if (name === q) score = 180;
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

function formatClock(minutes) {
  const wrap = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrap / 60);
  const m = wrap % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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
  document.getElementById("attr").textContent = atlas.meta.attribution;
  draw();
}

function renderHits() {
  const box = document.getElementById("hits");
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function openStop(stop) {
  if (!stop) return;
  state.stop = stop;
  state.camera.lon = stop.lon;
  state.camera.lat = stop.lat;
  state.camera.zoom = Math.max(state.camera.zoom, 14.2);
  const now = minutesOfDay(new Date());
  const active = activeServiceIndexes(state.atlas, new Date());
  const rows = scheduleAtStop(state.atlas, state.timetable, stop, now, active);
  const board = document.getElementById("board");
  board.hidden = false;
  const watchHref = watchUrl(stop, rows);
  board.innerHTML = `<h2>${escapeHtml(stop.name)}</h2>
    <p class="lead">Prochains passages ici. Tu n'as pas besoin d'être sur le quai.</p>
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
  ctx.fillStyle = "#e8eaed";
  ctx.fillRect(0, 0, w, h);
  if (!state.atlas) return;
  const selected = new Set(state.stop?.routes || []);
  for (const route of state.atlas.routes) {
    const frequent = route.type === 1 || /^80/.test(route.shortName);
    if (!frequent && state.camera.zoom < 13 && !selected.has(route.id)) continue;
    ctx.strokeStyle = route.color;
    ctx.globalAlpha = selected.size && !selected.has(route.id) ? 0.12 : frequent ? 0.9 : 0.35;
    ctx.lineWidth = route.type === 1 ? 4.4 : /^80/.test(route.shortName) ? 2.8 : 1.4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const dir of route.dirs) {
      const line = decodePolyline(dir.line);
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
  if (state.camera.zoom >= 13.4) {
    for (const stop of state.atlas.stops) {
      if (stop.kind === 2) continue;
      if (state.camera.zoom < 14.2 && stop.kind !== 1) continue;
      const [x, y] = worldToScreen(stop.lon, stop.lat, state.camera, w, h);
      if (x < -8 || y < -8 || x > w + 8 || y > h + 8) continue;
      ctx.fillStyle = state.stop && state.stop.id === stop.id ? "#e3a21c" : "#e7eef3";
      ctx.beginPath();
      ctx.arc(x, y, stop.kind === 1 ? 4.2 : 2.2, 0, Math.PI * 2);
      ctx.fill();
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
    document.querySelector(".sheet h1").textContent = t.elsewhere;
    document.querySelector(".sheet .lead").textContent = t.elsewhereLead;
    document.getElementById("q").placeholder = t.placeholder;
    document.getElementById("btn-quebec").textContent = t.quebec;
    document.getElementById("btn-montreal").textContent = t.montreal;
  })
  .catch(() => {});

document.getElementById("btn-quebec").onclick = () => switchCity("quebec");
document.getElementById("btn-montreal").onclick = () => switchCity("montreal");
document.getElementById("q").addEventListener("input", (e) => {
  state.query = e.target.value;
  renderHits();
});
document.getElementById("q").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const first = searchStops(state.atlas, state.query, 1)[0];
  if (first) openStop(first);
});

function switchCity(city) {
  document.getElementById("btn-quebec").classList.toggle("on", city === "quebec");
  document.getElementById("btn-montreal").classList.toggle("on", city === "montreal");
  state.stop = null;
  document.getElementById("board").hidden = true;
  document.getElementById("q").value = "";
  state.query = "";
  document.getElementById("hits").innerHTML = "";
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
loadCity(bootCity).then(() => {
  if (!bootStop || !state.atlas) return;
  const hit = state.atlas.stops.find((s) => s.id === bootStop);
  if (hit) openStop(hit);
});
