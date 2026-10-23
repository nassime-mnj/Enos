// Opérations d'édition sur le projet.
import { state, emit, uid, round3, clipEnd } from "./state.js";

export function selectClip(id) {
  state.selected = id;
  emit("select");
}

export function deleteSelected() {
  if (!state.selected) return;
  state.clips = state.clips.filter((c) => c.id !== state.selected);
  state.selected = null;
  emit("clips");
}

/** Coupe le clip sélectionné (ou, à défaut, le premier sous la tête de lecture) à la tête de lecture. */
export function splitAtPlayhead() {
  const t = state.playhead;
  const hit = (c) => t > c.start + 0.001 && t < clipEnd(c) - 0.001;
  const c = state.clips.find((x) => x.id === state.selected && hit(x)) || state.clips.find(hit);
  if (!c) return;
  const right = { ...c, id: uid("c"), start: t, in: round3(c.in + (t - c.start)), dur: round3(clipEnd(c) - t) };
  c.dur = round3(t - c.start);
  state.clips.push(right);
  emit("clips");
}

export function toggleMarker() {
  const i = state.markers.findIndex((m) => Math.abs(m.t - state.playhead) < 0.001);
  if (i >= 0) state.markers.splice(i, 1);
  else state.markers.push({ t: state.playhead });
  emit("markers");
}

export function toggleSnap() {
  state.snap = !state.snap;
  emit("snap");
}
