"use strict";
// YOUTUBE UPLOADER : sélection de la vidéo (~\Videos), titre, visibilité, envoi avec barre de progression.
// « Conçu pour les enfants » n'existe PAS dans cette interface : le serveur l'envoie toujours à False.
(() => {
  const $ = (id) => document.getElementById(id);
  const TOKEN = document.querySelector('meta[name="nasko-token"]').content;
  async function api(path, opts = {}) {
    const r = await fetch(path, { ...opts, headers: { "X-Nasko-Token": TOKEN, "Content-Type": "application/json" } });
    if (!r.ok) {
      let d = r.statusText;
      try { d = (await r.json()).detail || d; } catch (e) {}
      throw new Error(typeof d === "string" ? d : "requête refusée");
    }
    return r.json();
  }
  const post = (p, b) => api(p, { method: "POST", body: JSON.stringify(b || {}) });
  const bytes = (n) => (n < 1048576 ? (n / 1024).toFixed(0) + " Ko" : n < 1073741824 ? (n / 1048576).toFixed(1) + " Mo" : (n / 1073741824).toFixed(2) + " Go");
  const VIDEO_RE = /\.(mp4|mov|avi|wmv|flv|mkv|webm|mpg|mpeg|m4v|3gp)$/i;

  let video = null, timer = 0;
  const isOpen = () => !$("yt").hidden;
  const showErr = (id, msg) => { const e = $(id); e.textContent = msg || ""; e.hidden = !msg; };

  async function open() {
    $("yt").hidden = false;
    poll();
  }
  function close() { $("yt").hidden = true; clearTimeout(timer); }

  // ---------------------------------------------------------------- validation de l'interface
  function validate() {
    let ok = true;
    const t = $("yt-title").value.replace(/\s+/g, " ").trim();
    showErr("yt-title-e", "");
    showErr("yt-form-e", "");
    if (!video) { showErr("yt-form-e", "Choisissez d'abord une vidéo."); ok = false; }
    else if (!VIDEO_RE.test(video.path)) { showErr("yt-form-e", "Format non pris en charge."); ok = false; }
    if (!t) { showErr("yt-title-e", "Le titre est obligatoire."); ok = false; }
    else if (/[<>]/.test(t)) { showErr("yt-title-e", "Le titre ne peut pas contenir « < » ni « > »."); ok = false; }
    return ok ? t : null;
  }

  // ---------------------------------------------------------------- état serveur -> interface
  async function refresh() {
    let st;
    try { st = await api("/api/youtube/state"); } catch (e) { showErr("yt-form-e", e.message); return null; }
    render(st);
    return st;
  }

  function render(st) {
    const busy = st.busy;
    $("yt-setup").hidden = st.configured && st.phase !== "setup";
    $("yt-connect").hidden = !st.configured || st.authorized;
    $("yt-acct").textContent = st.authorized ? "● CHAÎNE CONNECTÉE" : "○ NON CONNECTÉ";
    const cb = $("yt-conn");
    cb.textContent = st.authorized ? "✔ CONNECTÉ À YOUTUBE" : st.phase === "setup" ? "■ ANNULER (en attente du JSON Google…)" : st.phase === "auth" ? "■ ANNULER (en attente de Google…)" : "CONNECTER À YOUTUBE";
    cb.disabled = st.authorized;
    cb.classList.toggle("on", st.authorized);
    $("yt-acct").classList.toggle("on", st.authorized);
    $("yt-disc").hidden = !st.authorized;
    $("yt-form").hidden = !st.configured || !st.authorized;
    $("yt-go").hidden = busy;
    $("yt-stop").hidden = st.phase !== "uploading";
    ["yt-pick", "yt-title", "yt-vis"].forEach((id) => ($(id).disabled = busy));
    $("yt-auth").disabled = st.phase === "auth";
    const showProg = st.phase === "uploading" || st.phase === "done" || (st.phase === "error" && st.progress > 0) || st.phase === "cancelled";
    $("yt-prog").hidden = !showProg;
    const pct = Math.round((st.progress || 0) * 100);
    $("yt-bar-i").style.width = pct + "%";
    $("yt-pct").textContent = pct + " %";
    $("yt-msg").textContent = st.message || "";
    $("yt-prog").dataset.phase = st.phase;
    $("yt-log").textContent = (st.log || []).join("\n");
    $("yt-log").scrollTop = 1e9;
    $("yt-log").hidden = !(st.log || []).length;
    const done = st.phase === "done" && st.result;
    $("yt-done").hidden = !done;
    if (done) {
      $("yt-link").textContent = st.result.url;
      $("yt-link").href = st.result.url;
      $("yt-note").textContent = st.result.privacy !== st.result.requested
        ? "⚠ YouTube a verrouillé cette vidéo en PRIVÉ : tant que votre projet API n'est pas audité par Google, les envois restent privés. Vous pouvez la rendre publique depuis YouTube Studio."
        : "";
    }
    if (st.phase === "error") showErr("yt-form-e", st.message);
  }

  function poll() {
    clearTimeout(timer);
    if (!isOpen()) return;
    refresh().then((st) => { timer = setTimeout(poll, st && st.busy ? 500 : 2500); });
  }

  // ---------------------------------------------------------------- actions
  async function pick() {
    showErr("yt-form-e", "");
    try {
      const r = await post("/api/youtube/pick");
      if (r.error) return showErr("yt-form-e", r.error);
      if (!r.path) return;
      video = { path: r.path, size: r.size };
      const name = r.path.split(/[\\/]/).pop();
      const b = document.createElement("b");
      b.textContent = name;
      b.title = r.path;
      const sm = document.createElement("small");
      sm.textContent = bytes(r.size || 0);
      $("yt-file").replaceChildren(b, sm);
      if (!$("yt-title").value.trim()) { $("yt-title").value = name.replace(/\.[^.]+$/, "").slice(0, 100); count(); }     // titre proposé : nom du fichier
    } catch (e) { showErr("yt-form-e", e.message); }
  }

  const count = () => { $("yt-count").textContent = $("yt-title").value.length + " / 100"; };

  async function submit(e) {
    e.preventDefault();
    const title = validate();
    if (title === null) return;
    try {
      $("yt-done").hidden = true;
      await post("/api/youtube/upload", { path: video.path, title, visibility: $("yt-vis").value });
      poll();
    } catch (err) { showErr("yt-form-e", err.message); }
  }

  function init() {
    if (!$("b-yt")) return;
    $("b-yt").onclick = open;
    $("yt-close").onclick = close;
    $("yt-pick").onclick = pick;
    $("yt-title").oninput = () => { count(); showErr("yt-title-e", ""); };
    $("yt-form").onsubmit = submit;
    $("yt-stop").onclick = () => post("/api/youtube/cancel").catch(() => {});
    $("yt-conn").onclick = async () => {                       // bouton permanent : connecte la chaîne, ou guide vers la configuration unique si elle manque
      showErr("yt-form-e", "");
      const st = await refresh();
      if (!st) return;
      try {
        if (st.phase === "setup" || st.phase === "auth") { await post("/api/youtube/cancel"); }              // le même bouton annule une attente en cours
        else { await post("/api/youtube/connect"); }                                                          // tout le reste est automatique
        poll();
      } catch (e) { showErr("yt-form-e", e.message); }
    };
    $("yt-import").onclick = async () => {
      try { const r = await post("/api/youtube/import-secret"); if (r.ok) { await refresh(); showErr("yt-form-e", ""); $("yt-conn").click(); } }
      catch (e) { showErr("yt-form-e", e.message); }
    };
    $("yt-auth").onclick = async () => {
      try { showErr("yt-form-e", ""); await post("/api/youtube/connect"); poll(); }
      catch (e) { showErr("yt-form-e", e.message); $("yt-form").hidden = false; }
    };
    $("yt-disc").onclick = async () => { await post("/api/youtube/disconnect"); refresh(); };
    $("yt-opencfg").onclick = () => post("/api/youtube/open-config").catch(() => {});
    $("yt-recheck").onclick = refresh;
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) close(); });
  }
  init();
})();
