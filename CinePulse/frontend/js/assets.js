// Bibliothèque de médias : synchronisation avec le serveur, import.
import { api } from "./api.js";
import { state, emit } from "./state.js";
import { toast } from "./ui.js";

// Sans ffprobe, la durée est mesurée par le navigateur.
function measure(a) {
  return new Promise((resolve) => {
    const el = document.createElement(a.kind === "video" ? "video" : "audio");
    el.preload = "metadata";
    el.onloadedmetadata = () => resolve(isFinite(el.duration) ? el.duration : 0);
    el.onerror = () => resolve(0);
    el.src = a.url;
  });
}

async function register(a) {
  if (a.duration == null) a.duration = await measure(a);
  state.assets.set(a.id, a);
  if (a.kind === "video" && a.fps > 1 && a.fps < 240 && ![...state.assets.values()].some((x) => x !== a && x.kind === "video")) {
    state.fps = a.fps;
  }
}

export async function refreshAssets() {
  for (const a of await api.assets()) await register(a);
  emit("assets");
}

export async function importFiles(files) {
  for (const f of files) {
    try {
      await register(await api.importFile(f));
      emit("assets");
    } catch (e) {
      toast(`Import de « ${f.name} » impossible : ${e.message}`);
    }
  }
}

export async function removeAsset(id) {
  await api.remove(id).catch(() => {});
  state.assets.delete(id);
  state.clips = state.clips.filter((c) => c.asset !== id);
  emit("assets");
  emit("clips");
}
