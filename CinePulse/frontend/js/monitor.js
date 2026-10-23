// Moniteur : affiche le plan vidéo sous la tête de lecture + contrôles de transport.
import { state, on, TRACKS, clipEnd } from "./state.js";
import { fmtTC, fmtMs } from "./format.js";
import * as engine from "./engine.js";

let video, empty, tc, ms, playBtn;

export function initMonitor(root) {
  root.innerHTML = `
    <div class="panel-title"><span>Moniteur</span><span class="dim" id="mon-fps"></span></div>
    <div class="mon-screen">
      <video playsinline class="hidden"></video>
      <div class="mon-empty">Aucun plan vidéo sous la tête de lecture</div>
    </div>
    <div class="mon-ctrl">
      <button data-a="start" title="Début (Home)">⏮</button>
      <button data-a="back" title="Image précédente (←)">◀▏</button>
      <button data-a="play" class="primary" title="Lecture / Pause (Espace)">▶</button>
      <button data-a="fwd" title="Image suivante (→)">▕▶</button>
      <button data-a="end" title="Fin (End)">⏭</button>
      <span class="tc" id="mon-tc">00:00:00:00</span>
      <span class="ms dim" id="mon-ms">0:00.000</span>
    </div>`;
  video = root.querySelector("video");
  empty = root.querySelector(".mon-empty");
  tc = root.querySelector("#mon-tc");
  ms = root.querySelector("#mon-ms");
  playBtn = root.querySelector('[data-a="play"]');
  const actions = { start: engine.goStart, end: engine.goEnd, play: engine.toggle,
    back: () => engine.step(-1), fwd: () => engine.step(1) };
  root.querySelector(".mon-ctrl").addEventListener("click", (e) => {
    const a = e.target.closest("button")?.dataset.a;
    if (a) actions[a]();
  });
  on((type) => {
    if (type === "playhead" || type === "seek" || type === "clips" || type === "transport" || type === "assets") refresh(root);
  });
  refresh(root);
}

function videoClipAt(t) {
  for (const tr of TRACKS) {          // V2 avant V1 : la piste du haut recouvre
    if (tr.type !== "video") continue;
    const c = state.clips.find((x) => x.track === tr.id && t >= x.start && t < clipEnd(x));
    if (c) return c;
  }
  return null;
}

function refresh(root) {
  tc.textContent = fmtTC(state.playhead, state.fps);
  ms.textContent = fmtMs(state.playhead);
  playBtn.textContent = state.playing ? "⏸" : "▶";
  root.querySelector("#mon-fps").textContent = `${state.fps} i/s`;
  syncVideo();
}

function syncVideo() {
  const c = videoClipAt(state.playhead);
  const asset = c && state.assets.get(c.asset);
  if (!asset) {
    if (!video.paused) video.pause();
    video.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  video.classList.remove("hidden");
  empty.classList.add("hidden");
  if (video.dataset.src !== asset.url) {
    video.dataset.src = asset.url;
    video.src = asset.url;
  }
  const target = c.in + state.playhead - c.start;
  if (state.playing) {
    if (video.paused) { video.currentTime = target; video.play().catch(() => {}); }
    else if (Math.abs(video.currentTime - target) > 0.2) video.currentTime = target;
  } else {
    if (!video.paused) video.pause();
    if (Math.abs(video.currentTime - target) > 0.0005) video.currentTime = target;
  }
}
