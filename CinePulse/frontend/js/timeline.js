// Timeline multi-pistes : zoom molette, tête de lecture, clips déplaçables/rognables, magnétisme, dépôt depuis la Soundboard.
import { state, on, emit, TRACKS, trackOf, uid, round3, clamp, clipEnd, projectEnd, overlaps, setPlayhead } from "./state.js";
import { snapTargets, snapValue } from "./snap.js";
import { fmtMs, fmtRuler } from "./format.js";
import { getPeaks, drawPeaks } from "./waveform.js";
import { selectClip, toggleSnap } from "./edit.js";
import { toast } from "./ui.js";

const HEADER_W = 132;
const SNAP_PX = 10;               // rayon d'aimantation à l'écran, indépendant du zoom
const MIN_PPS = 2, MAX_PPS = 40000; // 40 000 px/s = 40 px par milliseconde
const MIN_DUR = 0.01;
// [pas principal en s, subdivisions]
const STEPS = [[0.001, 5], [0.002, 4], [0.005, 5], [0.01, 5], [0.02, 4], [0.05, 5], [0.1, 5], [0.2, 4], [0.5, 5],
  [1, 5], [2, 4], [5, 5], [10, 5], [15, 3], [30, 6], [60, 6], [120, 4], [300, 5], [600, 5]];

let scroller, content, ruler, playheadEl, guideEl, markersEl, tip, zoomInput, snapBtn;
const lanes = {};
let ghost = null;

export function initTimeline(root) {
  root.innerHTML = `
    <div class="tl-bar">
      <span class="panel-title-inline">Timeline</span>
      <button id="tl-snap" title="Magnétisme (N) — Alt pendant le glisser pour l'ignorer">🧲 Magnétisme</button>
      <span class="spacer"></span>
      <button id="tl-zout" title="Zoom arrière (-)">−</button>
      <input id="tl-zoom" type="range" min="0" max="1000" step="1" title="Zoom (molette sur la timeline)">
      <button id="tl-zin" title="Zoom avant (+)">+</button>
      <button id="tl-fit" title="Tout afficher">Ajuster</button>
      <span class="dim" id="tl-scale"></span>
    </div>
    <div class="tl-scroll"><div class="tl-content">
      <div class="tl-ruler-row"><div class="tl-corner"></div><canvas class="tl-ruler"></canvas></div>
      ${TRACKS.map((t) => `<div class="tl-row ${t.type}" data-track="${t.id}">
          <div class="tl-head"><b>${t.label}</b><span>${t.type === "video" ? "Vidéo" : "Audio"}</span></div>
          <div class="tl-lane" data-track="${t.id}"></div></div>`).join("")}
      <div class="tl-overlay"><div class="tl-markers"></div><div class="tl-guide"></div><div class="tl-playhead"></div></div>
    </div></div>`;
  scroller = root.querySelector(".tl-scroll");
  content = root.querySelector(".tl-content");
  ruler = root.querySelector(".tl-ruler");
  playheadEl = root.querySelector(".tl-playhead");
  guideEl = root.querySelector(".tl-guide");
  markersEl = root.querySelector(".tl-markers");
  zoomInput = root.querySelector("#tl-zoom");
  snapBtn = root.querySelector("#tl-snap");
  for (const t of TRACKS) lanes[t.id] = root.querySelector(`.tl-lane[data-track="${t.id}"]`);
  tip = document.createElement("div");
  tip.className = "tl-tip hidden";
  document.body.append(tip);

  snapBtn.onclick = toggleSnap;
  root.querySelector("#tl-zin").onclick = () => zoomBy(1.5);
  root.querySelector("#tl-zout").onclick = () => zoomBy(1 / 1.5);
  root.querySelector("#tl-fit").onclick = fit;
  zoomInput.oninput = () => setZoom(sliderToPps(+zoomInput.value), viewW() / 2);

  scroller.addEventListener("wheel", onWheel, { passive: false });
  scroller.addEventListener("scroll", () => { drawRuler(); });
  new ResizeObserver(() => { layout(); drawRuler(); }).observe(scroller);
  ruler.addEventListener("pointerdown", onRulerDown);
  scroller.addEventListener("pointerdown", onClipDown);
  scroller.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".clip") && e.target.closest(".tl-lane")) selectClip(null);
  });
  for (const t of TRACKS) wireLaneDrop(lanes[t.id], t);

  on((type) => {
    if (type === "clips" || type === "assets") { layout(); renderClips(); drawRuler(); updateOverlay(); }
    else if (type === "select") renderSelection();
    else if (type === "playhead" || type === "seek") updatePlayhead();
    else if (type === "markers") { drawRuler(); updateOverlay(); }
    else if (type === "snap") snapBtn.classList.toggle("on", state.snap);
  });
  layout(); renderClips(); drawRuler(); updateOverlay(); updatePlayhead();
  snapBtn.classList.toggle("on", state.snap);
}

