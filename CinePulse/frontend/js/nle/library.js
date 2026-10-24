// TIROIR « BIBLIOTHÈQUE » : les médias persistants du backend (cinepulse_assets/). Instantané : la liste est gardée en mémoire, les vignettes sont servies avec un cache long.
// Toucher un média = l'ajouter à la tête de lecture ; le glisser (appui long au doigt, glisser à la souris) = le déposer sur une piste, avec aperçu fantôme et magnétisme.
// Import : bouton, ou fichiers glissés sur le tiroir ; envoi brut avec progression. Les proxies sont préparés par le serveur (state « processing » -> « ready »), sans bloquer.
const $ = (root, s) => root.querySelector(s);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const FILTERS = [["", "Tout"], ["video", "Vidéos"], ["image", "Images"], ["audio", "Sons"]];
const ICON = { video: "▶", image: "▣", audio: "♪" };
const fmtDur = (s) => (s == null ? "" : s >= 60 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : s.toFixed(1) + " s");
const fmtSize = (b) => (b > 1e9 ? (b / 1e9).toFixed(1) + " Go" : b > 1e6 ? (b / 1e6).toFixed(1) + " Mo" : Math.max(1, Math.round(b / 1e3)) + " Ko");

export class Library {
  /** @param {HTMLElement} root  @param {{onAdd(asset), onDragMove(asset,x,y)->bool, onDrop(asset,x,y), onDragEnd(), onChange()}} cb */
  constructor(root, cb) {
    this.root = root; this.cb = cb; this.assets = []; this.byId = new Map(); this.kind = ""; this.q = ""; this.timer = 0; this.poll = 0; this.menu = null;
    root.innerHTML = `<div class="lib-top"><b>BIBLIOTHÈQUE</b><span class="lib-stats" id="lib-stats"></span><button type="button" class="nle-btn" id="lib-x" aria-label="Fermer la bibliothèque">✕</button></div>
      <div class="lib-tools"><input type="search" id="lib-q" placeholder="Rechercher…" aria-label="Rechercher dans la bibliothèque" autocomplete="off"><button type="button" class="nle-btn pri" id="lib-import">+ IMPORTER</button><input type="file" id="lib-file" multiple hidden accept="video/*,image/*,audio/*"></div>
      <div class="lib-chips" id="lib-chips"></div><div class="lib-up" id="lib-up" hidden></div>
      <div class="lib-grid" id="lib-grid" role="list"></div><div class="lib-drop" id="lib-drop" hidden>Déposez vos fichiers pour les importer</div>`;
    $(root, "#lib-chips").innerHTML = FILTERS.map(([k, n]) => `<button type="button" class="lib-chip${k === "" ? " on" : ""}" data-k="${k}">${n}</button>`).join("");
    $(root, "#lib-chips").onclick = (e) => { const b = e.target.closest("[data-k]"); if (b) { this.kind = b.dataset.k; root.querySelectorAll(".lib-chip").forEach((x) => x.classList.toggle("on", x === b)); this.refresh(); } };
    $(root, "#lib-q").oninput = (e) => { clearTimeout(this.timer); this.timer = setTimeout(() => { this.q = e.target.value.trim(); this.refresh(); }, 180); };
    $(root, "#lib-import").onclick = () => $(root, "#lib-file").click();
    $(root, "#lib-file").onchange = (e) => { const f = [...e.target.files]; e.target.value = ""; this.upload(f); };
    $(root, "#lib-x").onclick = () => this.close();
    ["dragenter", "dragover"].forEach((t) => root.addEventListener(t, (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { e.preventDefault(); $(root, "#lib-drop").hidden = false; } }));
    ["dragleave", "drop"].forEach((t) => root.addEventListener(t, (e) => { if (t === "drop" || e.target === $(root, "#lib-drop")) $(root, "#lib-drop").hidden = true; }));
    root.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); this.upload([...e.dataTransfer.files]); } });
    this._bindGrid();
  }

  open() { this.root.classList.add("open"); this.refresh(); }
  close() { this.root.classList.remove("open"); }
  toggle() { this.root.classList.contains("open") ? this.close() : this.open(); }
  get(id) { return this.byId.get(id); }

  async refresh() {
    const qs = new URLSearchParams({ kind: this.kind, q: this.q, sort: this.q ? "name" : "recent" });
    try {
      const r = await fetch("/api/library?" + qs);
      const j = await r.json();
      this.assets = j.assets;
      for (const a of j.assets) this.byId.set(a.id, a);          // la table d'identifiants garde TOUS les médias vus : la timeline retrouve ses clips même filtrés
      $(this.root, "#lib-stats").textContent = j.stats.count ? `${j.stats.count} média${j.stats.count > 1 ? "s" : ""} · ${fmtSize(j.stats.bytes)}` : "";
      this._render();
      clearTimeout(this.poll);
      if (j.assets.some((a) => a.state === "processing")) this.poll = setTimeout(() => this.refresh(), 1500);     // proxies en préparation : on suit leur avancement
      if (this.cb.onChange) this.cb.onChange();
    } catch (err) { $(this.root, "#lib-grid").innerHTML = `<div class="lib-empty">Bibliothèque injoignable (${esc(err.message)}).</div>`; }
  }

  _render() {
    const g = $(this.root, "#lib-grid");
    if (!this.assets.length) { g.innerHTML = `<div class="lib-empty">${this.q || this.kind ? "Aucun média ne correspond." : "Votre bibliothèque est vide.<br><span>Importez vos vidéos, images, logos et sons : ils restent disponibles pour tous vos projets.</span>"}</div>`; return; }
    g.innerHTML = this.assets.map((a) => `<div class="lib-card${a.state === "processing" ? " busy" : ""}${a.state === "failed" ? " fail" : ""}" role="listitem" data-id="${esc(a.id)}" tabindex="0" aria-label="${esc(a.name)} : ajouter à la timeline">
      <div class="lib-thumb">${a.thumb_url ? `<img src="${esc(a.thumb_url)}" alt="" loading="lazy" draggable="false">` : `<span class="lib-ico">${ICON[a.kind] || "?"}</span>`}<i class="lib-kind">${ICON[a.kind] || ""}</i>${a.duration != null ? `<i class="lib-dur">${esc(fmtDur(a.duration))}</i>` : ""}${a.state === "processing" ? '<i class="lib-spin" title="Préparation du proxy…"></i>' : ""}</div>
      <div class="lib-name">${esc(a.name)}</div>
      <button type="button" class="lib-more nle-btn" data-more="${esc(a.id)}" aria-label="Actions pour ${esc(a.name)}">⋯</button>${a.state === "failed" ? `<div class="lib-err">${esc(a.error || "échec")}</div>` : ""}</div>`).join("");
  }

  // ------------------------------------------------------------------ actions
  async upload(files) {
    const box = $(this.root, "#lib-up"); box.hidden = false;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      box.textContent = `Import ${i + 1}/${files.length} : ${f.name} · 0 %`;
      try {
        await new Promise((res, rej) => {
          const x = new XMLHttpRequest();
          x.open("POST", "/api/library/import?name=" + encodeURIComponent(f.name));
          x.upload.onprogress = (e) => { if (e.lengthComputable) box.textContent = `Import ${i + 1}/${files.length} : ${f.name} · ${Math.round((e.loaded / e.total) * 100)} %`; };
          x.onload = () => { x.status < 300 ? res() : rej(new Error((JSON.parse(x.responseText || "{}").error) || "refusé")); };
          x.onerror = () => rej(new Error("réseau"));
          x.send(f);
        });
      } catch (err) { box.textContent = `${f.name} : ${err.message}`; await new Promise((r) => setTimeout(r, 2200)); }
    }
    box.hidden = true;
    this.refresh();
  }

  async _delete(a) {
    if (!confirm(`Supprimer « ${a.name} » de la bibliothèque ? Les clips qui l'utilisent perdront leur média.`)) return;
    await fetch("/api/library/" + a.id, { method: "DELETE" });
    this.byId.delete(a.id); this.refresh();
  }
  async _rename(a) {
    const n = prompt("Nouveau nom :", a.name);
    if (!n || n === a.name) return;
    await fetch("/api/library/" + a.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: n }) });
    this.refresh();
  }
  _menu(a, anchor) {
    this._closeMenu();
    const m = document.createElement("div"); m.className = "lib-menu"; m.setAttribute("role", "menu");
    m.innerHTML = `<button type="button" role="menuitem" data-a="add">Ajouter à la timeline</button><button type="button" role="menuitem" data-a="ren">Renommer</button><button type="button" role="menuitem" data-a="del" class="danger">Supprimer</button>`;
    m.onclick = (e) => { const b = e.target.closest("[data-a]"); if (!b) return; this._closeMenu(); if (b.dataset.a === "add") this._add(a); else if (b.dataset.a === "ren") this._rename(a); else this._delete(a); };
    anchor.closest(".lib-card").appendChild(m); this.menu = m;
  }
  _closeMenu() { if (this.menu) { this.menu.remove(); this.menu = null; } }
  _add(a) { if (this.cb.onAdd) this.cb.onAdd(a); fetch(`/api/library/${a.id}/use`, { method: "POST" }).catch(() => {}); }

  // ------------------------------------------------------------------ toucher / glisser (Pointer Events : le glisser-déposer HTML5 n'existe pas au doigt)
  _bindGrid() {
    const grid = $(this.root, "#lib-grid");
    let st = null;
    const end = (drop, e) => {
      if (!st) return;
      clearTimeout(st.timer);
      if (st.ghost) { st.ghost.remove(); if (drop && this.cb.onDrop) { this.cb.onDrop(st.a, e.clientX, e.clientY); fetch(`/api/library/${st.a.id}/use`, { method: "POST" }).catch(() => {}); } if (this.cb.onDragEnd) this.cb.onDragEnd(); this.root.classList.remove("dragging"); }
      else if (drop && !st.moved) this._add(st.a);                  // simple toucher : ajout à la tête de lecture
      st = null;
    };
    const lift = (e) => {
      if (!st || st.ghost) return;
      const g = document.createElement("div"); g.className = "lib-ghost"; g.innerHTML = st.card.querySelector(".lib-thumb").outerHTML + `<span>${esc(st.a.name)}</span>`;
      document.body.appendChild(g); st.ghost = g; this.root.classList.add("dragging"); this._place(g, st.x, st.y);
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) { /* non supporté */ } }
    };
    grid.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const more = e.target.closest("[data-more]");
      if (more) { e.preventDefault(); const a = this.byId.get(more.dataset.more); if (a) this._menu(a, more); return; }
      if (e.target.closest(".lib-menu")) return;
      this._closeMenu();
      const card = e.target.closest(".lib-card"), a = card && this.byId.get(card.dataset.id);
      if (!a) return;
      st = { a, card, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, touch: e.pointerType !== "mouse", id: e.pointerId };
      if (st.touch) st.timer = setTimeout(() => lift(e), 320);
    });
    grid.addEventListener("pointermove", (e) => {
      if (!st || e.pointerId !== st.id) return;
      st.x = e.clientX; st.y = e.clientY;
      const d = Math.hypot(e.clientX - st.x0, e.clientY - st.y0);
      if (d > 6) st.moved = true;
      if (!st.ghost && !st.touch && d > 5) lift(e);
      if (!st.ghost && st.touch && d > 10) { clearTimeout(st.timer); st = null; return; }     // le doigt défile la liste : ce n'est pas un glisser
      if (st.ghost) { try { grid.setPointerCapture(e.pointerId); } catch (err) { /* synthétique */ } this._place(st.ghost, e.clientX, e.clientY); if (this.cb.onDragMove) this.cb.onDragMove(st.a, e.clientX, e.clientY); }
    });
    grid.addEventListener("pointerup", (e) => end(true, e));
    grid.addEventListener("pointercancel", (e) => end(false, e));
    grid.addEventListener("touchmove", (e) => { if (st && st.ghost) e.preventDefault(); }, { passive: false });     // un glisser actif ne fait pas défiler la liste
    grid.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("lib-card")) { e.preventDefault(); const a = this.byId.get(e.target.dataset.id); if (a) this._add(a); } });
    grid.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  _place(g, x, y) { g.style.transform = `translate(${x - 44}px, ${y - 60}px)`; }
}
