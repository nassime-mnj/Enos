"use strict";
// SYNC : PC -> mobile (liens/QR temporaires) et mobile -> PC (upload vers Stockage/Réception_Mobile).
(() => {
  const $ = (id) => document.getElementById(id);
  const TOKEN = document.querySelector('meta[name="nasko-token"]').content;
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
  const bytes = (n) => (n < 1024 ? n + " o" : n < 1048576 ? (n / 1024).toFixed(1) + " Ko" : n < 1073741824 ? (n / 1048576).toFixed(1) + " Mo" : (n / 1073741824).toFixed(2) + " Go");
  const when = (t) => new Date(t * 1000).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const isRemote = () => document.body.classList.contains("remote");
  let tab = "mobile", shares = [], tickT = 0, toastT;

  function toast(msg, bad) {
    const t = $("sy-toast"); t.textContent = msg; t.className = "sy-toast show" + (bad ? " bad" : "");
    clearTimeout(toastT); toastT = setTimeout(() => (t.className = "sy-toast"), 4200);
  }

  // ---------------------------------------------------------------- onglets / ouverture
  function setTab(t) {
    tab = t;
    document.querySelectorAll(".sy-card").forEach((c) => c.classList.toggle("on", c.dataset.t === t));
    $("sy-mobile").hidden = t !== "mobile"; $("sy-pc").hidden = t !== "pc";
    if (t === "mobile") loadShares(); else loadReceived();
  }
  function open() {
    $("sy").hidden = false;
    document.body.classList.remove("menu-open");
    $("sy-local").hidden = isRemote(); $("sy-remote-dl").hidden = !isRemote();
    $("sy-pc-hint").textContent = isRemote()
      ? "Choisissez des photos, vidéos ou fichiers de ce téléphone : ils sont enregistrés sur le PC."
      : "Envoyez aussi un fichier depuis cet appareil, ou récupérez ce que le téléphone a envoyé.";
    setTab(tab);
    clearInterval(tickT); tickT = setInterval(tick, 1000);
  }
  function close() { $("sy").hidden = true; clearInterval(tickT); }

  // ---------------------------------------------------------------- PC -> mobile
  async function loadShares() {
    try { const r = await api("/api/sync/shares"); shares = r.items; $("sy-nonet").hidden = isRemote() || r.network; }
    catch (e) { shares = []; }
    renderShares();
  }

  function renderShares() {
    const box = $("sy-tickets");
    box.innerHTML = "";
    $("sy-empty").hidden = shares.length > 0;
    $("sy-empty").textContent = isRemote()
      ? "Aucun fichier prêt. Sur le PC : SYNC → ENVOYER VERS MOBILE → choisissez un fichier."
      : "Aucun fichier partagé pour l'instant. Choisissez un fichier ci-dessus.";
    shares.forEach((s, i) => {
      const el = document.createElement("article");
      el.className = "sy-ticket"; el.style.animationDelay = Math.min(i, 8) * 60 + "ms"; el.dataset.exp = s.expires;
      const links = (s.urls || []).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`).join("");
      el.innerHTML = `
        ${s.qr ? `<img class="qr" alt="QR code du lien" src="${s.qr}">` : ""}
        <div class="in">
          <h4>${esc(s.name)}</h4>
          <div class="ch"><span>${bytes(s.size)}</span><span class="cd">—</span><span>${s.hits} téléchargement${s.hits > 1 ? "s" : ""}</span></div>
          ${isRemote() ? "" : `<div class="lk">${links || "<em>Activez l'accès téléphone pour obtenir un lien joignable.</em>"}</div>`}
          <div class="ac">
            <a class="btn green dl" href="${esc(s.path)}" download="${esc(s.name)}">⬇ TÉLÉCHARGER</a>
            ${isRemote() ? "" : `<button class="btn" data-a="copy">COPIER LE LIEN</button><button class="btn red" data-a="rev">RÉVOQUER</button>`}
          </div>
        </div>`;
      const copy = el.querySelector('[data-a="copy"]'), rev = el.querySelector('[data-a="rev"]');
      if (copy) copy.onclick = async () => {
        const url = (s.urls && s.urls[0]) || location.origin + s.path;
        try { await navigator.clipboard.writeText(url); toast("Lien copié"); } catch (e) { toast(url); }
      };
      if (rev) rev.onclick = async () => { try { await api("/api/sync/share/" + s.token, { method: "DELETE" }); toast("Lien révoqué"); loadShares(); } catch (e) { toast(e.message, true); } };
      box.appendChild(el);
    });
    tick();
  }

  function tick() {                                       // compte à rebours des liens ; retire ceux qui expirent
    const now = Date.now() / 1000;
    let gone = false;
    document.querySelectorAll(".sy-ticket").forEach((el) => {
      const left = +el.dataset.exp - now;
      if (left <= 0) { gone = true; return; }
      el.querySelector(".cd").textContent = "expire dans " + (left > 90 ? Math.ceil(left / 60) + " min" : Math.ceil(left) + " s");
    });
    if (gone) loadShares();
  }

  async function share(path) {
    try {
      const s = await api("/api/sync/share", { method: "POST", body: JSON.stringify({ path }) });
      toast(`« ${s.name} » prêt pour le mobile`); $("sy-path").value = ""; await loadShares();
    } catch (e) { toast(e.message, true); }
  }
  async function browse() {
    try {
      const r = await api("/api/sync/pick", { method: "POST" });
      if (r.error) return toast(r.error, true);
      if (r.path) share(r.path);
    } catch (e) { toast(e.message, true); }
  }

  // ---------------------------------------------------------------- mobile -> PC
  function uploadOne(file, onProgress) {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append("files", file, file.name);
      const x = new XMLHttpRequest();
      x.open("POST", "/api/sync/upload");
      x.setRequestHeader("X-Nasko-Token", TOKEN);
      x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      x.onload = () => {
        if (x.status >= 200 && x.status < 300) return resolve(JSON.parse(x.responseText));
        let d = x.statusText; try { d = JSON.parse(x.responseText).detail || d; } catch (e) {}
        reject(new Error(d));
      };
      x.onerror = () => reject(new Error("connexion interrompue"));
      x.send(fd);
    });
  }

  async function sendFiles(files) {
    files = [...files];
    if (!files.length) return;
    const list = $("sy-up");
    for (const f of files) {
      const row = document.createElement("div");
      row.className = "sy-up";
      row.innerHTML = `<b>${esc(f.name)}</b><em>${bytes(f.size)}</em><div class="bar"><i></i></div><span class="st">En attente…</span>`;
      list.prepend(row);
      const bar = row.querySelector("i"), st = row.querySelector(".st");
      try {
        st.textContent = "Envoi…";
        await uploadOne(f, (p) => { bar.style.width = (p * 100).toFixed(0) + "%"; st.textContent = "Envoi " + Math.round(p * 100) + " %"; });
        bar.style.width = "100%"; row.classList.add("ok"); st.textContent = "✔ Reçu sur le PC";
      } catch (e) { row.classList.add("bad"); st.textContent = "✕ " + e.message; }
    }
    loadReceived();
  }

  async function loadReceived() {
    try {
      const r = await api("/api/sync/received");
      $("sy-rec-n").textContent = r.items.length ? `${r.items.length} fichier${r.items.length > 1 ? "s" : ""}` : "";
      $("sy-max").textContent = `Taille max : ${r.max_mb} Mo par fichier · dossier : ${r.folder}`;
      $("sy-rec").innerHTML = r.items.length
        ? r.items.map((i) => `<div class="sy-rec"><b>${esc(i.name)}</b><em>${bytes(i.size)}</em><small>${when(i.t)}</small></div>`).join("")
        : '<div class="sy-none">Rien reçu pour l\'instant.</div>';
    } catch (e) {}
  }

  function init() {
    if (!$("b-sy")) return;
    const on = (id, ev, fn) => { const el = $(id); if (el) el["on" + ev] = fn; };      // un élément absent ne bloque plus le reste du câblage
    on("b-sy", "click", open);
    on("sy-close", "click", close);
    // « ENVOYER VERS MOBILE / VERS PC » : délégation au niveau du panneau (fonctionne quel que soit l'état du DOM)
    $("sy").addEventListener("click", (e) => { const c = e.target.closest(".sy-card"); if (c) { e.preventDefault(); setTab(c.dataset.t); } });
    on("sy-browse", "click", browse);
    on("sy-pathform", "submit", (e) => { e.preventDefault(); const v = $("sy-path").value.trim(); if (v) share(v); });
    on("sy-file", "change", (e) => { sendFiles(e.target.files); e.target.value = ""; });
    on("sy-open", "click", () => api("/api/sync/open-folder", { method: "POST" }).catch((e) => toast(e.message, true)));
    const dz = $("sy-drop");
    if (dz) {
      ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
      ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
      dz.addEventListener("drop", (e) => sendFiles(e.dataTransfer.files));
    }
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("sy").hidden && $("ip-ov").hidden) close(); });
    // menu mobile : le tiroir se referme dès qu'un module est ouvert
    const side = $("side");
    if (side) side.addEventListener("click", (e) => { const b = e.target.closest(".sec .btn[id^='b-']"); if (b && !/b-(audio|clear|quit|net|awake|revoke|forget|appset)/.test(b.id)) setTimeout(() => document.body.classList.remove("menu-open"), 0); });
  }
  init();
})();