// ------------------------------------------------------------------ géométrie & zoom
const viewW = () => scroller.clientWidth - HEADER_W;
const timeToX = (t) => t * state.pps;
const sliderToPps = (v) => MIN_PPS * Math.pow(MAX_PPS / MIN_PPS, v / 1000);
const ppsToSlider = (p) => (Math.log(p / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS)) * 1000;

function layout() {
  const seconds = Math.max(projectEnd() + 30, viewW() / state.pps + 5, 60);
  content.style.width = `${HEADER_W + seconds * state.pps}px`;
  zoomInput.value = ppsToSlider(state.pps);
  const px = state.pps;
  scroller.parentElement.querySelector("#tl-scale").textContent =
    px >= 1000 ? `${(px / 1000).toFixed(px >= 10000 ? 0 : 1)} px/ms` : `${Math.round(px)} px/s`;
}

function setZoom(pps, anchorPx) {
  pps = clamp(pps, MIN_PPS, MAX_PPS);
  const t = (scroller.scrollLeft + anchorPx) / state.pps;   // instant sous le curseur : il reste fixe
  state.pps = pps;
  layout();
  scroller.scrollLeft = t * pps - anchorPx;
  renderClips(); drawRuler(); updateOverlay(); updatePlayhead(true);
  emit("zoom");
}

const zoomBy = (f) => setZoom(state.pps * f, viewW() / 2);

function fit() {
  setZoom(viewW() / Math.max(projectEnd() * 1.1, 5), 0);
  scroller.scrollLeft = 0;
}

function onWheel(e) {
  if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;   // défilement horizontal natif
  if (e.target.closest(".tl-head")) return;
  e.preventDefault();
  const anchor = e.clientX - scroller.getBoundingClientRect().left - HEADER_W;
  setZoom(state.pps * Math.exp(-e.deltaY * 0.0015), Math.max(0, anchor));
}

// ------------------------------------------------------------------ règle
function drawRuler() {
  const w = Math.max(1, viewW()), h = 28, dpr = window.devicePixelRatio || 1;
  if (ruler.width !== Math.round(w * dpr)) {
    ruler.width = Math.round(w * dpr); ruler.height = h * dpr;
    ruler.style.width = `${w}px`; ruler.style.height = `${h}px`;
  }
  const g = ruler.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const pps = state.pps, t0 = scroller.scrollLeft / pps, t1 = t0 + w / pps;
  const [step, sub] = STEPS.find(([s]) => s * pps >= 90) || STEPS[STEPS.length - 1];
  const minor = step / sub;
  g.font = "10px system-ui, sans-serif";
  g.textBaseline = "top";
  for (let k = Math.floor(t0 / minor); k * minor <= t1 + minor; k++) {
    const t = k * minor, x = Math.round((t - t0) * pps) + 0.5, major = k % sub === 0;
    g.strokeStyle = major ? "#6b7280" : "#3a3f4a";
    g.beginPath(); g.moveTo(x, major ? 12 : 20); g.lineTo(x, h); g.stroke();
    if (major) { g.fillStyle = "#9aa1ad"; g.fillText(fmtRuler(t, step), x + 4, 2); }
  }
  g.fillStyle = "#f5b942";
  for (const m of state.markers) {
    const x = (m.t - t0) * pps;
    if (x < -6 || x > w + 6) continue;
    g.beginPath(); g.moveTo(x - 5, 0); g.lineTo(x + 5, 0); g.lineTo(x, 9); g.closePath(); g.fill();
  }
}

