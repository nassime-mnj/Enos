import { state, on, emit, loadProject, saveProject } from "./state.js";
import { api } from "./api.js";
import { refreshAssets } from "./assets.js";
import { initMonitor } from "./monitor.js";
import { initSoundboard, previewIndex, stopPreview } from "./soundboard.js";
import { initTimeline } from "./timeline.js";
import * as engine from "./engine.js";
import { deleteSelected, splitAtPlayhead, toggleMarker, toggleSnap } from "./edit.js";

async function boot() {
  loadProject();
  initMonitor(document.getElementById("monitor"));
  initSoundboard(document.getElementById("soundboard"));
  initTimeline(document.getElementById("timeline"));
  on((t) => { if (t === "clips" || t === "markers" || t === "zoom") saveProject(); });

  const pill = document.getElementById("ff-status");
  api.status().then((s) => {
    pill.textContent = s.ffmpeg ? `FFmpeg ${s.ffmpeg_version || ""}` : "FFmpeg absent (mode dégradé)";
    pill.classList.toggle("warn", !s.ffmpeg);
  }).catch(() => { pill.textContent = "Serveur injoignable"; pill.classList.add("warn"); });

  await refreshAssets().catch(() => {});
  // Les clips sauvegardés dont le média n'existe plus (serveur redémarré) sont écartés.
  const before = state.clips.length;
  state.clips = state.clips.filter((c) => state.assets.has(c.asset));
  if (state.clips.length !== before) saveProject();
  emit("clips");
}

document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea") || e.ctrlKey || e.metaKey) return;
  const k = e.key;
  const handlers = {
    " ": () => engine.toggle(),
    ArrowLeft: () => engine.step(e.shiftKey ? -10 : -1),
    ArrowRight: () => engine.step(e.shiftKey ? 10 : 1),
    Home: engine.goStart,
    End: engine.goEnd,
    Delete: deleteSelected,
    Backspace: deleteSelected,
    s: splitAtPlayhead,
    m: toggleMarker,
    n: toggleSnap,
    Escape: stopPreview,
  };
  const h = handlers[k] || handlers[k.toLowerCase()];
  if (h) { e.preventDefault(); h(); }
  else if (/^[1-9]$/.test(k)) previewIndex(+k);
});

boot();
