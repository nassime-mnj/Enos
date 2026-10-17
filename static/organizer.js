"use strict";
// ORGANISATEUR DE DOSSIERS ET DE FICHIERS : explorateur rapide (clavier + glisser-déposer). Le serveur valide chaque chemin et rend tout annulable.
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
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const bytes = (n) => (n < 1024 ? n + " o" : n < 1048576 ? (n / 1024).toFixed(0) + " Ko" : n < 1073741824 ? (n / 1048576).toFixed(1) + " Mo" : (n / 1073741824).toFixed(2) + " Go");
  const when = (t) => { const d = new Date(t * 1000); return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); };
  const sep = "\\";
  const join = (a, b) => a.replace(/[\\/]+$/, "") + sep + b;
  const parentOf = (p) => { const t = p.replace(/[\\/]+$/, ""); const i = Math.max(t.lastIndexOf("\\"), t.lastIndexOf("/")); return i > 2 ? t.slice(0, i) : t.slice(0, i + 1); };
  const baseOf = (p) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
  const same = (a, b) => a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();
  const within = (child, parent) => { const c = child.replace(/[\\/]+$/, "").toLowerCase(), p = parent.replace(/[\\/]+$/, "").toLowerCase(); return c === p || c.startsWith(p + sep); };
  const store = (k, v) => { try { localStorage.setItem("og." + k, v); } catch (e) {} };
  const load = (k, d) => { try { return localStorage.getItem("og." + k) ?? d; } catch (e) { return d; } };

  // ------------------------------------------------------------------ icônes
  const CAT = {
    img: ["#ff7ad9", "jpg jpeg png gif webp bmp tif tiff svg heic ico psd raw"],
    vid: ["#ff9a3b", "mp4 mov mkv avi webm wmv flv m4v mpg mpeg"],
    aud: ["#a77bff", "mp3 wav flac ogg m4a aac wma opus mid"],
    doc: ["#5ab4ff", "pdf doc docx odt txt rtf md xls xlsx csv ppt pptx epub"],
    zip: ["#ffd93b", "zip rar 7z tar gz bz2 iso"],
    code: ["#3bffb4", "py js ts html css json xml cs gd cpp c h java sh bat yml yaml sql"],
    exe: ["#ff5a5a", "exe msi apk dmg"],
  };
  const EXTCOL = {};
  Object.values(CAT).forEach(([c, l]) => l.split(" ").forEach((e) => (EXTCOL["." + e] = c)));
  const FOLDER = (cls = "og-ico") => `<svg class="${cls}" viewBox="0 0 24 24"><path d="M2 6.5A1.5 1.5 0 0 1 3.5 5h5l2 2.2h10A1.5 1.5 0 0 1 22 8.7V18a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 18z" fill="#3bffb42a" stroke="#3bffb4" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
  const FILE = (ext, cls = "og-ico") => {
    const c = EXTCOL[ext] || "#8ab8aa", t = esc((ext || "").slice(1, 5).toUpperCase());
    return `<svg class="${cls}" viewBox="0 0 24 24"><path d="M5 2.5h9l5 5V21a.5.5 0 0 1-.5.5h-13A.5.5 0 0 1 5 21z" fill="${c}1c" stroke="${c}" stroke-width="1.2" stroke-linejoin="round"/><path d="M14 2.5V8h5" fill="none" stroke="${c}" stroke-width="1.2"/>${t ? `<text x="12" y="17.6" text-anchor="middle" font-size="${t.length > 3 ? 4.6 : 5.4}" font-weight="700" font-family="Consolas,monospace" fill="${c}">${t}</text>` : ""}</svg>`;
  };
  const icon = (e, cls) => (e.dir ? FOLDER(cls) : FILE(e.ext, cls));

  // ------------------------------------------------------------------ miniatures (chargées à la demande, 4 en parallèle)
  const THUMB_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".tif", ".tiff"]);
  const thumbs = new Map();                       // « chemin|mtime » -> url blob (ou null si échec)
  let thQueue = [], thActive = 0, thObs = null, ENT = new Map(), lassoEnd = 0;
  const isImg = (e) => !e.dir && THUMB_EXT.has(e.ext);
  const thKey = (e) => join(S.cur.path, e.name) + "|" + e.mtime;
  const lead = (e, cls, always) => {
    if (isImg(e)) {
      const u = thumbs.get(thKey(e));
      return `<span class="thw" data-th="${esc(e.name)}">${u ? `<img src="${u}" alt="" draggable="false">` : icon(e, cls)}</span>`;
    }
    return always ? `<span class="thw">${icon(e, cls)}</span>` : icon(e, cls);
  };
  function thumbReset() { thumbs.forEach((u) => u && URL.revokeObjectURL(u)); thumbs.clear(); thQueue = []; }
  function thumbPump() {
    while (thActive < 4 && thQueue.length) {
      const job = thQueue.shift();
      if (job.dir !== S.cur.path || thumbs.has(job.key)) continue;
      thActive++;
      fetch(`/api/org/thumb?path=${encodeURIComponent(job.path)}&size=256`, { headers: { "X-Nasko-Token": TOKEN } })
        .then((r) => (r.ok ? r.blob() : Promise.reject()))
        .then((b) => URL.createObjectURL(b), () => null)
        .then((u) => {
          thumbs.set(job.key, u);
          if (u && job.dir === S.cur.path) $("og-files").querySelectorAll("[data-th]").forEach((el) => { if (el.dataset.th === job.name) el.innerHTML = `<img src="${u}" alt="" draggable="false">`; });
        })
        .finally(() => { thActive--; thumbPump(); });
    }
  }
  function thumbObserve() {
    if (thObs) thObs.disconnect();
    thObs = new IntersectionObserver((list) => {
      for (const it of list) {
        if (!it.isIntersecting) continue;
        thObs.unobserve(it.target);
        const e = ENT.get(it.target.dataset.th);
        if (!e) continue;
        const key = thKey(e);
        if (!thumbs.has(key)) thQueue.push({ key, name: e.name, dir: S.cur.path, path: join(S.cur.path, e.name) });
      }
      thumbPump();
    }, { root: $("og-files"), rootMargin: "400px" });
    $("og-files").querySelectorAll("[data-th]").forEach((el) => { if (!el.querySelector("img")) thObs.observe(el); });
  }
  const kindOf = (e) => (e.dir ? "Dossier" : e.ext ? e.ext.slice(1).toUpperCase() : "Fichier");

  // ------------------------------------------------------------------ état
  const S = { roots: [], cur: null, entries: [], sel: new Set(), anchor: null, focus: null, clip: null, hist: [], hpos: -1, drag: null, tree: {}, typed: "", typedT: 0, toastT: 0, busy: false,
    tsize: +load("tsize", "130") || 130, view: load("view", "grid"), sort: load("sort", "name"), asc: load("asc", "1") === "1", hidden: load("hidden", "0") === "1", filter: "" };
  const isOpen = () => !$("og").hidden;
  const inWork = () => !$("og-work").hidden;

  const toast = (msg, bad, action) => {
    const t = $("og-toast");
    t.innerHTML = `<span>${esc(msg)}</span>`;
    if (action) {
      const b = document.createElement("button");
      b.textContent = action.label;
      b.onclick = () => { t.className = "og-toast"; action.fn(); };
      t.appendChild(b);
    }
    t.className = "og-toast show" + (bad ? " bad" : "");
    clearTimeout(S.toastT);
    S.toastT = setTimeout(() => (t.className = "og-toast"), action ? 8000 : bad ? 6000 : 3500);
  };
  const fail = (e) => toast(e.message || String(e), true);

  // ------------------------------------------------------------------ modale (confirmation / saisie)
  let modalResolve = null;
  function ask({ title, body = "", input = null, ok = "OK", danger = false }) {
    return new Promise((res) => {
      modalResolve = res;
      $("og-mt").textContent = title;
      $("og-mb").innerHTML = body;
      const mi = $("og-mi");
      mi.hidden = input === null;
      if (input !== null) mi.value = input;
      $("og-mok").textContent = ok;
      $("og-modal").querySelector(".og-card").classList.toggle("danger", danger);
      $("og-modal").hidden = false;
      setTimeout(() => (input !== null ? (mi.focus(), mi.select()) : $("og-mok").focus()), 30);
    });
  }
  function closeModal(v) {
    if ($("og-modal").hidden) return;
    $("og-modal").hidden = true;
    const r = modalResolve; modalResolve = null;
    if (r) r(v);
    $("og-files").focus({ preventScroll: true });
  }

  // ------------------------------------------------------------------ ouverture / accueil
  async function open() {
    $("og").hidden = false;
    try { S.roots = (await api("/api/org/roots")).roots; } catch (e) { return fail(e); }
    const last = load("last", "");
    if (last) { try { return await go(last, true); } catch (e) { /* retour à l'accueil */ } }
    showHome();
  }
  function close() { $("og").hidden = true; closeMenu(); }

  function showHome() {
    $("og-work").hidden = true;
    const h = $("og-home");
    h.hidden = false;
    const card = (r) => `<button class="og-rc ${r.kind === "project" ? "proj" : ""}" data-path="${esc(r.path)}">${FOLDER("")}<span><b>${esc(r.name)}</b><small>${esc(r.path)}</small></span></button>`;
    const proj = S.roots.filter((r) => r.kind === "project"), user = S.roots.filter((r) => r.kind === "user"), picked = S.roots.filter((r) => r.kind === "picked");
    h.innerHTML = `<h3>Où voulez-vous ranger ?</h3><p>Choisissez un emplacement : vous pourrez créer, renommer, déplacer, extraire et supprimer (Corbeille) — tout est annulable.</p>`
      + (proj.length ? `<h4>PROJETS</h4><div class="og-cards">${proj.map(card).join("")}</div>` : "")
      + `<h4>DOSSIERS DE VOTRE PC</h4><div class="og-cards">${user.map(card).join("")}</div>`
      + (picked.length ? `<h4>CHOISIS RÉCEMMENT</h4><div class="og-cards">${picked.map(card).join("")}</div>` : "")
      + `<h4>AUTRE ENDROIT</h4><div class="og-cards"><button class="og-rc other" id="og-pick"><svg viewBox="0 0 24 24"><path d="M2 6.5A1.5 1.5 0 0 1 3.5 5h5l2 2.2h10A1.5 1.5 0 0 1 22 8.7V18a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 18z" fill="none" stroke="#3bffb4" stroke-width="1.3" stroke-dasharray="2.5 2"/><path d="M12 10.5v6M9 13.5h6" stroke="#3bffb4" stroke-width="1.5" stroke-linecap="round"/></svg><span><b>Autre dossier…</b><small>Parcourir mon PC</small></span></button></div>`;
    h.querySelectorAll(".og-rc[data-path]").forEach((b) => (b.onclick = () => go(b.dataset.path).catch(fail)));
    $("og-pick").onclick = pickFolder;
  }

  async function pickFolder() {
    try {
      const r = await post("/api/org/pick");
      if (r.error) return toast(r.error, true);
      if (!r.path) return;
      S.roots = (await api("/api/org/roots")).roots;
      await go(r.path);
    } catch (e) { fail(e); }
  }

  // ------------------------------------------------------------------ navigation
  async function go(path, silent, noHist) {
    const r = await post("/api/org/list", { path, hidden: S.hidden });
    const newRoot = !S.cur || !same(S.cur.root, r.root);
    if (!S.cur || !same(S.cur.path, r.path)) thumbReset();
    S.cur = r;
    S.entries = r.entries;
    S.sel.clear(); S.anchor = S.focus = null; S.filter = ""; $("og-q").value = "";
    if (!noHist) { S.hist = S.hist.slice(0, S.hpos + 1); S.hist.push(r.path); S.hpos = S.hist.length - 1; }
    store("last", r.path);
    $("og-home").hidden = true;
    $("og-work").hidden = false;
    if (newRoot) S.tree = {};
    render();
    syncTree();
    $("og-files").focus({ preventScroll: true });
    return r;
  }
  const reload = async (select) => {
    try {
      const r = await post("/api/org/list", { path: S.cur.path, hidden: S.hidden });
      S.cur = r; S.entries = r.entries;
      S.sel = new Set([...S.sel].filter((n) => r.entries.some((e) => e.name === n)));
      if (select) { S.sel = new Set(select); S.focus = select[0] || null; S.anchor = S.focus; }
      render();
      refreshTreeNode(S.cur.path);
    } catch (e) { fail(e); }
  };
  const goUp = () => { if (S.cur && !S.cur.is_root) go(parentOf(S.cur.path)).catch(fail); };
  const goHist = (d) => { const n = S.hpos + d; if (n >= 0 && n < S.hist.length) { S.hpos = n; go(S.hist[n], false, true).catch(fail); } };

  // ------------------------------------------------------------------ rendu
  function visible() {
    const f = S.filter.toLowerCase();
    const arr = S.entries.filter((e) => !f || e.name.toLowerCase().includes(f));
    const k = S.sort, m = S.asc ? 1 : -1;
    const cmpName = (a, b) => a.name.localeCompare(b.name, "fr", { numeric: true, sensitivity: "base" });
    return arr.sort((a, b) => {
      if (a.dir !== b.dir) return a.dir ? -1 : 1;                       // dossiers toujours en premier
      const c = k === "mtime" ? a.mtime - b.mtime : k === "size" ? a.size - b.size : k === "ext" ? a.ext.localeCompare(b.ext) : cmpName(a, b);
      return c ? c * m : cmpName(a, b);
    });
  }
  let VIS = [];

  function render() {
    renderCrumbs();
    renderRoots();
    VIS = visible();
    ENT = new Map(S.entries.map((e) => [e.name, e]));
    const box = $("og-files");
    const keepScroll = box.scrollTop;
    const up = S.cur.is_root ? "" : S.view === "grid"
      ? `<div class="og-tile og-up" data-up="1" title="Dossier parent — déposez ici pour extraire">${FOLDER("ico")}<em>..</em><small>parent</small></div>`
      : `<div class="og-row og-up" data-up="1" title="Dossier parent — déposez ici pour extraire"><div class="nm">${FOLDER()}<em>..</em></div><span class="mt"></span><span class="ty"></span><span class="sz"></span></div>`;
    let html;
    if (S.view === "grid") {
      html = `<div class="og-grid" style="--ts:${S.tsize}px">${up}${VIS.map((e) => `<div class="og-tile ${e.dir ? "dir" : ""}" data-name="${esc(e.name)}" draggable="true" title="${esc(e.name)}">${lead(e, "ico", true)}<em>${esc(e.name)}</em><small>${e.dir ? "dossier" : bytes(e.size)}</small></div>`).join("")}</div>`;
    } else {
      const arrow = (k) => (S.sort === k ? (S.asc ? " ▲" : " ▼") : "");
      html = `<div class="og-lh"><span data-sort="name">NOM${arrow("name")}</span><span data-sort="mtime">MODIFIÉ${arrow("mtime")}</span><span data-sort="ext">TYPE${arrow("ext")}</span><span class="r" data-sort="size">TAILLE${arrow("size")}</span></div>`
        + up + VIS.map((e) => `<div class="og-row ${e.dir ? "dir" : ""}" data-name="${esc(e.name)}" draggable="true"><div class="nm">${lead(e)}<em>${esc(e.name)}</em></div><span class="mt">${when(e.mtime)}</span><span class="ty">${kindOf(e)}</span><span class="sz r">${e.dir ? "" : bytes(e.size)}</span></div>`).join("");
    }
    if (!VIS.length) html += `<div class="og-empty"><b>${S.filter ? "∅" : "◌"}</b>${S.filter ? "Aucun résultat pour ce filtre." : "Ce dossier est vide.<br>Glissez-y des éléments, ou utilisez <b style='display:inline;font-size:inherit;color:#3bffb4'>＋ Dossier</b> / <b style='display:inline;font-size:inherit;color:#3bffb4'>⤓ Importer</b>."}</div>`;
    if (S.cur.truncated) html += `<div class="og-empty">Affichage limité aux premiers éléments de ce dossier.</div>`;
    box.innerHTML = html;
    box.scrollTop = keepScroll;
    paintSel();
    thumbObserve();
    $("og-zoom").hidden = S.view !== "grid"; $("og-zoom").value = S.tsize;
    $("og-count").textContent = `${S.entries.length} élément${S.entries.length > 1 ? "s" : ""}` + (S.filter ? ` · ${VIS.length} affiché${VIS.length > 1 ? "s" : ""}` : "");
    $("og-back").disabled = S.hpos <= 0; $("og-fwd").disabled = S.hpos >= S.hist.length - 1; $("og-up").disabled = S.cur.is_root;
    $("og-view").textContent = S.view === "grid" ? "☰" : "▦";
    $("og-view").title = S.view === "grid" ? "Passer en liste" : "Passer en icônes";
    $("og-sort").value = S.sort; $("og-order").textContent = S.asc ? "↑" : "↓";
    $("og-hid").classList.toggle("on", S.hidden);
    $("og-undo").disabled = !S.cur.undo;
    $("og-undo").title = S.cur.undo ? "Annuler : " + S.cur.undo + " (Ctrl+Z)" : "Rien à annuler";
  }

  function paintSel() {
    const cut = S.clip && S.clip.mode === "cut" ? new Set(S.clip.paths) : null;
    let size = 0;
    $("og-files").querySelectorAll("[data-name]").forEach((el) => {
      const n = el.dataset.name, on = S.sel.has(n);
      el.classList.toggle("sel", on);
      el.classList.toggle("focus", n === S.focus);
      el.classList.toggle("cut", !!cut && cut.has(join(S.cur.path, n)));
    });
    S.sel.forEach((n) => { const e = S.entries.find((x) => x.name === n); if (e && !e.dir) size += e.size; });
    $("og-selinfo").textContent = S.sel.size ? `${S.sel.size} sélectionné${S.sel.size > 1 ? "s" : ""}${size ? " · " + bytes(size) : ""}` : "";
    const has = S.sel.size > 0;
    $("og-rename").disabled = S.sel.size !== 1; $("og-del").disabled = !has; $("og-group").disabled = !has;
    $("og-extract").disabled = !has || S.cur.is_root;
  }

  function renderCrumbs() {
    $("og-crumbs").innerHTML = S.cur.crumbs.map((c, i) => `${i ? '<span class="og-cs">›</span>' : ""}<button class="og-cr ${i === S.cur.crumbs.length - 1 ? "last" : ""}" data-path="${esc(c.path)}">${esc(c.name)}</button>`).join("");
    const el = $("og-crumbs"); el.scrollLeft = el.scrollWidth;
  }
  function renderRoots() {
    $("og-roots").innerHTML = S.roots.map((r) => `<div class="og-sr ${same(r.path, S.cur.root) ? "on" : ""}" data-path="${esc(r.path)}" title="${esc(r.path)}">${FOLDER("")}<span>${esc(r.name)}</span></div>`).join("")
      + `<div class="og-sr" id="og-pick2">${FOLDER("")}<span style="color:#3bffb4">Autre dossier…</span></div>`;
  }

  // ------------------------------------------------------------------ arborescence (chargement paresseux)
  async function loadChildren(path) {
    const n = S.tree[path] || (S.tree[path] = { path, name: baseOf(path), open: false, kids: null });
    if (n.kids) return n;
    try {
      const r = await post("/api/org/list", { path, hidden: S.hidden });
      n.kids = r.entries.filter((e) => e.dir && !e.link).sort((a, b) => a.name.localeCompare(b.name, "fr", { numeric: true })).map((e) => join(path, e.name));
      n.kids.forEach((k) => { if (!S.tree[k]) S.tree[k] = { path: k, name: baseOf(k), open: false, kids: null }; });
    } catch (e) { n.kids = []; }
    return n;
  }
  async function syncTree() {
    const my = S.cur.path;
    for (const c of S.cur.crumbs) {
      const n = await loadChildren(c.path);
      if (!same(c.path, my) || c === S.cur.crumbs[0]) n.open = true;
      if (S.cur.path !== my) return;
    }
    renderTree();
  }
  function refreshTreeNode(path) { const n = S.tree[path]; if (n) { n.kids = null; loadChildren(path).then(renderTree); } }
  function renderTree() {
    if (!S.cur) return;
    const root = S.cur.root;
    const draw = (p, depth) => {
      const n = S.tree[p];
      if (!n) return "";
      const hasKids = n.kids === null || n.kids.length > 0;
      let h = `<div class="og-tn ${same(p, S.cur.path) ? "cur" : ""}" data-path="${esc(p)}" style="padding-left:${6 + depth * 14}px"><span class="cv ${n.open ? "open" : ""} ${hasKids ? "" : "none"}">▶</span>${FOLDER("")}<span class="nm">${esc(depth === 0 ? S.cur.crumbs[0].name : n.name)}</span></div>`;
      if (n.open && n.kids) h += n.kids.map((k) => draw(k, depth + 1)).join("");
      return h;
    };
    $("og-tree").innerHTML = draw(root, 0);
    const cur = $("og-tree").querySelector(".cur");
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }

  // ------------------------------------------------------------------ sélection
  const names = () => [...S.sel];
  const pathsOf = (ns) => ns.map((n) => join(S.cur.path, n));
  function select(name, e) {
    const order = VIS.map((x) => x.name);
    if (e && e.shiftKey && S.anchor && order.includes(S.anchor)) {
      const a = order.indexOf(S.anchor), b = order.indexOf(name);
      const rng = order.slice(Math.min(a, b), Math.max(a, b) + 1);
      S.sel = e.ctrlKey || e.metaKey ? new Set([...S.sel, ...rng]) : new Set(rng);
    } else if (e && (e.ctrlKey || e.metaKey)) {
      S.sel.has(name) ? S.sel.delete(name) : S.sel.add(name);
      S.anchor = name;
    } else { S.sel = new Set([name]); S.anchor = name; }
    S.focus = name;
    paintSel();
  }
  function moveFocus(delta, e) {
    if (!VIS.length) return;
    const order = VIS.map((x) => x.name);
    let i = S.focus ? order.indexOf(S.focus) : -1;
    i = i < 0 ? (delta > 0 ? 0 : order.length - 1) : Math.max(0, Math.min(order.length - 1, i + delta));
    const n = order[i];
    if (e.shiftKey) { if (!S.anchor) S.anchor = n; select(n, { shiftKey: true }); } else select(n);
    const el = $("og-files").querySelector(`[data-name="${CSS.escape(n)}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }
  const gridCols = () => {
    const t = $("og-files").querySelectorAll(".og-tile[data-name]");
    if (t.length < 2) return 1;
    const y = t[0].offsetTop; let c = 0;
    for (const x of t) { if (x.offsetTop !== y) break; c++; }
    return Math.max(1, c);
  };

  // ------------------------------------------------------------------ actions
  async function act(url, body, okMsg, selectAfter) {
    if (S.busy) return null;
    S.busy = true;
    try {
      const r = await post(url, body);
      await reload(selectAfter);
      const nf = (r.fails || []).length;
      if (nf) toast(`${okMsg ? okMsg + " · " : ""}${nf} refusé(s) : ${r.fails[0].message}`, true);
      else if (okMsg) toast(okMsg, false, { label: "ANNULER", fn: undo });
      return r;
    } catch (e) { fail(e); return null; } finally { S.busy = false; }
  }
  async function undo() {
    if (!S.cur || !S.cur.undo) return toast("Rien à annuler.");
    try { const r = await post("/api/org/undo"); await reload(); toast("Annulé : " + r.label); } catch (e) { await reload(); fail(e); }
  }

  function uniqueName(base) {
    const taken = new Set(S.entries.map((e) => e.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    let i = 2; while (taken.has(`${base} (${i})`.toLowerCase())) i++;
    return `${base} (${i})`;
  }
  async function newFolder() {
    const name = uniqueName("Nouveau dossier");
    const r = await act("/api/org/mkdir", { parent: S.cur.path, name }, "", [name]);
    if (r) startRename(name);
  }
  async function newFile() {
    const name = uniqueName("Nouveau fichier.txt");
    const r = await act("/api/org/newfile", { parent: S.cur.path, name }, "", [name]);
    if (r) startRename(name);
  }
  function startRename(name) {
    name = name || (S.sel.size === 1 ? [...S.sel][0] : S.focus);
    if (!name) return;
    const el = $("og-files").querySelector(`[data-name="${CSS.escape(name)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "nearest" });
    const em = el.querySelector("em");
    const entry = S.entries.find((e) => e.name === name);
    const inp = document.createElement("input");
    inp.className = "og-edit"; inp.value = name; inp.spellcheck = false;
    em.replaceWith(inp);
    el.draggable = false;
    inp.focus();
    const dot = entry && !entry.dir ? name.lastIndexOf(".") : -1;
    inp.setSelectionRange(0, dot > 0 ? dot : name.length);
    let done = false;
    const finish = async (commit) => {
      if (done) return; done = true;
      const nv = inp.value.trim();
      if (!commit || !nv || nv === name) return render();
      const r = await act("/api/org/rename", { path: join(S.cur.path, name), name: nv }, `Renommé en « ${nv} »`, [nv]);
      if (!r) render();
    };
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") finish(true); else if (e.key === "Escape") finish(false); };
    inp.onblur = () => finish(true);
    inp.onclick = inp.ondblclick = (e) => e.stopPropagation();
  }

  // ---- renommage par modèle (lots) : aperçu en direct, conflits signalés, annulable d'un coup
  async function bulkRename() {
    const names = S.sel.size ? [...S.sel] : S.entries.map((e) => e.name);
    if (!names.length) return toast("Dossier vide.");
    const paths = names.map((n) => join(S.cur.path, n));
    const f = (id, label, html) => `<label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--mu)">${label}${html}</label>`;
    const body = `<p style="margin:0 0 10px;color:var(--mu)">${names.length} élément${names.length > 1 ? "s" : ""} ${S.sel.size ? "sélectionné" + (names.length > 1 ? "s" : "") : "(tout le dossier)"}.</p>
      <div style="display:grid;gap:8px">
        ${f("ogb-pattern", "MODÈLE  <span style='color:#4a9a82'>{name} nom actuel · {n} numéro · {date} date du fichier · {datetime} · {year} · {month} · {parent} dossier</span>", `<input class="og-edit" id="ogb-pattern" value="{name}" spellcheck="false" style="width:100%">`)}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${f("ogb-find", "CHERCHER", `<input class="og-edit" id="ogb-find" spellcheck="false" style="width:100%">`)}${f("ogb-repl", "REMPLACER PAR", `<input class="og-edit" id="ogb-repl" spellcheck="false" style="width:100%">`)}</div>
        <label style="font-size:12px"><input type="checkbox" id="ogb-regex"> expression régulière</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${f("ogb-case", "CASSE", `<select id="ogb-case" class="og-edit" style="width:100%"><option value="none">inchangée</option><option value="lower">minuscules</option><option value="upper">MAJUSCULES</option><option value="title">Chaque Mot</option></select>`)}
          ${f("ogb-spaces", "ESPACES", `<select id="ogb-spaces" class="og-edit" style="width:100%"><option value="keep">conservées</option><option value="underscore">→ _</option><option value="dash">→ -</option><option value="remove">supprimées</option></select>`)}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
          ${f("ogb-start", "DÉBUT {n}", `<input class="og-edit" id="ogb-start" type="number" value="1" style="width:100%">`)}${f("ogb-pad", "CHIFFRES (0 = auto)", `<input class="og-edit" id="ogb-pad" type="number" min="0" max="8" value="0" style="width:100%">`)}
          ${f("ogb-order", "ORDRE DE NUMÉROTATION", `<select id="ogb-order" class="og-edit" style="width:100%"><option value="selection">sélection</option><option value="name">nom</option><option value="mtime">date</option><option value="size">taille</option></select>`)}
        </div>
        <label style="font-size:12px"><input type="checkbox" id="ogb-acc"> retirer les accents</label>
        <div id="ogb-prev" style="max-height:190px;overflow:auto;border:1px solid var(--g2);padding:6px;font-size:12px;line-height:1.6"></div></div>`;
    const readOpts = () => ({ pattern: $("ogb-pattern").value || "{name}", find: $("ogb-find").value, replace: $("ogb-repl").value, regex: $("ogb-regex").checked, case: $("ogb-case").value, spaces: $("ogb-spaces").value,
      start: +$("ogb-start").value || 0, pad: +$("ogb-pad").value || 0, order: $("ogb-order").value, accents: $("ogb-acc").checked });
    let t = 0, seq = 0, okCount = 0;
    const preview = async () => {
      const my = ++seq;
      let h = "";
      try {
        const r = await post("/api/org/rename-plan", { paths, opts: readOpts() });
        if (my !== seq) return;
        const ch = r.plan.filter((x) => x.changed && !x.error), er = r.plan.filter((x) => x.error);
        okCount = ch.length;
        h = `<div style="color:var(--g)">${ch.length} à renommer${er.length ? ` · <span style="color:var(--rd)">${er.length} en conflit (ignoré${er.length > 1 ? "s" : ""})</span>` : ""}</div>` +
          r.plan.filter((x) => x.changed || x.error).slice(0, 40).map((x) => `<div style="${x.error ? "color:var(--rd)" : ""}">${esc(x.old)} <span style="color:var(--mu)">→</span> ${esc(x.new)}${x.error ? ` <em>(${esc(x.error)})</em>` : ""}</div>`).join("") || "<div style='color:var(--mu)'>Aucun changement.</div>";
      } catch (e) { okCount = 0; h = `<div style="color:var(--rd)">${esc(e.message)}</div>`; }
      if (my === seq && $("ogb-prev")) { $("ogb-prev").innerHTML = h; $("og-mok").disabled = !okCount; }
    };
    const p = ask({ title: "RENOMMER PAR MODÈLE", body, ok: "RENOMMER" });
    ["ogb-pattern", "ogb-find", "ogb-repl", "ogb-regex", "ogb-case", "ogb-spaces", "ogb-start", "ogb-pad", "ogb-order", "ogb-acc"].forEach((id) => { $(id).oninput = $(id).onchange = () => { clearTimeout(t); t = setTimeout(preview, 160); }; });
    preview();
    const yes = await p;
    $("og-mok").disabled = false;
    if (!yes) return;
    const r = await act("/api/org/rename-batch", { paths, opts: readOpts() }, "", []);
    if (r) { const n = r.done.length, nf = (r.fails || []).length; toast(`${n} élément${n > 1 ? "s" : ""} renommé${n > 1 ? "s" : ""}${nf ? ` · ${nf} ignoré(s)` : ""}`, nf > 0 && !n, n ? { label: "ANNULER", fn: undo } : undefined); }
  }

  async function doMove(paths, dest, copy) {
    paths = paths.filter((p) => !(!copy && same(parentOf(p), dest)));
    if (!paths.length) return;
    const r = await act(copy ? "/api/org/copy" : "/api/org/move", { paths, dest }, "");
    if (!r) return;
    const n = r.done.length;
    if (n && !(r.fails || []).length) toast(`${n} élément${n > 1 ? "s" : ""} ${copy ? "copié" : "déplacé"}${n > 1 ? "s" : ""} vers « ${baseOf(dest)} »`, false, { label: "ANNULER", fn: undo });
  }
  async function extract() {
    if (!S.sel.size || S.cur.is_root) return;
    const paths = pathsOf(names());
    const r = await act("/api/org/extract", { paths }, "");
    if (r && r.done.length && !(r.fails || []).length) toast(`${r.done.length} élément${r.done.length > 1 ? "s" : ""} extrait${r.done.length > 1 ? "s" : ""} vers « ${baseOf(parentOf(S.cur.path))} »`, false, { label: "ANNULER", fn: undo });
  }
  async function group() {
    if (!S.sel.size) return;
    const first = S.sel.size === 1 ? [...S.sel][0].replace(/\.[^.]+$/, "") : "Nouveau dossier";
    const name = await ask({ title: "REGROUPER DANS UN NOUVEAU DOSSIER", body: `${S.sel.size} élément${S.sel.size > 1 ? "s" : ""} seront déplacés dans le dossier :`, input: first, ok: "CRÉER ET DÉPLACER" });
    if (!name || !name.trim()) return;
    const r = await act("/api/org/group", { paths: pathsOf(names()), parent: S.cur.path, name: name.trim() }, "", [name.trim()]);
    if (r) toast(`Regroupé dans « ${name.trim()} »`, false, { label: "ANNULER", fn: undo });
  }
  async function del() {
    if (!S.sel.size) return;
    const ns = names(), list = ns.slice(0, 8).map((n) => `<li>${esc(n)}${S.entries.find((e) => e.name === n && e.dir) ? " (dossier)" : ""}</li>`).join("") + (ns.length > 8 ? `<li>… et ${ns.length - 8} autre(s)</li>` : "");
    const ok = await ask({ title: `SUPPRIMER ${ns.length} ÉLÉMENT${ns.length > 1 ? "S" : ""} ?`, body: `Envoyé${ns.length > 1 ? "s" : ""} à la <b>Corbeille de Windows</b> (récupérable).<ul>${list}</ul>`, ok: "SUPPRIMER", danger: true });
    if (!ok) return;
    const r = await act("/api/org/delete", { paths: pathsOf(ns) }, "");
    if (r && r.done.length && !(r.fails || []).length) toast(`${r.done.length} élément${r.done.length > 1 ? "s" : ""} envoyé${r.done.length > 1 ? "s" : ""} à la Corbeille`);
  }
  async function importFiles(kind) {
    try {
      const r = await post("/api/org/import", { dest: S.cur.path, kind });
      if (r.error) return toast(r.error, true);
      await reload((r.done || []).map((d) => baseOf(d.to)));
      if (r.fails && r.fails.length) toast(r.fails[0].message, true);
      else if (r.done.length) toast(`${r.done.length} élément${r.done.length > 1 ? "s" : ""} ajouté${r.done.length > 1 ? "s" : ""}`, false, { label: "ANNULER", fn: undo });
    } catch (e) { fail(e); }
  }
  async function autoSort() {
    try {
      const { plan } = await post("/api/org/autosort/plan", { path: S.cur.path });
      const cats = Object.keys(plan);
      if (!cats.length) return toast("Aucun fichier à ranger dans ce dossier.");
      const total = cats.reduce((a, c) => a + plan[c].length, 0);
      const rows = cats.map((c) => `<div class="pl"><span>📁 ${esc(c)}</span><b>${plan[c].length} fichier${plan[c].length > 1 ? "s" : ""}</b></div>`).join("");
      const ok = await ask({ title: "RANGER PAR TYPE", body: `Les ${total} fichiers de ce dossier seront triés dans des sous-dossiers (les dossiers existants ne bougent pas) :<div style="margin-top:10px">${rows}</div>`, ok: "RANGER" });
      if (!ok) return;
      await act("/api/org/autosort", { path: S.cur.path }, `${total} fichier${total > 1 ? "s" : ""} rangé${total > 1 ? "s" : ""} par type`);
    } catch (e) { fail(e); }
  }
  async function openItem(name) {
    const e = S.entries.find((x) => x.name === name);
    if (!e) return;
    if (e.dir) return go(join(S.cur.path, name)).catch(fail);
    post("/api/org/open", { path: join(S.cur.path, name) }).catch(fail);
  }
  const reveal = (name) => post("/api/org/reveal", { path: name ? join(S.cur.path, name) : S.cur.path }).catch(fail);
  async function paste(destDir) {
    if (!S.clip) return toast("Presse-papiers vide : Ctrl+C ou Ctrl+X d'abord.");
    const c = S.clip;
    const dest = destDir || S.cur.path;
    if (c.mode === "cut") S.clip = null;
    await doMove(c.paths, dest, c.mode === "copy");
  }
  function clip(mode) {
    if (!S.sel.size) return;
    S.clip = { mode, paths: pathsOf(names()) };
    paintSel();
    toast(`${S.sel.size} élément${S.sel.size > 1 ? "s" : ""} ${mode === "cut" ? "coupé" : "copié"}${S.sel.size > 1 ? "s" : ""} — Ctrl+V dans le dossier de destination`);
  }
  async function flatten(name) {
    const ok = await ask({ title: "APLATIR CE DOSSIER ?", body: `Le contenu de « ${esc(name)} » est remonté d'un niveau, puis le dossier vide est supprimé.`, ok: "APLATIR" });
    if (!ok) return;
    await act("/api/org/flatten", { path: join(S.cur.path, name) }, `« ${name} » aplati`);
  }

  // ------------------------------------------------------------------ menu contextuel
  function closeMenu() { $("og-menu").hidden = true; }
  function showMenu(x, y, items) {
    const m = $("og-menu");
    m.innerHTML = items.map((it, i) => (it === "-" ? '<div class="og-ms"></div>' : `<button class="og-mi ${it.dg ? "dg" : ""}" data-i="${i}"><i>${it.ic || ""}</i>${esc(it.t)}${it.k ? `<kbd>${it.k}</kbd>` : ""}</button>`)).join("");
    m.hidden = false;
    m.style.left = Math.min(x, innerWidth - m.offsetWidth - 8) + "px";
    m.style.top = Math.min(y, innerHeight - m.offsetHeight - 8) + "px";
    m.onclick = (e) => { const b = e.target.closest(".og-mi"); if (!b) return; closeMenu(); items[+b.dataset.i].fn(); };
  }
  function itemMenu(e, name) {
    if (!S.sel.has(name)) select(name);
    const one = S.sel.size === 1, ent = S.entries.find((x) => x.name === name), multi = S.sel.size > 1;
    const it = [];
    if (one) it.push({ ic: "↵", t: ent.dir ? "Ouvrir le dossier" : "Ouvrir", k: "Entrée", fn: () => openItem(name) });
    if (one) it.push({ ic: "✎", t: "Renommer", k: "F2", fn: () => startRename(name) });
    it.push({ ic: "✎", t: multi ? "Renommer par modèle (" + S.sel.size + ")…" : "Renommer par modèle…", fn: bulkRename });
    it.push("-",
      { ic: "✂", t: "Couper", k: "Ctrl+X", fn: () => clip("cut") },
      { ic: "⧉", t: "Copier", k: "Ctrl+C", fn: () => clip("copy") });
    if (one && ent.dir && S.clip) it.push({ ic: "⎘", t: "Coller dedans", fn: () => paste(join(S.cur.path, name)) });
    it.push("-", { ic: "▣", t: multi ? "Regrouper dans un nouveau dossier…" : "Mettre dans un nouveau dossier…", k: "Ctrl+G", fn: group });
    if (!S.cur.is_root) it.push({ ic: "⇱", t: "Extraire vers le dossier parent", k: "Ctrl+↑", fn: extract });
    if (one && ent.dir) it.push({ ic: "⇪", t: "Aplatir (remonter le contenu)", fn: () => flatten(name) });
    it.push("-", { ic: "⌕", t: "Afficher dans l'Explorateur", fn: () => reveal(one ? name : "") }, { ic: "✕", t: "Supprimer (Corbeille)", k: "Suppr", dg: true, fn: del });
    showMenu(e.clientX, e.clientY, it);
  }
  function bgMenu(e) {
    showMenu(e.clientX, e.clientY, [
      { ic: "＋", t: "Nouveau dossier", k: "Ctrl+N", fn: newFolder }, { ic: "＋", t: "Nouveau fichier", k: "Ctrl+Maj+N", fn: newFile },
      "-", { ic: "⎘", t: "Coller", k: "Ctrl+V", fn: () => paste() }, { ic: "⤓", t: "Importer des fichiers…", fn: () => importFiles("files") }, { ic: "⤓", t: "Importer un dossier…", fn: () => importFiles("folder") },
      "-", { ic: "✦", t: "Ranger ce dossier par type…", fn: autoSort }, { ic: "↻", t: "Actualiser", k: "F5", fn: () => reload() }, { ic: "⌕", t: "Ouvrir dans l'Explorateur", fn: () => reveal("") }]);
  }

  // ------------------------------------------------------------------ glisser-déposer
  const ghost = (n) => { const g = document.createElement("div"); g.className = "og-ghost"; g.textContent = n > 1 ? `${n} éléments` : "1 élément"; document.body.appendChild(g); setTimeout(() => g.remove(), 0); return g; };
  const dropTarget = (el) => {
    if (!el) return null;
    const row = el.closest("[data-name],[data-up],.og-cr,.og-tn,.og-sr");
    if (!row) return null;
    if (row.dataset.up) return parentOf(S.cur.path);
    if (row.classList.contains("og-cr") || row.classList.contains("og-tn") || row.classList.contains("og-sr")) return row.dataset.path;
    const e = S.entries.find((x) => x.name === row.dataset.name);
    return e && e.dir ? join(S.cur.path, e.name) : null;
  };
  const clearDrop = () => document.querySelectorAll("#og .drop").forEach((x) => x.classList.remove("drop"));
  const dropOk = (dest) => dest && S.drag && !S.drag.some((p) => within(dest, p));

  function initDnD() {
    const root = $("og");
    root.addEventListener("dragstart", (e) => {
      const row = e.target.closest && e.target.closest("[data-name]");
      if (!row || !$("og-files").contains(row)) return;
      if (!S.sel.has(row.dataset.name)) select(row.dataset.name);
      S.drag = pathsOf(names());
      e.dataTransfer.effectAllowed = "copyMove";
      e.dataTransfer.setData("text/plain", "enos-organizer");
      e.dataTransfer.setDragImage(ghost(S.drag.length), -8, -8);
    });
    root.addEventListener("dragover", (e) => {
      e.preventDefault();                                       // jamais de navigation si un fichier externe est lâché sur la fenêtre
      clearDrop();
      if (!S.drag) { e.dataTransfer.dropEffect = "none"; return; }
      const dest = dropTarget(e.target);
      if (dropOk(dest)) {
        e.dataTransfer.dropEffect = e.ctrlKey ? "copy" : "move";
        const el = e.target.closest("[data-name],[data-up],.og-cr,.og-tn,.og-sr");
        if (el) el.classList.add("drop");
      } else e.dataTransfer.dropEffect = "none";
    });
    root.addEventListener("dragleave", (e) => { if (!root.contains(e.relatedTarget)) clearDrop(); });
    root.addEventListener("drop", (e) => {
      e.preventDefault();
      clearDrop();
      if (!S.drag) { if (e.dataTransfer.files && e.dataTransfer.files.length) toast("Pour ajouter des fichiers venant de l'Explorateur, utilisez « ⤓ Importer ».", true); return; }
      const dest = dropTarget(e.target), paths = S.drag;
      S.drag = null;
      if (dest && !paths.some((p) => within(dest, p))) doMove(paths, dest, e.ctrlKey);
    });
    root.addEventListener("dragend", () => { S.drag = null; clearDrop(); });
  }

  // ------------------------------------------------------------------ sélection par cadre (clic maintenu + glisser)
  // Départ sur le vide ou sur un élément NON sélectionné ; départ sur un élément déjà sélectionné = glisser-déposer de la sélection.
  // Ctrl au départ = ajoute à la sélection existante.
  function initLasso(box) {
    let L = null;
    const toContent = (cx, cy) => { const r = box.getBoundingClientRect(); return [cx - r.left + box.scrollLeft, Math.max(0, cy - r.top + box.scrollTop)]; };
    function update() {
      const [x1, y1] = toContent(L.cx, L.cy);
      const x = Math.min(L.x0, x1), y = Math.min(L.y0, y1), w = Math.abs(x1 - L.x0), h = Math.abs(y1 - L.y0);
      Object.assign(L.el.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
      const hit = new Set(L.base);
      for (const it of L.items) if (it.l < x + w && it.r > x && it.t < y + h && it.b > y) hit.add(it.n);
      if (hit.size === S.sel.size && [...hit].every((n) => S.sel.has(n))) return;
      S.sel = hit;
      const first = L.items.find((it) => hit.has(it.n));
      S.anchor = S.focus = first ? first.n : null;
      paintSel();
    }
    function tick() {
      if (!L) return;
      const r = box.getBoundingClientRect(), edge = 36;
      const dy = L.cy < r.top + edge ? -Math.ceil((r.top + edge - L.cy) / 3) : L.cy > r.bottom - edge ? Math.ceil((L.cy - (r.bottom - edge)) / 3) : 0;
      if (dy) { box.scrollTop += dy; update(); }
      L.raf = requestAnimationFrame(tick);
    }
    box.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || e.target.closest(".og-lh,.og-edit,[data-up]")) return;
      const r = box.getBoundingClientRect();
      if (e.clientX - r.left >= box.clientWidth || e.clientY - r.top >= box.clientHeight) return;      // barre de défilement
      const item = e.target.closest("[data-name]");
      const additive = e.ctrlKey || e.metaKey;
      if (item && (e.shiftKey || (S.sel.has(item.dataset.name) && !additive))) return;                 // plage Maj / glisser la sélection
      e.preventDefault();                                                                                // pas de glisser natif ni de sélection de texte
      box.focus({ preventScroll: true });
      const [x0, y0] = toContent(e.clientX, e.clientY);
      L = { x0, y0, cx: e.clientX, cy: e.clientY, sx: e.clientX, sy: e.clientY, active: false, base: additive ? new Set(S.sel) : new Set(), items: null, el: null, raf: 0 };
    });
    document.addEventListener("mousemove", (e) => {
      if (!L) return;
      L.cx = e.clientX; L.cy = e.clientY;
      if (!L.active) {
        if (Math.hypot(e.clientX - L.sx, e.clientY - L.sy) < 5) return;
        L.active = true;
        const br = box.getBoundingClientRect();
        L.items = [...box.querySelectorAll("[data-name]")].map((el) => { const q = el.getBoundingClientRect(); return { n: el.dataset.name, l: q.left - br.left + box.scrollLeft, r: q.right - br.left + box.scrollLeft, t: q.top - br.top + box.scrollTop, b: q.bottom - br.top + box.scrollTop }; });
        L.el = document.createElement("div"); L.el.className = "og-lasso"; box.appendChild(L.el);
        box.classList.add("lassoing");
        closeMenu();
        L.raf = requestAnimationFrame(tick);
      }
      update();
    });
    const end = () => {
      if (!L) return;
      if (L.active) { cancelAnimationFrame(L.raf); L.el.remove(); box.classList.remove("lassoing"); lassoEnd = Date.now(); }
      L = null;
    };
    document.addEventListener("mouseup", end);
    window.addEventListener("blur", end);
  }

  // ------------------------------------------------------------------ clavier
  function onKey(e) {
    if (!isOpen()) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (!$("og-modal").hidden) {
      if (e.key === "Escape") { e.preventDefault(); closeModal(false); }
      else if (e.key === "Enter") { e.preventDefault(); closeModal($("og-mi").hidden ? true : $("og-mi").value); }
      return;
    }
    if (tag === "input" || tag === "select" || tag === "textarea") {
      if (e.target.id === "og-q" && (e.key === "Escape" || e.key === "Enter" || e.key === "ArrowDown")) { if (e.key === "Escape") { S.filter = ""; e.target.value = ""; render(); } $("og-files").focus(); e.preventDefault(); }
      return;
    }
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (k === "Escape") {
      if (!$("og-menu").hidden) return closeMenu();
      if (S.sel.size) { S.sel.clear(); paintSel(); return; }
      if (S.filter) { S.filter = ""; $("og-q").value = ""; return render(); }
      return close();
    }
    if (!inWork()) return;
    const grid = S.view === "grid";
    let used = true;
    if (ctrl && k === "ArrowUp") extract();
    else if (ctrl && (k === "a" || k === "A")) { S.sel = new Set(VIS.map((x) => x.name)); paintSel(); }
    else if (ctrl && (k === "c" || k === "C")) clip("copy");
    else if (ctrl && (k === "x" || k === "X")) clip("cut");
    else if (ctrl && (k === "v" || k === "V")) paste();
    else if (ctrl && (k === "z" || k === "Z")) undo();
    else if (ctrl && (k === "g" || k === "G")) group();
    else if (ctrl && e.shiftKey && (k === "n" || k === "N")) newFile();
    else if (ctrl && (k === "n" || k === "N")) newFolder();
    else if (ctrl && (k === "f" || k === "F")) $("og-q").focus();
    else if (k === "/") { $("og-q").focus(); }
    else if (k === "F2") startRename();
    else if (k === "F5") reload();
    else if (k === "Delete") del();
    else if (k === "Enter") { if (S.focus) openItem(S.focus); }
    else if (k === "Backspace" || (e.altKey && k === "ArrowUp")) goUp();
    else if (e.altKey && k === "ArrowLeft") goHist(-1);
    else if (e.altKey && k === "ArrowRight") goHist(1);
    else if (k === "ArrowDown") moveFocus(grid ? gridCols() : 1, e);
    else if (k === "ArrowUp") moveFocus(grid ? -gridCols() : -1, e);
    else if (k === "ArrowRight") { if (grid) moveFocus(1, e); else if (S.focus && S.entries.find((x) => x.name === S.focus && x.dir)) openItem(S.focus); }
    else if (k === "ArrowLeft") { if (grid) moveFocus(-1, e); else goUp(); }
    else if (k === "Home") { if (VIS.length) { select(VIS[0].name, e); } }
    else if (k === "End") { if (VIS.length) { select(VIS[VIS.length - 1].name, e); } }
    else if (k.length === 1 && !ctrl && !e.altKey) {                       // recherche instantanée au clavier
      const now = Date.now();
      S.typed = now - S.typedT > 800 ? k.toLowerCase() : S.typed + k.toLowerCase();
      S.typedT = now;
      const hit = VIS.find((x) => x.name.toLowerCase().startsWith(S.typed));
      if (hit) { select(hit.name); const el = $("og-files").querySelector(`[data-name="${CSS.escape(hit.name)}"]`); if (el) el.scrollIntoView({ block: "nearest" }); }
    } else used = false;
    if (used) e.preventDefault();
  }

  // ------------------------------------------------------------------ init
  function init() {
    if (!$("b-og")) return;
    $("b-og").onclick = open;
    $("og-close").onclick = close;
    $("og-back").onclick = () => goHist(-1); $("og-fwd").onclick = () => goHist(1); $("og-up").onclick = goUp;
    $("og-mkdir").onclick = newFolder; $("og-mkfile").onclick = newFile; $("og-import").onclick = (e) => {
      const r = $("og-import").getBoundingClientRect();
      showMenu(r.left, r.bottom + 4, [{ ic: "⤓", t: "Importer des fichiers…", fn: () => importFiles("files") }, { ic: "⤓", t: "Importer un dossier…", fn: () => importFiles("folder") }]);
      e.stopPropagation();
    };
    $("og-group").onclick = group; $("og-extract").onclick = extract; $("og-rename").onclick = () => startRename(); $("og-bulk").onclick = bulkRename; $("og-del").onclick = del;
    $("og-auto").onclick = autoSort; $("og-undo").onclick = undo;
    $("og-sort").onchange = (e) => { S.sort = e.target.value; store("sort", S.sort); render(); };
    $("og-order").onclick = () => { S.asc = !S.asc; store("asc", S.asc ? "1" : "0"); render(); };
    $("og-hid").onclick = () => { S.hidden = !S.hidden; store("hidden", S.hidden ? "1" : "0"); S.tree = {}; reload().then(syncTree); };
    $("og-view").onclick = () => { S.view = S.view === "grid" ? "list" : "grid"; store("view", S.view); render(); };
    $("og-q").oninput = (e) => { S.filter = e.target.value.trim(); render(); };
    $("og-mcancel").onclick = () => closeModal(false);
    $("og-mok").onclick = () => closeModal($("og-mi").hidden ? true : $("og-mi").value);
    $("og-modal").addEventListener("mousedown", (e) => { if (e.target === $("og-modal")) closeModal(false); });

    const files = $("og-files");
    $("og-zoom").oninput = (e) => {
      S.tsize = +e.target.value; store("tsize", S.tsize);
      const g = files.querySelector(".og-grid"); if (g) g.style.setProperty("--ts", S.tsize + "px");
    };
    initLasso(files);
    files.addEventListener("click", (e) => {
      if (Date.now() - lassoEnd < 250) return;                 // le clic qui suit un cadre de sélection ne doit pas effacer la sélection
      const hd = e.target.closest("[data-sort]");
      if (hd) { const k = hd.dataset.sort; S.asc = S.sort === k ? !S.asc : true; S.sort = k; store("sort", k); store("asc", S.asc ? "1" : "0"); return render(); }
      const row = e.target.closest("[data-name]");
      if (row) return select(row.dataset.name, e);
      if (!e.target.closest("[data-up]")) { S.sel.clear(); paintSel(); }
    });
    files.addEventListener("dblclick", (e) => {
      if (e.target.closest("[data-up]")) return goUp();
      const row = e.target.closest("[data-name]");
      if (row) openItem(row.dataset.name);
    });
    files.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const row = e.target.closest("[data-name]");
      row ? itemMenu(e, row.dataset.name) : bgMenu(e);
    });
    $("og-crumbs").addEventListener("click", (e) => { const b = e.target.closest(".og-cr"); if (b) go(b.dataset.path).catch(fail); });
    $("og-roots").addEventListener("click", (e) => {
      if (e.target.closest("#og-pick2")) return pickFolder();
      const r = e.target.closest(".og-sr"); if (r) go(r.dataset.path).catch(fail);
    });
    $("og-tree").addEventListener("click", async (e) => {
      const n = e.target.closest(".og-tn"); if (!n) return;
      const p = n.dataset.path;
      if (e.target.closest(".cv")) {
        const node = await loadChildren(p);
        node.open = !node.open;
        return renderTree();
      }
      go(p).catch(fail);
    });
    document.addEventListener("mousedown", (e) => { if (!e.target.closest("#og-menu")) closeMenu(); });
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", closeMenu);
    initDnD();
  }
  init();
})();
