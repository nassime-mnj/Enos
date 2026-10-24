// CINEPULSE NLE : assemble la timeline Canvas, la bibliothèque persistante et la barre d'outils. Le projet (EDL) est sauvegardé localement à chaque modification.
import * as core from "./core.js";
import { Library } from "./library.js";
import { TimelineCanvas } from "./timeline_canvas.js";

const $ = (id) => document.getElementById(id);
const KEY = "cinepulse.nle.project.v1";

function loadProject() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || "null");
    if (p && p.version === 1 && Array.isArray(p.tracks) && Array.isArray(p.clips) && p.tracks.length) return p;
  } catch (e) { /* stockage indisponible ou corrompu : projet vierge */ }
  return core.createProject();
}

export function start(root = document) {
  const lib = new Library($("lib"), {
    onAdd: (a) => tl.addAsset(a),
    onDragMove: (a, x, y) => tl.setDropPreview(a, x, y),
    onDrop: (a, x, y) => tl.dropAsset(a, x, y),
    onDragEnd: () => tl.clearDropPreview(),
    onChange: () => tl.requestDraw(),
  });
  const tl = new TimelineCanvas($("tl"), loadProject(), {
    asset: (id) => lib.get(id),
    peaks: (id) => fetch(`/api/library/${id}/waveform?buckets=1500`).then((r) => (r.ok ? r.json() : null)).then((j) => (j ? j.peaks : null)),
    onChange: save, onSelect: info, onSeek: () => info(tl.selectedClip), onZoom: () => {},
  });
  window.nle = { tl, lib, core };                                    // accès pour les tests et la console

  function save() { try { localStorage.setItem(KEY, JSON.stringify(tl.project)); } catch (e) { /* quota / mode privé */ } buttons(); }
  function buttons() { $("b-undo").disabled = !tl.history.canUndo; $("b-redo").disabled = !tl.history.canRedo; $("b-del").disabled = !tl.selectedClip; }
  function info(c) {
    buttons();
    $("sel").textContent = c ? `${c.name} · piste ${c.track} · début ${c.start.toFixed(2)} s · durée ${c.dur.toFixed(2)} s` : `Tête de lecture ${core.formatTime(tl.playhead, tl.project.fps)} · ${tl.project.clips.length} clip${tl.project.clips.length > 1 ? "s" : ""} · ${tl.project.tracks.length} pistes`;
  }

  $("b-lib").onclick = () => lib.toggle();
  $("b-undo").onclick = () => { tl.undo(); save(); info(tl.selectedClip); };
  $("b-redo").onclick = () => { tl.redo(); save(); info(tl.selectedClip); };
  $("b-del").onclick = () => { tl.deleteSelected(); info(null); };
  $("b-addv").onclick = () => { tl.addTrack("video"); info(tl.selectedClip); };
  $("b-adda").onclick = () => { tl.addTrack("audio"); info(tl.selectedClip); };
  $("b-zin").onclick = () => tl.zoomTo(tl.view.pps * 1.5);
  $("b-zout").onclick = () => tl.zoomTo(tl.view.pps / 1.5);
  $("b-fit").onclick = () => tl.zoomFit();
  $("b-snap").onclick = (e) => { const on = e.currentTarget.getAttribute("aria-pressed") !== "true"; e.currentTarget.setAttribute("aria-pressed", String(on)); tl.setSnapping(on); };
  document.addEventListener("keydown", (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (k === "delete" || k === "backspace") { if (tl.deleteSelected()) { info(null); e.preventDefault(); } }
    else if (mod && k === "z") { e.preventDefault(); e.shiftKey ? tl.redo() : tl.undo(); save(); info(tl.selectedClip); }
    else if (mod && k === "y") { e.preventDefault(); tl.redo(); save(); info(tl.selectedClip); }
    else if (k === "home") { tl.setPlayhead(0); tl.view.scrollX = 0; tl.requestDraw(); }
    else if (k === "+" || k === "=") tl.zoomTo(tl.view.pps * 1.25);
    else if (k === "-") tl.zoomTo(tl.view.pps / 1.25);
  });
  fetch("/api/status").then((r) => r.json()).then((s) => { $("ff").textContent = s.ffmpeg ? "FFmpeg ✓" : "FFmpeg ✗"; $("ff").title = s.ffmpeg ? "FFmpeg " + (s.ffmpeg_version || "") : "FFmpeg introuvable : pas de proxies ni de rendu"; $("ff").classList.toggle("bad", !s.ffmpeg); }).catch(() => { $("ff").textContent = "serveur ?"; });
  lib.refresh().then(() => { info(null); tl.requestDraw(); });
  info(null);
  return window.nle;
}

if (document.getElementById("tl") && !window.__NLE_TEST) start();
