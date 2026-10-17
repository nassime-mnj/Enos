"use strict";
// MODE CHILL : lecteur audio ambiant (balise <audio> native), liste des pistes de Stockage/Ambiance_Audio, mini-lecteur persistant.
(() => {
  const $ = (id) => document.getElementById(id);
  const TOKEN = document.querySelector('meta[name="nasko-token"]').content;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  async function api(path, opts = {}) {
    const r = await fetch(path, { ...opts, headers: { "X-Nasko-Token": TOKEN, "Content-Type": "application/json" } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
    return r.json();
  }
  const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  const mmss = (s) => (isFinite(s) ? Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0") : "0:00");
  const audio = $("ch-audio");
  let tracks = [], idx = -1, seeking = false, loaded = false;

  const urlPath = (t) => `/api/chill/file?name=${encodeURIComponent(t.id)}`;
  const isOpen = () => !$("ch").hidden;

  // ---------------------------------------------------------------- pistes
  async function loadTracks() {
    try { tracks = (await api("/api/chill/tracks")).items; } catch (e) { tracks = []; }
    $("ch-empty").hidden = tracks.length > 0;
    $("ch-count").textContent = tracks.length ? `${tracks.length} piste${tracks.length > 1 ? "s" : ""}` : "";
    const keep = idx >= 0 ? tracks.findIndex((t) => t.id === (audio.dataset.id || "")) : -1;
    idx = keep;
    renderList();
    if (!loaded && tracks.length) {                                 // dernière piste écoutée : préparée (sans jouer : l'autoplay est bloqué)
      const last = tracks.findIndex((t) => t.id === store.get("nasko_chill_last", ""));
      select(last >= 0 ? last : 0, false);
    }
    loaded = true;
  }

  function renderList() {
    const box = $("ch-list");
    box.innerHTML = "";
    tracks.forEach((t, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "ch-tr" + (i === idx ? " on" : ""); b.style.animationDelay = Math.min(i, 14) * 35 + "ms";
      b.innerHTML = `<span class="n">${i === idx && !audio.paused ? '<i class="eq"><u></u><u></u><u></u></i>' : String(i + 1).padStart(2, "0")}</span><span class="t"><b>${esc(t.name)}</b>${t.folder ? `<small>${esc(t.folder)}</small>` : ""}</span>`;
      b.onclick = () => { select(i, true); };
      box.appendChild(b);
    });
  }

  async function select(i, play) {
    if (!tracks.length) return;
    idx = (i + tracks.length) % tracks.length;
    const t = tracks[idx];
    audio.dataset.id = t.id;
    audio.src = await window.naskoSec.ticketUrl(urlPath(t));                  // <audio> n'envoie pas d'en-tête : ticket court
    store.set("nasko_chill_last", t.id);
    $("ch-title").textContent = t.name; $("ch-sub").textContent = t.folder || "Ambiance";
    $("mini-title").textContent = t.name;
    $("ch-seek").value = 0; $("ch-cur").textContent = "0:00"; $("ch-dur").textContent = "0:00";
    meta(t);
    if (play) audio.play().catch(() => {});
    renderList(); upd();
  }

  const next = () => select(idx + 1, true);
  const prev = () => (audio.currentTime > 4 ? (audio.currentTime = 0) : select(idx - 1, true));
  const toggle = () => { if (idx < 0) return select(0, true); audio.paused ? audio.play().catch(() => {}) : audio.pause(); };

  // ---------------------------------------------------------------- affichage
  function upd() {
    const playing = !audio.paused && !audio.ended;
    $("ch").classList.toggle("playing", playing);
    $("ch-play").textContent = playing ? "❚❚" : "▶"; $("mini-play").textContent = playing ? "❚❚" : "▶";
    $("ch-play").setAttribute("aria-label", playing ? "Pause" : "Lecture");
    $("ch-mini").classList.toggle("playing", playing);
    document.querySelectorAll("#ch-list .ch-tr").forEach((b, i) => {
      b.classList.toggle("on", i === idx);
      const n = b.querySelector(".n");
      n.innerHTML = i === idx && playing ? '<i class="eq"><u></u><u></u><u></u></i>' : String(i + 1).padStart(2, "0");
    });
    miniShow();
  }
  function miniShow() { $("ch-mini").hidden = $("ch").hidden === false || idx < 0 || (audio.paused && audio.currentTime === 0); }

  audio.addEventListener("play", upd); audio.addEventListener("pause", upd); audio.addEventListener("ended", () => { upd(); next(); });
  audio.addEventListener("loadedmetadata", () => { $("ch-dur").textContent = mmss(audio.duration); });
  audio.addEventListener("timeupdate", () => {
    if (!seeking && audio.duration) $("ch-seek").value = Math.round((audio.currentTime / audio.duration) * 1000);
    $("ch-cur").textContent = mmss(audio.currentTime);
    $("ch-seek").style.setProperty("--p", ((audio.currentTime / (audio.duration || 1)) * 100).toFixed(1) + "%");
    $("mini-bar").style.width = ((audio.currentTime / (audio.duration || 1)) * 100).toFixed(1) + "%";
    if ("mediaSession" in navigator && audio.duration && isFinite(audio.duration)) {
      try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: audio.currentTime, playbackRate: audio.playbackRate }); } catch (e) {}
    }
  });
  audio.addEventListener("error", () => { if (audio.src) { $("ch-sub").textContent = "Piste illisible : passage à la suivante…"; setTimeout(() => tracks.length > 1 && next(), 1200); } });

  // commandes de l'écran verrouillé / notification (Android, navigateur)
  function meta(t) {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.name, artist: "E.N.O.S. · Mode Chill", album: t.folder || "Ambiance" });
    const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) {} };
    set("play", () => audio.play()); set("pause", () => audio.pause()); set("nexttrack", next); set("previoustrack", prev);
    set("seekto", (d) => { if (d.seekTime != null) audio.currentTime = d.seekTime; });
  }

  // ---------------------------------------------------------------- panneau / mini-lecteur
  function open() {
    $("ch").hidden = false; document.body.classList.remove("menu-open"); document.body.classList.add("ch-open");
    miniShow(); loadTracks();
  }
  function hide() { $("ch").hidden = true; document.body.classList.remove("ch-open"); miniShow(); }          // la musique continue
  function stopAll() { audio.pause(); audio.currentTime = 0; $("ch-mini").hidden = true; }

  function init() {
    if (!$("b-ch")) return;
    audio.volume = store.get("nasko_chill_vol", 0.7);
    $("ch-vol").value = Math.round(audio.volume * 100);
    $("b-ch").onclick = open;
    $("ch-hide").onclick = hide;
    $("ch-play").onclick = toggle; $("mini-play").onclick = toggle;
    $("ch-next").onclick = next; $("ch-prev").onclick = prev; $("mini-next").onclick = next; $("mini-prev").onclick = prev;
    $("mini-open").onclick = open; $("mini-stop").onclick = stopAll;
    $("ch-vol").oninput = (e) => { audio.volume = e.target.value / 100; store.set("nasko_chill_vol", audio.volume); $("ch-vol").style.setProperty("--p", e.target.value + "%"); };
    $("ch-vol").style.setProperty("--p", $("ch-vol").value + "%");
    const seek = $("ch-seek");
    seek.addEventListener("input", () => { seeking = true; $("ch-cur").textContent = mmss((seek.value / 1000) * (audio.duration || 0)); seek.style.setProperty("--p", seek.value / 10 + "%"); });
    seek.addEventListener("change", () => { if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration; seeking = false; });
    $("ch-refresh").onclick = loadTracks;
    $("ch-folder").onclick = () => api("/api/chill/open-folder", { method: "POST" }).catch(() => {});
    document.addEventListener("keydown", (e) => {
      if (!isOpen()) return;
      if (e.key === "Escape") hide();
      else if (e.code === "Space" && !/^(INPUT|TEXTAREA|BUTTON)$/.test((document.activeElement || {}).tagName || "")) { e.preventDefault(); toggle(); }
      else if (e.key === "ArrowRight" && e.altKey) next(); else if (e.key === "ArrowLeft" && e.altKey) prev();
    });
  }
  init();
})();
