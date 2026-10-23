// État global du projet + bus d'événements minimal.
// Événements : assets, clips, markers, zoom, snap, select, transport, playhead (lecture), seek (action utilisateur)

export const TRACKS = [
  { id: "V2", type: "video", label: "V2" },
  { id: "V1", type: "video", label: "V1" },
  { id: "A1", type: "audio", label: "A1" },
  { id: "A2", type: "audio", label: "A2" },
  { id: "A3", type: "audio", label: "A3" },
];

export const state = {
  assets: new Map(),   // id -> asset (voir backend/server.py)
  clips: [],           // { id, asset, track, start, in, dur }  (secondes)
  markers: [],         // { t }
  playhead: 0,
  pps: 80,             // pixels par seconde (zoom)
  snap: true,
  selected: null,
  fps: 25,
  playing: false,
  drag: null,          // { asset } pendant un glisser depuis la Soundboard
};

const subs = new Set();
export const on = (fn) => subs.add(fn);
export const emit = (type) => subs.forEach((fn) => fn(type));

export const uid = (p = "id") => p + Math.random().toString(36).slice(2, 9);
export const round3 = (x) => Math.round(x * 1000) / 1000;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const clipEnd = (c) => c.start + c.dur;
export const trackOf = (id) => TRACKS.find((t) => t.id === id);
export const projectEnd = () => state.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);

/** user=true : saut demandé par l'utilisateur (resynchronise la lecture). */
export function setPlayhead(t, user = true) {
  state.playhead = Math.max(0, round3(t));
  emit(user ? "seek" : "playhead");
}

export function overlaps(track, start, end, excludeId) {
  return state.clips.some((c) => c.id !== excludeId && c.track === track &&
    c.start < end - 1e-6 && clipEnd(c) > start + 1e-6);
}

const KEY = "cinepulse.project.v1";
export function saveProject() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ clips: state.clips, markers: state.markers, pps: state.pps }));
  } catch { /* stockage indisponible */ }
}
export function loadProject() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!d) return;
    state.clips = d.clips || [];
    state.markers = d.markers || [];
    state.pps = d.pps || state.pps;
  } catch { /* projet corrompu : on repart de zéro */ }
}
