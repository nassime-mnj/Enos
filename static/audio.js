"use strict";
// LABORATOIRE AUDIO : extraction WAV, détection des SFX (pydub), éditeur wavesurfer.js + Regions, export, playlist.
(() => {
  const $ = (id) => document.getElementById(id);
  const TOKEN = document.querySelector('meta[name="nasko-token"]').content;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const H = { "X-Nasko-Token": TOKEN };
  async function api(path, opts = {}) {
    const r = await fetch(path, { ...opts, headers: { ...H, "Content-Type": "application/json" } });
    if (!r.ok) {
      let d = r.statusText;
      try { d = (await r.json()).detail || d; } catch (e) {}
      throw new Error(typeof d === "string" ? d : "requête refusée");
    }
    return r.json();
  }
  const post = (p, b) => api(p, { method: "POST", body: JSON.stringify(b || {}) });
  const blobOf = async (scope, path) => (await (await fetch(`/api/audio/file?scope=${scope}&path=${encodeURIComponent(path)}`, { headers: H })).blob());
  const bytes = (n) => (n < 1024 ? n + " o" : n < 1048576 ? (n / 1024).toFixed(1) + " Ko" : (n / 1048576).toFixed(2) + " Mo");
  const tm = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60); return m + ":" + (s - m * 60).toFixed(3).padStart(6, "0"); };
  const HUES = [168, 190, 275, 330, 45, 205, 140, 300];
  const colorOf = (i, a = 0.28) => `hsla(${HUES[i % HUES.length]},100%,60%,${a})`;

  let fmt = "mp3", kbps = 192, ws = null, rg = null, name = "", duration = 0, defaults = {}, active = null, raf = 0, preview = null;
  const meta = new Map();                       // region.id -> { el (contenu sur l'onde), num (élément <b>) }

  // ---------------------------------------------------------------- style injecté dans le shadow DOM de wavesurfer
  const SHADOW_CSS = `
   .rg{display:flex;align-items:center;gap:3px;padding:2px 3px;font:700 11px Consolas,monospace;color:#fff;white-space:nowrap;pointer-events:auto;
       background:#000000b0;border:1px solid #ffffff55;position:absolute;top:2px;left:3px;max-width:calc(100% - 6px);overflow:hidden}
   .rg b{padding:0 4px;color:#00ffe1}
   .rg button{all:unset;cursor:pointer;width:20px;height:18px;text-align:center;font-size:11px;color:#fff;background:#ffffff1f}
   .rg button:hover{background:#00ffe1;color:#000}.rg button.x:hover{background:#ff2a6d;color:#fff}
   [part~="region"]{border-left:2px solid #ffffffcc!important;border-right:2px solid #ffffffcc!important;transition:background-color .15s,box-shadow .15s}
   [part~="region"]:hover{box-shadow:inset 0 0 0 9999px #ffffff12}
   [part~="region"].on{box-shadow:inset 0 0 0 2px #fff,0 0 18px #00ffe1aa}
   [part~="region-handle"]{width:8px!important;background:#ffffffee!important;border:0!important}`;

  // ---------------------------------------------------------------- écran de chargement (réutilisé : extraction vidéo -> WAV)
  async function runJob(path) {
    await post("/api/audio/start", { path });
    window.nasko_ov_lock = true;
    const ov = window.nasko_ov, cancel = $("ip-ov-cancel");
    ov.on("work", "Traitement de votre produit en cours...", path.split(/[\\/]/).pop());
    cancel.hidden = false; cancel.disabled = false;
    cancel.onclick = async () => { cancel.disabled = true; try { await post("/api/audio/cancel"); } catch (e) {} };
    let st;
    for (;;) {
      await wait(400);
      try { st = await api("/api/audio/state"); } catch (e) { continue; }
      if (st.busy) { ov.setTarget(st.progress); ov.on("work", "Traitement de votre produit en cours...", `${st.stage}  ·  ${st.name}`); } else break;
    }
    if (!st.error) { ov.finish(); await wait(500); }
    cancel.hidden = true; ov.off(); window.nasko_ov_lock = false;
    if (st.error) throw new Error(st.error);
    return st.result;
  }

  // ---------------------------------------------------------------- étape 1 : choix du fichier
  const perr = (m) => { const e = $("au-perr"); e.textContent = m ? "⚠ " + m : ""; e.hidden = !m; };

  async function openStart() {
    destroyWs();
    $("au-edit").hidden = true; $("au-start").hidden = false; $("au-export").hidden = true; $("au-file").textContent = "";
    perr("");
    try {
      const r = await api("/api/audio/todo");
      defaults = r.defaults;
      $("au-nofx").hidden = r.ffmpeg;
      $("au-todo").innerHTML = r.items.length ? `<div class="lbl">Dans « Audio / A faire » :</div>` : "";
      r.items.forEach((i) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "au-item";
        b.innerHTML = `<span class="k ${i.kind}">${i.kind === "video" ? "VIDÉO" : "AUDIO"}</span><b>${esc(i.name)}</b><em>${bytes(i.size)}</em>`;
        b.onclick = () => importFile(i.path);
        $("au-todo").appendChild(b);
      });
    } catch (e) {}
  }

  async function importFile(path) {
    perr("");
    try { const res = await runJob(path); await loadResult(res); refreshPlaylist(); }
    catch (e) { perr(e.message); }
  }

  async function browse() {
    perr("");
    try {
      const r = await post("/api/audio/pick");
      if (r.error) return perr(r.error);
      if (r.path) importFile(r.path);
    } catch (e) { perr(e.message); }
  }

  // ---------------------------------------------------------------- étape 2 : éditeur
  function destroyWs() {
    cancelAnimationFrame(raf);
    if (ws) { try { ws.destroy(); } catch (e) {} }
    ws = rg = null; meta.clear(); active = null; $("au-wave").innerHTML = "";
  }

  async function loadResult(res) {
    name = res.name; duration = res.duration;
    $("au-start").hidden = true; $("au-edit").hidden = false; $("au-export").hidden = false;
    $("au-file").textContent = `${res.name}  ·  ${tm(res.duration)}  ·  ${res.rate} Hz  ·  ${res.channels === 1 ? "mono" : res.channels === 2 ? "stéréo" : res.channels + " canaux"}  ·  ${res.bits} bits`;
    setParams(res.analysis.params);
    $("au-thr").textContent = res.analysis.thresh_db == null ? "piste silencieuse" : `seuil ${res.analysis.thresh_db} dB`;
    destroyWs();
    $("au-wave").classList.add("loading");
    const blob = await blobOf("work", res.name);
    const g = document.createElement("canvas").getContext("2d");
    const wg = g.createLinearGradient(0, 0, 0, 200); wg.addColorStop(0, "#00ffe1"); wg.addColorStop(0.5, "#5b8cff"); wg.addColorStop(1, "#c04dff");
    const pg = g.createLinearGradient(0, 0, 0, 200); pg.addColorStop(0, "#ffffff"); pg.addColorStop(1, "#ff2a6d");
    ws = WaveSurfer.create({ container: "#au-wave", height: 200, waveColor: wg, progressColor: pg, cursorColor: "#ffffff", cursorWidth: 2,
      barWidth: 2, barGap: 1, barRadius: 2, normalize: true, autoScroll: true, autoCenter: false });
    rg = ws.registerPlugin(WaveSurfer.Regions.create());
    const root = ws.getWrapper().getRootNode();
    const st = document.createElement("style"); st.textContent = SHADOW_CSS; root.appendChild(st);
    rg.enableDragSelection({ color: colorOf(rg.getRegions().length) });          // glisser sur l'onde = nouvelle zone
    rg.on("region-created", onCreated);
    rg.on("region-updated", () => schedule());
    rg.on("region-removed", (r) => { meta.delete(r.id); if (active === r.id) active = null; schedule(); });
    rg.on("region-clicked", (r, e) => { e.stopPropagation(); setActive(r.id); });
    ws.on("timeupdate", (t) => { $("au-time").textContent = tm(t) + " / " + tm(ws.getDuration()); });
    ws.on("play", () => syncPlay()); ws.on("pause", () => syncPlay()); ws.on("finish", () => syncPlay());
    await new Promise((ok) => { ws.once("ready", ok); ws.loadBlob(blob); });
    $("au-wave").classList.remove("loading");
    duration = ws.getDuration();
    setZoom();
    putRegions(res.analysis.regions);
    $("au-wave").ondblclick = onDbl;
  }

  function setParams(p) {
    $("au-p-off").value = p.offset_db; $("au-p-sil").value = p.min_silence_ms; $("au-p-keep").value = p.keep_ms; $("au-p-min").value = p.min_sfx_ms;
    updParamLabels();
  }
  function updParamLabels() {
    $("au-p-off-v").textContent = $("au-p-off").value + " dB"; $("au-p-sil-v").textContent = $("au-p-sil").value + " ms";
    $("au-p-keep-v").textContent = $("au-p-keep").value + " ms"; $("au-p-min-v").textContent = $("au-p-min").value + " ms";
  }

  // ---------------------------------------------------------------- régions
  function content(region) {
    const el = document.createElement("div"); el.className = "rg";
    el.innerHTML = `<b>00</b><button class="p" title="Écouter cette zone">▶</button><button class="x" title="Supprimer cette zone">✕</button>`;
    const stop = (e) => e.stopPropagation();
    el.querySelectorAll("button").forEach((b) => { b.addEventListener("pointerdown", stop); b.addEventListener("mousedown", stop); });
    el.querySelector(".p").addEventListener("click", (e) => { e.stopPropagation(); playRegion(region); });
    el.querySelector(".x").addEventListener("click", (e) => { e.stopPropagation(); region.remove(); });
    meta.set(region.id, { el, num: el.querySelector("b") });
    return el;
  }

  function onCreated(region) {                    // zone créée à la souris (ou par putRegions)
    if (!meta.has(region.id)) {
      const el = content(region);
      if (typeof region.setContent === "function") region.setContent(el); else region.setOptions({ content: el });
    }
    schedule();
  }

  function putRegions(list) {
    rg.getRegions().slice().forEach((r) => r.remove());
    list.forEach((r, i) => rg.addRegion({ start: r.start, end: r.end, color: colorOf(i), drag: true, resize: true, minLength: 0.005 }));
    schedule();
  }

  const sorted = () => (rg ? rg.getRegions().slice().sort((a, b) => a.start - b.start) : []);
  const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); };

  function setActive(id) {
    active = id;
    rg.getRegions().forEach((r) => r.element && r.element.classList.toggle("on", r.id === id));
    document.querySelectorAll(".au-reg").forEach((c) => c.classList.toggle("on", c.dataset.id === id));
  }

  function playRegion(r) { if (preview) stopPreview(); setActive(r.id); r.play(); }

  function render() {
    const regs = sorted();
    regs.forEach((r, i) => {
      const m = meta.get(r.id);
      if (m) m.num.textContent = String(i + 1).padStart(2, "0");
      if (r.element) r.element.classList.toggle("on", r.id === active);
    });
    const box = $("au-list");
    const focusId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.f : null;
    box.innerHTML = "";
    $("au-count").textContent = regs.length + " SFX détecté" + (regs.length > 1 ? "s" : "");
    $("au-empty").hidden = regs.length > 0;
    const exp = $("au-export"); exp.disabled = regs.length === 0;
    $("au-export-n").textContent = regs.length ? `${regs.length} fichier${regs.length > 1 ? "s" : ""} ${fmt.toUpperCase()}` : "aucune zone";
    regs.forEach((r, i) => {
      const c = document.createElement("div");
      c.className = "au-reg" + (r.id === active ? " on" : ""); c.dataset.id = r.id; c.style.setProperty("--c", colorOf(i, 1));
      c.style.animationDelay = Math.min(i, 10) * 30 + "ms";
      c.innerHTML = `<span class="n">${String(i + 1).padStart(2, "0")}</span>
        <label>DÉBUT<input type="number" step="0.001" min="0" value="${r.start.toFixed(3)}" data-f="s${r.id}"></label>
        <label>FIN<input type="number" step="0.001" min="0" value="${r.end.toFixed(3)}" data-f="e${r.id}"></label>
        <span class="d">${Math.round((r.end - r.start) * 1000)} ms</span>
        <button class="b p" title="Écouter">▶</button><button class="b x" title="Supprimer">✕</button>`;
      c.onclick = () => setActive(r.id);
      c.querySelector(".p").onclick = (e) => { e.stopPropagation(); playRegion(r); };
      c.querySelector(".x").onclick = (e) => { e.stopPropagation(); r.remove(); };
      const [si, ei] = c.querySelectorAll("input");
      const apply = () => {
        let s = parseFloat(si.value), e = parseFloat(ei.value);
        if (!(s >= 0) || !(e > s)) return render();
        r.setOptions({ start: Math.min(s, duration), end: Math.min(e, duration) });
      };
      si.onchange = apply; ei.onchange = apply;
      box.appendChild(c);
    });
    if (focusId) { const f = box.querySelector(`[data-f="${focusId}"]`); if (f) f.focus(); }
  }

  function onDbl(e) {                              // double-clic sur une zone vide : nouvelle zone de 0,3 s
    const path = e.composedPath ? e.composedPath() : [];
    if (path.some((n) => n.getAttribute && /region/.test(n.getAttribute("part") || ""))) return;
    const rect = ws.getWrapper().getBoundingClientRect();
    addAt(((e.clientX - rect.left) / rect.width) * duration);
  }
  function addAt(t) {
    const len = Math.min(0.3, duration), s = Math.max(0, Math.min(duration - len, t - len / 2));
    const r = rg.addRegion({ start: s, end: s + len, color: colorOf(rg.getRegions().length), drag: true, resize: true, minLength: 0.005 });
    setActive(r.id);
  }

  function setZoom() {
    const fit = $("au-wave").clientWidth / Math.max(0.01, duration), v = +$("au-zoom").value;
    ws.zoom(Math.max(fit, v));
  }

  function syncPlay() {
    $("au-play").textContent = ws && ws.isPlaying() ? "❚❚" : "▶";
    $("au-play").classList.toggle("on", ws && ws.isPlaying());
  }

  // ---------------------------------------------------------------- analyse / export
  async function reanalyze() {
    const b = $("au-re"); b.disabled = true; b.textContent = "ANALYSE…";
    try {
      const r = await post("/api/audio/analyze", { name, offset_db: +$("au-p-off").value, min_silence_ms: +$("au-p-sil").value, keep_ms: +$("au-p-keep").value, min_sfx_ms: +$("au-p-min").value });
      putRegions(r.regions);
      $("au-thr").textContent = r.thresh_db == null ? "piste silencieuse" : `seuil ${r.thresh_db} dB`;
      toast(`${r.regions.length} SFX détecté${r.regions.length > 1 ? "s" : ""}`);
    } catch (e) { toast(e.message, true); }
    b.disabled = false; b.textContent = "⟳ RE-ANALYSER";
  }

  async function exportAll() {
    const regs = sorted().map((r) => ({ start: +r.start.toFixed(4), end: +r.end.toFixed(4) }));
    if (!regs.length) return;
    const b = $("au-export"); b.disabled = true; b.classList.add("busy");
    try {
      const r = await post("/api/audio/export", { name, regions: regs, fmt, bitrate: kbps });
      showExport(r); refreshPlaylist(true);
    } catch (e) { toast(e.message, true); }
    b.classList.remove("busy"); b.disabled = false;
  }

  async function convertFull() {
    if (!name) return;
    const b = $("au-full"); b.disabled = true; const t = b.textContent; b.textContent = "CONVERSION…";
    try { const r = await post("/api/audio/mp3", { name, bitrate: kbps }); await showExport(r); refreshPlaylist(); }
    catch (e) { toast(e.message, true); }
    b.disabled = false; b.textContent = t;
  }

  let dests = null;
  async function getDests() {
    if (dests) return dests;
    try { dests = (await api("/api/imgproc/destinations")).items; } catch (e) { dests = []; }
    return dests;
  }

  async function showExport(r) {
    const d = $("au-done"), n = r.files.length, kind = r.fmt === "mp3" ? "MP3" : "WAV";
    const ds = await getDests();
    d.innerHTML = `<div class="box"><div class="tick">✔</div><h3>${n} ${n > 1 ? "FICHIERS EXPORTÉS" : "FICHIER EXPORTÉ"} · ${kind}</h3><div class="path">Audio / Livraison / ${esc(r.folder)}</div>
      <div class="fl">${r.files.map((f) => `<div><button data-p="${esc(r.folder + "/" + f.name)}">▶</button><b>${esc(f.name)}</b><em>${f.duration ? Math.round(f.duration * 1000) + " ms · " : ""}${bytes(f.size)}</em></div>`).join("")}</div>
      <div class="send"><h4>ENVOYER LE COLIS VERS…</h4><div class="dest">${ds.map((x) => `<button data-k="${esc(x.key)}" ${x.ok ? "" : "disabled"} title="${esc(x.path)}">${esc(x.label.toUpperCase())}<small>${x.ok ? esc(x.path) : "dossier introuvable"}</small></button>`).join("")}</div>
        <div class="sent" id="au-sent" role="status"></div></div>
      <div class="acts"><button class="btn" id="au-d-colis">📦 CRÉER LE COLIS SEULEMENT</button><button class="btn green" id="au-d-open">OUVRIR LE DOSSIER</button><button class="btn" id="au-d-close">CONTINUER</button></div></div>`;
    d.hidden = false;
    d.querySelectorAll(".fl button").forEach((b) => (b.onclick = () => togglePreview("out", b.dataset.p, b)));
    $("au-d-open").onclick = () => post("/api/audio/open-folder").catch(() => {});
    $("au-d-close").onclick = () => { stopPreview(); d.hidden = true; };
    const sent = (m, bad) => { const e = $("au-sent"); e.textContent = m; e.className = "sent" + (bad ? " bad" : ""); };
    const lock = (v) => d.querySelectorAll(".dest button,#au-d-colis").forEach((b) => { if (v) b.dataset.was = b.disabled ? "1" : ""; b.disabled = v ? true : b.dataset.was === "1"; });
    $("au-d-colis").onclick = async () => {
      lock(true); sent("Création du colis…");
      try { const c = await post("/api/audio/colis", { folder: r.folder }); sent(`📦 « ${c.name} » prêt dans Colis en attente (${c.count} fichier${c.count > 1 ? "s" : ""}).`); }
      catch (e) { sent(e.message, true); }
      lock(false);
    };
    d.querySelectorAll(".dest button").forEach((b) => (b.onclick = async () => {
      const x = ds.find((q) => q.key === b.dataset.k); if (!x) return;
      lock(true); b.classList.add("busy"); sent(`Envoi vers ${x.label}…`);
      try {
        const colis = await post("/api/audio/colis", { folder: r.folder });
        const out = await post("/api/imgproc/deliver", { colis: colis.name, dest: x.path });
        b.classList.remove("busy"); b.classList.add("ok"); sent(`✔ ${out.count} fichier${out.count > 1 ? "s" : ""} livré${out.count > 1 ? "s" : ""} dans ${out.folder}`);
        toast(`Colis envoyé vers ${x.label}`);
      } catch (e) { b.classList.remove("busy"); sent(e.message, true); }
      lock(false);
    }));
  }

  let toastT;
  function toast(msg, bad) {
    const t = $("au-toast"); t.textContent = msg; t.className = "au-toast show" + (bad ? " bad" : "");
    clearTimeout(toastT); toastT = setTimeout(() => (t.className = "au-toast"), 3800);
  }

  // ---------------------------------------------------------------- playlist (dossier de travail + livraison) + écoute rapide
  let tab = "work";
  function stopPreview() {
    if (preview) { preview.audio.pause(); URL.revokeObjectURL(preview.url); preview.btn.textContent = "▶"; preview.btn.classList.remove("on"); preview = null; }
  }
  async function togglePreview(scope, path, btn) {
    const same = preview && preview.btn === btn;
    stopPreview();
    if (same) return;
    if (ws && ws.isPlaying()) ws.pause();
    try {
      const url = URL.createObjectURL(await blobOf(scope, path));
      const audio = new Audio(url);
      preview = { audio, url, btn };
      btn.textContent = "■"; btn.classList.add("on");
      audio.onended = () => { if (preview && preview.audio === audio) stopPreview(); };
      await audio.play();
    } catch (e) { stopPreview(); }
  }

  async function refreshPlaylist() {
    let pl;
    try { pl = await api("/api/audio/playlist"); } catch (e) { return; }
    const box = $("au-pl"); box.innerHTML = "";
    $("au-pl-tabs").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.t === tab));
    if (tab === "work") {
      $("au-pl-n").textContent = pl.work.length + " piste" + (pl.work.length > 1 ? "s" : "");
      if (!pl.work.length) box.innerHTML = '<div class="none">Aucune piste. Importez un fichier : il sera converti en WAV et rangé ici.</div>';
      pl.work.forEach((w) => {
        const it = document.createElement("div"); it.className = "pl-item" + (w.name === name ? " cur" : "");
        it.innerHTML = `<button class="pb" title="Écouter">▶</button><div class="pi"><b>${esc(w.name)}</b><small>${tm(w.duration)} · ${w.rate} Hz · ${bytes(w.size)}</small></div><button class="pe" title="Ouvrir dans l'éditeur">✎</button>`;
        it.querySelector(".pb").onclick = (e) => togglePreview("work", w.name, e.currentTarget);
        it.querySelector(".pe").onclick = () => openWork(w.name);
        it.querySelector(".pi").onclick = () => openWork(w.name);
        box.appendChild(it);
      });
    } else {
      const total = pl.out.reduce((a, f) => a + f.files.length, 0);
      $("au-pl-n").textContent = total + " SFX";
      if (!pl.out.length) box.innerHTML = '<div class="none">Aucun SFX exporté pour l\'instant.</div>';
      pl.out.forEach((d) => {
        const h = document.createElement("div"); h.className = "pl-dir"; h.textContent = `▣ ${d.folder}  (${d.files.length})`; box.appendChild(h);
        d.files.forEach((f) => {
          const it = document.createElement("div"); it.className = "pl-item sm";
          it.innerHTML = `<button class="pb">▶</button><div class="pi"><b>${esc(f.name)}</b><small>${Math.round(f.duration * 1000)} ms · ${bytes(f.size)}</small></div>`;
          it.querySelector(".pb").onclick = (e) => togglePreview("out", d.folder + "/" + f.name, e.currentTarget);
          box.appendChild(it);
        });
      });
    }
  }

  async function openWork(n) {
    stopPreview();
    try {
      const res = await post("/api/audio/open", { name: n });
      await loadResult(res); refreshPlaylist();
    } catch (e) { toast(e.message, true); }
  }

  // ---------------------------------------------------------------- panneau
  const isOpen = () => !$("au").hidden;
  function open() { $("au").hidden = false; if (!ws) openStart(); refreshPlaylist(); }
  function close() { if (ws && ws.isPlaying()) ws.pause(); stopPreview(); $("au").hidden = true; }

  function init() {
    if (!$("b-au")) return;
    $("b-au").onclick = open;
    $("au-close").onclick = close;
    $("au-browse").onclick = browse;
    $("au-pathform").onsubmit = (e) => { e.preventDefault(); const v = $("au-path").value.trim(); if (v) importFile(v); };
    $("au-change").onclick = () => { if (ws && ws.isPlaying()) ws.pause(); openStart(); };
    $("au-play").onclick = () => ws && ws.playPause();
    $("au-stop").onclick = () => { if (ws) { ws.pause(); ws.setTime(0); } };
    $("au-zoom").oninput = () => ws && setZoom();
    $("au-add").onclick = () => ws && addAt(ws.getCurrentTime());
    $("au-clear").onclick = () => {
      const b = $("au-clear");
      if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "CONFIRMER ?"; setTimeout(() => { b.classList.remove("armed"); b.textContent = "TOUT EFFACER"; }, 3000); return; }
      rg.getRegions().slice().forEach((r) => r.remove()); b.classList.remove("armed"); b.textContent = "TOUT EFFACER";
    };
    ["au-p-off", "au-p-sil", "au-p-keep", "au-p-min"].forEach((id) => ($(id).oninput = updParamLabels));
    $("au-re").onclick = reanalyze;
    $("au-export").onclick = exportAll;
    $("au-full").onclick = convertFull;
    $("au-kb").onchange = () => (kbps = +$("au-kb").value);
    $("au-fmt").querySelectorAll("button").forEach((b) => (b.onclick = () => {
      fmt = b.dataset.f;
      $("au-fmt").querySelectorAll("button").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-checked", x === b); });
      $("au-kb-wrap").hidden = fmt !== "mp3"; if (ws) render();
    }));
    $("au-pl-tabs").querySelectorAll("button").forEach((b) => (b.onclick = () => { tab = b.dataset.t; refreshPlaylist(); }));
    $("au-pl-refresh").onclick = refreshPlaylist;
    $("au-pl-open").onclick = () => post("/api/audio/open-folder").catch(() => {});
    document.addEventListener("keydown", (e) => {
      if (!isOpen() || !$("ip-ov").hidden) return;
      const typing = /^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName || "");
      if (e.key === "Escape") { if (!$("au-done").hidden) $("au-d-close").click(); else close(); }
      else if (typing || !ws) return;
      else if (e.code === "Space") { e.preventDefault(); ws.playPause(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && active) { const r = rg.getRegions().find((x) => x.id === active); if (r) r.remove(); }
    });
    window.addEventListener("resize", () => { if (ws && isOpen()) setZoom(); });
  }
  init();
})();