function onRulerDown(e) {
  ruler.setPointerCapture(e.pointerId);
  const targets = snapTargets({ playhead: false });
  const move = (ev) => {
    let t = Math.max(0, (scroller.scrollLeft + ev.clientX - ruler.getBoundingClientRect().left) / state.pps);
    if (state.snap && !ev.altKey) {
      const s = snapValue([t], targets, SNAP_PX / state.pps);
      if (s) t += s.delta;
    }
    setPlayhead(t);
  };
  const up = () => { ruler.removeEventListener("pointermove", move); ruler.removeEventListener("pointerup", up); };
  ruler.addEventListener("pointermove", move);
  ruler.addEventListener("pointerup", up);
  move(e);
}

// ------------------------------------------------------------------ tête de lecture, repères, guide
function updatePlayhead(noScroll) {
  const x = HEADER_W + timeToX(state.playhead);
  playheadEl.style.transform = `translateX(${x}px)`;
  if (state.playing && !noScroll) {
    const right = scroller.scrollLeft + scroller.clientWidth - 60;
    if (x > right) scroller.scrollLeft = x - HEADER_W - 40;
  }
}

function updateOverlay() {
  markersEl.replaceChildren(...state.markers.map((m) => {
    const d = document.createElement("div");
    d.className = "tl-marker";
    d.style.left = `${HEADER_W + timeToX(m.t)}px`;
    return d;
  }));
}

function showGuide(snap) {
  if (!snap) { guideEl.style.display = "none"; return; }
  guideEl.style.display = "block";
  guideEl.style.left = `${HEADER_W + timeToX(snap.target.t)}px`;
}

function showTip(e, text) {
  tip.textContent = text;
  tip.classList.remove("hidden");
  tip.style.left = `${e.clientX + 14}px`;
  tip.style.top = `${e.clientY - 34}px`;
}

function hideFeedback() {
  showGuide(null);
  tip.classList.add("hidden");
  if (ghost) { ghost.remove(); ghost = null; }
}

// ------------------------------------------------------------------ clips
function renderClips() {
  for (const id in lanes) lanes[id].replaceChildren();
  for (const c of state.clips) {
    const a = state.assets.get(c.asset);
    if (!a || !lanes[c.track]) continue;
    const el = document.createElement("div");
    el.className = `clip ${a.kind}${c.id === state.selected ? " sel" : ""}`;
    el.dataset.id = c.id;
    el.style.left = `${timeToX(c.start)}px`;
    el.style.width = `${Math.max(2, c.dur * state.pps)}px`;
    el.innerHTML = `${a.kind === "audio" ? "<canvas></canvas>" : ""}<span class="cname"></span><i class="h l"></i><i class="h r"></i>`;
    el.querySelector(".cname").textContent = a.name;
    lanes[c.track].append(el);
    if (a.kind === "audio") {
      const cv = el.querySelector("canvas");
      cv.width = clamp(Math.ceil(c.dur * state.pps), 1, 2048);
      cv.height = 56;
      const d = a.duration || c.in + c.dur;
      getPeaks(a).then((p) => drawPeaks(cv, p, c.in / d, (c.in + c.dur) / d, "rgba(255,255,255,.75)"));
    }
  }
}

function renderSelection() {
  content.querySelectorAll(".clip").forEach((el) => el.classList.toggle("sel", el.dataset.id === state.selected));
}

/** Position d'un clip de durée `dur` dont le bord gauche viserait `raw`, après aimantation. */
function place(raw, dur, excludeId, altKey) {
  let s = Math.max(0, raw), snap = null;
  if (state.snap && !altKey) {
    snap = snapValue([s, s + dur], snapTargets({ exclude: excludeId }), SNAP_PX / state.pps);
    if (snap) s = Math.max(0, s + snap.delta);
  }
  return { start: round3(s), snap };
}

const snapText = (snap) => (snap ? `  🧲 ${snap.target.label}` : "");

function laneUnder(y, type, fallback) {
  for (const t of TRACKS) {
    if (t.type !== type) continue;
    const r = lanes[t.id].getBoundingClientRect();
    if (y >= r.top && y < r.bottom) return t.id;
  }
  return fallback;
}

