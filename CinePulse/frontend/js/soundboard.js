// Soundboard / chutier : grille ou liste des médias, pré-écoute rapide, source du glisser-déposer vers la timeline.
import { state, on } from "./state.js";
import { fmtDur } from "./format.js";
import { getPeaks, drawPeaks } from "./waveform.js";
import { importFiles, removeAsset } from "./assets.js";

let root, body;
let tab = "audio";
let view = "grid";
const pv = new Audio();     // pré-écoute (hors timeline)
let pvId = null;

export function initSoundboard(el) {
  root = el;
  root.innerHTML = `
    <div class="panel-title">
      <span>Soundboard</span>
      <span class="tabs">
        <button data-tab="audio" class="on">Sons</button>
        <button data-tab="video">Vidéos</button>
      </span>
      <span class="spacer"></span>
      <button data-view title="Grille / liste">▦</button>
      <button data-import class="primary">+ Importer</button>
      <input type="file" multiple accept="audio/*,video/*" hidden>
    </div>
    <div class="sb-body"></div>`;
  body = root.querySelector(".sb-body");
  const input = root.querySelector("input[type=file]");

  root.querySelector("[data-import]").onclick = () => input.click();
  input.onchange = () => { importFiles([...input.files]); input.value = ""; };
  root.querySelector("[data-view]").onclick = () => { view = view === "grid" ? "list" : "grid"; render(); };
  root.querySelector(".tabs").onclick = (e) => {
    const t = e.target.dataset.tab;
    if (!t) return;
    tab = t;
    root.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
    render();
  };

  // Import par glisser-déposer de fichiers du système
  root.addEventListener("dragover", (e) => {
    if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); root.classList.add("dropping"); }
  });
  root.addEventListener("dragleave", (e) => { if (!root.contains(e.relatedTarget)) root.classList.remove("dropping"); });
  root.addEventListener("drop", (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    root.classList.remove("dropping");
    importFiles([...e.dataTransfer.files]);
  });

  body.addEventListener("click", onClick);
  pv.addEventListener("timeupdate", updateProgress);
  pv.addEventListener("ended", () => setPlaying(null));
  on((t) => { if (t === "assets") render(); });
  render();
}

function render() {
  body.className = `sb-body ${view}`;
  const list = [...state.assets.values()].filter((a) => a.kind === tab);
  if (!list.length) {
    body.innerHTML = `<div class="sb-empty">${tab === "audio" ? "Aucun son." : "Aucune vidéo."}<br>
      Glissez des fichiers ici ou cliquez sur « Importer ».</div>`;
    return;
  }
  body.replaceChildren(...list.map((a, i) => card(a, i)));
}

function card(a, i) {
  const el = document.createElement("div");
  el.className = `card ${a.kind}`;
  el.draggable = true;
  el.dataset.id = a.id;
  el.innerHTML = `
    <button class="play" data-act="play" title="Pré-écouter">▶</button>
    <div class="meta"><div class="nm"></div><div class="du"></div></div>
    <canvas class="mini" width="240" height="40"></canvas>
    <button class="del" data-act="del" title="Retirer du projet">×</button>
    <div class="prog"></div>`;
  el.querySelector(".nm").textContent = a.name;
  el.querySelector(".du").textContent = `${i < 9 && a.kind === "audio" ? `[${i + 1}] ` : ""}${fmtDur(a.duration)}`;
  getPeaks(a).then((p) => drawPeaks(el.querySelector("canvas"), p, 0, 1, "rgba(47,191,166,.85)"));

  el.addEventListener("dragstart", (e) => {
    state.drag = { asset: a };
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", a.id);
    el.classList.add("dragging");
  });
  el.addEventListener("dragend", () => { state.drag = null; el.classList.remove("dragging"); });
  if (pvId === a.id && !pv.paused) el.classList.add("playing");
  return el;
}

function onClick(e) {
  const act = e.target.dataset.act;
  const el = e.target.closest(".card");
  if (!el || !act) return;
  if (act === "del") { if (pvId === el.dataset.id) stopPreview(); removeAsset(el.dataset.id); }
  if (act === "play") preview(el.dataset.id);
}

export function preview(id) {
  const a = state.assets.get(id);
  if (!a) return;
  if (pvId === id && !pv.paused) return stopPreview();
  pv.src = a.url;
  pvId = id;
  pv.currentTime = 0;
  pv.play().catch(() => {});
  setPlaying(id);
}

export function previewIndex(n) {
  const a = [...state.assets.values()].filter((x) => x.kind === "audio")[n - 1];
  if (a) preview(a.id);
}

export function stopPreview() {
  pv.pause();
  pvId = null;
  setPlaying(null);
}

function setPlaying(id) {
  if (id === null) pvId = null;
  body.querySelectorAll(".card").forEach((c) => {
    const on = c.dataset.id === id;
    c.classList.toggle("playing", on);
    c.querySelector(".play").textContent = on ? "■" : "▶";
    if (!on) c.querySelector(".prog").style.width = "0";
  });
}

function updateProgress() {
  const c = body.querySelector(`.card[data-id="${pvId}"]`);
  if (c && pv.duration) c.querySelector(".prog").style.width = `${(pv.currentTime / pv.duration) * 100}%`;
}
