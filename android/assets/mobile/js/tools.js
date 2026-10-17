"use strict";
// OUTILS NATIFS : compression de photos (canvas, 100 % sur le téléphone) et gestionnaire de dossiers (Storage Access Framework d'Android).
(() => {
  const E = window.ENOS, $ = E.$, esc = E.esc, N = E.native, U = E.ui;

  // ------------------------------------------------------------------ navigation interne (accueil des outils <-> sous-vues)
  function showSub(id) {
    $("#tools-home").hidden = !!id;
    E.$$(".subview").forEach((s) => (s.hidden = s.id !== "tool-" + id));
    $(".view[data-v=tools] .scroll").scrollTop = 0;
  }
  const home = () => showSub("");

  // ================================================================== PHOTOS
  const results = [];
  const blobOf = (canvas, mime, q) => new Promise((res) => canvas.toBlob(res, mime, q));
  const readBytes = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(new Uint8Array(r.result)); r.onerror = () => rej(new Error("lecture")); r.readAsArrayBuffer(blob); });

  async function compress(file, side, mime, q) {
    const bmp = await createImageBitmap(file);                                     // orientation EXIF appliquée par le navigateur
    const k = side && Math.max(bmp.width, bmp.height) > side ? side / Math.max(bmp.width, bmp.height) : 1;
    const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    if (mime === "image/jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); }  // PNG transparent -> fond blanc plutôt que noir
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close && bmp.close();
    let blob = await blobOf(c, mime, q);
    if (!blob) throw new Error("format non pris en charge");
    if (blob.size >= file.size && k === 1) blob = file;                              // jamais plus lourd que l'original
    return { blob, w, h };
  }

  function initImages() {
    const inp = $("#img-input"), list = $("#img-list"), save = $("#img-save");
    $("#q-range").oninput = (e) => { $("#q-val").textContent = e.target.value + "%"; };
    $("#img-pick").onclick = () => inp.click();
    inp.onchange = async () => {
      const files = Array.from(inp.files || []);
      inp.value = "";
      if (!files.length) return;
      results.length = 0;
      save.hidden = true;
      const side = +$("#q-side").value, mime = $("#q-fmt").value, q = +$("#q-range").value / 100;
      list.innerHTML = files.map((f, i) => `<div class="img-it" id="ii-${i}"><img alt=""><div class="n"><b>${esc(f.name)}</b><span class="muted">${E.bytes(f.size)} → …</span><div class="bar"><i></i></div></div><span class="gain"></span></div>`).join("");
      let done = 0;
      for (let i = 0; i < files.length; i++) {
        const f = files[i], row = $("#ii-" + i);
        row.querySelector(".bar i").style.width = "35%";
        try {
          const r = await compress(f, side, mime, q);
          const bytes = await readBytes(r.blob);
          const ext = r.blob === f ? (f.name.split(".").pop() || "jpg") : mime === "image/webp" ? "webp" : "jpg";
          results.push({ name: f.name.replace(/\.[^.]+$/, "") + "_compresse." + ext, mime: r.blob.type || mime, bytes });
          const url = URL.createObjectURL(r.blob);
          row.querySelector("img").src = url;
          row.querySelector(".n span").textContent = `${E.bytes(f.size)} → ${E.bytes(bytes.length)} · ${r.w}×${r.h}`;
          row.querySelector(".gain").textContent = "-" + Math.max(0, Math.round((1 - bytes.length / f.size) * 100)) + "%";
          row.querySelector(".bar i").style.width = "100%";
          done++;
        } catch (e) { row.querySelector(".n span").textContent = "Échec : " + e.message; row.querySelector(".bar i").style.width = "0"; }
      }
      const before = files.reduce((a, f) => a + f.size, 0), after = results.reduce((a, r) => a + r.bytes.length, 0);
      if (done) { save.hidden = false; U.toast(`${done} photo(s) : ${E.bytes(before)} → ${E.bytes(after)}`, "ok", 5000); E.vibrate(20); }
    };
    save.onclick = async () => {
      save.disabled = true;
      let n = 0;
      for (const r of results) if (await N.files.save(r.name, r.mime, r.bytes, "images")) n++;
      save.disabled = false;
      U.toast(n ? `${n} photo(s) enregistrée(s) dans Galerie › ENOS` : "Enregistrement impossible (fonction disponible dans l'application Android).", n ? "ok" : "warn", 5000);
      if (n) { results.length = 0; save.hidden = true; }
    };
  }

  // ================================================================== DOSSIERS (SAF)
  const CAT = {
    Images: "jpg jpeg png webp gif heic bmp", Vidéos: "mp4 mkv mov avi webm 3gp", Audio: "mp3 wav flac ogg m4a aac opus",
    Documents: "pdf doc docx txt rtf odt ppt pptx xls xlsx csv md epub", Archives: "zip rar 7z tar gz", Applications: "apk",
  };
  const catOf = (name) => { const e = (name.split(".").pop() || "").toLowerCase(); return Object.keys(CAT).find((c) => CAT[c].split(" ").includes(e)); };
  const ICON = { dir: '<path d="M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6"/>', img: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>' };
  const F = { tree: null, stack: [], items: [] };

  function crumbs() {
    $("#f-crumbs").innerHTML = F.tree ? [`<button data-i="0">${esc(F.tree.name || "Racine")}</button>`, ...F.stack.slice(1).map((s, i) => `<button data-i="${i + 1}">${esc(s.name)}</button>`)].join("<span>›</span>") : '<span class="muted">Aucun dossier choisi</span>';
    $("#f-mkdir").hidden = $("#f-sort").hidden = !F.tree;
  }
  function render() {
    crumbs();
    if (!F.tree) { $("#f-list").innerHTML = '<div class="empty">Choisis un dossier (ex. Téléchargements) : Android te demandera l\'autorisation, uniquement pour celui-là.</div>'; return; }
    const cur = F.stack[F.stack.length - 1];
    F.items = N.files.list(F.tree.uri, cur.id).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
    $("#f-list").innerHTML = F.items.length ? F.items.map((it, i) => `<div class="it f-it" data-i="${i}"><span class="ic"><svg viewBox="0 0 24 24">${it.dir ? ICON.dir : /^image\//.test(it.mime) ? ICON.img : ICON.file}</svg></span><span class="n">${esc(it.name)}<small class="muted">${it.dir ? "dossier" : E.bytes(it.size)}${it.mtime ? " · " + new Date(it.mtime).toLocaleDateString("fr-FR") : ""}</small></span></div>`).join("") : '<div class="empty">Dossier vide.</div>';
  }
  async function open(tree) {
    F.tree = tree;
    F.stack = [{ id: "", name: tree.name }];
    E.settings.set("tree", tree);
    render();
  }
  const op = (name, args) => N.files.op(name, { tree: F.tree.uri, ...args });

  function initFiles() {
    const saved = E.settings.get("tree", null);
    if (saved && N.available) { F.tree = saved; F.stack = [{ id: "", name: saved.name }]; }
    $("#f-pick").onclick = async () => { const r = await N.files.pickTree(); if (r && r.uri) open(r); else if (r && r.error) U.toast(r.error, "warn"); };
    $("#f-crumbs").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; F.stack = F.stack.slice(0, +b.dataset.i + 1); render(); };
    $("#f-list").onclick = (e) => {
      const el = e.target.closest(".f-it");
      if (!el) return;
      const it = F.items[+el.dataset.i];
      if (it.dir) { F.stack.push({ id: it.id, name: it.name }); render(); } else U.toast(`${it.name} · ${E.bytes(it.size)}`);
    };
    U.longPress($("#f-list"), ".f-it", (el) => {
      const it = F.items[+el.dataset.i];
      const cur = F.stack[F.stack.length - 1];
      U.sheet({ title: it.name, options: [
        { label: "Renommer", fn: async () => { const n = await U.prompt("Renommer", "Nouveau nom", it.name, "RENOMMER"); if (n && n.trim() && n !== it.name) { const r = op("rename", { doc: it.id, name: n.trim() }); U.toast(r.ok ? "Renommé" : r.error || "Échec", r.ok ? "ok" : "warn"); render(); } } },
        { label: "Déplacer vers un sous-dossier…", fn: () => pickDest(it, cur) },
        { label: "Supprimer définitivement", cls: "bad", fn: async () => { if (await U.confirm("Supprimer ?", `« ${it.name} » sera supprimé définitivement (pas de corbeille sur Android).`, "SUPPRIMER", true)) { const r = op("delete", { doc: it.id }); U.toast(r.ok ? "Supprimé" : r.error || "Échec", r.ok ? "ok" : "warn"); render(); } } }] });
    });
    $("#f-mkdir").onclick = async () => { const n = await U.prompt("Nouveau dossier", "Nom du dossier", "", "CRÉER"); if (n && n.trim()) { const r = op("mkdir", { parent: F.stack[F.stack.length - 1].id, name: n.trim() }); U.toast(r.ok ? "Dossier créé" : r.error || "Échec", r.ok ? "ok" : "warn"); render(); } };
    $("#f-sort").onclick = autosort;
    render();
  }
  function pickDest(it, cur) {
    const dirs = F.items.filter((x) => x.dir && x.id !== it.id);
    if (!dirs.length) return U.toast("Crée d'abord un sous-dossier ici.", "warn");
    U.sheet({ title: "Déplacer dans…", options: dirs.map((d) => ({ label: "📁 " + d.name, fn: () => { const r = op("move", { doc: it.id, parent: cur.id, target: d.id }); U.toast(r.ok ? "Déplacé" : r.error || "Déplacement refusé par ce dossier", r.ok ? "ok" : "warn"); render(); } })) });
  }
  async function autosort() {
    const cur = F.stack[F.stack.length - 1];
    const plan = {};
    F.items.filter((i) => !i.dir).forEach((i) => { const c = catOf(i.name); if (c) (plan[c] = plan[c] || []).push(i); });
    const total = Object.values(plan).reduce((a, l) => a + l.length, 0);
    if (!total) return U.toast("Rien à ranger ici.");
    const txt = Object.entries(plan).map(([c, l]) => `${c} : ${l.length}`).join(" · ");
    if (!(await U.confirm("Ranger par type ?", `${total} fichier(s) seront déplacés dans des sous-dossiers (${txt}). Les fichiers de type inconnu ne bougent pas.`, "RANGER"))) return;
    let moved = 0, failed = 0;
    for (const [c, list] of Object.entries(plan)) {
      let dest = F.items.find((x) => x.dir && x.name === c);
      if (!dest) { const r = op("mkdir", { parent: cur.id, name: c }); if (!r.ok) { failed += list.length; continue; } dest = { id: r.id }; }
      for (const it of list) { const r = op("move", { doc: it.id, parent: cur.id, target: dest.id }); r.ok ? moved++ : failed++; }
    }
    U.toast(`${moved} déplacé(s)${failed ? `, ${failed} refusé(s)` : ""}`, failed ? "warn" : "ok", 5000);
    render();
  }

  E.tools = { show: showSub, init() {
    E.$$("[data-tool]").forEach((b) => (b.onclick = () => showSub(b.dataset.tool)));
    E.$$("[data-back]").forEach((b) => (b.onclick = home));
    E.on("tools-back", home);
    initImages(); initFiles();
  } };
})();
