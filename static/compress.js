"use strict";
// COMPRESSION MÉDIA : choix image/vidéo, fichier, mode pourcentage ou cible (Mo), écran de chargement, résultat.
(() => {
  const $ = (id) => document.getElementById(id);
  const TOKEN = document.querySelector('meta[name="nasko-token"]').content;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
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
  const bytes = (n) => (n < 1024 ? n + " o" : n < 1048576 ? (n / 1024).toFixed(1) + " Ko" : (n / 1048576).toFixed(2) + " Mo");
  const dur = (s) => (s >= 3600 ? Math.floor(s / 3600) + " h " : "") + Math.floor((s % 3600) / 60) + " min " + Math.round(s % 60) + " s";
  const MIN_VIDEO_KBPS = 60;

  let kind = "", file = null, mode = "percent", ffmpeg = true;

  const show = (step) => { ["cp-s1", "cp-s2", "cp-s3"].forEach((id) => ($(id).hidden = id !== "cp-s" + step)); };
  const isOpen = () => !$("cp").hidden;
  const remote = () => document.body.classList.contains("remote");

  // ---------------------------------------------------------------- étape 1 : type
  async function open() {
    $("cp").hidden = false;
    show(1);
    if (!remote()) { try { ffmpeg = (await api("/api/compress/files")).ffmpeg; } catch (e) {} }          // téléphone : FFmpeg tourne sur le PC
    $("cp-nofx").hidden = ffmpeg;
    $("cp-vid").classList.toggle("off", !ffmpeg);
  }
  const close = () => { $("cp").hidden = true; };

  async function choose(k) {
    if (k === "video" && !ffmpeg) return;
    kind = k; file = null;
    $("cp-gal").accept = k === "image" ? "image/*" : "video/*";
    $("cp-kind").textContent = k === "image" ? "IMAGE" : "VIDÉO";
    $("cp-kind").dataset.k = k;
    $("cp-browse-l").textContent = k === "image" ? "OUVRIR MES IMAGES" : "OUVRIR MES VIDÉOS";
    $("cp-browse-s").textContent = "Le sélecteur s'ouvre directement dans ~\\" + (k === "image" ? "Pictures" : "Videos");
    $("cp-fname").textContent = "Aucun fichier sélectionné"; $("cp-finfo").textContent = "";
    $("cp-pick").hidden = false; $("cp-set").hidden = true; $("cp-perr").hidden = true; $("cp-path").value = "";
    show(2);
    if (remote()) return;                                    // téléphone : pas de dossier « A faire » à lister
    try {
      const items = (await api("/api/compress/files")).items.filter((i) => i.kind === k);
      $("cp-todo").innerHTML = items.length ? `<div class="lbl">Dans « Compression / A faire » :</div>` : "";
      items.forEach((i) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "cp-item"; b.innerHTML = `<b>${esc(i.name)}</b><em>${bytes(i.size)}</em>`;
        b.onclick = () => select(i.path);
        $("cp-todo").appendChild(b);
      });
    } catch (e) { $("cp-todo").innerHTML = ""; }
  }

  // ---------------------------------------------------------------- étape 2 : fichier + réglages
  function perr(msg) { const e = $("cp-perr"); e.textContent = msg || ""; e.hidden = !msg; }

  async function browse(where) {
    perr("");
    try {
      const r = await post("/api/compress/pick", { kind, where: where || "media" });
      if (r.error) return perr(r.error);
      if (r.path) select(r.path);
    } catch (e) { perr(e.message); }
  }

  async function select(path) {
    perr("");
    let info;
    try { info = await post("/api/compress/info", { path }); } catch (e) { return perr(e.message); }
    if (info.kind !== kind) return perr(`Ce fichier est une ${info.kind === "image" ? "image" : "vidéo"} : utilisez le bouton « COMPRESSER UNE ${info.kind === "image" ? "IMAGE" : "VIDÉO"} ».`);
    file = info;
    $("cp-fname").textContent = info.name;
    $("cp-finfo").textContent = kind === "image"
      ? `${info.width}×${info.height} px · ${info.format} · ${bytes(info.size)}`
      : `${info.width}×${info.height} · ${dur(info.duration)} · ${info.fps || "?"} fps · ${info.has_audio ? "audio " + (info.audio_kbps || "?") + " kb/s" : "sans audio"} · ${bytes(info.size)}`;
    $("cp-pick").hidden = true; $("cp-set").hidden = false;
    setMode(mode); upd();
  }

  function pickKindOf(f) {
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    if ((f.type || "").startsWith("image/") || ["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff", "heic"].includes(ext)) return "image";
    if ((f.type || "").startsWith("video/") || ["mp4", "mov", "mkv", "avi", "webm", "m4v", "3gp"].includes(ext)) return "video";
    return "";
  }

  function readMeta(f, k) {
    return new Promise((res) => {
      const u = URL.createObjectURL(f), done = (o) => { URL.revokeObjectURL(u); res(o); };
      if (k === "image") { const i = new Image(); i.onload = () => done({ width: i.naturalWidth, height: i.naturalHeight }); i.onerror = () => done({}); i.src = u; }
      else { const v = document.createElement("video"); v.preload = "metadata"; v.muted = true; v.onloadedmetadata = () => done({ duration: v.duration, width: v.videoWidth, height: v.videoHeight }); v.onerror = () => done({}); v.src = u; }
      setTimeout(() => done({}), 6000);
    });
  }

  async function selectLocalFile(f) {                       // téléphone : le fichier reste sur l'appareil jusqu'au lancement
    perr("");
    const k = pickKindOf(f);
    if (k !== kind) return perr(`Ce fichier n'est pas ${kind === "image" ? "une image" : "une vidéo"}.`);
    const m = await readMeta(f, k);
    file = { name: f.name, size: f.size, kind: k, width: m.width || 0, height: m.height || 0, duration: m.duration || 0, fps: 0,
             has_audio: true, audio_kbps: 128, format: (f.name.split(".").pop() || "").toUpperCase(), localFile: f };
    $("cp-fname").textContent = f.name;
    $("cp-finfo").textContent = k === "image"
      ? `${file.width}×${file.height} px · ${file.format} · ${bytes(f.size)}`
      : `${file.width}×${file.height} · ${file.duration ? dur(file.duration) : "durée inconnue"} · ${bytes(f.size)}`;
    $("cp-pick").hidden = true; $("cp-set").hidden = false;
    setMode(mode); upd();
  }

  function setMode(m) {
    mode = m;
    document.querySelectorAll(".cp-modes button").forEach((b) => b.classList.toggle("on", b.dataset.m === m));
    $("cp-pane-percent").hidden = m !== "percent";
    $("cp-pane-target").hidden = m !== "target";
    upd();
  }

  const crfOf = (p) => Math.max(18, Math.min(51, Math.round(18 + (100 - p) * 17 / 90)));

  function upd() {
    if (!file) return;
    const p = +$("cp-pct").value;
    $("cp-pct-v").textContent = p;
    $("cp-pct").style.setProperty("--p", p + "%");
    const isPng = /\.png$/i.test(file.name);
    $("cp-map").innerHTML = kind === "video"
      ? `<span>libx264</span><span>CRF <b>${crfOf(p)}</b></span><span>preset slow</span><span>audio AAC ${p >= 90 ? 192 : 128} kb/s</span>`
      : isPng ? `<span>PNG</span><span>${p >= 100 ? "<b>sans perte</b> (optimize)" : "palette <b>" + Math.max(4, Math.round(256 * p / 100)) + "</b> couleurs"}</span>`
              : `<span>${/\.webp$/i.test(file.name) ? "WEBP" : "JPEG"}</span><span>quality=<b>${p}</b></span><span>optimize=True</span>`;
    const t = parseFloat(String($("cp-tgt").value).replace(",", "."));
    let html = "";
    if (!(t > 0)) html = `<span class="bad">Entrez un nombre de Mo (ex. 8 ou 8,5)</span>`;
    else if (file.size <= t * 1048576) html = `<span class="ok">Le fichier (${bytes(file.size)}) est déjà sous la cible : il sera copié sans perte.</span>`;
    else if (kind === "video") {
      const abr = file.has_audio ? Math.min(128, file.audio_kbps || 128) : 0;
      const vk = (t * 8192) / file.duration - abr;
      html = vk < MIN_VIDEO_KBPS && file.has_audio && (t * 8192) / file.duration - 48 >= MIN_VIDEO_KBPS
        ? `<span>double passe</span><span>audio réduit à 48 kb/s</span><span>vidéo ≈ <b>${Math.round((t * 8192) / file.duration - 48)}</b> kb/s</span>`
        : vk < MIN_VIDEO_KBPS ? `<span class="bad">Cible trop basse pour cette durée (minimum ≈ ${((MIN_VIDEO_KBPS + abr) * file.duration / 8192).toFixed(2)} Mo)</span>`
        : `<span>double passe (2 pass)</span><span>vidéo ≈ <b>${Math.round(vk)}</b> kb/s</span><span>audio ${abr} kb/s</span><span>réduction ≈ ${Math.round((1 - t * 1048576 / file.size) * 100)} %</span>`;
    } else html = `<span>recherche binaire de la qualité</span><span>réduction de résolution si nécessaire</span><span>réduction ≈ ${Math.round((1 - t * 1048576 / file.size) * 100)} %</span>`;
    $("cp-tmap").innerHTML = html;
  }

  // ---------------------------------------------------------------- lancement + écran de chargement plein écran
  function uploadCompress(f, value, onProgress, abortBox) {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append("mode", mode); fd.append("value", String(value)); fd.append("file", f, f.name);
      const x = new XMLHttpRequest();
      abortBox.abort = () => x.abort();
      x.open("POST", "/api/compress/upload");
      x.setRequestHeader("X-Nasko-Token", TOKEN);
      x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      x.onload = () => {
        if (x.status >= 200 && x.status < 300) return resolve();
        let d = x.statusText; try { d = JSON.parse(x.responseText).detail || d; } catch (e) {}
        reject(new Error(d));
      };
      x.onerror = () => reject(new Error("connexion interrompue pendant l'envoi"));
      x.onabort = () => reject(new Error("Envoi annulé."));
      x.send(fd);
    });
  }

  async function go() {
    if (!file) return;
    const value = mode === "percent" ? +$("cp-pct").value : String($("cp-tgt").value).trim();
    window.nasko_ov_lock = true;
    const ov = window.nasko_ov, cancel = $("ip-ov-cancel"), box = {};
    const TITLE = "Traitement de votre produit en cours...";
    const fromPhone = !!file.localFile;
    cancel.hidden = false; cancel.disabled = false;
    cancel.onclick = async () => { cancel.disabled = true; if (box.abort && !box.sent) box.abort(); else { try { await post("/api/compress/cancel"); } catch (e) {} } };
    const fail = (m) => { cancel.hidden = true; ov.off(); window.nasko_ov_lock = false; perr2(m); };
    ov.on("work", TITLE, file.name);
    if (fromPhone) {                                          // 1) envoi du fichier au PC (0 → 30 %)
      try {
        await uploadCompress(file.localFile, value, (p) => { ov.setTarget(p * 30); ov.on("work", TITLE, `Envoi vers le PC… ${Math.round(p * 100)} %  ·  ${file.name}`); }, box);
        box.sent = true;
      } catch (e) { return fail(e.message); }
    } else {
      try { await post("/api/compress/start", { path: file.path, mode, value }); }
      catch (e) { return fail(e.message); }
    }
    let st;
    for (;;) {                                                // 2) le PC compresse (30 → 100 % côté téléphone)
      await wait(450);
      try { st = await api("/api/compress/state"); } catch (e) { continue; }
      if (st.busy) { ov.setTarget(fromPhone ? 30 + st.progress * 0.7 : st.progress); ov.on("work", TITLE, `${fromPhone ? "Compression sur le PC · " : ""}${st.stage}  ·  ${file.name}`); }
      else break;
    }
    if (!st.error) { ov.finish(); await wait(700); }
    cancel.hidden = true; ov.off(); window.nasko_ov_lock = false;
    if (st.error) { perr2(st.error); return; }
    result(st.result);
    if (st.result.download) triggerDownload(st.result.download, st.result.name);       // 3) renvoi immédiat du fichier compressé
  }

  function triggerDownload(path, name) {
    const a = document.createElement("a");
    a.href = path; a.download = name || ""; a.style.display = "none";
    document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 1500);
  }

  function perr2(msg) {                       // erreur affichée au-dessus des réglages
    const e = $("cp-perr"); e.textContent = "⚠ " + msg; e.hidden = false;
    $("cp-set").scrollIntoView({ behavior: "smooth", block: "end" });
    $("cp-s2").appendChild(e);
  }

  // ---------------------------------------------------------------- étape 3 : résultat
  function result(r) {
    const saved = Math.max(0, Math.round((1 - r.size / r.before) * 100)), grew = r.size >= r.before;
    $("cp-s3").innerHTML = `
      <div class="cp-res">
        <div class="tick">✔</div><h3>COMPRESSION TERMINÉE</h3>
        <div class="cmp"><div><small>AVANT</small><b>${bytes(r.before)}</b></div><div class="ar">▶</div><div class="after"><small>APRÈS</small><b>${bytes(r.size)}</b></div>
          <div class="sv ${grew ? "bad" : ""}"><small>${grew ? "VARIATION" : "GAIN"}</small><b>${grew ? "+" + Math.round((r.size / r.before - 1) * 100) : "−" + saved} %</b></div></div>
        <div class="bar"><i style="width:0"></i></div>
        <div class="meta"><span>${esc(r.name)}</span><span>${r.dims || ""}</span><span>${esc(r.detail || "")}</span><span>${r.seconds} s</span></div>
        ${r.note ? `<div class="cp-warn">${esc(r.note)}</div>` : ""}
        ${r.mode === "target" ? `<div class="cp-hit">Cible ${esc(String(r.value))} Mo · obtenu ${(r.size / 1048576).toFixed(3)} Mo (${Math.round(r.size / 1048576 / parseFloat(String(r.value).replace(",", ".")) * 100)} % de la cible)</div>` : ""}
        <div class="acts">${r.download ? `<a class="btn green" id="cp-r-dl" href="${esc(r.download)}" download="${esc(r.name)}">⬇ TÉLÉCHARGER LE FICHIER</a>` : '<button class="btn green" id="cp-r-open">OUVRIR LE DOSSIER LIVRAISON</button>'}<button class="btn" id="cp-r-again">RÉGLER À NOUVEAU</button><button class="btn" id="cp-r-new">AUTRE FICHIER</button></div>
      </div>`;
    show(3);
    requestAnimationFrame(() => requestAnimationFrame(() => { $("cp-s3").querySelector(".bar i").style.width = Math.max(2, 100 - saved) + "%"; }));
    if ($("cp-r-open")) $("cp-r-open").onclick = () => post("/api/compress/open").catch(() => {});
    $("cp-r-again").onclick = () => { perr(""); show(2); };
    $("cp-r-new").onclick = () => show(1);
  }

  function init() {
    if (!$("b-cp")) return;
    $("b-cp").onclick = open;
    $("cp-close").onclick = close;
    $("cp-img").onclick = () => choose("image");
    $("cp-vid").onclick = () => choose("video");
    $("cp-back").onclick = () => show(1);
    $("cp-browse").onclick = () => browse("media");
    $("cp-other").onclick = () => browse("other");
    $("cp-gal").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) selectLocalFile(f); };
    $("cp-pathform").onsubmit = (e) => { e.preventDefault(); if ($("cp-path").value.trim()) select($("cp-path").value.trim()); };
    document.querySelectorAll(".cp-modes button").forEach((b) => (b.onclick = () => setMode(b.dataset.m)));
    $("cp-pct").oninput = upd;
    $("cp-tgt").oninput = upd;
    document.querySelectorAll(".cp-chips button").forEach((b) => (b.onclick = () => { $("cp-tgt").value = b.dataset.v; upd(); }));
    $("cp-go").onclick = go;
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen() && $("ip-ov").hidden) close(); });
  }
  init();
})();
