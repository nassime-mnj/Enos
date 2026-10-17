"use strict";
// STUDIO MÉDIA : conversion d'images, vidéo -> MP3/GIF, agrandissement net, nettoyage audio, floutage de confidentialité, EXIF, pipette,
// transcription et sous-titres. Les fichiers sont déposés sur le serveur local (un « ref »), puis un outil est lancé sur ce ref ; l'avancement est interrogé.
(() => {
  const $ = (id) => document.getElementById(id);
  if (!$("sm") || !$("b-sm")) return;
  const TOKEN = document.querySelector('meta[name="nasko-token"]').content;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const bytes = (n) => (n < 1024 ? n + " o" : n < 1048576 ? (n / 1024).toFixed(1) + " Ko" : (n / 1048576).toFixed(2) + " Mo");
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let toastT = 0;
  const toast = (m, bad) => { const t = $("sm-toast"); t.textContent = m; t.className = "sm-toast show" + (bad ? " bad" : ""); clearTimeout(toastT); toastT = setTimeout(() => (t.className = "sm-toast"), bad ? 6500 : 3500); };

  async function api(path, opts = {}) {
    const h = { "X-Nasko-Token": TOKEN };
    let body = opts.body;
    if (body !== undefined && !(body instanceof FormData)) { h["Content-Type"] = "application/json"; body = JSON.stringify(body); }
    const r = await fetch(path, { method: opts.method || (body !== undefined ? "POST" : "GET"), headers: h, body });
    if (!r.ok) { let d = r.statusText; try { d = (await r.json()).detail || d; } catch (e) {} throw new Error(typeof d === "string" ? d : "requête refusée"); }
    return r.json();
  }

  const EXT = { image: ".jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff,.gif,.heic,.heif,.avif", video: ".mp4,.mov,.mkv,.avi,.webm,.m4v,.wmv,.flv,.mpg,.mpeg,.ts,.3gp", audio: ".mp3,.wav,.m4a,.aac,.ogg,.opus,.flac,.wma" };
  const LANGS = [["fr", "Français"], ["en", "Anglais"], ["es", "Espagnol"], ["de", "Allemand"], ["it", "Italien"], ["pt", "Portugais"], ["nl", "Néerlandais"], ["ar", "Arabe"], ["ru", "Russe"], ["ja", "Japonais"], ["zh", "Chinois"], ["", "Détection automatique"]];

  // ------------------------------------------------------------------ catalogue des outils
  const T = {
    convert_image: { g: "IMAGES", t: "Convertisseur d'images", s: "HEIC · WEBP · AVIF → JPG / PNG", accept: ["image"], multi: true, need: "heic", btn: "CONVERTIR",
      d: "Transforme les formats restrictifs (HEIC d'Apple, WEBP et AVIF de Google, TIFF, BMP…) en formats universels. Plusieurs images à la fois. Les métadonnées (position GPS…) sont retirées par défaut.",
      opts: [{ k: "fmt", l: "FORMAT DE SORTIE", type: "select", o: [["jpg", "JPG (universel)"], ["png", "PNG (sans perte, transparence)"], ["webp", "WEBP (léger)"]], d: "jpg" },
        { k: "quality", l: "QUALITÉ", type: "range", min: 40, max: 100, d: 92, show: (v) => v.fmt !== "png" }, { k: "keep_meta", l: "Conserver les métadonnées (EXIF, GPS…)", type: "check", d: false }] },
    upscale: { g: "IMAGES", t: "Agrandisseur net", s: "×2 · ×3 · ×4 · réduit les artefacts", accept: ["image"], multi: true, btn: "AGRANDIR",
      d: "Agrandit une image floue ou pixellisée en restaurant la netteté : suppression des artefacts de compression, interpolation Lanczos par paliers, netteté adaptative. Ce n'est pas une IA générative : elle n'invente pas les détails absents, mais le résultat est propre et net pour un partage ou une impression.",
      opts: [{ k: "factor", l: "AGRANDISSEMENT", type: "select", o: [[2, "× 2"], [3, "× 3"], [4, "× 4"]], d: 2, num: true }, { k: "clean", l: "Réduire les artefacts JPEG / la pixellisation", type: "check", d: true },
        { k: "sharp", l: "NETTETÉ", type: "range", min: 0, max: 100, d: 60 }] },
    blur: { g: "VIE PRIVÉE", t: "Floutage de confidentialité", s: "visages · plaques · zones de texte", accept: ["image"], special: "blur", need: "opencv",
      d: "Détecte les visages, les plaques d'immatriculation et les zones de texte, que vous validez ou complétez à la main avant de flouter. La détection est approximative : vérifiez toujours le résultat avant de partager. L'image exportée ne garde aucune métadonnée." },
    exif: { g: "VIE PRIVÉE", t: "Métadonnées (EXIF)", s: "lire · effacer GPS, date, appareil", accept: ["image"], multi: true, special: "exif",
      d: "Révèle ce qu'une photo contient en cachette (position GPS, date exacte, modèle de l'appareil, logiciel) puis l'efface. Un JPEG sans rotation est nettoyé sans recompression : aucune perte de qualité." },
    picker: { g: "IMAGES", t: "Pipette à couleurs", s: "HEX · RGB · CMJN", accept: ["image"], special: "picker",
      d: "Cliquez n'importe où sur une image pour obtenir le code couleur en HEX, RGB et CMJN. La conversion CMJN est mathématique (pas un profil d'impression)." },
    video_audio: { g: "VIDÉO & AUDIO", t: "Vidéo → MP3", s: "extraire la piste audio", accept: ["video", "audio"], multi: true, need: "ffmpeg", btn: "EXTRAIRE L'AUDIO",
      d: "Isole la piste audio d'une vidéo en MP3, WAV ou M4A, en entier ou sur un extrait.",
      opts: [{ k: "fmt", l: "FORMAT", type: "select", o: [["mp3", "MP3"], ["m4a", "M4A (AAC)"], ["wav", "WAV (sans perte)"]], d: "mp3" }, { k: "bitrate", l: "DÉBIT (kb/s)", type: "select", o: [[128, "128"], [192, "192"], [256, "256"], [320, "320"]], d: 192, num: true, show: (v) => v.fmt !== "wav" },
        { k: "start", l: "DÉBUT (optionnel)", type: "text", ph: "ex. 1:05", d: "" }, { k: "duration", l: "DURÉE (optionnel)", type: "text", ph: "ex. 30", d: "" }] },
    video_gif: { g: "VIDÉO & AUDIO", t: "Vidéo → GIF", s: "extrait animé en boucle", accept: ["video"], need: "ffmpeg", btn: "CRÉER LE GIF",
      d: "Convertit un extrait précis (30 s maximum) en GIF animé qui boucle indéfiniment, avec une palette optimisée.",
      opts: [{ k: "start", l: "DÉBUT", type: "text", ph: "ex. 0:12", d: "0" }, { k: "duration", l: "DURÉE (s)", type: "text", ph: "ex. 5", d: "5" },
        { k: "width", l: "LARGEUR (px)", type: "select", o: [[320, "320"], [480, "480"], [640, "640"], [800, "800"]], d: 480, num: true }, { k: "fps", l: "FLUIDITÉ (images/s)", type: "select", o: [[8, "8"], [12, "12"], [15, "15"], [24, "24"]], d: 12, num: true }] },
    denoise: { g: "VIDÉO & AUDIO", t: "Nettoyeur audio", s: "supprimer le bruit de fond", accept: ["audio", "video"], multi: true, need: "ffmpeg", btn: "NETTOYER",
      d: "Réduit le bruit de fond continu (souffle, ventilation, circulation, vent) d'un enregistrement vocal ou d'une vidéo, en un clic. Un bruit constant est très bien traité ; l'écho est seulement atténué, pas supprimé. Une vidéo garde son image intacte.",
      opts: [{ k: "level", l: "FORCE", type: "select", o: [["light", "Légère"], ["medium", "Moyenne"], ["strong", "Forte"]], d: "medium" }, { k: "wind", l: "Couper aussi le vent et les basses parasites", type: "check", d: true }] },
    transcribe: { g: "TEXTE", t: "Transcription vocale", s: "audio / vidéo → texte en paragraphes", accept: ["audio", "video"], need: "stt", btn: "TRANSCRIRE",
      d: "Convertit une réunion, un cours ou une note vocale en texte structuré : les paragraphes sont séparés automatiquement aux pauses. Le fichier .txt et un .srt sont enregistrés. L'audio est envoyé au service de transcription configuré (comme la dictée).",
      opts: [{ k: "lang", l: "LANGUE PARLÉE", type: "select", o: LANGS, d: "fr" }, { k: "timestamps", l: "Ajouter l'heure au début de chaque paragraphe", type: "check", d: false }] },
    subtitles: { g: "TEXTE", t: "Sous-titres incrustés", s: "mots prononcés sur l'image", accept: ["video"], need: "stt", btn: "SOUS-TITRER",
      d: "Analyse la vidéo et incruste les mots prononcés directement sur l'image (texte contourné, lisible sur tout fond) ; le fichier .srt est aussi fourni. L'audio est envoyé au service de transcription configuré.",
      opts: [{ k: "lang", l: "LANGUE PARLÉE", type: "select", o: LANGS, d: "fr" }, { k: "size", l: "TAILLE", type: "select", o: [["s", "Petite"], ["m", "Moyenne"], ["l", "Grande"]], d: "m" },
        { k: "pos", l: "POSITION", type: "select", o: [["bottom", "Bas"], ["center", "Milieu"], ["top", "Haut"]], d: "bottom" }, { k: "color", l: "COULEUR", type: "select", o: [["white", "Blanc"], ["yellow", "Jaune"], ["cyan", "Cyan"]], d: "white" },
        { k: "burn", l: "Incruster dans la vidéo (sinon .srt seul)", type: "check", d: true }] },
  };
  const ORDER = ["convert_image", "upscale", "picker", "blur", "exif", "video_audio", "video_gif", "denoise", "transcribe", "subtitles"];

  let inited = false, cur = "convert_image", caps = {}, up = null, vals = {}, boxes = [], mode = "blur", busy = false;
  const isOpen = () => !$("sm").hidden;

  // ------------------------------------------------------------------ navigation
  function buildNav() {
    let g = "", h = "";
    ORDER.forEach((id) => { const t = T[id]; if (t.g !== g) { g = t.g; h += `<h4>${g}</h4>`; } h += `<button data-t="${id}" class="${id === cur ? "on" : ""}"><b>${esc(t.t)}</b><small>${esc(t.s)}</small></button>`; });
    h += `<h4>PDF</h4><button id="sm-pdf"><b>Protection &amp; déverrouillage PDF</b><small>dans l'Éditeur PDF → onglet SÉCURITÉ</small></button>`;
    $("sm-nav").innerHTML = h;
    $("sm-nav").querySelectorAll("button[data-t]").forEach((b) => (b.onclick = () => select(b.dataset.t)));
    $("sm-pdf").onclick = () => { $("sm").hidden = true; const b = $("b-pdf"); if (b) b.click(); };
  }

  function select(id) {
    if (busy) return;
    cur = id; up = null; boxes = []; vals = {};
    T[id].opts && T[id].opts.forEach((o) => (vals[o.k] = o.d));
    buildNav(); render();
  }

  // ------------------------------------------------------------------ rendu d'un outil
  function warnFor(t) {
    const w = [];
    if (t.need === "ffmpeg" && !caps.ffmpeg) w.push("FFmpeg est introuvable : cet outil est indisponible.");
    if (t.need === "heic" && !caps.heic) w.push("Le module pillow-heif est absent : les images HEIC / AVIF ne pourront pas être ouvertes (JPG, PNG, WEBP restent possibles).");
    if (t.need === "opencv" && !caps.opencv) w.push("OpenCV (version 4) ou ses détecteurs sont absents : seul le floutage manuel est disponible.");
    if (t.need === "stt" && !caps.stt) w.push("La transcription n'est pas configurée : renseignez stt_api_key (ou un LLM compatible OpenAI comme Groq) dans nasko_config.json, ou stt_provider « local ». Voir GUIDE.md.");
    if (t.need === "stt" && !caps.ffmpeg) w.push("FFmpeg est introuvable : cet outil est indisponible.");
    return w.map((x) => `<div class="sm-warn">${esc(x)}</div>`).join("");
  }

  function optField(o) {
    const id = "sm-o-" + o.k, v = vals[o.k];
    if (o.type === "check") return `<label class="chk"><input type="checkbox" id="${id}" ${v ? "checked" : ""}> ${esc(o.l)}</label>`;
    if (o.type === "select") return `<label>${esc(o.l)}<select id="${id}">${o.o.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
    if (o.type === "range") return `<label>${esc(o.l)} <em id="${id}-v">${v}</em><input type="range" id="${id}" min="${o.min}" max="${o.max}" value="${v}"></label>`;
    return `<label>${esc(o.l)}<input type="text" id="${id}" value="${esc(v)}" placeholder="${esc(o.ph || "")}"></label>`;
  }

  function readOpts(t) {
    const out = {};
    (t.opts || []).forEach((o) => {
      const e = $("sm-o-" + o.k); if (!e) return;
      let v = o.type === "check" ? e.checked : e.value;
      if (o.num || o.type === "range") v = Number(v);
      out[o.k] = v; vals[o.k] = v;
    });
    return out;
  }

  function render() {
    const t = T[cur], m = $("sm-main");
    let h = `<div class="sm-head"><h3>${esc(t.t)}</h3><p>${esc(t.d)}</p></div>${warnFor(t)}`;
    h += `<div class="sm-card"><h4>1 · FICHIER${t.multi ? "S" : ""}</h4><div class="sm-dz" id="sm-dz"><b>DÉPOSEZ ${t.multi ? "VOS FICHIERS" : "VOTRE FICHIER"} ICI</b><small>ou cliquez pour choisir (${t.accept.map((a) => ({ image: "image", video: "vidéo", audio: "audio" }[a])).join(" / ")})</small></div><div id="sm-fl"></div></div>`;
    if (t.opts) h += `<div class="sm-card"><h4>2 · RÉGLAGES</h4><div class="sm-opts" id="sm-opts">${t.opts.map(optField).join("")}</div></div>`;
    if (t.special === "blur") h += `<div class="sm-card"><h4>2 · QUE CHERCHER ?</h4><div class="sm-opts"><label class="chk"><input type="checkbox" id="sm-b-faces" checked> Visages</label><label class="chk"><input type="checkbox" id="sm-b-plates" checked> Plaques d'immatriculation</label><label class="chk"><input type="checkbox" id="sm-b-text"> Zones de texte (approximatif)</label></div></div>`;
    if (!t.special || t.special === "blur") h += `<div class="sm-run" id="sm-runrow">${t.special === "blur" ? `<button class="btn on big" id="sm-run">DÉTECTER LES ZONES</button><button class="btn" id="sm-manual">TRACER À LA MAIN</button>` : `<button class="btn on big" id="sm-run">${esc(t.btn)}</button>`}</div>`;
    h += `<div id="sm-res"></div>`;
    m.innerHTML = h;
    bindOpts(t);
    const dz = $("sm-dz");
    dz.onclick = () => { $("sm-file").accept = [].concat(...t.accept.map((a) => EXT[a].split(","))).join(","); $("sm-file").multiple = !!t.multi; $("sm-file").click(); };
    ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
    ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
    dz.addEventListener("drop", (e) => upload([...e.dataTransfer.files]));
    if ($("sm-run")) $("sm-run").onclick = () => go();
    if ($("sm-manual")) $("sm-manual").onclick = () => { if (!up) return toast("Choisissez d'abord une image.", true); boxes = []; blurEditor(); };
    showFiles();
  }

  function bindOpts(t) {
    (t.opts || []).forEach((o) => {
      const e = $("sm-o-" + o.k); if (!e) return;
      e.oninput = e.onchange = () => {
        readOpts(t);
        if (o.type === "range") $("sm-o-" + o.k + "-v").textContent = e.value;
        (t.opts || []).forEach((p) => { if (p.show) { const el = $("sm-o-" + p.k); if (el) el.closest("label").style.display = p.show(vals) ? "" : "none"; } });
      };
      if (o.show) { const el = $("sm-o-" + o.k); if (el) el.closest("label").style.display = o.show(vals) ? "" : "none"; }
    });
  }

  function showFiles() {
    const f = $("sm-fl"); if (!f) return;
    if (!up) { f.innerHTML = ""; return; }
    f.innerHTML = `<div class="sm-files">${up.names.map((n) => `<span>${esc(n)}</span>`).join("")}</div>` + (up.preview ? `<img class="sm-prev" id="sm-prev" alt="aperçu">` : "");
    if (up.preview) previewBlob().then((u) => { const i = $("sm-prev"); if (i) i.src = u; }).catch(() => {});
  }

  async function previewBlob() {
    const r = await fetch("/api/studio/preview?ref=" + up.ref + "&t=" + Date.now(), { headers: { "X-Nasko-Token": TOKEN } });
    if (!r.ok) throw new Error("aperçu indisponible");
    return URL.createObjectURL(await r.blob());
  }

  // ------------------------------------------------------------------ envoi de fichiers
  async function upload(files) {
    const t = T[cur];
    files = files.filter((f) => f.size >= 0);
    if (!files.length) return;
    if (!t.multi) files = files.slice(0, 1);
    const fd = new FormData(); files.forEach((f) => fd.append("files", f, f.name));
    const jt = $("sm-jt"); jt.textContent = "ENVOI"; $("sm-js").textContent = files.length > 1 ? `${files.length} fichiers…` : files[0].name; $("sm-jb").style.width = "35%"; $("sm-jx").hidden = true; $("sm-job").hidden = false;
    try {
      const r = await api("/api/studio/upload", { body: fd });
      up = r; boxes = [];
    } catch (e) { toast(e.message, true); up = null; }
    $("sm-job").hidden = true; $("sm-jx").hidden = false;
    $("sm-res").innerHTML = "";
    showFiles();
    if (up && t.special === "exif") go();
    if (up && t.special === "picker") picker();
  }

  // ------------------------------------------------------------------ exécution
  async function runJob(tool, opts, label) {
    $("sm-jt").textContent = label; $("sm-js").textContent = "Démarrage…"; $("sm-jb").style.width = "2%"; $("sm-jx").hidden = false; $("sm-job").hidden = false; busy = true;
    let j;
    try {
      j = await api("/api/studio/run/" + tool, { body: { ref: up.ref, opts } });
      while (j.busy) { await wait(400); j = await api("/api/studio/job"); $("sm-js").textContent = j.stage || ""; $("sm-jb").style.width = Math.max(2, j.progress) + "%"; }
    } catch (e) { busy = false; $("sm-job").hidden = true; toast(e.message, true); return null; }
    busy = false; $("sm-job").hidden = true;
    if (j.error) { toast(j.error, true); return null; }
    return j.result;
  }

  async function go() {
    const t = T[cur];
    if (!up) return toast("Choisissez d'abord un fichier.", true);
    let tool = cur, opts = readOpts(t);
    if (t.special === "blur") { tool = "blur_detect"; opts = { faces: $("sm-b-faces").checked, plates: $("sm-b-plates").checked, text: $("sm-b-text").checked }; }
    if (t.special === "exif") { tool = "exif_read"; opts = {}; }
    const r = await runJob(tool, opts, t.t.toUpperCase());
    if (!r) return;
    if (r.kind === "boxes") { boxes = r.boxes.map((b) => ({ ...b, on: true })); blurEditor(r.boxes.length ? "" : "Aucune zone détectée automatiquement : tracez-les à la main sur l'image."); }
    else if (r.kind === "exif") exifView(r);
    else showResult(r);
  }

  function mediaFor(f) {
    const e = f.name.split(".").pop().toLowerCase();
    if (["jpg", "jpeg", "png", "gif", "webp"].includes(e)) return `<img class="sm-media" src="${esc(f.link)}" alt="">`;
    if (["mp4", "m4v", "mov"].includes(e)) return `<video class="sm-media" src="${esc(f.link)}" controls></video>`;
    if (["mp3", "wav", "m4a"].includes(e)) return `<audio src="${esc(f.link)}" controls style="width:100%;margin:8px 0"></audio>`;
    return "";
  }

  function showResult(r, target) {
    target = target || $("sm-res");
    let h = `<div class="sm-card"><h4>RÉSULTAT</h4>`;
    if (r.info) { const i = r.info; const bits = []; if (i.from) bits.push(`${i.from} → <b>${i.to}</b>`); if (i.zones) bits.push(`${i.zones} zone(s) floutée(s)`); if (i.cues) bits.push(`${i.cues} sous-titres`); if (i.paragraphs) bits.push(`${i.paragraphs} paragraphes · ${i.words} mots`); if (bits.length) h += `<div class="sm-stat">${bits.join(" · ")}</div>`; }
    if (r.text) h += `<textarea class="sm-text" id="sm-txt" spellcheck="false">${esc(r.text)}</textarea><div class="sm-run"><button class="btn" id="sm-copy">COPIER LE TEXTE</button></div>`;
    if (r.files) { h += (r.files.length && !r.text ? r.files.slice(0, 3).map(mediaFor).join("") : "") + `<div class="sm-files-out">${r.files.map((f) => `<a class="f" href="${esc(f.link)}" download="${esc(f.name)}"><span>⬇ ${esc(f.name)}</span><em>${bytes(f.size)}</em></a>`).join("")}</div>`; }
    h += `<div class="sm-run"><button class="btn" id="sm-open">OUVRIR LE DOSSIER</button></div></div>`;
    target.innerHTML = h;
    const cp = target.querySelector("#sm-copy"), tx = target.querySelector("#sm-txt");
    if (cp) cp.onclick = () => { try { navigator.clipboard.writeText(tx.value); toast("Texte copié."); } catch (e) { tx.select(); toast("Sélectionnez puis Ctrl+C.", true); } };
    target.querySelector("#sm-open").onclick = () => api("/api/studio/open-folder", { body: {} }).catch((e) => toast(e.message, true));
    target.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ------------------------------------------------------------------ EXIF
  function exifView(r) {
    let h = `<div class="sm-card"><h4>CE QUE CONTIENT CETTE PHOTO (${esc(r.format)} · ${esc(r.size)})</h4>`;
    if (r.empty) h += `<div class="sm-stat">Aucune métadonnée trouvée : cette image est déjà propre.</div>`;
    else {
      h += `<table class="sm-tbl">${r.rows.map((x) => `<tr class="${x.label.startsWith("⚠") ? "gps" : ""}"><td>${esc(x.label)}</td><td>${esc(x.value)}</td></tr>`).join("")}${r.extra.length ? `<tr><td>Autres données cachées</td><td>${esc(r.extra.join(", "))}</td></tr>` : ""}</table>`;
      if (r.gps) h += `<div class="sm-warn" style="margin-top:12px">Cette photo révèle l'endroit où elle a été prise. Effacez les métadonnées avant de la partager.</div>`;
    }
    h += `<div class="sm-run"><button class="btn on big" id="sm-strip">EFFACER TOUTES LES MÉTADONNÉES</button></div><div id="sm-sres"></div></div>`;
    $("sm-res").innerHTML = h;
    $("sm-strip").onclick = async () => { const r2 = await runJob("exif_strip", {}, "NETTOYAGE"); if (r2) showResult(r2, $("sm-sres")); };
  }

  // ------------------------------------------------------------------ éditeur de zones de floutage
  async function blurEditor(msg) {
    let url;
    try { url = await previewBlob(); } catch (e) { return toast(e.message, true); }
    const kinds = { faces: "visage", plates: "plaque", text: "texte", manual: "zone" };
    $("sm-res").innerHTML = `<div class="sm-card"><h4>3 · VÉRIFIEZ LES ZONES</h4>${msg ? `<div class="sm-warn">${esc(msg)}</div>` : ""}
      <div class="sm-legend"><span><i style="border-color:#ffd23f"></i>visage</span><span><i style="border-color:#3de0ff"></i>plaque</span><span><i style="border-color:#b388ff"></i>texte</span><span><i style="border-color:#ff5a6a"></i>manuel</span><span>Clic sur une zone = l'ignorer · glisser sur l'image = ajouter une zone</span></div>
      <div class="sm-stage" id="sm-stage"><img id="sm-bimg" src="${url}" alt="" draggable="false"></div>
      <div class="sm-opts" style="margin-top:12px"><label>MÉTHODE<select id="sm-mode"><option value="blur">Flou (illisible)</option><option value="pixel">Pixellisation</option><option value="black">Aplat noir</option></select></label></div>
      <div class="sm-run"><button class="btn on big" id="sm-apply">FLOUTER <span id="sm-nb"></span></button><span id="sm-cnt" class="sm-stat"></span></div><div id="sm-bres"></div></div>`;
    $("sm-mode").value = mode; $("sm-mode").onchange = () => (mode = $("sm-mode").value);
    const stage = $("sm-stage");
    const draw = () => {
      stage.querySelectorAll(".sm-bx").forEach((n) => n.remove());
      boxes.forEach((b, i) => {
        const d = document.createElement("div"); d.className = "sm-bx " + b.kind + (b.on ? "" : " off"); const [x0, y0, x1, y1] = b.rect;
        d.style.cssText = `left:${x0 * 100}%;top:${y0 * 100}%;width:${(x1 - x0) * 100}%;height:${(y1 - y0) * 100}%`;
        d.innerHTML = `<span>${kinds[b.kind] || "zone"}</span>`;
        d.onpointerdown = (e) => e.stopPropagation();
        d.onclick = (e) => { e.stopPropagation(); b.on = !b.on; draw(); };
        d.oncontextmenu = (e) => { e.preventDefault(); boxes.splice(i, 1); draw(); };
        stage.appendChild(d);
      });
      const n = boxes.filter((b) => b.on).length;
      $("sm-nb").textContent = n ? `(${n} ZONE${n > 1 ? "S" : ""})` : ""; $("sm-apply").disabled = !n;
      $("sm-cnt").textContent = boxes.length ? `${boxes.length} zone(s), ${n} active(s). Clic droit sur une zone = la supprimer.` : "";
    };
    let st = null, ghost = null;
    const fr = (e) => { const r = stage.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)]; };
    stage.onpointerdown = (e) => { if (e.button !== 0) return; stage.setPointerCapture(e.pointerId); st = fr(e); ghost = document.createElement("div"); ghost.className = "sm-ghost"; stage.appendChild(ghost); };
    stage.onpointermove = (e) => { if (!st) return; const p = fr(e); ghost.style.cssText = `left:${Math.min(st[0], p[0]) * 100}%;top:${Math.min(st[1], p[1]) * 100}%;width:${Math.abs(p[0] - st[0]) * 100}%;height:${Math.abs(p[1] - st[1]) * 100}%`; };
    stage.onpointerup = (e) => {
      if (!st) return; const p = fr(e), s = st; st = null; ghost.remove();
      if (Math.abs(p[0] - s[0]) > 0.01 && Math.abs(p[1] - s[1]) > 0.01) { boxes.push({ kind: "manual", rect: [Math.min(s[0], p[0]), Math.min(s[1], p[1]), Math.max(s[0], p[0]), Math.max(s[1], p[1])], on: true }); draw(); }
    };
    draw();
    $("sm-apply").onclick = async () => {
      const r = await runJob("blur_apply", { boxes: boxes.filter((b) => b.on).map((b) => ({ kind: b.kind, rect: b.rect })), mode }, "FLOUTAGE");
      if (r) { const keep = $("sm-bres"); keep.innerHTML = `<div class="sm-files-out" style="margin-top:12px">${r.files.map((f) => `<a class="f" href="${esc(f.link)}" download="${esc(f.name)}"><span>⬇ ${esc(f.name)}</span><em>${bytes(f.size)}</em></a>`).join("")}</div>${r.files.map(mediaFor).join("")}<div class="sm-stat">${r.info.zones} zone(s) floutée(s) — aucune métadonnée conservée.</div>`; }
    };
  }

  // ------------------------------------------------------------------ pipette
  async function picker() {
    let url;
    try { url = await previewBlob(); } catch (e) { return toast("Aperçu indisponible pour ce fichier.", true); }
    $("sm-res").innerHTML = `<div class="sm-card"><h4>CLIQUEZ SUR L'IMAGE</h4><div class="sm-sw"><div class="sm-stage"><canvas id="sm-cv" style="cursor:crosshair"></canvas></div>
      <div><div class="sm-sw"><div class="box" id="sm-box" style="background:#222"></div><div class="sm-codes" id="sm-codes"><div><b>HEX</b><code>—</code></div><div><b>RGB</b><code>—</code></div><div><b>CMJN</b><code>—</code></div></div></div>
      <div class="sm-stat" id="sm-live">Survolez l'image pour voir la couleur sous le curseur.</div><h4 style="margin-top:16px">COULEURS DOMINANTES</h4><div class="sm-pal" id="sm-pal"></div><h4 style="margin-top:16px">HISTORIQUE</h4><div class="sm-pal" id="sm-hist"></div></div></div></div>`;
    const im = new Image();
    im.onload = () => {
      const cv = $("sm-cv"); cv.width = im.naturalWidth; cv.height = im.naturalHeight; const ctx = cv.getContext("2d", { willReadFrequently: true }); ctx.drawImage(im, 0, 0);
      const at = (e) => { const r = cv.getBoundingClientRect(); const x = clamp(Math.floor((e.clientX - r.left) * cv.width / r.width), 0, cv.width - 1), y = clamp(Math.floor((e.clientY - r.top) * cv.height / r.height), 0, cv.height - 1); const d = ctx.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };
      cv.onmousemove = (e) => { const c = at(e); $("sm-live").textContent = "Sous le curseur : " + hex(c); };
      cv.onclick = (e) => { const c = at(e); show(c); hist.unshift(c); hist = hist.filter((x, i) => hist.findIndex((y) => hex(y) === hex(x)) === i).slice(0, 12); drawHist(); };
      // couleurs dominantes : regroupement par 4 bits / canal sur une miniature
      const s = document.createElement("canvas"); s.width = 64; s.height = Math.max(1, Math.round(64 * cv.height / cv.width)); s.getContext("2d").drawImage(im, 0, 0, s.width, s.height);
      const px = s.getContext("2d").getImageData(0, 0, s.width, s.height).data, bins = {};
      for (let i = 0; i < px.length; i += 4) { const k = (px[i] >> 4) + "," + (px[i + 1] >> 4) + "," + (px[i + 2] >> 4); const b = bins[k] || (bins[k] = { n: 0, r: 0, g: 0, b: 0 }); b.n++; b.r += px[i]; b.g += px[i + 1]; b.b += px[i + 2]; }
      const top = Object.values(bins).sort((a, b) => b.n - a.n).map((b) => [Math.round(b.r / b.n), Math.round(b.g / b.n), Math.round(b.b / b.n)]);
      const dom = []; top.forEach((c) => { if (dom.length < 8 && dom.every((d) => Math.abs(d[0] - c[0]) + Math.abs(d[1] - c[1]) + Math.abs(d[2] - c[2]) > 60)) dom.push(c); });
      $("sm-pal").innerHTML = ""; dom.forEach((c) => $("sm-pal").appendChild(sw(c)));
    };
    im.onerror = () => toast("Image illisible.", true);
    im.src = url;
  }
  let hist = [];
  const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
  function cmyk(c) { const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, k = 1 - Math.max(r, g, b); if (k >= 1) return [0, 0, 0, 100]; return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k].map((v) => Math.round(v * 100)); }
  function sw(c) { const b = document.createElement("button"); b.style.background = hex(c); b.title = hex(c); b.onclick = () => show(c); return b; }
  function drawHist() { const h = $("sm-hist"); if (!h) return; h.innerHTML = ""; hist.forEach((c) => h.appendChild(sw(c))); }
  function show(c) {
    $("sm-box").style.background = hex(c);
    const k = cmyk(c), rows = [["HEX", hex(c)], ["RGB", `rgb(${c.join(", ")})`], ["CMJN", `${k[0]}%, ${k[1]}%, ${k[2]}%, ${k[3]}%`]];
    $("sm-codes").innerHTML = rows.map(([l, v]) => `<div><b>${l}</b><code>${v}</code><button class="btn" data-v="${esc(v)}">COPIER</button></div>`).join("");
    $("sm-codes").querySelectorAll("button").forEach((b) => (b.onclick = () => { try { navigator.clipboard.writeText(b.dataset.v); toast("Copié : " + b.dataset.v); } catch (e) { toast("Sélectionnez puis Ctrl+C.", true); } }));
  }

  // ------------------------------------------------------------------ init
  async function open() {
    $("sm").hidden = false; document.body.classList.remove("menu-open");
    try { caps = await api("/api/studio/caps"); } catch (e) { caps = {}; }
    if (!inited) { inited = true; select(cur); } else render();
  }
  function init() {
    $("b-sm").onclick = open;
    $("sm-close").onclick = () => { if (!busy) $("sm").hidden = true; };
    $("sm-folder").onclick = () => api("/api/studio/open-folder", { body: {} }).catch((e) => toast(e.message, true));
    $("sm-jx").onclick = () => api("/api/studio/job/cancel", { body: {} }).catch(() => {});
    $("sm-file").onchange = (e) => { const f = [...e.target.files]; e.target.value = ""; upload(f); };
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen() && !busy && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) $("sm").hidden = true; });
    buildNav();
  }
  init();
})();
