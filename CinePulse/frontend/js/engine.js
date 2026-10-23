// Moteur de lecture : horloge maître = AudioContext, les clips audio sont planifiés à l'échantillon près.
import { state, emit, on, setPlayhead, projectEnd, clipEnd } from "./state.js";

let ctx = null;
let sources = [];
let t0 = 0;       // position de la tête au démarrage
let c0 = 0;       // instant AudioContext correspondant
let raf = 0;
let gen = 0;      // invalide un play() en cours si pause()/nouveau play() survient
let starting = false;
const buffers = new Map();

export function audioCtx() {
  return (ctx ??= new (window.AudioContext || window.webkitAudioContext)());
}

export function getBuffer(asset) {
  if (!buffers.has(asset.id)) {
    buffers.set(asset.id, fetch(asset.url)
      .then((r) => r.arrayBuffer())
      .then((b) => audioCtx().decodeAudioData(b))
      .catch(() => null));
  }
  return buffers.get(asset.id);
}

export async function play() {
  const my = ++gen;
  const end = projectEnd();
  if (end === 0) return;
  starting = true;
  const ac = audioCtx();
  await ac.resume();
  if (state.playhead >= end - 0.001) state.playhead = 0;
  const startAt = state.playhead;
  const clips = state.clips.filter((c) => state.assets.get(c.asset)?.kind === "audio" && clipEnd(c) > startAt);
  const bufs = await Promise.all(clips.map((c) => getBuffer(state.assets.get(c.asset))));
  starting = false;
  if (my !== gen) return;

  t0 = state.playhead;
  c0 = ac.currentTime + 0.08;
  sources = [];
  clips.forEach((c, i) => {
    if (!bufs[i]) return;
    const s = ac.createBufferSource();
    s.buffer = bufs[i];
    s.connect(ac.destination);
    const skip = Math.max(0, t0 - c.start);
    s.start(c0 + Math.max(0, c.start - t0), c.in + skip, c.dur - skip);
    sources.push(s);
  });
  state.playing = true;
  emit("transport");
  loop();
}

function loop() {
  if (!state.playing) return;
  const t = Math.max(t0, t0 + ctx.currentTime - c0);
  if (t >= projectEnd()) {
    pause();
    setPlayhead(projectEnd(), false);
    return;
  }
  setPlayhead(t, false);
  raf = requestAnimationFrame(loop);
}

export function pause() {
  gen++;
  starting = false;
  cancelAnimationFrame(raf);
  for (const s of sources) { try { s.stop(); } catch { /* déjà arrêté */ } }
  sources = [];
  const was = state.playing;
  state.playing = false;
  if (was) { emit("transport"); emit("playhead"); }
}

export const toggle = () => (state.playing || starting ? pause() : play());

export function step(frames) {
  pause();
  setPlayhead(Math.max(0, (Math.round(state.playhead * state.fps) + frames) / state.fps));
}

export const goStart = () => { pause(); setPlayhead(0); };
export const goEnd = () => { pause(); setPlayhead(projectEnd()); };

// Toute modification pendant la lecture la replanifie depuis la position courante.
on((type) => {
  if (state.playing && (type === "seek" || type === "clips")) { pause(); play(); }
});
