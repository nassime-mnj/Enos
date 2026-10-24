// CINEPULSE NLE : assemble la timeline Canvas, la bibliothèque persistante et la barre d'outils. Le projet (EDL) est enregistré automatiquement côté serveur (projects.js).
import * as core from "./core.js";
import { Library } from "./library.js";
import { TimelineCanvas } from "./timeline_canvas.js";
import { Inspector } from "./inspector.js";
import { TransitionWheel } from "./wheel.js";
import { ExportPanel } from "./export.js";
import { Monitor } from "./monitor.js";
import { Projects, ProjectsPanel } from "./projects.js";

const $ = (id) => document.getElementById(id);

export function start(root = document) {
  const lib = new Library($("lib"), {
    onAdd: (a) => tl.addAsset(a),
    onDragMove: (a, x, y) => tl.setDropPreview(a, x, y),
    onDrop: (a, x, y) => tl.dropAsset(a, x, y),
    onDragEnd: () => tl.clearDropPreview(),
    onChange: () => { tl.requestDraw(); monitor.refresh(); },
  });
  const tl = new TimelineCanvas($("tl"), core.createProject(), {
    asset: (id) => lib.get(id),
    peaks: (id) => fetch(`/api/library/${id}/waveform?buckets=1500`).then((r) => (r.ok ? r.json() : null)).then((j) => (j ? j.peaks : null)),
    onChange: save, onSelect: info, onSeek: () => { info(tl.selectedClip); monitor.userSeek(); }, onZoom: () => {}, onModel: () => monitor.refresh(),
    onJunction: (j, x, y) => wheel.open(j, x, y),
  });
  const insp = new Inspector($("insp"), tl, { hasAudio: (c) => { const a = lib.get(c.asset); return !!(a && a.has_audio); }, onToggle: (open) => { $("b-insp").setAttribute("aria-pressed", String(open)); document.body.classList.toggle("insp-open", open); } });
  const monitor = new Monitor({ canvas: $("mon"), view: $("mon-view"), play: $("b-play"), home: $("b-home"), time: $("mon-time"), lite: $("mon-lite") }, tl, {
    asset: (id) => lib.get(id), hasAudio: (c) => { const a = lib.get(c.asset); return !!(a && a.has_audio); },
    onTransport: (playing) => { if (!playing) info(tl.selectedClip); },
    onSeekDone: () => info(tl.selectedClip),
  });
  const wheel = new TransitionWheel(tl);
  const exp = new ExportPanel($("exp"), () => tl.project);
  const prj = new Projects(tl, {
    onState: (state, i) => { const b = $("b-prj"); b.dataset.state = state; b.title = state === "saved" ? `Enregistré : ${prj.name || "projet vierge"}` : state === "error" ? "Non enregistré" : state === "conflict" ? "Conflit avec un autre appareil" : "Enregistrement…"; panel.paintState(state, i); },
    onLoaded: () => { buttons(); info(null); monitor.seek(0); },
  });
  const panel = new ProjectsPanel($("prj"), prj);
  window.nle = { tl, lib, core, insp, wheel, exp, monitor, prj, panel, ready: false };                  // accès pour les tests et la console

  function save() { prj.markDirty(); buttons(); }
  function buttons() {
    const c = tl.selectedClip;
    $("b-undo").disabled = !tl.history.canUndo; $("b-redo").disabled = !tl.history.canRedo; $("b-del").disabled = !c;
    $("b-split").disabled = !c || tl.playhead < c.start + core.MIN_DUR || tl.playhead > core.clipEnd(c) - core.MIN_DUR;
    insp.refresh();
    if (exp.isOpen) exp._paint();
  }
  function info(c) {
    buttons();
    $("sel").textContent = c ? `${c.name} · piste ${c.track} · début ${c.start.toFixed(2)} s · durée ${c.dur.toFixed(2)} s` : `Tête de lecture ${core.formatTime(tl.playhead, tl.project.fps)} · ${tl.project.clips.length} clip${tl.project.clips.length > 1 ? "s" : ""} · ${tl.project.tracks.length} pistes`;
  }

  $("b-lib").onclick = () => lib.toggle();
  $("b-insp").onclick = () => insp.toggle();
  $("b-exp").onclick = () => exp.toggle();
  $("b-prj").onclick = () => panel.toggle();
  $("b-split").onclick = () => { tl.splitAtPlayhead(); info(tl.selectedClip); };
  $("b-undo").onclick =() => { tl.undo(); save(); info(tl.selectedClip); };
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
    else if (k === "s" && !mod) { if (!$("b-split").disabled) { tl.splitAtPlayhead(); info(tl.selectedClip); } }
    else if (k === " ") { e.preventDefault(); monitor.toggle(); }
    else if (k === "home") { tl.setPlayhead(0); tl.view.scrollX = 0; tl.requestDraw(); }
    else if (k === "+" || k === "=") tl.zoomTo(tl.view.pps * 1.25);
    else if (k === "-") tl.zoomTo(tl.view.pps / 1.25);
  });
  fetch("/api/status").then((r) => r.json()).then((s) => { $("ff").textContent = s.ffmpeg ? "FFmpeg ✓" : "FFmpeg ✗"; $("ff").title = s.ffmpeg ? "FFmpeg " + (s.ffmpeg_version || "") : "FFmpeg introuvable : pas de proxies ni de rendu"; $("ff").classList.toggle("bad", !s.ffmpeg); }).catch(() => { $("ff").textContent = "serveur ?"; });
  lib.refresh().catch(() => {}).then(() => prj.init()).then(() => { info(null); tl.requestDraw(); window.nle.ready = true; });
  info(null);
  return window.nle;
}

if (document.getElementById("tl") && !window.__NLE_TEST) start();
