import { remainMinutes, watchPulseFromPayload } from "./rive-kit.js";

function minutesNow() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Montreal",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  return (
    Number(parts.find((p) => p.type === "hour")?.value) * 60 +
    Number(parts.find((p) => p.type === "minute")?.value)
  );
}

function readLive() {
  try {
    const q = new URLSearchParams(location.search);
    const bounded = (value, max) => (value && value.length <= max ? value : "");
    const stop = bounded(q.get("s") || "", 160);
    const route = bounded(q.get("r") || "", 160);
    const color = bounded(q.get("k") || "", 32);
    const clocks = bounded(q.get("t") || "", 1024);
    const departs = bounded(q.get("m") || "", 1024);
    if (stop || route || departs) {
      return watchPulseFromPayload({ s: stop, r: route, k: color, t: clocks, m: departs });
    }
    return watchPulseFromPayload(localStorage.getItem("rive.live"));
  } catch {
    return null;
  }
}

function paint() {
  try {
    const live = readLive();
    if (!live) return;
    document.getElementById("route").textContent = live.route || "Rive";
    document.getElementById("route").style.color = live.color || "#fff";
    const wait = remainMinutes(live.departs || [], minutesNow());
    document.getElementById("remain").textContent = wait == null ? "—" : wait === 0 ? "now" : String(wait);
    document.getElementById("clocks").textContent = (live.clocks || []).slice(0, 4).join("  ") || "—";
    document.getElementById("stop").textContent = live.stop || "";
  } catch {
    /* stay on the empty face */
  }
}

paint();
setInterval(paint, 15000);
