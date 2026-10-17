"use strict";
// DÉPÔT INTRANET : Forge (rendus en cours + compte à rebours), éditeur Monaco (moteur de VS Code), terminal Linux (xterm.js ⇄ WSL), Git « zéro friction »
// (ENVOYER = add + commit + tag Vn auto + push --follow-tags), branches/tags, cloner, sujet PDF → roadmap, entraînements avec ETO, Dépôt Shell.
// Tout texte venant du serveur / de la Forge / du PDF est inséré avec textContent (jamais en HTML).
(() => {
  const $ = (id) => document.getElementById(id);
  const open = $("b-dep");
  if (!open) return;
  const EXT = "/static/ext/";
  const S = { repo: "", st: null, mode: "", repos: [], tab: "forge", tabs: [], cur: null, models: {}, ed: null, monaco: null, term: null, ws: null, fit: null, forge: null, clock: 0, poll: 0, roadmap: null, train: null, opts: { shellTarget: "root" } };

  // ------------------------------------------------------------------ utilitaires
  const el = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const k in attrs || {}) { const v = attrs[k]; if (v == null || v === false) continue; if (k === "text") e.textContent = v; else if (k.startsWith("on")) e[k] = v; else if (k === "class") e.className = v; else if (k in e && k !== "list") e[k] = v; else e.setAttribute(k, v); }
    kids.flat().forEach((c) => c != null && c !== false && e.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return e;
  };
  const api = async (p, o = {}) => {
    const isForm = o.body instanceof FormData;
    const r = await fetch(p, { ...o, headers: isForm ? undefined : { "Content-Type": "application/json" } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(typeof j.detail === "string" ? j.detail : (j.detail && j.detail.message) || r.statusText || "Erreur " + r.status); e.status = r.status; e.data = j; throw e; }
    return j;
  };
  const post = (p, b) => api(p, { method: "POST", body: JSON.stringify(b || {}) });
  const q = (o) => Object.keys(o).filter((k) => o[k] != null && o[k] !== "").map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(o[k])).join("&");
  const btn = (label, fn, cls) => el("button", { class: "btn sm " + (cls || ""), type: "button", text: label, onclick: fn });
  const note = (t, kind) => el("div", { class: "dp-msg " + (kind || ""), text: t });
  const fmtT = (s) => { if (s == null) return "—"; s = Math.max(0, Math.floor(s)); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; const p = (n) => String(n).padStart(2, "0"); return (d ? d + " j " : "") + p(h) + ":" + p(m) + ":" + p(x); };
  const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("chargement impossible : " + src)); document.head.appendChild(s); });
  // xterm.js et son addon sont des bundles UMD : si un chargeur AMD est présent (celui de Monaco, déjà chargé quand on ouvre un fichier), ils s'y enregistrent comme modules
  // anonymes au lieu de créer window.Terminal / window.FitAddon -> « window.Terminal is not a constructor ». On masque donc `define` le temps du chargement.
  const loadUmd = async (src) => {
    const saved = window.define;
    try { window.define = undefined; await loadScript(src); } finally { if (saved !== undefined) window.define = saved; else delete window.define; }
  };
  const loadCss = (href) => { if (!document.querySelector(`link[href="${href}"]`)) document.head.appendChild(el("link", { rel: "stylesheet", href })); };

  function modal(title, body, actions) {
    const m = el("div", { class: "dp-modal", onmousedown: (e) => { if (e.target === m) m.remove(); } });
    const dlg = el("div", { class: "dp-dlg", role: "dialog", "aria-label": title }, el("h3", { text: title }), body, el("div", { class: "dp-row" }, (actions || []).map((a) => btn(a.label, () => a.fn(m), a.cls))));
    m.appendChild(dlg); document.body.appendChild(m);
    const f = dlg.querySelector("input,textarea,select"); if (f) f.focus();
    return m;
  }

  // ------------------------------------------------------------------ squelette
  const root = el("section", { id: "dp", role: "dialog", "aria-label": "Dépôt Intranet", hidden: true });
  const repoSel = el("select", { "aria-label": "Dépôt", onchange: () => selectRepo(repoSel.value) });
  const chipBranch = el("span", { class: "dp-chip", text: "—" }), chipAB = el("span", { class: "dp-chip", hidden: true });
  const sendB = btn("ENVOYER", () => sendDlg(), "dp-send"), pushB = btn("PUSH", () => gitSimple("push")), pullB = btn("PULL", () => gitSimple("pull")), commitB = btn("COMMIT", () => commitDlg()), cloneB = btn("GIT CLONE", () => startClone());
  const cloneUrl = el("input", { type: "text", class: "dp-clone-url", placeholder: "https://…, utilisateur@hôte:chemin ou proprietaire/depot", spellcheck: false, autocomplete: "off", "aria-label": "Adresse du dépôt à cloner", onkeydown: (e) => { if (e.key === "Enter") startClone(); } });
  const cloneProg = el("div", { class: "dp-cprog", hidden: true, role: "status", "aria-live": "polite" }, el("div", { class: "dp-bar2" }, el("i")), el("small"));
  const gitBtns = [sendB, pushB, pullB, commitB];
  // Outils de formatage C (norme EPITA) : injecter le .clang-format de l'espace WSL dans le dépôt courant
  const fmtMsg = el("span", { class: "dp-fmtmsg", role: "status", "aria-live": "polite" });
  let fmtTimer = 0;
  const fmtSay = (text, kind) => { fmtMsg.textContent = text; fmtMsg.className = "dp-fmtmsg " + (kind || ""); clearTimeout(fmtTimer); if (kind === "ok") fmtTimer = setTimeout(() => { fmtMsg.textContent = ""; }, 9000); };
  async function fmtRun(b, label, url, body, okText) {
    if (!S.repo) { fmtSay("Choisis d'abord un dépôt.", "bad"); return; }
    b.disabled = true; b.textContent = "…"; fmtSay("");
    try { const r = await post(url, { repo: S.repo, ...body }); fmtSay("✔ " + okText(r), "ok"); gitState(); if (S.tab === "git") paintGit(); }
    catch (e) { fmtSay("✕ " + e.message, "bad"); }
    b.textContent = label; b.disabled = !S.repo;
  }
  const injectB = btn("INJECTER .CLANG-FORMAT", () => fmtRun(injectB, "INJECTER .CLANG-FORMAT", "/api/depot/inject_clang_format", {}, (r) => ".clang-format EPITA " + (r.replaced ? "mis à jour (ancien fichier écrasé)" : "injecté avec succès")));
  injectB.title = "Écrit le style EPITA (intégré à E.N.O.S.) dans .clang-format à la racine du dépôt courant, en écrasant l'existant";
  const fmtDir = el("input", { type: "text", placeholder: "Dossier (ex: src/ ou vide pour tout)", spellcheck: false, autocomplete: "off", "aria-label": "Dossier à formater", onkeydown: (e) => { if (e.key === "Enter") fmtGo.click(); } });
  const fmtGo = btn("FORMATTER C/H", () => fmtRun(fmtGo, "FORMATTER C/H", "/api/depot/format_c", { folder: fmtDir.value.trim() }, (r) => r.files ? r.files + " fichier" + (r.files > 1 ? "s" : "") + " .c/.h formaté" + (r.files > 1 ? "s" : "") + " (" + r.target + ")" : "Aucun fichier .c/.h trouvé dans " + r.target));
  fmtGo.title = "Lance clang-format -i sur tous les .c et .h du dossier indiqué (tout le dépôt si vide). Exige le .clang-format dans le dépôt.";
  const fmtBtns = [injectB, fmtGo];
  // Espace de travail WSL : chaque utilisateur renseigne SON dossier (\\wsl.localhost\<distribution>\home\<son-nom>) ; le clone, les scripts et le terminal l'utilisent
  const wsB = btn("⚙ ESPACE WSL", () => workspaceDlg(), "ghost");
  wsB.title = "Dossier de travail WSL où sont clonés les dépôts et déposés les scripts (\\\\wsl.localhost\\Ubuntu\\home\\toi)";
  async function workspaceDlg() {
    const inp = el("input", { type: "text", placeholder: "\\\\wsl.localhost\\Ubuntu\\home\\toi", spellcheck: false, autocomplete: "off", "aria-label": "Dossier de travail WSL" });
    const status = el("div", { class: "dp-msg", text: "Chargement…" });
    const paint = (st) => { inp.value = st.unc; status.className = "dp-msg " + (st.exists ? "ok" : "bad"); status.textContent = st.exists ? "✔ Dossier trouvé dans WSL" + (st.default ? " (valeur par défaut)" : "") : "✕ " + (st.reason || "Dossier introuvable."); };
    const m = modal("ESPACE DE TRAVAIL WSL", el("div", {}, el("label", { text: "Dossier racine (là où sont tes dépôts)" }), inp, status,
      el("div", { class: "dp-note", text: "Format : \\\\wsl.localhost\\<distribution>\\home\\<ton-utilisateur-linux>. « Détecter » le lit dans WSL. Laisse vide pour revenir à la valeur par défaut. Le terminal ouvert sera relancé." })), [
      { label: "DÉTECTER", fn: async () => { try { const r = await post("/api/depot/workspace/detect", {}); inp.value = r.unc; status.className = "dp-msg"; status.textContent = "Trouvé : clique ENREGISTRER pour l'appliquer."; } catch (e) { status.className = "dp-msg bad"; status.textContent = "✕ " + e.message; } } },
      { label: "ENREGISTRER", cls: "dp-send", fn: async (d) => {
        try { const st = await post("/api/depot/workspace", { unc: inp.value.trim() }); closeTerm(); d.remove(); S.repo = ""; await refresh(true); fmtSay("✔ Espace de travail : " + st.unc, "ok"); }
        catch (e) { status.className = "dp-msg bad"; status.textContent = "✕ " + e.message; } } },
      { label: "ANNULER", fn: (d) => d.remove() }]);
    try { paint(await api("/api/depot/workspace")); } catch (e) { status.className = "dp-msg bad"; status.textContent = "✕ " + e.message; }
    return m;
  }
  const tabDefs = [["forge", "FORGE"], ["files", "FICHIERS"], ["git", "GIT"], ["subject", "SUJET"], ["train", "ENTRAÎN."], ["shell", "DÉPÔT SHELL"]];
  const tabBar = el("div", { class: "dp-tabs", role: "tablist" }, tabDefs.map(([id, l]) => el("button", { "data-t": id, role: "tab", text: l, onclick: () => tab(id) })));
  const panes = {}; tabDefs.forEach(([id]) => { panes[id] = el("div", { class: "dp-pane", hidden: true, id: "dp-p-" + id }); });
  const ftabs = el("div", { class: "dp-ftabs" }), editorBox = el("div", { id: "dp-editor" }, el("div", { class: "dp-ph", text: "Ouvre un fichier depuis l'onglet FICHIERS." }));
  const termBox = el("div", { id: "dp-term" }, el("div", { class: "dp-ph" }, btn("OUVRIR LE TERMINAL LINUX", () => openTerm())));
  const split = el("div", { class: "dp-split", title: "Redimensionner le terminal" });
  const purgeB = btn("🗑 PURGER TERMINAL", () => purgeTerm(), "ghost");
  purgeB.title = "Ferme le shell Linux actuel (tous ses processus) et en démarre un neuf et propre";
  const termBar = el("div", { class: "dp-termbar" }, el("small", { text: "TERMINAL" }), el("span", { class: "dp-sp" }), purgeB);
  root.append(
    el("div", { class: "dp-bar" }, el("h2", { text: "DÉPÔT INTRANET" }), repoSel, chipBranch, chipAB, cloneUrl, cloneB, el("span", { class: "dp-sp" }), ...gitBtns, btn("⟳", () => refresh(true)), btn("✕ FERMER", () => close())),
    el("div", { class: "dp-bar dp-fmtbar", role: "group", "aria-label": "Formatage C (norme EPITA)" }, el("small", { class: "dp-fmtlab", text: "FORMAT C" }), injectB, fmtDir, fmtGo, el("span", { class: "dp-sp" }), wsB, fmtMsg),
    cloneProg,
    el("div", { class: "dp-main" }, el("aside", { class: "dp-side" }, tabBar, Object.values(panes)), el("div", { class: "dp-work" }, ftabs, editorBox, split, termBar, termBox)));
  document.body.appendChild(root);

  function tab(id) {
    S.tab = id;
    tabBar.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.t === id));
    Object.entries(panes).forEach(([k, p]) => { p.hidden = k !== id; });
    ({ forge: paintForge, files: paintFiles, git: paintGit, subject: paintSubject, train: paintTrain, shell: paintShell }[id] || (() => {}))();
  }

  // ------------------------------------------------------------------ ouverture / dépôts
  async function show() {
    root.hidden = false;
    if (!S.opened) { S.opened = true; tab("forge"); }
    await refresh(true);
    clearInterval(S.clock); S.clock = setInterval(tick, 1000);
    startPoll();
  }
  function close() { root.hidden = true; clearInterval(S.clock); clearInterval(S.poll); }
  open.onclick = show;

  async function refresh(full) {
    try {
      S.st = await api("/api/depot/state");
      S.mode = S.st.mode; S.repos = S.st.repos || []; S.opts.shellTarget = (S.st.options || {}).shell_target || "root";
      const want = S.repo || S.st.current || (S.repos[0] && S.repos[0].name) || "";
      repoSel.replaceChildren(el("option", { value: "", text: S.repos.length ? "— dépôt —" : "aucun dépôt : clone-en un" }), ...S.repos.map((r) => el("option", { value: r.name, text: r.name + (r.dirty ? "  ●" : "") })));
      if (want && S.repos.some((r) => r.name === want)) { S.repo = want; repoSel.value = want; } else S.repo = "";
      gitBtns.concat(fmtBtns).forEach((b) => { b.disabled = !S.repo; });
      if (S.repo) await gitState();
      else { chipBranch.textContent = "—"; chipAB.hidden = true; }
    } catch (e) { panes[S.tab].replaceChildren(note(e.message, "bad")); }
    if (full) tab(S.tab);
  }
  async function selectRepo(name) {
    S.repo = name; S.tabs = []; S.cur = null; renderTabs(); if (S.ed) S.ed.setModel(null);
    if (name) { post("/api/depot/repo", { name }).catch(() => {}); }
    closeTerm(); await refresh(true);
  }
  async function gitState() {
    try {
      const s = await api("/api/depot/git/status?" + q({ repo: S.repo })); S.git = s;
      chipBranch.textContent = "⎇ " + (s.detached ? "(détaché)" : s.branch || "—");
      chipBranch.className = "dp-chip " + (s.clean ? "ok" : "warn");
      chipAB.hidden = !s.upstream; chipAB.textContent = "↑" + (s.ahead || 0) + " ↓" + (s.behind || 0);
    } catch (e) { chipBranch.textContent = "pas de Git"; chipBranch.className = "dp-chip warn"; S.git = null; }
  }
  function startPoll() { clearInterval(S.poll); S.poll = setInterval(() => { if (!root.hidden && !document.hidden) { if (S.tab === "forge") loadForge(false); else if (S.repo) gitState(); } }, 15000); }

  // ------------------------------------------------------------------ Forge (lien d'agenda .ics → tableau de bord en direct)
  async function loadForge(force) {
    try { S.forge = await api("/api/depot/forge" + (force ? "?force=1" : "")); } catch (e) { S.forge = { error: e.message, items: [], config: {} }; }
    if (S.tab === "forge") paintForge(true);
  }
  const urgency = (r) => (r < 0 ? "over" : r < 3600 ? "hot" : r < 86400 ? "warm" : "");
  const fmtAbs = (iso) => { const d = new Date(iso); return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) + " · " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); };
  const KIND = { pool: "PISCINE", project: "PROJET", exam: "EXAMEN", other: "AGENDA" };
  const STATUS = { running: "EN COURS", upcoming: "À VENIR", closed: "TERMINÉ", submitted: "RENDU" };
  function projCard(it) {
    const left = it.deadline_ts ? it.deadline_ts - Date.now() / 1000 : null;
    return el("div", { class: "dp-proj " + (it.status === "closed" ? "done " : "") + urgency(it.status === "closed" ? 1e9 : left), "data-dl": it.status === "closed" || it.status === "submitted" ? "" : it.deadline_ts, "data-start": it.start ? Date.parse(it.start) / 1000 : "" },
      el("h4", {}, el("span", { text: it.name }), el("span", { class: "dp-chip", text: KIND[it.kind] || "AGENDA" })),
      it.status === "closed" || it.status === "submitted" ? el("span", { class: "dp-note", text: (it.status === "submitted" ? "Rendu · " : "Terminé · ") + fmtAbs(it.deadline) })
        : el("div", { class: "dp-countrow" }, el("span", { class: "dp-count", text: fmtT(left) }), el("span", { class: "dp-note", text: "avant l'échéance du " + fmtAbs(it.deadline) })),
      it.progress != null && it.status === "running" ? el("div", { class: "dp-bar2", title: it.progress + " % du temps écoulé" }, el("i", { style: "width:" + Math.max(0, Math.min(100, it.progress)) + "%" })) : null,
      it.location ? el("small", { class: "dp-note", text: "📍 " + it.location }) : null,
      it.url ? btn("OUVRIR", () => window.open(it.url, "_blank", "noopener"), "ghost") : null);
  }
  function section(title, items, open) {
    if (!items.length) return null;
    return el("details", { open: open !== false, class: "dp-sec" }, el("summary", {}, title, el("span", { class: "dp-chip", text: String(items.length) })), el("div", { class: "dp-forge" }, items.map(projCard)));
  }
  function paintForge(skipLoad) {
    const p = panes.forge;
    if (!S.forge && !skipLoad) { p.replaceChildren(note("Chargement de la Forge…")); loadForge(false); return; }
    const f = S.forge || { items: [], config: {} }, c = f.config || {}, items = f.items || [];
    const running = items.filter((i) => i.status === "running"), upcoming = items.filter((i) => i.status === "upcoming"), done = items.filter((i) => i.status === "closed" || i.status === "submitted");
    const next = [...running, ...upcoming].filter((i) => i.deadline_ts).sort((a, b) => a.deadline_ts - b.deadline_ts)[0];
    const hero = next ? el("div", { class: "dp-hero " + urgency(next.deadline_ts - Date.now() / 1000), "data-dl": next.deadline_ts }, el("small", { text: "PROCHAINE ÉCHÉANCE" }), el("b", { text: next.name }), el("span", { class: "dp-count", text: fmtT(next.deadline_ts - Date.now() / 1000) })) : null;
    const link = el("input", { type: "text", placeholder: c.ics_set ? "Lien enregistré (" + c.host + ") — colle un nouveau lien pour le remplacer" : "https://forge.mon-ecole.fr/…/calendar.ics", spellcheck: false, autocomplete: "off" }), msg = el("div");
    const save = async () => { if (!link.value.trim()) { msg.replaceChildren(note("Colle d'abord le lien .ics.", "bad")); return; } try { await post("/api/depot/forge/config", { ics: link.value.trim() }); link.value = ""; msg.replaceChildren(note("Lien enregistré.", "ok")); await loadForge(true); } catch (e) { msg.replaceChildren(note(e.message, "bad")); } };
    link.onkeydown = (e) => { if (e.key === "Enter") save(); };
    const setup = el("details", { open: !c.ics_set, class: "dp-sec" }, el("summary", { text: c.ics_set ? "Lien de la Forge · " + c.host : "Brancher la Forge" }),
      el("div", { class: "dp-card" }, el("label", { text: "Lien d'agenda (.ics) de la Forge" }), link,
        el("div", { class: "dp-row" }, btn("ENREGISTRER", save), c.ics_set ? btn("EFFACER LE LIEN", async () => { await post("/api/depot/forge/clear", {}); await loadForge(true); }, "ghost") : null), msg,
        el("div", { class: "dp-note", text: "Même principe que Moodle ou Zeus : copie l'adresse « s'abonner au calendrier / export .ics » de ta Forge. Ce lien est secret : il reste sur ce PC, n'est jamais réaffiché ni envoyé ailleurs." })));
    const status = f.error ? note(f.error + (f.stale ? " — dernières données conservées." : ""), "bad") : f.fetched_at ? el("div", { class: "dp-note", text: "Synchronisé à " + new Date(f.fetched_at * 1000).toLocaleTimeString("fr-FR") + " · actualisation automatique" }) : null;
    p.replaceChildren(...[el("div", { class: "dp-row" }, btn("⟳ ACTUALISER", () => loadForge(true)), el("span", { class: "dp-sp" }), items.length ? el("span", { class: "dp-chip", text: running.length + " en cours" }) : null), status, hero,
      section("EN COURS", running), section("À VENIR", upcoming), section("TERMINÉS RÉCEMMENT", done, false),
      !items.length && c.ics_set && !f.error ? note("Aucune échéance dans l'agenda de la Forge pour le moment.") : null, setup].filter(Boolean));
  }
  function tick() {
    if (S.tab !== "forge" || root.hidden) return;
    const now = Date.now() / 1000;
    panes.forge.querySelectorAll("[data-dl]").forEach((n) => {
      const t = +n.dataset.dl; if (!t) return;
      const r = Math.floor(t - now), c = n.querySelector(".dp-count");
      if (c) c.textContent = r >= 0 ? fmtT(r) : "−" + fmtT(-r);
      n.classList.remove("over", "hot", "warm"); const u = urgency(r); if (u) n.classList.add(u);
    });
  }

  // ------------------------------------------------------------------ Monaco (VS Code) + fichiers
  async function ensureMonaco() {
    if (S.monaco) return S.monaco;
    if (!window.monaco) {
      await loadScript(EXT + "monaco/vs/loader.js");
      await new Promise((res, rej) => {
        window.require.config({ paths: { vs: EXT + "monaco/vs" }, "vs/nls": { availableLanguages: { "*": "fr" } } });
        const base = location.origin + EXT + "monaco/";
        window.MonacoEnvironment = { getWorkerUrl: () => URL.createObjectURL(new Blob([`self.MonacoEnvironment={baseUrl:'${base}'};importScripts('${base}vs/base/worker/workerMain.js');`], { type: "text/javascript" })) };
        window.require(["vs/editor/editor.main"], res, rej);
      });
    }
    const m = window.monaco, cs = getComputedStyle(document.documentElement), neon = (cs.getPropertyValue("--neon") || "#00ff9c").trim();
    const hex = (c, d) => (/^#[0-9a-f]{6}$/i.test(c) ? c : d);
    m.editor.defineTheme("enos", { base: "vs-dark", inherit: true, rules: [{ token: "keyword", foreground: hex(neon, "00ff9c").replace("#", ""), fontStyle: "bold" }, { token: "comment", foreground: "6b7a90", fontStyle: "italic" }, { token: "string", foreground: "f5d76e" }, { token: "number", foreground: "ff9d5c" }],
      colors: { "editor.background": "#0b0d10", "editorLineNumber.foreground": "#4b5565", "editorLineNumber.activeForeground": hex(neon, "#00ff9c"), "editorCursor.foreground": hex(neon, "#00ff9c"), "editor.selectionBackground": "#1f6f5a88", "editor.lineHighlightBackground": "#ffffff0a", "editorRuler.foreground": "#ffffff18" } });
    S.monaco = m; return m;
  }
  const LANG = { c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", py: "python", sh: "shell", bash: "shell", java: "java", sql: "sql", js: "javascript", mjs: "javascript", ts: "typescript", html: "html", css: "css", md: "markdown", json: "json", xml: "xml", yml: "yaml", yaml: "yaml", ini: "ini", dockerfile: "dockerfile" };
  const langOf = (p) => { const n = p.split("/").pop(); if (/^makefile$/i.test(n) || n.endsWith(".mk")) return "ini"; if (/^dockerfile$/i.test(n)) return "dockerfile"; return LANG[(n.split(".").pop() || "").toLowerCase()] || "plaintext"; };
  const isMake = (p) => /(^|\/)makefile$/i.test(p) || p.endsWith(".mk");
  async function ensureEditor() {
    const m = await ensureMonaco();
    if (S.ed) return S.ed;
    editorBox.replaceChildren();
    S.ed = m.editor.create(editorBox, { theme: "enos", automaticLayout: true, tabSize: 4, insertSpaces: true, detectIndentation: false, autoIndent: "full", formatOnType: true, formatOnPaste: true, fontSize: 14, fontFamily: "Consolas, 'Cascadia Code', monospace", fontLigatures: true,
      minimap: { enabled: false }, rulers: [80], renderWhitespace: "selection", bracketPairColorization: { enabled: true }, guides: { indentation: true, bracketPairs: true }, smoothScrolling: true, cursorBlinking: "smooth", cursorSmoothCaretAnimation: "on", scrollBeyondLastLine: false, wordWrap: "off", padding: { top: 8 } });
    S.ed.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => saveCur());
    return S.ed;
  }
  async function openFile(path) {
    if (!S.repo) return;
    try {
      const ed = await ensureEditor();
      let t = S.tabs.find((x) => x.path === path);
      if (!t) {
        const r = await api("/api/depot/fs/file?" + q({ repo: S.repo, path }));
        const model = S.monaco.editor.createModel(r.text, langOf(path), S.monaco.Uri.parse("enos://" + S.repo + "/" + path));
        model.updateOptions({ tabSize: 4, insertSpaces: !isMake(path) });              // Makefile : vraies tabulations ; sinon 4 espaces (norme)
        t = { path, model, saved: r.text, dirty: false };
        model.onDidChangeContent(() => { t.dirty = model.getValue() !== t.saved; renderTabs(); });
        S.tabs.push(t);
      }
      S.cur = t; ed.setModel(t.model); renderTabs(); ed.focus();
    } catch (e) { panes.files.prepend(note(e.message, "bad")); }
  }
  async function saveCur() {
    const t = S.cur; if (!t) return;
    try { const v = t.model.getValue(); await post("/api/depot/fs/file", { repo: S.repo, path: t.path, content: v }); t.saved = v; t.dirty = false; renderTabs(); gitState(); } catch (e) { panes.files.prepend(note(e.message, "bad")); }
  }
  function renderTabs() {
    ftabs.replaceChildren(...S.tabs.map((t) => el("button", { class: (t === S.cur ? "on " : "") + (t.dirty ? "dirty" : ""), onclick: () => { S.cur = t; S.ed.setModel(t.model); renderTabs(); } }, t.path.split("/").pop(),
      el("i", { text: "✕", title: "Fermer", onclick: (e) => { e.stopPropagation(); if (t.dirty && !confirm("Fermer sans enregistrer ?")) return; t.model.dispose(); S.tabs = S.tabs.filter((x) => x !== t); if (S.cur === t) { S.cur = S.tabs[S.tabs.length - 1] || null; S.ed.setModel(S.cur ? S.cur.model : null); } renderTabs(); } }))));
  }
  const treeCache = {};
  async function paintFiles() {
    const p = panes.files;
    if (!S.repo) { p.replaceChildren(note("Choisis ou clone un dépôt.")); return; }
    p.replaceChildren(el("div", { class: "dp-row" }, btn("+ FICHIER", () => newEntry("file")), btn("+ DOSSIER", () => newEntry("dir")), btn("⟳", () => { Object.keys(treeCache).forEach((k) => delete treeCache[k]); paintFiles(); })), el("div", { class: "dp-list", id: "dp-tree" }));
    await expand("", $("dp-tree"), 0);
  }
  async function expand(path, host, depth) {
    try {
      const r = treeCache[path] || (treeCache[path] = await api("/api/depot/fs/tree?" + q({ repo: S.repo, path: path || "." })));
      (r.items || []).forEach((it) => {
        const full = path ? path + "/" + it.name : it.name, row = el("div", { class: "dp-item dp-file", style: "padding-left:" + (8 + depth * 14) + "px" }, el("i", { text: it.type === "d" ? "▸" : "·" }), el("b", { text: it.name }));
        const sub = el("div", { class: "dp-list", hidden: true });
        row.onclick = async () => { if (it.type === "d") { sub.hidden = !sub.hidden; row.firstChild.textContent = sub.hidden ? "▸" : "▾"; if (!sub.hidden && !sub.childElementCount) await expand(full, sub, depth + 1); } else openFile(full); };
        host.append(row, sub);
      });
    } catch (e) { host.appendChild(note(e.message, "bad")); }
  }
  async function newEntry(kind) {
    const name = prompt(kind === "dir" ? "Nom du dossier (relatif au dépôt)" : "Nom du fichier (relatif au dépôt)"); if (!name) return;
    try { await post("/api/depot/fs/create", { repo: S.repo, path: name.trim(), kind }); Object.keys(treeCache).forEach((k) => delete treeCache[k]); paintFiles(); if (kind === "file") openFile(name.trim()); } catch (e) { panes.files.prepend(note(e.message, "bad")); }
  }

  // ------------------------------------------------------------------ terminal Linux (xterm.js ⇄ WebSocket ⇄ pty/WSL)
  async function openTerm() {
    if (!S.repo) { termBox.replaceChildren(el("div", { class: "dp-ph", text: "Choisis d'abord un dépôt." })); return; }
    termBox.replaceChildren(el("div", { class: "dp-ph", text: "Connexion au terminal…" }));
    try {
      loadCss(EXT + "xterm/xterm.css");
      if (typeof window.Terminal !== "function" || !(window.FitAddon && window.FitAddon.FitAddon)) { await loadUmd(EXT + "xterm/xterm.js"); await loadUmd(EXT + "xterm/addon-fit.js"); }
      if (typeof window.Terminal !== "function") throw new Error("xterm.js chargé mais « Terminal » reste indéfini (conflit avec un chargeur de modules).");
      // Police strictement monospace, sans espacement ni ligature : xterm mesure UNE cellule puis aligne toute la grille dessus (le moindre écart = caractères qui se chevauchent)
      const term = new window.Terminal({ cursorBlink: true, fontFamily: "Consolas, 'Courier New', monospace", fontSize: 13, fontWeight: "normal", fontWeightBold: "bold", letterSpacing: 0, lineHeight: 1, theme: { background: "#0b0d10" }, scrollback: 5000, convertEol: false, rightClickSelectsWord: false });
      const fit = new window.FitAddon.FitAddon(); term.loadAddon(fit);
      termBox.replaceChildren(); term.open(termBox); fit.fit();
      const refit = () => { try { fit.fit(); } catch (x) { /* conteneur masqué */ } };
      requestAnimationFrame(refit); if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { term.options.fontFamily = "Consolas, 'Courier New', monospace"; refit(); });   // re-mesure la cellule quand les polices sont chargées
      // Copier-coller. Ctrl+V / Maj+Inser : l'événement « paste » natif est repris ici (xterm gère le mode « bracketed paste ») ; la touche n'est PAS envoyée au shell (^V).
      const pasteText = (t) => { if (t) term.paste(t.replace(/\r?\n/g, "\r")); };
      const pasteClip = async () => { try { pasteText(await navigator.clipboard.readText()); } catch (x) { term.write("\r\n\x1b[33m[collage refusé par le navigateur : autorise le presse-papiers ou utilise Ctrl+V]\x1b[0m\r\n"); } };
      const copySel = () => { const s = term.getSelection(); if (s) { try { navigator.clipboard.writeText(s); } catch (x) { /* refusé */ } } return !!s; };
      termBox.addEventListener("paste", (e) => { e.preventDefault(); e.stopImmediatePropagation(); pasteText((e.clipboardData || window.clipboardData).getData("text")); }, true);
      term.attachCustomKeyEventHandler((e) => {
        if (e.type !== "keydown") return true;
        const k = e.key.toLowerCase();
        if ((e.ctrlKey && !e.altKey && k === "v") || (e.shiftKey && e.key === "Insert")) return false;                       // laisse l'événement « paste » faire le travail, sans envoyer ^V
        if (e.ctrlKey && e.shiftKey && k === "c") { copySel(); return false; }                                              // Ctrl+Maj+C : copier
        if (e.ctrlKey && !e.shiftKey && !e.altKey && k === "c" && term.hasSelection()) { copySel(); return false; }          // Ctrl+C avec sélection : copier ; sans sélection : interruption (^C) comme d'habitude
        return true;
      });
      termBox.addEventListener("contextmenu", (e) => { e.preventDefault(); if (!copySel()) pasteClip(); else term.clearSelection(); });   // clic droit : copie la sélection, sinon colle
      const url = (await window.naskoSec.wsUrl("/ws/depot-term")) + "&" + q({ repo: S.repo, cols: term.cols, rows: term.rows });
      const ws = new WebSocket(url); ws.binaryType = "arraybuffer";
      const enc = new TextEncoder();
      ws.onmessage = (e) => { if (typeof e.data === "string") { try { const m = JSON.parse(e.data); if (m.t === "exit") term.write("\r\n\x1b[90m[terminal terminé, code " + m.code + "]\x1b[0m\r\n"); else if (m.t === "error") term.write("\r\n\x1b[31m" + m.message + "\x1b[0m\r\n"); } catch (x) { /* ignoré */ } } else term.write(new Uint8Array(e.data)); };
      ws.onclose = () => { if (S.ws === ws) { term.write("\r\n\x1b[90m[connexion fermée]\x1b[0m\r\n"); S.ws = null; } };
      term.onData((d) => { if (ws.readyState === 1) ws.send(enc.encode(d)); });
      term.onResize(({ cols, rows }) => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: "resize", cols, rows })); });
      new ResizeObserver(() => { try { fit.fit(); } catch (x) { /* masqué */ } }).observe(termBox);
      S.term = term; S.ws = ws; S.fit = fit; term.focus();
    } catch (e) { termBox.replaceChildren(el("div", { class: "dp-ph" }, note("Terminal indisponible : " + e.message, "bad"))); }
  }
  // PURGER : dispose l'instance xterm, vide le conteneur, demande au serveur de tuer le shell (et ses enfants), puis rouvre un terminal tout neuf
  let purging = false;
  async function purgeTerm() {
    if (purging) return;
    purging = true; purgeB.disabled = true; purgeB.textContent = "…";
    try {
      closeTerm();
      termBox.replaceChildren(el("div", { class: "dp-ph", text: "Purge du terminal…" }));
      await post("/api/depot/terminal/reset", { repo: S.repo || "" });
      if (S.repo) await openTerm();
      else termBox.replaceChildren(el("div", { class: "dp-ph" }, btn("OUVRIR LE TERMINAL LINUX", () => openTerm())));
    } catch (e) { termBox.replaceChildren(el("div", { class: "dp-ph" }, note("Purge impossible : " + e.message, "bad"))); }
    finally { purging = false; purgeB.disabled = false; purgeB.textContent = "🗑 PURGER TERMINAL"; }
  }
  function closeTerm() { try { if (S.ws) S.ws.close(); } catch (e) { /* déjà fermé */ } try { if (S.term) S.term.dispose(); } catch (e) { /* déjà détruit */ } S.ws = S.term = S.fit = null; termBox.replaceChildren(el("div", { class: "dp-ph" }, btn("OUVRIR LE TERMINAL LINUX", () => openTerm()))); }
  (() => { let y = 0, h = 0, on = false; split.onpointerdown = (e) => { on = true; y = e.clientY; h = termBox.offsetHeight; split.setPointerCapture(e.pointerId); }; split.onpointermove = (e) => { if (on) termBox.style.height = Math.max(80, Math.min(window.innerHeight - 220, h + y - e.clientY)) + "px"; }; split.onpointerup = () => { on = false; if (S.fit) try { S.fit.fit(); } catch (x) { /* ignoré */ } }; })();

  // ------------------------------------------------------------------ Git
  const stepsView = (steps) => el("div", { class: "dp-steps" }, (steps || []).map((s) => el("div", { class: s.ok ? "ok" : "bad", text: (s.ok ? "✔ " : "✕ ") + s.name + (s.output ? " — " + String(s.output).trim().split("\n").slice(-2).join(" ") : "") })));
  async function gitSimple(op) {
    const b = { push: pushB, pull: pullB }[op]; b.disabled = true; const t = b.textContent; b.textContent = "…";
    try { const r = await post("/api/depot/git/" + op, { repo: S.repo }); const m = r.conflict ? "Conflit sur : " + (r.files || []).join(", ") : (r.output || "OK").trim().split("\n").slice(-3).join("\n"); modal(op.toUpperCase(), note(m, r.conflict ? "bad" : "ok"), [{ label: "OK", fn: (d) => d.remove() }]); }
    catch (e) { modal(op.toUpperCase(), note(e.message, "bad"), [{ label: "OK", fn: (d) => d.remove() }]); }
    b.textContent = t; b.disabled = false; gitState(); if (S.tab === "git") paintGit();
  }
  function commitDlg() {
    const msg = el("textarea", { placeholder: "Message du commit" }), out = el("div");
    modal("COMMIT (git commit -m)", el("div", {}, el("label", { text: "Message" }), msg, el("div", { class: "dp-note", text: "Commite ce qui est déjà ajouté (git add). Pour tout envoyer d'un coup : bouton ENVOYER." }), out), [
      { label: "COMMITER", fn: async (d) => { try { await post("/api/depot/git/commit", { repo: S.repo, message: msg.value }); d.remove(); gitState(); if (S.tab === "git") paintGit(); } catch (e) { out.replaceChildren(note(e.message, "bad")); } } }, { label: "ANNULER", fn: (d) => d.remove(), cls: "ghost" }]);
  }
  function sendDlg() {
    const folder = el("input", { type: "text", value: ".", list: "dp-dirs", spellcheck: false }), dl = el("datalist", { id: "dp-dirs" });
    const msg = el("textarea", { placeholder: "Message du commit" }), tag = el("input", { type: "text", placeholder: "ex : ex00  (→ ex00V1, ex00V2…)", spellcheck: false }), prev = el("div", { class: "dp-tagprev", text: "Tag : —" }), out = el("div");
    ((S.git && S.git.files) || []).map((f) => f.path.split("/")[0]).filter((v, i, a) => a.indexOf(v) === i).forEach((d) => dl.appendChild(el("option", { value: d })));
    let tm = 0; const upd = () => { clearTimeout(tm); tm = setTimeout(async () => { try { const r = await api("/api/depot/git/next-tag?" + q({ repo: S.repo, prefix: tag.value.trim() })); prev.textContent = "Tag : " + r.tag; } catch (e) { prev.textContent = "Tag : ?"; } }, 250); };
    tag.oninput = upd; upd();
    modal("ENVOYER", el("div", {}, el("label", { text: "Dossier à ajouter (git add <dossier>)" }), folder, dl, el("label", { text: "Message du commit" }), msg, el("label", { text: "Nom du tag (la version Vn est ajoutée automatiquement)" }), tag, prev, el("div", { class: "dp-note", text: "Enchaîne : git add → git commit → git tag -a (V auto-incrémenté) → git push --follow-tags." }), out), [
      { label: "ENVOYER", cls: "dp-send", fn: async (d) => {
        out.replaceChildren(note("Envoi en cours…"));
        try { const r = await post("/api/depot/git/send", { repo: S.repo, folder: folder.value.trim() || ".", message: msg.value, tag: tag.value.trim(), push: true }); out.replaceChildren(note(r.ok ? "Envoyé : " + r.tag : "Envoi interrompu", r.ok ? "ok" : "bad"), stepsView(r.steps)); gitState(); if (r.ok) setTimeout(() => d.remove(), 1800); }
        catch (e) { out.replaceChildren(...[note(e.message, "bad"), e.data && e.data.steps ? stepsView(e.data.steps) : null].filter(Boolean)); }
      } }, { label: "FERMER", fn: (d) => d.remove(), cls: "ghost" }]);
  }
  // ------------------------------------------------------------------ git clone : AUCUNE fenêtre, AUCUN choix de dossier
  // Le dossier de destination n'est plus une question : le backend clone toujours dans l'espace de travail (\\wsl.localhost\Ubuntu\home\nasko en WSL ; dépôt local ailleurs).
  // Un clic sur GIT CLONE envoie l'adresse au backend sur-le-champ et affiche la barre de progression sous la barre d'outils.
  let cloning = false;
  const cloneBar = () => cloneProg.querySelector(".dp-bar2");
  // progression git (« Receiving objects: 45% », « Resolving deltas: 80% »…) ramenée à une échelle unique 0-100 ; null = pas encore de pourcentage
  function cloneProgress(line, prev) {
    const m = /(Receiving objects|Resolving deltas|Updating files|Checking out files):\s+(\d{1,3})%/.exec(line || "");
    if (!m) return prev;
    const p = Math.min(100, +m[2]);
    const v = m[1] === "Receiving objects" ? p * 0.8 : m[1] === "Resolving deltas" ? 80 + p * 0.15 : 95 + p * 0.05;
    return Math.max(prev || 0, Math.min(99, Math.round(v)));
  }
  function paintClone(pct, text, kind) {
    cloneProg.hidden = false; cloneProg.className = "dp-cprog" + (kind ? " " + kind : "");
    const bar = cloneBar(); bar.classList.toggle("ind", pct == null && !kind);
    bar.firstChild.style.width = pct == null ? "" : pct + "%";
    cloneProg.querySelector("small").textContent = text;
  }
  async function startClone() {
    if (cloning) return;
    const url = cloneUrl.value.trim();
    if (!url) { cloneUrl.focus(); return; }                                  // rien à cloner : le curseur est placé dans le champ, sans dialogue
    cloning = true; cloneB.disabled = true; cloneUrl.disabled = true;
    const dest = (S.st && S.st.base) || "";
    let pct = null;
    paintClone(null, "Clonage de " + url + (dest ? " → " + dest : "") + " …");
    try {
      const r = await post("/api/depot/clone", { url });                      // pas de nom de dossier : il est déduit de l'adresse côté backend
      if (r.job) {
        for (let i = 0; i < 1800; i++) {                                      // 15 min maximum
          await new Promise((z) => setTimeout(z, 500));
          const j = await api("/api/dev/job?" + q({ id: r.job, since: 0 }));
          const lines = (j.text || "").trim().split("\n"), last = lines[lines.length - 1] || "";
          pct = cloneProgress(last, pct);
          paintClone(pct, last || "Connexion au dépôt…");
          if (!j.running) {
            if (j.rc !== 0) throw new Error("git clone a échoué : " + (lines.slice(-2).join(" ").trim() || "code " + j.rc));
            break;
          }
        }
      }
      paintClone(100, "Cloné : " + (r.name || url), "ok");
      cloneUrl.value = "";
      S.repo = r.name || ""; await refresh(true);
      setTimeout(() => { if (!cloning) cloneProg.hidden = true; }, 2500);
    } catch (e) { paintClone(100, e.message, "bad"); }
    finally { cloning = false; cloneB.disabled = false; cloneUrl.disabled = false; }
  }
  async function paintGit() {
    const p = panes.git; if (!S.repo) { p.replaceChildren(note("Choisis ou clone un dépôt.")); return; }
    p.replaceChildren(note("Chargement…"));
    try {
      const [st, br, tg, lg] = await Promise.all([api("/api/depot/git/status?" + q({ repo: S.repo })), api("/api/depot/git/branches?" + q({ repo: S.repo })), api("/api/depot/git/tags?" + q({ repo: S.repo })), api("/api/depot/git/log?" + q({ repo: S.repo, n: 15 }))]);
      S.git = st;
      const out = el("div");
      const act = async (url, body, okMsg) => { try { const r = await post(url, { repo: S.repo, ...body }); if (r && r.conflict) out.replaceChildren(note("Conflit : " + (r.files || []).join(", ") + " — résous-le puis commit, ou annule la fusion.", "bad")); else out.replaceChildren(note(okMsg || "OK", "ok")); await gitState(); paintGit(); } catch (e) { out.replaceChildren(note(e.message, "bad")); } };
      const files = el("div", { class: "dp-list" }, st.files.slice(0, 60).map((f) => el("div", { class: "dp-item" }, el("b", { text: f.path }), el("small", { text: (f.index || " ") + (f.worktree || " ") }))));
      const brCard = el("div", { class: "dp-card" }, el("h3", {}, "BRANCHES"), el("div", { class: "dp-list" }, br.local.map((b) => el("div", { class: "dp-item" + (b.name === br.current ? " on" : "") }, el("b", { text: b.name }), el("small", { text: b.upstream ? "↑" + (b.ahead || 0) + " ↓" + (b.behind || 0) : "local" }),
        b.name === br.current ? null : [btn("↪", () => act("/api/depot/git/branch", { action: "switch", name: b.name }, "Branche changée."), "ghost"), btn("FUSIONNER", () => { if (confirm("Fusionner « " + b.name + " » dans « " + br.current + " » ?")) act("/api/depot/git/branch", { action: "merge", name: b.name }, "Fusion terminée."); }, "ghost"),
          btn("✕", () => { if (confirm("Supprimer la branche « " + b.name + " » ?")) act("/api/depot/git/branch", { action: "delete", name: b.name }, "Branche supprimée.").then(() => {}); }, "ghost")]))),
        el("div", { class: "dp-row" }, (() => { const n = el("input", { type: "text", placeholder: "nouvelle-branche", spellcheck: false }); return [n, btn("OUVRIR", () => act("/api/depot/git/branch", { action: "create", name: n.value.trim() }, "Branche créée et activée."))]; })(), btn("ANNULER UNE FUSION", () => act("/api/depot/git/branch", { action: "merge_abort" }, "Fusion annulée."), "ghost")));
      const tgCard = el("div", { class: "dp-card" }, el("h3", {}, "TAGS ", el("small", { text: tg.items.length + "" })), el("div", { class: "dp-list" }, tg.items.slice(0, 30).map((t) => el("div", { class: "dp-item" }, el("b", { text: t.name }), el("small", { text: (t.date || "").slice(0, 10) }),
        btn("✕ local", () => { if (confirm("Supprimer le tag local « " + t.name + " » ?")) act("/api/depot/git/tag/delete", { name: t.name, remote: false }, "Tag supprimé."); }, "ghost"),
        btn("✕ distant", () => { if (confirm("Supprimer le tag « " + t.name + " » sur le dépôt distant ?")) act("/api/depot/git/tag/delete", { name: t.name, remote: true }, "Tag distant supprimé."); }, "ghost")))));
      const logCard = el("div", { class: "dp-card" }, el("h3", {}, "HISTORIQUE"), el("div", { class: "dp-list" }, lg.items.map((c) => el("div", { class: "dp-item" }, el("small", { text: c.short }), el("b", { text: c.subject }), el("small", { text: c.refs || "" })))));
      p.replaceChildren(el("div", { class: "dp-card" }, el("h3", {}, "ÉTAT ", el("small", { text: st.clean ? "propre" : st.files.length + " modification(s)" })), files, el("div", { class: "dp-row" }, btn("FETCH", () => act("/api/depot/git/fetch", {}, "Fetch terminé.")))), out, brCard, tgCard, logCard);
    } catch (e) { p.replaceChildren(note(e.message, "bad")); }
  }

  // ------------------------------------------------------------------ dropzones
  function dropzone(title, hint, onFile, accept) {
    const inp = el("input", { type: "file", accept: accept || "", hidden: true });
    const z = el("div", { class: "dp-drop", tabIndex: 0 }, el("b", { text: title }), hint, inp);
    const take = (f) => f && onFile(f);
    z.onclick = () => inp.click(); inp.onchange = () => take(inp.files[0]);
    z.ondragover = (e) => { e.preventDefault(); z.classList.add("hot"); }; z.ondragleave = () => z.classList.remove("hot");
    z.ondrop = (e) => { e.preventDefault(); z.classList.remove("hot"); take(e.dataTransfer.files[0]); };
    return z;
  }
  function paintShell() {
    const p = panes.shell, out = el("div"), ow = el("input", { type: "checkbox" });
    p.replaceChildren(el("div", { class: "dp-card" }, el("h3", {}, "DÉPÔT SHELL ", el("small", { text: S.repo ? "→ racine de « " + S.repo + " »" : "choisis un dépôt" })),
      dropzone("DÉPÔT SHELL", "Glisse ici un script .sh : il est déposé à la racine du dépôt (à côté de ton code et du dossier .git), converti en LF et rendu exécutable.", async (f) => {
        if (!S.repo) { out.replaceChildren(note("Choisis d'abord un dépôt.", "bad")); return; }
        const fd = new FormData(); fd.append("file", f); fd.append("repo", S.repo); fd.append("target", "root"); fd.append("overwrite", ow.checked ? "1" : "");
        try { const r = await api("/api/depot/shell-drop", { method: "POST", body: fd }); out.replaceChildren(note("Déposé : " + r.path + (r.executable ? " (exécutable)" : ""), "ok")); gitState(); Object.keys(treeCache).forEach((k) => delete treeCache[k]); }
        catch (e) { out.replaceChildren(note(e.status === 409 ? "Un fichier de ce nom existe déjà : coche « écraser » puis redépose." : e.message, "bad")); }
      }, ".sh,text/x-shellscript"),
      el("label", { class: "ac-toggle" }, ow, " Écraser un fichier existant"), out,
      el("div", { class: "dp-note", text: "Le script n'est jamais lancé automatiquement : relis-le, puis exécute-le dans le terminal (./nom.sh). Nom du fichier : lettres, chiffres, . _ - uniquement." })));
  }

  // ------------------------------------------------------------------ Sujet (PDF → roadmap)
  async function paintSubject() {
    const p = panes.subject; if (!S.repo) { p.replaceChildren(note("Choisis ou clone un dépôt : la roadmap est liée au dépôt.")); return; }
    const out = el("div"); p.replaceChildren(note("Chargement…"));
    try { S.roadmap = (await api("/api/depot/roadmap?" + q({ key: S.repo }))).roadmap; } catch (e) { S.roadmap = null; }
    const dz = dropzone("SUJET DU PROJET", "Glisse le PDF du sujet : l'IA t'explique les étapes et génère une roadmap à cocher.", async (f) => {
      out.replaceChildren(note("Analyse du sujet en cours…"));
      const fd = new FormData(); fd.append("file", f); fd.append("key", S.repo);
      try { const r = await api("/api/depot/subject/analyze", { method: "POST", body: fd }); S.roadmap = r.roadmap; paintSubject(); } catch (e) { out.replaceChildren(note(e.message, "bad")); }
    }, ".pdf,application/pdf");
    const R = S.roadmap && S.roadmap.analysis;
    if (!R) { p.replaceChildren(dz, out); return; }
    const done = R.steps.filter((s) => s.done).length;
    p.replaceChildren(dz, out, el("div", { class: "dp-card" }, el("h3", {}, R.title || "Sujet", el("small", { text: done + "/" + R.steps.length })), el("div", { class: "dp-bar2" }, el("i", { style: "width:" + Math.round(100 * done / Math.max(1, R.steps.length)) + "%" })), el("div", { class: "dp-note", text: R.summary || "" }),
      R.constraints && R.constraints.length ? el("div", { class: "dp-note", text: "Contraintes : " + R.constraints.join(" · ") }) : null,
      R.deliverables && R.deliverables.length ? el("div", { class: "dp-note", text: "À rendre : " + R.deliverables.join(" · ") }) : null, R.fallback ? note("Analyse automatique simplifiée (l'IA n'a pas répondu).", "bad") : null),
      el("div", { class: "dp-list" }, R.steps.map((s) => { const cb = el("input", { type: "checkbox", checked: !!s.done, onchange: async () => { try { await post("/api/depot/roadmap/step", { key: S.repo, step: s.id, done: cb.checked }); paintSubject(); } catch (e) { out.replaceChildren(note(e.message, "bad")); } } }); return el("label", { class: "dp-step" + (s.done ? " done" : "") }, cb, el("b", { text: s.title }), el("p", { text: s.detail || "" })); })),
      btn("SUPPRIMER LA ROADMAP", async () => { if (confirm("Supprimer la roadmap de ce dépôt ?")) { await api("/api/depot/roadmap?" + q({ key: S.repo }), { method: "DELETE" }); paintSubject(); } }, "ghost"));
  }

  // ------------------------------------------------------------------ Entraînements personnels (bibliothèque) + ETO
  const ago = (iso) => { if (!iso) return "jamais refait"; const d = (Date.now() - Date.parse(iso)) / 86400000; return d < 1 ? "refait aujourd'hui" : d < 2 ? "refait hier" : "refait il y a " + Math.floor(d) + " j"; };
  async function paintTrain() {
    const p = panes.train, out = el("div"); p.replaceChildren(note("Chargement…"));
    let items = []; try { items = (await api("/api/depot/trainings")).items; } catch (e) { p.replaceChildren(note(e.message, "bad")); return; }
    const dz = dropzone("ENTRAÎNEMENT", "Glisse un sujet (PDF) : il est enregistré dans ta bibliothèque « Entraînements personnels » pour le refaire plus tard avec ETO.", async (f) => {
      out.replaceChildren(note("Enregistrement et analyse du sujet…"));
      const fd = new FormData(); fd.append("file", f); fd.append("title", f.name.replace(/\.pdf$/i, ""));
      try { const r = await api("/api/depot/trainings", { method: "POST", body: fd }); S.train = r.training; paintTrain(); } catch (e) { out.replaceChildren(note(e.message, "bad")); }
    }, ".pdf,application/pdf");
    const search = el("input", { type: "text", placeholder: "Filtrer les entraînements…", spellcheck: false });
    const grid = el("div", { class: "dp-lib" });
    const draw = () => {
      const f = search.value.trim().toLowerCase(), shown = items.filter((t) => !f || (t.title + " " + (t.tags || []).join(" ")).toLowerCase().includes(f));
      grid.replaceChildren(...shown.map((t) => {
        const pct = t.total ? Math.round(100 * t.done_count / t.total) : 0;
        return el("div", { class: "dp-tcard" + (S.train && S.train.id === t.id ? " on" : ""), onclick: () => openTraining(t.id) },
          el("div", { class: "dp-tt" }, el("b", { text: t.title }), btn("✕", async (e) => { e.stopPropagation(); if (confirm("Supprimer l'entraînement « " + t.title + " » ?")) { await api("/api/depot/trainings/" + encodeURIComponent(t.id), { method: "DELETE" }); if (S.train && S.train.id === t.id) S.train = null; paintTrain(); } }, "ghost")),
          el("div", { class: "dp-bar2" }, el("i", { style: "width:" + pct + "%" })),
          el("small", { class: "dp-note", text: t.done_count + "/" + t.total + " étapes · " + ago(t.last_done) }),
          (t.tags || []).length ? el("div", { class: "dp-tags" }, t.tags.slice(0, 4).map((x) => el("span", { class: "dp-chip", text: x }))) : null);
      }));
      if (!shown.length) grid.appendChild(note(items.length ? "Aucun résultat." : "Ta bibliothèque est vide : glisse un premier sujet ci-dessus."));
    };
    search.oninput = draw; draw();
    p.replaceChildren(dz, out, el("div", { class: "dp-card" }, el("h3", {}, "BIBLIOTHÈQUE ", el("small", { text: items.length + " entraînement" + (items.length > 1 ? "s" : "") })), items.length > 4 ? search : null, grid), el("div", { id: "dp-train-detail" }));
    if (S.train) openTraining(S.train.id, true);
  }
  async function openTraining(id, quiet) {
    const host = $("dp-train-detail"); if (!host) return;
    try {
      const t = (await api("/api/depot/trainings/" + encodeURIComponent(id))).training; S.train = t; const A = t.analysis || { steps: [] };
      document.querySelectorAll(".dp-tcard").forEach((c) => c.classList.remove("on"));
      const chat = el("div", { class: "dp-chat" }), q1 = el("input", { type: "text", placeholder: "Pose une question à ETO (il guide, il ne donne pas la solution)", spellcheck: false });
      const hist = [];
      const ask = async () => { const v = q1.value.trim(); if (!v) return; q1.value = ""; chat.appendChild(el("div", { text: v })); hist.push({ role: "user", text: v }); const wait = el("div", { class: "eto", text: "ETO réfléchit…" }); chat.appendChild(wait);
        try { const code = S.cur ? S.cur.model.getValue().slice(0, 6000) : ""; const r = await post("/api/depot/trainings/" + encodeURIComponent(id) + "/ask", { question: v, code, history: hist.slice(-6) }); wait.textContent = r.text; hist.push({ role: "assistant", text: r.text }); } catch (e) { wait.textContent = e.message; } chat.scrollTop = chat.scrollHeight; };
      q1.onkeydown = (e) => { if (e.key === "Enter") ask(); };
      const bar = el("div", { class: "dp-bar2" }, el("i", { style: "width:" + Math.round(100 * (A.steps || []).filter((s) => s.done).length / Math.max(1, (A.steps || []).length)) + "%" }));
      const summary = [A.summary, (A.constraints || []).length ? "Contraintes : " + A.constraints.join(" · ") : "", (A.deliverables || []).length ? "À rendre : " + A.deliverables.join(" · ") : ""].filter(Boolean);
      host.replaceChildren(el("div", { class: "dp-card dp-detail" }, el("h3", {}, t.title, el("small", { text: "refaire avec ETO" })), bar, summary.map((x) => el("div", { class: "dp-note", text: x })),
        A.fallback ? note("Analyse automatique simplifiée (l'IA n'a pas répondu) : tu peux relancer l'analyse.", "bad") : null,
        el("div", { class: "dp-list" }, (A.steps || []).map((s) => { const cb = el("input", { type: "checkbox", checked: !!s.done, onchange: async () => { await post("/api/depot/trainings/" + encodeURIComponent(id) + "/step", { step: s.id, done: cb.checked }); } }); return el("label", { class: "dp-step" + (s.done ? " done" : "") }, cb, el("b", { text: s.title }), el("p", { text: s.detail || "" })); })),
        el("div", { class: "dp-row" }, btn("J'AI REFAIT CET ENTRAÎNEMENT", async () => { const m = prompt("Combien de minutes ? (facultatif)") || ""; await post("/api/depot/trainings/" + encodeURIComponent(id) + "/attempt", { minutes: m && /^\d+$/.test(m) ? +m : null }); paintTrain(); }, "ghost")),
        el("h3", {}, "ETO ", el("small", { text: "ton tuteur" })), chat, el("div", { class: "dp-row" }, q1, btn("DEMANDER", ask))));
      if (!quiet) host.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (e) { host.replaceChildren(note(e.message, "bad")); }
  }

  window.addEventListener("beforeunload", () => { try { if (S.ws) S.ws.close(); } catch (e) { /* fermeture */ } });
})();
