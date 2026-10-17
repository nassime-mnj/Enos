"use strict";
// VISUALISEUR D'ANIMATION : explorateur de dossiers (Binageux / Jeu Projet) puis lecteur de frames en pixel art.
(() => {
  const $ = (id) => document.getElementById(id);
  const TOKEN = document.querySelector('meta[name="nasko-token"]').content;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  async function fetchT(path) {
    const r = await fetch(path, { headers: { "X-Nasko-Token": TOKEN } });
    if (!r.ok) {
      let d = r.statusText;
      try { d = (await r.json()).detail || d; } catch (e) {}
      throw new Error(d);
    }
    return r;
  }
  const api = async (p) => (await fetchT(p)).json();
  const q = encodeURIComponent;

  // ------------------------------------------------------------ explorateur
  let roots = [], cur = null;                     // cur = reponse de /api/anim/browse

  async function loadRoots() {
    try { roots = (await api("/api/anim/roots")).items; } catch (e) { roots = []; }
    const box = $("av-roots");
    box.innerHTML = "";
    for (const r of roots) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "av-root"; b.disabled = !r.ok; b.dataset.key = r.key;
      b.innerHTML = `<b>${esc(r.label.toUpperCase())}</b><small>${esc(r.ok ? r.path : "dossier introuvable")}</small>`;
      b.onclick = () => browse(r.path);
      box.appendChild(b);
    }
  }

  async function browse(path) {
    try { cur = await api("/api/anim/browse?path=" + q(path)); }
    catch (e) { return note(e.message, true); }
    note("");
    renderBrowse();
  }

  function renderBrowse() {
    document.querySelectorAll(".av-root").forEach((b) => b.classList.toggle("on", roots.find((r) => r.key === b.dataset.key)?.label === cur.root));
    // fil d'Ariane : racine + segments relatifs
    const rel = cur.path.slice(cur.root_path.length).split(/[\\/]/).filter(Boolean);
    $("av-crumb").innerHTML = [`<span>${esc(cur.root.toUpperCase())}</span>`, ...rel.map((s) => `<span>${esc(s)}</span>`)].join('<i>▸</i>');
    const list = $("av-dirs");
    list.innerHTML = "";
    if (cur.parent) {
      const up = document.createElement("button");
      up.type = "button"; up.className = "av-dir up";
      up.innerHTML = `<span class="ic">↰</span><b>Dossier parent</b>`;
      up.onclick = () => browse(cur.parent);
      list.appendChild(up);
    }
    for (const d of cur.dirs) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "av-dir";
      b.innerHTML = `<span class="ic">▣</span><b>${esc(d.name)}</b><em>${d.images ? d.images + " image" + (d.images > 1 ? "s" : "") : ""}</em><span class="go">▸</span>`;
      b.onclick = () => browse(d.path);              // entrer dans le dossier : AUCUNE validation implicite
      list.appendChild(b);
    }
    if (!cur.dirs.length && !cur.parent) list.innerHTML = '<div class="av-none">— dossier vide —</div>';
    $("av-here").textContent = cur.path;
    const ok = cur.images > 0;
    const v = $("av-validate");
    v.disabled = !ok;
    $("av-validate-main").textContent = ok ? "VALIDER CE DOSSIER" : "AUCUNE IMAGE DANS CE DOSSIER";
    $("av-validate-sub").textContent = ok ? `${cur.images} image${cur.images > 1 ? "s" : ""} détectée${cur.images > 1 ? "s" : ""} ici` : "Entrez dans le dossier qui contient vos frames";
  }

  function note(msg, bad) {
    const n = $("av-note");
    n.textContent = msg; n.classList.toggle("bad", !!bad); n.hidden = !msg;
  }

  // ------------------------------------------------------------ lecteur
  const P = { frames: [], bmp: [], idx: 0, playing: false, loop: true, fps: 12, zoom: 0, last: 0, acc: 0, raf: 0, bg: 0, w: 1, h: 1 };
  const ctx = () => $("av-cv").getContext("2d");
  const BGS = ["checker", "dark", "light", "green"];

  async function validate() {
    if (!cur || !cur.images) return;
    $("av-explore").hidden = true; $("av-player").hidden = false;
    $("av-loading").hidden = false; $("av-stage-wrap").hidden = true;
    $("av-load-txt").textContent = "Lecture du dossier…"; $("av-load-fill").style.width = "0%";
    stop();
    let data;
    try { data = await api("/api/anim/frames?path=" + q(cur.path)); }
    catch (e) { return backToExplorer(e.message); }
    P.frames = data.frames; P.bmp = new Array(P.frames.length);
    if (!P.frames.length) return backToExplorer("Aucune image avec un nombre dans le nom : tri impossible.");
    // chargement des frames (6 en parallele) : l'en-tete porte le jeton, donc fetch + createImageBitmap plutot que <img>
    let done = 0, fail = 0, next = 0;
    const worker = async () => {
      while (next < P.frames.length) {
        const i = next++;
        try {
          const blob = await (await fetchT(`/api/anim/frame?path=${q(data.path)}&name=${q(P.frames[i].name)}`)).blob();
          P.bmp[i] = await createImageBitmap(blob);
        } catch (e) { fail++; }
        done++;
        $("av-load-txt").textContent = `Chargement des frames ${done} / ${P.frames.length}`;
        $("av-load-fill").style.width = (done / P.frames.length * 100).toFixed(0) + "%";
      }
    };
    await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
    const ok = P.frames.map((f, i) => [f, P.bmp[i]]).filter((x) => x[1]);
    if (!ok.length) return backToExplorer("Aucune frame lisible.");
    P.frames = ok.map((x) => x[0]); P.bmp = ok.map((x) => x[1]);
    P.w = Math.max(...P.bmp.map((b) => b.width)); P.h = Math.max(...P.bmp.map((b) => b.height));
    const cv = $("av-cv"); cv.width = P.w; cv.height = P.h;
    P.idx = 0; P.zoom = 0;
    $("av-folder").textContent = data.path;
    let msg = `${P.frames.length} frame${P.frames.length > 1 ? "s" : ""} · ${P.w}×${P.h}px`;
    if (data.ignored) msg += ` · ${data.ignored} fichier(s) sans nombre ignoré(s)`;
    if (data.truncated) msg += " · limité aux 1000 premières";
    if (fail) msg += ` · ${fail} illisible(s)`;
    $("av-info").textContent = msg;
    $("av-scrub").max = P.frames.length - 1;
    $("av-loading").hidden = true; $("av-stage-wrap").hidden = false;
    fit(); draw(); play();
  }

  function backToExplorer(msg) {
    stop();
    $("av-player").hidden = true; $("av-explore").hidden = false;
    if (msg) note(msg, true);
  }

  function fit() {                                   // zoom entier (netteté parfaite) : le plus grand qui tient dans la scène
    const box = $("av-stage");
    const auto = Math.max(1, Math.floor(Math.min((box.clientWidth - 24) / P.w, (box.clientHeight - 24) / P.h)));
    const z = P.zoom || auto;
    const cv = $("av-cv");
    cv.style.width = P.w * z + "px"; cv.style.height = P.h * z + "px";
    $("av-zoom").textContent = (P.zoom ? "×" + z : "AUTO ×" + auto);
  }

  function draw() {
    const c = ctx(), b = P.bmp[P.idx];
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, P.w, P.h);
    c.drawImage(b, Math.floor((P.w - b.width) / 2), Math.floor((P.h - b.height) / 2));
    $("av-scrub").value = P.idx;
    $("av-fname").textContent = `${P.idx + 1} / ${P.frames.length}  ·  ${P.frames[P.idx].name}`;
  }

  function tick(t) {
    P.raf = requestAnimationFrame(tick);
    if (!P.last) P.last = t;
    P.acc += t - P.last; P.last = t;
    const step = 1000 / P.fps;
    while (P.acc >= step) {
      P.acc -= step;
      if (P.idx < P.frames.length - 1) P.idx++;
      else if (P.loop) P.idx = 0;
      else { pause(); break; }
    }
    draw();
  }

  function play() {
    if (P.playing) return;
    if (!P.loop && P.idx >= P.frames.length - 1) P.idx = 0;     // relance depuis le début si l'animation était finie
    P.playing = true; P.last = 0; P.acc = 0; P.raf = requestAnimationFrame(tick); upd();
  }
  function pause() { P.playing = false; cancelAnimationFrame(P.raf); upd(); }
  function stop() { P.playing = false; cancelAnimationFrame(P.raf); }
  function step(d) { pause(); P.idx = (P.idx + d + P.frames.length) % P.frames.length; draw(); }

  function upd() {
    $("av-play").textContent = P.playing ? "❚❚  PAUSE" : "▶  PLAY";
    $("av-play").classList.toggle("on", P.playing);
    $("av-loop").classList.toggle("on", P.loop);
    $("av-loop").textContent = "⟲  BOUCLE : " + (P.loop ? "ON" : "OFF");
    $("av-fps-v").textContent = P.fps + " FPS";
  }

  // ------------------------------------------------------------ panneau
  const isOpen = () => !$("av").hidden;
  async function open() {
    $("av").hidden = false;
    if (!roots.length) await loadRoots();
    if (!cur) { const r = roots.find((x) => x.ok); if (r) browse(r.path); }
  }
  function close() { stop(); $("av").hidden = true; }

  function init() {
    const b = $("b-av");
    if (!b) return;
    b.onclick = open;
    $("av-close").onclick = close;
    $("av-validate").onclick = validate;
    $("av-change").onclick = () => backToExplorer("");
    $("av-play").onclick = () => (P.playing ? pause() : play());
    $("av-prev").onclick = () => step(-1);
    $("av-next").onclick = () => step(1);
    $("av-loop").onclick = () => { P.loop = !P.loop; upd(); };
    $("av-fps").oninput = (e) => { P.fps = +e.target.value; upd(); };
    $("av-scrub").oninput = (e) => { pause(); P.idx = +e.target.value; draw(); };
    $("av-zin").onclick = () => { const cur_ = P.zoom || +$("av-zoom").textContent.replace(/\D+/, ""); P.zoom = Math.min(cur_ + 1, 40); fit(); };
    $("av-zout").onclick = () => { const cur_ = P.zoom || +$("av-zoom").textContent.replace(/\D+/, ""); P.zoom = Math.max(cur_ - 1, 1); fit(); };
    $("av-zauto").onclick = () => { P.zoom = 0; fit(); };
    $("av-bg").onclick = () => { P.bg = (P.bg + 1) % BGS.length; $("av-stage").dataset.bg = BGS[P.bg]; $("av-bg").textContent = "FOND : " + BGS[P.bg].toUpperCase(); };
    window.addEventListener("resize", () => { if (isOpen() && !$("av-stage-wrap").hidden) fit(); });
    document.addEventListener("keydown", (e) => {
      if (!isOpen() || $("av-player").hidden || $("av-stage-wrap").hidden) return;
      if (e.code === "Space") { e.preventDefault(); P.playing ? pause() : play(); }
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "Escape") backToExplorer("");
    });
    upd();
  }
  init();
})();