function onClipDown(e) {
  const el = e.target.closest(".clip");
  if (!el || e.button !== 0) return;
  const c = state.clips.find((x) => x.id === el.dataset.id);
  const a = state.assets.get(c.asset);
  selectClip(c.id);
  const mode = e.target.classList.contains("l") ? "trimL" : e.target.classList.contains("r") ? "trimR" : "move";
  const orig = { ...c }, x0 = e.clientX;
  const type = trackOf(c.track).type;
  const baseTop = lanes[c.track].getBoundingClientRect().top;
  const targets = snapTargets({ exclude: c.id });
  const thr = SNAP_PX / state.pps;
  let cur = { ...orig }, invalid = false;
  el.setPointerCapture(e.pointerId);
  el.classList.add("dragging");

  const snapEdge = (t, ev) => {
    if (!state.snap || ev.altKey) return { t, snap: null };
    const s = snapValue([t], targets, thr);
    return { t: s ? t + s.delta : t, snap: s };
  };

  const move = (ev) => {
    const dx = (ev.clientX - x0) / state.pps;
    let snap = null;
    if (mode === "move") {
      const r = place(orig.start + dx, orig.dur, c.id, ev.altKey);
      snap = r.snap;
      cur = { ...orig, start: r.start, track: laneUnder(ev.clientY, type, cur.track) };
    } else if (mode === "trimL") {
      const r = snapEdge(orig.start + dx, ev);
      snap = r.snap;
      const s = round3(clamp(r.t, orig.start - orig.in, orig.start + orig.dur - MIN_DUR));
      cur = { ...orig, start: s, in: round3(orig.in + s - orig.start), dur: round3(orig.dur - (s - orig.start)) };
    } else {
      const r = snapEdge(orig.start + orig.dur + dx, ev);
      snap = r.snap;
      const maxEnd = a.duration ? orig.start + a.duration - orig.in : Infinity;
      cur = { ...orig, dur: round3(clamp(r.t, orig.start + MIN_DUR, maxEnd) - orig.start) };
    }
    invalid = overlaps(cur.track, cur.start, cur.start + cur.dur, c.id);
    el.style.left = `${timeToX(cur.start)}px`;
    el.style.width = `${Math.max(2, cur.dur * state.pps)}px`;
    el.style.transform = `translateY(${lanes[cur.track].getBoundingClientRect().top - baseTop}px)`;
    el.classList.toggle("invalid", invalid);
    showGuide(snap);
    showTip(ev, `${fmtMs(cur.start)} → ${fmtMs(cur.start + cur.dur)}  (${fmtMs(cur.dur)})${snapText(snap)}`);
  };

  const up = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    hideFeedback();
    const changed = cur.start !== orig.start || cur.dur !== orig.dur || cur.track !== orig.track || cur.in !== orig.in;
    if (!invalid) Object.assign(c, { start: cur.start, in: cur.in, dur: cur.dur, track: cur.track });
    if (changed || invalid) emit("clips");     // re-rendu : valide la position ou restaure l'ancienne
    else el.classList.remove("dragging");
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}

// ------------------------------------------------------------------ dépôt depuis la Soundboard
function wireLaneDrop(lane, track) {
  const compute = (e) => {
    const a = state.drag?.asset;
    if (!a || a.kind !== track.type) return null;
    const dur = a.duration || 1;
    const raw = (e.clientX - lane.getBoundingClientRect().left) / state.pps;
    const { start, snap } = place(raw, dur, null, e.altKey);
    return { a, dur, start, snap, invalid: overlaps(track.id, start, start + dur, null) };
  };

  lane.addEventListener("dragover", (e) => {
    const p = compute(e);
    if (!p) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = p.invalid ? "none" : "copy";
    if (!ghost || ghost.parentElement !== lane) {
      ghost?.remove();
      ghost = document.createElement("div");
      lane.append(ghost);
    }
    ghost.className = `clip ghost ${p.a.kind}${p.invalid ? " invalid" : ""}`;
    ghost.style.left = `${timeToX(p.start)}px`;
    ghost.style.width = `${Math.max(2, p.dur * state.pps)}px`;
    ghost.textContent = p.a.name;
    showGuide(p.snap);
    showTip(e, `${fmtMs(p.start)} → ${fmtMs(p.start + p.dur)}${snapText(p.snap)}`);
  });

  lane.addEventListener("dragleave", (e) => { if (!lane.contains(e.relatedTarget)) hideFeedback(); });

  lane.addEventListener("drop", (e) => {
    const p = compute(e);
    hideFeedback();
    if (!p) return;
    e.preventDefault();
    if (p.invalid) return toast("Emplacement occupé : le clip chevaucherait un autre clip de la piste.");
    const clip = { id: uid("c"), asset: p.a.id, track: track.id, start: p.start, in: 0, dur: round3(p.dur) };
    state.clips.push(clip);
    state.selected = clip.id;
    emit("clips");
  });
}
